import { useSearchParams } from "react-router-dom";

/**
 * Filtro inicial de uma listagem, com precedência explícita:
 *
 *   1. query param da URL (contexto explícito: veio de um link de relação);
 *   2. valor guardado da sessão, quando a tela usa `usePersistentFilter`;
 *   3. default da tela.
 *
 * A URL vence porque quem clicou em "Ver pedidos deste cliente" está pedindo
 * exatamente aquilo — abrir a tela com o filtro anterior seria responder outra
 * pergunta.
 */
export function useInitialFilters(): (name: string, fallback?: string) => string {
  const [params] = useSearchParams();
  return (name, fallback = "") => params.get(name) ?? fallback;
}
