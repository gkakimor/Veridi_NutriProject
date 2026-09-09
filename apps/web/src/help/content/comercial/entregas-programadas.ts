import type { HelpTopicV2 } from "../../help-content";

/**
 * Entregas programadas — a seção nova do Pedido (COM-04).
 *
 * Uma responsabilidade só: separar a PROMESSA da EXECUÇÃO. A confusão
 * previsível é achar que programar já compromete estoque, ou que a entrega
 * sai sozinha na data. Nenhuma das duas acontece, e é isso que o nível 1 e as
 * ressalvas dizem.
 *
 * Classe M, não S: a seção tem quatro ações (adicionar, preparar expedição,
 * reprogramar, cancelar) e cinco situações derivadas. Espremer isso em 250
 * palavras cortaria justamente as ressalvas que a fazem valer.
 */
export const entregasProgramadas = {
  version: 2,
  module: "comercial",
  size: "M",
  title: "Entregas programadas: a promessa de quando cada parte sai",
  revisedAt: "2026-09-09",

  oneLiner:
    "Aqui você registra quando cada parte do pedido foi prometida ao cliente. Programar é compromisso comercial: não reserva estoque, não expede e não fatura.",
  whenToUse: [
    "Quando a venda foi fechada para sair em datas diferentes.",
    "Para saber o que está atrasado e o que ainda vai sair.",
  ],
  nextSteps: [
    { label: 'Chegou a data: "Preparar expedição" a partir da entrega', href: "/comercial/expedicoes" },
  ],

  prerequisites: [{ text: "Pedido confirmado." }],
  steps: [
    {
      you: 'Clique em "Adicionar entrega programada", informe a data e quanto de cada produto sai nela.',
      system: 'O sistema recusa prometer mais do que o "Disponível para programar" da linha.',
    },
    {
      you: 'Na data, clique em "Preparar expedição" na linha da entrega.',
      system: "O sistema abre a separação já com as quantidades daquela promessa e ligada a ela.",
    },
    {
      you: "Confirme a Expedição pelo fluxo normal.",
      system: "O sistema baixa o estoque e a entrega passa a mostrar o que foi atendido.",
    },
    {
      you: "Mudou a data? Use Reprogramar, com o motivo.",
      system: "O sistema encerra a entrega atual e cria outra com o saldo pendente, guardando a anterior.",
    },
  ],
  automations: [
    "O sistema calcula a situação de cada entrega pelo que as Expedições confirmadas entregaram — não existe marcar como atendida.",
    "O sistema só chama de atrasada a entrega cujo dia passou e ainda tem saldo. No próprio dia ela não está atrasada.",
    "Quando a expedição é preparada pelo Pedido, sem escolher uma entrega, o sistema atende primeiro as entregas programadas mais antigas.",
  ],
  process: {
    before: ["Pedido confirmado"],
    here: "ENTREGAS PROGRAMADAS",
    after: ["Expedição", "Faturamento"],
  },

  terms: [
    { term: "Programado", text: "O que foi prometido nesta entrega." },
    { term: "Atendido", text: "O que saiu em Expedição confirmada ligada a esta entrega. Rascunho de expedição não conta." },
    { term: "Disponível para programar", text: "Pedido menos o já expedido, menos o pendente das entregas ainda ativas." },
  ],
  states: [
    { name: "Programada", allows: "Prometida e ainda não atendida." },
    { name: "Parcialmente atendida", allows: "Parte saiu; o resto continua prometido." },
    { name: "Atendida", allows: "Somente leitura; a promessa foi cumprida." },
    { name: "Atrasada", allows: "O dia passou e ainda falta quantidade." },
    { name: "Cancelada", allows: "O saldo voltou a ser programável; o que saiu continua registrado." },
  ],
  cautions: [
    "Programar não reserva estoque nem abre ordem de produção: quem faz isso é o Plano de Atendimento.",
    "Cancelar uma entrega não desfaz Expedição confirmada nem Faturamento emitido.",
    "Reprogramar não apaga a promessa anterior: ela fica no histórico com o que já entregou.",
    "Entrega inteiramente atendida não se cancela nem se reprograma — não há saldo.",
    "Entrega com expedição em preparação não se cancela nem se reprograma: resolva a expedição primeiro.",
  ],
  learnMore: [
    { concept: "reserva-consumo" },
    { label: "Tela: Expedições", href: "/comercial/expedicoes" },
    { label: "Tela: Faturamento", href: "/comercial/faturamento" },
  ],
} satisfies HelpTopicV2;
