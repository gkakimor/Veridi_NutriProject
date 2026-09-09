import type { HelpTopicV2 } from "../../help-content";

/**
 * Formulação — a versão, e o que cada número significa.
 *
 * Era o maior painel do sistema (1.288 palavras) para a tela com as regras
 * mais difíceis, e explicava a mais difícil de todas — "informar registra,
 * marcar aplica" — em aforismo, sem um número.
 *
 * A decisão PO-3 manteve a regra: preencher "Pureza %" registra o dado,
 * marcar "Corrigir pela pureza" é o que autoriza a conta. O que muda aqui é
 * que a regra passa a vir com exemplo numérico, e o aviso de dupla correção
 * deixa de ser aforismo para virar ressalva com consequência.
 */
export const formulacaoVersao = {
  version: 2,
  module: "producao",
  size: "L",
  title: "Formulação: a receita em versões, e o que cada número significa",
  revisedAt: "2026-09-09",

  oneLiner:
    "A formulação é a receita oficial do produto: quais itens entram e quanto de cada um para produzir uma quantidade-base. É ela que a Ordem de Produção executa e que o custo lê.",
  whenToUse: [
    "Para escrever a receita de um produto novo.",
    "Para mudar uma receita em uso: a ativa vale até você ativar a nova.",
    "Para consultar a versão que uma ordem antiga executou.",
  ],
  nextSteps: [
    { label: "Ativada: atualizar a Estrutura de custos", href: "/cadastros/produtos" },
    { label: "Ou abrir uma Ordem de Produção", href: "/producao/ordens" },
  ],

  prerequisites: [
    { text: "Produto cadastrado — o item de produto acabado nasce junto com ele.", href: "/cadastros/produtos" },
    { text: "Cada matéria-prima e embalagem cadastrada como item, na unidade em que é comprada e pesada.", href: "/cadastros/itens" },
    { text: "Componente declarado por dose exige saber as doses por embalagem: sem esse número a versão não ativa e o custo não existe." },
    { text: "Componente fornecido pelo cliente exige produto com cliente vinculado." },
  ],
  steps: [
    {
      you: 'Crie a receita, ou "Criar nova versão" a partir da ativa.',
      system: "O sistema abre um rascunho, já copiado da ativa quando existe.",
    },
    {
      you: 'Em "Produto e base", defina quanto de produto a receita produz e o modo: base fixa ou por dose. Decida isto antes de digitar quantidades.',
      system: "O sistema passa a interpretar todos os números abaixo em relação a essa base.",
    },
    {
      you: 'Use "Adicionar componente": item, quantidade, unidade, base da linha e quem fornece.',
      system: 'O sistema converte para a unidade de estoque do item e mostra "Equiv." e "Físico/un." ao lado.',
    },
    {
      you: 'Diga o que a quantidade significa em "O que a quantidade informada significa": física informada, ou calculada com os ajustes que você marcar.',
      system: "O sistema recalcula o físico e mostra a conta no ⓘ da linha.",
    },
    {
      you: 'Clique em "Salvar rascunho" quantas vezes precisar.',
      system: 'O sistema guarda e atualiza "Custo estimado de materiais". Rascunho não produz e não custeia.',
    },
    {
      you: 'Clique em "Ativar".',
      system: "O sistema grava o que está na tela, fecha a versão, desativa a anterior e passa a usar esta em toda ordem, cálculo e preço novos.",
    },
  ],
  automations: [
    "O sistema converte unidades (1 kg é 1.000 g) e calcula o físico por unidade acabada — é o físico que a ordem reserva e consome.",
    "O sistema multiplica componente por dose pelas doses por embalagem; embalagem nunca é multiplicada por dose.",
    "O sistema estima o custo com as fontes de hoje e avisa quando há edição pendente. Essa estimativa não é gravada: o custo que vale é o cálculo salvo na Estrutura de custos.",
    "O sistema congela a versão dentro de cada Ordem de Produção: ativar outra depois não muda ordem já emitida.",
  ],
  process: {
    before: ["Produto"],
    here: "FORMULAÇÃO",
    after: ["Estrutura de custos", "Ordem de Produção"],
  },

  terms: [
    { term: "Modo de cálculo", text: "Base fixa: as quantidades produzem a base inteira. Por dose: a quantidade de cada componente é para UMA dose." },
    { term: "Doses por embalagem", text: "Quantas doses cabem numa embalagem. É o multiplicador do modo por dose; em branco, não há quantidade física nem custo." },
    { term: "Quantidade informada", text: "O que você digitou, na unidade que escolheu. Sozinha ela não diz se já está corrigida." },
    { term: "Ajustes da quantidade", text: 'Equiv. é a quantidade por unidade acabada na unidade de estoque, ANTES dos ajustes. Físico/un. é depois — é o que a fábrica pesa.' },
    {
      term: "Pureza e overage (excesso planejado)",
      text: 'Pureza é o teor real do insumo; em branco significa desconhecida, nunca 100%. Overage é quantidade a mais, de propósito, para compensar perda. Preencher "Pureza %" ou "Overage %" registra o dado; marcar "Corrigir pela pureza" ou "Aplicar overage" é o que manda o sistema usá-lo. A linha avisa quando há risco de dupla correção.',
    },
    { term: "Fornecimento", text: "Veridi compra e custeia. Cliente envia o material: ele entra na receita e na necessidade, nunca no custo da Veridi." },
    { term: "Custo estimado de materiais", text: "Prévia de apoio, calculada com os preços de hoje. Não é gravada e não substitui o cálculo salvo." },
  ],
  states: [
    { name: "Rascunho", allows: "Edita e salva; não produz e não custeia." },
    { name: "Ativa", allows: "Produz e custeia; não se edita. Uma por produto." },
    { name: "Inativa", allows: "Somente leitura; ordens antigas continuam apontando para ela." },
  ],
  cautions: [
    "Não tem volta: versão ativada não se edita. Mudar a receita é criar outra versão.",
    "Informar pureza ou overage não corrige nada sozinho — a correção só acontece com o ajuste marcado.",
    "Risco de dupla correção: se a quantidade digitada já veio corrigida da origem, não marque o ajuste. O sistema dividiria pela pureza duas vezes e a ordem reservaria material a mais.",
    'O botão "Ativar" grava antes o que está na tela: o que você vê é o que vira ativa.',
    "Observações e notas técnicas não entram em cálculo.",
  ],
  example:
    "Um ativo declarado com 100 mg teóricos e Pureza % 80: com \"Corrigir pela pureza\" marcado, o físico é 100 ÷ 0,80 = 125 mg. Com a pureza preenchida e o ajuste desmarcado, o físico continua 100 mg — o dado fica registrado e não entra na conta.",
  learnMore: [
    { concept: "versoes" },
    { concept: "material-do-cliente" },
    { label: "Tela: Produtos", href: "/cadastros/produtos" },
    { label: "Tela: Modelos de formulação", href: "/producao/templates-formulacao" },
  ],
} satisfies HelpTopicV2;
