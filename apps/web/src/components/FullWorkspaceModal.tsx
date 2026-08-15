import { useEffect } from "react";
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
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="modal-overlay" />
      <div
        className="modal-fullscreen"
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
