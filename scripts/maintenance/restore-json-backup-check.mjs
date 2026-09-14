import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { descreverDestino, exigirBancoLocal } from "../local-db-guard.mjs";
import { PRISMA_BIN } from "../prisma-bin.mjs";

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
 * O banco que as migrations constroem não nasce vazio: o dado de referência
 * que elas gravam (`REFERENCIA_DAS_MIGRATIONS`) já está lá antes da carga, e é
 * conciliado com o arquivo linha a linha — idêntico conta como restaurado;
 * diferente é drift e reprova (`conciliarReferencia`).
 *
 * Nunca toca o Railway: a `DATABASE_URL` passa por `exigirBancoLocal`, e o
 * banco temporário leva um marcador no nome.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = path.join(RAIZ, "apps", "api");
export const MARCADOR = "veridi_restore_check_";

const requireFromApi = createRequire(path.join(API, "package.json"));
const { PrismaClient, Prisma } = requireFromApi("@prisma/client");

const propDoModel = (nome) => nome.charAt(0).toLowerCase() + nome.slice(1);
const models = Prisma.dmmf.datamodel.models;
const modelPorNome = new Map(models.map((m) => [m.name, m]));
const tabelaDoModel = new Map(models.map((m) => [m.name, m.dbName ?? m.name]));
const modelDaTabela = new Map([...tabelaDoModel].map(([m, t]) => [t, m]));

/**
 * Dado de referência que a cadeia de migrations grava num banco VAZIO: model e
 * a migration que o grava. É a única exceção à carga linha a linha — por
 * model, declarada aqui.
 *
 * Unidade de medida é tabela de referência sem tela, e produção nunca roda
 * seed: a migration cria o catálogo. Todo backup de base construída por essa
 * cadeia traz as mesmas linhas, e inseri-las de novo colide na chave.
 *
 * As outras migrations com `INSERT` são backfill (`INSERT … SELECT` de linhas
 * que já existiam) e não gravam nada num banco vazio. Migration nova que
 * grave dado num banco vazio reprova esta prova até entrar aqui.
 */
export const REFERENCIA_DAS_MIGRATIONS = new Map([
  ["UnitOfMeasure", "20260925093012_reference_units_of_measure"],
]);

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

/** Um valor como o arquivo o guarda — a forma em que banco e arquivo se comparam. */
const comoNoArquivo = (valor) => JSON.stringify(valor, replacer);

export function comBanco(url, nome) {
  const u = new URL(url);
  u.pathname = `/${nome}`;
  return u.toString();
}

/** `prisma migrate deploy` pelo Node, sem shell no caminho (ver `prisma-bin.mjs`). */
export function migrar(databaseUrl) {
  return execFileSync(process.execPath, [PRISMA_BIN, "migrate", "deploy"], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

/** A chave primária simples do model: é por ela que a linha do banco encontra a do arquivo. */
function chaveDoModel(model) {
  const chave = modelPorNome.get(model).fields.find((f) => f.isId);
  if (!chave) throw new Error(`${model} sem chave simples: não sei achar a mesma linha no banco e no arquivo`);
  return chave;
}

/**
 * O arquivo é um backup íntegro de `prod-backup-json.mjs` para ESTE schema?
 * Devolve os models do arquivo, em ordem.
 */
export function validarArquivo(backup) {
  if (backup?.mecanismo !== "prisma-logical-json" || !backup.dados || !backup.contagens) {
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

  // A prova conta linhas: contagem declarada, linhas presentes e total precisam
  // ser o mesmo número antes de servirem de gabarito.
  const incoerentes = noArquivo.filter((m) => (backup.dados[m] ?? []).length !== backup.contagens[m]);
  const soma = noArquivo.reduce((total, m) => total + backup.contagens[m], 0);
  if (incoerentes.length || soma !== backup.totalDeLinhas) {
    throw new Error(
      `arquivo incoerente — linhas ≠ contagem em: ${incoerentes.join(", ") || "—"}; ` +
        `totalDeLinhas ${backup.totalDeLinhas} · soma das contagens ${soma}`,
    );
  }
  return noArquivo;
}

/**
 * Concilia o banco recém-migrado com o arquivo ANTES de carregar qualquer linha.
 *
 * Ignorar colisão de chave na carga inteira esconderia duplicidade, corrupção
 * e backup incoerente em qualquer tabela; apagar o que a migration gravou e
 * carregar o arquivo por cima esconderia drift entre a cadeia e a base de onde
 * o backup saiu. A regra, linha a linha, em cada model de
 * `REFERENCIA_DAS_MIGRATIONS`:
 *
 * - a linha que a migration gravou está no arquivo, mesma chave e TODOS os
 *   campos iguais: já está restaurada, e não é inserida de novo;
 * - mesma chave com algum campo diferente, linha que a migration grava e o
 *   arquivo não tem, ou chave repetida no arquivo: drift — reprova;
 * - linha do arquivo que a migration não grava: segue para a carga normal.
 *
 * Qualquer outro model com linha logo depois das migrations também reprova: é
 * dado de referência novo, e só entra na regra declarado na lista.
 *
 * Devolve, por model de referência, as chaves já restauradas.
 */
export async function conciliarReferencia(db, backup) {
  const divergencias = [];
  const restauradas = new Map();

  for (const { name: model, fields } of models) {
    const delegate = db[propDoModel(model)];
    const migration = REFERENCIA_DAS_MIGRATIONS.get(model);
    if (!migration) {
      const existentes = await delegate.count();
      if (existentes) {
        divergencias.push(`${model}: ${existentes} linha(s) no banco recém-migrado, e o model não está em REFERENCIA_DAS_MIGRATIONS`);
      }
      continue;
    }

    const chave = chaveDoModel(model).name;
    const doArquivo = new Map();
    for (const linha of backup.dados[model] ?? []) {
      const id = comoNoArquivo(linha[chave]);
      if (doArquivo.has(id)) divergencias.push(`${model} ${id}: chave repetida no arquivo`);
      doArquivo.set(id, linha);
    }

    const campos = fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name);
    const iguais = new Set();
    for (const migrada of await delegate.findMany()) {
      const id = comoNoArquivo(migrada[chave]);
      const linha = doArquivo.get(id);
      if (!linha) {
        divergencias.push(`${model} ${id}: ${migration} grava, o arquivo não tem`);
        continue;
      }
      const diferentes = campos.filter((c) => comoNoArquivo(migrada[c]) !== comoNoArquivo(linha[c]));
      if (diferentes.length) {
        const detalhe = diferentes.map((c) => `${c} arquivo ${comoNoArquivo(linha[c])} · migrado ${comoNoArquivo(migrada[c])}`);
        divergencias.push(`${model} ${id}: mesma chave, conteúdo diferente — ${detalhe.join("; ")}`);
        continue;
      }
      iguais.add(id);
    }
    restauradas.set(model, iguais);
  }

  if (divergencias.length) {
    throw new Error(`banco migrado e arquivo divergem antes da carga — drift, nada foi carregado:\n  ${divergencias.join("\n  ")}`);
  }
  return restauradas;
}

/**
 * Carrega o arquivo no banco recém-migrado: concilia o dado de referência,
 * insere o resto com as FKs ligadas — sem ignorar colisão nenhuma —, fecha os
 * anéis e reposiciona as sequences. `log` recebe o andamento.
 */
export async function restaurar(db, backup, log = () => {}) {
  const restauradas = await conciliarReferencia(db, backup);
  const jaRestaurada = (model, linha) => {
    const chaves = restauradas.get(model);
    return chaves !== undefined && chaves.has(comoNoArquivo(linha[chaveDoModel(model).name]));
  };
  const deReferencia = [...restauradas.values()].reduce((total, chaves) => total + chaves.size, 0);
  log(
    `  ${deReferencia} linha(s) já gravadas pelas migrations e idênticas ao arquivo ` +
      `(${[...REFERENCIA_DAS_MIGRATIONS.keys()].join(", ")}): não são inseridas de novo`,
  );

  const { ordem, adiadas } = await planoDeCarga(db);
  const colunasAdiadas = [...adiadas].flatMap(([m, l]) => l.map((a) => `${m}.${a.campo}`));
  log(`— carga com FKs ligadas: ${ordem.length} models, pais antes das filhas`);
  log(`  anéis quebrados por coluna anulável, preenchida depois: ${colunasAdiadas.join(", ") || "nenhum"}`);

  let carregadas = 0;
  for (const model of ordem) {
    const linhas = (backup.dados[model] ?? []).filter((l) => !jaRestaurada(model, l));
    if (!linhas.length) continue;
    const adiados = adiadas.get(model) ?? [];
    // O Prisma parte o INSERT sozinho quando passa do limite de parâmetros.
    // Colisão de chave aqui é defeito do arquivo, e reprova a prova.
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
      if (jaRestaurada(model, linha)) continue;
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
  log(`  ${carregadas} linhas carregadas · ${religadas} religada(s) na segunda passada`);

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
  log(`  ${reposicionadas} sequence(s) reposicionada(s)`);

  return { carregadas, deReferencia, religadas, reposicionadas };
}

/**
 * Confere o banco restaurado contra o arquivo: contagem por model, linha a
 * linha e sequences. O dado de referência entra na conta como qualquer linha
 * — está no banco e no arquivo. Devolve as divergências e o total de linhas lidas.
 */
export async function conferir(db, backup) {
  const divergencias = [];
  let linhas = 0;
  for (const model of Object.keys(backup.contagens).sort()) {
    const lidas = await db[propDoModel(model)].findMany();
    linhas += lidas.length;
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
  for (const r of depois) {
    if (!(backup.sequences ?? []).some((s) => s.sequencename === r.sequencename)) {
      divergencias.push(`sequence ${r.sequencename}: existe no banco migrado, não no arquivo`);
    }
  }
  return { divergencias, linhas };
}

async function main(argv) {
  const [arquivo] = argv;
  const manter = argv.includes("--manter");
  if (!arquivo || arquivo.startsWith("-")) {
    throw new Error("uso: node scripts/maintenance/restore-json-backup-check.mjs <backup.json> [--manter]");
  }
  const backup = JSON.parse(readFileSync(arquivo, "utf8"));
  const noArquivo = validarArquivo(backup);

  const { url, alvo } = exigirBancoLocal();
  const temporario = `${MARCADOR}${Date.now()}`;
  const tempUrl = comBanco(url, temporario);
  if (!descreverDestino(tempUrl).endsWith(temporario) || !temporario.startsWith(MARCADOR)) {
    throw new Error("banco temporário sem marcador — abortado antes de criar qualquer coisa");
  }

  console.log(`arquivo: ${path.relative(RAIZ, path.resolve(arquivo))}`);
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

    console.log("— dado de referência das migrations × arquivo");
    const carga = await restaurar(db, backup, (linha) => console.log(linha));

    console.log("— conferência contra o arquivo");
    const { divergencias, linhas } = await conferir(db, backup);
    // A referência não conta duas vezes nem some da conta: o que se lê do banco
    // é exatamente o que se carregou mais o que as migrations já tinham gravado.
    if (carga.carregadas + carga.deReferencia !== linhas) {
      divergencias.push(`linhas: ${carga.carregadas} carregadas + ${carga.deReferencia} de referência · ${linhas} lidas`);
    }
    if (divergencias.length) {
      throw new Error(`restauração diverge do arquivo:\n  ${divergencias.join("\n  ")}`);
    }
    console.log(
      `\nRESTAURÁVEL: YES — ${noArquivo.length} models, ${linhas} linhas idênticas ao arquivo ` +
        `(${carga.carregadas} carregadas + ${carga.deReferencia} de referência gravadas pelas migrations), ` +
        `${(backup.sequences ?? []).length} sequences no mesmo ponto`,
    );
  } catch (erro) {
    falha = erro;
  } finally {
    await db.$disconnect();
    if (manter && !falha) {
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

/** Rodando como comando — e não importado pelo teste, que usa as funções sem criar banco. */
function executadoDireto() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (executadoDireto()) {
  main(process.argv.slice(2)).catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  });
}
