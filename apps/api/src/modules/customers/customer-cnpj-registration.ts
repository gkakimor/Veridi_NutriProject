import type { Customer } from "@prisma/client";
import type { CustomerCnpjRegistration } from "@veridi/shared";
import { normalizeCnpj } from "@veridi/shared";
import { diaDaColunaDeData, marcadorDoDiaCivil } from "../../lib/business-day.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.schemas.js";

/**
 * Dados cadastrais do CNPJ no Cliente — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.
 *
 * O bloco é o retrato de UMA consulta aplicada e salva, e pertence ao CNPJ que
 * o Cliente tem. Três regras, todas aqui, no servidor:
 *
 * 1. o bloco é gravado INTEIRO (as onze colunas de uma vez) ou limpo inteiro —
 *    nunca uma coluna solta, que misturaria consultas diferentes sob uma data;
 * 2. bloco de um CNPJ não é gravado sob outro: o `cnpj` consultado tem de ser
 *    o que o Cliente terá depois da gravação;
 * 3. trocar o CNPJ sem mandar bloco novo DESCARTA o bloco do CNPJ anterior —
 *    CNAE, porte e Simples de outra empresa não podem continuar parecendo
 *    válidos só porque ninguém lembrou de limpá-los.
 *
 * Consultar (`GET /cnpj-lookup/:cnpj`) não passa por aqui e não grava nada.
 */

/** Frase da recusa da regra 2 — no campo CNPJ, que é onde a pessoa corrige. */
export const DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE =
  "Os dados cadastrais aplicados são de outro CNPJ. Consulte o CNPJ do cadastro novamente.";

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

const BLOCO_VAZIO: ColunasDosDadosDoCnpj = {
  cnpjMainCnaeCode: null,
  cnpjMainCnaeDescription: null,
  cnpjLegalNature: null,
  cnpjCompanySize: null,
  cnpjOpenedAt: null,
  cnpjEstablishmentType: null,
  cnpjSimplesOptIn: null,
  cnpjMeiOptIn: null,
  cnpjRegistrationStatus: null,
  cnpjRegistrationStatusDate: null,
  cnpjLastConsultedAt: null,
};

type BlocoDeEntrada = NonNullable<CreateCustomerInput["cnpjRegistration"]>;

function colunasDoBloco(bloco: BlocoDeEntrada): ColunasDosDadosDoCnpj {
  return {
    cnpjMainCnaeCode: bloco.mainCnaeCode,
    cnpjMainCnaeDescription: bloco.mainCnaeDescription,
    cnpjLegalNature: bloco.legalNature,
    cnpjCompanySize: bloco.companySize,
    // Datas civis: a meia-noite UTC que marca o dia, como toda data-só do sistema.
    cnpjOpenedAt: bloco.openedAt ? marcadorDoDiaCivil(bloco.openedAt) : null,
    cnpjEstablishmentType: bloco.establishmentType,
    cnpjSimplesOptIn: bloco.simplesOptIn,
    cnpjMeiOptIn: bloco.meiOptIn,
    cnpjRegistrationStatus: bloco.registrationStatus,
    cnpjRegistrationStatusDate: bloco.registrationStatusDate
      ? marcadorDoDiaCivil(bloco.registrationStatusDate)
      : null,
    // O instante da consulta aplicada — o `consultedAt` do resultado, não o do Salvar.
    cnpjLastConsultedAt: new Date(bloco.consultedAt),
  };
}

/**
 * O que gravar do bloco, dado o CNPJ que a linha tem hoje (`null` na criação).
 *
 * Devolve `{}` quando o bloco não é tocado, as onze colunas quando é gravado ou
 * limpo, e lança `CnpjRegistrationMismatchError` quando o bloco é de outro CNPJ.
 */
export function dadosDoCnpjParaGravar(
  cnpjGravado: string | null,
  input: CreateCustomerInput | UpdateCustomerInput,
): Partial<ColunasDosDadosDoCnpj> {
  // `input.cnpj` já chega normalizado pelo Zod; `null` é o CNPJ apagado. O
  // gravado passa pela mesma normalização: máscara não é troca de número.
  const gravado = cnpjGravado ? normalizeCnpj(cnpjGravado) : null;
  const cnpjFinal = input.cnpj !== undefined ? input.cnpj : gravado;
  const bloco = input.cnpjRegistration;

  if (bloco === null) return BLOCO_VAZIO;

  if (bloco !== undefined) {
    if (cnpjFinal === null || bloco.cnpj !== cnpjFinal) throw new CnpjRegistrationMismatchError();
    return colunasDoBloco(bloco);
  }

  // Sem bloco: só a troca do CNPJ mexe nele — e descarta o do número anterior.
  return cnpjFinal !== gravado ? BLOCO_VAZIO : {};
}

/** O bloco gravado, para a DTO — `null` quando nenhuma consulta foi aplicada e salva. */
export function dadosDoCnpjDTO(customer: ColunasDosDadosDoCnpj): CustomerCnpjRegistration | null {
  if (!customer.cnpjLastConsultedAt) return null;
  return {
    mainCnaeCode: customer.cnpjMainCnaeCode,
    mainCnaeDescription: customer.cnpjMainCnaeDescription,
    legalNature: customer.cnpjLegalNature,
    companySize: customer.cnpjCompanySize,
    openedAt: customer.cnpjOpenedAt ? diaDaColunaDeData(customer.cnpjOpenedAt) : null,
    establishmentType: customer.cnpjEstablishmentType,
    simplesOptIn: customer.cnpjSimplesOptIn,
    meiOptIn: customer.cnpjMeiOptIn,
    registrationStatus: customer.cnpjRegistrationStatus,
    registrationStatusDate: customer.cnpjRegistrationStatusDate
      ? diaDaColunaDeData(customer.cnpjRegistrationStatusDate)
      : null,
    consultedAt: customer.cnpjLastConsultedAt.toISOString(),
  };
}
