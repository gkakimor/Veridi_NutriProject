import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Supplier, UserRole } from "@prisma/client";
import {
  ITEM_TYPE_DEFAULTS,
  SUPPLIER_ITEM_EDIT_ROLES,
  SUPPLIER_ITEM_QUALIFICATION_ROLES,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { marcadorDoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";

/**
 * Quem decide a situação da relação Item × Fornecedor —
 * ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01, decisão D3 do
 * ITEM-SUPPLIER-UX-DISCOVERY-01.
 *
 * Compras cria a relação, registra a primeira oferta e administra o
 * preferencial quando a relação for elegível — mas a relação nasce PENDENTE.
 * Homologar e bloquear são de Qualidade e Administrador, na rota de
 * homologação. A criação era a segunda porta da mesma decisão: Compras
 * cadastrava a relação já homologada. O Administrador, autoridade de exceção,
 * segue criando a relação na situação que informar.
 */

const itens: string[] = [];
const fornecedores: string[] = [];

type App = ReturnType<typeof buildTestApp>;
type Situacao = "PENDING" | "APPROVED" | "BLOCKED";

const RECUSA_DO_ATO = { error: "forbidden", message: "Seu perfil não permite esta ação." };
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** `effectiveAt` é data civil: o marcador vem do dia comercial, não do relógio. */
function hoje(): string {
  return marcadorDoDiaComercialDeTeste().toISOString();
}

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  // Ofertas e histórico saem em cascade com a relação; item e fornecedor são RESTRICT para ela.
  if (itens.length > 0) {
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
});

async function comApp<T>(role: UserRole, corpo: (app: App) => Promise<T>): Promise<T> {
  const app = buildTestApp(role);
  await app.ready();
  try {
    return await corpo(app);
  } finally {
    await app.close();
  }
}

async function criarItem() {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-QUAL-${m}`,
      name: `Item situação inicial ${m}`,
      unitCode: "kg",
      ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
      active: true,
    },
  });
  itens.push(item.id);
  return item;
}

async function criarFornecedor(): Promise<Supplier> {
  const m = marca();
  const fornecedor = await getPrisma().supplier.create({
    data: { code: `FOR-QUAL-${m}`, legalName: `Fornecedor situação inicial ${m}`, active: true },
  });
  fornecedores.push(fornecedor.id);
  return fornecedor;
}

function criarRelacao(app: App, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/supplier-items", payload });
}

function decidir(app: App, id: string, status: Situacao, note?: string) {
  return app.inject({
    method: "POST",
    url: `/supplier-items/${id}/qualification`,
    payload: note === undefined ? { status } : { status, note },
  });
}

/** O que existe no banco para o item — a prova de que a recusa não gravou nada. */
async function gravadoDoItem(itemId: string) {
  const prisma = getPrisma();
  const [relacoes, ofertas, eventos] = await Promise.all([
    prisma.supplierItem.count({ where: { itemId } }),
    prisma.supplierItemOffer.count({ where: { supplierItem: { itemId } } }),
    prisma.supplierItemQualificationHistory.count({ where: { supplierItem: { itemId } } }),
  ]);
  return { relacoes, ofertas, eventos };
}

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — as listas", () => {
  it("decidir a homologação é de Qualidade e Administrador; criar a relação segue de Compras e Administrador", () => {
    const ordenar = (roles: readonly string[]) => [...roles].sort();
    expect(ordenar(SUPPLIER_ITEM_QUALIFICATION_ROLES)).toEqual(["ADMIN", "QUALITY"]);
    // Nenhuma permissão ampliada: a lista do cadastro comercial é a de antes.
    expect(ordenar(SUPPLIER_ITEM_EDIT_ROLES)).toEqual(["ADMIN", "PURCHASING"]);
  });
});

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — Compras cria a relação pendente", () => {
  it("sem situação ou com Pendente explícita: nasce pendente, com um evento null → PENDING de quem criou", async () => {
    const item = await criarItem();
    const [a, b] = [await criarFornecedor(), await criarFornecedor()];
    const { user } = await createAuthenticatedUser("PURCHASING");

    await comApp("PURCHASING", async (app) => {
      const semSituacao = await criarRelacao(app, { itemId: item.id, supplierId: a.id });
      const explicita = await criarRelacao(app, {
        itemId: item.id,
        supplierId: b.id,
        qualificationStatus: "PENDING",
        qualificationNote: "Aguardando o laudo do fornecedor",
      });

      for (const [caso, resposta] of [
        ["sem situação", semSituacao],
        ["Pendente explícita", explicita],
      ] as const) {
        expect(resposta.statusCode, `${caso}: ${resposta.body}`).toBe(201);
        const criada = resposta.json();
        expect(criada.qualificationStatus, caso).toBe("PENDING");
        expect(criada.preferred, caso).toBe(false);
        expect(criada.qualificationHistory, caso).toHaveLength(1);
        expect(criada.qualificationHistory[0], caso).toMatchObject({
          fromStatus: null,
          toStatus: "PENDING",
          changedByName: user.name,
        });
      }
      expect(explicita.json().qualificationHistory[0].note).toBe("Aguardando o laudo do fornecedor");
    });
  });

  it.each(["APPROVED", "BLOCKED"] as const)(
    "%s pedido por Compras é 403 com o motivo, e nada nasce — nem relação, nem oferta, nem histórico",
    async (situacao) => {
      const item = await criarItem();
      const fornecedor = await criarFornecedor();

      await comApp("PURCHASING", async (app) => {
        const resposta = await criarRelacao(app, {
          itemId: item.id,
          supplierId: fornecedor.id,
          qualificationStatus: situacao,
          qualificationNote: "Auditoria 2026",
          ...(situacao === "APPROVED" ? { preferred: true } : {}),
          initialOffer: { unitPrice: "272", priceUomCode: "kg", effectiveAt: hoje() },
        });

        expect(resposta.statusCode, resposta.body).toBe(403);
        const rotulo = situacao === "APPROVED" ? "Homologado" : "Bloqueado";
        expect(resposta.json()).toEqual({
          error: "forbidden",
          message: `Seu perfil não cria a relação na situação "${rotulo}": homologar e bloquear são decisões de Qualidade ou Administrador. Crie a relação como Pendente; a homologação é feita depois, no detalhe da relação.`,
        });
      });

      expect(await gravadoDoItem(item.id)).toEqual({ relacoes: 0, ofertas: 0, eventos: 0 });
    },
  );

  it("a recusa vem antes da existência, e o corpo inválido continua 400", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("PURCHASING", async (app) => {
      const existentes = await criarRelacao(app, {
        itemId: item.id,
        supplierId: fornecedor.id,
        qualificationStatus: "APPROVED",
      });
      const inexistentes = await criarRelacao(app, {
        itemId: ID_INEXISTENTE,
        supplierId: ID_INEXISTENTE,
        qualificationStatus: "APPROVED",
      });
      expect(existentes.statusCode).toBe(403);
      // Sem a decisão, item e fornecedor inexistentes recebem a mesma resposta.
      expect(inexistentes.statusCode).toBe(403);
      expect(inexistentes.json()).toEqual(existentes.json());

      const semItem = await criarRelacao(app, { supplierId: fornecedor.id, qualificationStatus: "APPROVED" });
      expect(semItem.statusCode).toBe(400);
      expect(semItem.json().error).toBe("validation_error");
    });

    expect(await gravadoDoItem(item.id)).toEqual({ relacoes: 0, ofertas: 0, eventos: 0 });
  });

  it("pedido recusado não tira o preferencial que o item já tem", async () => {
    const item = await criarItem();
    const [atual, novo] = [await criarFornecedor(), await criarFornecedor()];
    const preferencial = await getPrisma().supplierItem.create({
      data: {
        itemId: item.id,
        supplierId: atual.id,
        qualificationStatus: "APPROVED",
        preferred: true,
        active: true,
      },
    });

    await comApp("PURCHASING", async (app) => {
      const resposta = await criarRelacao(app, {
        itemId: item.id,
        supplierId: novo.id,
        qualificationStatus: "APPROVED",
        preferred: true,
      });
      expect(resposta.statusCode, resposta.body).toBe(403);
    });

    const depois = await getPrisma().supplierItem.findMany({ where: { itemId: item.id } });
    expect(depois.map((relacao) => [relacao.id, relacao.preferred])).toEqual([[preferencial.id, true]]);
  });

  it("pendente não nasce preferencial — 409 de sempre, e nada nasce", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("PURCHASING", async (app) => {
      for (const payload of [
        { itemId: item.id, supplierId: fornecedor.id, preferred: true },
        { itemId: item.id, supplierId: fornecedor.id, qualificationStatus: "PENDING", preferred: true },
      ]) {
        const resposta = await criarRelacao(app, payload);
        expect(resposta.statusCode, resposta.body).toBe(409);
        expect(resposta.json().error).toBe("not_eligible_preferred");
      }
    });

    expect(await gravadoDoItem(item.id)).toEqual({ relacoes: 0, ofertas: 0, eventos: 0 });
  });
});

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — oferta e preferencial com a relação pendente", () => {
  it("a primeira oferta nasce com a relação pendente e só entra no custo depois da homologação; o preferencial vem em seguida, por Compras", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    const criada = await comApp("PURCHASING", async (app) => {
      const resposta = await criarRelacao(app, {
        itemId: item.id,
        supplierId: fornecedor.id,
        supplierItemCode: "SW-CAF-01",
        initialOffer: {
          unitPrice: "272",
          priceUomCode: "kg",
          minimumOrderQuantity: "25",
          minimumOrderUomCode: "kg",
          effectiveAt: hoje(),
        },
      });
      expect(resposta.statusCode, resposta.body).toBe(201);
      const relacao = resposta.json();
      expect(relacao.qualificationStatus).toBe("PENDING");
      expect(relacao.offers).toHaveLength(1);
      expect(relacao.offers[0]).toMatchObject({ unitPrice: "272", minimumOrderQuantity: "25", source: "MANUAL" });
      // A oferta existe e é referência comercial, mas a regra do custo segue a de sempre.
      expect(relacao.offers[0].eligibility).toBe("SUPPLIER_NOT_APPROVED");
      expect(relacao.costSourceToday.source).toBe("NO_COST");
      expect(relacao.costSourceToday.unitCost).toBeNull();

      // Pendente não vira preferencial, nem pela rota própria.
      const preferencialCedo = await app.inject({
        method: "POST",
        url: `/supplier-items/${relacao.id}/preferred`,
        payload: { preferred: true },
      });
      expect(preferencialCedo.statusCode).toBe(409);

      // E Compras não homologa nem bloqueia pela rota de homologação.
      for (const situacao of ["APPROVED", "BLOCKED"] as const) {
        expect((await decidir(app, relacao.id, situacao)).statusCode, situacao).toBe(403);
      }
      return relacao;
    });

    const { user: qualidade } = await createAuthenticatedUser("QUALITY");
    const homologada = await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, criada.id, "APPROVED", "CoA conferido");
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(homologada.qualificationHistory).toHaveLength(2);
    expect(homologada.qualificationHistory[0]).toEqual(criada.qualificationHistory[0]);
    expect(homologada.qualificationHistory[1]).toMatchObject({
      fromStatus: "PENDING",
      toStatus: "APPROVED",
      note: "CoA conferido",
      changedByName: qualidade.name,
    });
    expect(homologada.offers[0].eligibility).toBe("ELIGIBLE");
    expect(homologada.costSourceToday.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(homologada.costSourceToday.unitCost).toMatch(/^272(\.0+)?$/);

    await comApp("PURCHASING", async (app) => {
      const marcada = await app.inject({
        method: "POST",
        url: `/supplier-items/${criada.id}/preferred`,
        payload: { preferred: true },
      });
      expect(marcada.statusCode, marcada.body).toBe(200);
      expect(marcada.json().preferred).toBe(true);
      // Motor intocado: com uma oferta válida só, a fonte é ela, preferencial ou não.
      expect(marcada.json().costSourceToday).toMatchObject({
        source: "SUPPLIER_OFFER_SINGLE_APPROVED",
        unitCost: homologada.costSourceToday.unitCost,
      });

      const outraOferta = await app.inject({
        method: "POST",
        url: `/supplier-items/${criada.id}/offers`,
        payload: { unitPrice: "290", priceUomCode: "kg", effectiveAt: hoje() },
      });
      expect(outraOferta.statusCode, outraOferta.body).toBe(201);
      expect(outraOferta.json().offers).toHaveLength(2);
    });
  });
});

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — a Qualidade decide pela rota própria", () => {
  it("homologa, bloqueia e volta a homologar; Compras devolve para pendente; o histórico só acrescenta", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const { user: compras } = await createAuthenticatedUser("PURCHASING");
    const { user: qualidade } = await createAuthenticatedUser("QUALITY");

    const relacao = await comApp("PURCHASING", async (app) =>
      (await criarRelacao(app, { itemId: item.id, supplierId: fornecedor.id })).json(),
    );

    await comApp("QUALITY", async (app) => {
      expect((await decidir(app, relacao.id, "APPROVED", "Auditoria ok")).statusCode).toBe(200);
    });
    await comApp("PURCHASING", async (app) => {
      const marcada = await app.inject({
        method: "POST",
        url: `/supplier-items/${relacao.id}/preferred`,
        payload: { preferred: true },
      });
      expect(marcada.json().preferred).toBe(true);
    });
    const bloqueada = await comApp("QUALITY", async (app) =>
      (await decidir(app, relacao.id, "BLOCKED", "Não conformidade recorrente")).json(),
    );
    expect(bloqueada.qualificationStatus).toBe("BLOCKED");
    // Fornecedor bloqueado nunca continua preferencial.
    expect(bloqueada.preferred).toBe(false);

    const pendente = await comApp("PURCHASING", async (app) => {
      const resposta = await decidir(app, relacao.id, "PENDING", "Novo laudo solicitado");
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(pendente.qualificationStatus).toBe("PENDING");

    const final = await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, relacao.id, "APPROVED", "Novo laudo aprovado");
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });

    expect(
      final.qualificationHistory.map(
        (evento: { fromStatus: Situacao | null; toStatus: Situacao; changedByName: string }) => [
          evento.fromStatus,
          evento.toStatus,
          evento.changedByName,
        ],
      ),
    ).toEqual([
      [null, "PENDING", compras.name],
      ["PENDING", "APPROVED", qualidade.name],
      ["APPROVED", "BLOCKED", qualidade.name],
      ["BLOCKED", "PENDING", compras.name],
      ["PENDING", "APPROVED", qualidade.name],
    ]);
    // Os eventos anteriores continuam os mesmos: nada foi reescrito.
    expect(final.qualificationHistory.slice(0, 4)).toEqual(pendente.qualificationHistory);
  });

  it("a Qualidade não cria a relação — nem pendente, nem homologada", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("QUALITY", async (app) => {
      for (const situacao of [undefined, "APPROVED"] as const) {
        const resposta = await criarRelacao(app, {
          itemId: item.id,
          supplierId: fornecedor.id,
          ...(situacao ? { qualificationStatus: situacao } : {}),
        });
        expect(resposta.statusCode, String(situacao)).toBe(403);
        expect(resposta.json(), String(situacao)).toEqual(RECUSA_DO_ATO);
      }
    });

    expect(await gravadoDoItem(item.id)).toEqual({ relacoes: 0, ofertas: 0, eventos: 0 });
  });

  it.each(["PRODUCTION", "COMMERCIAL", "VIEWER"] as const)(
    "%s: não cria, não homologa, não bloqueia e não devolve para pendente",
    async (role) => {
      const item = await criarItem();
      const fornecedor = await criarFornecedor();
      const relacao = await getPrisma().supplierItem.create({
        data: { itemId: item.id, supplierId: fornecedor.id, qualificationStatus: "APPROVED", active: true },
      });

      await comApp(role, async (app) => {
        const outroFornecedor = await criarFornecedor();
        const criar = await criarRelacao(app, { itemId: item.id, supplierId: outroFornecedor.id });
        expect(criar.statusCode, `${role} criar`).toBe(403);
        for (const situacao of ["PENDING", "APPROVED", "BLOCKED"] as const) {
          const resposta = await decidir(app, relacao.id, situacao);
          expect(resposta.statusCode, `${role} ${situacao}`).toBe(403);
        }
      });

      const depois = await getPrisma().supplierItem.findMany({ where: { itemId: item.id } });
      expect(depois.map((linha) => [linha.id, linha.qualificationStatus])).toEqual([[relacao.id, "APPROVED"]]);
      expect(await gravadoDoItem(item.id)).toMatchObject({ relacoes: 1, eventos: 0 });
    },
  );
});

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — o Administrador segue como autoridade de exceção", () => {
  it("cria já homologada, com observação, preferencial e oferta — um evento null → APPROVED", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const { user: admin } = await createAuthenticatedUser("ADMIN");

    await comApp("ADMIN", async (app) => {
      const resposta = await criarRelacao(app, {
        itemId: item.id,
        supplierId: fornecedor.id,
        qualificationStatus: "APPROVED",
        qualificationNote: "Auditoria 2026",
        preferred: true,
        initialOffer: { unitPrice: "272", priceUomCode: "kg", effectiveAt: hoje() },
      });
      expect(resposta.statusCode, resposta.body).toBe(201);
      const criada = resposta.json();
      expect(criada.qualificationStatus).toBe("APPROVED");
      expect(criada.preferred).toBe(true);
      expect(criada.qualificationHistory).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: "APPROVED",
          note: "Auditoria 2026",
          changedByName: admin.name,
        }),
      ]);
      expect(criada.offers[0].eligibility).toBe("ELIGIBLE");
      expect(criada.costSourceToday.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    });
  });

  it("cria já bloqueada — um evento null → BLOCKED; bloqueada não nasce preferencial", async () => {
    const item = await criarItem();
    const [a, b] = [await criarFornecedor(), await criarFornecedor()];

    await comApp("ADMIN", async (app) => {
      const bloqueada = await criarRelacao(app, {
        itemId: item.id,
        supplierId: a.id,
        qualificationStatus: "BLOCKED",
        qualificationNote: "Reprovado na auditoria",
      });
      expect(bloqueada.statusCode, bloqueada.body).toBe(201);
      expect(bloqueada.json().qualificationStatus).toBe("BLOCKED");
      expect(bloqueada.json().qualificationHistory).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: "BLOCKED", note: "Reprovado na auditoria" }),
      ]);

      const preferencialBloqueada = await criarRelacao(app, {
        itemId: item.id,
        supplierId: b.id,
        qualificationStatus: "BLOCKED",
        preferred: true,
      });
      expect(preferencialBloqueada.statusCode).toBe(409);
    });

    expect(await gravadoDoItem(item.id)).toEqual({ relacoes: 1, ofertas: 0, eventos: 1 });
  });
});
