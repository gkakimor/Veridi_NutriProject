import type { HelpTopicV2 } from "../../help-content";

/**
 * Ordem de Produção — o documento de uma produção.
 *
 * O fluxo desenhado na ajuda antiga começava em "reserva" e pulava as duas
 * ações que o iniciante precisa achar primeiro: "Planejar OP", que congela a
 * versão da formulação, e "Liberar OP", que reserva os lotes. A ordem tem
 * seis situações e treze seções, e o texto não dizia qual usar em qual
 * situação.
 *
 * Aqui o passo a passo é a sequência dos botões reais, na ordem em que eles
 * aparecem, e o "Próximo passo" responde por situação. O fim da ordem diz o
 * que a decisão PO-2 manteve: concluir NÃO reserva o produto ao pedido.
 */
export const ordemProducao = {
  version: 2,
  module: "producao",
  size: "L",
  title: "Ordem de Produção: do planejamento ao lote acabado",
  revisedAt: "2026-09-12",

  oneLiner:
    "A Ordem de Produção é o documento de uma produção: o produto, a quantidade, a receita seguida e o registro do que foi reservado, consumido e produzido de fato.",
  whenToUse: [
    "Para produzir o que um Pedido exige: a ordem nasce ligada a ele.",
    "Para produzir para estoque.",
    "Para executar: liberar, conferir, consumir, registrar e concluir.",
  ],
  nextSteps: [
    { label: 'Rascunho: "Planejar OP". Planejada: "Liberar OP"' },
    { label: 'Liberada: separar e consumir. Em produção: "Registrar produção"' },
    { label: "Concluída: reservar o produto acabado no Pedido", href: "/comercial/pedidos" },
  ],

  prerequisites: [
    { text: "Produto aprovado e ativo, com item de produto acabado.", href: "/cadastros/produtos" },
    { text: "Uma OP precisa ter um roteiro antes de ser planejada, programada ou liberada.", href: "/planejamento/perfis-producao" },
    { text: "Formulação ativa: sem versão não há necessidade de material nem liberação.", href: "/producao/formulacoes" },
    { text: "Para liberar: estoque disponível cobrindo todo o material. Material em compra não cobre; lote aguardando a Qualidade não cobre.", href: "/estoque" },
    { text: "Componente do cliente exige ordem com cliente e lote daquele cliente." },
  ],
  steps: [
    {
      you: "Em rascunho, defina produto, quantidade e, se for pesar por batelada, em quantas partes dividir.",
      system: "O sistema mostra a formulação ativa de hoje. Só aqui produto, versão e quantidade mudam.",
    },
    {
      you: 'Clique em "Planejar OP".',
      system: 'O sistema congela produto, item de saída e a versão da formulação, e calcula a "Necessidade de Materiais".',
    },
    {
      you: 'Clique em "Liberar OP".',
      system:
        "O sistema confere a cobertura, escolhe os lotes pela validade (vence antes, sai antes) e os reserva. Nada sai do estoque. Se uma linha não fecha, nenhuma reserva é feita e a tela diz por quê.",
    },
    {
      you: 'Na separação, leia o QR ou informe o lote e clique em "Confirmar separação".',
      system: "O sistema registra quem conferiu e quando. Lote diferente do reservado não passa em silêncio: a troca é uma ação explícita, antes de qualquer consumo.",
    },
    {
      you: 'Informe "Consumir agora" por linha em "Consumo Real" — ou registre a pesagem na Folha de Receita, que é o mesmo consumo pelo outro caminho.',
      system: "Aqui o estoque cai. O primeiro consumo põe a ordem Em produção. Pesou mais que o reservado? Use Consumo extra, com motivo.",
    },
    {
      you: 'Clique em "Registrar produção": quantidade produzida, Lote Veridi e validade.',
      system: "O sistema cria o lote de produto acabado e a entrada no estoque. Produção parcial é normal; registre quantas vezes precisar, sem passar do planejado.",
    },
    {
      you: 'Use "Justificar diferença" em cada material cujo consumo ficou diferente do reservado.',
      system: "O sistema grava motivo, autor e data na linha.",
    },
    {
      you: 'Clique em "Concluir OP".',
      system: "O sistema exige as justificativas e, produzindo menos que o planejado, o motivo da variação; libera a sobra reservada, sem movimento, e fecha a ordem.",
    },
  ],
  automations: [
    "O sistema congela a versão da formulação no planejamento: ativar outra depois não muda esta ordem.",
    "O sistema congela na liberação as revisões vigentes dos documentos controlados.",
    "O sistema cria o lote de produto acabado aguardando liberação da Qualidade quando o item exige, e sugere a validade pela vida útil do produto.",
    "O sistema calcula o custo industrial da ordem. Material sem preço fica em aberto, nunca zero.",
  ],
  process: {
    before: ["Pedido e Plano", "Formulação ativa"],
    here: "ORDEM DE PRODUÇÃO",
    after: ["Lote de PA", "Qualidade", "Reserva ao pedido", "Expedição"],
  },

  terms: [
    { term: "Roteiro de produção", text: "Etapas e tempos da fabricação, copiados para esta ordem." },
    { term: "Necessidade de Materiais", text: "O que a receita exige para a quantidade planejada, com físico, reservado, disponível para esta ordem, em compra e falta." },
    { term: "Liberação", text: "O ato que reserva os lotes para a ordem. Compromete o material e não tira nada da prateleira." },
    { term: "Disponível para esta OP", text: "O disponível do estoque mais o que esta ordem já reservou. Na Posição de Estoque o mesmo item aparece menor." },
    { term: "Consumo extra", text: "Amplia a reserva da linha sobre o saldo livre do lote, com motivo. Ampliar não consome: registre o consumo depois." },
    { term: "Justificar diferença", text: "Motivo gravado quando o consumido ficou diferente do reservado. Concluir exige todos." },
    { term: "Lote interno × Lote Veridi", text: "O interno é o código que o sistema cria e que vai no QR; o Lote Veridi é o número comercial do rótulo." },
    { term: "Custo industrial", text: "Material consumido lote a lote mais os custos padrão da estrutura, na proporção do produzido." },
  ],
  states: [
    { name: "Rascunho", allows: "Edita produto, versão e quantidade." },
    { name: "Planejada", allows: "Versão congelada; libera o material." },
    { name: "Liberada", allows: "Material reservado; separa e consome." },
    { name: "Em produção", allows: "Consumo iniciado; registra produção. Não cancela mais." },
    { name: "Concluída", allows: "Somente leitura; a sobra reservada foi liberada." },
  ],
  cautions: [
    "Não tem volta: consumo registrado, produção registrada e ordem concluída. Depois do primeiro consumo a ordem não cancela.",
    "Consumir é limitado ao reservado da linha; além disso, só com Consumo extra e motivo.",
    "Liberar não tira material do estoque — a baixa é o consumo.",
    "O produto acabado produzido não entra sozinho no pedido: reserve-o na tela do Pedido.",
    "Gerar o PDF da ordem, da folha de separação ou do custo — para baixar ou imprimir — não altera nada.",
  ],
  example:
    "Ordem de 500 potes com 15,46 g de ativo por embalagem: a liberação reserva 7,73 kg. Consumidos 7,9 kg, a diferença de 0,17 kg precisa de justificativa antes de concluir.",
  learnMore: [
    { concept: "reserva-consumo" },
    { concept: "identidades-do-lote" },
    { label: "Tela: Separação e consumo", href: "/producao/picking" },
    { label: "Tela: Lotes", href: "/estoque/lotes" },
  ],
} satisfies HelpTopicV2;
