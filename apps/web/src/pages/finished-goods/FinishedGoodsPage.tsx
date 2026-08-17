import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { FinishedGoodRowDTO, LotStatus, ProductDTO } from "@veridi/shared";
import { COST_QUALITY_LABELS, COST_SOURCE_LABELS, LOT_STATUSES, LOT_STATUS_LABELS } from "@veridi/shared";
import { listFinishedGoods } from "../../lib/finished-goods-api";
import { listProducts } from "../../lib/products-api";
import { formatBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";

type StatusFilter = LotStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: LotStatus, isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    case "BLOCKED":
    case "EXPIRED":
      return "badge badge--err";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/**
 * Custo de material por unidade. O serviço de custo já devolve `null` quando
 * a qualidade é `PARTIAL`/`NO_COST` — nesses casos o número não existe e não
 * pode ser exibido como se fosse custo fechado.
 */
function CostCell({ row }: { row: FinishedGoodRowDTO }) {
  if (row.materialUnitCost === null) {
    return (
      <span className="muted">
        {row.costQuality === "PARTIAL" ? "Parcial" : "Sem custo"}
      </span>
    );
  }
  return (
    <>
      {formatBRL(row.materialUnitCost)}
      <div className="muted is-small">
        {row.costSource ? COST_SOURCE_LABELS[row.costSource] : COST_QUALITY_LABELS[row.costQuality]}
      </div>
    </>
  );
}

/**
 * Produção → Produto Acabado. Visão operacional somente leitura do que já
 * foi produzido: uma linha por lote com `origin = PRODUCTION`. Não cria nada
 * (produto acabado nasce só de Ordem de Produção com apontamento) e não
 * mantém saldo próprio — On Hand/Reserved/Available vêm do Inventory Ledger.
 * Ações de Qualidade continuam na tela do Lote.
 */
export function FinishedGoodsPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<FinishedGoodRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, productFilter, dateFrom, dateTo]);

  useEffect(() => {
    listProducts({ active: true, pageSize: 1000 })
      .then((result) => setProducts(result.products))
      .catch(() => setProducts([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listFinishedGoods>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;
    if (productFilter !== "all") params.productId = productFilter;
    if (dateFrom) params.dateFrom = new Date(`${dateFrom}T00:00:00`).toISOString();
    if (dateTo) params.dateTo = new Date(`${dateTo}T23:59:59.999`).toISOString();

    listFinishedGoods(params)
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos acabados");
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, productFilter, dateFrom, dateTo]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    search !== "" || statusFilter !== "all" || productFilter !== "all" || dateFrom !== "" || dateTo !== "";

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Produto Acabado</h1>
          <p className="page__subtitle">
            Lotes produzidos nas Ordens de Produção. Consulta operacional — saldo, qualidade e custo
            vêm das fontes originais.
          </p>
        </div>
        <ExportCsvButton path="/finished-goods/export.csv" filters={{
            search,
            status: statusFilter === "all" ? undefined : statusFilter,
            productId: productFilter === "all" ? undefined : productFilter,
          }} />
</div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="fg-search">
            Buscar produto acabado
          </label>
          <input
            id="fg-search"
            type="search"
            placeholder="Buscar por lote Veridi, lote interno, item, produto ou OP…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="fg-status-filter">
          Filtrar por qualidade
        </label>
        <select
          id="fg-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          <option value="all">Toda qualidade</option>
          {LOT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LOT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="fg-product-filter">
          Filtrar por produto
        </label>
        <select
          id="fg-product-filter"
          value={productFilter}
          onChange={(event) => setProductFilter(event.target.value)}
        >
          <option value="all">Todos os produtos</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>

        <label htmlFor="fg-date-from">Produzido de</label>
        <input
          id="fg-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <label htmlFor="fg-date-to">até</label>
        <input
          id="fg-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Item PA</th>
              <th>Lote Veridi</th>
              <th>Lote Interno</th>
              <th>OP</th>
              <th>Data produção</th>
              <th>Produzido</th>
              <th>Físico</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Qualidade</th>
              <th>Validade</th>
              <th>Custo Material Un.</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.lotId}>
                <td>{row.productName ?? "—"}</td>
                <td>
                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                </td>
                <td>{row.businessLotNumber ?? "—"}</td>
                <td className="is-code">{row.lotCode}</td>
                <td className="is-code">{row.productionOrderCode ?? "—"}</td>
                <td>{formatDate(row.producedAt)}</td>
                {/* Cada linha carrega a própria unidade: nunca se soma unidades diferentes. */}
                <td>
                  {row.producedQuantity} {row.unitCode}
                </td>
                <td>
                  {row.onHand} {row.unitCode}
                </td>
                <td>
                  {row.reserved} {row.unitCode}
                </td>
                <td>
                  {row.available} {row.unitCode}
                </td>
                <td>
                  <span className={statusBadgeClass(row.status, row.isExpired)}>
                    {row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td>{formatDate(row.expiryDate)}</td>
                <td>
                  <CostCell row={row} />
                </td>
                <td>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${row.lotId}`)}
                    >
                      Abrir lote
                    </button>
                    {/* Reaproveita a rota de impressão de etiqueta já existente —
                        o QR do lote produzido é o mesmo `LOT:<code>` de sempre. */}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${row.lotId}/etiqueta`)}
                    >
                      Etiqueta / QR
                    </button>
                    {row.productionOrderId && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/producao/ordens/${row.productionOrderId}`)}
                      >
                        Abrir OP
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={14} className="table__empty">
                  {hasFilters
                    ? "Nenhum produto acabado encontrado com esses filtros."
                    : "Nenhum produto acabado produzido ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "lote produzido" : "lotes produzidos"}
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
    </>
  );
}
