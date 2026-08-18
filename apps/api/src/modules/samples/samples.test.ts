import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 39 — Amostras / pilotos / testes Tn.
 *
 * Fixtures sintéticas: nada depende do corpus real nem das amostras
 * históricas importadas pelo seed.
 */

const fixtureSampleIds: string[] = [];
const fixtureProjectIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProjectProductIds: string[] = [];
const fixtureProductIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureSampleIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { projectSampleId: { in: fixtureSampleIds } } });
    await prisma.sampleConsumption.deleteMany({
      where: { projectSampleId: { in: fixtureSampleIds } },
    });
    await prisma.projectSample.deleteMany({ where: { id: { in: fixtureSampleIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureProjectProductIds.length > 0) {
    await prisma.projectProduct.deleteMany({ where: { id: { in: fixtureProjectProductIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureProjectIds.length > 0) {
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-AM-${m}`, legalName: `Cliente Amostra ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createProject(customerId: string) {
  const prisma = getPrisma();
  const m = marker();
  const project = await prisma.project.create({
    data: {
      code: `PROJ-AM-${m}`,
      customerId,
      name: `Projeto Amostra ${m}`,
      status: "WAITING",
      source: "MANUAL",
      entryDate: new Date(),
    },
  });
  fixtureProjectIds.push(project.id);
  return project;
}

async function createItem(
  overrides: {
    controlsLot?: boolean;
    controlsExpiry?: boolean;
    requiresQualityRelease?: boolean;
    requiresCoa?: boolean;
  } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-AM-${m}`,
      name: `Insumo Amostra ${m}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: overrides.requiresQualityRelease ?? false,
      requiresCoa: overrides.requiresCoa ?? false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/** Lote com entrada real no ledger — o saldo vem da mesma matemática do sistema. */
async function receiveStock(
  itemId: string,
  quantity: string,
  overrides: {
    status?: "AVAILABLE" | "AWAITING_RELEASE" | "BLOCKED" | "EXPIRED";
    expiryDate?: Date;
    ownerType?: "VERIDI" | "CUSTOMER";
    ownerCustomerId?: string;
    requiresCoaSnapshot?: boolean;
    coaStatus?: "NOT_REQUIRED" | "PENDING" | "RECEIVED" | "APPROVED" | "REJECTED";
  } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-AM-${marker()}`,
      itemId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ownerType: overrides.ownerType ?? "VERIDI",
      ...(overrides.ownerCustomerId ? { ownerCustomerId: overrides.ownerCustomerId } : {}),
      ...(overrides.expiryDate ? { expiryDate: overrides.expiryDate } : {}),
      ...(overrides.requiresCoaSnapshot !== undefined
        ? { requiresCoaSnapshot: overrides.requiresCoaSnapshot }
        : {}),
      ...(overrides.coaStatus ? { coaStatus: overrides.coaStatus } : {}),
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

async function newSample(app: App, projectId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/projects/${projectId}/samples`,
    payload: { description: "Piloto de teste" },
  });
  if (response.statusCode === 201) fixtureSampleIds.push(response.json().id);
  return response;
}

describe("Amostra — identidade e numeração", () => {
  it("cria amostra com código próprio, QR de amostra e Tn sequencial por projeto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { user } = await createAuthenticatedUser("COMMERCIAL");

    const customer = await createCustomer();
    const project = await createProject(customer.id);

    const first = await newSample(app, project.id);
    expect(first.statusCode).toBe(201);
    const sample = first.json();

    expect(sample.code.startsWith("AM-")).toBe(true);
    expect(sample.testSequence).toBe(1);
    expect(sample.testLabel).toBe("T1");
    expect(sample.status).toBe("DRAFT");
    expect(sample.createdByName).toBe(user.name);
    // QR de amostra nunca é QR de lote: confundir os dois levaria alguém a
    // tratar amostra como estoque expedível.
    expect(sample.qrPayload).toBe(`SAMPLE:${sample.code}`);
    expect(sample.qrPayload.startsWith("LOT:")).toBe(false);

    const second = (await newSample(app, project.id)).json();
    expect(second.testSequence).toBe(2);
    expect(second.testLabel).toBe("T2");

    // Projeto diferente recomeça em T1 — Tn é por projeto, não global.
    const otherProject = await createProject(customer.id);
    expect((await newSample(app, otherProject.id)).json().testSequence).toBe(1);

    await app.close();
  });

  it("diz qual produto do projeto a amostra testa, e não inventa um quando não existe vínculo", async () => {
    // Num projeto com três sabores, "T2 aprovada" não significa nada sem o
    // produto ao lado — e a amostra antiga, sem vínculo, tem que continuar
    // dizendo que não sabe em vez de apontar o primeiro produto da lista.
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const m = marker();
    const produtos = await Promise.all(
      ["A", "B"].map(async (sufixo, indice) => {
        const product = await prisma.product.create({
          data: { code: `PROD-AM-${sufixo}-${m}`, name: `Produto ${sufixo} ${m}`, customerId: customer.id },
        });
        fixtureProductIds.push(product.id);
        const link = await prisma.projectProduct.create({
          data: { projectId: project.id, productId: product.id, sequence: indice + 1 },
        });
        fixtureProjectProductIds.push(link.id);
        return { product, link };
      }),
    );
    const segundo = produtos[1]!;

    const escolhida = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/samples`,
      payload: { description: "Sabor B", projectProductId: segundo.link.id },
    });
    expect(escolhida.statusCode).toBe(201);
    fixtureSampleIds.push(escolhida.json().id);
    const comProduto = escolhida.json();
    expect(comProduto.projectProductId).toBe(segundo.link.id);
    expect(comProduto.productId).toBe(segundo.product.id);
    expect(comProduto.productCode).toBe(segundo.product.code);
    expect(comProduto.productName).toBe(segundo.product.name);

    // A lista mostra a mesma informação — é lá que a pessoa compara T1 e T2.
    const listada = (await app.inject({ method: "GET", url: `/project-samples?search=${comProduto.code}` }))
      .json()
      .samples.find((item: { id: string }) => item.id === comProduto.id);
    expect(listada.productCode).toBe(segundo.product.code);

    // Amostra de projeto sem produto cadastrado: sem vínculo, sem palpite.
    const projetoSemProduto = await createProject(customer.id);
    const legado = (await newSample(app, projetoSemProduto.id)).json();
    expect(legado.projectProductId).toBeNull();
    expect(legado.productId).toBeNull();
    expect(legado.productCode).toBeNull();

    await app.close();
  });

  it("continua a numeração depois do maior Tn legado, sem renumerar o histórico", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);

    const legacy = await prisma.projectSample.create({
      data: {
        code: `AM-LEGACY-${marker()}`,
        externalCode: "0007",
        projectId: project.id,
        testSequence: 11,
        status: "PRODUCED",
        source: "LEGACY_IMPORT",
      },
    });
    fixtureSampleIds.push(legacy.id);

    const next = (await newSample(app, project.id)).json();
    expect(next.testSequence).toBe(12);

    const untouched = await prisma.projectSample.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(untouched.testSequence).toBe(11);

    await app.close();
  });

  it("move o projeto para AMOSTRA com histórico e recusa projeto aprovado/cancelado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);

    await newSample(app, project.id);

    const moved = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(moved.status).toBe("SAMPLE");
    const history = await prisma.projectStatusHistory.findMany({
      where: { projectId: project.id },
    });
    expect(history.some((event) => event.toStatus === "SAMPLE")).toBe(true);

    // Segunda amostra não gera novo evento: o projeto já está em amostra.
    await newSample(app, project.id);
    const afterSecond = await prisma.projectStatusHistory.count({
      where: { projectId: project.id, toStatus: "SAMPLE" },
    });
    expect(afterSecond).toBe(1);

    await prisma.project.update({ where: { id: project.id }, data: { status: "APPROVED" } });
    const blocked = await newSample(app, project.id);
    expect(blocked.statusCode).toBe(409);

    await prisma.project.update({ where: { id: project.id }, data: { status: "CANCELLED" } });
    expect((await newSample(app, project.id)).statusCode).toBe(409);

    await app.close();
  });
});

describe("Amostra — consumo de material", () => {
  it("baixa estoque com movimento próprio e nunca disfarçado de ajuste", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const { user } = await createAuthenticatedUser("PRODUCTION");
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const lot = await receiveStock(item.id, "10");

    const response = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "2.5" },
    });
    expect(response.statusCode).toBe(201);

    const updated = response.json();
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.startedByName).toBe(user.name);
    expect(updated.consumptions).toHaveLength(1);
    expect(updated.consumptions[0].quantity).toBe("2.5");
    expect(updated.consumptions[0].executedByName).toBe(user.name);

    const movements = await prisma.inventoryMovement.findMany({
      where: { itemId: item.id, lotId: lot.id, type: "SAMPLE_CONSUMPTION" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.sourceType).toBe("PROJECT_SAMPLE");
    expect(movements[0]!.sourceId).toBe(sample.id);

    // Nenhum ajuste é criado para maquiar a saída.
    const adjustments = await prisma.inventoryMovement.count({
      where: { itemId: item.id, type: { in: ["ADJUSTMENT_OUT", "ADJUSTMENT_IN"] } },
    });
    expect(adjustments).toBe(0);

    // O consumo aponta 1:1 para o movimento — nunca há segunda contabilidade.
    const consumption = await prisma.sampleConsumption.findFirstOrThrow({
      where: { projectSampleId: sample.id },
    });
    expect(consumption.inventoryMovementId).toBe(movements[0]!.id);

    await app.close();
  });

  it("recusa quantidade maior que o disponível e nunca come o reservado", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const lot = await receiveStock(item.id, "5");

    const tooMuch = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "5.000001" },
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error).toBe("insufficient_stock");

    // Saldo intacto: tentativa recusada não movimenta nada.
    expect(
      await prisma.inventoryMovement.count({
        where: { lotId: lot.id, type: "SAMPLE_CONSUMPTION" },
      }),
    ).toBe(0);

    const zero = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "0" },
    });
    expect(zero.statusCode).toBe(400);

    await app.close();
  });

  it("aplica as mesmas regras de elegibilidade do resto do sistema", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const consume = (lotCode: string) =>
      app.inject({
        method: "POST",
        url: `/project-samples/${sample.id}/consumptions`,
        payload: { itemId: item.id, lotCode, quantity: "1" },
      });

    const awaitingRelease = await receiveStock(item.id, "10", { status: "AWAITING_RELEASE" });
    expect((await consume(awaitingRelease.code)).json().error).toBe("lot_not_eligible");

    const blocked = await receiveStock(item.id, "10", { status: "BLOCKED" });
    expect((await consume(blocked.code)).json().error).toBe("lot_not_eligible");

    const expired = await receiveStock(item.id, "10", {
      expiryDate: new Date(Date.now() - 86_400_000),
    });
    expect((await consume(expired.code)).json().error).toBe("lot_not_eligible");

    // CoA exigido e ainda não aprovado bloqueia igual — não existe bypass
    // "porque é amostra".
    const withoutCoa = await receiveStock(item.id, "10", {
      requiresCoaSnapshot: true,
      coaStatus: "PENDING",
    });
    expect((await consume(withoutCoa.code)).json().error).toBe("lot_not_eligible");

    // Item que controla lote sem lote informado é recusado.
    const missingLot = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, quantity: "1" },
    });
    expect(missingLot.statusCode).toBe(400);
    expect(missingLot.json().error).toBe("missing_lot");

    await app.close();
  });

  it("só aceita material do cliente no projeto daquele cliente", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const owner = await createCustomer();
    const other = await createCustomer();
    const project = await createProject(owner.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const foreign = await receiveStock(item.id, "10", {
      ownerType: "CUSTOMER",
      ownerCustomerId: other.id,
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: foreign.code, quantity: "1" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("lot_owner_mismatch");

    const own = await receiveStock(item.id, "10", {
      ownerType: "CUSTOMER",
      ownerCustomerId: owner.id,
    });
    const accepted = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: own.code, quantity: "1" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().consumptions[0].ownerType).toBe("CUSTOMER");

    await app.close();
  });
});

describe("Amostra — conclusão e decisão", () => {
  it("conclui congelando o snapshot e sem gerar estoque de produto acabado", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const lot = await receiveStock(item.id, "10");
    await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "1" },
    });

    const produced = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "12", outputUomCode: "un" },
    });
    expect(produced.statusCode).toBe(200);

    const body = produced.json();
    expect(body.status).toBe("PRODUCED");
    expect(body.outputQuantity).toBe("12");
    expect(body.customerNameSnapshot).toBe(customer.legalName);
    expect(body.projectCodeSnapshot).toBe(project.code);

    // Amostra não vira produto acabado: nenhuma entrada de produção existe.
    expect(
      await prisma.inventoryMovement.count({ where: { type: "FINISHED_GOOD_PRODUCTION", sourceId: sample.id } }),
    ).toBe(0);

    // Renomear o projeto depois não reescreve a etiqueta já impressa.
    await prisma.project.update({
      where: { id: project.id },
      data: { name: "Nome trocado depois" },
    });
    const reread = await app.inject({ method: "GET", url: `/project-samples/${sample.id}` });
    expect(reread.json().projectNameSnapshot).toBe(project.name);

    await app.close();
  });

  it("exige confirmação para concluir amostra sem consumo registrado", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const withoutConfirm = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "5", outputUomCode: "un" },
    });
    expect(withoutConfirm.statusCode).toBe(409);
    expect(withoutConfirm.json().error).toBe("no_consumption");

    const confirmed = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "5", outputUomCode: "un", confirmWithoutConsumption: true },
    });
    expect(confirmed.statusCode).toBe(200);

    await app.close();
  });

  it("aprova a amostra sem aprovar o projeto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "3", outputUomCode: "un", confirmWithoutConsumption: true },
    });

    const approved = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/approve`,
      payload: { decisionNotes: "Sabor aprovado pelo cliente" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("APPROVED");

    // O projeto continua em amostra: aprovação comercial é outra decisão,
    // e exige orçamento aceito.
    const projectAfter = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(projectAfter.status).toBe("SAMPLE");

    // Terminal: aprovada não volta a ser reprovada nem cancelada.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/project-samples/${sample.id}/reject`,
          payload: { decisionNotes: "mudei de ideia" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: "POST", url: `/project-samples/${sample.id}/cancel` })).statusCode,
    ).toBe(409);

    await app.close();
  });

  it("reprova só com justificativa e nunca estorna o material consumido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const lot = await receiveStock(item.id, "10");
    await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "4" },
    });
    await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "2", outputUomCode: "un" },
    });

    const withoutNotes = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/reject`,
      payload: {},
    });
    expect(withoutNotes.statusCode).toBe(400);

    const rejected = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/reject`,
      payload: { decisionNotes: "Viscosidade fora do alvo" },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe("REJECTED");

    // Estorno automático seria mentira física: o insumo foi usado.
    const movements = await prisma.inventoryMovement.findMany({ where: { lotId: lot.id } });
    expect(movements.filter((row) => row.type === "SAMPLE_CONSUMPTION")).toHaveLength(1);
    expect(movements.some((row) => row.type === "ADJUSTMENT_IN")).toBe(false);
    expect(rejected.json().consumptions).toHaveLength(1);

    await app.close();
  });

  it("cancela apenas amostra aberta e mantém o consumo já realizado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const item = await createItem();
    const lot = await receiveStock(item.id, "10");
    await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "3" },
    });

    const cancelled = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/cancel`,
      payload: { decisionNotes: "Cliente desistiu do teste" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().consumptions).toHaveLength(1);

    expect(
      await prisma.inventoryMovement.count({
        where: { lotId: lot.id, type: "SAMPLE_CONSUMPTION" },
      }),
    ).toBe(1);

    // Amostra cancelada é terminal: não aceita mais consumo.
    const afterCancel = await app.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "1" },
    });
    expect(afterCancel.statusCode).toBe(409);

    await app.close();
  });
});

describe("Amostra — perfis e consulta", () => {
  it("separa quem cria, quem consome e quem decide", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const commercial = buildTestApp("COMMERCIAL");
    await commercial.ready();
    const quality = buildTestApp("QUALITY");
    await quality.ready();

    const customer = await createCustomer();
    const project = await createProject(customer.id);

    // Qualidade lê, mas não cria amostra.
    expect((await newSample(quality, project.id)).statusCode).toBe(403);

    const sample = (await newSample(commercial, project.id)).json();

    // Comercial não baixa estoque.
    const item = await createItem();
    const lot = await receiveStock(item.id, "10");
    const commercialConsumption = await commercial.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/consumptions`,
      payload: { itemId: item.id, lotCode: lot.code, quantity: "1" },
    });
    expect(commercialConsumption.statusCode).toBe(403);

    await admin.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/produce`,
      payload: { outputQuantity: "1", outputUomCode: "un", confirmWithoutConsumption: true },
    });

    // Produção não decide o resultado comercial da amostra.
    const production = buildTestApp("PRODUCTION");
    await production.ready();
    const productionApproval = await production.inject({
      method: "POST",
      url: `/project-samples/${sample.id}/approve`,
      payload: {},
    });
    expect(productionApproval.statusCode).toBe(403);

    expect(
      (await quality.inject({ method: "GET", url: `/project-samples/${sample.id}` })).statusCode,
    ).toBe(200);

    await admin.close();
    await commercial.close();
    await quality.close();
    await production.close();
  });

  it("lista, filtra e exporta amostras sem expor identificadores internos", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const list = await app.inject({
      method: "GET",
      url: `/project-samples?projectId=${project.id}`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().samples).toHaveLength(1);

    const byProject = await app.inject({ method: "GET", url: `/projects/${project.id}/samples` });
    expect(byProject.json().samples[0].code).toBe(sample.code);

    const byStatus = await app.inject({
      method: "GET",
      url: `/project-samples?projectId=${project.id}&status=APPROVED`,
    });
    expect(byStatus.json().samples).toHaveLength(0);

    // Busca pelo código do QR lido no chão de fábrica.
    const lookup = await app.inject({
      method: "GET",
      url: `/project-samples/lookup?code=SAMPLE:${sample.code}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().id).toBe(sample.id);

    const csv = await app.inject({
      method: "GET",
      url: `/project-samples/export.csv?projectId=${project.id}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(sample.code);
    expect(csv.body).not.toContain(sample.id);
    expect(csv.body).not.toContain(project.id);

    await app.close();
  });

  it("aceita resultado de teste como anexo e recusa CoA/nota fiscal na amostra", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(customer.id);
    const sample = (await newSample(app, project.id)).json();

    const upload = async (documentType: string) => {
      const boundary = "----veridi-sample-test";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="documentType"',
        "",
        documentType,
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="resultado.pdf"',
        "Content-Type: application/pdf",
        "",
        "%PDF-1.4 resultado de teste",
        `--${boundary}--`,
        "",
      ].join("\r\n");

      return app.inject({
        method: "POST",
        url: `/project-samples/${sample.id}/attachments`,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
    };

    const result = await upload("SAMPLE_RESULT");
    expect(result.statusCode).toBe(201);
    expect(result.json().projectSampleId).toBe(sample.id);

    // Laudo pertence ao lote e nota fiscal ao recebimento — nunca à amostra.
    expect((await upload("COA")).statusCode).toBe(400);
    expect((await upload("INVOICE")).statusCode).toBe(400);

    const listed = await app.inject({
      method: "GET",
      url: `/project-samples/${sample.id}/attachments`,
    });
    expect(listed.json().attachments).toHaveLength(1);

    await app.close();
  });
});
