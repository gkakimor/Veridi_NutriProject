/** Contratos do módulo de Fornecedores, consumidos por `apps/api` e `apps/web`. */

export const SUPPLIER_CODE_PREFIX = "FOR";

/**
 * Endereço estruturado do Fornecedor — o MESMO modelo do Cliente, campo a
 * campo. Todos opcionais: fornecedor sem endereço continua válido e nenhum
 * fluxo de Compras (homologação, oferta, Ordem de Compra, Recebimento,
 * preferência) depende dele. `zipCode` trafega SOMENTE com dígitos; a máscara
 * `00000-000` é da UI.
 */
export interface SupplierAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
}

export interface SupplierDTO {
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
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierListResponse {
  suppliers: SupplierDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateSupplierInput {
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
}

export interface UpdateSupplierInput {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  /** Enviar vazio limpa o campo gravado; ausente não mexe nele. */
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  notes?: string;
}
