import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { SESSION_COOKIE, hashSessionToken } from "./auth.service.js";

/** Capacidade 36 — autenticação real, sessão e administração de usuários. */

const fixtureUserIds: string[] = [];
const PASSWORD = "senha-de-teste-forte";

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureUserIds.length > 0) {
    await prisma.userSession.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  }
});

async function createUserDirect(overrides: { role?: "ADMIN" | "PRODUCTION"; active?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const user = await prisma.user.create({
    data: {
      code: `USR-AUTH-${m}`,
      name: `Usuário Auth ${m}`,
      email: `auth-${m}@veridi.local`,
      passwordHash: await hashPassword(PASSWORD),
      role: overrides.role ?? "PRODUCTION",
      active: overrides.active ?? true,
    },
  });
  fixtureUserIds.push(user.id);
  return user;
}

function sessionCookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0]! : String(raw);
  return header.split(";")[0]!;
}

describe("Autenticação", () => {
  it("login correto abre sessão em cookie HttpOnly e /auth/me devolve o usuário", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createUserDirect();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(user.id);
    // O token nunca volta no corpo — só no cookie.
    expect(JSON.stringify(response.json())).not.toContain(SESSION_COOKIE);
    const cookieHeader = String(
      Array.isArray(response.headers["set-cookie"])
        ? response.headers["set-cookie"][0]
        : response.headers["set-cookie"],
    );
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Lax");

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: sessionCookieOf(response) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(user.email);

    await app.close();
  });

  it("senha errada e usuário inativo recebem a mesma resposta genérica", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createUserDirect();
    const inactive = await createUserDirect({ active: false });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "senha-errada-mesmo" },
    });
    const inactiveLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: inactive.email, password: PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(inactiveLogin.statusCode).toBe(401);
    // A mensagem não revela se a conta existe nem se está inativa.
    expect(inactiveLogin.json().message).toBe(wrongPassword.json().message);

    await app.close();
  });

  it("logout invalida a sessão", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createUserDirect();

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(login);

    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);

    await app.close();
  });

  it("rota operacional sem sessão responde 401", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/items" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("not_authenticated");

    // Health continua público — é o que monitora a aplicação.
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);

    await app.close();
  });

  it("sessão expirada deixa de ser aceita", async () => {
    const app = buildApp();
    await app.ready();
    const prisma = getPrisma();
    const user = await createUserDirect();

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(login);
    const token = cookie.split("=").slice(1).join("=");

    await prisma.userSession.update({
      where: { tokenHash: hashSessionToken(decodeURIComponent(token)) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);

    await app.close();
  });

  it("inativar o usuário derruba a sessão aberta na hora", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const rawApp = buildApp();
    await rawApp.ready();

    const created = (
      await app.inject({
        method: "POST",
        url: "/users",
        payload: {
          name: `Operador ${marker()}`,
          email: `operador-${marker()}@veridi.local`,
          password: PASSWORD,
          role: "PRODUCTION",
        },
      })
    ).json();
    fixtureUserIds.push(created.id);

    const login = await rawApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: created.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(login);
    expect((await rawApp.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(200);

    await app.inject({ method: "PATCH", url: `/users/${created.id}`, payload: { active: false } });

    const me = await rawApp.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);

    await app.close();
    await rawApp.close();
  });

  it("senha nunca é armazenada em texto puro", async () => {
    const prisma = getPrisma();
    const user = await createUserDirect();
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
    expect(await verifyPassword("outra-senha-qualquer", stored.passwordHash)).toBe(false);
  });
});

describe("Administração de usuários", () => {
  it("ADMIN cria usuário; outro perfil não administra usuários", async () => {
    const adminApp = buildTestApp("ADMIN");
    await adminApp.ready();
    const productionApp = buildTestApp("PRODUCTION");
    await productionApp.ready();

    const created = await adminApp.inject({
      method: "POST",
      url: "/users",
      payload: {
        name: `Usuário Criado ${marker()}`,
        email: `criado-${marker()}@veridi.local`,
        password: PASSWORD,
        role: "QUALITY",
      },
    });
    expect(created.statusCode).toBe(201);
    fixtureUserIds.push(created.json().id);
    expect(created.json().code.startsWith("USR-")).toBe(true);

    const forbidden = await productionApp.inject({ method: "GET", url: "/users" });
    expect(forbidden.statusCode).toBe(403);

    const forbiddenCreate = await productionApp.inject({
      method: "POST",
      url: "/users",
      payload: {
        name: "Tentativa",
        email: `tentativa-${marker()}@veridi.local`,
        password: PASSWORD,
        role: "ADMIN",
      },
    });
    expect(forbiddenCreate.statusCode).toBe(403);

    await adminApp.close();
    await productionApp.close();
  });

  it("usuário inativado continua existindo — histórico não é apagado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { user } = await createAuthenticatedUser("QUALITY");

    const updated = await app.inject({
      method: "PATCH",
      url: `/users/${user.id}`,
      payload: { active: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().active).toBe(false);

    const stillThere = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();

    // Volta ao ar para não afetar outros arquivos que reutilizam o perfil.
    await app.inject({ method: "PATCH", url: `/users/${user.id}`, payload: { active: true } });
    await app.close();
  });
});
