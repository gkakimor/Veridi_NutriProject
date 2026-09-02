/**
 * Conteúdo da ajuda contextual — um lugar só.
 *
 * O texto de ajuda é revisado por quem conhece a regra de negócio, não por
 * quem mexe no JSX. Espalhado pelas telas, cada revisão vira caçada e duas
 * páginas acabam explicando a mesma regra de jeitos diferentes — que é
 * exatamente o problema que a ajuda deveria resolver.
 *
 * Este módulo é a INFRAESTRUTURA da rodada: os tipos e o registro existem
 * completos, o conteúdo entra por módulo, aos poucos. Só os exemplos
 * demonstrativos estão preenchidos.
 */

/**
 * Módulos que vão receber ajuda contextual.
 *
 * A lista vem antes do conteúdo de propósito: assim todo tópico nasce com
 * dono declarado, e é possível saber o que ainda falta sem varrer as telas.
 */
export const HELP_MODULES = [
  "formulacao",
  "planoAtendimento",
  "ordemProducao",
  "cmv",
  "faturamento",
] as const;

export type HelpModule = (typeof HELP_MODULES)[number];

/** Ênfase de uma etapa — o desvio (falta, bloqueio) não lê igual ao caminho feliz. */
export type HelpStepTone = "neutral" | "accent" | "warn";

export interface HelpStep {
  /** Rótulo curto — é o que a pessoa lê primeiro. */
  label: string;
  /** Uma linha de detalhe. Opcional: no fluxo, muitas etapas se explicam sozinhas. */
  detail?: string;
  /** Padrão: `"neutral"`. */
  tone?: HelpStepTone;
}

export interface HelpDocLink {
  label: string;
  href: string;
}

export interface HelpTopic {
  module: HelpModule;
  /** Título do painel — nomeia a regra, não a tela. */
  title: string;
  /** Uma ou duas frases: o que é e por que existe. */
  summary: string;
  /** Etapas na ordem em que acontecem. */
  steps: HelpStep[];
  /** Ressalvas e casos de borda — o que costuma gerar chamado. */
  notes?: string[];
  /**
   * Fluxo curto desenhado acima das etapas (ex.: Pedido → Estoque → Falta).
   * Resumo visual, não substitui `steps`.
   */
  flow?: HelpStep[];
  /**
   * Link para documentação. Opcional — só entra quando existe destino real e
   * estável; link quebrado dentro da ajuda custa mais confiança do que a
   * ausência do link. Ex.: `{ label: "Manual do Plano", href: "/ajuda/plano" }`.
   */
  doc?: HelpDocLink;
}

/**
 * Painéis "Como funciona", indexados por `<módulo>.<assunto>`.
 *
 * `satisfies` em vez de anotação: cada entrada é validada contra `HelpTopic`
 * e `HelpTopicId` continua sendo a união das chaves REAIS — errar o nome do
 * tópico na tela vira erro de compilação, não painel vazio em produção.
 */
export const helpTopics = {
  "planoAtendimento.comoFunciona": {
    module: "planoAtendimento",
    title: "Como o Plano de Atendimento decide o que fazer",
    summary:
      "O Plano é projeção, não decisão: ele lê o pedido confirmado, compara com o estoque disponível e propõe reservar o que existe e produzir o que falta. Nada muda no estoque enquanto você não aplicar.",
    flow: [
      { label: "Pedido" },
      { label: "Estoque" },
      { label: "Falta", tone: "warn" },
      { label: "Produção/Compra", tone: "accent" },
    ],
    steps: [
      {
        label: "Pedido confirmado",
        detail: "O Plano só existe depois da confirmação: cliente, produtos e quantidades ficam congelados.",
      },
      {
        label: "Leitura do estoque",
        detail:
          "Vale o saldo livre. Lote bloqueado, aguardando liberação, vencido ou zerado fica de fora.",
      },
      {
        label: "Proposta padrão",
        detail: "Estoque primeiro: reserva o que existe e joga o restante para produção.",
      },
      {
        label: "Ajuste manual",
        detail: "Você move quantidade entre reservar e produzir, desde que a soma feche a quantidade pedida.",
      },
      {
        label: "Aplicar",
        detail:
          "A disponibilidade é revalidada na hora. Reserva e ordens de produção entram juntas ou não entra nada.",
      },
    ],
    notes: [
      "Abrir o Plano não reserva nada — a reserva acontece só ao aplicar.",
      "Cada linha em falta gera no máximo uma ordem de produção em rascunho, que segue o ciclo normal de planejar e liberar.",
      "Material em compra não conta como disponível: ele entra no estoque no recebimento.",
    ],
  },
} satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof helpTopics;

export interface HelpHint {
  module: HelpModule;
  /** O conceito explicado — vira o nome acessível do ícone. */
  label: string;
  /** Explicação curta. Uma ou duas frases; o que não couber aqui é `HelpTopic`. */
  text: string;
}

/**
 * Textos do ⓘ ao lado de um rótulo, indexados por `<módulo>.<conceito>`.
 *
 * Separados dos tópicos porque respondem a outra pergunta: "o que essa
 * palavra quer dizer", não "como esse processo funciona".
 */
export const helpHints = {
  "planoAtendimento.disponivel": {
    module: "planoAtendimento",
    label: "Disponível",
    text: "Saldo livre para uso: o que está em estoque menos o que já está reservado. Lote bloqueado, aguardando liberação ou vencido não entra na conta.",
  },
  "planoAtendimento.emCompra": {
    module: "planoAtendimento",
    label: "Em compra",
    text: "Quantidade já pedida ao fornecedor e ainda não recebida. É informativo: não conta como disponível para reservar nem para liberar produção.",
  },
} satisfies Record<string, HelpHint>;

export type HelpHintId = keyof typeof helpHints;
