import { createRequire } from "node:module";
import { defineConfig, loadEnv } from "vite";

// O client Prisma vive no workspace da API (é lá que ele é gerado). Os
// scripts de migração usam o MESMO client — nunca uma segunda instalação.
const requireFromApi = createRequire(new URL("apps/api/package.json", import.meta.url));
const prismaClientPath = requireFromApi.resolve("@prisma/client");

/**
 * Testes dos scripts de migração (capacidade 41).
 *
 * Ficam num projeto próprio porque `scripts/` está fora do `rootDir` das
 * apps: o importador é ferramenta de migração, não código de runtime do
 * ERP. Lê o mesmo `.env` do monorepo — sem banco, os testes que dependem
 * dele são pulados explicitamente em vez de falharem por infraestrutura.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@prisma/client": prismaClientPath },
  },
  test: {
    env: loadEnv(mode, ".", ""),
    // As funções puras de `@veridi/shared` (Decimal, sem banco) também rodam
    // aqui: o pacote não tem runner próprio, e uma segunda instalação de
    // vitest só para ele seria ferramenta a mais.
    include: ["scripts/**/*.test.ts", "packages/shared/src/**/*.test.ts"],
    // Cada teste roda o pipeline INTEIRO em dry-run sobre o corpus real e o
    // banco de desenvolvimento: são dezenas de milhares de linhas, e o
    // tempo cresce junto com a base. O padrão de 5s não descreve esse
    // trabalho — o timeout aqui é de infraestrutura, não de regra.
    testTimeout: 60_000,
    maxWorkers: 2,
    minWorkers: 1,
  },
}));
