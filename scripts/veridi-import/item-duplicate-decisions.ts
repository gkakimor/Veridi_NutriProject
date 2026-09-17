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
];
