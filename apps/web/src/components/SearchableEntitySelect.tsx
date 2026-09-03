import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface EntityOption {
  id: string;
  /** Código de negócio (MP-000245, FOR-000903, PROD-000012). */
  code: string;
  name: string;
  /** Complemento opcional à direita (ex.: unidade, cliente). */
  hint?: string;
  /**
   * Texto que a busca enxerga mas a lista não mostra.
   *
   * Cliente é o caso que obrigou isto: a linha exibe a razão social, e
   * quem procura digita o nome fantasia ou o CNPJ. Sem este campo, "THE
   * KING" não encontrava o cliente chamado "35.301.394 THIAGO LUZ DE
   * SOUZA" — e a única opção na tela era cadastrar de novo.
   */
  searchTerms?: string;
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
  onSearch,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
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
  /**
   * Busca no SERVIDOR. Ausente, o campo filtra a lista de `options`.
   *
   * Existe porque filtrar no navegador só enxerga o que foi carregado, e
   * quem carrega um catálogo com teto fixo passa a esconder tudo o que
   * passou dele — sem aviso. Medido: a contagem física carregava mil itens
   * de dois mil setecentos e vinte e nove, e os mil setecentos e vinte e
   * nove restantes ficavam impossíveis de achar pela busca. Como o campo
   * ainda oferece "+ Novo", o caminho natural de quem não achava era
   * cadastrar de novo o que já existia.
   *
   * Com esta função o campo pergunta ao servidor, que conhece o catálogo
   * inteiro. `options` continua servindo à abertura sem digitar e ao rótulo
   * do registro já escolhido.
   */
  onSearch?: (termo: string) => Promise<EntityOption[]>;
  /**
   * Repassados ao `combobox` interno para que o formulário ligue erro e
   * campo — mesmo par `aria-invalid` / `aria-describedby` que um `<input>`
   * nativo receberia.
   */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Enquanto o cadastro no contexto está aberto, o popover não volta. */
  const creating = useRef(false);
  /**
   * A lista atual já foi navegada por seta?
   *
   * Começa `true`: abrir a lista sem digitar e apertar a seta deve ANDAR,
   * que é o comportamento normal de combobox. Só filtrar zera isto — ver
   * `handleKeyDown`.
   */
  const navigated = useRef(true);
  /**
   * Resultado da busca no servidor. `null` = ainda não houve busca, e a
   * lista mostra `options`.
   */
  const [remoto, setRemoto] = useState<EntityOption[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState(false);
  /**
   * Geração da busca em curso.
   *
   * "caf" e "cafeína" saem quase juntos e voltam fora de ordem; sem isto a
   * resposta velha sobrescreve a nova e a lista passa a mostrar o resultado
   * de um texto que não está mais no campo.
   */
  const geracao = useRef(0);
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
    // Cadastro concluído: o registro novo já está escolhido, então o
    // selector volta ao normal e pode reabrir em novo foco do usuário.
    creating.current = false;
    setQuery("");
    setOpen(false);
  }, [value]);

  /** Busca sem acento e sem caixa: quem digita rápido não acentua. */
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  /** Só letras e dígitos: "35.301.394/0001-00" e "35301394" viram o mesmo. */
  const compact = (text: string) => text.replace(/[^a-z0-9]/g, "");

  /*
   * Busca no servidor, com espera curta.
   *
   * 200ms é o suficiente para não disparar uma consulta por tecla e curto o
   * bastante para a lista parecer imediata a quem digita devagar.
   */
  useEffect(() => {
    if (!onSearch) return;
    const termo = query.trim();

    if (termo.length === 0) {
      // Campo vazio volta a mostrar a primeira página que já veio pronta —
      // pedir "tudo" ao servidor traria o catálogo inteiro de novo.
      geracao.current += 1;
      setRemoto(null);
      setBuscando(false);
      setErroBusca(false);
      return;
    }

    const minha = (geracao.current += 1);
    setBuscando(true);
    setErroBusca(false);

    const timer = setTimeout(() => {
      onSearch(termo)
        .then((resultados) => {
          // Chegou tarde: outra busca já saiu depois desta.
          if (minha !== geracao.current) return;
          setRemoto(resultados);
          setBuscando(false);
        })
        .catch(() => {
          if (minha !== geracao.current) return;
          setRemoto([]);
          setErroBusca(true);
          setBuscando(false);
        });
    }, 200);

    return () => clearTimeout(timer);
    // `onSearch` fica fora das dependências de propósito: a maioria dos
    // chamadores define a função no corpo do render, e incluí-la refaria a
    // busca a cada tecla digitada em QUALQUER campo da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filtered = useMemo(() => {
    // Havendo busca no servidor, ela é a resposta: refiltrar no navegador
    // descartaria resultado que o servidor achou por critério próprio.
    if (onSearch && remoto !== null) return remoto;

    const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((option) => {
      const haystack = normalize(
        `${option.code} ${option.name} ${option.hint ?? ""} ${option.searchTerms ?? ""}`,
      );
      const haystackCompacto = compact(haystack);
      return words.every((word) => {
        if (haystack.includes(word)) return true;
        // Documento digitado com ou sem pontuação é a MESMA busca. Palavra
        // que some ao compactar (só pontuação) não vira casamento vazio.
        const palavraCompacta = compact(word);
        return palavraCompacta.length > 0 && haystackCompacto.includes(palavraCompacta);
      });
    });
  }, [options, query, onSearch, remoto]);

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

  // A lista renderiza no máximo 50 resultados; navegar por teclado além
  // disso apontaria `aria-activedescendant` para um item que não existe no
  // DOM — e o leitor de tela ficaria mudo no meio da lista.
  const visible = useMemo(() => filtered.slice(0, 50), [filtered]);
  const canOfferCreate = canCreate && Boolean(onCreateNew);
  /**
   * O texto digitado é o nome ou o código de um registro que já está na
   * lista?
   *
   * Sem acento, sem caixa e, para o código, sem pontuação — "35.301.394" e
   * "35301394" são o mesmo código.
   */
  const casaExato = useMemo(() => {
    const termo = normalize(query.trim());
    if (!termo) return false;
    const termoCompacto = compact(termo);
    return visible.some((option) => {
      const code = normalize(option.code);
      const name = normalize(option.name);
      if (termo === code || termo === name || termo === `${code} ${name}`) return true;
      return termoCompacto.length > 0 && termoCompacto === compact(code);
    });
    // `normalize` e `compact` são funções puras redeclaradas a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, query]);
  /*
   * "+ Novo X" encabeça a lista — menos quando o registro digitado já
   * existe.
   *
   * A ordem visual, a do DOM e a do teclado são sempre a mesma, esteja o
   * cadastro no topo ou no fim — nada de item pregado que o leitor de tela
   * anuncia fora de lugar.
   *
   * Ele já morou no fim quando havia correspondência, para que a ação mais
   * destrutiva do formulário — criar um duplicado — não fosse a mais fácil
   * de clicar. O problema é que ali ninguém o achava: com dez resultados a
   * ação ficava abaixo da dobra da lista, e quem não encontrava o registro
   * concluía que não dava para criar.
   *
   * Nome parecido não prova nada, e nesse caso o cadastro continua no topo.
   * Mas quando o que foi digitado é exatamente o código ou o nome de um
   * registro da lista, o convite a duplicar não pode vir antes do próprio
   * registro: ali o cadastro desce para depois dos resultados.
   *
   * A proteção contra o duplicado também não mudou: o índice ativo nasce no
   * primeiro RESULTADO, então quem digita e aperta Enter escolhe — nunca
   * cria. Chegar ao cadastro exige seta ou clique, que são atos
   * deliberados.
   */
  const criarPrimeiro = canOfferCreate && !casaExato;
  const createIndex = canOfferCreate ? (criarPrimeiro ? 0 : visible.length) : -1;
  /** Deslocamento dos resultados: encabeçando, o cadastro ocupa o índice 0. */
  const primeiroResultado = criarPrimeiro ? 1 : 0;
  const navigableCount = visible.length + (canOfferCreate ? 1 : 0);
  /** Opção sob o índice navegável — `null` quando o índice é o cadastro. */
  const opcaoNoIndice = (indice: number) => visible[indice - primeiroResultado] ?? null;
  /*
   * Onde o índice ativo nasce.
   *
   * No primeiro RESULTADO, para que Enter escolha em vez de cadastrar. Sem
   * resultado nenhum — nome que ainda não existe — a única ação possível é
   * cadastrar, e é nela que o Enter tem que cair: caso contrário quem digita
   * um fornecedor novo aperta Enter e não acontece nada.
   */
  const indiceInicial = visible.length > 0 ? primeiroResultado : Math.max(createIndex, 0);

  // Depois de `indiceInicial` existir: a lista reposiciona o item ativo a
  // cada busca nova e a cada abertura.
  useEffect(() => {
    setActiveIndex(indiceInicial);
  }, [query, open, indiceInicial]);

  /**
   * Entrega para o cadastro no contexto.
   *
   * O popover precisa sumir ANTES do painel de criação aparecer e continuar
   * fechado: como o `onFocus` do input reabre a lista, o foco devolvido pelo
   * painel ressuscitava o `listbox` por cima dele — sobrava uma camada
   * fantasma, com `role=listbox` órfão, sobre o formulário.
   */
  function startCreate() {
    if (!onCreateNew) return;
    creating.current = true;
    setOpen(false);
    /*
     * A busca é descartada aqui, e não na volta do cadastro.
     *
     * Salvando, o campo passa a mostrar a entidade criada — o texto digitado
     * não tem mais o que fazer ali. Desistindo, o campo fica vazio, que é a
     * verdade: nada foi escolhido. Mantê-lo deixava o nome digitado parado
     * no campo parecendo seleção confirmada, exatamente o que o descarte no
     * clique-fora existe para evitar.
     *
     * O texto vai inteiro para `onCreateNew` antes de sumir, então o
     * cadastro ainda nasce com o que a pessoa escreveu.
     */
    const digitado = query.trim();
    setQuery("");
    onCreateNew(digitado);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      /*
       * A lista já abre com o primeiro resultado ativo. Quem digita e usa a
       * seta espera ENTRAR na lista, não pular o primeiro item: com um único
       * resultado, a primeira seta caía direto em "+ Cadastrar novo" e o
       * Enter seguinte abria a criação de um registro que já existe.
       *
       * A primeira seta depois de filtrar só confirma o item ativo; a
       * navegação normal continua a partir daí.
       */
      if (!navigated.current) {
        navigated.current = true;
        if (event.key === "ArrowDown") return;
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
      const option = opcaoNoIndice(activeIndex);
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
      : opcaoNoIndice(activeIndex)
        ? `${listId}-${opcaoNoIndice(activeIndex)!.id}`
        : undefined;

  const itemCadastrar =
    createIndex >= 0 ? (
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
    ) : null;

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
        {...(ariaInvalid ? { "aria-invalid": true as const } : {})}
        {...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {})}
        {...(required ? { required: !selected } : {})}
        disabled={disabled ?? false}
        placeholder={selected ? `${selected.code} · ${selected.name}` : placeholder}
        value={open ? query : selected ? `${selected.code} · ${selected.name}` : query}
        onFocus={() => {
          // Foco devolvido pelo cadastro no contexto não reabre a lista.
          if (creating.current) return;
          setOpen(true);
        }}
        onChange={(event) => {
          creating.current = false;
          setQuery(event.target.value);
          setOpen(true);
          navigated.current = false;
          /*
           * Filtrar encurta a lista, e o índice ativo ficava onde estava.
           * Digitar "NutriViva" deixava um resultado real e o cadastro; o
           * índice herdado já apontava para o cadastro, então a primeira
           * seta caía em "+ Cadastrar novo cliente" e Enter abria a
           * criação de um registro que existe. Lista nova começa no
           * primeiro resultado real.
           */
          setActiveIndex(indiceInicial);
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
            {criarPrimeiro && itemCadastrar}

            {/*
              Três estados diferentes, três frases diferentes. Dizer "nenhum
              resultado" enquanto a busca ainda está no ar faz a pessoa parar
              de digitar e concluir que o registro não existe — que é
              exatamente o engano que leva a cadastrar duplicata.
            */}
            {buscando && (
              <li role="presentation" className="entity-select__empty">
                Procurando…
              </li>
            )}
            {!buscando && erroBusca && (
              <li role="presentation" className="entity-select__empty">
                Não foi possível buscar agora. Tente de novo.
              </li>
            )}
            {!buscando && !erroBusca && options.length === 0 && filtered.length === 0 && !canCreate && (
              <li role="presentation" className="entity-select__empty">
                Nada disponível para escolher.
              </li>
            )}
            {!buscando && !erroBusca && filtered.length === 0 && options.length > 0 && (
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
                  index + primeiroResultado === activeIndex
                    ? "entity-select__option is-active"
                    : "entity-select__option"
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActiveIndex(index + primeiroResultado)}
              >
                <span className="code">{option.code}</span>
                <span className="entity-select__name">{option.name}</span>
                {option.hint && <span className="entity-select__hint">{option.hint}</span>}
              </li>
            ))}

            {/* O que foi digitado já existe na lista: o registro vem antes do
                convite a criar outro igual. Ordem visual, ordem do DOM e ordem
                do teclado continuam sendo a mesma. */}
            {!criarPrimeiro && itemCadastrar}

            {filtered.length > 50 && (
              <li role="presentation" className="entity-select__empty">
                +{filtered.length - 50} resultados — refine a busca.
              </li>
            )}
            {/*
              Sem digitar, a lista é só a primeira página do catálogo. Quem
              não vê o que procura precisa saber que o resto existe e é
              alcançável — sem isso a lista curta parece o catálogo inteiro.
            */}
            {onSearch && query.trim().length === 0 && !buscando && (
              <li role="presentation" className="entity-select__empty">
                Digite para buscar em todo o catálogo.
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
