import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * A tela diz para QUAL quantidade ela calculou — COST-BASIS-UX-01.
 *
 * No walkthrough real de 2026-09-09 a base de produção do produto era 300
 * unidades e a tela destacava "custo por 1.000". A usuária não soube dizer se
 * o sistema havia calculado 300 ou 1.000. Enquanto essa dúvida existe, nenhum
 * número de custo sustenta decisão.
 *
 * A auditoria do motor veio primeiro e provou que a matemática estava certa
 * (`apps/api/src/modules/industrial-cost-calculation/cost-basis-scale.test.ts`,
 * em 200, 300, 500 e 1.000, com recurso fixo por lote, recurso proporcional,
 * energia e caixa inteira). O defeito era de apresentação: um total e uma
 * razão exibidos com o mesmo peso, sem dizer qual é qual.
 *
 * Esta suíte monta a cadeia inteira clicando — cliente, item com custo de
 * referência, produto com caixa de 120, formulação ativa, estrutura de base
 * 300 com recurso fixo por lote, energia e premissas, cálculo salvo — e então
 * afirma, na interface:
 *
 *   1. o CMV de 300 mostra a quantidade calculada JUNTO do total;
 *   2. o custo por unidade é o total daquela quantidade dividido por ela;
 *   3. o "por 1.000" aparece rotulado como EQUIVALENTE e visualmente
 *      secundário, com a ressalva de que não é um novo cálculo;
 *   4. nenhum texto da tela sugere que o cálculo foi feito para 1.000;
 *   5. o cálculo REAL de 1.000 sobre a mesma base custa MAIS que o
 *      equivalente por 1.000 da execução de 300 — que é exatamente a razão
 *      de a copy existir.
 *
 * Massa própria, carimbada pelo `runId`. Nada de SQL, nada de API para
 * avançar o negócio: a API só é usada pelo navegador, como a pessoa a usa.
 *
 *   node scripts/e2e/base-calculada-e-equivalente-por-mil.mjs
 */

const run = obterRun({ novo: true, dono: "custos" });
const P = `E2E${run.runId}`;

/** Base de produção do walkthrough. */
const BASE = "300";
const UNIDADES_POR_CAIXA = "120";

/*
 * Premissas escolhidas para que o custo NÃO seja linear — se fosse, a
 * diferença entre "equivalente por 1.000" e "produzir 1.000" desapareceria e
 * a suíte aprovaria sem provar nada.
 *
 *   material     0,01 kg/un × R$ 10,00/kg = R$ 0,10 por unidade
 *   mão de obra  2 h por lote × R$ 30,00/h = R$ 60,00 por LOTE
 *   energia      15 kWh por lote × R$ 0,80 = R$ 12,00 por LOTE
 *   setup        R$ 45,00 por LOTE
 *   caixa        R$ 1,00 por caixa de 120 unidades, sempre inteira
 *
 * 300 un = 1 lote e 3 caixas → 30 + 60 + 12 + 45 + 3 = R$ 150,00
 *          por unidade R$ 0,50 · equivalente por 1.000 R$ 500,00
 * 1000 un = 4 lotes e 9 caixas → 100 + 240 + 48 + 180 + 9 = R$ 577,00
 */
const CUSTO_MATERIAL_KG = "10";
const QUANTIDADE_POR_UNIDADE = "0.01";
const TARIFA_MAO_DE_OBRA = "30";
const HORAS_POR_LOTE = "2";
const TARIFA_ENERGIA = "0.80";
const KWH_POR_LOTE = "15";
const SETUP_POR_LOTE = "45";
const CUSTO_DA_CAIXA = "1";

const TOTAL_300 = 150;
const UNITARIO_300 = 0.5;
const EQUIVALENTE_1000_DA_EXECUCAO_DE_300 = 500;
const TOTAL_1000 = 577;

const EQUIVALENTE = "Equivalente por 1.000 un";

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

/** "R$ 150,00" → 150. Só para conferir a aritmética do que a tela mostra. */
function numeroDe(texto) {
  if (!texto) return null;
  const limpo = texto.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/** Tolerância de meio centavo: a tela mostra duas casas. */
function bate(obtido, esperado) {
  return obtido !== null && Math.abs(obtido - esperado) < 0.005;
}

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  const clicar = async (nome, opcoes = {}) =>
    pagina.getByRole("button", { name: nome, ...opcoes }).first().click();
  const preencher = async (id, valor) => pagina.locator(`#${id}`).first().fill(valor);
  const escolher = async (id, valor) => pagina.locator(`#${id}`).first().selectOption(valor);
  const esperarTexto = async (texto, timeout = 25000) =>
    pagina.getByText(texto, { exact: false }).first().waitFor({ timeout });
  const buscar = async (id, termo) => {
    await pagina.locator(`#${id}`).waitFor({ timeout: 25000 });
    await pagina.locator(`#${id}`).fill(termo);
    await pagina.waitForTimeout(1500);
  };
  /** Selector de entidade: digita, espera a busca e escolhe a opção. */
  const selecionar = async (id, termo) => {
    await pagina.locator(`#${id}`).first().fill(termo);
    await pagina.waitForTimeout(900);
    await pagina.getByRole("option", { name: new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  };

  try {
    // ── 1. cliente, item com custo, produto ─────────────────────────────
    console.log(`\n[1] Massa da execução ${P}`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await preencher("customer-legal-name", `Cliente ${P}`);
    await clicar("Criar cliente");
    await pagina.waitForURL(/\/cadastros\/clientes$/, { timeout: 25000 });

    await pagina.goto(`${WEB}/cadastros/itens/novo`);
    await escolher("item-type", "RAW_MATERIAL");
    await escolher("item-unit", "kg");
    await preencher("item-name", `Insumo ${P}`);
    // Custo de referência declarado: o CMV existe antes da primeira compra.
    await preencher("item-initial-cost-reference", CUSTO_MATERIAL_KG);
    await clicar("Criar item");
    await pagina.waitForURL(/\/cadastros\/itens$/, { timeout: 25000 });
    await buscar("items-search", `Insumo ${P}`);
    await esperarTexto(`Insumo ${P}`);

    await pagina.goto(`${WEB}/cadastros/produtos/novo`);
    await selecionar("product-customer", `Cliente ${P}`);
    await preencher("product-name", `Produto ${P}`);
    await escolher("product-finished-unit", "un");
    await preencher("product-units-per-box", UNIDADES_POR_CAIXA);
    await clicar("Criar produto");
    await pagina.waitForURL(/\/cadastros\/produtos$/, { timeout: 25000 });
    await buscar("products-search", `Produto ${P}`);
    await esperarTexto(`Produto ${P}`);
    /*
     * O produto se abre pela ação da própria linha — é o caminho da pessoa, e
     * é ele que devolve o id na URL. A lista não tem rota de detalhe.
     */
    const linhaProduto = pagina.getByRole("row", { name: new RegExp(`Produto ${P}`) }).first();
    await linhaProduto.waitFor({ timeout: 25000 });
    await linhaProduto.locator("button").last().click();
    await pagina.getByText("Custos industriais", { exact: true }).first().click();
    await pagina.waitForURL(/\/produtos\/[0-9a-f-]{36}\/custos/, { timeout: 25000 });
    const produtoId = pagina.url().match(/\/produtos\/([0-9a-f-]{36})\/custos/)?.[1] ?? null;
    afirmar("produto criado e aberto pelo próprio id", produtoId !== null, pagina.url());

    // ── 2. formulação ativa ─────────────────────────────────────────────
    console.log("\n[2] Formulação com 0,01 kg por unidade acabada");

    await pagina.goto(`${WEB}/producao/formulacoes/${produtoId}`);
    await clicar("Criar formulação em branco");
    await pagina.waitForURL(/\/versoes\/[0-9a-f-]{36}/, { timeout: 25000 });

    await preencher("version-basis", "1");
    await clicar("+ Adicionar componente");
    const seletorDoComponente = pagina.locator('[id^="componente-component-"]').first();
    await seletorDoComponente.fill(`Insumo ${P}`);
    await pagina.waitForTimeout(1200);
    await pagina.getByRole("option", { name: new RegExp(`Insumo ${P}`) }).first().click();
    // O nome acessível do campo carrega o CÓDIGO do item, que só a sequência
    // do domínio conhece — a linha é a única da tabela, então o prefixo basta.
    await pagina
      .locator('input[aria-label^="Quantidade de "]')
      .first()
      .fill(QUANTIDADE_POR_UNIDADE);
    await clicar("Salvar rascunho");
    await pagina.waitForTimeout(1800);
    // Ativar abre confirmação — ativar é o passo que torna a receita histórica.
    await clicar("Ativar versão");
    await pagina.getByRole("button", { name: "Ativar", exact: true }).first().click();
    await pagina
      .getByRole("button", { name: "Criar nova versão a partir desta" })
      .or(pagina.locator(".badge--active", { hasText: "Ativa" }))
      .first()
      .waitFor({ timeout: 25000 })
      .catch(() => {});
    await pagina.waitForTimeout(1200);
    const statusDaVersao = await pagina.locator(".badge--active").first().innerText().catch(() => "");
    afirmar("formulação ativada pela interface", /Ativa/i.test(statusDaVersao), `"${statusDaVersao}"`);

    // ── 3. recursos industriais com tarifa ──────────────────────────────
    console.log("\n[3] Mão de obra e energia com tarifa vigente");

    const criarRecurso = async (tipo, nome, tarifa) => {
      await pagina.goto(`${WEB}/gestao/recursos-industriais/novo`);
      await preencher("resource-name", nome);
      await escolher("resource-type", tipo);
      await clicar("Criar recurso");
      await pagina.waitForURL(/\/gestao\/recursos-industriais(\/[0-9a-f-]{36})?$/, { timeout: 25000 });
      if (!/\/recursos-industriais\/[0-9a-f-]{36}$/.test(pagina.url())) {
        await buscar("industrial-resources-search", nome);
        await pagina.getByRole("row", { name: new RegExp(nome) }).first().click();
        await pagina.waitForURL(/\/recursos-industriais\/[0-9a-f-]{36}$/, { timeout: 25000 });
      }
      await preencher("rate-value", tarifa);
      await clicar("Registrar tarifa");
      await pagina.waitForTimeout(1200);
    };

    await criarRecurso("LABOR", `Operador ${P}`, TARIFA_MAO_DE_OBRA);
    await criarRecurso("ENERGY", `Energia ${P}`, TARIFA_ENERGIA);

    // ── 4. estrutura de base 300 ────────────────────────────────────────
    console.log(`\n[4] Estrutura de custos com base de produção ${BASE}`);

    await pagina.goto(`${WEB}/produtos/${produtoId}/custos`);
    await preencher("new-reference-output", BASE);
    await clicar("Criar estrutura de custos");
    await esperarTexto("Rascunho");

    const adicionarRecurso = async (nome, quantidade) => {
      await selecionar("usage-resource", nome);
      await preencher("usage-quantity", quantidade);
      await clicar("Adicionar recurso");
      await pagina.waitForTimeout(1200);
    };
    await adicionarRecurso(`Operador ${P}`, HORAS_POR_LOTE);

    /*
     * O modo vem ANTES do consumo, e isso é da tela: fora do modo direto o
     * recurso de energia nem é oferecido, para não induzir dupla contagem.
     */
    await escolher("energy-mode", "DIRECT");
    await pagina.waitForTimeout(1500);
    await adicionarRecurso(`Energia ${P}`, KWH_POR_LOTE);

    const adicionarPremissa = async (categoria, descricao, base, valor) => {
      await escolher("cost-category", categoria);
      await preencher("cost-description", descricao);
      await escolher("cost-basis", base);
      await preencher("cost-rate", valor);
      await clicar("Adicionar premissa");
      await pagina.waitForTimeout(1200);
    };
    await adicionarPremissa("THIRD_PARTY_SERVICE", `Setup ${P}`, "FIXED_PER_BATCH", SETUP_POR_LOTE);
    await adicionarPremissa(
      "SECONDARY_PACKAGING",
      `Caixa ${P}`,
      "PER_SHIPPING_BOX",
      CUSTO_DA_CAIXA,
    );

    /*
     * Ativar sem pendência não abre diálogo. Se abrir, a estrutura está
     * incompleta — e uma estrutura incompleta não produz total nenhum, então
     * esta suíte reprova em vez de seguir com "subtotal conhecido".
     */
    await clicar("Ativar estrutura");
    await pagina.waitForTimeout(1500);
    const dialogoDePendencia = await pagina
      .locator(".confirm-dialog")
      .first()
      .innerText()
      .catch(() => "");
    afirmar(
      "a estrutura ativa sem pendência — premissas, recurso e energia informados",
      !/pend/i.test(dialogoDePendencia),
      dialogoDePendencia.replace(/\s+/g, " ").slice(0, 200),
    );
    await esperarTexto("Ativa");

    // ── 5. cálculo salvo ────────────────────────────────────────────────
    console.log("\n[5] Cálculo salvo — o documento que o CMV lê");

    await clicar("Calcular custo");
    await esperarTexto("Custo industrial total para");

    const detalhe = await pagina.evaluate(() => {
      const rotulos = [...document.querySelectorAll(".definition-list dt")];
      const valorDe = (regex) => {
        const dt = rotulos.find((d) => regex.test(d.textContent ?? ""));
        return dt?.nextElementSibling?.textContent?.trim() ?? null;
      };
      const secundario = rotulos.find((d) => d.classList.contains("is-secondary"));
      return {
        quantidade: valorDe(/^Quantidade calculada$/),
        total: valorDe(/^Custo industrial total para /),
        rotuloDoTotal: rotulos.find((d) => /^Custo industrial total para /.test(d.textContent ?? ""))?.textContent?.trim() ?? null,
        unitario: valorDe(/^Custo por unidade$/),
        rotuloSecundario: secundario?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        valorSecundario: secundario?.nextElementSibling?.textContent?.trim() ?? null,
        secundarioTemClasse: secundario?.nextElementSibling?.classList.contains("is-secondary") ?? false,
        temRotuloAmbiguo: rotulos.some((d) => /^Custo por 1\.000 unidades$/.test(d.textContent ?? "")),
      };
    });

    afirmar(
      "o detalhamento ancora a quantidade calculada",
      detalhe.quantidade?.startsWith(BASE),
      `"${detalhe.quantidade}"`,
    );
    afirmar(
      "o rótulo do total diz de QUANTO ele é",
      (detalhe.rotuloDoTotal ?? "").includes(`${BASE} un`),
      `"${detalhe.rotuloDoTotal}"`,
    );
    afirmar(
      `o custo industrial total de ${BASE} un é R$ ${TOTAL_300.toFixed(2)}`,
      bate(numeroDe(detalhe.total), TOTAL_300),
      `"${detalhe.total}"`,
    );
    afirmar(
      "o custo por unidade é o total dividido pela quantidade calculada",
      bate(numeroDe(detalhe.unitario), UNITARIO_300),
      `"${detalhe.unitario}" · conta independente ${TOTAL_300} ÷ ${BASE} = ${UNITARIO_300}`,
    );
    afirmar(
      "o por 1.000 do detalhamento se apresenta como equivalência, e secundário",
      (detalhe.rotuloSecundario ?? "").includes(EQUIVALENTE) && detalhe.secundarioTemClasse,
      `"${detalhe.rotuloSecundario}"`,
    );
    afirmar(
      "o rótulo ambíguo 'Custo por 1.000 unidades' não existe mais",
      detalhe.temRotuloAmbiguo === false,
    );

    // Salvar congela documento imutável: a tela sempre pergunta antes.
    await clicar("Salvar cálculo");
    await pagina.getByRole("button", { name: "Salvar", exact: true }).first().click();
    await esperarTexto("CALC-");
    afirmar("cálculo salvo — o documento que o CMV lê", true);

    // ── 6. CMV de 300 — a pergunta do walkthrough ───────────────────────
    console.log(`\n[6] CMV para ${BASE} unidades`);

    const lerCmv = async () =>
      pagina.evaluate(() => {
        const cartoes = [...document.querySelectorAll(".cmv-card")].map((cartao) => ({
          rotulo: cartao.querySelector(".cmv-card__label")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          valor: cartao.querySelector(".cmv-card__value")?.textContent?.trim() ?? "",
          classe: cartao.className,
        }));
        return { cartoes, texto: document.body.innerText };
      });

    const irParaCmv = async (quantidade) => {
      await pagina.goto(`${WEB}/produtos/${produtoId}/cmv?quantity=${quantidade}`);
      await pagina.getByText("CMV total para", { exact: false }).first().waitFor({ timeout: 25000 });
    };

    await irParaCmv(BASE);
    const cmv300 = await lerCmv();
    const cartaoDoTotal = cmv300.cartoes.find((c) => c.rotulo.startsWith("CMV total para"));
    const cartaoEquivalente = cmv300.cartoes.find((c) => c.rotulo.startsWith(EQUIVALENTE));
    const cartaoUnitario = cmv300.cartoes.find((c) => c.rotulo === "CMV por unidade");
    const cartaoQuantidade = cmv300.cartoes.find((c) => c.rotulo === "Quantidade simulada");

    afirmar(
      `a quantidade calculada aparece como ${BASE} un`,
      (cartaoQuantidade?.valor ?? "").startsWith(BASE),
      `"${cartaoQuantidade?.valor}"`,
    );
    afirmar(
      "o CMV total diz para qual quantidade ele é",
      (cartaoDoTotal?.rotulo ?? "").includes(`${BASE} un`),
      `"${cartaoDoTotal?.rotulo}"`,
    );
    afirmar(
      `o CMV total de ${BASE} un é R$ ${TOTAL_300.toFixed(2)}`,
      bate(numeroDe(cartaoDoTotal?.valor), TOTAL_300),
      `"${cartaoDoTotal?.valor}"`,
    );
    afirmar(
      "o CMV por unidade é o total daquela quantidade dividido por ela",
      bate(numeroDe(cartaoUnitario?.valor), UNITARIO_300),
      `"${cartaoUnitario?.valor}" · conta independente ${TOTAL_300} ÷ ${BASE} = ${UNITARIO_300}`,
    );
    afirmar(
      "o por 1.000 é rotulado como EQUIVALENTE",
      cartaoEquivalente !== undefined,
      cmv300.cartoes.map((c) => c.rotulo).join(" | "),
    );
    afirmar(
      "o cartão do equivalente é secundário, e o do total é o de destaque",
      (cartaoEquivalente?.classe ?? "").includes("cmv-card--secondary") &&
        (cartaoDoTotal?.classe ?? "").includes("cmv-card--strong"),
      `${cartaoEquivalente?.classe} / ${cartaoDoTotal?.classe}`,
    );
    afirmar(
      `o equivalente por 1.000 da execução de ${BASE} é R$ ${EQUIVALENTE_1000_DA_EXECUCAO_DE_300.toFixed(2)}`,
      bate(numeroDe(cartaoEquivalente?.valor), EQUIVALENTE_1000_DA_EXECUCAO_DE_300),
      `"${cartaoEquivalente?.valor}"`,
    );
    afirmar(
      "nenhum texto sugere que o cálculo foi feito para 1.000",
      !/\bCMV por 1\.000\b/.test(cmv300.texto) && !/Custo por 1\.000 unidades/.test(cmv300.texto),
    );

    // A ressalva precisa estar acessível a partir do próprio cartão.
    await pagina
      .getByRole("button", { name: new RegExp(`Ajuda sobre ${EQUIVALENTE}`) })
      .first()
      .click();
    await esperarTexto("Não representa um novo cálculo de produção para 1.000 unidades");
    afirmar("a ajuda do cartão diz que a equivalência não é um novo cálculo", true);

    // ── 7. calcular 1.000 de verdade ────────────────────────────────────
    console.log("\n[7] O cálculo REAL de 1.000 sobre a mesma base");

    await irParaCmv("1000");
    const cmv1000 = await lerCmv();
    const total1000 = cmv1000.cartoes.find((c) => c.rotulo.startsWith("CMV total para"));
    const lotes1000 = cmv1000.cartoes.find((c) => c.rotulo === "Quantidade simulada");

    afirmar(
      "1.000 unidades sobre base 300 são quatro lotes",
      (lotes1000?.valor ?? "").length > 0 && /4\s+lotes de referência/.test(cmv1000.texto),
      cmv1000.texto.match(/\d+\s+lotes? de referência/)?.[0] ?? "não encontrado",
    );
    afirmar(
      `o custo real de 1.000 un é R$ ${TOTAL_1000.toFixed(2)}`,
      bate(numeroDe(total1000?.valor), TOTAL_1000),
      `"${total1000?.valor}"`,
    );
    afirmar(
      "produzir 1.000 custa MAIS que o equivalente por 1.000 da execução de 300 — é por isso que a copy existe",
      numeroDe(total1000?.valor) > EQUIVALENTE_1000_DA_EXECUCAO_DE_300,
      `R$ ${TOTAL_1000.toFixed(2)} contra R$ ${EQUIVALENTE_1000_DA_EXECUCAO_DE_300.toFixed(2)} — custo fixo por lote e caixa inteira não diluem`,
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
  console.log(
    "APROVADO — a quantidade calculada manda na hierarquia, e o por 1.000 é equivalência declarada.",
  );
}

await main();
