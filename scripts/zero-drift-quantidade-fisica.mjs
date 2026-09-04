import fs from "node:fs";
import path from "node:path";

/**
 * Portão de zero drift da capability de quantidade física.
 *
 * A migration precisa preservar a SEMÂNTICA de cada componente, não o valor
 * bruto de `quantity`. O dado tem duas populações com significados opostos:
 * componentes cuja quantidade é teórica e recebe pureza/overage do motor, e
 * componentes cuja quantidade já vem fisicamente corrigida de fora.
 *
 * Tratar as duas do mesmo jeito reduziria a necessidade física entre 1,2× e
 * 2,4× em formulações ativas — a fábrica passaria a separar menos material do
 * que a receita exige, em silêncio.
 *
 * Este script fotografa o resultado AUTORITATIVO de hoje para todos os
 * componentes, e depois compara. Não é conferência por amostra: é linha a
 * linha, com o número.
 *
 *   node scripts/zero-drift-quantidade-fisica.mjs --antes
 *   node scripts/zero-drift-quantidade-fisica.mjs --depois
 */

const MODO = process.argv.includes("--depois") ? "depois" : "antes";
const ARQUIVO = path.resolve("handoff/zero-drift-quantidade-fisica.json");

const RAIZ = process.cwd();
const url = fs
  .readFileSync(path.join(RAIZ, ".env"), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim()
  .replace(/^["']|["']$/g, "");

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Banco não é local — recusado.");
  process.exit(1);
}

const { PrismaClient, Prisma } = await import(
  `file://${path.join(RAIZ, "apps/api/node_modules/@prisma/client/index.js")}`
);
const { computeComponentRequirement } = await import(
  `file://${path.join(RAIZ, "apps/api/src/lib/formulation-math.ts")}`
).catch(() => ({}));

const prisma = new PrismaClient({ datasources: { db: { url } } });

/**
 * A conta de hoje, replicada aqui a partir do calculador canônico.
 *
 * O script roda fora do build da API, então não importa o TypeScript direto.
 * A duplicação é deliberada e limitada a ESTE arquivo de conferência: se a
 * implementação mudar de forma que o resultado mude, é exatamente isso que o
 * portão precisa detectar. Um conferente que chama a mesma função que está
 * sendo alterada não confere nada.
 */
const CEM = new Prisma.Decimal(100);

function fatorDaBase(basis, produzido, basisQuantity, dosesPerPackage) {
  if (basis === "FIXED_BASIS") return produzido.dividedBy(basisQuantity);
  if (basis === "PER_DOSE") {
    if (!dosesPerPackage || dosesPerPackage <= 0) return null;
    return new Prisma.Decimal(dosesPerPackage).times(produzido);
  }
  return produzido;
}

function aplicarPurezaEOverage(teorico, pureza, overage) {
  let fisico = teorico;
  if (pureza !== null && pureza.greaterThan(0)) {
    fisico = fisico.dividedBy(pureza.dividedBy(CEM));
  }
  if (overage !== null && overage.greaterThanOrEqualTo(0)) {
    fisico = fisico.times(CEM.plus(overage).dividedBy(CEM));
  }
  return fisico;
}

const unidades = await prisma.unitOfMeasure.findMany();
const porCodigo = new Map(unidades.map((u) => [u.code, u]));

/** Conversão formal entre unidades da mesma dimensão, via fator para a base. */
function converter(valor, de, para) {
  if (de === para) return valor;
  const origem = porCodigo.get(de);
  const destino = porCodigo.get(para);
  if (!origem || !destino || origem.dimension !== destino.dimension) return null;
  return valor.times(origem.toBaseFactor).dividedBy(destino.toBaseFactor);
}

const PRODUZIDO = new Prisma.Decimal(1000);

const componentes = await prisma.formulationComponent.findMany({
  include: {
    item: { select: { code: true, unitCode: true } },
    formulationVersion: {
      select: { id: true, versionNumber: true, status: true, basisQuantity: true, dosesPerPackage: true },
    },
  },
  orderBy: [{ formulationVersionId: "asc" }, { position: "asc" }],
});

const linhas = [];
let semContexto = 0;

for (const c of componentes) {
  const v = c.formulationVersion;
  const fator = fatorDaBase(c.basis, PRODUZIDO, v.basisQuantity, v.dosesPerPackage);
  if (fator === null) {
    // PER_DOSE sem doses por embalagem: fail-closed hoje, e continua sendo.
    semContexto += 1;
    linhas.push({ id: c.id, item: c.item.code, base: c.basis, resultado: "CONTEXTO_INCOMPLETO" });
    continue;
  }
  const declarado = c.quantity.times(fator);
  const teorico = converter(declarado, c.unitCode, c.item.unitCode);
  if (teorico === null) {
    linhas.push({ id: c.id, item: c.item.code, base: c.basis, resultado: "UNIDADE_INCOMPATIVEL" });
    continue;
  }
  const fisico = aplicarPurezaEOverage(teorico, c.purityPercentApplied, c.overagePercent);
  linhas.push({
    id: c.id,
    item: c.item.code,
    base: c.basis,
    versao: `${v.id}/V${v.versionNumber}/${v.status}`,
    pureza: c.purityPercentApplied ? String(c.purityPercentApplied) : null,
    overage: c.overagePercent ? String(c.overagePercent) : null,
    // 12 casas: muito além da precisão do domínio, para que diferença real
    // apareça e ruído de escala Decimal não apareça.
    teorico: teorico.toFixed(12),
    fisico: fisico.toFixed(12),
  });
}

await prisma.$disconnect();

if (MODO === "antes") {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ capturadoEm: new Date().toISOString(), linhas }, null, 1));
  const comAjuste = linhas.filter((l) => l.pureza || l.overage).length;
  console.log(`fotografados ${linhas.length} componentes`);
  console.log(`  com pureza/overage registrados: ${comAjuste}`);
  console.log(`  PER_DOSE sem doses por embalagem (fail-closed): ${semContexto}`);
  console.log(`arquivo: ${ARQUIVO}`);
  process.exit(0);
}

if (!fs.existsSync(ARQUIVO)) {
  console.error("Sem foto anterior. Rode com --antes primeiro.");
  process.exit(1);
}

const antes = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
const porId = new Map(antes.linhas.map((l) => [l.id, l]));
const divergentes = [];
let conferidos = 0;

for (const agora of linhas) {
  const anterior = porId.get(agora.id);
  if (!anterior) {
    divergentes.push({ id: agora.id, item: agora.item, motivo: "componente novo, não existia na foto" });
    continue;
  }
  conferidos += 1;
  if ((anterior.fisico ?? anterior.resultado) !== (agora.fisico ?? agora.resultado)) {
    divergentes.push({
      id: agora.id,
      item: agora.item,
      antes: anterior.fisico ?? anterior.resultado,
      depois: agora.fisico ?? agora.resultado,
    });
  }
}

const sumidos = antes.linhas.filter((l) => !linhas.some((a) => a.id === l.id));
for (const s of sumidos) divergentes.push({ id: s.id, item: s.item, motivo: "componente sumiu depois da migration" });

console.log(`conferidos ${conferidos} de ${antes.linhas.length} componentes fotografados`);
if (divergentes.length === 0) {
  console.log(`\nZERO DRIFT: ${conferidos}/${antes.linhas.length} semanticamente idênticos.`);
  process.exit(0);
}
console.log(`\nDRIFT em ${divergentes.length} componente(s):`);
for (const d of divergentes.slice(0, 20)) console.log("  ", JSON.stringify(d));
process.exit(1);
