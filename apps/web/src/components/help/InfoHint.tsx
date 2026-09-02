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
 * encontra o texto no lugar em que ele foi anunciado. Ela flutua por
 * `position: absolute` — dentro de um ancestral com `overflow` recortado
 * (célula de tabela rolável) ela é cortada; nesse caso, prefira `ContextHelp`
 * acima da tabela.
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
   * Bolha ancorada pela direita.
   *
   * A última coluna de uma tabela larga fica colada na borda da janela; a
   * bolha alinhada à esquerda do ícone saía da tela e levava rolagem
   * horizontal junto. É a única medida que o CSS não consegue fazer sozinho.
   */
  const [alignEnd, setAlignEnd] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const rect = bubble.current?.getBoundingClientRect();
    if (!rect) return;
    setAlignEnd(rect.right > window.innerWidth - 8);
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
          className={alignEnd ? "info-hint__bubble info-hint__bubble--end" : "info-hint__bubble"}
        >
          {children}
        </span>
      )}
    </span>
  );
}
