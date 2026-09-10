import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Unidade controlada no Modelo de Formulação — FORM-UOM-01.
 *
 * Unidade é referência estrutural: existe no catálogo `UnitOfMeasure`, usa o
 * código canônico e, no componente, tem a dimensão da unidade de estoque do
 * Item — a mesma regra (`isUomCompatible`) que a Formulação real aplica. Estes
 * casos provam a fronteira da API, por fora da tela: nada fora do catálogo
 * entra, nada incompatível entra, e a API não escolhe unidade por ninguém.
 */

const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que este arquivo criou; versões e componentes cascateiam do template.
  if (fixtureTemplateIds.length > 0) {
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Códigos que não estão no catálogo — conferidos antes de valerem como prova. */
const FORA_DO_CATALOGO = ["abc", "KG", "quilo"] as const;

async function item(unitCode: "kg" | "un") {
  const m = marca();
  const criado = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-UOM-${m}`,
      name: `Insumo UOM ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(criado.id);
  return criado;
}

/** Um modelo novo: a V1 em rascunho, base 1 un, sem componentes. */
async function rascunho(app: App): Promise<string> {
  const resposta = await app.inject({
    method: "POST",
    url: "/formulation-templates",
    payload: { name: `Modelo UOM ${marca()}`, basisQuantity: "1", outputUnitCode: "un" },
  });
  expect(resposta.statusCode, resposta.body).toBeLessThan(300);
  const template = resposta.json();
  fixtureTemplateIds.push(template.id);
  return template.draftVersion.id as string;
}

function salvar(app: App, versionId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${versionId}`,
    payload,
  });
}

async function gravado(app: App, versionId: string) {
  const versao = (
    await app.inject({ method: "GET", url: `/formulation-template-versions/${versionId}` })
  ).json();
  return {
    status: versao.status as string,
    outputUnitCode: versao.outputUnitCode as string,
    componentes: (versao.components as { itemCode: string; unitCode: string }[]).map(
      (componente) => `${componente.itemCode}:${componente.unitCode}`,
    ),
  };
}

async function comApp<T>(corpo: (app: App) => Promise<T>): Promise<T> {
  const app = buildTestApp("ADMIN");
  await app.ready();
  try {
    return await corpo(app);
  } finally {
    await app.close();
  }
}

describe("FORM-UOM-01 — os códigos da prova não existem no catálogo", () => {
  it.each(FORA_DO_CATALOGO)("%j não é unidade cadastrada", async (codigo) => {
    expect(await getPrisma().unitOfMeasure.findUnique({ where: { code: codigo } })).toBeNull();
  });
});

describe("FORM-UOM-01 — unidade da base: só código do catálogo", () => {
  it.each(FORA_DO_CATALOGO)("salvar a base em %j: 400, e a base fica", (codigo) =>
    comApp(async (app) => {
      const id = await rascunho(app);

      const resposta = await salvar(app, id, { outputUnitCode: codigo });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect((await gravado(app, id)).outputUnitCode).toBe("un");
    }),
  );

  it("criar o modelo com a base fora do catálogo: 400, e nenhum modelo nasce", () =>
    comApp(async (app) => {
      const nome = `Modelo UOM ${marca()}`;

      const resposta = await app.inject({
        method: "POST",
        url: "/formulation-templates",
        payload: { name: nome, outputUnitCode: "abc" },
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect(await getPrisma().formulationTemplate.count({ where: { name: nome } })).toBe(0);
    }),
  );

  it.each(["kg", "g", "un"])("%s, do catálogo, grava como veio", (codigo) =>
    comApp(async (app) => {
      const id = await rascunho(app);

      const resposta = await salvar(app, id, { outputUnitCode: codigo });

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect((await gravado(app, id)).outputUnitCode).toBe(codigo);
    }),
  );
});

describe("FORM-UOM-01 — unidade do componente: catálogo e dimensão do Item", () => {
  it.each(FORA_DO_CATALOGO)("%j fora do catálogo: 400, e nada é gravado", (codigo) =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");
      expect(
        (await salvar(app, id, { components: [{ itemId: massa.id, quantity: "1", unitCode: "g" }] }))
          .statusCode,
      ).toBe(200);

      const resposta = await salvar(app, id, {
        components: [{ itemId: massa.id, quantity: "2", unitCode: codigo }],
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect((await gravado(app, id)).componentes).toEqual([`${massa.code}:g`]);
    }),
  );

  it("unidade de contagem num Item de massa: 400, com o motivo, e nada é gravado", () =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");

      const resposta = await salvar(app, id, {
        components: [{ itemId: massa.id, quantity: "1", unitCode: "un" }],
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect(resposta.json().message).toBe(
        `Unidade da fórmula incompatível com a unidade de estoque do item: ${massa.code}`,
      );
      expect((await gravado(app, id)).componentes).toEqual([]);
    }),
  );

  it("unidade de massa num Item de contagem: 400", () =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const contagem = await item("un");

      const resposta = await salvar(app, id, {
        components: [{ itemId: contagem.id, quantity: "1", unitCode: "g" }],
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect((await gravado(app, id)).componentes).toEqual([]);
    }),
  );

  it.each(["g", "kg"])("Item de massa aceita %s, e grava o código que veio", (codigo) =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");

      const resposta = await salvar(app, id, {
        components: [{ itemId: massa.id, quantity: "1", unitCode: codigo }],
      });

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect((await gravado(app, id)).componentes).toEqual([`${massa.code}:${codigo}`]);
    }),
  );

  it("trocar o Item sem trocar a unidade: a combinação final é incompatível, 400, e o gravado fica", () =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");
      const contagem = await item("un");
      await salvar(app, id, { components: [{ itemId: massa.id, quantity: "1", unitCode: "kg" }] });

      const resposta = await salvar(app, id, {
        components: [{ itemId: contagem.id, quantity: "1", unitCode: "kg" }],
      });

      // A API não troca "kg" pela unidade do Item novo: recusa a combinação.
      expect(resposta.statusCode, resposta.body).toBe(400);
      expect((await gravado(app, id)).componentes).toEqual([`${massa.code}:kg`]);
    }),
  );

  it("salvar só a base não toca nos componentes", () =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");
      await salvar(app, id, { components: [{ itemId: massa.id, quantity: "1", unitCode: "g" }] });

      const resposta = await salvar(app, id, { outputUnitCode: "kg" });

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect(await gravado(app, id)).toEqual({
        status: "DRAFT",
        outputUnitCode: "kg",
        componentes: [`${massa.code}:g`],
      });
    }),
  );
});

describe("FORM-UOM-01 — ativar não promove unidade inválida, e a versão ativa continua congelada", () => {
  it.each([
    ["fora do catálogo", "abc"],
    ["incompatível com o Item", "un"],
  ])("componente legado com unidade %s: ativar recusa, e a versão continua rascunho", (_caso, codigo) =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");
      // Dado legado: gravado por fora da API, como uma importação antiga faria.
      await getPrisma().formulationTemplateComponent.create({
        data: {
          formulationTemplateVersionId: id,
          itemId: massa.id,
          quantity: "1",
          unitCode: codigo,
          position: 0,
        },
      });

      const resposta = await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${id}/activate`,
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect((await gravado(app, id)).status).toBe("DRAFT");
    }),
  );

  it("versão ativa não se edita, nem para trocar unidade válida", () =>
    comApp(async (app) => {
      const id = await rascunho(app);
      const massa = await item("kg");
      await salvar(app, id, { components: [{ itemId: massa.id, quantity: "1", unitCode: "g" }] });
      const ativa = await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${id}/activate`,
      });
      expect(ativa.statusCode, ativa.body).toBe(200);

      const resposta = await salvar(app, id, {
        components: [{ itemId: massa.id, quantity: "1", unitCode: "kg" }],
      });

      expect(resposta.statusCode, resposta.body).toBe(409);
      expect((await gravado(app, id)).componentes).toEqual([`${massa.code}:g`]);
    }),
  );
});
