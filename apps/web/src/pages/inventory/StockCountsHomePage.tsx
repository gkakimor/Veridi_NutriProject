import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { StockCountMode, StockCountStatus, StockCountSummaryDTO } from "@veridi/shared";
import {
  STOCK_COUNT_MODE_LABELS,
  STOCK_COUNT_MODES,
  STOCK_COUNT_OPEN_STATUSES,
  STOCK_COUNT_STATUS_LABELS,
  STOCK_COUNT_STATUSES,
  recusaDoPeriodo,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { ListStatusRow } from "../../components/ListStatusRow";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { DateRangeFilter } from "../../components/filters/DateRangeFilter";
import type { StatusGroup } from "../../components/filters/StatusGroupFilter";
import { StatusGroupFilter, labelOfGroup, statusesOfGroup } from "../../components/filters/StatusGroupFilter";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { formatDateTime } from "../../lib/dates";
import { useListFilters } from "../../lib/list-filters";
import type { ListPeriodPreset } from "../../lib/list-period";
import {
  LIST_PERIOD_PRESET_LABELS,
  ehListPeriodPreset,
  formatListPeriod,
  resolveListPeriod,
} from "../../lib/list-period";
import { useListQuery } from "../../lib/list-query";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import type { ListStockCountsParams } from "../../lib/stock-counts-api";
import { listStockCounts } from "../../lib/stock-counts-api";
import {
  divergenciasDoInventario,
  progressoDoInventario,
  rotaDaContagem,
  rotaDoInventario,
  statusBadgeClass,
} from "./stock-count-display";
import { usePodeOperarInventario } from "./stock-count-permissions";
import "./inventario-fisico.css";

const PAGE_SIZE = 20;

/** "Em aberto" — em contagem ou em revisão: o inventário que ainda pede trabalho. */
const GRUPOS: StatusGroup<StockCountStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: [...STOCK_COUNT_OPEN_STATUSES] },
  { key: "todos", label: "Todas as situações", statuses: [] },
  ...STOCK_COUNT_STATUSES.map((status) => ({
    key: status,
    label: STOCK_COUNT_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const ABAS = [
  { key: "inventarios", label: "Inventários" },
  { key: "rapidas", label: "Contagens rápidas" },
] as const;

type Aba = (typeof ABAS)[number]["key"];

const FILTROS_PADRAO = {
  aba: "inventarios",
  search: "",
  status: "em-aberto",
  mode: "",
  period: "todos",
  dateFrom: "",
  dateTo: "",
};

const PRESETS: ListPeriodPreset[] = ["todos", "mes-atual", "7d", "30d", "custom"];

function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

function modoValido(valor: string): StockCountMode | "" {
  return (STOCK_COUNT_MODES as readonly string[]).includes(valor) ? (valor as StockCountMode) : "";
}

/**
 * Estoque → Inventário Físico — a lista dos inventários (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * Abre em "Em aberto": em contagem e em revisão, o que ainda pede trabalho.
 * Iniciar inventário e Contagem rápida são ações daqui, e só aparecem para
 * quem opera estoque; consultar a lista e abrir um inventário é de todos.
 * A Contagem rápida não ganhou item de menu (DU-2): ela mora nesta tela.
 */
export function StockCountsHomePage() {
  const navigate = useNavigate();
  const sessao = useOptionalAuth();
  const podeOperar = usePodeOperarInventario();

  const { values, page, set, setPage, clear } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "stock-counts",
    userId: sessao?.user?.id ?? null,
  });
  const aba: Aba = values.aba === "rapidas" ? "rapidas" : "inventarios";
  const grupo = grupoValido(values.status);
  const modo = modoValido(values.mode);
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "todos";
  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );
  const periodoRecusado = recusaDoPeriodo(periodo.dateFrom, periodo.dateTo);

  const [searchInput, setSearchInput] = useState(values.search);
  useEffect(() => {
    setSearchInput(values.search);
  }, [values.search]);
  useEffect(() => {
    if (searchInput === values.search) return;
    const handle = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(handle);
  }, [searchInput, values.search, set]);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListStockCountsParams, "page" | "pageSize"> = {
      kind: aba === "rapidas" ? "QUICK" : "SESSION",
    };
    if (values.search) filtros.search = values.search;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    // A contagem rápida nasce encerrada e com saldo: situação e modo não recortam nada nela.
    if (aba === "inventarios") {
      const statuses = statusesOfGroup(GRUPOS, grupo);
      if (statuses.length > 0) filtros.status = statuses;
      if (modo) filtros.mode = modo;
    }
    return filtros;
  }, [aba, values.search, periodo.dateFrom, periodo.dateTo, grupo, modo]);

  const consulta = useListQuery(
    listStockCounts,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { enabled: periodoRecusado === null, fallbackError: "Falha ao carregar os inventários" },
  );
  const linhas: StockCountSummaryDTO[] = consulta.data?.stockCounts ?? [];
  const total = consulta.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const chips: FilterChip[] = [];
  if (values.search) chips.push({ label: "Busca", value: values.search, onRemove: () => set({ search: "" }) });
  if (aba === "inventarios" && grupo !== FILTROS_PADRAO.status) {
    chips.push({
      label: "Situação",
      value: labelOfGroup(GRUPOS, grupo),
      onRemove: () => set({ status: FILTROS_PADRAO.status }),
    });
  }
  if (aba === "inventarios" && modo) {
    chips.push({ label: "Modo", value: STOCK_COUNT_MODE_LABELS[modo], onRemove: () => set({ mode: "" }) });
  }
  if (period !== FILTROS_PADRAO.period) {
    chips.push({
      label: "Período",
      value: period === "custom" ? formatListPeriod(periodo) : LIST_PERIOD_PRESET_LABELS[period],
      onRemove: () => set({ period: FILTROS_PADRAO.period, dateFrom: "", dateTo: "" }),
    });
  }

  const recorteAlemDaSituacao = Boolean(values.search || modo || period !== FILTROS_PADRAO.period);
  let vazio: ReactNode;
  if (aba === "rapidas") {
    vazio = recorteAlemDaSituacao ? (
      <>
        Nenhuma contagem rápida para os filtros atuais. <ClearFilters onClear={clear} />
      </>
    ) : (
      "Nenhuma contagem rápida registrada."
    );
  } else if (recorteAlemDaSituacao) {
    vazio = (
      <>
        Nenhum inventário encontrado para os filtros atuais. <ClearFilters onClear={clear} />
      </>
    );
  } else if (grupo === "em-aberto") {
    vazio = (
      <>
        Nenhum inventário em aberto.{" "}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ status: "todos" })}>
          Ver todos
        </button>
      </>
    );
  } else {
    vazio = "Nenhum inventário com esta situação.";
  }

  const colunas = aba === "rapidas" ? 5 : 9;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Inventário Físico</h1>
          <p className="page__subtitle">
            Contagem em lote, revisão e ajuste rastreável — o saldo nunca é digitado por cima.
          </p>
        </div>
        <div className="table__actions inv-acoes">
          <button type="button" className="btn btn--secondary" onClick={() => navigate("/print/contagem-fisica")}>
            Folha de contagem (FO-01)
          </button>
          {podeOperar && (
            <>
              <Link className="btn btn--secondary" to="/estoque/inventario/contagem-rapida">
                Contagem rápida
              </Link>
              <Link className="btn btn--accent" to="/estoque/inventario/novo">
                + Novo inventário
              </Link>
            </>
          )}
        </div>
      </div>

      <ContextHelp topic={helpTopics["estoque.inventarioFisico"]} />

      <div className="inv-abas" role="tablist" aria-label="Documentos de inventário">
        {ABAS.map((opcao) => (
          <button
            key={opcao.key}
            type="button"
            role="tab"
            className="inv-abas__aba"
            aria-selected={aba === opcao.key}
            onClick={() => set({ aba: opcao.key })}
          >
            {opcao.label}
          </button>
        ))}
      </div>

      <DateRangeFilter
        idPrefix="stock-counts"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        presets={PRESETS}
        fromLabel="Início a partir de"
        toLabel="Início até"
        onChange={(next) => set(next)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="stock-counts-search">
            Buscar inventários
          </label>
          <input
            id="stock-counts-search"
            type="search"
            placeholder={aba === "rapidas" ? "Buscar por código INV-…" : "Buscar por código INV- ou descrição…"}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        {aba === "inventarios" && (
          <>
            <StatusGroupFilter
              id="stock-counts-status-filter"
              label="Filtrar por situação"
              groups={GRUPOS}
              value={grupo}
              onChange={(key) => set({ status: key })}
            />
            <label className="sr-only" htmlFor="stock-counts-mode-filter">
              Filtrar por modo
            </label>
            <select id="stock-counts-mode-filter" value={modo} onChange={(event) => set({ mode: event.target.value })}>
              <option value="">Todos os modos</option>
              {STOCK_COUNT_MODES.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {STOCK_COUNT_MODE_LABELS[opcao]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {consulta.error && (
        <p className="form-alert" role="alert">
          {consulta.error}{" "}
          <button type="button" className="btn btn--secondary btn--sm" onClick={consulta.reload}>
            Tentar novamente
          </button>
        </p>
      )}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            {aba === "rapidas" ? (
              <tr>
                <th className="col-tight">Código</th>
                <th className="col-tight">Registrada em</th>
                <th className="col-flex">Registrada por</th>
                <th className="col-label">Situação</th>
                <th aria-label="Ações" />
              </tr>
            ) : (
              <tr>
                <th className="col-tight">Código</th>
                <th className="col-flex">Descrição</th>
                <th className="col-label">Modo</th>
                <th className="col-label">Situação</th>
                <th className="is-numeric col-tight">Progresso</th>
                <th className="is-numeric col-tight">Divergências</th>
                <th className="col-tight">Início</th>
                <th className="col-flex">Criado por</th>
                <th aria-label="Ações" />
              </tr>
            )}
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const abrir = () => navigate(rotaDoInventario(linha.id));
              const contar = podeOperar && linha.status === "IN_PROGRESS" && aba === "inventarios";
              return (
                <tr
                  key={linha.id}
                  tabIndex={0}
                  onClick={abrir}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.target === event.currentTarget) abrir();
                  }}
                >
                  <td className="is-code col-tight">{linha.code}</td>
                  {aba === "rapidas" ? (
                    <>
                      <td className="col-tight">{formatDateTime(linha.createdAt)}</td>
                      <td className="col-flex">{linha.createdByName}</td>
                    </>
                  ) : (
                    <>
                      <td className="col-flex">{linha.description ?? <span className="muted">—</span>}</td>
                      <td className="col-label">{STOCK_COUNT_MODE_LABELS[linha.mode]}</td>
                    </>
                  )}
                  <td className="col-label">
                    <span className={statusBadgeClass(linha.status)}>{STOCK_COUNT_STATUS_LABELS[linha.status]}</span>
                  </td>
                  {aba === "inventarios" && (
                    <>
                      <td className="is-numeric col-tight">{progressoDoInventario(linha)}</td>
                      <td className="is-numeric col-tight">{divergenciasDoInventario(linha)}</td>
                      <td className="col-tight">{formatDateTime(linha.createdAt)}</td>
                      <td className="col-flex">{linha.createdByName}</td>
                    </>
                  )}
                  <td>
                    <div className="table__actions">
                      {contar ? (
                        <Link
                          className="btn btn--accent btn--sm"
                          to={rotaDaContagem(linha.id)}
                          aria-label={`Contar ${linha.code}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Contar
                        </Link>
                      ) : (
                        <Link
                          className="btn btn--ghost btn--sm"
                          to={rotaDoInventario(linha.id)}
                          aria-label={`Abrir ${linha.code}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Abrir
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            <ListStatusRow
              colSpan={colunas}
              query={consulta}
              rowCount={linhas.length}
              periodRefused={periodoRecusado !== null}
            >
              {vazio}
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)}{" "}
            {aba === "rapidas"
              ? total === 1
                ? "contagem rápida"
                : "contagens rápidas"
              : total === 1
                ? "inventário"
                : "inventários"}
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
    </>
  );
}
