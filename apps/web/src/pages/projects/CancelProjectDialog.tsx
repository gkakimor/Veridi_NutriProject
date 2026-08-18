import { useState } from "react";
import type { ProjectCancelReason } from "@veridi/shared";
import { PROJECT_CANCEL_REASONS, PROJECT_CANCEL_REASON_LABELS } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/**
 * Cancelamento do projeto.
 *
 * O motivo é dado estruturado — o relatório comercial conta por que as
 * negociações morrem. Isso não autoriza pedir o ENUM ao usuário: a tela
 * pedia "PRICE, COMPETITOR, PROJECT_CHANGED, NOT_MET, OTHER" digitados num
 * `window.prompt` do navegador, fora do desenho do sistema, sem rótulo e
 * sem lista. Aqui o motivo é escolhido pelo nome que o negócio usa, e a
 * descrição livre só aparece quando ela é exigida.
 */
export function CancelProjectDialog({
  projectCode,
  onCancel,
  onConfirm,
}: {
  projectCode: string;
  onCancel: () => void;
  onConfirm: (reason: ProjectCancelReason, details: string) => void;
}) {
  const [reason, setReason] = useState<ProjectCancelReason>("PRICE");
  const [details, setDetails] = useState("");

  const detailsRequired = reason === "OTHER";

  return (
    <ConfirmDialog
      open
      title="Cancelar o projeto?"
      confirmLabel="Cancelar projeto"
      cancelLabel="Voltar"
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason, details.trim())}
      message={
        <>
          <p>
            O projeto <span className="code">{projectCode}</span> passa a ser histórico: não recebe
            produto novo, nem versão nova de orçamento.
          </p>
          <div className="field">
            <label htmlFor="cancel-project-reason">Motivo do cancelamento</label>
            <select
              id="cancel-project-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as ProjectCancelReason)}
            >
              {PROJECT_CANCEL_REASONS.map((option) => (
                <option key={option} value={option}>
                  {PROJECT_CANCEL_REASON_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          {detailsRequired && (
            <div className="field">
              <label htmlFor="cancel-project-details">Descreva o motivo</label>
              <textarea
                id="cancel-project-details"
                rows={3}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="O que aconteceu com esta negociação?"
              />
            </div>
          )}
        </>
      }
    />
  );
}
