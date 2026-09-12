import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProductionOrderDTO,
  ProductionOrderScheduleDTO,
  ProductionPlan,
} from "@veridi/shared";
import {
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  planProductionProfileSnapshot,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { applyProductionProfile } from "../../lib/production-orders-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDateTime } from "../../lib/dates";
import { formatMinutes } from "../../lib/duration";
import { formatQuantity } from "../../lib/quantity";
import {
  getProductionOrderSchedule,
  unscheduleProductionOrder,
} from "../../lib/production-schedules-api";
import { ScheduleOrderDialog } from "../planning/ScheduleOrderDialog";
import "../planning/planning.css";

/**
 * PLANEJAMENTO PREVISTO da OP — PLANNING-OP-SNAPSHOT-01, §89.
 *
 * Mostra a CÓPIA do Perfil de Produção que a ordem congelou, projetada para a
 * quantidade da OP. O tempo não vem gravado: é o motor canônico
 * (`planProductionProfileSnapshot`) aplicado à mesma cópia — a mesma conta do
 * servidor, aqui só para acompanhar a quantidade enquanto ela é digitada.
 *
 * Não é custo: horas-recurso são demanda de capacidade, e Estrutura de
 * Custos/CMV/Precificação seguem em outro lugar.
 */

interface Props {
  order: ProductionOrderDTO;
  /** Quantidade que está no campo agora — em rascunho ela muda antes de salvar. */
  quantityDraft: string;
  onApplied: (order: ProductionOrderDTO) => void;
}

export function ProductionPlanningSection({ order, quantityDraft, onApplied }: Props) {
  const { snapshot, plan: planSalvo, availableProfile, canApply, canUpdate } = order.planning;
  const [confirmarAtualizacao, setConfirmarAtualizacao] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * A PROGRAMAÇÃO da ordem — quando ela está prevista para acontecer
   * (PLANNING-CAPACITY-BOARD-01). Fica ao lado do planejamento previsto
   * porque responde à pergunta seguinte: o roteiro diz quanto trabalho há,
   * a programação diz quando ele acontece.
   */
  /*
   * Gate por SITUAÇÃO, como o resto desta tela — o perfil de acesso é
   * cobrado pelo servidor (ADMIN e PRODUCTION), que é onde a regra mora.
   * Ler a sessão aqui obrigaria toda a árvore da Ordem a viver dentro do
   * AuthProvider, e ela não vive.
   */
  const podeProgramar = ["DRAFT", "PLANNED", "RELEASED"].includes(order.status);
  const [agenda, setAgenda] = useState<ProductionOrderScheduleDTO | null>(null);
  const [abrindoAgenda, setAbrindoAgenda] = useState(false);
  const [feitoAgenda, setFeitoAgenda] = useState<string | null>(null);

  const carregarAgenda = useCallback(() => {
    getProductionOrderSchedule(order.id)
      .then((resposta) => setAgenda(resposta.schedule))
      .catch(() => setAgenda(null));
  }, [order.id]);

  useEffect(() => carregarAgenda(), [carregarAgenda]);

  /*
   * Rascunho recalcula ao vivo: mudar a quantidade refaz a projeção usando a
   * MESMA cópia congelada — nunca recopia o perfil. Quantidade ilegível cai
   * para o que o servidor já devolveu, e travessão quando nem isso existe.
   */
  const plan: ProductionPlan | null = useMemo(() => {
    if (!snapshot) return null;
    if (order.status !== "DRAFT") return planSalvo;
    const alvo = quantityDraft.trim().replace(",", ".");
    if (alvo === "") return planSalvo;
    try {
      return planProductionProfileSnapshot(snapshot, alvo);
    } catch {
      return planSalvo;
    }
  }, [snapshot, planSalvo, order.status, quantityDraft]);

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      onApplied(await applyProductionProfile(order.id));
      setConfirmarAtualizacao(false);
    } catch (error) {
      setErro(apiErrorMessage(error, "Não foi possível aplicar o roteiro de produção."));
    } finally {
      setAplicando(false);
    }
  }

  const quantidadeExibida = plan ? plan.quantity : order.plannedQuantity;

  return (
    <FormSection
      title="Planejamento previsto"
      subtitle={
        snapshot
          ? "Cópia do roteiro de produção congelada nesta ordem. Ativar uma versão nova do roteiro não altera o que está aqui."
          : "Cópia do roteiro de produção do produto, tirada na criação da ordem."
      }
    >
      {erro && <p className="form-error">{erro}</p>}

      {/* A programação só existe quando há roteiro: sem etapas não há o que
          posicionar no tempo. */}
      {snapshot && (
        <div className="schedule-block">
          <h4 className="profile-subtitle">Programação</h4>
          {agenda ? (
            <dl className="profile-summary" role="group" aria-label="Programação da ordem">
              <div>
                <dt>Início previsto</dt>
                <dd>{formatDateTime(agenda.plannedStartAt)}</dd>
              </div>
              <div>
                <dt>Fim previsto</dt>
                <dd>{formatDateTime(agenda.plannedEndAt)}</dd>
              </div>
              <div>
                <dt>Duração útil</dt>
                <dd>{formatMinutes(agenda.workingMinutes)}</dd>
              </div>
              <div>
                <dt>Programada em</dt>
                <dd>
                  {formatDateTime(agenda.scheduledAt)}
                  {agenda.scheduledBy ? ` por ${agenda.scheduledBy}` : ""}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="field__hint">
              Sem início previsto. Definir o início projeta as etapas sobre a jornada da fábrica.
            </p>
          )}

          <div className="form-actions">
            <div className="form-actions__group">
              {podeProgramar && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setAbrindoAgenda(true)}
                >
                  {agenda ? "Reprogramar" : "Definir início previsto"}
                </button>
              )}
              {podeProgramar && agenda && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void unscheduleProductionOrder(order.id)
                      .then(() => {
                        setAgenda(null);
                        setFeitoAgenda("Programação removida.");
                      })
                      .catch((err: unknown) =>
                        setErro(apiErrorMessage(err, "Não foi possível remover a programação.")),
                      )
                  }
                >
                  Tirar programação
                </button>
              )}
              {feitoAgenda && (
                <span className="form-status" role="status">
                  {feitoAgenda}
                </span>
              )}
            </div>
          </div>

          {abrindoAgenda && (
            <ScheduleOrderDialog
              orderId={order.id}
              orderCode={order.code}
              status={order.status}
              currentStartAt={agenda?.plannedStartAt ?? null}
              onClose={() => setAbrindoAgenda(false)}
              onSaved={(gravada) => {
                setAgenda(gravada);
                setAbrindoAgenda(false);
                setFeitoAgenda("Programação salva.");
              }}
            />
          )}
        </div>
      )}

      {!snapshot && (
        <>
          <p className="field__hint">Sem roteiro de produção aplicado.</p>
          {canApply && availableProfile && (
            <p>
              <button type="button" className="btn btn--ghost" disabled={aplicando} onClick={aplicar}>
                Aplicar roteiro de produção
              </button>{" "}
              <span className="field__hint">
                {availableProfile.profileCode} · V{availableProfile.versionNumber} —{" "}
                {availableProfile.profileName}
              </span>
            </p>
          )}
        </>
      )}

      {snapshot && (
        <>
          <dl className="profile-preview__values">
            <div>
              <dt>Perfil</dt>
              <dd>
                {snapshot.sourceProfileCode} · V{snapshot.sourceVersionNumber}
                <br />
                <span className="field__hint">{snapshot.sourceProfileName}</span>
              </dd>
            </div>
            <div>
              <dt>Quantidade</dt>
              <dd>
                {formatQuantity(quantidadeExibida)} {order.outputUnitCode}
              </dd>
            </div>
            <div>
              <dt>Tempo sequencial previsto</dt>
              <dd>{plan ? formatMinutes(plan.totalDurationMinutes) : "—"}</dd>
            </div>
          </dl>

          {canUpdate && availableProfile && (
            <p className="field__hint">
              Há uma versão mais recente do roteiro disponível ({availableProfile.profileCode} · V
              {availableProfile.versionNumber}).{" "}
              <button
                type="button"
                className="btn btn--ghost"
                disabled={aplicando}
                onClick={() => setConfirmarAtualizacao(true)}
              >
                Atualizar roteiro
              </button>
            </p>
          )}

          <h4 className="profile-subtitle">Etapas</h4>
          {plan ? (
            <ol className="profile-preview__steps">
              {plan.steps.map((etapa) => {
                const daCopia = snapshot.steps.find((passo) => passo.sequence === etapa.sequence);
                return (
                  <li key={etapa.sequence} className="profile-preview__step">
                    <p className="profile-preview__name">
                      {etapa.sequence}. {etapa.name}{" "}
                      <span className="field__hint">
                        {PRODUCTION_STEP_SCALING_MODE_LABELS[etapa.scalingMode]}
                        {etapa.batches !== null
                          ? ` · ${etapa.batches} ${etapa.batches === 1 ? "lote" : "lotes"}`
                          : ""}
                      </span>
                    </p>
                    {daCopia?.description && <p className="field__hint">{daCopia.description}</p>}
                    <dl className="profile-preview__values">
                      <div>
                        <dt>Preparação</dt>
                        <dd>{formatMinutes(etapa.setupMinutes)}</dd>
                      </div>
                      <div>
                        <dt>Execução</dt>
                        <dd>{formatMinutes(etapa.runMinutes)}</dd>
                      </div>
                      <div>
                        <dt>Duração</dt>
                        <dd>{formatMinutes(etapa.durationMinutes)}</dd>
                      </div>
                    </dl>
                    {etapa.resources.length > 0 && (
                      <ul className="profile-preview__resources">
                        {etapa.resources.map((recurso) => (
                          <li key={recurso.industrialResourceId}>
                            {recurso.resourceQuantity} × {recurso.resourceName}:{" "}
                            {formatMinutes(recurso.demandMinutes)} de recurso
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="field__hint">
              Não foi possível projetar o tempo para esta quantidade.
            </p>
          )}

          {plan && plan.resources.length > 0 && (
            <>
              <h4 className="profile-subtitle">Recursos necessários</h4>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Recurso</th>
                      <th className="is-numeric">Horas-recurso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.resources.map((recurso) => (
                      <tr key={recurso.industrialResourceId}>
                        <td>{recurso.resourceName}</td>
                        <td className="is-numeric">{formatMinutes(recurso.demandMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field__hint">
                Demanda de capacidade — quanto cada recurso fica ocupado, preparação incluída.
              </p>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmarAtualizacao}
        title="Atualizar roteiro de produção?"
        confirmTone="accent"
        confirmLabel="Atualizar roteiro de produção"
        message={
          <p>
            O planejamento previsto desta ordem passa a ser a cópia de{" "}
            {availableProfile
              ? `${availableProfile.profileCode} · V${availableProfile.versionNumber}`
              : "—"}
            . As etapas e os tempos atuais são substituídos.
          </p>
        }
        onConfirm={aplicar}
        onCancel={() => setConfirmarAtualizacao(false)}
      />
    </FormSection>
  );
}
