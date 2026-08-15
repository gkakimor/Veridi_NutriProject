import { defineConfig, loadEnv } from "vite";

/**
 * Os testes leem as mesmas variaveis do `.env` na raiz do monorepo.
 * `loadEnv` retorna vazio se o arquivo nao existir, entao o suite nao quebra
 * em um clone limpo — apenas reporta o banco como indisponivel.
 */
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, "../../", ""),
  },
}));
