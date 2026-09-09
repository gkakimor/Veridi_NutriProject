import type { HelpTopicV2 } from "../../help-content";

/**
 * Recebimento — o ato que faz o material existir no estoque.
 *
 * O tópico serve quatro telas (a lista, "Receber OC", o recebimento de
 * material do cliente e o documento). A auditoria recomendou dividi-lo, e a
 * divisão é da fase seguinte; o que não podia esperar é a proporção: o
 * recebimento é IRREVERSÍVEL e cria estoque, e merecia a ajuda mais
 * cuidadosa de Compras em vez da mais longa.
 *
 * O passo a passo aqui é o de "Receber OC", que é onde o erro custa caro. O
 * material do cliente e o documento continuam nomeados, com o que os
 * distingue.
 */
export const receberOc = {
  version: 2,
  module: "compras",
  size: "L",
  title: "Receber é o ato que faz o material existir no estoque",
  revisedAt: "2026-09-09",

  oneLiner:
    "No recebimento o material comprado passa a existir: cada linha vira um lote com entrada no histórico. Recebimento não tem rascunho — confirmar é definitivo.",
  whenToUse: [
    'Chegou material de uma ordem de compra confirmada, inteiro ou em parte: use "Receber OC".',
    'Chegou material enviado pelo cliente, sem compra: use "Receber materiais" do cliente.',
    "Para consultar o que entrou, com documento, lote e custo.",
  ],
  nextSteps: [
    { label: "Item que exige Qualidade: o lote nasce aguardando liberação", href: "/estoque/lotes" },
    { label: 'Imprimir a etiqueta do lote e guardar o material' },
  ],

  prerequisites: [
    { text: "Ordem de compra confirmada com saldo em aberto — só essas aparecem.", href: "/compras/ordens" },
    { text: "Nota fiscal ou documento de remessa em mãos." },
    { text: "Lote impresso na embalagem e validade, para itens que controlam lote e validade." },
    { text: "Material do cliente exige cliente ativo e itens com controle de lote.", href: "/cadastros/clientes" },
  ],
  steps: [
    {
      you: 'Clique em "Selecionar ordem de compra".',
      system: "O sistema traz as linhas em aberto daquela ordem, com o saldo de cada uma.",
    },
    {
      you: 'Preencha "Dados do recebimento": data, nota fiscal e referência de documento.',
      system: "O sistema usa a data para validar a validade dos lotes informados abaixo.",
    },
    {
      you: 'Por linha, informe "Receber agora", "Lote do fornecedor", validade e "Localização".',
      system: "Receber menos que o saldo é normal; mais que o saldo o sistema recusa na hora.",
    },
    {
      you: 'Informe o "Custo efetivo" quando ele for conhecido — "Usar preço da OC" copia o preço previsto.',
      system: "O sistema nunca assume o preço da ordem como custo: copiar é você afirmando que foi esse.",
    },
    {
      you: 'Clique em "Confirmar recebimento".',
      system: "O sistema grava lote, movimento e novo saldo da ordem de uma vez. Falhando algo, nada é gravado.",
    },
  ],
  automations: [
    "O sistema cria o código interno do lote por linha e guarda o lote do fornecedor ao lado.",
    "O sistema define a situação inicial do lote pela configuração do item: exigindo liberação ou laudo, o lote nasce aguardando.",
    "O sistema abate o saldo da ordem de compra e a marca como parcialmente recebida quando sobra saldo.",
    "No recebimento de material do cliente, o sistema cria o lote com o cliente como proprietário e não oferece campo de custo.",
  ],
  process: {
    before: ["Ordem de Compra confirmada"],
    here: "RECEBIMENTO",
    after: ["Lote", "Qualidade", "Estoque"],
  },

  terms: [
    { term: "Lote do fornecedor × lote interno", text: "O do fornecedor é o número impresso pelo fabricante. O interno é o código que o sistema cria, único, e é ele que vai no QR." },
    { term: "Custo efetivo", text: "O que o material custou de fato. É custeio, não recebimento físico: mudá-lo depois não altera quantidade, lote nem estoque." },
    { term: "Material do cliente", text: "Entra sem ordem de compra e sem fornecedor. O lote nasce com dono, é segregado e fica fora do custo da Veridi." },
    { term: "Localização", text: "Onde o material foi guardado. Texto livre, para quem vai buscar." },
    { term: "Quantidade recebida", text: "O que chegou nesta linha. Ela não é o saldo do lote: consumo e expedição mudam o saldo depois." },
  ],
  states: [
    { name: "Confirmado", allows: "É a única situação de um recebimento. Não há rascunho." },
  ],
  cautions: [
    "Não tem volta: recebimento não se edita nem se exclui. Diferença descoberta depois vira ajuste de estoque, com motivo.",
    "A única coisa editável depois é o custo efetivo, no documento do recebimento.",
    "Falta de material do cliente nunca vira compra da Veridi.",
    "Lote e validade do material do cliente podem hoje ficar em branco: a regra está em definição com a Veridi.",
  ],
  example:
    "Ordem de 100 kg: chegam 60 kg com o lote A do fabricante e 40 kg com o lote B. São duas linhas e dois lotes internos. Se chegarem só 60 kg, a ordem fica parcialmente recebida e os 40 kg continuam em compra.",
  learnMore: [
    { concept: "identidades-do-lote" },
    { concept: "material-do-cliente" },
    { label: "Tela: Ordens de Compra", href: "/compras/ordens" },
    { label: "Tela: Lotes", href: "/estoque/lotes" },
  ],
} satisfies HelpTopicV2;
