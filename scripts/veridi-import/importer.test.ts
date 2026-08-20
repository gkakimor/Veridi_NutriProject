import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corpusAvailable } from "../veridi-data/corpus.js";
import { parseMinimumOrder } from "../veridi-data/supplier-price-analysis.js";
import { ImportFindingLog, severityOf } from "./findings.js";
import { applyOpeningRow, validateOpeningRows } from "./opening-stock.js";
import type { TemplateRow } from "./opening-stock.js";
import type { Overrides } from "./overrides.js";
import { readOverrides } from "./overrides.js";
import { runPipeline } from "./pipeline.js";
import { buildSourceManifest, diffManifests } from "./sources.js";

/**
 * Testes do importador definitivo (capacidade 41).
 *
 * Findings NÃO são falha de teste: dado legado ruim é esperado. O que
 * falha aqui é o importador deixar de detectar um problema, passar a
 * importar linha insegura, quebrar idempotência ou movimentar estoque numa
 * importação de master data.
 *
 * Os casos que dependem do corpus real (fora do repositório) e do banco
 * local são pulados quando qualquer um dos dois não está disponível.
 */

const hasCorpus = corpusAvailable();
const hasDatabase = Boolean(process.env["DATABASE_URL"]);
const integration = hasCorpus && hasDatabase ? describe : describe.skip;

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

/*
 * Precondição dos casos de integração: o master data do corpus já aplicado.
 *
 * Os números conferidos aqui — 106 linhas no template de abertura, zero
 * registro criado numa segunda aplicação — descrevem uma base JÁ migrada.
 * Nada estabelecia isso: o próprio arquivo aplicava o corpus no meio da
 * suíte, então a primeira execução contra um banco recém-migrado falhava e
 * as seguintes passavam por herança da anterior. Um teste que depende do
 * histórico do banco não prova nada sobre o importador.
 *
 * `runPipeline` com `write` é idempotente por construção — é isso que o
 * próprio teste de idempotência verifica —, então garantir a precondição
 * aqui não muda nenhuma expectativa: só torna a suíte determinística a
 * partir de um schema vazio.
 */
let corpusAplicado = false;
async function garantirCorpusAplicado(): Promise<void> {
  if (corpusAplicado) return;
  await runPipeline({ prisma, write: true, overrides: readOverrides() });
  corpusAplicado = true;
}

function emptyOverrides(): Overrides {
  return { items: new Map(), priceUoms: new Map(), samples: new Map() };
}

function openingRow(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    lineNumber: 2,
    cutoverDate: "2026-08-16",
    itemCode: "MP-000001",
    expectedLegacyTotal: new Prisma.Decimal(100),
    internalLotCode: null,
    supplierLot: "FORN-123",
    businessLotNumber: null,
    ownerType: "VERIDI",
    ownerCustomerCode: null,
    quantity: new Prisma.Decimal(100),
    expiryDate: null,
    location: null,
    qualityStatus: null,
    coaStatus: null,
    notes: null,
    ...overrides,
  };
}

describe("Findings — severidade", () => {
  it("classifica o que entra, o que fica de fora e o que é política", () => {
    expect(severityOf("SUPPLIER_ITEM_ITEM_UNRESOLVED")).toBe("BLOCKING");
    expect(severityOf("CUSTOMER_CNPJ_INVALID")).toBe("REVIEW");
    expect(severityOf("MOQ_ASSUMED_ITEM_UOM")).toBe("INFO");
    expect(severityOf("NEGATIVE_LEGACY_STOCK")).toBe("EXCLUDED_BY_POLICY");
    // Código novo nunca some silenciosamente: cai em revisão.
    expect(severityOf("CODIGO_QUE_AINDA_NAO_EXISTE")).toBe("REVIEW");
  });

  it("agrupa por código com os bloqueadores primeiro", () => {
    const findings = new ImportFindingLog();
    findings.add("MOQ_ASSUMED_ITEM_UOM", "Offer", "1", "número puro");
    findings.add("MOQ_ASSUMED_ITEM_UOM", "Offer", "2", "número puro");
    findings.add("SUPPLIER_PRICE_INVALID", "Offer", "3", "preço ilegível");

    const summary = findings.summary();
    expect(summary[0]!.code).toBe("SUPPLIER_PRICE_INVALID");
    expect(summary[0]!.severity).toBe("BLOCKING");
    expect(summary[1]!.count).toBe(2);
    expect(findings.countBySeverity().INFO).toBe(2);
  });
});

describe("MOQ legado", () => {
  it("interpreta número puro como unidade do item e não inventa o ambíguo", () => {
    const numeric = parseMinimumOrder("25");
    expect(numeric?.quantity.toString()).toBe("25");
    // Sem unidade no texto: quem decide é o item, e a transformação vira INFO.
    expect(numeric?.uomCode).toBeNull();

    expect(parseMinimumOrder("500G")?.uomCode).toBe("g");
    expect(parseMinimumOrder("1 KG")?.quantity.toString()).toBe("1");
    expect(parseMinimumOrder("1000UNI")?.uomCode).toBe("un");
    expect(parseMinimumOrder("0.25")?.quantity.toString()).toBe("0.25");

    // "1mil", "KG" e "-" exigiriam adivinhação.
    expect(parseMinimumOrder("1mil")).toBeNull();
    expect(parseMinimumOrder("KG")).toBeNull();
    expect(parseMinimumOrder("-")).toBeNull();
  });
});

describe("Abertura de estoque — reconciliação", () => {
  it("aceita quando a soma dos lotes bate com o saldo legado", () => {
    const errors = validateOpeningRows(
      { controlsLot: true },
      [
        openingRow({ quantity: new Prisma.Decimal(60), supplierLot: "A" }),
        openingRow({ lineNumber: 3, quantity: new Prisma.Decimal(40), supplierLot: "B" }),
      ],
      new Prisma.Decimal(100),
    );
    expect(errors).toEqual([]);
  });

  it("recusa o item inteiro quando a soma diverge do saldo legado", () => {
    const errors = validateOpeningRows(
      { controlsLot: true },
      [openingRow({ quantity: new Prisma.Decimal(90) })],
      new Prisma.Decimal(100),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("diferença -10");
  });

  it("exige lote em item loteado, dono explícito e recusa CoA aprovado por texto", () => {
    const withoutLot = validateOpeningRows(
      { controlsLot: true },
      [openingRow({ supplierLot: null, businessLotNumber: null, internalLotCode: null })],
      null,
    );
    expect(withoutLot.some((error) => error.includes("item controla lote"))).toBe(true);

    const customerWithoutCode = validateOpeningRows(
      { controlsLot: false },
      [openingRow({ ownerType: "CUSTOMER", ownerCustomerCode: null })],
      null,
    );
    expect(customerWithoutCode.some((error) => error.includes("ownerCustomerCode"))).toBe(true);

    const approvedCoa = validateOpeningRows(
      { controlsLot: false },
      [openingRow({ coaStatus: "APPROVED" })],
      null,
    );
    expect(approvedCoa.some((error) => error.includes("coaStatus APPROVED"))).toBe(true);

    const negative = validateOpeningRows(
      { controlsLot: false },
      [openingRow({ quantity: new Prisma.Decimal(-5), expectedLegacyTotal: null })],
      null,
    );
    expect(negative.some((error) => error.includes("maior que zero"))).toBe(true);
  });
});

describe("Manifesto da fonte", () => {
  it("acusa quando o conteúdo muda depois do plano", () => {
    if (!hasCorpus) return;

    const planned = buildSourceManifest();
    expect(diffManifests(planned, planned)).toEqual([]);

    const tampered = planned.map((file) =>
      file.name === "itens.csv" ? { ...file, sha256: "0".repeat(64) } : file,
    );
    const differences = diffManifests(tampered, planned);
    expect(differences).toHaveLength(1);
    expect(differences[0]).toContain("itens.csv");
  });
});

integration("Migração — corpus real (dry-run)", () => {
  beforeAll(garantirCorpusAplicado, 120_000);
  it("preserva as invariantes conhecidas do corpus", async () => {
    const result = await runPipeline({ prisma, write: false, overrides: emptyOverrides() });

    // Motor de formulação × histórico: a única divergência que seria
    // defeito de código, não dado ruim.
    expect(result.golden).toEqual({ comparable: 26, matched: 26, divergent: 0 });

    // Saldo legado: negativos e ilegíveis nunca migram.
    expect(result.stock.negative).toBe(103);
    expect(result.stock.unreadable).toBe(9);
    expect(result.stock.positive).toBe(106);
    expect(result.templates.openingInventory).toHaveLength(106);

    const codes = new Set(result.findings.summary().map((row) => row.code));
    for (const expected of [
      "CUSTOMER_CNPJ_INVALID",
      "ADDRESS_PARSE_REVIEW_REQUIRED",
      "ITEM_ENRICHMENT_UNMATCHED",
      "SUPPLIER_ITEM_ITEM_UNRESOLVED",
      "SUPPLIER_PRICE_INVALID",
      "SUPPLIER_PRICE_UOM_INCOMPATIBLE",
      "MOQ_ASSUMED_ITEM_UOM",
      "NEGATIVE_LEGACY_STOCK",
      "DEFERRED_CMV",
      "DEFERRED_IN28",
      "DEFERRED_RECEIPT_HISTORY",
    ]) {
      expect(codes.has(expected), `finding ausente: ${expected}`).toBe(true);
    }

    // O aviso de status inferido só existe quando o projeto é criado: numa
    // base já migrada não há o que inferir de novo.
    if (result.domains.projects.created > 0) {
      expect(codes.has("PROJECT_LEGACY_STATUS_NOT_EXPORTED")).toBe(true);
    }
  });

  it("não resolve item de preço sem override, e resolve com ele", async () => {
    const without = await runPipeline({ prisma, write: false, overrides: emptyOverrides() });
    const unresolved = without.templates.unresolvedItemCodes;
    expect(unresolved.length).toBeGreaterThan(0);

    const target = await prisma.item.findFirst({
      where: { type: "RAW_MATERIAL", externalCode: { not: null } },
    });
    const overrides = emptyOverrides();
    overrides.items.set(unresolved[0]!.legacyItemCode, {
      legacyItemCode: unresolved[0]!.legacyItemCode,
      action: "MAP",
      targetItemCode: target!.code,
      note: "teste",
    });

    const mapped = await runPipeline({ prisma, write: false, overrides });
    expect(mapped.templates.unresolvedItemCodes.length).toBe(unresolved.length - 1);
    const codes = new Set(mapped.findings.summary().map((row) => row.code));
    expect(codes.has("SUPPLIER_ITEM_MAPPED_BY_OVERRIDE")).toBe(true);

    // Override apontando para item inexistente não inventa nada.
    const broken = emptyOverrides();
    broken.items.set(unresolved[0]!.legacyItemCode, {
      legacyItemCode: unresolved[0]!.legacyItemCode,
      action: "MAP",
      targetItemCode: "MP-NAO-EXISTE",
      note: "teste",
    });
    const brokenResult = await runPipeline({ prisma, write: false, overrides: broken });
    const brokenCodes = new Set(brokenResult.findings.summary().map((row) => row.code));
    expect(brokenCodes.has("SUPPLIER_ITEM_OVERRIDE_TARGET_UNKNOWN")).toBe(true);
  });

  it("só cria oferta com unidade incompatível quando existe override explícito", async () => {
    const base = await runPipeline({ prisma, write: false, overrides: emptyOverrides() });
    const incompatible = base.templates.incompatiblePriceUom[0];
    expect(incompatible).toBeDefined();

    const ignoring = emptyOverrides();
    ignoring.priceUoms.set(incompatible!.sourceKey, {
      sourceKey: incompatible!.sourceKey,
      action: "IGNORE_PRICE",
      overridePriceUom: null,
      note: "teste",
    });
    const ignored = await runPipeline({ prisma, write: false, overrides: ignoring });
    expect(ignored.templates.incompatiblePriceUom.length).toBe(
      base.templates.incompatiblePriceUom.length - 1,
    );

    const mapping = emptyOverrides();
    mapping.priceUoms.set(incompatible!.sourceKey, {
      sourceKey: incompatible!.sourceKey,
      action: "MAP_UOM",
      overridePriceUom: incompatible!.itemUom,
      note: "teste",
    });
    const mapped = await runPipeline({ prisma, write: false, overrides: mapping });
    const codes = new Set(mapped.findings.summary().map((row) => row.code));
    expect(codes.has("SUPPLIER_PRICE_UOM_BY_OVERRIDE")).toBe(true);
    expect(mapped.domains.supplierItemOffers.created).toBe(
      base.domains.supplierItemOffers.created + 1,
    );
  });

  it("recusa amostra sem projeto inequívoco e aceita override para projeto existente", async () => {
    const base = await runPipeline({ prisma, write: false, overrides: emptyOverrides() });
    const unresolved = base.templates.unresolvedSamples[0];
    expect(unresolved).toBeDefined();

    const project = await prisma.project.findFirst({ where: { source: "LEGACY_IMPORT" } });
    const overrides = emptyOverrides();
    overrides.samples.set(unresolved!.legacySample, {
      legacySample: unresolved!.legacySample,
      action: "MAP",
      targetProjectCode: project!.code,
      note: "teste",
    });
    const mapped = await runPipeline({ prisma, write: false, overrides });
    const codes = new Set(mapped.findings.summary().map((row) => row.code));
    // Amostra sem número de teste continua fora mesmo com override: o Tn
    // histórico não é inventado.
    expect(
      codes.has("SAMPLE_MAPPED_BY_OVERRIDE") || codes.has("SAMPLE_WITHOUT_TEST_NUMBER"),
    ).toBe(true);

    const broken = emptyOverrides();
    broken.samples.set(unresolved!.legacySample, {
      legacySample: unresolved!.legacySample,
      action: "MAP",
      targetProjectCode: "PROJ-NAO-EXISTE",
      note: "teste",
    });
    const brokenResult = await runPipeline({ prisma, write: false, overrides: broken });
    const brokenCodes = new Set(brokenResult.findings.summary().map((row) => row.code));
    expect(
      brokenCodes.has("SAMPLE_OVERRIDE_PROJECT_UNKNOWN") ||
        brokenCodes.has("SAMPLE_WITHOUT_TEST_NUMBER"),
    ).toBe(true);
  });
});

integration("Migração — aplicação idempotente", () => {
  beforeAll(garantirCorpusAplicado, 120_000);
  it("aplica sem duplicar e sem movimentar estoque", async () => {
    const before = {
      items: await prisma.item.count(),
      suppliers: await prisma.supplier.count(),
      projects: await prisma.project.count(),
      offers: await prisma.supplierItemOffer.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    const first = await runPipeline({ prisma, write: true, overrides: readOverrides() });
    const second = await runPipeline({ prisma, write: true, overrides: readOverrides() });

    // Base já importada: nenhuma execução pode criar registro novo.
    for (const counts of [first.domains, second.domains]) {
      for (const [domain, value] of Object.entries(counts)) {
        expect(value.created, `${domain} criou registros numa base já migrada`).toBe(0);
      }
    }

    const after = {
      items: await prisma.item.count(),
      suppliers: await prisma.supplier.count(),
      projects: await prisma.project.count(),
      offers: await prisma.supplierItemOffer.count(),
      movements: await prisma.inventoryMovement.count(),
    };
    expect(after).toEqual(before);

    // Invariante estrutural: importar master data nunca cria movimento.
    const importMovements = await prisma.inventoryMovement.count({
      where: { createdBy: "Importação Veridi" },
    });
    expect(importMovements).toBe(0);
  });

  it("nunca marca oferta legada como vigente", async () => {
    const legacyWithValidity = await prisma.supplierItemOffer.count({
      where: { source: "LEGACY_IMPORT", effectiveAt: { not: null } },
    });
    expect(legacyWithValidity).toBe(0);
  });
});

integration("Abertura de estoque — aplicação", () => {
  beforeAll(garantirCorpusAplicado, 120_000);
  it("cria lote e movimento OPENING_BALANCE uma única vez", async () => {
    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
    const item = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-OPEN-${marker}`,
        name: `Insumo Abertura ${marker}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: true,
        requiresCoa: false,
        active: true,
      },
    });

    try {
      const rows = [
        openingRow({
          itemCode: item.code,
          supplierLot: `LOTE-A-${marker}`,
          quantity: new Prisma.Decimal(60),
        }),
        openingRow({
          lineNumber: 3,
          itemCode: item.code,
          supplierLot: `LOTE-B-${marker}`,
          quantity: new Prisma.Decimal(40),
        }),
      ];
      // Reconciliação: 60 + 40 = 100 do saldo legado.
      expect(
        validateOpeningRows({ controlsLot: true }, rows, new Prisma.Decimal(100)),
      ).toEqual([]);

      const target = { itemId: item.id, itemCode: item.code, requiresCoa: false };
      for (const row of rows) {
        expect(await applyOpeningRow(prisma, target, row)).toBe("CREATED");
      }

      const lots = await prisma.lot.findMany({ where: { itemId: item.id } });
      expect(lots).toHaveLength(2);
      // Identidade do lote é do ERP, e sem evidência de liberação o lote
      // nasce aguardando a Qualidade.
      expect(lots.every((lot) => lot.code.startsWith("LT-"))).toBe(true);
      expect(lots.every((lot) => lot.origin === "OPENING_BALANCE")).toBe(true);
      expect(lots.every((lot) => lot.status === "AWAITING_RELEASE")).toBe(true);

      const movements = await prisma.inventoryMovement.findMany({ where: { itemId: item.id } });
      expect(movements).toHaveLength(2);
      expect(movements.every((movement) => movement.type === "OPENING_BALANCE")).toBe(true);
      const total = movements.reduce(
        (sum, movement) => sum.plus(movement.quantity),
        new Prisma.Decimal(0),
      );
      expect(total.toString()).toBe("100");

      // Reaplicar a mesma linha não duplica estoque.
      for (const row of rows) {
        expect(await applyOpeningRow(prisma, target, row)).toBe("ALREADY_APPLIED");
      }
      expect(await prisma.inventoryMovement.count({ where: { itemId: item.id } })).toBe(2);
      expect(await prisma.lot.count({ where: { itemId: item.id } })).toBe(2);
    } finally {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: item.id } });
      await prisma.lot.deleteMany({ where: { itemId: item.id } });
      await prisma.item.delete({ where: { id: item.id } });
    }
  });
});
