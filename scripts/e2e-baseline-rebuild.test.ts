import { describe, expect, it } from "vitest";
import { resolverAlvo } from "./e2e-baseline-rebuild.mjs";

/**
 * DEV-REALDATA-BASELINE-RESET-01 — a guarda do rebuild da base E2E.
 *
 * O comando faz `DROP DATABASE`. O que ele pode derrubar é decidido aqui,
 * antes de qualquer efeito: servidor local, nome com `e2e_baseline`, nunca o
 * banco da `.env` (o DEV de quem usa o sistema) e nenhuma marca de produção.
 */

const LOCAL = "postgresql://usuario:segredo@localhost:5432/veridi_dev?schema=public";

describe("resolverAlvo", () => {
  it("usa veridi_e2e_baseline no mesmo servidor, com a mesma credencial, trocando só o banco", () => {
    const alvo = resolverAlvo({ DATABASE_URL: LOCAL });
    expect(alvo.banco).toBe("veridi_e2e_baseline");
    const url = new URL(alvo.url);
    expect(url.pathname).toBe("/veridi_e2e_baseline");
    expect([url.hostname, url.port, url.username, url.password, url.search]).toEqual([
      "localhost",
      "5432",
      "usuario",
      "segredo",
      "?schema=public",
    ]);
  });

  it("aceita outro nome de base E2E pelo ambiente", () => {
    expect(resolverAlvo({ DATABASE_URL: LOCAL, E2E_BASELINE_DATABASE: "veridi_e2e_baseline_wt2" }).banco).toBe(
      "veridi_e2e_baseline_wt2",
    );
  });

  it.each([
    ["o DEV pelo nome", "veridi_dev"],
    ["nome sem e2e_baseline", "veridi_e2e"],
    ["aspas no nome", 'veridi_e2e_baseline"; DROP DATABASE veridi_dev; --'],
    ["maiúscula no nome", "Veridi_E2E_Baseline"],
  ])("recusa %s", (_caso, nome) => {
    expect(() => resolverAlvo({ DATABASE_URL: LOCAL, E2E_BASELINE_DATABASE: nome })).toThrow(/RECUSADO/);
  });

  it("recusa quando o banco da .env já é a base E2E", () => {
    const env = { DATABASE_URL: LOCAL.replace("/veridi_dev", "/veridi_e2e_baseline") };
    expect(() => resolverAlvo(env)).toThrow(/não pode ser o banco da \.env/);
  });

  it("recusa marca de produção no nome do destino", () => {
    expect(() => resolverAlvo({ DATABASE_URL: LOCAL, E2E_BASELINE_DATABASE: "veridi_e2e_baseline_prod" })).toThrow(
      /RECUSADO/,
    );
  });

  it.each([
    ["servidor remoto", { DATABASE_URL: "postgresql://u:p@db.exemplo.com:5432/veridi_dev" }],
    ["host do Railway", { DATABASE_URL: "postgresql://u:p@tokaido.proxy.rlwy.net:5432/railway" }],
    ["credencial de produção no ambiente", { DATABASE_URL: LOCAL, DATABASE_PUBLIC_URL: "postgresql://u:p@x/y" }],
    ["sem DATABASE_URL", {}],
  ])("recusa %s antes de qualquer efeito", (_caso, env) => {
    expect(() => resolverAlvo(env as Record<string, string>)).toThrow(/RECUSADO/);
  });
});
