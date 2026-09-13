import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BulkSelectionBar,
  BulkSelectionCell,
  BulkSelectionHeaderCell,
  useBulkSelection,
} from "../../components/BulkSelection";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import type { ProductionOrderDTO, ProductionOrderStatus } from "@veridi/shared";
import { PRODUCTION_ORDER_STATUSES, PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { ListProductionOrdersParams } from "../../lib/production-orders-api";
import { listProductionOrders } from "../../lib/production-orders-api";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { useListFilters } from "../../lib/list-filters";
import { produtoFilterSource } from "../../lib/filter-sources";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import type { StatusGroup } from "../../components/filters/StatusGroupFilter";
import {
  StatusGroupFilter,
  labelOfGroup,
  statusesOfGroup,
} from "../../components/filters/StatusGroupFilter";
import type { EntityOption } from "../../components/SearchableEntitySelect";

const PAGE_SIZE = 20;

function statusBadgeClass(status: ProductionOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "PLANNED":
    case "RELEASED":
      return "badge badge--active";
    case "IN_PRODUCTION":
      return "badge badge--warn";
    case "COMPLETED":
      return "badge badge--active";
    case "BLOCKED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function materialsLabel(order: ProductionOrderDTO): string {
  if (order.status === "CANCELLED") return "—";
  if (order.status === "RELEASED" || order.status === "IN_PRODUCTION" || order.status === "COMPLETED") {
    return "Reservado";
  }
  return order.materialsStatus === "MATERIALS_AVAILABLE"
    ? "Disponível"
    : `Falta em ${order.shortageItemCount} ${order.shortageItemCount === 1 ? "material" : "materiais"}`;
}

function materialsBadgeClass(order: ProductionOrderDTO): string {
  if (order.status === "CANCELLED") return "badge badge--neutral";
  if (order.status === "RELEASED" || order.status === "IN_PRODUCTION" || order.status === "COMPLETED") {
    return "badge badge--active";
  }
  return order.materialsStatus === "MATERIALS_AVAILABLE" ? "badge badge--active" : "badge badge--warn";
}

/**
 * "Em aberto" — a ordem que a produção ainda tem pela frente.
 *
 * Os quatro estados que o ciclo da OP percorre antes de terminar: rascunho
 * (falta planejar), planejada (falta liberar), liberada (falta separar e
 * consumir) e em produção (falta apontar e concluir). `COMPLETED` e
 * `CANCELLED` ficam fora: não há mais trabalho.
 *
 * `BLOCKED` também fica fora, e não por decisão desta tela: nenhum serviço
 * escreve esse status hoje, então não existe o que "bloqueada" significa na
 * operação — se ainda pede trabalho, de quem, e o que a destrava. Colocá-la
 * na fila seria inventar essa semântica. Ela continua exatamente como
 * estava: uma opção própria do filtro e parte de "Todos os status".
 */
const EM_ABERTO: ProductionOrderStatus[] = ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"];

/**
 * As escolhas do filtro de status. O valor na URL é a chave: `em-aberto` (o
 * default, fora do endereço), `todos`, ou o status do domínio.
 *
 * "Em aberto" são quatro status numa consulta — o mesmo `status=A,B,...`
 * que o Picking/Consumo já usa. Nenhum contrato novo.
 */
const GRUPOS: StatusGroup<ProductionOrderStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: EM_ABERTO },
  { key: "todos", label: "Todos os status", statuses: [] },
  ...PRODUCTION_ORDER_STATUSES.map((status) => ({
    key: status,
    label: PRODUCTION_ORDER_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: não vira chip e não aparece na URL. */
  status: "em-aberto",
  /* Também é o contexto do link "Ordens de produção" do cadastro do Produto. */
  productId: "",
  /*
   * Roteiro de produção: `1` = pendentes de roteiro (rascunho, planejada ou
   * liberada sem roteiro), `0` = com roteiro, vazio = todas. É o destino do
   * indicador "OPs sem roteiro" do Dashboard: `/producao/ordens?semRoteiro=1`.
   */
  semRoteiro: "",
};

const ROTEIRO_OPCOES: { value: string; label: string }[] = [
  { value: "", label: "Todos os roteiros" },
  { value: "0", label: "Com roteiro" },
  { value: "1", label: "Sem roteiro" },
];

function roteiroValido(valor: string): string {
  return valor === "0" || valor === "1" ? valor : "";
}

function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

/**
 * Produção → Ordens de Produção. Documento transacional: linha abre página própria, não modal.
 *
 * FILTER-OPERATIONS-WAVE-03. O `?productId=` do cadastro do Produto era lido
 * à parte, fora do conjunto de filtros — e por isso fora das dependências do
 * recarregamento, fora do CSV e fora do "Limpar filtros" da barra. A busca e
 * o status vinham da sessão campo a campo e se somavam ao produto do link.
 * Agora o produto é filtro como os outros, com chip, controle e endereço.
 */
const FILTER_SCOPE = "production-orders";

export function ProductionOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [productionOrders, setProductionOrders] = useState<ProductionOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [produtoEscolhido, setProdutoEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: FILTER_SCOPE,
    userId: user?.id ?? null,
  });
  const { search, productId } = values;
  const grupo = grupoValido(values.status);
  const semRoteiro = roteiroValido(values.semRoteiro);
  const canOperate = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  /* UM conjunto de filtros para a consulta e para o CSV. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListProductionOrdersParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (productId) filtros.productId = productId;
    const statuses = statusesOfGroup(GRUPOS, grupo);
    if (statuses.length > 0) filtros.status = statuses;
    // Entra no MESMO objeto da consulta, do CSV e da seleção em massa: trocar
    // o filtro de roteiro limpa a seleção como qualquer outro filtro.
    if (semRoteiro) filtros.semRoteiro = semRoteiro === "1";
    return filtros;
  }, [search, productId, grupo, semRoteiro]);

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(handle);
  }, [searchInput, search, set]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    listProductionOrders({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setProductionOrders(result.productionOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de produção");
      })
      .finally(() => setLoading(false));
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  /*
   * Seleção em massa sobre o MESMO recorte da consulta e do CSV. Ainda sem
   * ação, e nada no ciclo de vida da OP muda por estar selecionada.
   */
  const selecao = useBulkSelection({
    pageIds: productionOrders.map((op) => op.id),
    total,
    filters: filtrosDaConsulta,
    loading,
  });

  const chips: FilterChip[] = [];
  if (search) {
    chips.push({ label: "Busca", value: search, onRemove: () => set({ search: "" }) });
  }
  if (grupo !== FILTROS_PADRAO.status) {
    chips.push({
      label: "Status",
      value: labelOfGroup(GRUPOS, grupo),
      onRemove: () => set({ status: FILTROS_PADRAO.status }),
    });
  }
  if (semRoteiro) {
    chips.push({
      label: "Roteiro",
      value: semRoteiro === "1" ? "Sem roteiro" : "Com roteiro",
      onRemove: () => set({ semRoteiro: "" }),
    });
  }
  if (productId) {
    const nome =
      produtoEscolhido?.id === productId
        ? `${produtoEscolhido.code} · ${produtoEscolhido.name}`
        : (productionOrders.find((op) => op.productId === productId)?.productName ?? "selecionado");
    chips.push({ label: "Produto", value: nome, onRemove: () => set({ productId: "" }) });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordens de Produção</h1>
          <p className="page__subtitle">
            Necessidade de materiais calculada a partir do Produto e da Formulação.
          </p>
        </div>
        {canOperate && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => navigate("/producao/ordens/nova")}
          >
            + Nova OP
          </button>
        )}
        <ExportCsvButton path="/production-orders/export.csv" filters={filtrosDaConsulta} />
      </div>

      <ContextHelp topic={helpTopics["producao.ordens"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="op-search">
            Buscar ordens de produção
          </label>
          <input
            id="op-search"
            type="search"
            placeholder="Buscar por código ou produto…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="op-status-filter"
          label="Filtrar por status"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ status: key })}
        />

        <label className="sr-only" htmlFor="op-route-filter">
          Filtrar por roteiro de produção
        </label>
        <select
          id="op-route-filter"
          value={semRoteiro}
          onChange={(event) => set({ semRoteiro: event.target.value })}
        >
          {ROTEIRO_OPCOES.map((opcao) => (
            <option key={opcao.value} value={opcao.value}>
              {opcao.label}
            </option>
          ))}
        </select>

        {/* Busca no servidor: o catálogo de produtos não cabe num `<select>`. */}
        <EntityFilterSelect
          id="op-product-filter"
          label="Filtrar por produto"
          placeholder="Todos os produtos"
          value={productId}
          onChange={(value) => set({ productId: value })}
          source={produtoFilterSource}
          onResolve={setProdutoEscolhido}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <BulkSelectionBar selection={selecao} />

      <div className="table-container">
        <table className="table table--clickable-rows table--sticky-actions">
          <thead>
            <tr>
              <BulkSelectionHeaderCell selection={selecao} />
              <th className="col-tight">OP</th>
              <th className="col-flex">Produto</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Formulação</th>
              <th className="col-tight is-numeric">Quantidade</th>
              <th className="col-tight">Materiais</th>
              <th className="col-tight">Status</th>
              <th className="col-tight">Criada em</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {productionOrders.map((op) => (
              <tr
                key={op.id}
                tabIndex={0}
                onClick={() => navigate(`/producao/ordens/${op.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/producao/ordens/${op.id}`);
                }}
              >
                <BulkSelectionCell
                  selection={selecao}
                  id={op.id}
                  label={`Selecionar ordem de produção ${op.code}`}
                />
                <td className="col-tight is-code">
                  <EntityLink kind="productionOrder" id={op.id} code={op.code} />
                  {op.customerOrderId && (
                    <span className="cell-sub">
                      <EntityLink
                        kind="customerOrder"
                        id={op.customerOrderId}
                        code={op.customerOrderCode}
                      />
                    </span>
                  )}
                </td>
                <td className="col-flex">
                  <EntityLink
                    kind="product"
                    id={op.productId}
                    code={op.productCode}
                    name={op.productName}
                  />
                </td>
                <td className="col-flex">
                  <EntityLink
                    kind="customer"
                    id={op.customerId}
                    code={op.customerCode}
                    name={op.customerName}
                  />
                </td>
                <td className="col-tight">{op.formulationVersionLabel ?? "—"}</td>
                <td className="col-tight is-numeric">
                  {formatQuantity(op.plannedQuantity)} {op.outputUnitCode}
                </td>
                <td className="col-tight">
                  <span className={materialsBadgeClass(op)}>{materialsLabel(op)}</span>
                </td>
                <td className="col-tight">
                  <span className={statusBadgeClass(op.status)}>
                    {PRODUCTION_ORDER_STATUS_LABELS[op.status]}
                  </span>
                  {op.planning?.routePending === true && (
                    <span className="cell-sub">
                      <span className="badge badge--warn">Sem roteiro</span>
                    </span>
                  )}
                </td>
                <td className="col-tight">{formatDate(op.createdAt)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/producao/ordens/${op.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && productionOrders.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhuma ordem de produção encontrada para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    <>
                      Nenhuma ordem de produção em aberto.{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => set({ status: "todos" })}
                      >
                        Ver todas
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "ordem de produção" : "ordens de produção"}
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
    </>
  );
}
