import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * O custo estimado converge para o que foi salvo — pela interface, sem reload.
 *
 * F-03-1: alterar a quantidade de um componente e clicar em "Salvar rascunho"
 * deixava o bloco "Custo estimado de materiais" exibindo o custo ANTERIOR. Só
 * recarregando a página o número mudava. Quem conferisse o custo logo depois
 * de salvar conferia o número errado, e nada na tela dizia que aquele número
 * era de outro momento — a situação que §54 proíbe.
 *
 * O que esta suíte afirma, clicando:
 *
 * 1. com edição pendente, o bloco se identifica como o do último salvamento;
 * 2. salvar faz o custo convergir na MESMA montagem da página — sem F5, sem
 *    trocar de aba, sem sair e voltar;
 * 3. a segunda alteração também aparece: a tela não trava na primeira;
 * 4. o número novo faz sentido — dobrar a quantidade dobra o custo da linha.
 *
 * Massa: a formulação real `CAFEÍNA PT 60 CAPS THE KING`, a mesma da suíte
 * `formulacao-quantidade-fisica-e-custo.mjs`, pelo mesmo motivo: provar contra
 * o dado real da Veridi. O rascunho da versão seguinte é criado clicando, e
 * reaproveitado se a execução anterior já o criou. A quantidade é DEVOLVIDA ao
 * valor original no fim, com um segundo salvamento — que é também a prova 3.
 *
 * Nada é verificado por API nem por SQL: o que a suíte lê é o que a pessoa lê.
 *
 *   node scripts/e2e/custo-estimado-acompanha-o-salvamento.mjs
 */

const PRODUTO = "CAFEÍNA PT 60 CAPS THE KING";
const BUSCA = "THE KING";
/** A linha que a suíte mexe — a de maior peso no custo, então a mais visível. */
const COMPONENTE = "MP-000365";

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

/** "R$ 8,40" → 8.4. Só para conferir a aritmética do que a tela mostra. */
function numeroDe(textoBRL) {
  if (!textoBRL) return null;
  const limpo = textoBRL.replace(/[^\d,-]/g, "").replace(",", ".");
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/** O bloco de custo e o campo da linha, lidos do DOM como a pessoa os lê. */
async function lerTela(pagina) {
  return pagina.evaluate((codigoDoComponente) => {
    const texto = (elemento) => (elemento ? elemento.textContent.trim().replace(/\s+/g, " ") : null);

    const custo = [...document.querySelectorAll("table.table--custo-estimado tbody tr")].map((tr) => {
      const celulas = [...tr.children];
      const celulaQuantidade = celulas[1]?.cloneNode(true);
      celulaQuantidade?.querySelector(".field__hint")?.remove();
      return {
        item: (texto(celulas[0]) ?? "").match(/\b(?:MP|ME)-\d+/)?.[0] ?? null,
        quantidade: texto(celulaQuantidade),
        custo: texto(celulas[4]),
      };
    });

    const definicoes = [...document.querySelectorAll(".definition-list dt")];
    const valorDe = (rotulo) => {
      const dt = definicoes.find((d) => d.textContent.includes(rotulo));
      return dt ? texto(dt.nextElementSibling) : null;
    };

    const secaoDoCusto = document.querySelector("table.table--custo-estimado")?.closest("section");

    return {
      status: texto(document.querySelector(".badge--active, .badge--warn")),
      custo,
      custoDaBase: valorDe("Custo estimado da base"),
      quantidadeDigitada:
        document.querySelector(`input[aria-label="Quantidade de ${codigoDoComponente}"]`)?.value ?? null,
      // §54: o bloco diz de qual momento é o número que está mostrando.
      avisoDeUltimoSalvamento: /Custo do último salvamento/i.test(secaoDoCusto?.innerText ?? ""),
    };
  }, COMPONENTE);
}

function linhaDoComponente(tela) {
  return tela.custo.find((linha) => linha.item === COMPONENTE) ?? null;
}

async function abrirRascunhoDaFormulacao(pagina) {
  await pagina.goto(`${WEB}/producao/formulacoes`, { waitUntil: "networkidle" });
  await pagina.fill('input[type="search"][placeholder*="produto"]', BUSCA);
  await pagina.waitForFunction((nome) => document.body.innerText.includes(nome), PRODUTO, {
    timeout: 15000,
  });
  await pagina.getByRole("link", { name: "Abrir", exact: true }).first().click();
  await pagina.waitForFunction(() => document.body.innerText.includes("HISTÓRICO DE VERSÕES"), {
    timeout: 15000,
  });

  const jaExiste = await pagina.evaluate(() =>
    [...document.querySelectorAll("table tbody tr")].some((tr) => /Rascunho/i.test(tr.textContent)),
  );

  if (jaExiste) {
    console.log("  (rascunho da execução anterior reaproveitado)");
    await pagina
      .locator("table tbody tr", { hasText: /Rascunho/i })
      .first()
      .getByRole("button", { name: "Ver" })
      .click();
  } else {
    await pagina.getByRole("button", { name: "Nova versão a partir desta" }).first().click();
  }

  await pagina.waitForFunction(() => document.querySelector("table.table--custo-estimado") !== null, {
    timeout: 15000,
  });
}

async function digitarQuantidade(pagina, valor) {
  const campo = pagina.locator(`input[aria-label="Quantidade de ${COMPONENTE}"]`);
  await campo.fill(valor);
  // O aviso de §54 depende da comparação com o gravado, que roda no render.
  await pagina.waitForTimeout(150);
}

/**
 * Salva e espera o custo da linha DEIXAR de ser o que era.
 *
 * Esperar o valor mudar — em vez de esperar um tempo fixo — é o que faz a
 * suíte reprovar de verdade contra o defeito: com ele de volta, o número
 * simplesmente nunca muda e isto estoura por timeout.
 */
async function salvarEEsperarCusto(pagina, custoAnterior) {
  await pagina.getByRole("button", { name: "Salvar rascunho" }).click();
  await pagina.waitForFunction(
    ({ codigo, anterior }) => {
      const linha = [...document.querySelectorAll("table.table--custo-estimado tbody tr")].find((tr) =>
        (tr.children[0]?.textContent ?? "").includes(codigo),
      );
      const atual = linha?.children[4]?.textContent?.trim().replace(/\s+/g, " ") ?? null;
      return atual !== null && atual !== anterior;
    },
    { codigo: COMPONENTE, anterior: custoAnterior },
    { timeout: 15000 },
  );
}

const { pagina, erros, fechar } = await abrirNavegador();

try {
  console.log(`\n== rascunho da formulação — ${PRODUTO}`);
  await abrirRascunhoDaFormulacao(pagina);

  const antes = await lerTela(pagina);
  const linhaAntes = linhaDoComponente(antes);
  afirmar("versão é rascunho", antes.status === "Rascunho", `status lido: ${antes.status}`);
  afirmar(`linha de ${COMPONENTE} presente no custo`, linhaAntes !== null);
  afirmar(
    "sem edição pendente o bloco não fala em último salvamento",
    antes.avisoDeUltimoSalvamento === false,
  );

  const quantidadeOriginal = antes.quantidadeDigitada;
  const custoAntes = numeroDe(linhaAntes?.custo);
  const totalAntes = antes.custoDaBase;
  afirmar(
    "quantidade e custo lidos da tela",
    quantidadeOriginal !== null && custoAntes !== null,
    `${quantidadeOriginal} → ${linhaAntes?.custo} (base ${totalAntes})`,
  );

  const dobrada = String(Number(String(quantidadeOriginal).replace(",", ".")) * 2);

  console.log("\n-- edição pendente: o bloco diz de qual momento é o número (§54)");
  await digitarQuantidade(pagina, dobrada);
  const pendente = await lerTela(pagina);
  afirmar(
    "com alteração na tela, o bloco se identifica como o do último salvamento",
    pendente.avisoDeUltimoSalvamento === true,
  );
  afirmar(
    "e o número exibido ainda é o gravado — nada foi promovido sem salvar",
    numeroDe(linhaDoComponente(pendente)?.custo) === custoAntes,
    `${linhaDoComponente(pendente)?.custo}`,
  );

  console.log("\n-- salvar: o custo converge na mesma montagem da página");
  await salvarEEsperarCusto(pagina, linhaAntes.custo);
  const depois = await lerTela(pagina);
  const custoDepois = numeroDe(linhaDoComponente(depois)?.custo);

  afirmar(
    "dobrar a quantidade dobrou o custo da linha",
    custoDepois !== null && Math.abs(custoDepois - custoAntes * 2) < 0.02,
    `${custoAntes} → ${custoDepois}`,
  );
  afirmar(
    "o custo estimado da base também mudou",
    depois.custoDaBase !== totalAntes,
    `${totalAntes} → ${depois.custoDaBase}`,
  );
  afirmar("o aviso de pendência saiu depois de salvar", depois.avisoDeUltimoSalvamento === false);

  console.log("\n-- segunda alteração: a tela não trava na primeira");
  await digitarQuantidade(pagina, String(quantidadeOriginal).replace(",", "."));
  await salvarEEsperarCusto(pagina, linhaDoComponente(depois).custo);
  const voltou = await lerTela(pagina);

  afirmar(
    "o custo voltou ao valor de origem",
    Math.abs(numeroDe(linhaDoComponente(voltou)?.custo) - custoAntes) < 0.02,
    `${linhaDoComponente(voltou)?.custo}`,
  );
  afirmar(
    "e a base voltou junto — a massa fica como estava",
    voltou.custoDaBase === totalAntes,
    `${voltou.custoDaBase}`,
  );

  console.log("\n-- console");
  afirmar("console limpo", erros.length === 0, erros.join(" | "));
} finally {
  await fechar();
}

console.log("");
if (falhas.length > 0) {
  console.log(`REPROVADO — ${falhas.length} verificação(ões):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("APROVADO — o custo estimado acompanha o salvamento, e diz quando não acompanha.");
