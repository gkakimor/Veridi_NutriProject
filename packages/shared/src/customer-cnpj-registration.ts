/**
 * Dados cadastrais do CNPJ do Cliente — PRODUCT_RULES §119 e §122.
 *
 * CNAE, natureza jurídica, porte, abertura, matriz/filial, Simples, MEI e
 * situação na Receita: campos do cadastro, EDITÁVEIS, que a consulta de CNPJ
 * (OpenCNPJ) pode sugerir — só sugerir. A consulta é ADITIVA: completa o que
 * está vazio, e troca o que já existe só por escolha explícita de quem cadastra.
 *
 * A "Última consulta CNPJ" é metadado do SISTEMA: o instante da última
 * consulta aplicada e salva. Ninguém a digita.
 *
 * Toda gravação que muda estes dados, aplica uma consulta ou troca o CNPJ com
 * dados deixa um evento no histórico (append-only), com a origem POR CAMPO.
 */

import type { CnpjLookupCompany, CnpjRegistrationField } from "./cnpj-lookup.js";

/** Os dez dados cadastrais, com os tipos do contrato da consulta (`null` = vazio). */
export type CnpjRegistrationValues = Pick<CnpjLookupCompany, CnpjRegistrationField>;

/** Um valor cadastral: texto, dia civil `YYYY-MM-DD`, enum, Sim/Não ou vazio. */
export type CnpjRegistrationValue = string | boolean | null;

/**
 * Os dados cadastrais como o Cliente os devolve.
 *
 * Simples e MEI `null` são "não informado" — nunca "Não".
 */
export interface CustomerCnpjRegistration extends CnpjRegistrationValues {
  /** Última consulta de CNPJ aplicada e salva. Metadado do sistema; `null` = nunca. */
  lastConsultedAt: string | null;
}

/**
 * De onde veio o valor de um campo numa gravação: digitado (`MANUAL`) ou
 * sugerido pela consulta e aplicado (`OPEN_CNPJ`). Valor aplicado da consulta
 * e editado depois, antes do Salvar, é `MANUAL`.
 */
export const CNPJ_REGISTRATION_VALUE_SOURCES = ["MANUAL", "OPEN_CNPJ"] as const;

export type CnpjRegistrationValueSource = (typeof CNPJ_REGISTRATION_VALUE_SOURCES)[number];

/**
 * Os dados cadastrais no corpo do POST/PATCH do Cliente.
 *
 * Os dez campos vão sempre inteiros (`null` = vazio); o servidor compara com o
 * que está gravado e registra no histórico só o que mudou, com a origem de
 * `sources` (ausente = `MANUAL`).
 */
export interface CustomerCnpjRegistrationInput extends CnpjRegistrationValues {
  /** CNPJ a que estes dados pertencem — o do cadastro depois da gravação. */
  cnpj: string;
  /**
   * Consulta aplicada nesta edição: o `consultedAt` do resultado. Atualiza a
   * "Última consulta CNPJ" e é registrada no histórico mesmo sem mudança de valor.
   */
  consultedAt?: string;
  /** Origem de cada campo alterado. Só `OPEN_CNPJ` com `consultedAt`. */
  sources?: Partial<Record<CnpjRegistrationField, CnpjRegistrationValueSource>>;
}

/* ------------------------------------------------------------------------ */
/* Histórico — §122                                                          */
/* ------------------------------------------------------------------------ */

/**
 * O tipo de um evento do histórico.
 *
 * - `EDIT`: um ou mais campos mudaram (à mão, pela consulta, ou os dois);
 * - `CONSULTATION`: consulta aplicada sem mudança de valor — os dados foram
 *   conferidos pela fonte naquela data;
 * - `CNPJ_CHANGED`: o CNPJ mudou e os dados do número anterior foram limpos.
 */
export const CNPJ_REGISTRATION_EVENT_KINDS = ["EDIT", "CONSULTATION", "CNPJ_CHANGED"] as const;

export type CnpjRegistrationEventKind = (typeof CNPJ_REGISTRATION_EVENT_KINDS)[number];

/** A origem de UMA mudança de campo no histórico. */
export const CNPJ_REGISTRATION_CHANGE_SOURCES = ["MANUAL", "OPEN_CNPJ", "CNPJ_CHANGED"] as const;

export type CnpjRegistrationChangeSource = (typeof CNPJ_REGISTRATION_CHANGE_SOURCES)[number];

export const CNPJ_REGISTRATION_CHANGE_SOURCE_LABELS: Record<CnpjRegistrationChangeSource, string> = {
  MANUAL: "Manual",
  OPEN_CNPJ: "OpenCNPJ",
  CNPJ_CHANGED: "CNPJ alterado",
};

/** Uma mudança de campo: nunca "A → A" — valor igual não é mudança. */
export interface CnpjRegistrationFieldChange {
  field: CnpjRegistrationField;
  before: CnpjRegistrationValue;
  after: CnpjRegistrationValue;
  source: CnpjRegistrationChangeSource;
}

export interface CustomerCnpjRegistrationEventDTO {
  id: string;
  kind: CnpjRegistrationEventKind;
  /** Quando a gravação aconteceu (o "Salvar"). */
  occurredAt: string;
  /** Quem gravou, congelado no momento; `null` quando desconhecido. */
  userName: string | null;
  /** CNPJ a que os dados pertencem depois do evento. */
  cnpj: string | null;
  /** Só em `CNPJ_CHANGED`: o CNPJ anterior, dono dos dados limpos. */
  previousCnpj: string | null;
  /** Instante da consulta OpenCNPJ aplicada neste evento, quando houve. */
  consultedAt: string | null;
  changes: CnpjRegistrationFieldChange[];
}

/** Do mais recente para o mais antigo. */
export interface CustomerCnpjRegistrationHistoryResponse {
  events: CustomerCnpjRegistrationEventDTO[];
}
