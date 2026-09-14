import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exigirBancoLocal } from "../local-db-guard.mjs";
import {
  MARCADOR,
  REFERENCIA_DAS_MIGRATIONS,
  comBanco,
  conciliarReferencia,
  conferir,
  migrar,
  restaurar,
} from "./restore-json-backup-check.mjs";

/**
 * BACKUP-RESTORE-CHECK-01 — a prova de restauração sobre um banco que as
 * migrations NÃO deixam vazio.
 *
 * Na carga inicial de PROD o backup oficial saiu certo e a prova quebrou: a
 * migration `reference_units_of_measure` grava as 6 unidades num banco novo, o
 * arquivo traz as mesmas 6, e o `createMany` colidia na chave. Estes testes
 * provam a regra que substituiu a colisão — referência idêntica conta como
 * restaurada, referência diferente é drift e reprova — e que nada mais
 * afrouxou: duplicidade em model comum continua reprovando, nenhuma carga
 * ignora colisão, contagem e sequences seguem conferidas.
 *
 * Tudo roda em bancos descartáveis do servidor LOCAL da faixa, com o marcador
 * do script no nome, removidos no fim. O backup é o de verdade:
 * `prod-backup-json.mjs` sobre uma base construída pelas migrations, com dado
 * de negócio por cima.
 */

const RAIZ = process.cwd();
const SCRIPT = join(RAIZ, "scripts", "maintenance", "restore-json-backup-check.mjs");
const BACKUP_JSON = join(RAIZ, "scripts", "maintenance", "prod-backup-json.mjs");

// O mesmo client que o script carrega (mesma resolução, mesma instância).
const requireFromApi = createRequire(join(RAIZ, "apps", "api", "package.json"));
const { PrismaClient } = requireFromApi("@prisma/client");

type Linha = Record<string, unknown>;
interface Backup {
  totalDeLinhas: number;
  contagens: Record<string, number>;
  sequences: Array<{ sequencename: string; last_value: string | null }>;
  dados: Record<string, Linha[]>;
}

const local = exigirBancoLocal();
const carimbo = Date.now();
const admin = new PrismaClient({ datasources: { db: { url: comBanco(local.url, "postgres") } } });
const criados: string[] = [];
const clientes: Array<{ $disconnect(): Promise<void> }> = [];

let pasta = "";
let arquivo = "";
let backup: Backup;
// Banco só migrado, sem carga: os casos que reprovam antes de gravar dividem este.
let limpo: any;

/** Banco novo construído só pelas migrations — o ponto de partida de toda restauração. */
async function bancoMigrado(sufixo: string) {
  const nome = `${MARCADOR}test_${carimbo}_${sufixo}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
  criados.push(nome);
  const url = comBanco(local.url, nome);
  migrar(url);
  const db = new PrismaClient({ datasources: { db: { url } } });
  clientes.push(db);
  return { db, url };
}

const copia = (): Backup => structuredClone(backup);
const unidade = (b: Backup, code: string) => b.dados.UnitOfMeasure.find((u) => u.code === code) as Linha;

async function existeBanco(nome: string) {
  const linhas = (await admin.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS existe`,
    nome,
  )) as Array<{ existe: boolean }>;
  return linhas[0]?.existe === true;
}

/** Roda o comando de verdade e devolve saída + código, sem lançar. */
function rodarScript(args: string[]) {
  try {
    const saida = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, saida };
  } catch (erro) {
    const e = erro as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, saida: [e.stdout, e.stderr].filter(Boolean).join("\n") };
  }
}

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "veridi-restore-check-"));

  // A base de onde o backup sai: migrations + negócio que depende da referência.
  const { db: origem, url } = await bancoMigrado("origem");
  const codigo = async (sequence: string, prefixo: string) => {
    const [linha] = (await origem.$queryRawUnsafe(`SELECT nextval('${sequence}')::int AS n`)) as Array<{ n: number }>;
    return `${prefixo}-${String(linha!.n).padStart(6, "0")}`;
  };
  const ana = await origem.user.create({
    data: { code: await codigo("user_code_seq", "USR"), name: "Ana", email: "ana@restore.local", passwordHash: "sintetico" },
  });
  await origem.user.create({
    data: { code: await codigo("user_code_seq", "USR"), name: "Bruno", email: "bruno@restore.local", passwordHash: "sintetico" },
  });
  await origem.userPreference.create({ data: { userId: ana.id, ui: { tema: "claro" } } });
  await origem.supplier.create({ data: { code: await codigo("supplier_code_seq", "FOR"), legalName: "Fornecedor Sintético Ltda" } });
  await origem.item.create({
    data: { type: "RAW_MATERIAL", code: await codigo("item_code_raw_material_seq", "MP"), name: "Ácido ascórbico", unitCode: "g" },
  });
  await origem.$disconnect();

  arquivo = join(pasta, "backup.json");
  execFileSync(process.execPath, [BACKUP_JSON, arquivo], {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  backup = JSON.parse(readFileSync(arquivo, "utf8"));

  limpo = (await bancoMigrado("limpo")).db;
}, 120_000);

afterAll(async () => {
  for (const cliente of clientes) await cliente.$disconnect();
  for (const nome of criados) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
  await admin.$disconnect();
  if (pasta) rmSync(pasta, { recursive: true, force: true });
}, 60_000);

describe("A. referência gravada pelas migrations × backup da base migrada", () => {
  it("o banco que as migrations constroem já tem as 6 unidades — e nenhuma outra linha", async () => {
    const codes = (await limpo.unitOfMeasure.findMany()).map((u: Linha) => u.code);
    expect(codes.sort()).toEqual(["mg", "g", "kg", "un", "mL", "L"].sort());
    expect([...REFERENCIA_DAS_MIGRATIONS.keys()]).toEqual(["UnitOfMeasure"]);

    // Conciliar contra um arquivo só com as unidades: qualquer outro model com
    // linha no banco recém-migrado reprovaria aqui.
    const soReferencia = { ...copia(), dados: { UnitOfMeasure: backup.dados.UnitOfMeasure } };
    const restauradas = await conciliarReferencia(limpo, soReferencia);
    expect([...restauradas.keys()]).toEqual(["UnitOfMeasure"]);
    expect(restauradas.get("UnitOfMeasure")!.size).toBe(6);
  });

  it("o backup da base migrada traz as mesmas 6 unidades, campo a campo", async () => {
    const porCode = (linhas: Linha[]) =>
      [...linhas].sort((a, b) => String(a.code).localeCompare(String(b.code))).map((l) => JSON.stringify(l));
    const migradas = JSON.parse(JSON.stringify(await limpo.unitOfMeasure.findMany())) as Linha[];
    expect(backup.contagens.UnitOfMeasure).toBe(6);
    expect(porCode(backup.dados.UnitOfMeasure)).toEqual(porCode(migradas));
  });

  it("restaura: as 6 contam como restauradas sem INSERT, o resto carrega sem ignorar colisão, contagem e sequences batem", async () => {
    const { db } = await bancoMigrado("restaura");
    const cargas: Array<{ model: string; args: { data: unknown[]; skipDuplicates?: boolean } }> = [];
    const espiado = db.$extends({
      query: {
        $allModels: {
          async createMany({ model, args, query }: { model: string; args: any; query: (a: unknown) => Promise<unknown> }) {
            cargas.push({ model, args });
            return query(args);
          },
        },
      },
    });

    const carga = await restaurar(espiado, backup);

    // Referência satisfeita pelo estado migrado: nenhum INSERT de unidade.
    expect(carga.deReferencia).toBe(6);
    expect(cargas.map((c) => c.model)).not.toContain("UnitOfMeasure");
    // Model comum: toda carga sem `skipDuplicates`, uma por model com linha.
    expect(cargas.filter((c) => "skipDuplicates" in c.args)).toEqual([]);
    expect(cargas.map((c) => c.model).sort()).toEqual(["Item", "Supplier", "User", "UserPreference"]);

    // Contagens: carregadas + referência = arquivo, e a conferência lê o mesmo total.
    expect(carga.carregadas).toBe(backup.totalDeLinhas - 6);
    expect(cargas.reduce((total, c) => total + c.args.data.length, 0)).toBe(carga.carregadas);
    const { divergencias, linhas } = await conferir(db, backup);
    expect(divergencias).toEqual([]);
    expect(linhas).toBe(backup.totalDeLinhas);
    expect(await db.unitOfMeasure.count()).toBe(6);

    // Sequences: mesmo ponto do arquivo, e a próxima identidade continua dali.
    const lidas = (await db.$queryRawUnsafe(
      `SELECT sequencename, last_value::text AS last_value FROM pg_sequences WHERE schemaname = 'public'`,
    )) as Array<{ sequencename: string; last_value: string | null }>;
    const comoMapa = (s: Array<{ sequencename: string; last_value: string | null }>) =>
      Object.fromEntries(s.map((x) => [x.sequencename, x.last_value === null ? null : String(x.last_value)]));
    expect(comoMapa(lidas)).toEqual(comoMapa(backup.sequences));
    expect(comoMapa(backup.sequences).user_code_seq).toBe("2");
    const [proxima] = (await db.$queryRawUnsafe(`SELECT nextval('user_code_seq')::text AS n`)) as Array<{ n: string }>;
    expect(proxima!.n).toBe("3");
  });
});

describe("B. drift e duplicidade continuam reprovando", () => {
  it("unidade com o mesmo code e rótulo diferente reprova nomeando model, chave e campo — sem carregar nada", async () => {
    const divergente = copia();
    unidade(divergente, "g").label = "Grama (renomeada)";
    await expect(restaurar(limpo, divergente)).rejects.toThrow(
      /UnitOfMeasure "g": mesma chave, conteúdo diferente — label arquivo "Grama \(renomeada\)" · migrado "Grama"/,
    );
    expect(await limpo.user.count()).toBe(0);
    expect(await limpo.item.count()).toBe(0);
  });

  it("fator de conversão diferente no mesmo code também é drift", async () => {
    const divergente = copia();
    unidade(divergente, "kg").toBaseFactor = "1";
    await expect(restaurar(limpo, divergente)).rejects.toThrow(
      /UnitOfMeasure "kg": mesma chave, conteúdo diferente — toBaseFactor arquivo "1" · migrado "1000"/,
    );
    expect(await limpo.user.count()).toBe(0);
  });

  it("unidade que a migration grava e o arquivo não tem reprova", async () => {
    const semMl = copia();
    semMl.dados.UnitOfMeasure = semMl.dados.UnitOfMeasure.filter((u) => u.code !== "mL");
    semMl.contagens.UnitOfMeasure -= 1;
    semMl.totalDeLinhas -= 1;
    await expect(restaurar(limpo, semMl)).rejects.toThrow(
      /UnitOfMeasure "mL": 20260925093012_reference_units_of_measure grava, o arquivo não tem/,
    );
    expect(await limpo.user.count()).toBe(0);
  });

  it("unidade repetida no arquivo reprova em vez de sumir na conciliação", async () => {
    const repetida = copia();
    repetida.dados.UnitOfMeasure.push({ ...unidade(repetida, "g") });
    await expect(restaurar(limpo, repetida)).rejects.toThrow(/UnitOfMeasure "g": chave repetida no arquivo/);
    expect(await limpo.user.count()).toBe(0);
  });

  it("duplicidade em model comum continua reprovando na chave", async () => {
    const { db } = await bancoMigrado("duplicidade");
    const duplicado = copia();
    duplicado.dados.User.push({ ...duplicado.dados.User[0]! });
    duplicado.contagens.User += 1;
    duplicado.totalDeLinhas += 1;
    await expect(restaurar(db, duplicado)).rejects.toThrow(/Unique constraint failed/);
  });

  it("model fora da lista com linha logo depois das migrations reprova: referência nova precisa ser declarada", async () => {
    const { db } = await bancoMigrado("nao_declarado");
    await db.supplier.create({ data: { code: "FOR-999999", legalName: "Gravado por migration hipotética" } });
    await expect(conciliarReferencia(db, backup)).rejects.toThrow(
      /Supplier: 1 linha\(s\) no banco recém-migrado, e o model não está em REFERENCIA_DAS_MIGRATIONS/,
    );
  });
});

describe("C. o comando, de ponta a ponta", () => {
  it("RESTAURÁVEL: YES separando carga e referência na contagem, e o banco descartável some", async () => {
    const { code, saida } = rodarScript([arquivo]);
    expect(code, saida).toBe(0);
    expect(saida).toContain(
      `RESTAURÁVEL: YES — ${Object.keys(backup.contagens).length} models, ${backup.totalDeLinhas} linhas idênticas ao arquivo ` +
        `(${backup.totalDeLinhas - 6} carregadas + 6 de referência gravadas pelas migrations), ` +
        `${backup.sequences.length} sequences no mesmo ponto`,
    );
    const temporario = saida.match(/banco descartável: (veridi_restore_check_\d+)/)?.[1];
    expect(temporario).toBeDefined();
    expect(await existeBanco(temporario!)).toBe(false);
  });

  it("unidade divergente: RESTAURÁVEL: NO com o drift nomeado, e o banco descartável some", async () => {
    const divergente = copia();
    unidade(divergente, "g").label = "Grama (renomeada)";
    const arquivoDivergente = join(pasta, "backup-divergente.json");
    writeFileSync(arquivoDivergente, JSON.stringify(divergente), "utf8");

    const { code, saida } = rodarScript([arquivoDivergente]);
    expect(code, saida).toBe(1);
    expect(saida).toContain("RESTAURÁVEL: NO");
    expect(saida).toContain(`UnitOfMeasure "g": mesma chave, conteúdo diferente — label`);
    const temporario = saida.match(/banco descartável: (veridi_restore_check_\d+)/)?.[1];
    expect(temporario).toBeDefined();
    expect(await existeBanco(temporario!)).toBe(false);
  });
});
