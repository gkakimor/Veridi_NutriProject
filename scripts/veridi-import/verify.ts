import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { assertImportEnvironment } from "./environment.js";
import { OUT_DIR, PLAN_FILE, ensureOutputDirs } from "./sources.js";

/**
 * `pnpm veridi:import:verify` — confere o BANCO depois do APPLY.
 *
 * Não confia nas contagens do próprio importador: consulta o estado final
 * e valida invariantes de integridade. Falha (exit 1) só quando algo
 * estrutural quebrou — divergência de dado legado já é assunto dos
 * findings.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const environment = assertImportEnvironment({ write: false });
  ensureOutputDirs();

  const prisma = new PrismaClient();
  const checks: Check[] = [];

  try {
    const [
      suppliers,
      customers,
      items,
      products,
      formulations,
      projects,
      quotes,
      samples,
      supplierItems,
      offers,
    ] = await Promise.all([
      prisma.supplier.count(),
      prisma.customer.count(),
      prisma.item.count(),
      prisma.product.count(),
      prisma.formulationVersion.count({ where: { status: "ACTIVE" } }),
      prisma.project.count(),
      prisma.quoteVersion.count(),
      prisma.projectSample.count(),
      prisma.supplierItem.count(),
      prisma.supplierItemOffer.count(),
    ]);

    console.log(`VERIFICAÇÃO — banco ${environment.database}@${environment.host}\n`);
    console.log("MASTER DATA");
    console.log(`  Fornecedores ${suppliers} · Clientes ${customers} · Itens ${items}`);
    console.log(`  Produtos ${products} · Formulações ACTIVE ${formulations}`);
    console.log(`  Projetos ${projects} · Orçamentos ${quotes} · Amostras ${samples}`);
    console.log(`  Item × Fornecedor ${supplierItems} · Ofertas ${offers}`);

    if (fs.existsSync(PLAN_FILE)) {
      const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")) as {
        actions: Record<string, { created: number; existing: number; updated: number }>;
      };
      const planned = Object.entries(plan.actions)
        .map(([domain, counts]) => `${domain}: +${counts.created}`)
        .join(" · ");
      console.log(`\n  Plano previa → ${planned}`);
    }

    /* ── Integridade referencial ─────────────────────────── */
    const productsWithoutFinishedItem = await prisma.product.count({
      where: { finishedProductItemId: null },
    });
    checks.push({
      name: "Todo Product tem item de produto acabado",
      ok: productsWithoutFinishedItem === 0,
      detail: `${productsWithoutFinishedItem} produto(s) sem item`,
    });

    const activeVersionsByProduct = await prisma.formulationVersion.groupBy({
      by: ["productId"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    });
    const multipleActive = activeVersionsByProduct.filter((row) => row._count._all > 1).length;
    checks.push({
      name: "No máximo uma formulação ACTIVE por produto",
      ok: multipleActive === 0,
      detail: `${multipleActive} produto(s) com mais de uma versão ativa`,
    });

    // FK garante que todo componente aponta para um Item existente; o que
    // pode faltar é a receita ter ficado vazia na importação.
    const activeWithoutComponents = await prisma.formulationVersion.count({
      where: { status: "ACTIVE", components: { none: {} } },
    });
    checks.push({
      name: "Nenhuma formulação ACTIVE ficou sem componentes",
      ok: activeWithoutComponents === 0,
      detail: `${activeWithoutComponents} versão(ões) vazia(s)`,
    });

    // Projeto ligado a Product tem de manter o MESMO cliente.
    const linkedProjects = await prisma.project.findMany({
      where: { productId: { not: null } },
      select: { code: true, customerId: true, product: { select: { customerId: true } } },
    });
    const customerMismatch = linkedProjects.filter(
      (project) => project.product && project.product.customerId !== project.customerId,
    );
    checks.push({
      name: "Projeto e Product ligados compartilham o cliente",
      ok: customerMismatch.length === 0,
      detail: `${customerMismatch.length} projeto(s) divergente(s)`,
    });

    const preferredByItem = await prisma.supplierItem.groupBy({
      by: ["itemId"],
      where: { preferred: true },
      _count: { _all: true },
    });
    const duplicatedPreferred = preferredByItem.filter((row) => row._count._all > 1).length;
    checks.push({
      name: "No máximo um fornecedor preferencial por item",
      ok: duplicatedPreferred === 0,
      detail: `${duplicatedPreferred} item(ns) com mais de um preferencial`,
    });

    const preferredNotApproved = await prisma.supplierItem.count({
      where: { preferred: true, OR: [{ active: false }, { qualificationStatus: { not: "APPROVED" } }] },
    });
    checks.push({
      name: "Preferencial exige relação ativa e homologada",
      ok: preferredNotApproved === 0,
      detail: `${preferredNotApproved} relação(ões) inválida(s)`,
    });

    // Oferta legada não tem data confiável: nenhuma pode estar vigente.
    const legacyCurrentOffers = await prisma.supplierItemOffer.count({
      where: { source: "LEGACY_IMPORT", effectiveAt: { not: null } },
    });
    checks.push({
      name: "Nenhuma oferta legada virou preço vigente",
      ok: legacyCurrentOffers === 0,
      detail: `${legacyCurrentOffers} oferta(s) legada(s) com vigência`,
    });

    // Amostra legada sem código de origem não teria como ser reconciliada
    // com a planilha nem reimportada sem duplicar.
    const legacySamplesWithoutExternalCode = await prisma.projectSample.count({
      where: { source: "LEGACY_IMPORT", externalCode: null },
    });
    checks.push({
      name: "Toda amostra legada preserva o código de origem",
      ok: legacySamplesWithoutExternalCode === 0,
      detail: `${legacySamplesWithoutExternalCode} amostra(s) sem externalCode`,
    });

    const legacyRecordsWithoutExternalCode = await Promise.all([
      prisma.item.count({ where: { externalCode: null, type: { not: "FINISHED_PRODUCT" } } }),
      prisma.project.count({ where: { source: "LEGACY_IMPORT", externalCode: null } }),
    ]);
    checks.push({
      name: "Itens e projetos legados preservam o código da planilha",
      ok: legacyRecordsWithoutExternalCode.every((count) => count === 0),
      detail: `${legacyRecordsWithoutExternalCode[0]} item(ns) e ${legacyRecordsWithoutExternalCode[1]} projeto(s) sem externalCode`,
    });

    /* ── Estoque: importar master data não movimenta ─────── */
    const movementsFromImport = await prisma.inventoryMovement.count({
      where: { createdBy: "Importação Veridi" },
    });
    checks.push({
      name: "Importação de master data não criou movimento de estoque",
      ok: movementsFromImport === 0,
      detail: `${movementsFromImport} movimento(s) criado(s) pela importação`,
    });

    const openingMovements = await prisma.inventoryMovement.count({
      where: { type: "OPENING_BALANCE" },
    });
    const openingLots = await prisma.lot.count({ where: { origin: "OPENING_BALANCE" } });
    console.log(
      `\n  Abertura de estoque: ${openingLots} lote(s) e ${openingMovements} movimento(s) OPENING_BALANCE`,
    );

    /* ── Custo: oferta não é custo real ──────────────────── */
    const receiptLinesWithCost = await prisma.receiptLine.count({
      where: { actualUnitCost: { not: null } },
    });
    console.log(
      `  Custo real de aquisição continua vindo de ${receiptLinesWithCost} linha(s) de recebimento — ofertas não entram nessa conta.`,
    );

    console.log("\nINTEGRIDADE");
    for (const check of checks) {
      console.log(`  ${check.ok ? "OK  " : "FALHA"} ${check.name} (${check.detail})`);
    }

    const summaryFile = path.join(OUT_DIR, "verify-summary.json");
    fs.writeFileSync(
      summaryFile,
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          database: `${environment.database}@${environment.host}`,
          counts: {
            suppliers,
            customers,
            items,
            products,
            activeFormulations: formulations,
            projects,
            quotes,
            samples,
            supplierItems,
            offers,
            openingLots,
            openingMovements,
          },
          checks,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\n  Resumo: ${summaryFile}`);

    const failed = checks.filter((check) => !check.ok);
    if (failed.length > 0) {
      console.error(`\nABORTADO: ${failed.length} verificação(ões) falhou(ram).`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
