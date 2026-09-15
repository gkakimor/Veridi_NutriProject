import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  conferirBaselineAtual,
  conferirMigrationsDoBanco,
  estadoDasMigrations,
} from "./e2e-baseline-migrations.mjs";
import {
  BATERIAS,
  conferirTemplateSemConexao,
  encerrarArvore,
  esperarPronto,
  iniciarProcesso,
  lerOpcoes,
  nomeDoClone,
  origensDaExecucao,
  portaOcupada,
  prepararAlvos,
  processoVivo,
  rodarSuite,
  suitesDaExecucao,
} from "./e2e-run.mjs";
import { exigirOrigemLocal } from "./e2e/fixtures/api.mjs";
import { criarRun, novoRunId } from "./e2e/fixtures/run.mjs";
import { obterRun } from "./e2e/lib/run-id.mjs";

/**
 * E2E-BASELINE-REDESIGN-WAVE-01-02 — as guardas do `pnpm e2e:run`.
 *
 * O runner cria e DERRUBA banco, sobe e mata processo. O que ele pode tocar é
 * decidido antes de qualquer efeito, e o que ele sobe ele encerra — netos
 * inclusive. Nada aqui conecta em banco: as recusas são puras, e os processos
 * são scripts de brinquedo.
 */

const LOCAL = "postgresql://usuario:segredo@localhost:5432/veridi_dev?schema=public";
const RUN = "K3F9QZ";
const PASTA_E2E = fileURLToPath(new URL("./e2e/", import.meta.url));

const temporarias: string[] = [];
function pastaTemporaria(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "e2e-run-teste-"));
  temporarias.push(pasta);
  return pasta;
}
afterEach(() => {
  for (const pasta of temporarias.splice(0)) rmSync(pasta, { recursive: true, force: true, maxRetries: 5 });
});

const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function portaLivre(): Promise<number> {
  return new Promise((resolve) => {
    const servidor = net.createServer();
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address() as net.AddressInfo;
      servidor.close(() => resolve(port));
    });
  });
}

async function ate(condicao: () => boolean | Promise<boolean>, ms = 20000): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicao()) return true;
    await pausa(100);
  }
  return condicao();
}

function listar(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = path.join(pasta, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : [caminho];
  });
}

describe("clone: o que o runner pode criar e derrubar", () => {
  it("nasce da template com o runId, no mesmo servidor e com a mesma credencial", () => {
    const alvos = prepararAlvos({ DATABASE_URL: LOCAL }, { runId: RUN });
    expect(alvos.template.banco).toBe("veridi_e2e_baseline");
    expect(alvos.clone.banco).toBe("veridi_e2e_baseline_run_k3f9qz");
    const url = new URL(alvos.clone.url);
    expect([url.hostname, url.port, url.username, url.pathname, url.search]).toEqual([
      "localhost",
      "5432",
      "usuario",
      "/veridi_e2e_baseline_run_k3f9qz",
      "?schema=public",
    ]);
    expect(new URL(alvos.postgres).pathname).toBe("/postgres");
    expect(alvos.reuso).toBe(false);
    expect(prepararAlvos({ DATABASE_URL: LOCAL }, { clone: "veridi_e2e_baseline_run_abc123" }).reuso).toBe(true);
  });

  it.each([
    ["aspas e comando", 'veridi_e2e_baseline_x"; DROP DATABASE veridi_dev; --'],
    ["maiúscula", "Veridi_E2E_Baseline_run_x"],
    ["nome sem e2e_baseline", "veridi_run_k3f9qz"],
    ["nome acima de 63 caracteres", `veridi_e2e_baseline_${"x".repeat(50)}`],
    ["a própria template", "veridi_e2e_baseline"],
    ["marca de produção", "veridi_e2e_baseline_prod"],
  ])("recusa clone com %s", (_caso, clone) => {
    expect(() => prepararAlvos({ DATABASE_URL: LOCAL }, { runId: RUN, clone })).toThrow(/RECUSADO/);
  });

  it("recusa runId fora do formato no nome do clone", () => {
    expect(() => nomeDoClone("veridi_e2e_baseline", "abc")).toThrow(/runId inválido/);
  });

  it("recusa o banco da .env como clone e como template", () => {
    const clone = "veridi_e2e_baseline_run_k3f9qz";
    expect(() =>
      prepararAlvos({ DATABASE_URL: LOCAL.replace("/veridi_dev", `/${clone}`) }, { clone }),
    ).toThrow(/banco da \.env/);
    expect(() =>
      prepararAlvos({ DATABASE_URL: LOCAL.replace("/veridi_dev", "/veridi_e2e_baseline") }, { runId: RUN }),
    ).toThrow(/banco da \.env/);
  });

  it.each([
    ["servidor remoto", { DATABASE_URL: "postgresql://u:p@db.exemplo.com:5432/veridi_dev" }],
    ["host do Railway", { DATABASE_URL: "postgresql://u:p@tokaido.proxy.rlwy.net:5432/railway" }],
    ["credencial de produção no ambiente", { DATABASE_URL: LOCAL, DATABASE_PUBLIC_URL: "postgresql://u:p@x/y" }],
    ["sem DATABASE_URL", {}],
  ])("recusa %s antes de qualquer efeito", (_caso, env) => {
    expect(() => prepararAlvos(env as Record<string, string>, { runId: RUN })).toThrow(/RECUSADO/);
  });

  it("recusa clonar template com sessão aberta — e só pergunta, não derruba ninguém", async () => {
    const perguntas: string[] = [];
    const duasSessoes = async (banco: string) => {
      perguntas.push(banco);
      return 2;
    };
    await expect(conferirTemplateSemConexao(duasSessoes, "veridi_e2e_baseline")).rejects.toThrow(
      /RECUSADO: veridi_e2e_baseline tem 2 conexão\(ões\) aberta\(s\)/,
    );
    expect(perguntas).toEqual(["veridi_e2e_baseline"]);
    await expect(conferirTemplateSemConexao(async () => 0, "veridi_e2e_baseline")).resolves.toBeUndefined();
  });
});

describe("template velha", () => {
  function pastaDeMigrations(migrations: Record<string, string>): string {
    const pasta = pastaTemporaria();
    for (const [nome, sql] of Object.entries(migrations)) {
      mkdirSync(path.join(pasta, nome));
      writeFileSync(path.join(pasta, nome, "migration.sql"), sql);
    }
    writeFileSync(path.join(pasta, "migration_lock.toml"), 'provider = "postgresql"\n');
    return pasta;
  }
  const BANCO = { banco: "veridi_e2e_baseline" };
  const baselineDe = (migrations: unknown) => ({ banco: "veridi_e2e_baseline", migrations });
  const DUAS = {
    "20260101000000_a": "CREATE TABLE a (id int);\n",
    "20260101000001_b": "ALTER TABLE a ADD b int;\n",
  };

  it("aceita a base das mesmas migrations — fim de linha não conta", () => {
    const lf = estadoDasMigrations(pastaDeMigrations(DUAS));
    const crlf = estadoDasMigrations(
      pastaDeMigrations(Object.fromEntries(Object.entries(DUAS).map(([n, sql]) => [n, sql.replace(/\n/g, "\r\n")]))),
    );
    expect(crlf).toEqual(lf);
    expect(lf).toMatchObject({ total: 2, ultima: "20260101000001_b" });
    expect(() => conferirBaselineAtual(baselineDe(lf), crlf, BANCO)).not.toThrow();
  });

  it("recusa migration nova no repositório e manda rodar o rebuild — sem rebuild automático", () => {
    const baseline = estadoDasMigrations(pastaDeMigrations(DUAS));
    const atual = estadoDasMigrations(pastaDeMigrations({ ...DUAS, "20260101000002_c": "CREATE TABLE c (id int);\n" }));
    expect(() => conferirBaselineAtual(baselineDe(baseline), atual, BANCO)).toThrow(
      /template velha — veridi_e2e_baseline foi montada com 2 migrations \(última 20260101000001_b\), o repositório tem 3 \(última 20260101000002_c\).*pnpm e2e:baseline:rebuild/,
    );
  });

  it("recusa migration editada com o mesmo total", () => {
    const baseline = estadoDasMigrations(pastaDeMigrations(DUAS));
    const atual = estadoDasMigrations(pastaDeMigrations({ ...DUAS, "20260101000001_b": "ALTER TABLE a ADD b bigint;\n" }));
    expect(() => conferirBaselineAtual(baselineDe(baseline), atual, BANCO)).toThrow(/conteúdo diferente/);
  });

  it("recusa baseline ausente, anterior à guarda ou de outro banco", () => {
    const atual = estadoDasMigrations(pastaDeMigrations(DUAS));
    expect(() => conferirBaselineAtual(null, atual, BANCO)).toThrow(/sem baseline\.json.*pnpm e2e:baseline:rebuild/);
    expect(() => conferirBaselineAtual({ banco: "veridi_e2e_baseline", contagens: {} }, atual, BANCO)).toThrow(
      /não registra as migrations/,
    );
    expect(() => conferirBaselineAtual({ banco: "outra_e2e_baseline", migrations: atual }, atual, BANCO)).toThrow(
      /descreve outra_e2e_baseline/,
    );
  });

  it("recusa clone cujo banco não carrega as migrations do repositório", () => {
    const repositorio = ["20260101000000_a", "20260101000001_b"];
    expect(() => conferirMigrationsDoBanco(repositorio, repositorio, { banco: "x_e2e_baseline_run" })).not.toThrow();
    expect(() => conferirMigrationsDoBanco(["20260101000000_a"], repositorio, { banco: "x_e2e_baseline_run" })).toThrow(
      /faltam 1 \(20260101000001_b…\)/,
    );
  });
});

describe("opções, suítes e origens", () => {
  it("lê a bateria, aceita o -- literal do pnpm e recusa opção desconhecida", () => {
    expect(lerOpcoes(["--", "--bateria=wave-01-02", "--manter-clone"])).toMatchObject({
      bateria: "wave-01-02",
      manterClone: true,
      apiPorta: 3334,
      webPorta: 5174,
    });
    expect(() => lerOpcoes(["--apagar-tudo"])).toThrow(/RECUSADO: opção desconhecida/);
  });

  it("a bateria da wave são as 10 suítes A e o recebimento, todas existentes", () => {
    expect(BATERIAS["wave-01-02"]).toHaveLength(11);
    expect(suitesDaExecucao({ bateria: "wave-01-02", suites: null })).toContain("recebimento-validacao-viva");
    expect(suitesDaExecucao({ bateria: "provas-wave-01-02", suites: null })).toHaveLength(2);
  });

  it("a WAVE 3 é o Hub e as sete do Orçamento na página da versão, com o envio fundido", () => {
    const suites = suitesDaExecucao({ bateria: "wave-03", suites: null });
    expect(suites).toHaveLength(8);
    expect(suites).toContain("orcamentos-hub-e-pagina-da-versao");
    expect(suites).toContain("envio-exige-condicoes-e-linhas-salvas");
    // Fundidas na suíte do envio (decisão D do PO): não voltam como arquivo solto.
    for (const antiga of ["envio-exige-condicoes-salvas", "envio-exige-linhas-salvas"]) {
      expect(existsSync(path.join(PASTA_E2E, `${antiga}.mjs`)), antiga).toBe(false);
    }
  });

  it.each([
    [{ bateria: "wave-01-02", suites: ["troca-de-cep-do-cliente"] }, /OU/],
    [{ bateria: "nenhuma", suites: null }, /desconhecida/],
    [{ bateria: null, suites: ["../../apps/api/src/main"] }, /nome de suíte inválido/],
    [{ bateria: null, suites: ["suite-que-nao-existe"] }, /não existe/],
    [{ bateria: null, suites: null }, /informe --bateria/],
  ])("recusa pedido de suítes inválido %#", (pedido, mensagem) => {
    expect(() => suitesDaExecucao(pedido)).toThrow(mensagem);
  });

  it.each([
    "http://localhost:3334",
    "http://0.0.0.0:3334",
    "http://192.168.0.10:3334",
    "https://veridi.up.railway.app",
    "https://127.0.0.1:3334",
    "http://127.0.0.1",
    "http://usuario:senha@127.0.0.1:3334",
    "http://127.0.0.1:3334/api",
    "não é url",
  ])("recusa a origem não local %s", (origem) => {
    expect(() => exigirOrigemLocal(origem, "E2E_API")).toThrow(/RECUSADO/);
  });

  it("aceita só a origem 127.0.0.1 com porta, e API e Web em portas diferentes", () => {
    expect(exigirOrigemLocal("http://127.0.0.1:3334/", "E2E_API")).toBe("http://127.0.0.1:3334");
    expect(origensDaExecucao({ apiPorta: 3334, webPorta: 5174 })).toEqual({
      api: "http://127.0.0.1:3334",
      web: "http://127.0.0.1:5174",
    });
    expect(() => origensDaExecucao({ apiPorta: 3334, webPorta: 3334 })).toThrow(/mesma porta/);
    expect(() => lerOpcoes(["--api-porta=80"])).toThrow(/RECUSADO/);
    expect(() => lerOpcoes(["--web-porta=abc"])).toThrow(/RECUSADO/);
  });

  it("vê a porta ocupada e a porta livre", async () => {
    const servidor = net.createServer();
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", () => resolve()));
    const { port } = servidor.address() as net.AddressInfo;
    expect(await portaOcupada(port)).toBe(true);
    await new Promise((resolve) => servidor.close(resolve));
    expect(await ate(async () => !(await portaOcupada(port)), 5000)).toBe(true);
  });
});

describe("processos filhos", () => {
  it("API que morre na subida reprova com o exit e o log", async () => {
    const pasta = pastaTemporaria();
    const processo = iniciarProcesso({
      rotulo: "API de brinquedo",
      comando: process.execPath,
      args: ["-e", "console.error('quebrou na subida'); process.exit(3)"],
      cwd: pasta,
      env: process.env,
      arquivoDeLog: path.join(pasta, "api.log"),
    });
    const porta = await portaLivre();
    await expect(
      esperarPronto(`http://127.0.0.1:${porta}/health`, processo, { timeout: 20000, intervalo: 100 }),
    ).rejects.toThrow(/API de brinquedo saiu antes de ficar pronto \(exit 3\) — log: .*api\.log/);
    await processo.fechado;
    await processo.fecharLog();
    expect(readFileSync(processo.arquivoDeLog, "utf8")).toContain("quebrou na subida");
  });

  it("comando que nem existe também reprova, sem pendurar a espera", async () => {
    const pasta = pastaTemporaria();
    const processo = iniciarProcesso({
      rotulo: "Web de brinquedo",
      comando: path.join(pasta, "nao-existe.exe"),
      cwd: pasta,
      env: process.env,
      arquivoDeLog: path.join(pasta, "web.log"),
    });
    await expect(
      esperarPronto(`http://127.0.0.1:${await portaLivre()}/`, processo, { timeout: 20000, intervalo: 100 }),
    ).rejects.toThrow(/Web de brinquedo saiu antes de ficar pronto/);
    await processo.fecharLog();
  });

  it("suíte reprova por exit ≠ 0, por estouro de tempo e por SEM MASSA mesmo com exit 0", async () => {
    const pasta = pastaTemporaria();
    const suite = (nome: string, codigo: string) => {
      const arquivo = path.join(pasta, `${nome}.mjs`);
      writeFileSync(arquivo, codigo);
      return arquivo;
    };
    const base = { env: process.env, pastaDeLogs: pasta };
    const aprovada = await rodarSuite({ ...base, suite: "aprovada", arquivo: suite("aprovada", "console.log('  ok   o total bate'); console.log('APROVADO');") });
    const reprovada = await rodarSuite({ ...base, suite: "reprovada", arquivo: suite("reprovada", "console.log('  FALHA o total não bate'); process.exitCode = 1;") });
    const semMassa = await rodarSuite({ ...base, suite: "sem-massa", arquivo: suite("sem-massa", "console.log('SEM MASSA — nenhum lote liberado'); console.log('APROVADO');") });
    const lenta = await rodarSuite({ ...base, suite: "lenta", arquivo: suite("lenta", "setInterval(() => {}, 1000);"), timeoutMs: 1500 });

    expect(aprovada).toMatchObject({ ok: true, codigo: 0, semMassa: false, estourou: false, falhas: [] });
    expect(reprovada).toMatchObject({ ok: false, codigo: 1, falhas: ["FALHA o total não bate"] });
    expect(semMassa).toMatchObject({ ok: false, codigo: 0, semMassa: true });
    expect(lenta).toMatchObject({ ok: false, estourou: true });
  });

  it("encerrar leva a árvore inteira e libera a porta — o neto não fica órfão", async () => {
    const pasta = pastaTemporaria();
    const porta = await portaLivre();
    const neto = path.join(pasta, "neto.mjs");
    writeFileSync(
      neto,
      `import net from "node:net";\nnet.createServer().listen(${porta}, "127.0.0.1", () => console.log("neto=" + process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const pai = path.join(pasta, "pai.mjs");
    writeFileSync(
      pai,
      `import { spawn } from "node:child_process";\nspawn(process.execPath, [${JSON.stringify(neto)}], { stdio: "inherit" });\nsetInterval(() => {}, 1000);\n`,
    );
    const processo = iniciarProcesso({
      rotulo: "Web de brinquedo",
      comando: process.execPath,
      args: [pai],
      cwd: pasta,
      env: process.env,
      arquivoDeLog: path.join(pasta, "web.log"),
    });

    const pidDoNeto = () => Number(/neto=(\d+)/.exec(readFileSync(processo.arquivoDeLog, "utf8"))?.[1] ?? 0);
    expect(await ate(async () => (await portaOcupada(porta)) && pidDoNeto() > 0)).toBe(true);
    const netoPid = pidDoNeto();
    expect(processoVivo(netoPid)).toBe(true);

    await encerrarArvore(processo);
    await processo.fecharLog();

    expect(processo.terminou()).not.toBeNull();
    expect(await ate(() => !processoVivo(processo.pid!), 5000)).toBe(true);
    expect(await ate(() => !processoVivo(netoPid), 5000)).toBe(true);
    expect(await ate(async () => !(await portaOcupada(porta)), 5000)).toBe(true);
  });
});

describe("runId em memória", () => {
  it("seis caracteres base36, um por execução, sem retomar a anterior", () => {
    const ids = new Set(Array.from({ length: 500 }, () => novoRunId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Z]{6}$/);
    const run = criarRun();
    expect(run.carimbo).toBe(`E2E${run.runId}`);
    expect(criarRun({ prefixo: "GP" }).carimbo).toMatch(/^GP[0-9A-Z]{6}$/);
    expect(() => criarRun({ prefixo: "e2e; rm" })).toThrow(/prefixo/);
    expect(obterRun({ novo: false } as never).runId).not.toBe(obterRun({ novo: false } as never).runId);
  });

  it("nenhum arquivo global: runId não grava nada, e nenhuma suíte, fixture ou lib cita handoff/e2e-run.json", () => {
    const global = path.join(PASTA_E2E, "..", "..", "handoff", "e2e-run.json");
    const antes = existsSync(global) ? statSync(global).mtimeMs : null;
    criarRun();
    obterRun();
    expect(existsSync(global) ? statSync(global).mtimeMs : null).toBe(antes);

    // Citar o arquivo antigo em comentário (a história) não é ler: só o código conta.
    const semComentario = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const modulos = listar(PASTA_E2E).filter((arquivo) => arquivo.endsWith(".mjs"));
    expect(modulos.length).toBeGreaterThan(30);
    expect(
      modulos.filter((arquivo) => semComentario(readFileSync(arquivo, "utf8")).includes("e2e-run.json")),
    ).toEqual([]);
    for (const modulo of ["fixtures/run.mjs", "lib/run-id.mjs"]) {
      expect(readFileSync(path.join(PASTA_E2E, modulo), "utf8")).not.toMatch(/node:fs|require\(["']fs["']\)/);
    }
  });

  it("as suítes das waves e as provas não citam código comercial fixo nem leem banco", () => {
    const suites = [...BATERIAS["wave-01-02"], ...BATERIAS["provas-wave-01-02"], ...BATERIAS["wave-03"]];
    for (const suite of suites) {
      const fonte = readFileSync(path.join(PASTA_E2E, `${suite}.mjs`), "utf8");
      expect(fonte.match(/\b(CLI|FOR|MP|EMB|PA|PROD|PED|ORC|OC|OP|REC|FAT|LOT|PROJ)-\d{4,}\b/g), suite).toBeNull();
      expect(fonte, suite).not.toMatch(/@prisma\/client|DATABASE_URL|\$queryRaw/);
    }
  });

  it("as suítes da WAVE 3 não escolhem registro pela posição nem montam código de orçamento", () => {
    const semComentario = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const suite of BATERIAS["wave-03"]) {
      const fonte = semComentario(readFileSync(path.join(PASTA_E2E, `${suite}.mjs`), "utf8"));
      // "Primeira linha": opção por índice, linha de tabela ou opção de seletor pela posição, item [0] de lista da API.
      expect(fonte, suite).not.toMatch(/selectOption\([^)]*\{\s*index\s*:/);
      expect(fonte, suite).not.toMatch(/(tbody tr|\[role="option"\]|entity-select__option)["'`][^;]*\.(first|nth)\(/);
      expect(fonte, suite).not.toMatch(/\.(quoteVersions|lines|products|customers|projects|customerOrders)\[0\]/);
      // Rótulo e código de orçamento vêm do servidor, nunca de template.
      expect(fonte, suite).not.toMatch(/`ORC-\$\{/);
      // runId da fixture nova, em memória.
      expect(fonte, suite).toMatch(/criarRun\(\)/);
      expect(fonte, suite).not.toMatch(/obterRun|run-id\.mjs/);
    }
  });
});
