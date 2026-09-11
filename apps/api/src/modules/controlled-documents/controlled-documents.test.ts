import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlledDocumentType, UserRole } from "@prisma/client";
import { buildApp } from "../../app.js";
import type { App } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * QUALITY-DOC-WRITE-01 — quem administra revisão de documento controlado.
 *
 * Registrar e ativar revisão: Qualidade e ADMIN. Ler: qualquer usuário
 * autenticado, porque a impressão precisa do cabeçalho. Os demais perfis
 * continuam só lendo — e a recusa não mexe em nada.
 *
 * Roda na faixa serial (`vitest.serial.config.ts`): ativar revisão troca a
 * revisão VIGENTE do banco inteiro, e o release de OP de outro arquivo
 * congelaria a revisão deste teste. No fim a vigente de antes volta, e as
 * revisões criadas aqui saem.
 */

const TIPO: ControlledDocumentType = "RECIPE_SHEET";
/** `revision` aceita até 20 caracteres: marca curta, única por execução. */
const MARCA = `${Date.now().toString().slice(-5)}${Math.random().toString(36).slice(2, 4)}`;

const apps: App[] = [];
const criadas: string[] = [];
let vigenteAntes: string | null = null;

/** Embrulhado: a instância é thenable, e `await` a desembrulharia. */
async function appAs(role: UserRole): Promise<{ app: App }> {
  const app = buildTestApp(role);
  await app.ready();
  apps.push(app);
  return { app };
}

async function criar(app: App, prefixo: string) {
  const response = await app.inject({
    method: "POST",
    url: "/controlled-documents",
    payload: { type: TIPO, revision: `${prefixo}-${MARCA}` },
  });
  if (response.statusCode === 201) criadas.push(response.json().id as string);
  return response;
}

beforeAll(async () => {
  const vigente = await getPrisma().controlledDocumentRevision.findFirst({
    where: { type: TIPO, active: true },
  });
  vigenteAntes = vigente?.id ?? null;
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.controlledDocumentRevision.updateMany({
      where: { type: TIPO, active: true },
      data: { active: false },
    });
    if (vigenteAntes) {
      await tx.controlledDocumentRevision.update({
        where: { id: vigenteAntes },
        data: { active: true },
      });
    }
  });
  if (criadas.length > 0) {
    await prisma.controlledDocumentRevision.deleteMany({ where: { id: { in: criadas } } });
  }
  await Promise.all(apps.map((app) => app.close()));
});

describe("Documento controlado — quem registra e ativa revisão", () => {
  it.each([
    ["ADMIN", "A-ADM"],
    ["QUALITY", "A-QUA"],
  ] as const)("%s cria e ativa revisão", async (role, prefixo) => {
    const { app } = await appAs(role);

    const criada = await criar(app, prefixo);
    expect(criada.statusCode).toBe(201);
    expect(criada.json().active).toBe(false);

    const ativada = await app.inject({
      method: "POST",
      url: `/controlled-documents/${criada.json().id}/activate`,
    });
    expect(ativada.statusCode).toBe(200);
    expect(ativada.json().active).toBe(true);
  });

  it.each([
    ["PRODUCTION", "PRO"],
    ["PURCHASING", "PUR"],
    ["COMMERCIAL", "COM"],
    ["VIEWER", "VIE"],
  ] as const)("%s lê, mas não cria nem ativa", async (role, sigla) => {
    const { app: admin } = await appAs("ADMIN");
    const alvo = await criar(admin, `T-${sigla}`);
    expect(alvo.statusCode).toBe(201);

    const { app } = await appAs(role);
    expect((await app.inject({ method: "GET", url: "/controlled-documents" })).statusCode).toBe(200);

    const criada = await criar(app, `N-${sigla}`);
    expect(criada.statusCode).toBe(403);
    expect(criada.json().error).toBe("forbidden");

    const ativada = await app.inject({
      method: "POST",
      url: `/controlled-documents/${alvo.json().id}/activate`,
    });
    expect(ativada.statusCode).toBe(403);

    // A recusa não mexeu em nada: a revisão continua inativa.
    const depois = await getPrisma().controlledDocumentRevision.findUniqueOrThrow({
      where: { id: alvo.json().id as string },
    });
    expect(depois.active).toBe(false);
  });

  it("sem sessão: 401 para criar e para ativar", async () => {
    const app = buildApp();
    await app.ready();
    apps.push(app);

    const criada = await app.inject({
      method: "POST",
      url: "/controlled-documents",
      payload: { type: TIPO, revision: `X-${MARCA}` },
    });
    expect(criada.statusCode).toBe(401);

    const ativada = await app.inject({
      method: "POST",
      url: `/controlled-documents/${criadas[0] ?? "sem-revisao"}/activate`,
    });
    expect(ativada.statusCode).toBe(401);
  });
});
