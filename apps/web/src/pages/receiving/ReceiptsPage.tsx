import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import { EntityLink } from "../../components/EntityLink";
import type { ReceiptDTO, ReceiptSourceType } from "@veridi/shared";
import { RECEIPT_SOURCE_TYPES, RECEIPT_SOURCE_TYPE_LABELS } from "@veridi/shared";
import type { ListReceiptsParams } from "../../lib/receiving-api";
import { listReceipts } from "../../lib/receiving-api";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { useListFilters } from "../../lib/list-filters";
import type { ListPeriodPreset } from "../../lib/list-period";
import {
  LIST_PERIOD_PRESET_LABELS,
  ehListPeriodPreset,
  formatListPeriod,
  resolveListPeriod,
} from "../../lib/list-period";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { DateRangeFilter } from "../../components/filters/DateRangeFilter";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { fornecedorFilterSource } from "../../lib/filter-sources";
import { useAuth } from "../../app/AuthProvider";

const PAGE_SIZE = 20;

/**
 * Os filtros desta lista, e o que cada um significa quando está limpo.
 *
 * `period: "todos"` PRESERVA o comportamento atual — Recebimentos nunca teve
 * recorte de período, e impor um default operacional aqui esconderia
 * registros de uma tela que hoje mostra tudo. Isso é decisão de Product
 * Ownership, não de migração para a foundation.
 */
const FILTROS_PADRAO = {
  search: "",
  supplierId: "",
  sourceType: "all",
  period: "todos",
  dateFrom: "",
  dateTo: "",
  /* Contexto por link: quem chega de uma OC ou de um cliente vê o recorte. */
  purchaseOrderId: "",
  customerId: "",
};

/** Uma tela sem default de período precisa do "Todo o período" como saída. */
const PRESETS_DO_RECEBIMENTO: ListPeriodPreset[] = [
  "todos",
  "hoje",
  "7d",
  "30d",
  "mes-atual",
  "custom",
];

/**
 * Compras → Recebimentos. Receipt e historico/somente-leitura apos confirmado.
 *
 * A API já respondia por fornecedor, origem, OC, cliente e período; a tela
 * oferecia só a busca. Filtro que existe no servidor e não existe na tela é
 * capacidade perdida — e no caso do período era também um bug de data.
 */
export function ReceiptsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [receipts, setReceipts] = useState<ReceiptDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "receipts",
    userId: user?.id ?? null,
  });
  const { search, supplierId, purchaseOrderId, customerId } = values;
  const sourceType = values.sourceType as ReceiptSourceType | "all";
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "todos";

  /*
   * Período em dias comerciais. `Receipt.receivedAt` é instante, e o dia a
   * que ele pertence é o da operação — quem abre o dia nos dois instantes
   * que o limitam é o servidor, com fim exclusivo.
   */
  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );

  /* UM conjunto de filtros para a consulta e para o CSV. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListReceiptsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (supplierId) filtros.supplierId = supplierId;
    if (sourceType !== "all") filtros.sourceType = sourceType;
    if (purchaseOrderId) filtros.purchaseOrderId = purchaseOrderId;
    if (customerId) filtros.customerId = customerId;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    return filtros;
  }, [search, supplierId, sourceType, purchaseOrderId, customerId, periodo.dateFrom, periodo.dateTo]);

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

    listReceipts({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setReceipts(result.receipts);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar recebimentos");
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
  if (sourceType !== "all") {
    chips.push({
      label: "Origem",
      value: RECEIPT_SOURCE_TYPE_LABELS[sourceType],
      onRemove: () => set({ sourceType: "all" }),
    });
  }
  if (supplierId) {
    chips.push({
      label: "Fornecedor",
      value: receipts.find((receipt) => receipt.supplierId === supplierId)?.supplierName ?? "selecionado",
      onRemove: () => set({ supplierId: "" }),
    });
  }
  if (purchaseOrderId) {
    chips.push({
      label: "OC",
      value: receipts[0]?.purchaseOrderCode ?? "da origem",
      onRemove: () => set({ purchaseOrderId: "" }),
    });
  }
  if (customerId) {
    chips.push({
      label: "Cliente",
      value: receipts.find((receipt) => receipt.customerId === customerId)?.customerName ?? "selecionado",
      onRemove: () => set({ customerId: "" }),
    });
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
          <h1 className="page__title">Recebimentos</h1>
          <p className="page__subtitle">
            Materiais recebidos de Ordens de Compra ou enviados pelo próprio cliente.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/compras/recebimentos/novo")}
        >
          Receber OC
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => navigate("/compras/recebimentos/material-do-cliente")}
        >
          Receber material do cliente
        </button>
        <ExportCsvButton path="/receipts/export.csv" filters={filtrosDaConsulta} />
</div>

      {/* Duas entradas muito diferentes moram na mesma lista — compra da
          Veridi e remessa do cliente. Dizer isso antes da tabela evita a
          pergunta "por que este recebimento não tem fornecedor?". */}
      <ContextHelp topic={helpTopics["compras.recebimentos"]} />

      <DateRangeFilter
        idPrefix="receipts"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        presets={PRESETS_DO_RECEBIMENTO}
        fromLabel="Recebido a partir de"
        toLabel="Recebido até"
        onChange={(next) => set(next)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="receipts-search">
            Buscar recebimentos
          </label>
          <input
            id="receipts-search"
            type="search"
            placeholder="Buscar por código ou OC…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="receipts-source-filter">
          Filtrar por origem
        </label>
        <select
          id="receipts-source-filter"
          value={sourceType}
          onChange={(event) => set({ sourceType: event.target.value })}
        >
          <option value="all">Toda origem</option>
          {RECEIPT_SOURCE_TYPES.map((option) => (
            <option key={option} value={option}>
              {RECEIPT_SOURCE_TYPE_LABELS[option]}
            </option>
          ))}
        </select>

        <EntityFilterSelect
          id="receipts-supplier-filter"
          label="Filtrar por fornecedor"
          placeholder="Todos os fornecedores"
          value={supplierId}
          onChange={(value) => set({ supplierId: value })}
          source={fornecedorFilterSource}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-tight">Origem</th>
              <th className="col-tight">OC</th>
              <th className="col-flex">Fornecedor / Cliente</th>
              <th className="col-tight">Data</th>
              <th className="col-tight is-numeric">Itens</th>
              <th className="col-tight">Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr
                key={receipt.id}
                tabIndex={0}
                onClick={() => navigate(`/compras/recebimentos/${receipt.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/compras/recebimentos/${receipt.id}`);
                }}
              >
                <td className="col-tight is-code">
                  <EntityLink kind="receipt" id={receipt.id} code={receipt.code} />
                </td>
                <td className="col-tight">{RECEIPT_SOURCE_TYPE_LABELS[receipt.sourceType]}</td>
                <td className="col-tight is-code">
                  {/* Recebimento de material do cliente não tem OC: sem id, o
                      EntityLink devolve texto e o traço continua traço. */}
                  <EntityLink
                    kind="purchaseOrder"
                    id={receipt.purchaseOrderId}
                    code={receipt.purchaseOrderCode ?? "—"}
                  />
                </td>
                <td className="col-flex">
                  {receipt.sourceType === "CUSTOMER_SUPPLIED"
                    ? `Cliente — ${receipt.customerName ?? ""}`
                    : (receipt.supplierName ?? "—")}
                </td>
                <td className="col-tight">{formatDate(receipt.receivedAt)}</td>
                <td className="col-tight is-numeric">{receipt.lines.length}</td>
                <td className="col-tight">
                  <span className="badge badge--active">Confirmado</span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/compras/recebimentos/${receipt.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && receipts.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhum recebimento encontrado para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    "Nenhum recebimento encontrado."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "recebimento" : "recebimentos"}
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
