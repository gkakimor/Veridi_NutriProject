import type { DecisaoDeDuplicata } from "./item-duplicates.js";

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
 * mais de dois, par nomeado e consolidação no canônico),
 * `master-data-duplicate-sanitization.ts --onda=2`. As duas leem daqui, e cada
 * uma recusa a onda da outra.
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
  // do código; termo que só difere por asterisco final é o mesmo termo (fica a grafia do
  // canônico). O valor final está escrito aqui e a ferramenta recusa o grupo se o
  // cálculo não der exatamente isto. Executada por master-data-duplicate-sanitization.ts.
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
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000165", codigoPlanilha: "166" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: { declaredNutrient: "Clorogênico** · Adenosina · Rutina" },
  },
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000324", codigoPlanilha: "325" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: { declaredNutrient: "Clorogênico** · Adenosina · Rutina" },
  },
  {
    onda: "2",
    grupo: "G5",
    nome: "Concentrado hidrossolúvel de tomate (Lycopersicon esculentum)",
    absorvido: { codigo: "MP-000349", codigoPlanilha: "350" },
    canonico: { codigo: "MP-000347", codigoPlanilha: "348" },
    consolidar: { declaredNutrient: "Clorogênico** · Adenosina · Rutina" },
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
];
