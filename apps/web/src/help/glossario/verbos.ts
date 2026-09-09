/**
 * Os verbos que congelam alguma coisa — e o que cada um congela.
 *
 * O ERP tem oito atos irreversíveis com nomes parecidos: confirmar, ativar,
 * enviar, emitir, liberar, aplicar, aceitar, concluir. Quem está aprendendo
 * a operação não distingue "confirmar o pedido" de "confirmar a expedição",
 * e a ajuda antiga explicava o efeito de cada um dentro do tópico da tela —
 * oito explicações diferentes para a mesma pergunta.
 *
 * Este é o índice único: o que o verbo faz, e o que ele NÃO faz. A ajuda de
 * cada tela cita o botão pelo rótulo exato e diz a consequência; aqui fica a
 * consequência escrita uma vez, para o guia editorial e para quem escreve o
 * próximo tópico.
 */

export interface VerboDeAto {
  /** O verbo, como aparece no botão. */
  verbo: string;
  /** O que ele congela ou cria. Uma frase. */
  efeito: string;
  /** O que as pessoas acham que ele faz e ele não faz. */
  naoFaz: string;
}

export const VERBOS_DE_ATO: VerboDeAto[] = [
  {
    verbo: "Confirmar pedido",
    efeito: "Congela cliente, produtos, quantidades e o preço acordado de cada linha.",
    naoFaz: "Não reserva estoque nem cria ordem de produção — isso é o Plano de Atendimento.",
  },
  {
    verbo: "Aplicar Plano de Atendimento",
    efeito: "Cria a reserva de produto acabado e as ordens de produção em rascunho, tudo de uma vez.",
    naoFaz: "Não produz nada e não compra nada; as ordens nascem em rascunho.",
  },
  {
    verbo: "Ativar versão",
    efeito: "Fecha a versão da formulação, da estrutura de custos ou da precificação e desativa a anterior.",
    naoFaz: "Não altera documento já emitido: cada um continua na versão que executou.",
  },
  {
    verbo: "Enviar ao cliente",
    efeito: "Congela a versão do orçamento, com preços, condições e o custo de referência do dia.",
    naoFaz: "Não manda e-mail: registra que a proposta foi apresentada.",
  },
  {
    verbo: "Liberar OP",
    efeito: "Confere a cobertura de material e reserva os lotes escolhidos para a ordem.",
    naoFaz: "Não tira material do estoque — a baixa é o consumo.",
  },
  {
    verbo: "Liberar",
    efeito: "A Qualidade aprova o lote e ele passa a contar como disponível.",
    naoFaz: "Não gera movimento de estoque e não aprova o laudo do fornecedor.",
  },
  {
    verbo: "Confirmar expedição",
    efeito: "Baixa o físico e a reserva dos lotes enviados e atualiza a situação do pedido.",
    naoFaz: "Não fatura: o faturamento é preparado depois, a partir da expedição.",
  },
  {
    verbo: "Emitir faturamento",
    efeito: "Congela quantidades, preços e total do documento comercial.",
    naoFaz: "Não emite Nota Fiscal, não movimenta estoque e não gera título a receber.",
  },
  {
    verbo: "Concluir OP",
    efeito: "Fecha a ordem, exige as justificativas e libera a sobra reservada.",
    naoFaz: "Não reserva o produto acabado ao pedido — isso é feito no Pedido.",
  },
];
