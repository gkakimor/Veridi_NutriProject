import { PrismaClient } from "@prisma/client";
import { CORPUS_DIR, corpusAvailable, readCorpusCsv, cleanText } from "../veridi-data/corpus.js";
import { assertImportEnvironment } from "./environment.js";
import { readOverrides } from "./overrides.js";
import { runPipeline } from "./pipeline.js";
import { writeFindingsArtifacts } from "./report.js";
import { buildSourceManifest, ensureOutputDirs, OUT_DIR } from "./sources.js";

/**
 * `pnpm veridi:import:validate` — leitura pura da fonte.
 *
 * Falha (exit 1) apenas por problema ESTRUTURAL: arquivo ausente, parser
 * quebrado, motor de formulação divergindo do golden. Problema de
 * QUALIDADE do dado legado vira finding — o objetivo é enxergá-los, não
 * escondê-los.
 */

/** Invariantes do corpus. Mudança aqui exige explicação, nunca ajuste silencioso. */
const GOLDEN_COMPARABLE = 26;

async function main(): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    console.error("Os CSVs reais ficam fora do repositório (.local-data/, no .gitignore).");
    process.exit(1);
  }

  const environment = assertImportEnvironment({ write: false });
  ensureOutputDirs();

  const sources = buildSourceManifest();
  console.log(`FONTE — ${CORPUS_DIR}\n`);
  let structuralError = false;
  for (const file of sources) {
    if (!file.present) {
      console.error(`  ${file.name}: AUSENTE`);
      structuralError = true;
      continue;
    }
    console.log(
      `  ${file.name}: ${file.rowCount} linhas · sha256 ${file.sha256!.slice(0, 12)}… · ${file.imported ? "importado" : "somente conferência"}`,
    );
  }
  if (structuralError) {
    console.error("\nABORTADO: arquivos da fonte ausentes.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await runPipeline({ prisma, write: false, overrides: readOverrides() });
    writeFindingsArtifacts(result.findings);

    console.log("\nFORMULAÇÕES (motor × histórico)");
    console.log(
      `  comparáveis ${result.golden.comparable} · dentro da tolerância ${result.golden.matched} · divergentes ${result.golden.divergent}`,
    );

    // Qualidade documental do histórico — estatística, nunca classificação
    // automática de `Item.requiresCoa`.
    const receipts = readCorpusCsv("compras_recebimentos.csv");
    let laudoYes = 0;
    let laudoNo = 0;
    let laudoEmpty = 0;
    for (const row of receipts.rows) {
      const laudo = cleanText(row["laudo_recebido"]);
      const normalized = laudo?.toUpperCase() ?? "";
      if (!laudo) laudoEmpty += 1;
      else if (["SIM", "S", "OK", "TRUE"].includes(normalized)) laudoYes += 1;
      else if (["NAO", "NÃO", "N", "FALSE"].includes(normalized)) laudoNo += 1;
    }
    console.log("\nQUALIDADE DOCUMENTAL NO HISTÓRICO (somente leitura)");
    console.log(
      `  linhas ${receipts.rows.length} · laudo SIM ${laudoYes} · laudo NÃO ${laudoNo} · vazio ${laudoEmpty}`,
    );
    console.log("  nenhum Item é classificado automaticamente a partir deste histórico.");

    console.log("\nESTOQUE LEGADO (nada é movimentado)");
    console.log(
      `  positivos ${result.stock.positive} · zerados ${result.stock.zero} · NEGATIVOS ${result.stock.negative} · ilegíveis ${result.stock.unreadable}`,
    );

    result.findings.print(2);
    console.log(`\n  Findings detalhados em ${OUT_DIR}`);
    console.log(`  Banco de destino: ${environment.database}@${environment.host} (nada foi escrito)`);

    // O motor de formulação é o único ponto onde divergência é defeito de
    // código, não dado ruim: se o golden quebra, a importação para.
    if (result.golden.comparable !== GOLDEN_COMPARABLE) {
      console.error(
        `\nABORTADO: o golden mudou de ${GOLDEN_COMPARABLE} para ${result.golden.comparable} linhas comparáveis. Explique a mudança antes de importar.`,
      );
      process.exit(1);
    }
    if (result.golden.divergent > 0) {
      console.error(
        `\nABORTADO: ${result.golden.divergent} divergências entre o motor e o histórico. Não se importa com motor quebrado.`,
      );
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
