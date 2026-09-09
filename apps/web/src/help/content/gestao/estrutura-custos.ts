import type { HelpTopicV2 } from "../../help-content";

/**
 * Estrutura de custos — a declaração e o cálculo, na mesma tela.
 *
 * Era a nota mais baixa da auditoria (5,8) e o motivo era estrutural: três
 * documentos convivem aqui — a estrutura, o cálculo padrão e os cálculos
 * salvos — e a ajuda não separava o que é CONFIGURAÇÃO do que é RESULTADO.
 * Doze termos de quarenta a oitenta palavras cada resolviam o vocabulário e
 * não resolviam a pergunta.
 *
 * A primeira frase agora faz essa separação, e o "Onde isto entra" mostra a
 * cadeia inteira: é daqui que a precificação nasce, e era isso que ninguém
 * encontrava.
 */
export const estruturaCustos = {
  version: 2,
  module: "gestao",
  size: "L",
  title: "Estrutura de custos: o que entra no custo de produzir este produto",
  revisedAt: "2026-09-09",

  oneLiner:
    "A estrutura declara o que entra no custo além do material: base de produção, recursos e premissas. O cálculo, no fim da tela, transforma a declaração em número, e salvar um cálculo congela esse número.",
  whenToUse: [
    "Depois de ativar a formulação do produto.",
    "Quando tarifa, premissa ou receita mudarem — em versão nova, não na ativa.",
    "Para gerar o cálculo que a precificação vai citar.",
  ],
  nextSteps: [
    { label: "Cálculo salvo: criar a precificação do produto", href: "/gestao/precificacao" },
    { label: "Ou conferir o CMV do produto", href: "/cadastros/produtos" },
  ],

  prerequisites: [
    { text: "Formulação ativa do produto.", href: "/producao/formulacoes" },
    { text: "Recursos industriais cadastrados, com tarifa vigente.", href: "/gestao/recursos-industriais" },
    { text: "Unidades por caixa preenchidas no produto — elas entram no custo.", href: "/cadastros/produtos" },
  ],
  steps: [
    {
      you: "Crie a estrutura (vazia ou a partir de um modelo) ou abra uma versão nova, que copia a ativa; informe a base de referência e salve.",
      system: "O sistema sugere o lote mínimo como base e passa a ler os consumos em relação a ela.",
    },
    {
      you: "Adicione os recursos: quanto a base consome de cada um e em que base de uso.",
      system: "O sistema converte o consumo para a base de referência e avisa recurso inativo ou sem tarifa.",
    },
    {
      you: "Declare a energia de um jeito só: não estruturada, informada direto, ou derivada dos equipamentos.",
      system: "O sistema recusa as duas formas ao mesmo tempo — seria a mesma energia contada duas vezes.",
    },
    {
      you: "Adicione as premissas: embalagem secundária, serviços, gastos gerais.",
      system: "O sistema trata valor em branco como não informado, nunca como zero.",
    },
    {
      you: "Ative a estrutura.",
      system: "O sistema congela tarifas, potências e unidades por caixa. Havendo pendência, pede confirmação.",
    },
    {
      you: 'Clique em "Calcular custo" com a data de referência e, se algum material tiver referência manual, escolha automático ou forçar, com motivo.',
      system: "O sistema resolve a fonte de custo de cada material e mostra a composição inteira.",
    },
    {
      you: 'Clique em "Salvar cálculo".',
      system: "O sistema grava um documento imutável, com código. É ele que a precificação e o CMV citam.",
    },
  ],
  automations: [
    "O sistema lê a receita da formulação ativa: material não se redigita aqui.",
    "O sistema escolhe a fonte de custo de cada material e avisa oferta sem fornecedor preferencial.",
    "O sistema mostra o subtotal conhecido quando falta custo, e nomeia o que falta.",
  ],
  process: {
    before: ["Formulação ativa"],
    here: "ESTRUTURA DE CUSTOS",
    after: ["Cálculo salvo", "CMV e Precificação", "Orçamento"],
  },

  terms: [
    { term: "Rascunho × Ativa", text: "Só o rascunho se edita. Ativar congela a versão; a anterior fica legível porque cálculos antigos apontam para ela." },
    { term: "Base de referência", text: "A quantidade de produto sobre a qual os consumos são declarados. O lote mínimo é a sugestão." },
    { term: "Recursos industriais", text: "Mão de obra, equipamento e energia, com tarifa vigente. O consumo é declarado por lote, por unidade ou por mil." },
    { term: "Energia", text: "Ou informada direto, ou derivada da potência dos equipamentos — nunca as duas." },
    { term: "Premissas", text: "Custos adicionais que não são material nem recurso: embalagem secundária, serviços, gastos gerais." },
    { term: "Cálculo padrão", text: "O resultado que a tela mostra agora, com a data de referência escolhida. Muda quando o custo muda; não é documento." },
    { term: "Fonte do custo por material", text: "De onde veio o preço de cada item: compra real, oferta de fornecedor, custo de referência ou referência manual forçada." },
    { term: "Cálculos salvos", text: "Os documentos imutáveis já gravados. É desta lista que a precificação nasce." },
    { term: "Equivalente por 1.000 un", text: "Custo por unidade × 1.000, só para comparar. O cálculo é da base de referência, não de 1.000: produzir 1.000 sobre base 300 são quatro lotes, e custo fixo por lote e caixa inteira não diluem." },
  ],
  states: [
    { name: "Rascunho", allows: "Edita base, recursos e premissas." },
    { name: "Ativa", allows: "Calcula e salva cálculos; não se edita." },
    { name: "Inativa", allows: "Somente leitura; substituída por outra versão." },
  ],
  cautions: [
    "Não tem volta: ativar a estrutura e salvar o cálculo.",
    "Formulação nova não reescreve a estrutura ativa: crie outra versão.",
    "Material do cliente fica fora do custo.",
    "Forçar uma referência manual vale só para aquele cálculo.",
  ],
  example:
    "Encapsuladora por 4 h num lote de 500 potes, a R$ 90/h: R$ 360 por lote, ou R$ 0,72 por pote na base. Num lote de 300 potes o lote inteiro continua sendo pago, e o custo sobe para R$ 1,20 por pote.",
  learnMore: [
    { concept: "custo-desconhecido" },
    { concept: "versoes" },
    { label: "Tela: Modelos de estrutura", href: "/gestao/templates-estrutura" },
    { label: "Tela: Precificação", href: "/gestao/precificacao" },
  ],
} satisfies HelpTopicV2;
