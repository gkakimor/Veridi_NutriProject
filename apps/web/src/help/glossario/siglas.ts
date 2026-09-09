/**
 * Siglas e estrangeirismos — o que pode aparecer na ajuda, e escrito como.
 *
 * A auditoria encontrou "Picking", "CoA", "template", "stand-by" e "status"
 * soltos no texto que o usuário final lê. Cada um deles tem uma palavra em
 * português que a operação já usa; o inglês sobrevive só onde ele está
 * impresso no rótulo de um botão ou num documento controlado.
 *
 * A regra que este arquivo sustenta é uma só: o termo em inglês nunca vem
 * sozinho. Ou a ajuda escreve em português, ou escreve a forma glosada —
 * "Laudo (CoA)", "overage (excesso planejado)". O teste editorial lê estas
 * listas; mudar a política é mudar aqui, não caçar frase por frase.
 */

/** Um termo de negócio em inglês e como ele pode (ou não pode) ser escrito. */
export interface TermoEstrangeiro {
  /** Como o termo aparece no texto. Comparado sem diferenciar maiúsculas. */
  termo: string;
  /** A palavra em português que deve ser usada no lugar. */
  portugues: string;
  /**
   * Formas em que o termo É aceito, porque trazem a glosa junto. Vazio
   * significa que o termo não entra em texto principal de jeito nenhum.
   */
  glosas: string[];
}

/**
 * Termos de negócio proibidos em texto principal de ajuda.
 *
 * Só entram palavras que a operação lê. Nome de arquivo, identificador de
 * tópico e chave de rota continuam em inglês onde já estão — o teste olha o
 * texto, não o código.
 */
export const TERMOS_ESTRANGEIROS: TermoEstrangeiro[] = [
  { termo: "picking", portugues: "separação", glosas: ["separação (picking)"] },
  { termo: "template", portugues: "modelo", glosas: [] },
  { termo: "stand-by", portugues: "em espera", glosas: [] },
  { termo: "standby", portugues: "em espera", glosas: [] },
  { termo: "coa", portugues: "laudo", glosas: ["laudo (coa)", "laudos (coa)"] },
  { termo: "draft", portugues: "rascunho", glosas: [] },
  { termo: "dashboard", portugues: "painel", glosas: [] },
  { termo: "shipment", portugues: "expedição", glosas: [] },
  { termo: "billing", portugues: "faturamento", glosas: [] },
  { termo: "pricing", portugues: "precificação", glosas: [] },
  { termo: "fulfillment", portugues: "atendimento", glosas: [] },
  { termo: "overage", portugues: "excesso planejado", glosas: ["overage (excesso planejado)"] },
  { termo: "markup", portugues: "quanto o preço está acima do custo", glosas: ["markup (quanto o preço está acima do custo)"] },
  { termo: "fefo", portugues: "vence antes, sai antes", glosas: ["fefo (vence antes, sai antes)"] },
  { termo: "fifo", portugues: "entra antes, sai antes", glosas: ["fifo (entra antes, sai antes)"] },
  { termo: "kardex", portugues: "histórico de movimentações", glosas: [] },
];

/**
 * Siglas da casa que podem circular sozinhas.
 *
 * São siglas que a operação fala em voz alta todo dia e que estão impressas
 * em documento controlado. Explicá-las a cada citação atrapalharia a leitura
 * de quem trabalha aqui — o lugar delas é o glossário, não a frase.
 */
export const SIGLAS_DA_CASA: Record<string, string> = {
  OC: "Ordem de Compra",
  OP: "Ordem de Produção",
  PA: "Produto Acabado",
  MP: "Matéria-prima",
  ME: "Material de Embalagem",
  CMV: "Custo da Mercadoria Vendida",
  NF: "Nota Fiscal",
  QR: "código de barras em duas dimensões, o quadrado que a câmera lê",
};
