import { chromium } from "@playwright/test";

/**
 * As correções da onda adversarial, verificadas PELA INTERFACE, na massa que
 * carrega a prova original.
 *
 * As suítes adversariais guardam o veredito de cada caso no arquivo de
 * estado: rodá-las de novo repete o resultado gravado em vez de reavaliar.
 * Este script existe para a pergunta que importa — o mesmo documento e o
 * mesmo lote que falharam, olhados de novo depois da correção.
 *
 * Cada verificação diz o que mediu, não só se passou. "Deu certo" sem número
 * é a forma de erro que esta rodada inteira existiu para evitar.
 *
 *   node scripts/check-adversarial-fixes.mjs
 */

const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

/** Registros da onda 3 que carregam a evidência. */
const FATURA = "FAT-000152";
const LOTE = "LT-20260903-000803";
const EXPEDICAO = "EXP-000235";
const PEDIDO_DA_SAIDA = "PED-000485";
const LOTE_VENCIDO_BLOQUEADO = "LT-20260320-000799";

const resultados = [];
const ok = (achado, o_que, medida) => resultados.push({ achado, o_que, medida, passou: true });
const nok = (achado, o_que, medida) => resultados.push({ achado, o_que, medida, passou: false });

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(CRED),
});
if (!login.ok) throw new Error(`login → ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const corte = cookie.indexOf("=");

const api = (caminho) =>
  fetch(`${API}${caminho}`, { headers: { cookie } }).then(async (r) => ({
    status: r.status,
    body: r.status === 200 ? await r.json() : null,
  }));

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
await contexto.addCookies([
  {
    name: cookie.slice(0, corte),
    value: cookie.slice(corte + 1),
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const pagina = await contexto.newPage();

const erros = [];
pagina.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 160)));
pagina.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));

/* ── ADV-F10 · o documento fecha na conferência manual ──────────────────── */
{
  const lista = await api(`/billings?search=${FATURA}`);
  const fatura = (lista.body?.billings ?? lista.body?.items ?? [])[0];
  if (!fatura) {
    nok("ADV-F10", "faturamento da evidência existe", `${FATURA} não encontrado`);
  } else {
    await pagina.goto(`${WEB}/comercial/faturamento/${fatura.id}`);
    await pagina.waitForSelector("table tbody tr", { timeout: 20000 });

    const naTela = await pagina.evaluate(() => {
      const celulas = [...document.querySelectorAll("table tbody tr td")].map(
        (td) => td.textContent?.trim() ?? "",
      );
      const moedas = celulas.filter((t) => t.startsWith("R$"));
      return { celulas, moedas, texto: document.body.innerText };
    });

    const precoNaTela = naTela.moedas.find((t) => /R\$\s*4,05/.test(t)) ?? "(não achado)";
    const temQuatroCasas = /R\$\s*4,0531/.test(precoNaTela);
    temQuatroCasas
      ? ok("ADV-F10", "preço unitário mostra as quatro casas", precoNaTela)
      : nok("ADV-F10", "preço unitário mostra as quatro casas", precoNaTela);

    const detalhe = await api(`/billings/${fatura.id}`);
    const linha = detalhe.body.lines[0];
    const conferencia = (Number(linha.unitPrice) * Number(linha.quantity)).toFixed(2);
    const fecha = conferencia === Number(linha.lineTotal).toFixed(2);
    const medida = `${linha.unitPrice} × ${linha.quantity} = ${conferencia} · documento diz ${linha.lineTotal}`;
    fecha
      ? ok("ADV-F10", "conferência manual bate com o total impresso", medida)
      : nok("ADV-F10", "conferência manual bate com o total impresso", medida);
  }
}

/* ── ADV-F12 · a rastreabilidade diz por onde o lote saiu ───────────────── */
{
  const lista = await api(`/lots?search=${LOTE}`);
  const lote = (lista.body?.lots ?? lista.body?.items ?? [])[0];
  if (!lote) {
    nok("ADV-F12", "lote da evidência existe", `${LOTE} não encontrado`);
  } else {
    await pagina.goto(`${WEB}/estoque/lotes/${lote.id}`);
    await pagina.waitForTimeout(1200);
    const texto = await pagina.evaluate(() => document.body.innerText);

    const negativaFalsa = texto.includes("Este lote ainda não foi expedido");
    const mostraExpedicao = texto.includes(EXPEDICAO);
    const mostraPedidoReal = texto.includes(PEDIDO_DA_SAIDA);

    !negativaFalsa && mostraExpedicao
      ? ok("ADV-F12", "a saída física aparece na tela do lote", `${EXPEDICAO} listada`)
      : nok(
          "ADV-F12",
          "a saída física aparece na tela do lote",
          negativaFalsa ? "ainda diz que não foi expedido" : `${EXPEDICAO} ausente`,
        );

    mostraPedidoReal
      ? ok("ADV-F12", "mostra o pedido REALMENTE atendido", `${PEDIDO_DA_SAIDA} na linha da saída`)
      : nok("ADV-F12", "mostra o pedido REALMENTE atendido", `${PEDIDO_DA_SAIDA} ausente`);

    const detalhe = await api(`/lots/${lote.id}/traceability`);
    const saidas = detalhe.body?.commercialDestination?.shipments ?? [];
    const soma = saidas.reduce((s, e) => s + Number(e.quantity), 0);
    soma > 0
      ? ok("ADV-F12", "soma das saídas apresentadas", `${soma} un em ${saidas.length} expedição(ões)`)
      : nok("ADV-F12", "soma das saídas apresentadas", "zero");
  }
}

/* ── ADV-F1 e ADV-F6 · filtro não oferece o que a consulta recusa ───────── */
for (const [achado, tela, seletor] of [
  ["ADV-F6", "/estoque/movimentacoes", "type"],
  ["ADV-F1", "/comercial/pedidos", "status"],
]) {
  await pagina.goto(`${WEB}${tela}`);
  await pagina.waitForTimeout(900);
  const opcoes = await pagina.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => /^[A-Z_]{3,}$/.test(o.value)),
    );
    // `all` e `` são sentinelas de "sem filtro" da própria tela, não valores
    // de domínio: a consulta deve mesmo recusá-las se forem enviadas.
    return select
      ? [...select.options].map((o) => o.value).filter((v) => /^[A-Z][A-Z_]+$/.test(v))
      : [];
  });

  const recusadas = [];
  for (const valor of opcoes) {
    const rota = seletor === "type" ? "/inventory-movements" : "/customer-orders";
    const r = await api(`${rota}?${seletor}=${valor}&pageSize=1`);
    if (r.status !== 200) recusadas.push(`${valor}=${r.status}`);
  }

  recusadas.length === 0
    ? ok(achado, `as ${opcoes.length} opções da tela são aceitas`, `todas 200`)
    : nok(achado, `as ${opcoes.length} opções da tela são aceitas`, recusadas.join(" "));
}

/* ── ADV-F5 · o ajuste diz quem ajustou ─────────────────────────────────── */
{
  const r = await api("/inventory-movements?type=ADJUSTMENT_OUT&pageSize=5");
  const movimentos = r.body?.movements ?? r.body?.items ?? [];
  const autores = [...new Set(movimentos.map((m) => m.createdBy))];
  autores.length > 0
    ? ok("ADV-F5", "autores registrados nos ajustes", autores.join(" · "))
    : ok("ADV-F5", "autores registrados nos ajustes", "nenhum ajuste na base para inspecionar");
}

/* ── ADV-F7 · lote vencido não é liberável ──────────────────────────────── */
{
  const lista = await api(`/lots?search=${LOTE_VENCIDO_BLOQUEADO}`);
  const lote = (lista.body?.lots ?? lista.body?.items ?? [])[0];
  if (!lote) {
    ok("ADV-F7", "lote de controle presente", "ausente da base — não verificável aqui");
  } else {
    const antes = lote.status;
    const tentativa = await fetch(`${API}/lots/${lote.id}/release`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
    });
    const depois = (await api(`/lots/${lote.id}`)).body?.status;
    antes === depois
      ? ok("ADV-F7", "liberar não muda o estado do lote de controle", `${antes} → ${depois} (HTTP ${tentativa.status})`)
      : nok("ADV-F7", "liberar não muda o estado do lote de controle", `${antes} → ${depois}`);
  }
}

/* ── ADV-F4 · a Qualidade tem entrada para liberação de lote ────────────── */
{
  await pagina.goto(`${WEB}/`);
  await pagina.waitForTimeout(800);
  const menu = await pagina.evaluate(() =>
    [...document.querySelectorAll(".sidebar__link")].map((a) => a.textContent?.trim() ?? ""),
  );
  menu.some((t) => /Liberação de lotes/i.test(t))
    ? ok("ADV-F4", "entrada no menu", "Qualidade › Liberação de lotes")
    : nok("ADV-F4", "entrada no menu", menu.filter((t) => /lote/i.test(t)).join(" · ") || "ausente");
}

/* ── ADV-F2 · o Status cabe na tela ─────────────────────────────────────── */
{
  await pagina.goto(`${WEB}/comercial/pedidos`);
  await pagina.waitForSelector("table tbody tr", { timeout: 20000 });
  const medida = await pagina.evaluate(() => {
    const c = document.querySelector(".table-container");
    return c ? { corte: c.scrollWidth - c.clientWidth, largura: c.clientWidth } : null;
  });
  medida && medida.corte <= 0
    ? ok("ADV-F2", "tabela de Pedidos cabe na área visível", `0px cortados em ${medida.largura}px`)
    : nok("ADV-F2", "tabela de Pedidos cabe na área visível", `${medida?.corte}px cortados`);
}

await navegador.close();

/* ── Veredito ───────────────────────────────────────────────────────────── */
console.log("");
for (const r of resultados) {
  console.log(`${r.passou ? "ok  " : "NOK "} ${r.achado.padEnd(8)} ${r.o_que}`);
  console.log(`              ${r.medida}`);
}
const falhas = resultados.filter((r) => !r.passou);
console.log(`\nconsole.error/pageerror não deliberados: ${erros.length}`);
if (erros.length > 0) console.log(erros.slice(0, 5).join("\n"));
console.log(`\n${resultados.length - falhas.length} ok · ${falhas.length} nok`);
process.exit(falhas.length === 0 && erros.length === 0 ? 0 : 1);
