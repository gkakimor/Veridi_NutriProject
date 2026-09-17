import { Prisma } from "@prisma/client";
import type { Supplier, User } from "@prisma/client";
import type { SupplierDTO, SupplierListResponse } from "@veridi/shared";
import { SUPPLIER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { exigirNomeDeCadastroLivre } from "../../lib/nome-de-cadastro-mestre.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  DuplicateCnpjError,
  InvalidSupplierStatusTransitionError,
  SupplierNotFoundError,
} from "./suppliers.errors.js";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "./suppliers.schemas.js";

const CODE_SEQUENCE = "supplier_code_seq";

/**
 * Os campos de endereço, na ordem do formulário.
 *
 * Uma lista só: o DTO, o create e o update leem dela. Campo acrescentado ao
 * endereço entra nos três caminhos de uma vez — a alternativa é o campo que
 * grava mas não volta na leitura, e isso só aparece meses depois.
 */
const ADDRESS_FIELDS = [
  "street",
  "number",
  "complement",
  "district",
  "zipCode",
  "city",
  "state",
] as const;

type AddressField = (typeof ADDRESS_FIELDS)[number];

/** O que veio no payload, só as chaves presentes — ausente não mexe no gravado. */
function addressData(
  input: { [K in AddressField]?: string | null | undefined },
): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (const field of ADDRESS_FIELDS) {
    if (input[field] !== undefined) data[field] = input[field] as string | null;
  }
  return data;
}

function toSupplierDTO(supplier: Supplier): SupplierDTO {
  return {
    id: supplier.id,
    code: supplier.code,
    legalName: supplier.legalName,
    tradeName: supplier.tradeName,
    cnpj: supplier.cnpj,
    email: supplier.email,
    phone: supplier.phone,
    street: supplier.street,
    number: supplier.number,
    complement: supplier.complement,
    district: supplier.district,
    zipCode: supplier.zipCode,
    city: supplier.city,
    state: supplier.state,
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
  pagination: Pagination = query,
): Promise<SupplierListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.ids && query.ids.length > 0) where["id"] = { in: query.ids };
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
      ...pageArgs(pagination),
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    suppliers: suppliers.map(toSupplierDTO),
    ...pageMeta(pagination, total),
  };
}

export async function getSupplierById(id: string): Promise<SupplierDTO | null> {
  const supplier = await getPrisma().supplier.findUnique({ where: { id } });
  return supplier ? toSupplierDTO(supplier) : null;
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<SupplierDTO> {
  await exigirNomeDeCadastroLivre("SUPPLIER", input.legalName);
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
        ...addressData(input),
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
  if (input.legalName !== undefined) await exigirNomeDeCadastroLivre("SUPPLIER", input.legalName, id);
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
        ...addressData(input),
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

/**
 * Troca de situação: a gravação só acontece se o Fornecedor estiver na situação
 * de partida, e a condição mora no próprio UPDATE — dois pedidos concorrentes
 * não partem da mesma situação, e o segundo cai no 409.
 *
 * Reativar passa por aqui; inativar tem caminho próprio, porque limpa o
 * preferencial das relações na mesma transação.
 */
async function mudarSituacaoDoFornecedor(id: string, active: boolean): Promise<SupplierDTO> {
  const prisma = getPrisma();
  const { count } = await prisma.supplier.updateMany({
    where: { id, active: !active },
    data: { active },
  });
  if (count === 0) {
    await requireSupplier(id);
    throw new InvalidSupplierStatusTransitionError(active);
  }
  return toSupplierDTO(await prisma.supplier.findUniqueOrThrow({ where: { id } }));
}

export async function activateSupplier(id: string): Promise<SupplierDTO> {
  return mudarSituacaoDoFornecedor(id, true);
}

/**
 * Inativar o Fornecedor tira dele o preferencial de todo item —
 * SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112 (decisão D8 do PO).
 *
 * Preferencial é "de quem se compra este item": fornecedor inativo não pode
 * responder isso, e o motor de custo já o ignorava — o item ficava apontando
 * para um fornecedor que ninguém pode escolher. Só o preferencial cai: as
 * relações, as ofertas e o histórico de homologação ficam inteiros, e reativar o
 * fornecedor NÃO devolve o preferencial, que é decisão de Compras.
 *
 * Na mesma transação da inativação: um preferencial que sobrevive à queda da
 * gravação seguinte é exatamente o estado que esta regra existe para não deixar.
 */
export async function deactivateSupplier(
  id: string,
  actor: Pick<User, "id" | "name">,
): Promise<SupplierDTO> {
  const prisma = getPrisma();
  const supplier = await prisma.$transaction(async (tx) => {
    const { count } = await tx.supplier.updateMany({
      where: { id, active: true },
      data: { active: false },
    });
    if (count === 0) {
      await requireSupplier(id);
      throw new InvalidSupplierStatusTransitionError(false);
    }
    await tx.supplierItem.updateMany({
      where: { supplierId: id, preferred: true },
      data: { preferred: false, updatedByUserId: actor.id, updatedByNameSnapshot: actor.name },
    });
    return tx.supplier.findUniqueOrThrow({ where: { id } });
  });
  return toSupplierDTO(supplier);
}
