import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Recusa do laudo (CoA) do lote.
 *
 * O motivo é obrigatório e vira registro da Qualidade — mas era pedido num
 * `window.prompt` do navegador: sem rótulo, sem contexto do lote, sem o
 * desenho do sistema, e aceitando espaço em branco até o código aparar.
 * Aqui o campo tem rótulo, o lote aparece, e confirmar só existe quando há
 * motivo escrito.
 */
export function RejectCoaDialog({
  lotCode,
  onCancel,
  onConfirm,
}: {
  lotCode: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <ConfirmDialog
      open
      title="Recusar o laudo deste lote?"
      confirmLabel="Recusar laudo"
      cancelLabel="Voltar"
      onCancel={onCancel}
      onConfirm={() => {
        const trimmed = reason.trim();
        if (trimmed) onConfirm(trimmed);
      }}
      message={
        <>
          <p>
            O laudo {lotCode ? <span className="code">{lotCode}</span> : "deste lote"} volta para
            pendência e o lote continua sem liberação até um laudo aprovado.
          </p>
          <div className="field">
            <label htmlFor="reject-coa-reason">Motivo da recusa</label>
            <textarea
              id="reject-coa-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="O que está errado no laudo?"
              aria-describedby="reject-coa-hint"
            />
            <p id="reject-coa-hint" className="field__hint">
              Obrigatório: fica no histórico da Qualidade e explica a recusa para quem receber o
              lote depois.
            </p>
          </div>
        </>
      }
    />
  );
}
