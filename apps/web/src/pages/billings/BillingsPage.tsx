import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { listCustomers } from "../../lib/customers-api";
import { EntityLink } from "../../components/EntityLink";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { AwaitingBillingRowDTO, BillingDTO, BillingStatus } from "@veridi/shared";
import {
  BILLING_STATUSES,
  BILLING_STATUS_LABELS,
  SHIPMENT_BILLING_STATUS_LABELS,
} from "@veridi/shared";
import type { ListBillingsParams } from "../../lib/billings-api";
import { createBilling, listAwaitingBilling, listBillings } from "../../lib/billings-api";
import { formatBRL } from "../../lib/currency";
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
import { useAuth } from "../../app/AuthProvider";

type ActiveFilter = BillingStatus | "all";

const PAGE_SIZE = 20;

/**
 * Os filtros desta lista e o que cada um significa quando está limpo.
 *
 * `period: "mes-atual"` é decisão de Product Ownership: a pergunta operacional
 * do Faturamento é "o que faturamos neste mês", e abrir a base inteira faz a
 * primeira página envelhecer junto com a empresa. `Personalizado` continua
 * aberto para o relatório histórico, sem limite de recuo.
 */
const FILTROS_PADRAO = {
  search: "",
  status: "all",
  customerId: "",
  period: "mes-atual",
  dateFrom: "",
  dateTo: "",
};

const PRESETS_DO_FATURAMENTO: ListPeriodPreset[] = [
  "mes-atual",
  "hoje",
  "7d",
  "30d",
  "custom",
];

function statusBadgeClass(status: BillingStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ISSUED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}


/**
 * Comercial → Faturamento. Foco operacional: primeiro o que está
 * aguardando faturamento, depois os documentos já criados.
 *
 * Tela de referência da fundação de filtros: `useListFilters` (URL como
 * estado), `DateRangeFilter` (período em dia comercial) e
 * `ActiveFilterChips`. O período resolvido é UM objeto, e a lista e o CSV
 * leem o mesmo — é o que garante que o arquivo baixado seja o que está na
 * tela.
 */
export function BillingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [awaiting, setAwaiting] = useState<AwaitingBillingRowDTO[]>([]);
  const [billings, setBillings] = useState<BillingDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preparingShipmentId, setPreparingShipmentId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "billings",
    userId: user?.id ?? null,
  });
  const { search, customerId } = values;
  const status = values.status as ActiveFilter;
  const period: ListPeriodPreset = ehListPeriodPreset(values.period) ? values.period : "mes-atual";

  useEffect(() => {
    listCustomers({ pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);

  /*
   * O período em dias comerciais — `YYYY-MM-DD`, nunca instante. O servidor
   * abre cada dia nos dois instantes que o limitam, com o fim exclusivo:
   * "de 10/09 até 10/09" é o dia 10 inteiro em São Paulo, e o resultado é o
   * mesmo para quem abre a tela de outro fuso.
   */
  const periodo = useMemo(
    () => resolveListPeriod(period, values.dateFrom, values.dateTo),
    [period, values.dateFrom, values.dateTo],
  );

  /*
   * UM conjunto de filtros para a consulta e para o CSV. Duas listas de
   * campos lado a lado é como a tela e o arquivo passam a discordar sem
   * ninguém notar — o CSV não tem tela para conferir.
   */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListBillingsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (status !== "all") filtros.status = status;
    if (customerId) filtros.customerId = customerId;
    if (periodo.dateFrom) filtros.dateFrom = periodo.dateFrom;
    if (periodo.dateTo) filtros.dateTo = periodo.dateTo;
    return filtros;
  }, [search, status, customerId, periodo.dateFrom, periodo.dateTo]);

  /*
   * A busca é digitada; a URL é o estado. Escrever a cada tecla faria uma
   * consulta por letra, então o campo tem estado local e só o resultado
   * debounced chega à URL — e o campo volta a seguir a URL quando ela muda
   * por fora (chip removido, "Limpar filtros", sessão restaurada).
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

  const reloadAwaiting = useCallback(() => {
    listAwaitingBilling()
      .then((result) => setAwaiting(result.rows))
      .catch(() => setAwaiting([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    listBillings({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setBillings(result.billings);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar faturamentos");
      })
      .finally(() => setLoading(false));
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    reloadAwaiting();
  }, [reloadAwaiting]);

  const customerName = (id: string) => {
    const customer = customers.find((candidate) => candidate.id === id);
    return customer ? (customer.tradeName ?? customer.legalName) : id;
  };

  /*
   * Os chips saem do que está FORA do default — e o período personalizado é
   * um chip só, embora sejam três campos na URL. O × devolve o filtro ao
   * default, que no período é "Mês atual" e não "tudo".
   */
  const chips: FilterChip[] = [];
  if (search) {
    chips.push({ label: "Busca", value: search, onRemove: () => set({ search: "" }) });
  }
  if (status !== "all") {
    chips.push({
      label: "Status",
      value: BILLING_STATUS_LABELS[status],
      onRemove: () => set({ status: "all" }),
    });
  }
  if (customerId) {
    chips.push({
      label: "Cliente",
      value: customerName(customerId),
      onRemove: () => set({ customerId: "" }),
    });
  }
  if (period !== FILTROS_PADRAO.period) {
    chips.push({
      label: "Período",
      value: period === "custom" ? formatListPeriod(periodo) : LIST_PERIOD_PRESET_LABELS[period],
      onRemove: () =>
        set({ period: FILTROS_PADRAO.period, dateFrom: "", dateTo: "" }),
    });
  }

  async function handlePrepare(row: AwaitingBillingRowDTO) {
    if (row.billingId) {
      navigate(`/comercial/faturamento/${row.billingId}`);
      return;
    }
    setPreparingShipmentId(row.shipmentId);
    setError(null);
    try {
      const billing = await createBilling(row.shipmentId);
      navigate(`/comercial/faturamento/${billing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar faturamento");
    } finally {
      setPreparingShipmentId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento</h1>
          <p className="page__subtitle">
            Faturamento comercial/operacional do que foi realmente expedido — não emite Nota Fiscal.
          </p>
        </div>
        <ExportCsvButton path="/billings/export.csv" filters={filtrosDaConsulta} />
</div>

      <ContextHelp topic={helpTopics["faturamento.lista"]} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th colSpan={7}>Aguardando faturamento</th>
            </tr>
            <tr>
              <th className="col-tight">Expedição</th>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Data</th>
              <th className="is-numeric col-tight">Quantidade</th>
              <th className="col-tight">Situação</th>
              {/* Esta tabela não é `table--sticky-actions`, então a regra que
                  congela a última coluna não vale aqui: a classe vai à mão. */}
              <th aria-hidden="true" className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {awaiting.map((row) => (
              <tr key={row.shipmentId}>
                <td className="is-code col-tight">
                  <EntityLink kind="shipment" id={row.shipmentId} code={row.shipmentCode} />
                </td>
                <td className="is-code col-tight">
                  <EntityLink
                    kind="customerOrder"
                    id={row.customerOrderId}
                    code={row.customerOrderCode}
                  />
                </td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={row.customerId} code={row.customerName} />
                </td>
                <td className="col-tight">{formatDate(row.shipmentDate)}</td>
                <td className="col-tight">{formatQuantity(row.totalQuantity)}</td>
                <td className="col-tight">
                  <span
                    className={row.billingStatus === "DRAFT" ? "badge badge--warn" : "badge badge--neutral"}
                  >
                    {SHIPMENT_BILLING_STATUS_LABELS[row.billingStatus]}
                  </span>
                </td>
                <td className="col-actions">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={preparingShipmentId === row.shipmentId}
                    /* O código do faturamento já está na linha (coluna
                       Expedição/Pedido) e repeti-lo dentro do botão fazia a
                       coluna de ações virar a 2ª mais larga da tela. Fica só
                       no nome acessível, para quem navega por leitor de tela
                       ouvir qual documento vai abrir. */
                    aria-label={row.billingId ? `Abrir ${row.billingCode}` : undefined}
                    onClick={() => handlePrepare(row)}
                  >
                    {row.billingId
                      ? "Abrir"
                      : preparingShipmentId === row.shipmentId
                        ? "Preparando…"
                        : "Preparar faturamento"}
                  </button>
                </td>
              </tr>
            ))}

            {awaiting.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhuma expedição aguardando faturamento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* A barra filtra os DOCUMENTOS de faturamento; a fila "Aguardando
          faturamento" acima é outra pergunta e não responde a ela. Dizer isso
          é mais barato do que deixar o usuário deduzir pela posição. */}
      <p className="toolbar__scope">Filtrar documentos de faturamento</p>

      <DateRangeFilter
        idPrefix="billing"
        value={{ period, dateFrom: values.dateFrom, dateTo: values.dateTo }}
        /* Faturamento tem default operacional (Mês atual): "Todo o período"
           não entra na fileira de atalhos — quem quer a base inteira usa
           Personalizado sem limite de recuo. */
        presets={PRESETS_DO_FATURAMENTO}
        fromLabel="Emitido a partir de"
        toLabel="Emitido até"
        onChange={(next) => set(next)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="billing-search">
            Buscar faturamentos
          </label>
          <input
            id="billing-search"
            type="search"
            placeholder="Buscar por código, pedido, expedição ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="billing-status-filter">
          Filtrar por status
        </label>
        <select
          id="billing-status-filter"
          value={status}
          onChange={(event) => set({ status: event.target.value })}
        >
          <option value="all">Todos os status</option>
          {BILLING_STATUSES.map((option) => (
            <option key={option} value={option}>
              {BILLING_STATUS_LABELS[option]}
            </option>
          ))}
        </select>

        <div className="toolbar__entity">
          <label className="sr-only" htmlFor="billing-customer-filter">
            Filtrar por cliente
          </label>
          <SearchableEntitySelect
            id="billing-customer-filter"
            value={customerId}
            onChange={(value) => set({ customerId: value })}
            placeholder="Todos os clientes"
            options={customers.map((customer) => ({
              id: customer.id,
              code: customer.code,
              name: customer.tradeName ?? customer.legalName,
            }))}
          />
        </div>
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      <div className="table-container">
        <table className="table table--clickable-rows table--sticky-actions">
          <thead>
            <tr>
              <th colSpan={9}>Documentos de faturamento</th>
            </tr>
            <tr>
              <th className="col-tight">Faturamento</th>
              <th className="col-tight">Expedição</th>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="is-numeric col-tight">Quantidade</th>
              {/* Valor nunca trunca: meio número parece um número verdadeiro. */}
              <th className="is-numeric col-tight">Valor</th>
              <th className="col-tight">Status</th>
              <th className="col-tight">Emitido em</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {billings.map((billing) => (
              <tr
                key={billing.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/faturamento/${billing.id}`);
                }}
              >
                {/* O código identifica o documento da linha: é ele que a
                    pessoa mira para abrir o faturamento. */}
                <td className="is-code col-tight">
                  <EntityLink kind="billing" id={billing.id} code={billing.code} />
                </td>
                <td className="is-code col-tight">
                  <EntityLink kind="shipment" id={billing.shipmentId} code={billing.shipmentCode} />
                </td>
                <td className="is-code col-tight">
                  <EntityLink
                    kind="customerOrder"
                    id={billing.customerOrderId}
                    code={billing.customerOrderCode}
                  />
                </td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={billing.customerId} code={billing.customerName} />
                </td>
                <td className="col-tight">{formatQuantity(billing.totalQuantity)}</td>
                <td className="col-tight">
                  {billing.totalAmount ? formatBRL(billing.totalAmount) : "Não informado"}
                </td>
                <td className="col-tight">
                  <span className={statusBadgeClass(billing.status)}>
                    {BILLING_STATUS_LABELS[billing.status]}
                  </span>
                </td>
                <td className="col-tight">{formatDate(billing.issuedAt)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/comercial/faturamento/${billing.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && billings.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhum faturamento encontrado para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    "Nenhum faturamento cadastrado."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "faturamento" : "faturamentos"}
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
