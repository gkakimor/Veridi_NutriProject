import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { descreverDestino, exigirBancoLocal } from "../local-db-guard.mjs";

/**
 * Prova que um backup lógico JSON (`prod-backup-json.mjs`) RESTAURA.
 *
 *   pnpm exec dotenv -e .env -- node scripts/maintenance/restore-json-backup-check.mjs <backup.json> [--manter]
 *
 * Backup que nunca foi restaurado é uma hipótese. Este script cria um banco
 * descartável no servidor LOCAL, aplica as migrations do repositório, carrega
 * TODAS as linhas do arquivo com as FKs ligadas, reposiciona as sequences e
 * confere o resultado contra o arquivo — contagem por model e, depois, linha a
 * linha. Sem `--manter`, derruba o banco no fim, inclusive quando algo falha
 * no meio.
 *
 * Nunca toca o Railway: a `DATABASE_URL` passa por `exigirBancoLocal`, e o
 * banco temporário leva um marcador no nome.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = path.join(RAIZ, "apps", "api");
const MARCADOR = "veridi_restore_check_";

const requireFromApi = createRequire(path.join(API, "package.json"));
const { PrismaClient, Prisma } = requireFromApi("@prisma/client");

const ARQUIVO = process.argv[2];
const MANTER = process.argv.includes("--manter");

const propDoModel = (nome) => nome.charAt(0).toLowerCase() + nome.slice(1);
const models = Prisma.dmmf.datamodel.models;
const modelPorNome = new Map(models.map((m) => [m.name, m]));
const tabelaDoModel = new Map(models.map((m) => [m.name, m.dbName ?? m.name]));
const modelDaTabela = new Map([...tabelaDoModel].map(([m, t]) => [t, m]));

/** Coluna do banco -> campo do client, por model (`@map` quando existir). */
function campoDaColuna(model, coluna) {
  const campo = modelPorNome
    .get(model)
    .fields.find((f) => f.kind === "scalar" && (f.dbName ?? f.name) === coluna);
  if (!campo) throw new Error(`coluna ${coluna} sem campo em ${model}`);
  return campo.name;
}

/** O mesmo `replacer` do backup: BigInt vira texto, Decimal e Date já sabem se escrever. */
const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);

function comBanco(url, nome) {
  const u = new URL(url);
  u.pathname = `/${nome}`;
  return u.toString();
}

function migrar(databaseUrl) {
  return execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // `pnpm` no Windows é um .cmd: sem shell falha com ENOENT.
    shell: process.platform === "win32",
  });
}

/** Componentes fortemente conexos (Tarjan): quem se referencia em anel. */
function componentes(nos, arestas) {
  const indice = new Map();
  const menor = new Map();
  const pilha = [];
  const naPilha = new Set();
  const componenteDe = new Map();
  let contador = 0;
  let proximo = 0;

  const visitar = (v) => {
    indice.set(v, contador);
    menor.set(v, contador);
    contador += 1;
    pilha.push(v);
    naPilha.add(v);
    for (const w of arestas.get(v) ?? []) {
      if (!indice.has(w)) {
        visitar(w);
        menor.set(v, Math.min(menor.get(v), menor.get(w)));
      } else if (naPilha.has(w)) {
        menor.set(v, Math.min(menor.get(v), indice.get(w)));
      }
    }
    if (menor.get(v) !== indice.get(v)) return;
    let w;
    do {
      w = pilha.pop();
      naPilha.delete(w);
      componenteDe.set(w, proximo);
    } while (w !== v);
    proximo += 1;
  };

  for (const v of [...nos].sort()) if (!indice.has(v)) visitar(v);
  return componenteDe;
}

/**
 * Como carregar com as FKs ligadas.
 *
 * Na CARGA toda FK conta — inclusive as SET NULL: a ação de DELETE não muda o
 * fato de que a linha filha exige o pai existindo. E o schema tem anéis
 * (Produto aponta para a versão ativa da Formulação, que aponta para o
 * Produto; Pedido e Orçamento; Lote e OP). Nenhum anel se fecha só com
 * colunas obrigatórias — então a coluna ANULÁVEL que fecha o anel entra
 * vazia na carga e é preenchida depois, quando as duas pontas já existem.
 * Auto-referência anulável recebe o mesmo tratamento.
 */
async function planoDeCarga(db) {
  const fks = await db.$queryRawUnsafe(`
    SELECT src.relname AS src,
           tgt.relname AS tgt,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS colunas,
           (SELECT bool_and(NOT a.attnotnull)
              FROM unnest(c.conkey) AS k(num)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS anulavel
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `);
  const tabelas = new Set(tabelaDoModel.values());
  const relevantes = fks.filter((f) => tabelas.has(f.src) && tabelas.has(f.tgt));

  const todas = new Map([...tabelas].map((t) => [t, new Set()]));
  for (const f of relevantes) if (f.src !== f.tgt) todas.get(f.src).add(f.tgt);
  const componenteDe = componentes(tabelas, todas);

  const adiadas = new Map(); // model -> [{ campo, coluna }]
  const dependeDe = new Map([...tabelas].map((t) => [t, new Set()]));
  for (const f of relevantes) {
    const noAnel = f.src === f.tgt || componenteDe.get(f.src) === componenteDe.get(f.tgt);
    if (noAnel && f.anulavel) {
      const model = modelDaTabela.get(f.src);
      const lista = adiadas.get(model) ?? [];
      for (const coluna of f.colunas) lista.push({ campo: campoDaColuna(model, coluna), coluna });
      adiadas.set(model, lista);
      continue;
    }
    if (f.src === f.tgt) throw new Error(`auto-referência obrigatória em ${f.src}: carga não sabe ordenar`);
    dependeDe.get(f.src).add(f.tgt);
  }

  const ordem = [];
  const feitas = new Set();
  let restantes = [...tabelas].sort();
  while (restantes.length) {
    const prontas = restantes.filter((t) => [...dependeDe.get(t)].every((p) => feitas.has(p)));
    if (!prontas.length) throw new Error(`anel só de colunas obrigatórias: ${restantes.join(", ")}`);
    for (const t of prontas) {
      ordem.push(t);
      feitas.add(t);
    }
    restantes = restantes.filter((t) => !feitas.has(t));
  }
  return { ordem: ordem.map((t) => modelDaTabela.get(t)), adiadas };
}

/**
 * Devolve a linha do arquivo ao tipo que o client espera. O JSON perdeu três
 * distinções: BigInt virou texto, Bytes virou `{type, data}` e JSON nulo não
 * se distingue de coluna nula — que o Prisma exige como `DbNull`.
 */
function paraCarga(model, linha, adiados) {
  const saida = { ...linha };
  for (const campo of modelPorNome.get(model).fields) {
    if (campo.kind !== "scalar" || !(campo.name in saida)) continue;
    const valor = saida[campo.name];
    if (campo.type === "Json" && valor === null) saida[campo.name] = Prisma.DbNull;
    else if (campo.type === "BigInt" && valor !== null) saida[campo.name] = BigInt(valor);
    else if (campo.type === "Bytes" && valor?.type === "Buffer") saida[campo.name] = Buffer.from(valor.data);
  }
  for (const { campo } of adiados) saida[campo] = null;
  return saida;
}

/** Forma comparável de um conjunto de linhas: cada linha como texto, em ordem estável. */
const assinatura = (linhas) =>
  linhas
    .map((l) => JSON.stringify(l, replacer))
    .sort()
    .join("\n");

async function main() {
  if (!ARQUIVO || ARQUIVO.startsWith("-")) {
    throw new Error("uso: node scripts/maintenance/restore-json-backup-check.mjs <backup.json> [--manter]");
  }
  const backup = JSON.parse(readFileSync(ARQUIVO, "utf8"));
  if (backup.mecanismo !== "prisma-logical-json" || !backup.dados || !backup.contagens) {
    throw new Error("o arquivo não é um backup de prod-backup-json.mjs");
  }
  if (backup.falhas?.length) throw new Error(`o backup registrou ${backup.falhas.length} falha(s) de leitura`);

  const noSchema = models.map((m) => m.name).sort();
  const noArquivo = Object.keys(backup.contagens).sort();
  const faltam = noSchema.filter((m) => !noArquivo.includes(m));
  const sobram = noArquivo.filter((m) => !noSchema.includes(m));
  if (faltam.length || sobram.length) {
    throw new Error(`schema e arquivo divergem — faltam: ${faltam.join(", ") || "—"}; sobram: ${sobram.join(", ") || "—"}`);
  }

  const { url, alvo } = exigirBancoLocal();
  const temporario = `${MARCADOR}${Date.now()}`;
  const tempUrl = comBanco(url, temporario);
  if (!descreverDestino(tempUrl).endsWith(temporario) || !temporario.startsWith(MARCADOR)) {
    throw new Error("banco temporário sem marcador — abortado antes de criar qualquer coisa");
  }

  console.log(`arquivo: ${path.relative(RAIZ, path.resolve(ARQUIVO))}`);
  console.log(`  gerado em ${backup.geradoEm} · ${backup.totalDeLinhas} linhas · ${noArquivo.length} models`);
  console.log(`servidor local: ${alvo} · banco descartável: ${temporario}`);

  const admin = new PrismaClient({ datasources: { db: { url: comBanco(url, "postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${temporario}"`);
  const db = new PrismaClient({ datasources: { db: { url: tempUrl } } });

  let falha = null;
  try {
    console.log("— prisma migrate deploy (do zero)");
    const saida = migrar(tempUrl);
    if (!/All migrations have been successfully applied/.test(saida)) {
      throw new Error(`migrate deploy não terminou limpo:\n${saida.slice(-1500)}`);
    }

    const { ordem, adiadas } = await planoDeCarga(db);
    const colunasAdiadas = [...adiadas].flatMap(([m, l]) => l.map((a) => `${m}.${a.campo}`));
    console.log(`— carga com FKs ligadas: ${ordem.length} models, pais antes das filhas`);
    console.log(`  anéis quebrados por coluna anulável, preenchida depois: ${colunasAdiadas.join(", ") || "nenhum"}`);

    let carregadas = 0;
    for (const model of ordem) {
      const linhas = backup.dados[model] ?? [];
      if (!linhas.length) continue;
      const adiados = adiadas.get(model) ?? [];
      // O Prisma parte o INSERT sozinho quando passa do limite de parâmetros.
      await db[propDoModel(model)].createMany({ data: linhas.map((l) => paraCarga(model, l, adiados)) });
      carregadas += linhas.length;
    }

    // Segunda passada: fecha os anéis. SQL cru de propósito — o `update` do
    // client reescreveria `updatedAt`, e a restauração deixaria de ser fiel.
    let religadas = 0;
    for (const [model, adiados] of adiadas) {
      const tabela = tabelaDoModel.get(model);
      const chave = modelPorNome.get(model).fields.find((f) => f.isId);
      if (!chave) throw new Error(`${model} sem chave simples: não sei religar ${adiados.map((a) => a.campo).join(", ")}`);
      const colunaChave = chave.dbName ?? chave.name;
      for (const linha of backup.dados[model] ?? []) {
        const preenchidos = adiados.filter(({ campo }) => linha[campo] !== null && linha[campo] !== undefined);
        if (!preenchidos.length) continue;
        const sets = preenchidos.map(({ coluna }, i) => `"${coluna}" = $${i + 1}`).join(", ");
        await db.$executeRawUnsafe(
          `UPDATE "${tabela}" SET ${sets} WHERE "${colunaChave}" = $${preenchidos.length + 1}`,
          ...preenchidos.map(({ campo }) => linha[campo]),
          linha[chave.name],
        );
        religadas += 1;
      }
    }
    console.log(`  ${carregadas} linhas carregadas · ${religadas} religada(s) na segunda passada`);

    // Só sequence que as migrations criaram: o nome do arquivo nunca vira SQL solto.
    const existentes = new Set(
      (await db.$queryRawUnsafe(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`)).map(
        (s) => s.sequencename,
      ),
    );
    let reposicionadas = 0;
    for (const s of backup.sequences ?? []) {
      if (!existentes.has(s.sequencename)) throw new Error(`sequence ${s.sequencename} não existe no schema`);
      if (s.last_value === null || s.last_value === undefined) continue;
      await db.$executeRawUnsafe(`SELECT setval('"public"."${s.sequencename}"', ${BigInt(s.last_value)}, true)`);
      reposicionadas += 1;
    }
    console.log(`  ${reposicionadas} sequence(s) reposicionada(s)`);

    console.log("— conferência contra o arquivo");
    const divergencias = [];
    for (const model of noArquivo) {
      const lidas = await db[propDoModel(model)].findMany();
      if (lidas.length !== backup.contagens[model]) {
        divergencias.push(`${model}: arquivo ${backup.contagens[model]} · restaurado ${lidas.length}`);
      } else if (assinatura(lidas) !== assinatura(backup.dados[model] ?? [])) {
        divergencias.push(`${model}: mesma contagem, conteúdo diferente`);
      }
    }
    const depois = await db.$queryRawUnsafe(
      `SELECT sequencename, last_value::text AS last_value FROM pg_sequences WHERE schemaname = 'public'`,
    );
    for (const s of backup.sequences ?? []) {
      const r = depois.find((x) => x.sequencename === s.sequencename);
      if (String(r?.last_value ?? null) !== String(s.last_value ?? null)) {
        divergencias.push(`sequence ${s.sequencename}: arquivo ${s.last_value} · restaurada ${r?.last_value}`);
      }
    }
    if (divergencias.length) {
      throw new Error(`restauração diverge do arquivo:\n  ${divergencias.join("\n  ")}`);
    }
    console.log(
      `\nRESTAURÁVEL: YES — ${noArquivo.length} models, ${carregadas} linhas idênticas ao arquivo, ` +
        `${(backup.sequences ?? []).length} sequences no mesmo ponto`,
    );
  } catch (erro) {
    falha = erro;
  } finally {
    await db.$disconnect();
    if (MANTER && !falha) {
      console.log(`— banco mantido (--manter): ${temporario}`);
    } else {
      try {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${temporario}" WITH (FORCE)`);
        console.log(`— banco descartável removido: ${temporario}`);
      } catch (erroDrop) {
        console.error(`AVISO: não removeu ${temporario}: ${erroDrop.message}`);
      }
    }
    await admin.$disconnect();
  }

  if (falha) {
    console.error(`\nRESTAURÁVEL: NO — ${falha.stderr ? falha.stderr.slice(-2000) : falha.message}`);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
