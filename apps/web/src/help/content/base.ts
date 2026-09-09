import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Conteúdo escrito na primeira rodada de ajuda — formulação, plano, ordem de
 * produção, CMV e faturamento. Fica separado dos módulos novos para que uma
 * revisão de texto não precise abrir o registro inteiro.
 */
export const baseTopics = {
  "formulacao.lista": {
    module: "producao",
    title: "Formulações: qual produto já tem receita ativa",
    summary:
      "Esta lista mostra, produto a produto, se existe formulação e em que estado ela está: a versão ativa, ou rascunho sem versão ativa, ou nenhuma formulação. Não se edita receita aqui — cada linha abre a formulação do produto, onde ficam o histórico de versões e a edição.",
    concepts: [
      {
        term: "Versão ativa",
        text: "O número da versão em vigor do produto. É a única que a produção executa e que o custo e o preço leem.",
      },
      {
        term: "Situação",
        text: "Ativa: existe versão ativa. Rascunho, sem versão ativa: alguém começou a receita e ainda não ativou. Sem formulação: o produto não tem receita nenhuma e não pode ser produzido nem custeado.",
      },
      {
        term: "Item acabado",
        text: "O item de estoque que a receita produz — o produto acabado que ganha lote e saldo.",
      },
      {
        term: "Busca",
        text: "Por produto, cliente ou item acabado. A lista é de produtos, não de versões: um produto aparece uma vez só.",
      },
    ],
    flow: [
      { label: "Buscar o produto" },
      { label: "Ler a situação" },
      { label: "Abrir a formulação", tone: "accent" },
      { label: "Versão" },
    ],
    steps: [
      { label: "Buscar o produto", detail: "Por nome, código, cliente ou item acabado." },
      {
        label: "Ler a situação",
        detail: "Ativa, rascunho sem versão ativa, ou sem formulação. É o que diz se o produto está pronto para produzir.",
      },
      {
        label: "Abrir a formulação",
        detail: "A linha abre a formulação do produto: versão ativa, histórico e o botão de criar nova versão.",
      },
      {
        label: "Versão",
        detail: "Da formulação do produto se abre cada versão — é lá que a receita é escrita, salva e ativada.",
      },
    ],
    notes: [
      "Produto sem formulação não é erro da lista: é um produto que ainda não teve receita escrita.",
      "Rascunho não vale para produzir nem custear. Só a ativação fecha a receita.",
      "A lista não cria produto. Produto novo nasce em Cadastros › Produtos, e é lá que o item acabado é criado junto.",
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
  "producao.ordens": {
    module: "producao",
    title: "Ordens de Produção: a fila da fábrica",
    summary:
      "Esta lista reúne todas as ordens de produção e diz, de cada uma, o produto, o cliente, a versão da formulação, a quantidade planejada, se o material já está reservado e em que situação a ordem está. Nada se executa aqui: liberar, separar, consumir e concluir acontecem dentro da ordem.",
    concepts: [
      {
        term: "Situação",
        text: "Rascunho, Planejada, Liberada, Em produção, Concluída ou Cancelada. É a situação que diz o que ainda dá para fazer dentro da ordem.",
      },
      {
        term: "Formulação",
        text: "A versão da receita que a ordem executa. Congelada no planejamento — a lista mostra a versão da ordem, não a ativa do produto.",
      },
      {
        term: "Quantidade",
        text: "O planejado. Produzido e restante vivem dentro da ordem, porque mudam a cada apontamento.",
      },
      {
        term: "Materiais",
        text: "Se as necessidades já viraram reserva. Reservado é compromisso: o material continua na prateleira até o consumo.",
      },
      {
        term: "Nova OP",
        text: "Cria uma ordem em rascunho: produto e quantidade. Ordem que nasce de um pedido de cliente já vem ligada a ele pelo plano de atendimento.",
      },
    ],
    flow: [
      { label: "Filtrar" },
      { label: "Ler a situação" },
      { label: "Abrir a ordem", tone: "accent" },
      { label: "Executar na ordem" },
    ],
    steps: [
      { label: "Filtrar", detail: "Por situação, ou buscando por código, produto ou cliente. Exportar leva o recorte filtrado." },
      { label: "Ler a situação", detail: "Rascunho e planejada ainda aceitam mudança; liberada e em produção têm material comprometido; concluída e cancelada são histórico." },
      { label: "Abrir a ordem", detail: "A linha abre a ordem completa: necessidades, reservas, separação, consumo, apontamento e custo." },
      { label: "Executar na ordem", detail: "Planejar, liberar, consumir, apontar e concluir são ações da própria ordem, cada uma com a sua regra." },
    ],
    notes: [
      "Ordem em produção não pode mais ser cancelada: material físico já saiu.",
      "A lista de Picking / Consumo mostra só as ordens liberadas ou em produção, com o progresso da conferência e da baixa.",
      "Quantidade produzida não aparece aqui: ela é a soma dos apontamentos, dentro da ordem.",
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
        term: "Fonte do custo de cada material",
        text: "De onde veio o custo unitário de cada material, escolhido automaticamente na melhor fonte disponível, nesta ordem: compra real dos últimos 30 dias, compra real dos últimos 90 dias, última compra real, oferta válida de fornecedor, referência manual de custo. Sem nenhuma delas o custo é desconhecido — e desconhecido nunca vira zero.",
      },
      {
        term: "Referência manual e referência forçada",
        text: "A referência manual é uma estimativa declarada no cadastro do item, usada só quando não há compra real nem oferta válida. “Referência manual forçada” é a exceção: no cálculo de referência alguém escolheu usar a referência mesmo havendo fonte melhor — ou havendo ofertas válidas sem preferencial —, com motivo registrado. O cálculo salvo guarda a fonte usada e a que teria sido usada.",
      },
      {
        term: "Qualidade do custo",
        text: "O veredito sobre de onde vieram os preços: completo com referências reais de compra, completo com estimativas (oferta de fornecedor ou referência manual), parcial quando há custo não informado, ou sem custo conhecido. É ela que diz o quanto o número sustenta uma decisão.",
      },
      {
        term: "Precificação vigente",
        text: "Quando existe precificação ativa para o produto, a tela mostra a faixa cuja quantidade bate EXATAMENTE com a simulada: preço, margem de contribuição, comissão e markup, já calculados pela precificação. Faixa não se interpola: 750 entre 500 e 1.000 não tem preço vigente.",
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
          "Cada material recebe a melhor fonte disponível: compra real de 30 dias, depois 90 dias, última compra real, oferta válida de fornecedor e, por último, a referência manual do item.",
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
      "A qualidade da referência diz de onde vieram os preços: tudo de compra real, com estimativas (oferta de fornecedor ou referência manual), parcial ou sem custo. É ela que diz o quanto o número sustenta uma decisão.",
      "Várias ofertas válidas de fornecedor sem preferencial não escolhem sozinhas nem caem para a referência manual: o material aparece como “Ofertas disponíveis · seleção necessária”, sem custo, até alguém definir o preferencial ou forçar outra fonte no cálculo.",
      "Referência manual de custo é estimativa, nunca compra: entra só quando não há fonte melhor, e um cálculo que a usa é classificado como completo com estimativas. Forçá-la mesmo havendo compra real é decisão registrada no cálculo de referência, com motivo, autor e data — a composição mostra “Referência manual forçada” e o cálculo mostra o resto.",
      "Custo é uma coisa, preço é outra: a precificação vigente aparece ao lado para comparar, e a margem mostrada vem calculada de lá — esta tela não refaz a conta.",
      "Simular é ler: abrir a tela ou mudar a quantidade não cria cálculo, não grava preço e não persiste nada. Congelar continua sendo trabalho do cálculo salvo.",
      "A data de referência escolhe o cálculo em vigor até aquele dia — um cálculo salvo depois não poderia ser conhecido antes.",
    ],
  },
  "faturamento.lista": {
    module: "comercial",
    title: "Faturamento: a fila de expedições e os documentos",
    summary:
      "Esta tela tem duas tabelas. A primeira, Aguardando faturamento, é a fila: expedições confirmadas que ainda não têm documento de faturamento ativo. A segunda, Documentos de faturamento, é o histórico: cada faturamento com expedição, pedido, cliente, quantidade, valor, situação e data de emissão. Preparar faturamento é a única ação daqui — e ela cria um rascunho, não emite nada.",
    concepts: [
      {
        term: "Aguardando faturamento",
        text: "Expedições confirmadas sem faturamento ativo. Cada expedição é faturada por um documento de cada vez; cancelar o rascunho devolve a expedição para esta fila.",
      },
      {
        term: "Preparar faturamento",
        text: "Cria o rascunho a partir da expedição, com as linhas do que realmente saiu. Emitir, alterar preço e cancelar acontecem dentro do documento.",
      },
      {
        term: "Status",
        text: "Rascunho, Emitido ou Cancelado. Só rascunho aceita edição; emitido é histórico.",
      },
      {
        term: "Valor",
        text: "O valor do documento: subtotal das linhas menos o desconto acordado no pedido. Só existe quando todas as linhas têm preço — faltando alguma, o documento mostra valores incompletos em vez de somar parte, e o faturamento quantitativo continua válido.",
      },
      {
        term: "Filtros",
        text: "Busca por código, situação e cliente valem para a tabela de documentos. Exportar leva o recorte filtrado.",
      },
    ],
    flow: [{ label: "Expedição confirmada" }, { label: "Preparar", tone: "accent" }, { label: "Documento" }, { label: "Emitir" }],
    steps: [
      { label: "Expedição confirmada", detail: "Entra na fila sozinha: é a saída física que gera a obrigação de faturar." },
      { label: "Preparar", detail: "Cria o rascunho e abre o documento. A expedição sai da fila enquanto o rascunho existir." },
      { label: "Documento", detail: "Conferir linhas, preço acordado e preço faturado; alterar preço exige motivo e perfil." },
      { label: "Emitir", detail: "Torna o documento somente leitura. Não emite Nota Fiscal e não movimenta estoque." },
    ],
    notes: [
      "Faturamento nasce de expedição confirmada — nunca de pedido, reserva ou produção.",
      "Não é Nota Fiscal nem Contas a Receber: nenhum documento fiscal ou título é gerado aqui.",
      "Cancelar um rascunho devolve a expedição à fila; cancelar um emitido registra o cancelamento e o histórico continua visível.",
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
    text: "Quantidade já comprometida — com ordens de produção liberadas e ainda não consumidas, ou, no produto acabado, com pedidos de cliente. Continua no estoque físico, mas ninguém mais pode contar com ela.",
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
    text: "Teor real do insumo. Com 80% de pureza é preciso pesar mais para entregar a mesma quantidade ativa. Registrar a pureza NÃO aplica a correção sozinha: marque “Calcular quantidade física” e a caixa da pureza para o sistema corrigir. Sem isso ela fica registrada para auditoria e a quantidade informada é usada como está — importante quando a quantidade já vem corrigida de origem, porque corrigir de novo dobraria o ajuste. Vazio significa desconhecida, e nunca é lida como 100%.",
  },
  "formulacao.overage": {
    module: "producao",
    label: "Overage",
    text: "Excesso declarado de propósito, para compensar perda de processo ou de validade. Nunca entra no que é declarado ao cliente. Como a pureza, só é aplicado quando explicitamente marcado — preencher registra, marcar autoriza.",
  },
  "formulacao.equivalenteEstoque": {
    module: "producao",
    label: "Equivalente estoque",
    text: "Quanto a receita pede por unidade acabada, na unidade de estoque do item, ANTES dos ajustes — já com a base da linha aplicada (numa fórmula por dose, já multiplicado pelas doses da embalagem). Ao lado dele, o físico por unidade é o mesmo número depois dos ajustes que ESTE componente autoriza, e é o físico que a ordem de produção reserva e consome. O valor fica congelado na ordem: ativar uma versão nova da formulação não recalcula ordem que já existe.",
  },
} satisfies Record<string, HelpHint>;

