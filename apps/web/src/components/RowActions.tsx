import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface RowAction {
  label: string;
  onSelect: () => void;
  /** Ação de alta exposição (inativar, cancelar, bloquear, arquivar). */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Menu de ações secundárias de uma linha de tabela.
 *
 * Existe para tirar da tabela o botão vermelho permanente: inativar,
 * cancelar, bloquear e arquivar são ações raras e de alta exposição, e um
 * botão desses repetido em cada linha convida ao clique errado. A ação
 * operacional principal (abrir, receber, conferir) continua visível fora
 * do menu — esconder o trabalho do dia a dia atrás de "⋯" custaria mais
 * cliques em quem usa o sistema o dia inteiro.
 *
 * A confirmação continua sendo responsabilidade de quem usa o componente:
 * este menu nunca substitui o `ConfirmDialog`.
 */
export function RowActions({
  actions,
  label = "Mais ações",
  children,
}: {
  actions: RowAction[];
  label?: string;
  /** Ação principal, renderizada fora do menu. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Sem isso o foco cai no body e quem usa teclado recomeça a tabela.
      toggle.current?.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const available = actions.filter((action) => !action.disabled);

  return (
    // A linha da tabela trata Enter como "abrir registro"; sem parar o evento
    // aqui, Enter no menu "⋯" abria o cadastro em vez do menu.
    <div className="row-actions" ref={container} onKeyDown={(event) => event.stopPropagation()}>
      {children}
      {available.length > 0 && (
        <>
          <button
            type="button"
            ref={toggle}
            className="btn btn--ghost btn--sm row-actions__toggle"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
          >
            ⋯
          </button>

          {open && (
            <div className="row-actions__menu" role="menu">
              {available.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={
                    action.destructive
                      ? "row-actions__item row-actions__item--danger"
                      : "row-actions__item"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    action.onSelect();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
