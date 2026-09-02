import { createRequire } from "node:module";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");

/**
 * Inventário SOMENTE LEITURA do banco de produção.
 *
 * Roda com a `DATABASE_URL` injetada pelo Railway CLI, para a credencial
 * nunca precisar ser copiada para lugar nenhum:
 *
 *   railway run --service <serviço> node scripts/maintenance/prod-inventory.mjs
 *
 * Não escreve nada. É o passo anterior a qualquer plano de limpeza — decidir
 * o que remover a partir de números de outra base seria adivinhação.
 */

/*
 * De fora do Railway a `DATABASE_URL` aponta para o host interno
 * (`postgres.railway.internal`), que só resolve dentro da rede deles. A
 * pública é a que funciona daqui — e nenhuma das duas passa pela linha de
 * comando.
 */
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Marcas de dado artificial que as auditorias e fixtures deixaram. */
const ARTIFICIAL = /VAL-LEG|teste|test|fixture|demo|auditoria|smoke|tempor|probe|prova/i;

async function main() {
  const contagens = {
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    projects: await prisma.project.count(),
    products: await prisma.product.count(),
    items: await prisma.item.count(),
    suppliers: await prisma.supplier.count(),
    supplierItems: await prisma.supplierItem.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    receipts: await prisma.receipt.count(),
    lots: await prisma.lot.count(),
    inventoryMovements: await prisma.inventoryMovement.count(),
    formulationVersions: await prisma.formulationVersion.count(),
    industrialCostVersions: await prisma.industrialCostVersion.count(),
    industrialCostCalculations: await prisma.industrialCostCalculation.count(),
    pricingVersions: await prisma.pricingVersion.count(),
    quoteVersions: await prisma.quoteVersion.count(),
    customerOrders: await prisma.customerOrder.count(),
    productionOrders: await prisma.productionOrder.count(),
    shipments: await prisma.shipment.count(),
    billings: await prisma.billing.count(),
    customerOwnedLots: await prisma.lot.count({ where: { ownerType: "CUSTOMER" } }),
    formulationTemplates: await prisma.formulationTemplate.count(),
    industrialCostTemplates: await prisma.industrialCostTemplate.count(),
    pricingPolicyTemplates: await prisma.pricingPolicyTemplate.count(),
  };

  console.log("=== CONTAGENS ===");
  for (const [k, v] of Object.entries(contagens)) console.log(`${k}: ${v}`);

  // Amostras nominais: é pelo NOME que dado de auditoria se identifica.
  const amostra = async (rotulo, rows, nome) => {
    const artificiais = rows.filter((r) => ARTIFICIAL.test(nome(r) ?? ""));
    console.log(`\n=== ${rotulo}: ${rows.length} total | ${artificiais.length} com marca artificial ===`);
    for (const r of rows.slice(0, 40)) {
      console.log(`  ${ARTIFICIAL.test(nome(r) ?? "") ? "[ARTIFICIAL]" : "[         ]"} ${nome(r)}`);
    }
    if (rows.length > 40) console.log(`  … mais ${rows.length - 40}`);
  };

  await amostra(
    "CLIENTES",
    await prisma.customer.findMany({ select: { code: true, legalName: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} — ${r.legalName}`,
  );
  await amostra(
    "USUÁRIOS",
    await prisma.user.findMany({ select: { code: true, name: true, email: true, role: true } }),
    (r) => `${r.code} — ${r.name} <${r.email}> ${r.role}`,
  );
  await amostra(
    "FORNECEDORES",
    await prisma.supplier.findMany({ select: { code: true, legalName: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} — ${r.legalName}`,
  );
  await amostra(
    "PROJETOS",
    await prisma.project.findMany({ select: { code: true, name: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} — ${r.name}`,
  );
  await amostra(
    "PRODUTOS",
    await prisma.product.findMany({ select: { code: true, name: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} — ${r.name}`,
  );
  await amostra(
    "ITENS",
    await prisma.item.findMany({ select: { code: true, name: true, type: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} [${r.type}] — ${r.name}`,
  );
  await amostra(
    "PEDIDOS",
    await prisma.customerOrder.findMany({ select: { code: true, customerName: true }, orderBy: { code: "asc" } }),
    (r) => `${r.code} — ${r.customerName ?? "?"}`,
  );

  console.log("\n=== SEQUÊNCIAS ===");
  const seqs = await prisma.$queryRawUnsafe(
    `SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
  );
  for (const s of seqs) console.log(`  ${s.sequencename}: ${s.last_value ?? "nunca usada"}`);
}

main()
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
