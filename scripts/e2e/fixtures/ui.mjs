/**
 * Gestos de interface que toda suíte repete — sem regra de negócio.
 */

/** Opção de REGISTRO num seletor de entidade: "+ Novo …" também é `option`. */
export const OPCAO_DE_REGISTRO = '[role="option"]:not(.entity-select__create)';

/** O pathname casa (texto exato ou regex) e, se pedido, a consulta também. */
export function rotaCasa(url, caminho, consulta) {
  const alvo = url instanceof URL ? url : new URL(url);
  const pathname = alvo.pathname.replace(/\/+$/, "") || "/";
  const casaCaminho =
    typeof caminho === "string" ? pathname === (caminho.replace(/\/+$/, "") || "/") : caminho.test(pathname);
  return casaCaminho && (!consulta || consulta(alvo.searchParams));
}

/**
 * Espera a rota pelo PATHNAME. Regex contra a URL inteira quebra quando a tela
 * passa a devolver consulta — `/cadastros/clientes?ids=<id>` desde
 * CUSTOMER-COMMERCIAL-STATUS-01. Devolve a URL alcançada.
 *
 *   const url = await esperarRota(pagina, "/cadastros/clientes");
 *   const idDoCliente = url.searchParams.get("ids");
 */
export async function esperarRota(pagina, caminho, { timeout = 25000, consulta } = {}) {
  await pagina.waitForURL((url) => rotaCasa(url, caminho, consulta), { timeout });
  return new URL(pagina.url());
}

/**
 * Chega a uma tela pelo menu lateral, como a pessoa faz: o grupo abre (pelo
 * cabeçalho no menu expandido, pelo ícone no trilho) e o item é clicado.
 *
 *   await abrirPeloMenu(pagina, { grupo: "commercial", item: "Orçamentos" });
 */
export async function abrirPeloMenu(pagina, { grupo, item, timeout = 25000 }) {
  const menu = pagina.locator("nav#sidebar");
  await menu.waitFor({ timeout });
  const link = menu.getByRole("link", { name: item, exact: true });
  if (!(await link.isVisible())) {
    const trilho = menu.locator(`[data-rail="${grupo}"]`);
    if ((await trilho.count()) > 0) await trilho.click();
    else await menu.locator(`[data-group-toggle="${grupo}"]`).click();
  }
  await link.click({ timeout });
}

/**
 * Escolhe um REGISTRO num seletor de entidade digitando, como a pessoa faz.
 * Ignora a ação "criar novo" — que também é `option`, repete o texto digitado
 * e tira a pessoa da tela.
 */
export async function escolherOpcao(pagina, campo, termo, { texto = termo, timeout = 15000 } = {}) {
  const alvo = typeof campo === "string" ? pagina.locator(campo).first() : campo;
  await alvo.click();
  await alvo.fill("");
  await alvo.pressSequentially(termo, { delay: 20 });
  const opcao = pagina
    .locator(OPCAO_DE_REGISTRO, { hasText: texto })
    .filter({ hasNotText: /^\s*\+/ })
    .first();
  await opcao.waitFor({ state: "visible", timeout });
  await opcao.click();
}
