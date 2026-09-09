import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Onde mora o CLI do Prisma, resolvido do workspace da API.
 *
 * Os scripts de migration chamam o Prisma pelo Node — `node <PRISMA_BIN> …` —
 * e nao por `pnpm exec` num shell. Motivo: `pnpm` no Windows e um `.cmd`, o
 * que obrigaria `shell: true`, e com shell os argumentos sao CONCATENADOS em
 * vez de escapados (DEP0190). Resolvendo o `build/index.js` do proprio
 * workspace nao existe shell no caminho, e o binario e exatamente o mesmo que
 * `pnpm exec prisma` usaria.
 *
 * Modulo compartilhado de proposito: `create-migration.mjs` e
 * `apply-migrations.mjs` precisam do MESMO binario, e duas resolucoes
 * paralelas divergiriam no dia em que uma delas mudasse.
 */

export const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const API = path.join(RAIZ, "apps", "api");
export const MIGRATIONS = path.join(API, "prisma", "migrations");

const requireFromApi = createRequire(path.join(API, "package.json"));

export const PRISMA_BIN = path.join(
  path.dirname(requireFromApi.resolve("prisma/package.json")),
  "build",
  "index.js",
);
