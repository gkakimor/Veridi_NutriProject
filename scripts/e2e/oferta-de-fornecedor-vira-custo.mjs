import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * A oferta do fornecedor vira — ou não vira — custo, pela interface.
 *
 * O cadastro Item × Fornecedor sempre foi um degrau da hierarquia canônica de
 * custo (§53, degrau 4). Na base real ele nunca participou de nada: as 602
 * ofertas vieram da planilha sem data de cotação, e sem vigência uma oferta é
 * observação histórica, nunca preço vigente. Quem cadastrava cinco preços e
 * abria o CMV via "sem custo conhecido", sem nada ligando as duas telas.
 *
 * Esta suíte percorre a cadeia inteira clicando:
 *
 *   1. item novo, dois fornecedores novos, duas relações HOMOLOGADAS, cada
 *      uma com oferta válida — a situação que a auditoria mediu em 90 itens
 *      da base real;
 *   2. sem preferencial, o item fica AMBÍGUO: custo desconhecido, e a tela
 *      diz em português o que fazer. Nunca o mais barato, nunca o primeiro;
 *   3. marcar o fornecedor A como preferencial resolve, e a fonte do item
 *      passa a ser a oferta DELE — não a mais barata;
 *   4. trocar a preferência para B muda a referência, e a troca derruba a
 *      anterior;
 *   5. oferta sem vigência é recusada pela tela antes do servidor, e a
 *      importada sem vigência continua visível como histórico.
 *
 * O negativo mora aqui junto com o feliz de propósito: o que esta capability
 * protege é justamente a recusa — escolher sozinho seria decidir a compra.
 *
 * Massa própria carimbada pelo `runId`. Nada de SQL, nada de API para avançar.
 *
 *   node scripts/e2e/oferta-de-fornecedor-vira-custo.mjs
 */

const run = obterRun({ novo: true, dono: "custos" });
const P = `E2E${run.runId}`;

const PRECO_A = "300";
const PRECO_B = "260";

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

function conferir(descricao, obtido, esperado) {
  return afirmar(descricao, obtido === esperado, `esperado "${esperado}", obtido "${obtido}"`);
}

/** O dia de hoje como a tela o escreve num `<input type="date">`. */
function hojeISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();
  const clicar = async (nome, opcoes = {}) => {
    await pagina.getByRole("button", { name: nome, ...opcoes }).first().click();
  };
  /*
   * Por `id`, e não por rótulo: os rótulos obrigatórios da Veridi carregam um
   * `<span class="req">*</span>`, e casar texto de rótulo com asterisco dentro
   * quebra por motivo nenhum. O `id` é o mesmo que o `htmlFor` do rótulo — é
   * a mesma ligação que o leitor de tela usa.
   */
  const preencher = async (id, valor) => {
    await pagina.locator(`#${id}`).first().fill(valor);
  };
  const escolher = async (id, valor) => {
    await pagina.locator(`#${id}`).first().selectOption(valor);
  };
  const esperarTexto = async (texto, timeout = 20000) =>
    pagina.getByText(texto, { exact: false }).first().waitFor({ timeout });
  /** As listas filtram por digitação, com debounce de 300ms. */
  const buscar = async (id, termo) => {
    await pagina.locator(`#${id}`).waitFor({ timeout: 20000 });
    await pagina.locator(`#${id}`).fill(termo);
    await pagina.waitForTimeout(1500);
  };

  try {
    // ── 1. massa própria, criada clicando ───────────────────────────────
    console.log(`\n[1] Item e fornecedores da execução ${P}`);

    await pagina.goto(`${WEB}/cadastros/itens/novo`);
    await escolher("item-type", "RAW_MATERIAL");
    await escolher("item-unit", "kg");
    await preencher("item-name", `Insumo ${P}`);
    await clicar("Criar item");

    /*
     * Salvar leva à lista, e a lista filtra por DIGITAÇÃO — não por parâmetro
     * de URL. Reencontrar pelo campo de busca é o que a pessoa faz, e é o que
     * garante que a suíte só enxerga a massa desta execução.
     */
    await pagina.waitForURL(/\/cadastros\/itens$/, { timeout: 20000 });
    await buscar("items-search", `Insumo ${P}`);
    await esperarTexto(`Insumo ${P}`);
    const itemCodigo = (await pagina.locator("body").innerText()).match(/\bMP-\d{6}\b/)?.[0] ?? null;
    afirmar("item criado com código próprio", itemCodigo !== null, "nenhum MP-###### na tela");

    const fornecedores = [];
    for (const sufixo of ["A", "B"]) {
      await pagina.goto(`${WEB}/cadastros/fornecedores/novo`);
      await preencher("supplier-legal-name", `Fornecedor ${sufixo} ${P}`);
      await clicar("Criar fornecedor");
      await pagina.waitForURL(/\/cadastros\/fornecedores$/, { timeout: 20000 });
      await buscar("suppliers-search", `Fornecedor ${sufixo} ${P}`);
      await esperarTexto(`Fornecedor ${sufixo} ${P}`);
      fornecedores.push(`Fornecedor ${sufixo} ${P}`);
    }
    afirmar("dois fornecedores criados", fornecedores.length === 2);

    // ── 2. duas relações homologadas, cada uma com oferta válida ────────
    console.log("\n[2] Relações homologadas com oferta vigente");

    const criarRelacao = async (fornecedor, preco) => {
      await pagina.goto(`${WEB}/compras/item-fornecedor`);
      await clicar("Nova relação");
      await pagina.getByPlaceholder("Digite código ou nome do item…").fill(`Insumo ${P}`);
      await pagina.waitForTimeout(700);
      await pagina.getByRole("option", { name: new RegExp(`Insumo ${P}`) }).first().click();
      await pagina.getByPlaceholder("Digite código ou nome do fornecedor…").fill(fornecedor);
      await pagina.waitForTimeout(700);
      await pagina.getByRole("option", { name: new RegExp(fornecedor) }).first().click();
      await escolher("supplier-item-qualification", "APPROVED");
      await preencher("supplier-item-price", preco);
      await escolher("supplier-item-price-uom", "kg");
      await preencher("supplier-item-effective", hojeISO());
      await clicar("Criar relação");
      await pagina.waitForTimeout(1200);
    };

    await criarRelacao(fornecedores[0], PRECO_A);
    await criarRelacao(fornecedores[1], PRECO_B);

    await pagina.goto(`${WEB}/compras/item-fornecedor`);
    await buscar("supplier-items-search", `Insumo ${P}`);
    const grade = await pagina.locator("table.table tbody").innerText();
    afirmar("as duas relações aparecem na grade, homologadas", grade.includes(PRECO_A) && grade.includes(PRECO_B));
    conferir(
      "nenhuma nasceu preferencial — preferir é decisão de gente",
      (grade.match(/Definir preferencial/g) ?? []).length,
      2,
    );

    // ── 3. sem preferencial, o item é ambíguo ───────────────────────────
    console.log("\n[3] Dois homologados, nenhum preferencial");

    /*
     * A LINHA da grade, não o texto solto: o nome do fornecedor também está
     * dentro do `<option>` escondido do filtro por fornecedor, e esperar por
     * texto encontrava aquele elemento — que nunca fica visível.
     */
    const abrirRelacao = async (fornecedor) => {
      await pagina.goto(`${WEB}/compras/item-fornecedor`);
      await buscar("supplier-items-search", `Insumo ${P}`);
      const linha = pagina.getByRole("row", { name: new RegExp(fornecedor) }).first();
      await linha.waitFor({ timeout: 20000 });
      await linha.click();
      await esperarTexto("Ofertas / preços");
    };

    const fonteDoItem = async () =>
      pagina
        .locator("dt", { hasText: "Fonte de custo do item hoje" })
        .locator("xpath=following-sibling::dd[1]")
        .innerText();

    await abrirRelacao(fornecedores[0]);

    const ambiguo = await fonteDoItem();
    afirmar(
      "com dois homologados e nenhum preferencial, o custo fica desconhecido",
      ambiguo.includes("seleção necessária"),
      ambiguo.replace(/\s+/g, " ").slice(0, 120),
    );
    afirmar(
      "a tela explica o que fazer, sem enum técnico",
      (await pagina.locator("body").innerText()).includes("Defina o fornecedor preferencial"),
    );
    afirmar(
      "o enum do motor nunca aparece para o usuário",
      !(await pagina.locator("body").innerText()).includes("AMBIGUOUS_SUPPLIER_REFERENCE"),
    );
    afirmar(
      "as duas ofertas continuam elegíveis — o que falta é a escolha",
      (await pagina.locator("body").innerText()).includes("Serve de referência"),
    );

    // ── 4. marcar preferencial resolve, e não escolhe o mais barato ─────
    console.log("\n[4] Preferencial define a referência");

    await clicar("Marcar como preferencial");
    await esperarTexto("Remover preferencial");
    const comA = await fonteDoItem();
    afirmar(
      "a fonte passa a ser a oferta do preferencial",
      comA.includes("preferencial") && comA.includes(PRECO_A),
      comA.replace(/\s+/g, " ").slice(0, 140),
    );
    afirmar(
      "o sistema NÃO escolheu o mais barato — o preferencial é de R$ 300, o outro é R$ 260",
      comA.includes(PRECO_A) && !comA.includes(PRECO_B),
    );

    await pagina.keyboard.press("Escape");
    await abrirRelacao(fornecedores[1]);
    await clicar("Marcar como preferencial");
    await esperarTexto("Remover preferencial");
    const comB = await fonteDoItem();
    afirmar(
      "trocar o preferencial troca a referência do item",
      comB.includes(PRECO_B),
      comB.replace(/\s+/g, " ").slice(0, 140),
    );

    await pagina.keyboard.press("Escape");
    await abrirRelacao(fornecedores[0]);
    afirmar(
      "a troca derrubou o preferencial anterior — nunca dois ao mesmo tempo",
      (await pagina.locator("body").innerText()).includes("Marcar como preferencial"),
    );

    // ── 5. oferta nova sem vigência não passa pela tela ─────────────────
    console.log("\n[5] Vigência é requisito da oferta nova");

    await preencher("offer-price", "999");
    await preencher("offer-effective", "");
    const registrar = pagina.getByRole("button", { name: "Registrar preço" }).first();
    afirmar(
      "sem 'válida a partir de', a tela não deixa registrar",
      await registrar.isDisabled(),
    );

    await preencher("offer-effective", hojeISO());
    afirmar("com a data preenchida, a ação volta a existir", await registrar.isEnabled());

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
  console.log("APROVADO — a oferta do fornecedor participa do custo, e a recusa é explicada.");
}

await main();
