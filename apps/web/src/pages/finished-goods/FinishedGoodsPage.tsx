import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import type { FinishedGoodRowDTO, LotStatus } from "@veridi/shared";
import { COST_QUALITY_LABELS, COST_SOURCE_LABELS, LOT_STATUSES, LOT_STATUS_LABELS } from "@veridi/shared";
import type { ListFinishedGoodsParams } from "../../lib/finished-goods-api";
import { listFinishedGoods } from "../../lib/finished-goods-api";
import { formatBRL } from "../../lib/currency";
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
import { produtoFilterSource } from "../../lib/filter-sources";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/**
 * ⓘ de uma coluna, lido do registro central.
 *
 * A tabela põe lado a lado quatro quantidades do mesmo lote — produzido,
 * físico, reservado e disponível — que quase nunca são iguais. Sem a
 * explicação na própria coluna, "produzido" é lido como saldo.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type StatusFilter = LotStatus | "all";

const PAGE_SIZE = 20;

/**
 * Os filtros desta lista e o que cada um significa quando está limpo.
 *
 * `period: "todos"` PRESERVA o comportamento atual: a tela nunca teve recorte
 * de período, e impor "Mês atual" só porque o Faturamento usa esconderia
 * lotes de uma consulta que hoje mostra tudo. Mudar isso é decisão de
 * Product Ownership.
 */
const FILTROS_PADRAO = {
  search: "",
  status: "all",
  productId: "",
  period: "todos",
  dateFrom: "",
  dateTo: "",
  /* Contexto por link: "ver o que esta OP produziu". */
  productionOrderId: "",
};

const PRESETS_DO_PRODUTO_ACABADO: ListPeriodPreset[] = [
  "todos",
  "hoje",
  "7d",
  "30d",
  "mes-atual",
  "custom",
];

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
 * Estoque → Lotes de Produto Acabado. Visão operacional somente leitura do que já
 * foi produzido: uma linha por lote com `origin = PRODUCTION`. Não cria nada
 * (produto acabado nasce só de Ordem de Produção com apontamento) e não
 * mantém saldo próprio — On Hand/Reserved/Available vêm do Inventory Ledger.
 * Ações de Qualidade continuam na tela do Lote.
 */
export function FinishedGoodsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rows, setRows] = useState<FinishedGoodRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "finished-goods",
    userId: user?.id ?? null,
  });
  const { search, productId, productionOrderId } = values;
  const statusFilter = values.status as StatusFilter;
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "todos";

  /*
   * Período em DIAS comerciais.
   *
   * A tela montava o instante com os componentes LOCAIS do navegador — meia
   * -noite local na ponta de baixo e um 23:59:59.999 inventado na de cima.
   * O mesmo filtro "produzido em 10/09" devolvia conjuntos diferentes em São
   * Paulo, em Vancouver e em Tóquio, e nada dizia isso. Agora viaja o DIA, e
   * quem o abre nos dois instantes é o servidor, com fim exclusivo.
   */
  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );

  /*
   * UM conjunto de filtros para a consulta e para o CSV.
   *
   * O CSV levava só busca, qualidade e produto: a tela mostrava um período e
   * o arquivo exportava a produção inteira, sem nada avisando.
   */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListFinishedGoodsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (statusFilter !== "all") filtros.status = statusFilter;
    if (productId) filtros.productId = productId;
    if (productionOrderId) filtros.productionOrderId = productionOrderId;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    return filtros;
  }, [search, statusFilter, productId, productionOrderId, periodo.dateFrom, periodo.dateTo]);

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

    listFinishedGoods({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos acabados");
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
  if (statusFilter !== "all") {
    chips.push({
      label: "Qualidade",
      value: LOT_STATUS_LABELS[statusFilter],
      onRemove: () => set({ status: "all" }),
    });
  }
  if (productId) {
    chips.push({
      label: "Produto",
      value: rows.find((row) => row.productId === productId)?.productName ?? "selecionado",
      onRemove: () => set({ productId: "" }),
    });
  }
  if (productionOrderId) {
    chips.push({
      label: "OP",
      value: rows[0]?.productionOrderCode ?? "da origem",
      onRemove: () => set({ productionOrderId: "" }),
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
          <h1 className="page__title">Lotes de Produto Acabado</h1>
          <p className="page__subtitle">
            Lotes produzidos nas Ordens de Produção. Consulta operacional — saldo, qualidade e custo
            vêm das fontes originais.
          </p>
        </div>
        <ExportCsvButton path="/finished-goods/export.csv" filters={filtrosDaConsulta} />
</div>

      <ContextHelp topic={helpTopics["producao.produtoAcabado"]} />

      <DateRangeFilter
        idPrefix="fg"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        presets={PRESETS_DO_PRODUTO_ACABADO}
        fromLabel="Produzido a partir de"
        toLabel="Produzido até"
        onChange={(next) => set(next)}
      />

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
          onChange={(event) => set({ status: event.target.value })}
        >
          <option value="all">Toda qualidade</option>
          {LOT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LOT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        {/* Era um `<select>` alimentado por `listProducts({ pageSize: 1000 })`:
            catálogo com teto fixo apresentado como completo. Do produto 1001
            em diante ele existia no sistema e não existia no filtro. Agora a
            busca é do servidor. */}
        <EntityFilterSelect
          id="fg-product-filter"
          label="Filtrar por produto"
          placeholder="Todos os produtos"
          value={productId}
          onChange={(value) => set({ productId: value })}
          source={produtoFilterSource}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Item PA</th>
              <th>
                Lote Veridi
                <DicaDaColuna id="producao.pa.loteVeridi" />
              </th>
              <th>
                Lote Interno
                <DicaDaColuna id="producao.pa.loteInterno" />
              </th>
              <th>OP</th>
              <th>Data produção</th>
              {/* Quatro quantidades do mesmo lote que não querem dizer a
                  mesma coisa — é aqui que a leitura costuma errar. */}
              <th className="is-numeric">
                Produzido
                <DicaDaColuna id="producao.pa.produzido" />
              </th>
              <th className="is-numeric">
                Físico
                <DicaDaColuna id="producao.pa.fisico" />
              </th>
              <th>
                Reservado
                <DicaDaColuna id="producao.pa.reservado" />
              </th>
              <th>
                Disponível
                <DicaDaColuna id="producao.pa.disponivel" />
              </th>
              <th>
                Qualidade
                <DicaDaColuna id="producao.pa.qualidade" />
              </th>
              <th>Validade</th>
              <th className="is-numeric">
                Custo Material Un.
                <DicaDaColuna id="producao.pa.custoMaterial" />
              </th>
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
                <td className="is-numeric">
                  {formatQuantity(row.producedQuantity)} {row.unitCode}
                </td>
                <td className="is-numeric">
                  {formatQuantity(row.onHand)} {row.unitCode}
                </td>
                <td>
                  {formatQuantity(row.reserved)} {row.unitCode}
                </td>
                <td>
                  {formatQuantity(row.available)} {row.unitCode}
                </td>
                <td>
                  <span className={statusBadgeClass(row.status, row.isExpired)}>
                    {row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td>{formatDate(row.expiryDate)}</td>
                <td className="is-numeric">
                  <CostCell row={row} />
                </td>
                <td>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/estoque/lotes/${row.lotId}`}
                    >
                      Abrir lote
                    </Link>
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
                      <Link
                        className="btn btn--ghost btn--sm"
                        to={`/producao/ordens/${row.productionOrderId}`}
                      >
                        Abrir OP
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={14} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhum produto acabado encontrado com esses filtros.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    "Nenhum produto acabado produzido ainda."
                  )}
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
