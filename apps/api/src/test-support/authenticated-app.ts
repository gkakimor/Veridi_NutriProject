import { randomBytes } from "node:crypto";
import type { User, UserRole } from "@prisma/client";
import type { InjectOptions } from "fastify";
import { buildApp } from "../app.js";
import type { App } from "../app.js";
import { getPrisma } from "../db/prisma.js";
import { hashPassword } from "../lib/password.js";
import { SESSION_COOKIE, hashSessionToken } from "../modules/auth/auth.service.js";

/**
 * Suporte de teste para o sistema autenticado.
 *
 * A suíte inteira roda contra rotas protegidas, então cada teste precisa de
 * uma sessão. Em vez de espalhar login em centenas de casos, `buildTestApp`
 * devolve a mesma interface do `buildApp` com o cookie de sessão anexado
 * automaticamente — a autenticação é real (usuário, hash de senha e sessão
 * no banco), não um bypass.
 */

const cachedUsers = new Map<UserRole, { user: User; cookie: string }>();

/** Usuário reutilizável por perfil — criar um por teste seria desperdício. */
export async function createAuthenticatedUser(
  role: UserRole = "ADMIN",
): Promise<{ user: User; cookie: string }> {
  const cached = cachedUsers.get(role);
  if (cached) {
    // O usuário pode ter sido apagado por um cleanup de outro arquivo.
    const stillThere = await getPrisma().user.findUnique({ where: { id: cached.user.id } });
    if (stillThere) return cached;
    cachedUsers.delete(role);
  }

  const prisma = getPrisma();
  const marker = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      code: `USR-TEST-${role}-${marker}`,
      name: `Usuário de Teste ${role}`,
      email: `teste-${role.toLowerCase()}-${marker}@veridi.local`,
      passwordHash: await hashPassword(`senha-de-teste-${marker}`),
      role,
      active: true,
    },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.userSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const entry = { user, cookie: `${SESSION_COOKIE}=${token}` };
  cachedUsers.set(role, entry);
  return entry;
}

/**
 * App de teste: mesma interface do `buildApp()` (`ready`/`close`/`inject`),
 * com `inject` anexando o cookie de sessão do perfil escolhido. Um teste que
 * queira exercitar o comportamento SEM sessão usa `buildApp()` direto.
 */
export function buildTestApp(role: UserRole = "ADMIN") {
  const app = buildApp();
  const originalInject = app.inject.bind(app);

  return new Proxy(app, {
    get(target, property, receiver) {
      if (property !== "inject") return Reflect.get(target, property, receiver);

      return async (options: InjectOptions | string) => {
        const { cookie } = await createAuthenticatedUser(role);
        const request: InjectOptions = typeof options === "string" ? { url: options } : options;
        const headers = (request.headers ?? {}) as Record<string, string>;
        return originalInject({
          ...request,
          headers: { ...headers, cookie: headers["cookie"] ?? cookie },
        });
      };
    },
  }) as App;
}
