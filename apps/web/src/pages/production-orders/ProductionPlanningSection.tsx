import { useMemo, useState } from "react";
import type { ProductionOrderDTO, ProductionPlan } from "@veridi/shared";
import {
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  planProductionProfileSnapshot,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { applyProductionProfile } from "../../lib/production-orders-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatMinutes } from "../../lib/duration";
import { formatQuantity } from "../../lib/quantity";
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
      setErro(apiErrorMessage(error, "Não foi possível aplicar o perfil de produção."));
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
          ? "Cópia do perfil de produção congelada nesta ordem. Ativar uma versão nova do perfil não altera o que está aqui."
          : "Cópia do perfil de produção do produto, tirada na criação da ordem."
      }
    >
      {erro && <p className="form-error">{erro}</p>}

      {!snapshot && (
        <>
          <p className="field__hint">Sem perfil de produção aplicado.</p>
          {canApply && availableProfile && (
            <p>
              <button type="button" className="btn btn--ghost" disabled={aplicando} onClick={aplicar}>
                Aplicar perfil de produção
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
              Há uma versão mais recente do perfil disponível ({availableProfile.profileCode} · V
              {availableProfile.versionNumber}).{" "}
              <button
                type="button"
                className="btn btn--ghost"
                disabled={aplicando}
                onClick={() => setConfirmarAtualizacao(true)}
              >
                Atualizar perfil
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
        title="Atualizar perfil de produção?"
        confirmTone="accent"
        confirmLabel="Atualizar perfil de produção"
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
