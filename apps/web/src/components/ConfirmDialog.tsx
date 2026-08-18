import { useRef } from "react";
import { useModalDialog } from "./useModalDialog";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" (padrao) para acoes cautelares (Inativar); "accent" para acoes de commit positivas (Confirmar pedido). */
  confirmTone?: "danger" | "accent";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmacao Veridi generica — usada para inativar em Items, Suppliers,
 * Customers e Products, e para confirmacoes de commit em documentos
 * transacionais (ex.: Confirmar pedido de OC). Nao e um framework de
 * modais: um unico componente simples, centrado, com Escape fechando
 * (equivale a cancelar).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  confirmTone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Foco, trap, Escape e retorno vivem no hook: oito confirmações do app
  // remontavam esta marcação na mão e ficavam sem nada disso.
  useModalDialog(open, dialogRef, onCancel);

  if (!open) return null;

  return (
    <>
      <div className="confirm-overlay" />
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        {/* `div`, não `p`: a mensagem pode trazer lista ou parágrafos —
            bloco dentro de parágrafo é HTML inválido e o React avisa. */}
        <div className="confirm-dialog__message">{message}</div>
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmTone === "accent" ? "btn btn--accent" : "btn btn--danger"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
