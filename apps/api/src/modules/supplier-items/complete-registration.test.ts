import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Cadastro completo de Item × Fornecedor numa ação só.
 *
 * A auditoria VAL-LEG-01 cadastrou quatro materiais e terminou com quatro
 * relações `PENDING` e sem preço: a grade mostrava homologação,
 * preferencial, preço e MOQ, e o formulário não pedia nenhum dos quatro. O
 * custo de material ficou sem referência comercial nenhuma para consultar.
 *
 * Fixtures próprias, sem leitura global e sem `deleteMany` aberto.
 */

const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem(app: App) {
  const item = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: `Item SI ${marca()}`, unitCode: "kg" },
    })
  ).json();
  fixtureItemIds.push(item.id);
  return item;
}

async function criarFornecedor(app: App) {
  const supplier = (
    await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Fornecedor SI ${marca()}` },
    })
  ).json();
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

describe("Item × Fornecedor — cadastro completo em uma ação", () => {
  const app = buildTestApp();

  it("relação sem oferta continua sendo registro legítimo", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const response = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: supplier.id },
    });
    expect(response.statusCode).toBe(201);
    const criada = response.json();
    expect(criada.qualificationStatus).toBe("PENDING");
    expect(criada.preferred).toBe(false);
    expect(criada.offers).toHaveLength(0);
    // Sem preço é diferente de preço zero.
    expect(criada.currentOffer).toBeNull();
  });

  it("cria relação com preço na mesma chamada", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const criada = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: supplier.id,
          initialOffer: { unitPrice: "272", priceUomCode: "kg" },
        },
      })
    ).json();

    expect(criada.offers).toHaveLength(1);
    expect(criada.offers[0].unitPrice).toBe("272");
    expect(criada.offers[0].priceUomCode).toBe("kg");
    // Oferta continua sendo entidade própria, com a origem de sempre.
    expect(criada.offers[0].source).toBe("MANUAL");
  });

  it("preço, pedido mínimo, homologação e preferencial de uma vez", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const criada = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: supplier.id,
          supplierItemCode: "SW-CAF-01",
          qualificationStatus: "APPROVED",
          qualificationNote: "Auditoria 2026",
          preferred: true,
          initialOffer: {
            unitPrice: "272",
            priceUomCode: "kg",
            minimumOrderQuantity: "25",
            minimumOrderUomCode: "kg",
          },
        },
      })
    ).json();

    // Exatamente as quatro colunas que a grade mostra.
    expect(criada.qualificationStatus).toBe("APPROVED");
    expect(criada.preferred).toBe(true);
    expect(criada.offers[0].unitPrice).toBe("272");
    expect(criada.offers[0].minimumOrderQuantity).toBe("25");
  });

  it("o histórico registra o que aconteceu, não um PENDING que nunca existiu", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const criada = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: supplier.id,
          qualificationStatus: "APPROVED",
          qualificationNote: "CoA conferido",
        },
      })
    ).json();

    expect(criada.qualificationHistory).toHaveLength(1);
    expect(criada.qualificationHistory[0].fromStatus).toBeNull();
    expect(criada.qualificationHistory[0].toStatus).toBe("APPROVED");
    expect(criada.qualificationHistory[0].note).toBe("CoA conferido");
  });

  it("preferencial exige homologação — a mesma regra da rota dedicada", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const recusa = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: supplier.id, preferred: true },
    });
    expect(recusa.statusCode).toBe(409);
  });

  it("um preferencial por item: o anterior perde o posto", async () => {
    const item = await criarItem(app);
    const [a, b] = [await criarFornecedor(app), await criarFornecedor(app)];

    const primeira = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: a.id,
          qualificationStatus: "APPROVED",
          preferred: true,
        },
      })
    ).json();
    expect(primeira.preferred).toBe(true);

    const segunda = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: b.id,
          qualificationStatus: "APPROVED",
          preferred: true,
        },
      })
    ).json();
    expect(segunda.preferred).toBe(true);

    const anterior = await getPrisma().supplierItem.findUniqueOrThrow({
      where: { id: primeira.id },
    });
    expect(anterior.preferred).toBe(false);
  });

  it("oferta inválida não deixa relação órfã para trás", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const recusa = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: {
        itemId: item.id,
        supplierId: supplier.id,
        // Unidade de tempo não converte para a unidade de massa do item.
        initialOffer: { unitPrice: "10", priceUomCode: "un" },
      },
    });
    expect(recusa.statusCode).toBeGreaterThanOrEqual(400);

    // O ponto do teste: nada foi criado pela metade.
    const relacoes = await getPrisma().supplierItem.findMany({ where: { itemId: item.id } });
    expect(relacoes).toHaveLength(0);
  });

  it("oferta criada assim continua imutável — corrigir é registrar outra", async () => {
    const [item, supplier] = [await criarItem(app), await criarFornecedor(app)];
    const criada = (
      await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: supplier.id,
          initialOffer: { unitPrice: "272", priceUomCode: "kg" },
        },
      })
    ).json();

    const segunda = await app.inject({
      method: "POST",
      url: `/supplier-items/${criada.id}/offers`,
      payload: { unitPrice: "290", priceUomCode: "kg" },
    });
    expect(segunda.statusCode).toBe(201);
    const depois = segunda.json();
    expect(depois.offers).toHaveLength(2);
    // A primeira continua lá, com o preço que tinha.
    expect(depois.offers.map((o: { unitPrice: string }) => o.unitPrice).sort()).toEqual([
      "272",
      "290",
    ]);
  });
});
