import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import type { ProductionOrderDTO, ProductionProfileDTO } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Quem opera a Ordem de Produção pela porta direta — PRODUCTION-ROUTE-ASSIGNMENT-01.
 *
 * Produção e Administração criam, editam, aplicam ou trocam roteiro, planejam,
 * liberam e cancelam. Comercial, Qualidade, Compras e Leitura ENXERGAM a ordem,
 * e o servidor recusa a escrita com 403 antes de olhar o corpo. A OP que nasce
 * do Pedido tem a rota do Plano de Atendimento, coberta em `fulfillment-plan.test.ts`.
 */

type App = ReturnType<typeof buildTestApp>;
const admin: App = buildTestApp("ADMIN");
const producao: App = buildTestApp("PRODUCTION");
const outrosPerfis: UserRole[] = ["COMMERCIAL", "VIEWER", "QUALITY", "PURCHASING"];
const apps = new Map<UserRole, App>(outrosPerfis.map((perfil) => [perfil, buildTestApp(perfil)]));

const fixtureOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProfileIds: string[] = [];

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

let productId: string;
let versionId: string;

beforeAll(async () => {
  await admin.ready();
  await producao.ready();
  for (const app of apps.values()) await app.ready();

  const prisma = getPrisma();
  for (const unit of [
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const acabado = await prisma.item.create({
    data: { type: "FINISHED_PRODUCT", code: `PA-PERM-${proximo()}`, name: `Acabado ${marca}`, unitCode: "un" },
  });
  const materia = await prisma.item.create({
    data: { type: "RAW_MATERIAL", code: `MP-PERM-${proximo()}`, name: `Matéria ${marca}`, unitCode: "kg" },
  });
  fixtureItemIds.push(acabado.id, materia.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-PERM-${proximo()}`, name: `Produto ${marca}`, finishedProductItemId: acabado.id },
  });
  fixtureProductIds.push(produto.id);
  productId = produto.id;

  const formulacao = (await admin.inject({ method: "POST", url: `/products/${productId}/formulation-versions`, payload: {} })).json();
  await admin.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulacao.id}`,
    payload: { basisQuantity: "1000", components: [{ itemId: materia.id, quantity: "10", unitCode: "kg" }] },
  });
  expect((await admin.inject({ method: "POST", url: `/formulation-versions/${formulacao.id}/activate` })).statusCode).toBe(200);

  const perfil = (
    await admin.inject({
      method: "POST",
      url: "/production-profiles",
      payload: { name: `Roteiro ${proximo()}`, referenceQuantity: "1000", referenceUomCode: "un" },
    })
  ).json() as ProductionProfileDTO;
  fixtureProfileIds.push(perfil.id);
  versionId = perfil.draftVersion!.id;
  await admin.inject({
    method: "PATCH",
    url: `/production-profile-versions/${versionId}`,
    payload: { steps: [{ name: "Mistura", setupDurationMinutes: 0, runDurationMinutes: 60, scalingMode: "PROPORTIONAL", resources: [] }] },
  });
  expect((await admin.inject({ method: "POST", url: `/production-profile-versions/${versionId}/activate` })).statusCode).toBe(200);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  }
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  await prisma.productionProfile.deleteMany({ where: { id: { in: fixtureProfileIds } } });
  await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  await admin.close();
  await producao.close();
  for (const app of apps.values()) await app.close();
});

async function ordemEmRascunho(): Promise<ProductionOrderDTO> {
  const criada = await admin.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity: "1000" },
  });
  expect(criada.statusCode).toBe(201);
  const ordem = criada.json() as ProductionOrderDTO;
  fixtureOrderIds.push(ordem.id);
  return ordem;
}

describe("Ordem de Produção — só Produção e Administração escrevem", () => {
  for (const perfil of outrosPerfis) {
    it(`${perfil} lê a ordem, e não cria, edita, aplica roteiro, planeja, libera nem cancela`, async () => {
      const app = apps.get(perfil)!;
      const ordem = await ordemEmRascunho();

      expect((await app.inject("/production-orders")).statusCode).toBe(200);
      expect((await app.inject(`/production-orders/${ordem.id}`)).statusCode).toBe(200);

      const tentativas = [
        app.inject({ method: "POST", url: "/production-orders", payload: { productId, plannedQuantity: "1" } }),
        app.inject({ method: "PATCH", url: `/production-orders/${ordem.id}`, payload: { notes: "Tentativa" } }),
        app.inject({
          method: "POST",
          url: `/production-orders/${ordem.id}/production-profile`,
          payload: { productionProfileVersionId: versionId },
        }),
        app.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` }),
        app.inject({ method: "POST", url: `/production-orders/${ordem.id}/release` }),
        app.inject({ method: "POST", url: `/production-orders/${ordem.id}/cancel`, payload: { reason: "Tentativa" } }),
        // Sem corpo válido: o perfil é conferido antes da validação.
        app.inject({ method: "POST", url: "/production-orders", payload: {} }),
      ];
      for (const resposta of await Promise.all(tentativas)) {
        expect(resposta.statusCode).toBe(403);
        expect(resposta.json().error).toBe("forbidden");
      }

      const relida = (await admin.inject(`/production-orders/${ordem.id}`)).json() as ProductionOrderDTO;
      expect(relida.status).toBe("DRAFT");
      expect(relida.notes).toBeNull();
    });
  }

  it("PRODUCTION cria, edita, aplica roteiro, planeja e cancela", async () => {
    const criada = await producao.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId, plannedQuantity: "1000" },
    });
    expect(criada.statusCode).toBe(201);
    const ordem = criada.json() as ProductionOrderDTO;
    fixtureOrderIds.push(ordem.id);

    expect((await producao.inject({ method: "PATCH", url: `/production-orders/${ordem.id}`, payload: { notes: "Turno A" } })).statusCode).toBe(200);

    const aplicada = await producao.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/production-profile`,
      payload: { productionProfileVersionId: versionId },
    });
    expect(aplicada.statusCode).toBe(200);
    expect((aplicada.json() as ProductionOrderDTO).planning.appliedBy).toBe("Usuário de Teste PRODUCTION");

    expect((await producao.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` })).statusCode).toBe(200);
    expect(
      (await producao.inject({ method: "POST", url: `/production-orders/${ordem.id}/cancel`, payload: { reason: "Teste de permissão" } })).statusCode,
    ).toBe(200);
  });
});
