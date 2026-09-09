import type { HelpTopicV2 } from "../../help-content";

/**
 * Expedição — o documento que tira o produto da prateleira.
 *
 * O resumo antigo era um dos melhores do sistema; o que vinha depois eram
 * onze termos e dois fluxos quase idênticos (total e parcial diferem em uma
 * etapa). Aqui o fluxo é um só, a entrega parcial virou exemplo com número,
 * e três dos termos passaram a apontar para a dica ⓘ que já explica a mesma
 * coluna na tela — em vez de uma segunda redação que envelhece sozinha.
 */
export const expedicao = {
  version: 2,
  module: "comercial",
  size: "M",
  title: "O que muda o estoque numa expedição — e o que não muda",
  revisedAt: "2026-09-09",

  oneLiner:
    "Aqui a expedição sai: você ajusta quanto vai de cada lote reservado, confere o lote físico e confirma. Só a confirmação baixa o estoque.",
  whenToUse: [
    "Para enviar produto de um pedido em atendimento.",
    "Para enviar uma parte agora e o resto depois.",
  ],
  nextSteps: [{ label: "Confirmada: preparar o faturamento", href: "/comercial/faturamento" }],

  prerequisites: [
    { text: "Produto acabado reservado a este pedido, feito na tela do Pedido.", href: "/comercial/pedidos" },
    { text: "Lote dentro da validade e liberado pela Qualidade.", href: "/estoque/lotes" },
  ],
  steps: [
    {
      you: "Abra o rascunho da expedição.",
      system: "O sistema já preenche o reservado disponível de cada lote, limitado ao que falta expedir.",
    },
    {
      you: 'Ajuste "Enviar agora" por lote e anote as observações da entrega.',
      system: 'O sistema mostra "Já expedido", "Expedindo agora" e "Restante após esta expedição" enquanto você digita.',
    },
    {
      you: "Confira cada lote pela leitura do QR ou pelo código.",
      system: "O sistema compara com o lote reservado na linha. A conferência responde se o lote certo está ali, não quanto.",
    },
    {
      you: 'Clique em "Confirmar expedição".',
      system: "O sistema baixa físico e reserva de uma vez, revalida validade e situação do lote e atualiza o pedido.",
    },
  ],
  automations: [
    "O sistema limita a linha ao menor entre o reservado do lote e o que falta no pedido.",
    "O sistema libera a reserva remanescente quando o pedido fecha.",
  ],
  process: {
    before: ["Pedido", "Reserva de PA"],
    here: "EXPEDIÇÃO",
    after: ["Faturamento"],
  },

  terms: [
    "comercial.expedicaoReservadoDisponivel",
    "comercial.expedicaoEnviarAgora",
    "comercial.expedicaoConferencia",
    {
      term: "Separação",
      text: "O ato de buscar e juntar o material antes do envio. A Folha de separação (FO-05) é o papel de quem busca; ela é leitura e não movimenta nada.",
    },
    {
      term: "Confirmar",
      text: "O único ato desta tela que mexe no estoque. Separar e conferir não movimentam nada.",
    },
  ],
  states: [
    { name: "Rascunho", allows: "Edita quantidades e confere lotes; nada saiu." },
    { name: "Confirmada", allows: "Somente leitura; o estoque já baixou." },
    { name: "Cancelada", allows: "Existe só para rascunho." },
  ],
  cautions: [
    "Não tem volta: confirmar a expedição. Ela não se edita, não se reconfirma e não se cancela.",
    "Lote divergente não é trocado aqui: realoque a reserva na tela do Pedido.",
    "Conferir não movimenta nada — é só a resposta de que o lote certo está ali.",
  ],
  example:
    "Pedido de 3.000 com 1.000 reservadas hoje: confirme 1.000 e o pedido fica Parcialmente expedido. Produzidas e reservadas mais 2.000, uma segunda expedição fecha o pedido — e cada uma gera o próprio faturamento.",
  learnMore: [
    { concept: "reserva-consumo" },
    { label: "Tela: Faturamento", href: "/comercial/faturamento" },
  ],
} satisfies HelpTopicV2;
