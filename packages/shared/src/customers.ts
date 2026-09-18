/** Contratos do módulo de Clientes, consumidos por `apps/api` e `apps/web`. */

import type {
  CustomerCnpjRegistration,
  CustomerCnpjRegistrationInput,
} from "./customer-cnpj-registration.js";
import type { CustomerCommercialStatusDTO } from "./customer-commercial-status.js";
import type { CustomerBlockDTO, CustomerStatus } from "./customer-status.js";
import type { CustomerPaymentDefaultsDTO, PaymentInstrument } from "./payment.js";
import type { QuotePaymentMethod } from "./projects.js";
import type { UserRole } from "./users.js";

export const CUSTOMER_CODE_PREFIX = "CLI";

/**
 * Quem CRIA e EDITA o cadastro do Cliente — CUSTOMER-EDIT-PERMISSIONS-01,
 * decisão do PO.
 *
 * O cadastro é do domínio comercial: razão social, CNPJ, perfil tributário,
 * contato, endereço, observações e o sufixo de lote comercial. Os demais
 * perfis consultam o Cliente onde já consultam, e escolhem um Cliente
 * existente nos fluxos em que já trabalham — só não criam nem alteram. A API
 * recusa os outros com 403, antes de olhar o corpo ou o registro; a tela usa a
 * MESMA lista só para não oferecer o que seria recusado.
 *
 * Não é `CUSTOMER_STATUS_CHANGE_ROLES` (`customer-status.ts`): hoje as duas
 * listas coincidem, mas respondem perguntas diferentes — editar o cadastro e
 * mudar a situação cadastral — e podem divergir.
 */
/**
 * Tamanho máximo de cada campo de TEXTO do cadastro do Cliente.
 *
 * Mora no contrato compartilhado porque duas partes precisam da MESMA
 * resposta: o Zod da API, que recusa o que passa do limite, e a consulta
 * assistida de CNPJ (CUSTOMER-CNPJ-LOOKUP-01), que não oferece para aplicar
 * um valor da fonte pública que o campo não caberia — aplicar algo que o
 * servidor recusaria em seguida entrega ao operador um erro que ele não pediu
 * e não sabe de onde veio.
 *
 * Um segundo lugar com os mesmos números divergiria na primeira alteração.
 */
export const CUSTOMER_FIELD_MAX_LENGTHS = {
  legalName: 200,
  tradeName: 200,
  email: 200,
  street: 200,
  number: 20,
  complement: 100,
  district: 100,
  city: 100,
  notes: 1000,
  businessLotSuffix: 20,
} as const;

export const CUSTOMER_EDIT_ROLES: readonly UserRole[] = ["COMMERCIAL", "ADMIN"];

/**
 * Perfil tributário do Cliente — `PRODUCT_RULES.md` §83.
 *
 * Classificação INFORMADA pelo usuário. O sistema não deduz nada do CNPJ, do
 * porte, do CNAE ou da razão social; não calcula imposto e não bloqueia fluxo
 * nenhum. O consumidor previsto é o Modelo de Precificação, para SUGERIR
 * modelos compatíveis — nunca para determinar imposto.
 *
 * A consulta assistida de CNPJ (CUSTOMER-CNPJ-LOOKUP-01, §111) não muda isto:
 * este campo não está entre os que ela oferece para aplicar. Porte, CNAE,
 * natureza jurídica, Simples e MEI ficam guardados como dados cadastrais do
 * CNPJ (`CustomerCnpjRegistration`, §119) e nenhum deles define o perfil.
 *
 * `NOT_INFORMED` é o estado explícito de "não definido": o campo nunca é
 * `null`, e retirar uma classificação é escolher "Não informado" de novo. MEI
 * é opção independente — nada o converte em Simples Nacional.
 *
 * A ordem é a do seletor. O enum do banco (`CustomerTaxProfile`) tem os
 * mesmos valores, e um teste da API confere as duas listas.
 */
export const CUSTOMER_TAX_PROFILES = [
  "NOT_INFORMED",
  "MEI",
  "SIMPLES_NACIONAL",
  "LUCRO_PRESUMIDO",
  "LUCRO_REAL",
  "OTHER",
] as const;

export type CustomerTaxProfile = (typeof CUSTOMER_TAX_PROFILES)[number];

/** O que recebe o cliente criado sem informar o perfil — o default do banco é o mesmo. */
export const DEFAULT_CUSTOMER_TAX_PROFILE: CustomerTaxProfile = "NOT_INFORMED";

export const CUSTOMER_TAX_PROFILE_LABELS: Record<CustomerTaxProfile, string> = {
  NOT_INFORMED: "Não informado",
  MEI: "MEI",
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
  OTHER: "Outro",
};

/**
 * Endereço estruturado do Cliente. Todos os campos são opcionais: clientes
 * cadastrados antes da capacidade 33 continuam válidos com tudo em `null`.
 * `zipCode` trafega SOMENTE com dígitos; a máscara `00000-000` é da UI.
 */
export interface CustomerAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
}

/**
 * O Cliente carrega o pagamento padrão (`CustomerPaymentDefaultsDTO`, seis
 * campos, todos `null` quando não informado) — sugestão para novos orçamentos.
 */
export interface CustomerDTO extends CustomerPaymentDefaultsDTO {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  /** Nunca `null`: sem classificação é `NOT_INFORMED` (§83). */
  taxProfile: CustomerTaxProfile;
  /**
   * Dados cadastrais do CNPJ (§119, §122) — sempre do `cnpj` acima. `null`
   * quando não há dado nenhum nem consulta aplicada.
   */
  cnpjRegistration: CustomerCnpjRegistration | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  /** Sufixo do cliente na máscara de lote comercial (ex.: "A3") — só alimenta a sugestão. */
  businessLotSuffix: string | null;
  /**
   * Cadastro não arquivado. Sozinho não diz se pode vender: cliente bloqueado
   * continua `active`. Quem responde isso é `status` (§95).
   */
  active: boolean;
  /** Bloqueio comercial vigente; sobrevive à inativação e volta na reativação. */
  blocked: boolean;
  /** Situação cadastral (§95) — derivada de `active` + `blocked`, nunca a comercial (§86). */
  status: CustomerStatus;
  /** O bloqueio em vigor, com motivo, data e autor; `null` quando não há. */
  block: CustomerBlockDTO | null;
  createdAt: string;
  /**
   * Nome de quem cadastrou/alterou, congelado no momento da acao. `null`
   * para registros anteriores a esta capacidade ou importados do legado —
   * a tela mostra "Nao disponivel", nunca atribui a alguem.
   *
   * Somente o nome trafega: o id do usuario e detalhe interno.
   */
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
  /**
   * Situação comercial derivada (§86) — nunca `active`. Presente na listagem;
   * ausente nas respostas de escrita, que não a calculam.
   */
  commercial?: CustomerCommercialStatusDTO;
}

export interface CustomerListResponse {
  customers: CustomerDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateCustomerInput {
  legalName: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  /** Ausente vira `NOT_INFORMED`. `null` é recusado — não existe "limpar". */
  taxProfile?: CustomerTaxProfile;
  /** Dados cadastrais do CNPJ (§122). Ausente: sem dados cadastrais. */
  cnpjRegistration?: CustomerCnpjRegistrationInput;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  notes?: string;
  businessLotSuffix?: string | null;
  /** Pagamento padrão (ausente = não informado). */
  defaultPaymentInstrument?: PaymentInstrument | null;
  defaultPaymentMethod?: QuotePaymentMethod | null;
  defaultDownPaymentPercent?: string | null;
  defaultInstallmentCount?: number | null;
  defaultInstallmentIntervalDays?: number | null;
  defaultMonthlyInterestPercent?: string | null;
}

/** Formata o CEP guardado (só dígitos) para exibição. */
export function formatZipCode(zipCode: string | null): string | null {
  if (!zipCode) return zipCode;
  const digits = zipCode.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : zipCode;
}

/**
 * Alteração do cadastro: chave ausente não mexe, texto vazio limpa. O
 * endereço estruturado inteiro trafega aqui, como no `CreateCustomerInput` —
 * a tela sempre enviou CEP, logradouro, número, complemento e bairro, e a API
 * sempre os aceitou. A situação cadastral NÃO: ela muda só pelas quatro ações
 * de `customer-status.ts`.
 */
export interface UpdateCustomerInput {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  /** Ausente não mexe no perfil gravado. */
  taxProfile?: CustomerTaxProfile;
  /**
   * Dados cadastrais do CNPJ (§122): os dez campos como a tela os tem, e o
   * servidor grava e registra no histórico só o que mudou. Ausente não mexe —
   * salvo quando o `cnpj` muda, e aí os dados do CNPJ anterior são limpos.
   */
  cnpjRegistration?: CustomerCnpjRegistrationInput;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  notes?: string;
  businessLotSuffix?: string | null;
  /**
   * Pagamento padrão: chave ausente não mexe, `null` limpa. Condição `null` ou
   * `CASH` limpa o parcelamento; `INSTALLMENTS` sem parcelas é recusado.
   */
  defaultPaymentInstrument?: PaymentInstrument | null;
  defaultPaymentMethod?: QuotePaymentMethod | null;
  defaultDownPaymentPercent?: string | null;
  defaultInstallmentCount?: number | null;
  defaultInstallmentIntervalDays?: number | null;
  defaultMonthlyInterestPercent?: string | null;
}
