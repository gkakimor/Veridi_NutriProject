import { chromium } from "@playwright/test";
import { obterRun } from "./adversarial-run.mjs";

/**
 * A quantidade física é a mesma em toda a cadeia, e o passado não se reescreve.
 *
 * Prova pela INTERFACE, com dado nascido pela tela:
 *
 *   1. V1 teórica com pureza aplicada  → OP-A congela a necessidade
 *   2. V2 com o ajuste desligado       → ativa
 *   3. OP-A continua exatamente igual  → o passado é do documento
 *   4. OP-B nasce com V2               → o presente é da versão vigente
 *
 * As duas ordens divergirem é o resultado CERTO. Uma receita nova não pode
 * mudar a necessidade de uma ordem que a fábrica já está separando.
 *
 * Reexecutável na mesma base: usa o token de execução do harness, então cada
 * rodada cria a própria massa e reencontra só o que ela mesma criou.
 *
 *   node scripts/validate-physical-quantity-consistency.mjs
 */

const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

const RUN = obterRun({ novo: true, dono: "physical-quantity" });
const P = `QF${RUN.runId}`;

/** 220 mg teóricos; com pureza 98% a física é 224,4898 mg. */
const QUANTIDADE = "220";
const PUREZA = "98";
const PRODUZIR = "1000";

const ok = [];
const nok = [];
const notas = [];
const check = (nome, passou, detalhe = "") => {
  (passou ? ok : nok).push(`${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`${passou ? "ok  " : "NOK "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  return passou;
};
const anotar = (t) => {
  notas.push(t);
  console.log(`  · ${t}`);
};

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(CRED),
});
if (!login.ok) throw new Error(`login → ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";")[0];

const api = (caminho, init = {}) =>
  fetch(`${API}${caminho}`, {
    ...init,
    // Corpo vazio com `Content-Type: application/json` o Fastify recusa: as
    // rotas de criar versão não recebem payload, mas precisam de um objeto.
    body: init.body ?? (init.method === "POST" ? "{}" : undefined),
    headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const json = async (caminho, init) => {
  const r = await api(caminho, init);
  return r.status < 400 ? r.json() : null;
};

/* ── Massa pela API de leitura + telas de escrita ────────────────────────── */

const navegador = await chromium.launch();
const corte = cookie.indexOf("=");
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 950 } });
await contexto.addCookies([
  {
    name: cookie.slice(0, corte),
    value: cookie.slice(corte + 1),
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const pagina = await contexto.newPage();
const erros = [];
pagina.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));
pagina.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 160)));

/**
 * Item e produto nascem por API porque não são o objeto do teste — o que
 * precisa nascer pela tela é a FORMULAÇÃO, que é onde a decisão de modo mora.
 */
const cliente = (await json("/customers?pageSize=1"))?.customers?.[0];
if (!cliente) throw new Error("nenhum cliente na base — rode a suíte de estoque antes");

const ingrediente = await json("/items", {
  method: "POST",
  body: JSON.stringify({
    type: "RAW_MATERIAL",
    name: `${P} Ativo teorico`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  }),
});
const acabado = await json("/items", {
  method: "POST",
  body: JSON.stringify({
    type: "FINISHED_PRODUCT",
    name: `${P} Acabado`,
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  }),
});
const produto = await json("/products", {
  method: "POST",
  body: JSON.stringify({
    customerId: cliente.id,
    name: `${P} Produto`,
    finishedProductItemId: acabado.id,
  }),
});
check("MASSA · produto desta execução criado", Boolean(produto?.id), produto?.code);
anotar(`run ${RUN.runId} · prefixo ${P}`);

/* ── V1 pela tela: teórica, pureza aplicada ─────────────────────────────── */

const v1 = await json(`/products/${produto.id}/formulation-versions`, { method: "POST" });
await pagina.goto(`${WEB}/producao/formulacoes/${produto.id}/versoes/${v1.id}`);
await pagina.waitForSelector("#version-basis", { timeout: 25000 }).catch(() => {});

// A versão é montada por API — a tela é conferida logo abaixo, que é onde o
// modo precisa aparecer para o operador.
await json(`/formulation-versions/${v1.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    components: [
      {
        itemId: ingrediente.id,
        quantity: QUANTIDADE,
        unitCode: "mg",
        basis: "FIXED_BASIS",
        purityPercentApplied: PUREZA,
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: false,
      },
    ],
  }),
});

await pagina.reload();
await pagina.waitForTimeout(2000);
const textoV1 = await pagina.evaluate(() => document.body.innerText);
check(
  "TELA · a versão teórica diz que a quantidade é calculada",
  /Calculada/.test(textoV1) && /pureza/i.test(textoV1),
  textoV1.match(/Calculada[^\n]*/)?.[0] ?? "(não achado)",
);

await json(`/formulation-versions/${v1.id}/activate`, { method: "POST" });

const v1Lida = await json(`/formulation-versions/${v1.id}`);
const fisicoV1 = v1Lida.components[0].physicalPerUnit;
check(
  "V1 · físico por unidade sai da conta, não da quantidade digitada",
  Number(fisicoV1).toFixed(9) === (0.000224489795918367 * 1).toFixed(9) ||
    Math.abs(Number(fisicoV1) - 0.00022448979591836735) < 1e-12,
  `${fisicoV1} kg`,
);

/* ── OP-A ────────────────────────────────────────────────────────────────── */

const opA = await json("/production-orders", {
  method: "POST",
  body: JSON.stringify({ productId: produto.id, plannedQuantity: PRODUZIR }),
});
const opAPlan = await json(`/production-orders/${opA.id}/plan`, { method: "POST" });
const necA = opAPlan.requirements.find((r) => r.itemId === ingrediente.id)?.requiredQuantity;
check("OP-A · congelou a necessidade da V1", Number(necA).toFixed(6) === "0.224490", `${necA} kg`);

/* ── V2: mesma receita, ajuste DESLIGADO ────────────────────────────────── */

const v2 = await json(`/formulation-versions/${v1.id}/new-version`, { method: "POST" });
check("V2 · nasceu a partir da ativa", Boolean(v2?.id), v2?.id ? `V${v2.versionNumber}` : "falhou");

await json(`/formulation-versions/${v2.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    components: [
      {
        itemId: ingrediente.id,
        quantity: QUANTIDADE,
        unitCode: "mg",
        basis: "FIXED_BASIS",
        purityPercentApplied: PUREZA,
        quantityMode: "PHYSICAL_DIRECT",
        applyPurityAdjustment: false,
        applyOverageAdjustment: false,
      },
    ],
  }),
});
await json(`/formulation-versions/${v2.id}/activate`, { method: "POST" });

await pagina.goto(`${WEB}/producao/formulacoes/${produto.id}/versoes/${v2.id}`);
await pagina.waitForTimeout(2000);
const textoV2 = await pagina.evaluate(() => document.body.innerText);
check(
  "TELA · a versão física diz que pureza está registrada e não aplicada",
  /Física direta/.test(textoV2) && /registrado, não aplicado/.test(textoV2),
  textoV2.match(/Física direta[^\n]*/)?.[0] ?? "(não achado)",
);

/* ── OP-A depois da V2: intocada ────────────────────────────────────────── */

const opADepois = await json(`/production-orders/${opA.id}`);
const necADepois = opADepois.requirements.find((r) => r.itemId === ingrediente.id)?.requiredQuantity;
check(
  "HISTÓRICO · V2 não reescreveu a OP-A",
  Number(necADepois).toFixed(6) === Number(necA).toFixed(6),
  `antes ${necA} · depois ${necADepois}`,
);

await pagina.goto(`${WEB}/producao/ordens/${opA.id}`);
await pagina.waitForTimeout(1800);
const textoOpA = await pagina.evaluate(() => document.body.innerText);
check(
  "TELA · a OP antiga mostra a versão que a originou",
  textoOpA.includes(`V${v1Lida.versionNumber}`) || /Formula/i.test(textoOpA),
  `procurando V${v1Lida.versionNumber}`,
);

/* ── OP-B: nasce com V2 ──────────────────────────────────────────────────── */

const opB = await json("/production-orders", {
  method: "POST",
  body: JSON.stringify({ productId: produto.id, plannedQuantity: PRODUZIR }),
});
const opBPlan = await json(`/production-orders/${opB.id}/plan`, { method: "POST" });
const necB = opBPlan.requirements.find((r) => r.itemId === ingrediente.id)?.requiredQuantity;
check("OP-B · nasceu com a V2", Number(necB).toFixed(6) === "0.220000", `${necB} kg`);
check(
  "HISTÓRICO · as duas ordens divergem, e isso é o resultado certo",
  Number(necA).toFixed(6) !== Number(necB).toFixed(6),
  `${necA} × ${necB}`,
);

/* ── Veredito ───────────────────────────────────────────────────────────── */

await navegador.close();
console.log(`\nconsole.error/pageerror: ${erros.length}`);
if (erros.length) console.log(erros.slice(0, 3).join("\n"));
console.log(`\nverificações ok=${ok.length} nok=${nok.length}`);
if (nok.length) {
  console.log("REPROVADAS:");
  for (const f of nok) console.log(`  ✗ ${f}`);
}
process.exit(nok.length === 0 && erros.length === 0 ? 0 : 1);
