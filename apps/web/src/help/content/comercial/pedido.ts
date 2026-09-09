import type { HelpTopicV2 } from "../../help-content";

/**
 * Pedido do Cliente — o documento e o Plano de Atendimento, juntos.
 *
 * A tela é o acompanhamento inteiro de uma venda: doze seções, várias delas
 * visíveis só em certa situação. A ajuda antiga listava treze termos sem
 * dizer a ORDEM em que as seções são usadas, e escondia no meio do glossário
 * a automação que mais gera chamado — a que não existe: produzir não reserva.
 *
 * Aqui ela é passo 6, escrita como passo, e volta na seção Atenção. A
 * decisão PO-2 manteve o comportamento do produto: reservar continua sendo
 * um ato de quem vende, e a ajuda diz isso em vez de prometer o contrário.
 */
export const pedido = {
  version: 2,
  module: "comercial",
  size: "L",
  title: "Pedido do Cliente: da confirmação à expedição",
  revisedAt: "2026-09-09",

  oneLiner:
    "O Pedido é a venda registrada: quem pediu, o quê, quanto e por qual preço. Ele não movimenta estoque; autoriza reservar, produzir, expedir e faturar.",
  whenToUse: [
    "Para registrar a venda de um orçamento aceito ou digitada à mão.",
    "Para decidir como atender: quanto sai do pronto e quanto será produzido.",
    "Para acompanhar o pedido até o fim: ordens, compras, reservas e expedições.",
  ],
  nextSteps: [
    { label: "Confirmado: aplicar o Plano de Atendimento" },
    { label: "Em atendimento: liberar as ordens geradas", href: "/producao/ordens" },
    { label: "Reservado: preparar a expedição", href: "/comercial/expedicoes" },
  ],

  prerequisites: [
    { text: "Cliente ativo e produtos aprovados — produto em desenvolvimento é recusado.", href: "/cadastros/produtos" },
    { text: "Para o Plano: o pedido precisa estar confirmado." },
    { text: "Para expedir: produto acabado reservado a este pedido, no passo 6." },
  ],
  steps: [
    {
      you: 'Informe cliente, datas e produtos e clique em "Salvar rascunho".',
      system: "O sistema guarda sem prometer nada. Em rascunho tudo se edita.",
    },
    {
      you: 'Clique em "Confirmar pedido".',
      system:
        "O sistema congela cliente, produtos, quantidades e o preço acordado de cada linha. Mudar cadastro ou tabela de preço depois não altera este pedido.",
    },
    {
      you: 'Abra "Plano de Atendimento" e leia a proposta: por produto, quanto reservar do disponível e quanto produzir.',
      system:
        "O sistema calcula com o saldo livre de agora e não grava nada. Você pode mover quantidade entre as duas colunas; a soma tem de fechar o pedido.",
    },
    {
      you: 'Clique em "Aplicar Plano de Atendimento".',
      system:
        "O sistema confere a disponibilidade de novo, cria a reserva e uma Ordem de Produção em rascunho por linha em falta, tudo de uma vez, e passa o pedido para Em atendimento. Falhando algo, nada é gravado.",
    },
    {
      you: 'Confira a "Sugestão de Compra", digite "Comprar agora" e clique em "Gerar OCs em rascunho".',
      system: "O sistema cria uma ordem de compra em rascunho por fornecedor. Confirmar cada uma é trabalho de Compras.",
    },
    {
      you: 'Terminada a produção, volte e use "Reservar disponível" em "Reservar Produto Acabado".',
      system: "O sistema prende ao pedido o produto que ficou pronto. Produzir não reserva.",
    },
    {
      you: "Prepare a expedição com o que está reservado e confirme na tela da Expedição.",
      system: "O sistema baixa o estoque e marca o pedido Parcialmente expedido ou Expedido.",
    },
  ],
  automations: [
    "O sistema muda a situação do pedido por consequência — aplicar o plano, confirmar expedições. Não existe marcar como expedido.",
    'O sistema oferece "Gerar OP para saldo restante" quando uma ordem concluída produziu menos e a linha continua descoberta.',
    'O sistema mostra, por lote reservado, o que já saiu e o que resta, e permite "Realocar" a reserva de um lote que ficou vencido ou bloqueado.',
    "O sistema prepara o faturamento a partir de cada expedição confirmada, com o preço acordado e o desconto comercial do pedido.",
  ],
  process: {
    before: ["Orçamento aceito"],
    here: "PEDIDO",
    after: ["Plano", "OP e OC", "Reserva de PA", "Expedição", "Faturamento"],
  },

  terms: [
    {
      term: "Reserva × Produzir",
      text: "As duas colunas do Plano. Reservar compromete o que já existe; produzir abre ordem para o que falta. A soma deve ser exatamente a quantidade pedida.",
    },
    {
      term: "Disponível",
      text: "O que existe menos o que já está reservado para outros. Lote bloqueado, aguardando a Qualidade ou vencido não conta.",
    },
    {
      term: "Falta expedir",
      text: "Pedido menos expedido, por linha. É o número que diz se o pedido acabou.",
    },
    {
      term: "Sugestão de Compra",
      text: "Material que as ordens deste pedido vão exigir e que falta. Considera o pedido mínimo do fornecedor e o que já está em rascunho.",
    },
    {
      term: "Materiais aguardando cliente",
      text: "Falta de material que o cliente envia. Aparece à parte e nunca vira compra da Veridi.",
    },
    {
      term: "Reservar Produto Acabado",
      text: "O painel onde o que foi produzido é preso a este pedido. Só o reservado pode ser expedido.",
    },
    {
      term: "Preço acordado",
      text: "O valor congelado na confirmação. O faturamento herda daqui, junto com o desconto comercial.",
    },
  ],
  states: [
    { name: "Rascunho", allows: "Edita tudo." },
    { name: "Confirmado", allows: "Preço congelado; libera o Plano de Atendimento." },
    { name: "Em atendimento", allows: "Reserva e ordens criadas; libera compras e expedição." },
    { name: "Parcialmente expedido", allows: "Parte saiu; o resto continua a expedir." },
    { name: "Expedido", allows: "Nada falta expedir; o faturamento é por expedição." },
  ],
  cautions: [
    "Não tem volta: confirmar congela o preço; aplicar o plano cria reserva e ordens.",
    "O Plano é leitura até você aplicar. Abrir e ajustar não grava nada.",
    "Material em compra não conta como disponível — só vira estoque no recebimento.",
    'Produto produzido depois do plano precisa ser reservado aqui, em "Reservar disponível", antes de aparecer na expedição.',
    "Cancelar exige motivo e não desfaz reserva nem ordem já criadas.",
  ],
  example:
    "Pedido de 3.000 unidades com 1.200 disponíveis: o plano propõe reservar 1.200 e produzir 1.800. Aplicado, nasce uma ordem de 1.800 em rascunho. Quando ela produzir, reserve o disponível e prepare as expedições — podem ser várias.",
  learnMore: [
    { concept: "saldos" },
    { concept: "reserva-consumo" },
    { label: "Tela: Ordens de Produção", href: "/producao/ordens" },
    { label: "Tela: Expedições", href: "/comercial/expedicoes" },
  ],
} satisfies HelpTopicV2;
