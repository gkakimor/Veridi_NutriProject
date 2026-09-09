import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exigirBancoLocal } from "./local-db-guard.mjs";
import { PRISMA_BIN } from "./prisma-bin.mjs";

/**
 * A separacao entre CRIAR e APLICAR migration — MIG-ORDER-01b.
 *
 * O MIG-ORDER-01 deu um caminho oficial de criacao, mas `pnpm db:migrate`
 * continuava sendo `prisma migrate dev`, que tambem CRIA: bastava `--name`
 * para nascer uma pasta carimbada com o relogio real, antes da ponta da
 * cadeia. A barreira era so documental. Estes testes provam que agora ela e
 * tecnica.
 *
 * Nada aqui escreve no repositorio. O unico teste que toca banco cria um
 * descartavel no Postgres LOCAL, prova a aplicacao do zero e o derruba —
 * e se pula inteiro quando nao ha banco local.
 */

const RAIZ = process.cwd();
const MIGRATIONS = join(RAIZ, "apps", "api", "prisma", "migrations");
const APPLY = join(RAIZ, "scripts", "apply-migrations.mjs");

const pacote = (caminho: string) =>
  JSON.parse(readFileSync(join(RAIZ, caminho), "utf8")) as { scripts: Record<string, string> };

/** Roda o wrapper e devolve saida + codigo, sem lancar. */
function rodarApply(args: string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [APPLY, ...args], {
      cwd: RAIZ,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, saida: stdout };
  } catch (erro) {
    const e = erro as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, saida: [e.stdout, e.stderr].filter(Boolean).join("\n") };
  }
}

const pastasDeMigration = () => readdirSync(MIGRATIONS).filter((n) => /^\d{14}_/.test(n));

describe("A. so `migration:create` cria migration", () => {
  it("nenhum script de package.json chama `prisma migrate dev`", () => {
    const scripts = [
      ...Object.values(pacote("package.json").scripts),
      ...Object.values(pacote("apps/api/package.json").scripts),
    ];
    expect(scripts.filter((s) => /migrate\s+dev/.test(s))).toEqual([]);
  });

  it("`db:migrate` aponta para o wrapper de aplicacao, nas duas pontas", () => {
    expect(pacote("package.json").scripts["db:migrate"]).toContain("apply-migrations.mjs");
    expect(pacote("apps/api/package.json").scripts["db:migrate"]).toContain(
      "apply-migrations.mjs",
    );
  });

  it("`migration:create` continua sendo o unico caminho de criacao", () => {
    expect(pacote("package.json").scripts["migration:create"]).toContain("create-migration.mjs");
    const criador = readFileSync(join(RAIZ, "scripts", "create-migration.mjs"), "utf8");
    expect(criador).toContain("--create-only");
    // E o unico script que passa `migrate dev` ao Prisma.
    const aplicador = readFileSync(APPLY, "utf8");
    expect(/"migrate",\s*"dev"/.test(aplicador)).toBe(false);
    expect(/"migrate",\s*"deploy"/.test(aplicador)).toBe(true);
  });
});

describe("B. `db:migrate` nao aceita argumento de criacao", () => {
  it("recusa `--name`, nomeando o comando certo", () => {
    const { code, saida } = rodarApply(["--name", "minha_migration"]);
    expect(code).not.toBe(0);
    expect(saida).toContain("RECUSADO");
    expect(saida).toContain("pnpm migration:create");
    expect(saida).toContain("Nenhuma migration foi criada");
  });

  it("recusa `--name=` e `-n` pela mesma porta", () => {
    for (const arg of ["--name=x", "-n"]) {
      const { code, saida } = rodarApply([arg]);
      expect(code).not.toBe(0);
      expect(saida).toContain("argumento de CRIACAO");
    }
  });

  it("recusa qualquer outra opcao em vez de repassar em silencio ao Prisma", () => {
    const { code, saida } = rodarApply(["--create-only"]);
    expect(code).not.toBe(0);
    expect(saida).toContain("argumento inesperado");
  });

  it("o proprio `prisma migrate deploy` nao conhece `--name`", () => {
    // A segunda barreira, abaixo do wrapper: mesmo que um argumento
    // escapasse, o subcomando de aplicacao nao tem caminho de criacao.
    const { saida } = (() => {
      try {
        return {
          saida: execFileSync(
            process.execPath,
            [PRISMA_BIN, "migrate", "deploy", "--name", "x"],
            { cwd: join(RAIZ, "apps", "api"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          ),
        };
      } catch (erro) {
        const e = erro as { stdout?: string; stderr?: string };
        return { saida: [e.stdout, e.stderr].filter(Boolean).join("\n") };
      }
    })();
    expect(saida).toContain("unknown or unexpected option: --name");
  });
});

describe("C. `db:migrate` nunca cria pasta de migration", () => {
  it("a contagem de migrations nao muda depois de recusar `--name`", () => {
    const antes = pastasDeMigration();
    rodarApply(["--name", "nao_deve_nascer"]);
    expect(pastasDeMigration()).toEqual(antes);
  });

  it("banco remoto e recusado antes de qualquer chamada ao Prisma", () => {
    const antes = pastasDeMigration();
    const { code, saida } = rodarApply([], {
      DATABASE_URL: "postgresql://u:p@containers-us-west-1.railway.app:5432/railway",
    });
    expect(code).not.toBe(0);
    expect(saida).toContain("só roda contra banco LOCAL");
    expect(pastasDeMigration()).toEqual(antes);
  });
});

/*
 * D. Aplicacao de verdade, do zero, num banco descartavel do MESMO servidor
 * local — o unico jeito de provar que o wrapper APLICA, e nao so que ele
 * recusa. Some no fim, inclusive quando falha no meio. Sem banco local, pula.
 */
describe("D. aplica migrations pendentes num banco descartavel", async () => {
  let local: { url: string } | null = null;
  try {
    local = exigirBancoLocal();
  } catch {
    local = null;
  }

  it.skipIf(local === null)("aplica as 57 do zero, e nao cria nenhuma", async () => {
    const { createRequire } = await import("node:module");
    const requireFromApi = createRequire(join(RAIZ, "apps", "api", "package.json"));
    const { PrismaClient } = requireFromApi("@prisma/client");

    const comBanco = (url: string, nome: string) => {
      const u = new URL(url);
      u.pathname = `/${nome}`;
      return u.toString();
    };
    const temporario = `veridi_apply_check_${Date.now()}`;
    const admin = new PrismaClient({
      datasources: { db: { url: comBanco(local!.url, "postgres") } },
    });
    const antes = pastasDeMigration();

    await admin.$executeRawUnsafe(`CREATE DATABASE "${temporario}"`);
    try {
      const { code, saida } = rodarApply([], { DATABASE_URL: comBanco(local!.url, temporario) });
      expect(saida).toContain("banco local");
      expect(code).toBe(0);
      expect(saida).toMatch(/migrations have been successfully applied|└─ \d{14}_/);
      // Aplicar nunca inventa pasta.
      expect(pastasDeMigration()).toEqual(antes);
    } finally {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${temporario}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });
});
