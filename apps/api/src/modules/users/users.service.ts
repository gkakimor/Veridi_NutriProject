import type { User } from "@prisma/client";
import type { UserDTO, UserListResponse } from "@veridi/shared";
import { USER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { hashPassword } from "../../lib/password.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  EmailAlreadyUsedError,
  LastActiveAdminError,
  SelfDeactivationError,
  SelfDemotionError,
  UserNotFoundError,
} from "./users.errors.js";
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
 *
 * Guarda do administrador (USER-LAST-ADMIN-GUARD-01, §120): a alteração que
 * tira alguém do conjunto de ADMIN ativo — inativar, ou trocar o perfil por
 * outro — é recusada quando ele é o último; e quem está autenticado
 * (`actorId`) nunca faz isso consigo mesmo, nem havendo outro ADMIN.
 *
 * Contar e gravar sem trava deixaria dois administradores, cada um rebaixando
 * o outro ao mesmo tempo, lerem "há outro ADMIN" e zerarem a lista. Por isso a
 * edição inteira corre numa transação que começa travando as linhas de ADMIN
 * ativo: a segunda edição espera a primeira confirmar, e só então relê o alvo e
 * conta.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<UserDTO> {
  const email = input.email !== undefined ? normalizeEmail(input.email) : undefined;

  const user = await getPrisma().$transaction(async (tx) => {
    // Em ordem de id: duas edições simultâneas travam as mesmas linhas na mesma
    // ordem, sem deadlock, e a segunda só segue depois que a primeira confirma.
    // `FOR NO KEY UPDATE` e não `FOR UPDATE`: não disputa com o `FOR KEY SHARE`
    // que toda gravação com autor (chave estrangeira para `users`) toma na
    // linha de quem assina — só quem edita usuário espera. Quem vira ADMIN
    // ativo depois desta leitura fica fora da trava, mas só soma na contagem
    // abaixo — e tirá-lo do conjunto passa por esta mesma trava.
    await tx.$queryRaw`
      SELECT id FROM users WHERE role = 'ADMIN' AND active ORDER BY id FOR NO KEY UPDATE
    `;

    // Lido depois da trava: numa corrida, é o estado que a outra edição deixou.
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new UserNotFoundError(id);

    const inativa = input.active === false && current.active;
    const tiraAdmin =
      current.role === "ADMIN" && input.role !== undefined && input.role !== "ADMIN";

    // O último vem antes do "a si mesmo": sendo os dois, quem pede não tem a
    // quem recorrer, e a frase certa é a do sistema sem administrador.
    if (current.role === "ADMIN" && current.active && (inativa || tiraAdmin)) {
      const outrosAdmins = await tx.user.count({
        where: { role: "ADMIN", active: true, id: { not: id } },
      });
      if (outrosAdmins === 0) throw new LastActiveAdminError();
    }
    if (id === actorId && inativa) throw new SelfDeactivationError();
    if (id === actorId && tiraAdmin) throw new SelfDemotionError();

    if (email && email !== current.email) {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new EmailAlreadyUsedError(email);
    }

    const atualizado = await tx.user.update({
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
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return atualizado;
  });

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
