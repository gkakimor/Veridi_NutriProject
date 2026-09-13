import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { ALL_ROWS } from "../../lib/pagination.js";
import { getLatePurchaseOrdersReport } from "../reports/purchasing-reports.service.js";
import { onOrderQuerySchema } from "../reports/reports.schemas.js";
import { buildAttentionList } from "./attention.service.js";
import { getOpenPurchaseOrderState } from "./dashboard.queries.js";

/**
 * OC atrasada é o DIA previsto que já passou (PURCHASE-OVERDUE-CIVIL-DATE-01).
 *
 * `expectedDeliveryDate` é data civil: a tela manda o dia de um
 * `<input type="date">` e a coluna guarda a meia-noite UTC como MARCADOR dele.
 * O Painel comparava esse marcador com o relógio — e a meia-noite UTC de 12/09
 * são 21h de 11/09 em São Paulo. A OC prevista para 12/09 ficava "atrasada"
 * desde a véspera e durante todo o dia previsto.
 *
 * Três lugares dizem "OC atrasada" e respondem juntos aqui, no mesmo instante:
 * o contador "Atrasadas" do Estado atual, a lista de atenção e o R-11. As
 * bordas passam com a máquina em UTC, UTC-07 e São Paulo. A resposta de
 * negócio está escrita à mão na tabela, nunca recalculada com o helper que o
 * código usa — senão o teste concordaria consigo mesmo.
 *
 * O contador é agregado do banco inteiro, e este arquivo roda em paralelo. Em
 * vez de ir para a faixa serial, as duas leituras (com as OCs do teste e sem
 * elas) saem do MESMO retrato — transação REPEATABLE READ, desfeita no fim —,
 * e vizinho nenhum mexe na diferença.
 */

type App = ReturnType<typeof buildTestApp>;

/** As três máquinas, com o deslocamento que cada uma tem em setembro de 2026. */
const FUSOS = [
  { fuso: "UTC", deslocamentoEmMinutos: 0 },
  { fuso: "Etc/GMT+7", deslocamentoEmMinutos: 420 },
  { fuso: "America/Sao_Paulo", deslocamentoEmMinutos: 180 },
];

/** Roda `corpo` com o processo no fuso pedido — e confere que o fuso pegou. */
async function naMaquinaEm<T>(
  { fuso, deslocamentoEmMinutos }: (typeof FUSOS)[number],
  corpo: () => Promise<T>,
): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = fuso;
  try {
    // Sem isto o teste passaria sem nunca ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamentoEmMinutos);
    return await corpo();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

/** As OCs do teste: o dia previsto e a situação em que cada uma fica. */
const CENARIOS = {
  PREVISTA_12: { previsao: "2026-09-12", situacao: "ORDERED" },
  PREVISTA_11: { previsao: "2026-09-11", situacao: "ORDERED" },
  PARCIAL_11: { previsao: "2026-09-11", situacao: "PARTIALLY_RECEIVED" },
  RECEBIDA_11: { previsao: "2026-09-11", situacao: "RECEIVED" },
  CANCELADA_11: { previsao: "2026-09-11", situacao: "CANCELLED" },
  RASCUNHO_11: { previsao: "2026-09-11", situacao: "DRAFT" },
} as const;
type Cenario = keyof typeof CENARIOS;

/**
 * Cada instante em UTC, o que ele é em São Paulo, e as OCs atrasadas nele com
 * os dias de atraso que o R-11 mostra. Recebida, cancelada e rascunho nunca
 * entram: o status que já as excluía continua excluindo.
 */
const INSTANTES: { quando: string; saoPaulo: string; atrasadas: Partial<Record<Cenario, number>> }[] = [
  { quando: "2026-09-11T15:00:00.000Z", saoPaulo: "11/09 12:00", atrasadas: {} },
  // O relato: em UTC já é 12/09, e a OC prevista para 12/09 aparecia atrasada.
  { quando: "2026-09-12T00:30:00.000Z", saoPaulo: "11/09 21:30", atrasadas: {} },
  { quando: "2026-09-12T03:00:00.000Z", saoPaulo: "12/09 00:00", atrasadas: { PREVISTA_11: 1, PARCIAL_11: 1 } },
  { quando: "2026-09-12T15:00:00.000Z", saoPaulo: "12/09 12:00", atrasadas: { PREVISTA_11: 1, PARCIAL_11: 1 } },
  { quando: "2026-09-13T00:30:00.000Z", saoPaulo: "12/09 21:30", atrasadas: { PREVISTA_11: 1, PARCIAL_11: 1 } },
  { quando: "2026-09-13T02:59:59.000Z", saoPaulo: "12/09 23:59:59", atrasadas: { PREVISTA_11: 1, PARCIAL_11: 1 } },
  { quando: "2026-09-13T02:59:59.999Z", saoPaulo: "12/09 23:59:59.999", atrasadas: { PREVISTA_11: 1, PARCIAL_11: 1 } },
  {
    quando: "2026-09-13T03:00:00.000Z",
    saoPaulo: "13/09 00:00",
    atrasadas: { PREVISTA_12: 1, PREVISTA_11: 2, PARCIAL_11: 2 },
  },
  {
    quando: "2026-09-13T15:00:00.000Z",
    saoPaulo: "13/09 12:00",
    atrasadas: { PREVISTA_12: 1, PREVISTA_11: 2, PARCIAL_11: 2 },
  },
];

const ocs = {} as Record<Cenario, { id: string; code: string }>;
const criados = { ocs: [] as string[], recebimentos: [] as string[], itens: [] as string[], fornecedores: [] as string[] };

let app: App;
let fornecedorId: string;

function cenarioDaOc(id: string): Cenario | undefined {
  return (Object.keys(ocs) as Cenario[]).find((cenario) => ocs[cenario].id === id);
}

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();

  const prisma = getPrisma();
  const m = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const fornecedor = await prisma.supplier.create({
    data: { code: `FOR-ATR-${m}`, legalName: `Fornecedor OC Atrasada ${m}`, active: true },
  });
  criados.fornecedores.push(fornecedor.id);
  fornecedorId = fornecedor.id;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-ATR-${m}`,
      name: `Item OC Atrasada ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.itens.push(item.id);

  for (const cenario of Object.keys(CENARIOS) as Cenario[]) {
    const { previsao, situacao } = CENARIOS[cenario];
    const criada = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: fornecedor.id,
        orderDate: new Date().toISOString(),
        // O que a tela manda: o dia do `<input type="date">` como meia-noite UTC.
        expectedDeliveryDate: new Date(previsao).toISOString(),
        lines: [{ itemId: item.id, orderedQuantity: "100" }],
      },
    });
    expect(criada.statusCode, criada.body.slice(0, 300)).toBe(201);
    const oc = criada.json();
    criados.ocs.push(oc.id);
    ocs[cenario] = { id: oc.id, code: oc.code };
    if (situacao === "DRAFT") continue;

    const confirmada = await app.inject({ method: "POST", url: `/purchase-orders/${oc.id}/confirm` });
    expect(confirmada.statusCode, confirmada.body.slice(0, 300)).toBe(200);

    if (situacao === "CANCELLED") {
      const cancelada = await app.inject({
        method: "POST",
        url: `/purchase-orders/${oc.id}/cancel`,
        payload: { reason: "Teste de OC atrasada" },
      });
      expect(cancelada.statusCode, cancelada.body.slice(0, 300)).toBe(200);
    }

    if (situacao === "PARTIALLY_RECEIVED" || situacao === "RECEIVED") {
      const recebimento = await app.inject({
        method: "POST",
        url: `/purchase-orders/${oc.id}/receipts`,
        payload: {
          receivedAt: new Date().toISOString(),
          lines: [
            {
              purchaseOrderLineId: oc.lines[0].id,
              receivedQuantity: situacao === "RECEIVED" ? "100" : "40",
              supplierLot: `SUP-${m}-${cenario}`,
            },
          ],
        },
      });
      expect(recebimento.statusCode, recebimento.body.slice(0, 300)).toBe(201);
      criados.recebimentos.push(recebimento.json().id);
    }
  }

  // Cada OC está na situação pretendida — senão "recebida não atrasa" poderia
  // ser uma OC que nunca recebeu nada.
  const gravadas = await prisma.purchaseOrder.findMany({
    where: { id: { in: criados.ocs } },
    select: { id: true, status: true, expectedDeliveryDate: true },
  });
  for (const oc of gravadas) {
    const cenario = cenarioDaOc(oc.id)!;
    expect(oc.status, cenario).toBe(CENARIOS[cenario].situacao);
    expect(oc.expectedDeliveryDate?.toISOString(), cenario).toBe(`${CENARIOS[cenario].previsao}T00:00:00.000Z`);
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.receiptLine.deleteMany({ where: { receiptId: { in: criados.recebimentos } } });
  await prisma.receipt.deleteMany({ where: { id: { in: criados.recebimentos } } });
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: criados.ocs } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ocs } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await app.close();
});

class DesfazerRetrato extends Error {}

/**
 * Quanto as OCs do teste somam no contador "Atrasadas", em cada instante.
 *
 * Com as OCs e, depois de cancelá-las dentro da transação, sem elas — as duas
 * leituras no mesmo retrato REPEATABLE READ. A transação é desfeita: nada do
 * cancelamento chega ao banco.
 */
async function somaNoContador(instantes: Date[]): Promise<number[]> {
  let soma: number[] = [];
  try {
    await getPrisma().$transaction(
      async (tx) => {
        const com: number[] = [];
        for (const agora of instantes) com.push((await getOpenPurchaseOrderState(tx, agora)).lateOrders);
        await tx.purchaseOrder.updateMany({ where: { id: { in: criados.ocs } }, data: { status: "CANCELLED" } });
        const sem: number[] = [];
        for (const agora of instantes) sem.push((await getOpenPurchaseOrderState(tx, agora)).lateOrders);
        soma = com.map((valor, indice) => valor - sem[indice]!);
        throw new DesfazerRetrato();
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
    );
  } catch (erro) {
    if (!(erro instanceof DesfazerRetrato)) throw erro;
  }
  return soma;
}

describe("OC atrasada — o dia previsto passou, e não o relógio", () => {
  for (const maquina of FUSOS) {
    it(`máquina em ${maquina.fuso}: contador, lista de atenção e R-11 dizem o mesmo em cada borda`, async () => {
      await naMaquinaEm(maquina, async () => {
        const contador = await somaNoContador(INSTANTES.map((instante) => new Date(instante.quando)));

        for (const [indice, instante] of INSTANTES.entries()) {
          const agora = new Date(instante.quando);
          const rotulo = `${maquina.fuso} · ${instante.saoPaulo} em São Paulo`;
          const esperadas = (Object.keys(instante.atrasadas) as Cenario[]).sort();

          const atencao = await buildAttentionList(getPrisma(), agora);
          const naLista = atencao
            .filter((item) => item.type === "PURCHASE_ORDER_LATE")
            .map((item) => cenarioDaOc(item.targetId))
            .filter((cenario): cenario is Cenario => cenario !== undefined)
            .sort();
          expect(naLista, `lista de atenção · ${rotulo}`).toEqual(esperadas);

          const r11 = await getLatePurchaseOrdersReport(
            onOrderQuerySchema.parse({ supplierId: fornecedorId }),
            ALL_ROWS,
            agora,
          );
          const noR11 = Object.fromEntries(r11.rows.map((row) => [cenarioDaOc(row.purchaseOrderId), row.daysLate]));
          expect(noR11, `R-11 · ${rotulo}`).toEqual(instante.atrasadas);

          // O número do Estado atual é a mesma lista, contada.
          expect(contador[indice], `contador · ${rotulo}`).toBe(esperadas.length);
        }
      });
    });
  }
});
