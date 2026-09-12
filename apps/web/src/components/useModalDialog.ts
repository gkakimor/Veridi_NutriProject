import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useInertBackground } from "./useInertBackground";

/**
 * Comportamento de diálogo modal: foco entra, foco fica, Escape sai, foco volta.
 *
 * `role="alertdialog"` + `aria-modal="true"` é uma declaração, não uma
 * implementação. Sem o JS abaixo o diálogo só PARECE modal: o foco continua
 * no botão que o abriu, atrás do overlay, e o Tab passeia pelos campos da
 * tela escurecida — dá para editar um formulário que o usuário não está
 * vendo. `window.confirm` prendia o foco por conta do navegador; ao trocar
 * por marcação própria, isto passou a ser responsabilidade do app.
 *
 * O `ConfirmDialog` compartilhado já fazia tudo isso, mas oito confirmações
 * remontaram a marcação na mão — justamente as ações mais sensíveis do
 * sistema (bloquear lote, ajustar estoque, confirmar OC/OP/pedido/expedição/
 * faturamento). Este hook existe para que nenhuma delas precise reescrever
 * as mesmas quarenta linhas.
 *
 * @param open   diálogo visível
 * @param ref    elemento com `role="dialog"`/`"alertdialog"`
 * @param onClose o que Escape faz — normalmente cancelar
 */
export function useModalDialog(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useInertBackground(open, ref);

  /**
   * `onClose` é LIDO no Escape, não observado.
   *
   * Enquanto ele era dependência do efeito, um diálogo com campo digitável
   * perdia o que era digitado: `onClose={() => setAberto(false)}` nasce de
   * novo a cada renderização, a tecla re-renderizava a tela de trás, o efeito
   * se desmontava e remontava, e a remontagem devolvia o foco ao primeiro
   * botão. O motivo do cancelamento da OC não recebia uma letra sequer.
   *
   * A ref guarda sempre a última versão, então o Escape continua chamando o
   * que a renderização atual quer, sem prender foco e trap à identidade da
   * função.
   */
  const fechar = useRef(onClose);
  fechar.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    function focusables(): HTMLElement[] {
      const root = ref.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
    }

    // O primeiro controle é a saída segura (Voltar/Cancelar) sempre que
    // existe: quem abre sem querer não confirma sem querer.
    const items = focusables();
    (items[0] ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        fechar.current();
        return;
      }
      if (event.key !== "Tab") return;

      const current = focusables();
      if (current.length === 0) return;
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !ref.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Devolve o foco a quem abriu: sem isto o Tab seguinte recomeça do
      // topo da página, longe de onde a pessoa estava.
      previouslyFocused?.focus?.();
    };
  }, [open, ref]);
}
