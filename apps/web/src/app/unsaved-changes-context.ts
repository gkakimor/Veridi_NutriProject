import { createContext, useContext } from "react";

/**
 * Uma origem de alteração não salva.
 *
 * É sempre um BOOLEANO com um nome — nunca o formulário inteiro. Quem sabe
 * dizer se há alteração pendente é a tela, cada uma do seu jeito (comparação
 * com baseline, assinatura serializada, lista de condições alteradas); a
 * foundation só precisa saber que existe e como chamá-la na pergunta.
 */
export interface FonteDeAlteracao {
  isDirty: boolean;
  /** O que a pessoa perde: "projeto", "orçamento", "formulação". */
  substantivo: string;
  /**
   * Gênero do substantivo — decide entre "neste projeto" e "nesta
   * formulação". Padrão masculino, que é o caso mais comum no ERP.
   */
  genero?: "o" | "a";
}

export interface UnsavedChangesContextValue {
  /** Passa a valer a partir daqui. Chamar de novo com o mesmo `id` atualiza. */
  registrar: (id: string, fonte: FonteDeAlteracao) => void;
  desregistrar: (id: string) => void;
  /**
   * Descarte LOCAL — Cancelar, ✕ e Esc de um modal, que o router não vê.
   * Abre o MESMO diálogo da navegação.
   */
  pedirDescarte: (fonte: FonteDeAlteracao, acao: () => void) => void;
  /**
   * Executa a ação com a guarda suspensa por este ciclo.
   *
   * Serve ao instante depois de salvar: quem acabou de gravar navega na mesma
   * função em que o estado ainda não re-renderizou, e o `isDirty` que o
   * bloqueio leria ainda é o de antes do salvamento.
   */
  liberarGuarda: (acao: () => void) => void;
}

/**
 * Sem provider a foundation não existe e o comportamento é o de antes:
 * navegar e fechar seguem direto.
 *
 * Acontece em teste de unidade que monta uma tela isolada. No app o provider
 * é a raiz da árvore de rotas e está sempre lá.
 */
const SEM_PROVIDER: UnsavedChangesContextValue = {
  registrar: () => undefined,
  desregistrar: () => undefined,
  pedirDescarte: (_fonte, acao) => acao(),
  liberarGuarda: (acao) => acao(),
};

export const UnsavedChangesContext = createContext<UnsavedChangesContextValue>(SEM_PROVIDER);

export function useUnsavedChangesContext(): UnsavedChangesContextValue {
  return useContext(UnsavedChangesContext);
}
