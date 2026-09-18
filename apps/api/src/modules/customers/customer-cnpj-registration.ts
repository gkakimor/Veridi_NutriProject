import { z } from "zod";
import type { Customer, CustomerCnpjRegistrationHistory, Prisma, User } from "@prisma/client";
import type {
  CnpjRegistrationEventKind,
  CnpjRegistrationField,
  CnpjRegistrationFieldChange,
  CnpjRegistrationValue,
  CustomerCnpjRegistration,
  CustomerCnpjRegistrationEventDTO,
} from "@veridi/shared";
import {
  CNPJ_REGISTRATION_CHANGE_SOURCES,
  CNPJ_REGISTRATION_FIELDS,
  normalizeCnpj,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDoDiaCivil } from "../../lib/business-day.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.schemas.js";

/**
 * Dados cadastrais do CNPJ no Cliente — §119 e §122
 * (CUSTOMER-CNPJ-PERSISTED-DATA-01, CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Os dez campos são do cadastro e EDITÁVEIS; a consulta de CNPJ só os sugere.
 * O que este módulo garante, no servidor:
 *
 * 1. os dados pertencem ao CNPJ que o Cliente tem: o bloco enviado com outro
 *    CNPJ é recusado, e trocar o CNPJ LIMPA os dados do número anterior;
 * 2. toda gravação que muda os dados, aplica uma consulta ou limpa por troca de
 *    CNPJ deixa UM evento no histórico, na mesma transação, com a mudança
 *    campo a campo e a origem de cada uma — e nunca "A → A";
 * 3. a "Última consulta CNPJ" é do sistema: só muda quando uma consulta é
 *    aplicada e salva, e volta a nulo quando o CNPJ muda;
 * 4. o evento gravado na CRIAÇÃO do Cliente leva a marca estrutural
 *    `createdWithCustomerId` (§125); o de alteração, nunca.
 *
 * Consultar (`GET /cnpj-lookup/:cnpj`) não passa por aqui e não grava nada.
 */

/** Frase da recusa do bloco de outro CNPJ — no campo CNPJ, que é onde a pessoa corrige. */
export const DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE =
  "Os dados cadastrais enviados são de outro CNPJ. Confira o CNPJ do cadastro e consulte de novo.";

export class CnpjRegistrationMismatchError extends Error {
  constructor() {
    super(DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE);
    this.name = "CnpjRegistrationMismatchError";
  }
}

export function respostaDaRecusaDosDadosDoCnpj(error: CnpjRegistrationMismatchError) {
  return {
    error: "validation_error",
    message: error.message,
    issues: [{ path: "cnpj", message: error.message }],
  };
}

/** As onze colunas do bloco, na forma que o Prisma grava. */
type ColunasDosDadosDoCnpj = Pick<
  Customer,
  | "cnpjMainCnaeCode"
  | "cnpjMainCnaeDescription"
  | "cnpjLegalNature"
  | "cnpjCompanySize"
  | "cnpjOpenedAt"
  | "cnpjEstablishmentType"
  | "cnpjSimplesOptIn"
  | "cnpjMeiOptIn"
  | "cnpjRegistrationStatus"
  | "cnpjRegistrationStatusDate"
  | "cnpjLastConsultedAt"
>;

/** Para `select` de quem precisa do bloco gravado. */
export const colunasDosDadosDoCnpjSelect = {
  cnpjMainCnaeCode: true,
  cnpjMainCnaeDescription: true,
  cnpjLegalNature: true,
  cnpjCompanySize: true,
  cnpjOpenedAt: true,
  cnpjEstablishmentType: true,
  cnpjSimplesOptIn: true,
  cnpjMeiOptIn: true,
  cnpjRegistrationStatus: true,
  cnpjRegistrationStatusDate: true,
  cnpjLastConsultedAt: true,
} as const satisfies Record<keyof ColunasDosDadosDoCnpj, true>;

const COLUNA: Record<CnpjRegistrationField, Exclude<keyof ColunasDosDadosDoCnpj, "cnpjLastConsultedAt">> = {
  mainCnaeCode: "cnpjMainCnaeCode",
  mainCnaeDescription: "cnpjMainCnaeDescription",
  legalNature: "cnpjLegalNature",
  companySize: "cnpjCompanySize",
  openedAt: "cnpjOpenedAt",
  establishmentType: "cnpjEstablishmentType",
  simplesOptIn: "cnpjSimplesOptIn",
  meiOptIn: "cnpjMeiOptIn",
  registrationStatus: "cnpjRegistrationStatus",
  registrationStatusDate: "cnpjRegistrationStatusDate",
};

/** Os dois campos que são DATA CIVIL: `YYYY-MM-DD` no contrato, meia-noite UTC na coluna. */
const DIAS_CIVIS: ReadonlySet<CnpjRegistrationField> = new Set(["openedAt", "registrationStatusDate"]);

type ValoresCadastrais = Record<CnpjRegistrationField, CnpjRegistrationValue>;

const VAZIOS = Object.fromEntries(
  CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, null]),
) as ValoresCadastrais;

/** O que a linha tem gravado, no formato do contrato. */
function valoresGravados(colunas: ColunasDosDadosDoCnpj): ValoresCadastrais {
  return Object.fromEntries(
    CNPJ_REGISTRATION_FIELDS.map((campo) => {
      const bruto = colunas[COLUNA[campo]];
      return [campo, bruto instanceof Date ? diaDaColunaDeData(bruto) : (bruto ?? null)];
    }),
  ) as ValoresCadastrais;
}

function colunasDosValores(valores: ValoresCadastrais): Omit<ColunasDosDadosDoCnpj, "cnpjLastConsultedAt"> {
  return Object.fromEntries(
    CNPJ_REGISTRATION_FIELDS.map((campo) => {
      const valor = valores[campo];
      const coluna = DIAS_CIVIS.has(campo) && typeof valor === "string" ? marcadorDoDiaCivil(valor) : valor;
      return [COLUNA[campo], coluna];
    }),
  ) as Omit<ColunasDosDadosDoCnpj, "cnpjLastConsultedAt">;
}

function temAlgumDado(colunas: ColunasDosDadosDoCnpj): boolean {
  return (
    colunas.cnpjLastConsultedAt !== null ||
    CNPJ_REGISTRATION_FIELDS.some((campo) => colunas[COLUNA[campo]] !== null)
  );
}

/** A mudança de UM campo, tipada e validada — é isto que o JSON `changes` guarda. */
const valorCadastralSchema = z.union([z.string(), z.boolean(), z.null()]);

const mudancasSchema = z.array(
  z
    .object({
      field: z.enum(CNPJ_REGISTRATION_FIELDS),
      before: valorCadastralSchema,
      after: valorCadastralSchema,
      source: z.enum(CNPJ_REGISTRATION_CHANGE_SOURCES),
    })
    .strict(),
);

export interface EventoDosDadosDoCnpj {
  kind: CnpjRegistrationEventKind;
  cnpj: string | null;
  previousCnpj: string | null;
  consultedAt: Date | null;
  changes: CnpjRegistrationFieldChange[];
}

export interface PlanoDosDadosDoCnpj {
  /** As colunas a gravar; `{}` quando nada muda. */
  data: Partial<ColunasDosDadosDoCnpj>;
  /** O evento do histórico; `null` quando nada aconteceu com os dados. */
  evento: EventoDosDadosDoCnpj | null;
}

/**
 * O que a gravação faz com os dados cadastrais do CNPJ, dado o que a linha tem
 * hoje (`null` na criação).
 *
 * A comparação é contra o GRAVADO: só o valor que efetivamente muda vira
 * mudança no histórico, com a origem de `sources` (ausente = MANUAL). Valor
 * limpo pela troca de CNPJ tem origem `CNPJ_CHANGED` — não é edição manual.
 * Lança `CnpjRegistrationMismatchError` quando o bloco é de outro CNPJ.
 */
export function planejarDadosDoCnpj(
  gravado: ({ cnpj: string | null } & ColunasDosDadosDoCnpj) | null,
  input: CreateCustomerInput | UpdateCustomerInput,
): PlanoDosDadosDoCnpj {
  // `input.cnpj` já chega normalizado pelo Zod; `null` é o CNPJ apagado. O
  // gravado passa pela mesma normalização: máscara não é troca de número.
  const cnpjGravado = gravado?.cnpj ? normalizeCnpj(gravado.cnpj) : null;
  const cnpjFinal = input.cnpj !== undefined ? input.cnpj : cnpjGravado;
  const bloco = input.cnpjRegistration;

  if (bloco !== undefined && (cnpjFinal === null || bloco.cnpj !== cnpjFinal)) {
    throw new CnpjRegistrationMismatchError();
  }

  const antes = gravado ? valoresGravados(gravado) : VAZIOS;
  // Troca real de CNPJ com dados gravados: o que era do número anterior sai.
  const limpaPorTroca = gravado !== null && cnpjFinal !== cnpjGravado && temAlgumDado(gravado);
  const depois: ValoresCadastrais = bloco
    ? (Object.fromEntries(CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, bloco[campo]])) as ValoresCadastrais)
    : limpaPorTroca
      ? VAZIOS
      : antes;

  const changes: CnpjRegistrationFieldChange[] = [];
  for (const campo of CNPJ_REGISTRATION_FIELDS) {
    if (antes[campo] === depois[campo]) continue;
    const source =
      limpaPorTroca && depois[campo] === null ? "CNPJ_CHANGED" : (bloco?.sources?.[campo] ?? "MANUAL");
    changes.push({ field: campo, before: antes[campo], after: depois[campo], source });
  }

  const consultedAt = bloco?.consultedAt ? new Date(bloco.consultedAt) : null;
  const kind: CnpjRegistrationEventKind | null = limpaPorTroca
    ? "CNPJ_CHANGED"
    : changes.length > 0
      ? "EDIT"
      : consultedAt
        ? "CONSULTATION"
        : null;

  if (kind === null) return { data: {}, evento: null };

  // A última consulta é a mais recente aplicada — e nenhuma, depois de trocar o CNPJ.
  const ultimaAnterior = limpaPorTroca ? null : (gravado?.cnpjLastConsultedAt ?? null);
  const ultimaConsulta =
    consultedAt && (!ultimaAnterior || consultedAt > ultimaAnterior) ? consultedAt : ultimaAnterior;

  return {
    data: { ...colunasDosValores(depois), cnpjLastConsultedAt: ultimaConsulta },
    evento: {
      kind,
      cnpj: cnpjFinal,
      previousCnpj: kind === "CNPJ_CHANGED" ? cnpjGravado : null,
      consultedAt,
      changes,
    },
  };
}

/**
 * Onde o evento nasce. Só a CRIAÇÃO do Cliente marca o registro com
 * `createdWithCustomerId` — a prova estrutural de nascimento que a exclusão
 * física exige para tratá-lo como filho técnico (§125,
 * CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01). Alteração nunca marca, nem quando
 * é o primeiro registro do Cliente.
 */
export type OrigemDoEventoDosDadosDoCnpj = "CRIACAO_DO_CLIENTE" | "ALTERACAO_DO_CLIENTE";

/** Grava o evento — sempre dentro da transação que grava o Cliente. */
export async function registrarEventoDosDadosDoCnpj(
  tx: Prisma.TransactionClient,
  customerId: string,
  evento: EventoDosDadosDoCnpj,
  actor: User,
  origem: OrigemDoEventoDosDadosDoCnpj,
): Promise<void> {
  await tx.customerCnpjRegistrationHistory.create({
    data: {
      customerId,
      // A marca é o PRÓPRIO Cliente que nasce, na transação que o cria.
      createdWithCustomerId: origem === "CRIACAO_DO_CLIENTE" ? customerId : null,
      kind: evento.kind,
      cnpj: evento.cnpj,
      previousCnpj: evento.previousCnpj,
      consultedAt: evento.consultedAt,
      // Validado na escrita: só a forma conhecida entra no JSON.
      changes: mudancasSchema.parse(evento.changes),
      changedByUserId: actor.id,
      changedByNameSnapshot: actor.name,
    },
  });
}

function toEventoDTO(linha: CustomerCnpjRegistrationHistory): CustomerCnpjRegistrationEventDTO {
  return {
    id: linha.id,
    kind: linha.kind,
    occurredAt: linha.changedAt.toISOString(),
    userName: linha.changedByNameSnapshot,
    cnpj: linha.cnpj,
    previousCnpj: linha.previousCnpj,
    consultedAt: linha.consultedAt?.toISOString() ?? null,
    // Validado também na leitura: a Web recebe sempre a mesma forma.
    changes: mudancasSchema.parse(linha.changes),
  };
}

/** O histórico do Cliente, do mais recente para o mais antigo. */
export async function listarHistoricoDosDadosDoCnpj(
  customerId: string,
): Promise<CustomerCnpjRegistrationEventDTO[]> {
  const linhas = await getPrisma().customerCnpjRegistrationHistory.findMany({
    where: { customerId },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
  });
  return linhas.map(toEventoDTO);
}

/** Os dados gravados, para a DTO — `null` quando não há dado nenhum nem consulta. */
export function dadosDoCnpjDTO(colunas: ColunasDosDadosDoCnpj): CustomerCnpjRegistration | null {
  if (!temAlgumDado(colunas)) return null;
  return {
    ...(valoresGravados(colunas) as CustomerCnpjRegistration),
    lastConsultedAt: colunas.cnpjLastConsultedAt?.toISOString() ?? null,
  };
}
