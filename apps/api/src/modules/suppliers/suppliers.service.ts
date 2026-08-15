import { Prisma } from "@prisma/client";
import type { Supplier } from "@prisma/client";
import type { SupplierDTO, SupplierListResponse } from "@veridi/shared";
import { SUPPLIER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { DuplicateCnpjError, SupplierNotFoundError } from "./suppliers.errors.js";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "./suppliers.schemas.js";

const CODE_SEQUENCE = "supplier_code_seq";

function toSupplierDTO(supplier: Supplier): SupplierDTO {
  return {
    id: supplier.id,
    code: supplier.code,
    legalName: supplier.legalName,
    tradeName: supplier.tradeName,
    cnpj: supplier.cnpj,
    email: supplier.email,
    phone: supplier.phone,
    notes: supplier.notes,
    active: supplier.active,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

async function assertCnpjAvailable(cnpj: string, excludeId?: string): Promise<void> {
  const existing = await getPrisma().supplier.findFirst({
    where: { cnpj, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new DuplicateCnpjError(cnpj);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function requireSupplier(id: string): Promise<Supplier> {
  const supplier = await getPrisma().supplier.findUnique({ where: { id } });
  if (!supplier) throw new SupplierNotFoundError(id);
  return supplier;
}

export async function listSuppliers(
  query: ListSuppliersQuery,
): Promise<SupplierListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.active !== undefined) where["active"] = query.active;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { legalName: { contains: query.search, mode: "insensitive" } },
      { tradeName: { contains: query.search, mode: "insensitive" } },
      { cnpj: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    suppliers: suppliers.map(toSupplierDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getSupplierById(id: string): Promise<SupplierDTO | null> {
  const supplier = await getPrisma().supplier.findUnique({ where: { id } });
  return supplier ? toSupplierDTO(supplier) : null;
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<SupplierDTO> {
  if (input.cnpj) await assertCnpjAvailable(input.cnpj);

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, SUPPLIER_CODE_PREFIX);

  try {
    const supplier = await prisma.supplier.create({
      data: {
        code,
        legalName: input.legalName,
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return toSupplierDTO(supplier);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
): Promise<SupplierDTO> {
  await requireSupplier(id);
  if (input.cnpj) await assertCnpjAvailable(input.cnpj, id);

  try {
    const supplier = await getPrisma().supplier.update({
      where: { id },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return toSupplierDTO(supplier);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}

export async function activateSupplier(id: string): Promise<SupplierDTO> {
  await requireSupplier(id);
  const supplier = await getPrisma().supplier.update({
    where: { id },
    data: { active: true },
  });
  return toSupplierDTO(supplier);
}

export async function deactivateSupplier(id: string): Promise<SupplierDTO> {
  await requireSupplier(id);
  const supplier = await getPrisma().supplier.update({
    where: { id },
    data: { active: false },
  });
  return toSupplierDTO(supplier);
}
