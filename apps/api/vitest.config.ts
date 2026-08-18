import { defineConfig, loadEnv } from "vite";

/**
 * Os testes leem as mesmas variaveis do `.env` na raiz do monorepo.
 * `loadEnv` retorna vazio se o arquivo nao existir, entao o suite nao quebra
 * em um clone limpo — apenas reporta o banco como indisponivel.
 */
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, "../../", ""),
    // Cada arquivo de teste sobe a app e abre o proprio pool do Prisma.
    // Sem teto de workers o Postgres local esgota os connection slots
    // ("remaining connection slots are reserved...") e testes corretos
    // falham por infraestrutura.
    maxWorkers: 3,
    minWorkers: 1,
    // Agregado do banco inteiro não se mede com vizinho escrevendo ao lado.
    // Esses arquivos rodam em seguida, sozinhos — ver `vitest.serial.config.ts`.
    exclude: ["node_modules/**", "dist/**", "src/modules/dashboard/dashboard.test.ts"],
  },
}));
