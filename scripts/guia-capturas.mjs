import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Capturas para o guia passo a passo "Como criar um produto e chegar ao CMV".
 *
 * O produto deste script NÃO é um veredito de teste: é material de
 * documentação. Ele percorre o sistema de verdade, cria os registros que o
 * caminho exige e fotografa cada etapa que o leitor vai precisar reconhecer
 * na tela. Print de tela vazia não ensina ninguém — por isso nada aqui é
 * "abrir a rota e fotografar": cada imagem é tirada DEPOIS da ação que a
 * etapa descreve, com os campos já preenchidos e, quando a etapa é uma
 * decisão, com o diálogo de confirmação aberto (é ali que o sistema diz o
 * que passa a ser imutável).
 *
 * ## Duas trilhas para o mesmo destino
 *
 * TRILHA A — pelo Projeto comercial. O produto NASCE da negociação: projeto
 * → produto técnico (em desenvolvimento) → proposta → aceite do cliente →
 * aprovação do projeto, que é o que promove o produto a operacional.
 *
 * TRILHA B — pelo cadastro direto. `/cadastros/produtos/novo` cria o produto
 * já operacional, sem passar por negociação nenhuma.
 *
 * As duas convergem na FORMULAÇÃO: da versão de fórmula em diante o caminho
 * é literalmente a mesma sequência de telas (formulação → estrutura de
 * custos → cálculo → CMV). A diferença que sobra é uma só, e ela é capturada
 * nas duas trilhas: pelo Projeto o produto já nasce com uma formulação V1 em
 * RASCUNHO junto; pelo cadastro direto não nasce nenhuma, e a primeira
 * versão precisa ser criada à mão.
 *
 * ## Por que navegador de verdade
 *
 * Metade do que o guia precisa mostrar não existe fora do navegador: os
 * diálogos de confirmação (que só a UI monta), o estado dos botões que a
 * regra de domínio desabilita, o texto do bloqueio que a API devolve e a
 * tela traduz, e a posição de rolagem em que cada assunto realmente aparece.
 *
 * ## O que fica no banco
 *
 * Tudo. Nada é apagado — o guia vai referenciar estes registros pelo código.
 * Todos nascem com o carimbo `GUIA <timestamp>` no nome, e a lista completa
 * sai no fim da execução e dentro do `manifest.json`.
 *
 * Uso: pnpm exec dotenv -e .env -- node scripts/guia-capturas.mjs
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, "..");
const OUT = path.join(REPO, "handoff", "guia");
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

/** Largura/altura que dão print legível dentro de um documento Word. */
const VIEWPORT = { width: 1440, height: 900 };

fs.mkdirSync(OUT, { recursive: true });

const credentials = (() => {
  const arquivo = path.join(REPO, ".local-data", "dev-admin.json");
  if (!fs.existsSync(arquivo)) {
    throw new Error("Credencial de desenvolvimento não encontrada em .local-data/dev-admin.json");
  }
  return JSON.parse(fs.readFileSync(arquivo, "utf8"));
})();

let cookie = "";

async function api(method, url, body) {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Carimbo da execução.
 *
 * Legível em português e único: o guia impresso vai citar estes nomes, e
 * quem for conferir no sistema precisa achar exatamente o registro da foto.
 */
const agora = new Date();
const CARIMBO = `GUIA ${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, "0")}${String(
  agora.getDate(),
).padStart(2, "0")}-${String(agora.getHours()).padStart(2, "0")}${String(agora.getMinutes()).padStart(2, "0")}`;

/** Registros nascidos nesta execução — vão para o relatório e o manifesto. */
const registrosCriados = [];
function registrar(tipo, codigo, nome, id, trilha) {
  registrosCriados.push({ tipo, codigo, nome, id, trilha });
  console.log(`  + ${tipo.padEnd(22)} ${String(codigo ?? "—").padEnd(14)} ${nome}`);
}

/** Etapas por trilha, na ordem em que foram percorridas. */
const trilhaA = [];
const trilhaB = [];

/** Problemas que não derrubam a execução, mas o relatório precisa contar. */
const observacoes = [];
function anotar(texto) {
  observacoes.push(texto);
  console.log(`  · ${texto}`);
}

const consoleErrors = [];

let browser;
let page;

/* ─────────────────────────── ferramentas de tela ───────────────────────── */

/**
 * Espera a TELA, não a URL.
 *
 * `location` muda no instante em que o roteador aceita a rota; a árvore nova
 * aparece um tique depois. Medir entre as duas coisas fotografa a tela
 * anterior.
 */
async function abrir(rota, ancora = ".page__title, .doc-title, .doc-header") {
  await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(ancora, { timeout: 30000 });
  await page.waitForTimeout(700);
}

/**
 * Rola até o ponto que importa.
 *
 * O container de rolagem do app é `.workspace` (e, dentro de modal,
 * `.modal-fullscreen__body`) — não a janela. `scrollIntoView` resolve os dois
 * casos porque sobe pelo ancestral rolável mais próximo. Centralizar em vez
 * de "encostar" é o que evita a foto com o assunto colado na borda.
 */
async function rolarAte(alvo) {
  if (!alvo) return;
  const locator = typeof alvo === "string" ? page.locator(alvo).first() : alvo.first();
  try {
    await locator.waitFor({ state: "visible", timeout: 8000 });
    await locator.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  } catch {
    anotar(`não consegui rolar até um alvo pedido — a foto saiu na posição corrente`);
  }
  await page.waitForTimeout(350);
}

/**
 * Uma etapa do guia: rola, fotografa e descreve.
 *
 * `oQueFazer`, `oQueEsperar`, `regra` e `sePrender` são escritos a partir do
 * código lido e da tela vista. Onde não há regra ou não há erro provável, o
 * campo vai `null` — encher linguiça num guia é pior que a lacuna.
 */
async function passo(etapa) {
  const { trilha, id, titulo, rota, arquivo, foco, ajuste, ...resto } = etapa;
  if (foco) await rolarAte(foco);
  /*
   * Ajuste fino depois de centralizar.
   *
   * Centralizar a seção às vezes empurra para fora da foto a linha que diz
   * DE QUAL registro a tela fala — e um passo de guia sem o código do
   * produto na imagem vale menos. Alguns pixels para cima devolvem o
   * cabeçalho sem perder o assunto.
   */
  if (typeof ajuste === "number") {
    await page.evaluate((dy) => {
      const alvo =
        document.querySelector(".modal-fullscreen__body") ?? document.querySelector(".workspace");
      if (alvo) alvo.scrollTop += dy;
    }, ajuste);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);

  const nomeArquivo = `${id}-${arquivo}.png`;
  await page.screenshot({ path: path.join(OUT, nomeArquivo) });

  const registro = {
    id,
    titulo,
    rota,
    imagem: `handoff/guia/${nomeArquivo}`,
    oQueFazer: resto.oQueFazer ?? null,
    oQueEsperar: resto.oQueEsperar ?? null,
    regra: resto.regra ?? null,
    sePrender: resto.sePrender ?? null,
  };
  (trilha === "A" ? trilhaA : trilhaB).push(registro);
  console.log(`  ${id}  ${titulo}`);
  return registro;
}

/** Botão pelo nome acessível, com escopo opcional para evitar homônimo. */
function botao(nome, escopo) {
  return (escopo ?? page).getByRole("button", { name: nome });
}

async function clicar(nome, escopo) {
  const alvo = botao(nome, escopo).first();
  await alvo.waitFor({ state: "visible", timeout: 20000 });
  await alvo.scrollIntoViewIfNeeded();
  await alvo.click();
}

/**
 * Escolhe numa busca-por-digitação (`SearchableEntitySelect`).
 *
 * Não é um `<select>`: é um combobox que filtra por código, nome e apelido.
 * A lista sai por portal, então esperar por ela no fluxo do formulário não
 * funciona — espera-se pelo `.entity-select__list` global. Enter escolhe o
 * primeiro RESULTADO (o "+ Cadastrar novo" ocupa o índice 0 mas nunca é o
 * ativo quando há resultado), por isso a busca aqui é sempre pelo código,
 * que é único.
 */
async function escolherEntidade(seletor, busca) {
  const campo = typeof seletor === "string" ? page.locator(seletor).first() : seletor.first();
  await campo.scrollIntoViewIfNeeded();
  await campo.click();
  await campo.fill("");
  await campo.pressSequentially(busca, { delay: 15 });
  await page.waitForSelector(".entity-select__list", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const lista = document.querySelector(".entity-select__list");
      if (!lista) return false;
      return [...lista.querySelectorAll('li[role="option"]')].some(
        (li) => !li.classList.contains("entity-select__create"),
      );
    },
    undefined,
    { timeout: 15000 },
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}

/** O diálogo de confirmação do app é um só componente: `.confirm-dialog`. */
const dialogo = () => page.locator(".confirm-dialog");

async function esperarDialogo(tituloEsperado) {
  await dialogo().waitFor({ state: "visible", timeout: 20000 });
  if (tituloEsperado) {
    const titulo = await page.locator("#confirm-dialog-title").innerText();
    if (!titulo.includes(tituloEsperado)) {
      anotar(`diálogo esperado "${tituloEsperado}" veio como "${titulo}"`);
    }
  }
  await page.waitForTimeout(400);
}

async function confirmarDialogo(rotulo) {
  await clicar(rotulo, dialogo());
  await dialogo().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  /*
   * Alguns diálogos REABREM com outra pergunta: o envio do orçamento, por
   * exemplo, pode descobrir no servidor um custo incompleto que a tela não
   * antecipou. Confirmar de novo pelo botão de commit mantém o roteiro
   * andando, e a observação vai para o relatório.
   */
  if (await dialogo().isVisible().catch(() => false)) {
    const titulo = await page.locator("#confirm-dialog-title").innerText().catch(() => "?");
    anotar(`o diálogo reabriu como "${titulo}" depois de confirmar — confirmei outra vez`);
    await dialogo().locator(".btn--accent, .btn--danger").first().click();
    await dialogo().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(900);
  }
}

/** Seção de formulário pelo título — âncora estável para rolar e escopar. */
function secao(titulo) {
  return page
    .locator("section.form-section")
    .filter({ has: page.getByRole("heading", { level: 3, name: titulo }) });
}

/** Espera o botão sair do estado "…" (salvando/calculando) antes de seguir. */
async function esperarQuieto(ms = 1200) {
  await page.waitForTimeout(ms);
}

/* ───────────────────────────── execução ────────────────────────────────── */

const inicio = new Date();
let falhaFatal = null;

try {
  await api("POST", "/auth/login", credentials);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const [nomeCookie, valorCookie] = cookie.split("=");
  await context.addCookies([
    {
      name: nomeCookie,
      value: valorCookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (await page.locator("#login-email").count()) {
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
  }
  if (await page.locator("#login-email").count()) {
    throw new Error("Não foi possível autenticar no navegador.");
  }

  /* ── Preparação: o que o caminho PRESSUPÕE, e que não é etapa do guia ──
   *
   * Cliente, matérias-primas, embalagem e recursos industriais existem antes
   * de qualquer produto — são cadastros de outra jornada. Criar/consultar
   * aqui pela API mantém o guia falando só do que ele promete ensinar, sem
   * fotografar telas que não fazem parte das duas trilhas.
   */
  console.log("\nPreparação (pré-requisitos, fora das trilhas):");

  const cliente = await api("POST", "/customers", {
    legalName: `${CARIMBO} Nutrição Exemplo Ltda`,
    tradeName: `${CARIMBO} Exemplo`,
  });
  registrar("Cliente", cliente.code, cliente.legalName, cliente.id, "preparação");

  /*
   * Materiais com custo conhecido.
   *
   * O CMV só mostra número quando cada material tem referência de custo. Os
   * itens DEMO já têm recebimento com custo real na base de desenvolvimento
   * — reusá-los é o que faz a última tela do guia sair com valor em vez de
   * "custo parcial", que é justamente o que não se quer ensinar.
   */
  const itens = await api("GET", "/items?search=DEMO&pageSize=50");
  const acharItem = (codigo) => {
    const achado = itens.items.find((i) => i.code === codigo);
    if (!achado) throw new Error(`Item ${codigo} não existe nesta base — rode \`pnpm db:demo\`.`);
    return achado;
  };
  const betaAlanina = acharItem("MP-000004");
  const cafeina = acharItem("MP-000003");
  const pote = acharItem("ME-000003");
  console.log(
    `  = materiais reaproveitados: ${betaAlanina.code}, ${cafeina.code}, ${pote.code} (com custo conhecido)`,
  );

  const recursos = await api("GET", "/industrial-resources?pageSize=200");
  const acharRecurso = (codigo) => {
    const achado = recursos.resources.find((r) => r.code === codigo);
    if (!achado) throw new Error(`Recurso ${codigo} não existe nesta base — rode \`pnpm db:demo\`.`);
    return achado;
  };
  const maoDeObra = acharRecurso("REC-000001");
  const misturador = acharRecurso("REC-000002");
  const energia = acharRecurso("REC-000003");
  console.log(
    `  = recursos reaproveitados: ${maoDeObra.code} (mão de obra), ${misturador.code} (equipamento, 7,5 kW), ${energia.code} (energia)`,
  );

  const hojeISO = new Date().toISOString().slice(0, 10);

  /* ═══════════════════ Trecho comum às duas trilhas ═══════════════════════
   *
   * Da formulação em diante, A e B percorrem exatamente as mesmas telas. A
   * função abaixo é essa parte, escrita UMA vez: duas cópias divergiriam, e
   * o guia passaria a ensinar dois caminhos onde o sistema só tem um.
   *
   * `formulacaoJaExiste` é a única diferença real entre as trilhas: produto
   * nascido de Projeto chega aqui com uma V1 em rascunho pronta; produto do
   * cadastro direto chega sem versão nenhuma.
   */
  async function trechoComum({ trilha, produto, formulacaoJaExiste, n }) {
    /** Próximo identificador da etapa ("A-07"). Chamar UMA vez por captura. */
    const proximoId = () => `${trilha}-${String(n()).padStart(2, "0")}`;
    const rotaFormulacao = `/producao/formulacoes/${produto.id}`;
    const rotaCustos = `/produtos/${produto.id}/custos`;
    const rotaCmv = `/produtos/${produto.id}/cmv`;

    /*
     * Por que esta foto existe: é o "antes".
     *
     * O leitor precisa ver a tela de CMV recusando responder ANTES de
     * percorrer a cadeia, senão as quatro etapas seguintes parecem
     * burocracia. A tela diz a razão exata da recusa e lista o que falta —
     * é o mapa do resto do guia.
     */
    await abrir(rotaCmv, ".doc-title");
    await page.waitForTimeout(1500);
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Ver por que o CMV ainda não tem resposta",
      rota: rotaCmv,
      arquivo: "cmv-indisponivel",
      foco: page.locator(".form-alert, [role='status']").first(),
      oQueFazer:
        "Abra o CMV do produto recém-criado (menu do produto, opção CMV) e leia a mensagem em destaque.",
      oQueEsperar:
        'A tela responde "Este produto ainda não tem formulação ativa." em vez de mostrar custo. Nenhum card de valor aparece.',
      regra:
        "O CMV não calcula nada por conta própria: ele lê formulação ativa, estrutura de custos ativa e cálculo salvo. Sem os três documentos não existe custo — e o sistema prefere dizer isso a inventar um número.",
      sePrender:
        'A mensagem muda conforme o que falta: "sem formulação ativa", depois "sem estrutura de custos ativa", depois "Não há cálculo de custo salvo até esta data de referência". Ela é a lista de tarefas, não um erro.',
    });

    /* ── Formulação ─────────────────────────────────────────────────────── */

    await abrir(rotaFormulacao, ".doc-title");
    await page.waitForTimeout(900);

    if (formulacaoJaExiste) {
      /*
       * Trilha A: a V1 já veio junto com o produto do projeto. A foto existe
       * para o leitor não procurar um botão "criar" que não está lá.
       */
      await passo({
        trilha,
        id: proximoId(),
        titulo: "Abrir a formulação que nasceu com o produto",
        rota: rotaFormulacao,
        arquivo: "formulacao-rascunho-existente",
        foco: secao("Histórico de versões"),
        oQueFazer:
          'Abra Produção › Formulações, procure o produto e entre nele. Clique na linha da versão V1 (Rascunho) para editá-la.',
        oQueEsperar:
          'A tela mostra "Nenhuma versão ativa" e uma V1 já em Rascunho — o produto nascido de projeto vem com a formulação criada e vazia.',
        regra:
          "Produto nascido de Projeto já chega com a formulação V1 em rascunho. O comercial aprova o negócio, não a receita: a versão nasce em rascunho porque só a engenharia ativa uma fórmula.",
        sePrender: null,
      });
      const linhaVersao = secao("Histórico de versões").locator("tbody tr").first();
      await linhaVersao.scrollIntoViewIfNeeded();
      await linhaVersao.click();
      await page.waitForSelector("#version-basis", { timeout: 25000 });
      await page.waitForTimeout(900);
    } else {
      /*
       * Trilha B: não existe versão nenhuma. Esta é a única etapa que a
       * trilha B tem a mais — e é exatamente o que o guia precisa dizer.
       */
      await passo({
        trilha,
        id: proximoId(),
        titulo: "Criar a primeira versão da formulação",
        rota: rotaFormulacao,
        arquivo: "criar-formulacao",
        foco: secao("Formulação ativa"),
        oQueFazer:
          'Abra Produção › Formulações, entre no produto e clique em "Criar formulação em branco".',
        oQueEsperar:
          "A V1 é criada em rascunho e a tela já abre o editor da versão, com base e componentes vazios.",
        regra:
          "Produto cadastrado direto NÃO ganha formulação automática — diferente do produto nascido de projeto. A primeira versão é um ato explícito de quem faz a engenharia.",
        sePrender:
          'O botão fica desabilitado enquanto o produto não tem item de produto acabado vinculado; nesse caso a tela avisa "vincule em Cadastros / Produtos antes de criar uma formulação".',
      });
      await clicar("Criar formulação em branco");
      await page.waitForSelector("#version-basis", { timeout: 25000 });
      await page.waitForTimeout(900);
    }

    /*
     * Preencher a receita.
     *
     * A foto é tirada com a base e os TRÊS componentes já preenchidos e o
     * rascunho salvo: uma tabela de componentes vazia não ensina a
     * diferença entre "base fixa" (quantidade para o lote inteiro) e "por
     * unidade acabada" (a embalagem), que é a coisa que mais confunde.
     */
    const versaoUrl = new URL(page.url()).pathname;
    await page.fill("#version-basis", "1000");

    const secComponentes = secao("Componentes");
    for (let i = 0; i < 3; i += 1) {
      await clicar("+ Adicionar componente", secComponentes);
      await page.waitForTimeout(250);
    }
    const linhas = secComponentes.locator("tbody tr");

    const receita = [
      { item: betaAlanina, quantidade: "150", base: "FIXED_BASIS" },
      { item: cafeina, quantidade: "20", base: "FIXED_BASIS" },
      // Embalagem é por unidade acabada: 1 pote por pote produzido, não 1
      // pote por lote. É a linha que mostra as duas bases convivendo.
      { item: pote, quantidade: "1", base: "PER_FINISHED_UNIT" },
    ];
    for (let i = 0; i < receita.length; i += 1) {
      const linha = linhas.nth(i);
      await escolherEntidade(linha.locator('input[role="combobox"]'), receita[i].item.code);
      await linha
        .locator('select[aria-label="Base de cálculo do componente"]')
        .selectOption(receita[i].base);
      await linha.locator("td.is-numeric input").first().fill(receita[i].quantidade);
      await page.waitForTimeout(200);
    }

    await clicar("Salvar rascunho");
    await esperarQuieto(1800);

    await passo({
      trilha,
      id: proximoId(),
      titulo: "Informar a base e os componentes",
      rota: versaoUrl,
      arquivo: "formulacao-componentes",
      foco: secComponentes,
      // Sobe o bastante para o código do produto aparecer junto da tabela:
      // sem ele as duas trilhas produziriam a MESMA imagem, e o leitor não
      // saberia em qual produto está.
      ajuste: -190,
      oQueFazer:
        'Informe a base da formulação (1000), clique em "+ Adicionar componente" para cada material, escolha o item pelo código, ajuste a base de cálculo de cada linha e a quantidade. Clique em "Salvar rascunho".',
      oQueEsperar:
        'As linhas passam a mostrar a unidade de estoque, o equivalente em estoque e o físico por unidade calculados. O botão volta de "Salvando…" para "Salvar rascunho".',
      regra:
        'A base declara para quanto a receita vale ("estas quantidades produzem 1000 un"). Componente em "Base fixa" é quantidade do lote inteiro; em "Por unidade acabada" é quantidade por unidade produzida — a embalagem é sempre a segunda.',
      sePrender:
        'Só matéria-prima e embalagem entram como componente; item de produto acabado é recusado. Unidade incompatível com a unidade de estoque do item também barra — a unidade é preenchida sozinha ao escolher o item, e mudar para outra dimensão quebra a linha.',
    });

    /*
     * Ativar é a decisão, e o diálogo é onde o sistema diz o que se perde:
     * a versão ativada deixa de ser editável para sempre.
     */
    await clicar("Ativar versão");
    await esperarDialogo("Ativar formulação");
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Ativar a versão da formulação",
      rota: versaoUrl,
      arquivo: "ativar-formulacao",
      oQueFazer: 'Clique em "Ativar versão" e leia o diálogo antes de confirmar em "Ativar".',
      oQueEsperar:
        "A versão passa a ACTIVE, os campos ficam somente leitura e o botão de ação vira “Criar nova versão”.",
      regra:
        "Só a versão ATIVA vale para custo e produção, e existe no máximo uma por produto: ativar inativa a anterior. Versão ativa é documento histórico — não se edita, se substitui por uma versão nova.",
      sePrender:
        '"Ativar versão" NÃO salva o rascunho: se você editou e não clicou em "Salvar rascunho" antes, ativa a versão sem a sua alteração. Se faltar componente, a base for zero, o item estiver inativo ou houver componente por dose sem "doses por embalagem", a ativação é recusada com a lista de motivos.',
    });
    await confirmarDialogo("Ativar");
    await page.waitForTimeout(1200);

    /* ── Estrutura de custos ────────────────────────────────────────────── */

    /*
     * A tela de custos sem estrutura é um formulário de UMA pergunta: a base
     * de produção. Fotografar com o campo já preenchido é o que mostra que
     * a resposta é um número que a pessoa escolhe — o sistema nunca assume
     * 1000 por conta própria.
     */
    await abrir(rotaCustos, ".doc-title");
    await page.waitForTimeout(900);
    await page.fill("#new-reference-output", "1000");
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Informar a base de produção da estrutura de custos",
      rota: rotaCustos,
      arquivo: "custos-base-producao",
      foco: "#new-reference-output",
      oQueFazer:
        'Abra Custos industriais do produto, preencha "Base de produção" (1000) e clique em "Criar estrutura de custos".',
      oQueEsperar:
        "Nasce a EC V1 em rascunho, já vinculada à formulação ativa, e a tela passa a mostrar as seções de premissas, recursos e energia.",
      regra:
        "A estrutura de custos parte da formulação ATIVA e de um lote de referência declarado. Nada de assumir 1000: sem base informada (ou lote mínimo cadastrado no produto) o botão fica bloqueado.",
      sePrender:
        'Se o produto ainda não tem formulação ativa, a tela troca o botão por um aviso — "Este produto ainda não tem formulação ativa, e a estrutura de custos parte dela" — com atalho para a formulação. Voltar aqui só faz sentido depois de ativar a fórmula.',
    });
    await clicar("Criar estrutura de custos");
    await page.waitForSelector("#reference-output", { timeout: 25000 });
    await page.waitForTimeout(1200);
    const versaoCusto = await api("GET", `/products/${produto.id}/industrial-costs`);
    const ecDraft = versaoCusto.draft ?? versaoCusto.current;
    registrar("Estrutura de custos", ecDraft?.code, `${produto.code} · ${produto.name}`, ecDraft?.id, trilha);

    /*
     * Recursos industriais: é aqui que mão de obra, equipamento e energia
     * entram. A foto precisa mostrar as DUAS linhas já lançadas, com a
     * tarifa vigente ao lado — é o que explica por que o custo por unidade
     * cai quando a quantidade sobe (custo fixo do lote, diluído).
     */
    const secRecursos = page.locator("#secao-recursos");
    await escolherEntidade("#usage-resource", maoDeObra.code);
    await page.fill("#usage-quantity", "6");
    await clicar("Adicionar recurso", secRecursos);
    await esperarQuieto(1400);
    await escolherEntidade("#usage-resource", misturador.code);
    await page.fill("#usage-quantity", "4");
    await clicar("Adicionar recurso", secRecursos);
    await esperarQuieto(1400);

    await passo({
      trilha,
      id: proximoId(),
      titulo: "Declarar os recursos industriais consumidos",
      rota: rotaCustos,
      arquivo: "custos-recursos",
      foco: secRecursos,
      oQueFazer:
        'Na seção "Recursos industriais", escolha o recurso pelo código, informe o consumo por lote de referência e clique em "Adicionar recurso". Repita para cada recurso.',
      oQueEsperar:
        "Cada recurso vira uma linha com a tarifa vigente lida do cadastro de recursos. Nenhum total é calculado aqui — isso é a etapa seguinte.",
      regra:
        "O consumo é declarado POR LOTE DE REFERÊNCIA, não por unidade: é isso que faz o custo fixo se diluir quando se produz mais de um lote. Um recurso só pode aparecer uma vez por estrutura — some o tempo na linha existente.",
      sePrender:
        'Recurso sem tarifa vigente vira pendência e trava a conclusão da estrutura; recurso inativo impede a ativação ("Reative ou remova antes de ativar"). Recursos de ENERGIA não aparecem nesta lista fora do modo "energia informada diretamente".',
    });

    /*
     * Premissa manual: o que não está na fórmula nem é recurso. A foto
     * mostra a linha já lançada com valor — campo vazio significa "não
     * informado", nunca zero, e é justamente isso que vira pendência.
     */
    const secPremissas = page.locator("#secao-premissas");
    await page.selectOption("#cost-category", "THIRD_PARTY_SERVICE");
    await page.fill("#cost-description", `${CARIMBO} rotulagem terceirizada`);
    await page.selectOption("#cost-basis", "PER_OUTPUT_UNIT");
    await page.fill("#cost-rate", "0.35");
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Lançar uma premissa de custo adicional",
      rota: rotaCustos,
      arquivo: "custos-premissa",
      foco: secPremissas,
      oQueFazer:
        'Na seção "Premissas de custo adicionais", escolha a categoria, escreva a descrição, escolha a base de cálculo, informe o valor e clique em "Adicionar premissa".',
      oQueEsperar: "A premissa vira linha da estrutura, com a base de cálculo declarada ao lado.",
      regra:
        "Premissa é custo que não está na fórmula nem é recurso industrial. Valor em branco significa PREMISSA NÃO INFORMADA — nunca zero — e vira pendência bloqueante da estrutura.",
      sePrender:
        'Mão de obra, equipamentos e energia não podem ser lançados aqui: eles entram pelos recursos industriais. A base "por caixa de expedição" exige que o produto tenha "unidades por caixa" cadastrada, senão a premissa nasce pendente.',
    });
    await clicar("Adicionar premissa", secPremissas);
    await esperarQuieto(1500);

    /*
     * O BLOQUEIO, capturado de propósito.
     *
     * Neste ponto a energia ainda está como "não estruturada", e o sistema
     * trata isso como pendência bloqueante — energia em aberto não é energia
     * zero. Clicar em "Ativar estrutura" agora abre o diálogo que LISTA o
     * que falta. É a foto mais útil do guia inteiro: mostra onde a pessoa
     * vai travar e o que a mensagem quer dizer.
     */
    await clicar("Ativar estrutura");
    await esperarDialogo("Ativar estrutura com pendências");
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Ler o bloqueio: estrutura com pendências",
      rota: rotaCustos,
      arquivo: "custos-bloqueio-pendencias",
      oQueFazer:
        'Clique em "Ativar estrutura" antes de configurar a energia e leia a lista de pendências. Clique em "Cancelar" para voltar e resolvê-las.',
      oQueEsperar:
        'O diálogo "Ativar estrutura com pendências?" lista o que está em aberto — aqui, "A energia desta estrutura ainda não foi configurada."',
      regra:
        "Estrutura incompleta PODE ser ativada, mas nunca por acidente: o sistema exige confirmação explícita e mostra o que ficará em aberto. Premissa não informada não vira zero — vira custo desconhecido, e o cálculo sai parcial.",
      sePrender:
        'Confirmar aqui congela uma base de custo furada: o CMV vai mostrar apenas o "subtotal conhecido" e a proposta sai com custo incompleto. Cancele, resolva as pendências e ative depois — a estrutura ativa não pode mais ser editada.',
    });
    await clicar("Cancelar", dialogo());
    await dialogo().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);

    /*
     * Energia derivada do equipamento: horas × potência × tarifa. A foto
     * mostra os dois campos que precisam existir juntos — o modo e o recurso
     * que dá preço ao kWh. Sem o segundo, o consumo derivado é quantidade,
     * não custo.
     */
    const secEnergia = page.locator("#secao-energia");
    await page.selectOption("#energy-mode", "FROM_EQUIPMENT");
    await page.waitForSelector("#energy-resource", { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.selectOption("#energy-resource", energia.id);
    await esperarQuieto(1600);

    await passo({
      trilha,
      id: proximoId(),
      titulo: "Configurar como a energia é apurada",
      rota: rotaCustos,
      arquivo: "custos-energia",
      foco: secEnergia,
      oQueFazer:
        'Na seção "Energia", escolha "Derivada dos equipamentos" em "Como a energia é apurada" e, no campo que aparece, escolha o recurso de energia que dá preço ao kWh.',
      oQueEsperar:
        'A tela passa a mostrar o consumo derivado em kWh por lote de referência, e o selo do cabeçalho vira "Completa".',
      regra:
        "Energia informada diretamente e energia derivada dos equipamentos são exclusivas: somar as duas contaria a mesma energia duas vezes. Modo “não estruturada” não significa consumo zero.",
      sePrender:
        'No modo derivado, equipamento sem potência (kW) cadastrada deixa a energia em aberto, e sem escolher o recurso de tarifa o kWh derivado não vira dinheiro — as duas coisas viram pendência bloqueante.',
    });

    /*
     * Ativar a estrutura: agora sem pendência. A foto é do resultado, com o
     * selo "Ativa" no cabeçalho — é o que o leitor confere para saber que
     * deu certo.
     */
    await clicar("Ativar estrutura");
    await page.waitForTimeout(900);
    if (await dialogo().isVisible().catch(() => false)) {
      anotar(
        "a estrutura ainda tinha pendência depois de configurar a energia — confirmei para seguir; ver diálogo capturado",
      );
      await confirmarDialogo("Ativar");
    }
    await page.waitForTimeout(1600);
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Ativar a estrutura de custos",
      rota: rotaCustos,
      arquivo: "custos-ativada",
      foco: page.locator(".doc-title").first(),
      oQueFazer: 'Com as pendências resolvidas, clique em "Ativar estrutura".',
      oQueEsperar:
        'O cabeçalho passa a mostrar a versão como "Ativa" e "Completa"; os campos de edição somem — estrutura ativa é somente leitura.',
      regra:
        "A ativação CONGELA as premissas econômicas do momento: tarifa vigente e potência de cada recurso viram snapshot da versão. Reajustar uma tarifa amanhã não reescreve custo histórico.",
      sePrender:
        'Se a formulação vinculada ainda for rascunho, a ativação é recusada: "Ative a formulação antes de ativar a estrutura de custos". Estrutura ativa não se edita — alterar exige criar uma nova versão.',
    });

    /* ── Cálculo ────────────────────────────────────────────────────────── */

    /*
     * Calcular é exploração; o resultado ainda não é documento. A foto
     * precisa mostrar o detalhamento (materiais, recursos, energia,
     * premissas) porque é o único lugar onde o número aparece decomposto.
     */
    const secCalculo = secao("Cálculo padrão");
    await rolarAte(secCalculo);
    await clicar("Calcular custo", secCalculo);
    await esperarQuieto(2500);
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Calcular o custo da base de referência",
      rota: rotaCustos,
      arquivo: "calcular-custo",
      foco: secCalculo,
      oQueFazer:
        'Na seção "Cálculo padrão", confira a data de referência de custo e clique em "Calcular custo".',
      oQueEsperar:
        "O resultado aparece decomposto — materiais, recursos, energia e premissas — com o selo de qualidade do custo. Nada foi gravado ainda.",
      regra:
        "A data de referência é decisão de quem calcula, nunca “hoje” implícito: compras posteriores a ela não entram. O mesmo produto calculado em duas datas pode custar diferente, e a resposta precisa dizer de que dia ela fala.",
      sePrender:
        'Calcular não altera nada e pode ser repetido à vontade. Se materiais aparecerem como "sem custo", falta referência de preço para aqueles itens (compra recebida ou preço de fornecedor homologado) — o total sai parcial.',
    });

    /*
     * Salvar é o ato que cria documento. O diálogo é a foto porque é onde o
     * sistema diz a frase que o guia precisa repetir: precificação e CMV vão
     * CITAR este registro, e por isso ele não é reescrito depois.
     */
    await clicar("Salvar cálculo", secCalculo);
    await esperarDialogo();
    const tituloDialogo = await page.locator("#confirm-dialog-title").innerText();
    const incompleto = tituloDialogo.includes("incompleto");
    const idSalvar = proximoId();
    if (incompleto) {
      anotar(
        `o cálculo da trilha ${trilha} saiu incompleto — diálogo "${tituloDialogo}" (ver ${idSalvar})`,
      );
    }
    await passo({
      trilha,
      id: idSalvar,
      titulo: "Salvar o cálculo como base econômica",
      rota: rotaCustos,
      arquivo: "salvar-calculo",
      oQueFazer: 'Clique em "Salvar cálculo" e confirme no diálogo.',
      oQueEsperar:
        'O cálculo ganha código próprio (CALC-…) e passa a aparecer na tabela "Cálculos salvos", com data de referência e qualidade.',
      regra:
        "Salvar CONGELA a base econômica: as referências de custo daquele momento ficam presas ao documento. Precificação e CMV citam este registro — por isso ele é imutável, e um cálculo já citado por uma precificação nem pode ser descartado.",
      sePrender: incompleto
        ? 'O diálogo veio como "Congelar um custo incompleto?": confirmar aqui congela um custo sem total, e o CMV vai mostrar só o subtotal conhecido.'
        : 'Se a formulação tiver componentes por dose sem "doses por embalagem", o sistema recusa salvar: o que se congelaria seria um custo sem matéria-prima.',
    });
    await confirmarDialogo(incompleto ? "Salvar assim mesmo" : "Salvar");
    await page.waitForTimeout(2200);

    /*
     * Salvar LEVA para o documento — e é isso que prova que o cálculo virou
     * registro com endereço próprio. A foto existe porque quem salva pode
     * achar que "saiu da tela": não saiu, chegou ao documento.
     */
    const rotaCalculo = new URL(page.url()).pathname;
    if (/^\/calculos-custo\//.test(rotaCalculo)) {
      await page.waitForSelector(".doc-title", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await passo({
        trilha,
        id: proximoId(),
        titulo: "Ver o cálculo salvo como documento",
        rota: rotaCalculo,
        arquivo: "calculo-salvo",
        foco: secao("Contexto do cálculo"),
        oQueFazer: "Confira o documento para o qual o sistema levou você depois de salvar.",
        oQueEsperar:
          "O cálculo tem código próprio, endereço próprio e diz de qual estrutura, de qual formulação, de qual base de referência e de qual data ele fala.",
        regra:
          "O cálculo salvo é somente leitura: compras, tarifas ou estrutura que mudarem depois não alteram este documento. É por isso que ele serve de base para preço e CMV.",
        sePrender: null,
      });
    } else {
      anotar(
        `depois de salvar o cálculo a tela ficou em ${rotaCalculo} — esperava /calculos-custo/:id`,
      );
    }

    const calculos = await api("GET", `/products/${produto.id}/cost-calculations`);
    const calcSalvo = (calculos.calculations ?? calculos.items ?? calculos)[0] ?? null;
    if (calcSalvo) {
      registrar(
        "Cálculo de custo",
        calcSalvo.code,
        `${produto.code} · qualidade ${calcSalvo.quality}`,
        calcSalvo.id,
        trilha,
      );
    }

    /* ── CMV ────────────────────────────────────────────────────────────── */

    /*
     * O destino. A foto é rolada até os CARDS de valor — cabeçalho não prova
     * nada, o que o leitor precisa reconhecer é o custo total, o custo por
     * unidade e a contagem de lotes.
     */
    await abrir(rotaCmv, ".doc-title");
    await page.waitForTimeout(2000);
    await page.fill("#cmv-quantity", "1000");
    await clicar("Calcular CMV");
    await esperarQuieto(2500);
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Chegar ao CMV do produto",
      rota: rotaCmv,
      arquivo: "cmv-resultado",
      foco: page.locator(".cmv-cards").first(),
      oQueFazer:
        'Abra o CMV do produto, informe a quantidade a simular e a data de referência, e clique em "Calcular CMV".',
      oQueEsperar:
        "Os cards mostram a quantidade simulada, quantos lotes de referência ela representa, o custo total e o custo por unidade, com o selo de qualidade do custo.",
      regra:
        "O CMV é recalculado para a quantidade pedida — não é o custo unitário multiplicado: o custo fixo do lote se dilui, e a contagem de lotes é arredondada para cima. A base é sempre o cálculo salvo mais recente ATÉ a data de referência.",
      sePrender:
        "Simular é leitura: não cria nem altera cálculo nenhum. Se a resposta vier vazia, a data de referência provavelmente é anterior ao cálculo salvo — um cálculo feito depois dela não podia ser conhecido naquele dia.",
    });

    /*
     * A composição agrupada: matéria-prima, embalagem, recurso industrial,
     * overhead. Segunda foto da mesma tela porque o assunto está bem abaixo
     * dos cards e é o que responde "de onde vem esse número".
     */
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Conferir a composição do custo",
      rota: rotaCmv,
      arquivo: "cmv-composicao",
      foco: secao("Composição do custo"),
      oQueFazer:
        'Role até "Composição do custo" e leia as linhas agrupadas por natureza — material de fórmula, embalagem, recurso industrial e overhead.',
      oQueEsperar:
        "Cada linha mostra a quantidade necessária, a origem do custo unitário e o total daquele componente para a quantidade simulada.",
      regra:
        "A composição é a mesma conta que a precificação usa — existe um único motor de custo. Material fornecido pelo cliente aparece separado: entra na receita, mas não é custo da Veridi.",
      sePrender: null,
    });

    /*
     * "Base do cálculo" fecha a rastreabilidade: quais documentos exatos
     * estão por trás do número. É o que o cliente vai querer conferir quando
     * o valor mudar de um mês para o outro.
     */
    await passo({
      trilha,
      id: proximoId(),
      titulo: "Ver de quais documentos o número fala",
      rota: rotaCmv,
      arquivo: "cmv-base",
      foco: secao("Base do cálculo"),
      oQueFazer: 'Role até "Base do cálculo".',
      oQueEsperar:
        "A seção nomeia a formulação, a estrutura de custos e o cálculo salvo que produziram o número, com a data de referência de cada um.",
      regra:
        "A base econômica é congelada, não é o estado de hoje: o CMV fala dos documentos que existiam na data de referência. Por isso um valor de ontem continua reproduzível amanhã.",
      sePrender: null,
    });

    return { calcSalvo };
  }

  /* ═══════════════════════════ TRILHA A ═══════════════════════════════════
   *
   * Pelo Projeto comercial. A ordem aqui não é escolha de roteiro: é o que a
   * API impõe. A proposta só aceita produto que já está no projeto; só
   * proposta completa pode ser enviada; só proposta enviada pode ser aceita;
   * e a aprovação do projeto exige uma proposta ACEITA. Nada disso é
   * adivinhável pela tela — daí o guia.
   */
  console.log("\nTRILHA A — o produto nasce de um Projeto comercial:");
  let contadorA = 0;
  const nA = () => (contadorA += 1);

  const NOME_PROJETO = `${CARIMBO} Linha Vitalidade`;
  const NOME_PRODUTO_A = `${CARIMBO} Pré-Treino Frutas Vermelhas 300g`;

  await abrir("/comercial/projetos", ".page__title");
  await clicar("Novo projeto");
  await page.waitForSelector("#project-name", { timeout: 20000 });
  await escolherEntidade("#project-customer", cliente.code);
  await page.fill("#project-name", NOME_PROJETO);
  await page.fill("#project-concept", "Performance");
  await page.fill("#project-channel", "Distribuidora");
  await page.selectOption("#project-dosage-form", "POWDER");
  await page.selectOption("#project-presentation", "POT");
  await page.fill("#project-minimum-batch", "1000");

  /*
   * Foto com o formulário PREENCHIDO. O modal vazio é o que qualquer um vê
   * ao clicar; o que o leitor precisa reconhecer é onde vai o cliente (campo
   * de busca, não lista) e que o nome do projeto é obrigatório.
   */
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Abrir um projeto comercial",
    rota: "/comercial/projetos",
    arquivo: "novo-projeto",
    foco: "#project-name",
    oQueFazer:
      'Em Comercial › Projetos, clique em "Novo projeto", busque o cliente pelo código ou nome, escreva o nome do projeto e preencha o brief (conceito, canal, forma, apresentação, lote mínimo). Clique em "Criar projeto".',
    oQueEsperar:
      "O projeto é criado com código próprio (PRJ-…) e a tela vai direto para o detalhe dele, no status “Em espera”.",
    regra:
      "Projeto private label sempre pertence a um cliente — e o Projeto não é o Produto: ele é a negociação que existe ANTES do produto. O brief preenchido aqui é herdado pelo produto que nascer deste projeto.",
    sePrender:
      'O botão "Criar projeto" só habilita com cliente escolhido e nome com pelo menos 3 caracteres. O cliente precisa existir antes; se não existir, use "+ Novo cliente" dentro do próprio campo de busca.',
  });

  await clicar("Criar projeto");
  await page.waitForFunction(
    () => /^\/comercial\/projetos\/[0-9a-f-]{10,}$/.test(location.pathname),
    undefined,
    { timeout: 25000 },
  );
  await page.waitForTimeout(1500);
  const projetoId = new URL(page.url()).pathname.split("/").pop();
  const rotaProjeto = `/comercial/projetos/${projetoId}`;
  const projeto = await api("GET", `/projects/${projetoId}`);
  registrar("Projeto", projeto.code, projeto.name, projeto.id, "A");

  /*
   * O produto NASCE aqui, e nasce técnico. A foto é do formulário inline com
   * o nome já digitado, porque a dica embaixo do campo é a regra que mais se
   * erra: o nome é do PRODUTO, não do projeto.
   */
  const secProdutos = secao("Produtos do projeto");
  await clicar("+ Adicionar produto", secProdutos);
  await page.waitForSelector("#new-product-name", { timeout: 20000 });
  await page.fill("#new-product-name", NOME_PRODUTO_A);
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Criar o produto dentro do projeto",
    rota: rotaProjeto,
    arquivo: "criar-produto-do-projeto",
    foco: "#new-product-name",
    oQueFazer:
      'Na seção "Produtos do projeto", clique em "+ Adicionar produto", mantenha "Criar novo produto", escreva o nome do produto e clique em "Criar produto".',
    oQueEsperar:
      "O produto aparece na tabela com código PROD-…, situação técnica “Em desenvolvimento” e situação no projeto “Ativo”. Junto com ele nascem o item de produto acabado e a formulação V1 em rascunho.",
    regra:
      "Produto criado por aqui nasce EM DESENVOLVIMENTO: existe para engenharia, custo e preço, mas não entra em pedido, produção, expedição ou faturamento. Um projeto pode ter vários produtos (três sabores, três produtos).",
    sePrender:
      'Use o nome do produto, não o do projeto: três sabores com o mesmo nome ficam indistinguíveis na produção. "Vincular produto existente" recusa produto de outro cliente — seria misturar propriedade de clientes diferentes.',
  });
  await clicar("Criar produto", secProdutos);
  await page.waitForTimeout(2200);

  const projetoComProduto = await api("GET", `/projects/${projetoId}`);
  const vinculo = projetoComProduto.products[0];
  const produtoA = {
    id: vinculo.productId,
    code: vinculo.productCode,
    name: vinculo.productName,
  };
  registrar("Produto (técnico)", produtoA.code, produtoA.name, produtoA.id, "A");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".doc-title", { timeout: 25000 });
  await page.waitForTimeout(1500);
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Conferir o produto técnico do projeto",
    rota: rotaProjeto,
    arquivo: "produto-em-desenvolvimento",
    foco: secao("Produtos do projeto"),
    oQueFazer:
      'Confira a linha do produto na tabela: código, situação técnica e os atalhos da coluna "Cadeia técnica".',
    oQueEsperar:
      'A situação técnica é "Em desenvolvimento" e a coluna "Cadeia técnica" oferece os quatro destinos do produto: Formulação, CMV, Custos e Precificação.',
    regra:
      'A coluna "Cadeia técnica" é a ponte entre o funil comercial e as telas do produto — é por ela que este guia segue daqui em diante, e é o mesmo destino da trilha pelo cadastro direto.',
    sePrender: null,
  });

  /*
   * Proposta. Cada negociação é uma VERSÃO — e a versão nasce vazia. Esta
   * foto existe para o leitor não achar que criar a versão já é orçar.
   */
  const secOrcamentos = secao("Orçamentos");
  await clicar("Criar nova versão", secOrcamentos);
  await page.waitForTimeout(2200);
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Criar a versão de orçamento",
    rota: rotaProjeto,
    arquivo: "criar-orcamento",
    foco: page.locator(".quote-workspace").first(),
    oQueFazer: 'Na seção "Orçamentos", clique em "Criar nova versão".',
    oQueEsperar:
      'Abre a área de trabalho da versão V1 em Rascunho, ainda sem produto — "Nenhum produto na proposta. Adicione ao menos um para poder enviar."',
    regra:
      "Cada negociação é uma versão. Versão enviada vira histórico e não se edita: renegociar significa criar outra versão, nunca reescrever a anterior.",
    sePrender:
      "Projeto aprovado ou cancelado é histórico e não recebe proposta nova — o botão some e a tela explica por quê.",
  });

  const inlineOrcamento = page.locator(".quote-workspace .inline-form").first();
  await page.selectOption("#quote-add-product", { index: 1 });
  await clicar("Adicionar", inlineOrcamento);
  await page.waitForTimeout(2000);
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Colocar o produto na proposta",
    rota: rotaProjeto,
    arquivo: "orcamento-adicionar-produto",
    foco: page.locator(".table--quote-lines").first(),
    oQueFazer:
      'Em "Adicionar produto à proposta", escolha o produto do projeto e clique em "Adicionar".',
    oQueEsperar:
      "A linha entra na proposta já com a unidade do produto acabado preenchida; quantidade e preço ficam em branco.",
    regra:
      "Só produto que já está NO PROJETO entra na proposta — produto de fora entraria como vínculo inventado. A unidade vem do item de produto acabado; o sistema não pede que se digite de novo o que ele já sabe.",
    sePrender:
      "O mesmo produto não entra duas vezes na mesma proposta: ajuste a linha existente em vez de criar outra.",
  });

  const linhaOrcamento = page.locator(".table--quote-lines tbody tr").first();
  await linhaOrcamento.locator("td.is-numeric input").first().fill("1000");
  await page.keyboard.press("Tab");
  await esperarQuieto(1800);
  const linhaAtualizada = page.locator(".table--quote-lines tbody tr").first();
  await linhaAtualizada.locator("td.is-numeric input").last().fill("38.90");
  await page.keyboard.press("Tab");
  await esperarQuieto(1800);

  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Informar quantidade e preço da linha",
    rota: rotaProjeto,
    arquivo: "orcamento-quantidade-preco",
    foco: page.locator(".table--quote-lines").first(),
    oQueFazer:
      "Preencha a quantidade e o preço unitário na linha da proposta. Cada campo é gravado ao sair dele (Tab ou clique fora).",
    oQueEsperar:
      'O total da linha é calculado e a origem do preço fica registrada como "Manual".',
    regra:
      'Preço tem PROVENIÊNCIA: "Manual" é um número digitado, sem vínculo com cálculo de custo. "Usar precificação" liga a linha a uma faixa ativa e traz a cadeia preço → cálculo → estrutura → fórmula junto.',
    sePrender:
      'A faixa de precificação só se aplica quando a quantidade da linha bate EXATAMENTE com a faixa — o sistema não interpola nem escolhe faixa aproximada.',
  });

  /*
   * Enviar é o primeiro ponto sem volta da trilha A: a versão sai do
   * rascunho e o snapshot do cliente e do projeto fica congelado nela. O
   * diálogo é a foto.
   */
  await clicar("Enviar ao cliente");
  await esperarDialogo("Enviar");
  const tituloEnvio = await page.locator("#confirm-dialog-title").innerText();
  const envioComCustoIncompleto = tituloEnvio.includes("custo incompleto");
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Marcar a proposta como enviada",
    rota: rotaProjeto,
    arquivo: "orcamento-enviar",
    oQueFazer: 'Clique em "Enviar ao cliente" e confirme no diálogo.',
    oQueEsperar:
      'A versão passa a "Enviado", ganha data de envio e vira somente leitura. Aparecem os botões "Registrar aceite" e "Registrar recusa".',
    regra:
      "Enviar não manda e-mail: registra o fato comercial e CONGELA o documento — dados do cliente, do projeto e de cada linha ficam como estavam. É o que a impressão vai usar para sempre.",
    sePrender: envioComCustoIncompleto
      ? 'O diálogo veio como "Enviar com custo incompleto?": o preço pode ir assim, mas a base de custo dele tem pendências.'
      : 'Linha sem quantidade, sem unidade ou sem preço impede o envio: "Informe quantidade, unidade e preço unitário antes de marcar como enviado".',
  });
  await confirmarDialogo(envioComCustoIncompleto ? "Enviar mesmo assim" : "Enviar ao cliente");
  await page.waitForTimeout(1800);

  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Registrar o aceite do cliente",
    rota: rotaProjeto,
    arquivo: "orcamento-registrar-aceite",
    foco: page.locator(".quote-workspace .line-actions").last(),
    // O selo "Enviado" fica logo acima da linha da proposta: sem ele a foto
    // mostra o botão sem mostrar o estado que o habilita.
    ajuste: -160,
    oQueFazer: 'Com a proposta enviada, clique em "Registrar aceite".',
    oQueEsperar:
      'A versão passa a "Aceito". No máximo uma versão aceita vigente por projeto: uma anterior aceita seria substituída.',
    regra:
      "O aceite é registro operacional do “sim” do cliente, não assinatura eletrônica. É ele que libera a aprovação do projeto — e é o conteúdo da proposta aceita que define o que vira produto operacional.",
    sePrender:
      "Só proposta ENVIADA pode ser aceita ou recusada. Recusar não cancela o projeto: outra versão pode ser negociada.",
  });
  await clicar("Registrar aceite");
  await page.waitForTimeout(2200);

  /*
   * A aprovação é O ponto sem volta do funil: é onde o Projeto vira Produto
   * operacional. O diálogo lista o que será aprovado e o que fica fora de
   * escopo — capturar essa tela é o motivo de o guia existir.
   */
  await clicar("Aprovar projeto");
  await esperarDialogo("Aprovar o projeto");
  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Aprovar o projeto",
    rota: rotaProjeto,
    arquivo: "aprovar-projeto",
    oQueFazer: 'Clique em "Aprovar projeto" e leia o diálogo: ele diz quais produtos serão aprovados e quais ficam fora do escopo. Confirme em "Aprovar".',
    oQueEsperar:
      "O projeto passa a “Aprovado” e vira somente leitura; o produto que estava na proposta aceita passa de “Em desenvolvimento” para “Aprovado”.",
    regra:
      "A aprovação é o momento em que o Projeto vira Produto operacional — e o que ela promove é exatamente o que o cliente ACEITOU. Produto do projeto que ficou fora da proposta aceita continua em desenvolvimento, com a história técnica inteira preservada.",
    sePrender:
      '"Selecione/aceite uma versão de orçamento antes de aprovar o projeto" — sem proposta aceita não há o que aprovar. Depois de aprovado o projeto não recebe mais produto nem proposta: para propor de novo, crie um projeto novo.',
  });
  await confirmarDialogo("Aprovar");
  await page.waitForTimeout(2500);

  await passo({
    trilha: "A",
    id: `A-${String(nA()).padStart(2, "0")}`,
    titulo: "Confirmar que o produto ficou operacional",
    rota: rotaProjeto,
    arquivo: "produto-aprovado",
    foco: secao("Produtos do projeto"),
    oQueFazer: "Confira a tabela de produtos do projeto depois da aprovação.",
    oQueEsperar:
      'A situação técnica do produto virou "Aprovado" e a situação no projeto virou "Aprovado". Os botões de edição do projeto sumiram.',
    regra:
      'Só produto APROVADO entra em pedido, ordem de produção, expedição e faturamento. O gate vive no backend: chamar a API direto não contorna a regra.',
    sePrender: null,
  });

  const resultadoA = await trechoComum({
    trilha: "A",
    produto: produtoA,
    formulacaoJaExiste: true,
    n: nA,
  });
  void resultadoA;

  /* ═══════════════════════════ TRILHA B ═══════════════════════════════════
   *
   * Pelo cadastro direto. Sem negociação, sem proposta, sem aprovação: o
   * produto já nasce operacional. Em compensação ele nasce SEM formulação —
   * a única diferença que sobra depois da criação.
   */
  console.log("\nTRILHA B — o produto nasce direto no cadastro:");
  let contadorB = 0;
  const nB = () => (contadorB += 1);
  const NOME_PRODUTO_B = `${CARIMBO} Whey Baunilha 900g`;

  // Sem filtro: o que o leitor vê ao entrar em Cadastros › Produtos é a lista
  // inteira, e a ação principal ("+ Novo produto") no cabeçalho.
  await abrir("/cadastros/produtos", ".page__title");
  await page.waitForTimeout(1200);
  await passo({
    trilha: "B",
    id: `B-${String(nB()).padStart(2, "0")}`,
    titulo: "Abrir o cadastro de produtos",
    rota: "/cadastros/produtos",
    arquivo: "lista-produtos",
    foco: page.locator(".page__header").first(),
    oQueFazer: 'Em Cadastros › Produtos, clique em "+ Novo produto".',
    oQueEsperar: "A tela de cadastro abre em endereço próprio: /cadastros/produtos/novo.",
    regra:
      "O cadastro de produto tem URL própria — sobrevive a um F5, pode ser aberto por link direto e aparece no histórico do navegador. O modal continua servindo à edição, aberto a partir da linha.",
    sePrender: null,
  });

  await abrir("/cadastros/produtos/novo", ".page__title");
  await escolherEntidade("#product-customer", cliente.code);
  await page.fill("#product-name", NOME_PRODUTO_B);
  await page.selectOption("#product-finished-unit", "un");
  await page.selectOption("#product-dosage-form", "POWDER");
  await page.selectOption("#product-presentation", "POT");
  await page.fill("#product-minimum-batch", "1000");
  await page.fill("#product-units-per-box", "12");

  await passo({
    trilha: "B",
    id: `B-${String(nB()).padStart(2, "0")}`,
    titulo: "Preencher o cadastro do produto",
    rota: "/cadastros/produtos/novo",
    arquivo: "novo-produto",
    foco: "#product-name",
    oQueFazer:
      'Busque o cliente, escreva o nome do produto, escolha a unidade de estoque e preencha o perfil industrial (forma, apresentação, lote mínimo, unidades por caixa). Clique em "Criar produto".',
    oQueEsperar:
      "O produto é criado com código PROD-…, já Ativo, junto com o item de produto acabado (PA-…) que controla o estoque dele.",
    regra:
      "Produto pertence a UM cliente, e na criação isso é obrigatório. O item de produto acabado é criado junto e já nasce controlando lote, validade e liberação da Qualidade — esses três são padrão da casa.",
    sePrender:
      'O "Lote mínimo" preenchido aqui vira a base de produção sugerida na estrutura de custos, e "Unidades por caixa" é o que permite usar premissas de custo por caixa de expedição. Sem eles, as duas coisas viram pergunta ou pendência mais adiante.',
  });

  await clicar("Criar produto");
  await page.waitForFunction(
    () => location.pathname === "/cadastros/produtos",
    undefined,
    { timeout: 25000 },
  );
  await page.waitForTimeout(1800);

  const listaB = await api("GET", `/products?search=${encodeURIComponent(NOME_PRODUTO_B)}&pageSize=10`);
  const produtoB = (listaB.products ?? listaB.items ?? []).find((p) => p.name === NOME_PRODUTO_B);
  if (!produtoB) throw new Error("Produto da trilha B não foi encontrado depois de criado.");
  registrar("Produto (direto)", produtoB.code, produtoB.name, produtoB.id, "B");

  await page.fill("#products-search", CARIMBO);
  await page.waitForTimeout(1500);
  await passo({
    trilha: "B",
    id: `B-${String(nB()).padStart(2, "0")}`,
    titulo: "Encontrar o produto recém-criado",
    rota: "/cadastros/produtos",
    arquivo: "produto-criado",
    foco: page.locator("table.table").first(),
    oQueFazer: "De volta à lista, busque o produto pelo nome ou código.",
    oQueEsperar:
      'O produto aparece com código próprio e item de produto acabado (PA-…). Na coluna "Formulação" ele mostra "—": nasceu sem receita.',
    regra:
      "Produto cadastrado direto nasce APROVADO (operacional): pode entrar em pedido e produção imediatamente. É a diferença de ciclo de vida em relação ao produto nascido de projeto, que nasce em desenvolvimento.",
    sePrender:
      "O que ele NÃO tem é formulação: diferente do produto de projeto, nenhuma versão de fórmula é criada junto. A próxima etapa é criá-la.",
  });

  await trechoComum({
    trilha: "B",
    produto: { id: produtoB.id, code: produtoB.code, name: produtoB.name },
    formulacaoJaExiste: false,
    n: nB,
  });
} catch (error) {
  falhaFatal = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  console.error("\nFALHA:", falhaFatal);
  // A foto do momento da falha vale mais que a mensagem: guarda o estado da
  // tela em que a execução parou.
  if (page) {
    await page
      .screenshot({ path: path.join(OUT, "ERRO-estado-no-momento-da-falha.png") })
      .catch(() => {});
  }
} finally {
  const manifesto = {
    gerado: new Date().toISOString(),
    carimbo: CARIMBO,
    viewport: VIEWPORT,
    convergencia:
      "As duas trilhas convergem na FORMULAÇÃO. Da versão de fórmula em diante (formulação → estrutura de custos → cálculo → CMV) as telas e a ordem são idênticas. A única diferença que sobra: pelo Projeto o produto já nasce com a V1 em rascunho; pelo cadastro direto a primeira versão precisa ser criada com \"Criar formulação em branco\".",
    registrosCriados,
    trilhas: {
      A: {
        titulo: "Pelo Projeto comercial",
        resumo:
          "Projeto → produto técnico (em desenvolvimento) → proposta → envio → aceite do cliente → aprovação do projeto (que promove o produto a operacional) → formulação → estrutura de custos → cálculo → CMV.",
        etapas: trilhaA.length,
      },
      B: {
        titulo: "Direto pelo cadastro de produtos",
        resumo:
          "Cadastro do produto (já operacional) → criar a formulação → estrutura de custos → cálculo → CMV.",
        etapas: trilhaB.length,
      },
    },
    trilhaA,
    trilhaB,
    observacoes,
    ...(falhaFatal ? { falha: falhaFatal } : {}),
  };
  fs.writeFileSync(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(manifesto, null, 2)}\n`,
    "utf8",
  );

  if (browser) await browser.close();

  console.log("\n─────────────────────────────────────────────");
  console.log(`Carimbo: ${CARIMBO}`);
  console.log(`Etapas trilha A: ${trilhaA.length}  ·  trilha B: ${trilhaB.length}`);
  console.log(`Saída: ${OUT}`);
  console.log("\nRegistros que ficaram no banco:");
  for (const r of registrosCriados) {
    console.log(`  ${r.trilha.padEnd(12)} ${r.tipo.padEnd(22)} ${String(r.codigo ?? "—").padEnd(14)} ${r.nome}`);
  }
  if (observacoes.length > 0) {
    console.log("\nObservações:");
    for (const o of observacoes) console.log(`  · ${o}`);
  }
  if (consoleErrors.length > 0) {
    console.log(`\nErros de console (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  · ${e}`);
  }
  console.log(
    `\nDuração: ${Math.round((Date.now() - inicio.getTime()) / 1000)}s`,
  );
  process.exit(falhaFatal ? 1 : 0);
}
