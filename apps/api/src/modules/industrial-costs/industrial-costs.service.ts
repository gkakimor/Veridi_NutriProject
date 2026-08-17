import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialCostLineDTO,
  IndustrialCostMaterialDTO,
  IndustrialCostPendencyDTO,
  IndustrialCostVersionDTO,
  IndustrialCostVersionSummaryDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import { MAX_INDUSTRIAL_COST_PERCENT } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { convertUomDecimal, UomDimensionMismatchError, UomNotFoundError } from "../items/uom.js";
import {
  FormulationNotStableError,
  FormulationProductMismatchError,
  FormulationVersionNotFoundError,
  IncompatibleReferenceUomError,
  IncompleteActivationError,
  IndustrialCostLineNotFoundError,
  IndustrialCostProductNotFoundError,
  IndustrialCostVersionLockedError,
  IndustrialCostVersionNotFoundError,
  InvalidCostRateError,
  InvalidReferenceOutputError,
  MissingFormulationVersionError,
} from "./industrial-costs.errors.js";
import type {
  ActivateIndustrialCostVersionInput,
  CreateIndustrialCostLineInput,
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
  product: { include: { customer: true, finishedProductItem: true } },
  formulationVersion: { include: { components: { include: { item: true } } } },
  lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] as PrismaTypes.IndustrialCostLineOrderByWithRelationInput[] },
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
      });
    }
    if (
      line.calculationBasis === "PER_SHIPPING_BOX" &&
      version.product.unitsPerShippingBox === null
    ) {
      pendencies.push({
        code: "SHIPPING_BOX_NOT_CONFIGURED",
        description: `"${line.description}" usa caixa de expedição, mas o produto não tem unidades por caixa cadastradas.`,
      });
    }
  }

  if (version.formulationVersion.status === "DRAFT") {
    pendencies.push({
      code: "FORMULATION_NOT_STABLE",
      description: "A formulação referenciada ainda é rascunho.",
    });
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
    });
  }

  return pendencies;
}

/** Pendência que impede considerar a estrutura completa (a defasagem não impede). */
function blockingPendencies(pendencies: IndustrialCostPendencyDTO[]): IndustrialCostPendencyDTO[] {
  return pendencies.filter((pendency) => pendency.code !== "FORMULATION_OUTDATED");
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
    activeFormulationVersionNumber,

    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    unitsPerShippingBox: version.product.unitsPerShippingBox,

    notes: version.notes,

    materials: version.formulationVersion.components.map(toMaterialDTO),
    lines: version.lines.map(toLineDTO),

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
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  const formulationVersionId =
    input.formulationVersionId ??
    source?.formulationVersionId ??
    (
      await prisma.formulationVersion.findFirst({
        where: { productId, status: "ACTIVE" },
        select: { id: true },
      })
    )?.id;
  if (!formulationVersionId) throw new MissingFormulationVersionError();

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
        referenceOutputQuantity: new Prisma.Decimal(referenceQuantity),
        referenceOutputUomCode: referenceUom,
        ...(input.notes !== undefined ? { notes: input.notes } : { notes: source?.notes ?? null }),
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

  await prisma.industrialCostVersion.update({
    where: { id },
    data: {
      ...(input.formulationVersionId
        ? { formulationVersionId: input.formulationVersionId }
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

  const activeNumber = await activeFormulationNumber(version.productId);
  const pendencies = blockingPendencies(buildPendencies(version, activeNumber));
  if (pendencies.length > 0 && !input.confirmIncomplete) {
    throw new IncompleteActivationError(pendencies.map((pendency) => pendency.description));
  }

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
  });

  return (await getIndustrialCostVersion(id))!;
}
