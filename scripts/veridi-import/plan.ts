import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, corpusAvailable } from "../veridi-data/corpus.js";
import { assertImportEnvironment } from "./environment.js";
import { readOverrides, writeOverrideTemplate, ITEM_MAP_FILE, PRICE_UOM_FILE, SAMPLE_FILE } from "./overrides.js";
import { runPipeline } from "./pipeline.js";
import { writeFindingsArtifacts, writeImportReport, writeOpeningInventoryTemplate } from "./report.js";
import {
  OUT_DIR,
  PLAN_FILE,
  buildSourceManifest,
  ensureOutputDirs,
} from "./sources.js";

/**
 * `pnpm veridi:import:plan` — simula a migração inteira SEM escrever nada.
 *
 * O plano é o contrato do APPLY: mesmo código, mesmas decisões, mesmos
 * findings — só que com as escritas desligadas. Junto sai o manifesto com
 * SHA-256 de cada arquivo fonte, que o APPLY confere antes de tocar no
 * banco.
 */
export async function buildPlan(options: { quiet?: boolean } = {}): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    console.error("Os CSVs reais ficam fora do repositório (.local-data/, no .gitignore).");
    process.exit(1);
  }

  const environment = assertImportEnvironment({ write: false });
  ensureOutputDirs();

  const prisma = new PrismaClient();
  try {
    const sources = buildSourceManifest();
    const missing = sources.filter((file) => !file.present);
    if (missing.length > 0) {
      console.error(`ABORTADO: arquivos ausentes — ${missing.map((f) => f.name).join(", ")}`);
      process.exit(1);
    }

    const overrides = readOverrides();
    const result = await runPipeline({ prisma, write: false, overrides });

    // Templates de decisão humana: gerados só quando ainda não existem,
    // para nunca sobrescrever uma decisão já tomada.
    const itemTemplate = writeOverrideTemplate(
      ITEM_MAP_FILE,
      ["legacy_item_code", "legacy_description", "action", "target_item_code", "note"],
      result.templates.unresolvedItemCodes.map((row) => [
        row.legacyItemCode,
        row.description,
        "",
        "",
        "",
      ]),
    );
    const uomTemplate = writeOverrideTemplate(
      PRICE_UOM_FILE,
      [
        "sourceKey",
        "legacyItemCode",
        "itemCode",
        "currentItemUom",
        "sourcePriceUom",
        "action",
        "overridePriceUom",
        "note",
      ],
      result.templates.incompatiblePriceUom.map((row) => [
        row.sourceKey,
        row.legacyItemCode,
        row.itemCode,
        row.itemUom,
        row.sourcePriceUom,
        "",
        "",
        "",
      ]),
    );
    const sampleTemplate = writeOverrideTemplate(
      SAMPLE_FILE,
      ["legacySample", "description", "testNumber", "action", "targetProjectCode", "note"],
      result.templates.unresolvedSamples.map((row) => [
        row.legacySample,
        row.description,
        row.testNumber,
        "",
        "",
        "",
      ]),
    );

    writeFindingsArtifacts(result.findings);
    const openingTemplate = writeOpeningInventoryTemplate(result);

    const plan = {
      generatedAt: new Date().toISOString(),
      database: `${environment.database}@${environment.host}`,
      corpusDir: CORPUS_DIR,
      sources,
      overrides: {
        items: overrides.items.size,
        priceUoms: overrides.priceUoms.size,
        samples: overrides.samples.size,
      },
      actions: result.domains,
      formulationDetail: result.formulationDetail,
      golden: result.golden,
      stock: result.stock,
      findings: {
        bySeverity: result.findings.countBySeverity(),
        byCode: result.findings.summary(),
      },
      pendingHumanDecisions: {
        unresolvedItemCodes: result.templates.unresolvedItemCodes.length,
        incompatiblePriceUom: result.templates.incompatiblePriceUom.length,
        unresolvedSamples: result.templates.unresolvedSamples.length,
        openingInventoryItems: result.templates.openingInventory.length,
      },
    };
    fs.writeFileSync(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    writeImportReport(result, {
      databaseLabel: plan.database,
      sourceSummary: sources.map(
        (file) =>
          `${file.name}: ${file.rowCount} linhas · sha256 ${file.sha256?.slice(0, 12)}… · ${file.imported ? "importado" : "somente conferência"}`,
      ),
    });

    if (!options.quiet) {
      console.log(`PLANO DA MIGRAÇÃO (dry-run) — banco ${plan.database}\n`);
      for (const [domain, counts] of Object.entries(result.domains)) {
        console.log(
          `  ${domain}: criar ${counts.created} · completar ${counts.updated} · existentes ${counts.existing} · fora ${counts.skipped}`,
        );
      }
      console.log(
        `\n  Golden da formulação: ${result.golden.comparable}/${result.golden.matched}/${result.golden.divergent} (comparáveis/dentro da tolerância/divergentes)`,
      );
      console.log(
        `  Estoque legado: ${result.stock.positive} positivos · ${result.stock.negative} negativos · ${result.stock.unreadable} ilegíveis (nada movimenta aqui)`,
      );
      console.log("\n  Decisões humanas pendentes:");
      console.log(`    itens não resolvidos em preços: ${plan.pendingHumanDecisions.unresolvedItemCodes} (${itemTemplate.written ? "template gerado" : "override já existe"})`);
      console.log(`    preços com unidade incompatível: ${plan.pendingHumanDecisions.incompatiblePriceUom} (${uomTemplate.written ? "template gerado" : "override já existe"})`);
      console.log(`    amostras não resolvidas: ${plan.pendingHumanDecisions.unresolvedSamples} (${sampleTemplate.written ? "template gerado" : "override já existe"})`);
      console.log(`    itens com saldo para reconciliar: ${plan.pendingHumanDecisions.openingInventoryItems}`);

      result.findings.print(2);
      console.log(`\n  Plano: ${PLAN_FILE}`);
      console.log(`  Relatórios: ${OUT_DIR}`);
      console.log(`  Template de abertura: ${openingTemplate}`);
      console.log("\n  Nada foi escrito no banco. Para aplicar: pnpm veridi:import:apply -- --apply");
    }
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]).endsWith(path.join("veridi-import", "plan.ts"))
  : false;

if (invokedDirectly) {
  buildPlan().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
