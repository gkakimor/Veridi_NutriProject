import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, UomDimension, UserRole } from "@prisma/client";
import {
  ITEM_COST_REFERENCE_ROLES,
  ITEM_DEACTIVATE_ROLES,
  ITEM_EDIT_ROLES,
  ITEM_PRODUCTION_CONSUMPTION_ROLES,
  ITEM_QUALITY_CONTROL_ROLES,
  ITEM_REACTIVATE_ROLES,
  ITEM_TYPE_DEFAULTS,
  USER_ROLES,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Quem cria, edita, inativa e reativa o Item — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Decisão do PO:
 * - criar e editar identidade, classificação e códigos: Compras, Qualidade,
 *   Produção e Administrador; Comercial e Consulta leem;
 * - os quatro controles de rastreabilidade: Qualidade e Administrador — na
 *   criação por Compras ou Produção o item nasce no padrão canônico do tipo, e
 *   na edição a recusa é pela MUDANÇA de valor, nunca pela chave presente;
 * - "Consumido na produção": Produção e Administrador, pelo mesmo critério;
 * - custo de referência inicial: Comercial e Administrador — pedir sem ser
 *   deles é RECUSA, nunca referência ignorada;
 * - inativar: Compras, Qualidade e Administrador; reativar: Qualidade e
 *   Administrador; transição que não parte da situação atual é 409.
 *
 * A recusa por perfil vem antes do corpo e antes da existência do Item, e
 * nada é gravado.
 */

const itens: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const EDITAM = ["PURCHASING", "QUALITY", "PRODUCTION", "ADMIN"] as const satisfies readonly UserRole[];
const SO_CONSULTAM = ["COMMERCIAL", "VIEWER"] as const satisfies readonly UserRole[];
const EDITAM_SEM_CONTROLES = ["PURCHASING", "PRODUCTION"] as const satisfies readonly UserRole[];
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
const RECUSA = { error: "forbidden", message: "Seu perfil não permite esta ação." };

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  if (itens.length === 0) return;
  // Referências de custo saem junto (cascade) — Item não tem exclusão no app.
  await getPrisma().item.deleteMany({ where: { id: { in: itens } } });
});

async function criar(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/items", payload });
  // Se um dia a recusa falhar, o item criado não fica para trás.
  if (resposta.statusCode === 201) itens.push(resposta.json().id as string);
  return resposta;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/items/${id}`, payload });
}

function situacao(app: App, id: string, acao: "activate" | "deactivate") {
  return app.inject({ method: "POST", url: `/items/${id}/${acao}` });
}

/** Matéria-prima como a tela manda: os quatro controles SEMPRE presentes, no padrão do tipo. */
function materiaPrima(rotulo: string, extra: Record<string, unknown> = {}) {
  return {
    type: "RAW_MATERIAL",
    name: `Item permissão ${rotulo}`,
    unitCode: "kg",
    ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
    ...extra,
  };
}

/** O Item nasce pelo banco, fora de qualquer gate: o que se testa é quem o altera depois. */
async function itemExistente(extra: Partial<Item> = {}): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PERM-${m}`,
      name: `Item existente ${m}`,
      unitCode: "kg",
      ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

async function embalagemExistente(extra: Partial<Item> = {}): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "PACKAGING",
      code: `ME-PERM-${m}`,
      name: `Embalagem existente ${m}`,
      unitCode: "un",
      ...ITEM_TYPE_DEFAULTS.PACKAGING,
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

/** A linha inteira do banco: recusa que gravasse qualquer coisa mudaria algo aqui. */
function linha(id: string) {
  return getPrisma().item.findUniqueOrThrow({ where: { id } });
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

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — as listas do Item", () => {
  it("cada ato tem a sua lista, com os perfis da decisão do PO", () => {
    const ordenar = (roles: readonly string[]) => [...roles].sort();
    expect(ordenar(ITEM_EDIT_ROLES)).toEqual(ordenar(EDITAM));
    expect(ordenar(USER_ROLES.filter((role) => !ITEM_EDIT_ROLES.includes(role)))).toEqual(
      ordenar(SO_CONSULTAM),
    );
    expect(ordenar(ITEM_QUALITY_CONTROL_ROLES)).toEqual(["ADMIN", "QUALITY"]);
    expect(ordenar(ITEM_PRODUCTION_CONSUMPTION_ROLES)).toEqual(["ADMIN", "PRODUCTION"]);
    expect(ordenar(ITEM_COST_REFERENCE_ROLES)).toEqual(["ADMIN", "COMMERCIAL"]);
    expect(ordenar(ITEM_DEACTIVATE_ROLES)).toEqual(["ADMIN", "PURCHASING", "QUALITY"]);
    expect(ordenar(ITEM_REACTIVATE_ROLES)).toEqual(["ADMIN", "QUALITY"]);
  });

  it("o padrão canônico do tipo tem os quatro controles, com laudo desligado em todo tipo", () => {
    for (const padrao of Object.values(ITEM_TYPE_DEFAULTS)) {
      expect(Object.keys(padrao).sort()).toEqual(
        ["controlsExpiry", "controlsLot", "requiresCoa", "requiresQualityRelease"].sort(),
      );
      expect(padrao.requiresCoa).toBe(false);
    }
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — quem edita o Item cria e altera identidade e classificação", () => {
  it.each(EDITAM)("%s: POST 201 com os controles no padrão e PATCH 200 salvando o resto", async (role) => {
    await comApp(role, async (app) => {
      const criado = await criar(app, materiaPrima(`${role} ${marca()}`));
      expect(criado.statusCode, `${role} POST: ${criado.body}`).toBe(201);
      const id = criado.json().id as string;
      expect(criado.json(), role).toMatchObject({ ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL, active: true });

      // O salvamento da tela: tudo junto, controles e marca com o valor gravado.
      const nome = `Item renomeado ${role} ${marca()}`;
      const alterado = await alterar(app, id, {
        type: "RAW_MATERIAL",
        name: nome,
        unitCode: "kg",
        ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
        sourceName: "Cloridrato de tiamina",
        declaredNutrient: "Vitamina B1",
        family: "VITAMIN",
        defaultPurityPercent: "98.5",
        consumedInProduction: false,
        externalBarcode: "7891234567890",
      });
      expect(alterado.statusCode, `${role} PATCH: ${alterado.body}`).toBe(200);
      expect(await linha(id), role).toMatchObject({
        name: nome,
        sourceName: "Cloridrato de tiamina",
        declaredNutrient: "Vitamina B1",
        family: "VITAMIN",
        externalBarcode: "7891234567890",
        ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
      });
    });
  });

  it.each(EDITAM)("%s: item inexistente continua 404 e corpo inválido continua 400", async (role) => {
    await comApp(role, async (app) => {
      expect((await alterar(app, ID_INEXISTENTE, { name: "Qualquer" })).statusCode, role).toBe(404);
      const semCorpo = await criar(app, {});
      expect(semCorpo.statusCode, role).toBe(400);
      expect(semCorpo.json().error, role).toBe("validation_error");
    });
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Comercial e Consulta não gravam no Item", () => {
  it.each(SO_CONSULTAM)(
    "%s: criar, editar, inativar e reativar recebem 403 antes do corpo e da existência, e nada muda",
    async (role) => {
      const existente = await itemExistente();
      const inativo = await itemExistente({ active: false });
      const antes = await linha(existente.id);
      const antesInativo = await linha(inativo.id);
      const rotulo = `recusado ${role} ${marca()}`;

      await comApp(role, async (app) => {
        const tentativas: [string, Awaited<ReturnType<typeof criar>>][] = [
          ["POST válido", await criar(app, materiaPrima(rotulo))],
          ["POST sem corpo", await criar(app, {})],
          ["PATCH válido", await alterar(app, existente.id, { name: `Nome trocado ${rotulo}` })],
          ["PATCH inválido", await alterar(app, existente.id, { name: "", unitCode: 42 })],
          ["PATCH inexistente", await alterar(app, ID_INEXISTENTE, { name: "Qualquer" })],
          ["inativar", await situacao(app, existente.id, "deactivate")],
          ["reativar", await situacao(app, inativo.id, "activate")],
          ["inativar inexistente", await situacao(app, ID_INEXISTENTE, "deactivate")],
          ["reativar inexistente", await situacao(app, ID_INEXISTENTE, "activate")],
        ];
        for (const [caso, resposta] of tentativas) {
          expect(resposta.statusCode, `${role} ${caso}`).toBe(403);
          expect(resposta.json(), `${role} ${caso}`).toEqual(RECUSA);
        }

        // Pelo nome, não pelo total: arquivos vizinhos gravam itens em paralelo.
        expect(await getPrisma().item.count({ where: { name: { contains: rotulo } } }), role).toBe(0);
        expect(await linha(existente.id), role).toEqual(antes);
        expect(await linha(inativo.id), role).toEqual(antesInativo);

        // A consulta segue aberta.
        const detalhe = await app.inject({ method: "GET", url: `/items/${existente.id}` });
        expect(detalhe.statusCode, role).toBe(200);
        const lista = await app.inject({ method: "GET", url: `/items?ids=${existente.id}` });
        expect(lista.json().items.map((item: { id: string }) => item.id), role).toEqual([existente.id]);
      });
    },
  );
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — controles de qualidade na criação", () => {
  const FORA_DO_PADRAO: [string, Record<string, unknown>][] = [
    ["liga o laudo", { requiresCoa: true }],
    ["desliga a validade", { controlsExpiry: false }],
    ["desliga a liberação da Qualidade", { requiresQualityRelease: false }],
    ["desliga o lote", { controlsLot: false }],
  ];

  it.each(EDITAM_SEM_CONTROLES)(
    "%s: controle fora do padrão do tipo é 403 com o nome do controle, em qualquer direção, e nada nasce",
    async (role) => {
      await comApp(role, async (app) => {
        for (const [caso, controle] of FORA_DO_PADRAO) {
          const rotulo = `controle ${role} ${caso} ${marca()}`;
          const resposta = await criar(app, materiaPrima(rotulo, controle));
          expect(resposta.statusCode, `${role} ${caso}`).toBe(403);
          expect(resposta.json().error, `${role} ${caso}`).toBe("forbidden");
          expect(resposta.json().message, `${role} ${caso}`).toMatch(/só podem ser definidos por Qualidade ou Administrador/);
          expect(await getPrisma().item.count({ where: { name: { contains: rotulo } } }), caso).toBe(0);
        }

        // Endurecer também é decisão da Qualidade: embalagem com liberação ligada.
        const rotulo = `embalagem ${role} ${marca()}`;
        const embalagem = await criar(app, {
          type: "PACKAGING",
          name: `Item permissão ${rotulo}`,
          unitCode: "un",
          ...ITEM_TYPE_DEFAULTS.PACKAGING,
          requiresQualityRelease: true,
        });
        expect(embalagem.statusCode, role).toBe(403);
        expect(embalagem.json().message, role).toContain("Requer liberação da Qualidade");

        // Sem chave nenhuma, o item nasce no padrão do tipo.
        const semControles = await criar(app, {
          type: "PACKAGING",
          name: `Item permissão sem controles ${role} ${marca()}`,
          unitCode: "un",
        });
        expect(semControles.statusCode, role).toBe(201);
        expect(semControles.json(), role).toMatchObject(ITEM_TYPE_DEFAULTS.PACKAGING);
      });
    },
  );

  it.each(ITEM_QUALITY_CONTROL_ROLES)("%s: cria o item com os controles que escolher", async (role) => {
    await comApp(role, async (app) => {
      const resposta = await criar(
        app,
        materiaPrima(`qualidade ${role} ${marca()}`, {
          controlsExpiry: false,
          requiresQualityRelease: false,
          requiresCoa: true,
        }),
      );
      expect(resposta.statusCode, resposta.body).toBe(201);
      expect(await linha(resposta.json().id), role).toMatchObject({
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
        requiresCoa: true,
      });
    });
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — controles de qualidade na edição", () => {
  it.each(EDITAM_SEM_CONTROLES)(
    "%s: mudar controle é 403 e nada é gravado; manter o valor gravado salva o resto",
    async (role) => {
      const existente = await itemExistente();
      await comApp(role, async (app) => {
        for (const campo of ["controlsLot", "controlsExpiry", "requiresQualityRelease", "requiresCoa"] as const) {
          const antes = await linha(existente.id);
          const resposta = await alterar(app, existente.id, {
            name: `Não deveria gravar ${marca()}`,
            ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
            [campo]: !ITEM_TYPE_DEFAULTS.RAW_MATERIAL[campo],
          });
          expect(resposta.statusCode, `${role} ${campo}`).toBe(403);
          expect(resposta.json().message, `${role} ${campo}`).toMatch(
            /não altera os controles de rastreabilidade do item .* só Qualidade ou Administrador/,
          );
          expect(await linha(existente.id), `${role} ${campo}`).toEqual(antes);
        }

        const nome = `Salvo sem mexer nos controles ${role} ${marca()}`;
        const salvo = await alterar(app, existente.id, { name: nome, ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL });
        expect(salvo.statusCode, salvo.body).toBe(200);
        expect(await linha(existente.id)).toMatchObject({ name: nome, ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL });
      });
    },
  );

  it("tela velha de Compras não desfaz o laudo que a Qualidade acabou de ligar", async () => {
    const existente = await itemExistente();

    await comApp("QUALITY", async (qualidade) => {
      const ligado = await alterar(qualidade, existente.id, { requiresCoa: true });
      expect(ligado.statusCode, ligado.body).toBe(200);
    });

    await comApp("PURCHASING", async (compras) => {
      // O formulário de Compras abriu antes: manda o laudo desligado que viu.
      const velho = await alterar(compras, existente.id, {
        name: `Tela velha ${marca()}`,
        ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
      });
      expect(velho.statusCode).toBe(403);
    });

    expect((await linha(existente.id)).requiresCoa).toBe(true);
  });

  it.each(ITEM_QUALITY_CONTROL_ROLES)("%s: altera os controles do item", async (role) => {
    const existente = await itemExistente();
    await comApp(role, async (app) => {
      const resposta = await alterar(app, existente.id, {
        requiresCoa: true,
        requiresQualityRelease: false,
        controlsExpiry: false,
      });
      expect(resposta.statusCode, resposta.body).toBe(200);
    });
    expect(await linha(existente.id)).toMatchObject({
      requiresCoa: true,
      requiresQualityRelease: false,
      controlsExpiry: false,
    });
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Consumido na produção", () => {
  it.each(["PURCHASING", "QUALITY"] as const)(
    "%s: marcar ou desmarcar é 403; salvar com a marca gravada passa",
    async (role) => {
      const desmarcada = await embalagemExistente();
      const marcada = await embalagemExistente({ consumedInProduction: true });
      await comApp(role, async (app) => {
        const marcar = await alterar(app, desmarcada.id, { consumedInProduction: true });
        expect(marcar.statusCode, role).toBe(403);
        expect(marcar.json().message, role).toContain("Consumido na produção");
        const desmarcar = await alterar(app, marcada.id, { consumedInProduction: false });
        expect(desmarcar.statusCode, role).toBe(403);

        const salvo = await alterar(app, marcada.id, {
          name: `Cápsula ${role} ${marca()}`,
          consumedInProduction: true,
        });
        expect(salvo.statusCode, salvo.body).toBe(200);

        // Criar já marcado também é da Produção.
        const rotulo = `consumo ${role} ${marca()}`;
        const criado = await criar(app, {
          type: "PACKAGING",
          name: `Item permissão ${rotulo}`,
          unitCode: "un",
          consumedInProduction: true,
        });
        expect(criado.statusCode, role).toBe(403);
        expect(await getPrisma().item.count({ where: { name: { contains: rotulo } } })).toBe(0);
      });
      expect((await linha(desmarcada.id)).consumedInProduction).toBe(false);
      expect((await linha(marcada.id)).consumedInProduction).toBe(true);
    },
  );

  it.each(ITEM_PRODUCTION_CONSUMPTION_ROLES)("%s: marca na edição e na criação", async (role) => {
    const desmarcada = await embalagemExistente();
    await comApp(role, async (app) => {
      expect((await alterar(app, desmarcada.id, { consumedInProduction: true })).statusCode).toBe(200);
      const criado = await criar(app, {
        type: "PACKAGING",
        name: `Cápsula vazia ${role} ${marca()}`,
        unitCode: "un",
        consumedInProduction: true,
      });
      expect(criado.statusCode, criado.body).toBe(201);
      expect(criado.json().consumedInProduction).toBe(true);
    });
    expect((await linha(desmarcada.id)).consumedInProduction).toBe(true);
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — custo de referência inicial", () => {
  it.each(["PURCHASING", "QUALITY", "PRODUCTION"] as const)(
    "%s: pedir custo inicial é 403 — nem item, nem referência",
    async (role) => {
      const rotulo = `custo ${role} ${marca()}`;
      await comApp(role, async (app) => {
        const resposta = await criar(
          app,
          materiaPrima(rotulo, { initialCostReference: { unitCost: "12.5", uomCode: "kg" } }),
        );
        expect(resposta.statusCode, role).toBe(403);
        expect(resposta.json().message, role).toMatch(/não define custo de referência — só Comercial ou Administrador/);
      });
      expect(await getPrisma().item.count({ where: { name: { contains: rotulo } } }), role).toBe(0);
    },
  );

  it("ADMIN cria o item com a referência inicial", async () => {
    await comApp("ADMIN", async (app) => {
      const resposta = await criar(
        app,
        materiaPrima(`custo admin ${marca()}`, { initialCostReference: { unitCost: "12.5", uomCode: "kg" } }),
      );
      expect(resposta.statusCode, resposta.body).toBe(201);
      const referencias = await getPrisma().itemCostReference.findMany({
        where: { itemId: resposta.json().id },
      });
      expect(referencias).toHaveLength(1);
      expect(referencias[0]!.unitCost.toString()).toBe("12.5");
    });
  });

  it.each(["PURCHASING", "QUALITY", "PRODUCTION", "VIEWER"] as const)(
    "%s: a rota própria da referência de custo também recusa, e nenhuma vigência nasce",
    async (role) => {
      const existente = await itemExistente();
      await comApp(role, async (app) => {
        const referencia = await app.inject({
          method: "POST",
          url: `/items/${existente.id}/cost-references`,
          payload: { unitCost: "9.9", uomCode: "kg" },
        });
        expect(referencia.statusCode, role).toBe(403);
        expect(referencia.json(), role).toEqual(RECUSA);
      });
      expect(
        await getPrisma().itemCostReference.count({ where: { itemId: existente.id } }),
        role,
      ).toBe(0);
    },
  );

  it("COMMERCIAL não edita o Item, mas define a referência de custo dele", async () => {
    const existente = await itemExistente();
    await comApp("COMMERCIAL", async (app) => {
      expect((await alterar(app, existente.id, { name: "Comercial tentando" })).statusCode).toBe(403);
      const referencia = await app.inject({
        method: "POST",
        url: `/items/${existente.id}/cost-references`,
        payload: { unitCost: "9.9", uomCode: "kg" },
      });
      expect(referencia.statusCode, referencia.body).toBe(201);
    });
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — situação do Item", () => {
  it.each(ITEM_DEACTIVATE_ROLES)("%s: inativa; repetir é 409; item inexistente é 404", async (role) => {
    const existente = await itemExistente();
    await comApp(role, async (app) => {
      const inativar = await situacao(app, existente.id, "deactivate");
      expect(inativar.statusCode, inativar.body).toBe(200);
      expect(inativar.json().active).toBe(false);

      const repetir = await situacao(app, existente.id, "deactivate");
      expect(repetir.statusCode, role).toBe(409);
      expect(repetir.json()).toEqual({
        error: "invalid_status_transition",
        message: "Item já está inativo.",
      });
      expect((await situacao(app, ID_INEXISTENTE, "deactivate")).statusCode, role).toBe(404);
    });
    expect((await linha(existente.id)).active).toBe(false);
  });

  it.each(ITEM_REACTIVATE_ROLES)("%s: reativa; repetir é 409; item inexistente é 404", async (role) => {
    const inativo = await itemExistente({ active: false });
    await comApp(role, async (app) => {
      const reativar = await situacao(app, inativo.id, "activate");
      expect(reativar.statusCode, reativar.body).toBe(200);
      expect(reativar.json().active).toBe(true);

      const repetir = await situacao(app, inativo.id, "activate");
      expect(repetir.statusCode, role).toBe(409);
      expect(repetir.json().message).toBe("Item já está ativo.");
      expect((await situacao(app, ID_INEXISTENTE, "activate")).statusCode, role).toBe(404);
    });
  });

  it.each(["PRODUCTION"] as const)("%s: edita o Item, mas não inativa nem reativa", async (role) => {
    const ativo = await itemExistente();
    const inativo = await itemExistente({ active: false });
    await comApp(role, async (app) => {
      expect((await situacao(app, ativo.id, "deactivate")).statusCode).toBe(403);
      expect((await situacao(app, inativo.id, "activate")).statusCode).toBe(403);
    });
    expect((await linha(ativo.id)).active).toBe(true);
    expect((await linha(inativo.id)).active).toBe(false);
  });

  it("PURCHASING inativa, mas não reativa — devolver ao uso é da Qualidade", async () => {
    const inativo = await itemExistente({ active: false });
    await comApp("PURCHASING", async (app) => {
      const reativar = await situacao(app, inativo.id, "activate");
      expect(reativar.statusCode).toBe(403);
      expect(reativar.json()).toEqual(RECUSA);
      expect((await situacao(app, ID_INEXISTENTE, "activate")).statusCode).toBe(403);
    });
    expect((await linha(inativo.id)).active).toBe(false);
  });
});
