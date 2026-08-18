import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { getProductCmv } from "./product-cmv.service.js";
import { costForOutputQuantity, pricingVersionInclude } from "../pricing/pricing-cost.js";
import type { CostVersionForPricing } from "../pricing/pricing-cost.js";
import { getIndustrialCostCalculation } from "../industrial-cost-calculation/snapshot.service.js";

/**
 * CMV e faixa de precificação precisam responder o MESMO número.
 *
 * São duas superfícies da mesma pergunta econômica. Se um dia alguém
 * "otimizar" o CMV com uma conta própria, este teste quebra — que é
 * exatamente o ponto: existe um motor só.
 */
describe("CMV — motor único", () => {
  it("simulação do CMV e motor da precificação dão o mesmo custo para a mesma base", async () => {
    const prisma = getPrisma();

    const costVersion = (await prisma.industrialCostVersion.findFirst({
      where: { status: "ACTIVE", calculations: { some: {} } },
      include: pricingVersionInclude,
      orderBy: { versionNumber: "desc" },
    })) as CostVersionForPricing | null;
    if (!costVersion) return; // sem cenário econômico neste banco

    const saved = await prisma.industrialCostCalculation.findFirst({
      where: { industrialCostVersionId: costVersion.id },
      orderBy: { calculatedAt: "desc" },
      select: { id: true },
    });
    if (!saved) return;

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: costVersion.productId },
      include: { finishedProductItem: true },
    });
    const uom = product.finishedProductItem?.unitCode ?? costVersion.referenceOutputUomCode;
    const quantity = new Prisma.Decimal(1000);
    const referenceDate = new Date("2026-08-18T00:00:00.000Z");

    const calculation = await getIndustrialCostCalculation(saved.id);
    const direto = await costForOutputQuantity(prisma, {
      costVersion,
      calculation,
      quantity,
      quantityUomCode: uom,
    });

    const via = await getProductCmv({
      productId: product.id,
      quantity,
      referenceDate,
      includePricing: true,
    });

    expect(via.simulation).not.toBeNull();
    expect(via.simulation!.quality).toBe(direto.quality);
    expect(via.simulation!.knownSubtotal).toBe(direto.knownSubtotal.toFixed(4));
    expect(via.simulation!.totalCost).toBe(direto.total ? direto.total.toFixed(4) : null);
    expect(via.simulation!.costPerUnit).toBe(direto.perUnit ? direto.perUnit.toFixed(4) : null);
    expect(via.simulation!.batchCount).toBe(direto.batchCount.toString());
  });

  it("simular não persiste nada", async () => {
    const prisma = getPrisma();
    const product = await prisma.product.findFirst({
      where: { industrialCostVersions: { some: { status: "ACTIVE" } } },
    });
    if (!product) return;

    const antes = await prisma.industrialCostCalculation.count();
    await getProductCmv({
      productId: product.id,
      quantity: new Prisma.Decimal(777),
      referenceDate: new Date("2026-08-18T00:00:00.000Z"),
      includePricing: true,
    });
    expect(await prisma.industrialCostCalculation.count()).toBe(antes);
  });

  it("faixa vigente só casa por quantidade exata — nunca interpola", async () => {
    const prisma = getPrisma();
    const pricing = await prisma.pricingVersion.findFirst({
      where: { status: "ACTIVE", tiers: { some: {} } },
      include: { tiers: { orderBy: { quantity: "asc" } } },
    });
    if (!pricing || pricing.tiers.length < 2) return;

    const primeira = pricing.tiers[0]!.quantity;
    const segunda = pricing.tiers[1]!.quantity;
    const entre = primeira.plus(segunda).dividedBy(2);
    const referenceDate = new Date("2026-08-18T00:00:00.000Z");

    const exata = await getProductCmv({
      productId: pricing.productId,
      quantity: primeira,
      referenceDate,
      includePricing: true,
    });
    expect(exata.pricing?.tierQuantity).toBe(primeira.toString());

    if (pricing.tiers.some((tier) => tier.quantity.equals(entre))) return;
    const semFaixa = await getProductCmv({
      productId: pricing.productId,
      quantity: entre,
      referenceDate,
      includePricing: true,
    });
    // Entre duas faixas não existe preço vigente — e o CMV segue calculável.
    expect(semFaixa.pricing?.tierId).toBeNull();
    expect(semFaixa.pricing?.unitPrice).toBeNull();
    expect(semFaixa.pricing?.availableQuantities.length).toBeGreaterThan(0);
    expect(semFaixa.simulation).not.toBeNull();
  });

  it("material do cliente mantém quantidade física e fica fora da aquisição Veridi", async () => {
    const prisma = getPrisma();
    const version = await prisma.industrialCostVersion.findFirst({
      where: { status: "ACTIVE", calculations: { some: {} } },
      orderBy: { versionNumber: "desc" },
    });
    if (!version) return;

    const cmv = await getProductCmv({
      productId: version.productId,
      quantity: new Prisma.Decimal(1000),
      referenceDate: new Date("2026-08-18T00:00:00.000Z"),
      includePricing: false,
    });
    const doCliente = (cmv.simulation?.components ?? []).filter((c) => c.customerSupplied);
    for (const componente of doCliente) {
      expect(componente.requiredQuantity).not.toBeNull();
      expect(componente.totalCost).toBeNull();
      expect(componente.group).toBe("CUSTOMER_SUPPLIED");
    }
  });

  it("economia interna só chega a quem pode ver", async () => {
    const prisma = getPrisma();
    const pricing = await prisma.pricingVersion.findFirst({ where: { status: "ACTIVE" } });
    if (!pricing) return;

    const semPermissao = await getProductCmv({
      productId: pricing.productId,
      quantity: new Prisma.Decimal(1000),
      referenceDate: new Date("2026-08-18T00:00:00.000Z"),
      includePricing: false,
    });
    expect(semPermissao.pricing).toBeNull();
    // O custo industrial continua visível: quem produz precisa dele.
    expect(semPermissao.simulation).not.toBeNull();
  });
});
