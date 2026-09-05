import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Comercial — projetos, amostras, pedidos, expedições e faturamento.
 *
 * Cada tópico começa dizendo O QUE A TELA É — a entidade, do que ela é
 * feita e o que ela não é. Só depois vem o caminho. Ajuda que abre pela
 * cadeia macro ("Projeto → Produto → Pedido") situa a tela no mundo e
 * deixa quem está nela sem saber o que tem na frente.
 *
 * A divisão com `comercialHints` é deliberada: o painel explica a TELA, o
 * ⓘ explica uma PALAVRA que aparece em rótulo ou cabeçalho de coluna
 * ("Reservado disponível" não é "quantidade reservada"). Um não substitui
 * o outro, e nenhum dos dois é lugar para nome de campo de banco.
 */
export const comercialTopics = {
  "comercial.projetos": {
    module: "comercial",
    title: "O que é um Projeto e como ele anda no funil",
    summary:
      "Projeto é a negociação private label registrada antes de o produto existir: um cliente, um conceito, um canal, um responsável e o brief técnico do que se pretende fazer. Esta lista é o funil inteiro — cada linha diz em que estágio a conversa está e qual foi a última versão de orçamento. Projeto não é produto nem pedido: o produto operacional só nasce quando o projeto é aprovado.",
    concepts: [
      {
        term: "Projeto",
        text: "A negociação de um produto private label para um cliente: conceito, canal, responsável e o brief técnico do que se pretende fazer. Ele guarda a intenção — o produto operacional só existe depois da aprovação.",
      },
      {
        term: "Status",
        text: "Em que estágio do funil a conversa está: Aguardando, Amostra, Stand-by, Aprovado ou Cancelado. Aprovado e cancelado são terminais — dali em diante o projeto é somente leitura.",
      },
      {
        term: "Conceito e canal",
        text: "O que se pretende desenvolver e por onde a oportunidade chegou. São texto livre com sugestão do que já foi usado: vocabulário aberto, que cresce com o negócio em vez de ficar preso a uma lista fixa.",
      },
      {
        term: "Última versão",
        text: "Cada negociação é uma versão numerada de orçamento, e a coluna mostra a mais recente. Só o rascunho é editável, e existe no máximo um rascunho aberto por projeto.",
      },
      {
        term: "Produto",
        text: "O produto operacional do projeto. Vazio quer dizer que ninguém preparou o produto técnico ainda: a aprovação cria um, ou promove o que já estava em desenvolvimento.",
      },
      {
        term: "Código legado",
        text: "O número que o projeto tinha na planilha antiga. Só os registros importados o têm, e ele serve para reencontrar o projeto pelo identificador que a equipe já conhece.",
      },
      {
        term: "Histórico do pipeline",
        text: "Toda mudança de estágio fica registrada com autor, data e motivo. A data da última alteração do registro não conta essa história.",
      },
      {
        term: "Novo projeto",
        text: "A ação principal desta lista. Abre o cadastro do projeto: cliente (obrigatório), conceito, canal, responsável e o perfil técnico pretendido. O projeto nasce em Aguardando.",
      },
      {
        term: "Filtros e exportação",
        text: "Busca por código, código legado, nome ou cliente; filtros por situação, cliente e canal. Exportar leva exatamente o recorte filtrado.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Projeto que avança",
        when: "A negociação segue em frente, com ou sem amostra pelo caminho.",
        steps: [
          {
            label: "Aguardando",
            detail:
              "Estágio de entrada, onde todo projeto nasce — sempre com um cliente, porque private label não existe sem dono.",
          },
          {
            label: "Amostra",
            detail:
              "O projeto entra neste estágio sozinho, na hora em que a primeira amostra é criada. A mudança fica registrada no histórico, nunca é uma troca silenciosa.",
          },
          {
            label: "Orçamento",
            detail:
              "Cada negociação é uma versão. Só o rascunho é editável e existe no máximo um rascunho aberto por projeto; enviar congela a versão.",
          },
          {
            label: "Aceite",
            detail:
              "Registro operacional de que o cliente concordou com aquela versão. Não é assinatura eletrônica.",
          },
          {
            label: "Aprovado",
            tone: "accent",
            detail:
              "Exige orçamento aceito. Na mesma ação o produto operacional é criado ou promovido: aqui o funil termina e a operação começa.",
          },
        ],
      },
      {
        name: "Fluxo B · Projeto que não fecha",
        when: "O cliente adia, some ou desiste — e o funil precisa dizer isso sem apagar a negociação.",
        steps: [
          {
            label: "Aguardando ou Amostra",
            detail:
              "De onde se sai. Projeto já aprovado ou já cancelado não volta para nenhum destes dois estágios.",
          },
          {
            label: "Stand-by",
            tone: "warn",
            detail:
              "Pausa reversível: quando o cliente retomar, o projeto volta para aguardando ou para amostra e a negociação continua de onde parou.",
          },
          {
            label: "Cancelado",
            tone: "warn",
            detail:
              'Exige motivo, e "Outro" exige a descrição. É terminal: não reabre e não aceita edição depois.',
          },
        ],
      },
    ],
    notes: [
      "Aprovado e cancelado são terminais. O projeto vira somente leitura: não aceita edição, amostra nova nem orçamento novo.",
      "Toda mudança de estágio entra no histórico do projeto, com autor e data. A data da última alteração não conta essa história.",
      "Trocar o cliente só é possível enquanto nenhum orçamento foi formalizado. Depois disso, trocar reescreveria a história comercial.",
      "Conceito e canal são texto livre, com sugestão do que já foi usado. O vocabulário cresce com o negócio em vez de ficar preso a uma lista fechada.",
      "Projeto importado da planilha antiga pode chegar com estágio ou desfecho incompletos. Ele vem marcado como legado e não é completado por conta própria.",
    ],
  },

  "comercial.projeto": {
    module: "comercial",
    title: "O que a ficha do Projeto reúne — e o que a aprovação libera",
    summary:
      "Esta é a ficha completa de uma negociação: o cliente, os produtos que o projeto desenvolve, a cadeia de custo e preço de cada um, as versões de orçamento e as amostras já feitas. O preço de cada linha da proposta ou vem de uma faixa da precificação ativa do produto, ou é digitado à mão — e a proposta continua editável só enquanto é rascunho. É a proposta aceita que autoriza aprovar o projeto, e é a aprovação que promove o produto de desenvolvimento a produto operacional.",
    concepts: [
      {
        term: "Produto técnico",
        text: "O produto que o projeto cria enquanto ainda está em desenvolvimento. Pode ter fórmula, custo e preço, mas não entra em pedido, produção comercial, expedição nem faturamento. A aprovação promove ESSE mesmo produto — não cria outro.",
      },
      {
        term: "Versão de orçamento",
        text: "Cada proposta é uma versão com situação própria: rascunho, enviado, aceito, recusado ou substituído. Só o rascunho é editável, e uma negociação nova é sempre uma versão nova.",
      },
      {
        term: "Enviado",
        text: "Registra que a proposta foi apresentada ao cliente e congela cliente, projeto e a origem do preço. A versão vira somente leitura — e não dispara e-mail nenhum.",
      },
      {
        term: "Faixa de precificação",
        text: "Um cenário econômico fechado: uma quantidade com o preço calculado para ela. A linha só se prende à faixa cuja quantidade bate exatamente com a cotada — não existe faixa mais próxima.",
      },
      {
        term: "Preço manual",
        text: "Preço digitado direto na linha, sem faixa por trás. É exceção comercial legítima: aparece como aviso, não como bloqueio, e a proposta fica sem origem de preço registrada.",
      },
      {
        term: "Aceite",
        text: "Registro operacional de que o cliente concordou com aquela versão. Não é assinatura eletrônica — e é exatamente o que a aprovação do projeto exige.",
      },
      {
        term: "Proveniência do preço",
        text: "De onde o preço veio: precificação, cálculo de custo, margem, markup e comissão. É informação interna e nunca sai no documento do cliente.",
      },
      {
        term: "Produtos do projeto",
        text: "Um projeto pode desenvolver vários produtos, cada um com fórmula, custo e preço próprios. A tabela mostra a situação técnica e a situação no projeto de cada um, a última amostra e a cadeia técnica (formulação, custos, CMV, precificação). “Criar novo produto” prepara um produto técnico; “Vincular produto existente” traz um que já existe.",
      },
      {
        term: "Condições comerciais",
        text: "Da versão de orçamento: validade da proposta, prazo de entrega, desconto, forma de pagamento, entrada, parcelas, intervalo e juros ao mês, mais observações comerciais. Editáveis só no rascunho. O plano de parcelas (valor e vencimento de cada parcela) é calculado a partir delas e do total.",
      },
      {
        term: "Prévia e total salvo",
        text: "Na versão em rascunho, o total da linha e o \u201cTotal da proposta (prévia)\u201d acompanham o que está nos campos, sem esperar o salvamento. Enquanto houver digitação pendente, o total do último salvamento aparece ao lado como \u201cTotal salvo\u201d — o campo grava ao perder o foco. Quantidade ou preço em branco não viram zero: sem eles não há total. Versão enviada ou aceita é histórico e não recalcula: o total dela é o que o cliente recebeu.",
      },
      {
        term: "Simular CMV",
        text: "Atalho da linha do orçamento para a tela de CMV, já com o produto e a quantidade cotada. É leitura: não muda preço nem grava nada.",
      },
      {
        term: "Fechamento",
        text: "Depois do aceite: o resumo da proposta aceita e o pedido gerado a partir dela. Uma proposta aceita gera no máximo um pedido, e só depois do projeto aprovado.",
      },
      {
        term: "Recusa",
        text: "“Registrar recusa” marca a versão como recusada. O projeto continua vivo — uma nova versão pode ser negociada.",
      },
      {
        term: "Documentos do projeto",
        text: "Anexos de referência: briefing, arte e ficha técnica. Documentação, não trava operação nenhuma.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Preço vindo da precificação",
        when: "Há tempo de preparar o produto técnico e calcular o custo antes de propor.",
        steps: [
          {
            label: "Produto técnico",
            detail:
              '"Preparar produto técnico" cria o produto em desenvolvimento. É o MESMO produto que a aprovação promove depois: mesmo código, mesma fórmula, mesma história. Preparar não muda o estágio do projeto — é trabalho de engenharia, não decisão comercial.',
          },
          {
            label: "Custo e preço",
            detail:
              "Formulação, estrutura de custos, cálculo e precificação vivem no produto; o projeto acompanha a cadeia. Só faixa de uma versão de precificação ATIVA embasa proposta — preço em rascunho não vai ao cliente.",
          },
          {
            label: "Faixa da precificação",
            detail:
              "A linha do orçamento se prende a uma faixa por quantidade, e a quantidade da faixa tem que bater exatamente com a quantidade cotada — não existe faixa mais próxima nem interpolação. Presa à faixa, a linha não aceita quantidade, unidade e preço digitados; validade, pagamento e prazo continuam editáveis.",
          },
          {
            label: "Orçamento enviado",
            tone: "accent",
            detail:
              "Enviar registra que a proposta foi apresentada — não dispara e-mail. Congela cliente, projeto e a origem do preço, linha a linha, e torna a versão somente leitura.",
          },
          {
            label: "Aceite do cliente",
            detail:
              "Registro operacional de que o cliente concordou com aquela versão. Renegociar é criar uma versão nova; a anterior fica como substituída.",
          },
          {
            label: "Projeto aprovado",
            tone: "accent",
            detail:
              "Só com orçamento aceito. Promove a produto operacional exatamente os produtos que estão na proposta aceita — os demais continuam em desenvolvimento, com a história técnica inteira preservada.",
          },
          {
            label: "Pedido gerado",
            detail:
              "O pedido nasce da proposta aceita, com os preços que o cliente aceitou — nunca com preço recalculado. Uma proposta aceita gera no máximo um pedido, e só depois do projeto aprovado.",
          },
        ],
      },
      {
        name: "Fluxo B · Preço manual",
        when: "Não existe faixa de precificação para a quantidade cotada — e o negócio não pode esperar por ela.",
        steps: [
          {
            label: "Projeto",
            detail:
              "O produto pode nem existir ainda: quem não preparou produto técnico chega até a proposta assim mesmo.",
          },
          {
            label: "Preço digitado",
            detail:
              "Quantidade, unidade e preço são informados na linha. É exceção comercial legítima: aparece como aviso, não como bloqueio.",
          },
          {
            label: "Orçamento enviado",
            tone: "accent",
            detail:
              "Mesmo congelamento do fluxo A. O que não existe aqui é a origem do preço — proposta manual não recebe proveniência depois.",
          },
          {
            label: "Aceite do cliente",
            detail: "Igual ao fluxo A: registro de que o cliente concordou com aquela versão.",
          },
          {
            label: "Projeto aprovado",
            tone: "accent",
            detail:
              "Sem produto preparado, a aprovação cria o produto acabado — e para isso precisa da unidade do produto acabado.",
          },
          {
            label: "Pedido gerado",
            detail:
              "A unidade da proposta e a do produto acabado precisam ser a mesma: converter mudaria a quantidade sem mudar o preço acordado.",
          },
        ],
      },
    ],
    notes: [
      "Enviado é congelamento: a versão vira somente leitura. Renegociar é criar uma nova versão — nunca editar a que o cliente já viu.",
      "Desprender a linha da faixa passa para preço manual, mantém o valor como ponto de partida e apaga a origem do preço. Vínculo que sobrevivesse à edição manual seria mentira.",
      "Faixa com custo industrial incompleto pode virar proposta, mas enviar exige confirmação explícita, e o congelado registra que a margem não era calculável.",
      "Custo, margem, markup e comissão são informação interna: não entram no documento do cliente, e só perfis comercial e administrativo os enxergam.",
      "Aprovar duas vezes não cria um segundo produto, e aprovar exige orçamento aceito — pelo estágio, não pela boa vontade da tela.",
      "Cancelar o projeto desativa apenas o produto em desenvolvimento que aquele projeto criou. Nada é apagado: formulação, custo, preço e propostas continuam auditáveis.",
      "Condições comerciais e plano de parcelas fazem parte da versão: mudam só no rascunho e viajam congelados com a proposta enviada. O total da proposta é a soma das linhas; desconto e juros aparecem nas condições e nas parcelas, não no preço unitário de cada linha.",
      "Imprimir a proposta é leitura do que está gravado. Enviar ao cliente é o que congela; imprimir não muda situação nenhuma.",
    ],
  },

  "comercial.amostras": {
    module: "comercial",
    title: "O que é uma amostra Tn — e o que ela nunca vira",
    summary:
      "Amostra é o teste de desenvolvimento de um projeto, numerado Tn dentro daquele projeto: existe antes de haver produto, item de produto acabado ou fórmula operacional. Cada uma guarda o material realmente consumido, o que foi produzido e o parecer sobre o resultado. Não é lote e não é ordem de produção — o que sai dela nunca entra no estoque de produto acabado e não é vendável.",
    concepts: [
      {
        term: "Amostra",
        text: "O teste de desenvolvimento de um projeto, com código próprio. Nasce dentro de um projeto — não existe amostra solta — e vem antes de haver produto, item de produto acabado ou fórmula operacional.",
      },
      {
        term: "Teste Tn",
        text: "O número da amostra dentro do projeto: T1, T2, T3… A contagem é por projeto, nunca colide e nunca é reaproveitada.",
      },
      {
        term: "Status",
        text: "Rascunho, Em preparação, Produzida, Aprovada, Reprovada ou Cancelada. Em preparação começa no primeiro consumo registrado; da produção em diante a amostra é somente leitura.",
      },
      {
        term: "Consumo",
        text: "Cada baixa de material registrada para a amostra. É saída física real do estoque, com tipo de movimento próprio — a coluna conta baixas, não itens diferentes.",
      },
      {
        term: "Produzida",
        text: "O que a amostra rendeu, informado na conclusão. Não é lote e não entra no estoque de produto acabado: não pode ser reservado, expedido nem vendido.",
      },
      {
        term: "QR da amostra",
        text: "A amostra tem etiqueta e QR próprios, com prefixo diferente do de lote. Ler uma amostra nunca abre um lote de estoque.",
      },
    ],
    flow: [
      {
        label: "Rascunho",
        detail:
          "A amostra nasce dentro de um projeto — não existe amostra solta. O número Tn é sequencial por projeto e nunca colide, mesmo com duas criações ao mesmo tempo.",
      },
      {
        label: "Em preparação",
        detail:
          "O primeiro consumo de material registrado é o que marca o início real da preparação. Cada consumo é saída física do estoque, na hora.",
      },
      {
        label: "Produzida",
        detail:
          "Concluir registra a quantidade produzida e congela cliente e projeto no que a etiqueta usa — renomear depois não reescreve o que já foi impresso e enviado.",
      },
      {
        label: "Aprovada ou Reprovada",
        tone: "accent",
        detail:
          "Decisão sobre o resultado técnico. Reprovar exige o motivo descrito; nenhuma das duas devolve material ao estoque.",
      },
    ],
    notes: [
      "Amostra não é lote e não é ordem de produção. O QR dela tem prefixo próprio, diferente do prefixo dos lotes de estoque — ler uma amostra nunca abre um lote.",
      "Esta lista não cria amostra: ela nasce dentro do projeto, na seção Amostras / testes. Aqui ficam a busca, os filtros por situação e cliente e a exportação do recorte filtrado.",
      "O material consumido é saída física real do estoque, com tipo de movimento próprio. Não existe exceção “porque é amostra”: lote bloqueado, vencido, sem laudo ou de outro cliente continua fora, e a amostra nunca come estoque reservado para ordem de produção ou pedido.",
      "Reprovar ou cancelar não estorna consumo: o que foi usado continua usado. Devolver material seria uma operação de estoque à parte, com motivo próprio.",
      "Aprovar a amostra não aprova o projeto. A aprovação comercial continua exigindo orçamento aceito e ação explícita no projeto.",
      "Criar a primeira amostra move o projeto para o estágio Amostra. Projeto aprovado ou cancelado não aceita amostra nova.",
      "Amostra importada do legado pode chegar sem desfecho. O resultado não é adivinhado — fica em branco mesmo.",
    ],
  },

  "comercial.amostra": {
    module: "comercial",
    title: "Como uma amostra consome estoque e recebe parecer",
    summary:
      "Esta tela é o registro de um teste: quais itens e lotes foram usados, quanto se produziu, quem fez cada parte e qual foi a decisão sobre o resultado. O consumo registrado aqui é saída física de estoque no mesmo instante, e não volta atrás. A decisão técnica é uma etapa separada — e não decide nada sobre o projeto.",
    concepts: [
      {
        term: "Consumo",
        text: "O registro de que um item e um lote foram usados neste teste. Grava a saída física no estoque no mesmo instante — não é anotação para acertar depois.",
      },
      {
        term: "Lote elegível",
        text: "Só entra lote liberado pela Qualidade, dentro da validade, com laudo quando exigido e com saldo realmente livre. Não existe exceção porque é amostra.",
      },
      {
        term: "Proprietário",
        text: "De quem é o material consumido. Material de propriedade de um cliente só serve para amostra daquele mesmo cliente.",
      },
      {
        term: "Concluir",
        text: "Informa a quantidade produzida e fecha a preparação. É o passo que muda a amostra para Produzida e habilita a decisão.",
      },
      {
        term: "Cópia congelada da etiqueta",
        text: "A cópia de cliente e projeto gravada na conclusão. Renomear o cliente depois não reescreve a etiqueta que já foi impressa e enviada.",
      },
      {
        term: "Parecer",
        text: "A justificativa da decisão sobre o RESULTADO do teste. Reprovar exige o motivo descrito; aprovar pode ficar sem texto.",
      },
      {
        term: "Papéis",
        text: "Criar é do Comercial ou da Produção; registrar consumo e concluir são da Produção; aprovar ou reprovar é do Comercial. Ação que não aparece costuma ser papel, não falta de função.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Amostra com consumo de material",
        when: "O caso normal: houve pesagem e material saiu do estoque.",
        steps: [
          {
            label: "Rascunho",
            detail:
              "A amostra já existe, criada no projeto. Aqui entram descrição, produto testado e observações.",
          },
          {
            label: "Consumo registrado",
            tone: "accent",
            detail:
              "Cada item e lote consumido gera saída física do estoque na hora. Item que controla lote exige o lote informado — sem isso a rastreabilidade se perde. Registrar consumo é trabalho da Produção.",
          },
          {
            label: "Concluir",
            detail:
              "Informa a quantidade produzida e a unidade, e congela cliente e projeto na cópia que a etiqueta usa.",
          },
          {
            label: "Etiqueta",
            detail:
              "Pode ser impressa a partir daqui, com o QR próprio da amostra. Ela não leva preço nem custo.",
          },
          {
            label: "Decisão",
            tone: "accent",
            detail:
              "Aprovar ou reprovar o resultado — decisão do Comercial. Reprovar exige o motivo descrito.",
          },
        ],
      },
      {
        name: "Fluxo B · Amostra sem consumo registrado",
        when: "Montagem, embalagem ou registro histórico em que não houve material a baixar.",
        steps: [
          {
            label: "Rascunho",
            detail: "Mesmo começo: a amostra existe e ainda não tem consumo nenhum.",
          },
          {
            label: "Concluir sem consumo",
            tone: "warn",
            detail:
              "O sistema nunca inventa consumo. Concluir sem nenhum material registrado é possível, mas exige confirmação explícita de quem conclui.",
          },
          {
            label: "Produzida",
            detail:
              "A amostra fica com quantidade produzida e a cópia da etiqueta congelada, igual ao fluxo A.",
          },
          {
            label: "Decisão",
            tone: "accent",
            detail: "Aprovar ou reprovar segue igual — a ausência de consumo não muda o parecer.",
          },
        ],
      },
    ],
    notes: [
      "Só lote elegível entra: qualidade, validade e laudo valem aqui igual ao resto do sistema. Material de propriedade de cliente só pode ser usado em amostra daquele mesmo cliente.",
      "A conta é do saldo disponível: a amostra nunca toma estoque reservado para ordem de produção ou para pedido de cliente.",
      "Reprovar ou cancelar não estorna nada. O material consumido continua consumido.",
      "Amostra produzida, aprovada, reprovada ou cancelada é somente leitura — registro de amostra é histórico.",
      "Cancelar só existe enquanto a amostra está em rascunho ou em preparação. Depois de produzida, o caminho é aprovar ou reprovar.",
      "Papéis: criar é do Comercial ou da Produção; registrar consumo e concluir são da Produção; aprovar ou reprovar é do Comercial. Quando a ação não aparece, é o papel — não é falta da função.",
      "O que a amostra produz não entra no estoque de produto acabado e não pode ser expedido.",
    ],
  },

  "comercial.pedidos": {
    module: "comercial",
    title: "O que é um Pedido do Cliente e o que ele decide",
    summary:
      "Pedido do Cliente é a demanda comercial: quem pediu, o que pediu e quanto. Ele não é estoque e não reserva nada sozinho — é o documento que autoriza o resto a acontecer: reserva, produção, compra de material em falta, expedição e faturamento. Esta lista mostra todos os pedidos e três leituras de situação lado a lado: o status do pedido, o atendimento e o faturamento.",
    concepts: [
      {
        term: "Pedido do Cliente",
        text: "A demanda comercial registrada: cliente, produtos, quantidades e datas. Nunca é fonte de verdade de saldo — o que existe fisicamente está no estoque, não aqui.",
      },
      {
        term: "Rascunho",
        text: "Editável à vontade. Nada foi prometido a ninguém e nada foi reservado.",
      },
      {
        term: "Confirmado",
        text: "Cliente, produtos e quantidades são congelados num retrato histórico. É o único status a partir do qual o Plano de Atendimento fica disponível.",
      },
      {
        term: "Em atendimento",
        text: "Acontece só quando um Plano é aplicado. A partir daqui existem reserva e ordens de produção amarradas a este pedido.",
      },
      {
        term: "Parcialmente expedido",
        text: "Parte já saiu fisicamente. O pedido continua vivo e recebe outras expedições.",
      },
      {
        term: "Expedido",
        text: "Tudo o que foi pedido saiu. O status é consequência do que foi confirmado na expedição, nunca uma marcação manual.",
      },
      {
        term: "Coluna Atendimento",
        text: "Quanto do pedido já está coberto: reservado e produzido em relação ao pedido. É a leitura operacional, e pode estar completa antes de qualquer expedição.",
      },
      {
        term: "Coluna Faturamento",
        text: "Quanto do que saiu já foi faturado. Só avança depois da expedição confirmada e do documento de faturamento emitido.",
      },
      {
        term: "Entrega",
        text: "A data de entrega combinada no pedido. Informativa: não muda reserva nem produção.",
      },
      {
        term: "Novo pedido",
        text: "A ação principal da lista: abre o pedido em rascunho, com cliente, produtos, quantidades e datas.",
      },
    ],
    flow: [
      {
        label: "Rascunho",
        detail:
          "Registre cliente, produtos e quantidades. Enquanto está aqui, tudo se edita e nada é prometido.",
      },
      {
        label: "Confirmado",
        detail:
          "Congela o retrato do pedido. Mudar preço de tabela ou cadastro do cliente depois disto não reescreve o que foi acordado.",
      },
      {
        label: "Plano de Atendimento",
        tone: "accent",
        detail:
          "A conta de como atender: quanto sai do estoque pronto e quanto precisa ser produzido. Ler o plano não muda nada; aplicá-lo é que cria reserva e ordens.",
      },
      {
        label: "Em atendimento",
        detail:
          "Com o plano aplicado, existe reserva de produto acabado e, quando houve déficit, ordens de produção ligadas a este pedido.",
      },
      {
        label: "Expedição",
        detail:
          "A saída física sai daqui, e só pode usar o que está reservado PARA ESTE pedido. Estoque livre e reserva de outro pedido ficam de fora.",
      },
      {
        label: "Faturamento",
        detail:
          "Preparado sobre o que realmente saiu — nunca sobre o que foi pedido, reservado ou produzido.",
      },
    ],
    notes: [
      "Pedido não movimenta estoque em momento nenhum. Quem movimenta é produção e expedição; reserva compromete sem movimentar.",
      "O pedido pode gerar ordens de compra em rascunho para material em falta — mas gerar rascunho não compra nada: confirmar a ordem de compra continua sendo um ato à parte, em Compras.",
      "Não existe mudar status à mão: cada um é consequência de um ato — confirmar, aplicar o plano, confirmar uma expedição.",
      "O Plano de Atendimento é projeção, não segunda verdade sobre saldo. Ele é recalculado e revalidado no momento em que você aplica.",
      "Cancelar pedido em atendimento não desfaz sozinho reserva e ordem já criadas — elas são fatos operacionais com vida própria.",
    ],
  },

  "comercial.pedido": {
    module: "comercial",
    title: "Este pedido: onde ele está e o que falta",
    summary:
      "Esta tela é o pedido inteiro: o que o cliente pediu, como será atendido, o que já foi reservado, o que está sendo produzido e o que já saiu. O que aparece muda conforme o status — em Rascunho há edição, em Confirmado aparece o Plano de Atendimento, e em atendimento aparecem reserva, ordens e saldo a expedir.",
    concepts: [
      {
        term: "Linha do pedido",
        text: "Um produto e a quantidade pedida. Depois de confirmado, a linha é um retrato histórico e não acompanha mudança de cadastro.",
      },
      {
        term: "Reserva",
        text: "Produto acabado comprometido com ESTE pedido. Sai da disponibilidade dos outros e é a única origem possível da expedição.",
      },
      {
        term: "Produzir",
        text: "O déficit: o que o estoque pronto não cobre. Vira ordem de produção em rascunho, ligada a este pedido, que ninguém libera automaticamente.",
      },
      {
        term: "Saldo a expedir",
        text: "O que foi reservado ou produzido e ainda não saiu. É ele que diz se o pedido acabou.",
      },
      {
        term: "Preço acordado",
        text: "O valor congelado na confirmação. O faturamento herda daqui, não da tabela de preço de hoje.",
      },
      {
        term: "Origem comercial",
        text: "Quando o pedido nasceu de uma proposta aceita, o bloco aponta o projeto e a versão de orçamento de origem — é de lá que vieram os preços acordados. Pedido escrito à mão não tem origem.",
      },
      {
        term: "Falta expedir",
        text: "Por linha, o que ainda não saiu: pedido menos expedido. É ele que diz se o pedido acabou.",
      },
      {
        term: "Sugestão de Compra",
        text: "Análise a partir das ordens de produção deste pedido: por material, a falta física, o que já está em compra, os fornecedores homologados, o necessário restante, o já reservado para este pedido, o que já está em rascunho, o comprar sugerido (considera pedido mínimo) e o campo Comprar agora. Falta física e compra sugerida são conceitos diferentes.",
      },
      {
        term: "Gerar OCs em rascunho",
        text: "Cria ordens de compra em rascunho com o que foi digitado em Comprar agora, agrupadas por fornecedor. Não compra nada: confirmar cada ordem continua sendo ato de Compras. As ordens geradas aparecem em Ordens de Compra Vinculadas.",
      },
      {
        term: "Materiais aguardando cliente",
        text: "Material que a receita declara como fornecido pelo cliente e que ainda falta: necessário, disponível do cliente e falta. Não vira compra da Veridi — resolve-se com nova remessa do cliente.",
      },
      {
        term: "Reservar Produto Acabado",
        text: "Produto produzido depois do plano não entra sozinho na expedição. Este painel mostra, por linha, o expedido, o reservado restante, o que falta reservar e o disponível agora, e “Reservar disponível” prende ao pedido o que existe.",
      },
      {
        term: "Produto Acabado já reservado — por lote",
        text: "As reservas deste pedido, lote a lote: reservado, expedido e restante. Lote que ficou inelegível (vencido, bloqueado) pode ser realocado para outro lote; o que já foi expedido continua no lote original.",
      },
      {
        term: "Gerar OP para o saldo restante",
        text: "Quando uma ordem concluída produziu menos que o planejado e a linha continua descoberta, o pedido oferece uma nova ordem para o que falta. A ordem encerrada não gera nada sozinha.",
      },
    ],
    flow: [
      {
        label: "Confirmar",
        detail:
          "Congela cliente, produtos, quantidades e preço. Sem isto o Plano de Atendimento não aparece.",
      },
      {
        label: "Ler o plano",
        detail:
          "Mostra, por produto: pedido, disponível, quanto reservar e quanto produzir. Ler não persiste nada — dá para reequilibrar reserva e produção antes de aplicar.",
      },
      {
        label: "Aplicar o plano",
        tone: "accent",
        detail:
          "Revalida a disponibilidade naquele instante e cria reserva e ordens numa transação só. Ou tudo acontece, ou nada acontece.",
      },
      {
        label: "Produzir",
        detail:
          "As ordens nascem em rascunho. Liberar, produzir e concluir seguem o fluxo normal de produção, com o consumo de material reconciliado.",
      },
      {
        label: "Comprar o que falta",
        detail:
          "A Sugestão de Compra lê as ordens deste pedido e propõe quanto comprar por material e fornecedor. Gerar cria ordens de compra em rascunho; confirmar é em Compras.",
      },
      {
        label: "Reservar o produzido",
        detail:
          "Produto que ficou pronto depois do plano precisa ser reservado a este pedido explicitamente, no painel Reservar Produto Acabado.",
      },
      {
        label: "Expedir",
        detail:
          "Prepare a expedição daqui. Só o que está reservado para este pedido pode sair, e só a expedição confirmada baixa estoque.",
      },
      {
        label: "Faturar",
        detail:
          "Sobre o que saiu de fato, com o preço acordado na confirmação.",
      },
    ],
    notes: [
      "Reserva e produção somadas precisam cobrir exatamente a quantidade pedida — não existe plano parcial.",
      "Aplicar o plano nunca confia no número que a tela mostrou: a disponibilidade é conferida de novo, sob trava, no instante da aplicação.",
      "Produto produzido depois não entra sozinho na expedição: precisa ser reservado a este pedido explicitamente.",
      "O pedido fica expedido por consequência das expedições confirmadas. Não há marcar como expedido.",
      "Gerar ordens de compra a partir do pedido não compra nada e não cobre falta: material só vira estoque no recebimento. Falta de material do cliente nunca vira compra da Veridi.",
      "Cancelar o pedido exige motivo e não desfaz reserva e ordem já criadas — elas são fatos operacionais com vida própria. Imprimir e Observações não alteram o pedido.",
    ],
  },

  "comercial.expedicoes": {
    module: "comercial",
    title: "O que é uma expedição e por que ela nasce do pedido",
    summary:
      "Expedição é a saída física de produto acabado de um Pedido do Cliente: quais lotes saíram, quanto de cada um e quando. Esta lista mostra o que está em separação (rascunho) e o que já saiu (confirmada), sempre amarrado ao pedido de origem. Não existe expedição avulsa — ela parte de um pedido com reserva feita, e só a confirmada mexe no estoque.",
    concepts: [
      {
        term: "Expedição",
        text: "O documento da saída física de produto acabado de um pedido: quais lotes saíram, quanto de cada um e quando. Sempre amarrada a um Pedido do Cliente.",
      },
      {
        term: "Rascunho",
        text: "A separação: o que se pretende enviar. Não movimenta estoque, não mexe na reserva e não muda o status do pedido. Um por pedido de cada vez.",
      },
      {
        term: "Confirmada",
        text: "A saída de verdade. É o único momento em que o estoque cai, e a expedição vira histórico imutável na mesma hora.",
      },
      {
        term: "Reserva do pedido",
        text: "Quantidade comprometida com aquele pedido específico. É a única origem possível de uma expedição — estoque livre e reserva de outro pedido não servem.",
      },
      {
        term: "Quantidade",
        text: "No rascunho, o que se pretende enviar; na confirmada, o que realmente saiu. É o número da confirmada que o faturamento usa.",
      },
      {
        term: "Entrega parcial",
        text: "Expedir menos do que o pedido pede é normal e previsto. O pedido fica parcialmente expedido e recebe outras expedições depois.",
      },
    ],
    flow: [
      {
        label: "Pedido em atendimento",
        detail:
          "Só pedido em atendimento ou parcialmente expedido permite preparar expedição. É de lá que sai o botão — esta lista não cria expedição.",
      },
      {
        label: "Reserva",
        detail:
          "A expedição só pode puxar quantidade reservada para AQUELE pedido. Estoque livre, reserva de outro pedido e reserva de ordem de produção ficam de fora.",
      },
      {
        label: "Rascunho",
        detail:
          "É a separação: o que se pretende enviar. Um rascunho por pedido de cada vez, e ele não toca em saldo, reserva nem status do pedido.",
      },
      {
        label: "Conferência",
        detail:
          "Item que controla lote só sai depois de o lote ser conferido fisicamente. Conferir não movimenta estoque.",
      },
      {
        label: "Confirmada",
        tone: "accent",
        detail:
          "A única etapa que baixa estoque: saldo físico e reserva caem juntos. Depois disso a expedição é histórico e não se edita.",
      },
      {
        label: "Faturamento",
        detail:
          "Preparado sobre o que realmente saiu — nunca sobre o que foi pedido, reservado ou produzido.",
      },
    ],
    notes: [
      "Não há botão de nova expedição nesta lista. O caminho é abrir o Pedido do Cliente e preparar a expedição de lá, com a reserva já feita.",
      "Rascunho não é realidade física: criar, ajustar ou cancelar um rascunho não altera saldo, reserva nem status do pedido.",
      "Expedição confirmada não se edita, não se reconfirma e não se cancela. Desfazer uma saída física exigiria devolução e reentrada — que não existem nesta fase.",
      "Produto produzido depois do pedido não entra sozinho na expedição: ele precisa ser reservado ao pedido explicitamente.",
      "O pedido fica expedido ou parcialmente expedido por consequência do que foi confirmado. Não existe marcar como expedido à mão.",
    ],
  },

  "comercial.expedicao": {
    module: "comercial",
    title: "O que muda o estoque numa expedição — e o que não muda",
    summary:
      "Esta tela conduz uma expedição do rascunho até a saída: os lotes reservados a este pedido, quanto enviar de cada um, a conferência física de cada lote e a confirmação. Separar, conferir e expedir são três atos diferentes, e só o último move estoque. Depois de confirmada, a expedição é histórico — não se edita, não se reconfirma e não se cancela.",
    concepts: [
      {
        term: "Separação",
        text: "O rascunho: quais lotes e quanto de cada um se pretende enviar. Ajustar aqui não muda saldo, reserva nem pedido.",
      },
      {
        term: "Reservado disponível",
        text: "Quanto daquele lote continua reservado a este pedido e ainda não foi expedido. É o teto da linha — não é o saldo do lote nem a quantidade do pedido.",
      },
      {
        term: "Enviar agora",
        text: "Quanto sai nesta expedição. Limitado ao reservado disponível do lote e ao que ainda falta expedir daquele produto no pedido: vale o menor dos dois.",
      },
      {
        term: "Já expedido, expedindo agora e restante",
        text: "Três números diferentes por produto. Já expedido é o histórico das expedições confirmadas antes desta. Expedindo agora é a prévia da separação em edição: muda a cada quantidade digitada, sem gravar nada. Restante após esta expedição é o que ainda faltará do pedido depois de confirmar. Quantidade acima do que falta não vira saldo negativo: a linha avisa e a confirmação fica travada até corrigir.",
      },
      {
        term: "Conferência",
        text: "Ler o lote físico para confirmar que é o lote reservado nesta linha. Responde só “o lote certo está aqui?”: não movimenta estoque e nunca infere quantidade.",
      },
      {
        term: "Lote Veridi",
        text: "Rótulo de negócio do lote, usado na etiqueta e nas telas. A identidade continua sendo o código do lote — é ele que o QR carrega e que a conferência compara.",
      },
      {
        term: "Confirmar",
        text: "A única operação desta tela que move estoque: saldo físico e reserva caem juntos, numa transação só. Depois disso a expedição é histórico.",
      },
      {
        term: "Realocação de reserva",
        text: "Trocar o lote de uma linha nunca é automático e não acontece aqui: é uma realocação explícita da reserva, feita no Pedido do Cliente.",
      },
      {
        term: "Validade e localização",
        text: "Colunas de cada linha, lidas do lote: onde ele está e até quando vale. Lote vencido aparece marcado — ele não sai na confirmação, e o caminho é realocar a reserva no pedido.",
      },
      {
        term: "Folha de separação (FO-05)",
        text: "O papel de quem vai buscar o material: lotes, localização e quantidades desta expedição. Imprimir não muda a expedição.",
      },
      {
        term: "Observações",
        text: "Texto livre do rascunho. Entra no documento impresso e não altera quantidade nenhuma.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Expedição total do pedido",
        when: "Há reserva suficiente para enviar tudo o que ainda falta do pedido.",
        steps: [
          {
            label: "Rascunho pronto",
            detail:
              "A expedição já nasce preenchida com o reservado disponível de cada lote, limitada ao que ainda falta expedir de cada linha do pedido.",
          },
          {
            label: "Ajuste da separação",
            detail:
              "Dá para mudar quantidade por lote e anotar observações. Nada aqui altera saldo, reserva ou pedido — rascunho é planejamento.",
          },
          {
            label: "Conferência do lote",
            tone: "accent",
            detail:
              "Responde só “o lote certo está aqui?”. Lote divergente não é aceito nem trocado sozinho — trocar exige realocar a reserva no pedido. A quantidade continua sendo decisão à parte: a leitura diz qual lote, não quanto.",
          },
          {
            label: "Confirmar",
            tone: "accent",
            detail:
              "Único momento em que o estoque se move: cada linha vira uma saída, e o saldo físico e a reserva caem juntos. Tudo entra ou nada entra.",
          },
          {
            label: "Pedido expedido",
            detail:
              "O status do pedido é consequência do que saiu. A reserva que sobrou é liberada na mesma operação, sem deixar compromisso vivo para trás.",
          },
          {
            label: "Faturamento",
            detail:
              "Preparado a partir desta expedição, com as linhas do que realmente saiu. Não emite Nota Fiscal e não movimenta estoque.",
          },
        ],
      },
      {
        name: "Fluxo B · Entrega parcial",
        when: "Só parte da quantidade está reservada ou disponível agora — e o cliente recebe o resto depois.",
        steps: [
          {
            label: "Rascunho com o que há",
            detail:
              "A separação leva apenas o reservado disponível no momento. O que falta não vira linha vazia nem promessa.",
          },
          {
            label: "Confirmar o parcial",
            tone: "accent",
            detail:
              "A saída acontece igual, só que menor. O que saiu é definitivo; o que não saiu continua pendente no pedido.",
          },
          {
            label: "Pedido parcialmente expedido",
            detail:
              "O pedido registra sozinho que ainda falta quantidade. Nenhuma reserva restante é descartada por causa disso.",
          },
          {
            label: "Nova reserva no pedido",
            detail:
              "Produto que ficou pronto depois precisa ser reservado ao pedido explicitamente — produzir não reserva. Isso é feito no Pedido, não aqui.",
          },
          {
            label: "Nova expedição",
            detail:
              "Com a reserva nova, o pedido gera outro rascunho e o ciclo se repete até fechar a quantidade pedida.",
          },
          {
            label: "Faturamento por expedição",
            detail:
              "Cada expedição confirmada é faturada pelo seu próprio faturamento. Entrega parcial gera faturamento parcial.",
          },
        ],
      },
    ],
    notes: [
      "Rascunho nunca é realidade física: ajustar quantidades ou cancelar o rascunho não altera saldo, reserva nem o status do pedido.",
      "A quantidade de uma linha tem dois tetos ao mesmo tempo: o reservado que ainda resta naquele lote e o que ainda falta expedir daquele produto no pedido. Vale o menor.",
      "A elegibilidade do lote é revalidada na confirmação: lote que venceu, foi bloqueado ou voltou a aguardar a Qualidade não sai, mesmo que a reserva seja anterior à mudança. O caminho é realocar a reserva no pedido.",
      "Conferir é só auditoria: não cria movimento de estoque, não muda o pedido e nunca infere quantidade a partir da leitura.",
      "Expedição confirmada é histórico imutável. Cancelar só vale para rascunho — depois da saída física não há desfazer nesta fase.",
      "Faturar não é passo obrigatório desta tela: o faturamento é preparado a partir da expedição confirmada, não emite Nota Fiscal, não gera título e não movimenta estoque.",
    ],
  },
} satisfies Record<string, HelpTopic>;

/**
 * Palavras que aparecem em rótulo e cabeçalho de coluna nas telas do
 * Comercial.
 *
 * Entram aqui só os termos que ninguém adivinha pelo nome — "Reservado
 * disponível" não é "quantidade reservada", "Lote Veridi" não é a
 * identidade do lote, "Consumos" não conta itens. O que precisa de
 * parágrafo é assunto do painel, não do ⓘ.
 */
export const comercialHints = {
  "comercial.projetoStatus": {
    module: "comercial",
    label: "Status",
    text: "Estágio do projeto no funil: Aguardando, Amostra, Stand-by, Aprovado ou Cancelado. Aprovado e cancelado são terminais — o projeto vira somente leitura e não aceita edição, amostra nem orçamento novo.",
  },
  "comercial.projetoCanal": {
    module: "comercial",
    label: "Canal",
    text: "Por onde a oportunidade chegou. Assim como o conceito, é texto livre com sugestão dos valores já em uso: o vocabulário cresce com o negócio, em vez de ficar preso a uma lista fechada.",
  },
  "comercial.projetoUltimaVersao": {
    module: "comercial",
    label: "Última versão",
    text: "A versão de orçamento mais recente do projeto. Cada negociação é uma versão nova; a anterior fica registrada como substituída, e nenhuma delas é editada depois de enviada.",
  },
  "comercial.projetoProduto": {
    module: "comercial",
    label: "Produto",
    text: "O produto operacional do projeto. Fica vazio enquanto ninguém preparou o produto técnico: na aprovação ele é criado, ou o que já estava em desenvolvimento é promovido — mesmo código, mesma fórmula, mesma história.",
  },
  "comercial.projetoCodigoLegado": {
    module: "comercial",
    label: "Código legado",
    text: "O identificador que o registro tinha na planilha antiga. Existe só no que foi importado, e serve para reencontrar o projeto pelo número que a equipe já conhece.",
  },
  "comercial.projetoOrigem": {
    module: "comercial",
    label: "Origem do registro",
    text: "Diz se o projeto foi cadastrado no sistema ou importado da planilha antiga. Projeto importado pode ter chegado com estágio ou desfecho incompletos — o que veio é preservado, não completado por conta própria.",
  },

  "comercial.amostraTeste": {
    module: "comercial",
    label: "Teste",
    text: "O número Tn da amostra dentro do projeto — T1, T2, T3… A contagem é por projeto: amostra importada do legado mantém o número que já tinha, e as novas continuam a partir do maior existente.",
  },
  "comercial.amostraStatus": {
    module: "comercial",
    label: "Status",
    text: "Situação da amostra: Rascunho, Em preparação, Produzida, Aprovada, Reprovada ou Cancelada. Em preparação começa no primeiro consumo registrado; produzida, aprovada, reprovada e cancelada são somente leitura.",
  },
  "comercial.amostraConsumos": {
    module: "comercial",
    label: "Consumos",
    text: "Quantos registros de consumo a amostra tem. Cada um é uma saída física real do estoque — a contagem é de baixas registradas, não de itens diferentes.",
  },
  "comercial.amostraProdutoTestado": {
    module: "comercial",
    label: "Produto testado",
    text: "Qual produto do projeto esta amostra testa. Num projeto com vários produtos, quem cria escolhe: qual sabor foi testado não se deduz depois. Com um produto só, o vínculo é automático.",
  },
  "comercial.amostraProprietario": {
    module: "comercial",
    label: "Proprietário",
    text: "De quem é o material consumido. Material de propriedade de um cliente só pode ser usado em amostra daquele mesmo cliente — não existe exceção porque é amostra.",
  },
  "comercial.amostraQuantidadeProduzida": {
    module: "comercial",
    label: "Quantidade produzida",
    text: "O que a amostra rendeu, informado na conclusão. É registro do teste: não entra no estoque de produto acabado e não pode ser expedido.",
  },
  "comercial.amostraParecer": {
    module: "comercial",
    label: "Parecer",
    text: "A justificativa da decisão sobre o resultado. Reprovar exige o motivo descrito; aprovar pode ficar sem texto.",
  },

  "comercial.expedicaoStatus": {
    module: "comercial",
    label: "Status",
    text: "Rascunho é separação: nada saiu e nada mudou no estoque. Confirmada é saída física e histórico imutável. Cancelada só existe para rascunho — expedição confirmada não se cancela.",
  },
  "comercial.expedicaoQuantidade": {
    module: "comercial",
    label: "Quantidade",
    text: "Total das linhas da expedição. No rascunho é o que se pretende enviar; na confirmada é o que realmente saiu — e é esse número que o faturamento usa.",
  },
  "comercial.expedicaoReservadoDisponivel": {
    module: "comercial",
    label: "Reservado disponível",
    text: "Quanto daquele lote ainda está reservado a este pedido e ainda não foi expedido. Estoque livre, reserva de outro pedido e reserva de ordem de produção não entram nesta conta.",
  },
  "comercial.expedicaoEnviarAgora": {
    module: "comercial",
    label: "Enviar agora",
    text: "Quanto sai nesta expedição. Fica limitado ao reservado disponível do lote e ao que ainda falta expedir daquele produto no pedido — vale o menor dos dois.",
  },
  "comercial.expedicaoLoteVeridi": {
    module: "comercial",
    label: "Lote Veridi",
    text: "Rótulo de negócio do lote, usado na etiqueta e nas telas. A identidade do lote continua sendo o código do lote — é ele que o QR carrega e é ele que a conferência compara.",
  },
  "comercial.expedicaoConferencia": {
    module: "comercial",
    label: "Conferência",
    text: "Leitura do lote físico para confirmar que é o lote reservado nesta linha. Não movimenta estoque, não muda o pedido e nunca infere quantidade. Item que controla lote não é expedido sem ela.",
  },
} satisfies Record<string, HelpHint>;
