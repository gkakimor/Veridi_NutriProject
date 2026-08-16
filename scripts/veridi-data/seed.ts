import { Prisma, PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, FindingLog, corpusAvailable } from "./corpus.js";
import { assertLocalDevEnvironment } from "./environment.js";
import { doseToKg, readCmvProducts, reconstructGroup } from "./formulation-analysis.js";
import {
  groupLegacyProjects,
  legacyQuoteVersions,
  readLegacyProjectRows,
} from "./project-analysis.js";
import { normalizeName, readLegacySampleRows, resolveSamples } from "./sample-analysis.js";
import {
  legacyOfferSourceKey,
  normalizeSupplierName,
  parseMinimumOrder,
  readLegacySupplierPriceRows,
} from "./supplier-price-analysis.js";
import { nextSequenceCode } from "../../apps/api/src/lib/sequence-code.js";
import type { MappedItem } from "./mapping.js";
import {
  mapCustomers,
  mapItems,
  mapProducts,
  mapSuppliers,
  readFormulationRows,
  selectLatestGroups,
} from "./mapping.js";

/**
 * `pnpm veridi:data:seed` — popula a base LOCAL de desenvolvimento com o
 * corpus real da Veridi.
 *
 * Só roda em ambiente local (ver `environment.ts`). Idempotente por
 * `externalCode`: rodar de novo atualiza em vez de duplicar — já preparando
 * o importador definitivo (capacidade 41).
 *
 * O que NÃO é importado aqui, por decisão de roadmap: saldo de estoque
 * (a planilha tem negativos e nenhum lote real), compras/recebimentos,
 * preços de fornecedor, amostras, projetos como `Project`, CMV e IN28.
 */

const prisma = new PrismaClient();
const ACTOR = "Importação Veridi";
/** Unidades de massa do registro — usadas só para conferir compatibilidade do MOQ legado. */
const MASS_UOM_CODES = new Set(["mg", "g", "kg"]);
const HUNDRED = new Prisma.Decimal(100);

const UNITS = [
  { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  { code: "L", label: "Litro", dimension: "VOLUME" as const, toBaseFactor: "1" },
  { code: "mL", label: "Mililitro", dimension: "VOLUME" as const, toBaseFactor: "0.001" },
];

/**
 * Os códigos internos vêm das MESMAS sequences que a aplicação usa. Um
 * contador próprio aqui geraria códigos que o app tentaria reutilizar
 * depois — colisão garantida no primeiro cadastro manual.
 *
 * O mapa de sequences é repetido aqui (e não importado de
 * `modules/items/item-codes.ts`) porque aquele módulo importa
 * `@veridi/shared`, que não resolve fora do workspace da API. A sequence
 * no Postgres continua sendo a fonte única — o nome é que é copiado.
 */
const ITEM_CODE_SEQUENCE: Record<MappedItem["type"] | "FINISHED_PRODUCT", { sequence: string; prefix: string }> = {
  RAW_MATERIAL: { sequence: "item_code_raw_material_seq", prefix: "MP" },
  PACKAGING: { sequence: "item_code_packaging_seq", prefix: "ME" },
  FINISHED_PRODUCT: { sequence: "item_code_finished_product_seq", prefix: "PA" },
};

async function nextItemCode(type: keyof typeof ITEM_CODE_SEQUENCE): Promise<string> {
  const { sequence, prefix } = ITEM_CODE_SEQUENCE[type];
  return nextSequenceCode(prisma, sequence, prefix);
}

async function nextCustomerCode(): Promise<string> {
  return nextSequenceCode(prisma, "customer_code_seq", "CLI");
}

async function nextSupplierCode(): Promise<string> {
  return nextSequenceCode(prisma, "supplier_code_seq", "FOR");
}

async function nextProjectCode(): Promise<string> {
  return nextSequenceCode(prisma, "project_code_seq", "PROJ");
}

async function nextSampleCode(): Promise<string> {
  return nextSequenceCode(prisma, "project_sample_code_seq", "AM");
}

async function nextQuoteCode(): Promise<string> {
  return nextSequenceCode(prisma, "quote_code_seq", "ORC");
}

async function nextProductCode(): Promise<string> {
  return nextSequenceCode(prisma, "product_code_seq", "PROD");
}

async function resetDatabase(): Promise<void> {
  const environment = assertLocalDevEnvironment();
  console.log(`Reset autorizado — banco local ${environment.database} em ${environment.host}.`);

  // Ordem inversa das dependências. TRUNCATE … CASCADE limpa o grafo
  // operacional inteiro sem tocar em `_prisma_migrations`.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "billing_lines", "billings",
      "shipment_lines", "shipments",
      "customer_order_reservation_lines", "customer_order_reservations",
      "customer_order_lines", "customer_orders",
      "production_outputs", "production_consumptions",
      "material_reservation_lines", "material_reservations",
      "production_order_requirements", "production_orders",
      "inventory_movements", "lots",
      "receipt_lines", "receipts",
      "purchase_order_lines", "purchase_orders",
      "formulation_components", "formulation_versions",
      "products", "items", "customers", "suppliers"
    RESTART IDENTITY CASCADE
  `);
  console.log("Base operacional zerada.");
}

/**
 * De-para código legado × código interno.
 *
 * O código interno é o único identificador operacional do ERP; o código da
 * planilha serve para conferência humana e para reimportar sem duplicar.
 * Sai como arquivo em `.local-data` (fora do repositório, como o corpus) —
 * nenhuma tela ou export do sistema precisa expor código legado.
 */
async function writeCrossReference(): Promise<void> {
  const outputDir = path.resolve(CORPUS_DIR, "..", "de-para");
  fs.mkdirSync(outputDir, { recursive: true });

  const cell = (value: string | null): string => {
    const text = value ?? "";
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const write = (file: string, header: string[], rows: (string | null)[][]): void => {
    const content = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
    fs.writeFileSync(path.join(outputDir, file), `${content}\r\n`, "utf8");
  };

  const [customers, items, products, suppliers, samples] = await Promise.all([
    prisma.customer.findMany({ orderBy: { code: "asc" } }),
    prisma.item.findMany({ orderBy: { code: "asc" } }),
    prisma.product.findMany({ orderBy: { code: "asc" } }),
    prisma.supplier.findMany({ orderBy: { code: "asc" } }),
    prisma.projectSample.findMany({
      where: { source: "LEGACY_IMPORT" },
      orderBy: { code: "asc" },
      include: { project: { select: { code: true } } },
    }),
  ]);

  write(
    "de-para-clientes.csv",
    ["cod_cliente_planilha", "codigo_veridi", "razao_social", "cnpj"],
    customers.map((row) => [row.externalCode, row.code, row.legalName, row.cnpj]),
  );
  write(
    "de-para-itens.csv",
    ["cod_item_planilha", "codigo_veridi", "nome", "tipo"],
    items.map((row) => [row.externalCode, row.code, row.name, row.type]),
  );
  write(
    "de-para-produtos.csv",
    ["cod_produto_planilha", "codigo_veridi", "nome"],
    products.map((row) => [row.externalCode, row.code, row.name]),
  );
  write(
    "de-para-amostras.csv",
    ["lote_interno_planilha", "codigo_veridi", "projeto", "teste"],
    samples.map((row) => [
      row.externalCode,
      row.code,
      row.project.code,
      `T${row.testSequence}`,
    ]),
  );
  const supplierItems = await prisma.supplierItem.findMany({
    orderBy: [{ item: { code: "asc" } }, { supplier: { code: "asc" } }],
    include: { item: true, supplier: true, _count: { select: { offers: true } } },
  });
  write(
    "de-para-item-fornecedor.csv",
    [
      "cod_item_planilha",
      "codigo_veridi",
      "fornecedor",
      "codigo_fornecedor",
      "homologacao",
      "preferencial",
      "ofertas",
    ],
    supplierItems.map((row) => [
      row.item.externalCode,
      row.item.code,
      row.supplier.legalName,
      row.supplier.code,
      row.qualificationStatus,
      row.preferred ? "SIM" : "NAO",
      String(row._count.offers),
    ]),
  );
  // Fornecedor não tem código na planilha — o de-para é pelo nome.
  write(
    "de-para-fornecedores.csv",
    ["nome_planilha", "codigo_veridi"],
    suppliers.map((row) => [row.legalName, row.code]),
  );

  console.log(`\n  De-para (legado × interno) escrito em ${outputDir}.`);
}

async function main(): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    process.exit(1);
  }
  assertLocalDevEnvironment();

  const findings = new FindingLog();
  const shouldReset = process.argv.includes("--reset");
  if (shouldReset) await resetDatabase();

  for (const unit of UNITS) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  /* ── Fornecedores ── */
  let suppliersCreated = 0;
  for (const supplier of mapSuppliers(findings)) {
    const existing = await prisma.supplier.findFirst({ where: { legalName: supplier.legalName } });
    if (existing) continue;
    await prisma.supplier.create({
      data: { code: await nextSupplierCode(), legalName: supplier.legalName, active: true },
    });
    suppliersCreated += 1;
  }

  /* ── Clientes ── */
  const customerIdByExternal = new Map<string, string>();
  let customersCreated = 0;
  for (const customer of mapCustomers(findings)) {
    const data = {
      legalName: customer.legalName,
      tradeName: customer.tradeName,
      cnpj: customer.cnpj,
      city: customer.city,
      state: customer.state,
      // Endereço legado fica em notas: decompor não é inequívoco e inventar
      // rua/número/CEP seria pior que preservar o texto original.
      notes: customer.legacyAddress ? `Endereço (planilha): ${customer.legacyAddress}` : null,
      active: true,
    };
    const existing = await prisma.customer.findFirst({ where: { externalCode: customer.externalCode } });
    const saved = existing
      ? await prisma.customer.update({ where: { id: existing.id }, data })
      : await prisma.customer.create({
          data: {
            ...data,
            code: await nextCustomerCode(),
            externalCode: customer.externalCode,
          },
        });
    if (!existing) customersCreated += 1;
    customerIdByExternal.set(customer.externalCode, saved.id);
  }

  /* ── Itens ── */
  const items = mapItems(findings);
  const itemIdByExternal = new Map<string, string>();
  let itemsCreated = 0;
  for (const item of items) {
    const data = {
      name: item.name,
      type: item.type,
      unitCode: item.unitCode,
      sourceName: item.sourceName,
      declaredNutrient: item.declaredNutrient,
      family: item.family as never,
      defaultPurityPercent: item.defaultPurityPercent,
      controlsLot: true,
      controlsExpiry: item.type === "RAW_MATERIAL",
      requiresQualityRelease: item.type === "RAW_MATERIAL",
      active: true,
    };
    const existing = await prisma.item.findFirst({ where: { externalCode: item.externalCode } });
    const saved = existing
      ? await prisma.item.update({ where: { id: existing.id }, data })
      : await prisma.item.create({
          data: {
            ...data,
            code: await nextItemCode(item.type),
            externalCode: item.externalCode,
          },
        });
    if (!existing) itemsCreated += 1;
    itemIdByExternal.set(item.externalCode, saved.id);
  }

  /* ── Produtos + item de produto acabado ── */
  const formulationRows = readFormulationRows(findings);
  const latestGroups = selectLatestGroups(formulationRows, findings);
  const products = mapProducts(new Set(latestGroups.keys()), findings);
  const itemsByExternalCode = new Map(items.map((item) => [item.externalCode, item]));
  const cmvProducts = readCmvProducts();

  const productIdByExternal = new Map<string, { id: string; finishedItemId: string }>();
  let productsCreated = 0;
  for (const product of products) {
    const existing = await prisma.product.findFirst({
      where: { externalCode: product.externalCode },
      include: { finishedProductItem: true },
    });
    if (existing?.finishedProductItemId) {
      productIdByExternal.set(product.externalCode, {
        id: existing.id,
        finishedItemId: existing.finishedProductItemId,
      });
      continue;
    }

    // Produto acabado real precisa do próprio Item físico (1:1). O código
    // interno é PA-…; o legado fica em `Product.externalCode`.
    const finishedItem = await prisma.item.create({
      data: {
        code: await nextItemCode("FINISHED_PRODUCT"),
        type: "FINISHED_PRODUCT",
        name: product.name,
        unitCode: "un",
        controlsLot: true,
        controlsExpiry: true,
        requiresQualityRelease: true,
        active: true,
      },
    });

    const customerId = product.customerExternalCode
      ? customerIdByExternal.get(product.customerExternalCode) ?? null
      : null;

    const created = await prisma.product.create({
      data: {
        code: await nextProductCode(),
        externalCode: product.externalCode,
        name: product.name,
        finishedProductItemId: finishedItem.id,
        ...(customerId ? { customerId } : {}),
        active: true,
      },
    });
    productsCreated += 1;
    productIdByExternal.set(product.externalCode, { id: created.id, finishedItemId: finishedItem.id });
  }

  /* ── Formulações ── */
  let perDoseVersions = 0;
  let legacyVersions = 0;
  let skippedVersions = 0;

  for (const group of latestGroups.values()) {
    const product = productIdByExternal.get(group.productCode);
    if (!product) {
      skippedVersions += 1;
      continue;
    }

    const already = await prisma.formulationVersion.findFirst({ where: { productId: product.id } });
    if (already) continue;

    const reconstruction = reconstructGroup(group, itemsByExternalCode, cmvProducts, findings);
    const finishedItem = await prisma.item.findUniqueOrThrow({ where: { id: product.finishedItemId } });

    interface ComponentDraft {
      itemId: string;
      quantity: string;
      unitCode: string;
      basis: "PER_DOSE" | "PER_FINISHED_UNIT" | "FIXED_BASIS";
      purityPercentApplied: string | null;
      overagePercent: string | null;
      legacyTotalQuantity: string | null;
      legacyTotalUnitCode: string | null;
      legacyBatchUnits: string | null;
    }

    const drafts: ComponentDraft[] = [];
    const usedItems = new Set<string>();
    const perDose = reconstruction.status === "PER_DOSE_RECONSTRUCTED";

    for (const row of group.rows) {
      const mapped: MappedItem | undefined = itemsByExternalCode.get(row.itemCode);
      const itemId = itemIdByExternal.get(row.itemCode);
      if (!mapped || !itemId || usedItems.has(itemId)) continue;
      if (!row.legacyTotal || row.legacyTotal.lessThanOrEqualTo(0)) continue;

      const legacy = {
        legacyTotalQuantity: row.legacyTotal.toString(),
        legacyTotalUnitCode: mapped.type === "PACKAGING" ? "un" : "kg",
        legacyBatchUnits: row.batchUnits ? row.batchUnits.toString() : null,
      };

      if (mapped.type === "PACKAGING") {
        // Embalagem é BOM por unidade acabada — nunca cálculo por dose.
        const units = row.batchUnits && row.batchUnits.greaterThan(0) ? row.batchUnits : null;
        const perUnit = units ? row.legacyTotal.dividedBy(units) : row.legacyTotal;
        drafts.push({
          itemId,
          quantity: perUnit.toString(),
          unitCode: "un",
          basis: "PER_FINISHED_UNIT",
          purityPercentApplied: null,
          overagePercent: null,
          ...legacy,
        });
        usedItems.add(itemId);
        continue;
      }

      if (perDose && row.quantityPerDose && doseToKg(row.quantityPerDose, row.doseUnit)) {
        drafts.push({
          itemId,
          quantity: row.quantityPerDose.toString(),
          unitCode: (row.doseUnit ?? "MG").toLowerCase(),
          basis: "PER_DOSE",
          // Snapshot: pureza do item no momento da importação e overage
          // explicado pelo próprio corpus — nada inventado.
          purityPercentApplied: mapped.defaultPurityPercent,
          overagePercent: reconstruction.overagePercent
            ? reconstruction.overagePercent.toFixed(3)
            : null,
          ...legacy,
        });
        usedItems.add(itemId);
        continue;
      }

      // Sem como decompor dose/pureza/overage: importa o consumo REAL do
      // lote histórico (opção fiel), sem inventar fatores.
      drafts.push({
        itemId,
        quantity: row.legacyTotal.toString(),
        unitCode: "kg",
        basis: "FIXED_BASIS",
        purityPercentApplied: null,
        overagePercent: null,
        ...legacy,
      });
      usedItems.add(itemId);
    }

    if (drafts.length === 0) {
      skippedVersions += 1;
      continue;
    }

    const batchUnits = group.rows.find((row) => row.batchUnits)?.batchUnits ?? new Prisma.Decimal(1);
    const version = await prisma.formulationVersion.create({
      data: {
        productId: product.id,
        versionNumber: 1,
        status: "ACTIVE",
        // PER_DOSE: base é 1 unidade acabada. FIXED_BASIS legado: a base é
        // o próprio tamanho do lote histórico.
        basisQuantity: perDose ? "1" : batchUnits.toString(),
        calculationMode: perDose ? "PER_DOSE" : "FIXED_BASIS",
        ...(perDose && reconstruction.dosesPerPackage
          ? { dosesPerPackage: reconstruction.dosesPerPackage }
          : {}),
        outputItemId: finishedItem.id,
        outputItemCode: finishedItem.code,
        outputItemName: finishedItem.name,
        outputUnitCode: finishedItem.unitCode,
        notes: `Importada do histórico (lote ${group.lot}).`,
        createdBy: ACTOR,
        activatedAt: new Date(),
        activatedBy: ACTOR,
      },
    });

    await prisma.formulationComponent.createMany({
      data: drafts.map((draft, index) => ({
        formulationVersionId: version.id,
        itemId: draft.itemId,
        quantity: draft.quantity,
        unitCode: draft.unitCode,
        basis: draft.basis,
        purityPercentApplied: draft.purityPercentApplied,
        overagePercent: draft.overagePercent,
        legacyTotalQuantity: draft.legacyTotalQuantity,
        legacyTotalUnitCode: draft.legacyTotalUnitCode,
        legacyBatchUnits: draft.legacyBatchUnits,
        position: index,
      })),
    });

    if (perDose) perDoseVersions += 1;
    else legacyVersions += 1;
  }

  /* ── Projetos historicos (capacidade 38) ── */
  //
  // O export do pipeline NAO traz status nem motivo de cancelamento por
  // linha. Duas decisoes explicitas, ambas reportadas como finding:
  //  1. projeto ligado a um Product existente entra como APPROVED — o
  //     produto so existe no ERP porque o projeto foi aprovado e produzido;
  //  2. projeto sem Product entra como WAITING, porque o estagio real e
  //     desconhecido — nada e adivinhado a partir do nome ou do canal.
  const projectRows = readLegacyProjectRows(findings);
  const projectGroups = groupLegacyProjects(projectRows, findings);

  let projectsCreatedTotal = 0;
  let projectsLinkedToProduct = 0;
  let projectsWithoutProduct = 0;
  let legacyQuotesCreated = 0;

  for (const group of projectGroups.values()) {
    const first = group.rows[0]!;
    const customerId = customerIdByExternal.get(group.customerExternalCode) ?? null;
    if (!customerId) {
      findings.add(
        "PROJECT_CUSTOMER_UNRESOLVED",
        "Project",
        group.key,
        "cliente do projeto nao encontrado na base — projeto nao importado",
      );
      continue;
    }

    // Vinculo com o Product existente exige codigo legado E cliente iguais.
    const productMatch = await prisma.product.findFirst({
      where: { externalCode: group.productExternalCode },
    });
    let productId: string | null = null;
    if (productMatch) {
      if (productMatch.customerId === customerId) {
        productId = productMatch.id;
      } else {
        findings.add(
          "PROJECT_PRODUCT_CUSTOMER_MISMATCH",
          "Project",
          group.productExternalCode,
          "codigo legado bate com um Product de OUTRO cliente — vinculo nao criado",
        );
      }
    }

    const existing = await prisma.project.findFirst({
      where: { externalCode: group.productExternalCode, customerId },
    });

    let projectId: string;
    if (existing) {
      // Idempotencia: o seed nunca sobrescreve o que o sistema editou; so
      // completa o vinculo com o Product quando ele ainda falta.
      projectId = existing.id;
      if (!existing.productId && productId) {
        await prisma.project.update({ where: { id: existing.id }, data: { productId } });
      }
    } else {
      const status = productId ? "APPROVED" : "WAITING";
      const created = await prisma.project.create({
        data: {
          code: await nextProjectCode(),
          externalCode: group.productExternalCode,
          customerId,
          name: first.productName,
          channel: first.channel,
          status,
          source: "LEGACY_IMPORT",
          entryDate: first.entryDate ?? new Date(),
          notes: first.notes,
          ...(productId ? { productId } : {}),
        },
      });
      await prisma.projectStatusHistory.create({
        data: {
          projectId: created.id,
          fromStatus: null,
          toStatus: status,
          reason: "Importado da planilha (estagio historico nao exportado)",
        },
      });
      projectId = created.id;
      projectsCreatedTotal += 1;

      findings.add(
        "PROJECT_LEGACY_STATUS_NOT_EXPORTED",
        "Project",
        group.productExternalCode,
        productId
          ? "status assumido APPROVED por existir Product operacional — confirmar com o PO"
          : "status assumido WAITING — o export nao traz o estagio real",
      );
    }

    if (productId) projectsLinkedToProduct += 1;
    else projectsWithoutProduct += 1;

    // Versoes historicas de orcamento: o corpus so tem o rotulo (V1..Vn),
    // sem preco nem evidencia de envio — entram como ARCHIVED.
    for (const version of legacyQuoteVersions(group)) {
      const already = await prisma.quoteVersion.findFirst({
        where: { projectId, versionNumber: version.versionNumber },
      });
      if (already) continue;

      await prisma.quoteVersion.create({
        data: {
          code: await nextQuoteCode(),
          projectId,
          versionNumber: version.versionNumber,
          externalCode: version.externalCode,
          status: "ARCHIVED",
          source: "LEGACY_IMPORT",
          quoteDate: first.entryDate ?? new Date(),
        },
      });
      legacyQuotesCreated += 1;
    }
  }

  /* ── Amostras historicas (capacidade 39) ── */
  //
  // `amostras.csv` nao tem cod_cliente nem cod_produto: a unica ligacao
  // aceita e igualdade EXATA do nome do projeto. Amostra que nao resolve
  // vira finding e NAO e importada — nenhum Project e criado para acomodar
  // uma amostra, e nenhum consumo de material e reconstruido (o corpus nao
  // registra o que foi usado em cada teste).
  const legacySampleRows = readLegacySampleRows(findings);
  const legacyProjects = await prisma.project.findMany({
    where: { source: "LEGACY_IMPORT" },
    select: { id: true, name: true },
  });
  const projectsByName = new Map<string, string[]>();
  for (const project of legacyProjects) {
    const key = normalizeName(project.name);
    projectsByName.set(key, [...(projectsByName.get(key) ?? []), project.id]);
  }

  let samplesCreated = 0;
  let samplesSkipped = 0;

  for (const resolution of resolveSamples(legacySampleRows, projectsByName, findings)) {
    if (!resolution.projectId || resolution.row.testSequence === null) {
      samplesSkipped += 1;
      continue;
    }

    const existing = await prisma.projectSample.findFirst({
      where: { externalCode: resolution.row.externalCode },
    });
    if (existing) continue;

    // Tn ja usado no projeto: dois testes historicos diferentes disputando o
    // mesmo numero. Nada e renumerado — o conflito e reportado.
    const clash = await prisma.projectSample.findFirst({
      where: { projectId: resolution.projectId, testSequence: resolution.row.testSequence },
    });
    if (clash) {
      findings.add(
        "SAMPLE_TEST_NUMBER_CLASH",
        "ProjectSample",
        resolution.row.externalCode,
        `T${resolution.row.testSequence} ja existe no projeto — amostra nao importada`,
      );
      samplesSkipped += 1;
      continue;
    }

    // PRODUCED: a planilha e um registro de amostras que existiram
    // fisicamente. O desfecho (aprovada/reprovada) NAO esta no export e
    // nunca e inventado; data e quantidade produzida ficam vazias.
    await prisma.projectSample.create({
      data: {
        code: await nextSampleCode(),
        externalCode: resolution.row.externalCode,
        projectId: resolution.projectId,
        testSequence: resolution.row.testSequence,
        status: "PRODUCED",
        source: "LEGACY_IMPORT",
        description: resolution.row.description,
      },
    });
    samplesCreated += 1;

    findings.add(
      "SAMPLE_LEGACY_OUTCOME_UNKNOWN",
      "ProjectSample",
      resolution.row.externalCode,
      "export nao traz desfecho, data nem quantidade — importada como PRODUZIDA sem decisao",
    );
  }

  /* ── Item x Fornecedor (capacidade 40) ── */
  //
  // `precos_fornecedores.csv` nao tem data de cotacao nem coluna de moeda:
  // toda oferta entra em BRL, por quilo (header `preco_brl_kg`) e SEM
  // vigencia — observacao historica de preco, nunca preco atual. O
  // indicador "melhor_preco" da planilha e apenas um snapshot de CMV e
  // NUNCA vira fornecedor preferencial: nenhuma relacao importada nasce
  // preferred.
  const priceRows = readLegacySupplierPriceRows(findings);

  const [dbItems, dbSuppliers] = await Promise.all([
    prisma.item.findMany({ where: { externalCode: { not: null } } }),
    prisma.supplier.findMany(),
  ]);
  const itemByExternalCode = new Map(dbItems.map((item) => [item.externalCode!, item]));
  const supplierByName = new Map(
    dbSuppliers.map((supplier) => [normalizeSupplierName(supplier.legalName), supplier]),
  );

  // Homologacao e por PAR item+fornecedor: basta uma linha marcada como
  // homologada para a relacao entrar homologada.
  const qualifiedPairs = new Set<string>();
  for (const row of priceRows) {
    if (row.qualified) {
      qualifiedPairs.add(`${row.itemExternalCode}::${normalizeSupplierName(row.supplierName)}`);
    }
  }

  let supplierItemsCreated = 0;
  let supplierItemsSkipped = 0;
  let offersCreated = 0;
  let offersSkipped = 0;
  const supplierItemIdByPair = new Map<string, string>();

  for (const row of priceRows) {
    const item = itemByExternalCode.get(row.itemExternalCode);
    if (!item) {
      findings.add(
        "SUPPLIER_ITEM_ITEM_UNRESOLVED",
        "SupplierItem",
        row.itemExternalCode,
        "cod_item sem Item correspondente — relacao nao importada",
      );
      supplierItemsSkipped += 1;
      continue;
    }

    const supplierKey = normalizeSupplierName(row.supplierName);
    const supplier = supplierByName.get(supplierKey);
    if (!supplier) {
      // Nunca criar Supplier so para acomodar um preco legado.
      findings.add(
        "SUPPLIER_ITEM_SUPPLIER_UNRESOLVED",
        "SupplierItem",
        row.supplierName,
        "fornecedor sem correspondencia exata de nome — relacao nao importada",
      );
      supplierItemsSkipped += 1;
      continue;
    }

    const pairKey = `${row.itemExternalCode}::${supplierKey}`;
    let supplierItemId = supplierItemIdByPair.get(pairKey);

    if (!supplierItemId) {
      const existing = await prisma.supplierItem.findUnique({
        where: { supplierId_itemId: { supplierId: supplier.id, itemId: item.id } },
      });
      if (existing) {
        supplierItemId = existing.id;
      } else {
        const qualified = qualifiedPairs.has(pairKey);
        const created = await prisma.supplierItem.create({
          data: {
            itemId: item.id,
            supplierId: supplier.id,
            // Homologado quando a planilha diz explicitamente; ausencia e
            // desconhecimento (PENDING), nunca bloqueio.
            qualificationStatus: qualified ? "APPROVED" : "PENDING",
            preferred: false,
            createdByNameSnapshot: ACTOR,
            updatedByNameSnapshot: ACTOR,
          },
        });
        await prisma.supplierItemQualificationHistory.create({
          data: {
            supplierItemId: created.id,
            fromStatus: null,
            toStatus: "PENDING",
            note: "Relacao importada da planilha",
            changedByNameSnapshot: ACTOR,
          },
        });
        if (qualified) {
          await prisma.supplierItemQualificationHistory.create({
            data: {
              supplierItemId: created.id,
              fromStatus: "PENDING",
              toStatus: "APPROVED",
              note: "Homologacao marcada na planilha (sem data nem responsavel no export)",
              changedByNameSnapshot: ACTOR,
            },
          });
        }
        supplierItemId = created.id;
        supplierItemsCreated += 1;
      }
      supplierItemIdByPair.set(pairKey, supplierItemId);
    }

    // Preco ilegivel nao vira oferta — mas a relacao ja foi preservada.
    if (row.price === null) {
      offersSkipped += 1;
      continue;
    }
    // O corpus so tem preco por quilo: item que nao e de massa nao aceita
    // esse preco sem adivinhar a unidade real.
    const priceUomCode = "kg";
    if (item.unitCode !== "kg" && item.unitCode !== "g" && item.unitCode !== "mg") {
      offersSkipped += 1;
      continue;
    }

    const sourceKey = legacyOfferSourceKey(row);
    const alreadyImported = await prisma.supplierItemOffer.findUnique({ where: { sourceKey } });
    if (alreadyImported) continue;

    const parsedMoq = parseMinimumOrder(row.rawMinimumOrder);
    // MOQ so entra estruturado quando a unidade e compativel com a do item;
    // numero puro assume a unidade do item (registrado no validator).
    const moqUom = parsedMoq ? (parsedMoq.uomCode ?? item.unitCode) : null;
    const moqCompatible =
      moqUom !== null && MASS_UOM_CODES.has(moqUom) === MASS_UOM_CODES.has(item.unitCode);
    if (parsedMoq && !moqCompatible) {
      findings.add(
        "SUPPLIER_MOQ_UOM_INCOMPATIBLE",
        "SupplierItemOffer",
        `${row.itemExternalCode}/${row.supplierName}`,
        `pedido minimo "${row.rawMinimumOrder}" incompativel com a unidade do item (${item.unitCode}) — oferta sem MOQ`,
      );
    }

    await prisma.supplierItemOffer.create({
      data: {
        supplierItemId,
        unitPrice: row.price,
        currencyCode: "BRL",
        priceUomCode,
        ...(parsedMoq && moqCompatible
          ? { minimumOrderQuantity: parsedMoq.quantity, minimumOrderUomCode: moqUom! }
          : {}),
        // Sem data confiavel no export: observacao historica, nunca vigente.
        effectiveAt: null,
        validUntil: null,
        source: "LEGACY_IMPORT",
        sourceKey,
        notes: row.sourceName,
        createdByNameSnapshot: ACTOR,
      },
    });
    offersCreated += 1;
  }

  /* ── Resumo ── */
  const [suppliers, customers, itemCount, productCount, versions] = await Promise.all([
    prisma.supplier.count(),
    prisma.customer.count(),
    prisma.item.count(),
    prisma.product.count(),
    prisma.formulationVersion.count({ where: { status: "ACTIVE" } }),
  ]);

  console.log("\nBASE DEV POPULADA");
  console.log(`  Fornecedores: ${suppliers} (novos ${suppliersCreated})`);
  console.log(`  Clientes: ${customers} (novos ${customersCreated})`);
  console.log(`  Itens: ${itemCount} (novos ${itemsCreated})`);
  console.log(`  Produtos: ${productCount} (novos ${productsCreated})`);
  const [projectCount, quoteCount] = await Promise.all([
    prisma.project.count(),
    prisma.quoteVersion.count(),
  ]);
  console.log(`  Projetos: ${projectCount} (novos ${projectsCreatedTotal})`);
  console.log(`    ligados a Product existente: ${projectsLinkedToProduct}`);
  console.log(`    sem Product correspondente: ${projectsWithoutProduct}`);
  console.log(`  Versoes de orcamento (historico): ${quoteCount} (novas ${legacyQuotesCreated})`);
  console.log(
    `  Amostras historicas: ${samplesCreated} importadas, ${samplesSkipped} nao resolvidas`,
  );
  const [supplierItemCount, offerCount] = await Promise.all([
    prisma.supplierItem.count(),
    prisma.supplierItemOffer.count(),
  ]);
  console.log(`  Relacoes item x fornecedor: ${supplierItemCount} (novas ${supplierItemsCreated})`);
  console.log(`    linhas de preco nao importadas: ${supplierItemsSkipped}`);
  console.log(`  Ofertas de fornecedor: ${offerCount} (novas ${offersCreated})`);
  console.log(`    linhas sem oferta (preco/unidade nao utilizaveis): ${offersSkipped}`);
  console.log("    todas legadas entram SEM vigencia — referencia historica, nunca preco atual.");
  console.log(`  Formulações ACTIVE: ${versions}`);
  console.log(`    PER_DOSE reconstruídas: ${perDoseVersions}`);
  console.log(`    FIXED_BASIS pelo consumo histórico: ${legacyVersions}`);
  console.log(`    sem componentes utilizáveis: ${skippedVersions}`);
  console.log("\n  Estoque, compras, preços, amostras, projetos, CMV e IN28 NÃO foram importados.");

  await writeCrossReference();

  findings.print(3);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
