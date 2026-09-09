import type { HelpConceptId } from "./concepts";
import { baseHints, baseTopics } from "./content/base";
import { cadastrosHints, cadastrosTopics } from "./content/cadastros";
import { comercialHints, comercialTopics } from "./content/comercial";
import { gestaoTopics } from "./content/gestao";
import { producaoHints, producaoTopics } from "./content/producao";
import { suprimentosHints, suprimentosTopics } from "./content/suprimentos";
import { topicosV2 } from "./content/v2";

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

/* ------------------------------------------------------------------ *
 * Modelo V2 — a ajuda em três níveis
 * ------------------------------------------------------------------ */

/**
 * Classe de tamanho de um tópico. É o teto de palavras, testado.
 *
 * `S` lista de consulta ou tela de uma ação · `M` tela com duas a quatro
 * ações e uma regra de negócio · `L` tela de fluxo, com situações, atos
 * irreversíveis e pré-requisitos.
 */
export type HelpSize = "S" | "M" | "L";

/** Um destino: o rótulo que a pessoa lê e, quando existe rota, para onde vai. */
export interface HelpLink {
  label: string;
  /**
   * Rota interna (`/comercial/pedidos`) ou endereço externo. Opcional: há
   * próximo passo que acontece num diálogo da própria tela e não tem rota.
   * Toda `href` interna é conferida contra as rotas reais por teste.
   */
  href?: string;
}

/**
 * Um passo, escrito como as duas metades que ele realmente tem.
 *
 * A auditoria mostrou que a ajuda antiga misturava as duas: "a ordem reserva
 * os lotes" não diz que alguém precisa clicar em "Liberar OP". Separar quem
 * age de quem responde é o que faz o passo virar instrução.
 */
export interface HelpV2Step {
  /** O que a pessoa faz, no imperativo, citando o botão pelo rótulo exato. */
  you: string;
  /** O que o sistema faz em resposta, em terceira pessoa. */
  system?: string;
}

/** Um pré-requisito e, quando existe, a tela onde ele se resolve. */
export interface HelpPrerequisite {
  text: string;
  href?: string;
}

/** Onde a tela entra no processo — vira as caixas do `FlowSteps`. */
export interface HelpProcess {
  before: string[];
  /** O nome desta tela, em caixa alta, como ela aparece destacada no fluxo. */
  here: string;
  after: string[];
}

/** Uma situação do documento e o que ela permite fazer. */
export interface HelpState {
  name: string;
  allows: string;
}

/**
 * Um item de "Saiba mais": um conceito compartilhado ou uma tela vizinha.
 *
 * O conceito é citado por identificador, não copiado — é essa indireção que
 * impede a mesma ideia de existir em oito redações diferentes.
 */
export interface HelpLearnMore {
  concept?: HelpConceptId;
  /** Obrigatório quando o item é uma tela; ignorado quando há `concept`. */
  label?: string;
  href?: string;
}

/**
 * Um tópico no modelo V2 — três níveis, com teto de palavras por classe.
 *
 * O modelo é ADITIVO: `HelpTopic` (V1) continua válido e continua renderizando.
 * Os dois convivem no mesmo registro e o painel reconhece qual está lendo pelo
 * campo `version`. A migração acontece tópico a tópico, e não numa varredura
 * que ninguém consegue revisar.
 *
 * A ordem dos campos é a ordem de leitura, e ela é a decisão central desta
 * rodada: nível 1 (o que é, quando usar, o que fazer depois) vem primeiro,
 * porque a pergunta de quem abre a ajuda é "o que eu faço aqui?". O glossário
 * — que o §45 mandava vir antes — desceu para o nível 3, onde ele é
 * consultado em vez de lido.
 */
export interface HelpTopicV2 {
  /** Discriminante. É por ele que o painel sabe qual modelo está lendo. */
  version: 2;
  module: HelpModule;
  size: HelpSize;
  /** Título do painel — nomeia a tela ou a regra, não o componente. */
  title: string;

  /* Nível 1 — sempre visível, no máximo 80 palavras somadas. */
  /** O que a tela é e para que serve, em uma ou duas frases. */
  oneLiner: string;
  /** Duas ou três situações concretas de uso. */
  whenToUse: string[];
  /** A ação mais provável depois desta tela. */
  nextSteps: HelpLink[];

  /* Nível 2 — aberto por padrão. */
  prerequisites?: HelpPrerequisite[];
  steps: HelpV2Step[];
  /** O que acontece sem ninguém pedir. Cada linha começa por "O sistema". */
  automations?: string[];
  process?: HelpProcess;

  /* Nível 3 — recolhido. */
  /**
   * O vocabulário da tela. Aceita a chave de uma dica ⓘ já escrita: o termo
   * que o ⓘ explica em cima do campo é o mesmo que o painel lista, e escrever
   * duas vezes é como as versões divergem.
   */
  terms?: (HelpHintId | HelpConcept)[];
  states?: HelpState[];
  /** No máximo cinco. Irreversível começa por "Não tem volta:". */
  cautions?: string[];
  /** Um exemplo com número real. */
  example?: string;
  learnMore?: HelpLearnMore[];
  /** Data da última revisão do texto, `AAAA-MM-DD`. */
  revisedAt: string;
}

/** Um tópico em qualquer um dos dois modelos — é o que o painel recebe. */
export type AnyHelpTopic = HelpTopic | HelpTopicV2;

/** Diz qual modelo está na mão. O painel e os testes decidem por aqui. */
export function isHelpTopicV2(topic: AnyHelpTopic): topic is HelpTopicV2 {
  return (topic as HelpTopicV2).version === 2;
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
  ...gestaoTopics,
  /*
   * Os tópicos já escritos no modelo V2. Um tópico migrado mantém a MESMA
   * chave e sai do arquivo do módulo: existe um lugar só por tópico, e a
   * tela que o abre não muda de linha.
   */
  ...topicosV2,
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
