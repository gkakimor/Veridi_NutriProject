import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Perfil tributário do Cliente — CUSTOMER-TAX-PROFILE-01, PRODUCT_RULES §83.
 *
 * O Cliente ganhou um Perfil tributário: classificação INFORMADA pelo
 * usuário, que não calcula imposto e não bloqueia nada. O que esta suíte
 * prova, clicando:
 *
 *   1. abrir Clientes e o cadastro novo;
 *   2. criar um Cliente sem tocar no Perfil tributário — o POST não leva o
 *      campo, e o servidor aplica o default;
 *   3. o cadastro reaberto e o Resumo da Consulta dizem "Não informado";
 *   4–8. editar para Simples Nacional, salvar, recarregar e conferir;
 *   9–13. editar de novo, desta vez PELO TECLADO, para Lucro Presumido,
 *      salvar, recarregar e conferir — e salvar sem mexer não reenvia o perfil;
 *   14–15. usar o Cliente num Projeto, e também um Cliente "Não informado":
 *      os dois nascem sem bloqueio;
 *   16. console limpo;
 *   17. em 390px o seletor cabe no próprio campo e no formulário.
 *
 * Mutação de negócio só pela interface. A API do laboratório entra uma vez,
 * como verificação do default gravado.
 *
 * Massa própria, carimbada pelo `runId`.
 *
 *   node scripts/e2e/perfil-tributario-do-cliente.mjs
 */

const run = obterRun({ novo: true, dono: "cadastros" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Perfil ${P} LTDA`;
const RAZAO_SOCIAL_SEM_PERFIL = `Cliente Sem Perfil ${P} LTDA`;
const PROJETO = `Projeto Perfil ${P}`;
const PROJETO_SEM_PERFIL = `Projeto Sem Perfil ${P}`;
const DICA = "Classificação informada pela empresa. Não calcula impostos automaticamente.";

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
  const { pagina, api, erros, fechar } = await abrirNavegador();

  /** Cada gravação de Cliente que saiu do navegador, com o corpo que viajou. */
  const gravacoes = [];
  pagina.on("request", (requisicao) => {
    const metodo = requisicao.method();
    const caminho = new URL(requisicao.url()).pathname;
    if (!["POST", "PATCH"].includes(metodo)) return;
    if (!/^\/customers(\/[0-9a-f-]{36})?$/.test(caminho)) return;
    gravacoes.push({ metodo, corpo: requisicao.postDataJSON() ?? {} });
  });
  const ultimaGravacao = () => gravacoes[gravacoes.length - 1];

  const seletor = () => pagina.locator("#customer-tax-profile").first();
  const perfilNaTela = async () => seletor().inputValue();
  const rotuloMarcado = async () =>
    seletor().evaluate((select) => select.selectedOptions[0]?.textContent ?? "");

  /** O valor que vem logo depois de um rótulo numa lista de definições. */
  const valorDoResumo = async (rotulo) =>
    pagina.evaluate((texto) => {
      const dt = [...document.querySelectorAll(".definition-list dt")].find(
        (n) => n.textContent.trim() === texto,
      );
      return dt?.nextElementSibling?.textContent?.trim() ?? null;
    }, rotulo);

  /**
   * Abre a edição do cliente pela lista — o "Editar" DA LINHA dele, depois
   * de a busca filtrar. O primeiro botão da página pode ser de outro cliente.
   */
  async function abrirEdicao(razao) {
    await pagina.locator("#customers-search").first().fill(razao);
    const linha = pagina.getByRole("row", { name: new RegExp(razao) }).first();
    await linha.waitFor({ timeout: 25000 });
    await linha.getByRole("button", { name: "Editar" }).click();
    await seletor().waitFor({ timeout: 25000 });
    await pagina.waitForFunction(
      (nome) => document.querySelector("#customer-legal-name")?.value === nome,
      razao,
      { timeout: 25000 },
    );
  }

  async function salvarEdicao() {
    await pagina.getByRole("button", { name: "Salvar alterações" }).first().click();
    await seletor().waitFor({ state: "detached", timeout: 25000 });
  }

  async function perfilNaConsulta(url) {
    await pagina.goto(url);
    await pagina.getByText("Perfil tributário", { exact: true }).first().waitFor({ timeout: 25000 });
    return valorDoResumo("Perfil tributário");
  }

  async function criarCliente(razao) {
    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await pagina.locator("#customer-legal-name").first().waitFor({ timeout: 25000 });
    await pagina.locator("#customer-legal-name").first().fill(razao);
    await pagina.getByRole("button", { name: "Criar cliente" }).first().click();
    await pagina.waitForURL(/\/cadastros\/clientes$/, { timeout: 25000 });
  }

  async function criarProjeto(razao, nome) {
    await pagina.goto(`${WEB}/comercial/projetos`);
    await pagina.getByRole("button", { name: "Novo projeto" }).first().click();
    await pagina.locator("#project-customer").first().waitFor({ timeout: 25000 });
    await pagina.locator("#project-customer").first().fill(razao);
    // "+ Novo cliente" também é opção e repete o texto: a de verdade é a outra.
    const opcao = pagina.locator("li.entity-select__option:not(.entity-select__create)", {
      hasText: razao,
    });
    await opcao.first().waitFor({ timeout: 25000 });
    await opcao.first().click();
    await pagina.locator("#project-name").first().fill(nome);
    await pagina.getByRole("button", { name: "Criar projeto" }).first().click();
    await pagina.waitForURL(/\/comercial\/projetos\/[0-9a-f-]{36}/, { timeout: 25000 });
    /*
     * "Cliente" aparece em outros pontos da página antes de a ficha montar:
     * espera-se o PAR rótulo-valor da própria ficha. Se não vier, a afirmação
     * reprova mostrando o que estava na tela.
     */
    await pagina
      .waitForFunction(
        (nome) =>
          [...document.querySelectorAll(".definition-list dt")].some(
            (dt) =>
              dt.textContent.trim() === "Cliente" &&
              (dt.nextElementSibling?.textContent ?? "").includes(nome),
          ),
        razao,
        { timeout: 25000 },
      )
      .catch(() => {});
    return valorDoResumo("Cliente");
  }

  let urlDaConsulta = "";

  try {
    // ── 1. Clientes ─────────────────────────────────────────────────────
    console.log(`\n[1] Clientes`);

    await pagina.goto(`${WEB}/cadastros/clientes`);
    await pagina.getByRole("heading", { level: 1, name: "Clientes" }).waitFor({ timeout: 25000 });
    await pagina.getByRole("link", { name: "+ Novo cliente" }).first().click();
    await pagina.waitForURL(/\/cadastros\/clientes\/novo/, { timeout: 25000 });
    await seletor().waitFor({ timeout: 25000 });

    // ── 2. criar sem tocar no perfil ────────────────────────────────────
    console.log(`\n[2] ${RAZAO_SOCIAL}, sem tocar no Perfil tributário`);

    const campo = pagina.getByLabel("Perfil tributário", { exact: true });
    afirmar(
      "o rótulo aponta para um <select> nativo",
      (await campo.evaluate((el) => el.tagName)) === "SELECT",
    );
    afirmar(
      "o cadastro novo abre em Não informado",
      (await perfilNaTela()) === "NOT_INFORMED" && (await rotuloMarcado()) === "Não informado",
      await rotuloMarcado(),
    );
    const opcoes = await seletor().evaluate((select) =>
      [...select.options].map((opcao) => opcao.textContent),
    );
    afirmar(
      "as seis opções, em português",
      JSON.stringify(opcoes) ===
        JSON.stringify(["Não informado", "MEI", "Simples Nacional", "Lucro Presumido", "Lucro Real", "Outro"]),
      opcoes.join(" · "),
    );
    const dica = await seletor().evaluate((select) => {
      const id = select.getAttribute("aria-describedby");
      return id ? document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() : null;
    });
    afirmar("a dica está ligada ao campo e diz que não calcula imposto", dica === DICA, dica ?? "sem dica");

    await pagina.locator("#customer-cnpj").first().focus();
    await pagina.keyboard.press("Tab");
    afirmar(
      "o Tab sai do CNPJ e chega no Perfil tributário",
      (await pagina.evaluate(() => document.activeElement?.id)) === "customer-tax-profile",
    );

    await pagina.locator("#customer-legal-name").first().fill(RAZAO_SOCIAL);
    await pagina.getByRole("button", { name: "Criar cliente" }).first().click();
    await pagina.waitForURL(/\/cadastros\/clientes$/, { timeout: 25000 });
    afirmar(
      "o POST do cadastro não levou o campo",
      ultimaGravacao()?.metodo === "POST" && !("taxProfile" in ultimaGravacao().corpo),
      JSON.stringify(ultimaGravacao()?.corpo ?? {}),
    );

    // ── 3. Não informado, gravado ───────────────────────────────────────
    console.log(`\n[3] O que ficou gravado`);

    const busca = await api(`/customers?search=${encodeURIComponent(RAZAO_SOCIAL)}`);
    afirmar(
      "o servidor gravou Não informado (verificação pela API)",
      busca.corpo?.customers?.[0]?.taxProfile === "NOT_INFORMED",
      busca.corpo?.customers?.[0]?.taxProfile,
    );

    await abrirEdicao(RAZAO_SOCIAL);
    afirmar(
      "a edição mostra Não informado",
      (await rotuloMarcado()) === "Não informado",
      await rotuloMarcado(),
    );
    await pagina.getByRole("link", { name: "Consulta completa" }).first().click();
    await pagina.waitForURL(/\/consultas\/clientes\/[0-9a-f-]{36}\/resumo/, { timeout: 25000 });
    urlDaConsulta = pagina.url();
    const naConsulta = await perfilNaConsulta(urlDaConsulta);
    afirmar("o Resumo da Consulta diz Não informado", naConsulta === "Não informado", naConsulta);

    // ── 4–6. Simples Nacional ───────────────────────────────────────────
    console.log(`\n[4–6] Editar para Simples Nacional e salvar`);

    await pagina.goto(`${WEB}/cadastros/clientes`);
    await abrirEdicao(RAZAO_SOCIAL);
    await seletor().selectOption({ label: "Simples Nacional" });
    await salvarEdicao();
    afirmar(
      "o PATCH levou SIMPLES_NACIONAL",
      ultimaGravacao()?.metodo === "PATCH" && ultimaGravacao().corpo.taxProfile === "SIMPLES_NACIONAL",
      JSON.stringify(ultimaGravacao()?.corpo?.taxProfile),
    );

    // ── 7–8. recarregar e conferir ──────────────────────────────────────
    console.log(`\n[7–8] Recarregar e conferir`);

    await pagina.reload();
    await abrirEdicao(RAZAO_SOCIAL);
    afirmar(
      "reaberto depois do reload, o cadastro mostra Simples Nacional",
      (await perfilNaTela()) === "SIMPLES_NACIONAL" && (await rotuloMarcado()) === "Simples Nacional",
      await rotuloMarcado(),
    );
    const simplesNaConsulta = await perfilNaConsulta(urlDaConsulta);
    afirmar("o Resumo da Consulta diz Simples Nacional", simplesNaConsulta === "Simples Nacional", simplesNaConsulta);

    // ── 9–11. Lucro Presumido, pelo teclado ─────────────────────────────
    console.log(`\n[9–11] Editar de novo, pelo teclado, para Lucro Presumido`);

    await pagina.goto(`${WEB}/cadastros/clientes`);
    await abrirEdicao(RAZAO_SOCIAL);
    await seletor().focus();
    afirmar(
      "o seletor recebe foco",
      (await pagina.evaluate(() => document.activeElement?.id)) === "customer-tax-profile",
    );
    // Busca por digitação do <select> nativo: de "Simples Nacional", "L" leva
    // à primeira opção seguinte que começa com L.
    await pagina.keyboard.press("l");
    afirmar(
      "a tecla L escolhe Lucro Presumido",
      (await perfilNaTela()) === "LUCRO_PRESUMIDO",
      await rotuloMarcado(),
    );
    await salvarEdicao();
    afirmar(
      "o PATCH levou LUCRO_PRESUMIDO",
      ultimaGravacao()?.corpo?.taxProfile === "LUCRO_PRESUMIDO",
      JSON.stringify(ultimaGravacao()?.corpo?.taxProfile),
    );

    // ── 12–13. recarregar e conferir ────────────────────────────────────
    console.log(`\n[12–13] Recarregar e conferir`);

    await pagina.reload();
    await abrirEdicao(RAZAO_SOCIAL);
    afirmar(
      "reaberto depois do reload, o cadastro mostra Lucro Presumido",
      (await perfilNaTela()) === "LUCRO_PRESUMIDO" && (await rotuloMarcado()) === "Lucro Presumido",
      await rotuloMarcado(),
    );

    // Salvar sem mexer no perfil: ele não viaja, e o gravado fica.
    const antes = gravacoes.length;
    await salvarEdicao();
    afirmar(
      "salvar sem mexer no perfil não o reenvia",
      gravacoes.length === antes + 1 && !("taxProfile" in ultimaGravacao().corpo),
      JSON.stringify(Object.keys(ultimaGravacao()?.corpo ?? {})),
    );
    const presumidoNaConsulta = await perfilNaConsulta(urlDaConsulta);
    afirmar(
      "o Resumo da Consulta continua em Lucro Presumido",
      presumidoNaConsulta === "Lucro Presumido",
      presumidoNaConsulta,
    );

    // ── 14–15. o perfil não bloqueia o Projeto ──────────────────────────
    console.log(`\n[14–15] Projetos`);

    const clienteDoProjeto = await criarProjeto(RAZAO_SOCIAL, PROJETO);
    afirmar(
      "o Cliente em Lucro Presumido abre Projeto sem bloqueio",
      (clienteDoProjeto ?? "").includes(RAZAO_SOCIAL),
      clienteDoProjeto,
    );

    await criarCliente(RAZAO_SOCIAL_SEM_PERFIL);
    const clienteSemPerfil = await criarProjeto(RAZAO_SOCIAL_SEM_PERFIL, PROJETO_SEM_PERFIL);
    afirmar(
      "o Cliente em Não informado também abre Projeto sem bloqueio",
      (clienteSemPerfil ?? "").includes(RAZAO_SOCIAL_SEM_PERFIL),
      clienteSemPerfil,
    );

    // ── 16. console ─────────────────────────────────────────────────────
    console.log(`\n[16] Console`);
    afirmar("console limpo", erros.length === 0, erros.slice(0, 3).join(" | "));

    // ── 17. 390px ───────────────────────────────────────────────────────
    console.log(`\n[17] Viewport estreito (390px)`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    const medir = () =>
      pagina.evaluate(() => {
        const select = document.querySelector("#customer-tax-profile");
        const campo = select.closest(".field");
        const form = select.closest("form");
        const r = (el) => el.getBoundingClientRect();
        return {
          select: { left: r(select).left, right: r(select).right, width: Math.round(r(select).width) },
          campo: { left: r(campo).left, right: r(campo).right },
          form: { right: r(form).right, scrollW: form.scrollWidth, clientW: form.clientWidth },
          docScrollW: document.documentElement.scrollWidth,
        };
      });
    const conferir = (onde, m) => {
      afirmar(
        `${onde}: o seletor cabe no próprio campo`,
        m.select.left >= m.campo.left - 0.5 && m.select.right <= m.campo.right + 0.5,
        `seletor ${m.select.width}px`,
      );
      afirmar(`${onde}: o campo cabe no formulário`, m.campo.right <= m.form.right + 0.5);
      afirmar(
        `${onde}: o formulário não ganhou rolagem própria`,
        m.form.scrollW <= m.form.clientW + 1,
        `scrollWidth ${m.form.scrollW} / clientWidth ${m.form.clientW}`,
      );
      console.log(
        `  nota  rolagem lateral da PÁGINA: ${m.docScrollW}px — finding de shell conhecido (masthead), fora do escopo`,
      );
    };

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await seletor().waitFor({ timeout: 25000 });
    conferir("cadastro novo", await medir());

    await pagina.goto(`${WEB}/cadastros/clientes`);
    await abrirEdicao(RAZAO_SOCIAL);
    conferir("edição", await medir());
    afirmar(
      "em 390px o perfil gravado continua legível",
      (await rotuloMarcado()) === "Lucro Presumido",
      await rotuloMarcado(),
    );

    afirmar("console limpo no fim", erros.length === 0, erros.slice(0, 3).join(" | "));
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
    "APROVADO — o Perfil tributário nasce Não informado, muda e persiste pela tela, e não bloqueia o Projeto.",
  );
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
