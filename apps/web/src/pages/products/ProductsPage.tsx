import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { useNavigate } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import type { CustomerDTO, ProductDTO } from "@veridi/shared";
import { DOSAGE_FORM_LABELS, PRESENTATION_TYPE_LABELS } from "@veridi/shared";
import { listProducts, setProductActive } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { ProductFormModal } from "./ProductFormModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { RowActions } from "../../components/RowActions";

type LifecycleFilter = "all" | "APPROVED" | "DEVELOPMENT";
type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; product: ProductDTO };

const PAGE_SIZE = 20;

/** Cadastros → Produtos. Mesmo padrao de tabela densa + modal de Items. */
export function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Link contextual conhece o produto: vem `productId`, não texto. Busca
   * textual podia trazer mais de uma linha, esbarrar em filtro anterior ou
   * simplesmente não ser aplicada — o que o Product Owner viu na prática.
   *
   * A leitura é por efeito, não só no estado inicial: navegar de
   * `/cadastros/produtos` para a mesma rota com outra query não remonta o
   * componente, e um valor inicial nunca seria reavaliado.
   */
  const [params] = useSearchParams();
  const contextProductId = params.get("productId") ?? "";
  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [productContext, setProductContext] = useState<ProductDTO | null>(null);
  const [customerFilter, setCustomerFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");

  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });

  // Contexto exato substitui filtros incompatíveis: combinar o cliente da
  // visita anterior com o produto pedido agora daria lista vazia.
  useEffect(() => {
    if (!contextProductId) {
      setProductContext(null);
      return;
    }
    setSearchInput("");
    setSearch("");
    setCustomerFilter("");
    setActiveFilter("all");
    setLifecycleFilter("all");
    setPage(1);
  }, [contextProductId]);

  // Quem clicou em "Abrir produto" quer o produto, não a lista dele.
  const openId = params.get("open");
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    const target = openId ? products.find((product) => product.id === openId) : undefined;
    if (!target || openedId.current === openId) return;
    openedId.current = openId;
    setModalState({ mode: "edit", product: target });
  }, [openId, products]);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ProductDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, customerFilter, activeFilter, lifecycleFilter, contextProductId]);

  const hasFilters =
    searchInput !== "" ||
    search !== "" ||
    customerFilter !== "" ||
    activeFilter !== "all" ||
    lifecycleFilter !== "all";

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setCustomerFilter("");
    setActiveFilter("all");
    setLifecycleFilter("all");
  }

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listProducts>[0] = { page, pageSize: PAGE_SIZE };
    if (contextProductId) params.productId = contextProductId;
    if (search) params.search = search;
    if (customerFilter) params.customerId = customerFilter;
    if (activeFilter !== "all") params.active = activeFilter === "active";
    if (lifecycleFilter !== "all") params.lifecycle = lifecycleFilter;

    listProducts(params)
      .then((result) => {
        if (contextProductId) {
          setProductContext(result.products.find((row) => row.id === contextProductId) ?? null);
        }
        setProducts(result.products);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos");
      })
      .finally(() => setLoading(false));
  }, [page, search, customerFilter, activeFilter, lifecycleFilter, contextProductId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listCustomers({ pageSize: 1000 })
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
        <ExportCsvButton path="/products/export.csv" filters={{ search, customerId: customerFilter, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
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
        <div className="toolbar__entity">
          <SearchableEntitySelect
            id="products-customer-filter"
            value={customerFilter}
            onChange={setCustomerFilter}
            placeholder="Todos os clientes"
            options={customers.map((customer) => ({
              id: customer.id,
              code: customer.code,
              name: customer.tradeName ?? customer.legalName,
            }))}
          />
        </div>

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

        <label className="sr-only" htmlFor="products-lifecycle-filter">
          Filtrar por ciclo de vida
        </label>
        <select
          id="products-lifecycle-filter"
          value={lifecycleFilter}
          onChange={(event) => setLifecycleFilter(event.target.value as LifecycleFilter)}
        >
          <option value="all">Aprovados e em desenvolvimento</option>
          <option value="APPROVED">Aprovados</option>
          <option value="DEVELOPMENT">Em desenvolvimento</option>
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      {contextProductId && (
        <p className="context-chip">
          Mostrando apenas o produto{" "}
          <span className="code">{productContext?.code ?? "selecionado"}</span>
          {productContext ? ` · ${productContext.name}` : ""}{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/cadastros/produtos")}
          >
            Limpar filtros
          </button>
        </p>
      )}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Forma</th>
              <th>Apresentação</th>
              <th>Item acabado</th>
              <th>Vida útil</th>
              <th>Formulação</th>
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
                <td>
                  {product.name}
                  {/* Produto técnico de projeto: existe para custo, não para venda. */}
                  {product.lifecycle === "DEVELOPMENT" && (
                    <span className="badge badge--warn"> Em desenvolvimento</span>
                  )}
                </td>
                <td>
                  {product.customer
                    ? product.customer.tradeName ?? product.customer.legalName
                    : "—"}
                </td>
                <td>{product.dosageForm ? DOSAGE_FORM_LABELS[product.dosageForm] : "—"}</td>
                <td>
                  {product.presentationType
                    ? PRESENTATION_TYPE_LABELS[product.presentationType]
                    : "—"}
                </td>
                <td>
                  <EntityLink
                    kind="item"
                    id={product.finishedProductItem?.id}
                    code={product.finishedProductItem?.code}
                  />
                </td>
                <td>
                  {product.shelfLifeMonths ? `${product.shelfLifeMonths} meses` : "—"}
                </td>
                {/* Versão ACTIVE já existente — nenhuma lógica nova de versionamento. */}
                <td>{product.activeFormulationVersionLabel ?? "—"}</td>
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
                  <RowActions
                    actions={[
                      {
                        // Estrutura de custos é documento versionado: página
                        // própria, não modal.
                        label: "Custos industriais",
                        onSelect: () => navigate(`/produtos/${product.id}/custos`),
                      },
                      {
                        label: product.active ? "Inativar" : "Reativar",
                        destructive: product.active,
                        onSelect: () => handleToggleActive(product),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", product })}
                    >
                      Editar
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}

            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  {hasFilters ? (
                    <>
                      Nenhum produto encontrado para os filtros atuais.{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={clearFilters}
                      >
                        Limpar filtros
                      </button>
                    </>
                  ) : (
                    "Nenhum produto cadastrado."
                  )}
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
