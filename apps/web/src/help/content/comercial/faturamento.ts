import type { HelpTopicV2 } from "../../help-content";

/**
 * Faturamento — o documento comercial de uma expedição.
 *
 * O texto antigo era um dos melhores do sistema e envelheceu num ponto: ele
 * dizia que o desconto acordado no pedido NÃO chegava aqui. Depois de
 * BILL-DISCOUNT-01 e 01b ele chega, e o rodapé mostra a conta em quatro
 * partes — subtotal bruto, desconto comercial, ajuste de fechamento e total
 * faturado. A ajuda descreve o que a tela faz hoje.
 *
 * A implementação matemática do rateio não é repetida aqui: o que a pessoa
 * precisa saber é que o desconto entra no total sem mexer no preço unitário
 * da linha, e que o ajuste só aparece quando ele é necessário.
 */
export const faturamento = {
  version: 2,
  module: "comercial",
  size: "M",
  title: "O que o Faturamento faz — e o que ele não faz",
  revisedAt: "2026-09-09",

  oneLiner:
    "O faturamento é o documento comercial do que saiu numa expedição: as quantidades vêm dela e não se editam, e o preço vem do pedido. Não é Nota Fiscal e não movimenta estoque.",
  whenToUse: [
    "Para conferir os preços de uma expedição e emitir.",
    "Para alterar um preço com motivo, nos perfis autorizados.",
    "Para cancelar um rascunho ou registrar o cancelamento de um emitido.",
  ],
  nextSteps: [{ label: "Emitido: a emissão fiscal acontece fora do sistema nesta fase" }],

  prerequisites: [
    { text: "Expedição confirmada.", href: "/comercial/expedicoes" },
    { text: "Preço acordado no pedido — onde não houver, o preço é informado aqui.", href: "/comercial/pedidos" },
  ],
  steps: [
    {
      you: 'Confira "Itens faturados": quantidade da expedição, preço acordado e preço faturado de cada linha.',
      system: "O sistema copia as quantidades e o preço acordado, e aplica ao total o desconto comercial do pedido.",
    },
    {
      you: 'Se precisar, clique em "Alterar preço de faturamento", informe o novo preço e o motivo.',
      system: 'O sistema guarda os dois valores, com autor e data. "Voltar ao acordado" desfaz.',
    },
    {
      you: 'Clique em "Emitir".',
      system: "O sistema congela o documento. Corrigir depois é cancelar e preparar outro.",
    },
  ],
  automations: [
    "O sistema mostra o rodapé em quatro partes: subtotal bruto, desconto comercial, ajuste de fechamento e total faturado.",
    "O sistema recusa alteração de preço sem motivo ou sem perfil.",
    'O sistema só calcula total quando toda linha tem preço; faltando alguma, mostra "Valores incompletos" e nunca uma soma parcial.',
  ],
  process: {
    before: ["Pedido", "Expedição confirmada"],
    here: "FATURAMENTO",
    after: ["Nota Fiscal, fora do sistema"],
  },

  terms: [
    { term: "Quantidade faturada", text: "Vem da expedição e não se edita aqui. Faturar diferente do que saiu não é possível." },
    { term: "Preço acordado", text: "O preço congelado na confirmação do pedido. É o ponto de comparação e continua visível." },
    { term: "Preço faturado", text: "O preço que este documento usa. Igual ao acordado, a menos que alguém o altere com motivo." },
    { term: "Alteração de preço", text: "Guarda preço anterior, preço novo, motivo, autor e data. Fica registrada na Auditoria do documento." },
    {
      term: "Desconto comercial",
      text: "O desconto acordado no pedido, aplicado ao total do documento. Ele não altera o preço unitário de nenhuma linha.",
    },
    {
      term: "Ajuste de fechamento",
      text: "Aparece só quando é preciso para que os faturamentos do pedido fechem exatamente com a condição comercial acordada.",
    },
    { term: "Situação", text: "Rascunho edita e cancela; Emitido é histórico; Cancelado registra o motivo." },
  ],
  states: [
    { name: "Rascunho", allows: "Confere, altera preço com motivo, emite ou cancela." },
    { name: "Emitido", allows: "Somente leitura; corrigir é cancelar e preparar outro." },
    { name: "Cancelado", allows: "Registra o cancelamento, com motivo." },
  ],
  cautions: [
    "Não tem volta: emitir congela o documento.",
    "Um faturamento nasce de uma expedição, nunca de um pedido ou de uma produção.",
    "Não é Nota Fiscal e não gera contas a receber.",
  ],
  example:
    "Expedição de 1.000 unidades a R$ 12,50: subtotal bruto R$ 12.500,00. Com 4% de desconto comercial acordado no pedido, o desconto é R$ 500,00 e o total faturado, R$ 12.000,00 — o preço da linha continua R$ 12,50.",
  learnMore: [
    { concept: "previa-gravado" },
    { label: "Tela: Expedições", href: "/comercial/expedicoes" },
    { label: "Tela: Pedidos do Cliente", href: "/comercial/pedidos" },
  ],
} satisfies HelpTopicV2;
