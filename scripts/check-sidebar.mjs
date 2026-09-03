import { chromium } from "@playwright/test";

/**
 * Mede a sidebar depois da correção, nos quatro viewports do handoff.
 *
 * O que interessa não é "cabe tudo" — trinta e dois itens não cabem em 720px
 * de altura e nem deveriam. O que interessa é que a rolagem esteja no miolo (e
 * não na coluna), que exista pista visual, e que o item ativo se revele ao
 * entrar direto numa rota de baixo.
 */

const WEB = "http://127.0.0.1:5173";
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
];

const navegador = await chromium.launch();
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();

await pagina.goto(`${WEB}/login`);
await pagina.fill("#login-email", "admin@veridi.local");
await pagina.fill("#login-password", "veridi-local-dev");
await pagina.click('button[type="submit"]');
await pagina.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

console.log("viewport      coluna  miolo   conteudo  rola?  pista");
for (const viewport of VIEWPORTS) {
  await pagina.setViewportSize(viewport);
  await pagina.waitForTimeout(250);

  const medida = await pagina.evaluate(() => {
    const coluna = document.querySelector(".sidebar");
    const miolo = document.querySelector(".sidebar__nav");
    if (!coluna || !miolo) return null;
    const estilo = getComputedStyle(miolo);
    return {
      colunaRola: coluna.scrollHeight > coluna.clientHeight,
      colunaAltura: coluna.clientHeight,
      mioloAltura: miolo.clientHeight,
      conteudo: miolo.scrollHeight,
      mioloRola: miolo.scrollHeight > miolo.clientHeight,
      temPista: estilo.backgroundImage.includes("gradient"),
    };
  });

  if (!medida) {
    console.log(`${viewport.width}x${viewport.height}  ESTRUTURA NAO ENCONTRADA`);
    continue;
  }
  console.log(
    `${String(`${viewport.width}x${viewport.height}`).padEnd(13)} ` +
      `${String(medida.colunaAltura).padEnd(7)} ${String(medida.mioloAltura).padEnd(7)} ` +
      `${String(medida.conteudo).padEnd(9)} ${medida.mioloRola ? "sim" : "nao"}    ` +
      `${medida.temPista ? "sim" : "NAO"}` +
      `${medida.colunaRola ? "   [ALERTA: a coluna inteira rola]" : ""}`,
  );
}

// Item ativo abaixo da dobra deve se revelar sozinho.
await pagina.setViewportSize({ width: 1440, height: 900 });
await pagina.goto(`${WEB}/gestao/precificacao`);
await pagina.waitForTimeout(600);
const ativo = await pagina.evaluate(() => {
  const miolo = document.querySelector(".sidebar__nav");
  const item = document.querySelector(".sidebar__link.is-active");
  if (!miolo || !item) return null;
  const caixaMiolo = miolo.getBoundingClientRect();
  const caixaItem = item.getBoundingClientRect();
  return {
    rotulo: item.textContent?.trim(),
    visivel: caixaItem.top >= caixaMiolo.top - 1 && caixaItem.bottom <= caixaMiolo.bottom + 1,
    rolagem: miolo.scrollTop,
  };
});
console.log(
  `\nitem ativo apos entrar direto em /gestao/precificacao: ` +
    `"${ativo?.rotulo}" visivel=${ativo?.visivel} scrollTop=${ativo?.rolagem}`,
);

await navegador.close();
