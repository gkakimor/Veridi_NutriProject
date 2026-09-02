import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Ícone ⓘ ao lado de um conceito — "Em compra ⓘ".
 *
 * É uma DIVULGAÇÃO (disclosure), não um tooltip de hover. Hover sozinho não
 * existe para quem usa teclado nem para quem usa toque, e num ERP a palavra
 * explicada costuma ser justamente a que decide a ação ("disponível" não é o
 * mesmo que "em estoque"). Por isso o gatilho é um `<button>`: clique,
 * Enter e Espaço abrem igual, e o hover fica como atalho de mouse.
 *
 * A bolha é irmã do botão no DOM, logo depois dele: assim o leitor de tela
 * encontra o texto no lugar em que ele foi anunciado. Visualmente ela é
 * `position: fixed` e recebe coordenadas medidas aqui — não `absolute`. O
 * lugar mais comum do ⓘ é o cabeçalho de uma tabela, e `.table-container`
 * tem `overflow-x: auto`, que recorta o eixo Y junto: com poucas linhas a
 * bolha aparecia cortada pela borda da tabela. Ancorada ao viewport ela
 * escapa de qualquer ancestral recortado, e vira para dentro quando não
 * cabe à direita ou embaixo.
 */
export function InfoHint({
  label,
  children,
}: {
  /** O conceito explicado. Vira o nome acessível do botão ("Ajuda sobre Em compra"). */
  label: string;
  /** Explicação curta — texto ou marcação em linha. Texto longo é assunto de `ContextHelp`. */
  children: ReactNode;
}) {
  const bubbleId = useId();
  const [open, setOpen] = useState(false);
  /**
   * Aberto de propósito (clique/teclado) fica preso.
   *
   * Sem isto o hover e o clique brigam: passar o mouse abre, e o clique
   * seguinte — lido como "alternar" — fecharia justamente o que a pessoa
   * acabou de pedir para ver.
   */
  const [pinned, setPinned] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  /**
   * Coordenadas da bolha no viewport.
   *
   * `null` enquanto não foi medida — a bolha existe no DOM (é preciso
   * medi-la) mas fica invisível, senão pisca no canto antes de ir para o
   * lugar. É a parte que o CSS não faz sozinho: só aqui se conhece onde o
   * gatilho caiu e quanto espaço sobrou em volta.
   */
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosicao(null);
      return;
    }

    function medir() {
      const gatilho = trigger.current?.getBoundingClientRect();
      const balao = bubble.current?.getBoundingClientRect();
      if (!gatilho || !balao) return;

      /** Folga mínima até a borda da janela. */
      const MARGEM = 8;

      // Abaixo e alinhada à esquerda do ícone é o padrão. A última coluna de
      // uma tabela larga fica colada na borda: ali a bolha vira para dentro,
      // ancorada pela direita do ícone.
      let left = gatilho.left;
      if (left + balao.width > window.innerWidth - MARGEM) {
        left = Math.max(MARGEM, gatilho.right - balao.width);
      }

      // Cabeçalho no rodapé da janela: abre para cima em vez de sair da tela.
      let top = gatilho.bottom + 4;
      if (top + balao.height > window.innerHeight - MARGEM) {
        top = Math.max(MARGEM, gatilho.top - balao.height - 4);
      }

      setPosicao({ top, left });
    }

    medir();
    // Captura: a rolagem que importa costuma ser a do `.table-container`, não
    // a da janela, e evento de rolagem de elemento não sobe por bubbling.
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
      if (container.current?.contains(event.target as Node)) return;
      setOpen(false);
      setPinned(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <span
      ref={container}
      className="info-hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Escape aqui não pode fechar o modal em volta: a dica é a camada
        // mais interna e é ela que sai primeiro.
        event.stopPropagation();
        setOpen(false);
        setPinned(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="info-hint__trigger"
        aria-label={`Ajuda sobre ${label}`}
        aria-expanded={open}
        aria-controls={bubbleId}
        onClick={(event) => {
          // A dica costuma ficar dentro de `<label>` ou de linha clicável:
          // sem isto, pedir ajuda também marcaria o campo ou navegaria.
          event.stopPropagation();
          const abrir = !pinned;
          setOpen(abrir);
          setPinned(abrir);
        }}
      >
        <span aria-hidden="true">i</span>
      </button>

      {open && (
        <span
          ref={bubble}
          id={bubbleId}
          className={
            posicao ? "info-hint__bubble" : "info-hint__bubble info-hint__bubble--medindo"
          }
          style={posicao ? { top: posicao.top, left: posicao.left } : undefined}
        >
          {children}
        </span>
      )}
    </span>
  );
}
