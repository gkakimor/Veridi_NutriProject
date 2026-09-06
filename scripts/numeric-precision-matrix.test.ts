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
  ["20,8", "UNIT_COST"],
  ["9,6", "PURITY/OVERAGE"],
  // Ainda não migradas. Cada uma tem capability nomeada no BACKLOG, seção E.
  ["14,4", "UNIT_PRICE, RATE e composição de custo — aguardam PREC-MIG-D e decisão própria"],
  ["14,6", "UNIT_PRICE técnico da precificação — aguarda PREC-MIG-B"],
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

  it("os custos unitários do PREC-MIG-B estão em 20,8", () => {
    // A família UNIT_COST inteira, e só ela. Preço e tarifa continuam em 14,4
    // porque são outra categoria — o teste falha se alguém arrastar um
    // `unitPrice` documental junto por semelhança de nome.
    const porChave = new Map(colunas.map((c) => [`${c.model}.${c.campo}`, c.precisao]));
    for (const chave of [
      "ItemCostReference.unitCost",
      "ReceiptLine.actualUnitCost",
      "SupplierItemOffer.unitPrice",
    ]) {
      expect(porChave.get(chave), `${chave} deveria ser Decimal(20,8)`).toBe("20,8");
    }
    for (const chave of [
      "QuoteLine.unitPrice",
      "PurchaseOrderLine.unitPrice",
      "CustomerOrderLine.agreedUnitPrice",
      "BillingLine.unitPrice",
      "IndustrialResourceRate.rateValue",
    ]) {
      expect(porChave.get(chave), `${chave} não é UNIT_COST e não deveria ter migrado`).toBe(
        "14,4",
      );
    }
  });

  it("a pureza e o overage do PREC-MIG-C estão em 9,6", () => {
    // As sete colunas PERCENTAGE do inventário, e só elas. `6,3` saiu da
    // matriz junto: uma coluna nova de pureza copiada da linha de cima falha
    // em "toda precisão usada está na matriz aprovada" antes de chegar aqui.
    const porChave = new Map(colunas.map((c) => [`${c.model}.${c.campo}`, c.precisao]));
    for (const chave of [
      "Item.defaultPurityPercent",
      "FormulationComponent.purityPercentApplied",
      "FormulationComponent.overagePercent",
      "ProductionOrderRequirement.purityPercentApplied",
      "ProductionOrderRequirement.overagePercent",
      "FormulationTemplateComponent.purityPercentApplied",
      "FormulationTemplateComponent.overagePercent",
    ]) {
      expect(porChave.get(chave), `${chave} deveria ser Decimal(9,6)`).toBe("9,6");
    }
    // Percentual COMERCIAL é outra categoria e continua em 7,4 — o teste
    // falha se alguém arrastar um desconto ou uma margem por semelhança.
    for (const chave of [
      "QuoteVersion.discountPercent",
      "PricingTier.targetContributionMarginPercent",
    ]) {
      expect(porChave.get(chave), `${chave} não é PURITY/OVERAGE e não deveria ter migrado`).toBe(
        "7,4",
      );
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

/**
 * Widening NÃO é recálculo.
 *
 * `98.500` continua matematicamente `98.500000`; a coluna só passa a escrever
 * zeros à direita. Uma migration de precisão que traga um `UPDATE` estará
 * reescrevendo valor histórico — Formulação, OP, snapshot de custo — e casa
 * que nunca foi persistida não se reconstrói a partir do que sobrou. Este
 * teste é estático de propósito: ele lê o SQL versionado, não o banco, e falha
 * na revisão em vez de na produção.
 */
describe("as migrations de precisão só alargam tipo", () => {
  const MIGRACOES = [
    "20260925093001_numeric_precision_quantities_24_12",
    "20260925093002_numeric_precision_unit_cost_20_8",
    "20260925093003_numeric_precision_purity_overage_9_6",
  ];

  /** Os comandos reais, sem comentário — que é onde as palavras aparecem. */
  function comandos(migracao: string): string[] {
    const caminho = join(
      process.cwd(),
      "apps",
      "api",
      "prisma",
      "migrations",
      migracao,
      "migration.sql",
    );
    return readFileSync(caminho, "utf8")
      .split("\n")
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((bloco) => bloco.trim())
      .filter(Boolean);
  }

  for (const migracao of MIGRACOES) {
    it(`${migracao} contém apenas ALTER COLUMN ... SET DATA TYPE`, () => {
      // Um `ALTER TABLE` pode alargar várias colunas da MESMA tabela numa só
      // instrução, separadas por vírgula — é o que o PREC-MIG-A faz.
      const clausula = 'ALTER COLUMN "\\w+" SET DATA TYPE DECIMAL\\(\\d+,\\d+\\)';
      const widening = new RegExp(`^ALTER TABLE "\\w+" ${clausula}(, ${clausula})*$`);
      const fora = comandos(migracao).filter(
        (comando) => !widening.test(comando.replace(/\s+/g, " ")),
      );
      expect(fora, `${migracao} traz comando que não é widening`).toEqual([]);
    });
  }

  it("o PREC-MIG-C alarga as sete colunas de pureza e overage, e nada mais", () => {
    const alvo = comandos("20260925093003_numeric_precision_purity_overage_9_6").map((comando) =>
      comando.replace(/\s+/g, " "),
    );
    expect(alvo).toEqual([
      'ALTER TABLE "items" ALTER COLUMN "defaultPurityPercent" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "formulation_components" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "formulation_components" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "production_order_requirements" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "production_order_requirements" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "formulation_template_components" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6)',
      'ALTER TABLE "formulation_template_components" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6)',
    ]);
  });
});
