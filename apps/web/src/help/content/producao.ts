import type { HelpHint, HelpTopic } from "../help-content";

/**
 * Produção — picking/consumo, folha de receita, produto acabado e templates
 * de formulação.
 *
 * As telas de ordem de produção e de formulação já têm ajuda em `base.ts`;
 * aqui ficam as que faltavam. A ordem de cada tópico é sempre a mesma: o que
 * a tela É, os termos que ela usa, o caminho, e o que costuma gerar chamado.
 * Começar pelo desenho da cadeia deixava a pessoa sabendo onde a tela mora e
 * não o que ela faz.
 */
export const producaoTopics = {
  "producao.picking": {
    module: "producao",
    title: "Separar material é conferir; consumir é dar baixa",
    summary:
      "Esta lista reúne as ordens liberadas ou em produção e mostra, por ordem, o progresso de duas coisas que não são a mesma: Picking, quantas linhas já foram conferidas, e Consumo, quantas já foram baixadas. Não há botão nem formulário aqui — conferir, consumir e pedir material extra acontecem dentro da ordem, que a coluna Abrir leva. Separação (picking) é a conferência física do material que a ordem já tem reservado; reservar é compromisso, e só o consumo tira quantidade do estoque.",
    concepts: [
      {
        term: "Reserva",
        text: "O compromisso do material com uma ordem, criado na liberação. Reduz o disponível e não mexe no estoque físico: nada sai da prateleira e nenhum movimento é gerado. Serve para que duas ordens não contem com o mesmo lote.",
      },
      {
        term: "Separação (picking)",
        text: "A conferência física: o operador confirma que o lote na mão é o lote reservado, pelo QR ou pelo código. Confirma a linha inteira de uma vez e também não movimenta estoque — registra quem conferiu e quando.",
      },
      {
        term: "Consumo real",
        text: "A baixa. Cada consumo confirmado gera um movimento de saída e reduz o que a linha ainda tinha reservado. É o único ato do ciclo que muda a quantidade em estoque.",
      },
      {
        term: "Saldo reservado da linha",
        text: "O que restou de reservado depois dos consumos já registrados. É o teto do próximo consumo: não se consome além dele, e a recusa vem com o número que ainda resta.",
      },
      {
        term: "FEFO",
        text: "Vence antes, sai antes — o critério da sugestão de lote. Entram só lotes dentro da validade, liberados pela qualidade e com saldo ainda não reservado por outra ordem. É recomendação, não trava.",
      },
      {
        term: "Consumo extra",
        text: "Pedido de material além do reservado, com motivo obrigatório. Amplia a reserva daquela ordem sobre o saldo realmente livre do lote — e só depois disso o material pode ser consumido. Ampliar não é consumir.",
      },
      {
        term: "Situação da ordem",
        text: "Liberada: material reservado, nada consumido ainda. Em produção: o primeiro consumo já foi registrado — e a partir daí a ordem não pode mais ser cancelada.",
      },
      {
        term: "Colunas Picking e Consumo",
        text: "Contagens de linhas de material: quantas já foram conferidas e quantas já foram consumidas, sobre o total da ordem. Lidas lado a lado sem explicação passam por sinônimos — uma mede conferência, a outra mede baixa.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Material da Veridi",
        when: "Vale para o componente cujo fornecimento é da Veridi — o padrão da receita.",
        steps: [
          {
            label: "Ordem liberada",
            detail:
              "Liberar a ordem reserva os lotes na hora, e só libera se houver cobertura total por estoque disponível — material em compra não cobre nada. A reserva reduz o disponível e não movimenta o estoque físico: nada sai da prateleira e nenhum movimento é gerado.",
          },
          {
            label: "Lote sugerido",
            detail:
              "A sugestão é FEFO: vence antes, sai antes. Entram só lotes dentro da validade, liberados pela qualidade e com saldo — e a conta usa o que ainda não está reservado por outra ordem. Item que não controla validade cai no critério de entrada mais antiga.",
          },
          {
            label: "Conferência do lote",
            detail:
              "A separação confirma a linha inteira de uma vez, com o lote que está na mão — pelo QR ou pelo código digitado. Também não movimenta estoque, e a validade e a situação do lote são checadas de novo aqui, não só na liberação.",
          },
          {
            label: "Lote diferente",
            tone: "warn",
            detail:
              "Lote conferido diferente do reservado nunca é aceito em silêncio: os dois códigos aparecem e a troca precisa ser uma ação explícita. A substituição só vale antes de qualquer consumo na linha, e exige um único lote alternativo, do mesmo dono, que cubra a quantidade inteira. A linha original não é apagada — fica registrada, e a nova aponta para ela.",
          },
          {
            label: "Consumo real",
            tone: "accent",
            detail:
              "Aqui o estoque físico cai. Cada consumo confirmado gera um movimento de saída, pode ser parcial e repetido, e nunca passa do que a linha ainda tem reservado. O primeiro consumo da ordem é o que a coloca em produção — não existe um botão separado de iniciar.",
          },
          {
            label: "Consumo extra",
            tone: "warn",
            detail:
              "Pesou mais do que a receita pedia? É um ato à parte: pedir material extra, com motivo obrigatório. O sistema confere o saldo realmente livre do lote antes de ampliar a reserva — estoque reservado por outra ordem nunca é tomado. Ampliar ainda não é consumir: o estoque só se move quando o consumo é registrado.",
          },
        ],
      },
      {
        name: "Fluxo B · Material do cliente",
        when: "Vale para o componente declarado na receita como fornecido pelo cliente.",
        steps: [
          {
            label: "Componente do cliente",
            detail:
              "Quem fornece cada material é declarado na versão da formulação e copiado para a ordem quando ela nasce. A ordem não relê a receita atual: o que vale é o que foi congelado nela.",
          },
          {
            label: "Só lote do cliente",
            detail:
              "Disponibilidade, falta, sugestão FEFO e reserva olham apenas os lotes daquele cliente. Estoque da Veridi do mesmo material não substitui, e lote de outro cliente nunca conta. Sem cliente resolvido não existe estoque elegível, e a ordem nem chega a ser liberada.",
          },
          {
            label: "Conferência e consumo",
            detail:
              "Daqui em diante é igual ao material da Veridi: confere o lote separado e depois registra o consumo — e é o consumo que baixa o estoque. A troca de lote também respeita o dono: mesmo material não basta.",
          },
          {
            label: "Falta espera remessa",
            tone: "warn",
            detail:
              "Falta de material do cliente não vira compra: não gera sugestão de compra nem pedido ao fornecedor, e a coluna de material em compra é sempre vazia. A saída é o cliente enviar mais.",
          },
        ],
      },
    ],
    notes: [
      "Reserva não movimenta estoque físico; consumo movimenta. O disponível cai na reserva, o físico cai no consumo.",
      "FEFO é recomendação, não trava: outro lote elegível pode ser usado, desde que a troca seja explícita e fique registrada.",
      "Não existe caminho da reserva direto para a baixa: consumir exige a separação já confirmada naquela linha.",
      "Consumo extra grava motivo, autor e hora ao lado da reserva original — e aparece marcado na ordem, na separação, na tabela de consumo e na ordem impressa. Linha comum não mostra nada disso.",
      "Depois do primeiro consumo a ordem não pode mais ser cancelada: material físico já saiu, e desfazer isso pede um fluxo de devolução que ainda não existe.",
      "Sobra reservada continua reservada enquanto a ordem está em produção. Ela é liberada na conclusão da ordem, sem gerar movimento — nada físico mudou, o saldo só volta a ficar disponível.",
      "Material do cliente não tem custo de aquisição da Veridi. Isso não é custo faltando: é propriedade de terceiro, e nenhum valor pode ser lançado ali.",
      "Esta lista é só leitura de progresso. Ordem que não está liberada nem em produção não aparece — rascunho e planejada ficam na lista de Ordens de Produção.",
    ],
  },

  "producao.folhaReceita": {
    module: "producao",
    title: "A pesagem confirmada é o consumo real",
    summary:
      "A Folha de Receita (R.COQ.003) é o documento de execução da produção: para cada material, quanto a receita pediu, quanto foi realmente pesado, de qual lote, por quem e quando. Confirmar uma pesagem aqui já é a baixa do material — é o mesmo consumo da ordem, registrado pelo mesmo caminho, não um segundo registro. Quando a ordem é fracionada, a folha organiza esse trabalho parte por parte.",
    concepts: [
      {
        term: "Parte",
        text: "Uma fração da produção — uma batelada. Quantas partes a ordem tem é definido antes da liberação e congelado depois; elas somam exatamente o planejado, e a última absorve o arredondamento.",
      },
      {
        term: "Planejado da parte",
        text: "Quanto a receita pede daquele material nesta parte. Só matéria-prima é fracionada: embalagem não vira “um terço de pote” e fica com a quantidade total da ordem, no Picking/Consumo.",
      },
      {
        term: "Pesagem",
        text: "O registro do que foi realmente pesado e de qual lote. Confirmar a pesagem É o consumo: o estoque baixa ali, pelo mesmo caminho do Consumo Real, e nunca duas vezes.",
      },
      {
        term: "Diferença",
        text: "Pesado menos planejado. Fica registrada e destacada; não existe tolerância automática que a aceite em silêncio nem que a bloqueie.",
      },
      {
        term: "Lotes reservados",
        text: "Os lotes que a liberação da ordem separou para aquele material. A pesagem só aceita um deles, dentro da validade, liberado pela qualidade e do dono certo.",
      },
      {
        term: "Parte concluída",
        text: "Fecha a fração, com autor e hora. Exige ao menos uma pesagem por matéria-prima planejada e nunca exige bater exato com o plano. Concluir a parte não conclui a ordem.",
      },
      {
        term: "Consumo Real da OP",
        text: "O outro caminho para a mesma baixa, feito na tela da ordem. Linha já baixada por lá não aceita mais pesagem aqui: seriam dois consumos do mesmo material.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Parte única",
        when: "Vale quando a ordem não foi dividida em partes.",
        steps: [
          {
            label: "Ordem liberada",
            detail:
              "A folha só opera com a ordem liberada ou em produção. O material precisa estar separado: a pesagem é o consumo, e consumir exige a conferência do lote antes.",
          },
          {
            label: "Pesagem por material",
            detail:
              "Cada matéria-prima planejada recebe a quantidade real pesada e o lote usado — escaneado ou digitado. Quem pesou vem da sessão: a tela nunca escolhe o autor.",
          },
          {
            label: "Diferença registrada",
            detail:
              "A diferença entre planejado e pesado fica visível e registrada. Não existe tolerância automática: nada é arredondado para fechar, e nada é bloqueado por uma margem inventada.",
          },
          {
            label: "Concluir a parte",
            detail:
              "Concluir exige ao menos uma pesagem para cada matéria-prima planejada, mas nunca exige bater exato com o plano. A quantidade produzida é outro registro, feito na ordem de produção.",
          },
        ],
      },
      {
        name: "Fluxo B · Produção fracionada",
        when: "Vale quando a ordem foi dividida em partes — bateladas — antes de ser liberada.",
        steps: [
          {
            label: "Partes definidas antes",
            detail:
              "O número de partes é editável até a liberação e congelado depois: a folha, as partes e todo o registro de execução dependem dele.",
          },
          {
            label: "Rateio por parte",
            detail:
              "Só matéria-prima é fracionada, e as partes somam exatamente o total planejado — a última absorve o arredondamento. Embalagem não vira “um terço de pote”: fica com a quantidade total da ordem, no Picking/Consumo.",
          },
          {
            label: "Pesagem parte a parte",
            detail:
              "Cada parte tem a sua lista e o seu registro. A pesagem confirmada de uma parte já é o consumo daquele material, exatamente como na parte única.",
          },
          {
            label: "Concluir cada parte",
            detail:
              "Cada parte é concluída por si, com autor e hora. Concluir uma parte não conclui a ordem — a ordem fecha na tela dela, depois do apontamento da produção.",
          },
        ],
      },
    ],
    notes: [
      "Pesagem e Consumo Real da ordem são dois caminhos para o mesmo ato. Se a linha já foi baixada pelo Consumo Real, a pesagem é recusada: registrar de novo criaria duplicidade de consumo.",
      "Confirmar a mesma pesagem duas vezes nunca gera um segundo consumo.",
      "A folha registra a execução do material, não a produção entregue. Quantidade produzida, lote de produto acabado e validade são apontamento na ordem de produção.",
      "A diferença é registrada e destacada, nunca escondida. Regras de tolerância virão da Qualidade — hoje não existe nenhuma.",
      "Embalagem não é pesada por parte: ela segue no Picking/Consumo, com a quantidade total da ordem.",
      "O lote pesado precisa ser um dos lotes que a ordem reservou para aquele material, dentro da validade, liberado pela qualidade e do dono certo — material de um cliente nunca abastece a ordem de outro.",
      "Ordem encerrada ou cancelada transforma a folha em documento de consulta: não se pesa nem se conclui parte numa produção que já terminou.",
      "A coluna Proprietário das pesagens diz de quem era o lote pesado — Veridi ou cliente. “Imprimir Folha de Receita” e o atalho “Ver Consumo Real da OP” são leituras: nenhum dos dois altera a folha.",
    ],
  },

  "producao.produtoAcabado": {
    module: "producao",
    title: "Todo lote acabado nasce de um apontamento de produção",
    summary:
      "Apontar produção é declarar quanto efetivamente saiu da linha — e é esse apontamento que cria o lote de produto acabado e a entrada no estoque. Não existe cadastro de produto acabado nem um segundo estoque: cada linha desta tela é um lote que veio de uma ordem de produção. A tela é consulta — quantidade produzida, saldo, qualidade e custo vêm das fontes originais, e qualquer ação acontece no lote ou na ordem.",
    concepts: [
      {
        term: "Apontamento de produção",
        text: "A declaração de quanto saiu da linha. É ele que cria o lote de produto acabado e a entrada no estoque — não existe outro caminho para produto acabado nascer.",
      },
      {
        term: "Produzido",
        text: "A soma dos apontamentos daquele lote. É número histórico: não muda depois e não é saldo. Um lote pode ter produzido 500 e saldo zero.",
      },
      {
        term: "Lote Veridi × Lote Interno",
        text: "O lote Veridi é o número comercial — o que vai na embalagem e no documento do cliente, sugerido pela máscara e alterável. O lote interno é a identidade única no sistema, gerada na produção, que nunca muda e sustenta a rastreabilidade.",
      },
      {
        term: "Físico, reservado e disponível",
        text: "Físico é o que ainda existe do lote; reservado é o que já está comprometido com pedido ou expedição; disponível é a diferença. Vêm do estoque e mudam a cada movimento.",
      },
      {
        term: "Aguardando liberação",
        text: "Situação de quem exige decisão da qualidade ou laudo. A quantidade existe no físico, mas o disponível fica zerado até alguém liberar, na tela do Lote.",
      },
      {
        term: "Custo de material por unidade",
        text: "Resolvido pela ordem que produziu e compartilhado pelos lotes dela, sem rateio inventado. “Parcial” ou “Sem custo” significa preço faltando em algum material consumido — nesse caso nenhum número é mostrado.",
      },
      {
        term: "Variação de produção",
        text: "A diferença entre planejado e produzido numa ordem já concluída. É desvio registrado com motivo, não uma quantidade que ainda vai ser feita.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Produção total",
        when: "Vale quando a ordem entrega a quantidade que foi planejada.",
        steps: [
          {
            label: "Apontamento",
            detail:
              "Registrar a produção cria o lote de produto acabado e a entrada de estoque, na mesma hora. A soma dos apontamentos nunca passa da quantidade planejada da ordem.",
          },
          {
            label: "Lote acabado",
            detail:
              "O lote guarda a ordem que o produziu, a data de produção, o número comercial e a validade. Validade informada sempre prevalece; sem ela, a vida útil cadastrada no produto gera uma sugestão — e nada é inventado quando o produto não tem vida útil.",
          },
          {
            label: "Qualidade",
            tone: "warn",
            detail:
              "Quando o produto exige liberação da qualidade ou laudo, o lote nasce aguardando decisão: a quantidade existe no físico, mas o disponível fica zerado até alguém liberar. A decisão é tomada na tela do Lote.",
          },
          {
            label: "Conclusão da ordem",
            detail:
              "Produzido igual ao planejado, a ordem fecha sem justificativa. O material reservado e não consumido é liberado na conclusão, sem gerar movimento — nada físico mudou.",
          },
        ],
      },
      {
        name: "Fluxo B · Produção parcial",
        when: "Vale quando a linha entrega menos que o planejado, de uma vez só ou em várias.",
        steps: [
          {
            label: "Vários apontamentos",
            detail:
              "A produção pode ser apontada em pedaços, e não existe obrigação de fechar tudo no primeiro. Cada apontamento entra num lote novo ou soma a um lote que a própria ordem já criou.",
          },
          {
            label: "Saldo em aberto",
            detail:
              "Enquanto a ordem está em produção, o que falta para o planejado continua em aberto e pode ser apontado depois. Nenhum apontamento consegue ultrapassar esse saldo.",
          },
          {
            label: "Motivo da variação",
            tone: "warn",
            detail:
              "Concluir a ordem com menos que o planejado exige o motivo da diferença. Sem motivo a ordem não fecha — a variação de produção nunca passa despercebida.",
          },
          {
            label: "Reserva liberada",
            detail:
              "A conclusão libera o material reservado que não foi consumido. O saldo volta a ficar disponível sem nenhum movimento de estoque: fisicamente nada mudou, só deixou de estar comprometido.",
          },
          {
            label: "Diferença não é promessa",
            tone: "warn",
            detail:
              "Depois de concluída, planejado menos produzido é variação, não uma quantidade ainda a produzir. Se o pedido do cliente continua descoberto, é o pedido que oferece uma nova ordem para o que falta — a ordem encerrada não gera nada sozinha.",
          },
        ],
      },
    ],
    notes: [
      "Produzido não é saldo. Produzido é a soma dos apontamentos e não muda mais; físico, reservado e disponível vêm do estoque e mudam a cada expedição, reserva ou ajuste.",
      "Lote aguardando liberação, bloqueado ou vencido tem disponível zero mesmo com quantidade física na prateleira.",
      "O custo de material por unidade é resolvido pela ordem de produção: lotes da mesma ordem compartilham a mesma referência, sem rateio inventado.",
      "Custo “Parcial” ou “Sem custo” significa que falta preço de algum material consumido. Nenhum número é exibido nesse caso — custo incompleto mostrado como fechado sustenta decisão que ele não sustenta.",
      "Material fornecido pelo cliente fica fora do custo: é propriedade de terceiro, não custo faltando.",
      "O lote produzido é sempre da Veridi, mesmo quando parte do material consumido era do cliente.",
      "A tela não cria, não edita e não libera nada. Decisão de qualidade é na tela do Lote; apontamento e conclusão são na Ordem de Produção.",
      "Cada linha oferece três caminhos: Abrir lote, Etiqueta / QR e Abrir OP. Os filtros por qualidade, produto e período de produção, mais a busca por lote, item, produto ou ordem, recortam a lista — e Exportar leva o recorte.",
    ],
  },

  "producao.templates": {
    module: "producao",
    title: "Template é matriz reutilizável — usar é copiar",
    summary:
      "Um template de formulação é uma matriz técnica: a composição que serve de ponto de partida para vários produtos e vários clientes. Ele não é a fórmula de ninguém — nenhum produto produz por um template, e nem custo, preço, orçamento, pedido ou ordem de produção leem daqui. Usar um template COPIA a composição para a formulação do produto; a partir dali as duas vidas seguem separadas, e mexer no template nunca muda uma formulação já criada.",
    concepts: [
      {
        term: "Matriz (template)",
        text: "A composição técnica guardada para ser reutilizada. Não pertence a nenhum cliente e não produz nada — por isso o nome é escolhido por quem cria, e não pode ser o nome de um cliente.",
      },
      {
        term: "Versão do template",
        text: "O que se usa é a versão, não o template. Cada revisão da matriz é uma versão própria, com número e situação, e a biblioteca guarda todas.",
      },
      {
        term: "Versão ativa",
        text: "A única que pode virar formulação de produto — uma por template. Rascunho é trabalho que ninguém revisou e não sai da biblioteca.",
      },
      {
        term: "Usar o template",
        text: "Copiar a composição para dentro da formulação de um produto: linhas novas, identidade nova, nada compartilhado. Daí em diante as duas seguem separadas.",
      },
      {
        term: "Salvar como template",
        text: "O caminho inverso, feito na tela da formulação: cria uma matriz nova a partir de uma receita existente. Também é cópia — a formulação original não muda nem troca de dono.",
      },
      {
        term: "Fornecimento padrão",
        text: "Quem fornece cada material, Veridi ou cliente. Aqui é apenas sugestão: a cópia leva o valor como ponto de partida e o produto pode mudar sem mexer na biblioteca.",
      },
      {
        term: "Arquivado",
        text: "Sai da escolha de novas formulações. Tudo o que já foi criado a partir dele continua intacto.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Criar uma matriz do zero",
        when: "Vale quando a receita padrão ainda não existe em nenhum produto.",
        steps: [
          {
            label: "Novo template",
            detail:
              "A matriz nasce com um código próprio e a V1 em rascunho. O nome é escolhido por quem cria: uma matriz feita para ser reutilizada entre clientes não pode carregar o nome de um deles.",
          },
          {
            label: "Montar o rascunho",
            detail:
              "Base, unidade e componentes se editam à vontade enquanto a versão é rascunho — inclusive o fornecimento padrão de cada material.",
          },
          {
            label: "Ativar a versão",
            detail:
              "Ativar é o que autoriza a reutilização, e exige ao menos um componente. Só versão ativa vira formulação de produto: rascunho é trabalho que ninguém revisou.",
          },
          {
            label: "Usar no produto",
            tone: "accent",
            detail:
              "Aplicar a matriz a um produto cria uma cópia independente dentro da formulação dele: linhas novas, identidade nova, nada compartilhado. Alterar o template depois não muda nenhuma formulação já criada.",
          },
        ],
      },
      {
        name: "Fluxo B · Salvar uma formulação existente como template",
        when: "Vale quando a receita já foi montada num produto e serve para outros.",
        steps: [
          {
            label: "Formulação pronta",
            detail:
              "A ação parte da versão da formulação do produto, na tela da formulação — não daqui. A biblioteca só recebe o resultado.",
          },
          {
            label: "Cópia para a biblioteca",
            detail:
              "Salvar como template também é copiar: a formulação original não se move, não se converte e não troca de dono. Ela continua sendo a receita daquele produto.",
          },
          {
            label: "Nasce em rascunho",
            detail:
              "O template criado começa como rascunho, para alguém revisar antes de a matriz ser reutilizada por outro cliente.",
          },
          {
            label: "Nada comercial vai junto",
            detail:
              "Cliente, projeto, orçamento, estrutura de custos, cálculo, precificação e pedido ficam de fora. Só a composição técnica viaja.",
          },
        ],
      },
    ],
    notes: [
      "Não existe sincronizar, atualizar em massa nem “aplicar a todos os produtos”. Se existisse, a mudança pedida por um cliente reescreveria a receita de outro, e a descoberta viria na produção.",
      "Fornecimento padrão (Veridi ou cliente) é sugestão: a cópia leva o valor da matriz como ponto de partida, e o produto pode mudar sem mexer na biblioteca.",
      "Arquivar tira o template da escolha de novas formulações. As formulações já criadas a partir dele continuam intactas.",
      "Custo, precificação, orçamento, pedido e ordem de produção nunca leem um template: eles leem a formulação do produto.",
      "Template não tem parâmetro, variável nem campo configurável. É uma cópia estruturada e versionada, e nada mais.",
      "Criar, editar e ativar exigem perfil de Administração ou Produção. Os demais perfis consultam a biblioteca.",
    ],
  },

  "producao.templateDetalhe": {
    module: "producao",
    title: "Rascunho edita, versão ativa é história",
    summary:
      "Cada matriz guarda a sua linha de versões, e é a versão — não o template — que se usa. Só o rascunho é editável: a versão ativa não se altera porque formulações de produto já nasceram dela e apontam para ela. Mudar uma matriz ativa significa criar uma versão nova; a anterior continua existindo, e nada que já foi copiado dela é reescrito.",
    concepts: [
      {
        term: "Rascunho",
        text: "A única situação editável. Um rascunho por matriz: dois seriam duas verdades técnicas em edição, e a segunda ativação apagaria em silêncio o trabalho da primeira.",
      },
      {
        term: "Versão ativa",
        text: "A versão em vigor, e a única que pode ser usada por um produto. Depois de ativada não se altera — formulações nasceram dela e precisam continuar encontrando o que copiaram.",
      },
      {
        term: "Versão arquivada",
        text: "Versão que já foi ativa e foi substituída por uma nova. Continua existindo, e é por isso que o histórico das formulações criadas a partir dela continua fazendo sentido.",
      },
      {
        term: "Origem",
        text: "De qual versão anterior este rascunho foi copiado. É o que permite comparar as duas antes de ativar.",
      },
      {
        term: "Usada por",
        text: "Quantas formulações de produto nasceram daquela versão. Nenhuma delas muda quando a matriz muda: usar um template copia.",
      },
      {
        term: "Base da formulação",
        text: "A quantidade de produto acabado que a matriz produz. Tudo o que os componentes declaram se refere a essa quantidade.",
      },
      {
        term: "Comparar versões",
        text: "Mostra, item a item, o que mudou de uma versão para a outra. É a alternativa a um “atualizar” que não existe: nada é aplicado automaticamente a quem já copiou.",
      },
    ],
    flows: [
      {
        name: "Fluxo A · Primeira versão",
        when: "Vale para a matriz recém-criada, que ainda não foi usada por nenhum produto.",
        steps: [
          {
            label: "Rascunho V1",
            detail:
              "O template nasce com a V1 em rascunho — uma matriz sem versão nenhuma seria uma pasta vazia. Base, unidade e componentes se editam livremente.",
          },
          {
            label: "Salvar rascunho",
            detail:
              "Salvar guarda o trabalho sem autorizar uso: rascunho não vira formulação de produto, por mais completo que esteja.",
          },
          {
            label: "Ativar",
            tone: "accent",
            detail:
              "A ativação exige ao menos um componente e é o que libera a matriz para uso. Só uma versão fica ativa por template.",
          },
          {
            label: "Disponível na biblioteca",
            detail:
              "A partir daqui a versão pode ser aplicada a produtos — sempre como cópia, nunca como vínculo.",
          },
        ],
      },
      {
        name: "Fluxo B · Alterar uma matriz já ativa",
        when: "Vale quando já existe versão ativa — e ela possivelmente já virou formulação em algum produto.",
        steps: [
          {
            label: "Criar nova versão",
            detail:
              "A nova versão nasce em rascunho, copiada da ativa. Um rascunho por template: dois seriam duas verdades técnicas em edição, e a segunda ativação apagaria em silêncio o trabalho da primeira.",
          },
          {
            label: "Editar o rascunho",
            detail:
              "A versão ativa continua valendo e intacta enquanto o rascunho é trabalhado. Quem for usar a matriz nesse meio-tempo usa a ativa.",
          },
          {
            label: "Comparar versões",
            detail:
              "A comparação mostra, item a item, o que mudou de uma versão para a outra — antes de ativar, não depois.",
          },
          {
            label: "Ativar a nova",
            detail:
              "A anterior deixa de ser a ativa, mas continua existindo: as formulações criadas a partir dela apontam para ela e precisam encontrá-la.",
          },
          {
            label: "Nada é reescrito",
            tone: "warn",
            detail:
              "Nenhuma formulação, custo, preço, orçamento, pedido ou ordem de produção muda por causa da nova versão. Ela é anunciada onde couber, nunca aplicada — quem quiser adotá-la compara e cria uma versão nova da formulação do produto.",
          },
        ],
      },
    ],
    notes: [
      "“Usada por” conta quantas formulações de produto nasceram daquela versão. Nenhuma delas muda quando o template muda.",
      "Não existe “atualizar para a V4”. Sobrescrever reescreveria uma receita que já pode ter sustentado um custo, um preço e uma produção.",
      "Aplicar um template a um produto preenche a primeira versão quando ela está vazia. Se a formulação de destino já tem componentes, nasce uma versão nova e a anterior fica intacta — nada é sobrescrito.",
      "Versão em rascunho não pode ser usada por produto nenhum, e template arquivado sai da escolha de novas formulações.",
      "Editar e ativar exigem perfil de Administração ou Produção. Os demais perfis leem a matriz e o histórico.",
      "Nome e descrição do template se editam fora do versionamento, em “Salvar identificação”: renomear não cria versão. Arquivar tira o template da escolha de novas formulações sem apagar versão nenhuma.",
    ],
  },
} satisfies Record<string, HelpTopic>;

/**
 * Termos que aparecem em coluna e em rótulo das telas de Produção.
 *
 * Aqui mora o "o que essa palavra quer dizer" — "o que essa tela faz" é
 * assunto dos tópicos acima. Separar as duas coisas evita o cabeçalho de
 * tabela virar parágrafo e o painel virar glossário.
 */
export const producaoHints = {
  "producao.picking.conferencia": {
    module: "producao",
    label: "Picking",
    text: "Conferência física dos lotes que a ordem reservou, linha a linha. Confirma que o material na mão é o material separado — e não movimenta estoque.",
  },
  "producao.picking.consumo": {
    module: "producao",
    label: "Consumo",
    text: "Baixa real do material. Cada consumo confirmado gera um movimento de saída e reduz o saldo que a linha ainda tinha reservado. É o consumo, não a reserva, que tira quantidade do estoque.",
  },
  "producao.picking.situacao": {
    module: "producao",
    label: "Status da ordem",
    text: "Liberada: material reservado, nada consumido ainda. Em produção: o primeiro consumo já foi registrado — e a partir daí a ordem não pode mais ser cancelada.",
  },

  "producao.receita.planejado": {
    module: "producao",
    label: "Planejado",
    text: "Quanto a receita pede deste material para esta parte. Só matéria-prima é fracionada entre as partes; embalagem fica com a quantidade total da ordem, no Picking/Consumo.",
  },
  "producao.receita.pesado": {
    module: "producao",
    label: "Pesado",
    text: "Quanto foi efetivamente pesado e registrado. Cada pesagem confirmada já é o consumo real daquele material: o estoque baixa ali, uma vez só.",
  },
  "producao.receita.diferenca": {
    module: "producao",
    label: "Diferença",
    text: "Pesado menos planejado. É registrada e destacada, nunca escondida e nunca bloqueada por tolerância automática — regras de tolerância virão da Qualidade.",
  },
  "producao.receita.lotesReservados": {
    module: "producao",
    label: "Lotes reservados",
    text: "Os lotes que a liberação da ordem separou para este material. A pesagem só aceita um deles, dentro da validade, liberado pela qualidade e do dono certo.",
  },
  "producao.receita.fracionada": {
    module: "producao",
    label: "Produção fracionada",
    text: "Divisão da ordem em partes para pesar por batelada. Definida antes da liberação e congelada depois; as partes somam exatamente o planejado, e a última absorve o arredondamento.",
  },

  "producao.pa.produzido": {
    module: "producao",
    label: "Produzido",
    text: "Soma dos apontamentos de produção deste lote. É histórico e não muda mais — não confunda com saldo, que cai a cada expedição, consumo ou ajuste.",
  },
  "producao.pa.fisico": {
    module: "producao",
    label: "Físico",
    text: "Quantidade deste lote que ainda existe no estoque. Nasce igual ao produzido e cai a cada saída.",
  },
  "producao.pa.reservado": {
    module: "producao",
    label: "Reservado",
    text: "Quantidade deste lote já comprometida com um pedido ou uma expedição. Continua no físico, mas nenhuma outra operação pode contar com ela.",
  },
  "producao.pa.disponivel": {
    module: "producao",
    label: "Disponível",
    text: "Físico menos reservado. Lote aguardando liberação, bloqueado ou vencido tem disponível zero mesmo com quantidade na prateleira.",
  },
  "producao.pa.loteVeridi": {
    module: "producao",
    label: "Lote Veridi",
    text: "Número comercial do lote — o que vai na embalagem e no documento do cliente. É sugerido pela máscara configurada e pode ser digitado diferente.",
  },
  "producao.pa.loteInterno": {
    module: "producao",
    label: "Lote Interno",
    text: "Identidade única do lote dentro do sistema, gerada na produção. Nunca muda, e é por ela que a rastreabilidade se sustenta.",
  },
  "producao.pa.qualidade": {
    module: "producao",
    label: "Qualidade",
    text: "Situação do lote. Quando o produto exige liberação da qualidade ou laudo, ele nasce aguardando decisão e só conta como disponível depois dela. A decisão é tomada na tela do Lote.",
  },
  "producao.pa.custoMaterial": {
    module: "producao",
    label: "Custo Material Un.",
    text: "Custo de material por unidade, resolvido pela ordem de produção — lotes da mesma ordem compartilham a referência. “Parcial” ou “Sem custo” significa que falta preço de algum material consumido, e nesse caso nenhum número é mostrado. Material do cliente não entra nesta conta.",
  },

  "producao.template.versaoAtiva": {
    module: "producao",
    label: "Versão ativa",
    text: "A única versão que pode ser usada para criar formulações de produto. Rascunho é trabalho em curso e não sai da biblioteca.",
  },
  "producao.template.base": {
    module: "producao",
    label: "Base",
    text: "Quantidade de produto acabado que a matriz produz. Tudo o que os componentes declaram se refere a essa quantidade.",
  },
  "producao.template.situacao": {
    module: "producao",
    label: "Situação",
    text: "Ativa: pronta para uso. Rascunho sem versão ativa: ainda não pode ser usada. Arquivado: sai da escolha de novas formulações, sem afetar nada que já foi criado a partir dela.",
  },
  "producao.template.fornecimentoPadrao": {
    module: "producao",
    label: "Fornecimento padrão",
    text: "Quem fornece o material: Veridi ou o cliente. No template é apenas sugestão — a cópia leva o valor como ponto de partida, e o produto pode mudar sem mexer na biblioteca.",
  },
  "producao.template.usadaPor": {
    module: "producao",
    label: "Usada por",
    text: "Quantas formulações de produto nasceram desta versão. Nenhuma delas muda quando o template muda: usar um template copia.",
  },
} satisfies Record<string, HelpHint>;
