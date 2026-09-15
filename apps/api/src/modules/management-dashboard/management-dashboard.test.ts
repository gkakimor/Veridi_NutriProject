import { existsSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { CustomerOrderStatus, PurchaseOrderStatus, UserRole } from "@prisma/client";
import type { ManagementDashboardDTO, ManagementPeriodPreset } from "@veridi/shared";
import {
  MANAGEMENT_DASHBOARD_ROLES,
  MANAGEMENT_PERIOD_PRESETS,
  MENSAGEM_DE_PERIODO_INVERTIDO,
  MENSAGEM_PERIODO_SEM_INICIO,
  PORTFOLIO_ORDER_STATUSES,
  USER_ROLES,
} from "@veridi/shared";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { managementDashboardQuerySchema } from "./management-dashboard.schemas.js";
import { montarPainelGerencial } from "./management-dashboard.service.js";

/**
 * Painel Gerencial — o read model (MANAGEMENT-DASHBOARD-V1-01).
 *
 * Faixa serial. O resultado do período se mede em anos sorteados longe do
 * relógio real, um por teste, onde nenhum outro arquivo escreve. A carteira e
 * os compromissos são do banco inteiro: cada teste monta o painel numa
 * transação `RepeatableRead` desfeita no fim, que antes tira do retrato os
 * Pedidos em carteira, as Expedições confirmadas e as OCs abertas que não são
 * dele. A igualdade fica exata e nada é gravado.
 *
 * As fixtures gravam direto os documentos como a emissão os deixa — o total
 * congelado do faturamento, o preço acordado da linha —, porque o que se prova
 * aqui é a LEITURA: que número o painel tira de cada documento.
 */

type App = ReturnType<typeof buildTestApp>;

const LONGO = 60_000;

const criados = {
  clientes: [] as string[],
  fornecedores: [] as string[],
  itens: [] as string[],
  produtos: [] as string[],
  pedidos: [] as string[],
  ocs: [] as string[],
};

/** Ano-base sorteado por rodada; cada teste leva o seu, três anos adiante do anterior. */
let proximoAno = 2300 + Math.floor(Math.random() * 400);
function anoDoTeste(): number {
  const ano = proximoAno;
  proximoAno += 3;
  return ano;
}

let sequencia = 0;
function marca(): string {
  sequencia += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}${sequencia}`.toUpperCase();
}

/** Meio-dia de São Paulo no dia — longe das bordas do dia comercial. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00.000Z`);
/** Como uma coluna de data civil guarda o dia. */
const marcador = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

const FUSO_ORIGINAL = process.env.TZ;

beforeAll(async () => {
  const prisma = getPrisma();
  for (const unidade of [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unidade.code }, update: {}, create: unidade });
  }
});

afterEach(() => {
  if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = FUSO_ORIGINAL;
});

afterAll(async () => {
  const prisma = getPrisma();
  const pedidos = criados.pedidos;
  if (pedidos.length > 0) {
    await prisma.billingLine.deleteMany({ where: { billing: { customerOrderId: { in: pedidos } } } });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.shipmentLine.deleteMany({ where: { shipment: { customerOrderId: { in: pedidos } } } });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.customerOrderDeliveryLine.deleteMany({ where: { delivery: { customerOrderId: { in: pedidos } } } });
    await prisma.customerOrderDelivery.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: pedidos } } },
    });
    await prisma.customerOrderReservation.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidos } } });
  }
  if (criados.ocs.length > 0) await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ocs } } });
  if (criados.produtos.length > 0) await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  if (criados.itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  if (criados.clientes.length > 0) await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  if (criados.fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  }
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** O que é do teste: tudo o mais sai do retrato. */
interface Cenario {
  pedidos: string[];
  expedicoes: string[];
  ocs: string[];
}

const novoCenario = (): Cenario => ({ pedidos: [], expedicoes: [], ocs: [] });

async function criarCliente(sufixo = "") {
  const m = marca();
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-MGT-${m}${sufixo}`, legalName: `Cliente Gerencial ${m}${sufixo}`, active: true },
  });
  criados.clientes.push(cliente.id);
  return cliente;
}

async function criarFornecedor() {
  const m = marca();
  const fornecedor = await getPrisma().supplier.create({
    data: { code: `FOR-MGT-${m}`, legalName: `Fornecedor Gerencial ${m}`, active: true },
  });
  criados.fornecedores.push(fornecedor.id);
  return fornecedor;
}

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT" = "FINISHED_PRODUCT") {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-MGT-${m}`,
      name: `Item Gerencial ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.itens.push(item.id);
  return item;
}

async function criarProduto(customerId: string, sufixo = "") {
  const item = await criarItem();
  const m = marca();
  const produto = await getPrisma().product.create({
    data: { code: `PROD-MGT-${m}${sufixo}`, name: `Produto Gerencial ${m}`, customerId, finishedProductItemId: item.id },
  });
  criados.produtos.push(produto.id);
  return { ...produto, item };
}

type Produto = Awaited<ReturnType<typeof criarProduto>>;
type Cliente = Awaited<ReturnType<typeof criarCliente>>;

interface LinhaDoPedido {
  produto: Produto;
  quantidade: string;
  unidade?: string;
  preco?: string | null;
}

async function criarPedido(
  cenario: Cenario,
  cliente: Cliente,
  opcoes: {
    status: CustomerOrderStatus;
    confirmadoEm?: Date | null;
    linhas?: LinhaDoPedido[];
    subtotalAcordado?: string | null;
    descontoAcordado?: string | null;
    totalAcordado?: string | null;
  },
) {
  const prisma = getPrisma();
  const linhas = opcoes.linhas ?? [];
  const pedido = await prisma.customerOrder.create({
    data: {
      code: `PED-MGT-${marca()}`,
      customerId: cliente.id,
      status: opcoes.status,
      confirmedAt: opcoes.confirmadoEm ?? null,
      customerCode: cliente.code,
      customerName: cliente.legalName,
      agreedSubtotalAmount: opcoes.subtotalAcordado ?? null,
      agreedDiscountPercent: opcoes.descontoAcordado ?? null,
      agreedTotalAmount: opcoes.totalAcordado ?? null,
      lines: {
        create: linhas.map((linha, indice) => ({
          productId: linha.produto.id,
          orderedQuantity: linha.quantidade,
          unitCode: linha.unidade ?? "kg",
          position: indice + 1,
          agreedUnitPrice: linha.preco ?? null,
          productCode: linha.produto.code,
          productName: linha.produto.name,
        })),
      },
      reservations: { create: [{ status: "ACTIVE" }] },
    },
    include: { lines: { orderBy: { position: "asc" } }, reservations: true },
  });
  criados.pedidos.push(pedido.id);
  cenario.pedidos.push(pedido.id);

  const reservaId = pedido.reservations[0]!.id;
  const reservadas: { id: string }[] = [];
  for (const [indice, linha] of pedido.lines.entries()) {
    const produto = linhas[indice]!.produto;
    reservadas.push(
      await prisma.customerOrderReservationLine.create({
        data: {
          reservationId: reservaId,
          customerOrderLineId: linha.id,
          productId: produto.id,
          itemId: produto.item.id,
          quantity: linha.orderedQuantity,
        },
      }),
    );
  }
  return {
    ...pedido,
    cliente,
    linhas: pedido.lines.map((linha, indice) => ({
      ...linha,
      produto: linhas[indice]!.produto,
      reservaId: reservadas[indice]!.id,
    })),
  };
}

type Pedido = Awaited<ReturnType<typeof criarPedido>>;

async function criarExpedicao(
  cenario: Cenario,
  pedido: Pedido,
  opcoes: {
    status: "DRAFT" | "CONFIRMED";
    linhas: { linha: number; quantidade: string; linhaDaEntrega?: string }[];
  },
) {
  const expedicao = await getPrisma().shipment.create({
    data: {
      code: `EXP-MGT-${marca()}`,
      customerOrderId: pedido.id,
      status: opcoes.status,
      confirmedAt: opcoes.status === "CONFIRMED" ? new Date() : null,
      lines: {
        create: opcoes.linhas.map((item, indice) => {
          const linha = pedido.linhas[item.linha]!;
          return {
            customerOrderLineId: linha.id,
            customerOrderReservationLineId: linha.reservaId,
            customerOrderDeliveryLineId: item.linhaDaEntrega ?? null,
            productId: linha.produto.id,
            itemId: linha.produto.item.id,
            quantity: item.quantidade,
            unitCode: linha.unitCode,
            position: indice + 1,
          };
        }),
      },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  cenario.expedicoes.push(expedicao.id);
  return { ...expedicao, pedido };
}

type Expedicao = Awaited<ReturnType<typeof criarExpedicao>>;

/** Faturamento como a emissão o deixa: preço por linha e os valores congelados no cabeçalho. */
async function faturar(
  expedicao: Expedicao,
  opcoes: {
    status?: "DRAFT" | "ISSUED" | "CANCELLED";
    emitidoEm?: Date | null;
    precos: (string | null)[];
    bruto?: string | null;
    desconto?: string | null;
    total: string | null;
  },
) {
  const { pedido } = expedicao;
  return getPrisma().billing.create({
    data: {
      code: `FAT-MGT-${marca()}`,
      customerOrderId: pedido.id,
      shipmentId: expedicao.id,
      status: opcoes.status ?? "ISSUED",
      issuedAt: opcoes.emitidoEm ?? null,
      grossAmount: opcoes.bruto ?? opcoes.total,
      discountAmount: opcoes.desconto ?? (opcoes.total === null ? null : "0.00"),
      commercialAdjustmentAmount: opcoes.total === null ? null : "0.00",
      totalAmount: opcoes.total,
      customerCode: pedido.cliente.code,
      customerName: pedido.cliente.legalName,
      lines: {
        create: expedicao.lines.map((linhaExpedida, indice) => {
          const linha = pedido.linhas.find((candidata) => candidata.id === linhaExpedida.customerOrderLineId)!;
          return {
            shipmentLineId: linhaExpedida.id,
            customerOrderLineId: linha.id,
            productId: linha.produto.id,
            itemId: linha.produto.item.id,
            productCode: linha.produto.code,
            productName: linha.produto.name,
            itemCode: linha.produto.item.code,
            itemName: linha.produto.item.name,
            quantity: linhaExpedida.quantity,
            unitCode: linhaExpedida.unitCode,
            agreedUnitPrice: linha.agreedUnitPrice,
            unitPrice: opcoes.precos[indice] ?? null,
            position: indice + 1,
          };
        }),
      },
    },
  });
}

/** Pedido expedido inteiro numa Expedição e faturado — o atalho do resultado do período. */
async function vendaFaturada(
  cenario: Cenario,
  cliente: Cliente,
  produto: Produto,
  opcoes: {
    quantidade: string;
    unidade?: string;
    preco: string | null;
    emitidoEm: Date;
    total: string | null;
    bruto?: string | null;
    desconto?: string | null;
  },
) {
  const pedido = await criarPedido(cenario, cliente, {
    status: "SHIPPED",
    confirmadoEm: opcoes.emitidoEm,
    linhas: [{ produto, quantidade: opcoes.quantidade, unidade: opcoes.unidade ?? "kg", preco: opcoes.preco }],
  });
  const expedicao = await criarExpedicao(cenario, pedido, {
    status: "CONFIRMED",
    linhas: [{ linha: 0, quantidade: opcoes.quantidade }],
  });
  return faturar(expedicao, {
    emitidoEm: opcoes.emitidoEm,
    precos: [opcoes.preco],
    total: opcoes.total,
    bruto: opcoes.bruto ?? opcoes.total,
    desconto: opcoes.desconto ?? null,
  });
}

async function criarOc(
  cenario: Cenario,
  fornecedor: Awaited<ReturnType<typeof criarFornecedor>>,
  opcoes: {
    status: PurchaseOrderStatus;
    pedidaEm: string;
    previstaPara?: string;
    linhas: { quantidade: string; preco: string | null }[];
  },
) {
  const itens: Awaited<ReturnType<typeof criarItem>>[] = [];
  for (let i = 0; i < opcoes.linhas.length; i += 1) itens.push(await criarItem("RAW_MATERIAL"));
  const oc = await getPrisma().purchaseOrder.create({
    data: {
      code: `OC-MGT-${marca()}`,
      supplierId: fornecedor.id,
      supplierCode: fornecedor.code,
      supplierName: fornecedor.legalName,
      orderDate: marcador(opcoes.pedidaEm),
      expectedDeliveryDate: opcoes.previstaPara ? marcador(opcoes.previstaPara) : null,
      status: opcoes.status,
      lines: {
        create: opcoes.linhas.map((linha, indice) => ({
          itemId: itens[indice]!.id,
          itemCode: itens[indice]!.code,
          itemName: itens[indice]!.name,
          unitCode: "kg",
          orderedQuantity: linha.quantidade,
          unitPrice: linha.preco,
        })),
      },
    },
  });
  criados.ocs.push(oc.id);
  cenario.ocs.push(oc.id);
  return oc;
}

async function criarEntrega(
  pedido: Pedido,
  opcoes: { sequencia: number; dia: string; linhas: { linha: number; quantidade: string }[]; cancelada?: boolean },
) {
  return getPrisma().customerOrderDelivery.create({
    data: {
      customerOrderId: pedido.id,
      sequence: opcoes.sequencia,
      scheduledDate: marcador(opcoes.dia),
      ...(opcoes.cancelada ? { cancelledAt: new Date(), cancelledBy: "Teste", cancelReason: "Teste" } : {}),
      lines: {
        create: opcoes.linhas.map((item) => ({
          customerOrderLineId: pedido.linhas[item.linha]!.id,
          quantity: item.quantidade,
        })),
      },
    },
    include: { lines: true },
  });
}

class Desfazer extends Error {}

/**
 * O painel no retrato do teste: numa transação `RepeatableRead` desfeita no
 * fim, os documentos abertos que não são do cenário saem da carteira e das
 * compras abertas antes da leitura.
 */
async function painelNoRetrato(
  cenario: Cenario,
  now: Date,
  periodo: { period?: ManagementPeriodPreset; dateFrom?: string; dateTo?: string } = {},
): Promise<ManagementDashboardDTO> {
  let painel: ManagementDashboardDTO | undefined;
  await getPrisma()
    .$transaction(
      async (tx) => {
        await tx.customerOrder.updateMany({
          where: { id: { notIn: cenario.pedidos }, status: { in: [...PORTFOLIO_ORDER_STATUSES] } },
          data: { status: "CANCELLED" },
        });
        await tx.shipment.updateMany({
          where: { id: { notIn: cenario.expedicoes }, status: "CONFIRMED" },
          data: { status: "CANCELLED" },
        });
        await tx.purchaseOrder.updateMany({
          where: { id: { notIn: cenario.ocs }, status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } },
          data: { status: "CANCELLED" },
        });
        painel = await montarPainelGerencial(
          tx,
          { period: periodo.period ?? "mes-atual", dateFrom: periodo.dateFrom, dateTo: periodo.dateTo },
          now,
        );
        throw new Desfazer();
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: LONGO },
    )
    .catch((erro: unknown) => {
      if (!(erro instanceof Desfazer)) throw erro;
    });
  return painel!;
}

const vazio = { count: 0, withValue: 0, amount: null };

/* ------------------------------------------------------------------ *
 * Rota e perfis
 * ------------------------------------------------------------------ */

describe("GET /management-dashboard — perfis e período", () => {
  let app: App;
  const cookies = new Map<UserRole, string>();

  beforeAll(async () => {
    for (const papel of USER_ROLES) cookies.set(papel, (await createAuthenticatedUser(papel)).cookie);
    app = buildTestApp();
    await app.ready();
  }, LONGO);

  afterAll(async () => {
    await app?.close();
  });

  const como = (papel: UserRole, url: string) =>
    app.inject({ method: "GET", url, headers: { cookie: cookies.get(papel)! } });
  const pode = (papel: UserRole) => (MANAGEMENT_DASHBOARD_ROLES as readonly string[]).includes(papel);

  it("a autoridade é ADMIN e COMMERCIAL, com perfis reais dos dois lados", () => {
    expect([...MANAGEMENT_DASHBOARD_ROLES].sort()).toEqual(["ADMIN", "COMMERCIAL"]);
    expect(USER_ROLES.filter((papel) => !pode(papel))).toEqual(["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"]);
  });

  it.each(USER_ROLES.map((papel) => ({ papel, esperado: pode(papel) ? 200 : 403 })))(
    "$papel recebe $esperado",
    async ({ papel, esperado }) => {
      const resposta = await como(papel, "/management-dashboard");
      expect(resposta.statusCode).toBe(esperado);
      if (esperado === 403) {
        // Recusa de perfil, com a frase de sempre — nunca um 500.
        expect(resposta.json()).toEqual({ error: "forbidden", message: "Seu perfil não permite esta ação." });
        return;
      }
      const painel = resposta.json() as ManagementDashboardDTO;
      expect(painel.period.preset).toBe("mes-atual");
      expect(painel.result.billed.current).toHaveProperty("amount");
    },
    LONGO,
  );

  it("o perfil é conferido antes do filtro: consulta inválida continua 403 para quem não pode", async () => {
    const resposta = await como("VIEWER", "/management-dashboard?period=custom&dateFrom=2026-09-21&dateTo=2026-09-20");
    expect(resposta.statusCode).toBe(403);
  });

  it("sem sessão, 401", async () => {
    const semSessao = buildApp();
    await semSessao.ready();
    try {
      const resposta = await semSessao.inject({ method: "GET", url: "/management-dashboard" });
      expect(resposta.statusCode).toBe(401);
    } finally {
      await semSessao.close();
    }
  });

  it("Personalizado exige as duas datas, em dia, e na ordem", async () => {
    const semInicio = await como("ADMIN", "/management-dashboard?period=custom&dateTo=2026-09-20");
    expect(semInicio.statusCode).toBe(400);
    expect(semInicio.json().issues).toEqual([{ path: "dateFrom", message: MENSAGEM_PERIODO_SEM_INICIO }]);

    const invertido = await como("COMMERCIAL", "/management-dashboard?period=custom&dateFrom=2026-09-21&dateTo=2026-09-20");
    expect(invertido.statusCode).toBe(400);
    expect(invertido.json().issues).toEqual([{ path: "dateFrom", message: MENSAGEM_DE_PERIODO_INVERTIDO }]);

    const instante = await como(
      "ADMIN",
      "/management-dashboard?period=custom&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-02",
    );
    expect(instante.statusCode).toBe(400);

    expect((await como("ADMIN", "/management-dashboard?period=ytd")).statusCode).toBe(400);
  });

  it("Personalizado válido responde com o período e o equivalente anterior", async () => {
    const resposta = await como("ADMIN", "/management-dashboard?period=custom&dateFrom=2026-09-01&dateTo=2026-09-15");
    expect(resposta.statusCode).toBe(200);
    expect((resposta.json() as ManagementDashboardDTO).period).toEqual({
      preset: "custom",
      current: { from: "2026-09-01", to: "2026-09-15" },
      previous: { from: "2026-08-17", to: "2026-08-31" },
    });
  }, LONGO);

  it("o schema aceita exatamente os atalhos do contrato", () => {
    for (const period of MANAGEMENT_PERIOD_PRESETS) {
      const datas = period === "custom" ? { dateFrom: "2026-09-01", dateTo: "2026-09-02" } : {};
      expect(managementDashboardQuerySchema.safeParse({ period, ...datas }).success).toBe(true);
    }
    expect(managementDashboardQuerySchema.safeParse({}).data?.period).toBe("mes-atual");
    for (const period of ["hoje", "30d", "todos", "ytd"]) {
      expect(managementDashboardQuerySchema.safeParse({ period }).success).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Estrutura
 * ------------------------------------------------------------------ */

describe("estrutura do read model", () => {
  const servico = readFileSync(new URL("./management-dashboard.service.ts", import.meta.url), "utf8");
  const rota = readFileSync(new URL("./management-dashboard.routes.ts", import.meta.url), "utf8");

  it("um relógio por requisição, lido na rota; um retrato RepeatableRead", () => {
    expect(rota.match(/new Date\(/g)).toHaveLength(1);
    expect(rota.indexOf("requireRole(")).toBeLessThan(rota.indexOf("safeParse("));
    expect(servico).not.toMatch(/new Date\(|Date\.now\(/);
    expect(servico).toContain("TransactionIsolationLevel.RepeatableRead");
  });

  it("nenhum dinheiro multiplicado à mão: o valor faturado vem da implementação canônica, e só dela", () => {
    expect(servico).not.toMatch(/\.times\(/);
    expect(servico).toContain('import { resumirValorFaturado, valorDoFaturamento } from "../billings/billed-value.js";');
    // A ponte provisória sobre `totalAmount` saiu no rebase sobre BILLED-VALUE-CANONICAL-01.
    expect(existsSync(new URL("./faturado-provisorio.ts", import.meta.url))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Sem dados
 * ------------------------------------------------------------------ */

describe("base vazia", () => {
  it("nada é zero inventado: contagens zeradas, valores nulos, listas vazias", async () => {
    const ano = anoDoTeste();
    const painel = await painelNoRetrato(novoCenario(), meioDia(`${ano}-11-05`));

    expect(painel.today).toBe(`${ano}-11-05`);
    expect(painel.period).toEqual({
      preset: "mes-atual",
      current: { from: `${ano}-11-01`, to: `${ano}-11-05` },
      previous: { from: `${ano}-10-01`, to: `${ano}-10-05` },
    });
    for (const indicador of [painel.result.billed, painel.result.confirmedOrders, painel.result.contractedPurchases]) {
      expect(indicador).toEqual({ current: vazio, previous: vazio, variationPercent: null, withoutValue: [] });
    }
    expect(painel.result.billedCustomers).toEqual({ current: 0, previous: 0, variationPercent: null });
    expect(painel.position).toEqual({ toShip: { ...vazio, withoutValue: [] }, toBill: { ...vazio, withoutValue: [] } });
    expect(painel.trend.granularity).toBe("day");
    expect(painel.trend.buckets).toHaveLength(5);
    expect(painel.trend.buckets.every((balde) => balde.count === 0 && balde.amount === null)).toBe(true);
    expect(painel.rankings).toEqual({
      customers: { rows: [], excluded: [], excludedTotal: 0 },
      products: { rows: [], excluded: [], excludedTotal: 0 },
    });
    expect(painel.commitments).toEqual({
      window: { from: `${ano}-11-05`, to: `${ano}-12-04` },
      scheduledDeliveries: { ...vazio, items: [] },
      lateDeliveries: { count: 0, items: [] },
      expectedPurchases: { count: 0, items: [] },
    });
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Faturado
 * ------------------------------------------------------------------ */

describe("Faturado — o valor do documento emitido (D1)", () => {
  it("soma o total congelado, com desconto; rascunho, cancelado e fora da janela não entram; tendência e ranking fecham com o cartão", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const clienteA = await criarCliente("-A");
    const clienteB = await criarCliente("-B");
    const produtoA = await criarProduto(clienteA.id);
    const produtoB = await criarProduto(clienteB.id);

    // Sem desconto: 100 kg × R$ 3,00 = R$ 300,00.
    await vendaFaturada(cenario, clienteA, produtoA, {
      quantidade: "100",
      preco: "3",
      emitidoEm: meioDia(`${ano}-09-10`),
      total: "300.00",
    });
    // Com 10% de desconto: as linhas somam R$ 1.000,00, o documento vale R$ 900,00.
    await vendaFaturada(cenario, clienteB, produtoB, {
      quantidade: "100",
      preco: "10",
      emitidoEm: meioDia(`${ano}-09-12`),
      bruto: "1000.00",
      desconto: "100.00",
      total: "900.00",
    });

    // Rascunho e cancelado nunca faturam, mesmo com data dentro da janela.
    const pedidoRascunho = await criarPedido(cenario, clienteB, {
      status: "SHIPPED",
      linhas: [{ produto: produtoB, quantidade: "50", preco: "2" }],
    });
    await faturar(await criarExpedicao(cenario, pedidoRascunho, { status: "CONFIRMED", linhas: [{ linha: 0, quantidade: "50" }] }), {
      status: "DRAFT",
      emitidoEm: meioDia(`${ano}-09-11`),
      precos: ["2"],
      total: "100.00",
    });
    const pedidoCancelado = await criarPedido(cenario, clienteA, {
      status: "SHIPPED",
      linhas: [{ produto: produtoA, quantidade: "10", preco: "2" }],
    });
    await faturar(await criarExpedicao(cenario, pedidoCancelado, { status: "CONFIRMED", linhas: [{ linha: 0, quantidade: "10" }] }), {
      status: "CANCELLED",
      emitidoEm: meioDia(`${ano}-09-11`),
      precos: ["2"],
      total: "20.00",
    });
    // 16/09 00:00 em São Paulo já é amanhã.
    await vendaFaturada(cenario, clienteA, produtoA, {
      quantidade: "5",
      preco: "10",
      emitidoEm: new Date(`${ano}-09-16T03:00:00.000Z`),
      total: "50.00",
    });
    // Período anterior (01/08 a 15/08): um documento do cliente A.
    await vendaFaturada(cenario, clienteA, produtoA, {
      quantidade: "1",
      preco: "10",
      emitidoEm: meioDia(`${ano}-08-15`),
      total: "10.00",
    });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-09-15`));
    const { billed, billedCustomers } = painel.result;

    // Nunca R$ 1.300,00: o documento com desconto vale o que foi congelado nele.
    expect(billed.current).toEqual({ count: 2, withValue: 2, amount: "1200.00" });
    expect(billed.previous).toEqual({ count: 1, withValue: 1, amount: "10.00" });
    expect(billed.variationPercent).toBe("11900.0");
    expect(billed.withoutValue).toEqual([]);
    expect(billedCustomers).toEqual({ current: 2, previous: 1, variationPercent: "100.0" });

    const comDocumento = painel.trend.buckets.filter((balde) => balde.count > 0);
    expect(comDocumento).toEqual([
      { from: `${ano}-09-10`, to: `${ano}-09-10`, count: 1, withValue: 1, amount: "300.00" },
      { from: `${ano}-09-12`, to: `${ano}-09-12`, count: 1, withValue: 1, amount: "900.00" },
    ]);
    expect(painel.rankings.customers.rows.map(({ customerId, amount, billingCount }) => ({ customerId, amount, billingCount }))).toEqual([
      { customerId: clienteB.id, amount: "900.00", billingCount: 1 },
      { customerId: clienteA.id, amount: "300.00", billingCount: 1 },
    ]);
    expect(painel.rankings.customers.rows[0]).toMatchObject({ code: clienteB.code, name: clienteB.legalName });

    // Produtos pelo valor das linhas, ANTES do desconto: a soma do ranking não é o Faturado.
    expect(painel.rankings.products.rows.map(({ productId, amount, quantities }) => ({ productId, amount, quantities }))).toEqual([
      { productId: produtoB.id, amount: "1000.00", quantities: [{ unitCode: "kg", quantity: "100" }] },
      { productId: produtoA.id, amount: "300.00", quantities: [{ unitCode: "kg", quantity: "100" }] },
    ]);
    expect(painel.rankings.products.rows[0]?.customerId).toBe(clienteB.id);
  }, LONGO);

  it("emitido legado sem total congelado vale a soma das linhas arredondadas — no cartão, na barra e no ranking", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente("-L");
    const produto = await criarProduto(cliente.id);
    const outroProduto = await criarProduto(cliente.id);

    // Duas linhas de 1 × 0,1250 sem total congelado: o documento vale 0,13 + 0,13 = R$ 0,26, não R$ 0,25 nem "sem valor".
    const legado = await criarPedido(cenario, cliente, {
      status: "SHIPPED",
      confirmadoEm: meioDia(`${ano}-03-05`),
      linhas: [
        { produto, quantidade: "1", preco: "0.125" },
        { produto: outroProduto, quantidade: "1", preco: "0.125" },
      ],
    });
    const expedicaoLegada = await criarExpedicao(cenario, legado, {
      status: "CONFIRMED",
      linhas: [
        { linha: 0, quantidade: "1" },
        { linha: 1, quantidade: "1" },
      ],
    });
    await faturar(expedicaoLegada, { emitidoEm: meioDia(`${ano}-03-05`), precos: ["0.125", "0.125"], total: null });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "2", preco: "10", emitidoEm: meioDia(`${ano}-03-06`), total: "20.00" });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-03-10`));

    expect(painel.result.billed.current).toEqual({ count: 2, withValue: 2, amount: "20.26" });
    expect(painel.result.billed.withoutValue).toEqual([]);
    expect(painel.trend.buckets.find((balde) => balde.from === `${ano}-03-05`)).toMatchObject({
      count: 1,
      withValue: 1,
      amount: "0.26",
    });
    expect(painel.rankings.customers.rows).toEqual([
      { customerId: cliente.id, code: cliente.code, name: cliente.legalName, amount: "20.26", billingCount: 2 },
    ]);
  }, LONGO);

  it("documento emitido sem valor deixa o Faturado incompleto, é citado, e o cliente sai do ranking com o nome", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const clienteC = await criarCliente("-C");
    const clienteD = await criarCliente("-D");
    const produtoC = await criarProduto(clienteC.id);
    const produtoD = await criarProduto(clienteD.id);

    await vendaFaturada(cenario, clienteC, produtoC, { quantidade: "2", preco: "100", emitidoEm: meioDia(`${ano}-05-10`), total: "200.00" });
    const semPreco = await vendaFaturada(cenario, clienteC, produtoC, {
      quantidade: "3",
      preco: null,
      emitidoEm: meioDia(`${ano}-05-10`),
      total: null,
    });
    await vendaFaturada(cenario, clienteD, produtoD, { quantidade: "8", preco: "10", emitidoEm: meioDia(`${ano}-05-12`), total: "80.00" });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-05-20`));

    // Nunca R$ 280,00 com cara de total.
    expect(painel.result.billed.current).toEqual({ count: 3, withValue: 2, amount: null });
    expect(painel.result.billed.withoutValue).toEqual([{ id: semPreco.id, code: semPreco.code }]);
    expect(painel.result.billed.variationPercent).toBeNull();

    const dia10 = painel.trend.buckets.find((balde) => balde.from === `${ano}-05-10`);
    expect(dia10).toEqual({ from: `${ano}-05-10`, to: `${ano}-05-10`, count: 2, withValue: 1, amount: null });

    expect(painel.rankings.customers.rows.map((linha) => linha.customerId)).toEqual([clienteD.id]);
    expect(painel.rankings.customers.excluded).toEqual([
      { customerId: clienteC.id, code: clienteC.code, name: clienteC.legalName, billingCount: 2, withoutValue: 1 },
    ]);
    expect(painel.rankings.customers.excludedTotal).toBe(1);
    expect(painel.rankings.products.rows.map((linha) => linha.productId)).toEqual([produtoD.id]);
    expect(painel.rankings.products.excluded).toEqual([
      { productId: produtoC.id, code: produtoC.code, name: produtoC.name, customerId: clienteC.id, linesWithoutPrice: 1 },
    ]);
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Pedidos confirmados e compras contratadas
 * ------------------------------------------------------------------ */

describe("Pedidos confirmados", () => {
  it("por confirmedAt e pelo total acordado; rascunho e cancelado fora; Pedido direto deixa o valor incompleto", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();

    await criarPedido(cenario, cliente, { status: "IN_FULFILLMENT", confirmadoEm: meioDia(`${ano}-04-02`), totalAcordado: "450.00" });
    await criarPedido(cenario, cliente, { status: "SHIPPED", confirmadoEm: meioDia(`${ano}-04-10`), totalAcordado: "100.00" });
    await criarPedido(cenario, cliente, { status: "DRAFT", confirmadoEm: meioDia(`${ano}-04-03`), totalAcordado: "999.00" });
    await criarPedido(cenario, cliente, { status: "CANCELLED", confirmadoEm: meioDia(`${ano}-04-05`), totalAcordado: "777.00" });
    // 16/04 00:00 em São Paulo: fora do período que termina em 15/04.
    await criarPedido(cenario, cliente, {
      status: "CONFIRMED",
      confirmadoEm: new Date(`${ano}-04-16T03:00:00.000Z`),
      totalAcordado: "123.00",
    });
    await criarPedido(cenario, cliente, { status: "CONFIRMED", confirmadoEm: meioDia(`${ano}-03-10`), totalAcordado: "500.00" });

    const completo = await painelNoRetrato(cenario, meioDia(`${ano}-04-15`));
    expect(completo.result.confirmedOrders).toEqual({
      current: { count: 2, withValue: 2, amount: "550.00" },
      previous: { count: 1, withValue: 1, amount: "500.00" },
      variationPercent: "10.0",
      withoutValue: [],
    });

    const direto = await criarPedido(cenario, cliente, { status: "CONFIRMED", confirmadoEm: meioDia(`${ano}-04-08`) });
    const incompleto = await painelNoRetrato(cenario, meioDia(`${ano}-04-15`));
    expect(incompleto.result.confirmedOrders).toEqual({
      current: { count: 3, withValue: 2, amount: null },
      previous: { count: 1, withValue: 1, amount: "500.00" },
      variationPercent: null,
      withoutValue: [{ id: direto.id, code: direto.code }],
    });
  }, LONGO);
});

describe("Compras contratadas", () => {
  it("por orderDate em dia civil e pelo total da OC (§61); rascunho e cancelada fora; preço faltando deixa incompleto", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const fornecedor = await criarFornecedor();

    // 40,53 + 0,13 + 0,13 = R$ 40,79 — a soma das linhas impressas, não R$ 40,78.
    await criarOc(cenario, fornecedor, {
      status: "ORDERED",
      pedidaEm: `${ano}-06-01`,
      linhas: [
        { quantidade: "10", preco: "4.05318764" },
        { quantidade: "1", preco: "0.125" },
        { quantidade: "5", preco: "0.025" },
      ],
    });
    await criarOc(cenario, fornecedor, { status: "RECEIVED", pedidaEm: `${ano}-06-30`, linhas: [{ quantidade: "2", preco: "5" }] });
    await criarOc(cenario, fornecedor, { status: "DRAFT", pedidaEm: `${ano}-06-15`, linhas: [{ quantidade: "1", preco: "1000" }] });
    await criarOc(cenario, fornecedor, { status: "CANCELLED", pedidaEm: `${ano}-06-15`, linhas: [{ quantidade: "1", preco: "1000" }] });
    // O dia seguinte ao período, e o período anterior (01/05 a 30/05).
    await criarOc(cenario, fornecedor, {
      status: "PARTIALLY_RECEIVED",
      pedidaEm: `${ano}-07-01`,
      linhas: [{ quantidade: "1", preco: "1000" }],
    });
    await criarOc(cenario, fornecedor, { status: "ORDERED", pedidaEm: `${ano}-05-30`, linhas: [{ quantidade: "1", preco: "25" }] });

    const completo = await painelNoRetrato(cenario, meioDia(`${ano}-06-30`));
    expect(completo.result.contractedPurchases).toEqual({
      current: { count: 2, withValue: 2, amount: "50.79" },
      previous: { count: 1, withValue: 1, amount: "25.00" },
      variationPercent: "103.2",
      withoutValue: [],
    });

    const semPreco = await criarOc(cenario, fornecedor, {
      status: "ORDERED",
      pedidaEm: `${ano}-06-10`,
      linhas: [
        { quantidade: "1", preco: "10" },
        { quantidade: "1", preco: null },
      ],
    });
    const incompleto = await painelNoRetrato(cenario, meioDia(`${ano}-06-30`));
    expect(incompleto.result.contractedPurchases.current).toEqual({ count: 3, withValue: 2, amount: null });
    expect(incompleto.result.contractedPurchases.withoutValue).toEqual([{ id: semPreco.id, code: semPreco.code }]);
    expect(incompleto.result.contractedPurchases.variationPercent).toBeNull();
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Posição atual
 * ------------------------------------------------------------------ */

describe("Posição atual — preço acordado, antes do desconto (D5)", () => {
  it("A expedir, A faturar e Faturado dividem as quantidades sem contar duas vezes", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produtoKg = await criarProduto(cliente.id);
    const produtoUn = await criarProduto(cliente.id);

    // Pedido de 10 kg a R$ 12,50 e 3 un a R$ 0,1250, com 10% de desconto no cabeçalho.
    const pedido = await criarPedido(cenario, cliente, {
      status: "PARTIALLY_SHIPPED",
      confirmadoEm: meioDia(`${ano}-02-01`),
      subtotalAcordado: "125.38",
      descontoAcordado: "10",
      totalAcordado: "112.84",
      linhas: [
        { produto: produtoKg, quantidade: "10", preco: "12.5" },
        { produto: produtoUn, quantidade: "3", unidade: "un", preco: "0.125" },
      ],
    });
    // 4 kg expedidos e faturados: saem da carteira e de A faturar.
    const faturada = await criarExpedicao(cenario, pedido, { status: "CONFIRMED", linhas: [{ linha: 0, quantidade: "4" }] });
    await faturar(faturada, { emitidoEm: meioDia(`${ano}-02-05`), precos: ["12.5"], bruto: "50.00", desconto: "5.00", total: "45.00" });
    // 2 kg + 1 un expedidos sem faturamento: 25,00 + 0,13 = R$ 25,13.
    await criarExpedicao(cenario, pedido, {
      status: "CONFIRMED",
      linhas: [
        { linha: 0, quantidade: "2" },
        { linha: 1, quantidade: "1" },
      ],
    });
    // 1 kg expedido com faturamento em RASCUNHO: continua a faturar, R$ 12,50.
    const comRascunho = await criarExpedicao(cenario, pedido, { status: "CONFIRMED", linhas: [{ linha: 0, quantidade: "1" }] });
    await faturar(comRascunho, { status: "DRAFT", precos: ["12.5"], total: null });
    // Separação em rascunho não expediu nada.
    await criarExpedicao(cenario, pedido, { status: "DRAFT", linhas: [{ linha: 0, quantidade: "1" }] });

    // Expedido inteiro e faturado: nem carteira nem a faturar.
    const expedido = await criarPedido(cenario, cliente, {
      status: "SHIPPED",
      linhas: [{ produto: produtoKg, quantidade: "5", preco: "2" }],
    });
    await faturar(await criarExpedicao(cenario, expedido, { status: "CONFIRMED", linhas: [{ linha: 0, quantidade: "5" }] }), {
      emitidoEm: meioDia(`${ano}-02-06`),
      precos: ["2"],
      total: "10.00",
    });
    await criarPedido(cenario, cliente, { status: "DRAFT", linhas: [{ produto: produtoKg, quantidade: "7", preco: "1" }] });
    await criarPedido(cenario, cliente, { status: "CANCELLED", linhas: [{ produto: produtoKg, quantidade: "8", preco: "1" }] });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-02-10`));

    // Saldo: 10 − (4 + 2 + 1) = 3 kg × 12,50 = 37,50; 3 − 1 = 2 un × 0,125 = 0,25. Antes do desconto.
    expect(painel.position.toShip).toEqual({ count: 1, withValue: 1, amount: "37.75", withoutValue: [] });
    // As duas Expedições sem faturamento emitido: 25,13 + 12,50.
    expect(painel.position.toBill).toEqual({ count: 2, withValue: 2, amount: "37.63", withoutValue: [] });
  }, LONGO);

  it("Pedido direto sem preço acordado deixa A expedir e A faturar incompletos, e é citado", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);

    await criarPedido(cenario, cliente, {
      status: "CONFIRMED",
      confirmadoEm: meioDia(`${ano}-03-01`),
      linhas: [{ produto, quantidade: "4", preco: "10" }],
    });
    const direto = await criarPedido(cenario, cliente, {
      status: "CONFIRMED",
      confirmadoEm: meioDia(`${ano}-03-02`),
      linhas: [{ produto, quantidade: "5", preco: null }],
    });
    const diretoParcial = await criarPedido(cenario, cliente, {
      status: "PARTIALLY_SHIPPED",
      confirmadoEm: meioDia(`${ano}-03-03`),
      linhas: [{ produto, quantidade: "4", preco: null }],
    });
    const expedicaoSemPreco = await criarExpedicao(cenario, diretoParcial, {
      status: "CONFIRMED",
      linhas: [{ linha: 0, quantidade: "2" }],
    });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-03-10`));
    expect(painel.position.toShip).toEqual({
      count: 3,
      withValue: 1,
      amount: null,
      withoutValue: [
        { id: direto.id, code: direto.code },
        { id: diretoParcial.id, code: diretoParcial.code },
      ],
    });
    expect(painel.position.toBill).toEqual({
      count: 1,
      withValue: 0,
      amount: null,
      withoutValue: [{ id: expedicaoSemPreco.id, code: expedicaoSemPreco.code }],
    });
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Comparação, Acumulado no ano e fuso
 * ------------------------------------------------------------------ */

describe("comparação com o período equivalente", () => {
  it("Mês atual compara com o mesmo trecho do mês anterior", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);

    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "120450", emitidoEm: meioDia(`${ano}-09-10`), total: "120450.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "111300", emitidoEm: meioDia(`${ano}-08-10`), total: "111300.00" });
    // 16/08 fica fora do anterior (01/08 a 15/08).
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "5000", emitidoEm: meioDia(`${ano}-08-16`), total: "5000.00" });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-09-15`));
    expect(painel.result.billed.current.amount).toBe("120450.00");
    expect(painel.result.billed.previous.amount).toBe("111300.00");
    expect(painel.result.billed.variationPercent).toBe("8.2");
  }, LONGO);

  it("sem base de comparação: anterior sem faturamento, ou anterior incompleto", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);

    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "100", emitidoEm: meioDia(`${ano}-01-10`), total: "100.00" });
    const semAnterior = await painelNoRetrato(cenario, meioDia(`${ano}-01-20`));
    expect(semAnterior.period.previous).toEqual({ from: `${ano - 1}-12-01`, to: `${ano - 1}-12-20` });
    expect(semAnterior.result.billed.previous).toEqual(vazio);
    expect(semAnterior.result.billed.variationPercent).toBeNull();

    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: null, emitidoEm: meioDia(`${ano - 1}-12-05`), total: null });
    const anteriorIncompleto = await painelNoRetrato(cenario, meioDia(`${ano}-01-20`));
    expect(anteriorIncompleto.result.billed.previous).toEqual({ count: 1, withValue: 0, amount: null });
    expect(anteriorIncompleto.result.billed.variationPercent).toBeNull();
  }, LONGO);

  it("Acumulado no ano: de 1º de janeiro no dia comercial, contra o mesmo intervalo do ano anterior, em meses", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);

    // 01/01 00:00 em São Paulo entra; 31/12 23:59:59.999 do ano anterior não.
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "10", emitidoEm: new Date(`${ano}-01-01T03:00:00.000Z`), total: "10.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "1000", emitidoEm: new Date(`${ano}-01-01T02:59:59.999Z`), total: "1000.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "40", emitidoEm: meioDia(`${ano - 1}-03-10`), total: "40.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "999", emitidoEm: meioDia(`${ano - 1}-03-11`), total: "999.00" });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-03-10`), { period: "acumulado-ano" });
    expect(painel.period).toEqual({
      preset: "acumulado-ano",
      current: { from: `${ano}-01-01`, to: `${ano}-03-10` },
      previous: { from: `${ano - 1}-01-01`, to: `${ano - 1}-03-10` },
    });
    expect(painel.result.billed.current).toEqual({ count: 1, withValue: 1, amount: "10.00" });
    expect(painel.result.billed.previous).toEqual({ count: 1, withValue: 1, amount: "40.00" });
    expect(painel.result.billed.variationPercent).toBe("-75.0");
    expect(painel.trend.granularity).toBe("month");
    expect(painel.trend.buckets.map(({ from, to, amount }) => ({ from, to, amount }))).toEqual([
      { from: `${ano}-01-01`, to: `${ano}-01-31`, amount: "10.00" },
      { from: `${ano}-02-01`, to: `${ano}-02-${ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0) ? "29" : "28"}`, amount: null },
      { from: `${ano}-03-01`, to: `${ano}-03-10`, amount: null },
    ]);
  }, LONGO);

  it("o dia é o de São Paulo: 23:30 de 30/09 ainda é setembro, com a máquina em qualquer fuso", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);

    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "1", emitidoEm: new Date(`${ano}-09-01T03:00:00.000Z`), total: "1.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "2", emitidoEm: new Date(`${ano}-09-01T02:59:59.999Z`), total: "2.00" });
    await vendaFaturada(cenario, cliente, produto, { quantidade: "1", preco: "4", emitidoEm: new Date(`${ano}-10-01T02:00:00.000Z`), total: "4.00" });

    const fusos: [string, number][] = [
      ["UTC", 0],
      ["Etc/GMT+7", 420],
      ["America/Sao_Paulo", 180],
    ];
    for (const [fuso, deslocamento] of fusos) {
      process.env.TZ = fuso;
      expect(new Date(`${ano}-06-12T12:00:00Z`).getTimezoneOffset()).toBe(deslocamento);

      const painel = await painelNoRetrato(cenario, new Date(`${ano}-10-01T02:30:00.000Z`));
      expect(painel.today).toBe(`${ano}-09-30`);
      expect(painel.period.current).toEqual({ from: `${ano}-09-01`, to: `${ano}-09-30` });
      expect(painel.result.billed.current).toEqual({ count: 2, withValue: 2, amount: "5.00" });
      const comDocumento = painel.trend.buckets.filter((balde) => balde.count > 0).map(({ from, amount }) => ({ from, amount }));
      expect(comDocumento).toEqual([
        { from: `${ano}-09-01`, amount: "1.00" },
        { from: `${ano}-09-30`, amount: "4.00" },
      ]);
    }
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Rankings
 * ------------------------------------------------------------------ */

describe("rankings", () => {
  it("produto em kg e em un: valor somado, quantidade nunca; empate pelo código; incompletos nomeados", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const clienteG = await criarCliente("-G");
    const clienteH = await criarCliente("-H");
    const clienteI = await criarCliente("-I");
    const clienteK = await criarCliente("-K");
    const produtoX = await criarProduto(clienteG.id, "-X");
    const produtoY = await criarProduto(clienteH.id, "-Y");
    const produtoZ = await criarProduto(clienteI.id, "-Z");
    const produtoK = await criarProduto(clienteK.id, "-K");
    const dia = meioDia(`${ano}-07-10`);

    await vendaFaturada(cenario, clienteG, produtoX, { quantidade: "10", preco: "2", emitidoEm: dia, total: "20.00" });
    // 3 × 1,005 = 3,015 → R$ 3,02 na linha.
    await vendaFaturada(cenario, clienteG, produtoX, { quantidade: "3", unidade: "un", preco: "1.005", emitidoEm: dia, total: "3.02" });
    await vendaFaturada(cenario, clienteH, produtoY, { quantidade: "1", unidade: "un", preco: "100", emitidoEm: dia, bruto: "100.00", desconto: "10.00", total: "90.00" });
    await vendaFaturada(cenario, clienteI, produtoZ, { quantidade: "2", preco: null, emitidoEm: dia, total: null });
    await vendaFaturada(cenario, clienteK, produtoK, { quantidade: "1", preco: "23.02", emitidoEm: dia, total: "23.02" });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-07-20`));

    // O cartão fica incompleto; o ranking mostra só quem está completo e nomeia quem ficou fora.
    expect(painel.result.billed.current).toEqual({ count: 5, withValue: 4, amount: null });

    // Empate em valor: o código decide, sempre na mesma ordem.
    const porCodigo = <T extends { code: string }>(a: T, b: T) => (a.code < b.code ? -1 : 1);
    const clientesEmpatados = [
      { cliente: clienteG, billingCount: 2 },
      { cliente: clienteK, billingCount: 1 },
    ].sort((a, b) => porCodigo(a.cliente, b.cliente));
    expect(painel.rankings.customers.rows.map(({ customerId, amount, billingCount }) => ({ customerId, amount, billingCount }))).toEqual([
      { customerId: clienteH.id, amount: "90.00", billingCount: 1 },
      ...clientesEmpatados.map(({ cliente, billingCount }) => ({ customerId: cliente.id, amount: "23.02", billingCount })),
    ]);
    expect(painel.rankings.customers.excluded.map((cliente) => cliente.customerId)).toEqual([clienteI.id]);

    const quantidades = new Map([
      [produtoK.id, [{ unitCode: "kg", quantity: "1" }]],
      // Duas unidades, duas quantidades — nunca "13".
      [
        produtoX.id,
        [
          { unitCode: "kg", quantity: "10" },
          { unitCode: "un", quantity: "3" },
        ],
      ],
    ]);
    const produtosEmpatados = [produtoK, produtoX].sort(porCodigo);
    expect(painel.rankings.products.rows.map(({ productId, amount, quantities }) => ({ productId, amount, quantities }))).toEqual([
      { productId: produtoY.id, amount: "100.00", quantities: [{ unitCode: "un", quantity: "1" }] },
      ...produtosEmpatados.map((produto) => ({
        productId: produto.id,
        amount: "23.02",
        quantities: quantidades.get(produto.id),
      })),
    ]);
    expect(painel.rankings.products.excluded).toEqual([
      { productId: produtoZ.id, code: produtoZ.code, name: produtoZ.name, customerId: clienteI.id, linesWithoutPrice: 1 },
    ]);
  }, LONGO);
});

/* ------------------------------------------------------------------ *
 * Próximos compromissos
 * ------------------------------------------------------------------ */

describe("próximos compromissos — hoje e os 29 dias seguintes", () => {
  it("entregas programadas com saldo, atrasadas e compras esperadas, só o que está registrado", async () => {
    const ano = anoDoTeste();
    const cenario = novoCenario();
    const cliente = await criarCliente();
    const produto = await criarProduto(cliente.id);
    const fornecedor = await criarFornecedor();

    const pedido = await criarPedido(cenario, cliente, {
      status: "CONFIRMED",
      confirmadoEm: meioDia(`${ano}-06-01`),
      linhas: [{ produto, quantidade: "10", preco: "5" }],
    });
    const hoje = await criarEntrega(pedido, { sequencia: 1, dia: `${ano}-06-10`, linhas: [{ linha: 0, quantidade: "1" }] });
    const dia20 = await criarEntrega(pedido, { sequencia: 2, dia: `${ano}-06-20`, linhas: [{ linha: 0, quantidade: "3" }] });
    const ultimoDia = await criarEntrega(pedido, { sequencia: 3, dia: `${ano}-07-09`, linhas: [{ linha: 0, quantidade: "1" }] });
    const atrasada = await criarEntrega(pedido, { sequencia: 4, dia: `${ano}-06-05`, linhas: [{ linha: 0, quantidade: "2" }] });
    await criarEntrega(pedido, { sequencia: 5, dia: `${ano}-06-25`, linhas: [{ linha: 0, quantidade: "1" }], cancelada: true });
    await criarEntrega(pedido, { sequencia: 6, dia: `${ano}-07-10`, linhas: [{ linha: 0, quantidade: "1" }] });
    const atendida = await criarEntrega(pedido, { sequencia: 7, dia: `${ano}-06-12`, linhas: [{ linha: 0, quantidade: "1" }] });
    await criarExpedicao(cenario, pedido, {
      status: "CONFIRMED",
      linhas: [{ linha: 0, quantidade: "1", linhaDaEntrega: atendida.lines[0]!.id }],
    });
    // Separação em rascunho não atende a entrega do último dia.
    await criarExpedicao(cenario, pedido, {
      status: "DRAFT",
      linhas: [{ linha: 0, quantidade: "1", linhaDaEntrega: ultimoDia.lines[0]!.id }],
    });

    // Pedido cancelado e Pedido expedido não têm compromisso.
    const cancelado = await criarPedido(cenario, cliente, { status: "CANCELLED", linhas: [{ produto, quantidade: "2", preco: "5" }] });
    await criarEntrega(cancelado, { sequencia: 1, dia: `${ano}-06-15`, linhas: [{ linha: 0, quantidade: "2" }] });
    const expedido = await criarPedido(cenario, cliente, { status: "SHIPPED", linhas: [{ produto, quantidade: "2", preco: "5" }] });
    await criarEntrega(expedido, { sequencia: 1, dia: `${ano}-06-15`, linhas: [{ linha: 0, quantidade: "2" }] });

    const ocHoje = await criarOc(cenario, fornecedor, { status: "ORDERED", pedidaEm: `${ano}-05-01`, previstaPara: `${ano}-06-10`, linhas: [{ quantidade: "1", preco: "1" }] });
    const ocUltimoDia = await criarOc(cenario, fornecedor, {
      status: "PARTIALLY_RECEIVED",
      pedidaEm: `${ano}-05-01`,
      previstaPara: `${ano}-07-09`,
      linhas: [{ quantidade: "1", preco: null }],
    });
    await criarOc(cenario, fornecedor, { status: "ORDERED", pedidaEm: `${ano}-05-01`, previstaPara: `${ano}-07-10`, linhas: [{ quantidade: "1", preco: "1" }] });
    await criarOc(cenario, fornecedor, { status: "ORDERED", pedidaEm: `${ano}-05-01`, previstaPara: `${ano}-06-09`, linhas: [{ quantidade: "1", preco: "1" }] });
    await criarOc(cenario, fornecedor, { status: "RECEIVED", pedidaEm: `${ano}-05-01`, previstaPara: `${ano}-06-20`, linhas: [{ quantidade: "1", preco: "1" }] });
    await criarOc(cenario, fornecedor, { status: "DRAFT", pedidaEm: `${ano}-05-01`, previstaPara: `${ano}-06-20`, linhas: [{ quantidade: "1", preco: "1" }] });

    const painel = await painelNoRetrato(cenario, meioDia(`${ano}-06-10`));
    const { commitments } = painel;

    expect(commitments.window).toEqual({ from: `${ano}-06-10`, to: `${ano}-07-09` });
    // Saldo pelo preço acordado: 1 × 5 + 3 × 5 + 1 × 5.
    expect(commitments.scheduledDeliveries).toMatchObject({ count: 3, withValue: 3, amount: "25.00" });
    expect(commitments.scheduledDeliveries.items.map((item) => [item.deliveryId, item.scheduledDate, item.sequence])).toEqual([
      [hoje.id, `${ano}-06-10`, 1],
      [dia20.id, `${ano}-06-20`, 2],
      [ultimoDia.id, `${ano}-07-09`, 3],
    ]);
    expect(commitments.scheduledDeliveries.items[0]).toMatchObject({
      customerOrderId: pedido.id,
      customerOrderCode: pedido.code,
      customerName: cliente.legalName,
    });
    expect(commitments.lateDeliveries).toEqual({
      count: 1,
      items: [
        {
          deliveryId: atrasada.id,
          customerOrderId: pedido.id,
          customerOrderCode: pedido.code,
          sequence: 4,
          scheduledDate: `${ano}-06-05`,
          customerName: cliente.legalName,
        },
      ],
    });
    expect(commitments.expectedPurchases).toEqual({
      count: 2,
      items: [
        { purchaseOrderId: ocHoje.id, code: ocHoje.code, supplierName: fornecedor.legalName, expectedDeliveryDate: `${ano}-06-10` },
        {
          purchaseOrderId: ocUltimoDia.id,
          code: ocUltimoDia.code,
          supplierName: fornecedor.legalName,
          expectedDeliveryDate: `${ano}-07-09`,
        },
      ],
    });

    // Pedido direto com entrega na janela: o valor das programadas fica incompleto.
    const direto = await criarPedido(cenario, cliente, { status: "CONFIRMED", linhas: [{ produto, quantidade: "2", preco: null }] });
    await criarEntrega(direto, { sequencia: 1, dia: `${ano}-06-15`, linhas: [{ linha: 0, quantidade: "2" }] });
    const incompleto = await painelNoRetrato(cenario, meioDia(`${ano}-06-10`));
    expect(incompleto.commitments.scheduledDeliveries).toMatchObject({ count: 4, withValue: 3, amount: null });
  }, LONGO);
});
