import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CustomerOrderDeliveryScheduleDTO,
  DeliveryScheduleDTO,
  SchedulableLineDTO,
} from "@veridi/shared";
import { DELIVERY_SCHEDULE_STATUS_LABELS, Decimal } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDate } from "../../lib/dates";
import {
  cancelDeliverySchedule,
  createDeliverySchedule,
  getDeliverySchedule,
  prepareShipmentForDelivery,
  rescheduleDelivery,
} from "../../lib/delivery-schedule-api";
import { parseDecimalInput } from "../../lib/decimal-input";
import { formatQuantity } from "../../lib/quantity";

/**
 * Entregas programadas — a promessa de QUANDO cada parte do Pedido sai.
 *
 * A seção existe dentro do Pedido de propósito: a promessa é do Pedido, e um
 * módulo próprio obrigaria a operação a procurar em outro lugar o que ela
 * decide aqui. O Pedido já tem doze seções, então esta é compacta — uma linha
 * por entrega, o detalhe por produto só quando a entrega é aberta.
 *
 * O que ela NÃO faz, e a ajuda diz junto: programar não reserva estoque, não
 * abre ordem de produção, não expede e não fatura. Cada uma dessas ações
 * continua no seu fluxo.
 */
export function DeliveryScheduleSection({
  customerOrderId,
  editable,
}: {
  customerOrderId: string;
  /** Pedido cancelado ou ainda em rascunho não recebe compromisso novo. */
  editable: boolean;
}) {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState<CustomerOrderDeliveryScheduleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeliveryScheduleDTO | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<DeliveryScheduleDTO | null>(null);

  useEffect(() => {
    let ativo = true;
    getDeliverySchedule(customerOrderId)
      .then((data) => {
        if (ativo) setSchedule(data);
      })
      .catch((erro) => {
        if (ativo) setError(apiErrorMessage(erro, "Não foi possível carregar as entregas programadas."));
      });
    return () => {
      ativo = false;
    };
  }, [customerOrderId]);

  if (!schedule) return null;

  const temProgramavel = schedule.schedulable.some((linha) =>
    Number(linha.schedulableQuantity) > 0,
  );

  async function aplicar(acao: () => Promise<CustomerOrderDeliveryScheduleDTO>) {
    setSaving(true);
    setError(null);
    try {
      setSchedule(await acao());
      return true;
    } catch (erro) {
      setError(apiErrorMessage(erro, "Não foi possível salvar a entrega programada."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function prepararExpedicao(delivery: DeliveryScheduleDTO) {
    setSaving(true);
    setError(null);
    try {
      const shipment = await prepareShipmentForDelivery(customerOrderId, delivery.id);
      navigate(`/comercial/expedicoes/${shipment.id}`);
    } catch (erro) {
      // O índice de uma separação por Pedido é o caso comum aqui: a mensagem
      // do servidor já diz qual expedição está aberta.
      setError(apiErrorMessage(erro, "Não foi possível preparar a expedição."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSection
      title="Entregas programadas"
      subtitle="O compromisso de quando cada parte sai. Programar não reserva estoque e não expede — quem executa é a Expedição."
    >
      <ContextHelp
        topic={helpTopics["comercial.entregasProgramadas"]}
        triggerLabel="Como funciona a programação"
      />

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      {schedule.deliveries.length === 0 && !adding && (
        <p className="field__hint">Nenhuma entrega programada. O pedido pode ser expedido normalmente.</p>
      )}

      {schedule.deliveries.length > 0 && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Entrega</th>
                <th>Data programada</th>
                <th>Situação</th>
                <th className="is-numeric">Programado</th>
                <th className="is-numeric">Atendido</th>
                <th className="is-numeric">Pendente</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {schedule.deliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  editable={editable}
                  saving={saving}
                  expanded={expanded === delivery.id}
                  onToggle={() => setExpanded(expanded === delivery.id ? null : delivery.id)}
                  onPrepare={() => prepararExpedicao(delivery)}
                  onCancel={() => setCancelTarget(delivery)}
                  onReschedule={() => setRescheduleTarget(delivery)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && !adding && temProgramavel && (
        <button type="button" className="btn btn--secondary" onClick={() => setAdding(true)}>
          Adicionar entrega programada
        </button>
      )}

      {editable && !adding && !temProgramavel && schedule.deliveries.length > 0 && (
        <p className="field__hint">
          Todo o pedido já está programado ou expedido — não há saldo para programar.
        </p>
      )}

      {adding && (
        <NewDeliveryForm
          schedulable={schedule.schedulable}
          saving={saving}
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            const ok = await aplicar(() => createDeliverySchedule(customerOrderId, input));
            if (ok) setAdding(false);
          }}
        />
      )}

      {cancelTarget && (
        <ReasonDialog
          title={`Cancelar a entrega ${cancelTarget.sequence}?`}
          confirmLabel="Cancelar entrega"
          intro={
            <>
              <p>
                O saldo pendente volta a ficar disponível para programar. O que já foi expedido
                nesta entrega continua registrado e não é desfeito.
              </p>
              {Number(cancelTarget.totalFulfilledQuantity) > 0 && (
                <p className="field__hint">
                  Já atendidas: {formatQuantity(cancelTarget.totalFulfilledQuantity)} ·{" "}
                  saldo a cancelar: {formatQuantity(cancelTarget.totalRemainingQuantity)}.
                </p>
              )}
            </>
          }
          onCancel={() => setCancelTarget(null)}
          onConfirm={async (reason) => {
            const ok = await aplicar(() => cancelDeliverySchedule(cancelTarget.id, { reason }));
            if (ok) setCancelTarget(null);
          }}
        />
      )}

      {rescheduleTarget && (
        <ReasonDialog
          title={`Reprogramar a entrega ${rescheduleTarget.sequence}?`}
          confirmLabel="Reprogramar"
          confirmTone="accent"
          withDate
          intro={
            <p>
              A entrega atual é encerrada e nasce outra com o saldo ainda pendente
              {" "}({formatQuantity(rescheduleTarget.totalRemainingQuantity)}), na data nova. A
              promessa anterior continua no histórico, com o que ela já entregou.
            </p>
          }
          onCancel={() => setRescheduleTarget(null)}
          onConfirm={async (reason, scheduledDate) => {
            const ok = await aplicar(() =>
              rescheduleDelivery(rescheduleTarget.id, { reason, scheduledDate: scheduledDate! }),
            );
            if (ok) setRescheduleTarget(null);
          }}
        />
      )}
    </FormSection>
  );
}

/** Uma entrega na lista, com o detalhe por produto quando aberta. */
function DeliveryRow({
  delivery,
  editable,
  saving,
  expanded,
  onToggle,
  onPrepare,
  onCancel,
  onReschedule,
}: {
  delivery: DeliveryScheduleDTO;
  editable: boolean;
  saving: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPrepare: () => void;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const encerrada = delivery.status === "CANCELLED" || delivery.status === "FULFILLED";
  const podeExpedir = editable && !encerrada && Number(delivery.totalRemainingQuantity) > 0;

  return (
    <>
      <tr>
        <td>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onToggle}>
            Entrega {delivery.sequence}
          </button>
          {delivery.replacesDeliverySequence !== null && (
            <span className="field__hint"> · substitui a {delivery.replacesDeliverySequence}</span>
          )}
        </td>
        <td>{formatDate(delivery.scheduledDate)}</td>
        <td>
          <span className={`badge badge--${badgeTone(delivery.status)}`}>
            {DELIVERY_SCHEDULE_STATUS_LABELS[delivery.status]}
          </span>
          {delivery.replacedByDeliverySequence !== null && (
            <span className="field__hint"> · reprogramada para a {delivery.replacedByDeliverySequence}</span>
          )}
        </td>
        <td className="is-numeric">{formatQuantity(delivery.totalQuantity)}</td>
        <td className="is-numeric">{formatQuantity(delivery.totalFulfilledQuantity)}</td>
        <td className="is-numeric">{formatQuantity(delivery.totalRemainingQuantity)}</td>
        <td>
          {podeExpedir && (
            <button type="button" className="btn btn--sm" disabled={saving} onClick={onPrepare}>
              Preparar expedição
            </button>
          )}
          {editable && !encerrada && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={saving}
                onClick={onReschedule}
              >
                Reprogramar
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={saving}
                onClick={onCancel}
              >
                Cancelar
              </button>
            </>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7}>
            <dl className="definition-list">
              {delivery.lines.map((line) => (
                <div key={line.id}>
                  <dt>
                    {line.productCode} — {line.productName}
                  </dt>
                  <dd>
                    Programado {formatQuantity(line.quantity)} {line.unitCode} · atendido{" "}
                    {formatQuantity(line.fulfilledQuantity)} · pendente{" "}
                    {formatQuantity(line.remainingQuantity)}
                  </dd>
                </div>
              ))}
            </dl>
            {delivery.notes && <p className="field__hint">{delivery.notes}</p>}
            {delivery.cancelReason && (
              <p className="field__hint">Motivo do cancelamento: {delivery.cancelReason}</p>
            )}
            {delivery.shipments.length > 0 && (
              <p className="field__hint">
                Expedições:{" "}
                {delivery.shipments
                  .map((shipment) => `${shipment.shipmentCode} (${formatQuantity(shipment.quantity)})`)
                  .join(" · ")}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function badgeTone(status: DeliveryScheduleDTO["status"]): string {
  if (status === "LATE") return "err";
  if (status === "FULFILLED") return "active";
  if (status === "CANCELLED") return "inactive";
  if (status === "PARTIALLY_FULFILLED") return "warn";
  return "info";
}

/**
 * Formulário de uma entrega nova.
 *
 * A validação viva usa o MESMO saldo que o servidor devolveu na última
 * leitura: a tela antecipa a recusa, e o servidor continua sendo a autoridade
 * — ele revalida dentro da transação, com o Pedido travado.
 */
function NewDeliveryForm({
  schedulable,
  saving,
  onCancel,
  onSubmit,
}: {
  schedulable: SchedulableLineDTO[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: { scheduledDate: string; notes?: string; lines: { customerOrderLineId: string; quantity: string }[] }) => void;
}) {
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const excessos = useMemo(() => {
    const achados: string[] = [];
    for (const linha of schedulable) {
      const digitado = quantities[linha.customerOrderLineId];
      if (!digitado) continue;
      const valor = parseDecimalInput(digitado);
      if (valor === null) continue;
      if (new Decimal(valor).greaterThan(linha.schedulableQuantity)) {
        achados.push(
          `${linha.productCode}: disponível para programar ${formatQuantity(linha.schedulableQuantity)} ${linha.unitCode}`,
        );
      }
    }
    return achados;
  }, [quantities, schedulable]);

  const linhasPreenchidas = schedulable
    .map((linha) => ({
      customerOrderLineId: linha.customerOrderLineId,
      quantity: quantities[linha.customerOrderLineId] ?? "",
    }))
    .filter((linha) => {
      const valor = parseDecimalInput(linha.quantity);
      return valor !== null && new Decimal(valor).greaterThan(0);
    });

  const podeSalvar =
    scheduledDate !== "" && linhasPreenchidas.length > 0 && excessos.length === 0 && !saving;

  return (
    <div className="delivery-form">
      <div className="field-grid-2">
        <div className="field">
          <label htmlFor="delivery-date">
            Data programada <span className="req">*</span>
          </label>
          <input
            id="delivery-date"
            type="date"
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="delivery-notes">Observação</label>
          <input
            id="delivery-notes"
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="is-numeric">Pedido</th>
              <th className="is-numeric">Já expedido</th>
              <th className="is-numeric">Já programado pendente</th>
              <th className="is-numeric">Disponível para programar</th>
              <th className="is-numeric">Programar agora</th>
            </tr>
          </thead>
          <tbody>
            {schedulable.map((linha) => (
              <tr key={linha.customerOrderLineId}>
                <td>
                  {linha.productCode} — {linha.productName}
                </td>
                <td className="is-numeric">{formatQuantity(linha.orderedQuantity)}</td>
                <td className="is-numeric">{formatQuantity(linha.shippedQuantity)}</td>
                <td className="is-numeric">{formatQuantity(linha.scheduledPendingQuantity)}</td>
                <td className="is-numeric">{formatQuantity(linha.schedulableQuantity)}</td>
                <td className="is-numeric">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Programar ${linha.productCode}`}
                    value={quantities[linha.customerOrderLineId] ?? ""}
                    disabled={Number(linha.schedulableQuantity) <= 0}
                    onChange={(event) =>
                      setQuantities((atual) => ({
                        ...atual,
                        [linha.customerOrderLineId]: event.target.value,
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {excessos.length > 0 && (
        <p className="form-alert" role="alert">
          Quantidade acima do saldo — {excessos.join(" · ")}
        </p>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!podeSalvar}
          onClick={() =>
            onSubmit({
              scheduledDate,
              ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
              lines: linhasPreenchidas,
            })
          }
        >
          Salvar entrega
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Voltar
        </button>
      </div>
    </div>
  );
}

/** Diálogo com motivo obrigatório — e data, quando é reprogramação. */
function ReasonDialog({
  title,
  intro,
  confirmLabel,
  confirmTone = "danger",
  withDate = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  intro: React.ReactNode;
  confirmLabel: string;
  confirmTone?: "danger" | "accent";
  withDate?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, scheduledDate?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");

  return (
    <ConfirmDialog
      open
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel="Voltar"
      confirmTone={confirmTone}
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason.trim(), withDate ? scheduledDate : undefined)}
      message={
        <>
          {intro}
          {withDate && (
            <div className="field">
              <label htmlFor="reschedule-date">
                Nova data programada <span className="req">*</span>
              </label>
              <input
                id="reschedule-date"
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="delivery-reason">
              Motivo <span className="req">*</span>
            </label>
            <textarea
              id="delivery-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="O que mudou com o cliente?"
            />
          </div>
        </>
      }
    />
  );
}
