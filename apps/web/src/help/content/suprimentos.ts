import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Compras e estoque — ordens de compra, recebimentos, item × fornecedor,
 * posição, lotes, movimentações, inventário físico e materiais de clientes.
 *
 * Cada tópico começa dizendo O QUE A TELA É, não onde ela fica numa cadeia
 * maior: quem abre a ajuda está olhando para uma tabela agora e precisa
 * entender aquelas colunas antes de saber para onde o documento vai depois.
 * Por isso a ordem é sempre a mesma — o que é, o vocabulário, o caminho, o
 * que costuma pegar.
 *
 * Os mesmos termos aparecem em `suprimentosHints` para o ⓘ ao lado da
 * coluna: em `concepts` eles são apresentados juntos, que é como se aprende
 * a tela na primeira vez; no ⓘ eles são consultados um a um, que é como se
 * tira a dúvida no meio da operação.
 */
export const suprimentosTopics = {
  /* ------------------------------------------------------------------ *
   * COMPRAS
   * ------------------------------------------------------------------ */

  "compras.ordens": {
    module: "compras",
    title: "A ordem de compra é um compromisso, não estoque",
    summary:
      "Uma ordem de compra é o documento do que a Veridi pediu a um fornecedor: itens, quantidades, unidade e o preço previsto de cada linha. Enquanto é rascunho ela não vale para nada no sistema; confirmada, o que ainda não chegou passa a aparecer como Em Compra na posição de estoque. Quem transforma esse compromisso em material é o recebimento, nunca a própria ordem.",
    concepts: [
      {
        term: "Rascunho × confirmada",
        text: "Rascunho é livre e não conta em nenhuma conta de estoque. Confirmar é o ato que transforma a ordem em compromisso: ela trava, entra em Em Compra e passa a esperar recebimento.",
      },
      {
        term: "Quantidade em aberto",
        text: "O que foi pedido na linha menos tudo o que já foi recebido nela, somando todos os recebimentos. É esse saldo que vira Em Compra e é ele que limita o próximo recebimento.",
      },
      {
        term: "Em Compra",
        text: "Material já pedido e ainda não chegado. É previsão de planejamento: não cobre reserva, não libera produção e não conta como disponível em lugar nenhum.",
      },
      {
        term: "Preço previsto",
        text: "O preço negociado no momento em que a linha foi escrita, congelado no documento. É referência comercial: nunca vira custo real do material sozinho.",
      },
      {
        term: "Parcialmente recebida",
        text: "Chegou parte do pedido e o resto continua em aberto. É situação normal de operação, não erro — a ordem só fecha quando todas as linhas atingem a quantidade pedida.",
      },
      {
        term: "Origem",
        text: "De onde a ordem nasceu: escrita à mão, ou gerada como rascunho a partir de uma falta detectada num pedido de cliente. Gerar rascunho não compra nada; confirmar continua sendo um ato à parte.",
      },
      {
        term: "Dica comercial da linha",
        text: "Sob cada item aparece o que Item × Fornecedor sabe daquele par: homologação, se é preferencial, preço de referência e pedido mínimo. É orientação para quem digita o preço previsto — não trava e não preenche sozinha.",
      },
      {
        term: "Recebimentos",
        text: "Na ordem confirmada, o bloco lista cada recebimento já feito contra ela: data, nota fiscal, itens, quantidade e lotes gerados. É por ele que se lê quanto ainda está em aberto.",
      },
      {
        term: "Total e previsão",
        text: "Na lista, Total é a soma dos preços previstos das linhas e Previsão é a data de entrega prevista. Os dois são compromisso comercial, não custo nem estoque.",
      },
    ],
    flow: [
      {
        label: "Rascunho",
        detail:
          "Fornecedor, datas, itens, quantidades e preço previsto são livres. Rascunho não conta como Em Compra, não reserva nada e não aparece em nenhuma conta de estoque.",
      },
      {
        label: "Confirmar",
        detail:
          "Precisa de pelo menos uma linha. Ao confirmar, fornecedor e cada item são revalidados na hora — ativo, do tipo certo, sem repetição — e a ordem trava: só previsão de entrega e observações continuam editáveis.",
      },
      {
        label: "Em compra",
        detail:
          "A partir daqui o saldo em aberto de cada linha aparece como Em Compra. É informação de planejamento: não cobre reserva, não libera produção e não conta como disponível.",
        tone: "warn",
      },
      {
        label: "Recebimento",
        detail:
          "Cada recebimento abate o saldo em aberto da linha. Enquanto sobrar quantidade em aberto em qualquer linha, a ordem fica Parcialmente recebida — e isso é normal, não é erro.",
        tone: "accent",
      },
      {
        label: "Recebida",
        detail:
          "A ordem só fecha quando TODAS as linhas atingem a quantidade pedida. O status é recalculado a partir dos recebimentos reais, nunca marcado à mão.",
      },
    ],
    notes: [
      "Só matéria-prima e embalagem entram numa ordem de compra. Produto acabado não se compra: ele é produzido.",
      "A unidade da linha é sempre a unidade de estoque do item — não existe escolha de unidade na ordem.",
      "O mesmo item não pode aparecer em duas linhas da mesma ordem. Some as quantidades numa linha só.",
      "Depois de qualquer recebimento a ordem não pode mais ser cancelada: cancelar só vale para rascunho, ou para ordem confirmada que ainda não recebeu nada. Cancelar exige motivo e não apaga a ordem.",
      "Fornecedor e item ficam congelados na ordem no momento em que a linha é escrita: renomear o item no cadastro depois não muda como a ordem já confirmada é lida.",
      "Não existe fechamento por saldo: uma ordem com sobra em aberto que nunca vai chegar continua parcialmente recebida.",
      "Material do cliente nunca entra em ordem de compra da Veridi. Falta de material do cliente se resolve com nova remessa dele.",
      "Na ordem confirmada, “Salvar previsão e observações” é a única edição que sobra; “Receber materiais” leva ao recebimento; Imprimir é leitura.",
    ],
  },

  "compras.recebimentos": {
    module: "compras",
    title: "Receber é o ato que faz o material existir no estoque",
    summary:
      "Um recebimento é o registro do que entrou fisicamente na Veridi. Cada linha recebida cria um lote interno e uma entrada no histórico de movimentações — antes disso o material não existe para o sistema. O recebimento nasce confirmado e vira histórico: não há rascunho, não há edição e não há exclusão.",
    concepts: [
      {
        term: "Recebimento",
        text: "O documento do que entrou fisicamente, com data, nota fiscal e origem. Não existe rascunho: criar já é confirmar, e depois disso ele é só leitura.",
      },
      {
        term: "Linha recebida",
        text: "Um item, uma quantidade e um lote. Cada linha cria exatamente um lote interno — dois lotes do fornecedor na mesma entrega são duas linhas, não uma.",
      },
      {
        term: "Lote do fornecedor × lote interno",
        text: "O primeiro é a identificação que veio na embalagem; o segundo é o código que a Veridi cria (LT-…). Os dois ficam guardados, e um nunca substitui o outro.",
      },
      {
        term: "Recebimento parcial",
        text: "Chegou menos que o pedido. É normal: o saldo continua em aberto na ordem e pode chegar depois, em outro recebimento e com outro lote do fornecedor.",
      },
      {
        term: "Custo efetivo de aquisição",
        text: "O valor realmente pago por unidade de estoque. Sempre opcional — o recebimento nunca falha por falta de custo, e vazio quer dizer desconhecido, nunca zero.",
      },
      {
        term: "Material do cliente",
        text: "Entrada sem ordem de compra e sem fornecedor, com um cliente como proprietário do lote. Exige item com controle de lote e não recebe custo de aquisição da Veridi.",
      },
      {
        term: "Situação inicial do lote",
        text: "Item que exige liberação da Qualidade ou laudo entra como Aguardando liberação: o material já está no estoque físico, mas ainda não conta como disponível.",
      },
      {
        term: "Localização",
        text: "Onde o lote foi guardado, informado na linha do recebimento. É texto de apoio à separação; não é regra de estoque.",
      },
      {
        term: "Usar preço da OC",
        text: "Atalho de digitação: copia o preço previsto da ordem para o campo de custo efetivo. É você quem afirma que o valor praticado foi esse — o sistema nunca assume o preço da ordem como custo sozinho.",
      },
      {
        term: "Lista de recebimentos",
        text: "Todos os recebimentos, com origem (compra ou material do cliente), ordem de compra, fornecedor ou cliente, data e itens. A situação é sempre Confirmado: recebimento não tem rascunho nem outra situação.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Recebimento de OC",
        when: "O material foi comprado pela Veridi e chegou contra uma ordem de compra confirmada que ainda tem saldo em aberto.",
        steps: [
          {
            label: "Escolher a OC",
            detail:
              "Só aparecem ordens confirmadas com quantidade ainda em aberto. Sem ordem de compra, este não é o seu caminho.",
          },
          {
            label: "Nota e data",
            detail:
              "Data do recebimento, nota fiscal e referência de documento. É o que amarra a entrada ao papel que veio junto com o material.",
          },
          {
            label: "Quanto chegou",
            detail:
              "Quantidade por linha. Receber menos que o pedido é normal — o restante continua em aberto e pode chegar em outro recebimento. Receber mais que o saldo em aberto é recusado.",
            tone: "accent",
          },
          {
            label: "Lote do fornecedor",
            detail:
              "Obrigatório para item com controle de lote, e gravado como veio na embalagem. Validade é obrigatória quando o item controla validade, e não pode ser anterior à data do recebimento.",
          },
          {
            label: "Lote interno",
            detail:
              "O sistema cria a própria identidade do lote (LT-…) e guarda as duas: a do fornecedor e a interna. Cada linha recebida gera um lote.",
          },
          {
            label: "Custo efetivo",
            detail:
              "Opcional: o recebimento nunca falha por falta de custo. Informe só o valor realmente praticado — o preço previsto da OC nunca é assumido como custo real.",
          },
          {
            label: "Entrada no estoque",
            detail:
              "Confirmar grava tudo de uma vez: o lote, a entrada no histórico de movimentações e o novo saldo em aberto da ordem. Falhando qualquer parte, nada é gravado.",
          },
        ],
      },
      {
        name: "Fluxo B · Material do cliente, sem OC",
        when: "O material pertence ao cliente e foi enviado por ele. Não houve compra: não existe fornecedor nem ordem de compra para apontar.",
        steps: [
          {
            label: "Cliente proprietário",
            detail:
              "Obrigatório, e o cliente precisa estar ativo. É ele que define o dono do lote — sem dono não há a quem segregar o material.",
          },
          {
            label: "Documento de remessa",
            detail:
              "Nota fiscal não é obrigatória aqui: material do cliente costuma chegar com remessa ou declaração de conteúdo, não com NF de compra.",
          },
          {
            label: "Itens recebidos",
            detail:
              "Só matéria-prima e embalagem. Item sem controle de lote é recusado: saldo de terceiro que não se distingue do estoque da Veridi é pior que saldo nenhum.",
            tone: "warn",
          },
          {
            label: "Lote do cliente",
            detail:
              "O lote interno nasce com aquele cliente como proprietário e sem fornecedor — quem enviou é o dono, e dono não é fornecedor. O campo Lote do fabricante guarda a identificação que veio na embalagem, e Validade e Localização entram na mesma linha.",
          },
          {
            label: "Estoque segregado",
            detail:
              "O material entra no estoque físico com o dono explícito e só pode ser usado em ordens de produção do próprio cliente. Não recebe custo de aquisição da Veridi.",
            tone: "accent",
          },
        ],
      },
      {
        name: "Fluxo C · Consultar um recebimento",
        when: "O recebimento já existe e a pergunta é o que entrou, em qual lote, com qual custo e com qual documento.",
        steps: [
          {
            label: "Dados do recebimento",
            detail:
              "Origem, ordem de compra ou cliente proprietário, fornecedor, data, nota fiscal, referência de documento, quem criou e observações. Nada disso se edita.",
          },
          {
            label: "Itens recebidos",
            detail:
              "Por linha: quantidade, lote do fornecedor, validade, localização, o lote interno gerado — com “Imprimir etiqueta” — a situação do laudo, o preço previsto da ordem e o custo efetivo.",
          },
          {
            label: "Definir ou atualizar custo",
            tone: "accent",
            detail:
              "A única ação da tela: informa ou corrige o custo efetivo de aquisição da linha. É custeio — nunca muda quantidade, lote ou estoque. Em linha de material do cliente aparece Não aplicável.",
          },
          {
            label: "Documentos do recebimento",
            detail:
              "Anexos como a nota fiscal. O laudo do material fica no lote, não aqui.",
          },
          {
            label: "Imprimir",
            detail: "O documento de recebimento sai do que está gravado.",
          },
        ],
      },
    ],
    notes: [
      "Lote do fornecedor e lote interno são identidades diferentes e as duas ficam guardadas. O código interno nunca substitui a identificação que o fornecedor deu.",
      "Recebimento parcial é o normal, não um problema: a ordem continua aberta pelo saldo, e o resto entra em outro recebimento — inclusive com outro lote do fornecedor.",
      "Receber acima do saldo em aberto da linha é recusado, e a conta considera tudo o que já foi recebido antes naquela linha, em qualquer recebimento.",
      "O recebimento é histórico e não tem edição nem exclusão. Diferença descoberta depois se resolve no estoque, por ajuste com motivo, nunca reescrevendo o recebimento.",
      "A única coisa que se corrige depois é o custo efetivo de aquisição da linha: é custeio, não recebimento físico — nunca muda quantidade, item, lote ou fornecedor, e nunca mexe no estoque.",
      "Item que exige liberação da Qualidade OU laudo entra como Aguardando liberação. O material já está no estoque físico, mas não conta como disponível antes da decisão da Qualidade.",
      "Material do cliente não recebe custo de aquisição da Veridi: não é custo esquecido, é propriedade de terceiro — a ação de informar custo nem existe nessas linhas.",
    ],
  },

  "compras.itemFornecedor": {
    module: "compras",
    title: "Quem pode fornecer e a que preço são duas decisões diferentes",
    summary:
      "Item × Fornecedor é a relação entre um item e um fornecedor — uma por par, com o código que o fornecedor usa para aquele item. Ela guarda duas coisas que costumam ser confundidas: a homologação, que é decisão da Qualidade e vale item a item, e as ofertas de preço, que são registro comercial de Compras. Nenhuma das duas decide a outra, e preço aqui nunca é custo.",
    concepts: [
      {
        term: "Relação Item × Fornecedor",
        text: "Uma por par de item e fornecedor. É nela que vivem o código do fornecedor, a homologação e as ofertas — nunca no cadastro do item, que teria de escolher um fornecedor só.",
      },
      {
        term: "Código no fornecedor",
        text: "Como o fornecedor chama o item na nota e no pedido dele. Não é o código interno da Veridi nem o código da planilha antiga.",
      },
      {
        term: "Homologação",
        text: "Se este fornecedor está aprovado para ESTE item. Pendente é ausência de decisão, não recusa; só Bloqueado é recusa deliberada. Aprovar e bloquear é da Qualidade.",
      },
      {
        term: "Preferencial",
        text: "O fornecedor de primeira escolha do item: no máximo um, e só entre os aprovados e ativos. É decisão comercial e não quer dizer mais barato.",
      },
      {
        term: "Oferta",
        text: "Preço, unidade do preço, moeda e vigência, gravados juntos e imutáveis. Corrigir qualquer um deles é registrar outra oferta — o histórico não se reescreve.",
      },
      {
        term: "Oferta vigente",
        text: "A mais recente que já começou a valer e ainda não expirou. Preço sem vigência é referência histórica e nunca é apresentado como preço de hoje.",
      },
      {
        term: "Coluna Referências",
        text: "Quantas ofertas já foram registradas nesta relação, vigentes ou não. É a mesma coisa que “ofertas” no detalhe — o histórico de preços do par.",
      },
      {
        term: "Filtros",
        text: "Homologação, fornecedor, família do item, só preferenciais e só ativas. A lista chega filtrada por item quando se vem do cadastro do item ou da ordem de compra.",
      },
      {
        term: "Pedido mínimo",
        text: "Quanto o fornecedor exige por pedido. É recomendação, não bloqueio. Vazio quer dizer não informado, nunca zero.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Homologar quem pode fornecer",
        when: "A pergunta é se este fornecedor pode fornecer ESTE item.",
        steps: [
          {
            label: "Relação",
            detail:
              "Uma relação por fornecedor e item. O código no fornecedor é o dele — não é o código interno da Veridi nem o da planilha antiga.",
          },
          {
            label: "Pendente",
            detail:
              "Pendente é ausência de homologação, não recusa. Só Bloqueado é uma decisão deliberada de não usar aquele fornecedor para aquele item.",
            tone: "warn",
          },
          {
            label: "Homologar",
            detail:
              "Aprovar e bloquear são decisão da Qualidade, item a item: fornecedor aprovado para uma matéria-prima não fica aprovado para todas. Devolver para pendente é administrativo, e Compras também pode.",
            tone: "accent",
          },
          {
            label: "Histórico",
            detail:
              "Toda mudança de homologação fica registrada com autor e data, e o histórico nunca é reescrito.",
          },
          {
            label: "Ativa ou inativa",
            detail:
              "Relação inativa não é o mesmo que fornecedor não homologado: ele pode continuar aprovado e simplesmente ter parado de vender aquele item.",
          },
        ],
      },
      {
        name: "Fluxo B · Registrar preço e pedido mínimo",
        when: "A relação já existe e o que muda é a condição comercial.",
        steps: [
          {
            label: "Oferta",
            detail:
              "Preço, unidade do preço, moeda e vigência entram juntos como uma oferta. Preço desconhecido não vira zero: significa que não há oferta.",
          },
          {
            label: "Vigente",
            detail:
              "Preço atual é a oferta mais recente que já entrou em vigência e ainda não expirou. Preço importado da planilha antiga não tem vigência e aparece marcado como referência.",
          },
          {
            label: "Corrigir é nova oferta",
            detail:
              "Preço, pedido mínimo, moeda ou vigência errados viram uma oferta nova. A oferta anterior é imutável e continua no histórico.",
            tone: "accent",
          },
          {
            label: "Pedido mínimo",
            detail:
              "Opcional. Vazio quer dizer não informado, nunca zero. Quando informado, precisa de quantidade e unidade juntas.",
          },
          {
            label: "Preferencial",
            detail:
              "No máximo um por item, e só entre os aprovados e ativos. Bloquear ou desativar a relação tira o preferencial; ficar mais caro que outro nunca tira.",
          },
        ],
      },
    ],
    notes: [
      "Preço aqui é referência comercial do fornecedor. O custo real do material continua vindo do recebimento — uma oferta nunca vira custo do item nem da formulação.",
      "Preferencial não quer dizer mais barato. O sistema nunca troca o preferencial sozinho porque outra oferta ficou menor.",
      "Pedido mínimo é recomendação, não bloqueio. Quando as unidades são comparáveis, a sugestão de compra usa o maior entre a falta e o mínimo; quando não são, o mínimo aparece na unidade original e nada é ajustado sozinho.",
      "Moedas são registradas, não convertidas: não existe conversão de câmbio nem comparação de 'mais barato' entre moedas diferentes.",
      "A unidade do preço precisa ser compatível com a unidade de estoque do item — R$/g e R$/kg conversam, R$/g e R$/un não.",
      "Falta de homologação não trava compra: item sem fornecedor cadastrado continua mostrando a falta, e ordem de compra manual continua possível para emergência, amostra ou fornecedor novo.",
      "A sugestão de compra só oferece relações aprovadas e ativas, e nunca escolhe sozinha entre vários aprovados quando não há preferencial.",
    ],
  },

  /* ------------------------------------------------------------------ *
   * ESTOQUE
   * ------------------------------------------------------------------ */

  "estoque.posicao": {
    module: "estoque",
    title: "Nenhum saldo desta tela é digitado — todos são calculados",
    summary:
      "A Posição de Estoque é a leitura do saldo de cada item em quatro números que não querem dizer a mesma coisa: Físico, Reservado, Disponível e Em Compra. Nenhum deles é uma coluna guardada no banco nem um valor que alguém digitou — o físico é a soma do histórico de movimentações, e os outros três saem dele. É por isso que não existe, em lugar nenhum, uma tela para editar saldo.",
    concepts: [
      {
        term: "Físico",
        text: "O que existe no depósito agora, somando todos os lotes do item — inclusive lote bloqueado, aguardando liberação ou vencido. É a prateleira, não o que está livre para usar.",
      },
      {
        term: "Reservado",
        text: "A parte do físico já comprometida: matéria-prima e embalagem reservadas por ordens de produção liberadas e ainda não consumidas; produto acabado reservado a pedidos de cliente. Continua no depósito, mas ninguém mais pode contar com ela.",
      },
      {
        term: "Disponível",
        text: "Físico menos reservado, contando só lote liberado, com laudo aprovado quando exigido, e não vencido. É o único número que responde 'posso usar?'.",
      },
      {
        term: "Somente com estoque e FO-02",
        text: "O filtro esconde itens zerados; a busca e o tipo recortam a lista. “Imprimir posição (FO-02)” leva o mesmo recorte para o papel, para conferência no depósito.",
      },
      {
        term: "Em Compra",
        text: "Saldo em aberto de ordens de compra já confirmadas. É previsão: não cobre reserva, não libera produção e só vira estoque no recebimento.",
      },
      {
        term: "Movimentação",
        text: "Cada entrada ou saída registrada. O físico é a soma delas — não existe coluna de saldo que alguém possa acertar por cima.",
      },
      {
        term: "Causa da indisponibilidade",
        text: "Quando o físico é maior que o disponível, a linha diz o porquê a partir dos lotes reais: vencido, bloqueado, aguardando Qualidade, laudo pendente ou reservado.",
      },
    ],
    flow: [
      {
        label: "Movimentações",
        detail:
          "Toda entrada e toda saída viram um lançamento no histórico: recebimento, produção, consumo, expedição, amostra, ajuste, perda. O saldo é a soma desses lançamentos.",
      },
      {
        label: "Físico",
        detail:
          "O que existe no depósito agora, somando todos os lotes do item — inclusive lote bloqueado, aguardando liberação ou vencido. É a prateleira, não o que está livre.",
      },
      {
        label: "Reservado",
        detail:
          "A parte do físico já comprometida — com ordens de produção liberadas ou, no produto acabado, com pedidos de cliente. Continua no depósito, mas ninguém mais pode contar com ela.",
      },
      {
        label: "Disponível",
        detail:
          "O que sobra para uso: físico menos reservado, contando só lote liberado, com laudo em dia quando exigido, e não vencido. Lote aguardando a Qualidade contribui zero aqui, mesmo estando no físico.",
        tone: "accent",
      },
      {
        label: "Em Compra",
        detail:
          "Saldo em aberto de ordens de compra já confirmadas. É previsão: não cobre reserva, não libera produção e não vira disponível antes do recebimento.",
        tone: "warn",
      },
    ],
    notes: [
      "Físico maior que disponível quase nunca é erro. A linha diz a causa a partir dos lotes reais — vencido, bloqueado, aguardando Qualidade, laudo pendente ou reservado — e cada lote conta em uma causa só.",
      "Liberar ou bloquear um lote muda o disponível e nunca o físico: material bloqueado continua existindo no depósito e não some do estoque.",
      "O estoque nunca fica negativo em silêncio: saída de ajuste e perda são conferidas contra o disponível antes de gravar, e a operação é recusada se passar.",
      "Rascunho de ordem de compra não conta como Em Compra. Só ordem confirmada com saldo em aberto entra nessa coluna.",
      "Esta visão mostra tudo o que está fisicamente na Veridi, inclusive material de clientes. Ver não é poder usar: quem filtra por dono é a alocação — para o saldo separado por cliente, use Materiais de Clientes.",
      "Para entender por que um item está assim, abra o item: o detalhe mostra o saldo lote a lote, com validade, situação e localização.",
    ],
  },

  "estoque.item": {
    module: "estoque",
    title: "Corrigir saldo e escolher lote — nenhum dos dois se faz na mão",
    summary:
      "O detalhe do item mostra de onde vem o saldo daquele item: a disponibilidade em quatro números e, quando o item controla lote, o saldo aberto lote a lote, com validade, situação e localização. Daqui saem as duas ações que mais se tentava fazer fora do sistema — corrigir uma diferença e decidir de qual lote tirar material. Nenhuma das duas edita saldo.",
    concepts: [
      {
        term: "Saldo por lote",
        text: "O mesmo saldo do item, aberto lote a lote. Em item com controle de lote é aí que a conta acontece de verdade: cada lote tem a sua validade, a sua situação e o seu disponível.",
      },
      {
        term: "Ajuste × perda",
        text: "Ajuste de entrada e de saída corrigem uma diferença de registro; perda registra material que deixou de existir. Os três exigem motivo e viram lançamento no histórico.",
      },
      {
        term: "FEFO",
        text: "First Expire, First Out: o lote que vence primeiro sai primeiro. É a ordem padrão de consumo para item que controla validade.",
      },
      {
        term: "FIFO",
        text: "A alternativa para item com lote e sem controle de validade: sai primeiro o que foi recebido primeiro, pela data do recebimento.",
      },
      {
        term: "Lote elegível",
        text: "O que pode ser usado: liberado, com laudo aprovado quando exigido, não vencido e com saldo ainda livre. O que outra ordem já reservou não entra.",
      },
      {
        term: "Sugestão de alocação",
        text: "Cálculo feito sob demanda. Não reserva, não baixa estoque e não deixa registro — é recomendação para quem vai separar o material.",
      },
      {
        term: "Referência de custo",
        text: "Custo unitário do item vindo apenas de custos efetivos de aquisição informados nos recebimentos. Preço de ordem de compra nunca entra nessa conta.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Corrigir uma diferença de saldo",
        when: "O saldo do sistema não bate com o que existe fisicamente, e a diferença já tem explicação. Se ela veio de uma contagem, o caminho é o Inventário Físico.",
        steps: [
          {
            label: "Ajustar estoque",
            detail:
              "Abre o lançamento de ajuste. Não existe campo de saldo para digitar por cima em lugar nenhum do sistema.",
          },
          {
            label: "Tipo e lote",
            detail:
              "Ajuste de entrada, ajuste de saída ou perda. Em item com controle de lote a correção é sempre de um lote — nunca do item inteiro.",
          },
          {
            label: "Motivo",
            detail:
              "Obrigatório nos três tipos. É ele que explica a diferença para quem for auditar depois.",
          },
          {
            label: "Saída limitada",
            detail:
              "Ajuste de saída e perda não passam do disponível: nunca comem estoque que uma ordem de produção liberada está contando.",
            tone: "warn",
          },
          {
            label: "Lançamento novo",
            detail:
              "O ajuste entra como um lançamento novo e o saldo passa a refletir a soma. A movimentação original continua lá, intacta e visível.",
            tone: "accent",
          },
        ],
      },
      {
        name: "Fluxo B · Escolher de qual lote tirar",
        when: "Você precisa saber qual lote consumir primeiro para uma quantidade — antes de separar material, ou para conferir o que a produção vai pegar.",
        steps: [
          {
            label: "Quantidade necessária",
            detail: "Informe quanto precisa. O cálculo é feito na hora, sob demanda.",
          },
          {
            label: "Estratégia",
            detail:
              "Item que controla validade usa FEFO: vence primeiro, sai primeiro. Item com lote e sem validade usa FIFO, pela data de recebimento mais antiga. Item sem controle de lote não tem lote a escolher.",
          },
          {
            label: "Lotes elegíveis",
            detail:
              "Entra só lote liberado, com laudo aprovado quando exigido, não vencido e com saldo livre. Aguardando liberação, bloqueado ou vencido fica de fora, e o que outra ordem reservou não conta.",
          },
          {
            label: "Sugestão",
            detail:
              "É recomendação e cálculo: não reserva, não baixa estoque e não cria movimentação. Fechar a tela não deixa rastro nenhum.",
            tone: "accent",
          },
          {
            label: "Falta",
            detail:
              "Quando os lotes elegíveis não cobrem a quantidade, a diferença aparece como falta. Material em compra não entra nessa conta.",
            tone: "warn",
          },
        ],
      },
    ],
    notes: [
      "Diferença encontrada em contagem tem tela própria: o Inventário Físico calcula a diferença e gera o ajuste sozinho, sem você escolher tipo nem quantidade.",
      "FEFO é o padrão, não uma trava: outro lote liberado e com saldo continua podendo ser usado, e a troca fica registrada na separação da ordem de produção.",
      "O saldo por lote aparece ordenado por validade só para leitura. A regra operacional é a da sugestão, que também considera situação do lote e reserva.",
      "Reservado não é físico: reservar compromete o disponível e não movimenta estoque. A baixa acontece no consumo da ordem de produção.",
      "A referência de custo mostrada aqui vem apenas de custos efetivos de aquisição informados. Preço de ordem de compra nunca entra.",
    ],
  },

  "estoque.movimentacoes": {
    module: "estoque",
    title: "O histórico não se corrige — corrige-se com um lançamento novo",
    summary:
      "As Movimentações são o histórico de estoque: cada entrada e cada saída de um item, lote a lote, com data, tipo, documento de origem e motivo quando a operação exige. É a única fonte de saldo do sistema — o físico de qualquer item ou lote é a soma destes lançamentos. Por isso nada aqui é editado nem apagado.",
    concepts: [
      {
        term: "Movimentação",
        text: "Um lançamento de entrada ou saída de um item, em um lote, numa data. É a única fonte de saldo: o físico é a soma algébrica das movimentações.",
      },
      {
        term: "Tipo",
        text: "O que aconteceu e em que sentido: recebimento, produção, consumo, expedição, amostra, ajuste, perda, saldo de abertura. A quantidade é sempre positiva — quem dá o sinal é o tipo.",
      },
      {
        term: "Origem",
        text: "O documento que gerou o lançamento — recebimento, ordem de produção, expedição, amostra, ajuste manual ou inventário físico. Não existe lançamento avulso.",
      },
      {
        term: "Motivo",
        text: "A justificativa exigida em ajuste, perda e inventário físico. Recebimento, consumo e expedição não têm motivo: o documento de origem já explica o movimento.",
      },
      {
        term: "Saldo de abertura",
        text: "A entrada única da migração de dados, uma vez por lote. Não veio de compra nem de produção — é o estoque que já existia quando o sistema começou.",
      },
      {
        term: "Ajuste de correção",
        text: "O único jeito de corrigir: um lançamento novo, com motivo. O lançamento errado continua visível, porque é a sequência inteira que explica o saldo de hoje.",
      },
      {
        term: "Usuário",
        text: "Quem lançou o movimento, lido da sessão de quem executou a operação — nunca digitado. Com o documento de origem, é a outra metade da resposta de auditoria.",
      },
      {
        term: "Entrada / Saída",
        text: "O sentido do lançamento, dito pelo tipo. A quantidade é sempre positiva; a coluna é que diz se o saldo subiu ou desceu.",
      },
    ],
    flow: [
      {
        label: "Origem",
        detail:
          "Todo lançamento vem de uma operação real: recebimento, consumo de produção, produção de acabado, expedição, amostra, ajuste, perda ou saldo de abertura da migração.",
      },
      {
        label: "Lançamento",
        detail:
          "Item, lote, quantidade, data, tipo e o documento que originou o movimento. Motivo é gravado onde a operação exige — ajuste, perda e contagem.",
      },
      {
        label: "Entrada ou saída",
        detail:
          "A quantidade é sempre positiva; quem diz o sentido é o tipo do movimento. Não existe quantidade negativa gravada.",
      },
      {
        label: "Saldo",
        detail:
          "O físico do item e do lote é a soma algébrica destes lançamentos, calculada na hora — nunca uma coluna guardada que alguém possa acertar.",
        tone: "accent",
      },
      {
        label: "Correção",
        detail:
          "Erro descoberto depois vira um lançamento novo de ajuste, com motivo. O lançamento errado continua visível: é isso que permite reconstruir o que aconteceu.",
        tone: "warn",
      },
    ],
    notes: [
      "Nada aqui é editável, por decisão de projeto. Quem procura o botão de corrigir está procurando o ajuste, no detalhe do item, ou o Inventário Físico.",
      "Liberar, bloquear ou desbloquear lote não aparece nesta lista: essas decisões mudam a disponibilidade, não o estoque físico.",
      "Reserva também não aparece: reservar compromete quantidade para uma ordem, não movimenta estoque. Quem movimenta é o consumo.",
      "Cada lançamento carrega o documento que o originou — recebimento, ordem de compra, ordem de produção, expedição, amostra — e é por ele que se refaz o caminho do material.",
      "O filtro por tipo oferece todos os tipos de movimento; a busca por item ou lote recorta o histórico. Exportar leva o recorte filtrado.",
    ],
  },

  "estoque.inventario": {
    module: "estoque",
    title: "A contagem física não sobrescreve o saldo",
    summary:
      "Inventário Físico é a conferência entre o que foi contado no depósito e o que o sistema tem. Você informa o escopo — um item e, quando ele controla lote, um lote — e a quantidade contada; o sistema calcula a diferença e, havendo diferença, cria um ajuste rastreável por ela. Em nenhum momento o saldo é digitado por cima.",
    concepts: [
      {
        term: "Contagem",
        text: "A conferência de um saldo identificável: um item e, quando ele controla lote, um lote. Não existe contagem de um item inteiro por cima dos lotes.",
      },
      {
        term: "Saldo do sistema",
        text: "O físico que o sistema tem para aquele escopo, mostrado só para comparação. Confirmar a contagem não escreve por cima dele.",
      },
      {
        term: "Contagem física",
        text: "O que foi efetivamente contado no depósito, na unidade de estoque do item.",
      },
      {
        term: "Diferença",
        text: "Contado menos sistema. Diferente de zero, o motivo passa a ser obrigatório e um ajuste é criado; igual a zero, nada é gravado.",
      },
      {
        term: "Ajuste gerado",
        text: "O lançamento de entrada ou de saída criado pela diferença. É ele, e não a contagem, que muda o saldo — e ele fica no histórico.",
      },
      {
        term: "Contagem cega",
        text: "Folha impressa sem o saldo do sistema, para que quem conta não seja induzido pelo número esperado.",
      },
    ],
    flow: [
      {
        label: "Escopo",
        detail:
          "Um item, e o lote quando o item tem controle de lote. A contagem é sempre de um saldo identificável.",
      },
      {
        label: "Saldo do sistema",
        detail:
          "Exibido antes da contagem, para comparação. Para contar sem ver esse número, imprima a folha em modo Contagem cega: ela omite o saldo do sistema.",
      },
      {
        label: "Contagem física",
        detail: "O que foi efetivamente contado no depósito, na unidade de estoque do item.",
      },
      {
        label: "Diferença",
        detail:
          "Calculada na hora. Havendo diferença, o motivo passa a ser obrigatório — é ele que explica o ajuste para quem auditar.",
        tone: "warn",
      },
      {
        label: "Ajuste",
        detail:
          "Confirmar cria um ajuste de entrada ou de saída pela diferença, e ele passa a fazer parte do histórico. Contagem que confere não cria movimento nenhum.",
        tone: "accent",
      },
    ],
    notes: [
      "Contagem igual ao sistema não gera lançamento e não pede motivo: não há o que auditar quando não houve diferença.",
      "Contagem abaixo do que está reservado é recusada. O sistema não cancela reserva por conta própria — reveja as reservas da ordem de produção antes de ajustar.",
      "O saldo do sistema nunca é editado. O que muda o saldo é o ajuste gerado, e ele fica no histórico com data e motivo.",
      "A folha de contagem (FO-01) existe para o operador levar ao depósito e voltar com os números; a versão cega omite o saldo do sistema justamente para não induzir a contagem.",
      "Contagem é sempre do saldo físico. Ela não muda a situação de qualidade do lote nem o seu proprietário.",
    ],
  },

  "estoque.materiaisCliente": {
    module: "estoque",
    title: "Material do cliente está aqui, mas não é da Veridi",
    summary:
      "A Veridi fabrica para terceiros, e parte do material dentro da fábrica pertence ao cliente. Esta tela é o saldo desse material, lote a lote, com o cliente proprietário sempre visível. Proprietário é característica do lote e é diferente de fornecedor: fornecedor é quem vendeu, proprietário é de quem o material é.",
    concepts: [
      {
        term: "Proprietário",
        text: "De quem o material é: Veridi ou um cliente. Definido na criação do lote e imutável — não existe troca de dono nem transferência de propriedade.",
      },
      {
        term: "Proprietário × fornecedor",
        text: "Fornecedor é quem vendeu; proprietário é de quem o material é. Lote do cliente costuma não ter fornecedor nenhum, e isso não é cadastro incompleto.",
      },
      {
        term: "Lote externo",
        text: "O lote do fabricante que produziu o material, como veio na embalagem. Continua ao lado do lote interno que a Veridi criou.",
      },
      {
        term: "Segregação",
        text: "Material do cliente só é elegível para ordens de produção do próprio cliente. Estoque da Veridi não substitui, e material do cliente A nunca cobre a ordem do cliente B.",
      },
      {
        term: "Remessa",
        text: "A entrada desse material: sem ordem de compra e sem fornecedor, com documento de remessa em vez de nota fiscal de compra.",
      },
      {
        term: "Sem custo Veridi",
        text: "Material do cliente não tem custo de aquisição da Veridi. Não é custo desconhecido a preencher: é propriedade de terceiro, e a ação de informar custo não existe.",
      },
    ],
    flow: [
      {
        label: "Entra sem compra",
        detail:
          "Chega por remessa do cliente, sem ordem de compra e sem fornecedor. Nota fiscal não é obrigatória — costuma vir remessa ou declaração de conteúdo.",
      },
      {
        label: "Lote com dono",
        detail:
          "Cada lote nasce com um cliente proprietário. Item sem controle de lote é recusado no recebimento: saldo de terceiro que não se distingue do da Veridi é pior que saldo nenhum.",
        tone: "warn",
      },
      {
        label: "Estoque segregado",
        detail:
          "O saldo aparece no estoque físico com o dono explícito. Ver não é poder usar: o saldo agregado nunca é apresentado como se fosse da Veridi.",
      },
      {
        label: "Só o próprio dono",
        detail:
          "Componente com fornecimento do cliente enxerga apenas lotes daquele cliente. Estoque da Veridi não substitui, e material do cliente A nunca cobre a ordem do cliente B.",
        tone: "accent",
      },
      {
        label: "Falta",
        detail:
          "Falta de material do cliente se resolve com nova remessa dele. Não vira sugestão de compra nem ordem de compra da Veridi, e Em Compra da Veridi nunca a cobre.",
        tone: "warn",
      },
    ],
    notes: [
      "Proprietário é diferente de fornecedor. O lote do cliente costuma não ter fornecedor nenhum, e o lote externo continua sendo o do fabricante que produziu o material.",
      "Não existe transferência de propriedade: o dono é definido na criação do lote e é imutável. Ajuste e contagem física nunca mudam o proprietário.",
      "Material do cliente não tem custo de aquisição da Veridi. Isso não é custo desconhecido — é propriedade de terceiro, e a ação de informar custo não existe nessas linhas.",
      "Ordem de produção com componente do cliente não é liberada sem cliente definido: sem ele não existe estoque elegível para aquele componente.",
      "Qualidade, validade, reserva e FEFO valem igual para material do cliente. O dono é mais um critério de elegibilidade, não uma exceção às outras regras.",
      "A Posição de Estoque continua mostrando esse material no total físico do item, com o dono explícito — a separação por dono acontece na alocação e aqui.",
      "Reservado e Disponível seguem as mesmas regras do estoque próprio: reserva de ordem de produção do cliente compromete o lote, e a Qualidade decide se ele conta como disponível. O filtro por qualidade recorta a lista por essa situação, e o código do lote abre o lote.",
    ],
  },

  "estoque.lotes": {
    module: "estoque",
    title: "O lote é a unidade de rastreabilidade — e ele tem duas identidades",
    summary:
      "Lote é a menor porção de material que a Veridi consegue rastrear: o estoque é controlado por item E lote, e é pelo lote que se responde de onde o material veio e para onde ele foi. Cada lote tem um código interno criado pela Veridi (LT-…), que nunca muda, e ao lado dele a identificação de quem produziu o material — o lote do fornecedor, ou o número de lote da produção. As duas ficam guardadas, e uma nunca substitui a outra.",
    concepts: [
      {
        term: "Lote",
        text: "A menor porção de material que a Veridi rastreia. O estoque é controlado por item e lote — é por ele que se responde de onde o material veio e para onde foi.",
      },
      {
        term: "Lote interno",
        text: "O código que a Veridi cria (LT-…), imutável. É ele que está no QR, nas movimentações e na rastreabilidade.",
      },
      {
        term: "Lote do fornecedor",
        text: "A identificação externa, gravada como veio na embalagem. Nunca é substituída pelo código interno — as duas identidades convivem.",
      },
      {
        term: "Lote Veridi (produção)",
        text: "Em lote produzido, o número comercial informado pela produção, ao lado do código interno. É ele que vai para o rótulo.",
      },
      {
        term: "Proprietário",
        text: "Veridi ou um cliente. Imutável, e diferente de fornecedor — quem vendeu não é necessariamente de quem o material é.",
      },
      {
        term: "Situação",
        text: "Aguardando liberação, Disponível ou Bloqueado — decisão da Qualidade. Vencido não é decisão de ninguém: é calculado pela data de validade.",
      },
      {
        term: "Laudo (CoA)",
        text: "Situação documental do certificado do lote, independente da operacional. Anexar não aprova, e aprovar não libera o lote. Rejeitar exige motivo e bloqueia o lote na mesma ação.",
      },
      {
        term: "Expedições",
        text: "No detalhe do lote: para onde ele foi. Só expedição confirmada saiu de fato do estoque; rascunho de expedição não aparece como saída.",
      },
      {
        term: "Custo de aquisição × custo material da produção",
        text: "Dois blocos com regras diferentes. Custo de aquisição é o custo efetivo informado no recebimento deste lote — a fonte real de custo; material do cliente não tem. Custo material da produção, em lote produzido, é derivado do que a ordem de produção realmente consumiu — nunca de oferta de fornecedor.",
      },
      {
        term: "Destino comercial",
        text: "Por que o lote produzido existe: o pedido e o cliente que a ordem de produção atende. Por onde ele saiu está em Expedições.",
      },
      {
        term: "Rastreabilidade",
        text: "Genealogia real, nos dois sentidos: de quais lotes de material este lote veio, e em quais ordens de produção e amostras ele foi utilizado. Consumo e produção efetivos — nunca reserva nem sugestão.",
      },
      {
        term: "Auditoria",
        text: "Quem criou, liberou, bloqueou ou desbloqueou o lote, e quando. Lido da sessão de quem agiu.",
      },
      {
        term: "Escanear QR",
        text: "A leitura de um lote pela câmera ou pelo código digitado, em tela própria. É consulta: mostra o lote e a situação e leva ao detalhe — não movimenta, não libera nem reserva.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Lote recebido",
        when: "O lote veio de um recebimento — compra da Veridi ou remessa do cliente.",
        steps: [
          {
            label: "Recebimento",
            detail:
              "Cada linha recebida cria um lote. Um recebimento com três linhas cria três lotes, cada um com o seu lote de fornecedor.",
          },
          {
            label: "Duas identidades",
            detail:
              "O código interno é a identidade operacional, usada no QR e nas movimentações; o lote do fornecedor é a identidade externa, gravada como veio. Nenhuma substitui a outra.",
            tone: "accent",
          },
          {
            label: "Proprietário",
            detail:
              "Veridi ou um cliente. Definido na criação e imutável — não existe troca de dono depois.",
          },
          {
            label: "Situação inicial",
            detail:
              "Item que exige liberação da Qualidade ou que exige laudo nasce Aguardando liberação. Os demais nascem Disponível.",
            tone: "warn",
          },
          {
            label: "Saldo",
            detail:
              "A quantidade recebida é o que chegou naquele recebimento — não é o saldo de hoje. O saldo atual vem do histórico de movimentações.",
          },
        ],
      },
      {
        name: "Fluxo B · Lote produzido",
        when: "O lote saiu de uma ordem de produção da Veridi.",
        steps: [
          {
            label: "Apontamento",
            detail:
              "O apontamento de produção da ordem cria o lote do produto acabado, com data de produção e validade.",
          },
          {
            label: "Lote Veridi",
            detail:
              "Ao lado do código interno fica o número de lote comercial informado pela produção — é ele que vai para o rótulo.",
          },
          {
            label: "Dono Veridi",
            detail:
              "Lote produzido é sempre da Veridi, mesmo quando a receita consumiu material enviado pelo cliente.",
          },
          {
            label: "Rastreabilidade",
            detail:
              "O lote acabado guarda de quais lotes de material ele veio e para quais expedições foi — origem e destino, sem misturar as duas coisas.",
            tone: "accent",
          },
        ],
      },
      {
        name: "Fluxo C · Decisão da Qualidade",
        when: "O lote está aguardando liberação, ou precisa ser tirado de uso.",
        steps: [
          {
            label: "Aguardando liberação",
            detail:
              "O lote existe no estoque físico e não conta como disponível. Não entra em FEFO, reserva, separação nem consumo enquanto estiver assim.",
            tone: "warn",
          },
          {
            label: "Laudo (CoA)",
            detail:
              "Situação documental, independente da operacional. Anexar o documento não aprova, e aprovar o laudo não libera o lote: são duas decisões separadas.",
            tone: "accent",
          },
          {
            label: "Liberar",
            detail:
              "Ato explícito da Qualidade, com autor e data. Item que exige laudo só é liberado com o laudo aprovado — não há exceção por perfil.",
          },
          {
            label: "Bloquear",
            detail:
              "Tira o lote de uso, com motivo obrigatório. O material continua no estoque físico; o que muda é o disponível.",
          },
          {
            label: "Desbloquear",
            detail:
              "Reabre a decisão: o lote volta para Aguardando liberação, nunca direto para Disponível. Liberar continua sendo um ato à parte, e o bloqueio anterior fica no registro.",
          },
        ],
      },
    ],
    notes: [
      "Lote interno e lote do fornecedor são campos diferentes e ambos ficam guardados. O código interno nunca substitui a identificação do fornecedor, e o QR do lote aponta só para o código interno.",
      "Vencido é calculado pela data de validade — não é um status que alguém escreve nem uma rotina noturna que roda.",
      "Liberar, bloquear e desbloquear não geram movimentação de estoque: mudam o disponível, nunca o físico.",
      "Lote com quantidade reservada não pode ser bloqueado: uma ordem de produção liberada está contando com ele, e nada é cancelado em cascata.",
      "Liberar, bloquear e desbloquear são decisões da Qualidade. Para os outros perfis a ação não aparece, e no lugar dela fica o motivo.",
      "Quantidade recebida (ou produzida) não é saldo. O saldo atual é sempre a soma das movimentações do lote.",
      "Lote não é excluído. Um lote criado por engano se resolve zerando o saldo por ajuste, com motivo, e bloqueando o lote.",
      "A lista filtra por proprietário (Veridi ou cliente) e por situação, e cada linha oferece Imprimir etiqueta (QR) e Abrir. Exportar leva o recorte filtrado.",
      "Imprimir etiqueta e imprimir a rastreabilidade são leituras: nenhuma impressão altera o lote.",
    ],
  },
  "estoque.escanear": {
    module: "estoque",
    title: "Escanear lote: consulta pela leitura, nada mais",
    summary:
      "Esta tela lê um lote pelo QR da etiqueta ou pelo código digitado e mostra o que ele é: código, situação, item, validade e localização. É consulta pura — não movimenta estoque, não libera, não bloqueia e não reserva. Conferência de separação e de expedição acontecem dentro da ordem de produção e da expedição, não aqui.",
    concepts: [
      {
        term: "Ler QR ou digitar",
        text: "A câmera lê o QR da etiqueta; sem câmera, o código interno digitado faz o mesmo. Os dois caminhos consultam o mesmo lote.",
      },
      {
        term: "Lote encontrado",
        text: "Código, situação de Qualidade (inclusive Vencido), item, validade e localização. A situação é a que decide se o material pode ser usado.",
      },
      {
        term: "Lote não encontrado",
        text: "Código que não existe ou etiqueta de outra coisa — o QR de amostra tem prefixo próprio e nunca abre um lote.",
      },
      {
        term: "Ver detalhes",
        text: "Abre o lote completo: saldo, qualidade, laudo, rastreabilidade e as ações da Qualidade.",
      },
    ],
    flow: [
      { label: "Ler ou digitar" },
      { label: "Consultando" },
      { label: "Lote encontrado", tone: "accent" },
      { label: "Ver detalhes ou escanear outro" },
    ],
    steps: [
      { label: "Ler ou digitar", detail: "Aponte a câmera para o QR ou digite o código interno do lote." },
      { label: "Consultando", detail: "A tela busca o lote pelo código. Nada é gravado." },
      { label: "Lote encontrado", detail: "Situação, item, validade e localização. Vencido aparece marcado." },
      { label: "Ver detalhes ou escanear outro", detail: "Abrir o lote completo, ou voltar à leitura para o próximo." },
    ],
    notes: [
      "Ler não movimenta, não libera, não reserva e não confere separação: essas ações vivem na ordem de produção, na expedição e no lote.",
      "O QR aponta só para o código interno do lote — nunca para quantidade, situação ou dono, que mudam.",
      "Etiqueta de amostra não abre lote: amostra tem QR próprio.",
    ],
  },
} satisfies Record<string, HelpTopic>;

/**
 * Conceitos de COLUNA e de CAMPO de compras e estoque.
 *
 * São os mesmos termos que `concepts` apresenta em conjunto no painel — aqui
 * eles são consultados um a um, no lugar em que a dúvida nasce. "Disponível"
 * lido como "tem em estoque" é a origem de metade dos chamados, e o
 * cabeçalho da tabela é onde essa leitura acontece.
 */
export const suprimentosHints = {
  "estoque.fisico": {
    module: "estoque",
    label: "Físico",
    text: "O que existe no depósito agora, somando todos os lotes do item — inclusive lote bloqueado, aguardando liberação ou vencido. É a soma das movimentações, nunca um saldo digitado.",
  },
  "estoque.reservado": {
    module: "estoque",
    label: "Reservado",
    text: "A parte do físico já comprometida — com ordens de produção liberadas e ainda não consumidas, ou, no produto acabado, com pedidos de cliente. Continua no depósito, mas ninguém mais pode contar com ela.",
  },
  "estoque.disponivel": {
    module: "estoque",
    label: "Disponível",
    text: "Físico menos reservado, contando só lote liberado, com laudo aprovado quando exigido, e não vencido. Lote aguardando a Qualidade contribui zero aqui mesmo estando no físico.",
  },
  "estoque.emCompra": {
    module: "estoque",
    label: "Em Compra",
    text: "Saldo em aberto de ordens de compra já confirmadas. É previsão: não cobre reserva, não libera produção e só vira estoque no recebimento. Rascunho de OC não entra.",
  },
  "estoque.loteInterno": {
    module: "estoque",
    label: "Lote interno",
    text: "A identidade que a Veridi cria para o material (LT-…). É ela que aparece no QR, nas movimentações e na rastreabilidade, e ela nunca muda.",
  },
  "estoque.loteFornecedor": {
    module: "estoque",
    label: "Lote do fornecedor",
    text: "A identificação que veio na embalagem — do fornecedor, ou do fabricante quando o material é do cliente. É gravada como veio e nunca é substituída pelo código interno.",
  },
  "estoque.proprietario": {
    module: "estoque",
    label: "Proprietário",
    text: "De quem o material é: Veridi ou um cliente. É diferente de fornecedor, que é quem vendeu. Definido na criação do lote e imutável — material do cliente só serve a ordens do próprio cliente.",
  },
  "estoque.situacaoLote": {
    module: "estoque",
    label: "Situação do lote",
    text: "Aguardando liberação, Disponível ou Bloqueado — decisão da Qualidade. Vencido não é decisão: é calculado pela data de validade. Só lote disponível e não vencido conta como estoque disponível.",
  },
  "estoque.laudo": {
    module: "estoque",
    label: "Laudo (CoA)",
    text: "Situação do certificado do lote, independente da situação operacional. Anexar não aprova e aprovar não libera o lote. Lote que exige laudo e não o tem aprovado não entra em FEFO, reserva, separação nem consumo.",
  },
  "estoque.recebido": {
    module: "estoque",
    label: "Recebido",
    text: "Quanto chegou naquele recebimento — não é o saldo de hoje. O saldo atual do lote vem da soma das movimentações.",
  },
  "estoque.saldoSistema": {
    module: "estoque",
    label: "Saldo sistema",
    text: "O físico que o sistema tem para o escopo contado, no momento da contagem. É só comparação: confirmar não escreve por cima dele, gera um ajuste pela diferença.",
  },
  "estoque.diferenca": {
    module: "estoque",
    label: "Diferença",
    text: "Contagem física menos saldo do sistema. Diferente de zero, o motivo passa a ser obrigatório e um ajuste é criado. Igual a zero, nenhum movimento é gerado.",
  },
  "estoque.origemMovimento": {
    module: "estoque",
    label: "Origem",
    text: "O documento que gerou o lançamento — recebimento, ordem de produção, expedição, amostra, ajuste manual, inventário físico ou abertura da migração. Não existe lançamento sem origem.",
  },
  "estoque.motivoMovimento": {
    module: "estoque",
    label: "Motivo",
    text: "A justificativa exigida em ajuste, perda e inventário físico. Recebimento, consumo e expedição não têm motivo: o documento de origem já explica o movimento.",
  },
  "compras.saldoAberto": {
    module: "compras",
    label: "Em aberto",
    text: "Quanto da linha ainda não foi recebido: pedido menos tudo o que já entrou, em todos os recebimentos. É esse saldo que aparece como Em Compra e é ele que limita o próximo recebimento.",
  },
  "compras.precoPrevisto": {
    module: "compras",
    label: "Preço previsto (OC)",
    text: "O preço negociado quando a ordem foi escrita, congelado no documento. É referência: nunca é assumido como custo real do material.",
  },
  "compras.custoEfetivo": {
    module: "compras",
    label: "Custo efetivo de aquisição",
    text: "O custo realmente praticado por unidade de estoque, informado no recebimento. Sempre opcional — vazio quer dizer desconhecido, nunca zero. É ele, e só ele, que alimenta o custo do material.",
  },
  "compras.homologacao": {
    module: "compras",
    label: "Homologação",
    text: "Se este fornecedor está aprovado para ESTE item — decisão da Qualidade, item a item. Pendente é ausência de decisão, não recusa; só Bloqueado é recusa.",
  },
  "compras.preferencial": {
    module: "compras",
    label: "Preferencial",
    text: "O fornecedor de primeira escolha para o item: no máximo um, e só entre os aprovados e ativos. É decisão comercial e não quer dizer mais barato — nunca muda sozinho por preço.",
  },
  "compras.precoOferta": {
    module: "compras",
    label: "Preço",
    text: "O preço da oferta vigente: a mais recente que já entrou em vigência e não expirou. Preço sem vigência é referência histórica e nunca é preço de hoje. Corrigir um preço é registrar outra oferta.",
  },
  "compras.pedidoMinimo": {
    module: "compras",
    label: "Pedido mínimo",
    text: "A quantidade mínima que o fornecedor aceita vender. É recomendação, não bloqueio: eleva a sugestão de compra quando as unidades são comparáveis. Vazio quer dizer não informado, nunca zero.",
  },
} satisfies Record<string, HelpHint>;
