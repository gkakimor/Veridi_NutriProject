import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Conteúdo escrito na primeira rodada de ajuda — formulação, plano, ordem de
 * produção, CMV e faturamento. Fica separado dos módulos novos para que uma
 * revisão de texto não precise abrir o registro inteiro.
 */
export const baseTopics = {
  "formulacao.comoFunciona": {
    module: "producao",
    title: "Formulação: o que é e como usar esta tela",
    summary:
      "A formulação é a receita oficial de um produto: quais matérias-primas entram, quanto de cada uma, e sobre qual base essa quantidade é declarada. Ela não é editada no lugar — é escrita em versões. Uma versão vale enquanto é rascunho, e vira documento no momento em que é ativada: dali em diante ela não muda mais, e é ela que a produção executa e que o custo e o preço leem.",
    concepts: [
      {
        term: "Versão",
        text: "Cada revisão da receita é uma versão própria, com número e situação. Mudar a receita é criar uma versão nova, nunca reescrever a anterior — é assim que o histórico do que já foi produzido continua verdadeiro.",
      },
      {
        term: "Versão ativa",
        text: "A única versão que vale para produzir e custear. Só existe uma por produto. Ativar é o ato que fecha a receita: a partir daí ela é histórico.",
      },
      {
        term: "Base de cálculo",
        text: "A referência das quantidades que você digita: por lote (a receita inteira de uma batelada), por unidade acabada, ou por dose. Ela muda o significado de todo número da tabela, não o número em si.",
      },
      {
        term: "Componente",
        text: "Uma linha da receita: um item de estoque com a quantidade que entra. Matéria-prima, embalagem ou material que o próprio cliente fornece.",
      },
      {
        term: "Quantidade declarada × equivalente em estoque",
        text: "Você declara na unidade em que se pensa a fórmula; o sistema converte para a unidade em que o item é comprado e estocado. É o valor convertido que reserva e baixa material.",
      },
      {
        term: "Pureza e overage",
        text: "Correções sobre a quantidade declarada: pureza compensa o que o insumo tem de ativo, overage compensa a perda de processo. Ambos aumentam o que sai do estoque sem mudar a fórmula pretendida.",
      },
      {
        term: "Fornecimento",
        text: "Diz de quem é o material: Veridi ou o cliente. Material do cliente entra na receita e na necessidade de compra, mas nunca no custo de aquisição da Veridi.",
      },
    ],
    flows: [
      {
        name: "A. Montar e ativar uma versão",
        when: "É o que você faz nesta tela.",
        steps: [
          {
            label: "Nova versão",
            tone: "accent",
            detail:
              "Nasce em rascunho. Criada a partir da versão ativa, já vem com a receita atual copiada — você altera só o que mudou.",
          },
          {
            label: "Base de cálculo",
            detail:
              "Escolha antes de digitar quantidade: ela define o que cada número significa. Trocar depois não reinterpreta o que já foi digitado.",
          },
          {
            label: "Componentes",
            detail:
              "Cada linha é um item de estoque e quanto dele entra. O equivalente em estoque aparece ao lado, já convertido para a unidade de compra.",
          },
          {
            label: "Correções",
            detail:
              "Pureza, overage e fornecimento por linha. Só onde houver motivo — linha sem correção é a leitura mais fácil.",
          },
          {
            label: "Ativar",
            tone: "accent",
            detail:
              "Fecha a versão e substitui a anterior. A partir daqui a receita não muda mais, e é ela que a produção passa a executar.",
          },
        ],
      },
      {
        name: "B. Da versão ativa ao preço",
        when: "O que acontece depois, em outras telas, por causa do que você ativou aqui.",
        steps: [
          {
            label: "Versão ativa",
            tone: "accent",
            detail: "O ponto de partida de tudo que vem abaixo é a versão que está ativa agora.",
          },
          {
            label: "Estrutura de custos",
            detail:
              "Declara sobre qual versão se calcula, qual base de produção e quais recursos, energia e premissas entram.",
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
      "O Plano de Atendimento é onde um pedido confirmado vira decisão linha a linha: quanto sai do produto acabado que já existe e quanto precisa ser produzido. Até você aplicar, ele é leitura — compara o pedido com o saldo livre de agora e propõe a divisão, sem reservar nada e sem criar ordem nenhuma.",
    concepts: [
      {
        term: "Reservar × produzir",
        text: "As duas colunas editáveis de cada linha: quanto sai do estoque que já existe e quanto entra na fila de produção. A soma das duas tem que fechar exatamente a quantidade pedida da linha, senão o plano não aplica.",
      },
      {
        term: "Disponível",
        text: "O saldo livre do produto acabado: o que está em estoque menos o que já está reservado para outro compromisso. Lote bloqueado, aguardando liberação da qualidade ou vencido continua no físico e não entra aqui. É este número que limita quanto dá para reservar.",
      },
      {
        term: "Situação da linha",
        text: "Estoque suficiente, Requer produção ou Sem formulação ativa. A última não impede aplicar: a ordem de produção nasce mesmo assim, só que sem receita — e enquanto não tiver versão escolhida, a necessidade de material dela não aparece.",
      },
      {
        term: "Necessidade de material",
        text: "A segunda tabela: matéria-prima e embalagem que a produção proposta vai exigir, somadas entre todas as linhas que vão produzir. Sai da versão ativa da formulação de cada produto, e o mesmo material usado em dois produtos aparece numa linha só.",
      },
      {
        term: "Falta",
        text: "Necessário menos disponível, material a material. É falta física: o que está em compra aparece na coluna ao lado e não abate a conta, porque só vira estoque no recebimento.",
      },
      {
        term: "Aplicar",
        text: "O único ato desta tela que grava alguma coisa. A disponibilidade é recalculada na hora, a reserva do produto acabado e as ordens de produção em rascunho entram na mesma transação, e o pedido passa a Em atendimento. Depois disso o plano não é recalculado nem reaplicado.",
      },
    ],
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
      "A ordem de produção é o documento de uma produção: um produto, uma quantidade planejada, uma versão da formulação — e o registro do que foi separado, consumido e produzido de verdade. Dentro dela convivem dois momentos que costumam ser confundidos: reservar material é compromisso, consumir material é baixa física. Só o consumo tira quantidade do estoque.",
    concepts: [
      {
        term: "Situação",
        text: "Rascunho, Planejada, Liberada, Em produção, Concluída ou Cancelada. É a situação que diz o que ainda dá para fazer: só rascunho aceita trocar produto, formulação e quantidade, e só ordem planejada pode ser liberada.",
      },
      {
        term: "Versão congelada",
        text: "Produto, item de saída e versão da formulação são copiados para dentro da ordem no momento em que ela é planejada, não quando é criada. Enquanto rascunho, a tela mostra o estado atual do produto; depois de planejada, ativar uma versão nova não reescreve esta ordem.",
      },
      {
        term: "Necessidade de materiais",
        text: "O que a formulação exige para a quantidade planejada, já convertido para a unidade de estoque de cada item. Físico, reservado, disponível, em compra e falta ao lado são calculados na hora a partir do estoque atual — nenhum deles é reserva.",
      },
      {
        term: "Liberação",
        text: "O ato que transforma necessidade em reserva e prende lotes concretos à ordem. Exige cobertura total por estoque disponível, material a material: material em compra não cobre, e se uma linha não fecha, nenhuma reserva é feita.",
      },
      {
        term: "Planejado × produzido",
        text: "Planejado é a quantidade congelada no planejamento; produzido é a soma dos apontamentos reais. Produção parcial é normal, mas o produzido nunca ultrapassa o planejado. Antes de concluir, a diferença aparece como Restante; ao concluir, vira Variação e exige motivo.",
      },
      {
        term: "Folha de Receita",
        text: "O documento de execução da produção: quem pesou, quanto, de qual lote e quando, parte por parte quando a ordem é fracionada. A pesagem registrada ali baixa o material pelo mesmo consumo real desta tela — é registro de execução, não um segundo estoque.",
      },
    ],
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
    concepts: [
      {
        term: "Estrutura de custos",
        text: "O documento que declara sobre qual versão da formulação se calcula, qual é a base de produção e quais recursos, energia e premissas entram. Ela congela a receita de que foi feita: ativar uma versão nova da formulação depois não reescreve a estrutura que já está ativa.",
      },
      {
        term: "Cálculo de referência",
        text: "O cálculo salvo que serve de base econômica: aplica as referências de custo de uma data à estrutura e congela o resultado. É ele que a precificação e o orçamento leem. Enquanto não existir nenhum cálculo salvo não existe CMV, e a tela diz isso em vez de improvisar uma base.",
      },
      {
        term: "Data de referência",
        text: "O dia sobre o qual se pergunta. Ela seleciona o cálculo em vigor até aquela data — o sistema nunca escolhe o dia sozinho. Trocar a data pode trocar a base inteira do número.",
      },
      {
        term: "Lote de referência",
        text: "A base de produção declarada na estrutura. A quantidade simulada é convertida em número de lotes, e é isso que faz o unitário mudar com a quantidade: custo fixo por lote não dilui abaixo de um lote.",
      },
      {
        term: "Qualidade do custo",
        text: "O veredito sobre de onde vieram os preços: completo com referências reais de compra, completo com estimativa de fornecedor, parcial quando há custo não informado, ou sem custo conhecido. É ela que diz o quanto o número sustenta uma decisão.",
      },
      {
        term: "Subtotal conhecido",
        text: "O que dá para somar quando algum custo falta. Aparece rotulado como subtotal, ao lado de “CMV indisponível” — nunca no lugar do total e nunca como R$ 0,00. Zero informado é valor real; desconhecido não é.",
      },
      {
        term: "Com os dados de hoje",
        text: "Simulação sobre as premissas correntes, exibida ao lado do número congelado, para responder quanto custaria com o que se sabe agora. Não é base econômica: nada dela vira preço nem custo de ordem de produção.",
      },
    ],
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
    concepts: [
      {
        term: "Aguardando faturamento",
        text: "A fila de expedições confirmadas que ainda não têm faturamento ativo. Cada expedição é faturada por um documento de cada vez; cancelar o rascunho devolve a expedição para essa fila.",
      },
      {
        term: "Quantidade faturada",
        text: "Vem da expedição confirmada e não é editável aqui. Nunca é a quantidade pedida, a reservada nem a produzida: fatura-se o que saiu fisicamente.",
      },
      {
        term: "Preço acordado",
        text: "O preço unitário congelado no pedido quando o orçamento foi aceito, copiado para o faturamento na criação. Onde ele existe, não se redigita. Fica em branco só quando o pedido de origem não tinha preço.",
      },
      {
        term: "Preço faturado",
        text: "O que este documento efetivamente cobra. Nasce igual ao acordado e só difere depois de uma alteração explícita; onde não houve acordo, é informado à mão aqui.",
      },
      {
        term: "Alteração de preço",
        text: "Faturar diferente do acordado é ação restrita: só perfil comercial ou administrativo pode fazer, e o motivo é obrigatório. O acordado não é substituído — os dois valores, o motivo, o autor e a data ficam no documento. Voltar ao valor acordado desfaz a alteração em vez de registrar outra.",
      },
      {
        term: "Situação",
        text: "Rascunho, Emitido ou Cancelado. Só rascunho aceita edição, alteração de preço, emissão e cancelamento — emitido é histórico.",
      },
      {
        term: "Valor total",
        text: "Só existe quando todas as linhas têm preço; faltando alguma, o documento mostra valores incompletos em vez de somar parte. Preço não trava a emissão: o faturamento quantitativo vale mesmo sem valor.",
      },
    ],
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

  /*
   * Conceitos da tela de Formulação. Estavam em texto corrido no subtítulo
   * da seção, onde ninguém lê depois da primeira vez — e são exatamente os
   * que fazem a conta dar diferente do esperado.
   */
  "formulacao.base": {
    module: "producao",
    label: "Base da formulação",
    text: "A quantidade de produto acabado que a receita abaixo produz. Tudo o que for declarado nos componentes se refere a essa quantidade.",
  },
  "formulacao.modoCalculo": {
    module: "producao",
    label: "Modo de cálculo",
    text: "Base fixa: as quantidades declaradas produzem a base informada. Por dose: a quantidade é declarada para UMA dose e multiplicada pelas doses por embalagem. Embalagem continua por unidade acabada — não se multiplica por dose.",
  },
  "formulacao.fornecimento": {
    module: "producao",
    label: "Fornecimento",
    text: "Veridi: o material é comprado e custeado pela casa. Cliente: o material vem do cliente, exige produto vinculado a um cliente, e não entra no custo de aquisição da Veridi.",
  },
  "formulacao.pureza": {
    module: "producao",
    label: "Pureza",
    text: "Teor real do insumo. Com 80% de pureza é preciso pesar mais para entregar a mesma quantidade ativa. Deixar vazio significa pureza desconhecida — nenhuma correção é aplicada.",
  },
  "formulacao.overage": {
    module: "producao",
    label: "Overage",
    text: "Excesso declarado de propósito, para compensar perda de processo ou de validade. Entra no físico a pesar, nunca no que é declarado ao cliente.",
  },
  "formulacao.equivalenteEstoque": {
    module: "producao",
    label: "Equivalente estoque",
    text: "Quanto sai do estoque por unidade acabada, já com pureza e overage aplicados. É este número que a ordem de produção reserva e consome.",
  },
} satisfies Record<string, HelpHint>;

