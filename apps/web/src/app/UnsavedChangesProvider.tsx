import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog";
import { UnsavedChangesContext } from "./unsaved-changes-context";
import type { FonteDeAlteracao, UnsavedChangesContextValue } from "./unsaved-changes-context";

/** Descarte pedido por um modal — Cancelar, ✕ ou Esc — esperando resposta. */
interface PedidoDeDescarte {
  fonte: FonteDeAlteracao;
  acao: () => void;
}

function mesmaFonte(a: FonteDeAlteracao | null, b: FonteDeAlteracao | null): boolean {
  if (a === null || b === null) return a === b;
  return a.substantivo === b.substantivo && a.genero === b.genero;
}

/**
 * A guarda de alterações não salvas do ERP — uma única no app inteiro.
 *
 * Existe porque sair de uma tela com trabalho não salvo apagava o trabalho sem
 * dizer nada: clicar no menu com um cadastro meio preenchido descartava tudo,
 * e o modal de Projeto nem chegava a ser fechado — a tela de trás trocava
 * embaixo dele. Cada formulário resolver isso por conta própria daria 48
 * implementações e 48 comportamentos.
 *
 * Precisa de um router de dados (`createBrowserRouter`): `useBlocker` é o que
 * segura a navegação DEPOIS que o usuário já clicou, com o destino original em
 * mãos, e ele não existe no router declarativo. É o motivo da migração.
 *
 * O bloqueio vale para troca de TELA. Mudança só de query string na mesma rota
 * — abrir e fechar um modal que mora na URL, paginar, filtrar — não é saída, e
 * perguntar ali transformaria a guarda em ruído.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  /*
   * Ordem de registro importa: com duas fontes sujas, a pergunta fala da
   * primeira — e o `Map` preserva a posição de quem já está registrado quando
   * o valor é atualizado.
   */
  const fontes = useRef(new Map<string, FonteDeAlteracao>());
  const [sujo, setSujo] = useState<FonteDeAlteracao | null>(null);
  const sujoRef = useRef<FonteDeAlteracao | null>(null);
  const [pedido, setPedido] = useState<PedidoDeDescarte | null>(null);

  /**
   * Guarda suspensa por este ciclo.
   *
   * Ref, e não estado: quem salva e navega faz as duas coisas na mesma função,
   * antes de qualquer re-renderização, e o bloqueio é consultado no meio disso.
   */
  const ignorar = useRef(false);

  const recalcular = useCallback(() => {
    let primeira: FonteDeAlteracao | null = null;
    for (const fonte of fontes.current.values()) {
      if (fonte.isDirty) {
        primeira = fonte;
        break;
      }
    }
    sujoRef.current = primeira;
    setSujo((anterior) => (mesmaFonte(anterior, primeira) ? anterior : primeira));
  }, []);

  const registrar = useCallback(
    (id: string, fonte: FonteDeAlteracao) => {
      fontes.current.set(id, fonte);
      recalcular();
    },
    [recalcular],
  );

  const desregistrar = useCallback(
    (id: string) => {
      fontes.current.delete(id);
      recalcular();
    },
    [recalcular],
  );

  const liberarGuarda = useCallback((acao: () => void) => {
    ignorar.current = true;
    try {
      acao();
    } finally {
      // Volta a valer assim que a navegação desta ação terminou.
      setTimeout(() => {
        ignorar.current = false;
      }, 0);
    }
  }, []);

  /*
   * Um pedido de cada vez. Com a pergunta aberta, o Escape chega ao modal de
   * baixo antes de chegar a ela — os dois ouvem o `document` — e um segundo
   * pedido ali substituiria o primeiro por um idêntico, deixando o resultado
   * na mão da ordem de registro dos listeners.
   */
  const pedirDescarte = useCallback((fonte: FonteDeAlteracao, acao: () => void) => {
    setPedido((atual) => atual ?? { fonte, acao });
  }, []);

  const deveBloquear = useCallback(
    ({
      currentLocation,
      nextLocation,
    }: {
      currentLocation: { pathname: string };
      nextLocation: { pathname: string };
    }) =>
      !ignorar.current &&
      sujoRef.current !== null &&
      currentLocation.pathname !== nextLocation.pathname,
    [],
  );

  const blocker = useBlocker(deveBloquear);
  const bloqueado = blocker.state === "blocked";

  /**
   * F5, fechar aba e fechar janela não passam pelo router.
   *
   * O diálogo é o do navegador — desde 2016 nenhum deles mostra texto do site,
   * e tentar customizar só rende uma string que ninguém vê.
   */
  useEffect(() => {
    if (sujo === null) return;
    function avisar(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  const valor = useMemo<UnsavedChangesContextValue>(
    () => ({ registrar, desregistrar, pedirDescarte, liberarGuarda }),
    [registrar, desregistrar, pedirDescarte, liberarGuarda],
  );

  /*
   * Uma pergunta de cada vez. Enquanto um descarte local está aberto o fundo
   * fica inerte, então não há como disparar uma navegação por baixo dele —
   * mas a ordem aqui é explícita para que empilhar continue impossível no dia
   * em que alguém mexer no fundo.
   */
  const fonteDaPergunta = bloqueado ? sujo : (pedido?.fonte ?? null);

  function continuarEditando() {
    if (bloqueado) {
      blocker.reset?.();
      return;
    }
    setPedido(null);
  }

  function sairSemSalvar() {
    if (bloqueado) {
      blocker.proceed?.();
      return;
    }
    if (!pedido) return;
    const { acao } = pedido;
    setPedido(null);
    liberarGuarda(acao);
  }

  return (
    <UnsavedChangesContext.Provider value={valor}>
      {children}
      <UnsavedChangesDialog
        open={bloqueado || pedido !== null}
        fonte={fonteDaPergunta}
        onContinuarEditando={continuarEditando}
        onSairSemSalvar={sairSemSalvar}
      />
    </UnsavedChangesContext.Provider>
  );
}
