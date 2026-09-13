import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProductionOrderDTO,
  ProductionOrderScheduleDTO,
  ProductionPlan,
} from "@veridi/shared";
import {
  PRODUCTION_ROUTE_APPLICATION_SOURCE_LABELS,
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  planProductionProfileSnapshotForOrder,
  quantidadeNaUnidadeDoRoteiro,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
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
import { RouteChooserDialog } from "./RouteChooserDialog";
import type { RouteChooserMode } from "./RouteChooserDialog";
import "../planning/planning.css";

/**
 * ROTEIRO DE PRODUÇÃO da OP — PLANNING-OP-SNAPSHOT-01 e
 * PRODUCTION-ROUTE-ASSIGNMENT-01, §89.
 *
 * Sem roteiro a ordem existe, mas não planeja, não programa e não libera: o
 * bloco diz isso e oferece o caminho — o padrão atual do Produto ou outro
 * roteiro escolhido. Com roteiro, mostra a cópia congelada, projetada para a
 * quantidade da ordem CONVERTIDA para a unidade do roteiro — a mesma conta do
 * servidor (`planProductionProfileSnapshotForOrder`), aqui só para acompanhar a
 * quantidade enquanto ela é digitada.
 *
 * Quem aplica ou troca é Produção e Administração; os outros perfis leem. O
 * servidor continua sendo a autoridade.
 */

interface Props {
  order: ProductionOrderDTO;
  /** Quantidade que está no campo agora — em rascunho ela muda antes de salvar. */
  quantityDraft: string;
  onApplied: (order: ProductionOrderDTO) => void;
  /** Produção e Administração: aplicar, trocar e programar. */
  canOperate: boolean;
  /** Chegou por "Resolver": o bloco entra em foco. */
  focus?: boolean;
}

export function ProductionPlanningSection({
  order,
  quantityDraft,
  onApplied,
  canOperate,
  focus = false,
}: Props) {
  const planning = order.planning;
  const { snapshot, plan: planSalvo, productDefaultProfile } = planning;
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState<{
    mode: RouteChooserMode;
    initialVersionId: string | null;
  } | null>(null);
  const tituloRef = useRef<HTMLDivElement>(null);

  /*
   * A PROGRAMAÇÃO da ordem — quando ela está prevista para acontecer
   * (PLANNING-CAPACITY-BOARD-01). O roteiro diz quanto trabalho há; a
   * programação diz quando ele acontece.
   */
  const podeProgramar = canOperate && ["DRAFT", "PLANNED", "RELEASED"].includes(order.status);
  const [agenda, setAgenda] = useState<ProductionOrderScheduleDTO | null>(null);
  const [abrindoAgenda, setAbrindoAgenda] = useState(false);

  const carregarAgenda = useCallback(() => {
    getProductionOrderSchedule(order.id)
      .then((resposta) => setAgenda(resposta.schedule))
      .catch(() => setAgenda(null));
  }, [order.id]);

  useEffect(() => carregarAgenda(), [carregarAgenda]);

  useEffect(() => {
    if (!focus) return;
    const alvo = tituloRef.current;
    // jsdom não implementa `scrollIntoView`; no navegador ele existe sempre.
    alvo?.scrollIntoView?.({ block: "start" });
    alvo?.focus({ preventScroll: true });
  }, [focus]);

  /*
   * Rascunho recalcula ao vivo: mudar a quantidade refaz a projeção usando a
   * MESMA cópia, convertida para a unidade do roteiro. Quantidade ilegível cai
   * para o que o servidor já devolveu, e travessão quando nem isso existe.
   */
  const pedido = useMemo(() => {
    const digitada = quantityDraft.trim().replace(",", ".");
    return order.status === "DRAFT" && digitada !== "" ? digitada : order.plannedQuantity;
  }, [quantityDraft, order.status, order.plannedQuantity]);

  const plan: ProductionPlan | null = useMemo(() => {
    if (!snapshot) return null;
    if (order.status !== "DRAFT") return planSalvo;
    try {
      return planProductionProfileSnapshotForOrder(
        snapshot,
        { quantity: pedido, unitCode: order.outputUnitCode },
        planning.conversionUnits,
      );
    } catch {
      return planSalvo;
    }
  }, [snapshot, planSalvo, order.status, order.outputUnitCode, pedido, planning.conversionUnits]);

  const quantidadeNaReferencia = useMemo(() => {
    if (!snapshot || snapshot.referenceUomCode === order.outputUnitCode) return null;
    try {
      return quantidadeNaUnidadeDoRoteiro(
        snapshot.referenceUomCode,
        { quantity: pedido, unitCode: order.outputUnitCode },
        planning.conversionUnits,
      );
    } catch {
      return planning.quantityInReferenceUom;
    }
  }, [snapshot, pedido, order.outputUnitCode, planning.conversionUnits, planning.quantityInReferenceUom]);

  async function aplicarPadraoAtual() {
    setAplicando(true);
    setErro(null);
    setFeito(null);
    try {
      onApplied(await applyProductionProfile(order.id, { expectedSourceVersionId: null }));
      setFeito("Roteiro aplicado.");
    } catch (error) {
      setErro(apiErrorMessage(error, "Não foi possível aplicar o roteiro de produção."));
    } finally {
      setAplicando(false);
    }
  }

  const pendente = planning.routePending;
  const regularizacao = planning.requiresLegacyRepair;
  const titulo = snapshot
    ? "Roteiro de produção aplicado"
    : pendente
      ? "Roteiro de produção — Pendente"
      : "Roteiro de produção";

  /* Aplicar o padrão direto só quando não há nada a confirmar nem motivo a pedir. */
  const padraoDireto = planning.canApply && !regularizacao && agenda === null;

  return (
    <div id="roteiro" ref={tituloRef} tabIndex={-1} className="route-block">
      <FormSection
        title={titulo}
        subtitle={
          snapshot
            ? "Cópia do roteiro congelada nesta ordem. Mudar o roteiro padrão do produto, ou ativar uma versão nova, não altera o que está aqui."
            : "Etapas, tempos e recursos de fabricação desta ordem."
        }
      >
        {erro && (
          <p className="form-alert" role="alert">
            {erro}
          </p>
        )}
        {feito && (
          <p className="form-status" role="status">
            {feito}
          </p>
        )}

        {!snapshot && (
          <>
            {pendente ? (
              <p className="callout">
                Esta ordem ainda não possui etapas, tempos e recursos de fabricação definidos. Aplique um
                roteiro antes de planejar, programar ou liberar a produção.
              </p>
            ) : (
              <p className="field__hint">
                Ordem sem roteiro registrado. Em produção, concluída ou cancelada, ela fica como está.
              </p>
            )}

            <dl className="profile-summary route-block__facts" role="group" aria-label="Roteiro do produto">
              <div>
                <dt>Produto</dt>
                <dd>
                  {order.productCode} — {order.productName}
                </dd>
              </div>
              <div>
                <dt>Roteiro padrão</dt>
                <dd>
                  {productDefaultProfile
                    ? `${productDefaultProfile.profileName} · V${productDefaultProfile.versionNumber}`
                    : "Não definido."}
                  {productDefaultProfile && !planning.productDefaultCompatible && (
                    <span className="field__hint">
                      {" "}
                      — em {productDefaultProfile.referenceUomCode}, não converte para {order.outputUnitCode}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            {regularizacao && (
              <p className="field__hint">
                Esta ordem já saiu do rascunho sem roteiro. Aplicar agora é regularização: pede confirmação e
                motivo, e depois o roteiro não muda mais.
              </p>
            )}

            {canOperate && planning.canChoose && (
              <div className="route-block__actions">
                {planning.canApply && (
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={aplicando}
                    onClick={() =>
                      padraoDireto
                        ? void aplicarPadraoAtual()
                        : setEscolhendo({
                            mode: regularizacao ? "regularizacao" : "primeira",
                            initialVersionId: productDefaultProfile?.versionId ?? null,
                          })
                    }
                  >
                    {aplicando ? "Aplicando…" : "Aplicar roteiro padrão atual"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={aplicando}
                  onClick={() =>
                    setEscolhendo({
                      mode: regularizacao ? "regularizacao" : "primeira",
                      initialVersionId: null,
                    })
                  }
                >
                  {planning.canApply ? "Escolher outro roteiro" : "Escolher roteiro para esta OP"}
                </button>
              </div>
            )}
          </>
        )}

        {snapshot && (
          <>
            <dl className="profile-preview__values route-block__facts">
              <div>
                <dt>Roteiro</dt>
                <dd>
                  {snapshot.sourceProfileCode} · V{snapshot.sourceVersionNumber}
                  <br />
                  <span className="field__hint">{snapshot.sourceProfileName}</span>
                </dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd>
                  {formatQuantity(pedido)} {order.outputUnitCode}
                  {quantidadeNaReferencia !== null && (
                    <>
                      <br />
                      <span className="field__hint">
                        = {formatQuantity(quantidadeNaReferencia)} {snapshot.referenceUomCode} na unidade do roteiro
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Tempo sequencial previsto</dt>
                <dd>{plan ? formatMinutes(plan.totalDurationMinutes) : "—"}</dd>
              </div>
              <div>
                <dt>Aplicado</dt>
                <dd>
                  {planning.appliedAt ? formatDateTime(planning.appliedAt) : "—"}
                  {planning.appliedBy ? ` por ${planning.appliedBy}` : ""}
                  <br />
                  <span className="field__hint">
                    {planning.applicationSource
                      ? PRODUCTION_ROUTE_APPLICATION_SOURCE_LABELS[planning.applicationSource]
                      : "Origem não registrada"}
                    {planning.applicationReason ? ` — motivo: ${planning.applicationReason}` : ""}
                  </span>
                </dd>
              </div>
            </dl>

            {planning.planBlockedReason && (
              <p className="form-alert" role="alert">
                A unidade desta ordem ({order.outputUnitCode}) não converte para a unidade do roteiro (
                {snapshot.referenceUomCode}): os tempos não podem ser calculados.
              </p>
            )}

            {planning.canUpdate && planning.availableProfile && (
              <p className="field__hint">
                Há uma versão mais recente do roteiro padrão ({planning.availableProfile.profileCode} · V
                {planning.availableProfile.versionNumber}).
              </p>
            )}

            {canOperate && planning.canChoose && (
              <div className="route-block__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() =>
                    setEscolhendo({
                      mode: "troca",
                      initialVersionId: planning.canUpdate ? (planning.availableProfile?.versionId ?? null) : null,
                    })
                  }
                >
                  Alterar roteiro
                </button>
              </div>
            )}

            {/* A programação só existe quando há roteiro: sem etapas não há o que
                posicionar no tempo. */}
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

              {podeProgramar && (
                <div className="form-actions">
                  <div className="form-actions__group">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => setAbrindoAgenda(true)}
                    >
                      {agenda ? "Reprogramar" : "Definir início previsto"}
                    </button>
                    {agenda && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          void unscheduleProductionOrder(order.id)
                            .then(() => {
                              setAgenda(null);
                              setFeito("Programação removida.");
                            })
                            .catch((err: unknown) =>
                              setErro(apiErrorMessage(err, "Não foi possível remover a programação.")),
                            )
                        }
                      >
                        Tirar programação
                      </button>
                    )}
                  </div>
                </div>
              )}

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
                    setFeito("Programação salva.");
                  }}
                />
              )}
            </div>

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
              <p className="field__hint">Não foi possível projetar o tempo para esta quantidade.</p>
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

        {escolhendo && (
          <RouteChooserDialog
            order={order}
            mode={escolhendo.mode}
            initialVersionId={escolhendo.initialVersionId}
            hasSchedule={agenda !== null}
            onClose={() => setEscolhendo(null)}
            onApplied={(atualizada, mensagem) => {
              setEscolhendo(null);
              setErro(null);
              onApplied(atualizada);
              // Trocar o roteiro remove a programação no servidor: a tela relê.
              carregarAgenda();
              setFeito(mensagem);
            }}
          />
        )}
      </FormSection>
    </div>
  );
}
