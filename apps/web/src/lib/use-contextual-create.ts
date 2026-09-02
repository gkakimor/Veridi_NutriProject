import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  PARAM_ORIGEM,
  PARAM_RETOMAR,
  createRouteWithContext,
  discardContextualCreate,
  findPendingForRoute,
  finishContextualCreate,
  originRouteWithReturn,
  readContextualCreate,
  startContextualCreate,
  takeContextualCreate,
} from "./contextual-create";
import type { ContextualCreateRecord, ContextualCreateResult } from "./contextual-create";

/**
 * Os dois lados da criação contextual, um hook para cada.
 *
 * `useContextualCreateOrigin` é de quem TEM o campo e sai para criar.
 * `useContextualCreateTarget` é da tela oficial de criação, que precisa saber
 * se foi aberta a partir de um campo e para onde voltar.
 *
 * Nenhum dos dois inventa rota: a tela de origem diz de onde saiu, a de
 * criação lê o registro. É o que faz o fluxo sobreviver a refresh e a link
 * direto, que é justamente onde `navigate(-1)` quebra.
 */

/** Para onde a origem manda quem clicou em "+ Novo X". */
export interface ContextualCreateTarget {
  /** Rota canônica de criação. */
  route: string;
  /** Campo que recebe a entidade nova. */
  fieldKey: string;
  entityType: string;
  /** O que mais a origem precisa lembrar: a linha da tabela, o tipo exigido. */
  context?: Record<string, unknown>;
}

/** Lado de quem tem o campo. */
export function useContextualCreateOrigin<Rascunho extends Record<string, unknown>>(options: {
  /**
   * Devolve o estado do formulário a preservar. Chamado no instante da saída
   * — não guarde referência a função, elemento ou nada não serializável, e
   * nunca inclua credencial.
   */
  collectDraft: () => Rascunho;
  /** Recebe o rascunho de volta. */
  restoreDraft: (draft: Rascunho, record: ContextualCreateRecord) => void;
  /**
   * A entidade nova. Só é chamado quando o tipo bate com o que o campo
   * pediu — voltar com um fornecedor para um campo de cliente é bug de
   * navegação, e selecionar em silêncio esconderia o bug.
   */
  onCreated: (result: ContextualCreateResult, record: ContextualCreateRecord) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /*
   * As callbacks entram por ref para o efeito de retomada não depender da
   * identidade delas: um `restoreDraft` recriado a cada render faria o
   * rascunho ser restaurado em loop, apagando o que a pessoa digitasse.
   */
  const callbacks = useRef(options);
  callbacks.current = options;

  /** A retomada vale uma vez; sem isto, um re-render repetiria a seleção. */
  const jaRetomou = useRef(false);
  /** Enquanto sai para criar, não é hora de retomar nada. */
  const saindo = useRef(false);

  const tokenNaUrl = searchParams.get(PARAM_RETOMAR);

  useEffect(() => {
    if (jaRetomou.current || saindo.current) return;

    /*
     * Dois caminhos chegam aqui. O normal é o `?retomar=` que a tela de
     * criação põe na URL ao salvar ou cancelar. O outro é o botão VOLTAR do
     * navegador, que devolve à origem sem parâmetro nenhum — aí o contexto
     * pendente é encontrado pela própria rota.
     */
    const token = tokenNaUrl ?? findPendingForRoute(location.pathname);
    if (!token) return;

    jaRetomou.current = true;
    const retomada = takeContextualCreate(token);

    if (tokenNaUrl) {
      // Some com o `?retomar=` de qualquer jeito — inclusive quando o
      // registro não existe mais. Deixá-lo ali faria um F5 tentar retomar um
      // contexto já consumido, e um link compartilhado carregaria um token
      // morto.
      const limpa = new URLSearchParams(location.search);
      limpa.delete(PARAM_RETOMAR);
      const busca = limpa.toString();
      navigate(`${location.pathname}${busca ? `?${busca}` : ""}`, { replace: true });
    }

    if (!retomada) return;
    const { record, commit } = retomada;

    callbacks.current.restoreDraft(record.draft as Rascunho, record);

    // Sem resultado = cancelamento ou volta pelo navegador. O rascunho volta,
    // a seleção não muda.
    if (record.result && record.result.entityType === record.entityType) {
      callbacks.current.onCreated(record.result, record);
    }

    // Só agora. Apagar antes de restaurar perderia o rascunho se a
    // restauração falhasse no meio do caminho.
    commit();
  }, [tokenNaUrl, location.pathname, location.search, navigate]);

  /** Sai para a tela oficial de criação, guardando o rascunho. */
  const goCreate = useCallback(
    (destino: ContextualCreateTarget) => {
      saindo.current = true;
      const token = startContextualCreate({
        originRoute: `${location.pathname}${location.search}`,
        fieldKey: destino.fieldKey,
        entityType: destino.entityType,
        draft: callbacks.current.collectDraft(),
        ...(destino.context ? { context: destino.context } : {}),
      });
      // Sem armazenamento não há contexto para guardar, mas a pessoa ainda
      // quer cadastrar: vai para a tela oficial sem o retorno automático.
      navigate(token ? createRouteWithContext(destino.route, token) : destino.route);
    },
    [location.pathname, location.search, navigate],
  );

  return { goCreate };
}

/** Lado da tela oficial de criação. */
export function useContextualCreateTarget(entityType: string) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get(PARAM_ORIGEM);
  /*
   * Lido uma vez e guardado. A leitura seguinte devolveria `null` depois que
   * a origem consumir o contexto, e a tela perderia o botão de voltar no
   * meio da navegação.
   */
  const [record] = useState<ContextualCreateRecord | null>(() => readContextualCreate(token));

  /*
   * Contexto de outro tipo de entidade é ignorado. Acontece quando alguém
   * edita a URL à mão ou reusa um link antigo: melhor a tela se comportar
   * como criação normal do que voltar para um campo que não pediu.
   */
  const ativo = Boolean(record && record.entityType === entityType);

  /** Salvou: registra o resultado e volta para a origem. */
  const completeAndReturn = useCallback(
    (result: Omit<ContextualCreateResult, "entityType">) => {
      if (!record || !ativo) return false;
      finishContextualCreate(record.token, { ...result, entityType });
      navigate(originRouteWithReturn(record));
      return true;
    },
    [record, ativo, entityType, navigate],
  );

  /** Cancelou: volta para a origem sem resultado. O rascunho ainda é restaurado. */
  const cancelAndReturn = useCallback(() => {
    if (!record || !ativo) return false;
    // O registro segue no armazenamento até a origem consumi-lo: é ele que
    // carrega o rascunho. Sem `result`, a origem entende como cancelamento.
    navigate(originRouteWithReturn(record));
    return true;
  }, [record, ativo, navigate]);

  /** Abandono explícito, sem voltar — some com o rascunho para não vazar. */
  const abandon = useCallback(() => {
    discardContextualCreate(record?.token);
  }, [record]);

  return {
    /** `true` quando a tela foi aberta a partir de um campo. */
    isContextual: ativo,
    /** Contexto extra que a origem mandou (linha da tabela, tipo exigido). */
    context: ativo ? (record?.context ?? null) : null,
    /** Rótulo da ação de voltar: "Voltar para Produto". */
    originLabel: ativo ? rotuloDaOrigem(record!.originRoute) : null,
    completeAndReturn,
    cancelAndReturn,
    abandon,
  };
}

/**
 * Nome legível da tela de origem, tirado da rota.
 *
 * "Voltar" sozinho não diz para onde se volta, e num fluxo em que a pessoa
 * saiu do meio de um documento é exatamente isso que ela precisa saber antes
 * de clicar.
 */
function rotuloDaOrigem(rota: string): string {
  const caminho = rota.split("?")[0] ?? "";
  const conhecidas: [RegExp, string][] = [
    [/^\/comercial\/pedidos/, "Pedido"],
    [/^\/comercial\/projetos/, "Projeto"],
    [/^\/comercial\/amostras/, "Amostra"],
    [/^\/comercial\/expedicoes/, "Expedição"],
    [/^\/comercial\/faturamento/, "Faturamento"],
    [/^\/compras\/ordens/, "Ordem de compra"],
    [/^\/compras\/recebimentos/, "Recebimento"],
    [/^\/compras\/item-fornecedor/, "Item × Fornecedor"],
    [/^\/producao\/ordens/, "Ordem de produção"],
    [/^\/producao\/formulacoes/, "Formulação"],
    [/^\/producao\/templates-formulacao/, "Template de formulação"],
    // A estrutura de custos mora sob o produto, não sob produção.
    [/^\/produtos\/[^/]+\/custos/, "Estrutura de custos"],
    [/^\/gestao\/recursos-industriais/, "Recurso industrial"],
    [/^\/cadastros\/produtos/, "Produto"],
    [/^\/cadastros\/itens/, "Item de estoque"],
    [/^\/cadastros\/clientes/, "Cliente"],
    [/^\/cadastros\/fornecedores/, "Fornecedor"],
    [/^\/estoque/, "Estoque"],
  ];
  for (const [padrao, rotulo] of conhecidas) {
    if (padrao.test(caminho)) return rotulo;
  }
  return "tela anterior";
}
