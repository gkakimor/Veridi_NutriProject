import { chromium } from "@playwright/test";
import fs from "node:fs";

/**
 * Smoke AUTENTICADO em produção — somente leitura.
 *
 *   pnpm exec node scripts/smoke-prod.mjs handoff/smoke-prod
 *
 * O que ele prova: que a release no ar responde com SESSÃO REAL, não só no
 * `/health`. Deploy verde e `/health` 200 não dizem nada sobre uma tela que
 * quebra ao montar, um endpoint que passou a exigir campo novo, ou uma
 * migration que subiu pela metade.
 *
 * Duas pernas. A de LEITURA é o padrão. A de ESCRITA — criar um cliente,
 * conferir a autoria e inativá-lo — só roda com `--escrita`, porque cria
 * registro em produção; isso é decisão de quem opera, nunca efeito colateral
 * de uma verificação. O cliente criado é inativado no fim pelo fluxo oficial
 * e leva "SMOKE" no nome, para nunca ser confundido com cadastro de verdade.
 *
 * A credencial sai de `.local-data/prod-demo.json` e não passa por linha de
 * comando, log, screenshot nem mensagem de erro.
 */

const OUT = process.argv[2] ?? ".";
const COM_ESCRITA = process.argv.includes("--escrita");
const credenciais = JSON.parse(
  fs.readFileSync(new URL("../.local-data/prod-demo.json", import.meta.url), "utf8"),
);
const BASE = credenciais.url.replace(/\/$/, "");

fs.mkdirSync(OUT, { recursive: true });

const falhas = [];
function check(rotulo, condicao, detalhe = "") {
  if (condicao) {
    console.log("ok    ", rotulo);
  } else {
    falhas.push(`${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
    console.log("FALHOU", rotulo, detalhe);
  }
}

let cookie = "";

/** Só GET, fora o login. Qualquer outro verbo aqui seria escrita em produção. */
async function get(caminho) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    headers: { accept: "application/json", ...(cookie ? { cookie } : {}) },
  });
  const texto = await resposta.text();
  return {
    status: resposta.status,
    corpo: texto ? JSON.parse(texto) : null,
  };
}

async function main() {
  // 1. A casca antes da sessão.
  const saude = await fetch(`${BASE}/health`);
  check("/health responde 200", saude.status === 200, `status ${saude.status}`);

  // 2. Sessão real. É o passo que nenhuma rodada anterior tinha feito.
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: credenciais.email, password: credenciais.password }),
  });
  check("login autenticado", login.status === 200 || login.status === 204, `status ${login.status}`);
  const setCookie = login.headers.get("set-cookie");
  check("login devolve cookie de sessão", Boolean(setCookie));
  if (!setCookie) {
    console.log("\nSem sessão não há smoke. Parando.");
    return;
  }
  cookie = setCookie.split(";")[0];

  const eu = await get("/auth/me");
  check("/auth/me reconhece a sessão", eu.status === 200, `status ${eu.status}`);

  /*
   * 3. Endpoints que sustentam as telas do roteiro. Um 500 aqui é migration
   * ou DTO quebrado — o tipo de coisa que `/health` não vê.
   */
  const rotas = [
    "/customers?page=1&pageSize=5",
    "/products?page=1&pageSize=5",
    "/projects?page=1&pageSize=5",
    "/items?page=1&pageSize=5",
    "/suppliers?page=1&pageSize=5",
    "/customer-orders?page=1&pageSize=5",
    "/billings?page=1&pageSize=5",
    "/production-orders?page=1&pageSize=5",
    "/purchase-orders?page=1&pageSize=5",
    "/inventory?page=1&pageSize=5",
    "/lots?page=1&pageSize=5",
  ];
  for (const rota of rotas) {
    const resultado = await get(rota);
    check(`GET ${rota.split("?")[0]}`, resultado.status === 200, `status ${resultado.status}`);
  }

  /*
   * 4. O item de produto acabado carrega os controles de estoque. É o campo
   * novo desta rodada; se a build no ar for antiga, ele vem ausente.
   */
  const produtos = await get("/products?page=1&pageSize=5");
  const comItem = (produtos.corpo?.products ?? []).find((p) => p.finishedProductItem);
  if (comItem) {
    check(
      "resumo do item acabado traz os controles de estoque",
      typeof comItem.finishedProductItem.controlsLot === "boolean",
      "campo ausente — build no ar é anterior a esta rodada",
    );
  } else {
    console.log("aviso  nenhum produto com item acabado nos 5 primeiros; controle não verificado");
  }

  // 5. As telas, com a sessão do navegador.
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const [nome, ...resto] = cookie.split("=");
  await contexto.addCookies([
    {
      name: nome,
      value: resto.join("="),
      domain: new URL(BASE).hostname,
      path: "/",
      secure: true,
    },
  ]);

  const pagina = await contexto.newPage();
  const errosDeConsole = [];
  pagina.on("console", (msg) => {
    if (msg.type() === "error") errosDeConsole.push(msg.text());
  });
  pagina.on("pageerror", (erro) => errosDeConsole.push(String(erro)));
  // "Failed to load resource: 404" sem a URL não diz o que faltou. O evento
  // de resposta é o único lugar onde ela aparece.
  const requisicoesQuebradas = [];
  pagina.on("response", (resposta) => {
    if (resposta.status() >= 400) {
      requisicoesQuebradas.push(`${resposta.status()} ${resposta.url()}`);
    }
  });

  const telas = [
    ["dashboard", "/"],
    ["clientes", "/cadastros/clientes"],
    ["produtos", "/cadastros/produtos"],
    ["itens", "/cadastros/itens"],
    ["projetos", "/comercial/projetos"],
    ["pedidos", "/comercial/pedidos"],
    // `/estoque` mesmo: Posição de Estoque não tem sufixo. `/estoque/posicao`
    // cai em `/estoque/:itemId` e busca um item chamado "posicao".
    ["estoque", "/estoque"],
    ["ordens-producao", "/producao/ordens"],
  ];

  for (const [rotulo, caminho] of telas) {
    await pagina.goto(`${BASE}${caminho}`, { waitUntil: "networkidle" });
    // A tela de login no lugar da tela pedida significa sessão não aceita.
    const naLogin = pagina.url().includes("/login");
    check(`tela ${rotulo} abre autenticada`, !naLogin, naLogin ? "caiu no login" : "");
    await pagina.screenshot({ path: `${OUT}/prod-${rotulo}.png` });
  }

  /*
   * 6. A ajuda contextual desta rodada. Provar que ela existe EM PRODUÇÃO é
   * o ponto: o defeito original era justamente ela não aparecer.
   */
  await pagina.goto(`${BASE}/cadastros/produtos`, { waitUntil: "networkidle" });
  const gatilho = pagina.getByRole("button", { name: /Como funciona/ }).first();
  const temAjuda = await gatilho.isVisible().catch(() => false);
  check("ajuda contextual visível em produção", temAjuda);

  if (temAjuda) {
    await gatilho.click();
    const glossario = pagina.getByRole("heading", { name: "Nesta tela" });
    check("modal de ajuda traz o glossário da tela", await glossario.isVisible().catch(() => false));
    await pagina.screenshot({ path: `${OUT}/prod-ajuda.png` });
    await pagina.keyboard.press("Escape");
  }

  if (COM_ESCRITA) await pernaDeEscrita(pagina);

  check(
    "console sem erros durante a navegação",
    errosDeConsole.length === 0,
    errosDeConsole.slice(0, 3).join(" | "),
  );
  check(
    "nenhuma requisição 4xx/5xx",
    requisicoesQuebradas.length === 0,
    [...new Set(requisicoesQuebradas)].slice(0, 6).join(" | "),
  );

  await navegador.close();
}

/**
 * Roteiro do Cliente — item 5 do backlog.
 *
 * Prova o que só uma sessão real prova: que a validação recusa antes de
 * chegar ao servidor, que o CEP preenche endereço, que a autoria é gravada a
 * partir do usuário autenticado, e que o cliente sai pelo fluxo oficial de
 * inativação. Nada é apagado — inativar preserva o registro, que é a regra
 * da casa.
 */
async function pernaDeEscrita(pagina) {
  const marca = `SMOKE ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  await pagina.goto(`${BASE}/cadastros/clientes`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: /Novo cliente/ }).click();
  await pagina.locator("#customer-legal-name").waitFor();

  await pagina.locator("#customer-legal-name").fill(`${marca} LTDA`);

  // E-mail inválido: a recusa tem de vir da tela, sem ida ao servidor.
  await pagina.locator("#customer-email").fill("nao-e-email");
  await pagina.locator("#customer-legal-name").click();
  const erroEmail = await pagina
    .locator("#customer-email")
    .locator("xpath=ancestor::div[contains(@class,'field')][1]")
    .locator(".field__error")
    .isVisible()
    .catch(() => false);
  check("e-mail inválido recusado na tela", erroEmail);

  await pagina.locator("#customer-email").fill("smoke@veridi.demo");

  // Telefone curto: mesma prova, outro validador.
  await pagina.locator("#customer-phone").fill("119");
  await pagina.locator("#customer-legal-name").click();
  const erroTelefone = await pagina
    .locator("#customer-phone")
    .locator("xpath=ancestor::div[contains(@class,'field')][1]")
    .locator(".field__error")
    .isVisible()
    .catch(() => false);
  check("telefone curto recusado na tela", erroTelefone);

  await pagina.locator("#customer-phone").fill("11987654321");

  // CNPJ válido tem de passar — o validador não pode ser restritivo demais.
  await pagina.locator("#customer-cnpj").fill("11222333000181");
  await pagina.locator("#customer-legal-name").click();
  const erroCnpj = await pagina
    .locator("#customer-cnpj")
    .locator("xpath=ancestor::div[contains(@class,'field')][1]")
    .locator(".field__error")
    .isVisible()
    .catch(() => false);
  check("CNPJ válido aceito", !erroCnpj);

  // CEP preenche endereço. Depende do ViaCEP: falha aqui é rede, não regra —
  // e por isso o cadastro nunca é bloqueado por ela.
  await pagina.locator("#customer-zip").fill("01310100");
  await pagina.locator("#customer-legal-name").click();
  await pagina.waitForTimeout(2500);
  const cidade = await pagina.locator("#customer-city").inputValue();
  check("CEP preencheu o endereço", cidade.trim().length > 0, `cidade "${cidade}"`);

  await pagina.screenshot({ path: `${OUT}/prod-cliente-formulario.png` });

  await pagina.getByRole("button", { name: /Criar cliente/ }).click();
  await pagina.waitForTimeout(2500);

  const criado = await get(`/customers?search=${encodeURIComponent(marca)}&page=1&pageSize=5`);
  const cliente = (criado.corpo?.customers ?? [])[0];
  check("cliente criado em produção", Boolean(cliente), `busca por "${marca}"`);
  if (!cliente) return;

  // Autoria: o ponto da rodada do cadastro de Cliente. Sem sessão real ela
  // nunca tinha sido verificada em produção.
  check(
    "autoria gravada a partir do usuário autenticado",
    Boolean(cliente.createdByName),
    `createdByName ${JSON.stringify(cliente.createdByName)}`,
  );

  await pagina.goto(`${BASE}/cadastros/clientes?search=${encodeURIComponent(marca)}`, {
    waitUntil: "networkidle",
  });
  await pagina.screenshot({ path: `${OUT}/prod-cliente-criado.png` });

  // Sai pelo fluxo oficial: inativar, nunca apagar.
  await pagina.getByRole("row", { name: new RegExp(marca) }).getByRole("button").last().click();
  await pagina.getByText("Inativar", { exact: true }).click();
  await pagina.getByRole("button", { name: "Inativar", exact: true }).click();
  await pagina.waitForTimeout(2000);

  const depois = await get(`/customers?search=${encodeURIComponent(marca)}&page=1&pageSize=5`);
  const inativado = (depois.corpo?.customers ?? [])[0];
  check(
    "cliente do smoke inativado pelo fluxo oficial",
    inativado?.active === false,
    `active ${inativado?.active}`,
  );
  await pagina.screenshot({ path: `${OUT}/prod-cliente-inativado.png` });
  console.log(`       cliente do smoke: ${cliente.code} — ${marca} (inativo)`);
}

main()
  .catch((erro) => {
    // Mensagem de erro de driver de banco ou de fetch pode carregar a URL
    // com credencial embutida; nunca imprima o original sem limpar.
    const limpo = String(erro.message ?? erro).replace(/(postgres(?:ql)?:\/\/|:\/\/)[^\s"']+/g, "$1<omitido>");
    falhas.push(`erro não tratado: ${limpo}`);
  })
  .finally(() => {
    console.log("\n=== Resultado ===");
    if (falhas.length === 0) {
      console.log("smoke autenticado em produção: tudo passou");
    } else {
      console.log(`${falhas.length} falha(s):`);
      for (const falha of falhas) console.log("  -", falha);
      process.exitCode = 1;
    }
  });
