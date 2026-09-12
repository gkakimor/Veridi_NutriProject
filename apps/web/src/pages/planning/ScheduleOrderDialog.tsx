import { useState } from "react";
import type { ProductionOrderScheduleDTO, ProductionSchedulePreviewDTO } from "@veridi/shared";
import {
  AVISO_DE_AGENDA_LABELS,
  FUSO_COMERCIAL,
  diaCivil,
  instanteComercial,
  minutoDoDiaComercial,
} from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { ScheduleStartNotOperationalError, apiErrorMessage } from "../../lib/api-errors";
import { formatDateTime } from "../../lib/dates";
import { formatMinutes } from "../../lib/duration";
import {
  previewProductionOrderSchedule,
  scheduleProductionOrder,
} from "../../lib/production-schedules-api";
import "./planning.css";

/**
 * DEFINIR O INÍCIO PREVISTO de uma Ordem de Produção
 * (PLANNING-CAPACITY-BOARD-01).
 *
 * Um fluxo só, usado pelo detalhe da ordem e pelo quadro: dois caminhos
 * independentes para a mesma decisão viram duas regras diferentes na primeira
 * manutenção.
 *
 * A ordem é sempre a mesma: escolher o início, VER o resultado, e só então
 * confirmar. A prévia não grava nada — é ela que mostra fim previsto, tempo
 * útil, etapas, recursos e avisos antes de a pessoa se comprometer.
 */

/** `datetime-local` fala a hora de PAREDE; a fábrica vive em São Paulo. */
function paraEntradaLocal(iso: string | null): string {
  if (!iso) return "";
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return "";
  const dia = diaCivil(instante, FUSO_COMERCIAL);
  const minuto = minutoDoDiaComercial(instante);
  const hh = String(Math.floor(minuto / 60)).padStart(2, "0");
  const mm = String(minuto % 60).padStart(2, "0");
  return `${dia}T${hh}:${mm}`;
}

/**
 * O instante que a hora digitada representa.
 *
 * Lida como hora de São Paulo, e não como hora do navegador: quem abrir o ERP
 * de outro fuso programaria a fábrica em outro horário sem perceber.
 */
function deEntradaLocal(texto: string): string | null {
  const casou = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!casou) return null;
  const minuto = Number(casou[2]) * 60 + Number(casou[3]);
  return instanteComercial(casou[1]!, minuto).toISOString();
}

export function ScheduleOrderDialog({
  orderId,
  orderCode,
  status,
  currentStartAt,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderCode: string;
  status: string;
  currentStartAt: string | null;
  onClose: () => void;
  onSaved: (schedule: ProductionOrderScheduleDTO) => void;
}) {
  const [entrada, setEntrada] = useState(() => paraEntradaLocal(currentStartAt));
  const [previa, setPrevia] = useState<ProductionSchedulePreviewDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** O próximo horário válido que o servidor ofereceu. Usar é outra ação. */
  const [sugestao, setSugestao] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const liberada = status === "RELEASED";
  const instante = deEntradaLocal(entrada);

  async function calcular(isoEscolhido?: string) {
    const alvo = isoEscolhido ?? instante;
    if (!alvo) {
      setErro("Informe a data e a hora de início.");
      return;
    }
    setCalculando(true);
    setErro(null);
    setSugestao(null);
    try {
      const resultado = await previewProductionOrderSchedule(orderId, alvo);
      setPrevia(resultado);
      if (isoEscolhido) setEntrada(paraEntradaLocal(isoEscolhido));
    } catch (err) {
      setPrevia(null);
      /*
       * Início fora da jornada NÃO é corrigido por baixo: o servidor devolve
       * o motivo e o próximo horário válido, e usá-lo é um clique explícito.
       */
      const oferecido =
        err instanceof ScheduleStartNotOperationalError ? err.suggestionAt : null;
      setSugestao(oferecido);
      setErro(apiErrorMessage(err, "Não foi possível calcular a programação"));
    } finally {
      setCalculando(false);
    }
  }

  async function confirmar() {
    if (!instante) return;
    setSalvando(true);
    setErro(null);
    try {
      const gravada = await scheduleProductionOrder(orderId, {
        startAt: instante,
        ...(liberada ? { confirmReleased: true } : {}),
      });
      onSaved(gravada);
    } catch (err) {
      setErro(apiErrorMessage(err, "Não foi possível salvar a programação"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ModalDialog labelledBy="schedule-dialog-title" role="dialog" onClose={onClose}>
      <h3 id="schedule-dialog-title" className="modal__title">
        Definir início previsto — {orderCode}
      </h3>

      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}

      {sugestao && (
        <div className="form-actions">
          <div className="form-actions__group">
            <span className="form-status">
              Próximo horário disponível: {formatDateTime(sugestao)}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={calculando}
              onClick={() => void calcular(sugestao)}
            >
              Usar este horário
            </button>
          </div>
        </div>
      )}

      <div className="field field--narrow">
        <label htmlFor="schedule-start">Início previsto</label>
        <input
          id="schedule-start"
          type="datetime-local"
          step={300}
          value={entrada}
          onChange={(event) => {
            setEntrada(event.target.value);
            setPrevia(null);
          }}
        />
        <p className="field__hint">
          Horário da fábrica, no fuso de São Paulo. O sistema projeta as etapas sobre a jornada — ele
          não escolhe o horário por você.
        </p>
      </div>

      {liberada && (
        <p className="field__hint" role="status">
          Esta ordem já foi liberada para produção: confirmar aqui move a programação dela.
        </p>
      )}

      <div className="form-actions form-actions--split">
        <div className="form-actions__group">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={calculando || !instante}
            onClick={() => void calcular()}
          >
            {calculando ? "Calculando…" : "Ver prévia"}
          </button>
        </div>
        <div className="form-actions__group">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent btn--sm"
            /* Confirmar só depois de ver: a prévia é o que torna a decisão
               informada, e sem ela o botão não tem o que confirmar. */
            disabled={salvando || previa === null}
            onClick={() => void confirmar()}
          >
            {salvando ? "Salvando…" : "Confirmar programação"}
          </button>
        </div>
      </div>

      {previa && (
        <section className="schedule-preview" aria-label="Prévia da programação">
          <dl className="profile-summary" role="group" aria-label="Resumo da programação">
            <div>
              <dt>Início</dt>
              <dd>{formatDateTime(previa.schedule.plannedStartAt)}</dd>
            </div>
            <div>
              <dt>Fim previsto</dt>
              <dd>{formatDateTime(previa.schedule.plannedEndAt)}</dd>
            </div>
            <div>
              <dt>Tempo útil</dt>
              <dd>{formatMinutes(previa.schedule.workingMinutes)}</dd>
            </div>
            <div>
              <dt>Etapas</dt>
              <dd>{previa.schedule.steps.length}</dd>
            </div>
          </dl>

          {previa.warnings.length > 0 && (
            <ul className="schedule-warnings">
              {previa.warnings.map((aviso, indice) => (
                <li key={`${aviso.tipo}-${indice}`}>
                  <span className="badge badge--warn">{AVISO_DE_AGENDA_LABELS[aviso.tipo]}</span>{" "}
                  {aviso.texto}
                </li>
              ))}
            </ul>
          )}

          <ol className="profile-steps-readonly">
            {previa.schedule.steps.map((etapa) => (
              <li key={etapa.sequence} className="profile-step">
                <p className="profile-step__title">
                  <span className="profile-step__seq">Etapa {etapa.sequence}</span> {etapa.name}
                </p>
                <dl className="profile-step__facts">
                  <div>
                    <dt>Começa</dt>
                    <dd>{formatDateTime(etapa.plannedStartAt)}</dd>
                  </div>
                  <div>
                    <dt>Termina</dt>
                    <dd>{formatDateTime(etapa.plannedEndAt)}</dd>
                  </div>
                  <div>
                    <dt>Duração</dt>
                    <dd>{formatMinutes(etapa.durationMinutes)}</dd>
                  </div>
                  <div>
                    <dt>Recursos</dt>
                    <dd>
                      {etapa.resources.length === 0
                        ? "—"
                        : etapa.resources
                            .map((r) => `${r.resourceQuantity} × ${r.resourceName}`)
                            .join(" · ")}
                    </dd>
                  </div>
                </dl>
                {/* Os trechos efetivamente trabalhados: é isto que ocupa
                    recurso, e não o envelope da etapa. */}
                {etapa.workSegments.length > 1 && (
                  <p className="field__hint">
                    Trabalho em {etapa.workSegments.length} trechos:{" "}
                    {etapa.workSegments
                      .map((s) => `${formatDateTime(s.startAt)} → ${formatDateTime(s.endAt)}`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </ModalDialog>
  );
}
