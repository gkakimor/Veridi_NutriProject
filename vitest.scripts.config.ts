import { createRequire } from "node:module";
import { defineConfig, loadEnv } from "vite";
import { ambienteComBancoDeTeste } from "./apps/api/src/test-support/banco-de-teste.js";

// O client Prisma vive no workspace da API (é lá que ele é gerado). Os
// scripts de migração usam o MESMO client — nunca uma segunda instalação.
const requireFromApi = createRequire(new URL("apps/api/package.json", import.meta.url));
const prismaClientPath = requireFromApi.resolve("@prisma/client");

/**
 * Testes dos scripts de migração (capacidade 41).
 *
 * Ficam num projeto próprio porque `scripts/` está fora do `rootDir` das
 * apps: o importador é ferramenta de migração, não código de runtime do
 * ERP. Lê o mesmo `.env` do monorepo — menos o banco. O importador GRAVA o
 * master data do corpus (`runPipeline({ write: true })`) e a abertura de
 * estoque cria item, lote e movimento; até TEST-SCRIPTS-DB-ISOLATION-01 isso
 * caía no banco da `DATABASE_URL` — no DEV, o `veridi_dev`.
 *
 * Agora a faixa usa o banco de TESTE da suíte da API, pelo mesmo contrato e
 * com a mesma recusa (`apps/api/src/test-support/banco-de-teste.ts`): sem
 * banco reconhecido como de teste, nenhum arquivo roda — nem os puros do
 * `@veridi/shared`. `globalSetup` e `setupFiles` são os da API: criam e migram
 * o banco de teste e conferem o destino em cada worker.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@prisma/client": prismaClientPath },
  },
  test: {
    env: ambienteComBancoDeTeste(loadEnv(mode, ".", "")),
    globalSetup: ["./apps/api/src/test-support/preparar-banco-de-teste.ts"],
    setupFiles: ["./apps/api/src/test-support/ciclo-do-arquivo-de-teste.ts"],
    // As funções puras de `@veridi/shared` (Decimal, sem banco) também rodam
    // aqui: o pacote não tem runner próprio, e uma segunda instalação de
    // vitest só para ele seria ferramenta a mais.
    include: ["scripts/**/*.test.ts", "packages/shared/src/**/*.test.ts"],
    // Cada teste roda o pipeline INTEIRO sobre o corpus real e o banco de
    // teste: são dezenas de milhares de linhas, e o tempo cresce junto com a
    // base. O padrão de 5s não descreve esse trabalho — o timeout aqui é de
    // infraestrutura, não de regra.
    testTimeout: 60_000,
    maxWorkers: 2,
    minWorkers: 1,
  },
}));
