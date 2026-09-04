import type { HelpTopic } from "../help-content";

/**
 * Gestão — custo congelado, preço, bibliotecas reutilizáveis, relatórios e a
 * Consulta de Cliente.
 *
 * O módulo existe porque estas telas foram, por um tempo, explicadas pela
 * ajuda do CMV: a tela de preço abria um painel que descrevia como o custo
 * de uma quantidade é montado — assunto vizinho, tela errada. Cada tópico
 * daqui responde as três perguntas na ordem em que elas aparecem para quem
 * abriu a tela sem saber o que ela é: o QUE é esta tela, QUANDO eu a uso e o
 * que ACONTECE DEPOIS.
 *
 * As `notes` carregam o que não cabe em nenhuma das três: o que a tela não
 * faz, o que é irreversível e o que costuma ser confundido com outra coisa.
 */
export const gestaoTopics = {
  "precificacao.comoFunciona": {
    module: "gestao",
    title: "O que é uma Precificação e o que a ativação congela",
    summary:
      "Precificação é o documento interno que transforma um custo já calculado em preço: faixas de quantidade, margem de contribuição desejada e comissão, tudo sobre a MESMA base de custo. Ela não é o cálculo de custo, não é orçamento ao cliente e não é documento fiscal — e não nasce do nada: parte sempre de um cálculo de custo salvo.",
    concepts: [
      {
        term: "Versão de precificação",
        text: "O documento de preço de um produto. Em rascunho muda à vontade; ativa é preço acordado e não se reescreve. Cada produto tem no máximo um rascunho aberto e uma versão ativa por vez.",
      },
      {
        term: "Base de custo",
        text: "O cálculo de custo salvo sobre o qual a versão inteira foi construída, com a estrutura, a formulação e a data de referência que ele congelou. Todas as faixas compartilham essa mesma base — uma compra que chega no meio da negociação não pode fazer a faixa de 300 e a de 3.000 descreverem realidades diferentes.",
      },
      {
        term: "Faixa de quantidade",
        text: "Um cenário de venda: quanto o cliente leva. Cada faixa é recalculada para a própria quantidade, porque custo fixo por lote não encolhe abaixo de um lote e caixa de embalagem é inteira. O custo por unidade de 300 não é o de 3.000.",
      },
      {
        term: "Margem de contribuição",
        text: "Preço menos comissão menos custo industrial, dividido pelo preço. Não é lucro: imposto, despesa financeira, risco de inadimplência e frete comercial não entram nesta conta.",
      },
      {
        term: "Comissão",
        text: "Percentual sobre o preço bruto de venda: R$ 100 a 5% é R$ 5. Não existe outra base de comissão aqui.",
      },
      {
        term: "Markup",
        text: "Quanto o preço está acima do custo. É coisa diferente de margem, e fica em branco quando o custo base é zero — markup infinito não existe.",
      },
      {
        term: "Modo de preço",
        text: "Calcular pela margem, e o sistema devolve o preço que atinge a margem desejada; ou preço informado à mão, e o sistema devolve a margem que aquele preço dá.",
      },
      {
        term: "Lista de precificações",
        text: "A tela de entrada: uma linha por versão de precificação, com produto, cliente, situação (rascunho, ativa, inativa), cálculo e estrutura de origem, data do custo, qualidade do custo e número de faixas. Os filtros por situação e por qualidade do custo respondem “o que está vigente sobre custo real?”; a busca aceita código da precificação, do cálculo ou do produto.",
      },
      {
        term: "Observações",
        text: "Texto livre do documento. Não entra em conta nenhuma e não muda com a ativação.",
      },
    ],
    flow: [
      {
        label: "Escolher a base",
        detail:
          "A precificação nasce de um cálculo de custo salvo do produto. Sem ele não há de onde tirar preço, e o sistema recusa.",
      },
      {
        label: "Montar as faixas",
        detail:
          "Uma linha por quantidade, cada uma com o seu modo, a margem desejada e a comissão. Enquanto é rascunho, nada foi prometido a ninguém.",
      },
      {
        label: "Ler os números",
        detail:
          "Custo, preço, margem, markup e contribuição aparecem por faixa, com a qualidade do custo ao lado — é ela que diz o quanto o número sustenta uma decisão.",
      },
      {
        label: "Ativar",
        tone: "accent",
        detail:
          "Refaz a conta inteira e congela custo, preço, comissão, contribuição e markup de cada faixa. A versão ativa anterior do mesmo produto passa a inativa no mesmo ato.",
      },
      {
        label: "Usar",
        detail:
          "A partir daí esta é a precificação vigente do produto, e é dela que o orçamento parte. A oferta ao cliente continua sendo decisão de quem negocia.",
      },
    ],
    notes: [
      "Precificação ativa não muda mais. Compra nova, tarifa reajustada, estrutura nova ou cálculo mais completo não reescrevem preço acordado — para precificar sobre outra base, nasce uma versão nova, que copia as faixas e nenhum número congelado.",
      "Custo incompleto não vira preço pela margem: o preço sugerido fica em branco e a faixa não ativa nesse modo. Preço informado à mão é aceito sobre custo incompleto, mas margem, markup e contribuição continuam em branco — margem calculada sobre subtotal conhecido pareceria segura e não seria.",
      "Ativar assim mesmo é possível e exige confirmação explícita, tanto com custo incompleto quanto quando o cálculo aponta para uma estrutura de custos que já não é a ativa do produto.",
      "Trocar a base tem dois caminhos, e a tela mostra a diferença antes: no rascunho a base é trocada nele mesmo e o documento continua o mesmo; sobre uma versão ativa nasce um rascunho novo com as faixas copiadas, e a ativa fica intacta.",
      "Nada é calculado na tela. Os números de uma faixa aparecem depois de ela ser adicionada — não há prévia enquanto se digita — e, ao ativar, tudo é refeito do zero: os números que estavam à vista são ignorados.",
      "Custo e preço são colunas diferentes da mesma faixa: custo por unidade vem do cálculo salvo; preço sugerido, preço escolhido, margem resultante, markup e contribuição são a decisão comercial sobre ele.",
      "Quantidade abaixo do lote mínimo do produto é aviso, nunca correção automática: a quantidade digitada é a que fica.",
      "O sistema não arredonda preço por conta própria — 15,3846 continua 15,3846 até alguém decidir outra coisa. E contribuição negativa aparece como está: preço abaixo do custo é informação comercial, não erro a esconder.",
      "Material fornecido pelo cliente fica fora do custo da Veridi e não piora a qualidade do custo. O documento apenas registra que ele existe.",
    ],
  },

  "calculo.comoFunciona": {
    module: "gestao",
    title: "O cálculo de custo salvo: um retrato congelado",
    summary:
      "Um cálculo de custo é o retrato congelado de quanto custava produzir a base de referência de um produto numa data. Nada aqui é refeito na abertura: o documento mostra as referências de preço do momento em que a análise foi feita, mesmo que as compras de hoje já contem outra história. É ele que a precificação cita como base — e é essa citação que mantém uma decisão de preço explicável três meses depois.",
    concepts: [
      {
        term: "Código do cálculo",
        text: "O nome do documento. É por ele que uma precificação diz sobre qual custo o preço foi construído.",
      },
      {
        term: "Data de referência de custo",
        text: "O dia sobre o qual se perguntou. Ela escolhe as referências de preço dos materiais; o mesmo produto calculado em março e em agosto pode dar números diferentes, e é exatamente por isso que cálculos salvos existem.",
      },
      {
        term: "Base de referência",
        text: "A quantidade de produção declarada na estrutura de custos. O cálculo responde por ela — não por uma quantidade qualquer.",
      },
      {
        term: "Estrutura e formulação",
        text: "De que o cálculo foi feito: qual configuração industrial e qual versão da receita. As duas ficam registradas no documento e não mudam depois.",
      },
      {
        term: "Fonte do custo de cada material",
        text: "A linha de cada material diz de onde veio o custo unitário: compra real (média de 30 ou 90 dias, ou a última compra), oferta válida de fornecedor, referência manual de custo — ou sem referência. A seleção foi automática, na melhor fonte disponível na data de referência.",
      },
      {
        term: "Referência manual forçada",
        text: "Material em que quem calculou escolheu a referência manual do item mesmo havendo fonte melhor. A linha mostra a fonte automática que teria sido usada, o impacto no valor, o motivo, quem forçou e quando — tudo gravado neste documento, sem depender do item de hoje.",
      },
      {
        term: "Qualidade do custo",
        text: "De onde vieram os preços: tudo de compra real, com estimativas (oferta de fornecedor ou referência manual), parcial ou sem custo conhecido. É ela que diz o quanto o número sustenta uma decisão.",
      },
      {
        term: "Subtotal conhecido",
        text: "O que dá para somar quando falta o preço de algum material. Aparece rotulado como subtotal, nunca no lugar do total e nunca como R$ 0,00.",
      },
      {
        term: "Estrutura em rascunho",
        text: "O cálculo pode ser salvo antes de a estrutura ser ativada, e fica marcado assim: até a ativação, tarifas e premissas ainda podem mudar.",
      },
    ],
    flow: [
      {
        label: "Calcular",
        detail:
          "Nos custos industriais do produto, escolhendo a data de referência. Enquanto não se salva, é simulação: abrir e mudar a quantidade não grava nada.",
      },
      {
        label: "Salvar",
        tone: "accent",
        detail:
          "Congela a análise inteira — quantidades, referências de preço, tarifas, premissas e o veredito de qualidade — e o documento nasce com código próprio.",
      },
      {
        label: "Consultar",
        detail:
          "Esta tela, somente leitura. Nada é recalculado na abertura, e a impressão sai do que foi salvo.",
      },
      {
        label: "Precificar",
        detail:
          "A precificação escolhe um cálculo salvo como base. Vários preços podem citar o mesmo cálculo; nenhum deles o altera.",
      },
    ],
    notes: [
      "Cálculo salvo não se edita. Custo de recebimento informado depois, tarifa reajustada e estrutura alterada não reescrevem este documento.",
      "Cálculo que nenhuma precificação cita pode ser descartado inteiro — enquanto o produto está sendo definido, ele é só um retrato provisório. Citado por um preço, não: apagar deixaria um preço sem origem verificável. Editar continua fora de questão nos dois casos. Descartar é feito na lista de cálculos salvos, nos custos industriais do produto, ou na tela de CMV quando a base ficou defasada — não nesta tela.",
      "Referência manual mudada depois, ou compra que entrou depois, não altera este documento. Um cálculo novo pode usar a fonte nova; este continua dizendo o que foi usado e o que teria sido usado.",
      "Material sem preço conhecido não vira zero: o total fica indisponível e o que se mostra é o subtotal conhecido. Zero informado, esse sim, é valor real.",
      "Material fornecido pelo cliente fica de fora do custo da Veridi — não é zero nem desconhecido, e não piora a qualidade do resultado.",
      "Este não é o custo de nenhuma produção realizada. É o custo esperado da base de referência pelo que se sabia naquela data; o custo do que foi produzido de fato vive na ordem de produção.",
      "O sistema nunca escolhe a data sozinho. Trocar a data de referência pode trocar a base inteira do número.",
      "Não é possível salvar um cálculo cuja formulação não consegue dizer quanto material entra — congelar um custo sem matéria-prima seria pior do que não ter cálculo nenhum.",
    ],
  },

  "estruturaCusto.comoFunciona": {
    module: "gestao",
    title: "Estrutura de custos: o que entra no custo de produzir este produto",
    summary:
      "A estrutura de custos é o documento que declara, para um produto, sobre qual versão da formulação se calcula, qual é a base de produção e o que entra além do material: recursos industriais, energia e premissas de custo adicionais. Ela não calcula: o cálculo padrão, no fim da tela, é que transforma a estrutura em número, e salvar um cálculo congela esse número como base econômica. A estrutura é versionada — o rascunho se edita, a versão ativa é história.",
    concepts: [
      {
        term: "Rascunho × Ativa",
        text: "As duas abas do topo. Rascunho é a versão em trabalho, editável; Ativa é a versão em vigor, somente leitura. Um produto tem no máximo um rascunho e uma ativa por vez. Sem versão nenhuma, o botão é “Criar estrutura de custos”; com ativa, “Nova versão” copia a ativa para um rascunho.",
      },
      {
        term: "Resumo",
        text: "Cliente, formulação usada pela estrutura, formulação ativa do produto, base de referência, unidades por caixa, criada e ativada por quem e quando. O rascunho segue a formulação ativa do produto por padrão; escolher outra versão de propósito fixa a escolha.",
      },
      {
        term: "Matérias-primas e embalagens da formulação",
        text: "Vêm da versão da formulação e não são redigitadas aqui: item, quantidade, base, pureza, overage e fornecimento. Material fornecido pelo cliente aparece marcado e fica fora do custo Veridi. O custo de cada material é resolvido no cálculo, não neste bloco.",
      },
      {
        term: "Premissas de custo adicionais",
        text: "O que não vem da formulação nem dos recursos: embalagem secundária, serviço de terceiros, overhead e outros. Cada premissa tem categoria, descrição, base de cálculo (por lote, por unidade, por mil unidades, por caixa de expedição ou percentual sobre o custo direto) e valor. Valor em branco é premissa não informada — nunca zero.",
      },
      {
        term: "Recursos industriais",
        text: "Quanto de mão de obra, equipamento e energia esta base de produção consome, por recurso: quantidade e base de uso. Nenhum valor é multiplicado neste bloco; a tarifa vem do cadastro do recurso e é congelada na ativação.",
      },
      {
        term: "Energia",
        text: "Três modos: não estruturada (a energia é desconhecida, e o custo não fecha), informada diretamente (um consumo em kWh na lista de recursos) ou derivada dos equipamentos (horas × potência, valorizadas pela tarifa do recurso de energia escolhido). Os dois últimos são exclusivos — somar contaria a mesma energia duas vezes.",
      },
      {
        term: "Versões",
        text: "A linha de versões da estrutura: versão, situação, formulação, base, completude e data de ativação. Completude diz se todas as premissas e tarifas estão informadas — ativar com pendências é possível, mas exige confirmação e deixa o custo incompleto.",
      },
      {
        term: "Cálculo padrão",
        text: "Quanto custa produzir a base de referência pelas informações conhecidas na data de referência escolhida. Calcular não grava nada; Salvar cálculo cria um documento imutável, com código próprio, que o CMV e a precificação passam a citar. Cada material mostra a fonte do custo usada, escolhida automaticamente na melhor fonte disponível.",
      },
      {
        term: "Fonte do custo por material",
        text: "Depois de calcular, cada material que tem referência manual de custo no cadastro oferece a escolha: seleção automática (recomendada) ou forçar a referência manual. Forçar vale só para este cálculo e este material, exige motivo ao salvar, e o documento guarda a fonte usada, a que teria sido usada e o impacto.",
      },
      {
        term: "Cálculos salvos",
        text: "A lista dos cálculos congelados do produto. Daqui saem “Criar precificação” e “Usar política” (que também cria uma precificação, a partir de uma política de preço). Cálculo que nenhuma precificação cita pode ser descartado; citado, não.",
      },
      {
        term: "Usar template",
        text: "Copia a configuração de um template de estrutura de custos para o rascunho: recursos, energia e premissas. É cópia, não vínculo — o template pode mudar depois e esta estrutura continua a mesma.",
      },
    ],
    flows: [
      {
        name: "A. Montar e ativar a estrutura",
        when: "No rascunho.",
        steps: [
          {
            label: "Criar ou nova versão",
            detail: "A primeira nasce vazia ou de um template; as seguintes copiam a ativa. Informe a base de referência — o lote mínimo do produto é a sugestão.",
          },
          {
            label: "Recursos e energia",
            detail: "Quanto a base consome de cada recurso, e como a energia entra. Recurso inativo impede ativar: reative ou remova.",
          },
          {
            label: "Premissas adicionais",
            detail: "Embalagem secundária, serviços, overhead. Deixe o valor em branco quando não souber — o cálculo vai dizer que falta, em vez de assumir zero.",
          },
          {
            label: "Ativar estrutura",
            tone: "accent",
            detail: "Congela tarifas, potências, nome dos recursos e unidades por caixa. Com pendências, pede confirmação e o custo fica incompleto até uma versão nova.",
          },
        ],
      },
      {
        name: "B. Calcular e congelar o custo",
        when: "Com a estrutura montada — rascunho ou ativa.",
        steps: [
          {
            label: "Data de referência",
            detail: "Compras posteriores a essa data não entram. Trocar a data pode trocar a fonte de custo de cada material.",
          },
          {
            label: "Calcular custo",
            detail: "Mostra o detalhamento: materiais com fonte e conta, recursos, premissas, subtotais, qualidade do custo e observações com o caminho para resolver cada falta.",
          },
          {
            label: "Fonte do custo",
            detail: "Se algum material tem referência manual, escolha entre automático e forçar. Mudar a escolha recalcula na hora e mostra o impacto antes do motivo.",
          },
          {
            label: "Salvar cálculo",
            tone: "accent",
            detail: "Cria o documento imutável. Salvar incompleto é permitido com confirmação: o total continua sem existir, e o que aparece é o subtotal conhecido.",
          },
          {
            label: "Precificar",
            detail: "Da lista de cálculos salvos: criar precificação ou usar uma política de preço. O preço nasce sempre de um cálculo salvo.",
          },
        ],
      },
    ],
    notes: [
      "A estrutura declara; o cálculo valoriza. Nenhum total aparece nos blocos de recursos e premissas — eles são premissas, não custo.",
      "Versão ativa não se edita. Mudar tarifa, premissa ou recurso é criar uma versão nova; cálculos já salvos sobre a ativa continuam como estão.",
      "Formulação nova no produto não reescreve a estrutura ativa: ela congelou a receita da qual foi feita. Para o custo falar da receita nova, crie uma nova versão da estrutura sobre ela.",
      "Material do cliente fica fora do custo Veridi: não é zero nem desconhecido, e não piora a qualidade do cálculo.",
      "Custo desconhecido nunca vira zero: material sem compra, oferta nem referência manual deixa o total indisponível e aparece nas observações com o caminho — informar o custo num recebimento, registrar uma compra ou definir a referência no item.",
      "Forçar a referência manual não muda o item nem a ordem de seleção: o próximo cálculo volta ao automático.",
      "Imprimir a estrutura é leitura: o papel sai do que está gravado.",
    ],
  },

  "templateCusto.comoFunciona": {
    module: "gestao",
    title: "Templates de Estrutura de Custos: configuração reutilizável, sem tarifa",
    summary:
      "Um template de estrutura é a configuração industrial que se repete entre produtos parecidos: qual base de produção, que recursos e por quanto tempo, como a energia entra e quais premissas se aplicam. Ele não guarda tarifa, preço por hora nem custo calculado. Aplicar um template CRIA UMA CÓPIA — uma estrutura de custos própria do produto, que segue a vida dela sozinha.",
    concepts: [
      {
        term: "Template de estrutura",
        text: "A matriz reutilizável entre produtos e clientes. Ela diz “usar a encapsuladora por 4 horas”; quanto vale essa hora é resolvido no cadastro do recurso, na data de cada cálculo.",
      },
      {
        term: "Versão",
        text: "Cada template tem uma versão ativa e, no máximo, um rascunho. Só o rascunho é editável — versão ativa é histórica, porque estruturas nasceram dela.",
      },
      {
        term: "Base de produção sugerida",
        text: "A quantidade que a configuração descreve. Ela chega ao produto como ponto de partida e pode ser ajustada lá.",
      },
      {
        term: "Uso por lote",
        text: "Quanto de cada recurso a configuração consome — tempo ou consumo, nunca dinheiro.",
      },
      {
        term: "Modo de energia",
        text: "Não estruturada, informada diretamente ou derivada dos equipamentos. Derivada exige dizer qual recurso de energia valoriza o consumo; escolher sozinho seria inventar premissa.",
      },
      {
        term: "Usada por",
        text: "Quantas estruturas de custos nasceram desta versão. Nenhuma delas muda quando o template muda.",
      },
    ],
    flow: [
      {
        label: "Criar ou salvar como template",
        detail:
          "Ou começa vazio, ou parte de uma estrutura de custos que já deu certo em um produto — e o que atravessa é só a configuração.",
      },
      {
        label: "Montar o rascunho",
        detail:
          "Base de produção, recursos, modo de energia e premissas. Só quantidade e configuração; nenhum valor em reais.",
      },
      {
        label: "Ativar a versão",
        tone: "accent",
        detail:
          "A partir daqui a configuração pode ser reutilizada. Alterar depois exige uma versão nova: a ativa é histórica.",
      },
      {
        label: "Aplicar a um produto",
        detail:
          "Nasce uma estrutura de custos em rascunho no produto, com código próprio, para ser revisada e ativada lá.",
      },
      {
        label: "Calcular",
        detail:
          "As tarifas entram só no cálculo, pela tabela vigente na data de referência — nunca pela data em que a matriz foi escrita.",
      },
    ],
    notes: [
      "A ausência de tarifa é o ponto. Um preço por hora congelado na matriz seria um número sem data: copiado em dez produtos e lido seis meses depois, cotaria a máquina pelo valor do ano passado enquanto o cadastro do recurso mostraria o correto, e nada na tela explicaria a diferença.",
      "Aplicar copia, não liga. Mudar o template depois não mexe em nenhuma estrutura que já nasceu dele, e mexer na estrutura do produto não volta para o template.",
      "Versão nova do template é avisada, nunca aplicada por cima. Comparar e criar uma versão nova são as saídas — atualizar no lugar reescreveria uma estrutura que já pode ter explicado um custo, um preço e uma produção.",
      "Se o produto já tem uma estrutura em rascunho com configuração própria, aplicar o template é recusado, nomeando o rascunho. Ativar ou descartar é decisão de quem está trabalhando nele.",
      "Não se ativa uma versão sem nenhum recurso e nenhuma premissa: ela não descreveria configuração nenhuma.",
      "Arquivar tira o template dos documentos novos. O que já nasceu dele continua exatamente como está.",
      "A comparação entre versões mostra configuração, nunca dinheiro resolvido: “R$ 88 → R$ 110” faria parecer que o template mudou quando só a tarifa do cadastro mudou.",
    ],
  },

  "politicaPreco.comoFunciona": {
    module: "gestao",
    title: "Políticas de Precificação: regra comercial reutilizável, nunca preço",
    summary:
      "Uma política guarda a regra comercial que se repete: em que faixas de quantidade se vende, com que margem de contribuição desejada e que comissão. Ela NÃO guarda preço. O preço de cada faixa nasce do custo daquele produto no momento em que a política é aplicada — a mesma política dá preços diferentes em produtos diferentes, e é esse o motivo de ela ser uma regra e não uma tabela de números.",
    concepts: [
      {
        term: "Política de precificação",
        text: "A matriz comercial reutilizável entre produtos e clientes: faixas, margem alvo e comissão. Serve a qualquer produto justamente porque não carrega o custo de nenhum.",
      },
      {
        term: "Versão",
        text: "Uma versão ativa e, no máximo, um rascunho. Só o rascunho é editável — versão ativa é histórica, porque precificações nasceram dela.",
      },
      {
        term: "Faixa",
        text: "Uma quantidade com a margem desejada e a comissão dela. Aplicar gera exatamente essas quantidades: uma política de 500/1.000/3.000 não inventa uma faixa de 750 que ninguém aprovou.",
      },
      {
        term: "Margem alvo",
        text: "A margem de contribuição que se pretende atingir. O preço é a consequência dela e do custo do produto, nunca um número guardado na política.",
      },
      {
        term: "Prévia",
        text: "Os preços que a política produziria NESTE produto, mostrados antes de gravar qualquer coisa. Usa exatamente o mesmo cálculo da precificação, para prévia e aplicação não divergirem.",
      },
      {
        term: "Usada por",
        text: "Quantas precificações nasceram desta versão. Nenhuma delas muda quando a política muda.",
      },
    ],
    flow: [
      {
        label: "Criar ou salvar como política",
        detail:
          "Ou começa vazia, ou parte de uma precificação que já deu certo — e o que atravessa é só a regra.",
      },
      {
        label: "Montar as faixas",
        detail: "Quantidade, margem alvo e comissão. Nenhum preço, em nenhuma linha.",
      },
      {
        label: "Ativar a versão",
        detail:
          "A partir daqui a política pode ser aplicada. Alterar depois exige uma versão nova.",
      },
      {
        label: "Aplicar a um produto",
        tone: "accent",
        detail:
          "Escolha o produto e o cálculo de custo salvo que serve de base. A prévia mostra os preços daquele produto antes de qualquer coisa ser gravada.",
      },
      {
        label: "Ativar a precificação",
        detail:
          "A precificação criada nasce em rascunho e segue o caminho normal: revisar as faixas e ativar quando o preço estiver acordado.",
      },
    ],
    notes: [
      "A política não guarda preço, e isso é deliberado: copiar “R$ 44,90” de um produto para outro levaria o custo alheio disfarçado de decisão comercial, e o erro só apareceria na margem real meses depois.",
      "Faixa com preço informado à mão não vira política. Preço digitado é decisão de uma negociação sobre um custo específico, não regra reutilizável: ao salvar uma precificação como política essas faixas ficam de fora, e uma precificação sem nenhuma faixa por margem é recusada.",
      "Aplicar exige um cálculo de custo salvo do produto. Sem base de custo não há preço a calcular — o preço nasce do custo, não da política.",
      "Custo incompleto continua bloqueando o preço sugerido. A política não contorna a regra: onde falta custo, a prévia diz que falta.",
      "Aplicar copia, não liga. Mudar a política depois não mexe em nenhuma precificação que já nasceu dela.",
      "O produto admite um rascunho de precificação por vez. Havendo um aberto, é nele que a política entra, em vez de nascer um segundo em paralelo.",
      "Versão nova é avisada, nunca aplicada por cima — a precificação atual pode já ser um preço acordado com o cliente.",
      "A comparação entre versões mostra regra, nunca preço resultante: “R$ 44,90 → R$ 41,20” faria parecer que a política mudou quando só o custo do produto mudou.",
    ],
  },

  "relatorio.comoFunciona": {
    module: "gestao",
    title: "Como ler um relatório: filtro, recorte e o que vai para o papel",
    summary:
      "Todo relatório é uma consulta somente leitura, montada na hora sobre os documentos que já existem. Ele não guarda número, não congela nada e não altera a operação. O que está na tela é a leitura deste instante: refazer a mesma consulta depois de uma movimentação devolve outro número, e esse é o comportamento correto.",
    concepts: [
      {
        term: "Filtro",
        text: "Define o resultado inteiro. O total informado é o do recorte filtrado, não o da página que está à vista.",
      },
      {
        term: "Página",
        text: "Só o pedaço exibido. Trocar de página não muda o resultado nem o total — filtro e paginação são coisas diferentes.",
      },
      {
        term: "Data do relatório",
        text: "Cada relatório filtra pela data que faz sentido no assunto dele: consumo pela data do consumo, recebimento pela data de recebimento, faturamento pela data de emissão. Nenhum usa a data da última alteração do registro.",
      },
      {
        term: "Resumo",
        text: "Os números do topo. Valem para o recorte filtrado inteiro, não para a página.",
      },
      {
        term: "Exportar CSV",
        text: "Leva o recorte filtrado completo, gerado de novo no servidor — nunca as linhas que estavam na tela e nunca só a página atual.",
      },
      {
        term: "Imprimir / Salvar PDF",
        text: "Abre a versão de papel do mesmo recorte, com o nome do relatório, os filtros realmente aplicados e a data de geração no cabeçalho.",
      },
    ],
    flow: [
      {
        label: "Filtrar",
        detail:
          "Os filtros definem o recorte. Alguns já vêm ligados, e o cabeçalho impresso registra quais valeram.",
      },
      {
        label: "Ler",
        detail:
          "Resumo no topo, detalhe abaixo. Os códigos de documento são clicáveis e levam ao documento de origem.",
      },
      {
        label: "Conferir no documento",
        tone: "accent",
        detail:
          "Havendo divergência, o documento é que vale. O relatório é consulta sobre ele, nunca uma segunda verdade.",
      },
      {
        label: "Levar",
        detail:
          "CSV para planilha ou impressão para o papel — os dois com o mesmo recorte filtrado, completo.",
      },
    ],
    notes: [
      "Relatório não é documento: não guarda estado, não congela número e não substitui a tela do pedido, da ordem ou do lote.",
      "Abrir, filtrar e exportar não mudam nada na operação. Nenhum relatório mexe em saldo, situação ou documento.",
      "Valor desconhecido nunca vira zero. No CSV a célula fica vazia, na impressão sai “—”, e onde o custo é parcial o número continua rotulado como subtotal.",
      "Quantidades de unidades diferentes não são somadas. Onde a soma não faria sentido, o relatório conta itens ou documentos.",
      "O CSV sai no formato de planilha brasileira, com ponto e vírgula, datas e decimais em pt-BR. Código de documento, CNPJ, código de barras e número de lote saem como texto, nunca convertidos em outra coisa pela planilha.",
      "A impressão nasce em uma página própria: o que vai para o papel é o recorte com cabeçalho, não a tela de trabalho.",
    ],
  },

  "consultaCliente.comoFunciona": {
    module: "gestao",
    title: "Consulta de Cliente: aqui o cliente é a raiz",
    summary:
      "A Consulta reúne sob um cliente só o que já existe espalhado pelos módulos: produtos, projetos, pedidos, produção, estoque e faturamentos. Aqui dentro o cliente é a RAIZ da navegação — abrir um projeto, um pedido ou um faturamento troca de aba sob o mesmo cabeçalho, não troca de assunto. É consulta: nada se cria, se altera ou se cancela por aqui.",
    concepts: [
      {
        term: "Abas",
        text: "Cada aba é uma seção do mesmo cliente. Trocar de aba nunca perde o cliente escolhido, e o cabeçalho continua o mesmo.",
      },
      {
        term: "Trilha",
        text: "O caminho no topo volta sempre para dentro da consulta: “Projetos” ali são os projetos DESTE cliente, nunca a lista geral.",
      },
      {
        term: "Abrir … completo",
        text: "A única saída para o módulo operacional, e é sempre uma ação declarada. Nenhum clique comum tira você da consulta.",
      },
      {
        term: "Trocar cliente",
        text: "Volta para a busca. É assim que se muda de cliente — o sistema não guarda um “cliente atual” por trás das outras telas.",
      },
      {
        term: "Resumo",
        text: "Os contadores por módulo, para saber por onde começar. Eles mudam quando alguém opera em outra tela e são relidos ao voltar.",
      },
    ],
    flow: [
      {
        label: "Buscar o cliente",
        detail:
          "A consulta começa pela busca. O cliente escolhido passa a ser o contexto de tudo o que vem depois.",
      },
      {
        label: "Ver o resumo",
        detail: "Quanto o cliente tem em cada módulo — produtos, projetos, pedidos, produção, estoque e faturamentos.",
      },
      {
        label: "Navegar pelas abas",
        tone: "accent",
        detail:
          "Sempre do mesmo cliente, sempre sob o mesmo cabeçalho. É esta parte que evita perder o cliente ao pular de um documento para outro.",
      },
      {
        label: "Sair, quando precisar operar",
        detail:
          "Use “Abrir … completo” e vá ao módulo. Confirmar pedido, aplicar plano, liberar ordem e faturar acontecem lá, não aqui.",
      },
    ],
    notes: [
      "A consulta é somente leitura. Ela não cria, não altera e não cancela nada — é o mesmo dado dos módulos, visto pelo cliente.",
      "O cliente escolhido está no endereço da página. Recarregar, abrir em outra aba, mandar o link a alguém e usar voltar e avançar do navegador funcionam sem nenhum ajuste.",
      "Um documento de outro cliente não abre por aqui, mesmo com o endereço correto: a consulta responde como se ele não existisse. Confirmar que existe já seria vazar a informação que o escopo protege.",
      "As listas são as mesmas dos módulos, filtradas por este cliente. Não há uma segunda contagem paralela que possa discordar.",
      "A aba Estoque carrega duas coisas diferentes: o produto acabado que a Veridi fez para este cliente e o material que é propriedade dele.",
    ],
  },
} satisfies Record<string, HelpTopic>;
