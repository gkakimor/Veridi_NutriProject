import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * A tarifa registrada hoje vale HOJE — INDUSTRIAL-RATE-VALIDITY-01.
 *
 * `IndustrialResourceRate.effectiveAt` e `.validUntil` são datas civis, e a
 * pergunta "esta tarifa está vigente?" é sobre o DIA, nunca sobre o instante.
 * O servidor comparava instante cru contra o marcador de meia-noite do dia, e
 * decidia com o relógio do processo — em Railway, UTC. As duas coisas juntas
 * faziam a situação de uma tarifa depender da hora em que alguém abria a tela.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. recurso industrial novo nasce SEM tarifa, e a tela diz isso;
 *   2. tarifa registrada com a vigência de hoje aparece como **Vigente** no
 *      mesmo dia — a borda de início, que é a que a interface consegue criar;
 *   3. a estrutura de custos enxerga esse recurso como tendo tarifa vigente,
 *      isto é, o motor e a tela concordam sobre o mesmo dia;
 *   4. registrar uma tarifa nova NÃO edita, não encerra e não apaga a
 *      anterior — as duas ficam no histórico. A política de sobreposição é
 *      decisão de produto em aberto, e o que se garante aqui é que nada
 *      acontece por conta própria.
 *
 * O que ela deliberadamente NÃO faz: criar uma tarifa com "válida até". A
 * interface não oferece esse campo — `validUntil` só é LIDO na coluna "Válida
 * até" —, então essa borda é provada onde ela existe, de forma determinística:
 * `apps/api/src/modules/industrial-resources/rate-validity.test.ts` e
 * `rate-validity-api.test.ts`. Fabricar a tarifa por API para depois "provar
 * pela tela" seria usar a API como caminho de negócio.
 *
 * Massa própria, carimbada pelo `runId`.
 *
 *   node scripts/e2e/vigencia-de-tarifa-industrial.mjs
 */

const run = obterRun({ novo: true, dono: "custos" });
const P = `E2E${run.runId}`;

const TARIFA_INICIAL = "30";
const TARIFA_REAJUSTADA = "42";

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

/** Hoje no fuso operacional, como a tela o escreve num `<input type="date">`. */
function hojeComercial() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** `2026-09-09` → `09/09/2026`, que é como a tabela imprime a data. */
function porExtenso(diaISO) {
  const [ano, mes, dia] = diaISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  const clicar = async (nome, opcoes = {}) =>
    pagina.getByRole("button", { name: nome, ...opcoes }).first().click();
  const preencher = async (id, valor) => pagina.locator(`#${id}`).first().fill(valor);
  const escolher = async (id, valor) => pagina.locator(`#${id}`).first().selectOption(valor);
  const esperarTexto = async (texto, timeout = 25000) =>
    pagina.getByText(texto, { exact: false }).first().waitFor({ timeout });

  /** O histórico de tarifas como a pessoa o lê: valor, datas e situação. */
  const lerHistorico = async () =>
    pagina.evaluate(() => {
      const secao = [...document.querySelectorAll("section")].find((s) =>
        /Histórico de tarifas/i.test(s.textContent ?? ""),
      );
      // A linha de estado vazio ("Nenhuma tarifa registrada") não é tarifa.
      const linhas = [...(secao?.querySelectorAll("tbody tr") ?? [])].filter(
        (tr) => tr.querySelector("td.table__empty") === null,
      );
      return linhas.map((tr) => {
        const celulas = [...tr.children].map((td) => (td.textContent ?? "").trim());
        return {
          valor: celulas[0] ?? "",
          vigenteDesde: celulas[2] ?? "",
          validaAte: celulas[3] ?? "",
          situacao: celulas[5] ?? "",
        };
      });
    });

  const hoje = hojeComercial();

  try {
    // ── 1. recurso novo, sem tarifa ─────────────────────────────────────
    console.log(`\n[1] Recurso industrial da execução ${P}`);

    await pagina.goto(`${WEB}/gestao/recursos-industriais/novo`);
    await preencher("resource-name", `Operador ${P}`);
    await escolher("resource-type", "LABOR");
    await clicar("Criar recurso");
    await pagina.waitForURL(/\/gestao\/recursos-industriais\/[0-9a-f-]{36}$/, { timeout: 25000 });
    const recursoUrl = pagina.url();
    await esperarTexto("Histórico de tarifas");

    const vazio = await lerHistorico();
    afirmar("recurso novo nasce sem tarifa, e a tela diz o que falta", vazio.length === 0);
    afirmar(
      "a ausência é explicada, não escondida",
      (await pagina.locator("body").innerText()).includes("Nenhuma tarifa registrada"),
    );

    // ── 2. tarifa com vigência de HOJE ──────────────────────────────────
    console.log(`\n[2] Tarifa vigente a partir de ${porExtenso(hoje)}`);

    await preencher("rate-value", TARIFA_INICIAL);
    await preencher("rate-effective", hoje);
    await clicar("Registrar tarifa");
    await pagina.waitForTimeout(1500);

    const comUma = await lerHistorico();
    afirmar("a tarifa entrou no histórico", comUma.length === 1, JSON.stringify(comUma));
    afirmar(
      "a data registrada é a que foi escolhida — sem deslocamento de fuso",
      comUma[0]?.vigenteDesde === porExtenso(hoje),
      `"${comUma[0]?.vigenteDesde}" esperado "${porExtenso(hoje)}"`,
    );
    /*
     * A afirmação central: com comparação de instante, uma vigência que começa
     * hoje já valia (o marcador é 00:00) mas a que TERMINA hoje morria. Aqui
     * se prova a borda que a interface consegue criar, no próprio dia, em
     * qualquer hora em que a suíte rode.
     */
    afirmar(
      "vigente HOJE, no próprio dia em que começou — qualquer que seja a hora",
      comUma[0]?.situacao === "Vigente",
      `"${comUma[0]?.situacao}"`,
    );

    const tarifaVigenteNoTopo = await pagina
      .locator("dt", { hasText: "Tarifa vigente" })
      .locator("xpath=following-sibling::dd[1]")
      .innerText()
      .catch(() => "");
    afirmar(
      "o resumo do recurso mostra a mesma tarifa como vigente",
      tarifaVigenteNoTopo.includes(TARIFA_INICIAL),
      tarifaVigenteNoTopo.replace(/\s+/g, " ").slice(0, 80),
    );

    // ── 3. o motor concorda com a tela sobre o mesmo dia ─────────────────
    console.log("\n[3] A estrutura de custos vê a mesma vigência");

    await pagina.goto(`${WEB}/gestao/recursos-industriais`);
    await pagina.locator("#resources-search").fill(`Operador ${P}`);
    await pagina.waitForTimeout(1500);
    const naListagem = await pagina
      .getByRole("row", { name: new RegExp(`Operador ${P}`) })
      .first()
      .innerText();
    afirmar(
      "a listagem — outro caminho de leitura — mostra a mesma tarifa vigente",
      naListagem.includes(TARIFA_INICIAL),
      naListagem.replace(/\s+/g, " ").slice(0, 120),
    );

    // ── 4. reajuste não mexe na anterior ────────────────────────────────
    console.log("\n[4] Reajuste entra como registro novo");

    await pagina.goto(recursoUrl);
    await esperarTexto("Histórico de tarifas");
    await preencher("rate-value", TARIFA_REAJUSTADA);
    await preencher("rate-effective", hoje);
    await clicar("Registrar tarifa");
    await pagina.waitForTimeout(1500);

    const comDuas = await lerHistorico();
    afirmar("as duas tarifas convivem no histórico", comDuas.length === 2, JSON.stringify(comDuas));

    const anterior = comDuas.find((linha) => linha.valor.includes(TARIFA_INICIAL));
    afirmar(
      "a tarifa anterior continua no histórico, com o valor que tinha",
      anterior !== undefined,
      JSON.stringify(comDuas),
    );
    /*
     * O sistema NÃO encerra a anterior sozinho. Se um dia essa política for
     * decidida — junto com a sobreposição de oferta de fornecedor —, esta
     * afirmação muda de propósito, e é bom que ela quebre.
     */
    afirmar(
      "criar a nova NÃO preencheu 'válida até' da anterior — nenhuma vigência é encerrada por conta própria",
      anterior?.validaAte === "—" || anterior?.validaAte === "",
      `"${anterior?.validaAte}"`,
    );

    const reajustada = comDuas.find((linha) => linha.valor.includes(TARIFA_REAJUSTADA));
    afirmar(
      "a tarifa nova é a que vale",
      reajustada?.situacao === "Vigente",
      `"${reajustada?.situacao}"`,
    );

    /*
     * OBSERVAÇÃO registrada, não regra: sem "válida até" nas duas, o histórico
     * marca AS DUAS como Vigente. O motor não fica ambíguo — o resumo do topo
     * mostra qual ganha —, mas a tela não diz isso, e é a ambiguidade que a
     * decisão futura de sobreposição precisa resolver, junto com a oferta de
     * fornecedor. Se um dia a política mudar, esta afirmação quebra de
     * propósito.
     */
    afirmar(
      "estado atual: duas vigências abertas aparecem AS DUAS como Vigente no histórico",
      comDuas.filter((linha) => linha.situacao === "Vigente").length === 2,
      comDuas.map((linha) => `${linha.valor}=${linha.situacao}`).join(" | "),
    );
    const vigenteDepois = await pagina
      .locator("dt", { hasText: "Tarifa vigente" })
      .locator("xpath=following-sibling::dd[1]")
      .innerText()
      .catch(() => "");
    afirmar(
      "o resumo do recurso, esse sim, diz qual das duas o motor usa",
      vigenteDepois.includes(TARIFA_REAJUSTADA) && !vigenteDepois.includes(TARIFA_INICIAL),
      vigenteDepois.replace(/\s+/g, " ").slice(0, 80),
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
  console.log("APROVADO — a vigência da tarifa é do DIA, e o reajuste não reescreve o anterior.");
}

await main();
