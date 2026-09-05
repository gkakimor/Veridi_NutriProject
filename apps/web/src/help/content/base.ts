import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Conteúdo escrito na primeira rodada de ajuda — formulação, plano, ordem de
 * produção, CMV e faturamento. Fica separado dos módulos novos para que uma
 * revisão de texto não precise abrir o registro inteiro.
 */
export const baseTopics = {
  "formulacao.comoFunciona": {
    module: "producao",
    title: "Formulação: a receita em versões, e o que cada número significa",
    summary:
      "A formulação é a receita oficial de um produto: quais matérias-primas e embalagens entram, quanto de cada uma, e sobre qual base essa quantidade é declarada. Ela não é editada no lugar — é escrita em versões. Uma versão vale enquanto é rascunho e vira documento no momento em que é ativada: dali em diante ela não muda mais, e é ela que a produção executa e que o custo e o preço leem. Esta ajuda cobre a lista de versões do produto e a tela de uma versão.",
    concepts: [
      {
        term: "Versão e situação",
        text: "Cada revisão da receita é uma versão própria, com número e situação: Rascunho, Ativa ou Inativa. Mudar a receita é criar uma versão nova, nunca reescrever a anterior — é assim que o histórico do que já foi produzido continua verdadeiro. Só existe uma versão ativa por produto.",
      },
      {
        term: "Produto e base",
        text: "O bloco de cima da versão: o produto, o item de saída (o produto acabado que a receita produz), a base da formulação — a quantidade de produto acabado que a receita abaixo produz — e o modo de cálculo. Tudo o que os componentes declaram se refere à base.",
      },
      {
        term: "Modo de cálculo: base fixa × por dose",
        text: "Base fixa: as quantidades declaradas produzem a base informada, e é isso. Por dose: a quantidade de cada componente é declarada para UMA dose e multiplicada pelas doses por embalagem. Embalagem continua por unidade acabada — não se multiplica por dose.",
      },
      {
        term: "Doses por embalagem",
        text: "Quantas doses cabem em uma unidade acabada. É obrigatório assim que existe componente por dose: sem esse número a versão não ativa, e o custo de material não existe — não é zero.",
      },
      {
        term: "Componente",
        text: "Uma linha da receita: um item de estoque, a base da linha (base da fórmula, por dose ou por unidade acabada), quem fornece (Veridi ou cliente), a quantidade informada e a unidade em que ela foi digitada.",
      },
      {
        term: "Quantidade informada × equivalente estoque × físico por unidade",
        text: "Três números da mesma linha. A quantidade informada é o que você digitou, na unidade que escolheu. Equivalente estoque é essa quantidade convertida para a unidade em que o item é comprado e estocado. Físico por unidade é o que sai do estoque por unidade acabada, já com os ajustes que a linha autoriza — é este que a ordem de produção reserva e consome.",
      },
      {
        term: "Ajustes da quantidade: o que a quantidade informada significa",
        text: "Cada componente declara uma de duas coisas. “Quantidade física informada”: a quantidade digitada já representa o material que será usado; pureza e overage podem ser registrados, mas não alteram a quantidade. “Calcular quantidade física”: você informa a quantidade teórica e escolhe quais ajustes de pureza e overage devem ser aplicados — só os marcados entram na conta.",
      },
      {
        term: "Pureza e overage",
        text: "Pureza é o teor real do insumo; overage é o excesso declarado de propósito para compensar perda. Preencher REGISTRA; marcar AUTORIZA. Sem a marcação, os dois ficam documentados na linha e não alteram a quantidade. Pureza em branco é desconhecida — nunca 100%.",
      },
      {
        term: "Aviso de dupla correção",
        text: "A tela avisa para não marcar a correção quando a quantidade informada já veio corrigida de origem: corrigir de novo aplicaria a divisão pela pureza uma segunda vez, e a linha passaria a reservar mais material do que a receita pede.",
      },
      {
        term: "Fornecimento",
        text: "Diz de quem é o material: Veridi ou o cliente. Material do cliente entra na receita e na necessidade de material, mas nunca no custo de aquisição da Veridi, e exige produto vinculado a um cliente.",
      },
      {
        term: "Custo estimado de materiais",
        text: "Bloco de leitura, com a estimativa de HOJE: lê a fonte de custo vigente de cada componente a cada abertura e nunca é gravado na versão. O CMV e a precificação leem a base congelada do cálculo salvo — por isso os dois podem discordar, e é o cálculo salvo que vale como documento.",
      },
      {
        term: "Pendências",
        text: "Painel no alto da versão com o que impede ativar ou custear — item sem premissa, doses por embalagem em branco. Cada pendência tem o caminho para ser resolvida, como “Abrir o item”.",
      },
    ],
    flows: [
      {
        name: "A. Montar e ativar uma versão",
        when: "Na tela de uma versão em rascunho.",
        steps: [
          {
            label: "Nova versão",
            tone: "accent",
            detail:
              "Nasce em rascunho. Criada a partir da versão ativa, já vem com a receita atual copiada — você altera só o que mudou.",
          },
          {
            label: "Produto e base",
            detail:
              "Base da formulação, modo de cálculo e, havendo componente por dose, doses por embalagem. Decida antes de digitar quantidade: a base muda o que cada número significa.",
          },
          {
            label: "Componentes",
            detail:
              "Uma linha por item de estoque: base da linha, fornecimento, quantidade e unidade. Equivalente estoque e físico por unidade aparecem ao lado, calculados enquanto você digita.",
          },
          {
            label: "Ajustes da quantidade",
            detail:
              "Por linha: diga se a quantidade já é física ou se deve ser calculada, e marque só os ajustes que valem. A conta aparece explicada ao lado do físico por unidade.",
          },
          {
            label: "Salvar rascunho",
            detail:
              "Guarda o trabalho sem autorizar uso: rascunho não é executado pela produção nem lido pelo custo. Salvar quantas vezes precisar.",
          },
          {
            label: "Ativar versão",
            tone: "accent",
            detail:
              "Grava o rascunho e fecha a versão, substituindo a ativa anterior. A partir daqui a receita não muda mais, e é ela que a produção passa a executar.",
          },
        ],
      },
      {
        name: "B. Histórico de versões",
        when: "Na tela da formulação do produto, que lista a versão ativa e todas as anteriores.",
        steps: [
          {
            label: "Item acabado",
            detail: "O item de estoque que a receita produz. Vem do cadastro do Produto, não se escolhe aqui.",
          },
          {
            label: "Formulação ativa",
            detail:
              "A versão em vigor, com base e modo de cálculo. “Nenhuma versão ativa” significa que o produto ainda não pode ser produzido nem custeado.",
          },
          {
            label: "Histórico de versões",
            detail:
              "Versão, situação, origem, base, criada em e ativada em. Cada linha abre a versão — as inativas continuam legíveis, porque ordens antigas apontam para elas.",
          },
          {
            label: "Criar nova versão",
            tone: "accent",
            detail:
              "Copia a versão ativa para um rascunho novo. Enquanto ele é trabalhado, a ativa continua valendo.",
          },
        ],
      },
      {
        name: "C. Da versão ativa ao preço",
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
              "Aplica as fontes de custo de uma data à estrutura e congela o resultado. É o documento que a precificação lê.",
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
      "Preencher pureza ou overage não aplica correção nenhuma. A correção só acontece em componente “Calcular quantidade física” com o ajuste marcado. Em “Quantidade física informada” os dois campos são registro de auditoria.",
      "Não marque a correção se a quantidade informada já estiver corrigida — ela seria aplicada duas vezes. É o aviso que a própria linha mostra.",
      "Por dose: a quantidade do componente é declarada para UMA dose e multiplicada pelas doses por embalagem. Sem doses por embalagem a versão não ativa e o custo de material não existe — não é zero.",
      "Ativar grava o rascunho antes: o que está na tela é o que vira versão ativa, não a última gravação.",
      "Material fornecido pelo cliente é declarado na própria versão e segue congelado na ordem de produção. Ele entra na receita e na necessidade de material, mas nunca no custo de aquisição da Veridi.",
      "Versão com componente do cliente só ativa se o produto tiver cliente vinculado: sem cliente não existe estoque elegível para aquele componente.",
      "Observações e notas técnicas são texto livre da versão: não entram em cálculo nenhum.",
    ],
  },
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
        term: "Folha de Receita e folha de separação",
        text: "A Folha de Receita (R.COQ.003) é o documento de execução: quem pesou, quanto, de qual lote e quando, parte por parte quando a ordem é fracionada. A pesagem registrada ali baixa o material pelo mesmo consumo real desta tela. A folha de separação (FO-04) é o papel de quem vai buscar o material: lista os lotes reservados com validade e localização.",
      },
      {
        term: "Lote diferente na separação",
        text: "Lote conferido diferente do reservado nunca é aceito em silêncio: os dois códigos aparecem e a troca precisa ser uma ação explícita. A substituição só vale antes de qualquer consumo na linha, exige um único lote alternativo, do mesmo dono, que cubra a quantidade inteira, e a linha original fica registrada.",
      },
      {
        term: "Consumo extra",
        text: "Pesou mais do que a receita pedia? “Adicionar consumo extra” amplia a reserva daquela linha sobre o saldo realmente livre do lote, com motivo obrigatório — e só depois disso o material pode ser consumido. Ampliar não é consumir.",
      },
      {
        term: "Justificar diferença",
        text: "Antes de concluir, cada material cujo consumido ficou diferente do reservado precisa de um motivo. É a reconciliação de material: sem ela a ordem não conclui, e o motivo fica gravado com autor e data na própria linha.",
      },
      {
        term: "Lote interno × Lote Veridi",
        text: "No apontamento de produção nascem os dois: o lote interno é o código que o sistema cria e que vai no QR; o Lote Veridi é o número comercial que vai para o rótulo, informado por quem aponta. A tela sugere a máscara; o operador confirma ou informa outro.",
      },
      {
        term: "Custo industrial da ordem",
        text: "Bloco de leitura: material realmente consumido, lote a lote, com custo unitário e origem, mais os custos industriais padrão aplicados na proporção do produzido. É híbrido — horas de operador, de máquina e energia não são medidas, vêm da estrutura de custos. Material sem preço fica em aberto, nunca zero.",
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
          "Apontamento do que efetivamente saiu da linha, com quantidade, lote interno e Lote Veridi. Produção parcial é permitida e pode ter vários apontamentos.",
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
      "Concluir exige reconciliar o material: toda diferença entre reservado e consumido precisa do motivo registrado em “Justificar diferença”. Concluir também pede o motivo quando o produzido ficou abaixo do planejado.",
      "Necessidade de materiais mostra Em Compra só como informação: material pedido ao fornecedor não cobre liberação. Falta com material já no galpão costuma ser lote aguardando a Qualidade ou reservado por outra ordem.",
      "A ordem guarda a versão da formulação que executou — ativar uma versão nova depois nunca reescreve uma ordem já emitida.",
      "Depois do primeiro consumo a ordem não pode mais ser cancelada: material físico já saiu, e desfazer isso pede um fluxo de devolução que ainda não existe.",
      "Imprimir a ordem, a folha de separação (FO-04) e o custo da ordem são leituras: nenhuma impressão altera a ordem.",
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
      {
        term: "Prévia e valor gravado",
        text: "Enquanto o faturamento é rascunho, o rodapé mostra \u201cValor total (prévia)\u201d: o total dos preços que estão na tela agora. Quando ele difere do último salvamento, o valor gravado aparece ao lado, com esse nome. Alterar um preço mostra, antes de confirmar, o total da linha e o total do documento que vão resultar — e nada disso é gravado até a confirmação. Preço em branco ou ilegível não vira zero: a linha fica sem total e o documento fica sem valor.",
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
      "A tela do documento tem Observações, Auditoria (quem criou, emitiu ou cancelou, e quando) e Imprimir. Nenhum deles altera valor.",
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
        text: "Só existe quando todas as linhas têm preço. Faltando alguma, o documento mostra valores incompletos em vez de somar parte — e o faturamento quantitativo continua válido.",
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
    text: "Quanto sai do estoque por unidade acabada, com os ajustes que ESTE componente autoriza. É o número que a ordem de produção reserva e consome, e ele fica congelado na ordem: ativar uma versão nova da formulação não recalcula ordem que já existe.",
  },
} satisfies Record<string, HelpHint>;

