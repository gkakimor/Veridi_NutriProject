import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BulkSelectionBar,
  BulkSelectionCell,
  BulkSelectionHeaderCell,
  useBulkSelection,
} from "../../components/BulkSelection";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { CustomerOrderDTO, CustomerOrderStatus } from "@veridi/shared";
import {
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUSES,
  CUSTOMER_ORDER_STATUS_LABELS,
} from "@veridi/shared";
import type { ListCustomerOrdersParams } from "../../lib/customer-orders-api";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { useAuth } from "../../app/AuthProvider";
import { useListFilters } from "../../lib/list-filters";
import { clienteFilterSource } from "../../lib/filter-sources";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import type { StatusGroup } from "../../components/filters/StatusGroupFilter";
import {
  StatusGroupFilter,
  labelOfGroup,
  statusesOfGroup,
} from "../../components/filters/StatusGroupFilter";
import type { EntityOption } from "../../components/SearchableEntitySelect";

const PAGE_SIZE = 20;

function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "IN_FULFILLMENT":
    case "PARTIALLY_SHIPPED":
      return "badge badge--warn";
    case "SHIPPED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

/**
 * "Em aberto" — o pedido que ainda pede trabalho de alguém.
 *
 * Quatro status do domínio, nenhum inventado: o rascunho ainda precisa ser
 * confirmado, o confirmado ainda precisa de atendimento, e o que está em
 * atendimento ou parcialmente expedido ainda tem produto para sair. Ficam de
 * fora os dois estados encerrados: `SHIPPED` (tudo foi expedido e a reserva
 * que sobrava já foi liberada) e `CANCELLED`. O faturamento do pedido
 * expedido tem fila própria, "Aguardando faturamento", na tela de
 * Faturamento.
 */
const EM_ABERTO: CustomerOrderStatus[] = ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"];

/**
 * As escolhas do filtro de status.
 *
 * O valor na URL é a chave: `em-aberto` (o default, que não aparece no
 * endereço), `todos`, ou o próprio status do domínio — um link externo pode
 * dizer `?status=CONFIRMED` sem conhecer apelido nenhum.
 */
const GRUPOS: StatusGroup<CustomerOrderStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: EM_ABERTO },
  // A saída para o histórico: sem ela a tela ficaria presa à fila.
  { key: "todos", label: "Todos os status", statuses: [] },
  ...CUSTOMER_ORDER_STATUSES.map((status) => ({
    key: status,
    label: CUSTOMER_ORDER_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: não vira chip e não aparece na URL. */
  status: "em-aberto",
  /* Também é o contexto do link "Pedidos" do cadastro do Cliente. */
  customerId: "",
};

/** Chave conhecida, ou o default — `?status=QUALQUERCOISA` não vira consulta inválida. */
function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

/**
 * Comercial → Pedidos. Documento transacional: linhas abrem página própria, não modal.
 *
 * FILTER-OPERATIONS-WAVE-03. A tela abria em "todos os status" e lembrava os
 * filtros campo a campo (`usePersistentFilter`): chegando pelo link
 * "Pedidos" do Cliente X, o cliente vinha do link e a busca e o status
 * vinham da sessão — o cruzamento que a foundation existe para impedir. O
 * cliente era um `<select>` com `listCustomers({ pageSize: 1000 })`, teto
 * fixo apresentado como catálogo inteiro.
 */
const FILTER_SCOPE = "customer-orders";

export function CustomerOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [customerOrders, setCustomerOrders] = useState<CustomerOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: FILTER_SCOPE,
    userId: user?.id ?? null,
  });
  const { search, customerId } = values;
  const grupo = grupoValido(values.status);

  /* UM conjunto de filtros para a consulta e para o CSV. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListCustomerOrdersParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (customerId) filtros.customerId = customerId;
    const statuses = statusesOfGroup(GRUPOS, grupo);
    if (statuses.length > 0) filtros.status = statuses;
    return filtros;
  }, [search, customerId, grupo]);

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

    listCustomerOrders({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setCustomerOrders(result.customerOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar pedidos");
      })
      .finally(() => setLoading(false));
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  /*
   * Seleção em massa sobre o MESMO recorte da consulta e do CSV. Ainda sem
   * ação: os documentos em lote chegam em BULK-DOCUMENTS-01.
   */
  const selecao = useBulkSelection({
    pageIds: customerOrders.map((order) => order.id),
    total,
    filters: filtrosDaConsulta,
    loading,
  });

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
    /*
     * O nome sai do próprio filtro, não das linhas: o link do Cliente pode
     * abrir uma lista vazia, e é aí que a pessoa mais precisa ler de quem.
     */
    const nome =
      clienteEscolhido?.id === customerId
        ? `${clienteEscolhido.code} · ${clienteEscolhido.name}`
        : (customerOrders.find((order) => order.customerId === customerId)?.customerName ??
          "selecionado");
    chips.push({ label: "Cliente", value: nome, onRemove: () => set({ customerId: "" }) });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedidos do Cliente</h1>
          <p className="page__subtitle">Demanda comercial — conecta o pedido à disponibilidade real de estoque e produção.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/comercial/pedidos/novo")}
        >
          + Novo pedido
        </button>
        <ExportCsvButton path="/customer-orders/export.csv" filters={filtrosDaConsulta} />
      </div>

      <ContextHelp topic={helpTopics["comercial.pedidos"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="co-search">
            Buscar pedidos
          </label>
          <input
            id="co-search"
            type="search"
            placeholder="Buscar por código ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="co-status-filter"
          label="Filtrar por status"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ status: key })}
        />

        {/* Busca no servidor: a carteira de clientes não cabe num `<select>`. */}
        <EntityFilterSelect
          id="co-customer-filter"
          label="Filtrar por cliente"
          placeholder="Todos os clientes"
          value={customerId}
          onChange={(value) => set({ customerId: value })}
          source={clienteFilterSource}
          onResolve={setClienteEscolhido}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <BulkSelectionBar selection={selecao} />

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <BulkSelectionHeaderCell selection={selecao} />
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Data</th>
              <th className="col-tight">Entrega</th>
              <th className="col-tight">Produtos</th>
              <th className="is-numeric col-tight">Quantidade</th>
              <th className="col-label">Atendimento</th>
              <th className="col-label">Faturamento</th>
              <th className="col-label">Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {customerOrders.map((order) => {
              const totalQuantity = order.lines.reduce((sum, line) => sum + Number(line.orderedQuantity), 0);
              return (
                <tr
                  key={order.id}
                  tabIndex={0}
                  onClick={() => navigate(`/comercial/pedidos/${order.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/comercial/pedidos/${order.id}`);
                  }}
                >
                  <BulkSelectionCell
                    selection={selecao}
                    id={order.id}
                    label={`Selecionar pedido ${order.code}`}
                  />
                  <td className="is-code col-tight">{order.code}</td>
                  <td className="col-flex">
                    <EntityLink kind="customer" id={order.customerId} code={order.customerName} />
                  </td>
                  <td className="col-tight">{formatDate(order.orderDate)}</td>
                  <td className="col-tight">{formatDate(order.requestedDeliveryDate)}</td>
                  <td className="col-tight">{order.lines.length}</td>
                  <td className="is-numeric col-tight">{totalQuantity}</td>
                  <td className="col-label">
                    {/*
                      A situação de expedição vem do STATUS, nunca de uma
                      segunda derivação aqui.

                      Esta célula recalculava por conta própria — bastava UMA
                      expedição confirmada para dizer "Expedido", sem olhar se
                      ela cobria o pedido. `PED-000001` embarcou 980 de 1000 e a
                      linha dizia "Expedido" na coluna Atendimento e
                      "Parcialmente expedido" na coluna Status, lado a lado.
                      Duas colunas discordando sobre o mesmo fato é pior que uma
                      só: quem passa o olho na lista acredita na primeira.

                      `PARTIALLY_SHIPPED` e `SHIPPED` já são derivados no
                      servidor a partir das expedições confirmadas reais — é o
                      que o contrato do domínio declara. O que sobra para esta
                      coluna dizer é o que o status ainda não diz: se o plano de
                      atendimento chegou a ser aplicado.
                    */}
                    {order.status === "SHIPPED" || order.status === "PARTIALLY_SHIPPED"
                      ? CUSTOMER_ORDER_STATUS_LABELS[order.status]
                      : order.reservation || order.generatedProductionOrders.length > 0
                        ? "Em atendimento"
                        : "Não analisado"}
                  </td>
                  <td className="col-label">
                    {CUSTOMER_ORDER_BILLING_STATUS_LABELS[order.billingStatus]}
                  </td>
                  <td className="col-label">
                    <span className={statusBadgeClass(order.status)}>
                      {CUSTOMER_ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="table__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/comercial/pedidos/${order.id}`)}
                      >
                        Abrir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && customerOrders.length === 0 && (
              <tr>
                <td colSpan={11} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhum pedido encontrado para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    <>
                      {/* A fila vazia não é a base vazia: o histórico continua
                          a um clique. */}
                      Nenhum pedido em aberto.{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => set({ status: "todos" })}
                      >
                        Ver todos
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "pedido" : "pedidos"}
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
