import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { QuoteStatus, QuoteVersionListItemDTO } from "@veridi/shared";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS, recusaDoPeriodo } from "@veridi/shared";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink } from "../../components/EntityLink";
import { ListStatusRow } from "../../components/ListStatusRow";
import type { EntityOption } from "../../components/SearchableEntitySelect";
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
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { formatBRL } from "../../lib/currency";
import { clienteFilterSource, projetoFilterSource } from "../../lib/filter-sources";
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
import type { ListQuoteVersionsParams } from "../../lib/projects-api";
import { listQuoteVersions } from "../../lib/projects-api";
import { rotaDoOrcamento } from "../../lib/rota-do-orcamento";
import { formatQuoteDate, quoteBadgeClass } from "../projects/quote-display";

const PAGE_SIZE = 20;

/**
 * "Em aberto" — a versão que ainda pede ação comercial.
 *
 * Dois status do domínio, nenhum inventado: o rascunho ainda precisa ser
 * montado e enviado, e o enviado espera o desfecho — aceite, recusa ou uma
 * versão nova, inclusive quando venceu. Aceito, Recusado, Substituído e
 * Histórico já tiveram desfecho e ficam fora da fila; continuam em "Todos os
 * status" e no filtro de cada um.
 */
const EM_ABERTO: QuoteStatus[] = ["DRAFT", "SENT"];

/**
 * As escolhas do filtro de status. O valor na URL é a chave: `em-aberto` (o
 * default, que não aparece no endereço), `todos`, ou o próprio status do
 * domínio, com o rótulo de `QUOTE_STATUS_LABELS`.
 */
const GRUPOS: StatusGroup<QuoteStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: EM_ABERTO },
  { key: "todos", label: "Todos os status", statuses: [] },
  ...QUOTE_STATUSES.map((status) => ({
    key: status,
    label: QUOTE_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: não vira chip e não aparece na URL. */
  status: "em-aberto",
  customerId: "",
  projectId: "",
  /* A fila já é o recorte: período nenhum por padrão. */
  period: "todos",
  dateFrom: "",
  dateTo: "",
};

const PRESETS: ListPeriodPreset[] = ["todos", "mes-atual", "7d", "30d", "custom"];

const FILTER_SCOPE = "quote-versions";

/** Chave conhecida, ou o default — `?status=QUALQUERCOISA` não vira consulta inválida. */
function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

/**
 * Comercial → Orçamentos — QUOTES-HUB-01.
 *
 * A visão geral de TODAS as versões de orçamento, de todos os projetos. Não é
 * um segundo workspace: cada linha só abre a página da versão
 * (`/comercial/orcamentos/:id`, QUOTE-WORKSPACE-NAVIGATION-01), com a volta para
 * este recorte na URL. Editar, enviar, aceitar e gerar Pedido continuam lá;
 * orçamento novo continua nascendo na ficha do Projeto.
 *
 * A foundation das listas: filtros na URL com a lembrança da sessão
 * (`useListFilters`), consulta paginada no servidor (`useListQuery`), período
 * em dia civil (`DateRangeFilter`) e a linha de estado que separa carregando,
 * falha e vazio (`ListStatusRow`).
 */
export function QuotesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [clienteEscolhido, setClienteEscolhido] = useState<EntityOption | null>(null);
  const [projetoEscolhido, setProjetoEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: FILTER_SCOPE,
    userId: user?.id ?? null,
  });
  const { search, customerId, projectId } = values;
  const grupo = grupoValido(values.status);
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "todos";

  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );
  /* Data inicial depois da final não se consulta: a lista vazia se leria como resposta. */
  const periodoRecusado = recusaDoPeriodo(periodo.dateFrom, periodo.dateTo);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListQuoteVersionsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (customerId) filtros.customerId = customerId;
    if (projectId) filtros.projectId = projectId;
    const statuses = statusesOfGroup(GRUPOS, grupo);
    if (statuses.length > 0) filtros.status = statuses;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    return filtros;
  }, [search, customerId, projectId, grupo, periodo.dateFrom, periodo.dateTo]);

  /*
   * A busca é digitada; a URL é o estado. O campo tem estado local e só o
   * resultado com pausa chega à URL — uma consulta por pausa, não por letra.
   */
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(handle);
  }, [searchInput, search, set]);

  const consulta = useListQuery(
    listQuoteVersions,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { enabled: periodoRecusado === null, fallbackError: "Falha ao carregar orçamentos" },
  );
  const versoes: QuoteVersionListItemDTO[] = consulta.data?.quoteVersions ?? [];
  const total = consulta.data?.total ?? 0;

  /*
   * A volta da página da versão é ESTA lista, com o recorte e a página de agora
   * — o endereço já carrega os dois. "← Voltar para Orçamentos" devolve a
   * pessoa exatamente onde estava.
   */
  const estaLista = `${location.pathname}${location.search}`;
  const paginaDaVersao = (quoteVersionId: string) =>
    rotaDoOrcamento(quoteVersionId, { voltar: estaLista });

  const chips: FilterChip[] = [];
  if (search) {
    chips.push({ label: "Busca", value: search, onRemove: () => set({ search: "" }) });
  }
  if (grupo !== FILTROS_PADRAO.status) {
    chips.push({
      label: "Status",
      value: labelOfGroup(GRUPOS, grupo),
      // Tirar o recorte devolve a FILA, não a base inteira.
      onRemove: () => set({ status: FILTROS_PADRAO.status }),
    });
  }
  if (customerId) {
    const nome =
      clienteEscolhido?.id === customerId
        ? `${clienteEscolhido.code} · ${clienteEscolhido.name}`
        : (versoes.find((versao) => versao.customerId === customerId)?.customerName ?? "selecionado");
    chips.push({ label: "Cliente", value: nome, onRemove: () => set({ customerId: "" }) });
  }
  if (projectId) {
    const nome =
      projetoEscolhido?.id === projectId
        ? `${projetoEscolhido.code} · ${projetoEscolhido.name}`
        : (versoes.find((versao) => versao.projectId === projectId)?.projectCode ?? "selecionado");
    chips.push({ label: "Projeto", value: nome, onRemove: () => set({ projectId: "" }) });
  }
  if (period !== FILTROS_PADRAO.period) {
    chips.push({
      label: "Período",
      value: period === "custom" ? formatListPeriod(periodo) : LIST_PERIOD_PRESET_LABELS[period],
      onRemove: () => set({ period: FILTROS_PADRAO.period, dateFrom: "", dateTo: "" }),
    });
  }

  /*
   * Tabela vazia diz QUAL vazio: com recorte além do status, nada casou; a fila
   * vazia não é a base vazia (o histórico está a um clique); e só "Todos os
   * status" sem recorte nenhum pode dizer que não há orçamento.
   */
  const recorteAlemDoStatus = Boolean(
    search || customerId || projectId || period !== FILTROS_PADRAO.period,
  );
  const verTodos = (
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ status: "todos" })}>
      Ver todos
    </button>
  );
  let vazio: ReactNode;
  if (recorteAlemDoStatus) {
    vazio = (
      <>
        Nenhum orçamento encontrado para os filtros atuais. <ClearFilters onClear={clear} />
      </>
    );
  } else if (grupo === "em-aberto") {
    vazio = <>Nenhum orçamento em aberto. {verTodos}</>;
  } else if (grupo === "todos") {
    vazio = "Nenhum orçamento cadastrado — o orçamento nasce na ficha do Projeto.";
  } else {
    vazio = (
      <>
        Nenhum orçamento com status {labelOfGroup(GRUPOS, grupo)}. {verTodos}
      </>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Orçamentos</h1>
          <p className="page__subtitle">
            Todas as versões de orçamento, de todos os projetos. Cada versão abre na própria
            página; orçamento novo nasce na ficha do Projeto.
          </p>
        </div>
      </div>

      <ContextHelp topic={helpTopics["comercial.orcamento"]} />

      <DateRangeFilter
        idPrefix="quotes"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        presets={PRESETS}
        fromLabel="Orçamento a partir de"
        toLabel="Orçamento até"
        onChange={(next) => set(next)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="quotes-search">
            Buscar orçamentos
          </label>
          <input
            id="quotes-search"
            type="search"
            placeholder="Buscar por código, cliente ou projeto…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="quotes-status-filter"
          label="Filtrar por status"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ status: key })}
        />

        {/* Busca no servidor: nem clientes nem projetos cabem num `<select>`. */}
        <EntityFilterSelect
          id="quotes-customer-filter"
          label="Filtrar por cliente"
          placeholder="Todos os clientes"
          value={customerId}
          onChange={(value) => set({ customerId: value })}
          source={clienteFilterSource}
          onResolve={setClienteEscolhido}
        />

        <EntityFilterSelect
          id="quotes-project-filter"
          label="Filtrar por projeto"
          placeholder="Todos os projetos"
          value={projectId}
          onChange={(value) => set({ projectId: value })}
          source={projetoFilterSource}
          onResolve={setProjetoEscolhido}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {/* Falha não vira "Nenhum orçamento": o aviso diz o que houve e a tabela
          não responde por uma consulta que não voltou. */}
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
            <tr>
              <th className="col-tight">Orçamento</th>
              <th className="col-flex">Cliente</th>
              <th className="col-flex">Projeto</th>
              <th className="col-tight">Data</th>
              <th className="is-numeric col-tight">Produtos</th>
              {/* Enviado em diante, o total do documento congelado; rascunho, o
                  do último salvamento — os dois calculados pelo servidor. */}
              <th className="is-numeric col-tight">Total</th>
              <th className="col-tight">Validade</th>
              <th className="col-label">Status</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {versoes.map((versao) => (
              <tr
                key={versao.id}
                tabIndex={0}
                onClick={() => navigate(paginaDaVersao(versao.id))}
                onKeyDown={(event) => {
                  // Enter num link da linha já navega por ele: a linha não repete.
                  if (event.key === "Enter" && event.target === event.currentTarget) {
                    navigate(paginaDaVersao(versao.id));
                  }
                }}
              >
                <td className="is-code col-tight">{versao.versionLabel}</td>
                <td className="col-flex">
                  <EntityLink
                    kind="customer"
                    id={versao.customerId}
                    code={versao.customerCode}
                    name={versao.customerName}
                    hideCode
                  />
                </td>
                <td className="col-flex">
                  <EntityLink
                    kind="project"
                    id={versao.projectId}
                    code={versao.projectCode}
                    name={versao.projectName}
                  />
                </td>
                <td className="col-tight">{formatQuoteDate(versao.quoteDate)}</td>
                <td className="is-numeric col-tight">{formatIntegerPtBr(versao.productCount)}</td>
                <td className="is-numeric col-tight">{formatBRL(versao.total)}</td>
                <td className="col-tight">
                  {formatQuoteDate(versao.validUntil)}
                  {versao.expired && <span className="badge badge--warn"> Vencido</span>}
                </td>
                <td className="col-label">
                  <span className={quoteBadgeClass(versao.status)}>
                    {QUOTE_STATUS_LABELS[versao.status]}
                  </span>
                  {/* O Pedido que a versão aceita originou — referência, não coluna. */}
                  {versao.sourcedOrder && (
                    <span className="field__hint">
                      {" "}
                      · originou{" "}
                      <EntityLink
                        kind="customerOrder"
                        id={versao.sourcedOrder.id}
                        code={versao.sourcedOrder.code}
                      />
                    </span>
                  )}
                </td>
                {/* A célula fica `td` de verdade: é a coluna fixa da tabela
                    (`table--sticky-actions`), e `.table__actions` é flex — na
                    própria `td` tirava a célula do layout e o "Abrir" sumia. */}
                <td>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={paginaDaVersao(versao.id)}
                      aria-label={`Abrir ${versao.versionLabel}`}
                      // A linha inteira também navega: sem isto o clique chegaria duas vezes.
                      onClick={(event) => event.stopPropagation()}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            <ListStatusRow
              colSpan={9}
              query={consulta}
              rowCount={versoes.length}
              periodRefused={periodoRecusado !== null}
            >
              {vazio}
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "versão de orçamento" : "versões de orçamento"}
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
