import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * PREC-MIG-C — pureza e overage atravessam o sistema com seis casas.
 *
 * O achado da auditoria PREC-01: `99,9995%` de um laudo de ensaio era gravado
 * em `Decimal(6,3)` e voltava do banco como `100,000`. Ninguém era avisado, e
 * "100% puro" é uma afirmação diferente da que o laudo faz — a divisão pela
 * pureza passava a usar um operando que o laboratório nunca mediu.
 *
 * Este arquivo prova a volta inteira com dado real:
 *
 *   entrada → validator → Prisma → coluna → DTO → entrada de novo
 *
 * e as duas fronteiras que a capability cria: seis casas passam, sete são
 * RECUSADAS antes do PostgreSQL — porque acima do scale o banco arredondaria
 * de novo, e trocar um silêncio por outro não é correção.
 */

type App = ReturnType<typeof buildTestApp>;

const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixtureTemplateIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureTemplateIds.length > 0) {
    await prisma.formulationTemplateComponent.deleteMany({
      where: { formulationTemplateVersion: { formulationTemplateId: { in: fixtureTemplateIds } } },
    });
    await prisma.formulationTemplateVersion.deleteMany({
      where: { formulationTemplateId: { in: fixtureTemplateIds } },
    });
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem(
  app: App,
  tipo: "RAW_MATERIAL" | "FINISHED_PRODUCT",
  unidade: string,
  pureza?: string,
) {
  const resposta = await app.inject({
    method: "POST",
    url: "/items",
    payload: {
      type: tipo,
      name: `PREC-C ${tipo} ${marca()}`,
      unitCode: unidade,
      ...(pureza === undefined ? {} : { defaultPurityPercent: pureza }),
    },
  });
  expect(resposta.statusCode, `criação do item falhou: ${resposta.body}`).toBeLessThan(400);
  const item = resposta.json();
  fixtureItemIds.push(item.id);
  return item;
}

async function criarProduto(app: App) {
  const acabado = await criarItem(app, "FINISHED_PRODUCT", "un");
  const produto = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `PREC-C produto ${marca()}`,
        finishedProductItemId: acabado.id,
      },
    })
  ).json();
  fixtureProductIds.push(produto.id);
  return produto;
}

/** Uma versão com um componente teórico, pureza e overage aplicados. */
async function versaoComAjustes(
  app: App,
  produtoId: string,
  ingredienteId: string,
  pureza: string,
  overage: string,
  anterior?: string,
) {
  const versao = (
    await app.inject(
      anterior
        ? { method: "POST", url: `/formulation-versions/${anterior}/new-version` }
        : { method: "POST", url: `/products/${produtoId}/formulation-versions` },
    )
  ).json();

  const atualizada = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: {
      basisQuantity: "1",
      calculationMode: "FIXED_BASIS",
      components: [
        {
          itemId: ingredienteId,
          quantity: "220",
          unitCode: "mg",
          basis: "FIXED_BASIS",
          purityPercentApplied: pureza,
          overagePercent: overage,
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
          applyOverageAdjustment: true,
        },
      ],
    },
  });
  expect(atualizada.statusCode, `PATCH da versão falhou: ${atualizada.body}`).toBeLessThan(400);

  const ativada = await app.inject({
    method: "POST",
    url: `/formulation-versions/${versao.id}/activate`,
  });
  expect(ativada.statusCode, `ativação falhou: ${ativada.body}`).toBeLessThan(400);
  return atualizada.json();
}

describe("PREC-MIG-C: o valor do laudo sobrevive ao banco", () => {
  it("99,9995% persiste como 99.999500 e NÃO vira 100", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await criarItem(app, "RAW_MATERIAL", "kg", "99.9995");

    // 1. A coluna. Antes do PREC-MIG-C aqui saía `100.000`.
    const noBanco = await getPrisma().item.findUniqueOrThrow({ where: { id: item.id } });
    expect(noBanco.defaultPurityPercent?.toString()).toBe("99.9995");
    const bruto = await getPrisma().$queryRawUnsafe<{ v: string }[]>(
      `select "defaultPurityPercent"::text v from items where id = $1`,
      item.id,
    );
    expect(bruto[0]?.v).toBe("99.999500");

    // 2. O DTO. String, nunca número JSON — `99.9995` como número já teria
    //    saído do JSON com a precisão do float.
    const dto = (await app.inject({ method: "GET", url: `/items/${item.id}` })).json();
    expect(typeof dto.defaultPurityPercent).toBe("string");
    expect(Number(dto.defaultPurityPercent)).toBe(99.9995);

    await app.close();
  });

  it("99,999500 e 100 continuam sendo dois itens diferentes", async () => {
    const app = buildTestApp();
    await app.ready();

    const quaseCem = await criarItem(app, "RAW_MATERIAL", "kg", "99.9995");
    const cem = await criarItem(app, "RAW_MATERIAL", "kg", "100");

    const linhas = await getPrisma().$queryRawUnsafe<{ id: string; v: string }[]>(
      `select id, "defaultPurityPercent"::text v from items
        where id in ($1, $2) order by "defaultPurityPercent"`,
      quaseCem.id,
      cem.id,
    );
    expect(linhas.map((l) => l.v)).toEqual(["99.999500", "100.000000"]);

    await app.close();
  });

  it("as seis casas do domínio persistem exatamente como foram digitadas", async () => {
    const app = buildTestApp();
    await app.ready();

    // Os valores do acceptance, todos válidos na faixa de pureza.
    const casos = [
      ["98", "98.000000"],
      ["98.5", "98.500000"],
      ["98.1234", "98.123400"],
      ["98.123456", "98.123456"],
      ["99.9995", "99.999500"],
      ["99.999999", "99.999999"],
      ["0.000001", "0.000001"],
      ["100", "100.000000"],
    ] as const;

    for (const [entrada, esperado] of casos) {
      const item = await criarItem(app, "RAW_MATERIAL", "kg", entrada);
      const bruto = await getPrisma().$queryRawUnsafe<{ v: string }[]>(
        `select "defaultPurityPercent"::text v from items where id = $1`,
        item.id,
      );
      expect(bruto[0]?.v, `pureza ${entrada}`).toBe(esperado);
    }

    await app.close();
  });
});

describe("PREC-MIG-C: a fronteira recusa acima de seis casas", () => {
  it("pureza com sete casas é 400, e a mensagem diz o limite", async () => {
    const app = buildTestApp();
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/items",
      payload: {
        type: "RAW_MATERIAL",
        name: `PREC-C sete casas ${marca()}`,
        unitCode: "kg",
        defaultPurityPercent: "99.9999999",
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(resposta.json())).toContain("no máximo 6 casas decimais");

    await app.close();
  });

  it("overage com sete casas é recusado na Formulação", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const produto = await criarProduto(app);
    const versao = (
      await app.inject({
        method: "POST",
        url: `/products/${produto.id}/formulation-versions`,
      })
    ).json();

    const resposta = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versao.id}`,
      payload: {
        basisQuantity: "1",
        calculationMode: "FIXED_BASIS",
        components: [
          {
            itemId: ingrediente.id,
            quantity: "220",
            unitCode: "mg",
            basis: "FIXED_BASIS",
            overagePercent: "3.6543211",
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(resposta.json())).toContain("no máximo 6 casas decimais");

    await app.close();
  });

  it("a faixa de negócio da pureza não mudou com o scale", async () => {
    const app = buildTestApp();
    await app.ready();

    // A coluna suporta 999,999999; o domínio continua parando em 100, e zero
    // continua recusado — pureza zero seria divisão por zero disfarçada.
    for (const invalida of ["101", "999.999999", "0"]) {
      const resposta = await app.inject({
        method: "POST",
        url: "/items",
        payload: {
          type: "RAW_MATERIAL",
          name: `PREC-C faixa ${marca()}`,
          unitCode: "kg",
          defaultPurityPercent: invalida,
        },
      });
      expect(resposta.statusCode, `pureza ${invalida} deveria ser recusada`).toBe(400);
    }

    await app.close();
  });
});

describe("PREC-MIG-C: round-trip sem perda escondida", () => {
  it("abrir e salvar sem editar devolve o mesmo valor ao banco", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await criarItem(app, "RAW_MATERIAL", "kg", "99.9995");
    const antes = await getPrisma().$queryRawUnsafe<{ v: string }[]>(
      `select "defaultPurityPercent"::text v from items where id = $1`,
      item.id,
    );
    expect(antes[0]?.v).toBe("99.999500");

    // Abrir: é EXATAMENTE isto que o formulário coloca no campo.
    const aberto = (await app.inject({ method: "GET", url: `/items/${item.id}` })).json();

    // Salvar sem editar: o formulário devolve o que recebeu.
    const salvo = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      payload: { defaultPurityPercent: aberto.defaultPurityPercent },
    });
    expect(salvo.statusCode).toBeLessThan(400);

    const depois = await getPrisma().$queryRawUnsafe<{ v: string }[]>(
      `select "defaultPurityPercent"::text v from items where id = $1`,
      item.id,
    );
    expect(depois[0]?.v).toBe("99.999500");

    await app.close();
  });

  it("o componente da Formulação também volta inteiro", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const produto = await criarProduto(app);
    const versao = await versaoComAjustes(
      app,
      produto.id,
      ingrediente.id,
      "97.123456",
      "3.654321",
    );

    const componente = versao.components[0];
    expect(componente.purityPercentApplied).toBe("97.123456");
    expect(componente.overagePercent).toBe("3.654321");

    const bruto = await getPrisma().$queryRawUnsafe<{ p: string; o: string }[]>(
      `select "purityPercentApplied"::text p, "overagePercent"::text o
         from formulation_components where "formulationVersionId" = $1`,
      versao.id,
    );
    expect(bruto[0]).toEqual({ p: "97.123456", o: "3.654321" });

    await app.close();
  });
});

describe("PREC-MIG-C: o cálculo real usa os operandos precisos", () => {
  it("a OP congela pureza e overage de seis casas e a necessidade que eles produzem", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const produto = await criarProduto(app);
    await versaoComAjustes(app, produto.id, ingrediente.id, "97.123456", "3.654321");

    const ordem = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: produto.id, plannedQuantity: "1000" },
      })
    ).json();
    fixtureProductionOrderIds.push(ordem.id);
    await aplicarRoteiroDeTeste(ordem.id);
    await app.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` });

    const congelado = await getPrisma().productionOrderRequirement.findFirstOrThrow({
      where: { productionOrderId: ordem.id, itemId: ingrediente.id },
    });
    expect(congelado.purityPercentApplied?.toString()).toBe("97.123456");
    expect(congelado.overagePercent?.toString()).toBe("3.654321");

    // 220 mg × 1000 = 0,22 kg teóricos; ÷ 0,97123456 × 1,03654321.
    // Se qualquer operando tivesse sido cortado em três casas, o físico
    // divergiria a partir da quinta.
    expect(congelado.theoreticalQuantity?.toString()).toBe("0.22");
    expect(congelado.requiredQuantity.toFixed(12)).toBe("0.234793442894");

    await app.close();
  });

  it("V2 com pureza mais precisa não reescreve a OP nascida na V1", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const produto = await criarProduto(app);
    const v1 = await versaoComAjustes(app, produto.id, ingrediente.id, "98", "20");

    const opA = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: produto.id, plannedQuantity: "1000" },
      })
    ).json();
    fixtureProductionOrderIds.push(opA.id);
    await aplicarRoteiroDeTeste(opA.id);
    await app.inject({ method: "POST", url: `/production-orders/${opA.id}/plan` });

    const antes = await getPrisma().productionOrderRequirement.findFirstOrThrow({
      where: { productionOrderId: opA.id, itemId: ingrediente.id },
    });

    // V2: a mesma receita, com a pureza que o laudo realmente mediu.
    await versaoComAjustes(app, produto.id, ingrediente.id, "98.123456", "20", v1.id);

    const depois = await getPrisma().productionOrderRequirement.findFirstOrThrow({
      where: { productionOrderId: opA.id, itemId: ingrediente.id },
    });
    expect(depois.purityPercentApplied?.toString()).toBe("98");
    expect(depois.requiredQuantity.toString()).toBe(antes.requiredQuantity.toString());

    await app.close();
  });
});

describe("PREC-MIG-C: template → versão → Formulação sem perda", () => {
  it("a pureza de seis casas do template chega inteira à formulação gerada", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const produto = await criarProduto(app);

    const template = (
      await app.inject({
        method: "POST",
        url: "/formulation-templates",
        payload: {
          name: `PREC-C template ${marca()}`,
          basisQuantity: "1",
          outputUnitCode: "un",
          calculationMode: "FIXED_BASIS",
        },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    const versaoTemplate = template.versions[0];
    const atualizada = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${versaoTemplate.id}`,
      payload: {
        basisQuantity: "1",
        components: [
          {
            itemId: ingrediente.id,
            quantity: "220",
            unitCode: "mg",
            basis: "FIXED_BASIS",
            purityPercentApplied: "99.999500",
            overagePercent: "0.000001",
          },
        ],
      },
    });
    expect(atualizada.statusCode, `PATCH do template falhou: ${atualizada.body}`).toBeLessThan(400);
    expect(atualizada.json().components[0].purityPercentApplied).toBe("99.9995");

    const noBanco = await getPrisma().$queryRawUnsafe<{ p: string; o: string }[]>(
      `select "purityPercentApplied"::text p, "overagePercent"::text o
         from formulation_template_components where "formulationTemplateVersionId" = $1`,
      versaoTemplate.id,
    );
    expect(noBanco[0]).toEqual({ p: "99.999500", o: "0.000001" });

    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${versaoTemplate.id}/activate`,
    });
    expect(ativada.statusCode, `ativação do template falhou: ${ativada.body}`).toBeLessThan(400);

    const gerada = await app.inject({
      method: "POST",
      url: `/products/${produto.id}/formulation-versions/from-template`,
      payload: { formulationTemplateVersionId: versaoTemplate.id },
    });
    expect(gerada.statusCode, `aplicar template falhou: ${gerada.body}`).toBeLessThan(400);

    const componente = gerada.json().components[0];
    expect(componente.purityPercentApplied).toBe("99.9995");
    expect(componente.overagePercent).toBe("0.000001");

    const naFormulacao = await getPrisma().$queryRawUnsafe<{ p: string; o: string }[]>(
      `select "purityPercentApplied"::text p, "overagePercent"::text o
         from formulation_components where "formulationVersionId" = $1`,
      gerada.json().id,
    );
    expect(naFormulacao[0]).toEqual({ p: "99.999500", o: "0.000001" });

    await app.close();
  });

  it("o template também recusa mais de seis casas", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem(app, "RAW_MATERIAL", "kg");
    const template = (
      await app.inject({
        method: "POST",
        url: "/formulation-templates",
        payload: {
          name: `PREC-C template recusa ${marca()}`,
          basisQuantity: "1",
          outputUnitCode: "un",
          calculationMode: "FIXED_BASIS",
        },
      })
    ).json();
    fixtureTemplateIds.push(template.id);
    const versaoTemplate = template.versions[0];

    const resposta = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${versaoTemplate.id}`,
      payload: {
        basisQuantity: "1",
        components: [
          {
            itemId: ingrediente.id,
            quantity: "220",
            unitCode: "mg",
            basis: "FIXED_BASIS",
            purityPercentApplied: "99.9999999",
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(resposta.json())).toContain("no máximo 6 casas decimais");

    await app.close();
  });
});
