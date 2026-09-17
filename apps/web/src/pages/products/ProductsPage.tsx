import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { useNavigate } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import type { ProductDTO } from "@veridi/shared";
import { DOSAGE_FORM_LABELS, PRESENTATION_TYPE_LABELS } from "@veridi/shared";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import type { ListProductsParams } from "../../lib/products-api";
import { listProducts, setProductActive } from "../../lib/products-api";
import { clienteFilterSource } from "../../lib/filter-sources";
import { ProductFormModal } from "./ProductFormModal";
import {
  PEDIR_CADASTRO_DE_PRODUTO,
  podeMudarSituacaoDoProduto,
  usePodeEditarProduto,
} from "./product-permissions";
import { useOptionalAuth } from "../../app/AuthProvider";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { RetornoDoContexto } from "../../components/RecordContext";
import { RowActions } from "../../components/RowActions";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type LifecycleFilter = "all" | "APPROVED" | "DEVELOPMENT";
type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; product: ProductDTO };

const PAGE_SIZE = 20;

/** Cadastros → Produtos Acabados. Mesmo padrao de tabela densa + modal de Items. */
export function ProductsPage() {
  const navigate = useNavigate();
  /*
   * MASTER-DATA-EDIT-PERMISSIONS-01: criar, editar, inativar e reativar são de
   * Comercial e Administrador. Os demais perfis abrem o Produto em consulta —
   * pela linha, pelo "Ver" ou por link de outra tela — e não recebem
   * "+ Novo produto". CMV e Custos industriais seguem no menu: são telas com
   * regra própria, não o cadastro.
   */
  const podeEditar = usePodeEditarProduto();
  const sessao = useOptionalAuth();
  const podeMudarSituacao = sessao === null || podeMudarSituacaoDoProduto(sessao.user?.role);

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
  const [customerFilter, setCustomerFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");

  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });

  // Contexto exato substitui filtros incompatíveis: combinar o cliente da
  // visita anterior com o produto pedido agora daria lista vazia.
  useEffect(() => {
    if (!contextProductId) return;
    setSearchInput("");
    setSearch("");
    setCustomerFilter("");
    setActiveFilter("all");
    setLifecycleFilter("all");
  }, [contextProductId]);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListProductsParams, "page" | "pageSize"> = {};
    if (contextProductId) filtros.productId = contextProductId;
    if (search) filtros.search = search;
    if (customerFilter) filtros.customerId = customerFilter;
    if (activeFilter !== "all") filtros.active = activeFilter === "active";
    if (lifecycleFilter !== "all") filtros.lifecycle = lifecycleFilter;
    return filtros;
  }, [contextProductId, search, customerFilter, activeFilter, lifecycleFilter]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listProducts,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar produtos" },
  );
  const products: ProductDTO[] = consulta.data?.products ?? [];
  const total = consulta.data?.total ?? 0;
  const reload = consulta.reload;
  /* O produto do link sai da resposta do próprio recorte — nunca da de antes. */
  const productContext = contextProductId
    ? (products.find((row) => row.id === contextProductId) ?? null)
    : null;

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
      // Recusa por situação que já mudou (409): a linha volta a mostrar a verdade.
      reload();
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Produtos Acabados</h1>
          <p className="page__subtitle">
            Produtos comerciais e industriais fabricados pela Veridi.
          </p>
        </div>
        {/* Leva à tela oficial, não ao modal: o cadastro passou a ter URL
            própria, e é ela que sobrevive a um F5 e vale como link. O modal
            continua servindo à EDIÇÃO, aberta a partir da linha. */}
        {podeEditar && (
          <Link className="btn btn--primary" to="/cadastros/produtos/novo">
            + Novo produto
          </Link>
        )}
        <ExportCsvButton path="/products/export.csv" filters={{ search, customerId: customerFilter, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
</div>

      {/* Duas perguntas chegam junto com a tela: o que separa produto de item
          de estoque, e por que um produto listado aqui é recusado num pedido.
          As duas se respondem antes de qualquer filtro. */}
      <ContextHelp topic={helpTopics["produto.comoFunciona"]} />

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

        {/* Mesmo filtro de Cliente de Pedidos: abre com a primeira página e
            busca no servidor entre todos, inativo inclusive — o universo que a
            lista de 1000 oferecia, sem o teto. */}
        <EntityFilterSelect
          id="products-customer-filter"
          label="Filtrar por cliente"
          placeholder="Todos os clientes"
          value={customerFilter}
          onChange={setCustomerFilter}
          source={clienteFilterSource}
        />

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

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      {contextProductId && (
        <p className="context-chip">
          Mostrando apenas o produto{" "}
          <span className="code">{productContext?.code ?? "selecionado"}</span>
          {productContext ? ` · ${productContext.name}` : ""} <RetornoDoContexto />{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/cadastros/produtos")}
          >
            Limpar filtros
          </button>
        </p>
      )}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">
                Produto
                <DicaDaColuna id="produto.cicloDeVida" />
              </th>
              <th className="col-flex">
                Cliente
                <DicaDaColuna id="produto.cliente" />
              </th>
              <th className="col-tight">Forma</th>
              <th className="col-tight">Apresentação</th>
              <th className="col-tight">
                Item acabado
                <DicaDaColuna id="produto.itemAcabado" />
              </th>
              <th className="col-tight">
                Vida útil
                <DicaDaColuna id="produto.vidaUtil" />
              </th>
              <th className="col-tight">
                Formulação
                <DicaDaColuna id="produto.formulacaoAtiva" />
              </th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="produto.situacao" />
              </th>
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
                <td className="is-code col-tight">{product.code}</td>
                <td className="col-flex">
                  {product.name}
                  {/* Produto técnico de projeto: existe para custo, não para venda. */}
                  {product.lifecycle === "DEVELOPMENT" && (
                    <span className="badge badge--warn"> Em desenvolvimento</span>
                  )}
                </td>
                <td className="col-flex">
                  {product.customer
                    ? product.customer.tradeName ?? product.customer.legalName
                    : "—"}
                </td>
                <td className="col-tight">
                  {product.dosageForm ? DOSAGE_FORM_LABELS[product.dosageForm] : "—"}
                </td>
                <td className="col-tight">
                  {product.presentationType
                    ? PRESENTATION_TYPE_LABELS[product.presentationType]
                    : "—"}
                </td>
                <td className="col-tight">
                  <EntityLink
                    kind="item"
                    id={product.finishedProductItem?.id}
                    code={product.finishedProductItem?.code}
                  />
                </td>
                <td className="col-tight">
                  {product.shelfLifeMonths ? `${product.shelfLifeMonths} meses` : "—"}
                </td>
                {/* Versão ACTIVE já existente — nenhuma lógica nova de versionamento. */}
                <td className="col-tight">{product.activeFormulationVersionLabel ?? "—"}</td>
                <td className="col-tight">
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
                    label={`Mais ações de ${product.code}`}
                    actions={[
                      {
                        // Pergunta de negócio antes do documento: quanto custa
                        // produzir uma quantidade deste produto.
                        label: "CMV",
                        onSelect: () => navigate(`/produtos/${product.id}/cmv`),
                      },
                      {
                        // Estrutura de custos é documento versionado: página
                        // própria, não modal.
                        label: "Custos industriais",
                        onSelect: () => navigate(`/produtos/${product.id}/custos`),
                      },
                      ...(podeMudarSituacao
                        ? [
                            {
                              label: product.active ? "Inativar" : "Reativar",
                              destructive: product.active,
                              onSelect: () => handleToggleActive(product),
                            },
                          ]
                        : []),
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", product })}
                    >
                      {podeEditar ? "Editar" : "Ver"}
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={10} query={consulta} rowCount={products.length}>
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
              ) : podeEditar ? (
                "Nenhum produto cadastrado."
              ) : (
                `Nenhum produto cadastrado. ${PEDIR_CADASTRO_DE_PRODUTO}`
              )}
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "produto" : "produtos"}
          </div>
        )}
      </div>

      {consulta.data && (
        <div className="pagination">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="table__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {modalState.mode !== "closed" && (
        <ProductFormModal
          key={modalState.mode === "edit" ? modalState.product.id : "create"}
          mode={modalState.mode}
          product={modalState.mode === "edit" ? modalState.product : null}
          readOnly={!podeEditar}
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
