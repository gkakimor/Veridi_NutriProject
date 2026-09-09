/**
 * Conceitos compartilhados da ajuda — uma explicação por ideia.
 *
 * Sete ideias atravessam o ERP inteiro: saldo, reserva, lote, versão,
 * prévia, custo desconhecido e material do cliente. A auditoria UX-HELP-01
 * encontrou cada uma delas reescrita de um jeito diferente em oito, dez,
 * doze tópicos — e as cópias já divergiam entre si. Uma pessoa que aprendeu
 * "disponível" na Posição de Estoque reencontrava outra definição no Pedido.
 *
 * Aqui a ideia é escrita UMA vez, com exemplo numérico, e o tópico da tela
 * aponta para ela em "Saiba mais" com uma frase de contexto. O tópico
 * continua explicando a própria tela; o que ele não faz mais é redefinir o
 * vocabulário do sistema por conta própria.
 *
 * Ainda não existe rota `/ajuda/conceitos/:slug` — ela é da UX-HELP-03,
 * junto com o painel lateral. Até lá o conceito é exibido dentro do próprio
 * painel de ajuda, o que é o suficiente para o texto deixar de ser copiado.
 */

/** Um conceito compartilhado, do jeito que ele é lido dentro do painel. */
export interface HelpSharedConcept {
  /** Nome do conceito — é o que aparece no link de "Saiba mais". */
  title: string;
  /** Uma frase. É o que a maioria das pessoas vai ler e mais nada. */
  oneLiner: string;
  /** A explicação inteira, em duas a quatro frases. */
  text: string;
  /**
   * Um número real. A auditoria mediu trinta e um mil palavras de ajuda sem
   * um único exemplo numérico — é o defeito mais caro do conteúdo antigo, e
   * o conceito compartilhado é onde ele se resolve de uma vez.
   */
  example?: string;
}

export const helpConcepts = {
  saldos: {
    title: "Físico, Reservado, Disponível e Em compra",
    oneLiner:
      "Quatro números diferentes para a mesma prateleira: o que existe, o que já tem dono, o que sobra e o que ainda vem.",
    text:
      "Físico é o que está guardado. Reservado é a parte do físico que já foi prometida a uma ordem de produção ou a um pedido. Disponível é o físico menos o reservado — é este que autoriza uma promessa nova. Em compra é quantidade de ordem de compra confirmada e ainda não recebida: ela não cobre liberação nem reserva, porque ainda não existe. Lote bloqueado, aguardando a Qualidade ou vencido sai do disponível sem sair do físico.",
    example:
      "200 kg no estoque, 80 kg reservados para uma ordem: físico 200, reservado 80, disponível 120. Uma compra de 100 kg a caminho aparece como Em compra e o disponível continua 120.",
  },
  "reserva-consumo": {
    title: "Reserva × consumo",
    oneLiner: "Reservar é prometer; consumir é tirar da prateleira. Só o consumo mexe no físico.",
    text:
      "A reserva compromete uma quantidade com um documento: ela some do disponível dos outros e continua no físico. O consumo é a baixa: gera movimento de saída e reduz o físico. Liberar uma ordem de produção reserva; registrar o consumo na ordem ou confirmar a pesagem na Folha de Receita baixa. No comercial vale o mesmo: reservar produto acabado ao pedido não expede nada — a baixa é a confirmação da expedição.",
    example:
      "Ordem liberada com 15 kg reservados: o estoque continua com 15 kg no físico e ninguém mais pode contar com eles. Só quando a produção registra o consumo é que os 15 kg saem.",
  },
  "identidades-do-lote": {
    title: "As três identidades de um lote",
    oneLiner:
      "Código interno é o que o sistema cria, lote do fornecedor é o que veio na embalagem, lote comercial é o que vai no rótulo.",
    text:
      "O código interno (LT-…) nasce em cada linha de recebimento ou registro de produção, é único e é o que está no QR. O lote do fornecedor é o número impresso pelo fabricante: guardado ao lado, nunca substitui o interno. O lote comercial é o número que a Veridi imprime no rótulo do produto acabado; existe só em lote produzido. Os três convivem no mesmo lote e servem a perguntas diferentes: rastrear, reclamar com o fornecedor, atender o consumidor.",
    example:
      "Uma compra de 100 kg que chega em duas embalagens com lotes A e B do fabricante vira dois lotes internos, LT-000412 e LT-000413 — cada um com o seu lote do fornecedor ao lado.",
  },
  versoes: {
    title: "Rascunho, ativa e inativa",
    oneLiner: "Rascunho se edita; ativar congela e passa a valer; a anterior vira história legível.",
    text:
      "Formulação, estrutura de custos e precificação seguem a mesma regra: só o rascunho aceita edição, e existe um por produto. Ativar grava o que está na tela, fecha a versão e desativa a anterior. Documento emitido antes continua apontando para a versão que ele executou, e por isso a inativa nunca é apagada. Mudar uma versão ativa é criar outra versão, não editar aquela.",
    example:
      "Uma ordem planejada na versão 3 da formulação continua executando a versão 3 mesmo depois que a versão 4 é ativada.",
  },
  "previa-gravado": {
    title: "Prévia × valor gravado",
    oneLiner: "Prévia acompanha o que está na tela; o valor gravado é o que o documento guardou.",
    text:
      "Enquanto um documento é rascunho, os totais são recalculados a cada tecla e aparecem como prévia — mudar um campo muda o número na hora, sem gravar nada. O valor salvo fica ao lado, e é ele que o resto do sistema lê. Documento confirmado, enviado, emitido ou ativado não recalcula mais: o número dele é o do momento em que foi congelado, mesmo que preço, custo ou tarifa mudem depois.",
    example:
      "Um orçamento enviado por R$ 12,50 continua R$ 12,50 depois de a precificação do produto subir; a proposta nova é que vai custar diferente.",
  },
  "custo-desconhecido": {
    title: "Custo desconhecido não é zero",
    oneLiner: "Material sem preço fica em aberto. O sistema mostra o subtotal do que conhece e diz o que falta.",
    text:
      "Quando um material não tem fonte de custo, o sistema não coloca zero no lugar: zero somaria como se o material fosse de graça e o total pareceria confiável. Ele mostra o subtotal do que é conhecido, marca a qualidade do custo (completo, com estimativas, parcial, sem custo) e lista o que falta. Preço calculado por margem sobre custo incompleto fica em branco em vez de sair errado.",
    example:
      "Receita com cinco materiais e um sem preço: o cálculo mostra o subtotal dos quatro e a marca de custo parcial — nunca uma soma que finge estar inteira.",
  },
  "material-do-cliente": {
    title: "Material do cliente",
    oneLiner: "Material enviado pelo cliente entra no estoque com dono, é segregado e não tem custo da Veridi.",
    text:
      "O cliente pode mandar o próprio insumo. Ele entra por um recebimento sem ordem de compra e sem fornecedor, e o lote nasce com o cliente como proprietário. Esse saldo é segregado: só ordens de produção e amostras daquele cliente enxergam o material. Falta desse material nunca vira sugestão de compra da Veridi, e ele fica fora do custo industrial — o que não piora a qualidade do custo, porque não é ausência de informação e sim ausência de despesa.",
    example:
      "Uma receita com ativo do cliente e excipiente da Veridi custeia só o excipiente; o ativo aparece na necessidade de material da ordem e não na composição do custo.",
  },
} as const satisfies Record<string, HelpSharedConcept>;

export type HelpConceptId = keyof typeof helpConcepts;

/** Os sete conceitos, na ordem em que foram escritos. Usado por teste e por índice. */
export const HELP_CONCEPT_IDS = Object.keys(helpConcepts) as HelpConceptId[];
