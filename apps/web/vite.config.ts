import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * O `.env` do projeto fica na raiz do monorepo, nao em `apps/web`.
 * Sem `envDir` o Vite procuraria apenas em `apps/web`, e `VITE_API_URL`
 * seria silenciosamente ignorado — caindo sempre no fallback de
 * `src/lib/api.ts`.
 */
const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  plugins: [react()],
  envDir: monorepoRoot,
  server: {
    // Mesmo host da API (VITE_API_URL usa 127.0.0.1): o cookie de sessão só
    // é first-party quando página e API compartilham o host — para o
    // navegador, `localhost` e `127.0.0.1` são hosts diferentes.
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
