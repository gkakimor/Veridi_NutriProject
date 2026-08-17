import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface EntityOption {
  id: string;
  /** Código de negócio (MP-000245, FOR-000903, PROD-000012). */
  code: string;
  name: string;
  /** Complemento opcional à direita (ex.: unidade, cliente). */
  hint?: string;
}

/**
 * Seleção de entidade por digitação — substitui o `<select>` nativo onde o
 * catálogo é grande (centenas de itens, produtos, fornecedores).
 *
 * O problema não era truncamento (já resolvido): é que rolar 800 opções em
 * lista crua não é trabalho de gente. Aqui a pessoa digita o código ou o nome
 * e a lista filtra.
 *
 * Teclado é requisito, não enfeite: ↑/↓ percorrem, Enter escolhe, Escape
 * fecha sem alterar, Tab sai. Combobox segue o padrão ARIA (`combobox` +
 * `listbox` + `aria-activedescendant`), então leitor de tela anuncia a opção
 * ativa.
 *
 * A lista sai por portal, ancorada em coordenadas de viewport. Dentro do
 * fluxo ela era recortada por qualquer pai com `overflow` — no editor de
 * linhas do Pedido o resultado virava uma janelinha de ~90px com scroll
 * próprio. Painel flutuante resolve o recorte e devolve espaço de leitura.
 */
export function SearchableEntitySelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Digite código ou nome…",
  disabled,
  required,
  emptyMessage = "Nenhum resultado.",
}: {
  id: string;
  options: EntityOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  /** Espaço de leitura: ~10 resultados, sem passar do que a janela oferece. */
  const measure = useCallback(() => {
    const element = input.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 220 && above > below;
    const available = Math.max(160, Math.min(360, openUp ? above : below));
    // Nome de produto é longo: a lista pode passar da largura do campo, desde
    // que caiba na janela e não crie rolagem horizontal.
    const width = Math.min(Math.max(rect.width, 380), window.innerWidth - 24);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setAnchor({
      left,
      top: openUp ? rect.top - available - 4 : rect.bottom + 4,
      width,
      maxHeight: available,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  const selected = options.find((option) => option.id === value) ?? null;

  /** Busca sem acento e sem caixa: quem digita rápido não acentua. */
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  const filtered = useMemo(() => {
    const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((option) => {
      const haystack = normalize(`${option.code} ${option.name} ${option.hint ?? ""}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (container.current?.contains(target)) return;
      // A lista vive no portal: clicar nela não é clicar fora.
      if ((target as HTMLElement).closest?.(".entity-select__list")) return;
      // Fechar clicando fora descarta a busca em andamento: texto digitado
      // sem seleção confirmada não pode ficar no campo parecendo escolha.
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function choose(option: EntityOption) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
    input.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (filtered.length === 0) return 0;
        return (current + step + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      const option = filtered[activeIndex];
      if (option) {
        event.preventDefault();
        choose(option);
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  const activeId = open && filtered[activeIndex] ? `${listId}-${filtered[activeIndex]!.id}` : undefined;

  return (
    <div className="entity-select" ref={container}>
      <input
        id={id}
        ref={input}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(activeId ? { "aria-activedescendant": activeId } : {})}
        {...(required ? { required: !selected } : {})}
        disabled={disabled ?? false}
        placeholder={selected ? `${selected.code} · ${selected.name}` : placeholder}
        value={open ? query : selected ? `${selected.code} · ${selected.name}` : query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {selected && !open && (
        <button
          type="button"
          className="entity-select__clear"
          aria-label="Limpar seleção"
          disabled={disabled ?? false}
          onClick={() => {
            onChange("");
            setQuery("");
            input.current?.focus();
          }}
        >
          ✕
        </button>
      )}

      {open &&
        anchor &&
        createPortal(
          <ul
            className="entity-select__list"
            id={listId}
            role="listbox"
            style={{
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
            }}
          >
            {options.length === 0 && (
              <li className="entity-select__empty">Nada disponível para escolher.</li>
            )}
            {options.length > 0 && filtered.length === 0 && (
              <li className="entity-select__empty">{emptyMessage}</li>
            )}
            {filtered.slice(0, 50).map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${option.id}`}
                role="option"
                aria-selected={option.id === value}
                className={
                  index === activeIndex ? "entity-select__option is-active" : "entity-select__option"
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="code">{option.code}</span>
                <span className="entity-select__name">{option.name}</span>
                {option.hint && <span className="entity-select__hint">{option.hint}</span>}
              </li>
            ))}
            {filtered.length > 50 && (
              <li className="entity-select__empty">
                +{filtered.length - 50} resultados — refine a busca.
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
