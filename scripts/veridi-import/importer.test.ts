import { Prisma, PrismaClient } from "@prisma/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORPUS_DIR, corpusAvailable } from "../veridi-data/corpus.js";
import { mapSuppliers } from "../veridi-data/mapping.js";
import {
  normalizeSupplierName,
  parseMinimumOrder,
} from "../veridi-data/supplier-price-analysis.js";
import { bloqueiosDaRevisao, loadReviewPackage } from "./review-package.js";
import { ImportFindingLog, severityOf } from "./findings.js";
import { applyOpeningRow, validateOpeningRows } from "./opening-stock.js";
import type { TemplateRow } from "./opening-stock.js";
import type { Overrides } from "./overrides.js";
import { readOverrides } from "./overrides.js";
import { WORKBOOKS_DO_ESCOPO, chaveDoItem, runPipeline } from "./pipeline.js";
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


/* ─────────────── Ponte com o pacote revisado (BRIDGE-01/02) ─────────────── */

const pastasTemporarias: string[] = [];

afterAll(() => {
  for (const pasta of pastasTemporarias) fs.rmSync(pasta, { recursive: true, force: true });
});

interface LinhaDoPacote {
  chave: string;
  status: string;
  campos: Record<string, string | number | null>;
}

/**
 * Pacote sintético sobre dado REAL, lido do corpus e do banco em tempo de
 * execução — nunca escrito neste arquivo. O que a Veridi tem fica fora do Git,
 * teste incluído. O pacote exercita o caminho de escrita: aprovar, excluir,
 * aplicar valores revisados e reaplicar sem duplicar.
 *
 * Workbook ausente reprova a carga, então todos os seis do escopo aparecem —
 * vazio quando o cenário não precisa dele.
 */
function pacoteSintetico(workbooks: Record<string, LinhaDoPacote[]>): string {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "veridi-bridge-"));
  pastasTemporarias.push(pasta);
  const destino = path.join(pasta, "pacote-revisao.json");
  const completo = Object.fromEntries(
    WORKBOOKS_DO_ESCOPO.map((nome) => [
      nome,
      {
        colunaStatus: "STATUS_REVISAO",
        statusPermitidos: ["REVISAR", "OK", "PENDENTE", "NAO_IMPORTAR"],
        colunas: ["CHAVE_MIGRACAO", "STATUS_REVISAO"],
        obrigatorias: ["CHAVE_MIGRACAO", "STATUS_REVISAO"],
        contagem: {},
        registros: workbooks[nome] ?? [],
      },
    ]),
  );
  fs.writeFileSync(
    destino,
    JSON.stringify({
      formato: 1,
      geradoEm: new Date().toISOString(),
      pacote: {
        caminho: pasta,
        identidade: "a".repeat(64),
        referencia: null,
        arquivos: WORKBOOKS_DO_ESCOPO.map((nome) => ({
          nome,
          sha256: "b".repeat(64),
          bytes: 1,
          modificadoEm: "",
          registros: (workbooks[nome] ?? []).length,
        })),
      },
      validacao: { devolucao: true, erros: 0 },
      workbooks: completo,
    }),
    "utf8",
  );
  return destino;
}

const chaveDoCliente = (externalCode: string): string => `CLI-LEG-${externalCode.padStart(4, "0")}`;

function linhaFornecedor(legalName: string, status: string): LinhaDoPacote {
  return {
    chave: `FOR-LEG-${normalizeSupplierName(legalName).replace(/ /g, "-")}`,
    status,
    campos: { NOME_PLANILHA: legalName, RAZAO_SOCIAL_NOME: legalName, ATIVO: "SIM" },
  };
}

function linhaCliente(
  origem: { externalCode: string; legalName: string },
  status: string,
  campos: Record<string, string | null> = {},
): LinhaDoPacote {
  return {
    chave: chaveDoCliente(origem.externalCode),
    status,
    campos: {
      CODIGO_PLANILHA: origem.externalCode,
      RAZAO_SOCIAL_NOME: origem.legalName,
      ATIVO: "SIM",
      ...campos,
    },
  };
}

function linhaItem(
  origem: { externalCode: string; name: string; type: string; unitCode: string },
  status: string,
): LinhaDoPacote {
  return {
    chave: chaveDoItem(origem.externalCode),
    status,
    campos: {
      CODIGO_PLANILHA: origem.externalCode,
      NOME: origem.name,
      TIPO: origem.type === "PACKAGING" ? "EMBALAGEM" : "MATERIA_PRIMA",
      UNIDADE: origem.unitCode,
      ATIVO: "SIM",
    },
  };
}

function linhaProduto(
  origem: { externalCode: string; name: string; customerExternalCode: string },
  status: string,
  campos: Record<string, string | null> = {},
): LinhaDoPacote {
  const codigo = normalizeSupplierName(origem.externalCode).replace(/ /g, "-");
  return {
    chave: `PROD-LEG-${codigo}`,
    status,
    campos: {
      CHAVE_CLIENTE: chaveDoCliente(origem.customerExternalCode),
      NOME_PRODUTO: origem.name,
      REFERENCIA_EXTERNA: origem.externalCode,
      CHAVE_ITEM_PA: `PA-LEG-${codigo}`,
      UNIDADE_ESTOQUE: "un",
      ATIVO: "SIM",
      ...campos,
    },
  };
}

integration("Ponte com a revisão humana — corpus real", () => {
  it("o pacote real ainda em REVISAR bloqueia a carga", () => {
    const caminho = path.resolve(CORPUS_DIR, "..", "out", "pacote-revisao.json");
    // O JSON sai do tooling do pacote e fica fora do Git, como os .xlsx.
    if (!fs.existsSync(caminho)) return;
    const pacote = loadReviewPackage(caminho);
    const bloqueios = bloqueiosDaRevisao(pacote, WORKBOOKS_DO_ESCOPO);
    expect(bloqueios.length, "todo workbook do escopo tem de bloquear").toBe(
      WORKBOOKS_DO_ESCOPO.length,
    );
    expect(bloqueios.join(" ")).toMatch(/pendente\(s\) de revisão/);
  });

  it("aplica os valores aprovados dos quatro domínios e não duplica ao reaplicar", async () => {
    await garantirCorpusAplicado();

    const [fornecedor] = mapSuppliers(new ImportFindingLog()).slice(0, 1) as [{ legalName: string }];
    const produtoBase = await prisma.product.findFirst({
      where: { externalCode: { not: null }, customerId: { not: null } },
      include: { customer: true },
      orderBy: { code: "asc" },
    });
    expect(produtoBase?.customer?.externalCode, "base sem produto com cliente").toBeTruthy();
    const clienteDoProduto = produtoBase!.customer!;
    const itens = await prisma.item.findMany({
      where: { externalCode: { not: null }, type: { in: ["RAW_MATERIAL", "PACKAGING"] } },
      orderBy: { code: "asc" },
      take: 40,
    });
    const materias = itens.filter((item) => item.type === "RAW_MATERIAL").slice(0, 2);
    const embalagens = itens.filter((item) => item.type === "PACKAGING").slice(0, 1);

    const review = loadReviewPackage(
      pacoteSintetico({
        "02_FORNECEDORES": [linhaFornecedor(fornecedor.legalName, "OK")],
        "01_CLIENTES": [
          linhaCliente(
            { externalCode: clienteDoProduto.externalCode!, legalName: clienteDoProduto.legalName },
            "OK",
            { CIDADE: "Campinas", UF: "SP", PERFIL_TRIBUTARIO: "SIMPLES_NACIONAL" },
          ),
        ],
        "03_MATERIAS_PRIMAS": materias.map((item) =>
          linhaItem(
            {
              externalCode: item.externalCode!,
              name: item.name,
              type: item.type,
              unitCode: item.unitCode,
            },
            "OK",
          ),
        ),
        "04_EMBALAGENS_INSUMOS": embalagens.map((item) =>
          linhaItem(
            {
              externalCode: item.externalCode!,
              name: item.name,
              type: item.type,
              unitCode: item.unitCode,
            },
            "OK",
          ),
        ),
        "05_PRODUTOS_ACABADOS": [
          linhaProduto(
            {
              externalCode: produtoBase!.externalCode!,
              name: produtoBase!.name,
              customerExternalCode: clienteDoProduto.externalCode!,
            },
            "OK",
            { VIDA_UTIL_MESES: "24" },
          ),
        ],
      }),
    );

    const antes = {
      customers: await prisma.customer.count(),
      items: await prisma.item.count(),
      products: await prisma.product.count(),
      suppliers: await prisma.supplier.count(),
    };

    const primeira = await runPipeline({ prisma, write: true, overrides: emptyOverrides(), review });
    const segunda = await runPipeline({ prisma, write: true, overrides: emptyOverrides(), review });

    // Base já migrada: nenhuma execução cria registro novo em nenhum domínio.
    for (const resultado of [primeira, segunda]) {
      for (const dominio of [
        "customers",
        "items",
        "products",
        "suppliers",
        "finishedProductItems",
      ] as const) {
        expect(
          resultado.domains[dominio].created,
          `${dominio} criou registro numa base já migrada`,
        ).toBe(0);
      }
    }
    expect({
      customers: await prisma.customer.count(),
      items: await prisma.item.count(),
      products: await prisma.product.count(),
      suppliers: await prisma.supplier.count(),
    }).toEqual(antes);

    // Os valores revisados chegaram ao banco.
    const cliente = await prisma.customer.findFirst({
      where: { externalCode: clienteDoProduto.externalCode! },
    });
    expect(cliente?.city).toBe("Campinas");
    expect(cliente?.taxProfile).toBe("SIMPLES_NACIONAL");

    const produto = await prisma.product.findFirst({
      where: { externalCode: produtoBase!.externalCode! },
      include: { finishedProductItem: true },
    });
    expect(produto?.shelfLifeMonths).toBe(24);
    expect(produto?.customerId).toBe(cliente!.id);
    // Produto e item de produto acabado continuam 1:1, e é o MESMO par.
    expect(produto?.finishedProductItem?.type).toBe("FINISHED_PRODUCT");
    expect(produto?.finishedProductItemId).toBe(produtoBase!.finishedProductItemId);

    expect(primeira.review?.customers.approved).toBe(1);
    expect(primeira.review?.items.approved).toBe(materias.length + embalagens.length);
    expect(primeira.review?.products.approved).toBe(1);
    expect(primeira.review?.blocked).toBe(false);

    // Fixture do teste: o banco de desenvolvimento sai como entrou.
    await prisma.customer.update({
      where: { id: cliente!.id },
      data: { city: null, state: null, taxProfile: "NOT_INFORMED" },
    });
    await prisma.product.update({ where: { id: produto!.id }, data: { shelfLifeMonths: null } });
  });

  it("produto aprovado cujo cliente foi excluído bloqueia em vez de virar produto sem dono", async () => {
    await garantirCorpusAplicado();
    const produtoBase = await prisma.product.findFirst({
      where: { externalCode: { not: null }, customerId: { not: null } },
      include: { customer: true },
      orderBy: { code: "asc" },
    });
    const cliente = produtoBase!.customer!;

    const review = loadReviewPackage(
      pacoteSintetico({
        "01_CLIENTES": [
          linhaCliente(
            { externalCode: cliente.externalCode!, legalName: cliente.legalName },
            "NAO_IMPORTAR",
          ),
        ],
        "05_PRODUTOS_ACABADOS": [
          linhaProduto(
            {
              externalCode: produtoBase!.externalCode!,
              name: produtoBase!.name,
              customerExternalCode: cliente.externalCode!,
            },
            "OK",
          ),
        ],
      }),
    );

    const antes = await prisma.product.count();
    const resultado = await runPipeline({ prisma, write: true, overrides: emptyOverrides(), review });

    expect(await prisma.product.count()).toBe(antes);
    expect(resultado.findings.all().map((finding) => finding.code)).toContain(
      "PRODUCT_REVIEW_CUSTOMER_NOT_IMPORTED",
    );
    expect(resultado.domains.products.created).toBe(0);
  });

  it("workbook do escopo ausente no pacote reprova a carga", () => {
    const caminho = pacoteSintetico({});
    // Todos presentes e vazios: nada bloqueia por status.
    expect(bloqueiosDaRevisao(loadReviewPackage(caminho), WORKBOOKS_DO_ESCOPO)).toEqual([]);

    const bruto = JSON.parse(fs.readFileSync(caminho, "utf8")) as {
      workbooks: Record<string, unknown>;
    };
    delete bruto.workbooks["03_MATERIAS_PRIMAS"];
    fs.writeFileSync(caminho, JSON.stringify(bruto), "utf8");
    expect(bloqueiosDaRevisao(loadReviewPackage(caminho), WORKBOOKS_DO_ESCOPO)[0]).toContain(
      "ausente",
    );
  });
});
