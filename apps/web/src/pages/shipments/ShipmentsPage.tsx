import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import type { ShipmentDTO, ShipmentStatus } from "@veridi/shared";
import { SHIPMENT_STATUS_LABELS } from "@veridi/shared";
import type { ListShipmentsParams } from "../../lib/shipments-api";
import { listShipments } from "../../lib/shipments-api";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { useListFilters } from "../../lib/list-filters";
import { pedidoFilterSource } from "../../lib/filter-sources";
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

/**
 * ⓘ de rótulo e cabeçalho de coluna. O texto mora em `help-content`: a
 * mesma palavra quer dizer a mesma coisa na lista e na ficha, e quem revisa
 * a explicação não deveria precisar abrir duas telas.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}


function statusBadgeClass(status: ShipmentStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

/**
 * As escolhas do filtro de status — e o que ainda exige ação AQUI.
 *
 * O ciclo da Expedição tem três estados. Só o rascunho ainda pede trabalho
 * nesta tela: conferir os lotes e confirmar a saída. A confirmada já saiu —
 * não se edita, não se reconfirma e não se cancela —, e o faturamento dela
 * tem fila própria, "Aguardando faturamento", na tela de Faturamento. A
 * cancelada é histórico.
 *
 * Por isso "Em aberto" é UM status, e não aparece de novo como "Rascunho":
 * seriam duas opções para a mesma consulta, e um chip dizendo "Rascunho"
 * para a mesma lista que o default mostra sem chip nenhum.
 *
 * O valor na URL é a chave: `em-aberto` (o default, fora do endereço),
 * `todos`, ou o status do domínio (`CONFIRMED`, `CANCELLED`).
 */
const GRUPOS: StatusGroup<ShipmentStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: ["DRAFT"] },
  { key: "todos", label: "Todos os status", statuses: [] },
  { key: "CONFIRMED", label: SHIPMENT_STATUS_LABELS.CONFIRMED, statuses: ["CONFIRMED"] },
  { key: "CANCELLED", label: SHIPMENT_STATUS_LABELS.CANCELLED, statuses: ["CANCELLED"] },
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: não vira chip e não aparece na URL. */
  status: "em-aberto",
  /*
   * O pedido de origem. A API sempre filtrou por ele e a tela não oferecia
   * — é o contexto que um link vindo do Pedido carrega.
   */
  customerOrderId: "",
};

function grupoValido(valor: string): string {
  return GRUPOS.some((grupo) => grupo.key === valor) ? valor : FILTROS_PADRAO.status;
}

/**
 * Comercial → Expedições. Documento transacional: linhas abrem página própria.
 *
 * FILTER-OPERATIONS-WAVE-03. Os filtros viviam em `useState`: abrir uma
 * expedição e voltar perdia a busca, e nenhum endereço reproduzia o recorte.
 */
export function ShipmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [shipments, setShipments] = useState<ShipmentDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pedidoEscolhido, setPedidoEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "shipments",
    userId: user?.id ?? null,
  });
  const { search, customerOrderId } = values;
  const grupo = grupoValido(values.status);

  /* UM conjunto de filtros para a consulta e para o CSV. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListShipmentsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (customerOrderId) filtros.customerOrderId = customerOrderId;
    // Todo grupo desta tela é um status só — a API de Expedições lê um.
    const [status] = statusesOfGroup(GRUPOS, grupo);
    if (status) filtros.status = status;
    return filtros;
  }, [search, customerOrderId, grupo]);

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

    listShipments({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setShipments(result.shipments);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar expedições");
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
  if (grupo !== FILTROS_PADRAO.status) {
    chips.push({
      label: "Status",
      value: labelOfGroup(GRUPOS, grupo),
      onRemove: () => set({ status: FILTROS_PADRAO.status }),
    });
  }
  if (customerOrderId) {
    const nome =
      pedidoEscolhido?.id === customerOrderId
        ? `${pedidoEscolhido.code} · ${pedidoEscolhido.name}`
        : (shipments.find((shipment) => shipment.customerOrderId === customerOrderId)
            ?.customerOrderCode ?? "selecionado");
    chips.push({ label: "Pedido", value: nome, onRemove: () => set({ customerOrderId: "" }) });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Expedições</h1>
          <p className="page__subtitle">
            Saída física de produto acabado — só uma expedição confirmada altera o estoque.
          </p>
        </div>
        <ExportCsvButton path="/shipments/export.csv" filters={filtrosDaConsulta} />
      </div>

      {/* Rascunho e confirmada não são dois estágios do mesmo documento:
          um não toca em estoque e o outro é a saída física, definitiva. */}
      <ContextHelp topic={helpTopics["comercial.expedicoes"]} />

      {/* Um único caminho de criação — Pedido → Expedição — evita expedição
          sem pedido nem reserva. O que faltava era dizer isso aqui, em vez
          de deixar o operador procurar um botão que não existe. */}
      <div className="callout">
        <p>Novas expedições são criadas a partir do Pedido do Cliente, com a reserva já feita.</p>
        <div className="line-actions">
          <Link className="btn btn--secondary btn--sm" to="/comercial/pedidos">
            Ir para Pedidos
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="shipment-search">
            Buscar expedições
          </label>
          <input
            id="shipment-search"
            type="search"
            placeholder="Buscar por código, pedido ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="shipment-status-filter"
          label="Filtrar por status"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ status: key })}
        />

        {/* Busca no servidor, por código ou cliente — e identidade exata,
            que a busca por texto não dá: "PED-00012" também acha o 120. */}
        <EntityFilterSelect
          id="shipment-order-filter"
          label="Filtrar por pedido"
          placeholder="Todos os pedidos"
          value={customerOrderId}
          onChange={(value) => set({ customerOrderId: value })}
          source={pedidoFilterSource}
          onResolve={setPedidoEscolhido}
        />
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Expedição</th>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Data</th>
              <th className="is-numeric col-tight">
                Quantidade
                <DicaDaColuna id="comercial.expedicaoQuantidade" />
              </th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="comercial.expedicaoStatus" />
              </th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr
                key={shipment.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/expedicoes/${shipment.id}`);
                }}
              >
                <td className="is-code col-tight">
                  <EntityLink kind="shipment" id={shipment.id} code={shipment.code} />
                </td>
                <td className="is-code col-tight">
                  <EntityLink
                    kind="customerOrder"
                    id={shipment.customerOrderId}
                    code={shipment.customerOrderCode}
                  />
                </td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={shipment.customerId} code={shipment.customerName} />
                </td>
                <td className="col-tight">{formatDate(shipment.shipmentDate)}</td>
                <td className="is-numeric col-tight">{formatQuantity(shipment.totalQuantity)}</td>
                <td className="col-tight">
                  <span className={statusBadgeClass(shipment.status)}>
                    {SHIPMENT_STATUS_LABELS[shipment.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/comercial/expedicoes/${shipment.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && shipments.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhuma expedição encontrada para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    <>
                      Nenhuma expedição em aberto.{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => set({ status: "todos" })}
                      >
                        Ver todas
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "expedição" : "expedições"}
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
