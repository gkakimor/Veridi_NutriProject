import { Prisma } from "@prisma/client";
import type { Customer, Item, Product } from "@prisma/client";
import type { ProductDTO, ProductListResponse } from "@veridi/shared";
import { PRODUCT_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  CustomerNotFoundError,
  DuplicateFinishedItemError,
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
};

function toProductDTO(product: ProductWithRelations): ProductDTO {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    customerId: product.customerId,
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
    externalCode: product.externalCode,
    notes: product.notes,
    active: product.active,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
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
      include: { customer: true, finishedProductItem: true },
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
    include: { customer: true, finishedProductItem: true },
  });
  return product ? toProductDTO(product) : null;
}

export async function createProduct(input: CreateProductInput): Promise<ProductDTO> {
  if (input.customerId) await assertCustomerForNewAssociation(input.customerId);
  if (input.finishedProductItemId) {
    await assertFinishedItemForNewAssociation(input.finishedProductItemId);
  }

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PRODUCT_CODE_PREFIX);

  try {
    const product = await prisma.product.create({
      data: {
        code,
        name: input.name,
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.finishedProductItemId !== undefined
          ? { finishedProductItemId: input.finishedProductItemId }
          : {}),
        ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: { customer: true, finishedProductItem: true },
    });
    return toProductDTO(product);
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

  // So valida novamente se a associacao esta MUDANDO — mantem vinculo
  // historico intacto mesmo se o Customer/Item ligado foi inativado depois.
  if (input.customerId !== undefined && input.customerId !== current.customerId) {
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
        ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: { customer: true, finishedProductItem: true },
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
    include: { customer: true, finishedProductItem: true },
  });
  return toProductDTO(product);
}

export async function deactivateProduct(id: string): Promise<ProductDTO> {
  await requireProduct(id);
  const product = await getPrisma().product.update({
    where: { id },
    data: { active: false },
    include: { customer: true, finishedProductItem: true },
  });
  return toProductDTO(product);
}
