import { defineConfig, loadEnv } from "vite";
import { ambienteComBancoDeTeste } from "./src/test-support/banco-de-teste.js";

/**
 * Os testes leem as variaveis do `.env` na raiz do monorepo (e do ambiente,
 * que vence o arquivo) — menos o banco: a suíte escreve num banco de TESTE,
 * nunca no da `DATABASE_URL` (`src/test-support/banco-de-teste.ts`). Sem banco
 * reconhecido como de teste, nenhum arquivo roda.
 *
 * `globalSetup` cria o banco de teste se faltar e aplica as migrations;
 * `setupFiles` confere o destino em cada worker e tira, no fim de cada arquivo,
 * os usuários e as sessões que ele criou.
 */
export default defineConfig(({ mode }) => ({
  test: {
    env: ambienteComBancoDeTeste(loadEnv(mode, "../../", "")),
    globalSetup: ["./src/test-support/preparar-banco-de-teste.ts"],
    setupFiles: ["./src/test-support/ciclo-do-arquivo-de-teste.ts"],
    // Cada arquivo de teste sobe a app e abre o proprio pool do Prisma.
    // Sem teto de workers o Postgres local esgota os connection slots
    // ("remaining connection slots are reserved...") e testes corretos
    // falham por infraestrutura.
    maxWorkers: 3,
    minWorkers: 1,
    // Agregado do banco inteiro não se mede com vizinho escrevendo ao lado, e
    // revisão de documento controlado é ATIVA por tipo — uma só, global.
    // Esses arquivos rodam em seguida, sozinhos — ver `vitest.serial.config.ts`.
    exclude: [
      "node_modules/**",
      "dist/**",
      "src/modules/dashboard/dashboard.test.ts",
      "src/modules/dashboard/dashboard-retrato-unico.test.ts",
      "src/modules/dashboard/dashboard-conjuntos-uma-vez.test.ts",
      "src/modules/production-orders/gmp-execution.test.ts",
      "src/modules/controlled-documents/controlled-documents.test.ts",
      "src/modules/production-calendar/production-calendar.test.ts",
      "src/modules/production-schedules/production-schedules.test.ts",
    ],
  },
}));
