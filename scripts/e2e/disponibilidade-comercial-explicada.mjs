import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O Pedido diz por que não dá para reservar — com as palavras do Estoque.
 *
 * O defeito (F-09-1): com produto acabado produzido e o lote ainda
 * "Aguardando liberação", a linha do Pedido mostrava "Falta reservar 1000 ·
 * Disponível agora 0" e o botão "Reservar disponível" desabilitado, sem uma
 * palavra sobre a causa. A Posição de Estoque, no mesmo instante, escrevia
 * "aguardando liberação da Qualidade" na própria linha: o domínio sabia, e só
 * uma das duas telas perguntava (`getUnavailabilityByItems`).
 *
 * O que esta suíte prova, clicando:
 *
 * 1. a ação continua BLOQUEADA — a correção não é habilitar botão;
 * 2. a causa aparece, e é a MESMA que a Posição de Estoque escreve — a suíte
 *    lê a frase no Estoque e exige que o Pedido diga aquilo, em vez de
 *    comparar contra um texto decorado aqui;
 * 3. linha com retenção e linha sem estoque nenhum recebem explicações
 *    DIFERENTES — "preso" e "não existe" não são o mesmo fato;
 * 4. existe caminho para a informação, e ele leva ao item certo;
 * 5. a consulta de disponibilidade sai uma vez por carga — sem N+1, sem laço.
 *
 * Massa: a suíte CRIA o próprio Pedido, carimbado com o `runId` nas
 * observações. Os dois produtos são catálogo real e a suíte não depende da
 * identidade deles — precisa de um produto acabado com saldo físico RETIDO e
 * de outro sem saldo nenhum, que é o que separa as duas explicações.
 *
 * O que esta suíte NÃO faz, de propósito: liberar o lote pela Qualidade. A
 * liberação é de mão única e o DEV tem um único lote de produto acabado
 * aguardando liberação — consumi-lo tornaria a própria suíte irrepetível. A
 * transição "liberou → some o aviso → a ação abre" é provada onde ela pode ser
 * repetida à vontade: `shipments.test.ts` (API, com `POST /lots/:id/release`
 * de verdade) e `disponibilidade-reserva-explicada.test.tsx` (a tela, no caso
 * disponível).
 *
 *   node scripts/e2e/disponibilidade-comercial-explicada.mjs
 */

/** Produto cujo produto acabado tem saldo FÍSICO retido (lote aguardando Qualidade). */
const PRODUTO_RETIDO = "PROD-000031";
/** Produto cujo produto acabado não tem saldo nenhum. */
const PRODUTO_SEM_SALDO = "PROD-000010";
/** Os dois produtos são DO MESMO cliente — o Plano recusa pedido misturado. */
const CLIENTE = "CLI-000013";
const QUANTIDADE = "10";

const run = obterRun({ novo: true, dono: "fix-05" });

const falhas = [];
function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

/** Escolhe uma opção de um campo de busca de entidade, digitando. */
async function escolher(pagina, campoId, termo) {
  const campo = pagina.locator(`#${campoId}`);
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 20 });
  const opcao = pagina.locator('[role="option"]', { hasText: termo }).first();
  await opcao.waitFor({ state: "visible", timeout: 15000 });
  await opcao.click();
}

const secaoReserva = (pagina) =>
  pagina.locator(".form-section", { hasText: "Reservar Produto Acabado" }).first();
const botaoReservar = (pagina) => secaoReserva(pagina).getByRole("button", { name: "Reservar disponível" });

/** URLs desta execução — o `finally` precisa delas para limpar. */
let urlDoPedido = null;

/** Cancela as OPs em rascunho que o Plano gerou, pelo fluxo oficial. */
async function cancelarOpsGeradas(pagina) {
  if (!urlDoPedido) return;
  try {
    await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
    const links = pagina.locator('a[href^="/producao/ordens/"]');
    const destinos = await links.evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
    for (const destino of destinos) {
      await pagina.goto(`${WEB}${destino}`, { waitUntil: "networkidle" });
      const cancelar = pagina.getByRole("button", { name: "Cancelar OP" }).first();
      if ((await cancelar.count()) === 0) continue;
      await cancelar.click();
      const motivo = pagina.locator("textarea").last();
      await motivo.fill(`Massa de E2E ${run.runId} — FIX-05`);
      await pagina.locator(".confirm-dialog__actions, .modal__actions")
        .getByRole("button", { name: "Cancelar OP" })
        .click();
      await pagina.getByText("Cancelada", { exact: true }).first().waitFor({ timeout: 15000 });
      console.log(`  limpeza: OP ${destino.split("/").pop()} cancelada pelo fluxo oficial.`);
    }
  } catch {
    console.log("  limpeza: não foi possível cancelar alguma OP desta execução — verifique manualmente.");
  }
}

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  /*
   * A rede é observação, não assertion de negócio: uma tela que consulta
   * disponibilidade por linha, ou que entra em laço, é defeito mesmo com o
   * texto certo aparecendo.
   */
  const consultas = [];
  const respostasRuins = [];
  pagina.on("request", (requisicao) => {
    if (/\/reservation-status$/.test(requisicao.url())) consultas.push(requisicao.url());
  });
  pagina.on("response", (resposta) => {
    if (resposta.status() >= 400) respostasRuins.push(`${resposta.status()} ${resposta.url()}`);
  });

  try {
    console.log(`\nFIX-05 — disponibilidade comercial explicada (run ${run.runId})\n`);

    console.log("1. o que a Posição de Estoque diz sobre o produto acabado retido");
    await pagina.goto(`${WEB}/estoque?search=${PRODUTO_RETIDO.replace("PROD-", "PA-")}`, {
      waitUntil: "networkidle",
    });
    const linhaEstoque = pagina.locator("tbody tr", { hasText: PRODUTO_RETIDO.replace("PROD-", "PA-") }).first();
    await linhaEstoque.waitFor({ timeout: 20000 });
    const explicacaoDoEstoque = (await linhaEstoque.locator(".cell-sub").first().textContent())?.trim() ?? "";
    afirmar(
      `o Estoque explica a retenção: "${explicacaoDoEstoque}"`,
      explicacaoDoEstoque.length > 0,
      "linha sem `.cell-sub` — a massa retida sumiu do DEV",
    );

    console.log("\n2. criar o Pedido desta execução, pela interface");
    await pagina.goto(`${WEB}/comercial/pedidos/novo`, { waitUntil: "networkidle" });
    await escolher(pagina, "co-customer", CLIENTE);

    for (const produto of [PRODUTO_RETIDO, PRODUTO_SEM_SALDO]) {
      await pagina.getByRole("button", { name: "+ Adicionar produto" }).click();
      const seletor = pagina.locator('[id^="pedido-produto-"]').last();
      await seletor.click();
      await seletor.type(produto, { delay: 20 });
      await pagina.locator('[role="option"]', { hasText: produto }).first().click();
      await pagina.getByLabel(new RegExp(`Quantidade de ${produto}`)).fill(QUANTIDADE);
    }

    await pagina.locator("#co-notes").fill(`E2E ${run.runId} — FIX-05`);
    await pagina.getByRole("button", { name: "Salvar rascunho" }).click();
    await pagina.waitForURL(/\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await pagina.waitForFunction(
      () => /^PED-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 20000 },
    );
    urlDoPedido = pagina.url();
    const codigoDoPedido = (await pagina.locator("h1").first().textContent())?.trim();
    afirmar(`pedido criado: ${codigoDoPedido}`, /^PED-\d+$/.test(codigoDoPedido ?? ""));

    console.log("\n3. confirmar e aplicar o Plano — nada reservado, tudo a produzir");
    await pagina.getByRole("button", { name: "Confirmar pedido" }).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
    await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).waitFor({ timeout: 20000 });

    for (const produto of [PRODUTO_RETIDO, PRODUTO_SEM_SALDO]) {
      await pagina.getByLabel(new RegExp(`Produzir de ${produto}`)).fill(QUANTIDADE);
    }
    await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Aplicar Plano" }).click();
    await secaoReserva(pagina).waitFor({ timeout: 30000 });
    afirmar("pedido em atendimento — a tela de reserva apareceu", true);

    console.log("\n4. a ação continua bloqueada — e agora diz por quê");
    const linhaRetida = secaoReserva(pagina).locator("tbody tr", { hasText: PRODUTO_RETIDO }).first();
    await linhaRetida.waitFor({ timeout: 20000 });
    afirmar("ação de reservar bloqueada", await botaoReservar(pagina).isDisabled());
    afirmar(
      "o botão bloqueado explica o próprio bloqueio",
      /nenhuma linha tem produto disponível/i.test((await botaoReservar(pagina).getAttribute("title")) ?? ""),
      `title: ${await botaoReservar(pagina).getAttribute("title")}`,
    );

    const causaNaLinha = (await linhaRetida.locator(".cell-sub").first().textContent())?.trim() ?? "";
    afirmar(
      "a linha do Pedido repete a explicação do Estoque, palavra por palavra",
      causaNaLinha === explicacaoDoEstoque,
      `Pedido: "${causaNaLinha}" · Estoque: "${explicacaoDoEstoque}"`,
    );

    console.log("\n5. o bloco de continuidade nomeia as linhas e as causas");
    const aviso = secaoReserva(pagina).locator(".callout").first();
    await aviso.waitFor({ timeout: 20000 });
    const textoDoAviso = (await aviso.textContent()) ?? "";
    afirmar(
      "diz quantos produtos travam",
      /2 produtos sem disponibilidade suficiente para reservar\./.test(textoDoAviso),
      textoDoAviso.slice(0, 160),
    );
    afirmar(
      `${PRODUTO_RETIDO} aparece com a quantidade que falta`,
      new RegExp(`${PRODUTO_RETIDO}[^]*?faltam ${QUANTIDADE} \\S+ de ${QUANTIDADE} \\S+`).test(textoDoAviso),
      textoDoAviso.slice(0, 300),
    );
    afirmar(
      "a causa da linha retida é a do domínio, não uma frase genérica",
      textoDoAviso.includes(explicacaoDoEstoque),
      `esperado conter: "${explicacaoDoEstoque}"`,
    );
    afirmar(
      "a linha sem estoque recebe outra explicação — falta não é retenção",
      new RegExp(`${PRODUTO_SEM_SALDO}[^]*?ainda não foi produzida nem recebida`).test(textoDoAviso),
      textoDoAviso.slice(0, 400),
    );
    afirmar(
      "nenhuma das duas vira 'erro no estoque'",
      !/erro no estoque/i.test(textoDoAviso),
    );

    console.log("\n6. o caminho para a informação leva ao item certo");
    const consultasAntes = consultas.length;
    await aviso.getByRole("link", { name: "Ver disponibilidade" }).first().click();
    await pagina.waitForURL(/\/estoque\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const tituloDoItem = pagina.locator("h1", { hasText: PRODUTO_RETIDO.replace("PROD-", "PA-") }).first();
    await tituloDoItem.waitFor({ timeout: 20000 }).catch(() => {});
    afirmar(
      "abriu a posição do produto acabado retido",
      (await tituloDoItem.count()) > 0,
      `${pagina.url()} — título: ${(await pagina.locator("h1").first().textContent())?.trim()}`,
    );
    afirmar("navegar não disparou consulta de disponibilidade a mais", consultas.length === consultasAntes);

    console.log("\n7. rede e console");
    await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
    await secaoReserva(pagina).waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(1500);
    const consultasNaCarga = consultas.length;
    await pagina.waitForTimeout(2500);
    afirmar(
      "a consulta de disponibilidade não entra em laço",
      consultas.length === consultasNaCarga,
      `${consultasNaCarga} → ${consultas.length}`,
    );
    afirmar(
      "uma consulta por carga, não uma por linha do pedido",
      consultas.length <= 4,
      `consultas na execução inteira: ${consultas.length}`,
    );
    afirmar("nenhuma resposta 4xx/5xx", respostasRuins.length === 0, respostasRuins.slice(0, 5).join(" | "));
    afirmar("console limpo", erros.length === 0, erros.slice(0, 5).join(" | "));
  } finally {
    /*
     * As OPs em rascunho são canceláveis e voltam ao lugar. O Pedido não: o
     * domínio recusa cancelar pedido em atendimento que já gerou OP, e não
     * existe estorno canônico. Ele fica como resíduo declarado desta rodada,
     * como as OCs do FIX-04 — apagar por SQL seria pior.
     */
    await cancelarOpsGeradas(pagina);
    if (urlDoPedido) console.log(`  resíduo declarado: pedido ${urlDoPedido} em atendimento (E2E ${run.runId}).`);
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
