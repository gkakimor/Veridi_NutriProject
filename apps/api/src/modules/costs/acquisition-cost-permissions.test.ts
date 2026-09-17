import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@veridi/shared";
import { ACQUISITION_COST_ROLES, USER_ROLES } from "@veridi/shared";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { getConsumedLotCostReference } from "../../lib/cost-reference.js";

/**
 * ACQUISITION-COST-PERMISSION-01 — quem informa o custo efetivo de aquisição.
 *
 * O custo da linha de recebimento é a fonte REAL do lote e entra nas médias de
 * 30 e 90 dias do Item. Duas portas gravam esse número: o PUT depois do
 * recebimento e o próprio recebimento com `actualUnitCost`. As duas são de
 * Compras e Administrador; receber sem custo continua aberto a toda sessão, e
 * consultar também.
 *
 * A matriz é escrita aqui por extenso, e não lida da constante: trocar a lista
 * do shared sem trocar a regra derruba este arquivo.
 */

const AUTORIZADOS: UserRole[] = ["PURCHASING", "ADMIN"];
const RECUSADOS: UserRole[] = ["PRODUCTION", "QUALITY", "COMMERCIAL", "VIEWER"];

const DAY_MS = 24 * 60 * 60 * 1000;
const LINHA_INEXISTENTE = "00000000-0000-4000-8000-00000000ac01";
const OC_INEXISTENTE = "00000000-0000-4000-8000-00000000ac02";

type App = ReturnType<typeof buildTestApp>;

const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const apps = new Map<UserRole, App>();

/** Um app por perfil no arquivo inteiro — subir um por caso seria só custo. */
async function appDo(role: UserRole): Promise<App> {
  const existente = apps.get(role);
  if (existente) return existente;
  const app = buildTestApp(role);
  await app.ready();
  apps.set(role, app);
  return app;
}

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
});

afterAll(async () => {
  for (const app of apps.values()) await app.close();

  const prisma = getPrisma();
  if (fixturePurchaseOrderIds.length > 0) {
    // Pela OC, e não por id devolvido: um recebimento que escapasse de uma
    // recusa também sai daqui.
    const receipts = await prisma.receipt.findMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((receipt) => receipt.id);
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marcador(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** OC confirmada, pelo Administrador, com uma linha de 100 kg de uma matéria-prima com lote. */
async function ordemConfirmada() {
  const prisma = getPrisma();
  const m = marcador();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-ACP-${m}`, legalName: `Fornecedor Custo por Perfil ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-ACP-${m}`,
      name: `Item Custo por Perfil ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);

  const admin = await appDo("ADMIN");
  const criada = await admin.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: supplier.id,
      orderDate: new Date().toISOString(),
      lines: [{ itemId: item.id, orderedQuantity: "100", unitPrice: "30" }],
    },
  });
  expect(criada.statusCode, criada.body).toBe(201);
  const po = criada.json();
  fixturePurchaseOrderIds.push(po.id);
  const confirmada = await admin.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  expect(confirmada.statusCode, confirmada.body).toBe(200);

  return { item, poId: po.id as string, poLineId: po.lines[0].id as string };
}

function corpoDoRecebimento(
  poLineId: string,
  opcoes: { actualUnitCost?: string; receivedAt?: Date; quantidade?: string } = {},
) {
  return {
    receivedAt: (opcoes.receivedAt ?? new Date()).toISOString(),
    lines: [
      {
        purchaseOrderLineId: poLineId,
        receivedQuantity: opcoes.quantidade ?? "100",
        supplierLot: `SUP-${marcador()}`,
        ...(opcoes.actualUnitCost !== undefined ? { actualUnitCost: opcoes.actualUnitCost } : {}),
      },
    ],
  };
}

/** Material recebido pelo Administrador, com ou sem custo. */
async function recebido(opcoes: { actualUnitCost?: string; receivedAt?: Date } = {}) {
  const { item, poId, poLineId } = await ordemConfirmada();
  const admin = await appDo("ADMIN");
  const resposta = await admin.inject({
    method: "POST",
    url: `/purchase-orders/${poId}/receipts`,
    payload: corpoDoRecebimento(poLineId, opcoes),
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const receipt = resposta.json();
  return { item, receiptId: receipt.id as string, line: receipt.lines[0] as { id: string; lotId: string | null } };
}

/** O custo como está no banco — é ele, e não a resposta, que prova "nada muda". */
async function custoGravado(lineId: string) {
  const linha = await getPrisma().receiptLine.findUniqueOrThrow({
    where: { id: lineId },
    select: { actualUnitCost: true, costUpdatedAt: true, costUpdatedBy: true, costNote: true },
  });
  return {
    actualUnitCost: linha.actualUnitCost?.toString() ?? null,
    costUpdatedAt: linha.costUpdatedAt?.toISOString() ?? null,
    costUpdatedBy: linha.costUpdatedBy,
    costNote: linha.costNote,
  };
}

function informarCusto(app: App, lineId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PUT", url: `/receipt-lines/${lineId}/acquisition-cost`, payload });
}

async function referenciaDoItem(itemId: string) {
  const admin = await appDo("ADMIN");
  const resposta = (await admin.inject({ method: "GET", url: `/items/${itemId}/cost-reference` })).json();
  return { source: resposta.source as string, unitCost: resposta.unitCost as string | null };
}

async function referenciaRealDoLote(itemId: string, lotId: string) {
  const referencia = await getConsumedLotCostReference(getPrisma(), {
    itemId,
    lotId,
    consumedAt: new Date(),
  });
  return { source: referencia.source, unitCost: referencia.unitCost?.toString() ?? null };
}

describe("a matriz", () => {
  it("cobre os seis perfis, e a lista do shared é Compras e Administrador", () => {
    expect([...AUTORIZADOS, ...RECUSADOS].sort()).toEqual([...USER_ROLES].sort());
    expect([...ACQUISITION_COST_ROLES].sort()).toEqual([...AUTORIZADOS].sort());
  });
});

describe("PUT /receipt-lines/:id/acquisition-cost", () => {
  it.each(AUTORIZADOS)("%s informa o custo: 200, valor e nota gravados, autor da sessão", async (role) => {
    const { line } = await recebido();
    const app = await appDo(role);
    const { user } = await createAuthenticatedUser(role);

    const resposta = await informarCusto(app, line.id, { unitCost: "31.5", note: "NF chegou depois" });

    expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(200);
    expect(resposta.json().lines[0].actualUnitCost, role).toBe("31.50000000");
    expect(await custoGravado(line.id), role).toMatchObject({
      actualUnitCost: "31.5",
      costUpdatedBy: user.name,
      costNote: "NF chegou depois",
    });
  });

  it.each(RECUSADOS)("%s: 403 forbidden, a linha fica como estava e a consulta segue aberta", async (role) => {
    const { receiptId, line } = await recebido({ actualUnitCost: "7" });
    const antes = await custoGravado(line.id);
    const app = await appDo(role);

    const resposta = await informarCusto(app, line.id, { unitCost: "99", note: "tentativa" });
    expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(403);
    expect(resposta.json(), role).toEqual({ error: "forbidden", message: "Seu perfil não permite esta ação." });
    expect(await custoGravado(line.id), role).toEqual(antes);

    // Limpar também é informar custo: a recusa vale para o vazio.
    const limpar = await informarCusto(app, line.id, { unitCost: "" });
    expect(limpar.statusCode, `${role} limpar: ${limpar.body}`).toBe(403);
    expect(await custoGravado(line.id), `${role} limpar`).toEqual(antes);

    const consulta = await app.inject({ method: "GET", url: `/receipts/${receiptId}` });
    expect(consulta.statusCode, `${role} consulta`).toBe(200);
    expect(consulta.json().lines[0].actualUnitCost, `${role} consulta`).toBe("7.00000000");
  });

  describe("a ordem das respostas", () => {
    let lineId = "";
    beforeAll(async () => {
      lineId = (await recebido()).line.id;
    });

    it.each(RECUSADOS)("%s: o 403 vem antes do corpo inválido e da linha inexistente", async (role) => {
      const app = await appDo(role);
      const corpoInvalido = await informarCusto(app, lineId, { unitCost: "-5" });
      expect(corpoInvalido.statusCode, `${role} corpo inválido: ${corpoInvalido.body}`).toBe(403);
      const semCorpo = await app.inject({ method: "PUT", url: `/receipt-lines/${lineId}/acquisition-cost` });
      expect(semCorpo.statusCode, `${role} sem corpo: ${semCorpo.body}`).toBe(403);
      const inexistente = await informarCusto(app, LINHA_INEXISTENTE, { unitCost: "10" });
      expect(inexistente.statusCode, `${role} linha inexistente: ${inexistente.body}`).toBe(403);
    });

    it.each(AUTORIZADOS)("%s: corpo inválido segue 400 e linha inexistente segue 404", async (role) => {
      const app = await appDo(role);
      const corpoInvalido = await informarCusto(app, lineId, { unitCost: "-5" });
      expect(corpoInvalido.statusCode, `${role}: ${corpoInvalido.body}`).toBe(400);
      const inexistente = await informarCusto(app, LINHA_INEXISTENTE, { unitCost: "10" });
      expect(inexistente.statusCode, `${role}: ${inexistente.body}`).toBe(404);
    });
  });
});

describe("POST /purchase-orders/:id/receipts com custo", () => {
  it.each(AUTORIZADOS)("%s recebe já com o custo: 201, custo gravado com o autor da sessão", async (role) => {
    const { poId, poLineId } = await ordemConfirmada();
    const app = await appDo(role);
    const { user } = await createAuthenticatedUser(role);

    const resposta = await app.inject({
      method: "POST",
      url: `/purchase-orders/${poId}/receipts`,
      payload: corpoDoRecebimento(poLineId, { actualUnitCost: "12.5" }),
    });

    expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(201);
    const linha = resposta.json().lines[0];
    expect(linha.actualUnitCost, role).toBe("12.50000000");
    expect(linha.costUpdatedBy, role).toBe(user.name);
  });

  it.each(RECUSADOS)("%s: recebimento que traz custo é 403 e nada é gravado", async (role) => {
    const { item, poId, poLineId } = await ordemConfirmada();
    const admin = await appDo("ADMIN");
    const ocAntes = (await admin.inject({ method: "GET", url: `/purchase-orders/${poId}` })).json();
    const app = await appDo(role);

    const resposta = await app.inject({
      method: "POST",
      url: `/purchase-orders/${poId}/receipts`,
      payload: corpoDoRecebimento(poLineId, { actualUnitCost: "12.5" }),
    });

    expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(403);
    expect(resposta.json(), role).toEqual({
      error: "forbidden",
      message:
        "Seu perfil não informa o custo efetivo de aquisição — só Compras ou Administrador. Confirme o recebimento sem o custo.",
    });

    const prisma = getPrisma();
    expect(await prisma.receipt.count({ where: { purchaseOrderId: poId } }), `${role}: recebimento`).toBe(0);
    expect(await prisma.lot.count({ where: { itemId: item.id } }), `${role}: lote`).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { itemId: item.id } }), `${role}: movimento`).toBe(0);
    const ocDepois = (await admin.inject({ method: "GET", url: `/purchase-orders/${poId}` })).json();
    expect(
      { status: ocDepois.status, linha: ocDepois.lines[0].openQuantity },
      `${role}: saldo da OC`,
    ).toEqual({ status: ocAntes.status, linha: ocAntes.lines[0].openQuantity });
  });

  it.each(RECUSADOS)("%s: receber sem custo continua aberto — campo ausente ou vazio", async (role) => {
    const { poId, poLineId } = await ordemConfirmada();
    const app = await appDo(role);

    const semCampo = await app.inject({
      method: "POST",
      url: `/purchase-orders/${poId}/receipts`,
      payload: corpoDoRecebimento(poLineId, { quantidade: "40" }),
    });
    expect(semCampo.statusCode, `${role} sem campo: ${semCampo.body}`).toBe(201);
    expect(semCampo.json().lines[0].actualUnitCost, `${role} sem campo`).toBeNull();

    const vazio = await app.inject({
      method: "POST",
      url: `/purchase-orders/${poId}/receipts`,
      payload: corpoDoRecebimento(poLineId, { quantidade: "60", actualUnitCost: "  " }),
    });
    expect(vazio.statusCode, `${role} vazio: ${vazio.body}`).toBe(201);
    expect(vazio.json().lines[0].actualUnitCost, `${role} vazio`).toBeNull();
    expect(vazio.json().lines[0].costUpdatedBy, `${role} vazio`).toBeNull();
  });

  it.each(RECUSADOS)("%s: o 403 do custo vem antes do corpo inválido e da OC inexistente", async (role) => {
    const app = await appDo(role);

    const corpoInvalido = await app.inject({
      method: "POST",
      url: `/purchase-orders/${OC_INEXISTENTE}/receipts`,
      payload: { lines: [{ actualUnitCost: "-5" }] },
    });
    expect(corpoInvalido.statusCode, `${role} corpo inválido: ${corpoInvalido.body}`).toBe(403);

    const ocInexistente = await app.inject({
      method: "POST",
      url: `/purchase-orders/${OC_INEXISTENTE}/receipts`,
      payload: corpoDoRecebimento(LINHA_INEXISTENTE, { actualUnitCost: "5" }),
    });
    expect(ocInexistente.statusCode, `${role} OC inexistente: ${ocInexistente.body}`).toBe(403);

    // Sem custo, o mesmo pedido segue a resposta de sempre.
    const semCusto = await app.inject({
      method: "POST",
      url: `/purchase-orders/${OC_INEXISTENTE}/receipts`,
      payload: corpoDoRecebimento(LINHA_INEXISTENTE),
    });
    expect(semCusto.statusCode, `${role} sem custo: ${semCusto.body}`).toBe(400);
    expect(semCusto.json().error, `${role} sem custo`).toBe("purchase_order_not_found");
  });

  it.each(AUTORIZADOS)("%s: o mesmo corpo inválido segue 400, e a OC inexistente, 400 de OC", async (role) => {
    const app = await appDo(role);

    const corpoInvalido = await app.inject({
      method: "POST",
      url: `/purchase-orders/${OC_INEXISTENTE}/receipts`,
      payload: { lines: [{ actualUnitCost: "-5" }] },
    });
    expect(corpoInvalido.statusCode, `${role}: ${corpoInvalido.body}`).toBe(400);
    expect(corpoInvalido.json().error, role).toBe("validation_error");

    const ocInexistente = await app.inject({
      method: "POST",
      url: `/purchase-orders/${OC_INEXISTENTE}/receipts`,
      payload: corpoDoRecebimento(LINHA_INEXISTENTE, { actualUnitCost: "5" }),
    });
    expect(ocInexistente.statusCode, `${role}: ${ocInexistente.body}`).toBe(400);
    expect(ocInexistente.json().error, role).toBe("purchase_order_not_found");
  });
});

describe("REAL, 30D e 90D seguem a mesma fonte depois do gate", () => {
  it("Compras informa: o lote vira REAL e o Item vai à média de 30 dias; as recusas não mexem em nenhuma", async () => {
    const { item, line } = await recebido();
    expect(line.lotId).not.toBeNull();
    const lotId = line.lotId as string;
    expect(await referenciaRealDoLote(item.id, lotId)).toEqual({ source: "NO_COST", unitCost: null });
    expect(await referenciaDoItem(item.id)).toEqual({ source: "NO_COST", unitCost: null });

    const compras = await appDo("PURCHASING");
    expect((await informarCusto(compras, line.id, { unitCost: "10" })).statusCode).toBe(200);

    const real = { source: "REAL", unitCost: "10" };
    const media30 = { source: "ESTIMATED_30D", unitCost: "10.00000000" };
    expect(await referenciaRealDoLote(item.id, lotId)).toEqual(real);
    expect(await referenciaDoItem(item.id)).toEqual(media30);

    for (const role of RECUSADOS) {
      const app = await appDo(role);
      expect((await informarCusto(app, line.id, { unitCost: "99" })).statusCode, role).toBe(403);

      // A outra porta: um recebimento novo do MESMO item, com custo, também
      // não entra na média.
      const { poId, poLineId } = await ordemComMesmoItem(item.id);
      const recebimento = await app.inject({
        method: "POST",
        url: `/purchase-orders/${poId}/receipts`,
        payload: corpoDoRecebimento(poLineId, { actualUnitCost: "1000" }),
      });
      expect(recebimento.statusCode, `${role} recebimento: ${recebimento.body}`).toBe(403);

      expect(await referenciaRealDoLote(item.id, lotId), `${role}: REAL`).toEqual(real);
      expect(await referenciaDoItem(item.id), `${role}: 30D`).toEqual(media30);
    }
  });

  it("Administrador informa uma compra de 60 dias atrás: o Item vai à média de 90 dias; as recusas não mexem", async () => {
    const { item, line } = await recebido({ receivedAt: new Date(Date.now() - 60 * DAY_MS) });
    expect(await referenciaDoItem(item.id)).toEqual({ source: "NO_COST", unitCost: null });

    const admin = await appDo("ADMIN");
    expect((await informarCusto(admin, line.id, { unitCost: "20" })).statusCode).toBe(200);

    const media90 = { source: "ESTIMATED_90D", unitCost: "20.00000000" };
    expect(await referenciaDoItem(item.id)).toEqual(media90);

    for (const role of RECUSADOS) {
      const app = await appDo(role);
      expect((await informarCusto(app, line.id, { unitCost: "1" })).statusCode, role).toBe(403);
      expect(await referenciaDoItem(item.id), `${role}: 90D`).toEqual(media90);
    }
  });
});

/** Outra OC confirmada para um item que já existe — a segunda compra do mesmo material. */
async function ordemComMesmoItem(itemId: string) {
  const prisma = getPrisma();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-ACP-${marcador()}`, legalName: "Fornecedor Custo por Perfil (2ª compra)", active: true },
  });
  fixtureSupplierIds.push(supplier.id);

  const admin = await appDo("ADMIN");
  const criada = await admin.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: supplier.id,
      orderDate: new Date().toISOString(),
      lines: [{ itemId, orderedQuantity: "100", unitPrice: "30" }],
    },
  });
  expect(criada.statusCode, criada.body).toBe(201);
  const po = criada.json();
  fixturePurchaseOrderIds.push(po.id);
  const confirmada = await admin.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  expect(confirmada.statusCode, confirmada.body).toBe(200);
  return { poId: po.id as string, poLineId: po.lines[0].id as string };
}
