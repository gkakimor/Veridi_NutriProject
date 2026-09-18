import type {
  DecisaoDeDuplicata,
  DecisaoDeExclusaoDeAgregado,
  DecisaoDeRenomeacao,
  DecisaoDeRevisao,
} from "./item-duplicates.js";

/**
 * Arquivo de decisão da carga: Item duplicado absorvido → Item canônico
 * (ITEM-DUPLICATE-SANITIZATION-01).
 *
 * É o de-para único. Quem lê:
 *  - o importador (`pipeline.ts`), para que reexecutar a carga ou reconstruir a
 *    base E2E nunca recrie o duplicado absorvido;
 *  - a ferramenta de saneamento (`scripts/maintenance/item-duplicate-sanitization.ts`),
 *    que remove o duplicado do banco depois de conferir que ele está no estado
 *    previsto.
 *
 * Não existe tabela de alias nem migration: o rastro do código absorvido mora
 * aqui e em `docs/discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md`.
 *
 * Grupo novo só entra com decisão do PO. `nome` é o nome do grupo sem caixa: a
 * ferramenta recusa quando o nome gravado de qualquer um dos dois lados já não
 * é esse.
 *
 * Quem executa: a Onda A, `item-duplicate-sanitization.ts`; a Onda 2 (grupo de
 * mais de dois, par nomeado e consolidação no canônico) e a Onda 3,
 * `master-data-duplicate-sanitization.ts --onda=<n>`. As duas leem daqui, e cada
 * uma recusa a onda da outra.
 *
 * Da Onda 3 em diante (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01) o arquivo
 * guarda também as decisões que NÃO são fusão, nas listas do fim: renomeação
 * por nome técnico distinto, exclusão de agregado de teste nunca usado e grupo
 * mantido em revisão. Um código está em UMA decisão só, de uma espécie só.
 */
export const DECISOES_DE_DUPLICATAS: readonly DecisaoDeDuplicata[] = [
  // Onda A — duplicatas inequívocas, aprovadas pelo PO em 2026-09-17.
  {
    onda: "A",
    grupo: "G1",
    nome: "Ácido nicotínico",
    absorvido: { codigo: "MP-000034", codigoPlanilha: "34" },
    canonico: { codigo: "MP-000032", codigoPlanilha: "32" },
  },
  {
    onda: "A",
    grupo: "G12",
    nome: "Goma xantana",
    absorvido: { codigo: "MP-000509", codigoPlanilha: "639" },
    canonico: { codigo: "MP-000458", codigoPlanilha: "540" },
  },
  {
    onda: "A",
    grupo: "G14",
    nome: "L-triptofano",
    absorvido: { codigo: "MP-000507", codigoPlanilha: "637" },
    canonico: { codigo: "MP-000049", codigoPlanilha: "49" },
  },
  {
    onda: "A",
    grupo: "G16",
    nome: "Tampa p/ pote HP700BL Hecaplast",
    absorvido: { codigo: "ME-000084", codigoPlanilha: "542" },
    canonico: { codigo: "ME-000047", codigoPlanilha: "494" },
  },
  {
    onda: "A",
    grupo: "G17",
    nome: "Tampa p/ pote HP900BL Hecaplast",
    absorvido: { codigo: "ME-000086", codigoPlanilha: "544" },
    canonico: { codigo: "ME-000049", codigoPlanilha: "496" },
  },
  {
    onda: "A",
    grupo: "G18",
    nome: "TAMPA SR 0.9",
    absorvido: { codigo: "ME-000129", codigoPlanilha: "641" },
    canonico: { codigo: "ME-000127", codigoPlanilha: "626" },
  },
  // Onda 2 — aprovada pelo PO em 2026-09-17 (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01).
  // Mesmo material físico, uma linha por nutriente na planilha: o canônico recebe os
  // nutrientes ÚNICOS em "A · B · C" — o dele primeiro, depois os dos absorvidos na ordem
  // do código. Termo repetido só se reconhece sem espaço nas pontas e sem caixa; qualquer
  // outra diferença (asterisco inclusive) é outro termo, salvo equivalência declarada no
  // grupo. O valor final está escrito aqui e a ferramenta recusa o grupo se o cálculo
  // não der exatamente isto. Executada por master-data-duplicate-sanitization.ts.
  {
    onda: "2",
    grupo: "G2",
    nome: "Arabinogalactana",
    absorvido: { codigo: "MP-000322", codigoPlanilha: "323" },
    canonico: { codigo: "MP-000115", codigoPlanilha: "115" },
    consolidar: { declaredNutrient: "Fibra Alimentar · Arabinogalactana" },
  },
  {
    onda: "2",
    grupo: "G3",
    nome: "Beta-glucana de levedura (Saccharomyces cerevisiae)",
    absorvido: { codigo: "MP-000304", codigoPlanilha: "305" },
    canonico: { codigo: "MP-000118", codigoPlanilha: "118" },
    consolidar: { declaredNutrient: "Fibra Alimentar · Beta-glucana" },
  },
  // G5: "Clorogênico" (MP-000324) e "Clorogênico**" (canônico MP-000347) são o mesmo
  // nutriente POR DECISÃO DO PO NESTE GRUPO, aceita para o DEV: aparece uma vez, com a
  // grafia do canônico. NÃO é regra geral de asterisco — o significado de * / ** na
  // planilha (V4) segue pendente com a Veridi e tem de ser respondido antes de PROD.
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000165", codigoPlanilha: "166" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: {
      declaredNutrient: "Clorogênico** · Adenosina · Rutina",
      equivalentes: { "Clorogênico": "Clorogênico**" },
    },
  },
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000324", codigoPlanilha: "325" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: {
      declaredNutrient: "Clorogênico** · Adenosina · Rutina",
      equivalentes: { "Clorogênico": "Clorogênico**" },
    },
  },
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000349", codigoPlanilha: "350" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: {
      declaredNutrient: "Clorogênico** · Adenosina · Rutina",
      equivalentes: { "Clorogênico": "Clorogênico**" },
    },
  },
  {
    onda: "2",
    grupo: "G8",
    nome: "Fosfato de magnésio dibásico/Hidrogênio fosfato de magnésio",
    absorvido: { codigo: "MP-000285", codigoPlanilha: "286" },
    canonico: { codigo: "MP-000204", codigoPlanilha: "205" },
    consolidar: { declaredNutrient: "Magnésio · Fósforo" },
  },
  {
    onda: "2",
    grupo: "G9",
    nome: "Fosfato de cálcio monobásico/Dihidrogênio fosfato de cálcio",
    absorvido: { codigo: "MP-000283", codigoPlanilha: "284" },
    canonico: { codigo: "MP-000269", codigoPlanilha: "270" },
    consolidar: { declaredNutrient: "Cálcio · Fósforo" },
  },
  {
    onda: "2",
    grupo: "G10",
    nome: "Fosfato de cálcio tribásico/Fosfato tricálcico",
    absorvido: { codigo: "MP-000284", codigoPlanilha: "285" },
    canonico: { codigo: "MP-000270", codigoPlanilha: "271" },
    consolidar: { declaredNutrient: "Cálcio · Fósforo" },
  },
  {
    onda: "2",
    grupo: "G15",
    nome: "Membrana de casca de ovo",
    absorvido: { codigo: "MP-000317", codigoPlanilha: "318" },
    canonico: { codigo: "MP-000312", codigoPlanilha: "313" },
    consolidar: { declaredNutrient: "Colágeno · Glicosaminoglicanos · Ácido hialurônico" },
  },
  {
    onda: "2",
    grupo: "G15",
    nome: "Membrana de casca de ovo",
    absorvido: { codigo: "MP-000319", codigoPlanilha: "320" },
    canonico: { codigo: "MP-000312", codigoPlanilha: "313" },
    consolidar: { declaredNutrient: "Colágeno · Glicosaminoglicanos · Ácido hialurônico" },
  },
  // Par NOMEADO: os dois nomes diferem por acento ("Silica" × "SÍLICA"), e a regra
  // automática preserva acento — continua preservando. O que junta este par é a decisão
  // explícita do PO, não o algoritmo. Sem nutriente dos dois lados: nada a consolidar.
  {
    onda: "2",
    grupo: "D5-SILICA",
    nome: "Sachê Silica gel 5g",
    absorvido: { codigo: "ME-000089", codigoPlanilha: "548" },
    canonico: { codigo: "ME-000021", codigoPlanilha: "437" },
    nomeDoAbsorvido: "SACHÊ SÍLICA GEL 5G",
  },
  // Onda 3 — aprovada pelo PO em 2026-09-17 (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01).
  // G4: duplicado verdadeiro. Nenhum dos dois tem uso físico, Formulação, compra, estoque
  // nem histórico que diferencie material; o MP-000475 é o único com fornecedor e oferta
  // (APLINOVA). Consolida só o nutriente, canônico primeiro; forma física nenhuma é
  // inventada — o nome continua sem "pó" nem "líquido".
  {
    onda: "3",
    grupo: "G4",
    nome: "Concentrado de maçã",
    absorvido: { codigo: "MP-000149", codigoPlanilha: "149" },
    canonico: { codigo: "MP-000475", codigoPlanilha: "581" },
    consolidar: { declaredNutrient: "Açúcar de maçã · Carboidrato" },
  },
];

/**
 * Onda 3 — mesmo nome, material diferente (§114): cada registro ganha um nome
 * técnico distinto, e nada mais muda — código, fornecedores, ofertas, histórico,
 * `declaredNutrient` e Formulações ficam onde estão. `de` é o nome exato de hoje:
 * a ferramenta recusa se ele já não for o gravado.
 */
export const RENOMEACOES_DE_ITEM: readonly DecisaoDeRenomeacao[] = [
  {
    onda: "3",
    grupo: "G7",
    cadastro: "ITEM",
    nome: "Extrato de polpa de oliva (Olea europaea L.)",
    renomear: [
      {
        codigo: "MP-000320",
        codigoPlanilha: "321",
        de: "Extrato de polpa de oliva (Olea europaea L.)",
        para: "Extrato de polpa de oliva (Olea europaea L.) — Verbascosídeo",
      },
      {
        codigo: "MP-000468",
        codigoPlanilha: "574",
        de: "Extrato de polpa de oliva (Olea europaea L.)",
        para: "Extrato de polpa de oliva (Olea europaea L.) — Hidroxitirosol",
      },
    ],
    manter: [],
    motivo:
      "Materiais/especificações diferentes (Verbascosídeo × Hidroxitirosol): nome técnico distinto resolve a colisão (§114). Decisão do PO, Onda 3.",
  },
  {
    onda: "3",
    grupo: "G13",
    cadastro: "ITEM",
    nome: "Guaraná em pó soluvel",
    renomear: [
      { codigo: "MP-000393", codigoPlanilha: "409", de: "Guaraná em pó soluvel", para: "Extrato de guaraná 22%" },
    ],
    // O MP-000486 fica com o nome gravado hoje, sem mudança nenhuma.
    manter: [{ codigo: "MP-000486", codigoPlanilha: "594", nome: "Guaraná em pó soluvel" }],
    motivo:
      "Materiais diferentes: o MP-000393 é o extrato declarado a 22% (nutriente \"EXT GUARANÁ 22%\", pureza 22); o MP-000486 mantém o nome. Nome técnico distinto resolve a colisão (§114). Decisão do PO, Onda 3.",
  },
];

/**
 * Onda 3 — cadastros de teste nunca usados. Sai o agregado inteiro: o Modelo e a
 * V1 DRAFT que nasceu com ele. O buraco nos códigos é aceito, e a sequence não volta.
 */
export const EXCLUSOES_DE_AGREGADO: readonly DecisaoDeExclusaoDeAgregado[] = [
  {
    onda: "3",
    grupo: "MODELO-X",
    cadastro: "FORMULATION_TEMPLATE",
    nome: "X",
    excluir: [{ codigo: "FT-000001" }, { codigo: "FT-000002" }],
    motivo:
      "Cadastro de teste nunca usado: só a V1 DRAFT, sem componente, sem Formulação derivada nem referência. Decisão do PO: excluir os dois (Onda 3); buraco nos códigos aceito, sequence não volta.",
  },
];

/**
 * Onda 3 — continuam em revisão: dependem da Veridi. Aparecem no PLAN como
 * BLOCKED e nada neles é tocado. A resposta NÃO se infere: o significado de `*`
 * e `**` e o teor de cada material vêm da Veridi.
 */
export const GRUPOS_EM_REVISAO: readonly DecisaoDeRevisao[] = [
  {
    onda: "3",
    grupo: "G6",
    cadastro: "ITEM",
    nome: "Extrato de café verde",
    codigos: ["MP-000325", "MP-000348"],
    motivo: "Decisão do PO (Onda 3): continua em revisão — depende da Veridi. Não fundir, não renomear, não tocar.",
    perguntas: [
      'O que significam "*" e "**" nos nutrientes? (MP-000348 declara "Clorogênico**"; MP-000325, "Clorogênico")',
      "Qual o teor real de ácido clorogênico de cada código de Extrato de café verde (MP-000325 e MP-000348)?",
      "As cotações FLORIEN R$160/kg (pedido mínimo 1 kg) e R$650/kg (pedido mínimo 100 g) representam a mesma especificação/material?",
      "Por que o código legado 349 (MP-000348) aparece nas fórmulas antigas com teor aplicado de 8%, 45% e 50%?",
    ],
  },
  {
    onda: "3",
    grupo: "G11",
    cadastro: "ITEM",
    nome: "Fosfato de piridoxal",
    codigos: ["MP-000014", "MP-000022"],
    motivo: "Decisão do PO (Onda 3): continua em revisão — depende da Veridi. Não fundir, não renomear, não tocar.",
    perguntas: [
      'O que significam "*" e "**" nos nutrientes? (MP-000022 declara "Vitamina B6*"; MP-000014, "Vitamina B6")',
    ],
  },
];
