import { exigir } from "./fixtures/api.mjs";
import { criarFornecedor, criarItem } from "./fixtures/cadastros.mjs";
import { diaComercial } from "./fixtures/datas.mjs";
import { criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { lerPdf, textoDoPdfDaTela } from "./lib/pdf.mjs";

/**
 * O leitor de PDF das suítes contra um documento REAL — E2E-BASELINE-REDESIGN-WAVE-01-02.
 *
 * As suítes do Orçamento, do desconto até o Faturamento e do envio leem o
 * impresso por `lib/pdf.mjs`, e o leitor nunca tinha rodado dentro de uma suíte.
 * Antes de as próximas waves dependerem dele, esta prova abre um documento de
 * verdade e confere o contrato de ponta a ponta:
 *
 *   1. a tela do documento põe o arquivo no iframe `.pdf-screen__frame`;
 *   2. o `src` é `blob:` — PDF gerado no navegador, não página HTML nem URL da API;
 *   3. o texto extraído traz o que a massa escreveu: o código da OC lido da
 *      resposta, o fornecedor carimbado e o código do item;
 *   4. o texto entregue à suíte não tem NBSP.
 *
 * A OC é massa por API: o assunto aqui é o leitor, não a compra, e criar OC tem
 * teste de API próprio. Nenhum cenário de Orçamento ou Faturamento — isso é das
 * próximas waves.
 *
 *   node scripts/e2e/leitor-de-pdf-da-tela.mjs
 */

const run = criarRun();

const falhas = [];

function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

async function main() {
  const { pagina, api, erros, fechar } = await abrirNavegador();

  try {
    // ── 1. massa por API ────────────────────────────────────────────────
    console.log(`\n[1] OC de massa — ${run.carimbo}`);

    const fornecedor = await criarFornecedor(api, run);
    const item = await criarItem(api, run, { tipo: "RAW_MATERIAL", unidade: "kg" });
    const oc = await exigir(api, "POST", "/purchase-orders", {
      supplierId: fornecedor.id,
      orderDate: diaComercial(),
      notes: `Massa E2E ${run.carimbo}`,
      lines: [{ itemId: item.id, orderedQuantity: "12.5", unitPrice: "1234.56" }],
    });
    afirmar("OC criada, com o código oficial lido da resposta", /^OC-\d+$/.test(oc.code ?? ""), oc.code);

    // ── 2. o documento na tela ──────────────────────────────────────────
    console.log("\n[2] Documento gerado pela tela");

    const inicio = Date.now();
    await pagina.goto(`${WEB}/compras/ordens/${oc.id}/imprimir`);
    const texto = await textoDoPdfDaTela(pagina);
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    const frame = pagina.locator("iframe.pdf-screen__frame");
    const src = (await frame.first().getAttribute("src")) ?? "";
    afirmar("o arquivo está num único iframe .pdf-screen__frame", (await frame.count()) === 1);
    afirmar("o src é blob: gerado no navegador", src.startsWith("blob:"), src.slice(0, 48));
    console.log(`  info documento gerado e lido em ${segundos} s`);

    // ── 3. o texto extraído ─────────────────────────────────────────────
    console.log("\n[3] Texto extraído do PDF");

    afirmar("traz o código da OC", texto.includes(oc.code), oc.code);
    afirmar("traz o fornecedor desta execução", texto.includes(run.carimbo), run.carimbo);
    afirmar("traz o código do item", texto.includes(item.codigo), item.codigo);

    // ── 4. NBSP ─────────────────────────────────────────────────────────
    console.log("\n[4] NBSP");

    const cru = await pagina.evaluate(async () => {
      const origem = document.querySelector("iframe.pdf-screen__frame")?.getAttribute("src")?.split("#")[0] ?? "";
      return Array.from(new Uint8Array(await (await fetch(origem)).arrayBuffer()));
    });
    const textoCru = lerPdf(Uint8Array.from(cru)).paginas.join("\n");
    const especiais = (textoCru.match(/[  ]/g) ?? []).length;
    console.log(`  info NBSP e espaço fino no texto cru do PDF: ${especiais}`);
    afirmar("o texto entregue à suíte não tem NBSP nem espaço fino", !/[  ]/.test(texto));
    if (/R\$ \d/.test(textoCru)) {
      afirmar("valor em reais comparável com espaço comum", /R\$ \d/.test(texto));
    }

    afirmar("console e rede limpos", erros.length === 0, erros.slice(0, 3).join(" | "));
  } finally {
    await fechar();
  }

  console.log("\n──────────────────────────────────────────────");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  · ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO — o leitor das suítes lê o PDF real da tela: iframe, blob e texto.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
