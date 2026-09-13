import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BulkSelectionDescriptor } from "@veridi/shared";

/**
 * Seleção em massa de uma listagem paginada e filtrada
 * (BULK-SELECTION-FOUNDATION-01).
 *
 * Duas perguntas diferentes, dois gestos diferentes:
 *
 * - o checkbox do cabeçalho marca **os registros desta página** — com 327
 *   resultados e 20 à vista, são 20;
 * - "Selecionar todos os 327 resultados filtrados" é um clique à parte, que só
 *   aparece depois de a página inteira estar marcada.
 *
 * A seleção sai daqui como DESCRITOR, nunca como lista carregada. No modo
 * `filtered` o navegador guarda o filtro e as exceções, não os 327 ids: quem
 * executar a ação resolve o conjunto no servidor. Buscar `pageSize=10000` ou
 * andar pelas páginas juntando ids é exatamente o que este modo evita.
 *
 * É estado da tela aberta: não vai para a URL nem para a sessão. Trocar de
 * página preserva; trocar o filtro limpa, porque a seleção foi feita sobre
 * outro universo de registros.
 *
 * `TableSelection.tsx` continua sendo a seleção só da página, de Itens.
 */

/**
 * O que uma ação em lote recebe. Não conhece ação nenhuma. O tipo mora no
 * `@veridi/shared` desde BULK-DOCUMENTS-01: é o contrato que a API valida.
 */
export type { BulkSelectionDescriptor };

export type BulkPageState = "none" | "some" | "all";

export interface BulkSelectionOptions<F> {
  /** Ids ESTÁVEIS das linhas à vista — nunca índice, posição ou código exibido. */
  pageIds: readonly string[];
  /** Total do servidor para o filtro atual. */
  total: number;
  /**
   * O MESMO objeto de filtros que a tela manda para a listagem e para o CSV.
   * Paginação e campo vazio não mudam o universo e ficam fora da comparação.
   */
  filters: F;
  /**
   * Consulta em andamento. As linhas à vista podem ser do filtro anterior, e
   * marcar uma delas selecionaria um registro de outro universo.
   */
  loading?: boolean;
}

/** O que os componentes leem — independe do tipo do filtro. */
export interface BulkSelectionState {
  mode: "ids" | "filtered";
  /** Quantos estão selecionados de fato: no modo `filtered`, total − exceções. */
  count: number;
  total: number;
  excludedCount: number;
  visibleCount: number;
  pageState: BulkPageState;
  /** A página inteira está marcada e há mais resultados do que os marcados. */
  canSelectAllFiltered: boolean;
  disabled: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  togglePage: () => void;
  selectAllFiltered: () => void;
  clear: () => void;
  /**
   * Tira do conjunto os registros que o SERVIDOR disse terem saído do
   * universo (mutação feita na própria tela). Sumir de uma página recarregada
   * não é isso — o registro pode só ter mudado de página.
   */
  prune: (ids: readonly string[]) => void;
}

export interface BulkSelection<F> extends BulkSelectionState {
  /** `null` quando nada está selecionado. */
  descriptor: BulkSelectionDescriptor<F> | null;
}

type Estado = { mode: "ids"; ids: string[] } | { mode: "filtered"; excludedIds: string[] };

const NADA: Estado = { mode: "ids", ids: [] };

const PAGINACAO = new Set(["page", "pageSize"]);

/**
 * O filtro como conjunto de registros, por VALOR: objeto novo com o mesmo
 * conteúdo é o mesmo universo, e `?page=2` também.
 */
function assinaturaDe(filters: object): string {
  const entradas = Object.entries(filters)
    .filter(
      ([chave, valor]) =>
        !PAGINACAO.has(chave) &&
        valor !== undefined &&
        valor !== null &&
        valor !== "" &&
        !(Array.isArray(valor) && valor.length === 0),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entradas);
}

function marcado(estado: Estado, id: string): boolean {
  return estado.mode === "ids" ? estado.ids.includes(id) : !estado.excludedIds.includes(id);
}

/** Desmarcar um a um todos os resultados não é "todos, exceto todos": é nada. */
function semSobra(estado: Estado, total: number): Estado {
  return estado.mode === "filtered" && estado.excludedIds.length >= total ? NADA : estado;
}

function podeSelecionarTodos(estado: Estado, idsDaPagina: string[], total: number): boolean {
  return (
    estado.mode === "ids" &&
    idsDaPagina.length > 0 &&
    idsDaPagina.every((id) => estado.ids.includes(id)) &&
    total > estado.ids.length
  );
}

export function useBulkSelection<F extends object>({
  pageIds,
  total,
  filters,
  loading = false,
}: BulkSelectionOptions<F>): BulkSelection<F> {
  const assinatura = assinaturaDe(filters);
  const [guardado, setGuardado] = useState(() => ({ assinatura, estado: NADA }));

  let estado = guardado.estado;
  if (guardado.assinatura !== assinatura) {
    /*
     * O filtro mudou de verdade. Limpa já neste render — nenhum quadro com o
     * contador do universo anterior — e grava a limpeza, para que voltar ao
     * filtro antigo não ressuscite a seleção antiga.
     */
    estado = NADA;
    setGuardado({ assinatura, estado: NADA });
  }
  /* O total pode encolher depois das exceções: a tela nunca mostra "todos, exceto todos". */
  estado = semSobra(estado, total);

  /* O recorte que o modo `filtered` entrega, lido da própria assinatura. */
  const recorte = useMemo(
    () => Object.fromEntries(JSON.parse(assinatura) as [string, unknown][]) as F,
    [assinatura],
  );

  /* Dependência por valor: a tela monta `rows.map(r => r.id)` a cada render. */
  const chaveDaPagina = JSON.stringify(pageIds);
  const idsDaPagina = useMemo(() => JSON.parse(chaveDaPagina) as string[], [chaveDaPagina]);

  const mudar = useCallback(
    (transformar: (atual: Estado) => Estado) => {
      setGuardado((anterior) => ({
        assinatura,
        estado: transformar(anterior.assinatura === assinatura ? anterior.estado : NADA),
      }));
    },
    [assinatura],
  );

  const toggle = useCallback(
    (id: string) => {
      if (loading) return;
      mudar((atual) => {
        if (atual.mode === "ids") {
          return {
            mode: "ids",
            ids: atual.ids.includes(id) ? atual.ids.filter((outro) => outro !== id) : [...atual.ids, id],
          };
        }
        // Em "todos os filtrados", desmarcar é exceção — o modo continua.
        const excludedIds = atual.excludedIds.includes(id)
          ? atual.excludedIds.filter((outro) => outro !== id)
          : [...atual.excludedIds, id];
        return semSobra({ mode: "filtered", excludedIds }, total);
      });
    },
    [loading, mudar, total],
  );

  const togglePage = useCallback(() => {
    if (loading || idsDaPagina.length === 0) return;
    mudar((atual) => {
      const paginaInteira = idsDaPagina.every((id) => marcado(atual, id));
      if (atual.mode === "ids") {
        return {
          mode: "ids",
          ids: paginaInteira
            ? atual.ids.filter((id) => !idsDaPagina.includes(id))
            : [...atual.ids, ...idsDaPagina.filter((id) => !atual.ids.includes(id))],
        };
      }
      const excludedIds = paginaInteira
        ? [...atual.excludedIds, ...idsDaPagina.filter((id) => !atual.excludedIds.includes(id))]
        : atual.excludedIds.filter((id) => !idsDaPagina.includes(id));
      return semSobra({ mode: "filtered", excludedIds }, total);
    });
  }, [idsDaPagina, loading, mudar, total]);

  const selectAllFiltered = useCallback(() => {
    if (loading) return;
    mudar((atual) =>
      podeSelecionarTodos(atual, idsDaPagina, total) ? { mode: "filtered", excludedIds: [] } : atual,
    );
  }, [idsDaPagina, loading, mudar, total]);

  const clear = useCallback(() => mudar(() => NADA), [mudar]);

  const prune = useCallback(
    (sairam: readonly string[]) => {
      if (sairam.length === 0) return;
      mudar((atual) =>
        atual.mode === "ids"
          ? { mode: "ids", ids: atual.ids.filter((id) => !sairam.includes(id)) }
          : { mode: "filtered", excludedIds: atual.excludedIds.filter((id) => !sairam.includes(id)) },
      );
    },
    [mudar],
  );

  const isSelected = useCallback((id: string) => marcado(estado, id), [estado]);

  const count =
    estado.mode === "ids" ? estado.ids.length : Math.max(0, total - estado.excludedIds.length);
  const marcadosNaPagina = idsDaPagina.filter((id) => marcado(estado, id)).length;
  const pageState: BulkPageState =
    marcadosNaPagina === 0 ? "none" : marcadosNaPagina === idsDaPagina.length ? "all" : "some";

  const descriptor = useMemo<BulkSelectionDescriptor<F> | null>(() => {
    if (count === 0) return null;
    return estado.mode === "ids"
      ? { mode: "ids", ids: [...estado.ids] }
      : { mode: "filtered", filters: recorte, excludedIds: [...estado.excludedIds] };
  }, [count, estado, recorte]);

  return {
    mode: estado.mode,
    count,
    total,
    excludedCount: estado.mode === "filtered" ? estado.excludedIds.length : 0,
    visibleCount: idsDaPagina.length,
    pageState,
    canSelectAllFiltered: !loading && podeSelecionarTodos(estado, idsDaPagina, total),
    disabled: loading,
    isSelected,
    toggle,
    togglePage,
    selectAllFiltered,
    clear,
    prune,
    descriptor,
  };
}

/**
 * Checkbox que sabe ser "parcial". `indeterminate` é propriedade do DOM, não
 * atributo — e o navegador a zera a cada clique, mesmo quando o estado não
 * muda; por isso o efeito roda em todo render.
 */
export function BulkSelectionCheckbox({
  label,
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const caixa = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (caixa.current) caixa.current.indeterminate = indeterminate;
  });
  /* O rótulo cobre a célula: alvo de toque maior que a caixa de 16px. */
  return (
    <label className="bulk-select">
      <input
        ref={caixa}
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}

export function BulkSelectionHeaderCell({
  selection,
  label = "Selecionar todos os registros desta página",
}: {
  selection: BulkSelectionState;
  label?: string;
}) {
  return (
    <th className="table__select table__select--bulk">
      <BulkSelectionCheckbox
        label={label}
        checked={selection.pageState === "all"}
        indeterminate={selection.pageState === "some"}
        disabled={selection.disabled || selection.visibleCount === 0}
        onChange={selection.togglePage}
      />
    </th>
  );
}

/**
 * Célula de seleção da linha. A linha inteira abre o registro; o clique e o
 * Enter dados aqui dentro ficam aqui dentro.
 */
export function BulkSelectionCell({
  selection,
  id,
  label,
}: {
  selection: BulkSelectionState;
  id: string;
  /** Nome do registro para quem não vê a linha: "Selecionar pedido PED-000123". */
  label: string;
}) {
  return (
    <td
      className="table__select table__select--bulk"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <BulkSelectionCheckbox
        label={label}
        checked={selection.isSelected(id)}
        disabled={selection.disabled}
        onChange={() => selection.toggle(id)}
      />
    </td>
  );
}

function selecionados(count: number): string {
  return `${count} ${count === 1 ? "selecionado" : "selecionados"}`;
}

function fraseDeTodos(total: number, excluidos: number): string {
  const base =
    total === 1
      ? "O único resultado filtrado está selecionado"
      : `Todos os ${total} resultados filtrados estão selecionados`;
  if (excluidos === 0) return `${base}.`;
  return `${base}, exceto ${excluidos} ${excluidos === 1 ? "desmarcado" : "desmarcados"}.`;
}

/**
 * Barra contextual da seleção: quantos, o alcance, as ações de quem usa e a
 * saída. Existe só com seleção, logo acima da tabela; não é modal e não cobre
 * linha nenhuma. Ações não moram aqui — chegam por `children`.
 */
export function BulkSelectionBar({
  selection,
  children,
}: {
  selection: BulkSelectionState;
  children?: ReactNode;
}) {
  const { count, total, mode, excludedCount } = selection;
  const alcance = mode === "filtered" ? fraseDeTodos(total, excludedCount) : null;

  /* Quem usa leitor de tela ouve o contador mudar — e ouve a limpeza também. */
  const [houveSelecao, setHouveSelecao] = useState(false);
  if (count > 0 && !houveSelecao) setHouveSelecao(true);
  const anuncio =
    count > 0
      ? [`${selecionados(count)}.`, alcance].filter(Boolean).join(" ")
      : houveSelecao
        ? "Nenhum registro selecionado."
        : "";

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {anuncio}
      </p>
      {count > 0 && (
        <div className="bulk-bar" role="group" aria-label="Seleção em massa" data-mode={mode}>
          <div className="bulk-bar__group">
            <p className="bulk-bar__count">
              <b>{count}</b> {count === 1 ? "selecionado" : "selecionados"}
            </p>
            {alcance && <p className="bulk-bar__scope">{alcance}</p>}
            {selection.canSelectAllFiltered && (
              <button
                type="button"
                className="btn btn--ghost btn--sm bulk-bar__all"
                onClick={selection.selectAllFiltered}
              >
                {`Selecionar todos os ${total} resultados filtrados`}
              </button>
            )}
          </div>
          <div className="bulk-bar__group">
            {children ?? <span className="bulk-bar__hint">Use a seleção para ações em lote.</span>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={selection.clear}>
              Limpar seleção
            </button>
          </div>
        </div>
      )}
    </>
  );
}
