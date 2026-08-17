import { useEffect, useState } from "react";

/**
 * Persistência simples dos filtros das telas operacionais.
 *
 * `sessionStorage` de propósito: quem abre um lote e volta para a lista não
 * deve perder o filtro, mas também não deve encontrar amanhã uma tela
 * aparentemente vazia por causa de um filtro que nem lembra ter aplicado.
 * Sair do sistema limpa naturalmente.
 *
 * Não é "visão salva": isso seria entidade nova, no banco, e está fora de
 * escopo. Aqui é memória curta do navegador, por usuário e por tela.
 */

const PREFIX = "veridi:filters";

export function filterStorageKey(userId: string | null, scope: string, field: string): string {
  return `${PREFIX}:${userId ?? "anon"}:${scope}:${field}`;
}

/**
 * `useState` que lembra o valor na sessão.
 *
 * Um campo por chave: trocar um filtro nunca reescreve os outros, e um
 * valor gravado por uma versão anterior da tela some sozinho quando o
 * campo deixa de existir.
 */
export function usePersistentFilter<T>(
  userId: string | null,
  scope: string,
  field: string,
  initial: T,
  /**
   * Contexto explícito da URL. Quando vem preenchido, vence o que estava
   * guardado da sessão: quem clicou em "ver pedidos deste cliente" está
   * pedindo esse filtro, não o da última visita.
   */
  override?: T | null,
): [T, (value: T) => void] {
  const key = filterStorageKey(userId, scope, field);

  const [value, setValue] = useState<T>(() => {
    if (override !== undefined && override !== null && override !== ("" as unknown as T)) {
      return override;
    }
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      // Sessão sem storage (modo restrito): a tela continua funcionando,
      // só não lembra do filtro.
      return initial;
    }
  });

  useEffect(() => {
    try {
      if (JSON.stringify(value) === JSON.stringify(initial)) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Mesmo caso acima.
    }
    // `initial` é literal estável nos chamadores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}

/**
 * Limpa os filtros guardados de uma tela.
 *
 * Persistência sem saída óbvia é armadilha: o "Limpar filtros" precisa
 * devolver a lista completa em um clique.
 */
export function clearStoredFilters(userId: string | null, scope: string): void {
  const prefix = `${PREFIX}:${userId ?? "anon"}:${scope}:`;
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // Sem storage não há o que limpar.
  }
}
