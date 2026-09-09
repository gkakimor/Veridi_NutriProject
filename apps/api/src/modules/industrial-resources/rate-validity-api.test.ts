import { afterAll, describe, expect, it } from "vitest";
import { hojeComercial } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * INDUSTRIAL-RATE-VALIDITY-01 — a vigência civil atravessa a API.
 *
 * A regra vive em `isRateCurrent` e é provada caso a caso em
 * `rate-validity.test.ts`. Aqui o que se prova é a CADEIA: a mesma resposta
 * chega ao read model que a tela lê, e o read model pergunta pelo dia
 * comercial da Veridi — não pelo relógio do processo, que em Railway é UTC.
 *
 * O defeito era exatamente este trecho: `toRateDTO` decidia com `new Date()`
 * e comparava instante contra marcador de dia, então uma tarifa "válida até
 * hoje" chegava à tela como histórica durante o próprio dia impresso nela.
 */

const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
});

type App = ReturnType<typeof buildTestApp>;

/** O dia comercial de hoje e seus vizinhos, em `YYYY-MM-DD`. */
function diasEmVolta(): { ontem: string; hoje: string; amanha: string } {
  const hoje = hojeComercial();
  const [ano, mes, dia] = hoje.split("-").map(Number) as [number, number, number];
  const desloca = (passo: number) =>
    new Date(Date.UTC(ano, mes - 1, dia + passo)).toISOString().slice(0, 10);
  return { ontem: desloca(-1), hoje, amanha: desloca(1) };
}

async function criarRecurso(app: App): Promise<string> {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Operador vigência ${marker()}`, type: "LABOR" },
    })
  ).json();
  fixtureResourceIds.push(resource.id);
  return resource.id;
}

async function registrarTarifa(
  app: App,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resposta = await app.inject({
    method: "POST",
    url: `/industrial-resources/${resourceId}/rates`,
    payload,
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json();
}

/** A tarifa recém-registrada, do detalhe que a tela lê. */
function primeiraTarifa(detalhe: Record<string, unknown>): Record<string, unknown> {
  const rates = detalhe.rates as Record<string, unknown>[];
  return rates[0]!;
}


/**
 * Estrutura em RASCUNHO com um operador declarado.
 *
 * Rascunho de propósito: versão ativa lê o snapshot congelado na ativação, e
 * o que se quer provar aqui é a SELEÇÃO por data de referência — que só
 * acontece enquanto a estrutura ainda vê a tarifa vigente do cadastro.
 */
async function estruturaComOperador(app: App, resourceId: string) {
  const prisma = getPrisma();
  const m = marker();
  const criarItem = async (type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) => {
    const item = await prisma.item.create({
      data: {
        type,
        code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-VIG-${m}-${unitCode}`,
        name: `Item vigência ${m} ${unitCode}`,
        unitCode,
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
        active: true,
      },
    });
    fixtureItemIds.push(item.id);
    return item;
  };

  const finishedItem = await criarItem("FINISHED_PRODUCT", "un");
  const material = await criarItem("RAW_MATERIAL", "kg");

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto vigência ${m}`,
        finishedProductItemId: finishedItem.id,
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const formulation = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: material.id, quantity: "0.01", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: "1000", referenceOutputUomCode: "un" },
    })
  ).json();

  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: { resourceId, usageQuantity: "1" },
  });

  return version;
}

describe("Vigência de tarifa industrial — a mesma resposta chega à tela", () => {
  it("tarifa que vale ATÉ hoje chega ao read model como vigente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { ontem, hoje } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const detalhe = await registrarTarifa(app, resourceId, {
      rateValue: "30",
      effectiveAt: ontem,
      validUntil: hoje,
    });

    const rate = primeiraTarifa(detalhe);
    // Este é o caso que reprovava: o marcador de "até hoje" é 00:00:00.000, e
    // qualquer relógio depois disso declarava a tarifa histórica.
    expect(rate.isCurrent).toBe(true);
    expect((detalhe.currentRate as Record<string, unknown> | null)?.id).toBe(rate.id);

    // E a listagem — outro caminho, mesma decisão — concorda.
    const lista = (
      await app.inject({ method: "GET", url: `/industrial-resources?search=${detalhe.code}` })
    ).json();
    const naLista = (lista.resources as Record<string, unknown>[]).find(
      (linha) => linha.id === resourceId,
    )!;
    expect((naLista.currentRate as Record<string, unknown> | null)?.id).toBe(rate.id);
  });

  it("tarifa que venceu ONTEM chega como histórica, e o recurso fica sem vigente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { ontem } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const detalhe = await registrarTarifa(app, resourceId, {
      rateValue: "30",
      effectiveAt: "2026-01-01",
      validUntil: ontem,
    });

    expect(primeiraTarifa(detalhe).isCurrent).toBe(false);
    expect(detalhe.currentRate).toBeNull();
  });

  it("tarifa que começa AMANHÃ ainda não vale hoje", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { amanha } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const detalhe = await registrarTarifa(app, resourceId, {
      rateValue: "42",
      effectiveAt: amanha,
    });

    expect(primeiraTarifa(detalhe).isCurrent).toBe(false);
    expect(detalhe.currentRate).toBeNull();
  });

  it("tarifa sem vigência informada nasce valendo HOJE, como data civil", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { hoje } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const detalhe = await registrarTarifa(app, resourceId, { rateValue: "30" });
    const rate = primeiraTarifa(detalhe);

    expect(rate.isCurrent).toBe(true);
    // Marcador do dia civil, não um instante do meio do dia: a coluna guarda
    // o mesmo formato que o `<input type="date">` manda.
    expect(rate.effectiveAt).toBe(`${hoje}T00:00:00.000Z`);
  });

  it("validade no PRÓPRIO dia de início é aceita — vale aquele dia inteiro", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { hoje } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const detalhe = await registrarTarifa(app, resourceId, {
      rateValue: "30",
      effectiveAt: hoje,
      validUntil: hoje,
    });
    expect(primeiraTarifa(detalhe).isCurrent).toBe(true);
  });

  it("validade anterior ao início continua recusada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { ontem, hoje } = diasEmVolta();
    const resourceId = await criarRecurso(app);

    const resposta = await app.inject({
      method: "POST",
      url: `/industrial-resources/${resourceId}/rates`,
      payload: { rateValue: "30", effectiveAt: hoje, validUntil: ontem },
    });
    expect(resposta.statusCode).toBe(400);
  });

  it("criar tarifa nova não encerra nem edita a anterior", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const resourceId = await criarRecurso(app);

    const antes = await registrarTarifa(app, resourceId, {
      rateValue: "30",
      effectiveAt: "2026-01-01",
    });
    const anterior = primeiraTarifa(antes);

    const depois = await registrarTarifa(app, resourceId, {
      rateValue: "42",
      effectiveAt: "2026-09-01",
    });

    const aAnteriorDepois = (depois.rates as Record<string, unknown>[]).find(
      (linha) => linha.id === anterior.id,
    )!;
    // A decisão de encerrar a anterior é de PRODUTO e não foi tomada
    // (discovery, junto com a sobreposição de oferta de fornecedor). O que
    // esta capability garante é que nada acontece por conta própria.
    expect(aAnteriorDepois.validUntil).toBeNull();
    expect(aAnteriorDepois.rateValue).toBe(anterior.rateValue);
    expect(aAnteriorDepois.effectiveAt).toBe(anterior.effectiveAt);
    // As duas continuam no histórico; a mais recente é a vigente.
    expect((depois.rates as unknown[]).length).toBe(2);
    expect((depois.currentRate as Record<string, unknown>).rateValue).toBe("42");
  });
});

describe("O motor econômico segue a data de referência, nunca o relógio", () => {
  it("calcular agosto usa a tarifa de agosto, mesmo com setembro já vigente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const resourceId = await criarRecurso(app);

    // A vale desde janeiro; B, desde setembro. As duas existem HOJE.
    await registrarTarifa(app, resourceId, { rateValue: "30", effectiveAt: "2026-01-01" });
    await registrarTarifa(app, resourceId, { rateValue: "42", effectiveAt: "2026-09-01" });

    const version = await estruturaComOperador(app, resourceId);
    const calcular = async (costReferenceDate: string) => {
      const resposta = await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculate`,
        payload: { costReferenceDate },
      });
      expect(resposta.statusCode).toBe(200);
      const resultado = resposta.json();
      return (resultado.resources as { rateValue: string | null }[])[0]!.rateValue;
    };

    // 31/08 ainda é agosto: A. 01/09 já é setembro: B. A borda é o DIA.
    expect(await calcular("2026-08-31")).toBe("30");
    expect(await calcular("2026-09-01")).toBe("42");
    expect(await calcular("2026-12-31")).toBe("42");
  });
});

/**
 * O que existe hoje quando duas vigências se sobrepõem — OBSERVAÇÃO, não
 * decisão.
 *
 * Criar B não encerra A: as duas ficam sem `validUntil` e as duas respondem
 * "vigente" para o dia de hoje. A seleção do motor é determinística (o
 * `effectiveAt` mais recente, com desempate por `createdAt`), então nenhum
 * cálculo fica ambíguo — mas o HISTÓRICO da tela marca as duas como Vigente
 * sem dizer qual ganha, e é essa a ambiguidade para quem lê.
 *
 * A política — encerrar a anterior, bloquear a sobreposição, alertar, ou
 * permitir com prioridade explícita — é decisão de PRODUTO, e precisa ser
 * tomada junto com SUPPLIER-OFFER-OVERLAP-01: são a mesma pergunta nos dois
 * lados do custo, e duas respostas divergentes seriam pior que nenhuma.
 *
 * Este caso existe para que a mudança de política seja deliberada: quem
 * decidir vai vê-lo falhar e trocar a expectativa junto com a regra.
 */
describe("Sobreposição de vigências — o estado atual, registrado", () => {
  it("duas tarifas abertas coexistem, as duas aparecem vigentes, e a mais recente vence", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const resourceId = await criarRecurso(app);

    await registrarTarifa(app, resourceId, { rateValue: "30", effectiveAt: "2026-01-01" });
    const detalhe = await registrarTarifa(app, resourceId, {
      rateValue: "42",
      effectiveAt: "2026-09-01",
    });

    const rates = detalhe.rates as Record<string, unknown>[];
    expect(rates).toHaveLength(2);
    // O banco permite: nenhuma constraint de sobreposição.
    // O service permite: nenhuma validação de sobreposição.
    expect(rates.every((rate) => rate.validUntil === null)).toBe(true);
    // A tela marca AS DUAS como vigentes — é o risco de leitura registrado.
    expect(rates.filter((rate) => rate.isCurrent === true)).toHaveLength(2);
    // O motor, porém, não fica ambíguo: `effectiveAt` mais recente ganha.
    expect((detalhe.currentRate as Record<string, unknown>).rateValue).toBe("42");
  });
});
