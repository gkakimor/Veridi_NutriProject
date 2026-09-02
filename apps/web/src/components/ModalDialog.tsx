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
  role = "alertdialog",
  children,
}: {
  /** `id` do título dentro do diálogo — o rótulo acessível. */
  labelledBy: string;
  /** Escape e clique em cancelar chegam aqui. */
  onClose: () => void;
  /**
   * `alertdialog` é o padrão porque a casca nasceu para confirmações — e
   * `alertdialog` é o que faz o leitor de tela anunciar o conteúdo inteiro
   * de imediato, que é o certo para "isto não tem volta".
   *
   * Painel de ajuda passa `dialog`: quem clicou em "Como funciona" pediu
   * para ler, não foi interrompido. Anunciar ajuda com urgência de alerta
   * ensina o usuário a ignorar o alerta seguinte, que pode ser de verdade.
   */
  role?: "alertdialog" | "dialog";
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
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
