import type { HelpTopicV2 } from "../../help-content";

/**
 * Formulação — a versão, e o que cada número significa.
 *
 * Era o maior painel do sistema (1.288 palavras) para a tela com as regras
 * mais difíceis, e explicava a mais difícil de todas em aforismo, sem um
 * número.
 *
 * A regra mudou com a homologação da bancada (FORMULATION-WORKBENCH-01):
 * pureza e reserva de produção são COLUNAS da linha, a pureza informada
 * sempre corrige e a reserva nunca entra na dose. O que ficou foi a forma:
 * cada regra vem com o número, e o aviso de dupla correção é ressalva com
 * consequência, não aforismo.
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
    { text: "Componente por dose exige as doses por embalagem: sem esse número a versão não ativa e o custo não existe." },
    { text: "Componente fornecido pelo cliente exige produto com cliente vinculado." },
  ],
  steps: [
    {
      you: 'Crie a receita, ou "Criar nova versão" a partir da ativa.',
      system: "O sistema abre um rascunho, já copiado da ativa quando existe.",
    },
    {
      you: 'Em "Produto e apresentação", defina a forma (pó ou cápsula), a base e o modo. Decida isto antes de digitar quantidades.',
      system: "O sistema deriva as doses por embalagem e passa a ler todos os números abaixo em relação a essa base.",
    },
    {
      you: 'Use "Adicionar matéria-prima" ou "Adicionar embalagem": item, quantidade, unidade, base da linha e quem fornece.',
      system: "O sistema traz a pureza do cadastro do item e mostra a física por dose e por embalagem.",
    },
    {
      you: 'Informe a pureza na coluna da linha, e a reserva de produção se houver.',
      system: "O sistema corrige a física pela pureza enquanto você digita; a conta fica no ⓘ ao lado do número.",
    },
    {
      you: 'Clique em "Salvar rascunho" quantas vezes precisar.',
      system: 'O sistema guarda e atualiza "Custo estimado de materiais". Rascunho não produz e não custeia.',
    },
    {
      you: 'Clique em "Ativar".',
      system: "O sistema grava a tela, fecha a versão, desativa a anterior e passa a usar esta em toda ordem, cálculo e preço novos.",
    },
  ],
  automations: [
    "O sistema converte unidades (1 kg é 1.000 g), aplica a pureza e calcula o físico por dose, por cápsula e por unidade acabada — é ele que a ordem reserva e consome.",
    "O sistema multiplica componente por dose pelas doses por embalagem; embalagem nunca é multiplicada por dose.",
    "O sistema estima o custo com as fontes de hoje e avisa quando há edição pendente. A estimativa não é gravada: vale o cálculo salvo na Estrutura de custos.",
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
    { term: "Alvo por dose", text: "A quantidade ATIVA que uma dose deve entregar. É o que a fórmula promete; o que a fábrica pesa sai dela pela pureza." },
    { term: "Pureza", text: "Teor real do insumo. Corrige a física: com 70%, 0,4 mg de alvo viram 0,571429 mg pesados. Em branco é desconhecida, nunca 100% — é assim que se evita a dupla correção, quando o alvo já vem corrigido." },
    { term: "Reserva de matéria-prima", text: "Percentual a mais previsto para o lote, POR LINHA. Fica registrado na linha e NÃO altera a dose: a física por dose e por cápsula continua a mesma." },
    { term: "Perda prevista de produção", text: "Percentual estimado de perda normal do processo produtivo, premissa da VERSÃO inteira. Entra no planejamento e no custo estimado interno por unidade vendável, e nunca altera a quantidade comercial do Orçamento, do Pedido ou do faturamento." },
    { term: "Por embalagem", text: "Equivalente é por unidade acabada, ANTES da pureza; ao lado, o físico é depois — é o que a ordem reserva." },
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
    "A pureza SEMPRE corrige. Se o alvo já vier corrigido, deixe-a em branco — senão o sistema divide duas vezes e a ordem reserva material a mais.",
    "A reserva de matéria-prima não entra na dose: é previsão de lote, linha a linha.",
    "A perda prevista de produção não entra na dose nem na quantidade vendida: ela aumenta a quantidade BRUTA planejada e o custo estimado interno, e o Orçamento, o Pedido e o faturamento continuam na quantidade contratada.",
    'O botão "Ativar" grava antes o que está na tela: o que você vê é o que vira ativa.',
    "Observações e notas técnicas não entram em cálculo.",
  ],
  example:
    "Alvo de 100 mg por dose e Pureza 80%: o físico por dose é 100 ÷ 0,80 = 125 mg. Uma reserva de 10% na mesma linha fica registrada para o lote, e o físico por dose continua 125 mg.",
  learnMore: [
    { concept: "versoes" },
    { concept: "material-do-cliente" },
    { label: "Tela: Produtos Acabados", href: "/cadastros/produtos" },
    { label: "Tela: Modelos de Formulação", href: "/producao/templates-formulacao" },
  ],
} satisfies HelpTopicV2;
