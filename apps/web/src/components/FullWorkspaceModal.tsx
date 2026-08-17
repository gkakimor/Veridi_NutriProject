import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CodeChip } from "./CodeChip";

interface FullWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  /** Trilha de navegacao, ex.: "Cadastros / Itens". O ultimo segmento vai em negrito. */
  crumb: string;
  crumbActive: string;
  title: ReactNode;
  codeChip?: string;
  footer: ReactNode;
  children: ReactNode;
  closeLabel?: string;
}

/**
 * Modal fullscreen dentro do workspace — padrao oficial de CRUD (Itens,
 * Fornecedores, Clientes, Produtos). Comeca abaixo da topbar, ocupa o
 * espaco do workspace, mantem topbar/sidebar visiveis, body rolavel,
 * footer fixo. Fecha com Escape ou pelo botao "Fechar".
 */
export function FullWorkspaceModal({
  open,
  onClose,
  crumb,
  crumbActive,
  title,
  codeChip,
  footer,
  children,
  closeLabel = "Fechar",
}: FullWorkspaceModalProps) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Quem abriu o modal recebe o foco de volta ao fechar — sem isso, quem
    // usa só teclado sai do modal direto para o fim da página.
    const opener = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Foco preso no diálogo: Tab na tabela de fundo faria o usuário editar
      // um registro que não está mais visível.
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (!dialog.current?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const initial = focusable()[0];
    (initial ?? dialog.current)?.focus();

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="modal-overlay" />
      <div
        className="modal-fullscreen"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-workspace-modal-title"
      >
        <div className="modal-fullscreen__head">
          <div>
            <div className="modal-fullscreen__crumb">
              {crumb} / <b>{crumbActive}</b>
            </div>
            <div className="modal-fullscreen__title">
              <h2 id="full-workspace-modal-title">{title}</h2>
              {codeChip && <CodeChip>{codeChip}</CodeChip>}
            </div>
          </div>
          <button
            type="button"
            className="modal-fullscreen__close"
            onClick={onClose}
            aria-label="Fechar sem salvar"
          >
            <span aria-hidden="true">✕</span> {closeLabel}
          </button>
        </div>

        <div className="modal-fullscreen__body">
          <div className="modal-fullscreen__form-wrap">{children}</div>
        </div>

        <div className="modal-fullscreen__foot">{footer}</div>
      </div>
    </>
  );
}
