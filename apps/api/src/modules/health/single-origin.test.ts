import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Implantação de origem única: a API serve o build do frontend.
 *
 * O que estes testes protegem é o motivo de existir dessa configuração — a
 * sessão vive em cookie `SameSite=Lax`, então front e API precisam estar na
 * mesma origem. Servir estático não pode, em troca, abrir buraco na
 * autenticação nem transformar erro de API em página HTML.
 */

const distDir = path.join(os.tmpdir(), `veridi-web-dist-${process.pid}`);
const INDEX_HTML = "<!doctype html><title>Veridi</title><div id=root></div>";

let buildApp: typeof import("../../app.js").buildApp;

beforeAll(async () => {
  fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(distDir, "assets", "app.js"), "console.log('veridi');");

  process.env["VERIDI_WEB_DIST"] = distDir;
  // O env é validado uma vez na importação: só depois de definir a variável.
  ({ buildApp } = await import("../../app.js"));
});

afterAll(() => {
  delete process.env["VERIDI_WEB_DIST"];
  fs.rmSync(distDir, { recursive: true, force: true });
});

describe("Origem única — API servindo o frontend", () => {
  it("entrega o app e seus arquivos sem exigir sessão", async () => {
    const app = buildApp();
    await app.ready();

    const index = await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("Veridi");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);

    await app.close();
  });

  it("devolve o app em rota do SPA — o roteamento é no cliente", async () => {
    const app = buildApp();
    await app.ready();

    const spa = await app.inject({
      method: "GET",
      url: "/comercial/pedidos",
      headers: { accept: "text/html" },
    });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("Veridi");

    await app.close();
  });

  it("não transforma rota de API inexistente em HTML", async () => {
    const app = buildApp();
    await app.ready();

    const missing = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "not_found" });

    await app.close();
  });

  it("continua exigindo sessão nas rotas de dados", async () => {
    // A liberação do estático é por rota casada, não por cabeçalho: pedir
    // HTML não pode virar um caminho para ler dados sem sessão.
    const app = buildApp();
    await app.ready();

    for (const url of ["/items", "/projects", "/customers"]) {
      const anonymous = await app.inject({ method: "GET", url, headers: { accept: "text/html" } });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json()).toMatchObject({ error: "not_authenticated" });
    }

    await app.close();
  });
});
