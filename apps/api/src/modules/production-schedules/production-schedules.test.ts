import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  IndustrialResourceDetailDTO,
  ProductionBoardResponse,
  ProductionOrderDTO,
  ProductionOrderScheduleDTO,
  ProductionProfileDTO,
  ProductionSchedulePreviewDTO,
} from "@veridi/shared";
import { instanteComercial } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * PROGRAMAÇÃO DE PRODUÇÃO — PLANNING-CAPACITY-BOARD-01.
 *
 * O que estes testes protegem:
 *
 * 1. **capacidade é de mão de obra e equipamento.** Energia não ocupa recurso,
 *    e `null` NUNCA se lê como zero;
 * 2. **o calendário manda, e fail-closed.** Sem a posição do intervalo não sai
 *    hora exata; início fora da jornada é recusado COM sugestão, nunca
 *    deslocado em silêncio;
 * 3. **o ciclo de vida da ordem manda na agenda.** Rascunho e planejada se
 *    movem; liberada exige confirmação; em produção e concluída, a agenda é
 *    histórico;
 * 4. **agenda gravada é snapshot.** Mudar o calendário depois não reescreve o
 *    que já foi calculado — recalcular é uma ação explícita.
 */

type App = ReturnType<typeof buildTestApp>;
const app: App = buildTestApp("ADMIN");

const fixtureProfileIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureOrderIds: string[] = [];

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

/** Ano só deste arquivo: o calendário e as exceções são estado global. */
const ANO = 2033;
/** `2033-09-12` é segunda-feira. */
const SEGUNDA = `${ANO}-09-12`;
const em = (diaISO: string, hora: number, minuto = 0) =>
  instanteComercial(diaISO, hora * 60 + minuto).toISOString();

let operadorId: string;

async function salvarJornada(sobre: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: "PUT",
    url: "/production-calendar",
    payload: {
      startMinuteOfDay: 480,
      endMinuteOfDay: 1020,
      breakMinutes: 60,
      breakStartMinuteOfDay: 720,
      breakEndMinuteOfDay: 780,
      weekdays: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      },
      ...sobre,
    },
  });
  expect(resposta.statusCode).toBe(200);
  return resposta.json();
}

beforeAll(async () => {
  await app.ready();
  const prisma = getPrisma();
  for (const unit of [
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  await prisma.productionCalendarException.deleteMany({
    where: {
      date: {
        gte: new Date(`${ANO}-01-01T00:00:00.000Z`),
        lt: new Date(`${ANO + 1}-01-01T00:00:00.000Z`),
      },
    },
  });
  await salvarJornada();

  const criado = await prisma.industrialResource.create({
    data: {
      code: `RIN-SCH-${proximo()}`,
      name: `Mão de obra — Produção ${marca}`,
      type: "LABOR",
      defaultUsageUom: "HOUR",
      capacityQuantity: 2,
    },
  });
  fixtureResourceIds.push(criado.id);
  operadorId = criado.id;
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureProfileIds.length > 0) {
    await prisma.productionProfile.deleteMany({ where: { id: { in: fixtureProfileIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  await prisma.productionCalendarException.deleteMany({
    where: {
      date: {
        gte: new Date(`${ANO}-01-01T00:00:00.000Z`),
        lt: new Date(`${ANO + 1}-01-01T00:00:00.000Z`),
      },
    },
  });
  await app.close();
});

// ─────────────────────────────────────────────────────────────── fixtures

async function perfilAtivo(runDurationMinutes: number, resourceQuantity = 1) {
  const criado = await app.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Cápsulas ${proximo()}`, referenceQuantity: "1000", referenceUomCode: "un" },
  });
  expect(criado.statusCode).toBe(201);
  const perfil = criado.json() as ProductionProfileDTO;
  fixtureProfileIds.push(perfil.id);

  const rascunho = perfil.draftVersion!.id;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `/production-profile-versions/${rascunho}`,
        payload: {
          steps: [
            {
              name: "Mistura",
              setupDurationMinutes: 0,
              runDurationMinutes,
              scalingMode: "PROPORTIONAL",
              resources: [{ industrialResourceId: operadorId, resourceQuantity }],
            },
          ],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: `/production-profile-versions/${rascunho}/activate` }))
      .statusCode,
  ).toBe(200);
  return rascunho;
}

async function produtoPlanejavel() {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-SCH-${proximo()}`,
      name: `Produto acabado ${marca}`,
      unitCode: "un",
    },
  });
  fixtureItemIds.push(item.id);
  const produto = await prisma.product.create({
    data: {
      code: `PROD-SCH-${proximo()}`,
      name: `Produto ${marca}`,
      finishedProductItemId: item.id,
    },
  });
  fixtureProductIds.push(produto.id);

  const materia = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-SCH-${proximo()}`,
      name: `Matéria-prima ${marca}`,
      unitCode: "kg",
    },
  });
  fixtureItemIds.push(materia.id);

  const criada = await app.inject({
    method: "POST",
    url: `/products/${produto.id}/formulation-versions`,
    payload: {},
  });
  const versionId = criada.json().id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "1000",
      components: [{ itemId: materia.id, quantity: "10", unitCode: "kg" }],
    },
  });
  expect(
    (await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` }))
      .statusCode,
  ).toBe(200);
  return produto.id;
}

/** Ordem já com a cópia do roteiro — o mínimo para programar. */
async function ordemComRoteiro(runDurationMinutes = 120, resourceQuantity = 1) {
  const versionId = await perfilAtivo(runDurationMinutes, resourceQuantity);
  const productId = await produtoPlanejavel();
  expect(
    (
      await app.inject({
        method: "PUT",
        url: `/products/${productId}/production-profile`,
        payload: { productionProfileVersionId: versionId },
      })
    ).statusCode,
  ).toBe(200);
  const resposta = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity: "1000" },
  });
  expect(resposta.statusCode).toBe(201);
  const ordem = resposta.json() as ProductionOrderDTO;
  fixtureOrderIds.push(ordem.id);
  return ordem;
}

const programar = (id: string, startAt: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "PUT", url: `/production-orders/${id}/schedule`, payload: { startAt, ...payload } });

const prever = (id: string, startAt: string) =>
  app.inject({ method: "POST", url: `/production-orders/${id}/schedule/preview`, payload: { startAt } });

const situacao = (id: string, status: string) =>
  getPrisma().productionOrder.update({ where: { id }, data: { status: status as never } });

// ──────────────────────────────────────────────────────────────── testes

describe("Capacidade do recurso", () => {
  async function criarRecurso(payload: Record<string, unknown>) {
    const resposta = await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso ${proximo()}`, ...payload },
    });
    if (resposta.statusCode === 201) {
      fixtureResourceIds.push((resposta.json() as IndustrialResourceDetailDTO).id);
    }
    return resposta;
  }

  it("capacidade ausente nasce NULA — e nula não é zero", async () => {
    const resposta = await criarRecurso({ type: "LABOR" });
    expect(resposta.statusCode).toBe(201);
    expect((resposta.json() as IndustrialResourceDetailDTO).capacityQuantity).toBeNull();
  });

  it("mão de obra e equipamento aceitam capacidade a partir de 1", async () => {
    for (const type of ["LABOR", "EQUIPMENT"] as const) {
      const resposta = await criarRecurso({ type, capacityQuantity: 5 });
      expect(resposta.statusCode).toBe(201);
      expect((resposta.json() as IndustrialResourceDetailDTO).capacityQuantity).toBe(5);
    }
    const zero = await criarRecurso({ type: "LABOR", capacityQuantity: 0 });
    expect(zero.statusCode).toBe(400);
  });

  it("energia não ocupa capacidade e é recusada", async () => {
    const resposta = await criarRecurso({ type: "ENERGY", capacityQuantity: 3 });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("invalid_capacity");
  });

  it("null explícito volta a capacidade para não cadastrada", async () => {
    const criado = await criarRecurso({ type: "LABOR", capacityQuantity: 4 });
    const id = (criado.json() as IndustrialResourceDetailDTO).id;
    const limpo = await app.inject({
      method: "PATCH",
      url: `/industrial-resources/${id}`,
      payload: { capacityQuantity: null },
    });
    expect(limpo.statusCode).toBe(200);
    expect((limpo.json() as IndustrialResourceDetailDTO).capacityQuantity).toBeNull();
  });
});

describe("Calendário e a hora exata", () => {
  it("intervalo sem horário: o calendário vale, mas a agenda não sai", async () => {
    await salvarJornada({ breakStartMinuteOfDay: null, breakEndMinuteOfDay: null });
    const ordem = await ordemComRoteiro();

    const resposta = await prever(ordem.id, em(SEGUNDA, 8));
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("calendar_break_not_positioned");

    // O calendário continua legível e válido para o resto.
    const calendario = await app.inject("/production-calendar");
    expect(calendario.statusCode).toBe(200);
    expect(calendario.json().breakPositionWarning).toContain("Defina o horário do intervalo");

    await salvarJornada();
  });

  it("início fora da jornada é recusado COM sugestão, e não deslocado", async () => {
    const ordem = await ordemComRoteiro();
    // Domingo.
    const resposta = await prever(ordem.id, em(`${ANO}-09-11`, 9));
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("start_not_operational");
    expect(resposta.json().suggestionAt).toBe(em(SEGUNDA, 8));

    // Nada foi gravado por causa da recusa.
    const agenda = await app.inject(`/production-orders/${ordem.id}/schedule`);
    expect(agenda.json().schedule).toBeNull();
  });

  it("a prévia calcula e NÃO grava", async () => {
    const ordem = await ordemComRoteiro();
    const resposta = await prever(ordem.id, em(SEGUNDA, 8));
    expect(resposta.statusCode).toBe(200);
    const previa = resposta.json() as ProductionSchedulePreviewDTO;
    expect(previa.schedule.plannedStartAt).toBe(em(SEGUNDA, 8));
    expect(previa.schedule.workingMinutes).toBe(120);

    const agenda = await app.inject(`/production-orders/${ordem.id}/schedule`);
    expect(agenda.json().schedule).toBeNull();
  });

  it("ordem sem roteiro não tem o que programar", async () => {
    const productId = await produtoPlanejavel();
    const criada = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId, plannedQuantity: "1000" },
    });
    const ordem = criada.json() as ProductionOrderDTO;
    fixtureOrderIds.push(ordem.id);

    const resposta = await prever(ordem.id, em(SEGUNDA, 8));
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("order_without_route");
  });
});

describe("Ciclo de vida da ordem", () => {
  it("rascunho programa e reprograma à vontade", async () => {
    const ordem = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);

    const movida = await programar(ordem.id, em(SEGUNDA, 14));
    expect(movida.statusCode).toBe(200);
    expect((movida.json() as ProductionOrderScheduleDTO).plannedStartAt).toBe(em(SEGUNDA, 14));
  });

  it("planejada continua movendo", async () => {
    const ordem = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);
    await situacao(ordem.id, "PLANNED");
    expect((await programar(ordem.id, em(SEGUNDA, 9))).statusCode).toBe(200);
  });

  it("liberada só move com confirmação explícita", async () => {
    const ordem = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);
    await situacao(ordem.id, "RELEASED");

    const semConfirmar = await programar(ordem.id, em(SEGUNDA, 9));
    expect(semConfirmar.statusCode).toBe(409);
    expect(semConfirmar.json().error).toBe("schedule_needs_confirmation");

    const confirmada = await programar(ordem.id, em(SEGUNDA, 9), { confirmReleased: true });
    expect(confirmada.statusCode).toBe(200);
  });

  it("em produção e concluída a agenda vira histórico", async () => {
    for (const status of ["IN_PRODUCTION", "COMPLETED"]) {
      const ordem = await ordemComRoteiro();
      expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);
      await situacao(ordem.id, status);

      const movida = await programar(ordem.id, em(SEGUNDA, 9), { confirmReleased: true });
      expect(movida.statusCode).toBe(409);
      expect(movida.json().error).toBe("schedule_locked");

      // E a agenda gravada continua legível — histórico se lê.
      const agenda = await app.inject(`/production-orders/${ordem.id}/schedule`);
      expect((agenda.json().schedule as ProductionOrderScheduleDTO).plannedStartAt).toBe(
        em(SEGUNDA, 8),
      );
    }
  });
});

describe("Agenda é snapshot", () => {
  it("mudar a jornada depois NÃO reescreve a agenda gravada; recalcular é explícito", async () => {
    const ordem = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);

    try {
      // A fábrica passa a abrir às 09:00.
      await salvarJornada({ startMinuteOfDay: 540 });
      const inalterada = await app.inject(`/production-orders/${ordem.id}/schedule`);
      expect((inalterada.json().schedule as ProductionOrderScheduleDTO).plannedStartAt).toBe(
        em(SEGUNDA, 8),
      );

      // O antigo início nem serve mais — e a recusa diz qual é o novo.
      const velho = await programar(ordem.id, em(SEGUNDA, 8));
      expect(velho.statusCode).toBe(400);
      expect(velho.json().suggestionAt).toBe(em(SEGUNDA, 9));

      // Só quando alguém pede é que a agenda passa a usar o calendário novo.
      const recalculada = await programar(ordem.id, em(SEGUNDA, 9));
      expect(recalculada.statusCode).toBe(200);
      expect((recalculada.json() as ProductionOrderScheduleDTO).plannedStartAt).toBe(
        em(SEGUNDA, 9),
      );
    } finally {
      // A jornada é estado GLOBAL: deixá-la alterada quebraria o teste
      // seguinte por um motivo que nada tem a ver com ele.
      await salvarJornada();
    }
  });

  it("excluir a exceção que motivou a agenda não altera o que já foi calculado", async () => {
    const terca = `${ANO}-09-13`;
    const criada = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: terca, type: "FERIADO", reason: "Teste" },
    });
    expect(criada.statusCode).toBe(201);
    const excecaoId = criada.json().id as string;

    // 16:00 de segunda + 2 h: com o feriado na terça, o resto cai na quarta.
    const ordem = await ordemComRoteiro();
    const gravada = await programar(ordem.id, em(SEGUNDA, 16));
    expect(gravada.statusCode).toBe(200);
    const antes = (gravada.json() as ProductionOrderScheduleDTO).plannedEndAt;
    expect(antes).toBe(em(`${ANO}-09-14`, 9));

    expect(
      (await app.inject({ method: "DELETE", url: `/production-calendar/exceptions/${excecaoId}` }))
        .statusCode,
    ).toBe(204);

    const depois = await app.inject(`/production-orders/${ordem.id}/schedule`);
    expect((depois.json().schedule as ProductionOrderScheduleDTO).plannedEndAt).toBe(antes);
  });
});

describe("Conflito e quadro", () => {
  it("duas ordens sobrepostas estouram a capacidade e viram AVISO, não bloqueio", async () => {
    // Capacidade do operador do fixture é 2; cada ordem pede 2.
    const uma = await ordemComRoteiro(120, 2);
    const outra = await ordemComRoteiro(120, 2);
    expect((await programar(uma.id, em(SEGUNDA, 8))).statusCode).toBe(200);

    const segunda = await programar(outra.id, em(SEGUNDA, 9));
    // Conflito NÃO bloqueia: a programação é gravada do mesmo jeito.
    expect(segunda.statusCode).toBe(200);

    const quadro = await app.inject(
      `/production-board?from=${SEGUNDA}&to=${SEGUNDA}&view=DAY`,
    );
    expect(quadro.statusCode).toBe(200);
    const corpo = quadro.json() as ProductionBoardResponse;
    const meu = corpo.conflicts.filter((c) => c.industrialResourceId === operadorId);
    expect(meu.length).toBeGreaterThan(0);
    expect(meu[0]!.demanda).toBeGreaterThan(meu[0]!.capacityQuantity);

    const recurso = corpo.resources.find((r) => r.industrialResourceId === operadorId);
    expect(recurso?.situacao).toBe("SOBRECARGA");
    expect(recurso?.plannedMinutes).toBeGreaterThan(0);
  });

  it("o quadro filtra por situação e lista quem ainda não tem programação", async () => {
    const ordem = await ordemComRoteiro();
    const semAgenda = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);

    const quadro = await app.inject(
      `/production-board?from=${SEGUNDA}&to=${SEGUNDA}&view=DAY&status=DRAFT`,
    );
    const corpo = quadro.json() as ProductionBoardResponse;
    expect(corpo.orders.every((o) => o.status === "DRAFT")).toBe(true);
    expect(corpo.unscheduled.map((o) => o.productionOrderId)).toContain(semAgenda.id);
    expect(corpo.unscheduled.map((o) => o.productionOrderId)).not.toContain(ordem.id);
  });

  it("tirar a programação devolve a ordem para a lista de quem falta programar", async () => {
    const ordem = await ordemComRoteiro();
    expect((await programar(ordem.id, em(SEGUNDA, 8))).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "DELETE", url: `/production-orders/${ordem.id}/schedule` }))
        .statusCode,
    ).toBe(204);
    const agenda = await app.inject(`/production-orders/${ordem.id}/schedule`);
    expect(agenda.json().schedule).toBeNull();
  });
});
