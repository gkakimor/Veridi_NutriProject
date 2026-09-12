import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * SUPPLIER-ADDRESS-01 — endereço estruturado e OPCIONAL do Fornecedor.
 *
 * O modelo é o MESMO do Cliente, campo a campo, e as regras de CEP e UF são
 * as mesmas: o que passa num cadastro passa no outro — há um caso abaixo que
 * afirma isso com a MESMA carga nos dois.
 *
 * O que esta suíte protege acima de tudo é que endereço continua sendo
 * cadastro COMPLEMENTAR: fornecedor sem endereço existe, homologa item e vira
 * preferencial, e nenhum fluxo de Compras passou a exigir o que é opcional.
 *
 * Fixtures sintéticas: nada aqui depende do corpus real nem do seed.
 */

const createdSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierItemIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const ADDRESS_FIELDS = [
  "street",
  "number",
  "complement",
  "district",
  "zipCode",
  "city",
  "state",
] as const;

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
});

afterEach(async () => {
  if (createdSupplierIds.length === 0) return;
  const prisma = getPrisma();
  // A relação Item × Fornecedor sai antes do fornecedor: a FK existe e é o
  // ponto do caso de Compras.
  const relacoes = await prisma.supplierItem.findMany({
    where: { supplierId: { in: createdSupplierIds } },
    select: { id: true },
  });
  const relacaoIds = relacoes.map((relacao) => relacao.id);
  if (relacaoIds.length > 0) {
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItemId: { in: relacaoIds } },
    });
    await prisma.supplierItem.deleteMany({ where: { id: { in: relacaoIds } } });
  }
  await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
  createdSupplierIds.length = 0;
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureSupplierItemIds.length > 0) {
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItemId: { in: fixtureSupplierItemIds } },
    });
    await prisma.supplierItem.deleteMany({ where: { id: { in: fixtureSupplierItemIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

async function criarFornecedor(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/suppliers",
    payload: { legalName: `Fornecedor endereço ${marker()}`, ...overrides },
  });
  if (response.statusCode === 201) createdSupplierIds.push(response.json().id);
  return response;
}

/** Mensagem da API para um campo — o teste afirma a regra, não o envelope. */
function issueFor(
  response: { json: () => { issues?: { path: string; message: string }[] } },
  path: string,
): string | undefined {
  return response.json().issues?.find((issue) => issue.path === path)?.message;
}

const ENDERECO_COMPLETO = {
  zipCode: "04816-100",
  street: "Rua Vicente José de Almeida",
  number: "120",
  complement: "Galpão 3",
  district: "Cupecê",
  city: "São Paulo",
  state: "sp",
};

describe("Fornecedor — endereço opcional", () => {
  it("cria fornecedor SEM endereço: válido, com todos os campos em null", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await criarFornecedor(app);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    for (const field of ADDRESS_FIELDS) expect(body[field]).toBeNull();

    await app.close();
  });

  it("cria fornecedor com endereço completo e normaliza CEP e UF", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await criarFornecedor(app, ENDERECO_COMPLETO);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    // CEP viaja com máscara e grava só dígitos; UF sobe para maiúscula.
    expect(body.zipCode).toBe("04816100");
    expect(body.state).toBe("SP");
    expect(body.street).toBe("Rua Vicente José de Almeida");
    expect(body.number).toBe("120");
    expect(body.complement).toBe("Galpão 3");
    expect(body.district).toBe("Cupecê");
    expect(body.city).toBe("São Paulo");

    await app.close();
  });

  it("aceita endereço PARCIAL: cidade e UF sem CEP nem logradouro", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await criarFornecedor(app, { city: "Campinas", state: "SP" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.city).toBe("Campinas");
    expect(body.state).toBe("SP");
    expect(body.zipCode).toBeNull();
    expect(body.street).toBeNull();
    expect(body.number).toBeNull();

    await app.close();
  });

  it("detalhe e listagem devolvem o endereço gravado", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await criarFornecedor(app, ENDERECO_COMPLETO);
    const id = criado.json().id;

    const detalhe = await app.inject({ method: "GET", url: `/suppliers/${id}` });
    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json().zipCode).toBe("04816100");
    expect(detalhe.json().city).toBe("São Paulo");

    const lista = await app.inject({ method: "GET", url: `/suppliers?ids=${id}` });
    expect(lista.statusCode).toBe(200);
    const encontrado = lista.json().suppliers.find((s: { id: string }) => s.id === id);
    expect(encontrado.state).toBe("SP");
    expect(encontrado.street).toBe("Rua Vicente José de Almeida");

    await app.close();
  });

  it("edita o endereço de um fornecedor que não tinha nenhum", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await criarFornecedor(app);
    const id = criado.json().id;
    expect(criado.json().city).toBeNull();

    const response = await app.inject({
      method: "PATCH",
      url: `/suppliers/${id}`,
      payload: {
        zipCode: "13010-000",
        street: "Avenida Francisco Glicério",
        city: "Campinas",
        state: "SP",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().zipCode).toBe("13010000");
    expect(response.json().city).toBe("Campinas");

    await app.close();
  });

  it("campo enviado vazio LIMPA o valor gravado (volta a null)", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await criarFornecedor(app, ENDERECO_COMPLETO);
    const id = criado.json().id;

    const response = await app.inject({
      method: "PATCH",
      url: `/suppliers/${id}`,
      payload: { complement: "", zipCode: "", state: "" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.complement).toBeNull();
    expect(body.zipCode).toBeNull();
    expect(body.state).toBeNull();
    // O que não foi enviado continua gravado.
    expect(body.city).toBe("São Paulo");

    await app.close();
  });

  it("ausência de chave NÃO mexe no endereço gravado", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await criarFornecedor(app, ENDERECO_COMPLETO);
    const id = criado.json().id;

    const response = await app.inject({
      method: "PATCH",
      url: `/suppliers/${id}`,
      payload: { tradeName: "Outro nome" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().city).toBe("São Paulo");
    expect(response.json().zipCode).toBe("04816100");

    await app.close();
  });
});

describe("Fornecedor — CEP e UF seguem a regra do Cliente", () => {
  it("recusa CEP incompleto com a mesma mensagem do Cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await criarFornecedor(app, { zipCode: "1234" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "zipCode")).toBe("CEP deve ter 8 dígitos");

    await app.close();
  });

  it("recusa UF que não existe", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await criarFornecedor(app, { state: "XX" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "state")).toBe("UF inválida");

    await app.close();
  });

  it("não é mais rígido que o Cliente: a MESMA carga é aceita nos dois cadastros", async () => {
    const app = buildTestApp();
    await app.ready();

    const endereco = {
      zipCode: "04816100",
      street: "  Rua Vicente José de Almeida  ",
      city: " São Paulo ",
      state: "sp",
    };

    const fornecedor = await criarFornecedor(app, endereco);
    const cliente = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName: `Cliente espelho ${marker()}`, ...endereco },
    });

    expect(fornecedor.statusCode).toBe(201);
    expect(cliente.statusCode).toBe(201);
    // Trim e maiúscula da UF acontecem igual nos dois.
    expect(fornecedor.json().street).toBe(cliente.json().street);
    expect(fornecedor.json().city).toBe(cliente.json().city);
    expect(fornecedor.json().state).toBe(cliente.json().state);
    expect(fornecedor.json().zipCode).toBe(cliente.json().zipCode);

    await getPrisma().customer.delete({ where: { id: cliente.json().id } });
    await app.close();
  });
});

describe("Fornecedor sem endereço continua em Compras", () => {
  it("homologa item e vira preferencial sem nenhum campo de endereço", async () => {
    const compras = buildTestApp("PURCHASING");
    await compras.ready();

    const criado = await criarFornecedor(compras);
    const supplierId = criado.json().id;
    expect(criado.json().zipCode).toBeNull();

    const m = marker();
    const item = await getPrisma().item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-END-${m}`,
        name: `Item endereço ${m}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: false,
        active: true,
      },
    });
    fixtureItemIds.push(item.id);

    const relacao = await compras.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId },
    });
    expect(relacao.statusCode).toBe(201);
    const supplierItemId = relacao.json().id;
    fixtureSupplierItemIds.push(supplierItemId);

    const qualidade = buildTestApp("QUALITY");
    await qualidade.ready();
    const homologacao = await qualidade.inject({
      method: "POST",
      url: `/supplier-items/${supplierItemId}/qualification`,
      payload: { status: "APPROVED", note: "Auditoria ok" },
    });
    expect(homologacao.statusCode).toBe(200);
    await qualidade.close();

    const preferencia = await compras.inject({
      method: "POST",
      url: `/supplier-items/${supplierItemId}/preferred`,
      payload: { preferred: true },
    });
    expect(preferencia.statusCode).toBe(200);
    expect(preferencia.json().preferred).toBe(true);

    await compras.close();
  });
});
