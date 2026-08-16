import { Prisma } from "@prisma/client";
import type {
  FormulationComponent,
  FormulationVersion,
  Item,
  Product,
  UnitOfMeasure,
} from "@prisma/client";
import type {
  FormulationComponentDTO,
  FormulationListResponse,
  FormulationSummaryDTO,
  FormulationVersionDTO,
  FormulationVersionListResponse,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { computeComponentRequirement } from "../../lib/formulation-math.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { convertUomDecimal, isUomCompatible } from "../items/uom.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  FormulationActivationError,
  FormulationAlreadyExistsError,
  FormulationVersionNotFoundError,
  InactiveComponentItemError,
  IncompatibleComponentUnitError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
  MissingFinishedItemError,
  ProductNotFoundError,
  VersionNotActiveError,
  VersionNotDraftError,
} from "./formulations.errors.js";
import type {
  CreateFormulationVersionInput,
  FormulationComponentInput,
  ListFormulationsQuery,
  UpdateFormulationVersionInput,
} from "./formulations.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

type ComponentWithItem = FormulationComponent & { item: Item };
type VersionWithRelations = FormulationVersion & {
  product: Product;
  components: ComponentWithItem[];
};

function toComponentDTO(
  component: ComponentWithItem,
  units: readonly UnitOfMeasure[],
  version: { basisQuantity: Prisma.Decimal; dosesPerPackage: number | null },
): FormulationComponentDTO {
  const item = component.item;
  let stockEquivalentQuantity: Prisma.Decimal;
  try {
    stockEquivalentQuantity = convertUomDecimal(component.quantity, component.unitCode, item.unitCode, units);
  } catch {
    // Defensivo: nao deveria acontecer (unidade validada ao salvar), mas
    // nunca deixa a leitura quebrar por causa so do calculo de exibicao.
    stockEquivalentQuantity = component.quantity;
  }

  // Previa por UNIDADE acabada — mesma matematica do Requirement da OP,
  // nunca uma conta paralela so para a tela.
  const perUnit = computeComponentRequirement(
    {
      basis: component.basis,
      quantity: component.quantity,
      unitCode: component.unitCode,
      stockUnitCode: item.unitCode,
      purityPercentApplied: component.purityPercentApplied,
      overagePercent: component.overagePercent,
    },
    new Prisma.Decimal(1),
    { basisQuantity: version.basisQuantity, dosesPerPackage: version.dosesPerPackage },
    [...units],
  );

  return {
    id: component.id,
    itemId: component.itemId,
    itemCode: item.code,
    itemName: item.name,
    itemType: item.type,
    itemActive: item.active,
    quantity: component.quantity.toString(),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied
      ? component.purityPercentApplied.toString()
      : null,
    overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    legacyTotalQuantity: component.legacyTotalQuantity
      ? component.legacyTotalQuantity.toString()
      : null,
    legacyTotalUnitCode: component.legacyTotalUnitCode,
    legacyBatchUnits: component.legacyBatchUnits ? component.legacyBatchUnits.toString() : null,
    theoreticalPerUnit: perUnit.theoreticalQuantity.toString(),
    physicalPerUnit: perUnit.requiredQuantity.toString(),
    stockEquivalentQuantity: stockEquivalentQuantity.toString(),
    stockUnitCode: item.unitCode,
    notes: component.notes,
    position: component.position,
  };
}

function toVersionDTO(
  version: VersionWithRelations,
  units: readonly UnitOfMeasure[],
): FormulationVersionDTO {
  return {
    id: version.id,
    productId: version.productId,
    productCode: version.product.code,
    productName: version.product.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    outputItemId: version.outputItemId,
    outputItemCode: version.outputItemCode,
    outputItemName: version.outputItemName,
    outputUnitCode: version.outputUnitCode,
    notes: version.notes,
    components: version.components
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((component) => toComponentDTO(component, units, version)),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    inactivatedAt: version.inactivatedAt ? version.inactivatedAt.toISOString() : null,
    inactivatedBy: version.inactivatedBy,
  };
}

const versionInclude = {
  product: true,
  components: { include: { item: true } },
} as const;

async function getUnits(): Promise<UnitOfMeasure[]> {
  return getPrisma().unitOfMeasure.findMany();
}

async function requireVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().formulationVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new FormulationVersionNotFoundError(id);
  return version;
}

export async function listFormulations(
  query: ListFormulationsQuery,
  pagination: Pagination = query,
): Promise<FormulationListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      {
        customer: {
          is: {
            OR: [
              { legalName: { contains: query.search, mode: "insensitive" } },
              { tradeName: { contains: query.search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { customer: true, finishedProductItem: true },
      orderBy: { code: "asc" },
      ...pageArgs(pagination),
    }),
    prisma.product.count({ where }),
  ]);

  const productIds = products.map((product) => product.id);
  const versions = productIds.length
    ? await prisma.formulationVersion.findMany({
        where: { productId: { in: productIds } },
        orderBy: { versionNumber: "desc" },
      })
    : [];

  const byProduct = new Map<string, FormulationVersion[]>();
  for (const version of versions) {
    const list = byProduct.get(version.productId) ?? [];
    list.push(version);
    byProduct.set(version.productId, list);
  }

  const formulations: FormulationSummaryDTO[] = products.map((product) => {
    const productVersions = byProduct.get(product.id) ?? [];
    const active = productVersions.find((version) => version.status === "ACTIVE") ?? null;
    const latest = productVersions[0] ?? null;
    const reference = active ?? latest;

    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      customerName: product.customer?.legalName ?? null,
      finishedProductItemId: product.finishedProductItemId,
      finishedProductItemCode: product.finishedProductItem?.code ?? null,
      activeVersionId: active?.id ?? null,
      activeVersionLabel: active ? `V${active.versionNumber}` : null,
      hasFormulation: productVersions.length > 0,
      updatedAt: reference ? (reference.activatedAt ?? reference.createdAt).toISOString() : null,
    };
  });

  return { formulations, ...pageMeta(pagination, total) };
}

export async function listFormulationVersionsByProduct(
  productId: string,
): Promise<FormulationVersionListResponse> {
  const product = await getPrisma().product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  const [versions, units] = await Promise.all([
    getPrisma().formulationVersion.findMany({
      where: { productId },
      include: versionInclude,
      orderBy: { versionNumber: "desc" },
    }),
    getUnits(),
  ]);

  return { versions: versions.map((version) => toVersionDTO(version, units)) };
}

export async function getFormulationVersionById(id: string): Promise<FormulationVersionDTO | null> {
  const version = await getPrisma().formulationVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) return null;
  return toVersionDTO(version, await getUnits());
}

export async function createFirstFormulationVersion(
  productId: string,
  input: CreateFormulationVersionInput,
): Promise<FormulationVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);
  if (!product.finishedProductItemId) throw new MissingFinishedItemError();

  const outputItem = await prisma.item.findUnique({ where: { id: product.finishedProductItemId } });
  if (!outputItem) throw new MissingFinishedItemError();

  const versionId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const existing = await tx.formulationVersion.count({ where: { productId } });
    if (existing > 0) throw new FormulationAlreadyExistsError();

    const version = await tx.formulationVersion.create({
      data: {
        productId,
        versionNumber: 1,
        status: "DRAFT",
        basisQuantity: "1",
        outputItemId: outputItem.id,
        outputItemCode: outputItem.code,
        outputItemName: outputItem.name,
        outputUnitCode: outputItem.unitCode,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: SYSTEM_ACTOR,
      },
    });
    return version.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

export async function createNewVersionFromActive(
  sourceVersionId: string,
): Promise<FormulationVersionDTO> {
  const source = await requireVersion(sourceVersionId);
  if (source.status !== "ACTIVE") throw new VersionNotActiveError();

  const versionId = await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${source.productId} FOR UPDATE`;

    const maxVersion = await tx.formulationVersion.aggregate({
      where: { productId: source.productId },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (maxVersion._max.versionNumber ?? 0) + 1;

    const version = await tx.formulationVersion.create({
      data: {
        productId: source.productId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        basisQuantity: source.basisQuantity,
        // A nova versao nasce identica a ativa: copiar so os componentes
        // deixaria linhas PER_DOSE numa versao FIXED_BASIS sem doses —
        // formula quebrada no primeiro calculo.
        calculationMode: source.calculationMode,
        dosesPerPackage: source.dosesPerPackage,
        outputItemId: source.outputItemId,
        outputItemCode: source.outputItemCode,
        outputItemName: source.outputItemName,
        outputUnitCode: source.outputUnitCode,
        notes: source.notes,
        createdBy: SYSTEM_ACTOR,
        components: {
          create: source.components.map((component) => ({
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            ...(component.basis !== undefined ? { basis: component.basis } : {}),
            // Responsabilidade de fornecimento tambem e congelada aqui:
            // e intencao da versao, nao consulta ao cadastro atual.
            ...(component.supplyResponsibility !== undefined
              ? { supplyResponsibility: component.supplyResponsibility }
              : {}),
            // Pureza/overage sao SNAPSHOT: gravados aqui e nunca mais
            // reescritos por mudanca no cadastro do Item.
            ...(component.purityPercentApplied !== undefined
              ? { purityPercentApplied: component.purityPercentApplied }
              : {}),
            ...(component.overagePercent !== undefined
              ? { overagePercent: component.overagePercent }
              : {}),
            ...(component.legacyTotalQuantity !== undefined
              ? { legacyTotalQuantity: component.legacyTotalQuantity }
              : {}),
            ...(component.legacyTotalUnitCode !== undefined
              ? { legacyTotalUnitCode: component.legacyTotalUnitCode }
              : {}),
            ...(component.legacyBatchUnits !== undefined
              ? { legacyBatchUnits: component.legacyBatchUnits }
              : {}),
            notes: component.notes,
            position: component.position,
          })),
        },
      },
    });
    return version.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

/** Valida um array de componentes recebido — dedupe, tipo, ativo (so para itens NOVOS) e unidade. */
async function validateComponents(
  inputs: FormulationComponentInput[],
  previousItemIds: ReadonlySet<string>,
  units: readonly UnitOfMeasure[],
): Promise<void> {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.itemId)) {
      const item = await getPrisma().item.findUnique({ where: { id: input.itemId } });
      throw new DuplicateComponentItemError(item?.code ?? input.itemId);
    }
    seen.add(input.itemId);
  }

  for (const input of inputs) {
    const item = await getPrisma().item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ComponentItemNotFoundError(input.itemId);
    if (item.type === "FINISHED_PRODUCT") throw new InvalidComponentItemTypeError(item.code);

    // So exige item ativo para uma linha genuinamente NOVA — uma linha ja
    // existente antes desta edicao (herdada de copia de versao ACTIVE, por
    // exemplo) continua editavel mesmo que o item tenha sido inativado depois.
    if (!previousItemIds.has(input.itemId) && !item.active) {
      throw new InactiveComponentItemError(item.code);
    }

    if (new Prisma.Decimal(input.quantity).lessThanOrEqualTo(0)) {
      throw new InvalidComponentQuantityError(item.code);
    }
    if (!isUomCompatible(input.unitCode, item.unitCode, units)) {
      throw new IncompatibleComponentUnitError(item.code);
    }
  }
}

export async function updateFormulationVersion(
  id: string,
  input: UpdateFormulationVersionInput,
): Promise<FormulationVersionDTO> {
  const current = await requireVersion(id);
  if (current.status !== "DRAFT") throw new VersionNotDraftError();

  if (input.components !== undefined) {
    const previousItemIds = new Set(current.components.map((component) => component.itemId));
    const units = await getUnits();
    await validateComponents(input.components, previousItemIds, units);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.formulationVersion.update({
      where: { id },
      data: {
        ...(input.basisQuantity !== undefined ? { basisQuantity: input.basisQuantity } : {}),
        ...(input.calculationMode !== undefined
          ? { calculationMode: input.calculationMode }
          : {}),
        ...(input.dosesPerPackage !== undefined
          ? { dosesPerPackage: input.dosesPerPackage }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.components !== undefined) {
      await tx.formulationComponent.deleteMany({ where: { formulationVersionId: id } });
      if (input.components.length > 0) {
        await tx.formulationComponent.createMany({
          data: input.components.map((component, index) => ({
            formulationVersionId: id,
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            ...(component.basis !== undefined ? { basis: component.basis } : {}),
            // Responsabilidade de fornecimento tambem e congelada aqui:
            // e intencao da versao, nao consulta ao cadastro atual.
            ...(component.supplyResponsibility !== undefined
              ? { supplyResponsibility: component.supplyResponsibility }
              : {}),
            // Pureza/overage sao SNAPSHOT: gravados aqui e nunca mais
            // reescritos por mudanca no cadastro do Item.
            ...(component.purityPercentApplied !== undefined
              ? { purityPercentApplied: component.purityPercentApplied }
              : {}),
            ...(component.overagePercent !== undefined
              ? { overagePercent: component.overagePercent }
              : {}),
            ...(component.legacyTotalQuantity !== undefined
              ? { legacyTotalQuantity: component.legacyTotalQuantity }
              : {}),
            ...(component.legacyTotalUnitCode !== undefined
              ? { legacyTotalUnitCode: component.legacyTotalUnitCode }
              : {}),
            ...(component.legacyBatchUnits !== undefined
              ? { legacyBatchUnits: component.legacyBatchUnits }
              : {}),
            ...(component.notes !== undefined ? { notes: component.notes } : {}),
            position: index,
          })),
        });
      }
    }
  });

  return (await getFormulationVersionById(id))!;
}

export async function activateFormulationVersion(id: string): Promise<FormulationVersionDTO> {
  const version = await requireVersion(id);
  if (version.status !== "DRAFT") throw new VersionNotDraftError();

  const product = await getPrisma().product.findUnique({
    where: { id: version.productId },
    include: { finishedProductItem: true },
  });
  if (!product) throw new ProductNotFoundError(version.productId);

  const reasons: string[] = [];
  if (!product.active) reasons.push("o produto está inativo");
  if (!product.finishedProductItemId || !product.finishedProductItem) {
    reasons.push("o produto não possui item de produto acabado vinculado");
  } else {
    if (!product.finishedProductItem.active) reasons.push("o item de produto acabado está inativo");
    if (product.finishedProductItem.type !== "FINISHED_PRODUCT") {
      reasons.push("o item de saída não é mais um produto acabado");
    }
  }
  if (new Prisma.Decimal(version.basisQuantity).lessThanOrEqualTo(0)) {
    reasons.push("a base da formulação deve ser maior que zero");
  }
  if (version.components.length === 0) {
    reasons.push("adicione ao menos um componente antes de ativar");
  }

  const units = await getUnits();
  const invalidComponents: string[] = [];
  for (const component of version.components) {
    const item = component.item;
    if (!item.active) invalidComponents.push(`${item.code} (inativo)`);
    else if (item.type === "FINISHED_PRODUCT") invalidComponents.push(`${item.code} (produto acabado)`);
    else if (new Prisma.Decimal(component.quantity).lessThanOrEqualTo(0)) {
      invalidComponents.push(`${item.code} (quantidade inválida)`);
    } else if (!isUomCompatible(component.unitCode, item.unitCode, units)) {
      invalidComponents.push(`${item.code} (unidade incompatível)`);
    }
  }
  if (invalidComponents.length > 0) {
    reasons.push(`componentes precisam de revisão: ${invalidComponents.join(", ")}`);
  }

  // Material fornecido pelo cliente só existe se houver cliente: sem isso a
  // fórmula fica ambígua ("qual cliente envia?"). O DRAFT continua livre
  // para edição — o bloqueio é só na ativação.
  const hasCustomerComponent = version.components.some(
    (component) => component.supplyResponsibility === "CUSTOMER",
  );
  if (hasCustomerComponent && !product.customerId) {
    reasons.push(
      "há componentes fornecidos pelo cliente, mas o produto não está vinculado a um cliente",
    );
  }

  if (reasons.length > 0) {
    throw new FormulationActivationError(
      `Não é possível ativar esta versão: ${reasons.join("; ")}.`,
    );
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${version.productId} FOR UPDATE`;

    const previousActive = await tx.formulationVersion.findFirst({
      where: { productId: version.productId, status: "ACTIVE" },
    });
    if (previousActive) {
      await tx.formulationVersion.update({
        where: { id: previousActive.id },
        data: { status: "INACTIVE", inactivatedAt: new Date(), inactivatedBy: SYSTEM_ACTOR },
      });
    }

    await tx.formulationVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: SYSTEM_ACTOR },
    });
  });

  return (await getFormulationVersionById(id))!;
}
