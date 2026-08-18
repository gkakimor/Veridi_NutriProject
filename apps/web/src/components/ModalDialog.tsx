import { useRef } from "react";
import type { ReactNode } from "react";
import { useModalDialog } from "./useModalDialog";

/**
 * Casca de diálogo modal — overlay, papel ARIA e comportamento de foco.
 *
 * Existe porque a marcação `confirm-overlay` + `confirm-dialog` foi copiada
 * à mão em oito confirmações, cada uma com o conteúdo próprio (motivo do
 * bloqueio, quantidade do ajuste, razão do cancelamento) e nenhuma com
 * gestão de foco. O `ConfirmDialog` resolve o caso simples — título,
 * mensagem, dois botões; este resolve o caso em que o diálogo tem
 * formulário, sem obrigar cada tela a reimplementar trap, Escape e retorno
 * de foco.
 *
 * O conteúdo continua sendo de quem chama: só a casca é compartilhada.
 */
export function ModalDialog({
  labelledBy,
  onClose,
  children,
}: {
  /** `id` do título dentro do diálogo — o rótulo acessível. */
  labelledBy: string;
  /** Escape e clique em cancelar chegam aqui. */
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalDialog(true, ref, onClose);

  return (
    <>
      <div className="confirm-overlay" />
      <div
        ref={ref}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
