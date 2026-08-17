import { PrismaClient } from "@prisma/client";
import { CORPUS_DIR, corpusAvailable } from "./corpus.js";
import { assertLocalDevEnvironment } from "./environment.js";
import { readOverrides } from "../veridi-import/overrides.js";
import { runPipeline } from "../veridi-import/pipeline.js";

/**
 * `pnpm veridi:data:seed` — ALIAS DE TRANSIÇÃO.
 *
 * O fluxo oficial da migração é o da capacidade 41:
 *
 *   pnpm veridi:import:validate
 *   pnpm veridi:import:plan
 *   pnpm veridi:import:apply -- --apply
 *   pnpm veridi:import:verify
 *
 * Este comando continua existindo para não quebrar hábito/documentação
 * antiga, mas executa exatamente o mesmo pipeline — não existe uma segunda
 * implementação de importação. Só roda em banco local, é aditivo e
 * idempotente: não reseta nada.
 */
async function main(): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    process.exit(1);
  }
  const environment = assertLocalDevEnvironment();

  console.log(
    "AVISO: `veridi:data:seed` é alias do importador oficial (capacidade 41).\n" +
      "       Fluxo recomendado: veridi:import:validate → plan → apply -- --apply → verify.\n",
  );

  const prisma = new PrismaClient();
  try {
    const result = await runPipeline({ prisma, write: true, overrides: readOverrides() });

    console.log(`BASE DEV POPULADA — ${environment.database}@${environment.host}`);
    for (const [domain, counts] of Object.entries(result.domains)) {
      console.log(
        `  ${domain}: criados ${counts.created} · completados ${counts.updated} · existentes ${counts.existing} · fora ${counts.skipped}`,
      );
    }
    console.log(
      `  Golden da formulação: ${result.golden.comparable}/${result.golden.matched}/${result.golden.divergent}`,
    );
    console.log("  Estoque não foi movimentado — abertura é processo separado.");
    result.findings.print(2);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
