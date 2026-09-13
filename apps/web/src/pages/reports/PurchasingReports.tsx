import { formatQuantity } from "../../lib/quantity";
import { useMemo, useState } from "react";
import type { PurchaseOrderStatus } from "@veridi/shared";
import { PURCHASE_ORDER_STATUS_LABELS } from "@veridi/shared";
import {
  getLatePurchaseOrdersReport,
  getOnOrderReport,
  getPurchaseOrdersReport,
  getReceiptsReport,
} from "../../lib/reports-api";
import { fornecedorFilterSource } from "../../lib/filter-sources";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { DocLink, ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import { diaDoRelatorio } from "./report-period";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";

const PAGE_SIZE = 25;


/**
 * Filtro por Fornecedor com busca no servidor — o `<select>` de mil
 * fornecedores escondia do filtro quem passasse do milésimo.
 */
function SupplierFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <EntityFilterSelect
      id="supplier-filter"
      label="Fornecedor"
      placeholder="Todos os fornecedores"
      value={value}
      onChange={onChange}
      source={fornecedorFilterSource}
    />
  );
}

/** R-08 — Ordens de Compra. */
export function PurchaseOrdersReportPage() {
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [from, setFrom] = useState(diaDoRelatorio(-89));
  const [to, setTo] = useState(diaDoRelatorio(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      supplierId,
      status,
      origin,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, supplierId, status, origin, from, to, page],
  );
  const { data, loading, error } = useReport(getPurchaseOrdersReport, filters);

  return (
    <ReportPage
      title="R-08 · Ordens de Compra"
      csvPath="/reports/purchasing/orders/export.csv"
      reportCode="R-08"
      csvFilters={filters}
      total={data?.total}
      subtitle="Ordens por data do pedido. O valor previsto só aparece quando todas as linhas têm preço."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="po-from">De</label>
          <input id="po-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="po-to">até</label>
          <input id="po-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <SupplierFilter
            value={supplierId}
            onChange={(value) => {
              setPage(1);
              setSupplierId(value);
            }}
          />
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Todos os status</option>
            {(Object.keys(PURCHASE_ORDER_STATUS_LABELS) as PurchaseOrderStatus[]).map((option) => (
              <option key={option} value={option}>
                {PURCHASE_ORDER_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <select
            aria-label="Origem"
            value={origin}
            onChange={(event) => {
              setPage(1);
              setOrigin(event.target.value);
            }}
          >
            <option value="">Todas as origens</option>
            <option value="MANUAL">Manual</option>
            <option value="CUSTOMER_ORDER">Pedido do cliente</option>
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por OC ou fornecedor…"
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
          "OC",
          "Fornecedor",
          "Origem",
          "Pedido",
          "Status",
          "Data",
          "Previsão",
          "Itens",
          "Valor previsto",
          "Recebimentos",
        ]}
        emptyMessage="Nenhuma ordem de compra no período selecionado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.purchaseOrderId}>
            <td>
              <DocLink code={row.code} to={`/compras/ordens/${row.purchaseOrderId}`} />
            </td>
            <td>{row.supplierName}</td>
            <td>{row.origin === "CUSTOMER_ORDER" ? "Pedido do cliente" : "Manual"}</td>
            <td>
              <DocLink
                code={row.customerOrderCode}
                to={row.customerOrderId ? `/comercial/pedidos/${row.customerOrderId}` : null}
              />
            </td>
            <td>{PURCHASE_ORDER_STATUS_LABELS[row.status]}</td>
            <td>{formatDate(row.orderDate)}</td>
            <td>{formatDate(row.expectedDeliveryDate)}</td>
            <td className="is-number">{row.itemCount}</td>
            {/* Sem preço em todas as linhas não existe total da OC. */}
            <td className="is-number">
              {row.expectedAmount
                ? formatBRL(row.expectedAmount)
                : `Preço incompleto (${row.linesWithPrice}/${row.itemCount})`}
            </td>
            <td className="is-number">{row.receiptCount}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-09 — Recebimentos. */
export function ReceiptsReportPage() {
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState(diaDoRelatorio(-29));
  const [to, setTo] = useState(diaDoRelatorio(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      supplierId,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, supplierId, from, to, page],
  );
  const { data, loading, error } = useReport(getReceiptsReport, filters);

  return (
    <ReportPage
      title="R-09 · Recebimentos"
      csvPath="/reports/purchasing/receipts/export.csv"
      reportCode="R-09"
      csvFilters={filters}
      total={data?.total}
      subtitle="Uma linha por item recebido. Preço da OC é expectativa; custo efetivo é a referência real."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="rec-from">De</label>
          <input id="rec-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="rec-to">até</label>
          <input id="rec-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <SupplierFilter
            value={supplierId}
            onChange={(value) => {
              setPage(1);
              setSupplierId(value);
            }}
          />
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por recebimento, item ou lote…"
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
          "Recebimento",
          "Data",
          "OC",
          "Fornecedor",
          "Item",
          "Lote interno",
          "Lote fornecedor",
          "Quantidade",
          "Preço OC",
          "Custo efetivo",
        ]}
        emptyMessage="Nenhum recebimento no período selecionado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.receiptLineId}>
            <td>
              <DocLink code={row.receiptCode} to={`/compras/recebimentos/${row.receiptId}`} />
            </td>
            <td>{formatDate(row.receivedAt)}</td>
            <td>
              <DocLink code={row.purchaseOrderCode} to={`/compras/ordens/${row.purchaseOrderId}`} />
            </td>
            <td>{row.supplierName}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td>
              <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
            </td>
            <td>{row.supplierLot ?? "—"}</td>
            <td className="is-number">
              {formatQuantity(row.receivedQuantity)} {row.unitCode}
            </td>
            <td className="is-number">{row.orderedUnitPrice ? formatUnitPriceBRL(row.orderedUnitPrice) : "—"}</td>
            <td className="is-number">
              {row.actualUnitCost ? formatBRL(row.actualUnitCost) : "Sem custo informado"}
            </td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-10 — Em Compra. */
export function OnOrderReportPage() {
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, supplierId, page, pageSize: PAGE_SIZE }),
    [search, supplierId, page],
  );
  const { data, loading, error } = useReport(getOnOrderReport, filters);

  return (
    <ReportPage
      title="R-10 · Em Compra"
      csvPath="/reports/purchasing/on-order/export.csv"
      reportCode="R-10"
      csvFilters={filters}
      total={data?.total}
      subtitle="Quantidade ainda em aberto em ordens confirmadas. Rascunhos não contam como compra em curso."
      loading={loading}
      error={error}
      filters={
        <>
          <SupplierFilter
            value={supplierId}
            onChange={(value) => {
              setPage(1);
              setSupplierId(value);
            }}
          />
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por OC ou fornecedor…"
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
        columns={["OC", "Fornecedor", "Item", "Pedido", "Recebido", "Em aberto", "Previsão", "Status", "Pedido cliente"]}
        emptyMessage="Nenhuma quantidade em compra no momento."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.purchaseOrderLineId}>
            <td>
              <DocLink code={row.purchaseOrderCode} to={`/compras/ordens/${row.purchaseOrderId}`} />
            </td>
            <td>{row.supplierName}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td className="is-number">
              {formatQuantity(row.orderedQuantity)} {row.unitCode}
            </td>
            <td className="is-number">{formatQuantity(row.receivedQuantity)}</td>
            <td className="is-number">{formatQuantity(row.openQuantity)}</td>
            <td>{formatDate(row.expectedDeliveryDate)}</td>
            <td>{PURCHASE_ORDER_STATUS_LABELS[row.status]}</td>
            <td>
              <DocLink
                code={row.customerOrderCode}
                to={row.customerOrderId ? `/comercial/pedidos/${row.customerOrderId}` : null}
              />
            </td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-11 — OCs atrasadas. */
export function LatePurchaseOrdersReportPage() {
  const [supplierId, setSupplierId] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(() => ({ supplierId, page, pageSize: PAGE_SIZE }), [supplierId, page]);
  const { data, loading, error } = useReport(getLatePurchaseOrdersReport, filters);

  return (
    <ReportPage
      title="R-11 · Ordens de Compra atrasadas"
      csvPath="/reports/purchasing/late/export.csv"
      reportCode="R-11"
      csvFilters={filters}
      total={data?.total}
      subtitle="Previsão de entrega vencida com quantidade ainda em aberto — mais atrasada primeiro."
      loading={loading}
      error={error}
      filters={
        <SupplierFilter
          value={supplierId}
          onChange={(value) => {
            setPage(1);
            setSupplierId(value);
          }}
        />
      }
    >
      <ReportTable
        columns={["OC", "Fornecedor", "Item", "Em aberto", "Previsão", "Atraso", "Status", "Pedido cliente"]}
        emptyMessage="Nenhuma OC atrasada."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.purchaseOrderLineId}>
            <td>
              <DocLink code={row.purchaseOrderCode} to={`/compras/ordens/${row.purchaseOrderId}`} />
            </td>
            <td>{row.supplierName}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td className="is-number">
              {formatQuantity(row.openQuantity)} {row.unitCode}
            </td>
            <td>{formatDate(row.expectedDeliveryDate)}</td>
            <td className="is-number">{row.daysLate} dias</td>
            <td>{PURCHASE_ORDER_STATUS_LABELS[row.status]}</td>
            <td>
              <DocLink
                code={row.customerOrderCode}
                to={row.customerOrderId ? `/comercial/pedidos/${row.customerOrderId}` : null}
              />
            </td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}
