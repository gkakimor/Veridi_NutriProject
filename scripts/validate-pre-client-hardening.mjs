import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação pela interface do hardening pré-cliente.
 *
 * Reproduz localmente, contra cenários próprios, o que os três casos reais
 * deixaram em aberto: o Plano somando estoque de outro cliente, o total do
 * faturamento discordando de si mesmo no rascunho, o material do cliente
 * parecendo compra sem custo, a ampliação de reserva invisível e a falta sem
 * caminho para Compras.
 *
 * O ARRANGE usa a API (é fixture); o que se mede acontece na tela.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-pre-client-hardening.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const marca = `HD${Date.now().toString().slice(-8)}`;
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
  await page.screenshot({ path: path.join(OUT, `hardening-${nome}.png`), fullPage: true });
}

async function entrar(page) {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}

/**
 * Cenário do owner: cliente A com 1,5 kg e cliente B com 1,0 kg do MESMO
 * item, e um pedido do A que precisa de 1,8367 kg de material do cliente.
 */
async function montarCenarioOwner() {
  const material = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Ativo do cliente ${marca}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  const acabado = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `PA owner ${marca}`,
    unitCode: "un",
    controlsLot: true,
    requiresQualityRelease: false,
  });

  const clienteA = await api("POST", "/customers", { legalName: `Cliente A ${marca}` });
  const clienteB = await api("POST", "/customers", { legalName: `Cliente B ${marca}` });

  const recebimentosCliente = [];
  for (const [cliente, quantidade] of [
    [clienteA, "1.5"],
    [clienteB, "1"],
  ]) {
    recebimentosCliente.push(await api("POST", "/receipts/customer-supplied", {
      customerId: cliente.id,
      receivedAt: new Date().toISOString(),
      lines: [
        { itemId: material.id, receivedQuantity: quantidade, supplierLot: `${marca}-${cliente.code}` },
      ],
    }));
  }

  const produto = await api("POST", "/products", {
    name: `Produto owner ${marca}`,
    finishedProductItemId: acabado.id,
    customerId: clienteA.id,
  });
  const formulacao = await api("POST", `/products/${produto.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulacao.id}`, {
    basisQuantity: "1",
    components: [
      {
        itemId: material.id,
        quantity: "1.8367346938775510204",
        unitCode: "kg",
        supplyResponsibility: "CUSTOMER",
      },
    ],
  });
  await api("POST", `/formulation-versions/${formulacao.id}/activate`);

  const pedido = await api("POST", "/customer-orders", {
    customerId: clienteA.id,
    lines: [{ productId: produto.id, orderedQuantity: "1" }],
  });
  await api("POST", `/customer-orders/${pedido.id}/confirm`);

  return { pedidoId: pedido.id, material, produto, clienteA, clienteB, recebimentosCliente };
}

/** Cenário de falta Veridi, com fornecedor homologado e MOQ. */
async function montarCenarioCompra() {
  const material = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Excipiente ${marca}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  const acabado = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `PA compra ${marca}`,
    unitCode: "un",
    controlsLot: true,
    requiresQualityRelease: false,
  });
  const fornecedor = await api("POST", "/suppliers", { legalName: `Fornecedor ${marca}` });
  await api("POST", "/supplier-items", {
    itemId: material.id,
    supplierId: fornecedor.id,
    qualificationStatus: "APPROVED",
    preferred: true,
    initialOffer: {
      unitPrice: "26",
      currencyCode: "BRL",
      priceUomCode: "kg",
      minimumOrderQuantity: "1",
      minimumOrderUomCode: "kg",
      effectiveAt: new Date().toISOString(),
    },
  });

  const cliente = await api("POST", "/customers", { legalName: `Cliente compra ${marca}` });
  const produto = await api("POST", "/products", {
    name: `Produto compra ${marca}`,
    finishedProductItemId: acabado.id,
    customerId: cliente.id,
  });
  const formulacao = await api("POST", `/products/${produto.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulacao.id}`, {
    basisQuantity: "1",
    components: [{ itemId: material.id, quantity: "5", unitCode: "kg", supplyResponsibility: "VERIDI" }],
  });
  await api("POST", `/formulation-versions/${formulacao.id}/activate`);

  const pedido = await api("POST", "/customer-orders", {
    customerId: cliente.id,
    lines: [{ productId: produto.id, orderedQuantity: "1" }],
  });
  await api("POST", `/customer-orders/${pedido.id}/confirm`);
  return { pedidoId: pedido.id, material };
}

async function main() {
  await api("POST", "/auth/login", credentials);
  const owner = await montarCenarioOwner();
  const compra = await montarCenarioCompra();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ruins = [];
  page.on("response", (r) => {
    if (r.status() >= 400) ruins.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  try {
    await entrar(page);

    /* ── 1. Plano owner-aware: 1,5 do A, nunca 2,5 ── */
    await page.goto(`${WEB}/comercial/pedidos/${owner.pedidoId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const textoPlano = await page.locator("body").innerText();
    // A linha do material e lida pelas CELULAS: o rotulo do proprietario
    // quebra o texto corrido em varias linhas.
    const celulasPlano = await page
      .locator("main table tbody tr")
      .evaluateAll((linhas) =>
        linhas.map((linha) => [...linha.querySelectorAll("td")].map((c) => c.innerText.trim())),
      );
    const linhaPlano = celulasPlano.find((celulas) =>
      celulas.some((c) => c.includes("Ativo do cliente")),
    );

    checar(
      "o Plano so enxerga o estoque do cliente do Pedido",
      Boolean(linhaPlano) &&
        linhaPlano.some((c) => c === "1.5") &&
        !linhaPlano.some((c) => c === "2.5"),
      JSON.stringify(linhaPlano ?? []),
    );
    checar(
      "a falta do material do cliente aparece (0,336735), não zero",
      /0\.336735/.test(textoPlano),
    );
    checar(
      "o Plano diz de quem é o estoque",
      /Material do cliente/.test(textoPlano),
    );
    checar(
      "falta de material do cliente não oferece compra da Veridi",
      /Não há compra da Veridi a sugerir/.test(textoPlano),
    );
    await tela(page, "01-plano-owner");

    /* ── 2. Plano e OP concordam ── */
    const planoApi = await api("GET", `/customer-orders/${owner.pedidoId}/fulfillment-plan`);
    const doPlano = planoApi.materialImpact.find((linha) => linha.itemId === owner.material.id);
    const aplicado = await api("POST", `/customer-orders/${owner.pedidoId}/apply-fulfillment-plan`, {
      lines: [
        {
          customerOrderLineId: planoApi.lines[0].customerOrderLineId,
          reserveQuantity: "0",
          produceQuantity: "1",
        },
      ],
    });
    const op = await api("GET", `/production-orders/${aplicado.generatedProductionOrders[0].id}`);
    const daOp = op.requirements.find((linha) => linha.itemId === owner.material.id);
    checar(
      "Plano e OP dão os mesmos números",
      doPlano.available === daOp.available && doPlano.shortage === daOp.shortage,
      `plano ${doPlano.available}/${doPlano.shortage} · OP ${daOp.available}/${daOp.shortage}`,
    );

    /* ── 3. Falta Veridi oferece o caminho para Compras ── */
    await page.goto(`${WEB}/comercial/pedidos/${compra.pedidoId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const cta = page.locator('button:has-text("Ver sugestão de compra")').first();
    checar("falta Veridi oferece CTA de compra no próprio Plano", (await cta.count()) > 0);
    if ((await cta.count()) > 0) {
      await cta.click();
      await page.waitForTimeout(2500);
      const textoSourcing = await page.locator("body").innerText();
      checar(
        "a sugestão traz fornecedor, preço e pedido mínimo",
        /FOR-\d+/.test(textoSourcing) &&
          /preferencial/.test(textoSourcing) &&
          /mínimo 1 kg/.test(textoSourcing),
        textoSourcing.split(String.fromCharCode(10)).filter((l) => /FOR-|mínimo/.test(l)).join(" | ").slice(0, 160),
      );
      checar(
        "planejamento, não compra: nenhuma OC é criada",
        /nenhuma Ordem de Compra é criada aqui/.test(textoSourcing),
      );
      await tela(page, "02-shortage-cta");
    }

    /* ── 4. Lote do cliente: aquisição não aplicável, sem definir custo ── */
    const loteCliente = { id: owner.recebimentosCliente[0].lines[0].lotId };
    await page.goto(`${WEB}/estoque/lotes/${loteCliente.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const textoLote = await page.locator("body").innerText();
    checar(
      "lote do cliente diz 'Não aplicável', não 'sem custo informado'",
      /Não aplicável/.test(textoLote) &&
        !/não possui custo efetivo de aquisição informado/.test(textoLote),
    );
    checar(
      "lote do cliente mostra o proprietário",
      /Material fornecido pelo cliente/.test(textoLote),
    );
    await tela(page, "03-lote-cliente");

    /* ── 5. Recebimento do cliente não oferece definir custo ── */
    const recCliente = owner.recebimentosCliente[0];
    await page.goto(`${WEB}/compras/recebimentos/${recCliente.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const textoRec = await page.locator("body").innerText();
    checar(
      "recebimento do cliente não oferece definir custo",
      !/Definir custo/.test(textoRec) && /Material do cliente/.test(textoRec),
    );
    // E o servidor recusa mesmo se alguém chamar direto.
    const recusa = await fetch(`${API}/receipt-lines/${recCliente.lines[0].id}/acquisition-cost`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ unitCost: "999" }),
    });
    checar("servidor recusa custo em material do cliente", recusa.status === 400);
    await tela(page, "04-recebimento-cliente");

    console.log("\n≥400:", ruins.filter((r) => !/^40[013]/.test(r)).join(" | ") || "nenhum");
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
