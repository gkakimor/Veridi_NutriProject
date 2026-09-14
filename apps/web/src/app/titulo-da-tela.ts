import { createContext, useContext, useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Título da aba — QUOTE-PAGE-NAV-ACTIVE-01.
 *
 * O `AppShell` dá a cada tela o nome do item de menu dela ("Orçamentos ·
 * Veridi Nutrition"). Documento com página própria diz QUAL documento: com
 * duas propostas abertas em abas, "Orçamentos" nas duas não separa uma da
 * outra. A tela entrega o nome dela por `useTituloDaTela`, e o shell o usa
 * enquanto a rota for a mesma.
 */

export const NOME_DO_SISTEMA = "Veridi Nutrition";

/** "ORC-000444 · V1 · Veridi Nutrition"; sem nome de tela, só o do sistema. */
export function tituloDaAba(tela: string | null | undefined): string {
  return tela ? `${tela} · ${NOME_DO_SISTEMA}` : NOME_DO_SISTEMA;
}

export interface TituloDaTela {
  /** A rota que pediu o título: noutra rota ele não vale. */
  rota: string;
  titulo: string;
}

export const TituloDaTelaContext = createContext<((titulo: TituloDaTela | null) => void) | null>(
  null,
);

/**
 * A tela diz o próprio nome — `null` enquanto não sabe (carregando), e o shell
 * mantém o do menu.
 *
 * Pelo shell, e não escrevendo `document.title` direto: o efeito do pai roda
 * DEPOIS do efeito do filho no mesmo commit, e o título do menu apagaria o da
 * tela. Fora do shell (teste da tela sozinha) escreve direto.
 */
export function useTituloDaTela(titulo: string | null | undefined): void {
  const definir = useContext(TituloDaTelaContext);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!titulo) return;
    if (!definir) {
      document.title = tituloDaAba(titulo);
      return;
    }
    definir({ rota: pathname, titulo });
    return () => definir(null);
  }, [definir, pathname, titulo]);
}
