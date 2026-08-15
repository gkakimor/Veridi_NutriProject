/** Contratos do módulo de Produtos, consumidos por `apps/api` e `apps/web`. */

export const PRODUCT_CODE_PREFIX = "PROD";

export interface ProductCustomerSummary {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
}

export interface ProductFinishedItemSummary {
  id: string;
  code: string;
  name: string;
}

export interface ProductDTO {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  customer: ProductCustomerSummary | null;
  finishedProductItemId: string | null;
  finishedProductItem: ProductFinishedItemSummary | null;
  externalCode: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: ProductDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProductInput {
  name: string;
  customerId?: string;
  finishedProductItemId?: string;
  externalCode?: string;
  notes?: string;
}

export interface UpdateProductInput {
  name?: string;
  customerId?: string;
  finishedProductItemId?: string;
  externalCode?: string;
  notes?: string;
}
