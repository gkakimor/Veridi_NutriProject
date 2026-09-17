import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Product, UomDimension, UserRole } from "@prisma/client";
import {
  ATTACHMENT_ARCHIVE_ROLES,
  PRODUCT_DOCUMENT_UPLOAD_ROLES,
  PRODUCT_EDIT_ROLES,
  PRODUCT_STATUS_CHANGE_ROLES,
  USER_ROLES,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Quem cria, edita, inativa e reativa o Produto — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Decisão do PO: Comercial e Administrador — inclusive a criação direta, que
 * nasce APROVADA e por isso não podia continuar aberta a qualquer sessão.
 * Produção continua no Roteiro padrão e Qualidade nos documentos, pelas rotas
 * próprias. "Exige CoA" na criação vale para o PA que nasce com o Produto;
 * depois disso o controle é do cadastro do Item, e esta porta não o altera.
 */

const produtos: string[] = [];
const itens: string[] = [];
const anexos: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const EDITAM = ["COMMERCIAL", "ADMIN"] as const satisfies readonly UserRole[];
const SO_CONSULTAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"] as const satisfies readonly UserRole[];
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
const RECUSA = { error: "forbidden", message: "Seu perfil não permite esta ação." };

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

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
  if (anexos.length > 0) await prisma.attachment.deleteMany({ where: { id: { in: anexos } } });
  if (produtos.length > 0) {
    const criados = await prisma.product.findMany({
      where: { id: { in: produtos } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
    for (const { finishedProductItemId } of criados) {
      if (finishedProductItemId) itens.push(finishedProductItemId);
    }
  }
  if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
});

async function criar(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/products", payload });
  if (resposta.statusCode === 201) produtos.push(resposta.json().id as string);
  return resposta;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/products/${id}`, payload });
}

function situacao(app: App, id: string, acao: "activate" | "deactivate") {
  return app.inject({ method: "POST", url: `/products/${id}/${acao}` });
}

async function cadastro(rotulo: string, extra: Record<string, unknown> = {}) {
  return {
    name: `Produto permissão ${rotulo}`,
    customerId: await fixtureCustomerId(),
    finishedUnitCode: "un",
    dosageForm: "CAPSULE",
    capsulesPerDose: 2,
    notes: "Linha kids",
    ...extra,
  };
}

async function itemDeProdutoAcabado(extra: Partial<Item> = {}): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PERM-${m}`,
      name: `PA existente ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      requiresCoa: false,
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

/** Produto existente com o PA dele, nascidos pelo banco — fora de qualquer gate. */
async function produtoExistente(extra: Partial<Product> = {}, pa: Partial<Item> = {}): Promise<Product> {
  const item = await itemDeProdutoAcabado(pa);
  const m = marca();
  const produto = await getPrisma().product.create({
    data: {
      code: `PROD-PERM-${m}`,
      name: `Produto existente ${m}`,
      customerId: await fixtureCustomerId(),
      finishedProductItemId: item.id,
      active: true,
      ...extra,
    },
  });
  produtos.push(produto.id);
  return produto;
}

function linha(id: string) {
  return getPrisma().product.findUniqueOrThrow({ where: { id } });
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

/** PDF mínimo válido num multipart montado à mão — sem dependência extra. */
function arteDeRotulo(): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----veridi${marca()}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nLABEL_ART\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="arte.pdf"\r\n` +
        "Content-Type: application/pdf\r\n\r\n",
      "utf8",
    ),
    Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — as listas do Produto", () => {
  it("edição e situação são de Comercial e Administrador, em listas próprias", () => {
    const ordenar = (roles: readonly string[]) => [...roles].sort();
    expect(ordenar(PRODUCT_EDIT_ROLES)).toEqual(ordenar(EDITAM));
    expect(ordenar(USER_ROLES.filter((role) => !PRODUCT_EDIT_ROLES.includes(role)))).toEqual(
      ordenar(SO_CONSULTAM),
    );
    expect(PRODUCT_STATUS_CHANGE_ROLES).not.toBe(PRODUCT_EDIT_ROLES);
    expect(ordenar(PRODUCT_STATUS_CHANGE_ROLES)).toEqual(ordenar(EDITAM));
    // Seções com dono próprio dentro do Produto.
    expect(ordenar(PRODUCT_DOCUMENT_UPLOAD_ROLES)).toEqual(["ADMIN", "COMMERCIAL", "QUALITY"]);
    expect(ordenar(ATTACHMENT_ARCHIVE_ROLES)).toEqual(["ADMIN", "QUALITY"]);
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Comercial e Administrador mantêm o Produto", () => {
  it.each(EDITAM)(
    "%s: cria (aprovado, com o PA), edita, inativa e reativa; transição repetida é 409",
    async (role) => {
      await comApp(role, async (app) => {
        const criado = await criar(app, await cadastro(`${role} ${marca()}`));
        expect(criado.statusCode, criado.body).toBe(201);
        const id = criado.json().id as string;
        expect(criado.json()).toMatchObject({ lifecycle: "APPROVED", active: true });
        expect(criado.json().finishedProductItem).toMatchObject({
          controlsLot: true,
          controlsExpiry: true,
          requiresQualityRelease: true,
          requiresCoa: false,
        });

        const alterado = await alterar(app, id, { notes: "Linha adulto", capsulesPerDose: 3 });
        expect(alterado.statusCode, alterado.body).toBe(200);
        expect(await linha(id)).toMatchObject({ notes: "Linha adulto", capsulesPerDose: 3 });

        expect((await situacao(app, id, "deactivate")).statusCode).toBe(200);
        const inativarDeNovo = await situacao(app, id, "deactivate");
        expect(inativarDeNovo.statusCode).toBe(409);
        expect(inativarDeNovo.json()).toEqual({
          error: "invalid_status_transition",
          message: "Produto já está inativo.",
        });
        expect((await situacao(app, id, "activate")).statusCode).toBe(200);
        const reativarDeNovo = await situacao(app, id, "activate");
        expect(reativarDeNovo.statusCode).toBe(409);
        expect(reativarDeNovo.json().message).toBe("Produto já está ativo.");
      });
    },
  );

  it.each(EDITAM)("%s: produto inexistente continua 404 e corpo inválido continua 400", async (role) => {
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

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — os demais perfis consultam o Produto", () => {
  it.each(SO_CONSULTAM)(
    "%s: criar (aprovado), editar, inativar e reativar recebem 403 antes do corpo e da existência; nada nasce, nada muda",
    async (role) => {
      const ativo = await produtoExistente();
      const inativo = await produtoExistente({ active: false });
      const antesAtivo = await linha(ativo.id);
      const antesInativo = await linha(inativo.id);
      const rotulo = `recusado ${role} ${marca()}`;

      await comApp(role, async (app) => {
        const tentativas: [string, Awaited<ReturnType<typeof criar>>][] = [
          ["POST válido (nasceria APROVADO)", await criar(app, await cadastro(rotulo))],
          ["POST sem corpo", await criar(app, {})],
          ["PATCH válido", await alterar(app, ativo.id, { name: `Trocado ${rotulo}` })],
          ["PATCH inválido", await alterar(app, ativo.id, { name: "", capsulesPerDose: -1 })],
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

        // Nem o Produto nem o PA que nasceria junto com o mesmo nome.
        const prisma = getPrisma();
        expect(await prisma.product.count({ where: { name: { contains: rotulo } } }), role).toBe(0);
        expect(await prisma.item.count({ where: { name: { contains: rotulo } } }), role).toBe(0);
        expect(await linha(ativo.id), role).toEqual(antesAtivo);
        expect(await linha(inativo.id), role).toEqual(antesInativo);

        const detalhe = await app.inject({ method: "GET", url: `/products/${ativo.id}` });
        expect(detalhe.statusCode, role).toBe(200);
      });
    },
  );
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Exige CoA do PA", () => {
  it.each(EDITAM)("%s: marca Exige CoA para o PA que nasce com o Produto", async (role) => {
    await comApp(role, async (app) => {
      const criado = await criar(app, await cadastro(`coa ${role} ${marca()}`, { finishedRequiresCoa: true }));
      expect(criado.statusCode, criado.body).toBe(201);
      const pa = await getPrisma().item.findUniqueOrThrow({
        where: { id: criado.json().finishedProductItemId },
      });
      expect(pa).toMatchObject({
        type: "FINISHED_PRODUCT",
        controlsLot: true,
        controlsExpiry: true,
        requiresQualityRelease: true,
        requiresCoa: true,
      });
    });
  });

  it("PA que já existe: pedir outro laudo é 409 nas duas direções, e nada muda; o mesmo valor passa", async () => {
    const comLaudo = await itemDeProdutoAcabado({ requiresCoa: true });
    const semLaudo = await itemDeProdutoAcabado({ requiresCoa: false });

    await comApp("ADMIN", async (app) => {
      for (const [pa, pedido] of [
        [comLaudo, false],
        [semLaudo, true],
      ] as const) {
        const rotulo = `pa existente ${pedido} ${marca()}`;
        const resposta = await criar(
          app,
          await cadastro(rotulo, { finishedProductItemId: pa.id, finishedRequiresCoa: pedido }),
        );
        expect(resposta.statusCode, resposta.body).toBe(409);
        expect(resposta.json().error).toBe("finished_item_controls_not_editable_here");
        expect(resposta.json().message).toContain(pa.code);
        expect(await getPrisma().product.count({ where: { name: { contains: rotulo } } })).toBe(0);
      }

      const mesmoValor = await criar(
        app,
        await cadastro(`pa mesmo laudo ${marca()}`, {
          finishedProductItemId: comLaudo.id,
          finishedRequiresCoa: true,
        }),
      );
      expect(mesmoValor.statusCode, mesmoValor.body).toBe(201);
    });

    expect((await getPrisma().item.findUniqueOrThrow({ where: { id: comLaudo.id } })).requiresCoa).toBe(true);
    expect((await getPrisma().item.findUniqueOrThrow({ where: { id: semLaudo.id } })).requiresCoa).toBe(false);
  });

  it("depois da criação, editar o Produto não é porta para desligar o laudo do PA", async () => {
    const produto = await produtoExistente({}, { requiresCoa: true });
    await comApp("COMMERCIAL", async (app) => {
      const resposta = await alterar(app, produto.id, { notes: "Sem laudo?", finishedRequiresCoa: false });
      expect(resposta.statusCode, resposta.body).toBe(200);
    });
    const pa = await getPrisma().item.findUniqueOrThrow({ where: { id: produto.finishedProductItemId! } });
    expect(pa.requiresCoa).toBe(true);
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — seções com permissão própria continuam", () => {
  it("PRODUCTION não edita o Produto, mas define o Roteiro padrão dele", async () => {
    const produto = await produtoExistente();
    await comApp("PRODUCTION", async (app) => {
      expect((await alterar(app, produto.id, { notes: "Produção tentando" })).statusCode).toBe(403);
      const roteiro = await app.inject({
        method: "PUT",
        url: `/products/${produto.id}/production-profile`,
        payload: { productionProfileVersionId: null },
      });
      expect(roteiro.statusCode, roteiro.body).toBe(200);
    });
  });

  it("QUALITY não edita o Produto, mas anexa arte e ficha técnica; PRODUCTION não anexa", async () => {
    const produto = await produtoExistente();
    await comApp("QUALITY", async (app) => {
      expect((await alterar(app, produto.id, { notes: "Qualidade tentando" })).statusCode).toBe(403);
      const { payload, headers } = arteDeRotulo();
      const anexo = await app.inject({
        method: "POST",
        url: `/products/${produto.id}/attachments`,
        payload,
        headers,
      });
      expect(anexo.statusCode, anexo.body).toBe(201);
      anexos.push(anexo.json().id as string);
    });
    await comApp("PRODUCTION", async (app) => {
      const { payload, headers } = arteDeRotulo();
      const anexo = await app.inject({
        method: "POST",
        url: `/products/${produto.id}/attachments`,
        payload,
        headers,
      });
      expect(anexo.statusCode).toBe(403);
    });
  });
});
