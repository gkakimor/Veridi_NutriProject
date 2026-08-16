import { chromium } from "@playwright/test";
import path from "node:path";

const OUT = process.argv[2] ?? ".";
const PRODUCT = process.argv[3];
const VERSION = process.argv[4];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function shot(name, route, action) {
  await page.goto(`http://localhost:5173${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if (action) await action();
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log("ok", name);
}

await shot("34-formulations-list", "/producao/formulacoes");
await shot("34-version-per-dose", `/producao/formulacoes/${PRODUCT}/versoes/${VERSION}`);
await shot("34-version-draft", `/producao/formulacoes/${PRODUCT}/versoes/${VERSION}`, async () => {
  await page.getByRole("button", { name: /Criar nova versão/i }).click();
  await page.waitForTimeout(1200);
});

console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
for (const error of errors) console.log("  --", error);
await browser.close();
