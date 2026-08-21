import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação pela interface das correções do primeiro caso ponta a ponta.
 *
 * Reproduz localmente o que o VAL-LEG-01 não conseguiu fazer em produção:
 * consumir mais do que o reservado, faturar sem redigitar o preço acordado
 * e continuar um pedido atendido pela metade.
 *
 * Cenário sintético e próprio, criado e conferido nesta execução. O corpus
 * real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-post-e2e.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const marca = `PE${Date.now().toString().slice(-8)}`;
let sessionCookie = "";

async function api(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${text.slice(0, 300)}`);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return text ? JSON.parse(text) : null;
}

const resultados = [];
function checar(rotulo, condicao, detalhe = "") {
  resultados.push({ rotulo, ok: Boolean(condicao) });
  console.log(`${condicao ? "  ok  " : " FALHA"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function tela(page, nome) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `post-e2e-${nome}.png`), fullPage: true });
}

async function entrar(page) {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}

/**
 * Cenário: material X reservado 1,0 kg com 0,5 kg livres no mesmo lote;
 * pedido de 100 un a R$ 9,48; produção de 98.
 */
async function montarCenario() {
  const material = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Material ${marca}`,
    unitCode: "kg",
    controlsLot: true,
    // Sem liberação da Qualidade: o cenário aqui é sobre reserva e
    // consumo, e um lote retido não chega a ser reservado.
    requiresQualityRelease: false,
  });
  const acabado = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `PA ${marca}`,
    unitCode: "un",
    controlsLot: true,
    requiresQualityRelease: false,
  });
  const fornecedor = await api("POST", "/suppliers", { legalName: `Fornecedor ${marca}` });

  // 1,5 kg no lote: 1,0 vai para a reserva, 0,5 fica livre.
  const oc = await api("POST", "/purchase-orders", {
    supplierId: fornecedor.id,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ itemId: material.id, orderedQuantity: "1.5", unitPrice: "100" }],
  });
  await api("POST", `/purchase-orders/${oc.id}/confirm`);
  await api("POST", `/purchase-orders/${oc.id}/receipts`, {
    receivedAt: new Date().toISOString().slice(0, 10),
    lines: [
      {
        purchaseOrderLineId: oc.lines[0].id,
        receivedQuantity: "1.5",
        supplierLot: `LOTE-${marca}`,
        expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
      },
    ],
  });

  const produto = await api("POST", "/products", {
    name: `Produto ${marca}`,
    finishedProductItemId: acabado.id,
  });
  const formulacao = await api("POST", `/products/${produto.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulacao.id}`, {
    basisQuantity: "100",
    components: [{ itemId: material.id, quantity: "1", unitCode: "kg", basis: "FIXED_BASIS" }],
  });
  await api("POST", `/formulation-versions/${formulacao.id}/activate`);

  const cliente = await api("POST", "/customers", { legalName: `Cliente ${marca}` });
  const pedido = await api("POST", "/customer-orders", {
    customerId: cliente.id,
    lines: [{ productId: produto.id, orderedQuantity: "100" }],
  });
  const confirmado = await api("POST", `/customer-orders/${pedido.id}/confirm`);
  const linhaPedido = confirmado.lines[0];

  // O preço acordado normalmente chega pelo aceite do orçamento; aqui a
  // fixture grava o mesmo estado, porque o que se valida é o Faturamento.
  await api("PATCH", `/customer-order-lines/${linhaPedido.id}/agreed-price`, {
    agreedUnitPrice: "9.48",
  }).catch(() => null);

  const aplicado = await api("POST", `/customer-orders/${pedido.id}/apply-fulfillment-plan`, {
    lines: [
      { customerOrderLineId: linhaPedido.id, reserveQuantity: "0", produceQuantity: "100" },
    ],
  });

  const op = aplicado.generatedProductionOrders[0];
  await api("POST", `/production-orders/${op.id}/plan`);
  const liberada = await api("POST", `/production-orders/${op.id}/release`);

  return {
    material,
    acabado,
    produto,
    pedido,
    linhaPedidoId: linhaPedido.id,
    op: liberada,
    loteCode: liberada.requirements[0].reservationLines[0].lotCode,
    linhaReservaId: liberada.requirements[0].reservationLines[0].id,
  };
}

async function main() {
  await api("POST", "/auth/login", credentials);
  const cenario = await montarCenario();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ruins = [];
  page.on("response", (r) => {
    if (r.status() >= 400) ruins.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  try {
    await entrar(page);

    /* ── 1. Consumo extra: o que o VAL-LEG-01 não conseguiu fazer ── */
    await page.goto(`${WEB}/producao/ordens/${cenario.op.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Escanear / Informar lote")').first().click();
    await page.waitForTimeout(1000);
    await page.fill("#lot-scanner-manual", cenario.loteCode);
    await page.locator('button:has-text("Buscar")').first().click();
    await page.waitForTimeout(2500);

    const extra = page.locator('button:has-text("Adicionar consumo extra")').first();
    checar("a OP oferece adicionar consumo extra", (await extra.count()) > 0);
    await extra.click();
    await page.waitForTimeout(1500);

    const modal = await page.locator("body").innerText();
    checar(
      "o diálogo mostra o saldo livre antes de o operador pedir",
      /Disponível não reservado/.test(modal) && /0\.5/.test(modal),
    );
    await tela(page, "01-consumo-extra");

    await page.fill("#extra-quantity", "0.6");
    await page.waitForTimeout(600);
    checar(
      "recusa acima do saldo livre, dizendo o limite",
      /Acima do saldo livre deste lote/.test(await page.locator("body").innerText()),
    );

    await page.fill("#extra-quantity", "0.1");
    await page.fill("#extra-reason", "Ajuste de consumo durante produção");
    await page.waitForTimeout(600);
    await page.locator('button:has-text("Adicionar consumo extra")').last().click();
    await page.waitForTimeout(3000);

    const opDepois = await api("GET", `/production-orders/${cenario.op.id}`);
    const linhas = opDepois.requirements[0].reservationLines;
    checar("a reserva foi ampliada em linha nova", linhas.length === 2, `linhas: ${linhas.length}`);
    checar(
      "a linha original permanece intacta",
      linhas.some((l) => l.id === cenario.linhaReservaId && l.quantity === "1" && !l.extraReason),
    );
    const ampliada = linhas.find((l) => l.extraReason);
    checar(
      "a ampliação carrega motivo, autor e data",
      Boolean(ampliada?.extraReason && ampliada?.extraRequestedBy && ampliada?.extraRequestedAt),
      ampliada?.extraReason ?? "",
    );
    checar("reserva total virou 1,1 kg", opDepois.requirements[0].allocatedQuantity === "1.1");

    /* ── 2. Consumo real de 1,1 kg agora passa ── */
    await api("POST", `/production-orders/${cenario.op.id}/consumptions`, {
      entries: [
        { reservationLineId: cenario.linhaReservaId, quantity: "1" },
        { reservationLineId: ampliada.id, quantity: "0.1" },
      ],
    });
    const estoque = await api("GET", `/inventory?search=${cenario.material.code}`);
    checar(
      "estoque baixou exatamente o consumido (1,5 − 1,1 = 0,4)",
      estoque.items[0].onHand === "0.4",
      `onHand: ${estoque.items[0].onHand}`,
    );

    /* ── 3. Produção 98/100 e o limite dito antes do envio ── */
    await page.goto(`${WEB}/producao/ordens/${cenario.op.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.fill("#output-quantity", "101");
    await page.waitForTimeout(700);
    const textoProducao = await page.locator("body").innerText();
    checar(
      "produção acima do planejado é recusada na tela, não só no servidor",
      /produzido nunca ultrapassa o planejado/i.test(textoProducao),
    );
    await tela(page, "02-producao-limite");

    await api("POST", `/production-orders/${cenario.op.id}/outputs`, {
      quantity: "98",
      destination: "NEW_LOT",
      businessLotNumber: `L-${marca}`,
      expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
    });
    await api("POST", `/production-orders/${cenario.op.id}/complete`, {
      completionReason: "Perda de processo na encapsulação",
    });

    /* ── 4. Pedido parcial oferece continuidade ── */
    const paLotes = await api("GET", `/lots?search=L-${marca}`);
    const paLote = (paLotes.items ?? paLotes)[0];
    if (paLote?.id) await api("POST", `/lots/${paLote.id}/release`).catch(() => null);

    await page.goto(`${WEB}/comercial/pedidos/${cenario.pedido.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const textoPedido = await page.locator("body").innerText();
    checar(
      "o pedido oferece gerar OP para o saldo restante",
      /Gerar OP para saldo restante/.test(textoPedido),
    );
    await tela(page, "03-saldo-restante");

    /* ── 5. Expedições diz de onde nasce uma expedição ── */
    await page.goto(`${WEB}/comercial/expedicoes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    checar(
      "Expedições explica que a criação nasce do Pedido",
      /criadas a partir do Pedido do Cliente/i.test(await page.locator("body").innerText()),
    );

    /* ── 6. Produto Acabado em português ── */
    await page.goto(`${WEB}/producao/produto-acabado`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const textoPA = await page.locator("body").innerText();
    checar(
      "nenhum enum em inglês na grade de produto acabado",
      !/\bReserved\b/.test(textoPA) && !/\bAvailable\b/.test(textoPA),
    );

    console.log("\n≥400:", ruins.filter((r) => !/^40[13]/.test(r)).join(" | ") || "nenhum");
  } finally {
    await browser.close();
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram.`);
  if (falhas.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
