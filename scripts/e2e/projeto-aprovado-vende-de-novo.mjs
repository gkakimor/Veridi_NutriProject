import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O mesmo projeto vende duas vezes — pela interface, do zero.
 *
 * A regra antiga travava `createQuoteVersion` em projeto `APPROVED`, e a tela
 * mandava criar um projeto novo para o mesmo cliente. Recompra multiplicava o
 * cadastro pelo calendário, e a segunda venda perdia a história técnica da
 * primeira.
 *
 * Esta suíte percorre dois ciclos clicando:
 *
 *   1. projeto novo → produto técnico → orçamento → validade → enviar →
 *      aceitar → aprovar projeto → PEDIDO 1;
 *   2. MESMO projeto, já aprovado → "Novo orçamento" → validade → enviar →
 *      aceitar → PEDIDO 2.
 *
 * E prova o que o PO pediu: nenhum projeto novo, dois orçamentos distintos,
 * dois Pedidos distintos, cada Pedido apontando para a sua proposta, e a
 * primeira aceita continuando ACEITA — ela é a origem do Pedido 1.
 *
 * O terceiro cenário é a validade: um orçamento com data passada é enviado e
 * a tela recusa o aceite, dizendo "Vencido" e a data. Nada de SQL, nada de
 * relógio adulterado — a data vencida é digitada no próprio campo.
 *
 *   node scripts/e2e/projeto-aprovado-vende-de-novo.mjs
 */

/** Cliente real do catálogo — a suíte não cria cliente, cria o projeto dele. */
const CLIENTE = "CLI-000013";
const QUANTIDADE = "100";
const PRECO_CICLO_1 = "12,50";
const PRECO_CICLO_2 = "13,90";
const VALIDADE_FUTURA = "2099-12-31";
const VALIDADE_VENCIDA = "2020-01-31";

const run = obterRun({ novo: true, dono: "com-core" });

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

const { pagina, erros, fechar } = await abrirNavegador();
const respostas = [];
pagina.on("response", (r) => respostas.push({ status: r.status(), url: r.url() }));

/** A tabela de versões, como a pessoa a lê. */
async function lerVersoes() {
  return pagina.evaluate(() => {
    const tabela = [...document.querySelectorAll("table")].find((t) =>
      /Versão/.test(t.querySelector("thead")?.textContent ?? ""),
    );
    if (!tabela) return [];
    return [...tabela.querySelectorAll("tbody tr")].map((tr) => {
      const celulas = [...tr.children].map((td) => td.textContent.trim().replace(/\s+/g, " "));
      return { versao: celulas[0] ?? "", validade: celulas[4] ?? "", status: celulas[5] ?? "" };
    });
  });
}

async function clicar(nome, { exact = true } = {}) {
  await pagina.getByRole("button", { name: nome, exact }).first().click();
}

/**
 * O Pedido aberto: id da rota e código na tela.
 *
 * Ler o código antes de a tela terminar de montar devolvia `null` — daí a
 * espera explícita pelo padrão do código, e não por um tempo fixo.
 */
async function pedidoAberto() {
  /*
   * A rota troca ANTES de a tela do Pedido montar, e por um instante a URL
   * ja e a nova enquanto o DOM ainda e o do Projeto — que tambem imprime um
   * codigo PED na coluna "originou". Esperar so pelo padrao lia a pagina
   * anterior. A espera exige a tela do Pedido de verdade: sem os botoes do
   * Projeto, e com o codigo ja renderizado.
   */
  await pagina.waitForFunction(
    () => {
      const texto = document.body.innerText;
      const noProjeto = /Novo orçamento|Criar nova versão|Abrir rascunho/.test(texto);
      return (
        location.pathname.includes("/comercial/pedidos/") &&
        !noProjeto &&
        /PED-\d{6}/.test(texto)
      );
    },
    { timeout: 30000 },
  );
  return pagina.evaluate(() => ({
    id: location.pathname.split("/").pop(),
    codigo: document.body.innerText.match(/PED-\d{6}/)?.[0] ?? null,
    origem: document.body.innerText.match(/ORC-\d{6} · V\d+/)?.[0] ?? null,
  }));
}

async function esperarTexto(texto, timeout = 20000) {
  await pagina.waitForFunction(
    (alvo) => document.body.innerText.includes(alvo),
    texto,
    { timeout },
  );
}

/**
 * Informa a validade e GRAVA as condições.
 *
 * O botão de enviar lê o que está gravado, não o que está digitado — por isso
 * ele continua bloqueado até "Salvar condições". É o comportamento correto: a
 * validade é do documento, não do formulário.
 */
async function definirValidade(valor) {
  await pagina.locator("#quote-valid-until").fill(valor);
  await pagina.locator("#quote-valid-until").blur();
  await pagina.waitForTimeout(300);
  await clicar("Salvar condições");
  await pagina.waitForTimeout(900);
}

/** Envia a proposta aberta, passando pelo diálogo de confirmação. */
async function enviarProposta() {
  await clicar("Enviar ao cliente");
  await pagina.waitForTimeout(300);
  const confirmar = pagina.getByRole("button", { name: /Enviar mesmo assim|Enviar ao cliente/ });
  await confirmar.last().click();
  await esperarTexto("Enviado");
}

try {
  console.log(`\n== ciclo 1 — projeto novo (${run.runId})`);

  await pagina.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
  await clicar("Novo projeto");
  await pagina.waitForSelector("#project-customer");
  await pagina.fill("#project-customer", CLIENTE);
  await pagina.waitForTimeout(600);
  await pagina.keyboard.press("ArrowDown");
  await pagina.keyboard.press("Enter");
  await pagina.fill("#project-name", `Recompra ${run.runId}`);
  await clicar("Criar projeto", { exact: false });
  await pagina.waitForFunction(() => /\/comercial\/projetos\/[0-9a-f-]{10,}/.test(location.pathname), {
    timeout: 20000,
  });

  const urlDoProjeto = pagina.url();
  console.log(`  projeto: ${urlDoProjeto}`);

  // Produto técnico: sem ele não há o que orçar.
  await pagina.waitForSelector("#technical-unit");
  await pagina.fill("#technical-unit", "un");
  await clicar("Preparar produto técnico");
  await esperarTexto("Produto");

  // Orçamento V1.
  await clicar("Criar nova versão");
  await pagina.waitForTimeout(800);
  await pagina.waitForSelector("#quote-add-product");
  await pagina.selectOption("#quote-add-product", { index: 1 });
  await clicar("Adicionar");
  await pagina.waitForTimeout(800);

  const campoQuantidade = pagina.locator('input[aria-label^="Quantidade de"]').first();
  await campoQuantidade.fill(QUANTIDADE);
  await campoQuantidade.blur();
  const campoPreco = pagina.locator('input[aria-label^="Preço unitário de"]').first();
  await campoPreco.fill(PRECO_CICLO_1);
  await campoPreco.blur();
  await pagina.waitForTimeout(600);

  await definirValidade(VALIDADE_FUTURA);
  await enviarProposta();
  await clicar("Registrar aceite");
  await esperarTexto("Aceito");

  await clicar("Aprovar projeto");
  await pagina.waitForTimeout(600);
  await clicar("Aprovar");
  await esperarTexto("Aprovado");

  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/pedidos/"), {
    timeout: 20000,
  });
  const pedido1 = await pedidoAberto();
  afirmar("ciclo 1 gerou um Pedido", pedido1.codigo !== null, pedido1.codigo ?? "");

  console.log("\n== ciclo 2 — o MESMO projeto, já aprovado");
  await pagina.goto(urlDoProjeto, { waitUntil: "networkidle" });
  await esperarTexto("Aprovado");

  const temBotaoNovo = await pagina.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Novo orçamento"),
  );
  afirmar("projeto aprovado oferece “Novo orçamento”", temBotaoNovo);
  afirmar(
    "e não manda mais criar outro projeto",
    !(await pagina.evaluate(() => document.body.innerText.includes("crie um projeto novo"))),
  );

  await clicar("Novo orçamento");
  await pagina.waitForTimeout(1000);

  // A versão nova nasce com a linha da anterior: só o preço é renegociado.
  const precoCiclo2 = pagina.locator('input[aria-label^="Preço unitário de"]').first();
  await precoCiclo2.fill(PRECO_CICLO_2);
  await precoCiclo2.blur();
  await pagina.waitForTimeout(600);

  await definirValidade(VALIDADE_FUTURA);
  await enviarProposta();
  await clicar("Registrar aceite");
  await pagina.waitForTimeout(800);

  const versoesDepois = await lerVersoes();
  afirmar("o projeto tem duas versões", versoesDepois.length >= 2, JSON.stringify(versoesDepois));
  afirmar(
    "a V1 continua ACEITA — ela é a origem do Pedido 1",
    versoesDepois[0]?.status.includes("Aceito") === true,
    versoesDepois[0]?.status ?? "",
  );
  afirmar(
    "e diz qual Pedido originou",
    versoesDepois[0]?.status.includes(pedido1.codigo ?? "PED-") === true,
    versoesDepois[0]?.status ?? "",
  );

  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/pedidos/"), {
    timeout: 20000,
  });
  const pedido2 = await pedidoAberto();

  afirmar("ciclo 2 gerou um Pedido próprio", pedido2.codigo !== null, pedido2.codigo ?? "");
  afirmar(
    "os dois Pedidos são diferentes",
    pedido1.id !== pedido2.id && pedido1.codigo !== pedido2.codigo,
    `${pedido1.codigo} × ${pedido2.codigo}`,
  );
  afirmar(
    "e cada Pedido aponta para a SUA proposta",
    pedido1.origem !== null && pedido2.origem !== null && pedido1.origem !== pedido2.origem,
    `${pedido1.origem} × ${pedido2.origem}`,
  );

  console.log("\n== cenário 3 — proposta vencida não é aceita");
  await pagina.goto(urlDoProjeto, { waitUntil: "networkidle" });
  await clicar("Novo orçamento");
  await pagina.waitForTimeout(1000);
  await definirValidade(VALIDADE_VENCIDA);
  await enviarProposta();
  await pagina.waitForTimeout(600);

  const vencida = await pagina.evaluate(() => {
    const aceite = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Registrar aceite",
    );
    return {
      dizVencido: document.body.innerText.includes("Vencido"),
      explica: document.body.innerText.includes("janela de aceite fechou"),
      aceiteBloqueado: aceite ? aceite.disabled : null,
    };
  });

  afirmar("a proposta vencida se identifica na tela", vencida.dizVencido);
  afirmar("com a explicação do que fazer", vencida.explica);
  afirmar("e o aceite fica bloqueado", vencida.aceiteBloqueado === true);

  console.log("\n-- console e rede");
  afirmar("console limpo", erros.length === 0, erros.join(" | "));
  const servidor = respostas.filter((r) => r.status >= 500);
  afirmar("nenhuma resposta 5xx", servidor.length === 0, servidor.map((r) => r.url).join(" "));
} finally {
  await fechar();
}

console.log("");
if (falhas.length > 0) {
  console.log(`REPROVADO — ${falhas.length} verificação(ões):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("APROVADO — o mesmo projeto vendeu duas vezes, e a proposta vencida não foi aceita.");
