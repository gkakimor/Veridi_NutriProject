import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Trocar o CEP substitui o endereço — CUSTOMER-CEP-02.
 *
 * O endereço de um Cliente pertence a UM CEP. A Veridi relatou o contrário:
 * ao trocar o CEP, campos do endereço anterior ficavam na tela, e o que tinha
 * sido digitado à mão — número e complemento, que a consulta nunca conhece —
 * sobrevivia à troca. O resultado era um endereço híbrido: a rua e a cidade de
 * um CEP com o número de outro, salvo assim e impresso assim.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. o CEP A preenche logradouro, bairro, cidade e UF, e NÃO o número;
 *   2. número e complemento digitados sobre A ficam;
 *   3. trocar para B apaga o bloco inteiro — os seis campos, número e
 *      complemento inclusive — ANTES de a resposta de B chegar;
 *   4. a resposta de B preenche só o que é de B;
 *   5. o que é salvo é o CEP B com o endereço de B, e nada de A;
 *   6. reabrir o cadastro mostra o que foi salvo.
 *
 * O ViaCEP é interceptado no navegador (`page.route`), não mockado no código:
 * `lib/cep-api.ts` faz o `fetch` de verdade e lê a resposta no formato de
 * verdade. Isso mantém o contrato real da integração e tira a internet pública
 * do caminho — uma suíte que depende do ViaCEP estar de pé reprova por motivo
 * que não é do produto.
 *
 * A CORRIDA não está aqui. Provar "a resposta de A chega depois da de B" com
 * rede atrasada de navegador é exatamente o tipo de teste que passa a
 * intermitir; a prova determinística vive em
 * `apps/web/src/pages/customers/troca-de-cep-substitui-o-endereco.test.tsx`,
 * com as promessas resolvidas à mão.
 *
 * Massa própria, carimbada pelo `runId`.
 *
 *   node scripts/e2e/troca-de-cep-do-cliente.mjs
 */

const run = obterRun({ novo: true, dono: "cadastros" });
const P = `E2E${run.runId}`;

const CEP_A = "04816100";
const CEP_B = "13010000";

const ENDERECO_A = {
  logradouro: "Rua Vicente José de Almeida",
  bairro: "Cupecê",
  localidade: "São Paulo",
  uf: "SP",
};
const ENDERECO_B = {
  logradouro: "Avenida Francisco Glicério",
  bairro: "Centro",
  localidade: "Campinas",
  uf: "SP",
};

const NUMERO_A = "158";
const COMPLEMENTO_A = "Sala 2";
const NUMERO_B = "900";

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
  const { pagina, erros, fechar } = await abrirNavegador();

  /** Quantas vezes a tela consultou cada CEP — a consulta repetida é defeito. */
  const consultas = [];

  /*
   * O ViaCEP desta execução. Responde no formato do serviço real, inclusive o
   * `{ "erro": true }` de CEP inexistente, que é como ele nega.
   */
  await pagina.route("**/viacep.com.br/**", async (rota) => {
    const cep = (rota.request().url().match(/(\d{8})/) ?? [])[1] ?? "";
    consultas.push(cep);
    const corpo =
      cep === CEP_A ? ENDERECO_A : cep === CEP_B ? ENDERECO_B : { erro: true };
    await rota.fulfill({
      status: 200,
      contentType: "application/json",
      // A resposta é de outra origem: sem este cabeçalho o navegador recusa o
      // corpo e o `fetch` do `cep-api` vira erro de CORS no console.
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ cep, ...corpo }),
    });
  });

  const preencher = async (id, valor) => pagina.locator(`#${id}`).first().fill(valor);
  const valorDe = async (id) => pagina.locator(`#${id}`).first().inputValue();
  const clicar = async (nome) =>
    pagina.getByRole("button", { name: nome }).first().click();

  /** O bloco de endereço como está na tela, de uma vez. */
  const enderecoNaTela = async () => ({
    cep: await valorDe("customer-zip"),
    logradouro: await valorDe("customer-street"),
    numero: await valorDe("customer-number"),
    complemento: await valorDe("customer-complement"),
    bairro: await valorDe("customer-district"),
    cidade: await valorDe("customer-city"),
    uf: await valorDe("customer-state"),
  });

  const vazio = (endereco, campos) => campos.every((campo) => endereco[campo] === "");

  /**
   * Digita o CEP e sai do campo — que é quando a tela consulta. `blur` pelo
   * teclado, como a pessoa faz: `Tab` leva ao campo seguinte.
   */
  const digitarCep = async (valor) => {
    await preencher("customer-zip", valor);
    await pagina.locator("#customer-zip").first().press("Tab");
  };

  const RAZAO_SOCIAL = `Cliente CEP ${P} LTDA`;

  try {
    // ── 1. cadastro novo com o CEP A ────────────────────────────────────
    console.log(`\n[1] Cliente ${RAZAO_SOCIAL} com o CEP A (${CEP_A})`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await pagina.locator("#customer-legal-name").first().waitFor({ timeout: 25000 });
    await preencher("customer-legal-name", RAZAO_SOCIAL);

    await digitarCep(CEP_A);
    await pagina
      .locator("#customer-city")
      .first()
      .waitFor({ timeout: 25000 });
    await pagina.waitForFunction(
      () => document.querySelector("#customer-city")?.value === "São Paulo",
      { timeout: 25000 },
    );

    const comA = await enderecoNaTela();
    afirmar(
      "o CEP A preenche logradouro, bairro, cidade e UF",
      comA.logradouro === ENDERECO_A.logradouro &&
        comA.bairro === ENDERECO_A.bairro &&
        comA.cidade === ENDERECO_A.localidade &&
        comA.uf === ENDERECO_A.uf,
      `${comA.logradouro} / ${comA.bairro} / ${comA.cidade}-${comA.uf}`,
    );
    afirmar(
      "número e complemento continuam do operador: a consulta não os conhece",
      comA.numero === "" && comA.complemento === "",
      `número="${comA.numero}" complemento="${comA.complemento}"`,
    );

    // ── 2. o que o operador digita sobre o endereço de A ────────────────
    console.log(`\n[2] Número e complemento digitados sobre o endereço de A`);

    await preencher("customer-number", NUMERO_A);
    await preencher("customer-complement", COMPLEMENTO_A);
    const digitado = await enderecoNaTela();
    afirmar(
      "sob o mesmo CEP, o que foi digitado fica",
      digitado.numero === NUMERO_A && digitado.complemento === COMPLEMENTO_A,
      `${digitado.numero} / ${digitado.complemento}`,
    );

    // ── 3. a troca apaga o endereço anterior INTEIRO ────────────────────
    console.log(`\n[3] Troca para o CEP B (${CEP_B})`);

    /*
     * A resposta de B fica presa de propósito: o endereço de A tem de sumir
     * antes dela. Esperar a rede para parar de mostrar o endereço errado é
     * mostrá-lo pelo tempo que a rede levar — e ela pode não voltar.
     */
    let liberarB = () => {};
    const bPreso = new Promise((resolve) => {
      liberarB = resolve;
    });
    await pagina.route("**/viacep.com.br/**", async (rota) => {
      const cep = (rota.request().url().match(/(\d{8})/) ?? [])[1] ?? "";
      consultas.push(cep);
      if (cep === CEP_B) await bPreso;
      await rota.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ cep, ...(cep === CEP_B ? ENDERECO_B : { erro: true }) }),
      });
    });

    await digitarCep(CEP_B);
    const durante = await enderecoNaTela();
    afirmar(
      "o endereço de A some ANTES de a consulta de B responder",
      vazio(durante, ["logradouro", "bairro", "cidade", "uf"]),
      `"${durante.logradouro}" / "${durante.bairro}" / "${durante.cidade}-${durante.uf}"`,
    );
    afirmar(
      "número e complemento do endereço de A também somem — eram de A",
      vazio(durante, ["numero", "complemento"]),
      `número="${durante.numero}" complemento="${durante.complemento}"`,
    );

    // ── 4. a resposta de B preenche só o que é de B ─────────────────────
    console.log(`\n[4] Resposta do CEP B`);

    liberarB();
    await pagina.waitForFunction(
      () => document.querySelector("#customer-city")?.value === "Campinas",
      { timeout: 25000 },
    );
    const comB = await enderecoNaTela();
    afirmar(
      "o endereço de B preenche o bloco",
      comB.logradouro === ENDERECO_B.logradouro &&
        comB.bairro === ENDERECO_B.bairro &&
        comB.cidade === ENDERECO_B.localidade,
      `${comB.logradouro} / ${comB.bairro} / ${comB.cidade}`,
    );
    afirmar(
      "e o número de A não voltou junto com a resposta de B",
      comB.numero === "" && comB.complemento === "",
      `número="${comB.numero}" complemento="${comB.complemento}"`,
    );

    // ── 5. salvar leva o endereço de B ──────────────────────────────────
    console.log(`\n[5] Número do endereço de B e salvamento`);

    await preencher("customer-number", NUMERO_B);
    await clicar("Criar cliente");
    await pagina.waitForURL(/\/cadastros\/clientes$/, { timeout: 25000 });

    // ── 6. reabrir e conferir o que ficou ───────────────────────────────
    console.log(`\n[6] Reabertura do cadastro salvo`);

    await pagina.locator("#customers-search").first().fill(RAZAO_SOCIAL);
    await pagina.getByText(RAZAO_SOCIAL, { exact: false }).first().waitFor({ timeout: 25000 });
    await pagina.getByRole("button", { name: "Editar" }).first().click();
    await pagina.locator("#customer-zip").first().waitFor({ timeout: 25000 });

    const salvo = await enderecoNaTela();
    afirmar(
      "o CEP salvo é o B",
      salvo.cep.replace(/\D/g, "") === CEP_B,
      salvo.cep,
    );
    afirmar(
      "o endereço salvo é o de B, inteiro",
      salvo.logradouro === ENDERECO_B.logradouro &&
        salvo.bairro === ENDERECO_B.bairro &&
        salvo.cidade === ENDERECO_B.localidade &&
        salvo.uf === ENDERECO_B.uf,
      `${salvo.logradouro} / ${salvo.bairro} / ${salvo.cidade}-${salvo.uf}`,
    );
    afirmar(
      "o número salvo é o que foi digitado para B",
      salvo.numero === NUMERO_B,
      `"${salvo.numero}"`,
    );
    afirmar(
      "nada do endereço de A sobreviveu ao salvamento",
      !Object.values(salvo).includes(ENDERECO_A.logradouro) &&
        !Object.values(salvo).includes(ENDERECO_A.bairro) &&
        !Object.values(salvo).includes(ENDERECO_A.localidade) &&
        salvo.numero !== NUMERO_A &&
        salvo.complemento !== COMPLEMENTO_A,
      JSON.stringify(salvo),
    );

    // ── 7. reabrir não reconsulta, e o cadastro não é reescrito ─────────
    console.log(`\n[7] Abrir o cadastro não dispara consulta nem limpeza`);

    const antesDoBlur = consultas.length;
    await pagina.locator("#customer-zip").first().click();
    await pagina.locator("#customer-zip").first().press("Tab");
    const depoisDoBlur = await enderecoNaTela();
    afirmar(
      "sair do campo do CEP salvo não consulta de novo",
      consultas.length === antesDoBlur,
      `${consultas.length - antesDoBlur} consulta(s) a mais`,
    );
    afirmar(
      "e não apaga o endereço do cliente que acabou de abrir",
      depoisDoBlur.numero === NUMERO_B && depoisDoBlur.cidade === ENDERECO_B.localidade,
      `número="${depoisDoBlur.numero}" cidade="${depoisDoBlur.cidade}"`,
    );

    afirmar(
      "cada CEP foi consultado uma vez só",
      consultas.filter((cep) => cep === CEP_A).length === 1 &&
        consultas.filter((cep) => cep === CEP_B).length === 1,
      consultas.join(" | "),
    );

    afirmar("console limpo", erros.length === 0, erros.slice(0, 3).join(" | "));
  } finally {
    await fechar();
  }

  console.log("\n──────────────────────────────────────────────");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  · ${falha}`);
    process.exit(1);
  }
  console.log("APROVADO — o endereço pertence ao CEP, e trocar o CEP substitui o endereço inteiro.");
}

await main();
