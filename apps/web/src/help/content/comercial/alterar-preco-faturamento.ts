import type { HelpTopicV2 } from "../../help-content";

/**
 * Alterar preço de faturamento — a exceção autorizada.
 *
 * Tópico NOVO e curto, para um diálogo que altera dinheiro e não tinha
 * nenhuma ajuda. O ponto que ele precisa deixar claro é a diferença entre os
 * dois preços: o acordado continua ali, visível, e não é substituído. Este
 * não é um acerto de digitação — é uma decisão comercial deliberada, com
 * motivo, autor e data gravados.
 */
export const alterarPrecoFaturamento = {
  version: 2,
  module: "comercial",
  size: "S",
  title: "Alterar preço de faturamento: a exceção, com motivo",
  revisedAt: "2026-09-09",

  oneLiner:
    "Fatura por um preço diferente do acordado no pedido. O preço acordado continua visível ao lado e o total faturado muda de propósito.",
  whenToUse: [
    "Quando o comercial decidiu, para esta entrega, um preço diferente do acordado.",
    "Para desfazer uma alteração anterior e voltar ao acordado.",
  ],
  nextSteps: [{ label: "Preço conferido: emitir o faturamento", href: "/comercial/faturamento" }],

  prerequisites: [
    { text: "Faturamento em rascunho — documento emitido não altera preço." },
    { text: "Perfil Comercial ou Administrador." },
  ],
  steps: [
    {
      you: "Informe o novo preço e o motivo. O motivo é obrigatório.",
      system: "O sistema grava preço anterior, preço novo, motivo, autor e data, e mostra o total resultante enquanto você digita.",
    },
    {
      you: 'Para desfazer, use "Voltar ao acordado".',
      system: "O sistema devolve a linha ao preço do pedido e registra a volta.",
    },
  ],
  automations: ["O sistema recusa a alteração sem motivo e recusa quem não tem o perfil."],

  terms: [
    { term: "Preço acordado", text: "O congelado na confirmação do pedido. Não é apagado: fica ao lado, para comparação." },
    { term: "Preço faturado", text: "O que este documento cobra. É ele que entra no total faturado." },
  ],
  cautions: [
    "A alteração é deliberada e fica registrada na Auditoria do documento, com o seu nome.",
    "O desconto comercial do pedido continua sendo aplicado ao total, por fora do preço da linha.",
  ],
  learnMore: [{ label: "Tela: Faturamento", href: "/comercial/faturamento" }],
} satisfies HelpTopicV2;
