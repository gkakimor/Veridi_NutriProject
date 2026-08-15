/** Contratos do módulo de Clientes, consumidos por `apps/api` e `apps/web`. */

export const CUSTOMER_CODE_PREFIX = "CLI";

export interface CustomerDTO {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
  city?: string;
  state?: string;
  notes?: string;
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
}
