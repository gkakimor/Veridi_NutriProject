import { Prisma } from "@prisma/client";
import type {
  CmvComponentDTO,
  CmvGroup,
  IndustrialCostCalculationSnapshotDTO,
  ProductCmvResponse,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { costForOutputQuantity, pricingVersionInclude } from "../pricing/pricing-cost.js";
import type { CostVersionForPricing } from "../pricing/pricing-cost.js";
import { getIndustrialCostCalculation } from "../industrial-cost-calculation/snapshot.service.js";
import { ProductCmvNotFoundError } from "./product-cmv.errors.js";

/**
 * Read model do CMV — ORQUESTRA, não calcula.
 *
 * Toda conta aqui é do motor industrial que a precificação já usa
 * (`costForOutputQuantity`): escala de material, contagem de lote, rateio de
 * recurso, política de origem de custo e qualidade do custo continuam com
 * uma implementação só. O que este serviço faz é escolher os documentos
 * certos — formulação ativa, estrutura ativa, cálculo salvo vigente — e
 * apresentar o resultado agrupado como o negócio lê.
 *
 * Nada aqui persiste: simular é leitura. Congelar continua sendo o CALC.
 */

/** Último instante do dia da data pedida. */
function fimDoDia(date: Date): Date {
  const fim = new Date(date);
  fim.setUTCHours(23, 59, 59, 999);
  return fim;
}

function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(4);
}

/** Preço vigente da faixa: o congelado na ativação, ou o manual informado. */
function precoDaFaixa(tier: { selectedPriceSnapshot: Prisma.Decimal | null; manualUnitPrice: Prisma.Decimal | null } | null): string | null {
  if (!tier) return null;
  const price = tier.selectedPriceSnapshot ?? tier.manualUnitPrice;
  return price ? price.toFixed(4) : null;
}

/** Materiais de embalagem viram grupo próprio; o resto é matéria-prima. */
function groupForMaterial(itemType: string, customerSupplied: boolean): CmvGroup {
  if (customerSupplied) return "CUSTOMER_SUPPLIED";
  return itemType === "RAW_MATERIAL" ? "FORMULA_MATERIAL" : "PACKAGING";
}

/** Linha manual da estrutura: embalagem secundária é embalagem; o resto, overhead. */
function groupForManualLine(category: string): CmvGroup {
  return category === "SECONDARY_PACKAGING" ? "PACKAGING" : "OVERHEAD";
}

export async function getProductCmv(params: {
  productId: string;
  quantity: Prisma.Decimal;
  referenceDate: Date;
  /** Economia interna (preço, faixa) só para quem negocia. */
  includePricing: boolean;
}): Promise<ProductCmvResponse> {
  const prisma = getPrisma();

  const product = await prisma.product.findUnique({
    where: { id: params.productId },
    include: { finishedProductItem: true, customer: true },
  });
  if (!product) throw new ProductCmvNotFoundError(params.productId);

  const [activeFormulation, activeCostVersion] = await Promise.all([
    prisma.formulationVersion.findFirst({
      where: { productId: product.id, status: "ACTIVE" },
      select: { id: true, versionNumber: true, outputUnitCode: true },
    }),
    prisma.industrialCostVersion.findFirst({
      where: { productId: product.id, status: "ACTIVE" },
      include: pricingVersionInclude,
      orderBy: { versionNumber: "desc" },
    }),
  ]);

  const outputUomCode =
    product.finishedProductItem?.unitCode ?? activeFormulation?.outputUnitCode ?? "un";

  const base: ProductCmvResponse = {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    customerName: product.customer?.legalName ?? null,
    outputUomCode,
    formulationVersionId: activeFormulation?.id ?? null,
    formulationVersionNumber: activeFormulation?.versionNumber ?? null,
    industrialCostVersionId: activeCostVersion?.id ?? null,
    industrialCostVersionLabel: activeCostVersion
      ? `${activeCostVersion.code} · V${activeCostVersion.versionNumber}`
      : null,
    referenceOutputQuantity: activeCostVersion?.referenceOutputQuantity.toString() ?? null,
    referenceOutputUomCode: activeCostVersion?.referenceOutputUomCode ?? null,
    calculationId: null,
    calculationCode: null,
    calculationReferenceDate: null,
    referenceDate: params.referenceDate.toISOString(),
    simulation: null,
    unavailableReason: null,
    pricing: null,
  };

  if (!activeFormulation) {
    return { ...base, unavailableReason: "Este produto ainda não tem formulação ativa." };
  }
  if (!activeCostVersion) {
    return { ...base, unavailableReason: "Este produto ainda não tem estrutura de custos ativa." };
  }

  /*
   * A base econômica é o cálculo salvo (CALC) mais recente da estrutura
   * ativa. Simular não cria cálculo: sem CALC não há base congelada, e
   * inventar uma aqui seria um segundo motor de custo.
   */
  const savedCalculation = await prisma.industrialCostCalculation.findFirst({
    where: {
      industrialCostVersionId: activeCostVersion.id,
      // A data pedida escolhe a base: um cálculo feito DEPOIS dela não
      // podia ser conhecido naquele dia. Sem isto `referenceDate` seria
      // decorativa — a resposta usaria sempre o cálculo mais recente e
      // diria estar falando de outra data.
      // O dia inteiro conta: um cálculo salvo às 10h da manhã pertence à
      // data pedida. `referenceDate` é dia de calendário, não instante.
      costReferenceDate: { lte: fimDoDia(params.referenceDate) },
    },
    orderBy: { costReferenceDate: "desc" },
    select: { id: true },
  });
  if (!savedCalculation) {
    return {
      ...base,
      unavailableReason:
        "Não há cálculo de custo salvo até esta data de referência. Salve um cálculo na estrutura de custos para simular o CMV.",
    };
  }

  const calculation: IndustrialCostCalculationSnapshotDTO = await getIndustrialCostCalculation(
    savedCalculation.id,
  );

  const cost = await costForOutputQuantity(prisma, {
    costVersion: activeCostVersion as CostVersionForPricing,
    calculation,
    quantity: params.quantity,
    quantityUomCode: outputUomCode,
    collectBreakdown: true,
  });

  const components: CmvComponentDTO[] = [];
  for (const material of cost.breakdown?.materials ?? []) {
    const customerSupplied = material.supplyResponsibility === "CUSTOMER";
    components.push({
      group: groupForMaterial(material.itemType, customerSupplied),
      itemId: material.itemId,
      code: material.itemCode,
      name: material.itemName,
      requiredQuantity: material.requiredQuantity.toString(),
      unitCode: material.unitCode,
      costSource: material.costSource,
      unitCost: money(material.unitCost),
      totalCost: money(material.totalCost),
      customerSupplied,
    });
  }
  for (const resource of cost.breakdown?.resources ?? []) {
    components.push({
      group: "INDUSTRIAL_RESOURCE",
      itemId: null,
      code: resource.type,
      name: resource.name,
      requiredQuantity: resource.quantity.toString(),
      unitCode: resource.unitCode,
      costSource: null,
      unitCost: money(resource.rate),
      totalCost: money(resource.totalCost),
      customerSupplied: false,
    });
  }
  const energy = cost.breakdown?.energy;
  if (energy && (energy.total !== null || energy.kwh !== null)) {
    components.push({
      group: "INDUSTRIAL_RESOURCE",
      itemId: null,
      code: "ENERGY",
      name: "Energia",
      requiredQuantity: energy.kwh ? energy.kwh.toString() : null,
      unitCode: energy.kwh ? "kWh" : null,
      costSource: null,
      unitCost: money(energy.rate),
      totalCost: money(energy.total),
      customerSupplied: false,
    });
  }
  for (const line of cost.breakdown?.manualLines ?? []) {
    components.push({
      group: groupForManualLine(line.category),
      itemId: null,
      code: line.calculationBasis,
      name: line.description,
      requiredQuantity: null,
      unitCode: null,
      costSource: null,
      unitCost: money(line.rate),
      totalCost: money(line.amount),
      customerSupplied: false,
    });
  }

  const response: ProductCmvResponse = {
    ...base,
    calculationId: calculation.id,
    calculationCode: calculation.code,
    calculationReferenceDate: calculation.costReferenceDate,
    simulation: {
      quantity: params.quantity.toString(),
      uomCode: outputUomCode,
      batchCount: cost.batchCount.toString(),
      totalCost: money(cost.total),
      costPerUnit: money(cost.perUnit),
      costPer1000: money(cost.per1000),
      knownSubtotal: cost.knownSubtotal.toFixed(4),
      quality: cost.quality,
      warnings: cost.warnings,
      hasCustomerSuppliedMaterials: cost.hasCustomerSuppliedMaterials,
      components,
    },
  };

  if (!params.includePricing) return response;

  /*
   * Faixa vigente para EXATAMENTE esta quantidade.
   *
   * Sem interpolar, sem faixa mais próxima, sem cair para a de baixo: uma
   * faixa é uma negociação registrada para uma quantidade. 750 entre 500 e
   * 1000 não tem preço vigente, e dizer que tem seria inventar acordo
   * comercial.
   */
  const activePricing = await prisma.pricingVersion.findFirst({
    where: { productId: product.id, status: "ACTIVE" },
    include: { tiers: { orderBy: { quantity: "asc" } } },
    orderBy: { versionNumber: "desc" },
  });
  if (!activePricing) return response;

  const exact = activePricing.tiers.find((tier) => tier.quantity.equals(params.quantity)) ?? null;
  return {
    ...response,
    pricing: {
      pricingVersionId: activePricing.id,
      pricingVersionLabel: `${activePricing.code} · V${activePricing.versionNumber}`,
      tierId: exact?.id ?? null,
      tierQuantity: exact?.quantity.toString() ?? null,
      // Faixa ativa carrega o preço CONGELADO na ativação: renegociar exige
      // versão nova, e o custo de hoje não reescreve preço já acordado.
      unitPrice: precoDaFaixa(exact),
      availableQuantities: activePricing.tiers.map((tier) => tier.quantity.toString()),
    },
  };
}
