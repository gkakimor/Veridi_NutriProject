import { baseHints, baseTopics } from "./content/base";
import { cadastrosHints, cadastrosTopics } from "./content/cadastros";
import { comercialHints, comercialTopics } from "./content/comercial";
import { producaoHints, producaoTopics } from "./content/producao";
import { suprimentosHints, suprimentosTopics } from "./content/suprimentos";

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
  "cadastros",
  "comercial",
  "producao",
  "compras",
  "estoque",
  "qualidade",
  "gestao",
  "administracao",
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

export interface HelpFlow {
  /** Nome do caminho — "Fluxo A · Produção sob pedido". */
  name: string;
  /** Em que situação este caminho vale. */
  when?: string;
  steps: HelpStep[];
}

/** Um termo da tela e o que ele significa ali — não no dicionário. */
export interface HelpConcept {
  term: string;
  text: string;
}

export interface HelpTopic {
  module: HelpModule;
  /** Título do painel — nomeia a regra, não a tela. */
  title: string;
  /** Uma ou duas frases: o que é e por que existe. */
  summary: string;
  /**
   * O vocabulário próprio da tela — os termos que aparecem em campo, coluna
   * e situação e que ninguém adivinha pelo nome.
   *
   * Vem ANTES do fluxo de propósito: saber o caminho não adianta para quem
   * ainda não sabe o que a tela é. O `InfoHint` explica o termo onde ele
   * aparece; aqui ele é apresentado junto com os outros, que é como a
   * pessoa aprende a tela pela primeira vez.
   */
  concepts?: HelpConcept[];
  /**
   * Etapas soltas, para tela de fluxo único e simples. Havendo `flows`, a
   * explicação de cada etapa vive dentro do fluxo a que pertence.
   */
  steps?: HelpStep[];
  /** Ressalvas e casos de borda — o que costuma gerar chamado. */
  notes?: string[];
  /**
   * Caminhos pelos quais a tela é usada.
   *
   * Mais de um quando a tela serve a situações diferentes — produção sob
   * pedido e produção para estoque, por exemplo. Cada um tem nome e diz
   * quando vale, porque "qual desses é o meu caso?" é a pergunta que vem
   * antes de qualquer etapa.
   */
  flows?: HelpFlow[];
  /**
   * Fluxo único e sem nome. Forma curta para tela que só tem um caminho —
   * equivale a um `flows` de um item.
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
/**
 * Registro único da ajuda, montado a partir de um arquivo por módulo.
 *
 * A divisão existe por causa de quem escreve: o texto de cada módulo é
 * revisado por quem conhece aquela operação, e um arquivo só transformaria
 * cada revisão numa disputa pelo mesmo trecho.
 */
export const helpTopics = {
  ...baseTopics,
  ...comercialTopics,
  ...producaoTopics,
  ...suprimentosTopics,
  ...cadastrosTopics,
};

export type HelpTopicId = keyof typeof helpTopics;

export interface HelpHint {
  module: HelpModule;
  /** O conceito, como aparece na tela. Vira o nome acessível do ícone. */
  label: string;
  /** Uma ou duas frases. Explicação longa é assunto de `ContextHelp`. */
  text: string;
}

export const helpHints = {
  ...baseHints,
  ...comercialHints,
  ...producaoHints,
  ...suprimentosHints,
  ...cadastrosHints,
};

export type HelpHintId = keyof typeof helpHints;
