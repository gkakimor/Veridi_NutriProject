import { describe, expect, it } from "vitest";
import {
  BancoDeTesteRecusadoError,
  ambienteComBancoDeTeste,
  exigirBancoDeTeste,
  resolverBancoDeTeste,
} from "./banco-de-teste.js";

/**
 * Qual banco a suíte da API usa, e quando ela se recusa a rodar
 * (TEST-SUPPORT-ISOLATION-WAVE-01).
 *
 * É a barreira entre os testes — que apagam calendário, regravam jornada e
 * criam usuário — e o banco de quem usa o sistema. Sem banco: só a regra.
 */

const DEV = "postgresql://veridi:s3nh%40secreta@localhost:5432/veridi_dev?schema=public";

const recusa = (fn: () => unknown) => {
  try {
    fn();
  } catch (erro) {
    expect(erro).toBeInstanceOf(BancoDeTesteRecusadoError);
    return (erro as Error).message;
  }
  throw new Error("esperava recusa, e a suíte rodaria");
};

describe("sem TEST_DATABASE_URL, o banco de teste é <banco da DATABASE_URL>_test", () => {
  it("mesmo servidor, mesma credencial e parâmetros — nunca o banco da DATABASE_URL", () => {
    const banco = resolverBancoDeTeste({ DATABASE_URL: DEV });
    expect(banco.origem).toBe("DATABASE_URL");
    expect(banco.banco).toBe("veridi_dev_test");
    expect(banco.alvo).toBe("localhost:5432/veridi_dev_test");
    const u = new URL(banco.url);
    expect([u.username, u.password, u.hostname, u.port, u.searchParams.get("schema")]).toEqual([
      "veridi",
      "s3nh%40secreta",
      "localhost",
      "5432",
      "public",
    ]);
  });

  it("banco da DATABASE_URL que já tem 'test' no nome também ganha _test: o do DEV nunca é usado direto", () => {
    const worktree = "postgresql://u:p@localhost:5432/veridi_wt_test_support?schema=public";
    expect(resolverBancoDeTeste({ DATABASE_URL: worktree }).banco).toBe("veridi_wt_test_support_test");
  });

  it("o ambiente dos workers leva a DATABASE_URL trocada e mantém o resto", () => {
    const ambiente = ambienteComBancoDeTeste({ DATABASE_URL: DEV, API_PORT: "3333" });
    expect(ambiente["API_PORT"]).toBe("3333");
    expect(new URL(ambiente["DATABASE_URL"]!).pathname).toBe("/veridi_dev_test");
  });
});

describe("TEST_DATABASE_URL — o banco que o CI entrega pronto", () => {
  it.each(["veridi_test", "veridi_ci_4821_test", "test_4821", "app-test-2"])("aceita nome dinâmico com a palavra test: %s", (nome) => {
    const banco = resolverBancoDeTeste({ DATABASE_URL: DEV, TEST_DATABASE_URL: `postgresql://ci:ci@postgres:5432/${nome}` });
    expect(banco.origem).toBe("TEST_DATABASE_URL");
    expect(banco.banco).toBe(nome);
  });

  it("vale sem DATABASE_URL nenhuma", () => {
    expect(resolverBancoDeTeste({ TEST_DATABASE_URL: "postgresql://ci:ci@localhost:5432/veridi_test" }).banco).toBe(
      "veridi_test",
    );
  });

  // O banco do DEV de um worktree pode ter a palavra no nome; apontar
  // TEST_DATABASE_URL para ele continua sendo o banco de quem usa o sistema.
  it.each([
    "postgresql://u:p@localhost:5432/veridi_wt_test_x",
    "postgresql://outro:senha@127.0.0.1:5432/VERIDI_WT_TEST_X?schema=public",
    "postgresql://u:p@[::1]/veridi_wt_test_x",
  ])("recusa o mesmo banco da DATABASE_URL, escrito de outro jeito: %s", (url) => {
    const dev = "postgresql://u:p@localhost:5432/veridi_wt_test_x?schema=public";
    expect(recusa(() => resolverBancoDeTeste({ DATABASE_URL: dev, TEST_DATABASE_URL: url }))).toMatch(
      /mesmo banco da DATABASE_URL/,
    );
  });
});

describe("fail closed: destino que não se prova de teste não roda", () => {
  it.each(["veridi_dev", "veridi", "latest", "contest_db", "testing", "veridi_attest"])("nome sem a palavra test: %s", (nome) => {
    expect(recusa(() => exigirBancoDeTeste(`postgresql://u:p@localhost:5432/${nome}`))).toMatch(/palavra "test"/);
  });

  it.each(["veridi_prod_test", "production_test", "veridi_producao_test", "live_test", "railway_test"])(
    "nome com marca de produção: %s",
    (nome) => {
      expect(recusa(() => exigirBancoDeTeste(`postgresql://u:p@localhost:5432/${nome}`))).toMatch(/marca de produção/);
    },
  );

  it("DATABASE_URL de produção no Railway não vira banco de teste por ganhar _test", () => {
    const producao = "postgresql://postgres:segredo@postgres.railway.internal:5432/railway";
    expect(recusa(() => resolverBancoDeTeste({ DATABASE_URL: producao }))).toMatch(/marca de produção|banco gerenciado/);
    const publica = "postgresql://postgres:segredo@shuttle.proxy.rlwy.net:41234/veridi";
    expect(recusa(() => resolverBancoDeTeste({ DATABASE_URL: publica }))).toMatch(/banco gerenciado "rlwy.net"/);
  });

  it.each(["DATABASE_PUBLIC_URL", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"])("sessão com %s no ambiente", (chave) => {
    expect(recusa(() => resolverBancoDeTeste({ DATABASE_URL: DEV, [chave]: "x" }))).toMatch(/acesso à produção/);
  });

  it("sem banco nenhum, URL ilegível ou banco que não é PostgreSQL", () => {
    expect(recusa(() => resolverBancoDeTeste({}))).toMatch(/nem TEST_DATABASE_URL nem DATABASE_URL/);
    expect(recusa(() => resolverBancoDeTeste({ DATABASE_URL: "veridi_dev" }))).toMatch(/URL válida/);
    expect(recusa(() => exigirBancoDeTeste("mysql://u:p@localhost:3306/veridi_test"))).toMatch(/PostgreSQL/);
    expect(recusa(() => exigirBancoDeTeste(undefined))).toMatch(/nenhum banco/);
  });

  it("a mensagem de recusa nunca carrega a senha", () => {
    const mensagem = recusa(() => exigirBancoDeTeste("postgresql://veridi:s3nh%40secreta@localhost:5432/veridi_dev"));
    expect(mensagem).toContain("localhost:5432/veridi_dev");
    expect(mensagem).not.toMatch(/s3nh/);
  });
});
