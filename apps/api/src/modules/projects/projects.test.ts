import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildPaymentSchedule, calcularTotaisOrcamento } from "@veridi/shared";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 38 — Projetos e Orçamentos versionados. Fixtures sintéticas:
 * nada depende do corpus real nem dos projetos importados.
 */

const fixtureProjectIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureAttachmentIds: string[] = [];

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
  if (fixtureAttachmentIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { id: { in: fixtureAttachmentIds } } });
  }
  if (fixtureProjectIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    // Projetos/produtos criados pela aprovação também saem daqui.
    const products = await prisma.product.findMany({
      where: { customerId: { in: fixtureCustomerIds } },
      select: { id: true, finishedProductItemId: true },
    });
    const productIds = products.map((row) => row.id);
    await prisma.project.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: productIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.item.deleteMany({
      where: {
        id: {
          in: products
            .map((row) => row.finishedProductItemId)
            .filter((id): id is string => id !== null),
        },
      },
    });
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: {
      code: `CLI-PRJ-${m}`,
      legalName: `Cliente Projeto ${m}`,
      tradeName: "Alpha",
      street: "Avenida Paulista",
      number: "1000",
      city: "São Paulo",
      state: "SP",
      active: true,
    },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createProject(
  app: App,
  customerId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: {
      customerId,
      name: `Projeto ${marker()}`,
      concept: "Detox",
      channel: "Distribuidora",
      ...overrides,
    },
  });
  if (response.statusCode === 201) fixtureProjectIds.push(response.json().id);
  return response;
}

/** Cria um produto de desenvolvimento no projeto. */
async function addProjectProduct(app: App, projectId: string, name?: string) {
  const response = await app.inject({
    method: "POST",
    url: `/projects/${projectId}/products`,
    payload: { operation: "create", ...(name ? { name } : {}) },
  });
  return response.json();
}

/** Adiciona uma linha ao orçamento e devolve o id dela. */
async function addQuoteLine(
  app: App,
  quoteId: string,
  projectProductId: string,
  values: { quotedQuantity?: string; uomCode?: string; unitPrice?: string } = {},
) {
  const quote = (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quoteId}/lines`,
      payload: { projectProductId },
    })
  ).json();
  const line = quote.lines[quote.lines.length - 1];
  if (Object.keys(values).length > 0) {
    await app.inject({ method: "PATCH", url: `/quote-lines/${line.id}`, payload: values });
  }
  return line.id as string;
}

/** Cria uma versão com uma linha, preenche e marca como enviada. */
async function sendQuote(app: App, projectId: string, price = "12.3456") {
  const link = await addProjectProduct(app, projectId);
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();
  await addQuoteLine(app, quote.id, link.id, {
    quotedQuantity: "300",
    uomCode: "un",
    unitPrice: price,
  });
  return (await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send` })).json();
}

describe("Projeto — cadastro e pipeline", () => {
  it("cria projeto aguardando, com código próprio, autor e histórico inicial", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { user } = await createAuthenticatedUser("COMMERCIAL");

    const customer = await createCustomer();
    const response = await createProject(app, customer.id);

    expect(response.statusCode).toBe(201);
    const project = response.json();
    expect(project.code.startsWith("PROJ-")).toBe(true);
    // Aprovar é ação explícita: nenhum projeto nasce aprovado.
    expect(project.status).toBe("WAITING");
    expect(project.source).toBe("MANUAL");
    expect(project.createdByName).toBe(user.name);
    expect(project.statusHistory).toHaveLength(1);
    expect(project.statusHistory[0].fromStatus).toBeNull();
    expect(project.statusHistory[0].toStatus).toBe("WAITING");

    // Cliente é obrigatório — projeto private label sem cliente não existe.
    const withoutCustomer = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Sem cliente" },
    });
    expect(withoutCustomer.statusCode).toBe(400);

    await app.close();
  });

  it("aceita null nos campos opcionais — formulário em branco não derruba o cadastro", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    // O formulário envia null para todo campo opcional deixado em branco.
    const response = await createProject(app, customer.id, {
      concept: null,
      channel: null,
      externalCode: null,
      notes: null,
    });

    expect(response.statusCode).toBe(201);
    const project = response.json();
    expect(project.concept).toBeNull();
    expect(project.channel).toBeNull();
    expect(project.externalCode).toBeNull();
    expect(project.notes).toBeNull();

    // null continua limpando o campo em uma atualização.
    const filled = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { notes: "Anotação inicial" },
    });
    expect(filled.statusCode).toBe(200);
    const cleared = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { notes: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().notes).toBeNull();

    await app.close();
  });

  it("percorre o pipeline com histórico e trata aprovado/cancelado como terminais", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();

    const toSample = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status: "SAMPLE" },
    });
    expect(toSample.statusCode).toBe(200);
    expect(toSample.json().status).toBe("SAMPLE");

    const toStandBy = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status: "STAND_BY" },
    });
    expect(toStandBy.json().status).toBe("STAND_BY");

    // Aprovar não passa pela rota de status: é ação própria.
    const fakeApprove = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status: "APPROVED" },
    });
    expect(fakeApprove.statusCode).toBe(409);

    const cancelWithoutDetails = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "OTHER" },
    });
    expect(cancelWithoutDetails.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "PRICE" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().cancelReason).toBe("PRICE");
    expect(cancelled.json().statusHistory).toHaveLength(4);

    // Cancelado é terminal e somente leitura.
    const reopen = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status: "WAITING" },
    });
    expect(reopen.statusCode).toBe(409);
    const edit = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { name: "Outro nome" },
    });
    expect(edit.statusCode).toBe(409);

    await app.close();
  });

  it("cliente fica travado depois do primeiro orçamento formalizado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const project = (await createProject(app, customerA.id)).json();

    // Antes de qualquer proposta, trocar o cliente é legítimo.
    const before = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { customerId: customerB.id },
    });
    expect(before.statusCode).toBe(200);

    await sendQuote(app, project.id);

    const after = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { customerId: customerA.id },
    });
    expect(after.statusCode).toBe(409);
    expect(after.json().error).toBe("customer_locked");

    await app.close();
  });
});

describe("Orçamento versionado", () => {
  it("mantém um único rascunho e cria V2 só depois do envio", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();

    const v1 = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    expect(v1.versionNumber).toBe(1);

    // Rascunho aberto: pedir "nova versão" devolve o próprio rascunho.
    const again = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    expect(again.id).toBe(v1.id);

    const link = await addProjectProduct(app, project.id);
    await addQuoteLine(app, v1.id, link.id, {
      quotedQuantity: "300",
      uomCode: "un",
      unitPrice: "10",
    });
    await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/send` });

    const v2 = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    expect(v2.versionNumber).toBe(2);
    // Dados comerciais são copiados como ponto de partida; status não.
    expect(v2.lines[0].quotedQuantity).toBe("300");
    expect(v2.status).toBe("DRAFT");

    const reread = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    const previous = reread.quoteVersions.find((quote: { id: string }) => quote.id === v1.id);
    expect(previous.status).toBe("SUPERSEDED");

    await app.close();
  });

  it("o que a tela previu é o que o servidor grava, e a versão enviada não muda (#8H)", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();

    // V1 enviada — histórico.
    const v1 = await sendQuote(app, project.id, "10");
    expect(v1.total).toBe("3000.00");

    // V2 em rascunho, com duas linhas.
    const v2 = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    const segunda = await addProjectProduct(app, project.id);
    await addQuoteLine(app, v2.id, segunda.id, {
      quotedQuantity: "100",
      uomCode: "un",
      unitPrice: "20",
    });
    await app.inject({
      method: "PATCH",
      url: `/quote-versions/${v2.id}`,
      payload: { discountPercent: "10" },
    });

    const antes = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    const rascunho = antes.quoteVersions.find((q: { id: string }) => q.id === v2.id);
    // 300 × 10 + 100 × 20 = 5.000,00; com 10% de desconto, 4.500,00.
    expect(rascunho.subtotal).toBe("5000.00");
    expect(rascunho.total).toBe("4500.00");

    // A prévia da tela: MESMAS funções, com a quantidade que está no campo.
    const previa = calcularTotaisOrcamento([
      { quotedQuantity: "600", unitPrice: "10" },
      { quotedQuantity: "100", unitPrice: "20" },
    ]);
    const totalPrevisto = buildPaymentSchedule({
      subtotal: previa.subtotal!,
      discountPercent: rascunho.discountPercent,
      method: rascunho.paymentMethod,
      downPaymentPercent: rascunho.downPaymentPercent,
      installmentCount: rascunho.installmentCount,
      installmentIntervalDays: rascunho.installmentIntervalDays,
      monthlyInterestPercent: rascunho.monthlyInterestPercent,
    }).total;
    expect(previa.subtotal).toBe("8000.00");
    expect(totalPrevisto).toBe("7200.00");

    // Gravar a quantidade prevista: o servidor chega ao mesmo número.
    const primeiraLinha = rascunho.lines.find(
      (line: { unitPrice: string | null }) => line.unitPrice === "10.0000",
    );
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${primeiraLinha.id}`,
      payload: { quotedQuantity: "600" },
    });

    const depois = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    const gravado = depois.quoteVersions.find((q: { id: string }) => q.id === v2.id);
    expect(gravado.subtotal).toBe(previa.subtotal);
    expect(gravado.total).toBe(totalPrevisto);

    // A V1 enviada continua exatamente como o cliente a recebeu.
    const historica = depois.quoteVersions.find((q: { id: string }) => q.id === v1.id);
    expect(historica.total).toBe("3000.00");
    expect(historica.lines[0].quotedQuantity).toBe("300");

    await app.close();
  });

  it("envio exige preço e congela o snapshot do cliente", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();
    const quote = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();

    const incomplete = await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send` });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error).toBe("incomplete_quote");

    const link = await addProjectProduct(app, project.id);
    await addQuoteLine(app, quote.id, link.id, {
      quotedQuantity: "300",
      uomCode: "un",
      unitPrice: "12.3456",
    });
    const sent = (
      await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send` })
    ).json();

    expect(sent.status).toBe("SENT");
    expect(sent.customerName).toBe(customer.legalName);
    expect(sent.customerStreet).toBe("Avenida Paulista");
    // Total é derivado em Decimal: 300 × 12,3456 = 3703,68.
    expect(sent.total).toBe("3703.68");
    const sentLine = sent.lines[0];
    expect(new Prisma.Decimal(sentLine.quotedQuantity).times(sentLine.unitPrice).toFixed(2)).toBe(
      "3703.68",
    );

    // Enviado é imutável: renegociar exige nova versão.
    const edit = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${sentLine.id}`,
      payload: { unitPrice: "9" },
    });
    expect(edit.statusCode).toBe(409);

    await getPrisma().customer.update({
      where: { id: customer.id },
      data: { street: "Rua Nova", city: "Campinas" },
    });
    const reread = (await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })).json();
    expect(reread.customerStreet).toBe("Avenida Paulista");

    await app.close();
  });

  it("aceite e recusa só valem sobre orçamento enviado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { user } = await createAuthenticatedUser("COMMERCIAL");

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();

    const draft = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    const earlyAccept = await app.inject({
      method: "POST",
      url: `/quote-versions/${draft.id}/accept`,
    });
    expect(earlyAccept.statusCode).toBe(409);

    const acceptLink = await addProjectProduct(app, project.id);
    await addQuoteLine(app, draft.id, acceptLink.id, {
      quotedQuantity: "100",
      uomCode: "un",
      unitPrice: "5",
    });
    await app.inject({ method: "POST", url: `/quote-versions/${draft.id}/send` });

    const accepted = (
      await app.inject({ method: "POST", url: `/quote-versions/${draft.id}/accept` })
    ).json();
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedByName).toBe(user.name);

    // Recusar depois de aceito não faz sentido.
    const reject = await app.inject({ method: "POST", url: `/quote-versions/${draft.id}/reject` });
    expect(reject.statusCode).toBe(409);

    await app.close();
  });
});

describe("Aprovação do projeto", () => {
  it("exige orçamento aceito", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status: "SAMPLE" },
    });

    const response = await app.inject({ method: "POST", url: `/projects/${project.id}/approve` });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("orçamento");

    await app.close();
  });

  it("cria Product, item de produto acabado e formulação V1 DRAFT — e é idempotente", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = (
      await createProject(app, customer.id, {
        dosageForm: "CAPSULE",
        presentationType: "POT",
        dosesPerPackage: 60,
        shelfLifeMonths: 24,
      })
    ).json();

    const quote = await sendQuote(app, project.id);
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });

    const approved = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/approve` })
    ).json();

    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.productId).not.toBeNull();
    expect(approved.productCode.startsWith("PROD-")).toBe(true);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: approved.productId },
      include: { finishedProductItem: true, formulationVersions: true },
    });
    expect(product.customerId).toBe(customer.id);
    // Brief do projeto vira ponto de partida do produto.
    expect(product.dosageForm).toBe("CAPSULE");
    expect(product.dosesPerPackage).toBe(60);
    expect(product.shelfLifeMonths).toBe(24);
    expect(product.finishedProductItem?.code.startsWith("PA-")).toBe(true);
    expect(product.finishedProductItem?.unitCode).toBe("un");

    // Formulação nasce DRAFT: o comercial aprova o negócio, não a receita.
    expect(product.formulationVersions).toHaveLength(1);
    expect(product.formulationVersions[0]!.status).toBe("DRAFT");
    expect(product.formulationVersions[0]!.versionNumber).toBe(1);

    // Aprovar de novo não cria um segundo produto.
    const second = await app.inject({ method: "POST", url: `/projects/${project.id}/approve` });
    expect(second.statusCode).toBe(409);
    expect(
      await prisma.product.count({ where: { customerId: customer.id } }),
    ).toBe(1);

    // Projeto aprovado é histórico.
    const edit = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      payload: { concept: "Sono" },
    });
    expect(edit.statusCode).toBe(409);

    await app.close();
  });

  it("preserva o vínculo quando o projeto já tem produto (caso legado)", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const finishedItem = await prisma.item.create({
      data: {
        code: `PA-PRJ-${marker()}`,
        type: "FINISHED_PRODUCT",
        name: `PA Projeto ${marker()}`,
        unitCode: "un",
        controlsLot: true,
        controlsExpiry: true,
        requiresQualityRelease: false,
        active: true,
      },
    });
    fixtureItemIds.push(finishedItem.id);
    const existingProduct = await prisma.product.create({
      data: {
        code: `PROD-PRJ-${marker()}`,
        name: `Produto Existente ${marker()}`,
        customerId: customer.id,
        finishedProductItemId: finishedItem.id,
        active: true,
      },
    });
    fixtureProductIds.push(existingProduct.id);

    const project = (await createProject(app, customer.id)).json();
    await prisma.project.update({
      where: { id: project.id },
      data: { productId: existingProduct.id },
    });

    // O produto legado é VINCULADO, não recriado: a proposta é sobre ele.
    const link = (
      await app.inject({
        method: "POST",
        url: `/projects/${project.id}/products`,
        payload: { operation: "link", productId: existingProduct.id },
      })
    ).json();
    const draft = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    await addQuoteLine(app, draft.id, link.id, {
      quotedQuantity: "300",
      uomCode: "un",
      unitPrice: "10",
    });
    await app.inject({ method: "POST", url: `/quote-versions/${draft.id}/send` });
    await app.inject({ method: "POST", url: `/quote-versions/${draft.id}/accept` });
    const approved = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/approve` })
    ).json();

    expect(approved.productId).toBe(existingProduct.id);
    // Nenhum produto novo foi criado para "completar" o fluxo.
    expect(await prisma.product.count({ where: { customerId: customer.id } })).toBe(1);

    await app.close();
  });
});

describe("Documentos e exportação do projeto", () => {
  it("aceita briefing e recusa laudo no contexto de projeto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (await createProject(app, customer.id)).json();

    const boundary = `----veridi${marker()}`;
    const build = (documentType: string) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\n${documentType}\r\n`,
          "utf8",
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="briefing.pdf"\r\n` +
            `Content-Type: application/pdf\r\n\r\n`,
          "utf8",
        ),
        Buffer.from("%PDF-1.4\n%%EOF\n", "utf8"),
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
      ]);
    const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };

    const briefing = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/attachments`,
      payload: build("BRIEFING"),
      headers,
    });
    expect(briefing.statusCode).toBe(201);
    fixtureAttachmentIds.push(briefing.json().id);
    expect(briefing.json().projectId).toBe(project.id);
    expect(briefing.json().uploadedByName).toBeTruthy();

    // Laudo é documento de lote — não existe no projeto.
    const coa = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/attachments`,
      payload: build("COA"),
      headers,
    });
    expect(coa.statusCode).toBe(400);
    expect(coa.json().error).toBe("invalid_document_type");

    await app.close();
  });

  it("CSV respeita os filtros e traz códigos, nunca UUID", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = (
      await createProject(app, customer.id, { channel: "Farmácia", concept: "Sono" })
    ).json();

    const csv = await app.inject({
      method: "GET",
      url: `/projects/export.csv?customerId=${customer.id}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(project.code);
    expect(csv.body).toContain("Aguardando");
    expect(csv.body).toContain("Farmácia");
    expect(csv.body).not.toContain(project.id);

    // Filtro que não casa devolve só o cabeçalho.
    const filtered = await app.inject({
      method: "GET",
      url: `/projects/export.csv?customerId=${customer.id}&status=APPROVED`,
    });
    expect(filtered.body).not.toContain(project.code);

    await app.close();
  });

  it("vocabulário de conceito e canal vem dos valores já usados", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    await createProject(app, customer.id, { concept: "Termogênico", channel: "Academia" });

    const vocabulary = (await app.inject({ method: "GET", url: "/projects/vocabulary" })).json();
    expect(vocabulary.concepts).toContain("Termogênico");
    expect(vocabulary.channels).toContain("Academia");

    await app.close();
  });
});
