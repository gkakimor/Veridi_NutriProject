import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialCostLineDTO,
  IndustrialCostMaterialDTO,
  IndustrialCostPendencyDTO,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  IndustrialCostVersionSummaryDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import { MAX_INDUSTRIAL_COST_PERCENT, usageUomForResourceType } from "@veridi/shared";
import { pickCurrentRate, toRateDTO } from "../industrial-resources/industrial-resources.service.js";
import { getPrisma } from "../../db/prisma.js";
import { missingFormulationContext } from "../../lib/formulation-math.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { convertUomDecimal, UomDimensionMismatchError, UomNotFoundError } from "../items/uom.js";
import {
  DirectEnergyNotAllowedError,
  InvalidEnergyResourceError,
  DuplicatedResourceUsageError,
  EnergyUsageRequiresDirectModeError,
  FormulationNotStableError,
  FormulationProductMismatchError,
  FormulationVersionNotFoundError,
  IncompatibleReferenceUomError,
  IncompleteActivationError,
  IndustrialCostLineNotFoundError,
  IndustrialCostProductNotFoundError,
  IndustrialCostVersionLockedError,
  IndustrialCostVersionNotFoundError,
  InactiveResourceActivationError,
  InvalidCostRateError,
  InvalidReferenceOutputError,
  MissingFormulationVersionError,
  ResourceNotFoundForUsageError,
  ResourceUsageNotFoundError,
} from "./industrial-costs.errors.js";
import type {
  ActivateIndustrialCostVersionInput,
  CreateIndustrialCostLineInput,
  CreateResourceUsageInput,
  UpdateEnergyModeInput,
  CreateIndustrialCostVersionInput,
  UpdateIndustrialCostLineInput,
  UpdateIndustrialCostVersionInput,
} from "./industrial-costs.schemas.js";

/**
 * Estrutura de custos industriais.
 *
 * Três limites que sustentam a capacidade inteira:
 * 1. **estrutura ≠ cálculo**: aqui ficam premissas (receita usada, base de
 *    produção, custos adicionais). Nenhum total é calculado nem persistido —
 *    o custo industrial consolidado é outra capacidade;
 * 2. **nada da Formulação é redigitado**: matérias-primas e embalagens vêm
 *    da versão de formulação referenciada, read-only. Material do cliente
 *    aparece porque pertence à estrutura física, mas nunca como custo de
 *    aquisição da Veridi;
 * 3. **desconhecido continua desconhecido**: taxa não informada é `null`,
 *    nunca zero — e a estrutura pode ser ativada assim, com confirmação
 *    explícita, em vez de travar o cadastro inteiro.
 *
 * A Foundation of Costs (custo real de aquisição, hierarquia
 * REAL/30D/90D/LAST_REAL/NO_COST) não é tocada por nada aqui.
 */

const CODE_SEQUENCE = "industrial_cost_code_seq";
const CODE_PREFIX = "EC";

const versionInclude = {
  energyResource: { select: { id: true, name: true } },
  // Nome atual do template de origem, só para o rótulo "criada a partir de".
  originCostTemplateVersion: { include: { industrialCostTemplate: true } },
  product: { include: { customer: true, finishedProductItem: true } },
  formulationVersion: { include: { components: { include: { item: true } } } },
  lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] as PrismaTypes.IndustrialCostLineOrderByWithRelationInput[] },
  resourceUsages: {
    include: { industrialResource: { include: { rates: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] as PrismaTypes.IndustrialCostResourceUsageOrderByWithRelationInput[],
  },
} satisfies PrismaTypes.IndustrialCostVersionInclude;

type VersionWithRelations = PrismaTypes.IndustrialCostVersionGetPayload<{
  include: typeof versionInclude;
}>;

function toLineDTO(line: VersionWithRelations["lines"][number]): IndustrialCostLineDTO {
  return {
    id: line.id,
    category: line.category,
    description: line.description,
    calculationBasis: line.calculationBasis,
    // `null` = não informado. A UI mostra "—"; nunca R$ 0,00.
    rateValue: line.rateValue ? line.rateValue.toString() : null,
    notes: line.notes,
    sortOrder: line.sortOrder,
  };
}

function toMaterialDTO(
  component: VersionWithRelations["formulationVersion"]["components"][number],
): IndustrialCostMaterialDTO {
  return {
    itemId: component.itemId,
    itemCode: component.item.code,
    itemName: component.item.name,
    itemType: component.item.type,
    quantity: component.quantity.toString(),
    unitCode: component.unitCode,
    basis: component.basis,
    purityPercentApplied: component.purityPercentApplied
      ? component.purityPercentApplied.toString()
      : null,
    overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    // Material do cliente entra na estrutura física, nunca no custo Veridi.
    customerSupplied: component.supplyResponsibility === "CUSTOMER",
  };
}

type UsageWithResource = VersionWithRelations["resourceUsages"][number];

/**
 * Consumo energético derivado de UM equipamento: horas planejadas × kW.
 *
 * É quantidade de energia, não dinheiro. `null` quando a potência é
 * desconhecida — a energia não vira zero por omissão.
 */
function derivedEnergyForUsage(usage: UsageWithResource): Prisma.Decimal | null {
  if (usage.industrialResource.type !== "EQUIPMENT") return null;
  const power = usage.powerKwSnapshot ?? usage.industrialResource.powerKw;
  if (!power) return null;
  return usage.usageQuantity.times(power);
}

function toUsageDTO(usage: UsageWithResource, reference: Date): IndustrialCostResourceUsageDTO {
  const current = pickCurrentRate(usage.industrialResource.rates, reference);
  const derived = derivedEnergyForUsage(usage);

  return {
    id: usage.id,
    resourceId: usage.industrialResourceId,
    resourceCode: usage.industrialResource.code,
    // Nome atual para navegar; o snapshot preserva o que a versão ativa viu.
    resourceName: usage.industrialResource.name,
    resourceType: usage.industrialResource.type,
    resourceActive: usage.industrialResource.active,
    usageBasis: usage.usageBasis,
    usageQuantity: usage.usageQuantity.toString(),
    usageUom: usage.usageUom,
    notes: usage.notes,

    currentRate: current ? toRateDTO(current, reference) : null,
    powerKw: usage.industrialResource.powerKw ? usage.industrialResource.powerKw.toString() : null,

    rateValueSnapshot: usage.rateValueSnapshot ? usage.rateValueSnapshot.toString() : null,
    rateCurrencySnapshot: usage.rateCurrencySnapshot,
    rateUomSnapshot: usage.rateUomSnapshot,
    rateEffectiveAtSnapshot: usage.rateEffectiveAtSnapshot
      ? usage.rateEffectiveAtSnapshot.toISOString()
      : null,
    powerKwSnapshot: usage.powerKwSnapshot ? usage.powerKwSnapshot.toString() : null,
    resourceNameSnapshot: usage.resourceNameSnapshot,

    derivedEnergyKwh: derived ? derived.toString() : null,
  };
}

/**
 * Energia derivada da versão: Σ(horas de equipamento × kW).
 *
 * Só existe no modo `FROM_EQUIPMENT`; nos demais é `null`, porque somar
 * energia derivada com consumo informado direto contaria a mesma energia
 * duas vezes.
 */
function derivedEnergyForVersion(version: VersionWithRelations): Prisma.Decimal | null {
  if (version.energyCalculationMode !== "FROM_EQUIPMENT") return null;

  let total = new Prisma.Decimal(0);
  let hasAny = false;
  for (const usage of version.resourceUsages) {
    const isEquipment =
      (usage.resourceTypeSnapshot ?? usage.industrialResource.type) === "EQUIPMENT";
    if (!isEquipment) continue;

    const derived = derivedEnergyForUsage(usage);
    // Um único equipamento sem potência deixa o total EM ABERTO. Somar só os
    // conhecidos apresentaria um número menor como se fosse o consumo real —
    // é a mesma mentira de tratar potência desconhecida como zero.
    if (!derived) return null;

    total = total.plus(derived);
    hasAny = true;
  }
  return hasAny ? total : null;
}

/**
 * Pendências da estrutura — derivadas, nunca persistidas.
 *
 * "Incompleta" não é "CMV zerado": significa que existe premissa econômica
 * que ninguém informou ainda, e o cálculo futuro devolverá custo parcial em
 * vez de fingir um número.
 */
function buildPendencies(
  version: VersionWithRelations,
  activeFormulationVersionNumber: number | null,
): IndustrialCostPendencyDTO[] {
  const pendencies: IndustrialCostPendencyDTO[] = [];

  for (const line of version.lines) {
    if (line.rateValue === null) {
      pendencies.push({
        code: "RATE_NOT_INFORMED",
        description: `"${line.description}" está sem valor informado.`,
        severity: "BLOCKING",
        target: "SELF",
        resourceId: null,
      });
    }
    if (
      line.calculationBasis === "PER_SHIPPING_BOX" &&
      version.product.unitsPerShippingBox === null
    ) {
      pendencies.push({
        code: "SHIPPING_BOX_NOT_CONFIGURED",
        description: `"${line.description}" usa caixa de expedição, mas o produto não tem unidades por caixa cadastradas.`,
        severity: "BLOCKING",
        target: "PRODUCT",
        resourceId: null,
      });
    }
  }

  if (version.formulationVersion.status === "DRAFT") {
    pendencies.push({
      code: "FORMULATION_NOT_STABLE",
      description: "A formulação referenciada ainda é rascunho.",
      severity: "BLOCKING",
      target: "FORMULATION",
      resourceId: null,
    });
  }

  /*
   * Terceira barreira: mesmo uma formulação ATIVA antiga pode estar
   * inválida — versões ativadas antes deste hotfix passaram pelo gate
   * quando ele ainda não existia. Uma estrutura que depende dela não pode
   * se declarar completa nem produzir custo de material.
   */
  if (
    missingFormulationContext(
      version.formulationVersion.components,
      version.formulationVersion,
    ) === "DOSES_PER_PACKAGE"
  ) {
    pendencies.push({
      code: "FORMULATION_DOSES_MISSING",
      description:
        "A formulação usada tem componentes calculados por dose, mas não informa as doses por embalagem. Sem isso, a quantidade de material não existe.",
      severity: "BLOCKING",
      target: "FORMULATION",
      resourceId: null,
    });
  }

  // Versão congelada é lida pelo que ela congelou: inativar o recurso ou
  // mexer na tarifa hoje não cria pendência num documento já ativado.
  const frozen = version.status !== "DRAFT";
  const reference = new Date();
  for (const usage of version.resourceUsages) {
    const name = usage.resourceNameSnapshot ?? usage.industrialResource.name;
    if (frozen) {
      if (usage.rateValueSnapshot === null) {
        pendencies.push({
          code: "RESOURCE_RATE_NOT_INFORMED",
          description: `"${name}" foi ativado sem tarifa vigente informada.`,
          severity: "BLOCKING",
          target: "RESOURCE",
          resourceId: usage.industrialResourceId,
        });
      }
      continue;
    }
    if (!pickCurrentRate(usage.industrialResource.rates, reference)) {
      pendencies.push({
        code: "RESOURCE_RATE_NOT_INFORMED",
        description: `"${name}" não tem tarifa vigente informada.`,
        severity: "BLOCKING",
        target: "RESOURCE",
        resourceId: usage.industrialResourceId,
      });
    }
    if (!usage.industrialResource.active) {
      pendencies.push({
        code: "RESOURCE_INACTIVE",
        description: `"${name}" está inativo no cadastro de recursos.`,
        severity: "BLOCKING",
        target: "RESOURCE",
        resourceId: usage.industrialResourceId,
      });
    }
  }

  // Energia: `NONE` é "ainda não estruturada", nunca energia zero.
  if (version.energyCalculationMode === "NONE") {
    pendencies.push({
      code: "ENERGY_NOT_CONFIGURED",
      description: "A energia desta estrutura ainda não foi configurada.",
      severity: "BLOCKING",
      target: "SELF",
      resourceId: null,
    });
  }

  if (version.energyCalculationMode === "DIRECT") {
    const hasEnergyUsage = version.resourceUsages.some(
      (usage) => usage.industrialResource.type === "ENERGY",
    );
    if (!hasEnergyUsage) {
      pendencies.push({
        code: "ENERGY_RESOURCE_MISSING",
        description: "Modo direto sem consumo de energia informado.",
        severity: "BLOCKING",
        target: "SELF",
        resourceId: null,
      });
    }
  }

  if (version.energyCalculationMode === "FROM_EQUIPMENT") {
    // Sem potência não há como derivar energia — e assumir potência padrão
    // seria inventar consumo.
    for (const usage of version.resourceUsages) {
      const isEquipment =
        (usage.resourceTypeSnapshot ?? usage.industrialResource.type) === "EQUIPMENT";
      // Congelada: vale a potência do momento da ativação; rascunho: a atual.
      const power = frozen
        ? usage.powerKwSnapshot
        : (usage.powerKwSnapshot ?? usage.industrialResource.powerKw);
      if (isEquipment && !power) {
        pendencies.push({
          code: "EQUIPMENT_POWER_NOT_INFORMED",
          description: `"${usage.resourceNameSnapshot ?? usage.industrialResource.name}" está sem potência cadastrada — a energia derivada fica incompleta.`,
          severity: "BLOCKING",
          target: "RESOURCE",
          resourceId: usage.industrialResourceId,
        });
      }
    }
    if (!version.resourceUsages.some((usage) => usage.industrialResource.type === "EQUIPMENT")) {
      pendencies.push({
        code: "ENERGY_RESOURCE_MISSING",
        description: "Energia derivada dos equipamentos, mas nenhum equipamento foi planejado.",
        severity: "BLOCKING",
        target: "SELF",
        resourceId: null,
      });
    }
  }

  // Informativo: a estrutura continua válida sobre a receita que ela
  // congelou — trocar a formulação ativa nunca reescreve custo histórico.
  if (
    activeFormulationVersionNumber !== null &&
    activeFormulationVersionNumber !== version.formulationVersion.versionNumber
  ) {
    pendencies.push({
      code: "FORMULATION_OUTDATED",
      description: `Esta estrutura usa a formulação V${version.formulationVersion.versionNumber}; a formulação ativa atual é V${activeFormulationVersionNumber}.`,
      severity: "INFO",
      target: "FORMULATION",
      resourceId: null,
    });
  }

  return pendencies;
}

/**
 * Pendência que impede considerar a estrutura completa.
 *
 * A severidade viaja no DTO justamente para a tela poder separar "o que
 * falta para ativar" de "contexto" sem repetir esta regra do lado do
 * cliente — quem decide `complete` e quem lista o que falta leem o mesmo
 * campo.
 */
function blockingPendencies(pendencies: IndustrialCostPendencyDTO[]): IndustrialCostPendencyDTO[] {
  return pendencies.filter((pendency) => pendency.severity === "BLOCKING");
}

function toVersionDTO(
  version: VersionWithRelations,
  activeFormulationVersionNumber: number | null,
): IndustrialCostVersionDTO {
  const pendencies = buildPendencies(version, activeFormulationVersionNumber);

  return {
    id: version.id,
    code: version.code,
    productId: version.productId,
    productCode: version.product.code,
    productName: version.product.name,
    customerName: version.product.customer?.legalName ?? null,
    versionNumber: version.versionNumber,
    label: `${version.code} · V${version.versionNumber}`,
    status: version.status,

    formulationVersionId: version.formulationVersionId,
    formulationVersionNumber: version.formulationVersion.versionNumber,
    formulationStatus: version.formulationVersion.status,
    formulationPinned: version.formulationPinned,
    activeFormulationVersionNumber,

    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    unitsPerShippingBox: version.product.unitsPerShippingBox,

    notes: version.notes,

    materials: version.formulationVersion.components.map(toMaterialDTO),
    lines: version.lines.map(toLineDTO),
    resourceUsages: version.resourceUsages.map((usage) => toUsageDTO(usage, new Date())),

    energyCalculationMode: version.energyCalculationMode,
    energyResourceId: version.energyResourceId,
    energyResourceName: version.energyResource?.name ?? null,
    derivedEnergyKwh: derivedEnergyForVersion(version)?.toString() ?? null,

    complete: blockingPendencies(pendencies).length === 0,
    pendencies,

    createdAt: version.createdAt.toISOString(),
    createdByName: version.createdByNameSnapshot,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedByName: version.activatedByNameSnapshot,

    customerCodeSnapshot: version.customerCodeSnapshot,
    customerNameSnapshot: version.customerNameSnapshot,
    productCodeSnapshot: version.productCodeSnapshot,
    productNameSnapshot: version.productNameSnapshot,
    // Proveniência no template de estrutura — nunca vínculo vivo.
    originCostTemplateVersionId: version.originCostTemplateVersionId,
    originCostTemplateCode: version.originCostTemplateCode,
    originCostTemplateVersionNumber: version.originCostTemplateVersionNumber,
    originCostTemplateName: version.originCostTemplateVersion?.industrialCostTemplate.name ?? null,
  };
}

async function activeFormulationNumber(productId: string): Promise<number | null> {
  const active = await getPrisma().formulationVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    select: { versionNumber: true },
  });
  return active?.versionNumber ?? null;
}

export async function getIndustrialCostVersion(
  id: string,
): Promise<IndustrialCostVersionDTO | null> {
  const version = await getPrisma().industrialCostVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) return null;
  return toVersionDTO(version, await activeFormulationNumber(version.productId));
}

export async function getProductIndustrialCosts(
  productId: string,
): Promise<ProductIndustrialCostResponse> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { finishedProductItem: true },
  });
  if (!product) throw new IndustrialCostProductNotFoundError(productId);

  const [versions, activeFormulation] = await Promise.all([
    prisma.industrialCostVersion.findMany({
      where: { productId },
      include: versionInclude,
      orderBy: { versionNumber: "desc" },
    }),
    prisma.formulationVersion.findFirst({
      where: { productId, status: "ACTIVE" },
      select: { id: true, versionNumber: true },
    }),
  ]);

  const activeNumber = activeFormulation?.versionNumber ?? null;
  const summaries: IndustrialCostVersionSummaryDTO[] = versions.map((version) => {
    const dto = toVersionDTO(version, activeNumber);
    return {
      id: dto.id,
      code: dto.code,
      versionNumber: dto.versionNumber,
      label: dto.label,
      status: dto.status,
      formulationVersionNumber: dto.formulationVersionNumber,
      referenceOutputQuantity: dto.referenceOutputQuantity,
      referenceOutputUomCode: dto.referenceOutputUomCode,
      complete: dto.complete,
      activatedAt: dto.activatedAt,
    };
  });

  const current = versions.find((version) => version.status === "ACTIVE") ?? null;
  const draft = versions.find((version) => version.status === "DRAFT") ?? null;

  return {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    // Sugestão, não default: o usuário confirma a base de produção.
    suggestedReferenceOutputQuantity: product.minimumBatchQuantity
      ? product.minimumBatchQuantity.toString()
      : null,
    referenceOutputUomCode: product.finishedProductItem?.unitCode ?? null,
    activeFormulationVersionId: activeFormulation?.id ?? null,
    activeFormulationVersionNumber: activeNumber,
    versions: summaries,
    current: current ? toVersionDTO(current, activeNumber) : null,
    draft: draft ? toVersionDTO(draft, activeNumber) : null,
  };
}

async function requireEditableVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().industrialCostVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new IndustrialCostVersionNotFoundError(id);
  if (version.status !== "DRAFT") throw new IndustrialCostVersionLockedError(version.status);
  return version;
}

/** A base de produção precisa ser compatível com a unidade do produto acabado. */
async function assertReferenceUom(uomCode: string, expectedUom: string): Promise<void> {
  if (uomCode === expectedUom) return;
  const units = await getPrisma().unitOfMeasure.findMany();
  try {
    convertUomDecimal(new Prisma.Decimal(1), uomCode, expectedUom, units);
  } catch (error) {
    if (error instanceof UomNotFoundError || error instanceof UomDimensionMismatchError) {
      throw new IncompatibleReferenceUomError(uomCode, expectedUom);
    }
    throw error;
  }
}

/**
 * Cria a próxima versão da estrutura.
 *
 * Se já existe rascunho aberto, devolve o próprio rascunho: "nova versão"
 * clicado duas vezes nunca gera V3/V4 por acidente. Quando existe versão
 * ativa, a nova versão copia dela a receita, a base e as premissas manuais —
 * mas nunca o status nem a auditoria de ativação.
 */
export async function createIndustrialCostVersion(
  productId: string,
  input: CreateIndustrialCostVersionInput,
  actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { finishedProductItem: true },
  });
  if (!product) throw new IndustrialCostProductNotFoundError(productId);

  const existingDraft = await prisma.industrialCostVersion.findFirst({
    where: { productId, status: "DRAFT" },
  });
  if (existingDraft) return (await getIndustrialCostVersion(existingDraft.id))!;

  const source = await prisma.industrialCostVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      // Os usos são copiados; as TARIFAS não — elas são referência global e
      // a nova versão deve enxergar a vigente, não a congelada da anterior.
      resourceUsages: { orderBy: { sortOrder: "asc" } },
    },
  });

  const ativa = await prisma.formulationVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    select: { id: true },
  });
  /*
   * A ativa tem precedência sobre a receita da versão de origem.
   *
   * Copiar a da origem fazia uma V2 de estrutura nascer na receita velha
   * mesmo com uma nova publicada, e não havia caminho pela tela para chegar
   * na nova. Rascunho é trabalho em andamento: o padrão é a receita que vale
   * hoje. Ficar na antiga continua possível — mas passa a ser pedido
   * explícito, e aí a versão nasce fixada.
   */
  const formulationVersionId =
    input.formulationVersionId ?? ativa?.id ?? source?.formulationVersionId;
  if (!formulationVersionId) throw new MissingFormulationVersionError();
  const nascePinned = formulationVersionId !== ativa?.id;

  const formulation = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
  });
  if (!formulation) throw new FormulationVersionNotFoundError(formulationVersionId);
  if (formulation.productId !== productId) throw new FormulationProductMismatchError();

  const referenceUom =
    input.referenceOutputUomCode ??
    source?.referenceOutputUomCode ??
    product.finishedProductItem?.unitCode;
  if (!referenceUom) {
    throw new InvalidReferenceOutputError("Produto sem item de produto acabado definido.");
  }
  if (product.finishedProductItem) {
    await assertReferenceUom(referenceUom, product.finishedProductItem.unitCode);
  }

  // Nada de assumir 1000: sem base informada e sem versão anterior, o
  // cadastro exige que alguém diga qual é o lote de referência.
  const referenceQuantity =
    input.referenceOutputQuantity ??
    source?.referenceOutputQuantity.toString() ??
    (product.minimumBatchQuantity ? product.minimumBatchQuantity.toString() : null);
  if (!referenceQuantity) throw new InvalidReferenceOutputError();

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CODE_PREFIX);

  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const maxVersion = await tx.industrialCostVersion.aggregate({
      where: { productId },
      _max: { versionNumber: true },
    });

    const created = await tx.industrialCostVersion.create({
      data: {
        code,
        productId,
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        formulationVersionId,
        formulationPinned: nascePinned,
        referenceOutputQuantity: new Prisma.Decimal(referenceQuantity),
        referenceOutputUomCode: referenceUom,
        ...(input.notes !== undefined ? { notes: input.notes } : { notes: source?.notes ?? null }),
        energyCalculationMode: source?.energyCalculationMode ?? "NONE",
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    if (source && source.lines.length > 0) {
      await tx.industrialCostLine.createMany({
        data: source.lines.map((line) => ({
          industrialCostVersionId: created.id,
          category: line.category,
          description: line.description,
          calculationBasis: line.calculationBasis,
          rateValue: line.rateValue,
          notes: line.notes,
          sortOrder: line.sortOrder,
        })),
      });
    }

    if (source && source.resourceUsages.length > 0) {
      await tx.industrialCostResourceUsage.createMany({
        data: source.resourceUsages.map((usage) => ({
          industrialCostVersionId: created.id,
          industrialResourceId: usage.industrialResourceId,
          usageBasis: usage.usageBasis,
          usageQuantity: usage.usageQuantity,
          usageUom: usage.usageUom,
          notes: usage.notes,
          sortOrder: usage.sortOrder,
          // Snapshots econômicos ficam de fora: são da ativação, e esta
          // versão ainda vai enxergar as tarifas vigentes.
        })),
      });
    }

    return created.id;
  });

  return (await getIndustrialCostVersion(id))!;
}

export async function updateIndustrialCostVersion(
  id: string,
  input: UpdateIndustrialCostVersionInput,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const version = await requireEditableVersion(id);

  if (input.formulationVersionId) {
    const formulation = await prisma.formulationVersion.findUnique({
      where: { id: input.formulationVersionId },
    });
    if (!formulation) throw new FormulationVersionNotFoundError(input.formulationVersionId);
    if (formulation.productId !== version.productId) throw new FormulationProductMismatchError();
  }

  if (input.referenceOutputUomCode && version.product.finishedProductItem) {
    await assertReferenceUom(
      input.referenceOutputUomCode,
      version.product.finishedProductItem.unitCode,
    );
  }

  /*
   * Escolher a receita EXPLICITAMENTE é decisão do usuário, e o rascunho para
   * de seguir a ativa — seguir por cima disso seria sobrescrever intenção.
   * Escolher justamente a ativa é o contrário: volta a seguir.
   */
  let pinned: boolean | undefined;
  if (input.formulationVersionId) {
    const ativa = await prisma.formulationVersion.findFirst({
      where: { productId: version.productId, status: "ACTIVE" },
      select: { id: true },
    });
    pinned = input.formulationVersionId !== ativa?.id;
  }

  await prisma.industrialCostVersion.update({
    where: { id },
    data: {
      ...(input.formulationVersionId
        ? { formulationVersionId: input.formulationVersionId, formulationPinned: pinned === true }
        : {}),
      ...(input.referenceOutputQuantity
        ? { referenceOutputQuantity: new Prisma.Decimal(input.referenceOutputQuantity) }
        : {}),
      ...(input.referenceOutputUomCode
        ? { referenceOutputUomCode: input.referenceOutputUomCode }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return (await getIndustrialCostVersion(id))!;
}

function assertRate(basis: string, rateValue: string | null | undefined): void {
  if (rateValue === null || rateValue === undefined) return;
  const value = new Prisma.Decimal(rateValue);
  if (value.lessThan(0)) throw new InvalidCostRateError("O valor não pode ser negativo.");
  if (
    basis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST" &&
    value.greaterThan(MAX_INDUSTRIAL_COST_PERCENT)
  ) {
    // 10 = 10%. Acima de 1000% é erro de digitação, não overhead real.
    throw new InvalidCostRateError(
      `Percentual acima do limite técnico (${MAX_INDUSTRIAL_COST_PERCENT}%). Informe o percentual como número (10 = 10%).`,
    );
  }
}

export async function createIndustrialCostLine(
  versionId: string,
  input: CreateIndustrialCostLineInput,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  await requireEditableVersion(versionId);
  assertRate(input.calculationBasis, input.rateValue);

  const last = await prisma.industrialCostLine.aggregate({
    where: { industrialCostVersionId: versionId },
    _max: { sortOrder: true },
  });

  await prisma.industrialCostLine.create({
    data: {
      industrialCostVersionId: versionId,
      category: input.category,
      description: input.description,
      calculationBasis: input.calculationBasis,
      // Ausente continua ausente: premissa sem valor é `null`, nunca zero.
      rateValue: input.rateValue ? new Prisma.Decimal(input.rateValue) : null,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });

  return (await getIndustrialCostVersion(versionId))!;
}

export async function updateIndustrialCostLine(
  lineId: string,
  input: UpdateIndustrialCostLineInput,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const line = await prisma.industrialCostLine.findUnique({ where: { id: lineId } });
  if (!line) throw new IndustrialCostLineNotFoundError(lineId);
  await requireEditableVersion(line.industrialCostVersionId);

  assertRate(input.calculationBasis ?? line.calculationBasis, input.rateValue);

  await prisma.industrialCostLine.update({
    where: { id: lineId },
    data: {
      ...(input.description ? { description: input.description } : {}),
      ...(input.calculationBasis ? { calculationBasis: input.calculationBasis } : {}),
      ...(input.rateValue !== undefined
        ? { rateValue: input.rateValue === null ? null : new Prisma.Decimal(input.rateValue) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return (await getIndustrialCostVersion(line.industrialCostVersionId))!;
}

export async function deleteIndustrialCostLine(
  lineId: string,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const line = await prisma.industrialCostLine.findUnique({ where: { id: lineId } });
  if (!line) throw new IndustrialCostLineNotFoundError(lineId);
  await requireEditableVersion(line.industrialCostVersionId);

  await prisma.industrialCostLine.delete({ where: { id: lineId } });
  return (await getIndustrialCostVersion(line.industrialCostVersionId))!;
}


/**
 * Adiciona um recurso à versão em rascunho.
 *
 * Uma linha por recurso: sem roteiro nesta fase, o mesmo equipamento usado
 * em duas etapas soma o tempo planejado. A unidade vem do tipo do recurso —
 * operador em hora, energia em kWh.
 */
export async function createResourceUsage(
  versionId: string,
  input: CreateResourceUsageInput,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const version = await requireEditableVersion(versionId);

  const resource = await prisma.industrialResource.findUnique({
    where: { id: input.resourceId },
  });
  if (!resource) throw new ResourceNotFoundForUsageError(input.resourceId);

  // Energia direta só existe no modo direto; no modo derivado ela vem dos
  // equipamentos, e aceitar as duas contaria a mesma energia duas vezes.
  if (resource.type === "ENERGY" && version.energyCalculationMode !== "DIRECT") {
    throw new EnergyUsageRequiresDirectModeError();
  }

  const existing = await prisma.industrialCostResourceUsage.findUnique({
    where: {
      industrialCostVersionId_industrialResourceId: {
        industrialCostVersionId: versionId,
        industrialResourceId: input.resourceId,
      },
    },
  });
  if (existing) throw new DuplicatedResourceUsageError(resource.name);

  const last = await prisma.industrialCostResourceUsage.aggregate({
    where: { industrialCostVersionId: versionId },
    _max: { sortOrder: true },
  });

  await prisma.industrialCostResourceUsage.create({
    data: {
      industrialCostVersionId: versionId,
      industrialResourceId: resource.id,
      usageBasis: input.usageBasis ?? "FIXED_PER_REFERENCE_BATCH",
      usageQuantity: new Prisma.Decimal(input.usageQuantity),
      usageUom: usageUomForResourceType(resource.type),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });

  return (await getIndustrialCostVersion(versionId))!;
}

export async function deleteResourceUsage(
  usageId: string,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const usage = await prisma.industrialCostResourceUsage.findUnique({ where: { id: usageId } });
  if (!usage) throw new ResourceUsageNotFoundError(usageId);
  await requireEditableVersion(usage.industrialCostVersionId);

  await prisma.industrialCostResourceUsage.delete({ where: { id: usageId } });
  return (await getIndustrialCostVersion(usage.industrialCostVersionId))!;
}

/**
 * Troca o modo de energia da versão.
 *
 * Sair do modo direto com consumo de energia já lançado é recusado: o
 * usuário remove a linha antes, para que ninguém acabe com energia direta e
 * derivada convivendo.
 */
export async function updateEnergyMode(
  versionId: string,
  input: UpdateEnergyModeInput,
  _actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const version = await requireEditableVersion(versionId);

  const hasEnergyUsage = version.resourceUsages.some(
    (usage) => usage.industrialResource.type === "ENERGY",
  );
  if (hasEnergyUsage && input.energyCalculationMode !== "DIRECT") {
    throw new DirectEnergyNotAllowedError();
  }

  // Tarifa do kWh derivado: escolha explícita de um recurso de energia. O
  // sistema nunca elege um sozinho — seria inventar premissa econômica.
  if (input.energyResourceId) {
    const resource = await prisma.industrialResource.findUnique({
      where: { id: input.energyResourceId },
    });
    if (!resource) throw new ResourceNotFoundForUsageError(input.energyResourceId);
    if (resource.type !== "ENERGY") {
      throw new InvalidEnergyResourceError(resource.name);
    }
  }

  await prisma.industrialCostVersion.update({
    where: { id: versionId },
    data: {
      energyCalculationMode: input.energyCalculationMode,
      ...(input.energyResourceId !== undefined
        ? { energyResourceId: input.energyResourceId }
        : {}),
    },
  });

  return (await getIndustrialCostVersion(versionId))!;
}

/**
 * Ativa a estrutura e congela os snapshots do documento.
 *
 * A versão ativa anterior vira INACTIVE na mesma transação — nunca duas
 * ativas. Ativar sobre formulação DRAFT é recusado: congelaria custo sobre
 * receita mutável. Ativar com premissa faltando é permitido, mas só com
 * confirmação explícita: desconhecido não vira zero nem trava o cadastro.
 */
export async function activateIndustrialCostVersion(
  id: string,
  input: ActivateIndustrialCostVersionInput,
  actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const version = await requireEditableVersion(id);

  if (version.formulationVersion.status === "DRAFT") throw new FormulationNotStableError();

  // Recurso inativo não entra numa estrutura nova: o histórico antigo que
  // já o usava continua válido, mas ativar algo sobre recurso desativado
  // seria criar uma premissa que a fábrica já abandonou.
  const inactive = version.resourceUsages.filter((usage) => !usage.industrialResource.active);
  if (inactive.length > 0) {
    throw new InactiveResourceActivationError(
      inactive.map((usage) => usage.industrialResource.name),
    );
  }

  const activeNumber = await activeFormulationNumber(version.productId);
  const pendencies = blockingPendencies(buildPendencies(version, activeNumber));
  if (pendencies.length > 0 && !input.confirmIncomplete) {
    throw new IncompleteActivationError(pendencies.map((pendency) => pendency.description));
  }

  // Congela o que a versão considerou: tarifa e potência do momento da
  // ativação. Reajustar a hora amanhã não pode reescrever custo histórico,
  // e tarifa ausente continua `null` — nunca zero.
  const reference = new Date();
  const snapshots = version.resourceUsages.map((usage) => {
    const rate = pickCurrentRate(usage.industrialResource.rates, reference);
    return {
      id: usage.id,
      resourceNameSnapshot: usage.industrialResource.name,
      resourceTypeSnapshot: usage.industrialResource.type,
      rateIdSnapshot: rate?.id ?? null,
      rateValueSnapshot: rate?.rateValue ?? null,
      rateCurrencySnapshot: rate?.currencyCode ?? null,
      rateUomSnapshot: rate?.rateUom ?? null,
      rateEffectiveAtSnapshot: rate?.effectiveAt ?? null,
      powerKwSnapshot: usage.industrialResource.powerKw ?? null,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${version.productId} FOR UPDATE`;

    await tx.industrialCostVersion.updateMany({
      where: { productId: version.productId, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });

    await tx.industrialCostVersion.update({
      where: { id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        activatedByUserId: actor.id,
        activatedByNameSnapshot: actor.name,
        // Snapshot do documento: renomear produto/cliente depois não
        // reescreve a estrutura já impressa.
        productCodeSnapshot: version.product.code,
        productNameSnapshot: version.product.name,
        customerCodeSnapshot: version.product.customer?.code ?? null,
        customerNameSnapshot: version.product.customer?.legalName ?? null,
        formulationVersionNumberSnapshot: version.formulationVersion.versionNumber,
        unitsPerShippingBoxSnapshot: version.product.unitsPerShippingBox,
      },
    });

    for (const snapshot of snapshots) {
      const { id, ...data } = snapshot;
      await tx.industrialCostResourceUsage.update({ where: { id }, data });
    }
  });

  return (await getIndustrialCostVersion(id))!;
}
