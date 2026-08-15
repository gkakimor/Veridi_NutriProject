import { Prisma } from "@prisma/client";
import type { Customer } from "@prisma/client";
import type { CustomerDTO, CustomerListResponse } from "@veridi/shared";
import { CUSTOMER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { CustomerNotFoundError, DuplicateCnpjError } from "./customers.errors.js";
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from "./customers.schemas.js";

const CODE_SEQUENCE = "customer_code_seq";

function toCustomerDTO(customer: Customer): CustomerDTO {
  return {
    id: customer.id,
    code: customer.code,
    legalName: customer.legalName,
    tradeName: customer.tradeName,
    cnpj: customer.cnpj,
    email: customer.email,
    phone: customer.phone,
    city: customer.city,
    state: customer.state,
    notes: customer.notes,
    active: customer.active,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

async function assertCnpjAvailable(cnpj: string, excludeId?: string): Promise<void> {
  const existing = await getPrisma().customer.findFirst({
    where: { cnpj, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new DuplicateCnpjError(cnpj);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function requireCustomer(id: string): Promise<Customer> {
  const customer = await getPrisma().customer.findUnique({ where: { id } });
  if (!customer) throw new CustomerNotFoundError(id);
  return customer;
}

export async function listCustomers(
  query: ListCustomersQuery,
): Promise<CustomerListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.active !== undefined) where["active"] = query.active;
  if (query.state) where["state"] = query.state;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { legalName: { contains: query.search, mode: "insensitive" } },
      { tradeName: { contains: query.search, mode: "insensitive" } },
      { cnpj: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    customers: customers.map(toCustomerDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getCustomerById(id: string): Promise<CustomerDTO | null> {
  const customer = await getPrisma().customer.findUnique({ where: { id } });
  return customer ? toCustomerDTO(customer) : null;
}

export async function createCustomer(
  input: CreateCustomerInput,
): Promise<CustomerDTO> {
  if (input.cnpj) await assertCnpjAvailable(input.cnpj);

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CUSTOMER_CODE_PREFIX);

  try {
    const customer = await prisma.customer.create({
      data: {
        code,
        legalName: input.legalName,
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return toCustomerDTO(customer);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDTO> {
  await requireCustomer(id);
  if (input.cnpj) await assertCnpjAvailable(input.cnpj, id);

  try {
    const customer = await getPrisma().customer.update({
      where: { id },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return toCustomerDTO(customer);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}

export async function activateCustomer(id: string): Promise<CustomerDTO> {
  await requireCustomer(id);
  const customer = await getPrisma().customer.update({
    where: { id },
    data: { active: true },
  });
  return toCustomerDTO(customer);
}

export async function deactivateCustomer(id: string): Promise<CustomerDTO> {
  await requireCustomer(id);
  const customer = await getPrisma().customer.update({
    where: { id },
    data: { active: false },
  });
  return toCustomerDTO(customer);
}
