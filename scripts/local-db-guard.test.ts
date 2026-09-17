import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * O porteiro de shell do `local-db-guard.mjs`.
 *
 * `node scripts/local-db-guard.mjs && <comando destrutivo>` só protege se o
 * comando sair com código diferente de zero quando o banco não é
 * comprovadamente local. Até 2026-09-17 o bloco de execução direta nunca
 * rodava no Windows — comparava `file:///C:/...` com `file://C:/...` —, e sem
 * `DATABASE_URL`, ou com a URL do Railway, o porteiro saía 0 sem imprimir nada.
 *
 * A detecção de execução direta só existe num processo em que o guarda é o
 * comando: os testes rodam `node` de verdade. Nenhum abre conexão — o guarda
 * só lê a URL.
 */

const RAIZ = process.cwd();
const GUARDA = join(RAIZ, "scripts", "local-db-guard.mjs");

/** O que decide o veredito não vem do ambiente da suíte; cada teste põe o seu. */
const VARIAVEIS_DO_VEREDITO = ["DATABASE_URL", "DATABASE_PUBLIC_URL", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"];

function rodarNode(args: string[], env: Record<string, string> = {}) {
  const herdado = { ...process.env };
  for (const chave of VARIAVEIS_DO_VEREDITO) delete herdado[chave];
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, env: { ...herdado, ...env }, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("rodado direto, é porteiro", () => {
  it("sem DATABASE_URL, recusa com exit 1", () => {
    const { code, stdout, stderr } = rodarNode([GUARDA]);
    expect(stderr).toContain("RECUSADO");
    expect(stderr).toContain("DATABASE_URL não está definida");
    expect(stdout).not.toContain("ok  banco local");
    expect(code).toBe(1);
  });

  it("com a URL do Railway, recusa com exit 1 sem imprimir a senha", () => {
    const { code, stdout, stderr } = rodarNode([GUARDA], {
      DATABASE_URL: "postgresql://postgres:segredo@tokaido.proxy.rlwy.net:5432/railway",
    });
    expect(stderr).toContain("RECUSADO");
    expect(stderr).toContain('host "tokaido.proxy.rlwy.net" não é local');
    expect(stdout + stderr).not.toContain("segredo");
    expect(code).toBe(1);
  });

  it("com banco local, sai 0 e diz o destino sem a credencial", () => {
    const { code, stdout } = rodarNode([GUARDA], {
      DATABASE_URL: "postgresql://usuario:segredo@localhost:5432/veridi_guarda_local?schema=public",
    });
    expect(stdout).toContain("ok  banco local: localhost:5432/veridi_guarda_local");
    expect(stdout).not.toContain("segredo");
    expect(code).toBe(0);
  });
});

/*
 * Os scripts destrutivos importam `exigirBancoLocal`: importado, o guarda não
 * dá veredito nem mexe no código de saída de quem o importou.
 */
describe("importado, não é porteiro", () => {
  const urlDoGuarda = JSON.stringify(pathToFileURL(GUARDA).href);
  let pasta = "";

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), "veridi-local-db-guard-"));
  });

  afterAll(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it("por outro script: nada impresso e exit 0, mesmo sem DATABASE_URL", () => {
    const script = join(pasta, "importa-o-guarda.mjs");
    writeFileSync(script, `import ${urlDoGuarda};\n`);
    expect(rodarNode([script])).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("sem argv[1] (`node -e`): nada impresso e exit 0", () => {
    expect(rodarNode(["--input-type=module", "-e", `await import(${urlDoGuarda});`])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });
});
