import type { HelpTopicV2 } from "../../help-content";

/**
 * Lote — a rastreabilidade e a decisão da Qualidade.
 *
 * O tópico serve à lista, à fila da Qualidade (o mesmo lista, filtrada por
 * "Aguardando liberação") e ao documento do lote. A decisão mais sensível do
 * sistema — liberar material para uso — dividia 995 palavras com custo e
 * rastreabilidade, e nenhum dos botões reais era citado.
 *
 * A divisão em três tópicos é da fase seguinte. O que muda agora é o foco: o
 * passo a passo é o da decisão da Qualidade, e a rastreabilidade ficou nos
 * termos, que é onde ela é consultada.
 */
export const loteQualidade = {
  version: 2,
  module: "estoque",
  size: "L",
  title: "O lote: as três identidades e a decisão da Qualidade",
  revisedAt: "2026-09-09",

  oneLiner:
    "O lote é a menor porção de material que a Veridi rastreia. Nesta tela a Qualidade decide se ele pode ser usado: liberar, bloquear, desbloquear e decidir sobre o laudo.",
  whenToUse: [
    "Para decidir sobre um lote aguardando liberação — recebido ou produzido.",
    "Para tirar de uso um lote com problema, ou devolvê-lo para análise.",
    "Para achar um lote ou ver onde ele foi parar.",
  ],
  nextSteps: [
    { label: "Liberado: o lote passa a contar como disponível para ordem, amostra e expedição", href: "/estoque" },
  ],

  prerequisites: [
    { text: "Perfil Qualidade: só ele decide sobre o lote." },
    { text: 'Item que exige laudo (CoA): documento anexado em "Documentos do lote" e o laudo aprovado ANTES de liberar. Aprovar o laudo não libera o lote.', href: "/qualidade/documentos" },
  ],
  steps: [
    {
      you: 'Confira "Quantidade e validade", "Saldo" e "Qualidade documental".',
      system: "O sistema calcula o saldo pela soma das movimentações e marca como vencido pela data de validade.",
    },
    {
      you: 'Exigindo laudo, clique em "Aprovar CoA" — que exige o anexo — ou "Rejeitar CoA", com motivo.',
      system: "O sistema registra a decisão documental. Rejeitar o laudo bloqueia o lote na mesma ação.",
    },
    {
      you: 'Clique em "Liberar".',
      system: "O sistema torna o lote disponível. Nenhum movimento de estoque é gerado.",
    },
    {
      you: 'Para tirar de uso, clique em "Bloquear lote" e informe o motivo.',
      system: "O sistema tira o lote do disponível sem tirá-lo do físico, e recusa bloquear lote com quantidade reservada.",
    },
    {
      you: 'Para reabrir a análise, clique em "Desbloquear lote".',
      system: "O sistema devolve o lote para aguardando liberação, nunca direto para disponível.",
    },
  ],
  automations: [
    "O sistema registra autor e data de cada decisão na Auditoria do lote.",
    "O sistema define a situação inicial do lote no recebimento ou no registro de produção, pela configuração do item.",
    "A validade vale o dia inteiro: o lote vence à meia-noite seguinte.",
  ],
  process: {
    before: ["Recebimento", "Registro de produção"],
    here: "LOTE E QUALIDADE",
    after: ["Disponível", "OP, Amostra ou Expedição"],
  },

  terms: [
    { term: "Lote interno", text: "O código que o sistema cria em cada linha de entrada. É único e é o que o QR carrega." },
    { term: "Lote do fornecedor", text: "O número impresso pelo fabricante. Guardado ao lado; nunca substitui o interno." },
    { term: "Lote Veridi", text: "O número comercial do rótulo, em lote produzido. É rótulo de negócio, não identidade." },
    { term: "Situação", text: "Aguardando liberação, Disponível ou Bloqueado. Vencido não é situação: é calculado pela validade." },
    { term: "Laudo (CoA)", text: "O certificado do fornecedor. Não exigido, pendente, aguardando análise, aprovado ou rejeitado — é uma decisão separada da liberação." },
    { term: "Expedições", text: "As saídas comerciais deste lote, com pedido e cliente. Somente leitura." },
    { term: "Custo de aquisição", text: "O que este lote custou ao entrar. Em lote produzido, o custo material da produção ocupa esse lugar." },
    { term: "Destino comercial", text: "Para onde o lote foi: pedido, cliente e projeto. É o outro lado da rastreabilidade." },
    { term: "Auditoria", text: "Quem decidiu o quê e quando, no lote. Não se edita." },
  ],
  states: [
    { name: "Aguardando liberação", allows: "Não conta como disponível; espera a decisão da Qualidade." },
    { name: "Disponível", allows: "Conta para reserva, consumo e expedição." },
    { name: "Bloqueado", allows: "Fora de uso, sem sair do físico. Sai por desbloqueio." },
  ],
  cautions: [
    "Lote não se exclui: zere por ajuste de estoque e bloqueie.",
    "Quantidade recebida não é saldo — consumo e expedição mudam o saldo.",
    "Aprovar o laudo não libera o lote; são duas decisões.",
    "As decisões da Qualidade não geram movimento de estoque.",
  ],
  example:
    "Lote recebido de 100 kg, com 30 kg já consumidos: a quantidade recebida continua 100 kg e o saldo é 70 kg. Bloquear agora tira os 70 kg do disponível e não move nada no físico.",
  learnMore: [
    { concept: "identidades-do-lote" },
    { concept: "saldos" },
    { label: "Tela: Laudos e documentos", href: "/qualidade/documentos" },
    { label: "Tela: Posição de Estoque", href: "/estoque" },
  ],
} satisfies HelpTopicV2;
