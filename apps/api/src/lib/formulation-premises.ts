import { Prisma } from "@prisma/client";
import type { DosageForm, PresentationType, UnitOfMeasure } from "@prisma/client";
import {
  MENSAGENS_DA_APRESENTACAO,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
} from "@veridi/shared";
import type { ApresentacaoBlock, PremissasDaApresentacao, UomFactorLike } from "@veridi/shared";

/**
 * AS PREMISSAS TÉCNICAS DA RECEITA, resolvidas num lugar só.
 *
 * Formulação e Modelo guardam as MESMAS premissas — forma, apresentação,
 * cápsulas por dose, dose e conteúdo — e derivam delas a MESMA grandeza:
 * doses por embalagem. Enquanto a regra morou dentro do serviço da Formulação,
 * dar as premissas ao Modelo significava escrever a divisão uma segunda vez, e
 * a segunda implementação diverge da primeira no primeiro caso de borda que
 * alguém corrigir de um lado só.
 *
 * Este módulo é a única autoridade da derivação no servidor. A conta em si
 * continua no motor compartilhado (`@veridi/shared`): aqui mora a leitura do
 * patch — o que o payload trouxe, o que a versão já tinha, o que cada forma
 * guarda e em que campo a recusa pousa.
 *
 * Nada aqui depende de Produto, de Cliente ou de qualquer tabela: recebe o que
 * está gravado, recebe o que foi informado, devolve o que deve ser gravado.
 */

/** As premissas da apresentação como as colunas as guardam. */
export type PremissasGravadas = {
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: Prisma.Decimal | null;
  doseUomCode: string | null;
  packageContentAmount: Prisma.Decimal | null;
  packageContentUomCode: string | null;
  dosesPerPackage: number | null;
};

/** O que a versão — de Formulação ou de Modelo — tem gravado hoje. */
export type PremissasAtuais = {
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: Prisma.Decimal | null;
  doseUomCode: string | null;
  packageContentAmount: Prisma.Decimal | null;
  packageContentUomCode: string | null;
  dosesPerPackage: number | null;
};

/**
 * O que o payload pode trazer. `undefined` é "não mexeu"; `null` é "limpar".
 *
 * `capsulesPerPackage` é ENTRADA e não coluna: com cápsulas por dose ela fecha
 * as doses por embalagem, e volta no DTO como produto das duas.
 */
export type PremissasInformadas = {
  dosageForm?: DosageForm | null | undefined;
  presentationType?: PresentationType | null | undefined;
  capsulesPerDose?: number | null | undefined;
  capsulesPerPackage?: number | null | undefined;
  doseAmount?: string | null | undefined;
  doseUomCode?: string | null | undefined;
  packageContentAmount?: string | null | undefined;
  packageContentUomCode?: string | null | undefined;
  dosesPerPackage?: number | null | undefined;
};

/**
 * Recusa de premissa COM ENDEREÇO: a tela marca o campo em vez de mostrar a
 * frase solta no topo, onde ela obrigaria a procurar qual premissa não fechou.
 */
export class InvalidFormulationPresentationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidFormulationPresentationError";
  }
}

/** Campos da apresentação que o payload pode trazer. */
export const CAMPOS_DA_APRESENTACAO = [
  "dosageForm",
  "presentationType",
  "capsulesPerDose",
  "capsulesPerPackage",
  "doseAmount",
  "doseUomCode",
  "packageContentAmount",
  "packageContentUomCode",
] as const;

export function tocouNaApresentacao(input: PremissasInformadas): boolean {
  return CAMPOS_DA_APRESENTACAO.some((campo) => input[campo] !== undefined);
}

/** As unidades como o motor compartilhado as consome. */
export function unidadesDoMotor(units: readonly UnitOfMeasure[]): UomFactorLike[] {
  return units.map((unit) => ({
    code: unit.code,
    dimension: unit.dimension,
    toBaseFactor: unit.toBaseFactor.toString(),
  }));
}

/** Em que campo a recusa da apresentação deve aparecer. */
export function campoDaRecusa(motivo: ApresentacaoBlock, forma: DosageForm | null): string {
  if (motivo === "CAPSULAS_NAO_DIVIDEM") return "capsulesPerPackage";
  if (motivo === "DOSES_NAO_INTEIRAS") return "packageContentAmount";
  return forma === "POWDER" ? "doseUomCode" : "dosageForm";
}

/**
 * As premissas depois desta gravação, com doses por embalagem DERIVADO nas
 * formas que o derivam.
 *
 * Cada forma guarda só o que usa: premissa de outra forma deixada aqui seria
 * dado invisível, que volta a valer no dia em que alguém trocar a forma.
 *
 * `dosesPerPackage` continua sendo a premissa do motor — a diferença é que na
 * cápsula e no pó ela é RESULTADO (cápsulas por embalagem / cápsulas por dose,
 * conteúdo / dose) em vez de um segundo número digitado, que divergiria do
 * primeiro. Divisão que não fecha é RECUSADA com o campo junto: arredondar
 * doses mudaria em silêncio o material de toda linha por dose.
 */
export function resolverApresentacao(
  current: PremissasAtuais,
  input: PremissasInformadas,
  units: readonly UnitOfMeasure[],
): PremissasGravadas {
  const forma = input.dosageForm !== undefined ? input.dosageForm : current.dosageForm;
  const apresentacao =
    input.presentationType !== undefined ? input.presentationType : current.presentationType;
  const capsulasPorDose =
    input.capsulesPerDose !== undefined ? input.capsulesPerDose : current.capsulesPerDose;
  const capsulasNaEmbalagem =
    input.capsulesPerPackage !== undefined
      ? input.capsulesPerPackage
      : capsulasPorEmbalagem(current.capsulesPerDose, current.dosesPerPackage);
  const dose =
    input.doseAmount !== undefined
      ? input.doseAmount
      : current.doseAmount
        ? current.doseAmount.toString()
        : null;
  const doseUom = input.doseUomCode !== undefined ? input.doseUomCode : current.doseUomCode;
  const conteudo =
    input.packageContentAmount !== undefined
      ? input.packageContentAmount
      : current.packageContentAmount
        ? current.packageContentAmount.toString()
        : null;
  const conteudoUom =
    input.packageContentUomCode !== undefined
      ? input.packageContentUomCode
      : current.packageContentUomCode;

  const daCapsula = forma === "CAPSULE";
  const doPo = forma === "POWDER";
  const premissas: PremissasDaApresentacao = {
    dosageForm: forma,
    capsulesPerDose: daCapsula ? capsulasPorDose : null,
    capsulesPerPackage: daCapsula ? capsulasNaEmbalagem : null,
    doseAmount: doPo ? dose : null,
    doseUomCode: doPo ? doseUom : null,
    packageContentAmount: doPo ? conteudo : null,
    packageContentUomCode: doPo ? conteudoUom : null,
  };

  let doses: number | null;
  if (formaDerivaDoses(forma)) {
    const derivado = dosesPorEmbalagemDaApresentacao(premissas, unidadesDoMotor(units));
    if (typeof derivado === "string") {
      throw new InvalidFormulationPresentationError(
        campoDaRecusa(derivado, forma),
        MENSAGENS_DA_APRESENTACAO[derivado],
      );
    }
    doses = derivado;
  } else {
    doses = input.dosesPerPackage !== undefined ? input.dosesPerPackage : current.dosesPerPackage;
  }

  return {
    dosageForm: forma,
    presentationType: apresentacao,
    capsulesPerDose: premissas.capsulesPerDose,
    doseAmount:
      premissas.doseAmount === null ? null : new Prisma.Decimal(String(premissas.doseAmount)),
    doseUomCode: premissas.doseUomCode,
    packageContentAmount:
      premissas.packageContentAmount === null
        ? null
        : new Prisma.Decimal(String(premissas.packageContentAmount)),
    packageContentUomCode: premissas.packageContentUomCode,
    dosesPerPackage: doses,
  };
}
