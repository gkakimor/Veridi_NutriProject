import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O telefone do Cliente dentro do Projeto — PROJECT-CUSTOMER-CONTACT-01.
 *
 * A Veridi relatou o percurso real: trabalhando dentro de um Projeto, para
 * ligar (ou mandar mensagem) era preciso sair da tela e abrir o cadastro do
 * Cliente. O link para o Cliente já existia; o que faltava era o número estar
 * visível onde a pessoa já está.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. um Cliente cadastrado com telefone e e-mail pela tela oficial;
 *   2. um Projeto desse Cliente, criado pelo modal de Projetos;
 *   3. telefone e e-mail visíveis no Resumo do Projeto, com máscara;
 *   4. o link "Cliente" que já existia leva ao cadastro certo — e é UM link;
 *   5. o telefone alterado no cadastro, pela tela;
 *   6. de volta ao Projeto, o telefone NOVO — sem sincronização e sem job.
 *
 * O passo 6 é a prova semântica: o Projeto PROJETA o cadastro, não copia.
 * Se algum dia o valor for gravado no Projeto, é aqui que aparece.
 *
 * A navegação é toda de interface. Nenhuma chamada de API faz parte do
 * caminho de negócio — o `api` do laboratório não é usado.
 *
 * Massa própria, carimbada pelo `runId`. Não depende de dado de produção.
 *
 *   node scripts/e2e/contato-do-cliente-no-projeto.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Contato ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Contato ${P}`;

const TELEFONE_A = "(15) 99999-8888";
const TELEFONE_B = "(15) 98888-7777";
const EMAIL = `contato.${run.runId.toLowerCase()}@empresa.com.br`;

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

  /** O valor que vem logo depois de um rótulo no Resumo do Projeto. */
  const valorDoResumo = async (rotulo) =>
    pagina.evaluate((texto) => {
      const dt = [...document.querySelectorAll(".definition-list dt")].find(
        (n) => n.textContent.trim() === texto,
      );
      return dt?.nextElementSibling?.textContent?.trim() ?? null;
    }, rotulo);

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente com telefone e e-mail, pela tela oficial ─────────────
    console.log(`\n[1] Cliente ${RAZAO_SOCIAL}`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await pagina.locator("#customer-legal-name").first().waitFor({ timeout: 25000 });
    await pagina.locator("#customer-legal-name").first().fill(RAZAO_SOCIAL);
    await pagina.locator("#customer-email").first().fill(EMAIL);
    await pagina.locator("#customer-phone").first().fill(TELEFONE_A);
    await pagina.getByRole("button", { name: "Criar cliente" }).first().click();
    await pagina.waitForURL("**/cadastros/clientes**", { timeout: 25000 });
    afirmar("cliente salvo pela tela de cadastro", true, RAZAO_SOCIAL);

    // ── 2. Projeto desse Cliente, pelo modal de Projetos ────────────────
    console.log(`\n[2] Projeto ${NOME_DO_PROJETO}`);

    await pagina.goto(`${WEB}/comercial/projetos`);
    await pagina.getByRole("button", { name: "Novo projeto" }).first().click();
    await pagina.locator("#project-customer").first().waitFor({ timeout: 25000 });
    await pagina.locator("#project-customer").first().fill(RAZAO_SOCIAL);
    /*
     * A lista do seletor é assíncrona, e o carimbo desta execução evita
     * homônimo de massa antiga. O item "+ Novo cliente" também é `option` e
     * repete o texto digitado — escolher por papel e nome pegaria ELE, que
     * sai do modal para a tela de cadastro. A opção de verdade é a que não
     * é o convite a criar.
     */
    const opcaoDoCliente = pagina.locator(
      "li.entity-select__option:not(.entity-select__create)",
      { hasText: P },
    );
    await opcaoDoCliente.first().waitFor({ timeout: 25000 });
    await opcaoDoCliente.first().click();
    await pagina.locator("#project-name").first().fill(NOME_DO_PROJETO);
    await pagina.getByRole("button", { name: "Criar projeto" }).first().click();

    // Criar já abre a ficha do projeto — a tela leva para lá sozinha.
    await pagina.waitForURL(/\/comercial\/projetos\/[0-9a-f-]{36}/, { timeout: 25000 });
    urlDoProjeto = pagina.url();
    await pagina.getByText("Telefone", { exact: true }).first().waitFor({ timeout: 25000 });

    // ── 3. contato visível no Resumo ────────────────────────────────────
    console.log(`\n[3] Contato no Resumo do Projeto`);

    const telefoneNaTela = await valorDoResumo("Telefone");
    const emailNaTela = await valorDoResumo("E-mail");
    const clienteNaTela = await valorDoResumo("Cliente");

    afirmar("o Projeto mostra o cliente", (clienteNaTela ?? "").includes(RAZAO_SOCIAL), clienteNaTela);
    afirmar(
      "o Projeto mostra o telefone com máscara brasileira",
      telefoneNaTela === TELEFONE_A,
      telefoneNaTela,
    );
    afirmar("o Projeto mostra o e-mail", emailNaTela === EMAIL, emailNaTela);

    // ── 4. o link que já existia, e é um só ─────────────────────────────
    console.log(`\n[4] Link "Cliente"`);

    const links = await pagina.getByRole("link", { name: new RegExp(RAZAO_SOCIAL) }).count();
    afirmar("existe UM link para o cliente, não dois", links === 1, `${links} link(s)`);

    await pagina.getByRole("link", { name: new RegExp(RAZAO_SOCIAL) }).first().click();
    await pagina.waitForURL("**/cadastros/clientes**", { timeout: 25000 });
    // O link contextual abre o próprio registro citado.
    await pagina.locator("#customer-phone").first().waitFor({ timeout: 25000 });
    const telefoneNoCadastro = await pagina.locator("#customer-phone").first().inputValue();
    afirmar(
      "o link leva ao cadastro do cliente certo, já aberto",
      telefoneNoCadastro === TELEFONE_A,
      telefoneNoCadastro,
    );

    // ── 5. telefone alterado pela tela ──────────────────────────────────
    console.log(`\n[5] Telefone alterado para ${TELEFONE_B}`);

    await pagina.locator("#customer-phone").first().fill(TELEFONE_B);
    await pagina.getByRole("button", { name: "Salvar alterações" }).first().click();
    await pagina.locator("#customer-phone").first().waitFor({ state: "detached", timeout: 25000 });

    // ── 6. de volta ao Projeto: o valor NOVO ────────────────────────────
    console.log(`\n[6] De volta ao Projeto`);

    await pagina.goto(urlDoProjeto);
    await pagina.getByText("Telefone", { exact: true }).first().waitFor({ timeout: 25000 });
    const depois = await valorDoResumo("Telefone");
    afirmar(
      "o Projeto mostra o telefone novo, sem sincronizar nada",
      depois === TELEFONE_B,
      depois,
    );
    afirmar("o e-mail não foi afetado pela troca do telefone", (await valorDoResumo("E-mail")) === EMAIL);

    // ── 7. viewport estreito ────────────────────────────────────────────
    console.log(`\n[7] Viewport estreito (390px)`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.reload();
    await pagina.getByText("Telefone", { exact: true }).first().waitFor({ timeout: 25000 });
    afirmar(
      "telefone continua legível em 390px",
      (await valorDoResumo("Telefone")) === TELEFONE_B,
    );
    /*
     * A pergunta é se o RESUMO cabe — não se a página inteira cabe.
     *
     * Em 390px o `masthead` já transborda em TODA tela do sistema (medido:
     * `scrollWidth` 457 contra 390 de viewport, em Projetos, Clientes e no
     * painel), e é o finding de shell conhecido. Ele empurra o container do
     * conteúdo junto, então medir o documento reprovaria por um defeito que
     * não é desta capability — e esconderia o que ela precisa provar.
     *
     * O que se mede aqui é o bloco: ele cabe na largura da tela e não tem
     * rolagem própria. Um telefone ou e-mail longo demais apareceria como
     * `scrollWidth` maior que `clientWidth`.
     */
    const resumo = await pagina.evaluate(() => {
      const lista = document.querySelector(".definition-list");
      if (!lista) return null;
      return {
        largura: Math.round(lista.getBoundingClientRect().width),
        viewport: document.documentElement.clientWidth,
        scrollW: lista.scrollWidth,
        clientW: lista.clientWidth,
        docScrollW: document.documentElement.scrollWidth,
      };
    });
    afirmar(
      "o Resumo cabe na largura de 390px",
      !!resumo && resumo.largura <= resumo.viewport,
      resumo ? `${resumo.largura}px em ${resumo.viewport}px` : "sem Resumo",
    );
    afirmar(
      "o Resumo não ganhou rolagem própria",
      !!resumo && resumo.scrollW <= resumo.clientW + 1,
      resumo ? `scrollWidth ${resumo.scrollW} / clientWidth ${resumo.clientW}` : "",
    );
    console.log(
      `  nota  rolagem lateral da PÁGINA em 390px: ${resumo?.docScrollW}px — finding de shell (masthead), presente em todas as telas`,
    );

    afirmar("console limpo", erros.length === 0, erros.slice(0, 3).join(" | "));
  } finally {
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`FALHOU — ${falhas.length} verificação(ões):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("OK — o contato do Cliente aparece no Projeto e acompanha o cadastro.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
