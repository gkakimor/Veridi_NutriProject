/** Contratos do módulo de Fornecedores, consumidos por `apps/api` e `apps/web`. */

export const SUPPLIER_CODE_PREFIX = "FOR";

export interface SupplierDTO {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
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
  notes?: string;
}

export interface UpdateSupplierInput {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  notes?: string;
}
