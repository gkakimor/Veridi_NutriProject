import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ProductionBoardOrderDTO,
  ProductionBoardResponse,
  ProductionBoardView,
} from "@veridi/shared";
import {
  AVISO_DE_AGENDA_LABELS,
  DIAS_DA_SEMANA,
  PRODUCTION_ORDER_STATUS_LABELS,
  diaCivilDeslocado,
  diaDaSemanaComercial,
  hojeComercial,
} from "@veridi/shared";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { useAuth } from "../../app/AuthProvider";
import { useListFilters } from "../../lib/list-filters";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDateTime } from "../../lib/dates";
import { formatMinutes } from "../../lib/duration";
import { formatQuantity } from "../../lib/quantity";
import { getProductionBoard } from "../../lib/production-schedules-api";
import { listProducts } from "../../lib/products-api";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { ScheduleOrderDialog } from "./ScheduleOrderDialog";
import "./planning.css";

/**
 * Planejamento → Planejamento de Produção (PLANNING-CAPACITY-BOARD-01).
 *
 * A pergunta desta tela é uma só: o que está previsto para este período, e
 * onde há conflito. Ela junta o Roteiro (quanto trabalho existe), o Calendário
 * (quando a fábrica trabalha) e a capacidade do recurso (quantos existem).
 *
 * O que ela NÃO faz, de propósito: não agenda sozinha, não prioriza, não
 * arrasta cartão e não empurra ordem por causa de conflito. Conflito é AVISO —
 * quem planeja decide.
 */

const VISOES: { valor: ProductionBoardView; rotulo: string }[] = [
  { valor: "DAY", rotulo: "Dia" },
  { valor: "WEEK", rotulo: "Semana" },
];

/** A segunda-feira da semana comercial de um dia. */
function segundaDaSemana(diaISO: string): string {
  const indice = DIAS_DA_SEMANA.indexOf(diaDaSemanaComercial(diaISO));
  return diaCivilDeslocado(diaISO, -indice);
}

function periodoDaVisao(diaISO: string, visao: ProductionBoardView): { from: string; to: string } {
  if (visao === "DAY") return { from: diaISO, to: diaISO };
  const segunda = segundaDaSemana(diaISO);
  return { from: segunda, to: diaCivilDeslocado(segunda, 6) };
}

function diaPorExtenso(diaISO: string): string {
  const [ano, mes, dia] = diaISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Avisos numa linha só — a tabela não vira parágrafo. */
function Avisos({ avisos }: { avisos: ProductionBoardOrderDTO["warnings"] }) {
  if (avisos.length === 0) return <span className="field__hint">—</span>;
  return (
    <span className="board-warnings">
      {avisos.map((aviso, indice) => (
        <span key={`${aviso.tipo}-${indice}`} className="badge badge--warn" title={aviso.texto}>
          {AVISO_DE_AGENDA_LABELS[aviso.tipo]}
        </span>
      ))}
    </span>
  );
}

export function ProductionBoardPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";
  const hoje = useMemo(() => hojeComercial(), []);

  const filtros = useListFilters({
    defaults: {
      view: "WEEK",
      dia: hoje,
      status: "",
      productId: "",
      industrialResourceId: "",
    },
    persistScope: "production-board",
    userId: user?.id ?? null,
  });

  const visao = (filtros.values.view === "DAY" ? "DAY" : "WEEK") as ProductionBoardView;
  const periodo = useMemo(
    () => periodoDaVisao(filtros.values.dia, visao),
    [filtros.values.dia, visao],
  );

  const [quadro, setQuadro] = useState<ProductionBoardResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [programando, setProgramando] = useState<ProductionBoardOrderDTO | null>(null);
  const [rotuloProduto, setRotuloProduto] = useState<string | null>(null);
  const [rotuloRecurso, setRotuloRecurso] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    getProductionBoard({
      from: periodo.from,
      to: periodo.to,
      view: visao,
      ...(filtros.values.status ? { status: filtros.values.status } : {}),
      ...(filtros.values.productId ? { productId: filtros.values.productId } : {}),
      ...(filtros.values.industrialResourceId
        ? { industrialResourceId: filtros.values.industrialResourceId }
        : {}),
    })
      .then(setQuadro)
      .catch((err: unknown) => setErro(apiErrorMessage(err, "Falha ao carregar o planejamento")))
      .finally(() => setCarregando(false));
  }, [
    periodo.from,
    periodo.to,
    visao,
    filtros.values.status,
    filtros.values.productId,
    filtros.values.industrialResourceId,
  ]);

  useEffect(() => recarregar(), [recarregar]);

  const fonteDeProduto = useMemo(
    () => ({
      inicial: async () =>
        (await listProducts({ pageSize: 20 })).products.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
        })),
      buscar: async (termo: string) =>
        (await listProducts({ search: termo, pageSize: 20 })).products.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
        })),
      porId: async (id: string) => {
        const achados = (await listProducts({ pageSize: 20 })).products.find((p) => p.id === id);
        return achados ? { id: achados.id, code: achados.code, name: achados.name } : null;
      },
    }),
    [],
  );

  const fonteDeRecurso = useMemo(
    () => ({
      inicial: async () =>
        (await listIndustrialResources({ pageSize: 50, active: true })).resources.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
        })),
      buscar: async (termo: string) =>
        (await listIndustrialResources({ search: termo, pageSize: 50 })).resources.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
        })),
      porId: async (id: string) => {
        const achado = (await listIndustrialResources({ pageSize: 100 })).resources.find(
          (r) => r.id === id,
        );
        return achado ? { id: achado.id, code: achado.code, name: achado.name } : null;
      },
    }),
    [],
  );

  const deslocar = (passos: number) =>
    filtros.set({ dia: diaCivilDeslocado(filtros.values.dia, visao === "DAY" ? passos : passos * 7) });

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Planejamento de Produção</h1>
          <p className="page__subtitle">
            Quando cada ordem está prevista e onde a fábrica fica apertada. O roteiro diz quanto
            trabalho existe, o calendário diz quando a fábrica trabalha e a capacidade diz quantos
            recursos existem. Conflito aqui é aviso: nada é reagendado sozinho.
          </p>
        </div>
      </div>

      <ContextHelp topic={helpTopics["planejamento.quadro"]} />

      {quadro?.calendarWarning && (
        <p className="pendency-panel" role="status">
          <span className="pendency-panel__title">{quadro.calendarWarning}</span>
          <span className="pendency-panel__sub">
            As programações já gravadas continuam valendo. Novas horas exatas esperam por isto —{" "}
            <Link to="/planejamento/calendario">Calendário de Produção</Link>.
          </span>
        </p>
      )}

      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}

      <div className="toolbar">
        <div className="board-period">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => deslocar(-1)}>
            ← Anterior
          </button>
          <span className="board-period__label">
            {periodo.from === periodo.to
              ? diaPorExtenso(periodo.from)
              : `${diaPorExtenso(periodo.from)} a ${diaPorExtenso(periodo.to)}`}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => deslocar(1)}>
            Próximo →
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => filtros.set({ dia: hoje })}
          >
            Hoje
          </button>
        </div>

        <div className="field">
          <label htmlFor="board-view">Visão</label>
          <select
            id="board-view"
            value={visao}
            onChange={(event) => filtros.set({ view: event.target.value })}
          >
            {VISOES.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="board-status">Situação</label>
          <select
            id="board-status"
            value={filtros.values.status}
            onChange={(event) => filtros.set({ status: event.target.value })}
          >
            <option value="">Todas</option>
            {(["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION", "COMPLETED"] as const).map(
              (status) => (
                <option key={status} value={status}>
                  {PRODUCTION_ORDER_STATUS_LABELS[status]}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="field toolbar__entity">
          <EntityFilterSelect
            id="board-product"
            label="Produto"
            placeholder="Produto…"
            value={filtros.values.productId}
            onChange={(id) => filtros.set({ productId: id })}
            source={fonteDeProduto}
            onResolve={(opcao) => setRotuloProduto(opcao ? opcao.name : null)}
          />
        </div>

        <div className="field toolbar__entity">
          <EntityFilterSelect
            id="board-resource"
            label="Recurso"
            placeholder="Recurso…"
            value={filtros.values.industrialResourceId}
            onChange={(id) => filtros.set({ industrialResourceId: id })}
            source={fonteDeRecurso}
            onResolve={(opcao) => setRotuloRecurso(opcao ? opcao.name : null)}
          />
        </div>

        {filtros.isActive && <ClearFilters onClear={filtros.clear} />}
      </div>

      <ActiveFilterChips
        onClear={filtros.clear}
        chips={[
          ...(filtros.values.status
            ? [
                {
                  label: "Situação",
                  value:
                    PRODUCTION_ORDER_STATUS_LABELS[
                      filtros.values.status as keyof typeof PRODUCTION_ORDER_STATUS_LABELS
                    ] ?? filtros.values.status,
                  onRemove: () => filtros.set({ status: "" }),
                },
              ]
            : []),
          ...(filtros.values.productId
            ? [
                {
                  label: "Produto",
                  value: rotuloProduto ?? "Selecionado",
                  onRemove: () => filtros.set({ productId: "" }),
                },
              ]
            : []),
          ...(filtros.values.industrialResourceId
            ? [
                {
                  label: "Recurso",
                  value: rotuloRecurso ?? "Selecionado",
                  onRemove: () => filtros.set({ industrialResourceId: "" }),
                },
              ]
            : []),
        ]}
      />

      {feito && (
        <p className="form-status" role="status">
          {feito}
        </p>
      )}

      {carregando && <p className="field__hint">Carregando…</p>}

      {quadro && !carregando && (
        <>
          <section className="form-section" aria-label="Ordens programadas">
            <h3>Ordens programadas</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>OP</th>
                    <th>Produto</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Situação</th>
                    <th>Início previsto</th>
                    <th>Fim previsto</th>
                    <th className="is-numeric">Duração útil</th>
                    <th>Avisos</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {quadro.orders.map((ordem) => (
                    <tr key={ordem.productionOrderId}>
                      <td>
                        <Link to={`/producao/ordens/${ordem.productionOrderId}`}>
                          <code>{ordem.code}</code>
                        </Link>
                      </td>
                      <td>
                        <code>{ordem.productCode}</code> {ordem.productName}
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(ordem.plannedQuantity)} {ordem.outputUnitCode}
                      </td>
                      <td>
                        {PRODUCTION_ORDER_STATUS_LABELS[
                          ordem.status as keyof typeof PRODUCTION_ORDER_STATUS_LABELS
                        ] ?? ordem.status}
                      </td>
                      <td>{formatDateTime(ordem.plannedStartAt)}</td>
                      <td>{formatDateTime(ordem.plannedEndAt)}</td>
                      <td className="is-numeric">{formatMinutes(ordem.workingMinutes)}</td>
                      <td>
                        <Avisos avisos={ordem.warnings} />
                      </td>
                      <td>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setProgramando(ordem)}
                          >
                            Reprogramar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {quadro.orders.length === 0 && (
                    <tr>
                      <td colSpan={9} className="table__empty">
                        Nenhuma ordem programada neste período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="form-section" aria-label="Sem programação">
            <h3>Sem programação</h3>
            <p className="form-section__sub">
              Ordens abertas que ainda não têm início previsto. Elas não pertencem a nenhum dia do
              quadro — é justamente esta a lista de quem falta programar.
            </p>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>OP</th>
                    <th>Produto</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Situação</th>
                    <th>Avisos</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {quadro.unscheduled.map((ordem) => (
                    <tr key={ordem.productionOrderId}>
                      <td>
                        <Link to={`/producao/ordens/${ordem.productionOrderId}`}>
                          <code>{ordem.code}</code>
                        </Link>
                      </td>
                      <td>
                        <code>{ordem.productCode}</code> {ordem.productName}
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(ordem.plannedQuantity)} {ordem.outputUnitCode}
                      </td>
                      <td>
                        {PRODUCTION_ORDER_STATUS_LABELS[
                          ordem.status as keyof typeof PRODUCTION_ORDER_STATUS_LABELS
                        ] ?? ordem.status}
                      </td>
                      <td>
                        <Avisos avisos={ordem.warnings} />
                      </td>
                      <td>
                        {canEdit && ordem.warnings.length === 0 && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setProgramando(ordem)}
                          >
                            Definir início previsto
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {quadro.unscheduled.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table__empty">
                        Nenhuma ordem aberta esperando programação.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="form-section" aria-label="Capacidade por recurso">
            <h3>Capacidade por recurso</h3>
            <p className="form-section__sub">
              Carga planejada contra o que a fábrica tem no período. A sobrecarga não sai desta
              soma: ela vem do cruzamento real dos trechos trabalhados, logo abaixo.
            </p>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th>Tipo</th>
                    <th className="is-numeric">Capacidade</th>
                    <th className="is-numeric">Carga planejada</th>
                    <th className="is-numeric">Disponível no período</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {quadro.resources.map((recurso) => (
                    <tr key={recurso.industrialResourceId}>
                      <td>
                        <code>{recurso.resourceCode}</code> {recurso.resourceName}
                      </td>
                      <td>{recurso.resourceType === "LABOR" ? "Mão de obra" : "Equipamento"}</td>
                      <td className="is-numeric">
                        {recurso.capacityQuantity ?? "Capacidade não cadastrada"}
                      </td>
                      <td className="is-numeric">{formatMinutes(recurso.plannedMinutes)}</td>
                      <td className="is-numeric">
                        {recurso.availableMinutes === null
                          ? "—"
                          : formatMinutes(recurso.availableMinutes)}
                      </td>
                      <td>
                        {recurso.situacao === "OK" && <span className="badge badge--active">Ok</span>}
                        {recurso.situacao === "SOBRECARGA" && (
                          <span className="badge badge--warn">Sobrecarga</span>
                        )}
                        {recurso.situacao === "CAPACIDADE_NAO_CADASTRADA" && (
                          <span className="badge badge--neutral">Capacidade não cadastrada</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {quadro.resources.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table__empty">
                        Nenhum recurso de produção com capacidade cadastrada ou carga no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="form-section" aria-label="Conflitos de capacidade">
            <h3>Conflitos de capacidade</h3>
            {quadro.conflicts.length === 0 ? (
              <p className="field__hint">
                Nenhum conflito no período — entre os recursos com capacidade cadastrada.
              </p>
            ) : (
              <ul className="schedule-warnings">
                {quadro.conflicts.map((conflito, indice) => (
                  <li key={`${conflito.industrialResourceId}-${indice}`}>
                    <span className="badge badge--warn">Sobrecarga</span> {conflito.resourceName}:{" "}
                    {conflito.demanda} em uso para capacidade {conflito.capacityQuantity}, de{" "}
                    {formatDateTime(conflito.startAt)} a {formatDateTime(conflito.endAt)} —{" "}
                    {conflito.ordens.map((o) => o.productionOrderCode).join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {programando && (
        <ScheduleOrderDialog
          orderId={programando.productionOrderId}
          orderCode={programando.code}
          status={programando.status}
          currentStartAt={programando.plannedStartAt}
          onClose={() => setProgramando(null)}
          onSaved={() => {
            setProgramando(null);
            setFeito("Programação salva.");
            recarregar();
          }}
        />
      )}
    </>
  );
}
