import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Isola o fundo enquanto um diálogo modal está aberto.
 *
 * `aria-modal="true"` é uma PROMESSA: o leitor de tela deve tratar o resto da
 * página como inexistente. Sozinho ele não faz nada — quem navega por
 * elementos continua encontrando a tela de trás, e o Veridi tinha ~50
 * controles alcançáveis atrás do modal de cadastro. O focus trap resolve o
 * Tab; não resolve o modo de navegação do leitor.
 *
 * O algoritmo é o mesmo de `aria-hidden`/`inert` de bibliotecas de modal:
 * subir do diálogo até o `body` marcando os IRMÃOS de cada ancestral. Assim
 * funciona onde quer que o diálogo esteja montado — dentro da árvore do app
 * ou num portal — sem precisar mover ninguém.
 *
 * `inert` cobre foco, ponteiro e leitor de tela; `aria-hidden` fica junto
 * para navegadores que ainda não implementam `inert`.
 */
export function useInertBackground(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    // Só desfaz o que ESTE diálogo marcou: com dois modais abertos (cadastro
    // no contexto por cima do formulário), o de baixo não pode ser revelado
    // quando o de cima fecha.
    const marked: HTMLElement[] = [];
    let node: HTMLElement | null = dialog;
    while (node && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node) continue;
        if (!(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
        marked.push(sibling);
      }
      node = node.parentElement;
    }

    return () => {
      for (const element of marked) {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      }
    };
  }, [open, ref]);
}
