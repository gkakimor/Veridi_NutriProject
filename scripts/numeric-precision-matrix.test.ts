import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda coluna numérica do schema segue a matriz aprovada — `PRODUCT_RULES.md` §58.
 *
 * O defeito que este teste impede é o de reincidência: uma capability futura
 * cria uma tabela nova com `quantity Decimal @db.Decimal(18, 6)` porque copiou
 * a linha de cima, e a microdosagem volta a zerar sem ninguém perceber. A
 * auditoria PREC-01 encontrou isso com dado real; o custo de reencontrá-lo é
 * outra migration.
 *
 * O teste é deliberadamente **grosso**: ele não interpreta o domínio nem tenta
 * adivinhar categoria. Ele exige que toda `@db.Decimal` do schema tenha uma
 * precisão que a matriz reconhece, e mantém a lista das exceções nomeadas — as
 * que o PO decidiu manter, e as que ainda esperam PREC-MIG-B a E. Uma coluna
 * nova com precisão fora da matriz falha aqui e obriga uma decisão explícita.
 */

const SCHEMA = join(process.cwd(), "apps", "api", "prisma", "schema.prisma");

/** Precisões que a matriz de §58 autoriza hoje, com o que cada uma significa. */
const PRECISOES_DA_MATRIZ = new Map<string, string>([
  ["24,12", "QUANTITY, FACTOR/conversão e TECHNICAL_RESULT persistido"],
  ["14,2", "COMMERCIAL_TOTAL fechado"],
  ["7,4", "PERCENTAGE comercial"],
  ["12,4", "MARKUP e PHYSICAL_MEASUREMENT (kW)"],
  // Ainda não migradas. Cada uma tem capability nomeada no BACKLOG, seção E.
  ["14,4", "UNIT_COST/UNIT_PRICE/RATE — aguarda PREC-MIG-B"],
  ["14,6", "UNIT_PRICE técnico da precificação — aguarda PREC-MIG-B"],
  ["6,3", "PURITY/OVERAGE — aguarda PREC-MIG-C"],
  ["18,6", "excluídas do PREC-MIG-A por decisão — ver lista abaixo"],
]);

/**
 * As únicas colunas que podem permanecer em `18,6` depois do PREC-MIG-A.
 *
 * Não é uma lista de tolerância: é a decisão registrada. Os dois campos
 * `legacy*` são dado importado sobre o qual ninguém calcula
 * (`NOT_APPLICABLE` no inventário da auditoria), e
 * `QuoteLine.industrialCostPerUnitSnapshot` viaja com os demais snapshots de
 * precificação da mesma linha, no PREC-MIG-B — separá-lo quebraria a família.
 */
const EXCECOES_18_6 = new Set([
  "FormulationComponent.legacyTotalQuantity",
  "FormulationComponent.legacyBatchUnits",
  "QuoteLine.industrialCostPerUnitSnapshot",
]);

interface Coluna {
  model: string;
  campo: string;
  precisao: string;
}

function lerColunasDecimais(): Coluna[] {
  const linhas = readFileSync(SCHEMA, "utf8").split("\n");
  const colunas: Coluna[] = [];
  let model = "";
  for (const linha of linhas) {
    const inicioModel = /^model (\w+)/.exec(linha);
    if (inicioModel) {
      model = inicioModel[1]!;
      continue;
    }
    const decimal = /@db\.Decimal\((\d+),\s*(\d+)\)/.exec(linha);
    if (!decimal) continue;
    const campo = linha.trim().split(/\s+/)[0]!;
    colunas.push({ model, campo, precisao: `${decimal[1]},${decimal[2]}` });
  }
  return colunas;
}

describe("matriz de precisão numérica", () => {
  const colunas = lerColunasDecimais();

  it("o schema tem colunas Decimal para conferir", () => {
    expect(colunas.length).toBeGreaterThan(50);
  });

  it("toda coluna Decimal declara precisão e scale explícitos", () => {
    // Uma `Decimal` sem `@db.Decimal` vira `DECIMAL(65,30)` no PostgreSQL —
    // precisão que ninguém decidiu e que o motor não consegue produzir.
    const sem = readFileSync(SCHEMA, "utf8")
      .split("\n")
      .filter((l) => /^\s+\w+\s+Decimal/.test(l) && !l.includes("@db.Decimal"));
    expect(sem).toEqual([]);
  });

  it("toda precisão usada está na matriz aprovada", () => {
    const fora = colunas
      .filter((c) => !PRECISOES_DA_MATRIZ.has(c.precisao))
      .map((c) => `${c.model}.${c.campo} = Decimal(${c.precisao})`);
    expect(fora).toEqual([]);
  });

  it("nenhuma coluna nova ficou em 18,6 — só as exceções decididas", () => {
    const emSeisCasas = colunas
      .filter((c) => c.precisao === "18,6")
      .map((c) => `${c.model}.${c.campo}`)
      .filter((chave) => !EXCECOES_18_6.has(chave));
    expect(emSeisCasas).toEqual([]);
  });

  it("as exceções continuam existindo — a lista não pode virar letra morta", () => {
    // Se um campo da lista for removido ou migrado, a exceção sai junto. Sem
    // isto a lista cresceria e ninguém notaria que ela já não descreve nada.
    const presentes = new Set(colunas.map((c) => `${c.model}.${c.campo}`));
    for (const excecao of EXCECOES_18_6) {
      expect(presentes.has(excecao), `${excecao} saiu do schema; remova a exceção`).toBe(true);
    }
  });

  it("as quantidades do PREC-MIG-A estão em 24,12", () => {
    const criticas = [
      "ProductionOrderRequirement.requiredQuantity",
      "ProductionOrderRequirement.theoreticalQuantity",
      "MaterialReservationLine.quantity",
      "ProductionConsumption.quantity",
      "InventoryMovement.quantity",
      "RecipeWeighing.plannedQuantitySnapshot",
      "SampleConsumption.quantity",
      "UnitOfMeasure.toBaseFactor",
    ];
    const porChave = new Map(colunas.map((c) => [`${c.model}.${c.campo}`, c.precisao]));
    for (const chave of criticas) {
      expect(porChave.get(chave), `${chave} deveria ser Decimal(24,12)`).toBe("24,12");
    }
  });
});
