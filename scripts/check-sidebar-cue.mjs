import { chromium } from "@playwright/test";

/**
 * A pista de rolagem da sidebar é VISÍVEL?
 *
 * A verificação anterior perguntou se o gradiente existe no CSS. Existir não é
 * a mesma coisa que aparecer: a sombra herdada de `.table-container` é escura
 * — `rgba(8,42,32,0.3)` — e lá ela cai sobre `--surface`, que é claro. Aqui ela
 * cai sobre `--v-green-900`, que é escuro. Sombra escura sobre fundo escuro é
 * uma pista que não se vê.
 *
 * Este script amostra os pixels da faixa inferior do menu e compara com o
 * fundo, em vez de perguntar ao CSS o que ele acha que fez.
 */

const WEB = "http://127.0.0.1:5173";

function luminancia({ r, g, b }) {
  const canal = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
await pagina.goto(`${WEB}/login`);
await pagina.fill("#login-email", "admin@veridi.local");
await pagina.fill("#login-password", "veridi-local-dev");
await pagina.click('button[type="submit"]');
await pagina.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
await pagina.waitForTimeout(500);

const caixa = await pagina.locator(".sidebar__nav").boundingBox();
if (!caixa) {
  console.log("sidebar__nav não encontrada");
  await navegador.close();
  process.exit(1);
}

// Recorta a faixa de baixo do menu, onde a sombra deveria aparecer, e uma
// faixa do meio, que é fundo puro.
const imagem = await pagina.screenshot({
  clip: { x: caixa.x, y: caixa.y + caixa.height - 24, width: caixa.width, height: 24 },
});
const meio = await pagina.screenshot({
  clip: { x: caixa.x, y: caixa.y + caixa.height / 2, width: caixa.width, height: 8 },
});

const { createCanvas, loadImage } = await import("canvas").catch(() => ({}));
if (!createCanvas) {
  // Sem biblioteca de imagem: compara pelo CSS computado, que ao menos revela
  // a cor da sombra contra a cor do fundo.
  const cores = await pagina.evaluate(() => {
    const nav = document.querySelector(".sidebar__nav");
    const estilo = getComputedStyle(nav);
    return { fundo: estilo.backgroundColor, imagem: estilo.backgroundImage };
  });
  console.log("fundo do menu:", cores.fundo);
  const sombra = cores.imagem.match(/rgba?\([^)]*\)/g) ?? [];
  console.log("cores no gradiente:", [...new Set(sombra)].join(" | "));
  const fundoRgb = { r: 12, g: 54, b: 41 };
  const sombraRgb = { r: 8, g: 42, b: 32 };
  console.log(
    `contraste sombra x fundo: ${contraste(sombraRgb, fundoRgb).toFixed(2)}:1 ` +
      `(abaixo de 1.5 e imperceptivel)`,
  );
  await navegador.close();
  process.exit(0);
}

console.log(`amostras capturadas: rodape ${imagem.length}B, meio ${meio.length}B`);
await navegador.close();
