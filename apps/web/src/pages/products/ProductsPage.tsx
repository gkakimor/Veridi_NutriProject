import { useCallback, useEffect, useState } from "react";
import type { CustomerDTO, ProductDTO } from "@veridi/shared";
import { listProducts, setProductActive } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { ProductFormModal } from "./ProductFormModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";

type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; product: ProductDTO };

const PAGE_SIZE = 20;

/** Cadastros → Produtos. Mesmo padrao de tabela densa + modal de Items. */
export function ProductsPage() {
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [confirmDeactivate, setConfirmDeactivate] = useState<ProductDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, customerFilter, activeFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listProducts>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (customerFilter) params.customerId = customerFilter;
    if (activeFilter !== "all") params.active = activeFilter === "active";

    listProducts(params)
      .then((result) => {
        setProducts(result.products);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos");
      })
      .finally(() => setLoading(false));
  }, [page, search, customerFilter, activeFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listCustomers({ pageSize: 100 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);

  function handleToggleActive(product: ProductDTO) {
    if (product.active) {
      setConfirmDeactivate(product);
      return;
    }
    void applyActive(product, true);
  }

  async function applyActive(product: ProductDTO, active: boolean) {
    try {
      await setProductActive(product.id, active);
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Falha ao atualizar status");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Produtos</h1>
          <p className="page__subtitle">
            Produtos comerciais e industriais fabricados pela Veridi.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setModalState({ mode: "create" })}
        >
          + Novo produto
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="products-search">
            Buscar produtos
          </label>
          <input
            id="products-search"
            type="search"
            placeholder="Buscar por código, nome, referência ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="products-customer-filter">
          Filtrar por cliente
        </label>
        <select
          id="products-customer-filter"
          value={customerFilter}
          onChange={(event) => setCustomerFilter(event.target.value)}
        >
          <option value="">Todos os clientes</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} — {customer.tradeName ?? customer.legalName}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="products-active-filter">
          Filtrar por status
        </label>
        <select
          id="products-active-filter"
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Item acabado</th>
              <th>Referência</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr
                key={product.id}
                tabIndex={0}
                onClick={() => setModalState({ mode: "edit", product })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setModalState({ mode: "edit", product });
                  }
                }}
              >
                <td className="is-code">{product.code}</td>
                <td>{product.name}</td>
                <td>
                  {product.customer
                    ? product.customer.tradeName ?? product.customer.legalName
                    : "—"}
                </td>
                <td>
                  {product.finishedProductItem ? (
                    <span className="code">{product.finishedProductItem.code}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{product.externalCode ?? "—"}</td>
                <td>
                  <span
                    className={
                      product.active ? "badge badge--active" : "badge badge--inactive"
                    }
                  >
                    {product.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", product })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={
                        product.active
                          ? "btn btn--danger btn--sm"
                          : "btn btn--secondary btn--sm"
                      }
                      onClick={() => handleToggleActive(product)}
                    >
                      {product.active ? "Inativar" : "Reativar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "produto" : "produtos"}
        </div>
      </div>

      <div className="pagination">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>

      {modalState.mode !== "closed" && (
        <ProductFormModal
          key={modalState.mode === "edit" ? modalState.product.id : "create"}
          mode={modalState.mode}
          product={modalState.mode === "edit" ? modalState.product : null}
          onClose={() => setModalState({ mode: "closed" })}
          onSaved={() => {
            setModalState({ mode: "closed" });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="Inativar produto?"
        message={
          <>
            "{confirmDeactivate?.name}" deixará de aparecer para novas
            formulações e ordens de produção. O registro não será excluído —
            o histórico será preservado e ele pode ser reativado a qualquer
            momento.
          </>
        }
        confirmLabel="Inativar"
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          const target = confirmDeactivate;
          setConfirmDeactivate(null);
          if (target) void applyActive(target, false);
        }}
      />
    </>
  );
}
