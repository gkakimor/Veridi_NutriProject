import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Cadastros, gestão, qualidade e administração.
 *
 * São as telas que uma pessoa nova abre primeiro, e as que mais sofrem com
 * nome parecido: item e produto, cliente e projeto, laudo e liberação,
 * recurso e uso do recurso. Por isso cada tópico começa dizendo O QUE a
 * entidade é — e o que ela não é — antes de qualquer fluxo.
 */
export const cadastrosTopics = {
  "item.comoFunciona": {
    module: "cadastros",
    title: "Item de estoque: o que o sistema controla de verdade",
    summary:
      "Item é a coisa física que o estoque acompanha: uma matéria-prima, um material de embalagem ou um produto acabado. Tudo o que tem saldo, lote, validade e movimentação no sistema é um item — não é o produto, não é a formulação, não é o pedido. O item não sabe de cliente, receita nem preço de venda; ele sabe em que unidade é comprado, se controla lote e se precisa passar pela Qualidade.",
    concepts: [
      {
        term: "Tipo do item",
        text: "Matéria-prima (MP), material de embalagem (ME) ou produto acabado (PA). O tipo define o prefixo do código e os padrões de rastreabilidade. Produto acabado não se cria por aqui: ele nasce junto com o Produto.",
      },
      {
        term: "Unidade",
        text: "A unidade em que o item é comprado, estocado e movimentado — uma só por item. É para ela que a formulação converte a quantidade declarada antes de reservar e baixar material.",
      },
      {
        term: "Controla lote",
        text: "Cada recebimento gera um lote interno próprio, com código e QR, e o lote do fornecedor passa a ser obrigatório na entrada. Sem isso o item tem saldo único e o consumo não aponta para nenhuma entrada específica.",
      },
      {
        term: "Controla validade",
        text: "Exige data de vencimento no recebimento e muda a ordem de sugestão de lote: com validade o sistema sugere primeiro o que vence antes (FEFO); sem validade, o mais antigo que entrou (FIFO).",
      },
      {
        term: "Requer liberação da Qualidade × Exige CoA",
        text: "São dois controles independentes. Liberação é a decisão de usar o material, tomada na tela do lote. CoA é o laudo do fornecedor, analisado em Qualidade. Um item pode exigir os dois, um só, ou nenhum — e exigir laudo nunca é deduzido de exigir liberação.",
      },
      {
        term: "Fonte × nutriente declarado",
        text: "Fonte é a forma química que entra de fato (cloridrato de tiamina). Nutriente declarado é o nome que aparece na tabela nutricional (vitamina B1). Os dois convivem porque quase nunca são a mesma palavra, e os dois entram na busca.",
      },
      {
        term: "Pureza padrão",
        text: "Teor do insumo, só como valor inicial de novas formulações. Em branco significa pureza desconhecida — nunca 100%. A pureza que vale para o cálculo é a congelada no componente da versão da formulação, e mudar este campo não reescreve nenhuma receita existente.",
      },
      {
        term: "Histórico operacional",
        text: "O item passa a ter histórico assim que aparece em uma linha de ordem de compra, um recebimento, um lote ou uma movimentação de estoque. A partir daí os campos estruturais travam.",
      },
      {
        term: "Custo de referência",
        text: "A referência manual de custo do item: uma estimativa declarada por gente, com valor, unidade, válido desde e observação. Não é compra, recebimento nem valor pago. Alterar cria uma nova vigência e a anterior fica no histórico; cálculos já salvos não mudam.",
      },
      {
        term: "Fonte selecionada hoje",
        text: "Ao lado da referência, a fonte que o cálculo de custo e o CMV usariam agora para este item, escolhida automaticamente nesta ordem: compra real dos últimos 30 dias, compra real dos últimos 90 dias, última compra real, oferta válida de fornecedor, referência manual. A referência só entra quando nada de prioridade maior existe — é assim que se lê a diferença entre referência e compra real.",
      },
      {
        term: "Fornecedores",
        text: "Na edição, a lista de quem fornece o item, com homologação, preferencial, preço e pedido mínimo — só leitura. Cadastrar relação, homologar e registrar preço acontecem em Compras › Item × Fornecedor.",
      },
    ],
    flows: [
      {
        name: "A. Cadastrar um item",
        when: "Em Novo item de estoque — a tela de criação, que abre esta mesma ajuda.",
        steps: [
          {
            label: "Tipo e unidade",
            tone: "accent",
            detail:
              "As duas decisões que mais custam depois: elas travam no primeiro uso operacional. Escolha a unidade em que o item é realmente comprado e contado.",
          },
          {
            label: "Nome",
            detail:
              "O nome que a fábrica usa. Ele é independente do nome do produto, mesmo quando o item nasceu de um.",
          },
          {
            label: "Classificação industrial",
            detail:
              "Fonte, nutriente declarado, família e pureza padrão. Tudo opcional, e é o que a formulação lê como ponto de partida.",
          },
          {
            label: "Rastreabilidade",
            detail:
              "Controla lote, controla validade, requer liberação da Qualidade e exige CoA. O tipo escolhido já traz um padrão para os três primeiros; a exigência de laudo começa desligada sempre.",
          },
          {
            label: "Custo de referência inicial",
            detail:
              "Opcional: uma estimativa de custo por unidade do item, para o CMV existir antes da primeira compra. Em branco é “Não informado”, nunca R$ 0,00. Códigos (código de barras) também são opcionais.",
          },
          {
            label: "Criar item",
            detail:
              "O código sai da sequência oficial do tipo (MP ou ME) e não é digitado nem editado depois. O item nasce ativo.",
          },
        ],
      },
      {
        name: "B. O que muda depois do primeiro uso",
        when: "Quando o item já foi comprado, recebido ou movimentado.",
        steps: [
          {
            label: "Primeiro uso",
            detail:
              "Uma linha de ordem de compra, um recebimento, um lote ou uma movimentação já dá histórico ao item. Não é preciso mais do que isso.",
          },
          {
            label: "Campos travados",
            tone: "warn",
            detail:
              "Tipo, unidade, controla lote e controla validade deixam de ser editáveis. Mudá-los reescreveria o significado de quantidade já registrada.",
          },
          {
            label: "O que segue editável",
            detail:
              "Nome, classificação industrial, liberação da Qualidade, exigência de CoA, código de barras e o custo de referência continuam ajustáveis a qualquer momento.",
          },
          {
            label: "Inativar",
            detail:
              "Tira o item das próximas compras, relações com fornecedor e receitas novas, sem apagar nada. O histórico permanece e a reativação é possível.",
          },
        ],
      },
    ],
    notes: [
      'Tipo, unidade, controla lote e controla validade travam assim que o item tem histórico operacional. A mensagem é literal: "este campo não pode ser alterado porque o item já possui histórico operacional". Reenviar o mesmo valor não é bloqueado — só a mudança é.',
      "Produto acabado não é criado nesta tela. Ele nasce junto com o cadastro de Produtos, já com controla lote, controla validade e liberação da Qualidade ligados — esse é o padrão seguro, e alterá-lo depois é decisão consciente aqui.",
      "Liberação da Qualidade e exigência de CoA são copiadas para o lote no momento em que ele nasce. Ligar ou desligar o controle depois vale só para lotes novos: nenhum lote existente muda de situação por causa disso.",
      "Pureza em branco é pureza desconhecida, não 100%. Nenhuma correção é aplicada quando ela está vazia, e o valor daqui é apenas o ponto de partida de uma formulação nova.",
      "Subtipo de embalagem só existe para material de embalagem. Informá-lo em outro tipo é recusado com \"subtipo de embalagem só se aplica a itens do tipo Material de embalagem\".",
      "Inativar não exclui e não interrompe o que já está em curso: recebimento contra ordem de compra existente, consumo de produção e saldo em estoque continuam funcionando. O que o item deixa de aceitar é vínculo novo — nova relação com fornecedor, nova linha de ordem de compra, novo produto acabado e novo componente de formulação.",
      "Referência manual de custo é estimativa: entra na seleção automática só depois de compra real e oferta válida. Existindo compra real nos últimos 30 dias, é a compra que vale — a referência fica registrada e a tela do item diz que ela não está sendo usada. Material do cliente nunca ganha custo Veridi, mesmo com referência no item.",
      "Na lista, a busca casa código, nome ou código de barras; os filtros são por tipo e por situação. Marcar linhas permite exportar só o que foi marcado; Exportar CSV sem marcação leva o recorte filtrado.",
    ],
  },

  "produto.comoFunciona": {
    module: "cadastros",
    title: "Produto: o registro comercial e o item acabado que ele carrega",
    summary:
      "Produto é o que a Veridi fabrica e vende: nome, cliente, perfil industrial, formulação, custo e preço. Ele não é o registro de estoque — todo produto tem um item de produto acabado (PA) ligado a ele, e é esse item que de fato tem lote, validade e saldo. E também não é o projeto: projeto é a negociação que existe antes de o produto existir.",
    concepts: [
      {
        term: "Item de produto acabado",
        text: "O item PA que representa este produto no estoque. Na criação ele é gerado junto, sempre com controle de lote, validade e liberação da Qualidade ligados — esse é o padrão do produto acabado da casa. Exigir laudo é a única dessas marcações que se escolhe aqui. A relação é de um para um: um item acabado pertence a um único produto.",
      },
      {
        term: "Ciclo de vida",
        text: "Em desenvolvimento ou Aprovado. Em desenvolvimento o produto é entidade técnica: aceita formulação, estrutura de custos, cálculo e precificação, mas é recusado em pedido de cliente e em ordem de produção — e, por consequência, nunca chega a expedição nem a faturamento.",
      },
      {
        term: "Ativo × em desenvolvimento",
        text: "São coisas diferentes, e a tela mostra as duas. Inativo é produto retirado de circulação, e aparece na coluna Status. Em desenvolvimento é produto que ainda não foi liberado para a operação comercial, e aparece como etiqueta ao lado do nome.",
      },
      {
        term: "Cliente do produto",
        text: "Obrigatório na criação e o cliente precisa estar ativo. Ele marca de quem é o produto e sustenta a leitura de propriedade em toda a cadeia. Trocar o cliente depois é bloqueado assim que existe pedido, ordem de produção ou orçamento com este produto, ou quando ele nasceu de um projeto.",
      },
      {
        term: "Formulação ativa",
        text: "A versão da receita em vigor para este produto. É ela que a produção executa e que o custo e o preço leem. Vazio significa que ainda não existe versão ativa.",
      },
      {
        term: "Perfil industrial",
        text: "Forma farmacêutica, apresentação, dose, público-alvo, cápsulas por dose e doses por embalagem. Cadastro descritivo: nenhuma regra regulatória depende dele nesta fase, e quem manda no cálculo por dose é a própria versão da formulação.",
      },
      {
        term: "Unidades por caixa",
        text: "Diferente do resto do perfil: este número entra no custo e no preço, porque caixa de embalagem é inteira. Ele é congelado na estrutura de custos ativada, e é o valor congelado que vale para cálculos antigos.",
      },
      {
        term: "Lote mínimo",
        text: "Menor quantidade de produção declarada, sempre na unidade do item de produto acabado. É referência: sugere a base da estrutura de custos e faz a precificação avisar quando uma faixa fica abaixo dele. Nunca bloqueia uma ordem de produção.",
      },
    ],
    flows: [
      {
        name: "A. Cadastrar um produto direto",
        when: "Produto que não passa pelo funil de projeto.",
        steps: [
          {
            label: "Cliente",
            tone: "accent",
            detail:
              "Obrigatório, e precisa estar ativo. É o vínculo mais difícil de corrigir depois: assim que existe pedido, ordem, orçamento ou origem em projeto, ele trava.",
          },
          {
            label: "Nome e unidade",
            detail:
              "A unidade de estoque informada é a do item de produto acabado que será criado junto — a unidade em que o produto é contado no estoque.",
          },
          {
            label: "Perfil industrial",
            detail:
              "Forma, apresentação, dose, vida útil, lote mínimo, unidades por caixa. Tudo opcional e ajustável depois.",
          },
          {
            label: "Item acabado",
            detail:
              "Criado automaticamente na mesma operação, com código PA da sequência oficial e o nome do produto. Na edição ele aparece como fato, não como campo a trocar.",
          },
          {
            label: "Aprovado de saída",
            detail:
              "Produto criado aqui já nasce aprovado e operacional. Quem nasce em desenvolvimento é o produto criado por um projeto.",
          },
        ],
      },
      {
        name: "B. Do produto ao preço",
        when: "O que se abre a partir do produto, em outras telas.",
        steps: [
          {
            label: "Formulação",
            detail: "A receita em versões. Só a versão ativa vale para produzir e custear.",
          },
          {
            label: "Estrutura de custos",
            detail:
              "Declara sobre qual versão se calcula, qual base de produção e quais recursos, energia e premissas entram.",
          },
          {
            label: "Cálculo",
            detail: "Congela o custo de uma data. É o documento que a precificação lê.",
          },
          {
            label: "Precificação",
            detail:
              "Margem e faixas por quantidade, sempre a partir do cálculo congelado.",
          },
          {
            label: "Operação",
            tone: "accent",
            detail:
              "Pedido de cliente e ordem de produção. Só para produto aprovado e ativo.",
          },
        ],
      },
    ],
    notes: [
      'Produto em desenvolvimento é recusado ao entrar em pedido de cliente, ao confirmar o pedido, ao abrir ordem de produção e ao gerar pedido a partir de proposta aceita, com a mensagem "está em desenvolvimento e ainda não pode ser usado em operação comercial ou industrial". Formulação, custo e preço continuam liberados de propósito.',
      "Não existe botão de aprovar no cadastro do produto. Quem promove um produto de desenvolvimento para aprovado é a aprovação do projeto que o criou, e essa aprovação não tem volta.",
      "Produto criado direto nesta tela nasce aprovado. É o caminho para produto que não passou por projeto.",
      "Trocar o cliente de um produto já usado é recusado, com o motivo dito na mensagem: já existe pedido, ordem de produção ou orçamento, ou o produto nasceu de um projeto. O caminho nesse caso é cadastrar um produto para o outro cliente.",
      "O item de produto acabado nasce com o nome do produto e segue independente a partir daí: renomear o produto depois não reescreve o nome do item nem o histórico do estoque.",
      "Vida útil em meses é a sugestão de validade quando um lote é produzido. Ela não altera lotes já existentes, e a data digitada no apontamento sempre vence a sugestão.",
      "Código de lote comercial do produto e sufixo do cliente só alimentam a sugestão da máscara de lote na ordem de produção. Não são o código do lote interno e não são obrigatórios.",
      "Inativar um produto não apaga nada e não pede confirmação de nada em aberto. A partir daí ele é recusado em nova linha de pedido, na confirmação de pedido e em nova ordem de produção.",
      "Documentos (arte de rótulo, ficha técnica) e Observações são referência: anexar e anotar não mudam nenhuma regra do produto. Dose e apresentação descrevem o produto e não alimentam cálculo — quem manda no cálculo por dose é a formulação.",
      "Na lista, cada linha oferece os atalhos CMV e Custos industriais, além de Inativar/Reativar. A busca casa código, nome, referência e cliente; os filtros são cliente, situação e ciclo de vida. Novo produto abre em tela própria.",
    ],
  },

  "cliente.comoFunciona": {
    module: "cadastros",
    title: "Cliente: a identidade que os documentos congelam",
    summary:
      "Cliente é a pessoa jurídica que compra da Veridi e que, em private label, é dona da marca e às vezes do próprio material. O cadastro guarda identificação, contato, endereço e notas internas. Não é agenda de contatos nem ferramenta de relacionamento comercial: não há histórico de conversas, funil nem tarefas aqui — o funil comercial é o Projeto.",
    concepts: [
      {
        term: "Código do cliente",
        text: "Sai da sequência oficial no padrão CLI-000001. Não é digitado, não é editado e é por ele que os documentos citam o cliente.",
      },
      {
        term: "Razão social × nome fantasia",
        text: "Razão social é o único campo obrigatório do cadastro e é o que vai para documento. Nome fantasia é como o cliente é chamado no dia a dia, e é o que as listas mostram primeiro quando existe.",
      },
      {
        term: "CNPJ",
        text: "Opcional, mas único entre clientes: dois não podem ter o mesmo, mesmo que um esteja inativo. Os dígitos verificadores são conferidos, inclusive na forma alfanumérica nova. A conferência é de consistência do número, não de existência da empresa na Receita.",
      },
      {
        term: "Endereço",
        text: "Usado nos documentos impressos. UF precisa ser uma sigla válida e o CEP guarda oito dígitos, sem a máscara. Uma proposta enviada congela o endereço do momento do envio: alterar o cadastro depois não reescreve o que já foi impresso.",
      },
      {
        term: "Sufixo do lote comercial",
        text: "O trecho do cliente na máscara de lote comercial sugerida na ordem de produção. Não é o lote interno, não obriga nada e não altera estoque.",
      },
      {
        term: "Informações do cadastro",
        text: "Quem criou e quem alterou por último, pelo usuário autenticado no momento. Quem criou nunca muda; quem alterou é atualizado também quando o cliente é ativado ou inativado. Registros antigos ou importados aparecem como Não disponível, e nunca são atribuídos a alguém por dedução.",
      },
    ],
    flow: [
      {
        label: "Identificação",
        detail:
          "Razão social é obrigatória. CNPJ e nome fantasia entram aqui, e o código é gerado pelo sistema.",
      },
      {
        label: "Contato e endereço",
        detail:
          "E-mail, telefone, CEP, cidade e UF. Tudo opcional — cliente sem endereço continua sendo cadastro válido.",
      },
      {
        label: "Salvar",
        detail:
          "A partir daí o cliente pode ser vinculado a projeto, produto, pedido e material de propriedade dele no estoque.",
      },
      {
        label: "Inativar",
        tone: "warn",
        detail:
          "Tira o cliente de novos vínculos. Projetos, pedidos, produtos e lotes já ligados continuam intactos e visíveis.",
      },
    ],
    notes: [
      'O CNPJ é único no cadastro de clientes. Tentar repetir um já usado devolve "CNPJ já cadastrado", inclusive quando o outro cliente está inativo. Um fornecedor pode ter o mesmo CNPJ: são cadastros diferentes.',
      "Inativar um cliente não é bloqueado por pedido em aberto — o sistema deixa inativar e passa a recusar o que vier depois: novo produto para ele, criação e confirmação de pedido, e registro de material enviado por ele.",
      "Estoque de propriedade do cliente é identificado por este cadastro. É ele que decide qual material de cliente uma formulação, uma ordem ou uma amostra pode consumir.",
      "Alterar razão social ou endereço não reescreve documento já emitido: a proposta enviada guarda a cópia congelada do cliente daquela data.",
      "Observações são notas internas: nunca saem em documento para o cliente. Na lista, a busca casa código, razão social, nome fantasia e CNPJ; os filtros são UF e situação, e Exportar leva o recorte. Novo cliente abre em tela própria, que usa esta mesma ajuda.",
    ],
  },

  "fornecedor.comoFunciona": {
    module: "cadastros",
    title: "Fornecedor: a identidade, e nada além dela",
    summary:
      "Fornecedor é a empresa de quem a Veridi compra. O cadastro é curto de propósito: aqui ficam só razão social, CNPJ e contato — nem endereço existe. O que este fornecedor vende, com que código, se está homologado e a que preço se decide em Item x Fornecedor, porque essas informações são por par de item e fornecedor, não por empresa — a edição do fornecedor mostra essa lista só para consulta.",
    concepts: [
      {
        term: "Código do fornecedor",
        text: "Sai da sequência oficial no padrão FOR-000001, gerado pelo sistema e usado pelos documentos de compra.",
      },
      {
        term: "CNPJ",
        text: "Opcional e único entre fornecedores. Dígitos verificadores conferidos, nas formas numérica e alfanumérica. Não há consulta à Receita, e um cliente pode ter o mesmo CNPJ sem conflito.",
      },
      {
        term: "Item x Fornecedor",
        text: "A relação entre um item e este fornecedor: o código que ele usa para aquele item, a homologação e as ofertas de preço. É lá que se decide de quem comprar, não aqui.",
      },
      {
        term: "Homologação",
        text: "Decisão por item, não por empresa, e tomada pela Qualidade. O mesmo fornecedor pode estar homologado para um item e bloqueado para outro — por isso ela não cabe nesta tela.",
      },
      {
        term: "Lote do fornecedor",
        text: "O número de lote impresso pelo fornecedor, guardado no recebimento junto ao lote interno da Veridi. São duas identidades do mesmo material, e as duas ficam registradas.",
      },
    ],
    flow: [
      {
        label: "Identificação",
        detail:
          "Razão social é obrigatória; nome fantasia e CNPJ são opcionais. O código é gerado pelo sistema.",
      },
      {
        label: "Contato",
        detail: "E-mail e telefone de quem atende a Veridi. Opcionais.",
      },
      {
        label: "Itens fornecidos",
        tone: "accent",
        detail:
          "Em Compras, Item x Fornecedor: um registro por item, com o código do fornecedor, a homologação e as ofertas de preço.",
      },
      {
        label: "Compra e recebimento",
        detail:
          "A ordem de compra escolhe o fornecedor; o recebimento gera o lote interno e guarda o lote do fornecedor ao lado.",
      },
    ],
    notes: [
      "Preço de fornecedor é referência comercial registrada nas ofertas, em Item x Fornecedor. O custo real de aquisição continua vindo do recebimento.",
      'O CNPJ é único entre fornecedores. Repetir um já cadastrado devolve "CNPJ já cadastrado".',
      "Inativar não é bloqueado por ordem de compra em aberto: as compras e os recebimentos existentes seguem íntegros. O fornecedor inativo passa a ser recusado em nova ordem de compra e em nova relação Item x Fornecedor, e deixa de aparecer como candidato em sugestão de compra e como referência de custo.",
      "O cadastro de fornecedor não registra autoria de criação e alteração. Quem precisa dessa informação a encontra nos documentos de compra e recebimento.",
      "Na edição, o bloco Itens fornecidos é só leitura: código no fornecedor, homologação, preferencial, preço e pedido mínimo, com o caminho para Compras › Item x Fornecedor. Observações são notas internas. Novo fornecedor abre em tela própria, com esta mesma ajuda.",
    ],
  },

  "recursoIndustrial.comoFunciona": {
    module: "gestao",
    title: "Recurso industrial: o que custa fora do material",
    summary:
      "Recurso industrial é o que a fábrica consome além da matéria-prima: mão de obra, equipamento e energia, cada um com uma tarifa por hora ou por kWh. Esta tela cadastra o recurso e guarda o histórico das tarifas. Ela não calcula nada e não sabe de produto: quanto de cada recurso um produto consome é declarado na estrutura de custos daquele produto. Recurso de mão de obra é a categoria econômica, não uma pessoa — não tem relação com o cadastro de usuários.",
    concepts: [
      {
        term: "Recurso × uso do recurso",
        text: "Recurso é o que existe na fábrica e quanto ele custa por hora ou por kWh. Uso é quanto dele um produto consome, e vive na estrutura de custos. Esta tela cuida só do primeiro.",
      },
      {
        term: "Tipo",
        text: "Mão de obra e equipamento se medem em tempo, com tarifa por hora. Energia se mede em kWh. O tipo define a unidade da tarifa, é escolhido na criação e não muda depois.",
      },
      {
        term: "Tarifa vigente",
        text: "A tarifa com data de início já passada e validade ainda não vencida. Havendo mais de uma candidata, vale a de início mais recente.",
      },
      {
        term: "Histórico de tarifas",
        text: "Cada tarifa é um registro próprio e não se edita nem se apaga. Reajuste é tarifa nova; a anterior continua explicando por que uma estrutura antiga custou o que custou.",
      },
      {
        term: "Tarifa sem vigência",
        text: "Tarifa sem data de início, típica de valor herdado da planilha. Aparece como referência histórica e nunca é escolhida como tarifa vigente.",
      },
      {
        term: "Potência em kW",
        text: "Só se aplica a equipamento — informá-la em mão de obra ou energia é recusado. Em branco significa potência desconhecida, nunca zero, e o cadastro não trava por causa disso.",
      },
      {
        term: "Base de uso",
        text: "Como o consumo é declarado na estrutura de custos: por lote de referência, por unidade acabada ou por mil unidades acabadas. Ela muda o significado do número, não o número.",
      },
    ],
    flows: [
      {
        name: "A. Cadastrar o recurso e sua tarifa",
        when: "É o que você faz nesta tela e no detalhe do recurso. Só o perfil administrador altera.",
        steps: [
          {
            label: "Tipo e nome",
            tone: "accent",
            detail:
              "Mão de obra, equipamento ou energia. O tipo define se a tarifa é por hora ou por kWh e não é escolhido de novo depois.",
          },
          {
            label: "Potência",
            detail:
              "Só em equipamento, e só quando conhecida. Deixar em branco é dizer que não se sabe, o que é diferente de dizer que é zero.",
          },
          {
            label: "Nova tarifa",
            detail:
              "Valor e data de início. Ela passa a ser a vigente a partir dessa data; a anterior continua registrada como histórico.",
          },
          {
            label: "Inativar",
            detail:
              "Marca o recurso como fora de uso. Cálculos e estruturas que já o congelaram continuam válidos.",
          },
        ],
      },
      {
        name: "B. Do recurso ao custo do produto",
        when: "O que acontece com este cadastro em outras telas.",
        steps: [
          {
            label: "Estrutura de custos",
            detail:
              "No produto, cada recurso ganha uma quantidade de uso e uma base. É onde recurso e produto se encontram.",
          },
          {
            label: "Ativação",
            tone: "accent",
            detail:
              "Ao ativar a versão da estrutura, a tarifa e a potência do momento são congeladas na linha de uso, junto com o nome do recurso.",
          },
          {
            label: "Cálculo",
            detail:
              "Enquanto a versão é rascunho, o custo lê a tarifa de hoje e avisa que é referência. Depois de ativada, lê o valor congelado.",
          },
          {
            label: "Energia",
            detail:
              "Informada direto ou derivada das horas de equipamento pela potência. Nunca as duas ao mesmo tempo, porque somaria a mesma energia duas vezes.",
          },
        ],
      },
    ],
    notes: [
      "Tarifa não se edita nem se apaga. Corrigir um valor é cadastrar uma tarifa nova com a data de início correta; a antiga permanece explicando os cálculos que a usaram.",
      "Tarifa sem data de início nunca é tratada como vigente. Ela fica no histórico como referência.",
      "A unidade da tarifa segue o tipo do recurso. Cadastrar tarifa por hora em recurso de energia é recusado com \"unidade não corresponde ao tipo do recurso\".",
      "A estrutura de custos congela tarifa, potência e nome do recurso na ativação. Cadastrar tarifa nova depois disso não reescreve estrutura já ativada nem cálculo já salvo.",
      "Inativar um recurso não bloqueia nada aqui, nem desfaz estrutura que já o usa. O bloqueio aparece depois, ao tentar ativar uma versão de estrutura que ainda contém o recurso inativo: \"Recurso inativo nesta estrutura — reative ou remova antes de ativar\".",
      "Com a energia derivada dos equipamentos, equipamento sem potência cadastrada vira pendência que impede fechar o custo. Não existe potência padrão presumida.",
      "Cadastrar recurso e cadastrar tarifa são ações do perfil administrador. Os demais perfis consultam.",
      "O histórico de tarifas mostra, por tarifa, valor, unidade, vigente desde, válida até, origem (cadastrada ou herdada da planilha), situação e quem registrou. Novo recurso abre em tela própria, com esta mesma ajuda; a tarifa é cadastrada depois, no detalhe.",
    ],
  },

  "qualidadeDocumentos.comoFunciona": {
    module: "qualidade",
    title: "Laudo aprovado não é lote liberado",
    summary:
      "Esta tela mostra a situação documental dos lotes: quem já mandou laudo, quem está aguardando análise, quem foi aprovado e quem foi rejeitado. Ela é uma leitura sobre os lotes existentes, não uma fila com vida própria — não há nada armazenado por trás dela. E a regra que mais gera confusão está aqui: aprovar o laudo não libera o lote. Liberar continua sendo uma ação explícita na tela do lote, e o laudo aprovado é pré-requisito dela, nunca substituto.",
    concepts: [
      {
        term: "CoA ou laudo",
        text: "O certificado de análise que o fornecedor emite para aquele lote. É documento de terceiro, anexado ao lote e analisado pela Qualidade.",
      },
      {
        term: "Situação do CoA",
        text: "Não exigido, Pendente de documento, Aguardando análise, Aprovado ou Rejeitado. Descreve o documento, nunca o material. Ela anda sozinha até Aguardando análise, quando o anexo chega; daí em diante só muda por decisão de alguém.",
      },
      {
        term: "Situação do lote",
        text: "Aguardando liberação, Disponível, Bloqueado ou Vencido. Descreve o material e é ela que decide se o lote pode ser usado.",
      },
      {
        term: "Exige CoA",
        text: "Marcação copiada do cadastro do item quando o lote nasceu. Só em lote que exige laudo é que a análise documental aparece como pendência e as ações de aprovar e rejeitar ficam disponíveis.",
      },
      {
        term: "Pendências",
        text: "O filtro que a tela abre por padrão: os lotes com laudo pendente de documento, aguardando análise ou rejeitado. Escolher uma situação específica substitui esse recorte.",
      },
      {
        term: "Fornecedor / Proprietário",
        text: "De quem veio e de quem é. Lote da Veridi mostra o fornecedor; lote de material de cliente mostra o cliente dono, porque a análise é a mesma mas a propriedade não.",
      },
    ],
    flows: [
      {
        name: "A. Analisar o laudo",
        when: "É o que você faz nesta tela, com perfil Qualidade ou Administrador.",
        steps: [
          {
            label: "Pendências",
            detail:
              "A tela abre no que ainda espera alguém. Os demais estados ficam a um clique, e o filtro de saldo esconde lote já consumido por inteiro.",
          },
          {
            label: "Conferir o lote",
            detail:
              "Item, fonte, fornecedor ou cliente dono, validade e saldo físico na mesma linha. Abrir o lote mostra o documento anexado.",
          },
          {
            label: "Aprovar ou rejeitar",
            tone: "accent",
            detail:
              "A decisão é sobre o documento. Aprovar exige que o laudo já esteja anexado; rejeitar exige motivo, que fica registrado com autor e data.",
          },
          {
            label: "Liberar o lote",
            tone: "warn",
            detail:
              "Passo separado, na tela do lote. Enquanto ele não acontece, o material continua fora do disponível mesmo com laudo aprovado.",
          },
        ],
      },
    ],
    notes: [
      "Aprovar o laudo não libera o lote e não movimenta estoque. Ele apenas deixa de ser impedimento: a liberação continua sendo ação explícita na tela do lote, e ela é recusada enquanto o CoA exigido não estiver aprovado.",
      "Aprovar exige o documento anexado. Sem nenhum anexo ativo a ação é recusada com \"anexe o CoA antes de aprovar\".",
      "Rejeitar exige motivo, e faz mais do que marcar o documento: lote que estava disponível é bloqueado na mesma ação, com o motivo \"CoA rejeitado\". Desbloquear é ação à parte, e devolve o lote para aguardando liberação — nunca direto para disponível.",
      "As ações de aprovar e rejeitar são dos perfis Qualidade e Administrador. Anexar o documento é possível também para Compras — anexar não é decidir.",
      "Consultar esta tela é liberado a qualquer usuário autenticado. Fechar a tela não deixa nada pendente: ela é uma consulta sobre os lotes.",
      "A folha de pendências (FO-03) imprime o mesmo recorte para conferência em papel.",
    ],
  },

  "usuario.comoFunciona": {
    module: "administracao",
    title: "Usuário: quem assina cada registro",
    summary:
      "Usuário existe por dois motivos: entrar no sistema e responder quem executou cada ação. O nome de quem estava autenticado é gravado no próprio documento — liberação de lote, análise de laudo, ativação de custo, alteração de preço — e vem sempre da sessão, nunca de um campo digitado. Não é um módulo de RH: não há cargo, jornada, setor nem hierarquia, só identidade e perfil de acesso.",
    concepts: [
      {
        term: "Perfil de acesso",
        text: "Administrador, Produção, Qualidade, Compras, Comercial ou Consulta. Um perfil por usuário. É um controle por área, não uma matriz de permissão por botão.",
      },
      {
        term: "Código do usuário",
        text: "Sai da sequência oficial no padrão USR-000001. Ele identifica o usuário nas listas, junto com o nome.",
      },
      {
        term: "Ativo × inativo",
        text: "Usuário nunca é excluído. Com registros de GMP atrás dele, apagar seria perder rastreabilidade. Inativar derruba as sessões abertas na hora e preserva tudo o que ele assinou.",
      },
      {
        term: "Autoria congelada",
        text: "O nome de quem executou é gravado no momento da ação, ao lado do vínculo com o usuário. Renomear, trocar de perfil ou inativar depois não reescreve o que já ficou registrado.",
      },
      {
        term: "Senha",
        text: "Mínimo de dez caracteres, sem exigência de símbolo ou maiúscula — comprimento é o que realmente protege. A troca é feita por um administrador e derruba as sessões abertas daquele usuário.",
      },
    ],
    flow: [
      {
        label: "Novo usuário",
        detail:
          "Nome, e-mail, senha e perfil. O e-mail é o login, precisa ser único, e o código é gerado pelo sistema.",
      },
      {
        label: "Perfil",
        tone: "accent",
        detail:
          "Define o que a pessoa vê e o que o sistema aceita dela. Esconder um botão não é o controle: é a consequência dele.",
      },
      {
        label: "Editar",
        detail:
          "Nome, e-mail, perfil e situação. Deixar o campo de senha em branco mantém a senha atual.",
      },
      {
        label: "Inativar",
        tone: "warn",
        detail:
          "Bloqueia o acesso na hora, sem apagar o usuário. Os registros que ele assinou continuam com o nome dele.",
      },
    ],
    notes: [
      "Usuário não é excluído em nenhuma hipótese. A saída de alguém da operação se resolve inativando, e as sessões abertas caem imediatamente.",
      "Criar, editar, inativar usuário e trocar senha são ações do perfil administrador. Nada impede um administrador de inativar a si mesmo nem de inativar o último administrador — confira antes de salvar.",
      "A troca de senha não avisa ninguém. O sistema não envia e-mail: a pessoa descobre porque foi desconectada e a senha anterior parou de funcionar.",
      "Deixar a senha em branco na edição mantém a senha atual. Preencher o campo é o que dispara a troca.",
      "O perfil vale onde há controle por área declarado: administração de usuários, recursos industriais e documentos controlados são do administrador; liberação de lote, bloqueio e decisão de laudo são de Qualidade; estrutura de custos, precificação, projetos, orçamentos e alteração de preço faturado são do Comercial; templates de custo e de formulação e a execução de amostras são da Produção; Item x Fornecedor é de Compras. Fora desses pontos, o registro do autor continua acontecendo mesmo onde não há restrição de perfil.",
      "Trocar o perfil não reescreve nada do passado: as ações já registradas continuam com o autor e a data em que aconteceram.",
    ],
  },

  "documentoControlado.comoFunciona": {
    module: "administracao",
    title: "Documento controlado: o cabeçalho da revisão, só isso",
    summary:
      "Esta tela guarda a revisão vigente dos formulários impressos da Veridi — a Ordem de Produção (R.PRO.002) e a Folha de Receita (R.COQ.003). É o cabeçalho que esses papéis precisam carregar: código, revisão, data e responsáveis. Não é um gerenciador de documentos: não se anexa arquivo aqui, não há editor do desenho do formulário, não há assinatura eletrônica, e o sistema não declara conformidade GMP ou ANVISA em lugar nenhum.",
    concepts: [
      {
        term: "Tipo de documento",
        text: "Ordem de Produção ou Folha de Receita. São os dois formulários impressos que carregam cabeçalho controlado nesta fase.",
      },
      {
        term: "Código do documento",
        text: "R.PRO.002 e R.COQ.003 são os códigos reais da Veridi. Eles vêm do tipo escolhido e não são digitados nem inventados.",
      },
      {
        term: "Revisão",
        text: "O identificador da versão do formulário, como a Qualidade o numera. É texto livre porque a numeração é da Veridi — e não se repete: cada revisão existe uma vez só por tipo.",
      },
      {
        term: "Revisão vigente",
        text: "Uma por tipo de documento. É ela que os documentos impressos daqui em diante carregam no cabeçalho.",
      },
      {
        term: "Elaborado por / Aprovado por",
        text: "Os responsáveis que o cabeçalho impresso exibe, referenciando o cadastro de usuários. É identificação de responsável, não assinatura eletrônica.",
      },
    ],
    flow: [
      {
        label: "Nova revisão",
        detail:
          "Escolha o tipo e informe o número da revisão. A data é opcional: quando a data real não é conhecida, não se inventa uma.",
      },
      {
        label: "Ativação",
        tone: "accent",
        detail:
          "A revisão criada aqui entra como vigente e a anterior do mesmo tipo passa a histórico, na mesma operação. Só existe uma vigente por tipo.",
      },
      {
        label: "Liberação da ordem",
        detail:
          "Ao liberar uma ordem de produção, as revisões vigentes dos dois documentos são congeladas naquela ordem.",
      },
      {
        label: "Histórico",
        detail:
          "As revisões anteriores continuam listadas, e uma delas pode voltar a ser a vigente. É o que explica o cabeçalho de um papel arquivado.",
      },
    ],
    notes: [
      "Documento já emitido não é reescrito. Uma ordem de produção liberada guarda a revisão vigente na época — trocar a revisão hoje não muda o papel de ontem.",
      "Revisão não se edita e não se apaga. Repetir o número da mesma revisão é recusado, porque seria reescrever histórico; corrigir é criar uma revisão nova.",
      "Só existe uma revisão vigente por tipo. Ativar uma coloca a anterior em histórico automaticamente.",
      "Data da revisão é opcional de propósito: para documento herdado, uma data inventada é pior do que a ausência dela.",
      "Não haver revisão vigente não impede liberar ordem de produção: o cabeçalho sai sem essa informação em vez de travar a operação.",
      "Criar e ativar revisão são ações do perfil administrador. A leitura é aberta, porque a impressão precisa do cabeçalho.",
    ],
  },

  "relatorios.comoFunciona": {
    module: "gestao",
    title: "Relatórios: consulta, nunca fonte de verdade",
    summary:
      "Esta tela é o catálogo dos relatórios operacionais, agrupados por domínio e numerados de R-01 em diante. Cada relatório é uma consulta somente leitura montada na hora sobre os documentos do sistema — não existe tabela de relatório, número guardado nem painel analítico configurável. Se um relatório e o documento discordam, o documento é que vale.",
    concepts: [
      {
        term: "Código R-xx",
        text: "O identificador oficial do relatório. Ele é estável e serve para pedir um relatório pelo nome certo em vez de descrevê-lo.",
      },
      {
        term: "Apelido",
        text: "Como a Veridi chama o relatório na prática — Kardex, falta de material, carteira. A busca casa pelo apelido também, com ou sem acento, porque quase ninguém procura pelo título oficial.",
      },
      {
        term: "Somente leitura",
        text: "Nenhum relatório altera saldo, situação ou documento. Abrir, filtrar e exportar não muda nada na operação.",
      },
      {
        term: "Data de referência",
        text: "Cada relatório usa a data que faz sentido para o assunto: consumo pela data do consumo, compra pela data do pedido, faturamento pela data de emissão. Nenhum deles usa a data da última alteração do registro.",
      },
      {
        term: "Exportar e imprimir",
        text: "Levam exatamente o recorte filtrado, não a base inteira. A impressão escreve no cabeçalho quais filtros foram aplicados, para a folha dizer a que ela se refere.",
      },
    ],
    flow: [
      {
        label: "Escolher",
        detail:
          "Seis grupos: estoque, produção, compras, comercial, faturamento e gestão industrial. A busca aceita código, título e apelido.",
      },
      {
        label: "Filtrar",
        detail:
          "Cada relatório tem os seus filtros, e alguns já vêm ligados — posição de estoque e vencimentos abrem só com saldo.",
      },
      {
        label: "Ler",
        detail:
          "Resumo no topo, detalhe abaixo. Os números vêm dos documentos no instante da consulta.",
      },
      {
        label: "Levar",
        detail: "Exportar em CSV ou imprimir o mesmo recorte, com os filtros no cabeçalho.",
      },
    ],
    notes: [
      "Relatório não é documento. Ele não guarda estado, não congela número e não substitui a tela do pedido, da ordem ou do lote quando há divergência.",
      "Custo desconhecido nunca vira zero. Onde falta referência de custo o relatório diz que falta, e o total fica identificado como parcial.",
      "Quantidades de unidades diferentes nunca são somadas. Onde a soma não faria sentido, o relatório conta itens ou documentos.",
      "Custo industrial (R-18) mostra o último cálculo salvo de cada produto, sem recalcular na abertura; precificação (R-19) mostra só as precificações ativas, com os valores congelados na ativação. Produto sem cálculo aparece vazio, e vazio é informação.",
      "Orçamento x Precificação (R-20) expõe custo e margem por proposta e exige perfil comercial ou administrativo. Os demais relatórios estão abertos a qualquer usuário autenticado.",
      "O resultado é a leitura do momento. Reabrir o mesmo relatório depois de uma movimentação devolve outro número, e isso é o comportamento correto.",
    ],
  },

  "painel.comoFunciona": {
    module: "gestao",
    title: "Painel: o que exige decisão hoje",
    summary:
      "O painel é a mesa de comando da operação, não uma ferramenta de análise de dados. Ele junta duas coisas que não se misturam: o estado de agora — o que precisa de atenção e o que está aberto em cada área — e a contagem de documentos do período escolhido. Nada aqui é armazenado: tudo é derivado dos documentos a cada carregamento, e nenhum número do painel é fonte de verdade.",
    concepts: [
      {
        term: "Precisa de atenção",
        text: "O que muda a decisão de hoje: lote vencido ou bloqueado com saldo, lote aguardando Qualidade, ordem com falta de material, compra atrasada, expedição a faturar. É estado atual e ignora o filtro de período.",
      },
      {
        term: "Operação atual",
        text: "O que está aberto agora em comercial, produção, compras e estoque. Também ignora o período: um pedido confirmado continua confirmado, tenha sido criado hoje ou no mês passado.",
      },
      {
        term: "No período",
        text: "Contagem de documentos dentro das datas escolhidas, cada um pela data que lhe importa: pedido pela criação, recebimento pela entrada, ordem pela conclusão, expedição pela confirmação, faturamento pela emissão.",
      },
      {
        term: "Movimentações",
        text: "Contagem de lançamentos de estoque por dia e por tipo. É contagem de eventos, nunca soma física: quilo e unidade não se somam no mesmo total. Consumo de amostra tem cartão próprio e nunca é misturado com consumo de produção nem com ajuste.",
      },
      {
        term: "Ações rápidas",
        text: "Atalhos para as telas onde a criação acontece, filtrados pelo seu perfil. São links: as validações continuam sendo aplicadas na tela de destino.",
      },
      {
        term: "Gráfico e últimas movimentações",
        text: "O gráfico conta lançamentos de estoque por dia dentro do período, e a tabela abaixo lista os últimos: quando, quantidade e origem. Cada linha abre o documento que gerou o movimento.",
      },
      {
        term: "Valor faturado indisponível",
        text: "Quando algum faturamento emitido no período não tem preço em todas as linhas, o total não é exibido. Faltar preço não vira zero, e soma parcial não é apresentada como total.",
      },
    ],
    flow: [
      {
        label: "Atenção primeiro",
        tone: "warn",
        detail:
          "A primeira seção é o que exige decisão agora, do mais crítico para o menos. Cada item abre o documento correspondente.",
      },
      {
        label: "Período",
        detail:
          "O filtro de datas vale só para as seções No período e Movimentações. Trocar o período não altera o que está aberto na operação.",
      },
      {
        label: "Operação atual",
        detail:
          "A situação de agora por área. É a leitura para saber onde a fila está parada.",
      },
      {
        label: "Abrir o documento",
        tone: "accent",
        detail:
          "Toda linha leva ao documento de origem. A decisão se toma lá, com as validações da tela.",
      },
    ],
    notes: [
      "Trocar o filtro de período não muda Precisa de atenção nem Operação atual. Essas duas seções são estado de agora, por definição.",
      "Alerta de lote só aparece quando ainda existe saldo. Lote zerado, mesmo vencido ou bloqueado, não é problema operacional.",
      "As contagens são de documentos e de eventos, não de quantidade. Um recebimento com cinco linhas conta como um recebimento, e itens em compra conta itens distintos, porque quilo e unidade não formam um total só.",
      "A lista de atenção mostra os casos mais urgentes e informa o total. O número ao lado do grupo é o total real, mesmo quando nem todos aparecem na tela.",
      "Vencimento é calculado pela data do lote, não por uma marcação guardada. Não há rotina que carimbe lote como vencido.",
      "As ações rápidas mudam conforme o perfil de acesso. Não ver um atalho não é falha da tela.",
    ],
  },
} satisfies Record<string, HelpTopic>;

export const cadastrosHints = {
  /* Colunas do cadastro de Itens de estoque. */
  "item.tipo": {
    module: "cadastros",
    label: "Tipo",
    text: "Matéria-prima (MP), material de embalagem (ME) ou produto acabado (PA). Define o prefixo do código e os padrões de lote, validade e Qualidade. Trava assim que o item tem histórico operacional.",
  },
  "item.fonte": {
    module: "cadastros",
    label: "Fonte",
    text: "A forma química que entra de fato, como cloridrato de tiamina. Diferente do nutriente declarado, que é o nome da tabela nutricional.",
  },
  "item.unidade": {
    module: "cadastros",
    label: "Unidade",
    text: "A unidade em que o item é comprado, estocado e movimentado — uma só por item. É para ela que a formulação converte a quantidade declarada antes de reservar material.",
  },
  "item.controlaLote": {
    module: "cadastros",
    label: "Lote",
    text: "Sim significa que cada recebimento gera um lote interno próprio, com QR, e exige o lote do fornecedor na entrada. Não significa saldo único, sem apontar de qual entrada veio o material consumido.",
  },
  "item.controlaValidade": {
    module: "cadastros",
    label: "Validade",
    text: "Sim exige a data de vencimento no recebimento e faz o sistema sugerir primeiro o lote que vence antes (FEFO). Não faz a sugestão seguir a ordem de entrada (FIFO).",
  },
  "item.situacao": {
    module: "cadastros",
    label: "Status do item",
    text: "Inativo deixa de aceitar vínculo novo: nova relação com fornecedor, nova linha de compra e novo componente de formulação. Saldo, lotes e o que já está em curso continuam funcionando, e a reativação é possível.",
  },

  /* Colunas do cadastro de Produtos. */
  "produto.cliente": {
    module: "cadastros",
    label: "Cliente do produto",
    text: "De quem é o produto. Obrigatório na criação e travado depois que existe pedido, ordem de produção ou orçamento com ele — nesse caso o caminho é cadastrar outro produto.",
  },
  "produto.itemAcabado": {
    module: "cadastros",
    label: "Item acabado",
    text: "O item PA que representa este produto no estoque — é ele que tem lote, validade e saldo. Um item acabado pertence a um único produto.",
  },
  "produto.cicloDeVida": {
    module: "cadastros",
    label: "Em desenvolvimento",
    text: "Produto técnico de projeto: aceita formulação, custo e preço, mas é recusado em pedido de cliente e em ordem de produção. Ele passa a aprovado quando o projeto que o criou é aprovado.",
  },
  "produto.formulacaoAtiva": {
    module: "cadastros",
    label: "Formulação",
    text: "A versão da receita em vigor para este produto. É ela que a produção executa e que o custo e o preço leem. Vazio significa que ainda não há versão ativa.",
  },
  "produto.vidaUtil": {
    module: "cadastros",
    label: "Vida útil",
    text: "Prazo padrão em meses. Ele sugere a validade quando um lote é produzido; a data digitada no apontamento vence a sugestão, e lotes já existentes não mudam.",
  },
  "produto.situacao": {
    module: "cadastros",
    label: "Status do produto",
    text: "Inativo é recusado em nova linha de pedido, na confirmação do pedido e em nova ordem de produção. É diferente de em desenvolvimento, que aparece ao lado do nome.",
  },

  /* Colunas do cadastro de Clientes. */
  "cliente.razaoSocial": {
    module: "cadastros",
    label: "Razão Social / Nome",
    text: "O único campo obrigatório, e o que vai para os documentos. Nome fantasia é como o cliente é chamado no dia a dia, e é o que as listas mostram primeiro quando existe.",
  },
  "cliente.cnpj": {
    module: "cadastros",
    label: "CNPJ do cliente",
    text: "Opcional e único entre clientes, mesmo que o outro esteja inativo. Os dígitos verificadores são conferidos, inclusive na forma alfanumérica nova. Um fornecedor pode ter o mesmo CNPJ: são cadastros diferentes.",
  },
  "cliente.situacao": {
    module: "cadastros",
    label: "Status do cliente",
    text: "Inativar não é bloqueado por pedido em aberto e não desfaz nada. Depois disso o cliente é recusado em produto novo, em criação e confirmação de pedido e no registro de material enviado por ele.",
  },

  /* Colunas do cadastro de Fornecedores. */
  "fornecedor.razaoSocial": {
    module: "cadastros",
    label: "Razão Social / Nome",
    text: "O único campo obrigatório, e o que vai para os documentos de compra. Nome fantasia é como o fornecedor é chamado no dia a dia.",
  },
  "fornecedor.cnpj": {
    module: "cadastros",
    label: "CNPJ do fornecedor",
    text: "Opcional e único entre fornecedores. Os dígitos verificadores são conferidos, inclusive na forma alfanumérica nova. Um cliente pode ter o mesmo CNPJ: são cadastros diferentes.",
  },
  "fornecedor.situacao": {
    module: "cadastros",
    label: "Status do fornecedor",
    text: "Inativar não é bloqueado por ordem de compra em aberto e não desfaz nada. Depois disso o fornecedor é recusado em nova ordem de compra e em nova relação Item x Fornecedor, e some das sugestões de compra e das referências de custo.",
  },

  /* Colunas de Recursos industriais. */
  "recurso.tipo": {
    module: "gestao",
    label: "Tipo do recurso",
    text: "Mão de obra e equipamento se medem em tempo, com tarifa por hora. Energia se mede em kWh. O tipo define a unidade da tarifa e não muda depois da criação.",
  },
  "recurso.potencia": {
    module: "gestao",
    label: "Potência (kW)",
    text: "Só se aplica a equipamento. Em branco significa potência desconhecida, nunca zero. É por ela que a energia pode ser derivada das horas de equipamento.",
  },
  "recurso.tarifaVigente": {
    module: "gestao",
    label: "Tarifa vigente",
    text: "A tarifa com início já passado e validade não vencida; havendo mais de uma, vale a de início mais recente. Tarifa sem data de início é referência histórica e nunca aparece aqui.",
  },
  "recurso.tarifas": {
    module: "gestao",
    label: "Tarifas",
    text: "Quantas tarifas o recurso já teve. Elas não se editam nem se apagam: reajuste é tarifa nova, e a antiga é o que explica cálculos antigos.",
  },
  "recurso.situacao": {
    module: "gestao",
    label: "Status do recurso",
    text: "Inativar não desfaz estrutura de custos que já usa o recurso. O bloqueio aparece ao tentar ativar uma versão que ainda o contém: reative ou remova antes.",
  },

  /* Colunas da situação documental da Qualidade. */
  "qualidade.coa": {
    module: "qualidade",
    label: "CoA",
    text: "Situação do laudo do fornecedor: não exigido, pendente de documento, aguardando análise, aprovado ou rejeitado. Descreve o documento, nunca o material.",
  },
  "qualidade.situacaoLote": {
    module: "qualidade",
    label: "Qualidade do lote",
    text: "Situação do material: aguardando liberação, disponível, bloqueado ou vencido. É ela que decide se o lote pode ser usado — e aprovar o laudo não a altera sozinho.",
  },
  "qualidade.proprietario": {
    module: "qualidade",
    label: "Fornecedor / Proprietário",
    text: "De quem veio e de quem é. Lote da Veridi mostra o fornecedor; lote de material de cliente mostra o cliente dono. A análise é a mesma, a propriedade não.",
  },
  "qualidade.fisico": {
    module: "qualidade",
    label: "Físico",
    text: "O que existe no lote hoje, inclusive o que está reservado. Lote sem saldo pode continuar com pendência documental — o filtro Somente com saldo esconde esses casos.",
  },

  /* Colunas da Administração. */
  "usuario.perfil": {
    module: "administracao",
    label: "Perfil",
    text: "Administrador, Produção, Qualidade, Compras, Comercial ou Consulta. Um por usuário. É um controle por área, não uma permissão por botão.",
  },
  "usuario.situacao": {
    module: "administracao",
    label: "Status do usuário",
    text: "Usuário nunca é excluído: com registros de GMP atrás dele, apagar seria perder rastreabilidade. Inativar derruba as sessões abertas na hora e mantém tudo o que ele assinou.",
  },
  "documentoControlado.revisao": {
    module: "administracao",
    label: "Revisão",
    text: "O número da versão do formulário, como a Qualidade o numera. É texto livre porque a numeração é da Veridi, e não se repete dentro do mesmo tipo.",
  },
  "documentoControlado.vigente": {
    module: "administracao",
    label: "Situação da revisão",
    text: "Uma revisão vigente por tipo de documento. Ativar uma nova coloca a anterior em histórico — e nunca reescreve documento já emitido.",
  },
} satisfies Record<string, HelpHint>;
