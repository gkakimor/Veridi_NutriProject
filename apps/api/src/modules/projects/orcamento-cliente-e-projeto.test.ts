import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Cliente e projeto no documento do orçamento — PDF-DATA-PARITY-01.
 *
 * O PDF do Orçamento só desenha o que o DTO entrega. O envio congela o
 * snapshot de cliente e projeto (`PRODUCT_RULES.md`, "Quotes are versioned");
 * antes dele não existe snapshot, e o rascunho saía com Cliente, CNPJ e
 * Projeto "—". O que estes testes fixam:
 *
 * 1. **Rascunho mostra o cadastro atual** — o mesmo que o envio vai congelar —
 *    sem gravar nada na versão.
 * 2. **Enviado é história**: editar cliente ou projeto depois do envio não
 *    muda o documento.
 * 3. **Versão fora de rascunho sem snapshot (legado) não relê o cadastro.**
 * 4. **Ausente continua ausente**: campo que o cadastro não tem vem `null`.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await getPrisma().unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou — o banco é compartilhado com o app local.
  if (fixtureProjectIds.length > 0) {
    await prisma.quoteLine.deleteMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
    });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    const produtos = await prisma.product.findMany({
      where: { id: { in: fixtureProductIds } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
    const itens = produtos
      .map((produto) => produto.finishedProductItemId)
      .filter((id): id is string => id !== null);
    if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** 14 dígitos únicos por execução — o índice parcial não aceita CNPJ repetido. */
function cnpjUnico(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10)}`.slice(-14);
}

const ENDERECO = {
  street: "Rua das Palmeiras",
  number: "1234",
  complement: "Sala 5",
  district: "Centro",
  zipCode: "13010000",
  city: "Campinas",
  state: "SP",
};

/** Rascunho com um produto precificado; cliente e projeto completos ou só o obrigatório. */
async function rascunho(app: App, completo = true) {
  const m = marca();
  const prisma = getPrisma();
  const customer = await prisma.customer.create({
    data: {
      code: `CLI-PAR-${m}`,
      legalName: `Cliente Paridade ${m} Ltda`,
      active: true,
      ...(completo ? { tradeName: "NutriMais", cnpj: cnpjUnico(), ...ENDERECO } : {}),
    },
  });
  fixtureCustomerIds.push(customer.id);
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: `Projeto Paridade ${m}`, customerId: customer.id, entryDate: new Date().toISOString() },
    })
  ).json();
  fixtureProjectIds.push(project.id);
  if (completo) {
    await prisma.project.update({
      where: { id: project.id },
      data: { concept: "Proteína para academia", channel: "Distribuidor" },
    });
  }
  const preparado = (
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/technical-product`,
      payload: { finishedUnitCode: "un" },
    })
  ).json();
  fixtureProductIds.push(preparado.productId);

  const produtos = (await app.inject({ method: "GET", url: `/projects/${project.id}/products` })).json()
    .products as { id: string }[];
  const quote = (await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })).json();
  const comLinha = (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: produtos[0]!.id },
    })
  ).json();
  const preco = await app.inject({
    method: "PATCH",
    url: `/quote-lines/${comLinha.lines[0].id}`,
    payload: { quotedQuantity: "100", uomCode: "un", unitPrice: "12.3456" },
  });
  expect(preco.statusCode, preco.body).toBe(200);
  const validade = await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: { validUntil: "2099-12-31" },
  });
  expect(validade.statusCode, validade.body).toBe(200);
  return { customer, project, quoteId: quote.id as string };
}

async function lerOrcamento(app: App, quoteId: string) {
  return (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
}

async function enviar(app: App, quoteId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

describe("PDF-DATA-PARITY-01 — cliente e projeto no documento do orçamento", () => {
  let app: App;

  beforeAll(async () => {
    app = buildTestApp("ADMIN");
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rascunho traz o cadastro atual — razão social, fantasia, CNPJ, endereço e projeto — sem gravar snapshot", async () => {
    const { customer, project, quoteId } = await rascunho(app);
    const dto = await lerOrcamento(app, quoteId);

    expect(dto.status).toBe("DRAFT");
    expect(dto.customerCode).toBe(customer.code);
    expect(dto.customerName).toBe(customer.legalName);
    expect(dto.customerTradeName).toBe("NutriMais");
    expect(dto.customerCnpj).toBe(customer.cnpj);
    expect(dto.customerStreet).toBe(ENDERECO.street);
    expect(dto.customerNumber).toBe(ENDERECO.number);
    expect(dto.customerComplement).toBe(ENDERECO.complement);
    expect(dto.customerDistrict).toBe(ENDERECO.district);
    expect(dto.customerZipCode).toBe(ENDERECO.zipCode);
    expect(dto.customerCity).toBe(ENDERECO.city);
    expect(dto.customerState).toBe(ENDERECO.state);
    expect(dto.projectCode).toBe(project.code);
    expect(dto.projectName).toBe(project.name);
    expect(dto.projectConcept).toBe("Proteína para academia");
    expect(dto.projectChannel).toBe("Distribuidor");

    // Ler não congela: o snapshot só nasce no envio.
    const gravada = await getPrisma().quoteVersion.findUniqueOrThrow({ where: { id: quoteId } });
    expect(gravada.customerName).toBeNull();
    expect(gravada.customerCnpj).toBeNull();
    expect(gravada.projectCode).toBeNull();
  });

  it("rascunho acompanha o cadastro; o envio congela o que ele mostrava, e editar depois não muda o documento", async () => {
    const { customer, project, quoteId } = await rascunho(app);
    const prisma = getPrisma();
    const renomeado = `${customer.legalName} Renomeado`;
    await prisma.customer.update({ where: { id: customer.id }, data: { legalName: renomeado } });
    expect((await lerOrcamento(app, quoteId)).customerName).toBe(renomeado);

    await enviar(app, quoteId);
    const enviado = await lerOrcamento(app, quoteId);
    expect(enviado.status).toBe("SENT");
    expect(enviado.customerName).toBe(renomeado);
    expect(enviado.customerCnpj).toBe(customer.cnpj);
    expect(enviado.projectCode).toBe(project.code);

    // Documento enviado é história: o cadastro muda, o papel não.
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        legalName: "Outra Razão Social Ltda",
        tradeName: "Outra Fantasia",
        cnpj: cnpjUnico(),
        street: "Rua Nova",
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { concept: "Conceito novo", channel: "Farmácia" },
    });
    const depois = await lerOrcamento(app, quoteId);
    expect(depois.customerName).toBe(renomeado);
    expect(depois.customerTradeName).toBe("NutriMais");
    expect(depois.customerCnpj).toBe(customer.cnpj);
    expect(depois.customerStreet).toBe(ENDERECO.street);
    expect(depois.projectConcept).toBe("Proteína para academia");
    expect(depois.projectChannel).toBe("Distribuidor");
  });

  it("versão fora de rascunho sem snapshot (legado) não relê o cadastro", async () => {
    const { quoteId } = await rascunho(app);
    await getPrisma().quoteVersion.update({
      where: { id: quoteId },
      data: { status: "ARCHIVED", source: "LEGACY_IMPORT" },
    });

    const dto = await lerOrcamento(app, quoteId);
    expect(dto.status).toBe("ARCHIVED");
    expect(dto.customerName).toBeNull();
    expect(dto.customerCnpj).toBeNull();
    expect(dto.projectCode).toBeNull();
  });

  it("o que o cadastro não tem continua ausente: null, nunca texto inventado", async () => {
    const { customer, quoteId } = await rascunho(app, false);
    const dto = await lerOrcamento(app, quoteId);

    expect(dto.customerName).toBe(customer.legalName);
    for (const campo of [
      "customerTradeName",
      "customerCnpj",
      "customerStreet",
      "customerNumber",
      "customerComplement",
      "customerDistrict",
      "customerZipCode",
      "customerCity",
      "customerState",
      "projectConcept",
      "projectChannel",
    ]) {
      expect(dto[campo], campo).toBeNull();
    }
  });
});
