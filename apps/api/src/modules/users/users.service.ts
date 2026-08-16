import type { User } from "@prisma/client";
import type { UserDTO, UserListResponse } from "@veridi/shared";
import { USER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { hashPassword } from "../../lib/password.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { EmailAlreadyUsedError, UserNotFoundError } from "./users.errors.js";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./users.schemas.js";

const CODE_SEQUENCE = "user_code_seq";

function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    code: user.code,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** E-mail é sempre normalizado antes de gravar/consultar. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listUsers(
  query: ListUsersQuery,
  pagination: Pagination = query,
): Promise<UserListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.active !== undefined) where["active"] = query.active;
  if (query.role) where["role"] = query.role;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { code: "asc" }, ...pageArgs(pagination) }),
    prisma.user.count({ where }),
  ]);

  return { users: users.map(toUserDTO), ...pageMeta(pagination, total) };
}

export async function getUserById(id: string): Promise<UserDTO | null> {
  const user = await getPrisma().user.findUnique({ where: { id } });
  return user ? toUserDTO(user) : null;
}

export async function createUser(input: CreateUserInput): Promise<UserDTO> {
  const prisma = getPrisma();
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailAlreadyUsedError(email);

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, USER_CODE_PREFIX);
  const user = await prisma.user.create({
    data: {
      code,
      name: input.name,
      email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      active: true,
    },
  });
  return toUserDTO(user);
}

/**
 * Edita cadastro. Senha nunca muda por aqui — troca de senha é ação
 * explícita e separada.
 */
export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDTO> {
  const prisma = getPrisma();
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new UserNotFoundError(id);

  const email = input.email !== undefined ? normalizeEmail(input.email) : undefined;
  if (email && email !== current.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new EmailAlreadyUsedError(email);
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });

  // Inativar derruba o acesso na hora: as sessões abertas deixam de valer.
  if (input.active === false) {
    await prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return toUserDTO(user);
}

/** Reset explícito de senha; invalida as sessões abertas do usuário. */
export async function resetUserPassword(id: string, password: string): Promise<UserDTO> {
  const prisma = getPrisma();
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new UserNotFoundError(id);

  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password) },
  });
  await prisma.userSession.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return toUserDTO(user);
}
