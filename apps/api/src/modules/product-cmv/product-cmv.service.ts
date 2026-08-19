import { Prisma } from "@prisma/client";
import type {
  CmvComponentDTO,
  CmvGroup,
  CmvLiveSimulationDTO,
  IndustrialCostWarningDTO,
  IndustrialCostCalculationSnapshotDTO,
  ProductCmvResponse,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { costForOutputQuantity, pricingVersionInclude } from "../pricing/pricing-cost.js";
import type { CostVersionForPricing } from "../pricing/pricing-cost.js";
import { getIndustrialCostCalculation } from "../industrial-cost-calculation/snapshot.service.js";
import { calculateIndustrialCost } from "../industrial-cost-calculation/calculation.service.js";
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

/**
 * Composição agrupada a partir do detalhamento do motor.
 *
 * Extraído para ser usado pelas DUAS respostas — a base congelada e a
 * simulação com os dados de hoje. Duas cópias divergiriam, e a diferença
 * entre os dois blocos passaria a incluir a forma de agrupar, que não é
 * diferença econômica nenhuma.
 */
function componentesDoCusto(cost: Awaited<ReturnType<typeof costForOutputQuantity>>): CmvComponentDTO[] {
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
  return components;
}

/**
 * Custo com as premissas de HOJE, sobre a estrutura em trabalho.
 *
 * Roda o MESMO motor, sem persistir: `calculateIndustrialCost` já existe
 * para a tela de estrutura mostrar número antes de congelar, e é ele que
 * responde aqui. A estrutura escolhida é o RASCUNHO quando existe — é ele
 * que representa o que está sendo definido — e a ativa quando não há.
 *
 * `null` quando não há estrutura nenhuma: sem premissas não há simulação, e
 * inventar uma seria o segundo motor de custo que este módulo existe para
 * não ter.
 */
async function simulacaoComDadosDeHoje(
  prisma: ReturnType<typeof getPrisma>,
  params: {
    productId: string;
    quantity: Prisma.Decimal;
    referenceDate: Date;
    outputUomCode: string;
  },
): Promise<CmvLiveSimulationDTO | null> {
  const estrutura = await prisma.industrialCostVersion.findFirst({
    where: { productId: params.productId, status: { in: ["DRAFT", "ACTIVE"] } },
    include: pricingVersionInclude,
    // Rascunho primeiro: é ele que carrega o trabalho em andamento.
    orderBy: [{ status: "asc" }, { versionNumber: "desc" }],
  });
  if (!estrutura) return null;

  const previa = await calculateIndustrialCost(estrutura.id, params.referenceDate);
  const cost = await costForOutputQuantity(prisma, {
    costVersion: estrutura as CostVersionForPricing,
    calculation: previa,
    quantity: params.quantity,
    quantityUomCode: params.outputUomCode,
    collectBreakdown: true,
  });

  return {
    industrialCostVersionId: estrutura.id,
    industrialCostVersionLabel: `${estrutura.code} · V${estrutura.versionNumber}`,
    industrialCostVersionStatus: estrutura.status,
    formulationVersionNumber: previa.formulationVersionNumber,
    costReferenceDate: previa.costReferenceDate,
    quantity: params.quantity.toString(),
    uomCode: params.outputUomCode,
    batchCount: cost.batchCount.toString(),
    totalCost: money(cost.total),
    costPerUnit: money(cost.perUnit),
    costPer1000: money(cost.per1000),
    knownSubtotal: cost.knownSubtotal.toFixed(4),
    quality: cost.quality,
    warnings: await comCaminhoDeSolucao(prisma, cost.warnings),
    hasCustomerSuppliedMaterials: cost.hasCustomerSuppliedMaterials,
    components: componentesDoCusto(cost),
  };
}

/**
 * Descobre, para cada material sem custo, o que a pessoa precisa FAZER.
 *
 * O motor sabe que o custo falta; só o histórico do item diz por quê, e são
 * três caminhos diferentes:
 *
 *   - existe recebimento com custo em branco  -> informar ali
 *   - nunca houve compra recebida             -> registrar ordem de compra
 *   - já existe custo hoje                    -> a base congelada é que é
 *                                                anterior a ele; salvar um
 *                                                cálculo novo
 *
 * Fica no read model, e não no motor de custo: a precificação percorre os
 * mesmos materiais faixa a faixa e não deve pagar consulta por linha.
 */
function chaveDoAviso(warning: IndustrialCostWarningDTO): string {
  return `${warning.code}:${warning.itemId ?? warning.resourceId ?? ""}`;
}

async function comCaminhoDeSolucao(
  prisma: ReturnType<typeof getPrisma>,
  warnings: IndustrialCostWarningDTO[],
  /**
   * Avisos que a simulação de HOJE ainda tem. O que sobra na base congelada e
   * não aparece aqui já foi resolvido no estado atual — o que está velho é o
   * cálculo, não a estrutura. Sem esta comparação a tela culpava a estrutura
   * por uma falta que ela não tem mais, e mandava consertar o que já estava
   * certo.
   */
  aindaAberto?: Set<string>,
): Promise<IndustrialCostWarningDTO[]> {
  if (aindaAberto) {
    warnings = warnings.map((warning) =>
      aindaAberto.has(chaveDoAviso(warning)) ? warning : { ...warning, target: "STALE_BASIS" as const },
    );
  }
  const semCusto = warnings.filter(
    (w) => w.code === "MATERIAL_COST_UNKNOWN" && w.itemId && w.target !== "STALE_BASIS",
  );
  if (semCusto.length === 0) return warnings;

  const itemIds = [...new Set(semCusto.map((w) => w.itemId!))];
  const linhas = await prisma.receiptLine.findMany({
    where: { itemId: { in: itemIds } },
    select: {
      itemId: true,
      actualUnitCost: true,
      receipt: { select: { id: true, code: true, receivedAt: true } },
    },
    orderBy: { receipt: { receivedAt: "desc" } },
  });

  return warnings.map((warning) => {
    if (warning.code !== "MATERIAL_COST_UNKNOWN" || !warning.itemId) return warning;
    if (warning.target === "STALE_BASIS") return warning;
    const doItem = linhas.filter((linha) => linha.itemId === warning.itemId);
    if (doItem.length === 0) {
      return { ...warning, target: "PURCHASE" as const };
    }
    const semValor = doItem.find((linha) => linha.actualUnitCost === null);
    if (semValor) {
      return {
        ...warning,
        target: "RECEIPT" as const,
        receiptId: semValor.receipt.id,
        receiptCode: semValor.receipt.code,
      };
    }
    // Todo recebimento já tem custo: o que está velho é o cálculo.
    return { ...warning, target: "STALE_BASIS" as const };
  });
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

  /*
   * Calculada ANTES dos retornos antecipados de propósito: a ausência de
   * base congelada é justamente quando a simulação mais serve — produto em
   * definição, sem cálculo salvo ainda.
   */
  const live = await simulacaoComDadosDeHoje(prisma, {
    productId: product.id,
    quantity: params.quantity,
    referenceDate: params.referenceDate,
    outputUomCode,
  });

  const base: ProductCmvResponse = {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    customerName: product.customer?.legalName ?? null,
    outputUomCode,
    formulationVersionId: activeFormulation?.id ?? null,
    formulationVersionNumber: activeFormulation?.versionNumber ?? null,
    // A base é a receita congelada pela estrutura ativa; só o cálculo sabe
    // o número dela, então antes de existir CALC fica só o id.
    basisFormulationVersionId: activeCostVersion?.formulationVersionId ?? null,
    basisFormulationVersionNumber: null,
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
    live,
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

  const components = componentesDoCusto(cost);

  const response: ProductCmvResponse = {
    ...base,
    calculationId: calculation.id,
    calculationCode: calculation.code,
    calculationReferenceDate: calculation.costReferenceDate,
    basisFormulationVersionNumber: calculation.formulationVersionNumber,
    simulation: {
      quantity: params.quantity.toString(),
      uomCode: outputUomCode,
      batchCount: cost.batchCount.toString(),
      totalCost: money(cost.total),
      costPerUnit: money(cost.perUnit),
      costPer1000: money(cost.per1000),
      knownSubtotal: cost.knownSubtotal.toFixed(4),
      quality: cost.quality,
      warnings: await comCaminhoDeSolucao(
        prisma,
        cost.warnings,
        live ? new Set(live.warnings.map(chaveDoAviso)) : undefined,
      ),
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
