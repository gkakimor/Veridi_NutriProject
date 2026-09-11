import { afterAll, describe, expect, it } from "vitest";
import type { Prisma, UserRole } from "@prisma/client";
import { buildApp } from "../../app.js";
import type { App } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * NAVIGATION-SIDEBAR-01 — a preferência de navegação pertence ao usuário da
 * SESSÃO: menu compacto, grupos abertos e favoritos, por id estável.
 *
 * `createAuthenticatedUser` reaproveita um usuário por perfil dentro do
 * arquivo, então perfis diferentes são pessoas diferentes — é assim que o
 * isolamento entre usuários é provado.
 */

const apps: App[] = [];
const touchedUserIds = new Set<string>();

async function appAs(role: UserRole) {
  const { user } = await createAuthenticatedUser(role);
  touchedUserIds.add(user.id);
  const app = buildTestApp(role);
  await app.ready();
  apps.push(app);
  return { app, user };
}

function patch(app: App, payload: unknown) {
  return app.inject({ method: "PATCH", url: "/me/preferences", payload: payload as object });
}

function read(app: App) {
  return app.inject({ method: "GET", url: "/me/preferences" });
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  if (touchedUserIds.size > 0) {
    await getPrisma().userPreference.deleteMany({ where: { userId: { in: [...touchedUserIds] } } });
  }
});

const PADRAO = { compact: false, openGroups: [], favorites: [] };

describe("Preferências de interface — GET/PATCH /me/preferences", () => {
  it("usuário sem preferência gravada recebe o padrão: expandida, nenhum grupo, nenhum favorito", async () => {
    const { app } = await appAs("QUALITY");

    const response = await read(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ navigation: PADRAO });
  });

  it("grava e relê as próprias preferências, sem repetir id", async () => {
    const { app } = await appAs("ADMIN");

    const saved = await patch(app, {
      navigation: {
        compact: true,
        openGroups: ["commercial", "inventory"],
        favorites: ["customer-orders", "lots", "customer-orders"],
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().navigation).toEqual({
      compact: true,
      openGroups: ["commercial", "inventory"],
      favorites: ["customer-orders", "lots"],
    });
    expect((await read(app)).json().navigation).toEqual(saved.json().navigation);
  });

  it("PATCH parcial troca só o campo enviado", async () => {
    const { app } = await appAs("ADMIN");
    await patch(app, { navigation: { compact: true, openGroups: ["purchasing"], favorites: ["lots"] } });

    const response = await patch(app, { navigation: { favorites: ["receipts"] } });

    expect(response.json().navigation).toEqual({
      compact: true,
      openGroups: ["purchasing"],
      favorites: ["receipts"],
    });
  });

  it("outro usuário não herda a preferência de ninguém — nem lendo, nem gravando", async () => {
    const { app: admin } = await appAs("ADMIN");
    const { app: viewer } = await appAs("VIEWER");
    await patch(admin, { navigation: { compact: true, favorites: ["receipts"] } });

    expect((await read(viewer)).json().navigation).toEqual(PADRAO);

    await patch(viewer, { navigation: { favorites: ["lots"] } });
    expect((await read(admin)).json().navigation.favorites).toEqual(["receipts"]);
  });

  const INVALIDOS: [string, unknown][] = [
    ["compact que não é booleano", { navigation: { compact: "sim" } }],
    ["favoritos que não são lista", { navigation: { favorites: "customer-orders" } }],
    ["id que não é texto", { navigation: { favorites: [42] } }],
    ["id com markup", { navigation: { favorites: ["<b>pedidos</b>"] } }],
    ["id com espaço e maiúscula", { navigation: { openGroups: ["Comercial Geral"] } }],
    ["id longo demais", { navigation: { favorites: ["a".repeat(65)] } }],
    [
      "lista longa demais",
      { navigation: { favorites: Array.from({ length: 101 }, (_, index) => `tela-${index}`) } },
    ],
    ["campo desconhecido na navegação", { navigation: { theme: "dark" } }],
    ["seção desconhecida", { tema: { cor: "verde" } }],
    ["corpo que não é objeto", [{ navigation: { compact: true } }]],
  ];

  it.each(INVALIDOS)("payload inválido é recusado sem gravar nada: %s", async (_caso, payload) => {
    const { app } = await appAs("COMMERCIAL");
    await patch(app, { navigation: { compact: true, openGroups: [], favorites: ["projects"] } });

    const response = await patch(app, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");
    expect((await read(app)).json().navigation).toEqual({
      compact: true,
      openGroups: [],
      favorites: ["projects"],
    });
  });

  it("id bem formado que o menu não conhece é guardado — quem o ignora é a tela", async () => {
    const { app } = await appAs("PURCHASING");

    const response = await patch(app, {
      navigation: { favorites: ["tela-que-ainda-nao-existe", "receipts"], openGroups: ["grupo-antigo"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().navigation).toEqual({
      compact: false,
      openGroups: ["grupo-antigo"],
      favorites: ["tela-que-ainda-nao-existe", "receipts"],
    });
  });

  it("JSON gravado torto é lido com segurança, e seção desconhecida sobrevive à gravação", async () => {
    const { app, user } = await appAs("PRODUCTION");
    const torto: Prisma.InputJsonObject = {
      navigation: {
        compact: "sim",
        openGroups: "commercial",
        favorites: ["lots", 42, "<b>x</b>", "lots", "receipts"],
      },
      futuro: { tema: "escuro" },
    };
    const prisma = getPrisma();
    await prisma.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ui: torto },
      update: { ui: torto },
    });

    const response = await read(app);
    expect(response.statusCode).toBe(200);
    expect(response.json().navigation).toEqual({
      compact: false,
      openGroups: [],
      favorites: ["lots", "receipts"],
    });

    await patch(app, { navigation: { compact: true } });
    const row = await prisma.userPreference.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.ui).toMatchObject({
      futuro: { tema: "escuro" },
      navigation: { compact: true, openGroups: [], favorites: ["lots", "receipts"] },
    });
  });

  it("sem sessão: 401 na leitura e na gravação", async () => {
    const app = buildApp();
    await app.ready();
    apps.push(app);

    expect((await read(app)).statusCode).toBe(401);
    expect((await patch(app, { navigation: { compact: true } })).statusCode).toBe(401);
  });
});
