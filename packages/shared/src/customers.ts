/** Contratos do módulo de Clientes, consumidos por `apps/api` e `apps/web`. */

export const CUSTOMER_CODE_PREFIX = "CLI";

/**
 * Perfil tributário do Cliente — `PRODUCT_RULES.md` §83.
 *
 * Classificação INFORMADA pelo usuário. O sistema não consulta a Receita e não
 * deduz nada do CNPJ, do porte, do CNAE ou da razão social; não calcula
 * imposto e não bloqueia fluxo nenhum. O consumidor previsto é o Modelo de
 * Precificação, para SUGERIR modelos compatíveis — nunca para determinar
 * imposto.
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

export interface CustomerDTO {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  /** Nunca `null`: sem classificação é `NOT_INFORMED` (§83). */
  taxProfile: CustomerTaxProfile;
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
  active: boolean;
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
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  notes?: string;
  businessLotSuffix?: string | null;
}

/** Formata o CEP guardado (só dígitos) para exibição. */
export function formatZipCode(zipCode: string | null): string | null {
  if (!zipCode) return zipCode;
  const digits = zipCode.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : zipCode;
}

export interface UpdateCustomerInput {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  /** Ausente não mexe no perfil gravado. */
  taxProfile?: CustomerTaxProfile;
  city?: string;
  state?: string;
  notes?: string;
  businessLotSuffix?: string | null;
}
