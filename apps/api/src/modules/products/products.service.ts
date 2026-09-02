import { Prisma } from "@prisma/client";
import type { Customer, Item, Product } from "@prisma/client";
import type { ProductDTO, ProductListResponse } from "@veridi/shared";
import { PRODUCT_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { createFinishedItemForProduct } from "../items/finished-item-for-product.js";
import {
  CustomerNotFoundError,
  DoseUomNotFoundError,
  FinishedUnitNotFoundError,
  DuplicateFinishedItemError,
  ProductCustomerLockedError,
  FinishedItemNotFoundError,
  InactiveCustomerError,
  InactiveFinishedItemError,
  InvalidFinishedItemTypeError,
  ProductNotFoundError,
} from "./products.errors.js";
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from "./products.schemas.js";

const CODE_SEQUENCE = "product_code_seq";

type ProductWithRelations = Product & {
  customer: Customer | null;
  finishedProductItem: Item | null;
  formulationVersions?: { id: string; versionNumber: number }[];
  originProject?: { code: string } | null;
};

/**
 * A listagem mostra a versão ACTIVE da formulação quando existir. Nenhuma
 * lógica nova de versionamento: só a leitura da versão já marcada ACTIVE.
 */
const productInclude = {
  customer: true,
  finishedProductItem: true,
  // O projeto que originou o produto continua sendo contexto útil depois de
  // aprovado — é o caminho de volta para quem veio de lá.
  originProject: { select: { code: true } },
  formulationVersions: {
    where: { status: "ACTIVE" as const },
    select: { id: true, versionNumber: true },
    take: 1,
  },
} as const;

function toProductDTO(product: ProductWithRelations): ProductDTO {
  const activeVersion = product.formulationVersions?.[0] ?? null;
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    customerId: product.customerId,
    lifecycle: product.lifecycle,
    originProjectId: product.originProjectId,
    originProjectCode: product.originProject?.code ?? null,
    customer: product.customer
      ? {
          id: product.customer.id,
          code: product.customer.code,
          legalName: product.customer.legalName,
          tradeName: product.customer.tradeName,
        }
      : null,
    finishedProductItemId: product.finishedProductItemId,
    finishedProductItem: product.finishedProductItem
      ? {
          id: product.finishedProductItem.id,
          code: product.finishedProductItem.code,
          name: product.finishedProductItem.name,
        }
      : null,
    dosageForm: product.dosageForm,
    presentationType: product.presentationType,
    capsulesPerDose: product.capsulesPerDose,
    // Decimais viajam como string — nunca float.
    doseAmount: product.doseAmount ? product.doseAmount.toString() : null,
    doseUomCode: product.doseUomCode,
    dosesPerPackage: product.dosesPerPackage,
    unitsPerShippingBox: product.unitsPerShippingBox,
    targetAgeGroup: product.targetAgeGroup,
    shelfLifeMonths: product.shelfLifeMonths,
    businessLotCode: product.businessLotCode,
    minimumBatchQuantity: product.minimumBatchQuantity
      ? product.minimumBatchQuantity.toString()
      : null,
    activeFormulationVersionId: activeVersion ? activeVersion.id : null,
    activeFormulationVersionLabel: activeVersion ? `V${activeVersion.versionNumber}` : null,
    externalCode: product.externalCode,
    notes: product.notes,
    active: product.active,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

/** A unidade da dose (mg/g/ml…) precisa existir — pode diferir da unidade de estoque. */
async function assertDoseUomExists(code: string): Promise<void> {
  const unit = await getPrisma().unitOfMeasure.findUnique({ where: { code } });
  if (!unit) throw new DoseUomNotFoundError(code);
}

/**
 * Unidade do item de produto acabado criado junto com o produto. Conferida
 * ANTES de abrir a transação: falhar dentro dela custaria um número da
 * sequence de itens por um erro de digitação.
 */
async function assertUnitExists(code: string): Promise<void> {
  const unit = await getPrisma().unitOfMeasure.findUnique({ where: { code } });
  if (!unit) throw new FinishedUnitNotFoundError(code);
}

/** Vinculo NOVO a um Customer: precisa existir e estar ativo. */
async function assertCustomerForNewAssociation(id: string): Promise<void> {
  const customer = await getPrisma().customer.findUnique({ where: { id } });
  if (!customer) throw new CustomerNotFoundError(id);
  if (!customer.active) throw new InactiveCustomerError(id);
}

/**
 * Vinculo NOVO a um Item de produto acabado: precisa existir, ser
 * FINISHED_PRODUCT, estar ativo e nao estar associado a outro Product
 * (1:1 — pre-checagem; a constraint unique no banco e a garantia real
 * contra corrida).
 */
async function assertFinishedItemForNewAssociation(
  id: string,
  excludeProductId?: string,
): Promise<void> {
  const item = await getPrisma().item.findUnique({ where: { id } });
  if (!item) throw new FinishedItemNotFoundError(id);
  if (item.type !== "FINISHED_PRODUCT") throw new InvalidFinishedItemTypeError(id);
  if (!item.active) throw new InactiveFinishedItemError(id);

  const existing = await getPrisma().product.findFirst({
    where: {
      finishedProductItemId: id,
      ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
    },
  });
  if (existing) throw new DuplicateFinishedItemError(id);
}

/**
 * Um produto em uso não troca de Cliente.
 *
 * Pedido, ordem de produção e orçamento são o histórico de um Cliente
 * específico; mover o produto para outro dono reescreveria esse histórico
 * sem deixar rastro. Produto ainda sem uso continua livre — corrigir um
 * cliente escolhido errado no cadastro é legítimo.
 *
 * O produto nascido de Projeto também fica preso ao Cliente do projeto: são
 * a mesma decisão comercial.
 */
async function assertCustomerChangeAllowed(current: {
  id: string;
  code: string;
  originProjectId: string | null;
}): Promise<void> {
  const prisma = getPrisma();
  const [orderLines, productionOrders, quoteLines] = await Promise.all([
    prisma.customerOrderLine.count({ where: { productId: current.id } }),
    prisma.productionOrder.count({ where: { productId: current.id } }),
    prisma.quoteLine.count({ where: { productId: current.id } }),
  ]);

  const reasons: string[] = [];
  if (orderLines > 0) reasons.push("já existe pedido com este produto");
  if (productionOrders > 0) reasons.push("já existe ordem de produção");
  if (quoteLines > 0) reasons.push("já existe orçamento");
  if (current.originProjectId) reasons.push("o produto nasceu de um projeto");

  if (reasons.length > 0) throw new ProductCustomerLockedError(current.code, reasons);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function requireProduct(id: string): Promise<Product> {
  const product = await getPrisma().product.findUnique({ where: { id } });
  if (!product) throw new ProductNotFoundError(id);
  return product;
}

export async function listProducts(
  query: ListProductsQuery,
  pagination: Pagination = query,
): Promise<ProductListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.active !== undefined) where["active"] = query.active;
  if (query.customerId) where["customerId"] = query.customerId;
  if (query.productId) where["id"] = query.productId;
  if (query.lifecycle) where["lifecycle"] = query.lifecycle;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { externalCode: { contains: query.search, mode: "insensitive" } },
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
      include: productInclude,
      orderBy: { code: "asc" },
      ...pageArgs(pagination),
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products: products.map(toProductDTO),
    ...pageMeta(pagination, total),
  };
}

export async function getProductById(id: string): Promise<ProductDTO | null> {
  const product = await getPrisma().product.findUnique({
    where: { id },
    include: productInclude,
  });
  return product ? toProductDTO(product) : null;
}

/**
 * Campos do perfil industrial (capacidade 33). Chave ausente não mexe,
 * `null` limpa — mesmo idioma do resto do cadastro. Nenhum deles participa
 * de cálculo de estoque, produção ou custo nesta fase.
 */
function industrialData(input: CreateProductInput | UpdateProductInput) {
  return {
    ...(input.dosageForm !== undefined ? { dosageForm: input.dosageForm } : {}),
    ...(input.presentationType !== undefined
      ? { presentationType: input.presentationType }
      : {}),
    ...(input.capsulesPerDose !== undefined ? { capsulesPerDose: input.capsulesPerDose } : {}),
    ...(input.doseAmount !== undefined ? { doseAmount: input.doseAmount } : {}),
    ...(input.doseUomCode !== undefined ? { doseUomCode: input.doseUomCode } : {}),
    ...(input.dosesPerPackage !== undefined ? { dosesPerPackage: input.dosesPerPackage } : {}),
    ...(input.unitsPerShippingBox !== undefined
      ? { unitsPerShippingBox: input.unitsPerShippingBox }
      : {}),
    ...(input.targetAgeGroup !== undefined ? { targetAgeGroup: input.targetAgeGroup } : {}),
    ...(input.shelfLifeMonths !== undefined ? { shelfLifeMonths: input.shelfLifeMonths } : {}),
    ...(input.businessLotCode !== undefined ? { businessLotCode: input.businessLotCode } : {}),
    ...(input.minimumBatchQuantity !== undefined
      ? { minimumBatchQuantity: input.minimumBatchQuantity }
      : {}),
  };
}

/** Unidade de estoque padrão do item criado junto com o produto. */
const DEFAULT_FINISHED_UNIT = "un";

/**
 * Produto + Item de produto acabado, numa transação só.
 *
 * O usuário não cadastra mais o item de estoque à mão antes de criar o
 * produto: eram dois cadastros para uma coisa só, e a pergunta "preciso
 * criar o produto acabado duas vezes?" era o sintoma. Agora o produto traz
 * o próprio item.
 *
 * `finishedProductItemId` continua aceito — importação, migração e
 * integrações precisam poder vincular um item específico — e quando vem
 * preenchido é validado com rigor. O que mudou é que a tela normal não
 * precisa mais mandá-lo.
 *
 * Tudo numa transação: sem ela, uma falha depois da criação do item
 * deixaria um `PA-000123` órfão no cadastro, consumindo um número da
 * sequence e aparecendo na lista de itens sem pertencer a produto nenhum.
 */
export async function createProduct(input: CreateProductInput): Promise<ProductDTO> {
  await assertCustomerForNewAssociation(input.customerId);
  if (input.doseUomCode) await assertDoseUomExists(input.doseUomCode);
  if (input.finishedProductItemId) {
    await assertFinishedItemForNewAssociation(input.finishedProductItemId);
  }

  const prisma = getPrisma();
  const unitCode = input.finishedUnitCode ?? DEFAULT_FINISHED_UNIT;
  if (!input.finishedProductItemId) await assertUnitExists(unitCode);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const code = await nextSequenceCode(tx, CODE_SEQUENCE, PRODUCT_CODE_PREFIX);

      // Sem item explícito, o produto cria o seu — mesma construção usada
      // pelo produto nascido de Projeto.
      const finishedProductItemId =
        input.finishedProductItemId ??
        (
          await createFinishedItemForProduct(tx, {
            // O item de estoque nasce com o nome do produto; os dois seguem
            // independentes a partir daí — renomear o produto depois não
            // reescreve o histórico do estoque.
            name: input.name,
            unitCode,
          })
        ).id;

      return tx.product.create({
        data: {
          code,
          name: input.name,
          customerId: input.customerId,
          finishedProductItemId,
          ...industrialData(input),
          ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        include: productInclude,
      });
    });
    return toProductDTO(created);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.finishedProductItemId) {
      throw new DuplicateFinishedItemError(input.finishedProductItemId);
    }
    throw error;
  }
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductDTO> {
  const current = await requireProduct(id);
  if (input.doseUomCode) await assertDoseUomExists(input.doseUomCode);

  // So valida novamente se a associacao esta MUDANDO — mantem vinculo
  // historico intacto mesmo se o Customer/Item ligado foi inativado depois.
  if (input.customerId !== undefined && input.customerId !== current.customerId) {
    await assertCustomerChangeAllowed(current);
    if (input.customerId) await assertCustomerForNewAssociation(input.customerId);
  }
  if (
    input.finishedProductItemId !== undefined &&
    input.finishedProductItemId !== current.finishedProductItemId
  ) {
    if (input.finishedProductItemId) {
      await assertFinishedItemForNewAssociation(input.finishedProductItemId, id);
    }
  }

  try {
    const product = await getPrisma().product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.finishedProductItemId !== undefined
          ? { finishedProductItemId: input.finishedProductItemId }
          : {}),
        ...industrialData(input),
        ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: productInclude,
    });
    return toProductDTO(product);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.finishedProductItemId) {
      throw new DuplicateFinishedItemError(input.finishedProductItemId);
    }
    throw error;
  }
}

export async function activateProduct(id: string): Promise<ProductDTO> {
  await requireProduct(id);
  const product = await getPrisma().product.update({
    where: { id },
    data: { active: true },
    include: productInclude,
  });
  return toProductDTO(product);
}

export async function deactivateProduct(id: string): Promise<ProductDTO> {
  await requireProduct(id);
  const product = await getPrisma().product.update({
    where: { id },
    data: { active: false },
    include: productInclude,
  });
  return toProductDTO(product);
}
