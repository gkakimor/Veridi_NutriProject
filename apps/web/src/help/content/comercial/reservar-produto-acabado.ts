import type { HelpTopicV2 } from "../../help-content";

/**
 * Reservar Produto Acabado — a seção do Pedido que ninguém encontra sozinho.
 *
 * Tópico NOVO e curto. A auditoria classificou esta seção como o
 * pré-requisito invisível mais caro do sistema: o produto que a ordem
 * terminou de produzir NÃO entra sozinho no pedido, e quem não sabe disso
 * chega à expedição e não encontra nada para enviar.
 *
 * A decisão PO-2 manteve as duas ações separadas. A ajuda, então, tem uma
 * responsabilidade só: dizer que este passo existe, e onde ele fica.
 */
export const reservarProdutoAcabado = {
  version: 2,
  module: "comercial",
  size: "S",
  title: "Reservar Produto Acabado: o passo entre produzir e expedir",
  revisedAt: "2026-09-09",

  oneLiner:
    "Produto que ficou pronto depois do Plano de Atendimento não entra sozinho no pedido. Aqui você prende ao pedido o que já existe em estoque.",
  whenToUse: [
    "Quando uma ordem de produção deste pedido terminou.",
    "Quando chegou produto acabado por outro caminho e ele vai atender este pedido.",
  ],
  nextSteps: [{ label: "Reservado: preparar a expedição", href: "/comercial/expedicoes" }],

  prerequisites: [
    { text: "Produto acabado disponível: lote liberado pela Qualidade e dentro da validade.", href: "/estoque/lotes" },
  ],
  steps: [
    {
      you: "Leia a linha do produto: expedido, reservado restante, falta reservar e disponível agora.",
      system: "O sistema calcula o disponível descontando o que já está reservado a outros pedidos e a ordens.",
    },
    {
      you: 'Clique em "Reservar disponível".',
      system: "O sistema prende ao pedido o que existe, até o que falta reservar.",
    },
  ],
  automations: [
    'O sistema permite "Realocar" quando um lote reservado fica vencido ou bloqueado; o que já saiu continua no lote original.',
  ],
  process: {
    before: ["OP concluída"],
    here: "RESERVAR PA",
    after: ["Expedição"],
  },

  terms: [
    { term: "Falta reservar", text: "Quantidade do pedido que ainda não tem produto preso a ela." },
    { term: "Disponível agora", text: "Produto acabado em estoque que nenhum outro documento reservou." },
  ],
  cautions: [
    "Concluir a ordem de produção não reserva nada: este passo é manual e é aqui.",
    "Só o que está reservado pode ser expedido.",
  ],
  learnMore: [
    { concept: "reserva-consumo" },
    { concept: "saldos" },
    { label: "Tela: Expedições", href: "/comercial/expedicoes" },
  ],
} satisfies HelpTopicV2;
