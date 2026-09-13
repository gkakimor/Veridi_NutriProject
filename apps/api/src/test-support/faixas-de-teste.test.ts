import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nenhuma faixa de `pnpm test` escreve no banco de quem usa o sistema
 * (TEST-SCRIPTS-DB-ISOLATION-01).
 *
 * TEST-SUPPORT-ISOLATION-WAVE-01 pôs as duas faixas da API em banco de teste e
 * deixou a de scripts da raiz no da `DATABASE_URL`: com o corpus presente, o
 * importador gravava master data no `veridi_dev`. O furo não estava num teste,
 * estava numa faixa que ninguém classificou.
 *
 * Aqui se lê o comando real — o `test` do `package.json` da raiz e o de cada
 * pacote que o `pnpm -r` alcança — e toda config de Vitest que ele dispara tem
 * de estar classificada: ou monta o ambiente dos workers pelo contrato de
 * `banco-de-teste.ts`, com a preparação do banco e a conferência em cada
 * arquivo, ou mora em pacote sem client de banco. Faixa nova reprova aqui até
 * ser classificada. (Teste de tela ainda alcança a API de desenvolvimento por
 * HTTP, mas sem sessão: toda rota que escreve exige usuário autenticado.)
 *
 * A recusa em si — destino que não se prova de teste — está em
 * `banco-de-teste.test.ts`; esta é a prova de que nenhuma faixa a contorna.
 */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));

/** Faixas que alcançam banco: escrevem só no banco de teste. */
const COM_BANCO = ["apps/api/vitest.config.ts", "apps/api/vitest.serial.config.ts", "vitest.scripts.config.ts"];

/** Faixas de pacote sem client de banco. */
const SEM_BANCO = ["apps/web/vite.config.ts"];

const ler = (relativo: string) => readFileSync(path.join(RAIZ, relativo), "utf8");

interface Pacote {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const pacote = (pasta: string) => JSON.parse(ler(path.posix.join(pasta, "package.json"))) as Pacote;

/** Pacotes do workspace (`pnpm-workspace.yaml`), como o `pnpm -r` os alcança. */
function pacotesDoWorkspace(): string[] {
  const padroes = [...ler("pnpm-workspace.yaml").matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]!);
  return padroes.flatMap((padrao) => {
    if (!padrao.endsWith("/*")) throw new Error(`padrão de workspace que este teste não sabe ler: ${padrao}`);
    const base = padrao.slice(0, -2);
    return readdirSync(path.join(RAIZ, base))
      .map((nome) => `${base}/${nome}`)
      .filter((pasta) => existsSync(path.join(RAIZ, pasta, "package.json")));
  });
}

/** A config que o `vitest` usa sem `--config`: `vitest.config.*` antes de `vite.config.*`. */
function configPadrao(pasta: string): string {
  const achada = ["vitest.config.ts", "vite.config.ts"].find((nome) => existsSync(path.join(RAIZ, pasta, nome)));
  if (!achada) throw new Error(`${pasta} roda vitest sem config conhecida`);
  return path.posix.join(pasta, achada);
}

/** Toda config de Vitest que um script de teste dispara, relativa à raiz. */
function faixasDoScript(pasta: string, script: string): string[] {
  return script.split("&&").flatMap((parte) => {
    const comando = parte.trim();
    if (/^(echo|exit)\b/.test(comando)) return [];
    if (/^pnpm\s+(-r|--recursive)\b.*\stest$/.test(comando)) {
      return pacotesDoWorkspace().flatMap((outro) => {
        const teste = pacote(outro).scripts?.["test"];
        return teste ? faixasDoScript(outro, teste) : [];
      });
    }
    if (/^vitest\s/.test(comando)) {
      const explicita = /--config[=\s]+(\S+)/.exec(comando)?.[1];
      return [explicita ? path.posix.join(pasta, explicita) : configPadrao(pasta)];
    }
    if (/\b(vitest|test)\b/.test(comando)) throw new Error(`comando de teste que este teste não sabe ler: "${comando}"`);
    return [];
  });
}

describe("toda faixa de `pnpm test` está classificada", () => {
  it("o `pnpm test` da raiz dispara exatamente as faixas conhecidas", () => {
    const script = pacote(".").scripts?.["test"];
    expect(script).toBeDefined();
    expect([...new Set(faixasDoScript(".", script!))].sort()).toEqual([...COM_BANCO, ...SEM_BANCO].sort());
  });
});

describe("faixa que alcança banco escreve só em banco de teste", () => {
  it.each(COM_BANCO)("%s: os workers recebem o banco de teste, preparado antes e conferido em cada arquivo", (config) => {
    const fonte = ler(config);

    // Uma única origem de ambiente para os workers, e ela passa pelo contrato.
    const ambientes = fonte.match(/^[ \t]*env:.*$/gm) ?? [];
    expect(ambientes).toHaveLength(1);
    expect(ambientes[0]).toMatch(/env:\s*ambienteComBancoDeTeste\(loadEnv\(/);
    expect(fonte).toMatch(/from "\.\/(apps\/api\/)?src\/test-support\/banco-de-teste\.js"/);

    for (const [chave, arquivo] of [
      ["globalSetup", "preparar-banco-de-teste.ts"],
      ["setupFiles", "ciclo-do-arquivo-de-teste.ts"],
    ] as const) {
      const caminho = new RegExp(`\\b${chave}:\\s*\\[\\s*"([^"]+)"\\s*\\]`).exec(fonte)?.[1];
      expect(caminho, `${config} sem ${chave}`).toBeDefined();
      expect(caminho!.endsWith(`src/test-support/${arquivo}`), `${chave} de ${config}: ${caminho}`).toBe(true);
      expect(existsSync(path.join(RAIZ, path.posix.dirname(config), caminho!)), `${chave} de ${config} não existe`).toBe(true);
    }
  });
});

describe("faixa sem banco", () => {
  it.each(SEM_BANCO)("%s: o pacote não tem client de banco", (config) => {
    const { dependencies, devDependencies } = pacote(path.posix.dirname(config));
    const nomes = Object.keys({ ...dependencies, ...devDependencies });
    expect(nomes.filter((nome) => /prisma|postgres|^pg$|^pg-/.test(nome))).toEqual([]);
  });
});
