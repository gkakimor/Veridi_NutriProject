import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Item ou fornecedor inativo na relação Item × Fornecedor —
 * SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112 (decisões D4 e D8 do PO).
 *
 * Inativo não começa compromisso novo: criar, reativar, homologar, preferencial
 * e oferta recusam. Inativo não apaga o que existe: bloquear, voltar para
 * pendente, inativar a relação, ler o histórico e RECEBER uma OC confirmada
 * antes da inativação seguem — o compromisso foi assumido enquanto os cadastros
 * estavam ativos, e cancelar por causa da inativação não é decisão desta regra.
 *
 * Fixtures sintéticas, com marcador próprio: nada depende do corpus real.
 */

const criados = {
  relacoes: [] as string[],
  itens: [] as string[],
  fornecedores: [] as string[],
  ordens: [] as string[],
};

let app: ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  app = buildTestApp("ADMIN");
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  // Recebimento leva linhas e movimentos em cascata; a OC leva as linhas dela.
  await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: criados.ordens } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  if (criados.relacoes.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItemId: { in: criados.relacoes } },
    });
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItemId: { in: criados.relacoes } },
    });
    await prisma.supplierItem.deleteMany({ where: { id: { in: criados.relacoes } } });
  }
  await prisma.supplierItem.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await app?.close();
});

async function criarItem(): Promise<{ id: string; code: string }> {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-SIG-${m}`,
      name: `Insumo Gate Inativo ${m}`,
      unitCode: "kg",
      // Sem lote: o recebimento da OC deste arquivo é sobre a permissão, não
      // sobre rastreabilidade.
      controlsLot: false,
      controlsExpiry: false,
      active: true,
    },
  });
  criados.itens.push(item.id);
  return item;
}

async function criarFornecedor(): Promise<{ id: string; code: string; legalName: string }> {
  const m = marker();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-SIG-${m}`, legalName: `Fornecedor Gate Inativo ${m}`, active: true },
  });
  criados.fornecedores.push(supplier.id);
  return supplier;
}

const OFERTA = {
  unitPrice: "10.00",
  priceUomCode: "kg",
  effectiveAt: "2026-09-01T12:00:00.000Z",
};

async function criarRelacao(
  itemId: string,
  supplierId: string,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/supplier-items",
    payload: { itemId, supplierId, ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  const relacao = response.json() as { id: string };
  criados.relacoes.push(relacao.id);
  return relacao.id;
}

async function inativarItem(id: string): Promise<void> {
  await getPrisma().item.update({ where: { id }, data: { active: false } });
}

async function inativarFornecedorNoBanco(id: string): Promise<void> {
  await getPrisma().supplier.update({ where: { id }, data: { active: false } });
}

function detalhe(id: string) {
  return app.inject({ method: "GET", url: `/supplier-items/${id}` });
}

/** As quatro portas de compromisso novo sobre uma relação que já existe. */
async function tentarCompromissosNovos(relacaoId: string) {
  return {
    homologar: await app.inject({
      method: "POST",
      url: `/supplier-items/${relacaoId}/qualification`,
      payload: { status: "APPROVED" },
    }),
    preferencial: await app.inject({
      method: "POST",
      url: `/supplier-items/${relacaoId}/preferred`,
      payload: { preferred: true },
    }),
    oferta: await app.inject({
      method: "POST",
      url: `/supplier-items/${relacaoId}/offers`,
      payload: OFERTA,
    }),
    reativar: await app.inject({
      method: "PATCH",
      url: `/supplier-items/${relacaoId}`,
      payload: { active: true },
    }),
  };
}

describe("Item × Fornecedor — parte inativa não começa compromisso novo", () => {
  it("item inativo: criar a relação recusa 400 inactive_reference dizendo para reativar o item", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    await inativarItem(item.id);

    const response = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: fornecedor.id },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({
      error: "inactive_reference",
      message: "Item inativo — reative o item antes de criar a relação.",
    });
    expect(
      await getPrisma().supplierItem.count({ where: { itemId: item.id } }),
      "nada é gravado na recusa",
    ).toBe(0);
  });

  it("fornecedor inativo: criar a relação recusa dizendo para reativar o fornecedor", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    await inativarFornecedorNoBanco(fornecedor.id);

    const response = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: fornecedor.id },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({
      error: "inactive_reference",
      message: "Fornecedor inativo — reative o fornecedor antes de criar a relação.",
    });
  });

  it("item inativado depois: homologar, preferencial, oferta e reativar recusam nomeando o item", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const relacaoId = await criarRelacao(item.id, fornecedor.id, { initialOffer: OFERTA });
    // A relação nasce ativa; inativá-la é permitido, e é o que o "reativar" abaixo tenta desfazer.
    const inativarRelacao = await app.inject({
      method: "PATCH",
      url: `/supplier-items/${relacaoId}`,
      payload: { active: false },
    });
    expect(inativarRelacao.statusCode, inativarRelacao.body).toBe(200);

    await inativarItem(item.id);
    const tentativas = await tentarCompromissosNovos(relacaoId);

    for (const [porta, response] of Object.entries(tentativas)) {
      expect(response.statusCode, `${porta}: ${response.body}`).toBe(400);
      expect((response.json() as { error: string }).error, porta).toBe("inactive_reference");
      expect((response.json() as { message: string }).message, porta).toContain("Item inativo");
    }
    expect(tentativas.homologar.json()).toMatchObject({
      message: "Item inativo — reative o item antes de homologar a relação.",
    });
    expect(tentativas.preferencial.json()).toMatchObject({
      message: "Item inativo — reative o item antes de definir o fornecedor preferencial.",
    });
    expect(tentativas.oferta.json()).toMatchObject({
      message: "Item inativo — reative o item antes de registrar uma oferta.",
    });
    expect(tentativas.reativar.json()).toMatchObject({
      message: "Item inativo — reative o item antes de reativar a relação.",
    });

    const gravada = await getPrisma().supplierItem.findUniqueOrThrow({ where: { id: relacaoId } });
    expect(gravada.active, "a recusa não reativou a relação").toBe(false);
    expect(gravada.qualificationStatus, "a recusa não homologou").toBe("PENDING");
    expect(
      await getPrisma().supplierItemOffer.count({ where: { supplierItemId: relacaoId } }),
      "a oferta recusada não entrou; a inicial continua",
    ).toBe(1);
  });

  it("item inativado depois: bloquear, voltar para pendente e inativar a relação seguem, com histórico e ofertas à vista", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const relacaoId = await criarRelacao(item.id, fornecedor.id, {
      qualificationStatus: "APPROVED",
      initialOffer: OFERTA,
    });
    await inativarItem(item.id);

    const bloquear = await app.inject({
      method: "POST",
      url: `/supplier-items/${relacaoId}/qualification`,
      payload: { status: "BLOCKED", note: "Laudo reprovado na análise de entrada." },
    });
    expect(bloquear.statusCode, bloquear.body).toBe(200);
    expect(bloquear.json()).toMatchObject({ qualificationStatus: "BLOCKED", preferred: false });

    const pendente = await app.inject({
      method: "POST",
      url: `/supplier-items/${relacaoId}/qualification`,
      payload: { status: "PENDING" },
    });
    expect(pendente.statusCode, pendente.body).toBe(200);

    const inativarRelacao = await app.inject({
      method: "PATCH",
      url: `/supplier-items/${relacaoId}`,
      payload: { active: false },
    });
    expect(inativarRelacao.statusCode, inativarRelacao.body).toBe(200);

    const lida = await detalhe(relacaoId);
    expect(lida.statusCode, lida.body).toBe(200);
    const corpo = lida.json() as {
      itemActive: boolean;
      supplierActive: boolean;
      active: boolean;
      offers: unknown[];
      qualificationHistory: unknown[];
    };
    expect(corpo.itemActive, "a situação do item viaja no DTO").toBe(false);
    expect(corpo.supplierActive).toBe(true);
    expect(corpo.active).toBe(false);
    expect(corpo.offers, "as ofertas continuam à vista").toHaveLength(1);
    expect(
      corpo.qualificationHistory.length,
      "o histórico registra criação, bloqueio e volta para pendente",
    ).toBe(3);
  });

  it("fornecedor inativado depois: as mesmas quatro portas recusam nomeando o fornecedor", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const relacaoId = await criarRelacao(item.id, fornecedor.id);
    const inativarRelacao = await app.inject({
      method: "PATCH",
      url: `/supplier-items/${relacaoId}`,
      payload: { active: false },
    });
    expect(inativarRelacao.statusCode, inativarRelacao.body).toBe(200);

    await inativarFornecedorNoBanco(fornecedor.id);
    const tentativas = await tentarCompromissosNovos(relacaoId);

    for (const [porta, response] of Object.entries(tentativas)) {
      expect(response.statusCode, `${porta}: ${response.body}`).toBe(400);
      expect((response.json() as { message: string }).message, porta).toContain(
        "Fornecedor inativo",
      );
    }
    expect(tentativas.preferencial.json()).toMatchObject({
      message: "Fornecedor inativo — reative o fornecedor antes de definir o fornecedor preferencial.",
    });

    const lida = await detalhe(relacaoId);
    expect((lida.json() as { supplierActive: boolean }).supplierActive).toBe(false);
    expect((lida.json() as { itemActive: boolean }).itemActive).toBe(true);
  });

  it("inativar o fornecedor limpa o preferencial das relações dele, sem apagar nada, e reativar não devolve", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();
    const relacaoId = await criarRelacao(item.id, fornecedor.id, {
      qualificationStatus: "APPROVED",
      preferred: true,
      initialOffer: OFERTA,
    });
    expect(
      (await detalhe(relacaoId)).json(),
      "a relação começa preferencial",
    ).toMatchObject({ preferred: true });

    const inativar = await app.inject({
      method: "POST",
      url: `/suppliers/${fornecedor.id}/deactivate`,
    });
    expect(inativar.statusCode, inativar.body).toBe(200);
    expect(inativar.json()).toMatchObject({ active: false });

    const depois = (await detalhe(relacaoId)).json() as {
      preferred: boolean;
      active: boolean;
      qualificationStatus: string;
      supplierActive: boolean;
      offers: unknown[];
      qualificationHistory: unknown[];
    };
    expect(depois.preferred, "o preferencial cai com a inativação").toBe(false);
    expect(depois.active, "a relação NÃO é inativada nem apagada").toBe(true);
    expect(depois.qualificationStatus, "a homologação fica como estava").toBe("APPROVED");
    expect(depois.supplierActive).toBe(false);
    expect(depois.offers, "as ofertas ficam").toHaveLength(1);
    expect(depois.qualificationHistory, "o histórico fica").toHaveLength(1);

    const reativar = await app.inject({
      method: "POST",
      url: `/suppliers/${fornecedor.id}/activate`,
    });
    expect(reativar.statusCode, reativar.body).toBe(200);
    expect(
      (await detalhe(relacaoId)).json(),
      "preferencial é decisão de Compras: reativar não a toma de novo",
    ).toMatchObject({ preferred: false, supplierActive: true });
  });

  it("OC confirmada antes da inativação continua podendo ser recebida, e a OC marca as duas partes", async () => {
    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    const criada = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: fornecedor.id,
        orderDate: "2026-09-01",
        lines: [{ itemId: item.id, orderedQuantity: "10", unitPrice: "12.5" }],
      },
    });
    expect(criada.statusCode, criada.body).toBe(201);
    const ordem = criada.json() as { id: string; lines: { id: string }[] };
    criados.ordens.push(ordem.id);

    const confirmada = await app.inject({
      method: "POST",
      url: `/purchase-orders/${ordem.id}/confirm`,
    });
    expect(confirmada.statusCode, confirmada.body).toBe(200);

    // Os dois cadastros saem DEPOIS do compromisso assumido.
    await inativarItem(item.id);
    await inativarFornecedorNoBanco(fornecedor.id);

    const recebimento = await app.inject({
      method: "POST",
      url: `/purchase-orders/${ordem.id}/receipts`,
      payload: {
        receivedAt: "2026-09-10T12:00:00.000Z",
        lines: [{ purchaseOrderLineId: ordem.lines[0]!.id, receivedQuantity: "10" }],
      },
    });
    expect(
      recebimento.statusCode,
      `receber compromisso já assumido não é barrado pela inativação: ${recebimento.body}`,
    ).toBe(201);

    const lida = await app.inject({ method: "GET", url: `/purchase-orders/${ordem.id}` });
    const corpo = lida.json() as {
      status: string;
      supplierActive: boolean;
      lines: { itemActive: boolean }[];
    };
    expect(corpo.status).toBe("RECEIVED");
    expect(corpo.supplierActive, "a marca sai do servidor, não da ausência no catálogo").toBe(false);
    expect(corpo.lines[0]!.itemActive).toBe(false);
  });
});
