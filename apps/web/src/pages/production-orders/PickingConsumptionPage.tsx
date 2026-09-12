import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EntityLink } from "../../components/EntityLink";
import type { ProductionOrderDTO, ProductionOrderStatus } from "@veridi/shared";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { ListProductionOrdersParams } from "../../lib/production-orders-api";
import { listProductionOrders } from "../../lib/production-orders-api";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { useListFilters } from "../../lib/list-filters";
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
import { produtoFilterSource } from "../../lib/filter-sources";
import { useAuth } from "../../app/AuthProvider";

/**
 * ⓘ de uma coluna, lido do registro central.
 *
 * "Picking" e "Consumo" são duas colunas de contagem que parecem medir a
 * mesma coisa e medem coisas opostas: uma conta conferência, a outra conta
 * baixa de estoque. O texto vive em `help-content` porque quem o revisa
 * conhece a regra, não o JSX.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

const PAGE_SIZE = 20;

/**
 * Os grupos de situação desta fila.
 *
 * `em-aberto` é a pergunta operacional da tela e são DOIS status do domínio
 * — nenhum status novo é inventado. `RELEASED` é a OP liberada para
 * separação e `IN_PRODUCTION` a que já está sendo produzida: as duas ainda
 * são atendíveis por Picking/Consumo, e é por isso que a fila junta as duas.
 * O resto do ciclo (rascunho, planejada, concluída, bloqueada, cancelada)
 * não tem conferência nem consumo a fazer, e por isso não aparece aqui.
 */
const GRUPOS: StatusGroup<ProductionOrderStatus>[] = [
  { key: "em-aberto", label: "Em aberto", statuses: ["RELEASED", "IN_PRODUCTION"] },
  { key: "liberada", label: "Liberada", statuses: ["RELEASED"] },
  { key: "em-producao", label: "Em produção", statuses: ["IN_PRODUCTION"] },
];

const FILTROS_PADRAO = {
  search: "",
  /* Default operacional: o que a produção ainda tem para fazer. */
  grupo: "em-aberto",
  productId: "",
};

function statusBadgeClass(status: ProductionOrderDTO["status"]): string {
  return status === "IN_PRODUCTION" ? "badge badge--warn" : "badge badge--active";
}

function pickingSummary(order: ProductionOrderDTO): string {
  const lines = order.requirements.flatMap((requirement) =>
    requirement.reservationLines.filter((line) => line.releasedAt === null),
  );
  const confirmed = lines.filter((line) => line.pickingStatus === "CONFIRMED").length;
  return `${confirmed}/${lines.length} lotes conferidos`;
}

function consumptionSummary(order: ProductionOrderDTO): string {
  const total = order.requirements.length;
  const fullyConsumed = order.requirements.filter(
    (requirement) => Number(requirement.remainingReservedQuantity) <= 0,
  ).length;
  return `${fullyConsumed}/${total} materiais consumidos`;
}

/**
 * Produção → Picking / Consumo. Lista as OPs ainda atendíveis — a ação
 * acontece na própria página da OP.
 *
 * A fila era montada com DUAS consultas de `pageSize: 100` concatenadas no
 * navegador, uma por status, sem filtro nenhum e sem paginação. A partir da
 * 101ª ordem de qualquer um dos dois lados a fila perdia linhas em silêncio,
 * e o rodapé contava o que havia sobrado como se fosse o total — numa tela
 * cuja função é justamente garantir que nada ficou para trás. Agora é UMA
 * consulta com `status=RELEASED,IN_PRODUCTION`, paginada pelo banco, e o
 * total é o do servidor.
 */
export function PickingConsumptionPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [orders, setOrders] = useState<ProductionOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "picking",
    userId: user?.id ?? null,
  });
  const { search, grupo, productId } = values;

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListProductionOrdersParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (productId) filtros.productId = productId;
    const statuses = statusesOfGroup(GRUPOS, grupo);
    if (statuses.length > 0) filtros.status = statuses;
    return filtros;
  }, [search, grupo, productId]);

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

    listProductionOrders({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setOrders(result.productionOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de produção");
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
  if (grupo !== FILTROS_PADRAO.grupo) {
    chips.push({
      label: "Situação",
      value: labelOfGroup(GRUPOS, grupo),
      onRemove: () => set({ grupo: FILTROS_PADRAO.grupo }),
    });
  }
  if (productId) {
    chips.push({
      label: "Produto",
      value: orders.find((order) => order.productId === productId)?.productName ?? "selecionado",
      onRemove: () => set({ productId: "" }),
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Picking / Consumo</h1>
          <p className="page__subtitle">
            Ordens de produção liberadas ou em produção — conferência de lotes e consumo real.
          </p>
        </div>
      </div>

      <ContextHelp topic={helpTopics["producao.picking"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="picking-search">
            Buscar ordens de produção
          </label>
          <input
            id="picking-search"
            type="search"
            placeholder="Buscar por OP, produto ou código…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <StatusGroupFilter
          id="picking-status-filter"
          label="Filtrar por situação"
          groups={GRUPOS}
          value={grupo}
          onChange={(key) => set({ grupo: key })}
        />

        {/* Busca no servidor: o catálogo de produtos não cabe num `<select>`
            e um teto fixo esconderia produto sem avisar. */}
        <EntityFilterSelect
          id="picking-product-filter"
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
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">OP</th>
              <th className="col-flex">Produto</th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="producao.picking.situacao" />
              </th>
              <th className="col-tight">
                Picking
                <DicaDaColuna id="producao.picking.conferencia" />
              </th>
              <th className="col-tight">
                Consumo
                <DicaDaColuna id="producao.picking.consumo" />
              </th>
              {/* `col-actions` explícito: esta tabela não tem
                  `table--sticky-actions`, então a regra automática da última
                  coluna não vale aqui. */}
              <th className="col-actions" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                tabIndex={0}
                onClick={() => navigate(`/producao/ordens/${order.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/producao/ordens/${order.id}`);
                }}
              >
                <td className="col-tight is-code">
                  <EntityLink kind="productionOrder" id={order.id} code={order.code} />
                </td>
                <td className="col-flex">
                  {order.productCode} — {order.productName}
                </td>
                <td className="col-tight">
                  <span className={statusBadgeClass(order.status)}>
                    {PRODUCTION_ORDER_STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="col-tight">{pickingSummary(order)}</td>
                <td className="col-tight">{consumptionSummary(order)}</td>
                <td className="col-actions" onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/producao/ordens/${order.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={6} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhuma ordem encontrada para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    "Nenhuma ordem liberada ou em produção no momento."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* O total é o do SERVIDOR, não o tamanho da página: a tela dizia
            "N ordens" contando as linhas que tinha em mão. */}
        <div className="table-foot">
          {total} {total === 1 ? "ordem" : "ordens"}
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
