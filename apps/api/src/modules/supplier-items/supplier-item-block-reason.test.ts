import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Supplier, UserRole } from "@prisma/client";
import { ITEM_TYPE_DEFAULTS, MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { marcadorDoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";

/**
 * Bloquear a relação Item × Fornecedor exige motivo —
 * SUPPLIER-QUALITY-REJECTION-REASON-01.
 *
 * O motivo é a observação do evento de homologação (`note`), que já existia: sem
 * migration e sem segundo campo. `BLOCKED` sem motivo é 400 `validation_error` na
 * rota de homologação e na criação já bloqueada, e nada é gravado. Homologar e
 * voltar para pendente seguem sem obrigatoriedade. A recusa por perfil continua
 * antes: quem não decide ouve 403, não "falta o motivo". Bloqueio antigo sem
 * observação continua legível e não impede nenhuma decisão seguinte.
 */

const itens: string[] = [];
const fornecedores: string[] = [];

type App = ReturnType<typeof buildTestApp>;
type Situacao = "PENDING" | "APPROVED" | "BLOCKED";

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

async function criarItem(): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-BLOQ-${m}`,
      name: `Item motivo do bloqueio ${m}`,
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
    data: { code: `FOR-BLOQ-${m}`, legalName: `Fornecedor motivo do bloqueio ${m}`, active: true },
  });
  fornecedores.push(fornecedor.id);
  return fornecedor;
}

function decidir(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/supplier-items/${id}/qualification`, payload });
}

/**
 * Relação homologada e preferencial, com a história que a API grava: Compras cria
 * (null → PENDING), a Qualidade homologa (PENDING → APPROVED) e Compras marca o
 * preferencial.
 */
async function relacaoHomologadaPreferencial(): Promise<{ id: string; itemId: string }> {
  const item = await criarItem();
  const fornecedor = await criarFornecedor();
  const criada = await comApp("PURCHASING", async (app) => {
    const resposta = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: fornecedor.id },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    return resposta.json();
  });
  await comApp("QUALITY", async (app) => {
    const resposta = await decidir(app, criada.id, { status: "APPROVED", note: "CoA conferido" });
    expect(resposta.statusCode, resposta.body).toBe(200);
  });
  await comApp("PURCHASING", async (app) => {
    const resposta = await app.inject({
      method: "POST",
      url: `/supplier-items/${criada.id}/preferred`,
      payload: { preferred: true },
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
  });
  return { id: criada.id, itemId: item.id };
}

/** Tudo o que uma recusa não pode ter mexido: situação, preferencial, autoria e histórico. */
async function retrato(id: string) {
  const prisma = getPrisma();
  const [relacao, eventos] = await Promise.all([
    prisma.supplierItem.findUniqueOrThrow({ where: { id } }),
    prisma.supplierItemQualificationHistory.findMany({
      where: { supplierItemId: id },
      orderBy: { changedAt: "asc" },
    }),
  ]);
  return {
    qualificationStatus: relacao.qualificationStatus,
    preferred: relacao.preferred,
    updatedAt: relacao.updatedAt.toISOString(),
    updatedByNameSnapshot: relacao.updatedByNameSnapshot,
    eventos: eventos.map((evento) => [evento.id, evento.fromStatus, evento.toStatus, evento.note]),
  };
}

const RECUSA_SEM_MOTIVO = (campo: string) => ({
  error: "validation_error",
  message: MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE,
  issues: [{ path: campo, message: MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE }],
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — bloquear pela rota de homologação", () => {
  it.each([
    ["sem o campo", {}],
    ["nulo", { note: null }],
    ["vazio", { note: "" }],
    ["só espaços", { note: "     " }],
    ["dois caracteres", { note: " ok " }],
  ] as const)("motivo %s: 400 validation_error com a frase, e nada gravado", async (_caso, motivo) => {
    const relacao = await relacaoHomologadaPreferencial();
    const antes = await retrato(relacao.id);

    for (const role of ["QUALITY", "ADMIN"] as const) {
      await comApp(role, async (app) => {
        const resposta = await decidir(app, relacao.id, { status: "BLOCKED", ...motivo });
        expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(400);
        expect(resposta.json(), role).toEqual(RECUSA_SEM_MOTIVO("note"));
      });
    }

    // Continua homologada e preferencial; nenhum evento novo, nenhuma autoria trocada.
    expect(await retrato(relacao.id)).toEqual(antes);
    expect(antes).toMatchObject({ qualificationStatus: "APPROVED", preferred: true });
  });

  it("com motivo: bloqueia, grava o motivo aparado no evento novo, e os eventos anteriores ficam como estavam", async () => {
    const relacao = await relacaoHomologadaPreferencial();
    const { user: qualidade } = await createAuthenticatedUser("QUALITY");
    const antes = await comApp("QUALITY", async (app) =>
      (await app.inject({ method: "GET", url: `/supplier-items/${relacao.id}` })).json(),
    );
    expect(antes.qualificationHistory).toHaveLength(2);

    const bloqueada = await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, relacao.id, {
        status: "BLOCKED",
        note: "  Laudo reprovado: teor de cafeína abaixo da especificação  ",
      });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });

    expect(bloqueada.qualificationStatus).toBe("BLOCKED");
    // Fornecedor bloqueado nunca continua preferencial — regra de antes, na mesma transação.
    expect(bloqueada.preferred).toBe(false);
    expect(bloqueada.qualificationHistory).toHaveLength(3);
    expect(bloqueada.qualificationHistory.slice(0, 2)).toEqual(antes.qualificationHistory);
    expect(bloqueada.qualificationHistory[2]).toMatchObject({
      fromStatus: "APPROVED",
      toStatus: "BLOCKED",
      note: "Laudo reprovado: teor de cafeína abaixo da especificação",
      changedByName: qualidade.name,
    });

    // O que a resposta diz é o que o banco guarda.
    const gravado = await getPrisma().supplierItemQualificationHistory.findUniqueOrThrow({
      where: { id: bloqueada.qualificationHistory[2].id },
    });
    expect(gravado).toMatchObject({
      fromStatus: "APPROVED",
      toStatus: "BLOCKED",
      note: "Laudo reprovado: teor de cafeína abaixo da especificação",
      changedByUserId: qualidade.id,
    });
  });

  it("três caracteres bastam, e o Administrador bloqueia como a Qualidade", async () => {
    const relacao = await relacaoHomologadaPreferencial();
    const { user: admin } = await createAuthenticatedUser("ADMIN");

    const bloqueada = await comApp("ADMIN", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "BLOCKED", note: "CoA" });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(bloqueada.qualificationHistory.at(-1)).toMatchObject({
      toStatus: "BLOCKED",
      note: "CoA",
      changedByName: admin.name,
    });
  });

  it("homologar e voltar para pendente seguem sem motivo — a observação continua opcional", async () => {
    const relacao = await relacaoHomologadaPreferencial();
    await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "BLOCKED", note: "Especificação divergente" });
      expect(resposta.statusCode, resposta.body).toBe(200);
    });

    const pendente = await comApp("PURCHASING", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "PENDING" });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(pendente.qualificationStatus).toBe("PENDING");
    expect(pendente.qualificationHistory.at(-1)).toMatchObject({
      fromStatus: "BLOCKED",
      toStatus: "PENDING",
      note: null,
    });

    const homologada = await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "APPROVED" });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(homologada.qualificationStatus).toBe("APPROVED");
    expect(
      homologada.qualificationHistory.map(
        (evento: { fromStatus: Situacao | null; toStatus: Situacao; note: string | null }) => [
          evento.fromStatus,
          evento.toStatus,
          evento.note,
        ],
      ),
    ).toEqual([
      [null, "PENDING", null],
      ["PENDING", "APPROVED", "CoA conferido"],
      ["APPROVED", "BLOCKED", "Especificação divergente"],
      ["BLOCKED", "PENDING", null],
      ["PENDING", "APPROVED", null],
    ]);
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — quem decide vem antes do motivo", () => {
  it.each(["PURCHASING", "PRODUCTION", "COMMERCIAL", "VIEWER"] as const)(
    "%s: bloquear é 403 com e sem motivo — nunca 'falta o motivo' — e nada gravado",
    async (role) => {
      const relacao = await relacaoHomologadaPreferencial();
      const antes = await retrato(relacao.id);

      await comApp(role, async (app) => {
        for (const payload of [{ status: "BLOCKED" }, { status: "BLOCKED", note: "Laudo reprovado" }]) {
          const resposta = await decidir(app, relacao.id, payload);
          expect(resposta.statusCode, `${role} ${JSON.stringify(payload)}`).toBe(403);
          expect(resposta.json().error).toBe("forbidden");
        }
      });

      expect(await retrato(relacao.id)).toEqual(antes);
    },
  );

  it("a ordem é perfil → motivo → existência: relação inexistente sem motivo é 400, com motivo é 404", async () => {
    await comApp("PURCHASING", async (app) => {
      expect((await decidir(app, ID_INEXISTENTE, { status: "BLOCKED" })).statusCode).toBe(403);
    });
    await comApp("QUALITY", async (app) => {
      const semMotivo = await decidir(app, ID_INEXISTENTE, { status: "BLOCKED" });
      expect(semMotivo.statusCode, semMotivo.body).toBe(400);
      expect(semMotivo.json()).toEqual(RECUSA_SEM_MOTIVO("note"));

      const comMotivo = await decidir(app, ID_INEXISTENTE, { status: "BLOCKED", note: "Laudo reprovado" });
      expect(comMotivo.statusCode, comMotivo.body).toBe(404);
    });
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — a criação já bloqueada é a outra porta", () => {
  it("Administrador sem motivo: 400 em qualificationNote, e nada nasce — nem relação, nem oferta, nem histórico", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("ADMIN", async (app) => {
      for (const motivo of [{}, { qualificationNote: "  " }, { qualificationNote: "no" }]) {
        const resposta = await app.inject({
          method: "POST",
          url: "/supplier-items",
          payload: {
            itemId: item.id,
            supplierId: fornecedor.id,
            qualificationStatus: "BLOCKED",
            ...motivo,
            initialOffer: { unitPrice: "272", priceUomCode: "kg", effectiveAt: hoje() },
          },
        });
        expect(resposta.statusCode, `${JSON.stringify(motivo)}: ${resposta.body}`).toBe(400);
        expect(resposta.json()).toEqual(RECUSA_SEM_MOTIVO("qualificationNote"));
      }
    });

    const prisma = getPrisma();
    expect(await prisma.supplierItem.count({ where: { itemId: item.id } })).toBe(0);
    expect(await prisma.supplierItemOffer.count({ where: { supplierItem: { itemId: item.id } } })).toBe(0);
    expect(
      await prisma.supplierItemQualificationHistory.count({ where: { supplierItem: { itemId: item.id } } }),
    ).toBe(0);
  });

  it("Administrador com motivo: nasce bloqueada com um evento null → BLOCKED que guarda o motivo", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("ADMIN", async (app) => {
      const resposta = await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: {
          itemId: item.id,
          supplierId: fornecedor.id,
          qualificationStatus: "BLOCKED",
          qualificationNote: " Fornecedor não homologado na auditoria ",
        },
      });
      expect(resposta.statusCode, resposta.body).toBe(201);
      expect(resposta.json().qualificationHistory).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: "BLOCKED",
          note: "Fornecedor não homologado na auditoria",
        }),
      ]);
    });
  });

  it("Compras pedindo Bloqueado sem motivo ouve o 403 de quem não decide, não o 400 do motivo", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    await comApp("PURCHASING", async (app) => {
      const resposta = await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: { itemId: item.id, supplierId: fornecedor.id, qualificationStatus: "BLOCKED" },
      });
      expect(resposta.statusCode, resposta.body).toBe(403);
      expect(resposta.json().error).toBe("forbidden");
    });
    expect(await getPrisma().supplierItem.count({ where: { itemId: item.id } })).toBe(0);
  });

  it("homologada e pendente na criação seguem sem motivo", async () => {
    const item = await criarItem();
    const [a, b] = [await criarFornecedor(), await criarFornecedor()];

    await comApp("ADMIN", async (app) => {
      for (const [fornecedor, situacao] of [
        [a, "APPROVED"],
        [b, "PENDING"],
      ] as const) {
        const resposta = await app.inject({
          method: "POST",
          url: "/supplier-items",
          payload: { itemId: item.id, supplierId: fornecedor.id, qualificationStatus: situacao },
        });
        expect(resposta.statusCode, `${situacao}: ${resposta.body}`).toBe(201);
        expect(resposta.json().qualificationHistory).toEqual([
          expect.objectContaining({ fromStatus: null, toStatus: situacao, note: null }),
        ]);
      }
    });
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — bloqueio antigo sem motivo", () => {
  it("continua válido: o detalhe devolve o evento como foi gravado, e homologar ou voltar para pendente não pedem motivo retroativo", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const prisma = getPrisma();
    // O que existia antes da regra: bloqueio gravado sem observação.
    const relacao = await prisma.supplierItem.create({
      data: { itemId: item.id, supplierId: fornecedor.id, qualificationStatus: "BLOCKED", active: true },
    });
    const legado = await prisma.supplierItemQualificationHistory.create({
      data: {
        supplierItemId: relacao.id,
        fromStatus: "APPROVED",
        toStatus: "BLOCKED",
        changedAt: new Date("2026-03-10T15:00:00.000Z"),
        changedByNameSnapshot: "Qualidade (antes da regra)",
      },
    });

    const lido = await comApp("VIEWER", async (app) => {
      const resposta = await app.inject({ method: "GET", url: `/supplier-items/${relacao.id}` });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(lido.qualificationStatus).toBe("BLOCKED");
    expect(lido.qualificationHistory).toEqual([
      {
        id: legado.id,
        fromStatus: "APPROVED",
        toStatus: "BLOCKED",
        note: null,
        changedAt: "2026-03-10T15:00:00.000Z",
        changedByName: "Qualidade (antes da regra)",
      },
    ]);

    const pendente = await comApp("PURCHASING", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "PENDING" });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(pendente.qualificationHistory[0]).toEqual(lido.qualificationHistory[0]);

    const homologada = await comApp("QUALITY", async (app) => {
      const resposta = await decidir(app, relacao.id, { status: "APPROVED" });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    });
    expect(homologada.qualificationStatus).toBe("APPROVED");
    // O evento antigo segue sem motivo: nada foi preenchido nem reescrito.
    expect(homologada.qualificationHistory[0]).toEqual(lido.qualificationHistory[0]);
    expect(
      (await prisma.supplierItemQualificationHistory.findUniqueOrThrow({ where: { id: legado.id } })).note,
    ).toBeNull();
  });
});
