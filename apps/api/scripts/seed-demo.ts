import { PrismaClient } from "@prisma/client";
import type { User } from "@prisma/client";
import { addProjectProduct } from "../src/modules/projects/project-products.service.js";
import { approveProject, createProject } from "../src/modules/projects/projects.service.js";
import {
  acceptQuoteVersion,
  addQuoteLine,
  createQuoteVersion,
  sendQuoteVersion,
  updateQuoteLine,
} from "../src/modules/projects/quotes.service.js";
import { createSample } from "../src/modules/samples/samples.service.js";
import {
  activateFormulationVersion,
  createFirstFormulationVersion,
  updateFormulationVersion,
} from "../src/modules/formulations/formulations.service.js";
import { nextSequenceCode } from "../src/lib/sequence-code.js";

/**
 * `pnpm db:demo` — cenário fictício de demonstração.
 *
 * Existe para alguém abrir o sistema e entender o produto sem cadastrar trinta
 * registros antes. Conta uma história inteira: uma linha de suplementos com
 * três sabores, proposta em duas versões, aprovação parcial e o material que o
 * cliente envia.
 *
 * Três coisas que o script NUNCA faz:
 *
 * 1. usar corpus real — tudo aqui é inventado, e os nomes deixam isso óbvio;
 * 2. apagar o que não é dele — a limpeza casa pelo prefixo `DEMO` e pelos
 *    códigos externos `DEMO-*`, nunca por "tudo do banco";
 * 3. burlar regra de domínio — passa pelos mesmos serviços da aplicação, então
 *    o que aparece na tela é o que o sistema realmente produz.
 *
 * Reexecutar é seguro: encontra o que já existe e continua de onde parou.
 */

const prisma = new PrismaClient();

const DEMO_TAG = "DEMO";
const DEMO_EXTERNAL = "DEMO-LINHA-PERFORMANCE";

const CUSTOMER_NAME = "NutriViva Suplementos Ltda (DEMO)";
const PROJECT_NAME = "DEMO — Linha Performance 2026";

const PRODUCTS = [
  { name: "DEMO Pré-Treino Frutas Vermelhas 300g", quantity: "1000", price: "38.9000" },
  { name: "DEMO Pré-Treino Limão 300g", quantity: "1000", price: "38.9000" },
  { name: "DEMO Pré-Treino Laranja 300g", quantity: "500", price: "41.5000" },
];

async function demoActor(): Promise<User> {
  const existing = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (existing) return existing;
  throw new Error(
    "Nenhum ADMIN ativo no banco. Rode `pnpm user:bootstrap-admin` antes de gerar o cenário DEMO.",
  );
}

async function ensureUnits(): Promise<void> {
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
}

async function ensureCustomer() {
  const existing = await prisma.customer.findFirst({ where: { legalName: CUSTOMER_NAME } });
  if (existing) return existing;

  const code = await nextSequenceCode(prisma, "customer_code_seq", "CLI");
  return prisma.customer.create({
    data: {
      code,
      legalName: CUSTOMER_NAME,
      tradeName: "NutriViva",
      // CNPJ claramente fictício — nunca um número real de terceiro.
      cnpj: "00000000000191",
      city: "Campinas",
      state: "SP",
      active: true,
    },
  });
}

async function ensureSuppliers() {
  const rows = [
    { legalName: "Insumos Andorinha Ltda (DEMO)", tradeName: "Andorinha" },
    { legalName: "Embalagens Ipê S.A. (DEMO)", tradeName: "Ipê" },
  ];
  const suppliers = [];
  for (const row of rows) {
    const existing = await prisma.supplier.findFirst({ where: { legalName: row.legalName } });
    if (existing) {
      suppliers.push(existing);
      continue;
    }
    const code = await nextSequenceCode(prisma, "supplier_code_seq", "FOR");
    suppliers.push(
      await prisma.supplier.create({
        data: { code, legalName: row.legalName, tradeName: row.tradeName, active: true },
      }),
    );
  }
  return suppliers;
}

async function ensureItem(input: {
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING";
  unitCode: string;
}) {
  const existing = await prisma.item.findFirst({ where: { name: input.name } });
  if (existing) return existing;

  const prefix = input.type === "RAW_MATERIAL" ? "MP" : "ME";
  const sequence = input.type === "RAW_MATERIAL" ? "item_code_raw_material_seq" : "item_code_packaging_seq";
  const code = await nextSequenceCode(prisma, sequence, prefix);

  return prisma.item.create({
    data: {
      code,
      name: input.name,
      type: input.type,
      unitCode: input.unitCode,
      controlsLot: true,
      controlsExpiry: input.type === "RAW_MATERIAL",
      requiresQualityRelease: input.type === "RAW_MATERIAL",
      active: true,
    },
  });
}

async function main(): Promise<void> {
  const actor = await demoActor();
  await ensureUnits();

  const customer = await ensureCustomer();
  const suppliers = await ensureSuppliers();

  // Matérias-primas, embalagem e o material que o CLIENTE envia — este
  // último é o diferencial que o sistema segrega do estoque da Veridi.
  const cafeina = await ensureItem({
    name: "DEMO Cafeína anidra",
    type: "RAW_MATERIAL",
    unitCode: "kg",
  });
  const betaAlanina = await ensureItem({
    name: "DEMO Beta-alanina",
    type: "RAW_MATERIAL",
    unitCode: "kg",
  });
  const aromaCliente = await ensureItem({
    name: "DEMO Aroma natural (fornecido pelo cliente)",
    type: "RAW_MATERIAL",
    unitCode: "kg",
  });
  const pote = await ensureItem({ name: "DEMO Pote 300g", type: "PACKAGING", unitCode: "un" });

  let project = await prisma.project.findFirst({ where: { name: PROJECT_NAME } });
  if (!project) {
    const created = await createProject(
      {
        customerId: customer.id,
        name: PROJECT_NAME,
        concept: "Performance",
        channel: "Distribuidora",
        externalCode: DEMO_EXTERNAL,
      },
      actor,
    );
    project = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
  }

  // Três sabores da mesma linha: um projeto, três produtos.
  const links = [];
  for (const spec of PRODUCTS) {
    const existing = await prisma.projectProduct.findFirst({
      where: { projectId: project.id, product: { name: spec.name } },
      include: { product: true },
    });
    if (existing) {
      links.push({ id: existing.id, productId: existing.productId, spec });
      continue;
    }
    const created = await addProjectProduct(
      project.id,
      { operation: "create", name: spec.name, finishedUnitCode: "un" },
      actor,
    );
    links.push({ id: created.id, productId: created.productId, spec });
  }

  // Fórmula do primeiro sabor: matéria-prima da Veridi, material do cliente e
  // embalagem — as três responsabilidades que o sistema distingue.
  const first = links[0]!;
  const hasFormula = await prisma.formulationVersion.findFirst({
    where: { productId: first.productId },
  });
  if (!hasFormula) {
    const version = await createFirstFormulationVersion(first.productId, actor);
    await updateFormulationVersion(
      version.id,
      {
        basisQuantity: "1",
        calculationMode: "FIXED_BASIS",
        components: [
          {
            itemId: betaAlanina.id,
            quantity: "0.15",
            uomCode: "kg",
            basis: "PER_BASIS",
            supplyResponsibility: "VERIDI",
          },
          {
            itemId: cafeina.id,
            quantity: "0.02",
            uomCode: "kg",
            basis: "PER_BASIS",
            supplyResponsibility: "VERIDI",
          },
          {
            itemId: aromaCliente.id,
            quantity: "0.01",
            uomCode: "kg",
            basis: "PER_BASIS",
            // Material do cliente: entra na fórmula, não vira estoque da Veridi.
            supplyResponsibility: "CUSTOMER",
          },
          {
            itemId: pote.id,
            quantity: "1",
            uomCode: "un",
            basis: "PER_UNIT",
            supplyResponsibility: "VERIDI",
          },
        ],
      } as never,
      actor,
    );
    await activateFormulationVersion(version.id);
  }

  // Amostras por produto: com vários sabores, qual foi testado importa.
  const samples = await prisma.projectSample.count({ where: { projectId: project.id } });
  if (samples === 0) {
    await createSample(
      project.id,
      { projectProductId: first.id, description: "DEMO T1 — ajuste de doçura" },
      actor,
    );
    await createSample(
      project.id,
      { projectProductId: links[1]!.id, description: "DEMO T2 — ajuste de acidez" },
      actor,
    );
  }

  // Duas versões de proposta: a primeira com os três sabores, a segunda —
  // aceita — com dois. É o que faz o terceiro ficar fora do escopo.
  const existingQuotes = await prisma.quoteVersion.count({ where: { projectId: project.id } });
  if (existingQuotes === 0) {
    const v1 = await createQuoteVersion(project.id, actor);
    for (const link of links) {
      const withLine = await addQuoteLine(v1.id, { projectProductId: link.id });
      const created = withLine.lines[withLine.lines.length - 1]!;
      await updateQuoteLine(created.id, {
        quotedQuantity: link.spec.quantity,
        uomCode: "un",
        unitPrice: link.spec.price,
      });
    }
    await sendQuoteVersion(v1.id, actor, { confirmIncompleteCost: true });

    const v2 = await createQuoteVersion(project.id, actor);
    const keep = new Set([links[0]!.productId, links[1]!.productId]);
    const v2Lines = await prisma.quoteLine.findMany({ where: { quoteVersionId: v2.id } });
    for (const line of v2Lines) {
      if (!keep.has(line.productId)) await prisma.quoteLine.delete({ where: { id: line.id } });
    }
    await sendQuoteVersion(v2.id, actor, { confirmIncompleteCost: true });
    await acceptQuoteVersion(v2.id, actor);

    if (project.status !== "APPROVED") {
      await approveProject(project.id, {}, actor);
    }
  }

  const summary = await prisma.projectProduct.findMany({
    where: { projectId: project.id },
    include: { product: true },
    orderBy: { sequence: "asc" },
  });

  console.log(`\nCenário DEMO pronto — cliente ${customer.code} · ${customer.tradeName}`);
  console.log(`Projeto ${project.code} · ${project.name}`);
  for (const link of summary) {
    console.log(
      `  ${link.product.code}  ${link.product.name.padEnd(42)} ${link.product.lifecycle.padEnd(12)} ${link.status}`,
    );
  }
  console.log(`Fornecedores: ${suppliers.map((supplier) => supplier.code).join(", ")}`);
  console.log("\nReexecutar é seguro: o script reaproveita o que já existe.\n");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
