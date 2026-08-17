import { useMemo, useState } from "react";
import type { LotStatus } from "@veridi/shared";
import {
  INVENTORY_MOVEMENT_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
} from "@veridi/shared";
import type { InventoryMovementType, ItemType } from "@veridi/shared";
import {
  getExpiryReport,
  getInventoryPositionReport,
  getMovementsReport,
} from "../../lib/reports-api";
import { DocLink, ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import { dateInputValueOffset } from "../../lib/period";
import { EntityLink } from "../../components/EntityLink";

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

function lotStatusLabel(status: LotStatus | null, isExpired: boolean): string {
  if (isExpired) return "Vencido";
  return status ? LOT_STATUS_LABELS[status] : "—";
}

/** R-01 — Posição de Estoque. */
export function InventoryPositionReportPage() {
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [status, setStatus] = useState("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  const [page, setPage] = useState(1);

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
      filters={
        <>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por código ou nome do item…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
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
              {row.onHand} {row.unitCode}
            </td>
            <td className="is-number">{row.reserved}</td>
            <td className="is-number">{row.available}</td>
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
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(dateInputValueOffset(0));
  const [to, setTo] = useState(dateInputValueOffset(60));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      window,
      search,
      page,
      pageSize: PAGE_SIZE,
      ...(window === "CUSTOM"
        ? {
            from: new Date(`${from}T00:00:00`).toISOString(),
            to: new Date(`${to}T23:59:59.999`).toISOString(),
          }
        : {}),
    }),
    [window, search, from, to, page],
  );
  const { data, loading, error } = useReport(getExpiryReport, filters);

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
            <option value="EXPIRED">Vencidos</option>
            <option value="D7">Próximos 7 dias</option>
            <option value="D30">Próximos 30 dias</option>
            <option value="D60">Próximos 60 dias</option>
            <option value="CUSTOM">Período personalizado</option>
          </select>
          {window === "CUSTOM" && (
            <>
              <label htmlFor="expiry-from">De</label>
              <input
                id="expiry-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <label htmlFor="expiry-to">até</label>
              <input id="expiry-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </>
          )}
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por item ou lote…"
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
              {row.daysToExpiry < 0
                ? `Vencido há ${Math.abs(row.daysToExpiry)} dias`
                : `Vence em ${row.daysToExpiry} dias`}
            </td>
            <td className="is-number">
              {row.onHand} {row.unitCode}
            </td>
            <td className="is-number">{row.reserved}</td>
            <td className="is-number">{row.available}</td>
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
};

/** R-03 — Movimentações. */
export function MovementsReportPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState(dateInputValueOffset(-29));
  const [to, setTo] = useState(dateInputValueOffset(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      type,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, type, from, to, page],
  );
  const { data, loading, error } = useReport(getMovementsReport, filters);

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
      filters={
        <>
          <label htmlFor="mov-from">De</label>
          <input id="mov-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="mov-to">até</label>
          <input id="mov-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
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
            <input
              type="search"
              placeholder="Buscar por item ou lote…"
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
              {row.quantity} {row.unitCode}
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
