import type { HelpTopicV2 } from "../../help-content";

/**
 * Orçamento — a proposta de preço ao cliente.
 *
 * Tópico NOVO. Até aqui o Orçamento dividia o painel com a ficha inteira do
 * Projeto: quem estava numa linha de proposta lia antes sobre produto
 * técnico, amostras e documentos. É a tela onde o preço é decidido e era a
 * única sem ajuda própria.
 *
 * A decisão PO-1 manteve o Orçamento dentro do Projeto — a tela própria fica
 * para outra rodada. O que muda agora é o conteúdo: ele passa a ser tratado
 * como documento de primeira classe, com a formação de preço por linha, a
 * validade e a recompra explicadas onde elas acontecem.
 */
export const orcamento = {
  version: 2,
  module: "comercial",
  size: "L",
  title: "Orçamento: a proposta de preço e o que o aceite autoriza",
  revisedAt: "2026-09-09",

  oneLiner:
    "O orçamento é a proposta de preço e condições apresentada ao cliente para produtos deste projeto. Cada negociação é uma versão; a aceita autoriza o Pedido.",
  whenToUse: [
    "Na primeira venda, depois que existe precificação ativa.",
    "Em toda recompra: o cliente que voltou recebe um orçamento novo neste mesmo projeto.",
    "Para registrar que o cliente aceitou ou recusou uma proposta enviada.",
  ],
  nextSteps: [
    { label: "Aceite em projeto novo: aprovar o projeto" },
    { label: "Projeto já aprovado: gerar o Pedido no Fechamento", href: "/comercial/pedidos" },
  ],

  prerequisites: [
    { text: "Projeto aberto, não cancelado.", href: "/comercial/projetos" },
    {
      text: "Para puxar preço da precificação: faixa ativa na quantidade exata cotada — 750 unidades não usam a faixa de 500 nem a de 1.000.",
      href: "/gestao/precificacao",
    },
    { text: "Para manter ou reajustar condição: proposta aceita anterior do mesmo produto neste projeto." },
  ],
  steps: [
    {
      you: 'Clique em "Criar nova versão" (ou "Novo orçamento", em projeto aprovado).',
      system: 'O sistema abre um rascunho numerado. Existe um por vez; havendo, o botão vira "Abrir rascunho".',
    },
    {
      you: 'Adicione as linhas em "Adicionar produto à proposta": produto, quantidade e unidade.',
      system: 'O sistema procura preço para cada linha e abre "Como formar o preço?" com as opções que existem ali.',
    },
    {
      you: 'Decida o preço linha a linha: manter a condição acordada, "Reajustar condição" com percentual, "Usar precificação atual" ou "Preço manual".',
      system:
        "O sistema sugere manter a condição quando ela vige e a quantidade é a mesma; quantidade diferente ou condição vencida exigem um motivo, que fica gravado.",
    },
    {
      you: 'Preencha validade, prazo, desconto e forma de pagamento e clique em "Salvar condições".',
      system: 'O sistema monta o plano de parcelas e o "Total da proposta (prévia)" enquanto você digita; o gravado fica ao lado como "Total salvo".',
    },
    {
      you: 'Clique em "Enviar ao cliente".',
      system:
        "O sistema congela a versão inteira e ela vira leitura. Enviar não manda e-mail: registra que a proposta foi apresentada.",
    },
    {
      you: 'Registre a resposta: "Registrar aceite" ou "Registrar recusa".',
      system: "O sistema marca a versão. Renegociar é criar outra; a anterior fica no histórico.",
    },
  ],
  automations: [
    "O sistema solta o preço herdado ou reajustado quando você muda a quantidade da linha: aquele preço era de outra quantidade.",
    "O sistema recusa o envio sem validade e recusa o aceite de proposta vencida.",
    "O sistema congela, no envio, o custo de referência do dia — é a base do CMV daquela venda.",
    "O sistema guarda a origem de cada preço. É informação interna: não sai no documento do cliente, assim como custo, margem e comissão.",
  ],
  process: {
    before: ["Precificação ativa", "Condição acordada anterior"],
    here: "ORÇAMENTO",
    after: ["Aceite", "Aprovar projeto", "Pedido do Cliente"],
  },

  terms: [
    {
      term: "Versão",
      text: "Cada proposta é uma versão com situação própria. Só o rascunho se edita.",
    },
    {
      term: "Condição acordada",
      text: "O preço da última proposta aceita deste produto neste projeto, com a quantidade e a validade daquela negociação.",
    },
    {
      term: "Faixa de precificação",
      text: "Cenário fechado de quantidade e preço. A linha só se prende à faixa cuja quantidade é exatamente a cotada.",
    },
    {
      term: "Validade",
      text: "Até que dia o cliente pode aceitar; vale o dia inteiro. Depois disso o caminho é uma versão nova. Proposta aceita não vence.",
    },
    {
      term: "Total da proposta (prévia) × Total salvo",
      text: "A prévia acompanha o que está na tela; o salvo é o que foi gravado. Enviado e aceito não recalculam.",
    },
    {
      term: "Simular",
      text: "Abre a simulação de custo na quantidade da linha. Não muda preço e não grava nada.",
    },
  ],
  states: [
    { name: "Rascunho", allows: "Edita linhas, preços e condições." },
    { name: "Enviado", allows: "Somente leitura; aguarda a resposta do cliente." },
    { name: "Aceito", allows: "Autoriza aprovar o projeto e gerar o Pedido." },
    { name: "Recusado", allows: "Encerra a versão; a renegociação é outra versão." },
    { name: "Substituído", allows: "Uma versão aceita depois tomou o lugar desta." },
  ],
  cautions: [
    "Não tem volta: enviar congela a versão e aceitar autoriza pedido com aquele preço. Corrigir é criar outra versão.",
    "Custo, margem e comissão aparecem só para os perfis Comercial e Administrador, e nunca no impresso.",
    "Proposta com custo industrial incompleto pode ser enviada; o sistema pede confirmação e registra que a margem não era calculável.",
    "Reajuste não abaixa preço. Para vender abaixo do acordo, use preço manual ou o desconto das condições comerciais.",
    "Uma versão aceita gera no máximo um Pedido; gerar de novo devolve o mesmo.",
  ],
  example:
    "O cliente fechou 3.000 unidades a R$ 12,50 em março. Em junho pede 3.000 de novo e a linha vem com a condição acordada sugerida. Se pedir 1.000, manter o preço exige motivo; reajustar 4% dá R$ 13,00 sem motivo.",
  learnMore: [
    { concept: "previa-gravado" },
    { concept: "versoes" },
    { label: "Tela: Precificação", href: "/gestao/precificacao" },
    { label: "Tela: Pedidos do Cliente", href: "/comercial/pedidos" },
  ],
} satisfies HelpTopicV2;
