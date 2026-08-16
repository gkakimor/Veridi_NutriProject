import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { sanitizeFileName } from "../../lib/file-storage.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 37 — qualidade documental (CoA) e anexos.
 *
 * Fixtures sintéticas: nada depende do corpus real, e nenhum arquivo real
 * de cliente é usado.
 */

const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureAttachmentIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** PDF mínimo válido — o teste não depende de nenhum documento real. */
function pdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");
}

/** Multipart montado à mão: sem dependência extra só para o teste. */
function multipartPayload(
  file: { name: string; mimeType: string; content: Buffer },
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----veridi${marker()}`;
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`,
      "utf8",
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  );

  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
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
  if (fixtureItemIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { lot: { itemId: { in: fixtureItemIds } } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.receiptLine.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.receipt.deleteMany({ where: { customerId: { in: fixtureCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem(
  app: App,
  overrides: { requiresCoa?: boolean; requiresQualityRelease?: boolean } = {},
) {
  const item = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: {
        type: "RAW_MATERIAL",
        name: `Item CoA ${marker()}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: overrides.requiresQualityRelease ?? false,
        ...(overrides.requiresCoa !== undefined ? { requiresCoa: overrides.requiresCoa } : {}),
      },
    })
  ).json();
  fixtureItemIds.push(item.id);
  return item;
}

async function createCustomer() {
  const prisma = getPrisma();
  const customer = await prisma.customer.create({
    data: { code: `CLI-COA-${marker()}`, legalName: `Cliente CoA ${marker()}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

/** Recebe material do cliente — caminho mais curto para nascer um lote real. */
async function receiveCustomerSupplied(app: App, customerId: string, itemId: string, quantity = "10") {
  const receipt = (
    await app.inject({
      method: "POST",
      url: "/receipts/customer-supplied",
      payload: {
        customerId,
        receivedAt: new Date().toISOString(),
        lines: [{ itemId, receivedQuantity: quantity }],
      },
    })
  ).json();
  return { receipt, lotId: receipt.lines[0].lotId as string };
}

async function uploadCoa(app: App, lotId: string, fileName = "laudo.pdf") {
  const { payload, headers } = multipartPayload(
    { name: fileName, mimeType: "application/pdf", content: pdfBuffer() },
    { documentType: "COA" },
  );
  const response = await app.inject({
    method: "POST",
    url: `/lots/${lotId}/attachments`,
    payload,
    headers,
  });
  if (response.statusCode === 201) fixtureAttachmentIds.push(response.json().id);
  return response;
}

describe("Exigência documental do item e do lote", () => {
  it("item que exige CoA gera lote PENDING e aguardando liberação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true, requiresQualityRelease: false });
    expect(item.requiresCoa).toBe(true);

    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.requiresCoa).toBe(true);
    expect(lot.coaStatus).toBe("PENDING");
    // Exigir laudo já impede o lote de nascer disponível, mesmo sem
    // liberação manual configurada.
    expect(lot.status).toBe("AWAITING_RELEASE");
    expect(lot.available).toBe("0");

    await app.close();
  });

  it("item sem exigência gera lote NOT_REQUIRED e fluxo normal", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem(app, { requiresCoa: false, requiresQualityRelease: false });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.coaStatus).toBe("NOT_REQUIRED");
    expect(lot.status).toBe("AVAILABLE");
    expect(lot.available).toBe("10");

    await app.close();
  });

  it("mudar o item depois não reclassifica lote existente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    await app.inject({ method: "PATCH", url: `/items/${item.id}`, payload: { requiresCoa: false } });

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    // O lote guarda a exigência que valia quando nasceu.
    expect(lot.requiresCoa).toBe(true);
    expect(lot.coaStatus).toBe("PENDING");

    const release = await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    expect(release.statusCode).toBe(400);
    expect(release.json().message).toContain("CoA");

    await app.close();
  });
});

describe("Upload e validação de arquivo", () => {
  it("upload de PDF registra metadados, autor e move PENDING para RECEIVED", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();
    const { user } = await createAuthenticatedUser("QUALITY");

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const response = await uploadCoa(app, lotId, "laudo-lote.pdf");
    expect(response.statusCode).toBe(201);
    const attachment = response.json();
    expect(attachment.documentType).toBe("COA");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.sizeBytes).toBeGreaterThan(0);
    expect(attachment.uploadedByName).toBe(user.name);
    expect(attachment.active).toBe(true);

    const prisma = getPrisma();
    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    // Nome do usuário nunca vira caminho de arquivo.
    expect(stored.storageKey).not.toContain("laudo-lote");

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    // Documento chegou, mas ninguém aprovou nada ainda.
    expect(lot.coaStatus).toBe("RECEIVED");

    await app.close();
  });

  it("recusa tipo de arquivo não permitido e neutraliza path traversal no nome", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const html = multipartPayload(
      { name: "laudo.html", mimeType: "text/html", content: Buffer.from("<script>", "utf8") },
      { documentType: "COA" },
    );
    const rejected = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/attachments`,
      payload: html.payload,
      headers: html.headers,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("unsupported_file_type");

    // Extensão precisa combinar com o MIME declarado.
    const disguised = multipartPayload(
      { name: "malicioso.exe", mimeType: "application/pdf", content: pdfBuffer() },
      { documentType: "COA" },
    );
    const disguisedResponse = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/attachments`,
      payload: disguised.payload,
      headers: disguised.headers,
    });
    expect(disguisedResponse.statusCode).toBe(400);

    // Nome com caminho é sanitizado, nunca escapa do diretório.
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\\\Windows\\\\system32\\\\laudo.pdf")).toBe("laudo.pdf");

    await app.close();
  });

  it("CoA não é aceito em produto e arte não é aceita em lote", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const finishedItem = (
      await app.inject({
        method: "POST",
        url: "/items",
        payload: {
          type: "FINISHED_PRODUCT",
          name: `PA CoA ${marker()}`,
          unitCode: "un",
          controlsLot: true,
          controlsExpiry: false,
          requiresQualityRelease: false,
        },
      })
    ).json();
    fixtureItemIds.push(finishedItem.id);

    const product = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: { name: `Produto CoA ${marker()}`, finishedProductItemId: finishedItem.id },
      })
    ).json();
    fixtureProductIds.push(product.id);

    const coaInProduct = multipartPayload(
      { name: "laudo.pdf", mimeType: "application/pdf", content: pdfBuffer() },
      { documentType: "COA" },
    );
    const rejected = await app.inject({
      method: "POST",
      url: `/products/${product.id}/attachments`,
      payload: coaInProduct.payload,
      headers: coaInProduct.headers,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("invalid_document_type");

    // Arte de rótulo é documentação do produto — não altera nada operacional.
    const art = multipartPayload(
      { name: "arte.png", mimeType: "image/png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { documentType: "LABEL_ART" },
    );
    const accepted = await app.inject({
      method: "POST",
      url: `/products/${product.id}/attachments`,
      payload: art.payload,
      headers: art.headers,
    });
    expect(accepted.statusCode).toBe(201);
    fixtureAttachmentIds.push(accepted.json().id);

    await app.close();
  });
});

describe("Revisão do CoA", () => {
  it("Compras anexa mas não aprova; Qualidade aprova", async () => {
    const purchasing = buildTestApp("PURCHASING");
    await purchasing.ready();
    const quality = buildTestApp("QUALITY");
    await quality.ready();
    const { user: qualityUser } = await createAuthenticatedUser("QUALITY");

    const item = await createItem(purchasing, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(purchasing, customer.id, item.id);

    const uploaded = await uploadCoa(purchasing, lotId);
    expect(uploaded.statusCode).toBe(201);

    const forbidden = await purchasing.inject({
      method: "POST",
      url: `/lots/${lotId}/coa/approve`,
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);

    const approved = await quality.inject({
      method: "POST",
      url: `/lots/${lotId}/coa/approve`,
      payload: { note: "Laudo conferido" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().coaStatus).toBe("APPROVED");
    expect(approved.json().reviewedByName).toBe(qualityUser.name);
    // Aprovar o documento NÃO libera o lote.
    expect(approved.json().lotStatus).toBe("AWAITING_RELEASE");

    await purchasing.close();
    await quality.close();
  });

  it("não aprova sem documento anexado", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const response = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/coa/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Anexe o CoA");

    await app.close();
  });

  it("rejeição exige motivo, bloqueia lote disponível e não move estoque", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);
    await uploadCoa(app, lotId);

    const withoutReason = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/coa/reject`,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    // Cenário histórico: lote já disponível quando o laudo é reprovado.
    await prisma.lot.update({ where: { id: lotId }, data: { status: "AVAILABLE" } });
    const movementsBefore = await prisma.inventoryMovement.count({ where: { lotId } });

    const rejected = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/coa/reject`,
      payload: { reason: "Resultado fora de especificação" },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().coaStatus).toBe("REJECTED");
    expect(rejected.json().lotStatus).toBe("BLOCKED");

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.onHand).toBe("10");
    expect(lot.available).toBe("0");
    expect(await prisma.inventoryMovement.count({ where: { lotId } })).toBe(movementsBefore);

    await app.close();
  });

  it("liberação da Qualidade só passa com CoA aprovado", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);

    const beforeDocument = await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    expect(beforeDocument.statusCode).toBe(400);

    await uploadCoa(app, lotId);
    const afterDocument = await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    expect(afterDocument.statusCode).toBe(400);

    await app.inject({ method: "POST", url: `/lots/${lotId}/coa/approve`, payload: {} });
    const released = await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    expect(released.statusCode).toBe(200);
    expect(released.json().status).toBe("AVAILABLE");
    // Material do cliente segue exatamente o mesmo caminho documental.
    expect(released.json().ownerType).toBe("CUSTOMER");
    expect(released.json().available).toBe("10");

    await app.close();
  });

  it("arquivar o último documento devolve o lote para pendência", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);
    const uploaded = await uploadCoa(app, lotId);
    const attachmentId = uploaded.json().id as string;

    const archived = await app.inject({
      method: "POST",
      url: `/attachments/${attachmentId}/archive`,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().active).toBe(false);
    expect(archived.json().archivedByName).toBeTruthy();
    // Arquivar preserva o registro e quem enviou.
    expect(archived.json().uploadedByName).toBeTruthy();

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.coaStatus).toBe("PENDING");

    const activeList = (
      await app.inject({ method: "GET", url: `/lots/${lotId}/attachments` })
    ).json();
    expect(activeList.attachments).toHaveLength(0);

    const withArchived = (
      await app.inject({ method: "GET", url: `/lots/${lotId}/attachments?includeArchived=true` })
    ).json();
    expect(withArchived.attachments).toHaveLength(1);

    await app.close();
  });
});

describe("Fila da Qualidade e leitura documental", () => {
  it("fila traz pendências com saldo do ledger e respeita filtros", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id, "25");

    const pending = (
      await app.inject({ method: "GET", url: `/quality/coa-queue?itemId=${item.id}&onlyPending=true` })
    ).json();
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].lotId).toBe(lotId);
    expect(pending.rows[0].coaStatus).toBe("PENDING");
    expect(pending.rows[0].onHand).toBe("25");
    expect(pending.rows[0].ownerType).toBe("CUSTOMER");

    await uploadCoa(app, lotId);
    await app.inject({ method: "POST", url: `/lots/${lotId}/coa/approve`, payload: {} });

    const stillPending = (
      await app.inject({ method: "GET", url: `/quality/coa-queue?itemId=${item.id}&onlyPending=true` })
    ).json();
    expect(stillPending.rows).toHaveLength(0);

    const approvedOnly = (
      await app.inject({
        method: "GET",
        url: `/quality/coa-queue?itemId=${item.id}&coaStatus=APPROVED`,
      })
    ).json();
    expect(approvedOnly.rows).toHaveLength(1);

    await app.close();
  });

  it("R-01, materiais de clientes e download refletem o estado documental", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);
    const uploaded = await uploadCoa(app, lotId);

    const position = (
      await app.inject({ method: "GET", url: `/reports/inventory/position?itemId=${item.id}` })
    ).json();
    expect(position.rows[0].coaStatus).toBe("RECEIVED");

    const materials = (
      await app.inject({ method: "GET", url: `/inventory/customer-materials?customerId=${customer.id}` })
    ).json();
    expect(materials.rows[0].coaStatus).toBe("RECEIVED");

    const csv = await app.inject({
      method: "GET",
      url: `/reports/inventory/position/export.csv?itemId=${item.id}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("Aguardando análise");

    // Download exige sessão e devolve o conteúdo com o MIME correto.
    const download = await app.inject({
      method: "GET",
      url: `/attachments/${uploaded.json().id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");

    await app.close();
  });

  it("rastreabilidade preserva estado e metadados do laudo, sem binário", async () => {
    const app = buildTestApp("QUALITY");
    await app.ready();

    const item = await createItem(app, { requiresCoa: true });
    const customer = await createCustomer();
    const { lotId } = await receiveCustomerSupplied(app, customer.id, item.id);
    await uploadCoa(app, lotId, "laudo-rastreio.pdf");

    const traceability = (
      await app.inject({ method: "GET", url: `/lots/${lotId}/traceability` })
    ).json();
    expect(traceability.kind).toBe("RAW_MATERIAL");
    expect(traceability.coaStatus).toBe("RECEIVED");
    expect(traceability.coaDocuments).toHaveLength(1);
    expect(traceability.coaDocuments[0].originalFileName).toBe("laudo-rastreio.pdf");
    expect(traceability.coaDocuments[0].uploadedByName).toBeTruthy();
    expect(JSON.stringify(traceability)).not.toContain("storageKey");

    await app.close();
  });
});
