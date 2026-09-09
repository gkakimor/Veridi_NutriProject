import type { HelpTopicV2 } from "../../help-content";

/**
 * Precificação — o documento que vira preço.
 *
 * O defeito mais caro do texto antigo não era o tamanho: era não dizer DE
 * ONDE se cria uma precificação. Ela nasce na Estrutura de custos, na lista
 * de cálculos salvos — a lista de precificações não cria nada, e ninguém
 * avisava. Os dois modos de faixa, que são a decisão central da tela,
 * cabiam num termo de trinta palavras.
 *
 * Aqui a origem é pré-requisito e primeiro passo, os modos são o passo 2, e
 * a cadeia inteira aparece em "Onde isto entra": os cinco botões de custo e
 * preço deixam de parecer módulos desconectados.
 */
export const precificacao = {
  version: 2,
  module: "gestao",
  size: "L",
  title: "O que é uma Precificação e o que a ativação congela",
  revisedAt: "2026-09-09",

  oneLiner:
    "A precificação transforma um custo já calculado em preço de venda por faixa de quantidade, com margem e comissão. Ativada, ela é o preço vigente do produto.",
  whenToUse: [
    "Depois de salvar um cálculo de custo na Estrutura de custos do produto.",
    "Quando o custo mudou e o preço precisa ser revisto: crie uma versão nova.",
    "Quando a mesma regra serve a vários produtos: aplique uma política.",
  ],
  nextSteps: [
    { label: "Ativada: o orçamento passa a oferecer o preço das faixas", href: "/comercial/projetos" },
  ],

  prerequisites: [
    { text: "Um cálculo de custo salvo do produto. Sem ele não existe precificação.", href: "/cadastros/produtos" },
    { text: "O cálculo idealmente completo: com custo incompleto, o preço por margem fica em branco." },
    { text: "Perfil Comercial ou Administrador." },
  ],
  steps: [
    {
      you: 'Na Estrutura de custos, na lista de cálculos salvos, clique em "Criar precificação" (ou use uma política).',
      system: "O sistema abre um rascunho com a base de custo fixada naquele cálculo. Um rascunho por produto.",
    },
    {
      you: "Adicione faixas: quantidade, modo, margem e comissão.",
      system: "O sistema mostra a prévia da faixa — custo, preço sugerido, comissão, contribuição e markup (quanto o preço está acima do custo) — antes de você adicionar.",
    },
    {
      you: "Escolha o modo de cada faixa: informar a margem desejada, ou informar o preço.",
      system: "No primeiro, o sistema devolve o preço; no segundo, devolve a margem que aquele preço dá.",
    },
    {
      you: "Leia a qualidade do custo ao lado de cada faixa.",
      system: "O sistema diz de onde vieram os preços dos materiais — é isso que mede o quanto o número sustenta a decisão.",
    },
    {
      you: 'Clique em "Ativar precificação".',
      system:
        "O sistema refaz a conta inteira, congela custo, preço, comissão, contribuição e markup de cada faixa e torna inativa a versão anterior. Com custo incompleto, pede confirmação.",
    },
  ],
  automations: [
    "O sistema recalcula cada faixa para a própria quantidade: custo fixo por lote não dilui abaixo de um lote e caixa de embalagem é inteira. Por isso o custo unitário de 300 não é o de 3.000.",
    "O sistema recusa margem somada à comissão em 100% ou mais.",
    "O sistema avisa quando a quantidade da faixa fica abaixo do lote mínimo do produto, sem corrigir.",
    "Ao trocar a base pelo custo atual: no rascunho, troca nele mesmo; na versão ativa, cria uma versão nova com as faixas copiadas e mantém a ativa intacta.",
    "O sistema não arredonda preço: 15,3846 fica 15,3846 até alguém decidir.",
  ],
  process: {
    before: ["Formulação ativa", "Estrutura de custos", "Cálculo salvo"],
    here: "PRECIFICAÇÃO",
    after: ["Orçamento", "Pedido"],
  },

  terms: [
    { term: "Base de custo", text: "O cálculo salvo sobre o qual todas as faixas foram construídas. Uma base para a versão inteira." },
    { term: "Faixa de quantidade", text: "Um cenário de venda fechado. O orçamento só usa a faixa cuja quantidade é exatamente a cotada: 750 não usa a de 500 nem a de 1.000." },
    { term: "Modo de preço", text: "Calcular pela margem (você informa a margem, o sistema devolve o preço) ou preço informado (você digita o preço, o sistema devolve a margem)." },
    { term: "Margem de contribuição", text: "Preço menos comissão menos custo industrial, dividido pelo preço. Não é lucro: imposto, frete e inadimplência não entram." },
    { term: "Comissão", text: "Percentual sobre o preço bruto de venda." },
    { term: "Markup (quanto o preço está acima do custo)", text: "Diferente de margem. Fica em branco quando o custo é zero." },
    { term: "Qualidade do custo", text: "De onde vieram os preços dos materiais: compra real, estimativas, parcial ou sem custo." },
    { term: "Lista de precificações", text: "A tela de consulta das versões. Ela não cria precificação: a criação é na Estrutura de custos." },
  ],
  states: [
    { name: "Rascunho", allows: "Edita faixas e troca a base. Um por produto." },
    { name: "Ativa", allows: "É o preço vigente; não se edita." },
    { name: "Inativa", allows: "Somente leitura; foi substituída por outra versão." },
  ],
  cautions: [
    "Não tem volta: ativar congela. Para outra base, nasce outra versão.",
    "Com custo incompleto o preço pela margem fica em branco; preço informado é aceito, mas margem, markup e contribuição ficam em branco.",
    "Contribuição negativa aparece como está: preço abaixo do custo é informação, não erro escondido.",
    "Material do cliente fica fora do custo e não piora a qualidade do custo.",
  ],
  example:
    "Custo por unidade R$ 10,00 na faixa de 1.000, margem desejada 30% e comissão 5%: preço = 10 ÷ (1 − 0,30 − 0,05) = R$ 15,38. Na faixa de 300 o custo unitário sobe, porque o custo fixo do lote se divide por menos unidades, e o preço sobe junto.",
  learnMore: [
    { concept: "custo-desconhecido" },
    { concept: "previa-gravado" },
    { label: "Tela: Políticas de precificação", href: "/gestao/politicas-precificacao" },
    { label: "Tela: Projetos e orçamentos", href: "/comercial/projetos" },
  ],
} satisfies HelpTopicV2;
