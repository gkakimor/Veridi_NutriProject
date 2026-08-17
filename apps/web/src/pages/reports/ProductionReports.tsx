import { useEffect, useMemo, useState } from "react";
import type {
  ProductionOrderDTO,
  ProductionOrderStatus,
  TraceabilityConsumedRowDTO,
  TraceabilityProducedRowDTO,
} from "@veridi/shared";
import { COST_QUALITY_LABELS, COST_SOURCE_LABELS, PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import {
  getConsumptionReport,
  getPlannedActualReport,
  getProductionTraceabilityReport,
  getRequirementsReport,
} from "../../lib/reports-api";
import { listProductionOrders } from "../../lib/production-orders-api";
import { DocLink, ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import { dateInputValueOffset } from "../../lib/period";
import { formatBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Seletor de OP reutilizado pelos relatórios que exigem uma ordem. */
function useProductionOrderOptions() {
  const [orders, setOrders] = useState<ProductionOrderDTO[]>([]);
  useEffect(() => {
    listProductionOrders({ pageSize: 100 })
      .then((result) => setOrders(result.productionOrders))
      .catch(() => setOrders([]));
  }, []);
  return orders;
}

/** R-04 — Necessidade / Falta para OP. */
export function RequirementsReportPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [onlyShortage, setOnlyShortage] = useState(false);
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, status, onlyShortage, page, pageSize: PAGE_SIZE }),
    [search, status, onlyShortage, page],
  );
  const { data, loading, error } = useReport(getRequirementsReport, filters);

  return (
    <ReportPage
      title="R-04 · Necessidade / Falta para OP"
      csvPath="/reports/production/requirements/export.csv"
      reportCode="R-04"
      csvFilters={filters}
      total={data?.total}
      subtitle="Material necessário por Ordem de Produção aberta. A reserva da própria OP não gera falta, e 'Em compra' nunca reduz a falta."
      loading={loading}
      error={error}
      filters={
        <>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por OP ou produto…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
          <select
            aria-label="Status da OP"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Todas as OPs abertas</option>
            {(["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"] as ProductionOrderStatus[]).map((option) => (
              <option key={option} value={option}>
                {PRODUCTION_ORDER_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <label className="field--checkbox">
            <input
              type="checkbox"
              checked={onlyShortage}
              onChange={(event) => {
                setPage(1);
                setOnlyShortage(event.target.checked);
              }}
            />
            Somente com falta
          </label>
        </>
      }
    >
      <ReportTable
        columns={["OP", "Produto", "Status", "Item", "Necessário", "Reservado", "Disponível", "Em compra", "Falta"]}
        emptyMessage="Nenhuma necessidade de material encontrada."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.requirementId}>
            <td>
              <DocLink code={row.productionOrderCode} to={`/producao/ordens/${row.productionOrderId}`} />
            </td>
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td>{PRODUCTION_ORDER_STATUS_LABELS[row.productionOrderStatus]}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td className="is-number">
              {row.requiredQuantity} {row.unitCode}
            </td>
            <td className="is-number">{row.reserved}</td>
            <td className="is-number">{row.available}</td>
            <td className="is-number">{row.onOrder}</td>
            <td className="is-number">{row.shortage}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-05 — Planejado x Realizado. */
export function PlannedActualReportPage() {
  const [status, setStatus] = useState("COMPLETED");
  const [search, setSearch] = useState("");
  const [includeCost, setIncludeCost] = useState(false);
  const [from, setFrom] = useState(dateInputValueOffset(-29));
  const [to, setTo] = useState(dateInputValueOffset(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      status,
      search,
      includeCost,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      page,
      pageSize: PAGE_SIZE,
    }),
    [status, search, includeCost, from, to, page],
  );
  const { data, loading, error } = useReport(getPlannedActualReport, filters);

  return (
    <ReportPage
      title="R-05 · Planejado x Realizado"
      csvPath="/reports/production/planned-actual/export.csv"
      reportCode="R-05"
      csvFilters={filters}
      total={data?.total}
      subtitle={
        status === "COMPLETED"
          ? "OPs concluídas no período (por data de conclusão). Produzido vem dos apontamentos reais."
          : "OPs no status selecionado, filtradas pela data de criação."
      }
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="pa-from">De</label>
          <input id="pa-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="pa-to">até</label>
          <input id="pa-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <select
            aria-label="Status da OP"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            {(
              ["COMPLETED", "IN_PRODUCTION", "RELEASED", "PLANNED", "DRAFT", "CANCELLED"] as ProductionOrderStatus[]
            ).map((option) => (
              <option key={option} value={option}>
                {PRODUCTION_ORDER_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por OP ou produto…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
          <label className="field--checkbox">
            <input
              type="checkbox"
              checked={includeCost}
              onChange={(event) => setIncludeCost(event.target.checked)}
            />
            Incluir custo de material
          </label>
        </>
      }
    >
      <ReportTable
        columns={[
          "OP",
          "Produto",
          "Formulação",
          "Planejado",
          "Produzido",
          "Variação",
          "Rendimento",
          "Início",
          "Conclusão",
          "Status",
          ...(includeCost ? ["Custo material/un"] : []),
        ]}
        emptyMessage="Nenhuma Ordem de Produção no período selecionado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.productionOrderId}>
            <td>
              <DocLink code={row.productionOrderCode} to={`/producao/ordens/${row.productionOrderId}`} />
            </td>
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td>{row.formulationVersionNumber ? `v${row.formulationVersionNumber}` : "—"}</td>
            <td className="is-number">
              {row.plannedQuantity} {row.unitCode}
            </td>
            <td className="is-number">{row.producedQuantity}</td>
            <td className="is-number">{row.variance}</td>
            <td className="is-number">{row.yieldPercent ? `${row.yieldPercent}%` : "—"}</td>
            <td>{formatDate(row.startedAt)}</td>
            <td>{formatDate(row.completedAt)}</td>
            <td>{PRODUCTION_ORDER_STATUS_LABELS[row.status]}</td>
            {includeCost && (
              <td className="is-number">
                {/* Custo incompleto nunca é exibido como valor fechado. */}
                {row.materialUnitCost
                  ? `${formatBRL(row.materialUnitCost)} (${COST_QUALITY_LABELS[row.costQuality]})`
                  : COST_QUALITY_LABELS[row.costQuality]}
              </td>
            )}
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-06 — Rastreabilidade por OP. */
export function ProductionTraceabilityReportPage() {
  const orders = useProductionOrderOptions();
  const [productionOrderId, setProductionOrderId] = useState("");

  const filters = useMemo(() => ({ productionOrderId }), [productionOrderId]);
  const { data, loading, error } = useReport(getProductionTraceabilityReport, filters, {
    enabled: productionOrderId !== "",
  });

  return (
    <ReportPage
      title="R-06 · Rastreabilidade por OP"
      reportCode="R-06"
      printFilters={{ productionOrderId }}
      subtitle="Genealogia real: só o que foi efetivamente consumido e apontado — reserva e sugestão FEFO não entram."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="trace-op">Ordem de Produção</label>
          <select
            id="trace-op"
            value={productionOrderId}
            onChange={(event) => setProductionOrderId(event.target.value)}
          >
            <option value="">Selecione a OP…</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.code} — {order.productName}
              </option>
            ))}
          </select>
        </>
      }
    >
      {!productionOrderId && <p className="muted">Selecione uma Ordem de Produção para ver a genealogia.</p>}

      {data && (
        <>
          <section className="report-block">
            <h2>Ordem de Produção</h2>
            <dl className="definition-list">
              <dt>OP</dt>
              <dd>
                <DocLink code={data.productionOrderCode} to={`/producao/ordens/${data.productionOrderId}`} />
              </dd>
              <dt>Produto</dt>
              <dd>
                <EntityLink kind="product" id={data.productId} code={data.productCode} name={data.productName} />
              </dd>
              <dt>Planejado / Produzido</dt>
              <dd>
                {data.plannedQuantity} / {data.producedQuantity} {data.unitCode}
              </dd>
              <dt>Conclusão</dt>
              <dd>{formatDate(data.completedAt)}</dd>
            </dl>
          </section>

          <section className="report-block">
            <h2>Materiais realmente consumidos</h2>
            <ReportTable
              columns={["Item", "Lote interno", "Lote fornecedor", "Fornecedor", "Quantidade"]}
              emptyMessage="Nenhum consumo registrado nesta OP."
              rows={data.consumed.map((row: TraceabilityConsumedRowDTO) => (
                <tr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
                  <td>
                    <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                  </td>
                  <td>
                    <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
                  </td>
                  <td>{row.supplierLot ?? "—"}</td>
                  <td>{row.supplierName ?? "—"}</td>
                  <td className="is-number">
                    {row.quantity} {row.unitCode}
                  </td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Produto acabado produzido</h2>
            <ReportTable
              columns={["Lote interno", "Lote Veridi", "Quantidade", "Validade", "Qualidade"]}
              emptyMessage="Nenhum apontamento de produção nesta OP."
              rows={data.produced.map((row: TraceabilityProducedRowDTO) => (
                <tr key={row.lotId}>
                  <td>
                    <DocLink code={row.lotCode} to={`/estoque/lotes/${row.lotId}`} />
                  </td>
                  <td>{row.businessLotNumber ?? "—"}</td>
                  <td className="is-number">
                    {row.quantity} {row.unitCode}
                  </td>
                  <td>{formatDate(row.expiryDate)}</td>
                  <td>{row.isExpired ? "Vencido" : row.status}</td>
                </tr>
              ))}
            />
          </section>
        </>
      )}
    </ReportPage>
  );
}

/** R-07 — Consumo por período. */
export function ConsumptionReportPage() {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(dateInputValueOffset(-29));
  const [to, setTo] = useState(dateInputValueOffset(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, from, to, page],
  );
  const { data, loading, error } = useReport(getConsumptionReport, filters);

  return (
    <ReportPage
      title="R-07 · Consumo por período"
      csvPath="/reports/production/consumption/export.csv"
      reportCode="R-07"
      csvFilters={filters}
      total={data?.total}
      subtitle="Consumo real de materiais, com o custo do lote consumido e sua origem."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="cons-from">De</label>
          <input id="cons-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="cons-to">até</label>
          <input id="cons-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por item, lote ou OP…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Data",
          "Item",
          "Lote",
          "Produto",
          "OP",
          "Quantidade",
          "Custo unitário",
          "Origem do custo",
          "Custo do consumo",
        ]}
        emptyMessage="Nenhum consumo registrado no período."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.id}>
            <td>{formatDate(row.consumedAt)}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td>
              <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
            </td>
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td>
              <DocLink code={row.productionOrderCode} to={`/producao/ordens/${row.productionOrderId}`} />
            </td>
            <td className="is-number">
              {row.quantity} {row.unitCode}
            </td>
            {/* Custo desconhecido aparece como "Sem custo", nunca como zero. */}
            <td className="is-number">{row.unitCost ? formatBRL(row.unitCost) : "Sem custo"}</td>
            <td>{COST_SOURCE_LABELS[row.costSource]}</td>
            <td className="is-number">{row.totalCost ? formatBRL(row.totalCost) : "—"}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}
