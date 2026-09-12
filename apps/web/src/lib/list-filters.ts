import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { readStoredFilterSet, writeStoredFilterSet } from "./stored-filters";

/**
 * Estado dos filtros de uma listagem — fundação das telas operacionais.
 *
 * A URL é o estado. Não é detalhe de implementação: filtro que vive só em
 * `useState` não sobrevive a abrir um registro e voltar, não pode ser colado
 * num chamado e não diz ao CSV o que a tela está mostrando. Aqui a lista tem
 * endereço.
 *
 * Precedência, a mesma já documentada em `filter-params.ts`:
 *
 *   1. a URL, quando traz qualquer filtro desta tela;
 *   2. a lembrança da sessão, quando a tela pede `persistScope`;
 *   3. os defaults da tela.
 *
 * O passo 1 é tudo ou nada de propósito. Misturar a lembrança de quem abriu
 * com uma URL compartilhada faria duas pessoas verem listas diferentes no
 * mesmo endereço — e "estado compartilhável" deixaria de ser verdade.
 *
 * Quem some da URL é o que está no default: `?status=all&page=1` é ruído, e
 * um endereço com parâmetro repetido não é endereço. Trocar qualquer filtro
 * volta para a página 1 — a página 3 do filtro anterior responde outra
 * pergunta, e quase sempre está vazia.
 *
 * `defaults` pode ser literal inline: as dependências olham o VALOR, não a
 * identidade do objeto.
 */

const PARAM_PAGINA = "page";

export interface ListFiltersOptions<T extends Record<string, string>> {
  /** Um campo por filtro, com o valor que significa "sem filtro". */
  defaults: T;
  /**
   * Escopo da lembrança de sessão (ex.: `"billings"`). Sem ele a tela não
   * lembra nada — e várias listas não devem lembrar.
   */
  persistScope?: string;
  /** Dono da lembrança: filtro de um usuário não é o do outro. */
  userId?: string | null;
}

export interface ListFilters<T extends Record<string, string>> {
  /** Todos os filtros, já com os defaults preenchidos. */
  values: T;
  /** Só os que estão FORA do default — o que a API e o CSV recebem. */
  applied: Partial<T>;
  page: number;
  /** Aplica um ou mais filtros de uma vez e volta para a página 1. */
  set: (patch: Partial<T>) => void;
  setPage: (page: number) => void;
  clear: () => void;
  activeCount: number;
  isActive: boolean;
}

export function useListFilters<T extends Record<string, string>>(
  options: ListFiltersOptions<T>,
): ListFilters<T> {
  const { persistScope, userId = null } = options;
  /*
   * A assinatura do default por VALOR. Sem isto, um literal inline no
   * chamador daria identidade nova a cada render, `set` mudaria de
   * identidade junto e o `useEffect` de recarga da tela entraria em laço.
   */
  const assinatura = JSON.stringify(options.defaults);
  const defaults = useMemo(() => JSON.parse(assinatura) as T, [assinatura]);
  const chaves = useMemo(() => Object.keys(defaults) as (keyof T & string)[], [defaults]);

  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const resultado = { ...defaults };
    for (const chave of chaves) {
      const bruto = params.get(chave);
      // `?status=` é filtro limpo, não valor vazio: cai no default.
      if (bruto !== null && bruto !== "") resultado[chave] = bruto as T[typeof chave];
    }
    return resultado;
  }, [chaves, defaults, params]);

  const applied = useMemo(() => {
    const resultado: Partial<T> = {};
    for (const chave of chaves) {
      if (values[chave] !== defaults[chave]) resultado[chave] = values[chave];
    }
    return resultado;
  }, [chaves, defaults, values]);

  const page = useMemo(() => {
    const bruto = Number(params.get(PARAM_PAGINA));
    return Number.isFinite(bruto) && bruto >= 1 ? Math.floor(bruto) : 1;
  }, [params]);

  const escrever = useCallback(
    (proximos: T, pagina: number) => {
      setParams(
        (atuais) => {
          const proximo = new URLSearchParams(atuais);
          for (const [chave, padrao] of Object.entries(defaults) as [string, string][]) {
            const valor = proximos[chave] ?? padrao;
            if (valor === padrao) proximo.delete(chave);
            else proximo.set(chave, valor);
          }
          if (pagina <= 1) proximo.delete(PARAM_PAGINA);
          else proximo.set(PARAM_PAGINA, String(pagina));
          return proximo;
        },
        /*
         * `replace`: cada tecla digitada na busca é um estado de filtro, e
         * empilhar isso no histórico transformaria o botão Voltar do
         * navegador numa máquina de desfazer letras.
         */
        { replace: true },
      );
    },
    [defaults, setParams],
  );

  const set = useCallback(
    (patch: Partial<T>) => escrever({ ...values, ...patch }, 1),
    [escrever, values],
  );

  const setPage = useCallback((pagina: number) => escrever(values, pagina), [escrever, values]);

  const clear = useCallback(() => escrever(defaults, 1), [defaults, escrever]);

  /*
   * Restaura a lembrança da sessão UMA vez, e só quando a URL não trouxe
   * nenhum filtro desta tela. `useRef` porque a restauração reescreve a
   * própria URL: sem a trava, o efeito veria a URL nova e recomeçaria.
   */
  const restaurou = useRef(false);
  useEffect(() => {
    if (restaurou.current) return;
    restaurou.current = true;
    if (!persistScope) return;
    if (chaves.some((chave) => params.has(chave))) return;
    const guardado = readStoredFilterSet(userId, persistScope);
    const recuperados = chaves.filter((chave) => chave in guardado);
    if (recuperados.length === 0) return;
    const proximos = { ...defaults };
    for (const chave of recuperados) proximos[chave] = guardado[chave] as T[typeof chave];
    escrever(proximos, 1);
    // Uma passada só, na montagem: as dependências não a repetem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!persistScope) return;
    writeStoredFilterSet(userId, persistScope, applied as Record<string, string>);
  }, [applied, persistScope, userId]);

  const activeCount = Object.keys(applied).length;

  return { values, applied, page, set, setPage, clear, activeCount, isActive: activeCount > 0 };
}
