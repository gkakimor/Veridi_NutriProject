import { useEffect, useRef } from "react";
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
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // `window.confirm` prendia o foco por conta do navegador. Ao trocar por
    // um modal do proprio app, o foco precisa ser gerido aqui — senao a
    // substituicao seria uma regressao de acessibilidade.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function focusables(): HTMLElement[] {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Devolve o foco a quem abriu o dialogo.
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel]);

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
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel}>
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
