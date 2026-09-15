import { autenticar, clienteApi, exigir } from "./fixtures/api.mjs";
import { criarCliente, criarFormulacaoAtiva, criarItem, criarProdutoOperacional } from "./fixtures/cadastros.mjs";
import { aplicarRoteiro, criarOrdemDeProducao, criarRoteiroAtivo, planejarOrdem } from "./fixtures/producao.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";

/**
 * O roteiro das fixtures planeja uma OP de verdade — E2E-BASELINE-REDESIGN-WAVE-01-02.
 *
 * `lib/roteiro.mjs` nasceu em PRODUCTION-ROUTE-ASSIGNMENT-01 para o golden path
 * e a OP fora da primeira página, e nunca tinha rodado. As próximas waves
 * dependem dele para ter uma ordem que planeja. Esta prova monta o cenário
 * mínimo por API — cliente, produto, componente, formulação ativa, OP em
 * rascunho — e confere o contrato:
 *
 *   1. sem roteiro, planejar é recusado — a regra que obriga o roteiro;
 *   2. o roteiro da fixture fica com a V1 ativa;
 *   3. aplicado à OP, o planejamento é aceito e a OP fica PLANNED.
 *
 * Só API: não há tela sob teste. Não libera, não separa, não produz.
 *
 *   node scripts/e2e/roteiro-aplicado-planeja-ordem.mjs
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
  const api = clienteApi(await autenticar());

  // ── 1. cenário mínimo ─────────────────────────────────────────────────
  console.log(`\n[1] Cliente, produto, componente, formulação e OP — ${run.carimbo}`);

  const cliente = await criarCliente(api, run);
  const componente = await criarItem(api, run, { nome: carimbar(run, "Componente"), tipo: "RAW_MATERIAL", unidade: "kg" });
  const produto = await criarProdutoOperacional(api, run, { cliente, unidade: "un" });
  const formulacao = await criarFormulacaoAtiva(api, run, {
    produto,
    base: "1",
    componentes: [{ item: componente, quantidade: "0.5", unidade: "g" }],
  });
  afirmar(`formulação V${formulacao.numero} ativa em ${produto.codigo}`, formulacao.status === "ACTIVE");

  const ordem = await criarOrdemDeProducao(api, run, { produto, quantidade: "100" });
  afirmar(`${ordem.codigo} nasce em rascunho`, ordem.status === "DRAFT", ordem.status);
  afirmar("a OP leva a formulação ativa criada agora", ordem.formulacaoId === formulacao.id, ordem.formulacaoId);

  // ── 2. sem roteiro ────────────────────────────────────────────────────
  console.log("\n[2] Sem roteiro, a OP não planeja");

  const semRoteiro = await api(`/production-orders/${ordem.id}/plan`, { method: "POST" });
  const recusa = JSON.stringify(semRoteiro.erro ?? "");
  afirmar("planejar sem roteiro é recusado com 4xx", semRoteiro.status >= 400 && semRoteiro.status < 500, `${semRoteiro.status}`);
  afirmar("e a recusa fala do roteiro", /roteiro/i.test(recusa), recusa.slice(0, 160));

  // ── 3. roteiro da fixture ─────────────────────────────────────────────
  console.log("\n[3] Roteiro criado, ativado, aplicado — e a OP planeja");

  const roteiro = await criarRoteiroAtivo(api, run, { unidade: produto.unidade });
  afirmar(`${roteiro.codigo} com a V1 ativa`, Boolean(roteiro.versaoId));
  await aplicarRoteiro(api, ordem.id, roteiro.versaoId);
  const planejada = await planejarOrdem(api, ordem.id);
  afirmar("o planejamento é aceito", planejada.status === "PLANNED", planejada.status);
  const relida = await exigir(api, "GET", `/production-orders/${ordem.id}`);
  afirmar("relida pela API, a OP está PLANNED", relida.status === "PLANNED", relida.status);

  console.log("\n──────────────────────────────────────────────");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  · ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO — o roteiro das fixtures é aplicado à OP e ela planeja.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
