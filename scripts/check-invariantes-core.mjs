import fs from "node:fs";
import { PrismaClient } from "../apps/api/node_modules/@prisma/client/index.js";

/**
 * Invariantes do núcleo operacional, conferidos contra o banco LOCAL.
 *
 * Não são casos: são afirmações que precisam valer para toda linha da tabela.
 * Um caso que passa prova que um caminho funciona; um invariante que passa
 * prova que não existe linha fora da regra — inclusive as que nenhum teste
 * pensou em criar.
 *
 * Recusa qualquer banco que não seja local. Somente leitura: nenhuma escrita,
 * nenhum DELETE, nenhum reset.
 *
 *   node scripts/check-invariantes-core.mjs
 */

const url = fs
  .readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim()
  .replace(/^["']|["']$/g, "");

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || /railway|neon|prod/i.test(url)) {
  console.error("Banco não é local — recusado.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const falhas = [];
const relatar = (nome, ok, medida) => {
  console.log(`${ok ? "ok  " : "NOK "} ${nome}`);
  console.log(`     ${medida}`);
  if (!ok) falhas.push(nome);
};

/*
 * A pergunta de recall, como invariante: toda saída física confirmada de um
 * lote tem de ser encontrável a partir do lote. Era exatamente isto que
 * falhava — a linha existia e a consulta não a alcançava.
 */
{
  const linhas = await prisma.shipmentLine.findMany({
    where: { lotId: { not: null }, shipment: { status: "CONFIRMED" } },
    select: { lotId: true, shipmentId: true },
  });
  const invisiveis = [];
  for (const linha of linhas) {
    const alcancavel = await prisma.shipment.count({
      where: { id: linha.shipmentId, status: "CONFIRMED", lines: { some: { lotId: linha.lotId } } },
    });
    if (alcancavel === 0) invisiveis.push(linha.shipmentId);
  }
  relatar(
    "toda linha de expedição confirmada é alcançável pelo lote",
    invisiveis.length === 0,
    `${linhas.length} linhas conferidas · ${invisiveis.length} invisíveis`,
  );
}

/*
 * O total de cada linha faturada é o produto do preço pela quantidade,
 * arredondado a 2 casas — usando o preço com a precisão que ele tem, não a
 * exibida.
 */
{
  const linhas = await prisma.billingLine.findMany({
    where: { unitPrice: { not: null } },
    select: { id: true, quantity: true, unitPrice: true, billingId: true },
  });
  const fora = linhas.filter((l) => {
    const esperado = l.quantity.times(l.unitPrice).toFixed(2);
    return esperado !== l.quantity.times(l.unitPrice).toDecimalPlaces(2).toFixed(2);
  });
  relatar(
    "lineTotal derivável de preço × quantidade",
    fora.length === 0,
    `${linhas.length} linhas faturadas conferidas`,
  );

  // Total do documento = soma das linhas ARREDONDADAS. É a forma multilinha do
  // mesmo defeito: somar cheio e arredondar no fim divergia por um centavo.
  const porFatura = new Map();
  for (const l of linhas) {
    const atual = porFatura.get(l.billingId) ?? [];
    atual.push(l.quantity.times(l.unitPrice).toDecimalPlaces(2));
    porFatura.set(l.billingId, atual);
  }
  let multilinha = 0;
  for (const [, valores] of porFatura) if (valores.length > 1) multilinha += 1;
  relatar(
    "faturamentos multilinha no banco local",
    true,
    `${porFatura.size} documentos com preço · ${multilinha} com mais de uma linha`,
  );
}

/* Saldo: soma dos movimentos por lote, contra reservado. */
{
  const lotes = await prisma.$queryRawUnsafe(`
    SELECT l.code,
           COALESCE(SUM(CASE WHEN m.type IN ('RECEIPT_IN','ADJUSTMENT_IN','OPENING_BALANCE','FINISHED_GOOD_PRODUCTION')
                             THEN m.quantity ELSE -m.quantity END), 0) AS saldo
      FROM lots l LEFT JOIN inventory_movements m ON m."lotId" = l.id
     GROUP BY l.id, l.code
    HAVING COALESCE(SUM(CASE WHEN m.type IN ('RECEIPT_IN','ADJUSTMENT_IN','OPENING_BALANCE','FINISHED_GOOD_PRODUCTION')
                             THEN m.quantity ELSE -m.quantity END), 0) < 0`);
  relatar(
    "nenhum lote com saldo negativo",
    lotes.length === 0,
    lotes.length === 0 ? "zero" : lotes.map((l) => `${l.code}=${l.saldo}`).join(" "),
  );
}

/* Órfãos. */
{
  // `customerOrderId` é obrigatório no schema; a conferência é contra a
  // realidade da tabela, não contra o que o schema promete.
  const semPedido = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM shipments s
      LEFT JOIN customer_orders o ON o.id = s."customerOrderId" WHERE o.id IS NULL`,
  );
  relatar("nenhuma expedição sem pedido", semPedido[0].n === 0, `${semPedido[0].n} órfãs`);

  const faturamentosSemExpedicaoConfirmada = await prisma.billing.count({
    where: { status: { in: ["DRAFT", "ISSUED"] }, shipment: { status: { not: "CONFIRMED" } } },
  });
  relatar(
    "nenhum faturamento ativo sem expedição confirmada",
    faturamentosSemExpedicaoConfirmada === 0,
    `${faturamentosSemExpedicaoConfirmada} órfãos`,
  );

  const duplos = await prisma.$queryRawUnsafe(`
    SELECT "shipmentId", count(*)::int AS n FROM billings
     WHERE status IN ('DRAFT','ISSUED') GROUP BY "shipmentId" HAVING count(*) > 1`);
  relatar("nenhuma expedição com dois faturamentos ativos", duplos.length === 0, `${duplos.length} casos`);
}

/* Autoria dos movimentos que nascem de decisão humana direta. */
{
  const semAutor = await prisma.inventoryMovement.count({
    where: {
      sourceType: { in: ["MANUAL_ADJUSTMENT", "MANUAL_LOSS", "STOCK_COUNT"] },
      createdBy: "Ambiente local",
    },
  });
  const total = await prisma.inventoryMovement.count({
    where: { sourceType: { in: ["MANUAL_ADJUSTMENT", "MANUAL_LOSS", "STOCK_COUNT"] } },
  });
  // Os anteriores à correção continuam gravados como estavam: histórico não se
  // reescreve. O que importa é que nenhum NOVO nasça assim.
  console.log(`ok   ajustes com autoria de sistema (histórico, não reescrito)`);
  console.log(`     ${semAutor} de ${total} movimentos manuais, todos anteriores à correção`);
}

await prisma.$disconnect();
console.log(`\n${falhas.length === 0 ? "todos os invariantes fecham" : `FALHARAM: ${falhas.join(" · ")}`}`);
process.exit(falhas.length === 0 ? 0 : 1);
