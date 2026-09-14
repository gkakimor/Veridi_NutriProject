import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { PREFIXO_DO_USUARIO_DE_TESTE } from "../../test-support/usuarios-de-teste.js";
import { getPrisma } from "../../db/prisma.js";
import { hashPassword } from "../../lib/password.js";

/**
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 — `active` da lista de Usuários é
 * `"true"` ou `"false"`, exatos.
 *
 * O schema lia todo texto fora de `"true"` como `false`, calado:
 * `?active=1` — "ativos" para quem escreve — listava só os INATIVOS. Agora
 * lê `booleanoDeConsultaSchema` (`lib/boolean-schema.ts`); o resto é 400.
 * Ausente continua sem filtro.
 */

type App = ReturnType<typeof buildTestApp>;
type Resposta = { statusCode: number; body: string };

/** Nada disto é booleano de URL — nem o `1` que parecia "sim". */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];

const ATIVO = "ativo";
const INATIVO = "inativo";

let app: App;
let m: string;
const criados: string[] = [];
/** id do usuário → rótulo legível na falha. */
const rotulos = new Map<string, string>();

/** Sempre recortado nos usuários do teste; espaço vai como `%20`, nunca `+`. */
function url(query: Record<string, string>): string {
  const pares = Object.entries({ search: m, pageSize: "100", ...query }).map(
    ([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`,
  );
  return `/users?${pares.join("&")}`;
}

function usuariosDe(corpo: string): string[] {
  return (JSON.parse(corpo) as { users: { id: string }[] }).users
    .map((usuario) => rotulos.get(usuario.id) ?? usuario.id)
    .sort();
}

async function lista(query: Record<string, string>): Promise<string[]> {
  const resposta = await app.inject({ method: "GET", url: url(query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return usuariosDe(resposta.body);
}

/** O que a rota fez com o valor: o status e, com 200, os usuários devolvidos. É o que a falha mostra. */
function desfecho(resposta: Resposta): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  return `200 com ${usuariosDe(resposta.body).join(" e ") || "nenhum usuário"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const passwordHash = await hashPassword(`senha-de-teste-${m}`);

  for (const [rotulo, active] of [
    [ATIVO, true],
    [INATIVO, false],
  ] as const) {
    // Prefixo de teste: rodada interrompida é varrida no `globalSetup`.
    const usuario = await prisma.user.create({
      data: {
        code: `${PREFIXO_DO_USUARIO_DE_TESTE}${m}-${rotulo.toUpperCase()}`,
        name: `Usuário Booleano ${m} ${rotulo}`,
        email: `booleano-${rotulo}-${m.toLowerCase()}@veridi.local`,
        passwordHash,
        role: "VIEWER",
        active,
      },
    });
    criados.push(usuario.id);
    rotulos.set(usuario.id, rotulo);
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  if (criados.length > 0) await getPrisma().user.deleteMany({ where: { id: { in: criados } } });
  await app?.close();
});

describe("Usuários pela rota — active", () => {
  it("true: só o ativo", async () => {
    expect(await lista({ active: "true" })).toEqual([ATIVO]);
  });

  it("false: só o inativo", async () => {
    expect(await lista({ active: "false" })).toEqual([INATIVO]);
  });

  it("ausente: os dois, sem filtro", async () => {
    expect(await lista({})).toEqual([ATIVO, INATIVO]);
  });

  it("texto fora de true/false é 400, nunca lista", async () => {
    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await app.inject({ method: "GET", url: url({ active: valor }) });
      obtidos.push([valor, desfecho(resposta)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: "active" }] });
      }
    }
    expect(obtidos, "/users?active").toEqual(RECUSADOS.map((valor) => [valor, "400"]));
  });
});
