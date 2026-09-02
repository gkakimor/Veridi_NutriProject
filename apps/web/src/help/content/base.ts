import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Conteúdo escrito na primeira rodada de ajuda — formulação, plano, ordem de
 * produção, CMV e faturamento. Fica separado dos módulos novos para que uma
 * revisão de texto não precise abrir o registro inteiro.
 */
export const baseTopics = {
  "formulacao.comoFunciona": {
    module: "producao",
    title: "Como a formulação vira custo e preço",
    summary:
      "A formulação é a receita oficial do produto, e só passa a valer quando uma versão é ativada. É a versão ativa que a estrutura de custos, o cálculo e a precificação leem — e que a produção executa.",
    flow: [
      { label: "Produto" },
      { label: "Formulação" },
      { label: "Versão ativa", tone: "accent" },
      { label: "Estrutura de custos" },
      { label: "Cálculo" },
      { label: "Precificação" },
    ],
    steps: [
      {
        label: "Produto com item acabado",
        detail:
          "A formulação pertence ao produto. Sem item de produto acabado vinculado não há o que produzir nem o que custear.",
      },
      {
        label: "Rascunho",
        detail:
          "Enquanto está em rascunho a receita é livre: componentes, quantidades, base de cálculo e doses mudam à vontade.",
      },
      {
        label: "Ativar a versão",
        detail:
          "Só uma versão fica ativa por produto. Ativar é o que autoriza produzir e calcular custo por ela.",
      },
      {
        label: "Estrutura de custos",
        detail:
          "Declara sobre qual versão da receita se calcula, qual base de produção e quais recursos, energia e premissas entram.",
      },
      {
        label: "Cálculo",
        detail:
          "Aplica as referências de custo de uma data à estrutura e congela o resultado. É o documento que a precificação lê.",
      },
      {
        label: "Precificação",
        detail:
          "Margem e faixas por quantidade partem do cálculo congelado — nunca de um custo recalculado na hora da venda.",
      },
    ],
    notes: [
      "Versão ativa é histórico: depois de ativada ela não se altera. Para mudar a receita, crie uma nova versão a partir dela — a anterior continua registrada.",
      "Ordem de produção já emitida nunca muda porque uma nova versão foi ativada: cada ordem guarda a versão que executou.",
      "Por dose: a quantidade do componente é declarada para UMA dose e multiplicada pelas doses por embalagem. Embalagem continua por unidade acabada — não se multiplica por dose.",
      "Material fornecido pelo cliente é declarado na própria versão e segue congelado na ordem de produção. Ele entra na receita e na necessidade de material, mas nunca no custo de aquisição da Veridi.",
      "Versão com componente do cliente só ativa se o produto tiver cliente vinculado: sem cliente não existe estoque elegível para aquele componente.",
    ],
  },
  "planoAtendimento.comoFunciona": {
    module: "comercial",
    title: "Como o Plano de Atendimento decide o que fazer",
    summary:
      "O Plano é projeção, não decisão: ele lê o pedido confirmado, compara com o estoque disponível e propõe reservar o que existe e produzir o que falta. Nada muda no estoque enquanto você não aplicar.",
    flow: [
      { label: "Pedido" },
      { label: "Estoque" },
      { label: "Falta", tone: "warn" },
      { label: "Produção/Compra", tone: "accent" },
    ],
    steps: [
      {
        label: "Pedido confirmado",
        detail: "O Plano só existe depois da confirmação: cliente, produtos e quantidades ficam congelados.",
      },
      {
        label: "Leitura do estoque",
        detail:
          "Vale o saldo livre. Lote bloqueado, aguardando liberação, vencido ou zerado fica de fora.",
      },
      {
        label: "Proposta padrão",
        detail: "Estoque primeiro: reserva o que existe e joga o restante para produção.",
      },
      {
        label: "Ajuste manual",
        detail: "Você move quantidade entre reservar e produzir, desde que a soma feche a quantidade pedida.",
      },
      {
        label: "Aplicar",
        detail:
          "A disponibilidade é revalidada na hora. Reserva e ordens de produção entram juntas ou não entra nada.",
      },
    ],
    notes: [
      "Abrir o Plano não reserva nada — a reserva acontece só ao aplicar.",
      "Cada linha em falta gera no máximo uma ordem de produção em rascunho, que segue o ciclo normal de planejar e liberar.",
      "Material em compra não conta como disponível: ele entra no estoque no recebimento.",
    ],
  },
  "ordemProducao.comoFunciona": {
    module: "producao",
    title: "Como a ordem de produção movimenta o estoque",
    summary:
      "A ordem separa dois momentos que costumam ser confundidos: reservar material é compromisso, consumir material é baixa física. Só o consumo tira quantidade do estoque.",
    flow: [
      { label: "OP" },
      { label: "Reserva" },
      { label: "Separação" },
      { label: "Consumo", tone: "accent" },
      { label: "Produção realizada" },
      { label: "Lote acabado" },
      { label: "Qualidade" },
    ],
    steps: [
      {
        label: "Liberar a ordem",
        detail:
          "A liberação exige cobertura total por estoque disponível e reserva os lotes na hora. Material em compra não cobre nada.",
      },
      {
        label: "Reserva",
        detail:
          "Compromete o saldo para esta ordem. Reduz o disponível, não o físico: nada sai do estoque e nenhum movimento é gerado.",
      },
      {
        label: "Separação",
        detail:
          "Conferência física do lote separado. Também não altera estoque — confirma que o material reservado é o que está na mão.",
      },
      {
        label: "Consumo real",
        detail:
          "Aqui o estoque físico cai. Cada consumo confirmado gera um movimento de saída e reduz a reserva que ainda restava.",
      },
      {
        label: "Produção realizada",
        detail:
          "Apontamento do que efetivamente saiu da linha. Produção parcial é permitida e pode ter vários apontamentos.",
      },
      {
        label: "Lote acabado",
        detail: "O produto acabado entra no estoque como lote próprio, com data de produção e validade.",
      },
      {
        label: "Qualidade",
        detail:
          "Quando o item acabado exige liberação, o lote nasce aguardando decisão e só conta como disponível depois dela.",
      },
    ],
    notes: [
      "Reserva não movimenta estoque físico; consumo movimenta. O disponível cai na reserva, o físico cai no consumo.",
      "O consumo é limitado ao que a linha tem reservado. Para ir além existe o consumo extra: é um ato à parte, com motivo obrigatório, gravado com autor e data ao lado da reserva original — nunca um ajuste silencioso.",
      "O consumo extra confere o saldo realmente livre do lote antes de ampliar a reserva — estoque reservado por outra ordem nunca é tomado.",
      "Ampliar a reserva ainda não é consumir: o estoque só se move quando o consumo é registrado.",
      "Sobra reservada continua reservada enquanto a ordem está em produção; ela é liberada no encerramento da ordem.",
      "A ordem guarda a versão da formulação que executou — ativar uma versão nova depois nunca reescreve uma ordem já emitida.",
    ],
  },
  "cmv.comoFunciona": {
    module: "gestao",
    title: "Como o CMV de uma quantidade é montado",
    summary:
      "O CMV responde “quanto custa produzir esta quantidade”. Não é um cadastro à parte: soma a formulação, os recursos e as premissas da estrutura de custos usando o cálculo em vigor na data de referência.",
    flow: [
      { label: "Formulação" },
      { label: "Materiais" },
      { label: "Recursos" },
      { label: "Energia" },
      { label: "Premissas" },
      { label: "CMV", tone: "accent" },
    ],
    steps: [
      {
        label: "Formulação",
        detail:
          "A versão da receita define as quantidades físicas de cada material para a base de produção declarada.",
      },
      {
        label: "Materiais",
        detail:
          "Cada material recebe uma referência de custo: média ponderada das compras recentes e, só em último caso, oferta de fornecedor homologado.",
      },
      {
        label: "Recursos",
        detail:
          "Mão de obra e equipamento entram pelo tempo que a base de produção consome, na tarifa declarada na estrutura.",
      },
      {
        label: "Energia",
        detail:
          "Informada direto ou derivada dos equipamentos — nunca as duas, porque somaria a mesma energia duas vezes.",
      },
      {
        label: "Premissas",
        detail:
          "Percentuais e custos adicionais aplicam sobre o custo industrial direto completo; um percentual nunca vira base de outro.",
      },
      {
        label: "CMV",
        detail:
          "O custo da quantidade pedida. A quantidade muda o unitário: custo fixo por lote não dilui abaixo de um lote e caixa de embalagem é inteira.",
      },
    ],
    notes: [
      "Material sem custo conhecido não vira zero: ele aparece como pendência, o total fica indisponível e o que se mostra é o subtotal conhecido, rotulado como subtotal. Zero informado, esse sim, é um valor real.",
      "Material de propriedade do cliente fica fora da aquisição da Veridi. Não é zero nem desconhecido — é de terceiro, e não piora a qualidade do resultado.",
      "A qualidade da referência diz de onde vieram os preços: tudo de compra real, com estimativa de oferta de fornecedor, parcial ou sem custo. É ela que diz o quanto o número sustenta uma decisão.",
      "Simular é ler: abrir a tela ou mudar a quantidade não cria cálculo, não grava preço e não persiste nada. Congelar continua sendo trabalho do cálculo salvo.",
      "A data de referência escolhe o cálculo em vigor até aquele dia — um cálculo salvo depois não poderia ser conhecido antes.",
    ],
  },
  "faturamento.comoFunciona": {
    module: "comercial",
    title: "O que o Faturamento faz — e o que ele não faz",
    summary:
      "O faturamento é o documento comercial do que foi efetivamente expedido. Ele fecha o ciclo do pedido, mas não emite Nota Fiscal, não movimenta estoque e não é Contas a Receber.",
    flow: [{ label: "Pedido" }, { label: "Expedição" }, { label: "Faturamento", tone: "accent" }],
    steps: [
      {
        label: "Pedido confirmado",
        detail: "Congela cliente, produtos, quantidades e o preço acordado de cada linha.",
      },
      {
        label: "Expedição confirmada",
        detail:
          "É ela que tira o produto do estoque, e é dela que sai a quantidade faturável — nunca a quantidade pedida, reservada ou produzida.",
      },
      {
        label: "Faturamento",
        detail:
          "Nasce com as linhas da expedição: produto, lote, quantidade e unidade não são editáveis aqui. Cada expedição confirmada é faturada por um faturamento.",
      },
      {
        label: "Emissão",
        detail:
          "Emitir torna o documento somente leitura. Não há correção depois — o caminho é cancelar e preparar outro.",
      },
    ],
    notes: [
      "O preço unitário é herdado do pedido: é o preço acordado quando o orçamento foi aceito. Precificação nova ou cálculo novo nunca reescrevem o que já foi combinado.",
      "Faturar diferente do acordado é uma alteração de preço: exige perfil comercial ou administrativo e motivo obrigatório, e o preço acordado continua visível ao lado. Voltar ao valor acordado limpa a alteração em vez de registrar uma.",
      "Onde não houve preço acordado, o faturamento quantitativo continua válido e o preço é informado à mão — nada é inventado para preencher a lacuna.",
      "Não é Nota Fiscal: nenhum documento fiscal é emitido aqui. A emissão fiscal é um passo separado, fora do sistema nesta fase.",
      "Não é Contas a Receber: faturar não gera título, não registra pagamento e não movimenta estoque — a saída física já aconteceu na expedição.",
    ],
  },
} satisfies Record<string, HelpTopic>;



/**
 * Textos do ⓘ ao lado de um rótulo, indexados por `<módulo>.<conceito>`.
 *
 * Separados dos tópicos porque respondem a outra pergunta: "o que essa
 * palavra quer dizer", não "como esse processo funciona".
 */
export const baseHints = {
  "planoAtendimento.fisico": {
    module: "comercial",
    label: "Físico",
    text: "O que existe de fato no estoque, somando todos os lotes do item — inclusive lote bloqueado, aguardando liberação ou vencido. É o que está na prateleira, não o que está livre para usar.",
  },
  "planoAtendimento.reservado": {
    module: "comercial",
    label: "Reservado",
    text: "Quantidade já comprometida com ordens de produção liberadas e ainda não consumida. Continua no estoque físico, mas nenhuma outra ordem pode contar com ela.",
  },
  "planoAtendimento.disponivel": {
    module: "comercial",
    label: "Disponível",
    text: "Saldo livre para uso: o que está em estoque menos o que já está reservado. Lote bloqueado, aguardando liberação ou vencido não entra na conta.",
  },
  "planoAtendimento.emCompra": {
    module: "comercial",
    label: "Em compra",
    text: "Quantidade já pedida ao fornecedor e ainda não recebida. É informativo: não conta como disponível para reservar nem para liberar produção.",
  },
  "planoAtendimento.falta": {
    module: "comercial",
    label: "Falta",
    text: "Quanto o necessário passa do disponível. É falta física: material em compra não abate esta conta, e falta de material do cliente se resolve com nova remessa dele, não com compra da Veridi.",
  },
} satisfies Record<string, HelpHint>;

