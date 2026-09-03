import { formatQuantity } from "../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AttentionGroupDTO,
  AttentionItemDTO,
  AttentionSeverity,
  AttentionTargetKind,
  DashboardDTO,
  MovementActivityPointDTO,
  RecentMovementDTO,
} from "@veridi/shared";
import {
  ATTENTION_LIST_PATH,
  ATTENTION_SEVERITY_LABELS,
  ATTENTION_TYPE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
} from "@veridi/shared";
import type { InventoryMovementType } from "@veridi/shared";
import { EntityLink } from "../components/EntityLink";
import { ContextHelp } from "../components/help";
import { helpTopics } from "../help/help-content";
import { getDashboard } from "../lib/dashboard-api";
import type { UserRole } from "@veridi/shared";
import type { PeriodPreset } from "../lib/period";
import { PERIOD_PRESET_LABELS, dateInputValueOffset, resolvePeriodBounds } from "../lib/period";
import { formatBRL } from "../lib/currency";
import { useAuth } from "../app/AuthProvider";
import "./dashboard.css";
import { formatDate } from "../lib/dates";

function severityBadgeClass(severity: AttentionSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "badge badge--err";
    case "WARNING":
      return "badge badge--warn";
    case "INFO":
      return "badge badge--neutral";
  }
}


function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

function attentionPath(kind: AttentionTargetKind, id: string): string {
  switch (kind) {
    case "LOT":
      return `/estoque/lotes/${id}`;
    case "PRODUCTION_ORDER":
      return `/producao/ordens/${id}`;
    case "PURCHASE_ORDER":
      return `/compras/ordens/${id}`;
    case "CUSTOMER_ORDER":
      return `/comercial/pedidos/${id}`;
    case "SHIPMENT":
      return `/comercial/expedicoes/${id}`;
  }
}

function movementPath(movement: RecentMovementDTO): string | null {
  if (!movement.sourceId) return null;
  switch (movement.sourceKind) {
    case "RECEIPT":
      return `/compras/recebimentos/${movement.sourceId}`;
    case "PRODUCTION_ORDER":
      return `/producao/ordens/${movement.sourceId}`;
    case "SHIPMENT":
      return `/comercial/expedicoes/${movement.sourceId}`;
    case "PROJECT_SAMPLE":
      return `/comercial/amostras/${movement.sourceId}`;
    default:
      return null;
  }
}

const SERIES: { key: keyof Omit<MovementActivityPointDTO, "date">; label: string; color: string }[] = [
  { key: "receiptIn", label: "Recebimento", color: "var(--v-green-600)" },
  { key: "finishedGoodProduction", label: "Produção", color: "var(--v-lime)" },
  { key: "productionConsumption", label: "Consumo", color: "var(--v-green-900)" },
  { key: "sampleConsumption", label: "Amostras", color: "var(--v-green-700)" },
  { key: "shipmentOut", label: "Expedição", color: "var(--ink-3)" },
  { key: "adjustments", label: "Ajustes", color: "var(--warn-fg)" },
  { key: "loss", label: "Perdas", color: "var(--err-fg)" },
];

/**
 * Único gráfico do cockpit: contagem de EVENTOS de estoque por dia. Barras
 * empilhadas de contagem, nunca soma física — kg e un não se somam.
 * SVG puro: nada de biblioteca de BI.
 */
function MovementActivityChart({ points }: { points: MovementActivityPointDTO[] }) {
  const width = Math.max(560, points.length * 34);
  const height = 180;
  const padBottom = 24;
  const totals = points.map((point) => SERIES.reduce((sum, series) => sum + point[series.key], 0));
  const max = Math.max(1, ...totals);
  const barWidth = Math.max(8, Math.min(22, (width - 16) / Math.max(points.length, 1) - 8));

  return (
    <div className="dash-chart">
      <svg width={width} height={height} role="img" aria-label="Movimentações por dia">
        {points.map((point, index) => {
          const x = 8 + index * ((width - 16) / Math.max(points.length, 1));
          let y = height - padBottom;
          return (
            <g key={point.date}>
              {SERIES.map((series) => {
                const value = point[series.key];
                if (value === 0) return null;
                const barHeight = (value / max) * (height - padBottom - 8);
                y -= barHeight;
                return (
                  <rect
                    key={series.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={series.color}
                  >
                    <title>{`${formatDate(`${point.date}T12:00:00`)} — ${series.label}: ${value}`}</title>
                  </rect>
                );
              })}
              {index % Math.ceil(points.length / 12 || 1) === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--ink-3)"
                >
                  {point.date.slice(8, 10)}/{point.date.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="dash-chart__legend">
        {SERIES.map((series) => (
          <span key={series.key}>
            <i style={{ background: series.color }} aria-hidden="true" />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StateLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="dash-state__line">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * Um grupo por tipo de atenção: "CoA pendente — 12 lotes" em vez de doze
 * linhas quase idênticas. Expandir mostra os primeiros itens; "ver todos"
 * leva para a tela onde a operação realmente resolve o problema.
 */
function AttentionGroup({
  group,
  onOpenItem,
  onOpenList,
}: {
  group: AttentionGroupDTO;
  onOpenItem: (item: AttentionItemDTO) => void;
  onOpenList: () => void;
}) {
  // Pendência escondida atrás de um clique é pendência que ninguém vê. Grupo
  // curto já abre; só o volumoso começa recolhido, para o painel não virar
  // uma parede.
  const [expanded, setExpanded] = useState(group.items.length > 0 && group.items.length <= 5);

  return (
    <div className="dash-attention__group">
      <button
        type="button"
        className="dash-attention__group-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={severityBadgeClass(group.severity)}>
          {ATTENTION_SEVERITY_LABELS[group.severity]}
        </span>
        <span className="dash-attention__group-title">{ATTENTION_TYPE_LABELS[group.type]}</span>
        <span className="dash-attention__group-count">
          {group.count} {group.count === 1 ? "item" : "itens"}
        </span>
        <span className="dash-attention__group-toggle" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="dash-attention__group-body">
          {group.items.map((item) => (
            <AttentionRow
              key={`${item.type}-${item.targetId}`}
              item={item}
              onOpen={() => onOpenItem(item)}
            />
          ))}
          {group.count > group.items.length && (
            <p className="dash-attention__more">
              Mostrando {group.items.length} de {group.count}.
            </p>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenList}>
            Ver todos
          </button>
        </div>
      )}
    </div>
  );
}

function AttentionRow({ item, onOpen }: { item: AttentionItemDTO; onOpen: () => void }) {
  return (
    <button type="button" className="dash-attention__row" onClick={onOpen}>
      <span className={severityBadgeClass(item.severity)}>
        {ATTENTION_SEVERITY_LABELS[item.severity]}
      </span>
      <span className="dash-attention__desc">
        {item.description}
        <span className="dash-attention__type">{ATTENTION_TYPE_LABELS[item.type]}</span>
      </span>
      <span className="dash-attention__code">{item.code}</span>
      <span className="dash-attention__date">{formatDate(item.relevantDate)}</span>
    </button>
  );
}

/**
 * Dashboard executivo/operacional — cockpit, não BI.
 *
 * Nunca é fonte de verdade: tudo é derivado ao vivo do read model
 * `GET /dashboard`. Estado atual e período são blocos separados — trocar o
 * filtro de período não altera o que está aberto agora na operação.
 */
/**
 * Atalhos para o começo dos fluxos operacionais.
 *
 * São LINKS para as telas onde a criação acontece com todas as validações
 * — nunca um atalho que pula pré-condição. O backend continua sendo a
 * autoridade; aqui só se evita esconder a ação do usuário certo.
 */
const QUICK_ACTIONS: { label: string; path: string; roles: UserRole[] }[] = [
  { label: "Novo projeto", path: "/comercial/projetos?novo=1", roles: ["COMMERCIAL", "ADMIN"] },
  { label: "Novo pedido", path: "/comercial/pedidos/novo", roles: ["COMMERCIAL", "ADMIN"] },
  { label: "Nova ordem de produção", path: "/producao/ordens", roles: ["PRODUCTION", "ADMIN"] },
  {
    label: "Novo recebimento",
    path: "/compras/recebimentos",
    roles: ["PURCHASING", "QUALITY", "ADMIN"],
  },
  // Duas filas distintas, e a Qualidade usa as duas: o laudo (CoA) e a
  // liberação do lote para uso. Uma só entrada mandava quem precisava
  // liberar para a tela do laudo.
  { label: "Laudos / CoA", path: "/qualidade/documentos", roles: ["QUALITY", "ADMIN"] },
  {
    label: "Lotes aguardando liberação",
    path: "/estoque/lotes?status=AWAITING_RELEASE",
    roles: ["QUALITY", "ADMIN"],
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const quickActions = QUICK_ACTIONS.filter(
    (action) => !user || action.roles.includes(user.role),
  );

  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [customFrom, setCustomFrom] = useState(dateInputValueOffset(-6));
  const [customTo, setCustomTo] = useState(dateInputValueOffset(0));
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(
    () => resolvePeriodBounds(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    getDashboard(bounds.from, bounds.to)
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar o dashboard");
      })
      .finally(() => setLoading(false));
  }, [bounds]);

  useEffect(() => {
    reload();
  }, [reload]);

  const period = data?.period;
  const state = data?.currentState;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Dashboard</h1>
          <p className="page__subtitle">
            Visão operacional ao vivo. Nenhum número é armazenado aqui — tudo vem dos documentos.
          </p>
        </div>
      </div>

      {/* O filtro de período fica logo abaixo e não vale para metade da tela.
          É a primeira coisa que confunde, e por isso a explicação vem antes
          do filtro, não depois dos cartões. */}
      <ContextHelp topic={helpTopics["painel.comoFunciona"]} />

      <div className="dash-filter">
        <span className="dash-filter__label">Período:</span>
        {(Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[]).map((option) => (
          <button
            key={option}
            type="button"
            className={preset === option ? "btn btn--primary btn--sm" : "btn btn--secondary btn--sm"}
            onClick={() => setPreset(option)}
          >
            {PERIOD_PRESET_LABELS[option]}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <label className="sr-only" htmlFor="dash-from">
              Data inicial
            </label>
            <input
              id="dash-from"
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <label className="sr-only" htmlFor="dash-to">
              Data final
            </label>
            <input
              id="dash-to"
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </>
        )}
      </div>

      <section className="dash-section">
        <div className="dash-section__head">
          <h2>Ações rápidas</h2>
          <span className="dash-section__hint">Início dos fluxos mais usados no dia a dia</span>
        </div>
        <div className="dash-quick">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => navigate(action.path)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="form-alert" role="alert">{error}</p>}
      {loading && !data && <p className="muted">Carregando…</p>}

      {data && period && state && (
        <>
          {/* PRECISA DE ATENÇÃO vem antes de qualquer número bonito: é o que
              muda a decisão do operador hoje. */}
          <section className="dash-section">
            <div className="dash-section__head">
              <h2>Precisa de atenção</h2>
              <span className="dash-section__hint">
                Estado atual — não depende do período selecionado
              </span>
            </div>
            <div className="dash-attention">
              {data.attentionGroups.length === 0 && (
                <p className="dash-attention__empty">Nada exigindo atenção agora.</p>
              )}
              {data.attentionGroups.map((group) => (
                <AttentionGroup
                  key={group.type}
                  group={group}
                  onOpenItem={(item) => navigate(attentionPath(item.targetKind, item.targetId))}
                  onOpenList={() => navigate(ATTENTION_LIST_PATH[group.type])}
                />
              ))}
            </div>
          </section>

          <section className="dash-section">
            <div className="dash-section__head">
              <h2>No período</h2>
              <span className="dash-section__hint">
                {formatDate(period.from)} até {formatDate(period.to)} — contagem de documentos
              </span>
            </div>
            <div className="dash-cards">
              <article className="dash-card">
                <div className="dash-card__label">Pedidos criados</div>
                <div className="dash-card__value">{period.customerOrdersCreated}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Recebimentos</div>
                <div className="dash-card__value">{period.receiptsCompleted}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">OPs concluídas</div>
                <div className="dash-card__value">{period.productionOrdersCompleted}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Expedições</div>
                <div className="dash-card__value">{period.shipmentsConfirmed}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Faturamentos emitidos</div>
                <div className="dash-card__value">{period.billingsIssued}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Valor faturado</div>
                {period.billedAmount === null ? (
                  <>
                    {/* Soma parcial jamais é apresentada como total. */}
                    <div className="dash-card__value dash-card__value--unavailable">
                      Valores incompletos
                    </div>
                    <div className="dash-card__note">
                      {period.billingsWithCompletePricing} de {period.billingsIssued} documentos com
                      preço completo.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dash-card__value">{formatBRL(period.billedAmount)}</div>
                    <div className="dash-card__note">
                      {period.billingsIssued} documentos, todos com preço completo.
                    </div>
                  </>
                )}
              </article>
            </div>
          </section>

          <section className="dash-section">
            <div className="dash-section__head">
              <h2>Operação atual</h2>
              <span className="dash-section__hint">Situação de agora — independente do período</span>
            </div>
            <div className="dash-state">
              <article className="dash-state__block">
                <h3>Comercial</h3>
                <StateLine label="Pedidos confirmados" value={state.commercial.confirmedOrders} />
                <StateLine label="Em atendimento" value={state.commercial.inFulfillmentOrders} />
                <StateLine
                  label="Parcialmente expedidos"
                  value={state.commercial.partiallyShippedOrders}
                />
                <StateLine
                  label="Aguardando expedição"
                  value={state.commercial.ordersAwaitingShipment}
                />
                <StateLine
                  label="Expedições a faturar"
                  value={state.commercial.shipmentsAwaitingBilling}
                />
              </article>

              <article className="dash-state__block">
                <h3>Produção</h3>
                <StateLine label="Rascunho" value={state.production.draft} />
                <StateLine label="Planejadas" value={state.production.planned} />
                <StateLine label="Liberadas" value={state.production.released} />
                <StateLine label="Em produção" value={state.production.inProduction} />
                <StateLine label="Com falta de material" value={state.production.withShortage} />
                <StateLine
                  label="Concluídas com custo incompleto"
                  value={state.production.completedWithIncompleteCost}
                />
              </article>

              <article className="dash-state__block">
                <h3>Compras</h3>
                <StateLine label="Ordens abertas" value={state.purchasing.openOrders} />
                <StateLine
                  label="Recebidas parcialmente"
                  value={state.purchasing.partiallyReceived}
                />
                <StateLine label="Atrasadas" value={state.purchasing.lateOrders} />
                {/* Itens distintos: kg e un nunca viram um total só. */}
                <StateLine label="Itens em compra" value={state.purchasing.itemsOnOrder} />
              </article>

              <article className="dash-state__block">
                <h3>Estoque &amp; Qualidade</h3>
                <StateLine
                  label="Lotes aguardando Qualidade"
                  value={state.inventory.lotsAwaitingQuality}
                />
                <StateLine label="Lotes bloqueados" value={state.inventory.lotsBlocked} />
                <StateLine label="Lotes vencidos com saldo" value={state.inventory.lotsExpired} />
                <StateLine label="Vencem em 30 dias" value={state.inventory.lotsNearExpiry} />
              </article>
            </div>
          </section>

          <section className="dash-section">
            <div className="dash-section__head">
              <h2>Movimentações</h2>
              <span className="dash-section__hint">Contagem de eventos no período</span>
            </div>
            <div className="dash-cards">
              <article className="dash-card">
                <div className="dash-card__label">Entradas por recebimento</div>
                <div className="dash-card__value">{data.movementSummary.receiptIn}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Consumos de produção</div>
                <div className="dash-card__value">{data.movementSummary.productionConsumption}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Consumos em amostra</div>
                <div className="dash-card__value">{data.movementSummary.sampleConsumption}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Entradas por produção</div>
                <div className="dash-card__value">
                  {data.movementSummary.finishedGoodProduction}
                </div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Saídas por expedição</div>
                <div className="dash-card__value">{data.movementSummary.shipmentOut}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Ajustes</div>
                <div className="dash-card__value">{data.movementSummary.adjustments}</div>
              </article>
              <article className="dash-card">
                <div className="dash-card__label">Perdas</div>
                <div className="dash-card__value">{data.movementSummary.loss}</div>
              </article>
            </div>

            {data.movementActivity.length > 0 && (
              <div style={{ marginTop: "var(--sp-3)" }}>
                <MovementActivityChart points={data.movementActivity} />
              </div>
            )}

            <div className="table-container table-container--spaced">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Tipo</th>
                    <th>Item</th>
                    <th>Lote</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentMovements.map((movement) => {
                    const path = movementPath(movement);
                    return (
                      <tr key={movement.id}>
                        <td>{formatDateTime(movement.occurredAt)}</td>
                        <td>
                          {INVENTORY_MOVEMENT_TYPE_LABELS[movement.type as InventoryMovementType] ??
                            movement.type}
                        </td>
                        <td>
                          <EntityLink kind="item" id={movement.itemId} code={movement.itemCode} name={movement.itemName} />
                        </td>
                        <td className="is-code">{movement.lotCode ?? "—"}</td>
                        {/* Cada linha traz a própria unidade — nada é somado entre linhas. */}
                        <td className="is-numeric">
                          {formatQuantity(movement.quantity)} {movement.unitCode}
                        </td>
                        <td>
                          {movement.sourceCode && path ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => navigate(path)}
                            >
                              {movement.sourceCode}
                            </button>
                          ) : (
                            (movement.sourceCode ?? "—")
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {data.recentMovements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table__empty">
                        Nenhuma movimentação no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
