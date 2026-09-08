import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * A quantidade da tela e a quantidade do custo são a MESMA — pela interface.
 *
 * O defeito que esta suíte impede de voltar aparecia numa tela só, em duas
 * tabelas empilhadas: a de componentes mostrava `0,012 kg` por unidade acabada
 * e a de custo estimado mostrava `0,0002 kg` para o mesmo componente. Sessenta
 * vezes de diferença, sem rótulo que explicasse, e o custo de material saía
 * `R$ 0,15` onde a fábrica gasta `R$ 9,10`.
 *
 * Massa: a formulação real `CAFEÍNA PT 60 CAPS THE KING` — 60 doses por
 * embalagem, componentes declarados em `mg` com estoque em `kg`, todos com
 * referência de custo. É o caso que originou o achado, e ele já existe na base;
 * a suíte não o fabrica. A mutação de negócio que ela faz — criar a versão
 * seguinte para comparar rascunho com ativa — é feita clicando.
 *
 * Nada aqui é verificado por API nem por SQL: o que a suíte lê é o que a pessoa
 * lê.
 *
 * **Por que esta suíte nomeia massa fixa**, contra a regra 1 do `README.md`
 * desta pasta: a regra existe para impedir que uma suíte reencontre o resíduo
 * da execução anterior e o conte como seu. Aqui a massa não é resíduo — é o
 * dado real importado da Veridi, e é o caso exato que produziu o achado. O
 * risco que a regra cobre é outro: se a base for recarregada com outros
 * códigos ou outras referências de custo, esta suíte REPROVA dizendo qual
 * número leu, em vez de passar por acidente. Fabricar um produto de 60 doses
 * do zero provaria a mesma conta com dados inventados; provar contra o dado
 * real é o ponto.
 *
 *   node scripts/e2e/formulacao-quantidade-fisica-e-custo.mjs
 */

const PRODUTO = "CAFEÍNA PT 60 CAPS THE KING";
const BUSCA = "THE KING";

/**
 * O que a fábrica separa por unidade acabada, e o que isso custa.
 *
 * Todos os componentes são `Física informada` com pureza e overage registrados
 * e NÃO aplicados, então físico = teórico e a única conta é `mg × 60 doses`
 * convertido para `kg`. Os valores estão aqui em texto formatado de propósito:
 * é o que a tela mostra, e é contra a tela que esta suíte afirma.
 */
const ESPERADO = [
  { item: "MP-000365", quantidade: "0,012 kg", referencia: "R$ 700,00", custo: "R$ 8,40" },
  { item: "MP-000368", quantidade: "0,0003 kg", referencia: "R$ 44,32", custo: "R$ 0,01" },
  { item: "MP-000369", quantidade: "0,0012 kg", referencia: "R$ 126,00", custo: "R$ 0,15" },
  { item: "MP-000120", quantidade: "0,01518 kg", referencia: "R$ 35,00", custo: "R$ 0,53" },
];

const TOTAL_ESPERADO = "R$ 9,10";

/** O que a estimativa mostrava antes da correção — nenhum destes pode voltar. */
const ANTES_DA_CORRECAO = ["0,0002 kg", "0,000005 kg", "0,00002 kg", "0,000253 kg"];

const falhas = [];
function conferir(descricao, obtido, esperado) {
  if (obtido === esperado) {
    console.log(`  ok   ${descricao}: ${obtido}`);
    return true;
  }
  falhas.push(`${descricao}: esperado "${esperado}", obtido "${obtido}"`);
  console.log(`  FALHA ${descricao}: esperado "${esperado}", obtido "${obtido}"`);
  return false;
}

function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

/** As duas tabelas da tela, lidas do DOM como a pessoa as lê. */
async function lerTelaDaVersao(pagina) {
  return pagina.evaluate(() => {
    const texto = (elemento) => (elemento ? elemento.textContent.trim().replace(/\s+/g, " ") : null);

    /*
      O código do item vive em lugares diferentes conforme o estado: na versão
      gravada é texto da célula; no rascunho é o valor do campo de busca do
      item, porque a linha é editável. Ler os dois é o preço de comparar a
      MESMA linha nos dois estados, que é justamente o que esta suíte afirma.
    */
    const codigoDoItem = (tr) => {
      const campo = tr.querySelector('input[id^="componente-"]');
      const bruto = campo ? campo.value : texto(tr.querySelector("td"));
      return (bruto ?? "").match(/\b(?:MP|ME|PA)-\d+/)?.[0] ?? null;
    };

    const componentes = [...document.querySelectorAll("table.table--formulacao tbody tr")]
      .map((tr) => ({
        item: codigoDoItem(tr),
        equivalente: texto(tr.querySelector(".estoque-valor--equivalente")),
        fisico: texto(tr.querySelector(".estoque-valor--fisico")),
      }))
      .filter((linha) => linha.item !== null);

    const custo = [...document.querySelectorAll("table.table--custo-estimado tbody tr")].map((tr) => {
      const celulas = [...tr.children];
      /*
        A célula da quantidade tem duas linhas: a física em cima e a declarada
        como dica embaixo, separadas por `<br>` — que não vira espaço no
        `textContent`. Remover a dica numa cópia é o que separa "0,012 kg" de
        "0,012 kg200 mg".
      */
      const celulaQuantidade = celulas[1]?.cloneNode(true);
      celulaQuantidade?.querySelector(".field__hint")?.remove();
      return {
        item: (texto(celulas[0]) ?? "").match(/\b(?:MP|ME)-\d+/)?.[0] ?? null,
        quantidade: texto(celulaQuantidade),
        declarada: texto(celulas[1]?.querySelector(".field__hint")),
        referencia: texto(celulas[2]),
        custo: texto(celulas[4]),
      };
    });

    const definicoes = [...document.querySelectorAll(".definition-list dt")];
    const valorDe = (rotulo) => {
      const dt = definicoes.find((d) => d.textContent.includes(rotulo));
      return dt ? texto(dt.nextElementSibling) : null;
    };

    return {
      status: texto(document.querySelector(".badge--active, .badge--warn")),
      // Rascunho tem campo editável; versão gravada mostra o valor como texto.
      doses:
        document.querySelector("#version-doses")?.value ??
        texto(
          [...document.querySelectorAll("label")]
            .find((l) => /Doses por embalagem/.test(l.textContent))
            ?.parentElement?.querySelector(".field-readonly-value"),
        ),
      componentes,
      custo,
      custoDaBase: valorDe("Custo estimado da base"),
      custoPorUnidade: valorDe("Custo estimado por unidade"),
      qualidade: valorDe("Qualidade"),
      cabecalhoCusto: [...document.querySelectorAll("table.table--custo-estimado thead th")].map((th) =>
        th.textContent.trim(),
      ),
    };
  });
}

async function abrirVersaoAtiva(pagina) {
  await pagina.goto(`${WEB}/producao/formulacoes`, { waitUntil: "networkidle" });
  await pagina.fill('input[type="search"][placeholder*="produto"]', BUSCA);
  await pagina.waitForFunction(
    (nome) => document.body.innerText.includes(nome),
    PRODUTO,
    { timeout: 15000 },
  );
  await pagina.getByRole("link", { name: "Abrir", exact: true }).first().click();
  await pagina.getByRole("button", { name: "Ver versão ativa" }).click();
  await pagina.waitForFunction(() => document.querySelector("table.table--custo-estimado") !== null, {
    timeout: 15000,
  });
}

/**
 * Abre o rascunho da versão seguinte, criando-o pela tela quando ainda não
 * existe. Reexecutar não pode depender de a base estar como estava: se a
 * rodada anterior já criou o rascunho, esta abre aquele.
 */
async function abrirRascunho(pagina) {
  await pagina.getByRole("link", { name: "Voltar" }).first().click();
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

const { pagina, erros, fechar } = await abrirNavegador();

try {
  console.log(`\n== versão ATIVA — ${PRODUTO}`);
  await abrirVersaoAtiva(pagina);
  const ativa = await lerTelaDaVersao(pagina);

  afirmar("versão está ativa", ativa.status === "Ativa", `status lido: ${ativa.status}`);
  afirmar("60 doses por embalagem", String(ativa.doses).includes("60"), `doses: ${ativa.doses}`);
  afirmar(
    "a coluna do custo diz de que grandeza está falando",
    ativa.cabecalhoCusto.some((c) => /Quantidade física para a base/i.test(c)),
    ativa.cabecalhoCusto.join(" | "),
  );

  console.log("\n-- tabela de componentes × tabela de custo (mesma tela)");
  for (const esperado of ESPERADO) {
    const componente = ativa.componentes.find((c) => c.item === esperado.item);
    const custo = ativa.custo.find((c) => c.item === esperado.item);
    if (!componente || !custo) {
      falhas.push(`${esperado.item}: linha ausente em uma das tabelas`);
      console.log(`  FALHA ${esperado.item}: linha ausente em uma das tabelas`);
      continue;
    }
    conferir(`${esperado.item} equivalente estoque`, componente.equivalente, esperado.quantidade);
    conferir(`${esperado.item} físico por unidade`, componente.fisico, esperado.quantidade);
    conferir(`${esperado.item} quantidade no custo`, custo.quantidade, esperado.quantidade);
    conferir(`${esperado.item} referência unitária`, custo.referencia, esperado.referencia);
    conferir(`${esperado.item} custo estimado`, custo.custo, esperado.custo);
  }

  console.log("\n-- total");
  conferir("custo estimado da base", ativa.custoDaBase, TOTAL_ESPERADO);
  conferir("custo estimado por unidade", ativa.custoPorUnidade, TOTAL_ESPERADO);
  conferir("qualidade", ativa.qualidade, "Estimado");

  console.log("\n-- nenhuma quantidade da conta antiga sobreviveu");
  const textoDoCusto = ativa.custo.map((c) => `${c.quantidade}`).join(" ");
  for (const antigo of ANTES_DA_CORRECAO) {
    afirmar(`custo não usa "${antigo}"`, !textoDoCusto.includes(antigo), textoDoCusto);
  }

  console.log("\n== rascunho da versão seguinte — mesma grandeza, mesma célula");
  await abrirRascunho(pagina);
  const rascunho = await lerTelaDaVersao(pagina);

  afirmar("versão é rascunho", rascunho.status === "Rascunho", `status lido: ${rascunho.status}`);
  for (const esperado of ESPERADO) {
    const componente = rascunho.componentes.find((c) => c.item === esperado.item);
    const custo = rascunho.custo.find((c) => c.item === esperado.item);
    conferir(`${esperado.item} equivalente estoque (rascunho)`, componente?.equivalente, esperado.quantidade);
    conferir(`${esperado.item} quantidade no custo (rascunho)`, custo?.quantidade, esperado.quantidade);
  }
  conferir("custo estimado da base (rascunho)", rascunho.custoDaBase, TOTAL_ESPERADO);

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
console.log("APROVADO — quantidade da tela, quantidade do custo e quantidade do motor são a mesma.");
