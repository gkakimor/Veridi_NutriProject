/**
 * Captura screenshots das telas do Veridi para o pacote de handoff.
 *
 * Uso: `node scripts/capture-screens.mjs [pastaDeSaida]` com `pnpm dev`
 * rodando. Não faz parte do build nem dos testes — é ferramenta de apoio
 * para documentação/demonstração.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.VERIDI_WEB_URL ?? "http://localhost:5173";
const API_URL = process.env.VERIDI_API_URL ?? "http://localhost:3333";
const outputDir = process.argv[2] ?? path.resolve("../handoff/screens");

/** Telas de listagem/consulta — não dependem de um id específico. */
const STATIC_SCREENS = [
  ["dashboard", "/"],
  ["cadastros-clientes", "/cadastros/clientes"],
  ["cadastros-fornecedores", "/cadastros/fornecedores"],
  ["cadastros-itens", "/cadastros/itens"],
  ["cadastros-produtos", "/cadastros/produtos"],
  ["compras-ordens", "/compras/ordens"],
  ["compras-recebimentos", "/compras/recebimentos"],
  ["estoque-visao-geral", "/estoque"],
  ["estoque-lotes", "/estoque/lotes"],
  ["estoque-movimentacoes", "/estoque/movimentacoes"],
  ["estoque-inventario", "/estoque/inventario"],
  ["producao-formulacoes", "/producao/formulacoes"],
  ["producao-ordens", "/producao/ordens"],
  ["producao-picking", "/producao/picking"],
  ["producao-produto-acabado", "/producao/produto-acabado"],
  ["comercial-pedidos", "/comercial/pedidos"],
  ["comercial-expedicoes", "/comercial/expedicoes"],
  ["comercial-faturamento", "/comercial/faturamento"],
  ["relatorios-hub", "/relatorios"],
  ["relatorio-r01-posicao", "/relatorios/estoque/posicao"],
  ["relatorio-r02-vencimentos", "/relatorios/estoque/vencimentos"],
  ["relatorio-r03-movimentacoes", "/relatorios/estoque/movimentacoes"],
  ["relatorio-r04-necessidades", "/relatorios/producao/necessidades"],
  ["relatorio-r05-planejado-realizado", "/relatorios/producao/planejado-realizado"],
  ["relatorio-r06-rastreabilidade", "/relatorios/producao/rastreabilidade"],
  ["relatorio-r07-consumo", "/relatorios/producao/consumo"],
  ["relatorio-r08-ordens-compra", "/relatorios/compras/ordens"],
  ["relatorio-r09-recebimentos", "/relatorios/compras/recebimentos"],
  ["relatorio-r10-em-compra", "/relatorios/compras/em-compra"],
  ["relatorio-r11-atrasadas", "/relatorios/compras/atrasadas"],
  ["relatorio-r12-pedidos", "/relatorios/comercial/pedidos"],
  ["relatorio-r13-atendimento", "/relatorios/comercial/atendimento"],
  ["relatorio-r14-pedido-operacao", "/relatorios/comercial/pedido-operacao"],
  ["relatorio-r15-faturamento-periodo", "/relatorios/faturamento/periodo"],
  ["relatorio-r16-aguardando-faturamento", "/relatorios/faturamento/pendentes"],
  ["relatorio-r17-pedido-entregue-faturado", "/relatorios/faturamento/pedido-entregue-faturado"],
];

/** Primeiro id disponível de cada listagem, para capturar os documentos. */
async function firstId(endpoint, collection, filter = () => true) {
  const response = await fetch(`${API_URL}${endpoint}`);
  if (!response.ok) return null;
  const payload = await response.json();
  const rows = payload[collection] ?? payload.rows ?? [];
  const found = rows.find(filter);
  return found ? (found.id ?? found.lotId ?? null) : null;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const [purchaseOrderId, receiptId, lotId, productionOrderId, customerOrderId, shipmentId, billingId] =
    await Promise.all([
      firstId("/purchase-orders?pageSize=20", "purchaseOrders"),
      firstId("/receipts?pageSize=20", "receipts"),
      firstId("/lots?pageSize=20", "lots"),
      firstId("/production-orders?pageSize=20", "productionOrders"),
      firstId("/customer-orders?pageSize=20", "customerOrders"),
      firstId("/shipments?pageSize=20", "shipments"),
      firstId("/billings?pageSize=20", "billings"),
    ]);

  const documentScreens = [
    ["doc-ordem-compra", purchaseOrderId && `/compras/ordens/${purchaseOrderId}`],
    ["doc-recebimento", receiptId && `/compras/recebimentos/${receiptId}`],
    ["doc-lote", lotId && `/estoque/lotes/${lotId}`],
    ["doc-ordem-producao", productionOrderId && `/producao/ordens/${productionOrderId}`],
    ["doc-pedido", customerOrderId && `/comercial/pedidos/${customerOrderId}`],
    ["doc-expedicao", shipmentId && `/comercial/expedicoes/${shipmentId}`],
    ["doc-faturamento", billingId && `/comercial/faturamento/${billingId}`],
    ["print-etiqueta-lote", lotId && `/estoque/lotes/${lotId}/etiqueta`],
    ["print-rastreabilidade", lotId && `/estoque/lotes/${lotId}/rastreabilidade/imprimir`],
    ["print-ordem-compra", purchaseOrderId && `/compras/ordens/${purchaseOrderId}/imprimir`],
    ["print-ordem-producao", productionOrderId && `/producao/ordens/${productionOrderId}/imprimir`],
    ["print-pedido", customerOrderId && `/comercial/pedidos/${customerOrderId}/imprimir`],
    ["print-expedicao", shipmentId && `/comercial/expedicoes/${shipmentId}/imprimir`],
    ["print-faturamento", billingId && `/comercial/faturamento/${billingId}/imprimir`],
  ].filter(([, route]) => Boolean(route));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const captured = [];
  const skipped = [];
  for (const [name, route] of [...STATIC_SCREENS, ...documentScreens]) {
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 20000 });
      // Dá tempo para a primeira carga de dados pintar a tabela.
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
      captured.push(`${name} → ${route}`);
    } catch (error) {
      skipped.push(`${name} (${route}): ${error instanceof Error ? error.message : error}`);
    }
  }

  await browser.close();
  console.log(`capturadas: ${captured.length}`);
  for (const line of captured) console.log("  ok", line);
  if (skipped.length > 0) {
    console.log(`falhas: ${skipped.length}`);
    for (const line of skipped) console.log("  --", line);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
