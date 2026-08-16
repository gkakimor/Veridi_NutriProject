import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import type { AuthenticatedUserDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { verifyPassword } from "../../lib/password.js";
import { InvalidCredentialsError } from "./auth.errors.js";

/** Nome do cookie de sessão — o token bruto só existe aqui. */
export const SESSION_COOKIE = "veridi_session";

/** Sessão de 12 horas: um turno de produção, sem refresh-token. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * O banco guarda só o HASH do token: vazamento de backup não vira sessão
 * válida. SHA-256 basta aqui porque o token é aleatório de 256 bits (não é
 * segredo escolhido por humano, então não há ataque de dicionário).
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toAuthenticatedUserDTO(user: User): AuthenticatedUserDTO {
  return {
    id: user.id,
    code: user.code,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export interface LoginResult {
  user: AuthenticatedUserDTO;
  token: string;
  expiresAt: Date;
}

/**
 * Login. Credencial inválida e usuário inativo devolvem exatamente o mesmo
 * erro — a resposta nunca revela se o e-mail existe.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const prisma = getPrisma();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.active) {
    // Custo constante: sem usuário, ainda assim verificamos um hash, para não
    // vazar a existência da conta pelo tempo de resposta.
    await verifyPassword(password, "scrypt$16384$8$1$AAAA$AAAA");
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.userSession.create({
    data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt },
  });

  return { user: toAuthenticatedUserDTO(user), token, expiresAt };
}

/** Revoga a sessão do token informado. Repetir logout nunca é erro. */
export async function logout(token: string | null): Promise<void> {
  if (!token) return;
  await getPrisma().userSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve o usuário de uma sessão. `null` quando o token não existe, foi
 * revogado, expirou ou o usuário foi inativado — inativar um usuário derruba
 * o acesso imediatamente, sem esperar a sessão expirar.
 */
export async function resolveSessionUser(
  token: string | null,
  prisma: PrismaClient = getPrisma(),
): Promise<User | null> {
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.active) return null;

  return session.user;
}
