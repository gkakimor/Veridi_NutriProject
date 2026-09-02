import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient, Prisma } = require("@prisma/client");

/**
 * Backup LÓGICO completo do banco de produção, em JSON.
 *
 * Existe porque o `pg_dump` local é 16.15 e o servidor do Railway é 18.6 —
 * o pg_dump se recusa a dumpar servidor mais novo que ele. Este é o
 * mecanismo alternativo: lê TODAS as tabelas do schema via Prisma e grava
 * um único arquivo JSON com linhas + contagens + sequences.
 *
 *   railway run --service Postgres node scripts/maintenance/prod-backup-json.mjs <destino.json>
 *
 * Somente leitura. Não escreve nada no banco.
 */

const destino = process.argv[2];
if (!destino) throw new Error("Uso: node prod-backup-json.mjs <arquivo-destino.json>");

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Nome do model -> propriedade do client (Prisma minúscula a 1ª letra). */
const propDoModel = (nome) => nome.charAt(0).toLowerCase() + nome.slice(1);

/** BigInt não tem serialização JSON nativa; Decimal e Date já têm toJSON. */
const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);

async function main() {
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
  console.log(`Models no schema: ${models.length}`);

  const dados = {};
  const contagens = {};
  const falhas = [];

  for (const model of models) {
    const prop = propDoModel(model);
    const delegate = prisma[prop];
    if (!delegate?.findMany) {
      falhas.push(`${model}: delegate '${prop}' inexistente no client`);
      continue;
    }
    try {
      const linhas = await delegate.findMany();
      dados[model] = linhas;
      contagens[model] = linhas.length;
      console.log(`  ${model}: ${linhas.length}`);
    } catch (e) {
      falhas.push(`${model}: ${e.message}`);
      console.error(`  ${model}: ERRO ${e.message}`);
    }
  }

  // Sequences entram no backup para o estado ficar reconstituível — mesmo
  // que a limpeza tenha ordem explícita de NUNCA resetá-las.
  const sequences = await prisma.$queryRawUnsafe(
    `SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
  );

  const total = Object.values(contagens).reduce((a, b) => a + b, 0);

  const payload = {
    geradoEm: new Date().toISOString(),
    mecanismo: "prisma-logical-json",
    motivo: "pg_dump 16.15 recusa servidor 18.6; sem cliente 18 nem docker na máquina",
    totalDeLinhas: total,
    contagens,
    sequences,
    falhas,
    dados,
  };

  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(payload, replacer, 2), "utf8");

  console.log(`\nTotal de linhas: ${total}`);
  console.log(`Falhas: ${falhas.length}`);
  for (const f of falhas) console.log(`  ! ${f}`);
  console.log(`Arquivo: ${destino}`);
}

main()
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
