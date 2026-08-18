import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { buildApp } from "../src/app.js";

/**
 * Metade industrial do cenário DEMO.
 *
 * Compra → recebimento → lote → qualidade → estoque → pedido → OP → reserva →
 * consumo → produção → lote acabado → expedição → faturamento.
 *
 * Roda pelas ROTAS REAIS da aplicação, não escrevendo direto no banco: o
 * objetivo do cenário é provar que o domínio consegue produzir essa história,
 * e escrever por fora provaria só que o Prisma funciona. Cada etapa checa
 * antes se já existe — reexecutar continua e não repete operação irreversível.
 */

type App = ReturnType<typeof buildApp>;

interface Contexto {
  prisma: PrismaClient;
  app: App;
  cookie: string;
  actor: User;
}

const DEMO_PO_NOTE = "DEMO — reposição de matéria-prima";
const DEMO_SUPPLIER_LOT = "DEMO-FORN-2026-011";
const DEMO_BUSINESS_LOT = "DEMO-PA-2026-001";

async function abrirSessao(prisma: PrismaClient, actor: User): Promise<string> {
  // Sessão real: as rotas exigem usuário autenticado, e a auditoria registra
  // quem executou. Nada de "Ambiente local" no histórico do cenário.
  const token = randomBytes(32).toString("hex");
  await prisma.userSession.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: actor.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return `veridi_session=${token}`;
}

async function chamar<T>(
  ctx: Contexto,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
): Promise<T> {
  const response = await ctx.app.inject({
    method,
    url,
    headers: { cookie: ctx.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  if (response.statusCode >= 400) {
    throw new Error(`${method} ${url} → ${response.statusCode}: ${response.body.slice(0, 220)}`);
  }
  return response.json() as T;
}

export async function seedIndustrial(
  prisma: PrismaClient,
  actor: User,
  entrada: {
    customerId: string;
    supplierId: string;
    productAId: string;
    materiaPrimaId: string;
    materiaPrimaSecundariaId: string;
    materialClienteId: string;
    embalagemId: string;
  },
): Promise<void> {
  const app = buildApp();
  await app.ready();
  const ctx: Contexto = { prisma, app, cookie: await abrirSessao(prisma, actor), actor };

  try {
    /* ── Compra parcialmente recebida ───────────────────────────
     * 100 kg pedidos, 60 recebidos: sobra "em compra", que é o número que
     * faz a tela de estoque contar uma história em vez de um saldo. */
    let po = await prisma.purchaseOrder.findFirst({ where: { notes: DEMO_PO_NOTE } });
    if (!po) {
      const criada = await chamar<{ id: string }>(ctx, "POST", "/purchase-orders", {
        supplierId: entrada.supplierId,
        orderDate: new Date().toISOString(),
        expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
        notes: DEMO_PO_NOTE,
        lines: [
          { itemId: entrada.materiaPrimaId, orderedQuantity: "200", unitPrice: "42.00" },
        ],
      });
      await chamar(ctx, "POST", `/purchase-orders/${criada.id}/confirm`);
      po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: criada.id } });
    }

    const poDetalhe = await chamar<{ lines: { id: string }[] }>(
      ctx,
      "GET",
      `/purchase-orders/${po.id}`,
    );

    /* ── Recebimento parcial, lote e validade ─────────────────── */
    let recebimento = await prisma.receipt.findFirst({
      where: { purchaseOrderId: po.id },
      include: { lines: true },
    });
    if (!recebimento) {
      const criado = await chamar<{ id: string }>(ctx, "POST", `/purchase-orders/${po.id}/receipts`, {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poDetalhe.lines[0]!.id,
            receivedQuantity: "160",
            // Custo EFETIVO de aquisição, informado no recebimento — o
            // domínio nunca o copia do preço da OC (preço negociado não é
            // valor pago). Sem ele o item não tem custo real conhecido e
            // todo o CMV do produto sai "sem custo".
            actualUnitCost: "42.00",
            supplierLot: DEMO_SUPPLIER_LOT,
            expiryDate: new Date(Date.now() + 540 * 864e5).toISOString(),
          },
        ],
      });
      recebimento = await prisma.receipt.findUniqueOrThrow({
        where: { id: criado.id },
        include: { lines: true },
      });
    }

    /* ── Qualidade: o lote principal é liberado, e um segundo lote
     * fica aguardando — a fila de qualidade vazia não conta nada. */
    const loteRecebido = await prisma.lot.findFirst({
      where: { itemId: entrada.materiaPrimaId, supplierLot: DEMO_SUPPLIER_LOT },
    });
    if (loteRecebido && loteRecebido.status !== "AVAILABLE") {
      await chamar(ctx, "POST", `/lots/${loteRecebido.id}/release`, {
        notes: "DEMO — laudo do fornecedor conferido",
      });
    }

    /* ── Material do cliente: entra sem ordem de compra e não vira
     * estoque da Veridi. É o diferencial que o cenário precisa mostrar. */
    const loteCliente = await prisma.lot.findFirst({
      where: { itemId: entrada.materialClienteId, ownerType: "CUSTOMER" },
    });
    if (!loteCliente) {
      await chamar(ctx, "POST", "/receipts/customer-supplied", {
        customerId: entrada.customerId,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            itemId: entrada.materialClienteId,
            receivedQuantity: "25",
            supplierLot: "DEMO-CLI-AROMA-07",
            expiryDate: new Date(Date.now() + 400 * 864e5).toISOString(),
          },
        ],
      });
    }

    /* ── Segunda matéria-prima da fórmula ──────────────────────
     * A OP só libera com TODOS os componentes disponíveis — é a regra que
     * impede começar uma produção que vai parar no meio. */
    const loteSecundario = await prisma.lot.findFirst({
      where: { itemId: entrada.materiaPrimaSecundariaId },
    });
    if (!loteSecundario) {
      const poSec = await chamar<{ id: string }>(ctx, "POST", "/purchase-orders", {
        supplierId: entrada.supplierId,
        orderDate: new Date().toISOString(),
        notes: "DEMO — cafeína",
        lines: [{ itemId: entrada.materiaPrimaSecundariaId, orderedQuantity: "30", unitPrice: "180.00" }],
      });
      await chamar(ctx, "POST", `/purchase-orders/${poSec.id}/confirm`);
      const detalhe = await chamar<{ lines: { id: string }[] }>(ctx, "GET", `/purchase-orders/${poSec.id}`);
      const rec = await chamar<{ id: string }>(ctx, "POST", `/purchase-orders/${poSec.id}/receipts`, {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: detalhe.lines[0]!.id,
            receivedQuantity: "30",
            actualUnitCost: "180.00",
            supplierLot: "DEMO-FORN-CAF-04",
            expiryDate: new Date(Date.now() + 500 * 864e5).toISOString(),
          },
        ],
      });
      void rec;
      const novo = await prisma.lot.findFirst({ where: { itemId: entrada.materiaPrimaSecundariaId } });
      if (novo && novo.status !== "AVAILABLE") {
        await chamar(ctx, "POST", `/lots/${novo.id}/release`, {
          notes: "DEMO — laudo conferido",
        });
      }
    }

    // Material do cliente também passa pela liberação quando o item exige:
    // a regra é do item, não do dono.
    const loteClienteAtual = await prisma.lot.findFirst({
      where: { itemId: entrada.materialClienteId, ownerType: "CUSTOMER" },
    });
    if (loteClienteAtual && loteClienteAtual.status !== "AVAILABLE") {
      await chamar(ctx, "POST", `/lots/${loteClienteAtual.id}/release`, {
        notes: "DEMO — material conferido no recebimento",
      });
    }

    /* ── Embalagem: sem ela a OP não fecha os requisitos ──────── */
    const lotePote = await prisma.lot.findFirst({ where: { itemId: entrada.embalagemId } });
    if (!lotePote) {
      const poEmb = await chamar<{ id: string }>(ctx, "POST", "/purchase-orders", {
        supplierId: entrada.supplierId,
        orderDate: new Date().toISOString(),
        notes: "DEMO — embalagem",
        lines: [{ itemId: entrada.embalagemId, orderedQuantity: "1500", unitPrice: "1.80" }],
      });
      await chamar(ctx, "POST", `/purchase-orders/${poEmb.id}/confirm`);
      const detalhe = await chamar<{ lines: { id: string }[] }>(
        ctx,
        "GET",
        `/purchase-orders/${poEmb.id}`,
      );
      await chamar(ctx, "POST", `/purchase-orders/${poEmb.id}/receipts`, {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: detalhe.lines[0]!.id,
            receivedQuantity: "1500",
            actualUnitCost: "1.80",
            supplierLot: "DEMO-EMB-2026-03",
          },
        ],
      });
    }

    console.log("  compra, recebimento, qualidade e material do cliente prontos");

    /* ── Pedido do cliente ─────────────────────────────────────
     * 1000 unidades: a mesma quantidade da faixa de precificação usada na
     * proposta, para a história fechar de ponta a ponta. */
    let pedido = await prisma.customerOrder.findFirst({
      where: { customerId: entrada.customerId, lines: { some: { productId: entrada.productAId } } },
      include: { lines: true },
    });
    if (!pedido) {
      const criado = await chamar<{ id: string }>(ctx, "POST", "/customer-orders", {
        customerId: entrada.customerId,
        lines: [{ productId: entrada.productAId, orderedQuantity: "1000" }],
      });
      await chamar(ctx, "POST", `/customer-orders/${criado.id}/confirm`);
      pedido = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: criado.id },
        include: { lines: true },
      });
    }

    /* ── Plano de atendimento ──────────────────────────────────
     * Sem estoque de produto acabado, o pedido só é atendido produzindo — e
     * a OP precisa NASCER do pedido. Criar a ordem por fora produziria a
     * mesma quantidade sem nenhum vínculo: quem abrisse o pedido depois não
     * teria como saber qual ordem o atende, e o relatório de carteira sairia
     * dizendo que nada foi produzido para ele.
     */
    const linhaPedido = pedido.lines[0]!;
    if (pedido.status === "CONFIRMED") {
      await chamar(ctx, "POST", `/customer-orders/${pedido.id}/apply-fulfillment-plan`, {
        lines: [
          {
            customerOrderLineId: linhaPedido.id,
            reserveQuantity: "0",
            produceQuantity: "1000",
          },
        ],
      });
      pedido = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: pedido.id },
        include: { lines: true },
      });
    }

    /* ── Ordem de produção ─────────────────────────────────────
     * Gerada pelo plano acima, já ligada ao pedido e ao cliente. */
    let op = await prisma.productionOrder.findFirstOrThrow({
      where: { customerOrderId: pedido.id },
      orderBy: { createdAt: "desc" },
    });
    if (op.status === "DRAFT") {
      await chamar(ctx, "POST", `/production-orders/${op.id}/plan`);
      op = await prisma.productionOrder.findUniqueOrThrow({ where: { id: op.id } });
    }

    /*
     * A OP avança por estado, não por "se acabei de criar".
     *
     * Reexecutar o cenário com a OP no meio do caminho precisa CONTINUAR de
     * onde parou — foi exatamente isso que faltou antes: o bloco só tratava
     * ordem recém-criada, a produção nunca era apontada, e o erro aparecia
     * três etapas depois, na reserva de um produto que não existia.
     */
    if (op.status === "DRAFT" || op.status === "PLANNED") {
      const liberada = await chamar<{
        requirements: { reservationLines: { id: string; lotCode: string | null; quantity: string }[] }[];
      }>(ctx, "POST", `/production-orders/${op.id}/release`);

      for (const requisito of liberada.requirements) {
        for (const linha of requisito.reservationLines) {
          await chamar(
            ctx,
            "POST",
            `/production-orders/${op.id}/picking/${linha.id}/confirm`,
            linha.lotCode ? { lotCode: linha.lotCode } : {},
          );
          await chamar(ctx, "POST", `/production-orders/${op.id}/consumptions`, {
            entries: [{ reservationLineId: linha.id, quantity: linha.quantity }],
          });
        }
      }
      op = await prisma.productionOrder.findUniqueOrThrow({ where: { id: op.id } });
    }

    if (op.status === "RELEASED" || op.status === "IN_PRODUCTION") {
      // Picking e consumo pendentes de uma execução interrompida.
      const detalhe = await chamar<{
        requirements: {
          reservationLines: {
            id: string;
            lotCode: string | null;
            quantity: string;
            pickingStatus: string;
            remainingQuantity: string;
          }[];
        }[];
      }>(ctx, "GET", `/production-orders/${op.id}`);

      for (const requisito of detalhe.requirements) {
        for (const linha of requisito.reservationLines) {
          if (linha.pickingStatus !== "CONFIRMED") {
            await chamar(
              ctx,
              "POST",
              `/production-orders/${op.id}/picking/${linha.id}/confirm`,
              linha.lotCode ? { lotCode: linha.lotCode } : {},
            );
          }
          if (Number(linha.remainingQuantity) > 0) {
            await chamar(ctx, "POST", `/production-orders/${op.id}/consumptions`, {
              entries: [{ reservationLineId: linha.id, quantity: linha.remainingQuantity }],
            });
          }
        }
      }

      const produzido = await prisma.productionOutput.count({ where: { productionOrderId: op.id } });
      if (produzido === 0) {
        await chamar(ctx, "POST", `/production-orders/${op.id}/outputs`, {
          quantity: "1000",
          destination: "NEW_LOT",
          businessLotNumber: DEMO_BUSINESS_LOT,
          // Produto acabado controla validade: o lote nasce com a dela.
          expiryDate: new Date(Date.now() + 720 * 864e5).toISOString(),
        });
      }

      await chamar(ctx, "POST", `/production-orders/${op.id}/complete`, {});
      op = await prisma.productionOrder.findUniqueOrThrow({ where: { id: op.id } });
      console.log(`  ordem de produção ${op.code} — ${op.status}`);
    }

    /* ── Liberação do lote acabado ─────────────────────────────
     * Produto acabado exige liberação da Qualidade antes de virar estoque
     * disponível — é o que impede expedir o que ainda não foi aprovado. */
    const loteAcabado = await prisma.lot.findFirst({
      where: { businessLotNumber: DEMO_BUSINESS_LOT },
    });
    if (loteAcabado && loteAcabado.status !== "AVAILABLE") {
      await chamar(ctx, "POST", `/lots/${loteAcabado.id}/release`, {
        notes: "DEMO — lote aprovado pela Qualidade",
      });
      console.log(`  lote acabado ${loteAcabado.code} liberado`);
    }

    /* ── Expedição parcial ─────────────────────────────────────
     * 600 de 1000: sobra pendência, que é o que faz a fila de faturamento e
     * o atendimento do pedido terem o que mostrar. */
    const jaExpedido = await prisma.shipment.findFirst({
      where: { customerOrderId: pedido.id },
    });
    if (!jaExpedido) {
      /*
       * Reserva complementar: o plano já foi aplicado (foi ele que gerou a
       * OP) e não se reaplica. O produto acabado só existe agora, depois da
       * produção, então é aqui que ele é reservado para este pedido.
       */
      await chamar(ctx, "POST", `/customer-orders/${pedido.id}/reserve-available`, {
        lines: [{ customerOrderLineId: linhaPedido.id, quantity: "1000" }],
      });

      const rascunho = await chamar<{
        id: string;
        lines: { id: string; customerOrderReservationLineId: string; requiresVerification: boolean; lotCode: string | null }[];
      }>(ctx, "POST", `/customer-orders/${pedido.id}/shipments`);

      if (rascunho) {
        await chamar(ctx, "PATCH", `/shipments/${rascunho.id}`, {
          lines: rascunho.lines.map((linha) => ({
            customerOrderReservationLineId: linha.customerOrderReservationLineId,
            quantity: "600",
          })),
        });

        const detalhe = await chamar<{
          lines: { id: string; requiresVerification: boolean; lotCode: string | null }[];
        }>(ctx, "GET", `/shipments/${rascunho.id}`);
        for (const linha of detalhe.lines) {
          if (!linha.requiresVerification || !linha.lotCode) continue;
          await chamar(ctx, "POST", `/shipments/${rascunho.id}/lines/${linha.id}/verify`, {
            lotCode: linha.lotCode,
          });
        }

        const confirmada = await chamar<{ id: string; code: string }>(
          ctx,
          "POST",
          `/shipments/${rascunho.id}/confirm`,
        );

        /* ── Faturamento do que foi expedido ───────────────── */
        if (confirmada) {
          const fatura = await chamar<{ id: string }>(ctx, "POST", "/billings", {
            shipmentId: confirmada.id,
          });
          if (fatura) {
            await chamar(ctx, "POST", `/billings/${fatura.id}/issue`, {});
          }
          console.log(`  expedição ${confirmada.code} e faturamento prontos`);
        }
      }
    }
  } finally {
    await app.close();
  }
}
