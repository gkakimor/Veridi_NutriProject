import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Supplier, UomDimension, UserRole } from "@prisma/client";
import {
  ITEM_TYPE_DEFAULTS,
  SUPPLIER_EDIT_ROLES,
  SUPPLIER_STATUS_CHANGE_ROLES,
  USER_ROLES,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { uniqueCnpj } from "../../test-support/br-documents.js";

/**
 * Quem cria, edita, inativa e reativa o Fornecedor — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Decisão do PO: Compras e Administrador. A Qualidade não edita o Fornecedor —
 * ela homologa no relacionamento Item × Fornecedor, que continua com a regra
 * própria. Produção, Comercial e Consulta leem. A recusa vem antes do corpo e
 * da existência, e nada é gravado; transição de situação que não parte da
 * situação atual é 409.
 */

const fornecedores: string[] = [];
const itens: string[] = [];
const relacoes: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const EDITAM = ["PURCHASING", "ADMIN"] as const satisfies readonly UserRole[];
const SO_CONSULTAM = ["QUALITY", "PRODUCTION", "COMMERCIAL", "VIEWER"] as const satisfies readonly UserRole[];
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
const RECUSA = { error: "forbidden", message: "Seu perfil não permite esta ação." };

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await getPrisma().unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Relação sai antes (histórico e ofertas em cascade): fornecedor e item são RESTRICT para ela.
  if (relacoes.length > 0) await prisma.supplierItem.deleteMany({ where: { id: { in: relacoes } } });
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
  if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
});

async function criar(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/suppliers", payload });
  if (resposta.statusCode === 201) fornecedores.push(resposta.json().id as string);
  return resposta;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/suppliers/${id}`, payload });
}

function situacao(app: App, id: string, acao: "activate" | "deactivate") {
  return app.inject({ method: "POST", url: `/suppliers/${id}/${acao}` });
}

function cadastro(rotulo: string) {
  return {
    legalName: `Fornecedor permissão ${rotulo}`,
    tradeName: "Insumos Brasil",
    cnpj: uniqueCnpj(),
    email: "compras@insumos.com.br",
    phone: "11987654321",
    zipCode: "01310100",
    street: "Avenida Paulista",
    number: "1000",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    notes: "Entrega às terças",
  };
}

async function fornecedorExistente(extra: Partial<Supplier> = {}): Promise<Supplier> {
  const m = marca();
  const fornecedor = await getPrisma().supplier.create({
    data: { code: `FOR-PERM-${m}`, legalName: `Fornecedor existente ${m}`, active: true, ...extra },
  });
  fornecedores.push(fornecedor.id);
  return fornecedor;
}

function linha(id: string) {
  return getPrisma().supplier.findUniqueOrThrow({ where: { id } });
}

async function comApp<T>(role: UserRole, corpo: (app: App) => Promise<T>): Promise<T> {
  const app = buildTestApp(role);
  await app.ready();
  try {
    return await corpo(app);
  } finally {
    await app.close();
  }
}

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — as listas do Fornecedor", () => {
  it("edição e situação são de Compras e Administrador, em listas próprias", () => {
    const ordenar = (roles: readonly string[]) => [...roles].sort();
    expect(ordenar(SUPPLIER_EDIT_ROLES)).toEqual(ordenar(EDITAM));
    expect(ordenar(USER_ROLES.filter((role) => !SUPPLIER_EDIT_ROLES.includes(role)))).toEqual(
      ordenar(SO_CONSULTAM),
    );
    expect(SUPPLIER_STATUS_CHANGE_ROLES).not.toBe(SUPPLIER_EDIT_ROLES);
    expect(ordenar(SUPPLIER_STATUS_CHANGE_ROLES)).toEqual(ordenar(EDITAM));
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Compras e Administrador mantêm o Fornecedor", () => {
  it.each(EDITAM)("%s: cria, edita, inativa e reativa; transição repetida é 409", async (role) => {
    await comApp(role, async (app) => {
      const criado = await criar(app, cadastro(`${role} ${marca()}`));
      expect(criado.statusCode, criado.body).toBe(201);
      const id = criado.json().id as string;

      const alterado = await alterar(app, id, { tradeName: "Insumos Brasil Ltda", notes: "Entrega às quartas" });
      expect(alterado.statusCode, alterado.body).toBe(200);
      expect(await linha(id)).toMatchObject({ tradeName: "Insumos Brasil Ltda", notes: "Entrega às quartas" });

      expect((await situacao(app, id, "deactivate")).statusCode).toBe(200);
      const inativarDeNovo = await situacao(app, id, "deactivate");
      expect(inativarDeNovo.statusCode).toBe(409);
      expect(inativarDeNovo.json()).toEqual({
        error: "invalid_status_transition",
        message: "Fornecedor já está inativo.",
      });

      expect((await situacao(app, id, "activate")).statusCode).toBe(200);
      const reativarDeNovo = await situacao(app, id, "activate");
      expect(reativarDeNovo.statusCode).toBe(409);
      expect(reativarDeNovo.json().message).toBe("Fornecedor já está ativo.");
      expect((await linha(id)).active).toBe(true);
    });
  });

  it.each(EDITAM)("%s: fornecedor inexistente continua 404 e corpo inválido continua 400", async (role) => {
    await comApp(role, async (app) => {
      expect((await alterar(app, ID_INEXISTENTE, { notes: "x" })).statusCode).toBe(404);
      expect((await situacao(app, ID_INEXISTENTE, "deactivate")).statusCode).toBe(404);
      expect((await situacao(app, ID_INEXISTENTE, "activate")).statusCode).toBe(404);
      const semNome = await criar(app, {});
      expect(semNome.statusCode).toBe(400);
      expect(semNome.json().error).toBe("validation_error");
    });
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — os demais perfis consultam o Fornecedor", () => {
  it.each(SO_CONSULTAM)(
    "%s: criar, editar, inativar e reativar recebem 403 antes do corpo e da existência, e nada muda",
    async (role) => {
      const ativo = await fornecedorExistente();
      const inativo = await fornecedorExistente({ active: false });
      const antesAtivo = await linha(ativo.id);
      const antesInativo = await linha(inativo.id);
      const rotulo = `recusado ${role} ${marca()}`;

      await comApp(role, async (app) => {
        const tentativas: [string, Awaited<ReturnType<typeof criar>>][] = [
          ["POST válido", await criar(app, cadastro(rotulo))],
          ["POST sem corpo", await criar(app, {})],
          ["PATCH válido", await alterar(app, ativo.id, { legalName: `Trocado ${rotulo}` })],
          ["PATCH inválido", await alterar(app, ativo.id, { legalName: "", email: "não é email" })],
          ["PATCH inexistente", await alterar(app, ID_INEXISTENTE, { notes: "x" })],
          ["inativar", await situacao(app, ativo.id, "deactivate")],
          ["reativar", await situacao(app, inativo.id, "activate")],
          ["inativar inexistente", await situacao(app, ID_INEXISTENTE, "deactivate")],
          ["reativar inexistente", await situacao(app, ID_INEXISTENTE, "activate")],
        ];
        for (const [caso, resposta] of tentativas) {
          expect(resposta.statusCode, `${role} ${caso}`).toBe(403);
          expect(resposta.json(), `${role} ${caso}`).toEqual(RECUSA);
        }

        expect(
          await getPrisma().supplier.count({ where: { legalName: { contains: rotulo } } }),
          role,
        ).toBe(0);
        expect(await linha(ativo.id), role).toEqual(antesAtivo);
        expect(await linha(inativo.id), role).toEqual(antesInativo);

        const detalhe = await app.inject({ method: "GET", url: `/suppliers/${ativo.id}` });
        expect(detalhe.statusCode, role).toBe(200);
      });
    },
  );
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — homologação continua na relação Item × Fornecedor", () => {
  it("a Qualidade não edita o Fornecedor, mas homologa a relação dele", async () => {
    const m = marca();
    const item = await getPrisma().item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-HOMO-${m}`,
        name: `Item homologação ${m}`,
        unitCode: "kg",
        ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
        active: true,
      },
    });
    itens.push(item.id);
    const fornecedor = await fornecedorExistente();

    const relacao = await comApp("PURCHASING", async (app) => {
      const resposta = await app.inject({
        method: "POST",
        url: "/supplier-items",
        payload: { itemId: item.id, supplierId: fornecedor.id },
      });
      expect(resposta.statusCode, resposta.body).toBe(201);
      relacoes.push(resposta.json().id as string);
      return resposta.json();
    });

    await comApp("QUALITY", async (app) => {
      expect((await alterar(app, fornecedor.id, { notes: "Qualidade tentando" })).statusCode).toBe(403);

      const homologar = await app.inject({
        method: "POST",
        url: `/supplier-items/${relacao.id}/qualification`,
        payload: { status: "APPROVED", note: "Auditoria ok" },
      });
      expect(homologar.statusCode, homologar.body).toBe(200);
      expect(homologar.json().qualificationStatus).toBe("APPROVED");
    });
  });
});
