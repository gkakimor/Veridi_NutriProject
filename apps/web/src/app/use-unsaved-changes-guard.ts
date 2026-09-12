import { useCallback, useEffect, useId, useRef } from "react";
import type { FonteDeAlteracao } from "./unsaved-changes-context";
import { useUnsavedChangesContext } from "./unsaved-changes-context";

export interface GuardaDeAlteracoes {
  /**
   * Fecha o contexto atual sem passar pelo router — Cancelar, ✕ e Esc.
   *
   * Limpo: executa na hora. Sujo: abre o mesmo diálogo da navegação, e a ação
   * só roda em "Sair sem salvar".
   */
  confirmarDescarte: (acao: () => void) => void;
  /**
   * Executa a ação com a guarda suspensa — usado logo depois de um salvamento
   * bem-sucedido, quando o `isDirty` desta renderização ainda é o de antes.
   */
  liberarGuarda: (acao: () => void) => void;
}

/**
 * Registra uma fonte de alteração não salva na guarda global.
 *
 * Recebe um BOOLEANO, não o formulário: cada tela já sabe dizer se tem
 * alteração pendente, e a foundation não tem como descobrir isso sozinha sem
 * reimplementar a comparação de cada uma — que é exatamente onde essas
 * verificações divergem em silêncio.
 *
 * Mais de uma fonte na mesma tela é normal (formulário + subformulário) e não
 * multiplica diálogos: o provider é um só, e a pergunta também.
 */
export function useUnsavedChangesGuard(fonte: FonteDeAlteracao): GuardaDeAlteracoes {
  const contexto = useUnsavedChangesContext();
  const id = useId();
  const { isDirty, substantivo, genero } = fonte;

  /* O clique lê o valor do instante do clique, não o do render que criou o
     handler — o mesmo motivo pelo qual o envio da proposta confere a pendência
     por ref. */
  const atual = useRef<FonteDeAlteracao>(fonte);
  atual.current = fonte;

  useEffect(() => {
    contexto.registrar(id, { isDirty, substantivo, ...(genero ? { genero } : {}) });
  }, [contexto, id, isDirty, substantivo, genero]);

  // Desmontar é deixar de pesar na guarda: a tela saiu, a pendência foi com ela.
  useEffect(() => () => contexto.desregistrar(id), [contexto, id]);

  const confirmarDescarte = useCallback(
    (acao: () => void) => {
      if (!atual.current.isDirty) {
        acao();
        return;
      }
      contexto.pedirDescarte(atual.current, acao);
    },
    [contexto],
  );

  const liberarGuarda = useCallback(
    (acao: () => void) => contexto.liberarGuarda(acao),
    [contexto],
  );

  return { confirmarDescarte, liberarGuarda };
}
