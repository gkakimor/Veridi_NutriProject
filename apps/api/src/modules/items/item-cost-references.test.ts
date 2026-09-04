import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Referência manual de custo do Item — a porta de entrada.
 *
 * Histórico por vigência (nada é sobrescrito), unidade coerente com a do
 * item, papel de quem define, e a criação do item já com referência inicial
 * — atômica: referência recusada não deixa item pela metade.
 */

const fixtureItemIds: string[] = [];

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  if (fixtureItemIds.length > 0) {
    await getPrisma().item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

async function createItem(unitCode = "kg") {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-REF-${m}`,
      name: `Item Referência ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

describe("Referência manual de custo do Item", () => {
  it("alterar cria vigência nova; a anterior fica no histórico; a seleção automática mostra a manual", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const item = await createItem();

    const vazio = (await app.inject({ method: "GET", url: `/items/${item.id}/cost-references` })).json();
    expect(vazio.current).toBeNull();
    expect(vazio.history).toEqual([]);
    expect(vazio.automatic.source).toBe("NO_COST");
    expect(vazio.automatic.unitCost).toBeNull();

    const primeira = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "1.200,50".replace(".", ""), note: "Cotação de balcão" },
    });
    expect(primeira.statusCode, primeira.body).toBe(201);
    expect(primeira.json().current.unitCost).toBe("1200.5");
    expect(primeira.json().current.uomCode).toBe("kg");
    expect(primeira.json().current.createdByName).toBeTruthy();
    expect(primeira.json().automatic.source).toBe("MANUAL_REFERENCE");
    expect(primeira.json().automatic.unitCost).toBe("1200.500000");

    const segunda = (
      await app.inject({
        method: "POST",
        url: `/items/${item.id}/cost-references`,
        payload: { unitCost: "1300" },
      })
    ).json();
    expect(segunda.current.unitCost).toBe("1300");
    expect(segunda.history).toHaveLength(2);
    expect(segunda.history[0].current).toBe(true);
    expect(segunda.history[1].current).toBe(false);
    expect(segunda.history[1].unitCost).toBe("1200.5");
    await app.close();
  });

  it("recusa valor negativo e unidade incompatível; zero é zero explícito", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem("kg");

    const negativo = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "-1" },
    });
    expect(negativo.statusCode).toBe(400);
    expect(negativo.json().error).toBe("invalid_cost_reference");

    const incompativel = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "10", uomCode: "un" },
    });
    expect(incompativel.statusCode).toBe(400);
    expect(incompativel.json().error).toBe("cost_reference_unit_incompatible");

    const zero = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "0" },
    });
    expect(zero.statusCode).toBe(201);
    expect(zero.json().automatic.unitCost).toBe("0.000000");
    await app.close();
  });

  it("definir referência é papel de COMMERCIAL/ADMIN; consultar é de qualquer usuário", async () => {
    const leitor = buildTestApp("VIEWER");
    await leitor.ready();
    const item = await createItem();
    const recusado = await leitor.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "10" },
    });
    expect(recusado.statusCode).toBe(403);
    const leitura = await leitor.inject({ method: "GET", url: `/items/${item.id}/cost-references` });
    expect(leitura.statusCode).toBe(200);
    await leitor.close();
  });

  it("criar item já com referência inicial — e nada fica pela metade quando ela é recusada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();
    const m = marker();

    const criado = await app.inject({
      method: "POST",
      url: "/items",
      payload: {
        type: "RAW_MATERIAL",
        name: `Com referência ${m}`,
        unitCode: "g",
        initialCostReference: { unitCost: "1200", uomCode: "kg", note: "Estimativa inicial" },
      },
    });
    expect(criado.statusCode, criado.body).toBe(201);
    fixtureItemIds.push(criado.json().id);
    const refs = (
      await app.inject({ method: "GET", url: `/items/${criado.json().id}/cost-references` })
    ).json();
    expect(refs.current.unitCost).toBe("1200");
    expect(refs.current.uomCode).toBe("kg");
    // Item em gramas, referência por quilo: a seleção converte.
    expect(refs.automatic.unitCost).toBe("1.200000");

    const nome = `Sem item ${m}`;
    const recusado = await app.inject({
      method: "POST",
      url: "/items",
      payload: {
        type: "RAW_MATERIAL",
        name: nome,
        unitCode: "kg",
        initialCostReference: { unitCost: "10", uomCode: "un" },
      },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("cost_reference_unit_incompatible");
    expect(await prisma.item.findFirst({ where: { name: nome } })).toBeNull();

    // Sem referência inicial o item continua válido.
    const semReferencia = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: `Sem referência ${m}`, unitCode: "kg" },
    });
    expect(semReferencia.statusCode).toBe(201);
    fixtureItemIds.push(semReferencia.json().id);
    await app.close();
  });
});
