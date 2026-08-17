import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";
import type { User, UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { ForbiddenError, NotAuthenticatedError } from "../modules/auth/auth.errors.js";
import { SESSION_COOKIE, resolveSessionUser } from "../modules/auth/auth.service.js";

/**
 * Contexto de usuário da requisição.
 *
 * Regra central de auditoria GMP: quem executou uma ação vem SEMPRE da
 * sessão, nunca de um campo enviado pelo frontend. Nenhum service aceita
 * `executedBy` como texto livre.
 */
declare module "fastify" {
  interface FastifyRequest {
    currentUser?: User;
  }

  interface FastifyContextConfig {
    /** Rota que serve arquivo do frontend — pública por natureza. */
    publicAsset?: boolean;
  }
}

/** Rotas que existem justamente para quem ainda não tem sessão. */
const PUBLIC_ROUTES = new Set([
  "/health",
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/auth/session",
]);

export function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_ROUTES.has(path);
}

/** Lê o token de sessão do cookie (sem dependência extra de parser). */
export function readSessionToken(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Hook global: resolve a sessão e exige usuário autenticado em toda rota
 * operacional. Login/health ficam de fora — o resto do sistema, não.
 */
export async function authenticationHook(
  request: FastifyRequest<RouteGenericInterface>,
  reply: FastifyReply,
): Promise<void> {
  const user = await resolveSessionUser(readSessionToken(request));
  if (user) request.currentUser = user;

  if (isPublicRoute(request.url)) return;

  /**
   * Arquivo do build do frontend (marcado como `publicAsset` no registro do
   * estático) ou rota do próprio SPA, que não casa rota nenhuma da API e cai
   * no `notFoundHandler` — ele devolve o `index.html` e quem decide o que
   * aparece é a tela de login.
   *
   * A liberação é por rota, nunca por caminho ou cabeçalho: endpoint de dados
   * sempre casa uma rota da API sem essa marca, então não há como escapar da
   * sessão pedindo HTML.
   */
  if (request.routeOptions?.config?.publicAsset === true) return;
  if (!request.routeOptions?.url) return;

  if (!user) {
    await reply.status(401).send({
      error: "not_authenticated",
      message: new NotAuthenticatedError().message,
    });
  }
}

/** Usuário da sessão, garantido. Usar nos services/rotas auditados. */
export function requireCurrentUser(request: FastifyRequest): User {
  const user = request.currentUser;
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** Gate simples de perfil — sem matriz de permissão por botão nesta fase. */
export function requireRole(request: FastifyRequest, ...roles: UserRole[]): User {
  const user = requireCurrentUser(request);
  if (!roles.includes(user.role)) throw new ForbiddenError();
  return user;
}

/** Cookie de sessão: HttpOnly sempre, Secure quando em produção (HTTPS). */
export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
