import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, corpusAvailable } from "../veridi-data/corpus.js";
import { assertImportEnvironment, hasApplyFlag } from "./environment.js";
import { readOverrides } from "./overrides.js";
import { runPipeline } from "./pipeline.js";
import { writeFindingsArtifacts, writeImportReport, writeOpeningInventoryTemplate } from "./report.js";
import {
  OUT_DIR,
  PLAN_FILE,
  buildSourceManifest,
  diffManifests,
  ensureOutputDirs,
  writeCsv,
} from "./sources.js";
import type { SourceFileManifest } from "./sources.js";

/**
 * `pnpm veridi:import:apply -- --apply` — a única etapa que escreve.
 *
 * Três guardas antes de qualquer INSERT:
 * 1. `--apply` explícito (dry-run é o padrão em todo o fluxo);
 * 2. plano existente e fonte com o MESMO hash — aplicar um plano sobre uma
 *    planilha diferente é a forma clássica de importar coisa errada com
 *    confiança total;
 * 3. alvo de produção exige opt-in por variável de ambiente e confirmação
 *    do nome do banco.
 *
 * Nada aqui apaga: sem TRUNCATE, sem reset, sem deleteMany.
 */

export async function applyImport(): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    process.exit(1);
  }

  if (!hasApplyFlag()) {
    console.error(
      "ABORTADO: dry-run é o padrão. Rode com `--apply` quando quiser escrever no banco:\n" +
        "  pnpm veridi:import:apply -- --apply",
    );
    process.exit(1);
  }

  if (!fs.existsSync(PLAN_FILE)) {
    console.error(`ABORTADO: plano ausente (${PLAN_FILE}). Rode pnpm veridi:import:plan antes.`);
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")) as {
    generatedAt: string;
    sources: SourceFileManifest[];
  };
  const differences = diffManifests(plan.sources, buildSourceManifest());
  if (differences.length > 0) {
    console.error("ABORTADO: a fonte mudou depois do PLAN.");
    for (const difference of differences) console.error(`  - ${difference}`);
    console.error("\nRode de novo: pnpm veridi:import:validate && pnpm veridi:import:plan");
    process.exit(1);
  }

  const environment = assertImportEnvironment({ write: true });
  ensureOutputDirs();

  const prisma = new PrismaClient();
  try {
    console.log(
      `APLICANDO A MIGRAÇÃO — banco ${environment.database}@${environment.host}` +
        `${environment.isProductionTarget ? " (ALVO DE PRODUÇÃO, autorizado explicitamente)" : ""}`,
    );
    console.log(`Plano de ${plan.generatedAt}, fonte conferida por SHA-256.\n`);

    const result = await runPipeline({ prisma, write: true, overrides: readOverrides() });

    writeFindingsArtifacts(result.findings);
    writeOpeningInventoryTemplate(result);
    await writeCrossReferenceMaps(prisma);

    const summaryFile = path.join(OUT_DIR, "import-summary.json");
    fs.writeFileSync(
      summaryFile,
      `${JSON.stringify(
        {
          appliedAt: new Date().toISOString(),
          planGeneratedAt: plan.generatedAt,
          database: `${environment.database}@${environment.host}`,
          actions: result.domains,
          formulationDetail: result.formulationDetail,
          golden: result.golden,
          stock: result.stock,
          findings: result.findings.countBySeverity(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    writeImportReport(result, {
      databaseLabel: `${environment.database}@${environment.host}`,
      sourceSummary: plan.sources.map(
        (file) => `${file.name}: ${file.rowCount} linhas · sha256 ${file.sha256?.slice(0, 12)}…`,
      ),
    });

    for (const [domain, counts] of Object.entries(result.domains)) {
      console.log(
        `  ${domain}: criados ${counts.created} · completados ${counts.updated} · existentes ${counts.existing} · fora ${counts.skipped}`,
      );
    }
    console.log(
      `\n  Golden da formulação: ${result.golden.comparable}/${result.golden.matched}/${result.golden.divergent}`,
    );
    console.log("  Estoque: nenhum movimento criado — abertura é processo separado.");
    result.findings.print(2);
    console.log(`\n  Relatórios e de-para: ${OUT_DIR}`);
    console.log("  Próximo passo: pnpm veridi:import:verify");
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * De-para código legado × código interno.
 *
 * O código interno é o único identificador operacional do ERP; o código da
 * planilha serve para conferência humana e para reimportar sem duplicar.
 * Sai só em `.local-data` — nenhuma tela do sistema expõe código legado.
 */
async function writeCrossReferenceMaps(prisma: PrismaClient): Promise<void> {
  const [customers, items, products, suppliers, projects, samples, supplierItems] =
    await Promise.all([
      prisma.customer.findMany({ orderBy: { code: "asc" } }),
      prisma.item.findMany({ orderBy: { code: "asc" } }),
      prisma.product.findMany({ orderBy: { code: "asc" } }),
      prisma.supplier.findMany({ orderBy: { code: "asc" } }),
      prisma.project.findMany({ orderBy: { code: "asc" }, include: { customer: true } }),
      prisma.projectSample.findMany({
        where: { source: "LEGACY_IMPORT" },
        orderBy: { code: "asc" },
        include: { project: { select: { code: true } } },
      }),
      prisma.supplierItem.findMany({
        orderBy: [{ item: { code: "asc" } }, { supplier: { code: "asc" } }],
        include: { item: true, supplier: true, _count: { select: { offers: true } } },
      }),
    ]);

  writeCsv(
    path.join(OUT_DIR, "customer-map.csv"),
    ["cod_cliente_planilha", "codigo_veridi", "razao_social", "cnpj"],
    customers.map((row) => [row.externalCode, row.code, row.legalName, row.cnpj]),
  );
  writeCsv(
    path.join(OUT_DIR, "item-map.csv"),
    ["cod_item_planilha", "codigo_veridi", "nome", "tipo", "unidade"],
    items.map((row) => [row.externalCode, row.code, row.name, row.type, row.unitCode]),
  );
  writeCsv(
    path.join(OUT_DIR, "product-map.csv"),
    ["cod_produto_planilha", "codigo_veridi", "nome"],
    products.map((row) => [row.externalCode, row.code, row.name]),
  );
  // Fornecedor não tem código na planilha — o de-para é pelo nome.
  writeCsv(
    path.join(OUT_DIR, "supplier-map.csv"),
    ["nome_planilha", "codigo_veridi"],
    suppliers.map((row) => [row.legalName, row.code]),
  );
  writeCsv(
    path.join(OUT_DIR, "project-map.csv"),
    ["cod_produto_planilha", "codigo_veridi", "cliente", "status"],
    projects.map((row) => [row.externalCode, row.code, row.customer.legalName, row.status]),
  );
  writeCsv(
    path.join(OUT_DIR, "sample-map.csv"),
    ["lote_interno_planilha", "codigo_veridi", "projeto", "teste"],
    samples.map((row) => [
      row.externalCode,
      row.code,
      row.project.code,
      `T${row.testSequence}`,
    ]),
  );
  writeCsv(
    path.join(OUT_DIR, "supplier-item-map.csv"),
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
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]).endsWith(path.join("veridi-import", "apply.ts"))
  : false;

if (invokedDirectly) {
  applyImport().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
