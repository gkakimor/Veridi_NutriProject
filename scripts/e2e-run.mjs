import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  conferirBaselineAtual,
  conferirMigrationsDoBanco,
  estadoDasMigrations,
  nomesDasMigrations,
} from "./e2e-baseline-migrations.mjs";
import { resolverAlvo } from "./e2e-baseline-rebuild.mjs";
import { exigirOrigemLocal } from "./e2e/fixtures/api.mjs";
import { novoRunId } from "./e2e/fixtures/run.mjs";
import { descreverDestino, exigirBancoLocal } from "./local-db-guard.mjs";

/**
 * Roda suítes E2E num CLONE descartável da base E2E
 * (E2E-BASELINE-REDESIGN-WAVE-01-02).
 *
 *   pnpm e2e:run --bateria=wave-01-02
 *   pnpm e2e:run --suites=troca-de-cep-do-cliente,perfil-tributario-do-cliente
 *   pnpm e2e:run --bateria=wave-01-02 --manter-clone
 *   pnpm e2e:run --bateria=wave-01-02 --clone=veridi_e2e_baseline_run_k3f9qz
 *
 * 1. confere que a template (`veridi_e2e_baseline`, ou `E2E_BASELINE_DATABASE`)
 *    foi montada com as migrations do repositório — `baseline.json` diferente
 *    é recusado, nunca reconstruído por conta própria;
 * 2. cria o clone por `CREATE DATABASE … TEMPLATE` — nome com `e2e_baseline`,
 *    nunca o banco da `.env`, nunca a própria template — ou reusa o clone de
 *    `--clone`, sujo da execução anterior;
 * 3. cria o usuário ADMIN próprio da execução (`scripts/bootstrap-admin.ts`),
 *    com senha sorteada que só as suítes recebem;
 * 4. sobe API e Web SÓ em 127.0.0.1, apontadas para o clone — nunca para a
 *    template;
 * 5. roda as suítes em série: exit ≠ 0, estouro de tempo ou "SEM MASSA"
 *    reprovam;
 * 6. derruba API e Web (a árvore de processos inteira) e remove o clone, a
 *    menos que `--manter-clone`.
 *
 * Opções: `--api-porta` (3334), `--web-porta` (5174), `--timeout-suite`
 * (minutos, 20). Logs de API, Web e de cada suíte em
 * `../.local-data/veridi/e2e-runs/<clone>/<runId>/`.
 */

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PASTA_API = path.join(RAIZ, "apps", "api");
const PASTA_WEB = path.join(RAIZ, "apps", "web");
export const PASTA_MIGRATIONS = path.join(PASTA_API, "prisma", "migrations");
export const PASTA_SUITES = path.join(RAIZ, "scripts", "e2e");
const DADOS = path.resolve(RAIZ, "..", ".local-data", "veridi");
/** Teto de identificador do PostgreSQL. */
const LIMITE_DO_NOME = 63;

export const BATERIAS = Object.freeze({
  /** Grupo A do mapa das E2E mais o recebimento com massa própria. */
  "wave-01-02": [
    "base-calculada-e-equivalente-por-mil",
    "contato-do-cliente-no-projeto",
    "modelo-aplicado-preserva-base",
    "modelo-formulacao-unidade-controlada",
    "oferta-de-fornecedor-vira-custo",
    "perfil-tributario-do-cliente",
    "produto-do-cliente-do-pedido",
    "projeto-inteiro-invalido-nao-apaga",
    "troca-de-cep-do-cliente",
    "vigencia-de-tarifa-industrial",
    "recebimento-validacao-viva",
  ],
  /** Contratos das libs das próximas waves: leitor de PDF e roteiro na OP. */
  "provas-wave-01-02": ["leitor-de-pdf-da-tela", "roteiro-aplicado-planeja-ordem"],
});

const PRAZO = Symbol("prazo");

/** A promessa, ou `PRAZO` se ela não resolver a tempo — sem timer pendurado depois. */
function comPrazo(promessa, ms) {
  let timer;
  const prazo = new Promise((resolve) => {
    timer = setTimeout(() => resolve(PRAZO), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────────────── opções ─────────────────────────── */

function lerPorta(valor, opcao) {
  if (!/^\d+$/.test(valor) || Number(valor) < 1024 || Number(valor) > 65535) {
    throw new Error(`RECUSADO: ${opcao}=${valor} não é porta válida (1024–65535). Nada foi executado.`);
  }
  return Number(valor);
}

export function lerOpcoes(argv) {
  const opcoes = {
    bateria: null,
    suites: null,
    clone: null,
    manterClone: false,
    apiPorta: 3334,
    webPorta: 5174,
    timeoutSuiteMin: 20,
  };
  for (const argumento of argv) {
    // O pnpm 10 entrega o "--" literal ao script.
    if (argumento === "--") continue;
    const corte = argumento.indexOf("=");
    const chave = corte === -1 ? argumento : argumento.slice(0, corte);
    const valor = corte === -1 ? "" : argumento.slice(corte + 1);
    switch (chave) {
      case "--bateria":
        opcoes.bateria = valor;
        break;
      case "--suites":
        opcoes.suites = valor
          .split(",")
          .map((suite) => suite.trim())
          .filter(Boolean);
        break;
      case "--clone":
        opcoes.clone = valor;
        break;
      case "--manter-clone":
        opcoes.manterClone = true;
        break;
      case "--api-porta":
        opcoes.apiPorta = lerPorta(valor, chave);
        break;
      case "--web-porta":
        opcoes.webPorta = lerPorta(valor, chave);
        break;
      case "--timeout-suite":
        if (!/^\d+$/.test(valor) || Number(valor) < 1) {
          throw new Error(`RECUSADO: --timeout-suite=${valor} — minutos inteiros. Nada foi executado.`);
        }
        opcoes.timeoutSuiteMin = Number(valor);
        break;
      default:
        throw new Error(`RECUSADO: opção desconhecida "${argumento}". Nada foi executado.`);
    }
  }
  return opcoes;
}

/** As suítes pedidas, conferidas contra os arquivos de `scripts/e2e`. */
export function suitesDaExecucao({ bateria, suites }, pasta = PASTA_SUITES) {
  if (bateria && suites) throw new Error("RECUSADO: use --bateria OU --suites. Nada foi executado.");
  if (bateria && !BATERIAS[bateria]) {
    throw new Error(`RECUSADO: bateria "${bateria}" desconhecida (${Object.keys(BATERIAS).join(", ")}).`);
  }
  const lista = bateria ? BATERIAS[bateria] : suites;
  if (!lista || lista.length === 0) throw new Error("RECUSADO: informe --bateria=<nome> ou --suites=a,b.");
  if (new Set(lista).size !== lista.length) throw new Error("RECUSADO: suíte repetida na lista.");
  for (const suite of lista) {
    if (!/^[a-z0-9-]+$/.test(suite)) throw new Error(`RECUSADO: nome de suíte inválido "${suite}".`);
    if (!existsSync(path.join(pasta, `${suite}.mjs`))) throw new Error(`RECUSADO: scripts/e2e/${suite}.mjs não existe.`);
  }
  return lista;
}

/** API e Web da execução: sempre 127.0.0.1, em portas diferentes. */
export function origensDaExecucao({ apiPorta, webPorta }) {
  const api = exigirOrigemLocal(`http://127.0.0.1:${apiPorta}`, "API E2E");
  const web = exigirOrigemLocal(`http://127.0.0.1:${webPorta}`, "Web E2E");
  if (api === web) throw new Error("RECUSADO: API e Web na mesma porta. Nada foi executado.");
  return { api, web };
}

/* ─────────────────────────── bancos ─────────────────────────── */

export function nomeDoClone(template, runId) {
  if (!/^[0-9A-Z]{6}$/.test(runId ?? "")) throw new Error(`runId inválido para nome de clone: "${runId}"`);
  return `${template}_run_${runId.toLowerCase()}`;
}

/** O que o runner pode criar, usar e derrubar como clone. Lança antes de qualquer efeito. */
export function exigirCloneSeguro(clone, { template, bancoDaEnv }) {
  if (typeof clone !== "string" || !/^[a-z0-9_]+$/.test(clone)) {
    throw new Error(`RECUSADO: clone "${clone}" fora do padrão — só minúsculas, dígitos e "_". Nada foi alterado.`);
  }
  if (!clone.includes("e2e_baseline")) {
    throw new Error(`RECUSADO: clone "${clone}" sem "e2e_baseline" no nome. Nada foi alterado.`);
  }
  if (clone.length > LIMITE_DO_NOME) {
    throw new Error(`RECUSADO: clone "${clone}" passa de ${LIMITE_DO_NOME} caracteres. Nada foi alterado.`);
  }
  if (clone === template) {
    throw new Error(`RECUSADO: o clone não pode ser a própria template ${template}. Nada foi alterado.`);
  }
  if (clone === bancoDaEnv) {
    throw new Error(`RECUSADO: o clone não pode ser o banco da .env (${bancoDaEnv}). Nada foi alterado.`);
  }
  return clone;
}

/**
 * Template, clone e a base `postgres` do MESMO servidor local da `.env`. Toda
 * recusa — servidor remoto, nome inseguro, banco da `.env`, marca de produção
 * — acontece aqui, antes de conectar.
 */
export function prepararAlvos(env, { runId, clone } = {}) {
  const template = resolverAlvo(env);
  const { url, banco: bancoDaEnv } = exigirBancoLocal(env);
  const nome = exigirCloneSeguro(clone ?? nomeDoClone(template.banco, runId), {
    template: template.banco,
    bancoDaEnv,
  });
  const alvo = new URL(url);
  alvo.pathname = `/${nome}`;
  exigirBancoLocal({ ...env, DATABASE_URL: alvo.toString() });
  const postgres = new URL(url);
  postgres.pathname = "/postgres";
  return {
    template,
    clone: { banco: nome, url: alvo.toString() },
    postgres: postgres.toString(),
    bancoDaEnv,
    reuso: clone !== undefined && clone !== null,
  };
}

export function arquivoDaBaseline(banco) {
  return path.join(DADOS, "e2e-baseline", banco, "baseline.json");
}

export function lerBaseline(arquivo) {
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : null;
}

/** `CREATE DATABASE … TEMPLATE` exige a template sem nenhuma sessão — e o runner não derruba sessão alheia. */
export async function conferirTemplateSemConexao(contarConexoes, template) {
  const conexoes = await contarConexoes(template);
  if (conexoes > 0) {
    throw new Error(
      `RECUSADO: ${template} tem ${conexoes} conexão(ões) aberta(s) e CREATE DATABASE … TEMPLATE exige nenhuma. ` +
        `Feche quem está nela (servidor ou cliente apontado para a template); o runner não derruba conexão alheia.`,
    );
  }
}

function clientePrisma(url) {
  const { PrismaClient } = createRequire(path.join(PASTA_API, "package.json"))("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } } });
}

async function comBanco(url, trabalho) {
  const db = clientePrisma(url);
  try {
    return await trabalho(db);
  } finally {
    await db.$disconnect();
  }
}

async function bancoExiste(postgres, banco) {
  return comBanco(postgres, async (db) => {
    const [linha] = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_database WHERE datname = $1", banco);
    return linha.n > 0;
  });
}

async function contarConexoes(postgres, banco) {
  return comBanco(postgres, async (db) => {
    const [linha] = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", banco);
    return linha.n;
  });
}

async function criarClone({ postgres, template, clone }) {
  await comBanco(postgres, async (db) => {
    try {
      // Os dois nomes passaram por `prepararAlvos`: só [a-z0-9_].
      await db.$executeRawUnsafe(`CREATE DATABASE "${clone.banco}" TEMPLATE "${template.banco}"`);
    } catch (erro) {
      throw new Error(`RECUSADO: não clonou ${template.banco} (${String(erro.message).split("\n").at(-1)}).`);
    }
  });
}

async function removerClone({ postgres, clone }) {
  await comBanco(postgres, (db) => db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${clone.banco}" WITH (FORCE)`));
}

async function migrationsDoBanco(url) {
  return comBanco(url, async (db) => {
    const linhas = await db.$queryRawUnsafe(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
    );
    return linhas.map((linha) => linha.migration_name);
  });
}

/* ─────────────────────────── processos ─────────────────────────── */

/** Porta em uso por qualquer processo — quem aceita conexão ou quem impede o bind. */
export async function portaOcupada(porta, host = "127.0.0.1") {
  const conecta = await new Promise((resolve) => {
    const socket = net.connect({ port: porta, host });
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (conecta) return true;
  return new Promise((resolve) => {
    const servidor = net.createServer();
    servidor.once("error", () => resolve(true));
    servidor.listen(porta, host, () => servidor.close(() => resolve(false)));
  });
}

/**
 * Processo filho com saída num arquivo de log. `saida` resolve quando o
 * processo termina (ou nem começa); `fechado`, quando a saída acabou de chegar.
 */
export function iniciarProcesso({ rotulo, comando, args = [], cwd, env, arquivoDeLog, shell = false, capturar = false }) {
  mkdirSync(path.dirname(arquivoDeLog), { recursive: true });
  const log = createWriteStream(arquivoDeLog, { flags: "a" });
  const pedacos = [];
  const filho = spawn(comando, args, {
    cwd,
    env,
    shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    // Fora do Windows, grupo próprio: o encerramento alcança a árvore inteira.
    detached: process.platform !== "win32",
  });
  const guardar = (pedaco) => {
    log.write(pedaco);
    if (capturar) pedacos.push(pedaco);
  };
  filho.stdout?.on("data", guardar);
  filho.stderr?.on("data", guardar);

  let terminou = null;
  const saida = new Promise((resolve) => {
    filho.once("error", (erro) => {
      log.write(`\n[e2e:run] ${rotulo} não iniciou: ${erro.message}\n`);
      terminou ??= { codigo: null, sinal: null, erro: erro.message };
      resolve(terminou);
    });
    filho.once("exit", (codigo, sinal) => {
      terminou ??= { codigo, sinal, erro: null };
      resolve(terminou);
    });
  });
  const fechado = new Promise((resolve) => {
    filho.once("close", resolve);
    filho.once("error", resolve);
  });

  return {
    rotulo,
    filho,
    pid: filho.pid,
    saida,
    fechado,
    arquivoDeLog,
    terminou: () => terminou,
    texto: () => Buffer.concat(pedacos).toString("utf8"),
    fecharLog: () => new Promise((resolve) => log.end(resolve)),
  };
}

/**
 * Encerra o processo E os filhos dele. No Windows `kill()` mata só o primeiro
 * elo — `taskkill /T` leva a árvore (esbuild, tsx, Chromium) junto.
 */
export async function encerrarArvore(processo, { espera = 15000 } = {}) {
  // Processo que já saiu não é alvo: o PID dele pode ter ido para outro programa.
  if (!processo?.pid || processo.terminou?.()) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(processo.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  } else {
    try {
      process.kill(-processo.pid, "SIGKILL");
    } catch {
      // já tinha saído
    }
  }
  await comPrazo(processo.saida, espera);
}

export function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === "EPERM";
  }
}

/** Espera o endereço responder 2xx; lança se o processo sair antes ou o tempo acabar. */
export async function esperarPronto(url, processo, { timeout = 120_000, intervalo = 500 } = {}) {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    const terminou = processo.terminou();
    if (terminou) {
      throw new Error(
        `${processo.rotulo} saiu antes de ficar pronto (exit ${terminou.codigo ?? terminou.sinal ?? terminou.erro}) — log: ${processo.arquivoDeLog}`,
      );
    }
    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (resposta.ok) return;
    } catch {
      // ainda subindo
    }
    await esperar(intervalo);
  }
  throw new Error(`${processo.rotulo} não respondeu em ${Math.round(timeout / 1000)} s (${url}) — log: ${processo.arquivoDeLog}`);
}

/**
 * Uma suíte, com o veredito do runner: aprovada só com exit 0, dentro do prazo
 * e sem "SEM MASSA" — suíte que não achou massa não avaliou nada.
 */
export async function rodarSuite({ suite, arquivo, env, pastaDeLogs, timeoutMs = 20 * 60_000 }) {
  const inicio = Date.now();
  const processo = iniciarProcesso({
    rotulo: suite,
    comando: process.execPath,
    args: [arquivo ?? path.join(PASTA_SUITES, `${suite}.mjs`)],
    cwd: RAIZ,
    env,
    arquivoDeLog: path.join(pastaDeLogs, `${suite}.log`),
    capturar: true,
  });
  const estourou = (await comPrazo(processo.fechado, timeoutMs)) === PRAZO;
  if (estourou) await encerrarArvore(processo);
  const terminou = processo.terminou() ?? (await processo.saida);
  await processo.fecharLog();
  const saida = processo.texto();
  const semMassa = /SEM MASSA/i.test(saida);
  return {
    suite,
    ok: !estourou && terminou.codigo === 0 && !terminou.erro && !semMassa,
    codigo: terminou.codigo,
    estourou,
    semMassa,
    duracaoMs: Date.now() - inicio,
    falhas: saida
      .split(/\r?\n/)
      .filter((linha) => /^\s*FALHA\b/.test(linha))
      .map((linha) => linha.trim()),
    arquivoDeLog: processo.arquivoDeLog,
  };
}

/** Respostas 5xx que a API registrou ("request completed" do Fastify). */
export function contarRespostas5xx(arquivoDeLog) {
  if (!existsSync(arquivoDeLog)) return 0;
  return readFileSync(arquivoDeLog, "utf8")
    .split(/\r?\n/)
    .filter((linha) => /request completed/.test(linha) && /"statusCode":5\d\d/.test(linha)).length;
}

export function duracao(ms) {
  const segundos = Math.round(ms / 1000);
  const minutos = Math.floor(segundos / 60);
  return minutos > 0 ? `${minutos}m ${String(segundos % 60).padStart(2, "0")}s` : `${segundos}s`;
}

/* ─────────────────────────── execução ─────────────────────────── */

function ambienteBase(env) {
  const base = { ...env };
  // `PORT` venceria `API_PORT` na API (é a porta de quem hospeda).
  delete base.PORT;
  return base;
}

async function criarUsuarioDaExecucao({ runId, clone, envBase, pasta }) {
  const email = `e2e.${runId.toLowerCase()}@veridi.local`;
  const senha = randomBytes(24).toString("base64url");
  const processo = iniciarProcesso({
    rotulo: "usuário ADMIN da execução",
    // `pnpm` é `.cmd` no Windows: shell com comando fixo, e a senha só no ambiente.
    comando: process.platform === "win32" ? "pnpm exec tsx scripts/bootstrap-admin.ts" : "pnpm",
    args: process.platform === "win32" ? [] : ["exec", "tsx", "scripts/bootstrap-admin.ts"],
    shell: process.platform === "win32",
    cwd: RAIZ,
    env: {
      ...envBase,
      DATABASE_URL: clone.url,
      VERIDI_ADMIN_NAME: `E2E ${runId}`,
      VERIDI_ADMIN_EMAIL: email,
      VERIDI_ADMIN_PASSWORD: senha,
    },
    arquivoDeLog: path.join(pasta, "usuario.log"),
  });
  const terminou = await processo.saida;
  await processo.fecharLog();
  if (terminou.codigo !== 0) {
    throw new Error(
      `usuário ADMIN da execução não foi criado (exit ${terminou.codigo ?? terminou.erro}) — log: ${processo.arquivoDeLog}`,
    );
  }
  return { email, senha };
}

function iniciarApi({ clone, origens, envBase, pasta }) {
  const tsx = pathToFileURL(createRequire(path.join(PASTA_API, "package.json")).resolve("tsx")).href;
  return iniciarProcesso({
    rotulo: "API E2E",
    comando: process.execPath,
    args: ["--import", tsx, "src/main.ts"],
    cwd: PASTA_API,
    env: {
      ...envBase,
      NODE_ENV: "development",
      DATABASE_URL: clone.url,
      API_HOST: "127.0.0.1",
      API_PORT: new URL(origens.api).port,
      WEB_ORIGIN: origens.web,
      VERIDI_UPLOAD_DIR: path.join(pasta, "uploads"),
    },
    arquivoDeLog: path.join(pasta, "api.log"),
  });
}

function iniciarWeb({ origens, envBase, pasta }) {
  const vite = path.join(
    path.dirname(createRequire(path.join(PASTA_WEB, "package.json")).resolve("vite/package.json")),
    "bin",
    "vite.js",
  );
  return iniciarProcesso({
    rotulo: "Web E2E",
    comando: process.execPath,
    args: [vite, "--host", "127.0.0.1", "--port", new URL(origens.web).port, "--strictPort"],
    cwd: PASTA_WEB,
    // Variável do processo vence a `.env` no Vite: a Web fala com a API do clone.
    env: { ...envBase, VITE_API_URL: origens.api },
    arquivoDeLog: path.join(pasta, "web.log"),
  });
}

/** A primeira carga dispara a otimização de dependências do Vite — melhor antes da primeira suíte. */
async function aquecerWeb(origemWeb) {
  const { chromium } = await import("@playwright/test");
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    await pagina.goto(`${origemWeb}/`, { waitUntil: "networkidle", timeout: 120_000 });
  } finally {
    await navegador.close();
  }
}

async function main() {
  const inicio = Date.now();
  const opcoes = lerOpcoes(process.argv.slice(2));
  const suites = suitesDaExecucao(opcoes);
  const origens = origensDaExecucao(opcoes);
  const runId = novoRunId();
  const alvos = prepararAlvos(process.env, { runId, clone: opcoes.clone ?? undefined });
  const { template, clone, postgres } = alvos;

  const atual = estadoDasMigrations(PASTA_MIGRATIONS);
  conferirBaselineAtual(lerBaseline(arquivoDaBaseline(template.banco)), atual, { banco: template.banco });
  for (const [papel, origem] of Object.entries(origens)) {
    const porta = Number(new URL(origem).port);
    if (await portaOcupada(porta)) {
      throw new Error(`RECUSADO: porta ${porta} (${papel}) ocupada — escolha outra com --${papel}-porta. Nada foi executado.`);
    }
  }

  const pasta = path.join(DADOS, "e2e-runs", clone.banco, runId);
  console.log(`e2e:run · runId ${runId}`);
  console.log(`  template ${descreverDestino(template.url)} · ${atual.total} migrations, última ${atual.ultima}`);
  console.log(`  clone    ${descreverDestino(clone.url)} · ${alvos.reuso ? "REUSO, sujo de execução anterior" : "novo"}`);
  console.log(`  API ${origens.api} · Web ${origens.web} · ${suites.length} suíte(s)`);
  console.log(`  logs     ${pasta}`);

  const estado = { api: null, web: null, cloneEmUso: false };
  let limpeza = null;
  const limpar = async () => {
    if (limpeza) return limpeza;
    const pendencias = [];
    for (const papel of ["web", "api"]) {
      const processo = estado[papel];
      if (!processo) continue;
      await encerrarArvore(processo);
      await processo.fecharLog();
      const porta = Number(new URL(origens[papel]).port);
      if (await portaOcupada(porta)) pendencias.push(`porta ${porta} (${papel}) ocupada depois de encerrar o PID ${processo.pid}`);
    }
    let cloneRemovido = false;
    if (estado.cloneEmUso && !opcoes.manterClone) {
      try {
        await removerClone(alvos);
        cloneRemovido = true;
      } catch (erro) {
        pendencias.push(`clone ${clone.banco} não foi removido: ${erro.message}`);
      }
    }
    rmSync(path.join(pasta, "uploads"), { recursive: true, force: true });
    // Na hora: se a subida falhou, o resumo nem chega a ser impresso.
    for (const pendencia of pendencias) console.log(`PENDÊNCIA: ${pendencia}`);
    limpeza = { pendencias, cloneRemovido };
    return limpeza;
  };
  process.once("SIGINT", () => {
    console.log("\ninterrompido — encerrando API, Web e o clone…");
    void limpar().finally(() => process.exit(130));
  });

  const resultados = [];
  try {
    if (alvos.reuso) {
      if (!(await bancoExiste(postgres, clone.banco))) {
        throw new Error(`RECUSADO: o clone ${clone.banco} não existe — sem --clone o runner cria um novo.`);
      }
    } else {
      if (!(await bancoExiste(postgres, template.banco))) {
        throw new Error(`RECUSADO: ${template.banco} não existe. Rode: pnpm e2e:baseline:rebuild`);
      }
      if (await bancoExiste(postgres, clone.banco)) throw new Error(`RECUSADO: ${clone.banco} já existe.`);
      await conferirTemplateSemConexao((banco) => contarConexoes(postgres, banco), template.banco);
      await criarClone(alvos);
    }
    estado.cloneEmUso = true;
    conferirMigrationsDoBanco(await migrationsDoBanco(clone.url), nomesDasMigrations(PASTA_MIGRATIONS), {
      banco: clone.banco,
    });

    const envBase = ambienteBase(process.env);
    const usuario = await criarUsuarioDaExecucao({ runId, clone, envBase, pasta });
    console.log(`  usuário  ADMIN ${usuario.email} (senha sorteada, só no ambiente das suítes)`);

    estado.api = iniciarApi({ clone, origens, envBase, pasta });
    await esperarPronto(`${origens.api}/health`, estado.api);
    estado.web = iniciarWeb({ origens, envBase, pasta });
    await esperarPronto(`${origens.web}/`, estado.web);
    await aquecerWeb(origens.web).catch((erro) => {
      console.log(`  aviso: aquecimento da Web falhou (${String(erro.message).split("\n")[0]})`);
    });
    console.log(`  API e Web prontas em ${duracao(Date.now() - inicio)}\n`);

    const envDaSuite = {
      ...envBase,
      E2E_API: origens.api,
      E2E_WEB: origens.web,
      E2E_EMAIL: usuario.email,
      E2E_PASSWORD: usuario.senha,
    };
    // Suíte não fala com banco: nem a URL ela recebe.
    delete envDaSuite.DATABASE_URL;
    delete envDaSuite.TEST_DATABASE_URL;

    for (const suite of suites) {
      const resultado = await rodarSuite({
        suite,
        env: envDaSuite,
        pastaDeLogs: pasta,
        timeoutMs: opcoes.timeoutSuiteMin * 60_000,
      });
      resultados.push(resultado);
      const motivo = resultado.estourou
        ? " · estourou o tempo"
        : resultado.semMassa
          ? " · SEM MASSA"
          : resultado.codigo !== 0
            ? ` · exit ${resultado.codigo}`
            : "";
      console.log(`  ${resultado.ok ? "ok   " : "FALHA"} ${suite} (${duracao(resultado.duracaoMs)})${motivo}`);
      for (const falha of resultado.falhas.slice(0, 5)) console.log(`         ${falha}`);
      if (!resultado.ok) console.log(`         log: ${resultado.arquivoDeLog}`);
    }
  } finally {
    await limpar();
  }

  const reprovadas = resultados.filter((resultado) => !resultado.ok);
  const semMassa = resultados.filter((resultado) => resultado.semMassa).length;
  const tempoDasSuites = resultados.reduce((soma, resultado) => soma + resultado.duracaoMs, 0);
  console.log("\n──────────────────────────────────────────────");
  console.log(
    `${resultados.length} suíte(s) · ${resultados.length - reprovadas.length} ok · ${reprovadas.length} falha(s) · ` +
      `SEM MASSA ${semMassa} · 5xx no log da API ${contarRespostas5xx(path.join(pasta, "api.log"))}`,
  );
  console.log(`duração ${duracao(Date.now() - inicio)} (suítes ${duracao(tempoDasSuites)})`);
  console.log(
    limpeza.cloneRemovido
      ? `clone ${clone.banco} removido`
      : `clone ${clone.banco} MANTIDO — reusar com --clone=${clone.banco}`,
  );
  if (limpeza.pendencias.length > 0) console.log(`${limpeza.pendencias.length} pendência(s) de limpeza — acima`);
  if (reprovadas.length > 0 || limpeza.pendencias.length > 0) process.exitCode = 1;
}

/** Rodando como comando — e não importado pelo teste. */
function executadoDireto() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (executadoDireto()) {
  main().catch((erro) => {
    console.error(`\nFALHOU: ${erro.message}`);
    process.exitCode = 1;
  });
}
