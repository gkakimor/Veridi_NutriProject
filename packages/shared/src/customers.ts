/** Contratos do módulo de Clientes, consumidos por `apps/api` e `apps/web`. */

export const CUSTOMER_CODE_PREFIX = "CLI";

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
  city?: string;
  state?: string;
  notes?: string;
  businessLotSuffix?: string | null;
}
