import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import type { PurchaseOrderDTO, PurchaseOrderStatus } from "@veridi/shared";
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { ListPurchaseOrdersParams } from "../../lib/purchase-orders-api";
import { listPurchaseOrders } from "../../lib/purchase-orders-api";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { useAuth } from "../../app/AuthProvider";
import { useListFilters } from "../../lib/list-filters";
import type { ListPeriodPreset } from "../../lib/list-period";
import {
  LIST_PERIOD_PRESET_LABELS,
  ehListPeriodPreset,
  formatListPeriod,
  resolveListPeriod,
} from "../../lib/list-period";
import { fornecedorFilterSource } from "../../lib/filter-sources";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { DateRangeFilter } from "../../components/filters/DateRangeFilter";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import type { StatusGroup } from "../../components/filters/StatusGroupFilter";
import {
  StatusGroupFilter,
  labelOfGroup,
  statusesOfGroup,
} from "../../components/filters/StatusGroupFilter";
import type { EntityOption } from "../../components/SearchableEntitySelect";

const PAGE_SIZE = 20;

function statusBadgeClass(status: PurchaseOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ORDERED":
    case "RECEIVED":
      return "badge badge--active";
    case "PARTIALLY_RECEIVED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

/**
 * "Em aberto" — a ordem de compra que ainda pede trabalho de Compras.
 *
 * O rascunho ainda precisa ser confirmado ao fornecedor; a confirmada e a
 * recebida parcialmente ainda têm material a chegar. `RECEIVED` e
 * `CANCELLED` são os estados encerrados. Não é `OPEN_PURCHASE_ORDER_STATUSES`
 * (`@veridi/shared`): aquele é "o que conta como Em Compra" no estoque, e
 * rascunho não conta — mas é trabalho aberto de quem compra.
 *
 * A regra de compras não muda: uma ordem com sobra que nunca vai chegar
 * continua parcialmente recebida, e por isso continua na fila.
 */
const EM_ABERTO: PurchaseOrderStatus[] = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"];

/**
 * As escolhas do filtro de status. O valor na URL é a chave: `em-aberto` (o
 * default, fora do endereço), `todos`, ou o status do domínio.
 */
const GRUPOS: StatusGroup<PurchaseOrderStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: EM_ABERTO },
  { key: "todos", label: "Todos os status", statuses: [] },
  ...PURCHASE_ORDER_STATUSES.map((status) => ({
    key: status,
    label: PURCHASE_ORDER_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: não vira chip e não aparece na URL. */
  status: "em-aberto",
  /* Também é o contexto do link "Ordens de compra" do cadastro do Fornecedor. */
  supplierId: "",
  /*
   * Sem recorte de período por default: a fila é por status, e um período
   * padrão esconderia a OC confirmada há dois meses que ainda não chegou —
   * justamente a que mais precisa de atenção.
   */
  period: "todos",
  dateFrom: "",
  dateTo: "",
};

/** Sem default de período, "Todo o período" é a saída e vem primeiro. */
const PRESETS_DA_OC: ListPeriodPreset[] = ["todos", "hoje", "7d", "30d", "mes-atual", "custom"];

function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

/**
 * Compras → Ordens de Compra. Documento transacional: linhas abrem pagina propria, nao modal.
 *
 * FILTER-OPERATIONS-WAVE-03. Os filtros viviam em `useState`, então nenhum
 * endereço reproduzia o recorte e voltar de uma OC perdia a busca. O
 * fornecedor era um `<select>` com `listSuppliers({ pageSize: 1000 })` —
 * teto fixo apresentado como catálogo inteiro — e o `?supplierId=` do
 * cadastro do Fornecedor ficava FORA do "Limpar filtros" (não havia um).
 */
export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fornecedorEscolhido, setFornecedorEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "purchase-orders",
    userId: user?.id ?? null,
  });
  const { search, supplierId } = values;
  const grupo = grupoValido(values.status);
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "todos";

  /*
   * Período em DIAS CIVIS pela data do pedido. `orderDate` é data de
   * documento, e quem compara dia com a coluna é o servidor — a tela só
   * resolve o que o atalho quer dizer hoje, no fuso da operação.
   */
  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );

  /* UM conjunto de filtros para a consulta e para o CSV. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListPurchaseOrdersParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (supplierId) filtros.supplierId = supplierId;
    const statuses = statusesOfGroup(GRUPOS, grupo);
    if (statuses.length > 0) filtros.status = statuses;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    return filtros;
  }, [search, supplierId, grupo, periodo.dateFrom, periodo.dateTo]);

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

    listPurchaseOrders({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setPurchaseOrders(result.purchaseOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de compra");
      })
      .finally(() => setLoading(false));
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

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
  if (supplierId) {
    const nome =
      fornecedorEscolhido?.id === supplierId
        ? `${fornecedorEscolhido.code} · ${fornecedorEscolhido.name}`
        : (purchaseOrders.find((po) => po.supplierId === supplierId)?.supplierName ?? "selecionado");
    chips.push({ label: "Fornecedor", value: nome, onRemove: () => set({ supplierId: "" }) });
  }
  if (period !== FILTROS_PADRAO.period) {
    chips.push({
      label: "Período",
      value: period === "custom" ? formatListPeriod(periodo) : LIST_PERIOD_PRESET_LABELS[period],
      onRemove: () => set({ period: FILTROS_PADRAO.period, dateFrom: "", dateTo: "" }),
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordens de Compra</h1>
          <p className="page__subtitle">
            Pedidos de materiais e embalagens enviados aos fornecedores.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/compras/ordens/nova")}
        >
          + Nova OC
        </button>
        <ExportCsvButton path="/purchase-orders/export.csv" filters={filtrosDaConsulta} />
      </div>

      {/* Rascunho, Confirmada e Parcialmente recebida são estados com
          consequências diferentes no estoque — e só um deles conta como
          Em Compra. */}
      <ContextHelp topic={helpTopics["compras.ordens"]} />

      <DateRangeFilter
        idPrefix="po"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        presets={PRESETS_DA_OC}
        fromLabel="Pedido a partir de"
        toLabel="Pedido até"
        onChange={(next) => set(next)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="po-search">
            Buscar ordens de compra
          </label>
          <input
            id="po-search"
            type="search"
            placeholder="Buscar por código ou fornecedor…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="po-status-filter"
          label="Filtrar por status"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ status: key })}
        />

        {/* Busca no servidor: o cadastro de fornecedores não cabe num `<select>`. */}
        <EntityFilterSelect
          id="po-supplier-filter"
          label="Filtrar por fornecedor"
          placeholder="Todos os fornecedores"
          value={supplierId}
          onChange={(value) => set({ supplierId: value })}
          source={fornecedorFilterSource}
          onResolve={setFornecedorEscolhido}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">Fornecedor</th>
              <th className="col-tight">Data</th>
              <th className="col-tight">Previsão</th>
              <th className="col-tight is-numeric">Itens</th>
              <th className="col-tight is-numeric">Total</th>
              <th className="col-tight">Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr
                key={po.id}
                tabIndex={0}
                onClick={() => navigate(`/compras/ordens/${po.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/compras/ordens/${po.id}`);
                }}
              >
                <td className="col-tight is-code">
                  <EntityLink kind="purchaseOrder" id={po.id} code={po.code} />
                </td>
                <td className="col-flex">
                  <EntityLink kind="supplier" id={po.supplierId} code={po.supplierCode} name={po.supplierName} />
                </td>
                <td className="col-tight">{formatDate(po.orderDate)}</td>
                <td className="col-tight">{formatDate(po.expectedDeliveryDate)}</td>
                <td className="col-tight is-numeric">{po.lines.length}</td>
                <td className="col-tight is-numeric">{formatBRL(po.orderTotal)}</td>
                <td className="col-tight">
                  <span className={statusBadgeClass(po.status)}>
                    {PURCHASE_ORDER_STATUS_LABELS[po.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/compras/ordens/${po.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && purchaseOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhuma ordem de compra encontrada para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    <>
                      Nenhuma ordem de compra em aberto.{" "}
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
          {total} {total === 1 ? "ordem de compra" : "ordens de compra"}
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
