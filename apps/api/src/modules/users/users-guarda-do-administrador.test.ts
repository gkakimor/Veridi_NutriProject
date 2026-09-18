import { randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { App } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { hashPassword } from "../../lib/password.js";
import {
  PREFIXO_DO_USUARIO_DE_TESTE,
  registrarUsuarioDeTeste,
} from "../../test-support/usuarios-de-teste.js";
import { SESSION_COOKIE, hashSessionToken } from "../auth/auth.service.js";

/**
 * USER-LAST-ADMIN-GUARD-01 (§120) — o sistema nunca fica sem ADMIN ativo, e
 * ninguém inativa a si mesmo nem retira de si o perfil Administrador.
 *
 * O conjunto de ADMIN ativo é do banco INTEIRO: "único ADMIN ativo" só se monta
 * sem vizinho criando administrador ao lado. Por isso o arquivo roda na faixa
 * serial (`vitest.serial.config.ts`), e cada caso começa com o conjunto vazio —
 * os ADMIN ativos que já estavam no banco de teste (autor de fixture que ficou,
 * rodada interrompida) saem no começo e voltam no fim.
 *
 * Pela rota, o único ADMIN ativo só pode ser alvo de si mesmo: quem chama o
 * PATCH também é ADMIN ativo. Por isso "o último" se prova de dois jeitos —
 * sozinho, pedindo contra si (a recusa do último vem antes da do "a si mesmo"),
 * e na corrida, em que o autor é outro.
 */

const MENSAGEM_ULTIMO =
  "Não é possível concluir. O sistema precisa manter pelo menos um administrador ativo.";
const MENSAGEM_INATIVAR_A_SI =
  "Não é possível concluir. Você não pode inativar o próprio usuário — outro administrador deve fazer isso.";
const MENSAGEM_REBAIXAR_A_SI =
  "Não é possível concluir. Você não pode retirar de si mesmo o perfil Administrador — outro administrador deve fazer isso.";

interface Usuario {
  readonly id: string;
  readonly nome: string;
  readonly cookie: string;
}

let app: App;
let m: string;
let passwordHash: string;
let sequencia = 0;
/** ADMIN ativos do banco antes do arquivo: fora do conjunto enquanto ele roda, de volta no fim. */
let anteriores: string[] = [];

async function abrirSessao(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getPrisma().userSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}

/** Usuário com sessão aberta. Prefixo de teste: rodada interrompida é varrida no `globalSetup`. */
async function criar(role: UserRole, active = true): Promise<Usuario> {
  sequencia += 1;
  const rotulo = `${m}-${sequencia}`;
  const nome = `Guarda do Administrador ${rotulo}`;
  const user = await getPrisma().user.create({
    data: {
      code: `${PREFIXO_DO_USUARIO_DE_TESTE}${rotulo}`,
      name: nome,
      email: `guarda-admin-${rotulo.toLowerCase()}@veridi.local`,
      passwordHash,
      role,
      active,
    },
  });
  registrarUsuarioDeTeste(user.id);
  return { id: user.id, nome, cookie: await abrirSessao(user.id) };
}

function editar(autor: Usuario, alvoId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/users/${alvoId}`,
    headers: { cookie: autor.cookie },
    payload,
  });
}

function situacao(id: string) {
  return getPrisma().user.findUniqueOrThrow({
    where: { id },
    select: { name: true, role: true, active: true },
  });
}

/** Os ADMIN ativos do banco inteiro, em ordem de JS (a do banco depende da collation). */
async function adminsAtivos(): Promise<string[]> {
  const linhas = await getPrisma().user.findMany({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });
  return linhas.map((linha) => linha.id).sort();
}

async function sessaoVale(cookie: string): Promise<boolean> {
  const resposta = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
  return resposta.statusCode === 200;
}

/**
 * Espera as edições pararem NA TRAVA de `users`. Sem esta prova a corrida não
 * vale nada: sem a trava no serviço, as duas contam "há outro ADMIN" antes de
 * gravar — e é a gravação delas que para aqui.
 */
async function esperarParadasNaTrava(quantas: number): Promise<void> {
  const prisma = getPrisma();
  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const [linha] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%users%'
        AND pid <> pg_backend_pid()
    `;
    if ((linha?.n ?? 0) >= quantas) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`as ${quantas} edições não pararam na trava de users`);
}

beforeAll(async () => {
  const prisma = getPrisma();
  m = `GA${Date.now().toString(36)}${randomBytes(2).toString("hex")}`.toUpperCase();
  passwordHash = await hashPassword(`senha-de-teste-${m}`);

  const ativos = await prisma.user.findMany({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });
  anteriores = ativos.map((usuario) => usuario.id);
  await prisma.user.updateMany({ where: { id: { in: anteriores } }, data: { active: false } });

  app = buildApp();
  await app.ready();
});

beforeEach(async () => {
  // Cada caso monta o próprio conjunto de ADMIN ativo, do zero.
  await getPrisma().user.updateMany({
    where: { role: "ADMIN", active: true },
    data: { active: false },
  });
});

afterAll(async () => {
  await getPrisma().user.updateMany({ where: { id: { in: anteriores } }, data: { active: true } });
  await app?.close();
});

describe("o último ADMIN ativo", () => {
  it("não pode ser inativado — a recusa é a do último, e nada muda", async () => {
    const unico = await criar("ADMIN");

    const resposta = await editar(unico, unico.id, { active: false });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({ error: "last_active_admin", message: MENSAGEM_ULTIMO });
    expect(await situacao(unico.id)).toMatchObject({ role: "ADMIN", active: true });
    expect(await adminsAtivos()).toEqual([unico.id]);
    // Recusar não derruba ninguém: a sessão segue valendo.
    expect(await sessaoVale(unico.cookie)).toBe(true);
  });

  it.each(["PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const)(
    "não pode ter o perfil trocado por %s",
    async (perfil) => {
      const unico = await criar("ADMIN");

      const resposta = await editar(unico, unico.id, { role: perfil });

      expect(resposta.statusCode, perfil).toBe(409);
      expect(resposta.json(), perfil).toEqual({ error: "last_active_admin", message: MENSAGEM_ULTIMO });
      expect(await situacao(unico.id), perfil).toMatchObject({ role: "ADMIN", active: true });
    },
  );

  it("a recusa vale para o pedido inteiro: o nome enviado junto não é gravado", async () => {
    const unico = await criar("ADMIN");

    const resposta = await editar(unico, unico.id, {
      name: "Nome que não pode entrar",
      role: "VIEWER",
      active: false,
    });

    expect(resposta.statusCode).toBe(409);
    expect(await situacao(unico.id)).toEqual({ name: unico.nome, role: "ADMIN", active: true });
  });

  it("editar o próprio cadastro sem sair do conjunto passa — a tela manda perfil e situação junto", async () => {
    const unico = await criar("ADMIN");

    const resposta = await editar(unico, unico.id, {
      name: `${unico.nome} renomeado`,
      role: "ADMIN",
      active: true,
    });

    expect(resposta.statusCode).toBe(200);
    expect(await situacao(unico.id)).toEqual({
      name: `${unico.nome} renomeado`,
      role: "ADMIN",
      active: true,
    });
  });

  it("ADMIN inativo não conta: é rebaixado sem recusa, e reativado volta ao conjunto", async () => {
    const unico = await criar("ADMIN");
    const inativo = await criar("ADMIN", false);

    const rebaixado = await editar(unico, inativo.id, { role: "VIEWER" });
    expect(rebaixado.statusCode).toBe(200);

    const reativado = await editar(unico, inativo.id, { role: "ADMIN", active: true });
    expect(reativado.statusCode).toBe(200);
    expect(await adminsAtivos()).toEqual([unico.id, inativo.id].sort());
  });

  it("os demais perfis seguem livres: com um ADMIN só, trocar o perfil e inativar passam", async () => {
    const unico = await criar("ADMIN");
    const operador = await criar("PRODUCTION");

    const trocado = await editar(unico, operador.id, { role: "QUALITY" });
    expect(trocado.statusCode).toBe(200);
    expect(trocado.json()).toMatchObject({ role: "QUALITY", active: true });

    const inativado = await editar(unico, operador.id, { active: false });
    expect(inativado.statusCode).toBe(200);
    expect(inativado.json()).toMatchObject({ role: "QUALITY", active: false });
    expect(await sessaoVale(operador.cookie)).toBe(false);
  });
});

describe("dois ADMIN ativos", () => {
  it("um inativa o outro", async () => {
    const autor = await criar("ADMIN");
    const alvo = await criar("ADMIN");

    const resposta = await editar(autor, alvo.id, { active: false });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ id: alvo.id, role: "ADMIN", active: false });
    expect(await adminsAtivos()).toEqual([autor.id]);
  });

  it("um rebaixa o outro", async () => {
    const autor = await criar("ADMIN");
    const alvo = await criar("ADMIN");

    const resposta = await editar(autor, alvo.id, { role: "PRODUCTION" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ id: alvo.id, role: "PRODUCTION", active: true });
    expect(await adminsAtivos()).toEqual([autor.id]);
  });

  it("ninguém inativa a si mesmo, nem havendo outro ADMIN — o outro pode", async () => {
    const eu = await criar("ADMIN");
    const outro = await criar("ADMIN");

    const resposta = await editar(eu, eu.id, { name: "Nome que não pode entrar", active: false });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({ error: "self_deactivation", message: MENSAGEM_INATIVAR_A_SI });
    expect(await situacao(eu.id)).toEqual({ name: eu.nome, role: "ADMIN", active: true });
    expect(await sessaoVale(eu.cookie)).toBe(true);

    const peloOutro = await editar(outro, eu.id, { active: false });
    expect(peloOutro.statusCode).toBe(200);
    expect(await adminsAtivos()).toEqual([outro.id]);
  });

  it("ninguém retira de si o perfil Administrador, nem havendo outro ADMIN — o outro pode", async () => {
    const eu = await criar("ADMIN");
    const outro = await criar("ADMIN");

    const resposta = await editar(eu, eu.id, { role: "COMMERCIAL" });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({ error: "self_demotion", message: MENSAGEM_REBAIXAR_A_SI });
    expect(await situacao(eu.id)).toMatchObject({ role: "ADMIN", active: true });

    const peloOutro = await editar(outro, eu.id, { role: "COMMERCIAL" });
    expect(peloOutro.statusCode).toBe(200);
    expect(await adminsAtivos()).toEqual([outro.id]);
  });
});

describe("inativar derruba as sessões, como antes", () => {
  it("todas as sessões abertas do inativado deixam de valer; as de quem inativou, não", async () => {
    const autor = await criar("ADMIN");
    const alvo = await criar("ADMIN");
    const outraSessaoDoAlvo = await abrirSessao(alvo.id);

    const resposta = await editar(autor, alvo.id, { active: false });

    expect(resposta.statusCode).toBe(200);
    const sessoes = await getPrisma().userSession.findMany({ where: { userId: alvo.id } });
    expect(sessoes).toHaveLength(2);
    expect(sessoes.filter((sessao) => sessao.revokedAt === null)).toEqual([]);
    expect(await sessaoVale(alvo.cookie)).toBe(false);
    expect(await sessaoVale(outraSessaoDoAlvo)).toBe(false);
    expect(await sessaoVale(autor.cookie)).toBe(true);
  });
});

describe("corrida: duas edições simultâneas não zeram a lista", () => {
  it.each([
    { caso: "os dois rebaixam", deA: { role: "PRODUCTION" }, deB: { role: "VIEWER" } },
    { caso: "os dois inativam", deA: { active: false }, deB: { active: false } },
    { caso: "um inativa, o outro rebaixa", deA: { active: false }, deB: { role: "QUALITY" } },
  ])("$caso: uma passa, a outra é recusada como a do último", async ({ caso, deA, deB }) => {
    const a = await criar("ADMIN");
    const b = await criar("ADMIN");

    let aberta!: () => void;
    const travada = new Promise<void>((resolve) => {
      aberta = resolve;
    });
    let soltar!: () => void;
    const segurando = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    /*
     * A transação do teste segura as duas linhas enquanto as duas edições
     * entram — cada uma já passou pela sessão e está pronta para contar.
     * Soltas juntas, a trava do serviço é o que decide a ordem.
     */
    const transacao = getPrisma().$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM users WHERE id IN (${a.id}, ${b.id}) ORDER BY id FOR NO KEY UPDATE
        `;
        aberta();
        await segurando;
      },
      { timeout: 30_000 },
    );
    await travada;

    const aEditaB = editar(a, b.id, deA);
    const bEditaA = editar(b, a.id, deB);
    await esperarParadasNaTrava(2);

    soltar();
    await transacao;
    const [deAParaB, deBParaA] = await Promise.all([aEditaB, bEditaA]);

    const codigos = [deAParaB.statusCode, deBParaA.statusCode].sort();
    expect(codigos, caso).toEqual([200, 409]);
    const recusa = deAParaB.statusCode === 409 ? deAParaB : deBParaA;
    expect(recusa.json(), caso).toEqual({ error: "last_active_admin", message: MENSAGEM_ULTIMO });

    // Fica quem editou primeiro — e só ele.
    const vencedor = deAParaB.statusCode === 200 ? a.id : b.id;
    expect(await adminsAtivos(), caso).toEqual([vencedor]);
  });
});
