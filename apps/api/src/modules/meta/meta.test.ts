import { afterAll, describe, expect, it, vi } from "vitest";
import { VERIDI_VERSION } from "@veridi/shared";

/**
 * `GET /meta` — versão, ambiente e commit do sistema no ar
 * (VERIDI-SYSTEM-VERSIONING-01).
 *
 * O arquivo sobe a app como o Railway a sobe: com o nome do ambiente e o commit
 * injetados no processo ANTES do `env` ser lido. Assim a rota prova também que
 * o esquema do `env` deixa as duas variáveis passarem — sem elas no esquema, o
 * zod as descartaria e PROD responderia "test"/`null` sem erro nenhum.
 */
const railway = vi.hoisted(() => {
  const valores = {
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  };
  Object.assign(process.env, valores);
  return valores;
});

import { buildApp } from "../../app.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { resolveSystemMeta } from "./meta.routes.js";

afterAll(() => {
  for (const chave of Object.keys(railway)) delete process.env[chave];
});

describe("GET /meta", () => {
  it("responde a versão da fonte única, o ambiente e o commit do deploy — e nada além", async () => {
    const app = buildTestApp("VIEWER");
    await app.ready();

    const resposta = await app.inject({ method: "GET", url: "/meta" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      version: "1.0.0",
      environment: "production",
      commitHash: railway.RAILWAY_GIT_COMMIT_SHA,
    });
    // Nenhum segredo do processo vaza pela resposta — nem a URL do banco.
    expect(resposta.body).not.toContain(process.env["DATABASE_URL"] ?? "<sem DATABASE_URL>");
    expect(resposta.body).not.toMatch(/postgres(ql)?:\/\//i);

    await app.close();
  });

  it("exige sessão, como toda rota fora da lista pública", async () => {
    const app = buildApp();
    await app.ready();

    const resposta = await app.inject({ method: "GET", url: "/meta" });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.body).not.toContain(VERIDI_VERSION);

    await app.close();
  });
});

describe("resolveSystemMeta", () => {
  const SHA = "ff861c90512232bb5a168c304a186747150576d0";

  it("a fonte única diz 1.0.0", () => {
    expect(VERIDI_VERSION).toBe("1.0.0");
    expect(resolveSystemMeta({ NODE_ENV: "production" }).version).toBe(VERIDI_VERSION);
  });

  it("no Railway: o nome do ambiente e o commit publicado", () => {
    expect(
      resolveSystemMeta({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "production",
        RAILWAY_GIT_COMMIT_SHA: SHA.toUpperCase(),
      }),
    ).toEqual({ version: VERIDI_VERSION, environment: "production", commitHash: SHA });
  });

  it("outro ambiente do Railway aparece com o nome dele", () => {
    expect(
      resolveSystemMeta({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "homologacao" }).environment,
    ).toBe("homologacao");
  });

  it("fora do Railway: o NODE_ENV, e commit nulo — não se inventa build", () => {
    expect(resolveSystemMeta({ NODE_ENV: "development" })).toEqual({
      version: VERIDI_VERSION,
      environment: "development",
      commitHash: null,
    });
    expect(resolveSystemMeta({ NODE_ENV: "test", RAILWAY_ENVIRONMENT_NAME: "" }).environment).toBe("test");
  });

  it("valor fora do formato vira o padrão, não texto livre na tela", () => {
    const meta = resolveSystemMeta({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "<script>alert(1)</script>",
      RAILWAY_GIT_COMMIT_SHA: "ghp_segredoQueNaoEhCommit",
    });
    expect(meta.environment).toBe("development");
    expect(meta.commitHash).toBeNull();
    expect(resolveSystemMeta({ NODE_ENV: "production", RAILWAY_GIT_COMMIT_SHA: "abc12" }).commitHash).toBeNull();
  });

  it("monta a resposta campo a campo: o resto do ambiente não sai", () => {
    const ambiente = {
      NODE_ENV: "production" as const,
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_GIT_COMMIT_SHA: SHA,
      DATABASE_URL: "postgresql://veridi:senha-secreta@host.interno:5432/veridi",
      VERIDI_R2_SECRET_ACCESS_KEY: "chave-secreta-do-r2",
      RAILWAY_PROJECT_ID: "id-do-projeto",
    };

    const meta = resolveSystemMeta(ambiente);

    expect(Object.keys(meta).sort()).toEqual(["commitHash", "environment", "version"]);
    const texto = JSON.stringify(meta);
    for (const segredo of ["senha-secreta", "chave-secreta-do-r2", "id-do-projeto", "host.interno"]) {
      expect(texto).not.toContain(segredo);
    }
  });
});
