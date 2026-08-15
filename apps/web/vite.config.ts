import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
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
    port: 5173,
    strictPort: false,
  },
});
