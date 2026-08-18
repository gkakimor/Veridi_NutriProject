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
  canCreate = false,
  createLabel = "Cadastrar novo",
  onCreateNew,
}: {
  id: string;
  options: EntityOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
  /**
   * Criação no contexto: quando o que a pessoa procura não existe, cadastrar
   * ali mesmo evita abandonar o formulário pela metade. Só aparece quando o
   * papel do usuário permite criar — CTA que termina em 403 é pior que CTA
   * nenhum.
   */
  canCreate?: boolean;
  createLabel?: string;
  onCreateNew?: (typed: string) => void;
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

  // Seleção que chega de fora — criação no contexto devolvendo o registro
  // recém-cadastrado — precisa aparecer no campo. Sem isto o valor está
  // escolhido no estado e a tela mostra caixa vazia, que lê como "não salvou".
  useEffect(() => {
    if (!value) return;
    setQuery("");
    setOpen(false);
  }, [value]);

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

  /**
   * "Cadastrar novo" é a última parada da lista, não um botão solto embaixo
   * dela. Quem chega ao fim dos resultados com a seta continua a navegação e
   * cai no cadastro — antes essa ação só existia para quem usava mouse, e
   * quem digitava o nome de um cliente que ainda não existe ficava sem saída.
   */
  // A lista renderiza no máximo 50 resultados; navegar por teclado além
  // disso apontaria `aria-activedescendant` para um item que não existe no
  // DOM — e o leitor de tela ficaria mudo no meio da lista.
  const visible = useMemo(() => filtered.slice(0, 50), [filtered]);
  const createIndex = canCreate && onCreateNew ? visible.length : -1;
  const navigableCount = visible.length + (createIndex >= 0 ? 1 : 0);

  function startCreate() {
    if (!onCreateNew) return;
    setOpen(false);
    onCreateNew(query.trim());
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
        if (navigableCount === 0) return 0;
        return (current + step + navigableCount) % navigableCount;
      });
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      if (createIndex >= 0 && activeIndex === createIndex) {
        event.preventDefault();
        startCreate();
        return;
      }
      const option = visible[activeIndex];
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

  const createOptionId = `${listId}-create`;
  const activeId = !open
    ? undefined
    : createIndex >= 0 && activeIndex === createIndex
      ? createOptionId
      : visible[activeIndex]
        ? `${listId}-${visible[activeIndex]!.id}`
        : undefined;

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
            {/* Filho de `listbox` que não é opção precisa dizer que não é —
                senão o leitor de tela conta aviso e ação como resultado. */}
            {options.length === 0 && !canCreate && (
              <li role="presentation" className="entity-select__empty">
                Nada disponível para escolher.
              </li>
            )}
            {options.length > 0 && filtered.length === 0 && (
              <li role="presentation" className="entity-select__empty">
                {emptyMessage}
              </li>
            )}
            {visible.map((option, index) => (
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
              <li role="presentation" className="entity-select__empty">
                +{filtered.length - 50} resultados — refine a busca.
              </li>
            )}
            {createIndex >= 0 && (
              <li
                id={createOptionId}
                role="option"
                aria-selected={activeIndex === createIndex}
                className={
                  activeIndex === createIndex
                    ? "entity-select__option entity-select__create is-active"
                    : "entity-select__option entity-select__create"
                }
                onMouseDown={(event) => {
                  // `mousedown` antes do blur fechar a lista.
                  event.preventDefault();
                  startCreate();
                }}
                onMouseEnter={() => setActiveIndex(createIndex)}
              >
                + {createLabel}
                {query.trim() ? `: “${query.trim()}”` : ""}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
