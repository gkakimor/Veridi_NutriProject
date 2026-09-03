import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const menu = useRef<HTMLDivElement>(null);
  /**
   * Onde o menu é pintado, em coordenada de viewport.
   *
   * O menu mora dentro de `.table-container`, que tem `overflow-x: auto` — e
   * overflow num eixo recorta o outro. Posicionado pelo ancestral, o menu da
   * última linha aparecia cortado ao meio. Ancorado ao viewport ele escapa;
   * o preço é que a coordenada precisa ser medida aqui.
   */
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosicao(null);
      return;
    }

    function medir() {
      const gatilho = toggle.current?.getBoundingClientRect();
      const caixa = menu.current?.getBoundingClientRect();
      if (!gatilho || !caixa) return;

      const MARGEM = 8;
      // Alinhado pela direita do botão: o menu é mais largo que ele, e a
      // coluna de ações fica na borda da tabela.
      let left = Math.max(MARGEM, gatilho.right - caixa.width);
      if (left + caixa.width > window.innerWidth - MARGEM) {
        left = Math.max(MARGEM, window.innerWidth - MARGEM - caixa.width);
      }

      // Linha no rodapé da janela: abre para cima em vez de sair da tela.
      let top = gatilho.bottom + 2;
      if (top + caixa.height > window.innerHeight - MARGEM) {
        top = Math.max(MARGEM, gatilho.top - caixa.height - 2);
      }

      setPosicao({ top, left });
    }

    medir();
    // Captura: a rolagem que desloca o botão é a do `.table-container`, e
    // evento de rolagem de elemento não sobe por bubbling.
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [open]);

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

    /*
     * Sair com Tab tambem fecha. Havia fechamento por clique fora e por
     * Escape, e nenhum por foco: quem abria o menu com Enter e seguia
     * tabulando deixava o menu flutuando aberto sobre a proxima linha, ancorado
     * numa acao que nao era mais a que estava em foco.
     *
     * `focusout` sobe, entao o alvo do foco novo chega em `relatedTarget`.
     * `null` significa que o foco saiu da janela — a pessoa pode voltar, e
     * fechar ali seria perder o menu por trocar de aba.
     */
    function handleFocusOut(event: FocusEvent) {
      const proximo = event.relatedTarget as Node | null;
      if (!proximo) return;
      if (!container.current?.contains(proximo)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    container.current?.addEventListener("focusout", handleFocusOut);
    const atual = container.current;
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      atual?.removeEventListener("focusout", handleFocusOut);
    };
  }, [open]);

  const available = actions.filter((action) => !action.disabled);

  /*
   * Seta move o foco dentro do menu.
   *
   * `role="menu"` é uma promessa: quem usa teclado (e quem usa leitor de
   * tela) espera navegar com as setas, não com Tab. O menu declarava o papel
   * e não entregava o comportamento — Tab funcionava, seta não fazia nada.
   */
  function itens(): HTMLButtonElement[] {
    return Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
  }

  function moverFoco(passo: 1 | -1 | "primeiro" | "ultimo") {
    const lista = itens();
    if (lista.length === 0) return;
    if (passo === "primeiro") return lista[0]!.focus();
    if (passo === "ultimo") return lista[lista.length - 1]!.focus();
    const atual = lista.indexOf(document.activeElement as HTMLButtonElement);
    // Fora do menu, a primeira seta entra nele pela ponta correspondente.
    const proximo =
      atual === -1
        ? passo === 1
          ? 0
          : lista.length - 1
        : (atual + passo + lista.length) % lista.length;
    lista[proximo]!.focus();
  }

  return (
    // A linha da tabela trata Enter como "abrir registro" — só essas teclas
    // param aqui. Parar TODAS impedia o Escape de chegar ao listener que
    // fecha o menu.
    <div
      className="row-actions"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        if (!open) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moverFoco(event.key === "ArrowDown" ? 1 : -1);
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          moverFoco(event.key === "Home" ? "primeiro" : "ultimo");
        }
      }}
    >
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
            onKeyDown={(event) => {
              // Abrir pela seta já entra no menu, como em qualquer menu.
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              event.stopPropagation();
              if (!open) setOpen(true);
              requestAnimationFrame(() =>
                moverFoco(event.key === "ArrowDown" ? "primeiro" : "ultimo"),
              );
            }}
          >
            ⋯
          </button>

          {open && (
            <div
              className={
                posicao ? "row-actions__menu" : "row-actions__menu row-actions__menu--medindo"
              }
              role="menu"
              ref={menu}
              {...(posicao ? { style: { top: posicao.top, left: posicao.left } } : {})}
            >
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
