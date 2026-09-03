import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exigirBancoLocal } from "./local-db-guard.mjs";

/**
 * Backup, recriação e seed mínimo do banco LOCAL.
 *
 *   pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar
 *
 * Sem `--confirmar` só descreve o que faria. A ordem é sempre a mesma e não
 * se inverte: **primeiro o backup, e só depois o drop**. Se o dump falhar ou
 * sair vazio, nada é apagado — dado sem cópia é dado que se perde de vez.
 *
 * Todo destino passa por `exigirBancoLocal`, que recusa qualquer coisa que
 * não seja comprovadamente localhost. A checagem é feita AQUI e de novo antes
 * do drop: entre uma linha e outra o ambiente não muda sozinho, mas a
 * repetição custa nada e é a única barreira entre um engano e a base do
 * cliente.
 *
 * O que o seed recria é só INFRAESTRUTURA — unidades de medida e o usuário de
 * acesso. Cliente, item, produto, projeto e todo o resto nascem pela
 * interface, que é o ponto desta rodada de validação.
 */

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIRMAR = process.argv.includes("--confirmar");
const PG_BIN = "C:/Program Files/PostgreSQL/16/bin";

function passo(texto) {
  console.log(`\n— ${texto}`);
}

function rodar(comando, args, opcoes = {}) {
  return execFileSync(comando, args, {
    cwd: RAIZ,
    stdio: opcoes.silencioso ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    /*
     * `shell: true` porque no Windows `pnpm` e um `.cmd`, e `execFileSync` sem
     * shell procura um executavel com esse nome exato e falha com ENOENT — o
     * que ja aconteceu DEPOIS do drop, deixando a base recriada e vazia de
     * schema. As chamadas ao Postgres passam caminho absoluto e nao dependem
     * disto; quem precisa e o pnpm.
     */
    shell: true,
    ...opcoes,
  });
}

const { url, alvo, banco } = exigirBancoLocal();
console.log(`Destino: ${alvo}`);

const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const pastaBackup = path.join(RAIZ, "handoff", "backups");
const arquivoBackup = path.join(pastaBackup, `local-pre-e2e-${carimbo}.dump`);

if (!CONFIRMAR) {
  console.log(`
Simulação. Com --confirmar, nesta ordem:

  1. backup de ${banco} em handoff/backups/local-pre-e2e-<carimbo>.dump
  2. verificação do arquivo (existe e não está vazio) — falhou, para aqui
  3. DROP e CREATE de ${banco}
  4. prisma migrate deploy
  5. seed-infra: unidades e usuário, e nada de negócio

Nada foi alterado.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Backup — antes de tudo, e condição para o resto.
// ---------------------------------------------------------------------------

passo("Backup da base local");
fs.mkdirSync(pastaBackup, { recursive: true });

// Formato custom (-Fc): comprimido e restaurável seletivamente por
// `pg_restore`. A senha vai por `PGPASSWORD` para não aparecer na linha de
// comando, que é visível na lista de processos da máquina.
const u = new URL(url);
const ambientePg = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(u.password || ""),
};

rodar(path.join(PG_BIN, "pg_dump.exe"), [
  "-h", u.hostname,
  "-p", String(u.port || 5432),
  "-U", decodeURIComponent(u.username || "postgres"),
  "-d", banco,
  "-Fc",
  "-f", arquivoBackup,
], { env: ambientePg });

passo("Verificação do backup");
if (!fs.existsSync(arquivoBackup)) {
  console.error("RECUSADO: o arquivo de backup não foi criado. Nada foi apagado.");
  process.exit(1);
}
const tamanho = fs.statSync(arquivoBackup).size;
if (tamanho < 1024) {
  console.error(
    `RECUSADO: backup com ${tamanho} bytes — pequeno demais para ser real. Nada foi apagado.`,
  );
  process.exit(1);
}

// Conteúdo, não só tamanho: um dump truncado tem bytes e não tem tabelas.
const listagem = rodar(
  path.join(PG_BIN, "pg_restore.exe"),
  ["--list", arquivoBackup],
  { silencioso: true, env: ambientePg },
);
const tabelas = (listagem.match(/TABLE DATA/g) ?? []).length;
if (tabelas === 0) {
  console.error("RECUSADO: o backup não contém dados de tabela. Nada foi apagado.");
  process.exit(1);
}
console.log(`ok  ${(tamanho / 1024 / 1024).toFixed(1)} MB, ${tabelas} tabelas com dados`);
console.log(`    ${path.relative(RAIZ, arquivoBackup)}`);

// ---------------------------------------------------------------------------
// 2. Recriação — a partir daqui é destrutivo.
// ---------------------------------------------------------------------------

// Segunda checagem, deliberadamente redundante.
exigirBancoLocal();

passo("Recriando o banco");
const psql = path.join(PG_BIN, "psql.exe");
const conexaoAdmin = [
  "-h", u.hostname,
  "-p", String(u.port || 5432),
  "-U", decodeURIComponent(u.username || "postgres"),
  "-d", "postgres",
  "-v", "ON_ERROR_STOP=1",
];

// Sessões abertas impedem o DROP; derrubá-las é seguro num banco local.
rodar(psql, [...conexaoAdmin, "-c",
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${banco}' AND pid <> pg_backend_pid();`,
], { silencioso: true, env: ambientePg });
rodar(psql, [...conexaoAdmin, "-c", `DROP DATABASE IF EXISTS "${banco}";`], { env: ambientePg });
rodar(psql, [...conexaoAdmin, "-c", `CREATE DATABASE "${banco}";`], { env: ambientePg });

passo("Aplicando migrations");
// `migrate deploy`, nunca `db push`: o push infere o schema e não deixa
// histórico, então a base local deixaria de ser reproduzível a partir do
// repositório — que é justamente o que esta rodada precisa garantir.
rodar("pnpm", ["--filter", "@veridi/api", "exec", "prisma", "migrate", "deploy"]);

passo("Seed de infraestrutura");
// `seed-infra`, não `seed`: o segundo popula um ambiente de demonstração com
// cliente, item, fornecedor e compra — dado de negócio que esta rodada exige
// que nasça pela interface.
rodar("pnpm", ["--filter", "@veridi/api", "exec", "tsx", "prisma/seed-infra.ts"]);

console.log(`
Pronto. Base local recriada e vazia de dado de negócio.
Backup em ${path.relative(RAIZ, arquivoBackup)}.`);
