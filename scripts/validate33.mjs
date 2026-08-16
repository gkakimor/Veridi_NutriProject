import { chromium } from "@playwright/test";
import path from "node:path";

const OUT = process.argv[2] ?? ".";
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

await shot("33-items-list", "/cadastros/itens");
await shot("33-item-modal", "/cadastros/itens", async () => {
  await page.getByRole("button", { name: /Novo item/i }).click();
  await page.waitForTimeout(400);
  await page.locator("#item-type").selectOption("PACKAGING");
  await page.waitForTimeout(300);
});
await shot("33-products-list", "/cadastros/produtos");
await shot("33-product-modal", "/cadastros/produtos", async () => {
  await page.getByRole("button", { name: /Novo produto/i }).click();
  await page.waitForTimeout(600);
});
await shot("33-customer-modal", "/cadastros/clientes", async () => {
  await page.getByRole("button", { name: /Novo cliente/i }).click();
  await page.waitForTimeout(400);
});

console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
for (const error of errors) console.log("  --", error);
await browser.close();
