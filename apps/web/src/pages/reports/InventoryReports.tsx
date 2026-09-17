import { formatQuantity } from "../../lib/quantity";
import { useMemo, useState } from "react";
import type { LotStatus } from "@veridi/shared";
import {
  INVENTORY_MOVEMENT_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
  recusaDoPeriodo,
} from "@veridi/shared";
import type { InventoryMovementType, ItemType } from "@veridi/shared";
import {
  getExpiryReport,
  getInventoryPositionReport,
  getMovementsReport,
} from "../../lib/reports-api";
import { DocLink, ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import { useFiltrosDigitados } from "./useFiltrosDigitados";
import { ariaDoPeriodoRecusado, diaDoRelatorio, JANELAS_DE_VENCIMENTO } from "./report-period";
import { emDias } from "../../lib/duration";
import { EntityLink } from "../../components/EntityLink";
import { formatDate, formatDateTime } from "../../lib/dates";

const PAGE_SIZE = 25;


function lotStatusLabel(status: LotStatus | null, isExpired: boolean): string {
  if (isExpired) return "Vencido";
  return status ? LOT_STATUS_LABELS[status] : "—";
}

/** R-01 — Posição de Estoque. */
export function InventoryPositionReportPage() {
  const [itemType, setItemType] = useState("");
  const [status, setStatus] = useState("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "" }, setPage);
  const { search } = digitados.aplicados;

  const filters = useMemo(
    () => ({ search, itemType, status, onlyWithBalance, page, pageSize: PAGE_SIZE }),
    [search, itemType, status, onlyWithBalance, page],
  );
  const { data, loading, error } = useReport(getInventoryPositionReport, filters);

  return (
    <ReportPage
      title="R-01 · Posição de Estoque"
      csvPath="/reports/inventory/position/export.csv"
      reportCode="R-01"
      csvFilters={filters}
      total={data?.total}
      subtitle="Saldo atual por item e lote, sempre calculado a partir das movimentações."
      loading={loading}
      error={error}
      filtersPending={digitados.pendente}
      filters={
        <>
          <div className="toolbar__search">
            <input type="search" placeholder="Buscar por código ou nome do item…" {...digitados.campo("search")} />
          </div>
          <select
            aria-label="Tipo de item"
            value={itemType}
            onChange={(event) => {
              setPage(1);
              setItemType(event.target.value);
            }}
          >
            <option value="">Todos os tipos</option>
            {(Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((type) => (
              <option key={type} value={type}>
                {ITEM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            aria-label="Qualidade do lote"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Toda qualidade</option>
            {(Object.keys(LOT_STATUS_LABELS) as LotStatus[]).map((option) => (
              <option key={option} value={option}>
                {LOT_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <label className="field--checkbox">
            <input
              type="checkbox"
              checked={onlyWithBalance}
              onChange={(event) => {
                setPage(1);
                setOnlyWithBalance(event.target.checked);
              }}
            />
            Somente com saldo
          </label>
        </>
      }
    >
      <ReportTable
        columns={[
          "Item",
          "Tipo",
          "Lote",
          "Lote fornecedor / Veridi",
          "Fornecedor",
          "Validade",
          "Localização",
          "Físico",
          "Reservado",
          "Disponível",
          "Qualidade",
        ]}
        emptyMessage="Nenhum lote com saldo encontrado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td>{ITEM_TYPE_LABELS[row.itemType]}</td>
            <td>
              <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
            </td>
            <td>{row.businessLotNumber ?? row.supplierLot ?? "—"}</td>
            <td>{row.supplierName ?? "—"}</td>
            <td>{formatDate(row.expiryDate)}</td>
            <td>{row.location ?? "—"}</td>
            {/* Cada linha com a própria unidade — nunca somadas entre si. */}
            <td className="is-number">
              {formatQuantity(row.onHand)} {row.unitCode}
            </td>
            <td className="is-number">{formatQuantity(row.reserved)}</td>
            <td className="is-number">{formatQuantity(row.available)}</td>
            <td>{lotStatusLabel(row.status, row.isExpired)}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-02 — Vencimentos. */
export function ExpiryReportPage() {
  const [window, setWindow] = useState("D30");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "", from: diaDoRelatorio(0), to: diaDoRelatorio(60) }, setPage);
  const { search, from, to } = digitados.aplicados;

  const filters = useMemo(
    () => ({
      window,
      search,
      page,
      pageSize: PAGE_SIZE,
      ...(window === "CUSTOM" ? { from, to } : {}),
    }),
    [window, search, from, to, page],
  );
  // As datas só são filtro na janela personalizada (PERIOD-RANGE-VALIDATION-WAVE-01).
  const periodoRecusado = window === "CUSTOM" ? recusaDoPeriodo(from, to) : null;
  const { data, loading, error } = useReport(getExpiryReport, filters, { enabled: periodoRecusado === null });

  return (
    <ReportPage
      title="R-02 · Vencimentos"
      csvPath="/reports/inventory/expiry/export.csv"
      reportCode="R-02"
      csvFilters={filters}
      total={data?.total}
      subtitle="Lotes vencidos e vencendo, considerando a validade efetiva e o saldo atual."
      loading={loading}
      error={error}
      periodRefusal={periodoRecusado}
      filtersPending={digitados.pendente}
      filters={
        <>
          <select
            aria-label="Janela de vencimento"
            value={window}
            onChange={(event) => {
              setPage(1);
              setWindow(event.target.value);
            }}
          >
            {Object.entries(JANELAS_DE_VENCIMENTO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          {window === "CUSTOM" && (
            <>
              <label htmlFor="expiry-from">De</label>
              <input
                id="expiry-from"
                type="date"
                {...digitados.campo("from")}
                {...ariaDoPeriodoRecusado(periodoRecusado)}
              />
              <label htmlFor="expiry-to">até</label>
              <input
                id="expiry-to"
                type="date"
                {...digitados.campo("to")}
                {...ariaDoPeriodoRecusado(periodoRecusado)}
              />
            </>
          )}
          <div className="toolbar__search">
            <input type="search" placeholder="Buscar por item ou lote…" {...digitados.campo("search")} />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Item",
          "Lote",
          "Origem",
          "Validade",
          "Situação",
          "Físico",
          "Reservado",
          "Disponível",
          "Qualidade",
          "Localização",
        ]}
        emptyMessage="Nenhum lote nesta janela de vencimento."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.lotId}>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td>
              <DocLink code={row.lotCode} to={`/estoque/lotes/${row.lotId}`} />
            </td>
            <td>{row.lotOrigin === "PRODUCTION" ? "Produção" : "Recebimento"}</td>
            <td>{formatDate(row.expiryDate)}</td>
            <td>
              {/* `daysToExpiry` vem da API em dias civis: `0` é hoje, e o
                  lote que vence hoje ainda vale o dia inteiro. */}
              {row.daysToExpiry < 0
                ? `Vencido há ${emDias(Math.abs(row.daysToExpiry))}`
                : row.daysToExpiry === 0
                  ? "Vence hoje"
                  : `Vence em ${emDias(row.daysToExpiry)}`}
            </td>
            <td className="is-number">
              {formatQuantity(row.onHand)} {row.unitCode}
            </td>
            <td className="is-number">{formatQuantity(row.reserved)}</td>
            <td className="is-number">{formatQuantity(row.available)}</td>
            <td>{lotStatusLabel(row.status, row.isExpired)}</td>
            <td>{row.location ?? "—"}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

const MOVEMENT_DOCUMENT_PATHS: Record<string, string> = {
  RECEIPT: "/compras/recebimentos",
  PRODUCTION_ORDER: "/producao/ordens",
  SHIPMENT: "/comercial/expedicoes",
  PROJECT_SAMPLE: "/comercial/amostras",
  STOCK_COUNT: "/estoque/inventario",
};

/** R-03 — Movimentações. */
export function MovementsReportPage() {
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "", from: diaDoRelatorio(-29), to: diaDoRelatorio(0) }, setPage);
  const { search, from, to } = digitados.aplicados;

  const filters = useMemo(
    () => ({
      search,
      type,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, type, from, to, page],
  );
  const periodoRecusado = recusaDoPeriodo(from, to);
  const { data, loading, error } = useReport(getMovementsReport, filters, { enabled: periodoRecusado === null });

  return (
    <ReportPage
      title="R-03 · Movimentações"
      csvPath="/reports/inventory/movements/export.csv"
      reportCode="R-03"
      csvFilters={filters}
      total={data?.total}
      subtitle="Toda entrada e saída de estoque no período, com o documento que a originou."
      loading={loading}
      error={error}
      periodRefusal={periodoRecusado}
      filtersPending={digitados.pendente}
      filters={
        <>
          <label htmlFor="mov-from">De</label>
          <input id="mov-from" type="date" {...digitados.campo("from")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <label htmlFor="mov-to">até</label>
          <input id="mov-to" type="date" {...digitados.campo("to")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <select
            aria-label="Tipo de movimento"
            value={type}
            onChange={(event) => {
              setPage(1);
              setType(event.target.value);
            }}
          >
            <option value="">Todos os tipos</option>
            {(Object.keys(INVENTORY_MOVEMENT_TYPE_LABELS) as InventoryMovementType[]).map((option) => (
              <option key={option} value={option}>
                {INVENTORY_MOVEMENT_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
          <div className="toolbar__search">
            <input type="search" placeholder="Buscar por item ou lote…" {...digitados.campo("search")} />
          </div>
        </>
      }
    >
      <ReportTable
        columns={["Data/Hora", "Tipo", "Item", "Lote", "Quantidade", "Documento", "Motivo", "Usuário"]}
        emptyMessage="Nenhuma movimentação no período selecionado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.id}>
            <td>{formatDateTime(row.occurredAt)}</td>
            <td>{INVENTORY_MOVEMENT_TYPE_LABELS[row.type]}</td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td>
              <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
            </td>
            <td className="is-number">
              {formatQuantity(row.quantity)} {row.unitCode}
            </td>
            <td>
              <DocLink
                code={row.documentCode}
                to={
                  row.documentKind && row.documentId
                    ? `${MOVEMENT_DOCUMENT_PATHS[row.documentKind]}/${row.documentId}`
                    : null
                }
              />
            </td>
            <td>{row.reason ?? "—"}</td>
            <td>{row.createdBy ?? "—"}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}
