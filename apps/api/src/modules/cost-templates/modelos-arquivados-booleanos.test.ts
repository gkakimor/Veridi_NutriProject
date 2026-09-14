import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 — `archived` das bibliotecas de
 * Modelos é `"true"` ou `"false"`, exatos: Estrutura de Custos, Política de
 * preço (herda o campo por `.extend`) e Formulação.
 *
 * Os schemas liam todo texto fora de `"true"` como `false`, calados:
 * `?archived=1` — "arquivados" para quem escreve — listava os NÃO arquivados.
 * Agora leem `booleanoDeConsultaSchema` (`lib/boolean-schema.ts`); o resto é
 * 400. Ausente continua escondendo o arquivado: a biblioteca mostra o que se
 * usa.
 */

type App = ReturnType<typeof buildTestApp>;
type Resposta = { statusCode: number; body: string };

/** Nada disto é booleano de URL — nem o `1` que parecia "sim". */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];

const ATIVO = "ativo";
const ARQUIVADO = "arquivado";

type Biblioteca = { nome: string; caminho: string; chave: "templates" | "policies" };

const BIBLIOTECAS: Biblioteca[] = [
  { nome: "Modelos de Estrutura de Custos", caminho: "/cost-templates", chave: "templates" },
  { nome: "Políticas de preço", caminho: "/pricing-policies", chave: "policies" },
  { nome: "Modelos de Formulação", caminho: "/formulation-templates", chave: "templates" },
];

let app: App;
let m: string;
const criados = { estruturas: [] as string[], politicas: [] as string[], formulacoes: [] as string[] };
/** id do modelo → rótulo legível na falha. */
const rotulos = new Map<string, string>();

/** Sempre recortado nos modelos do teste; espaço vai como `%20`, nunca `+`. */
function url(caminho: string, query: Record<string, string>): string {
  const pares = Object.entries({ search: m, pageSize: "100", ...query }).map(
    ([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`,
  );
  return `${caminho}?${pares.join("&")}`;
}

function modelosDe(corpo: string, chave: Biblioteca["chave"]): string[] {
  return ((JSON.parse(corpo) as Record<string, { id: string }[]>)[chave] ?? [])
    .map((modelo) => rotulos.get(modelo.id) ?? modelo.id)
    .sort();
}

/** O que a rota fez com o valor: o status e, com 200, os modelos devolvidos. É o que a falha mostra. */
function desfecho(resposta: Resposta, chave: Biblioteca["chave"]): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  return `200 com ${modelosDe(resposta.body, chave).join(" e ") || "nenhum modelo"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

  for (const [rotulo, archivedAt] of [
    [ATIVO, null],
    [ARQUIVADO, new Date()],
  ] as const) {
    const dados = (prefixo: string) => ({
      code: `${prefixo}-${m}-${rotulo.toUpperCase()}`,
      name: `Modelo Booleano ${m} ${rotulo}`,
      archivedAt,
      archivedBy: archivedAt ? "Teste" : null,
    });
    const estrutura = await prisma.industrialCostTemplate.create({ data: dados("TEC") });
    const politica = await prisma.pricingPolicyTemplate.create({ data: dados("TPP") });
    const formulacao = await prisma.formulationTemplate.create({ data: dados("FT") });
    criados.estruturas.push(estrutura.id);
    criados.politicas.push(politica.id);
    criados.formulacoes.push(formulacao.id);
    for (const modelo of [estrutura, politica, formulacao]) rotulos.set(modelo.id, rotulo);
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.industrialCostTemplate.deleteMany({ where: { id: { in: criados.estruturas } } });
  await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: criados.politicas } } });
  await prisma.formulationTemplate.deleteMany({ where: { id: { in: criados.formulacoes } } });
  await app?.close();
});

describe.each(BIBLIOTECAS)("$nome pela rota — archived", ({ caminho, chave }) => {
  async function lista(query: Record<string, string>): Promise<string[]> {
    const resposta = await app.inject({ method: "GET", url: url(caminho, query) });
    expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
    return modelosDe(resposta.body, chave);
  }

  it("true: só o arquivado", async () => {
    expect(await lista({ archived: "true" })).toEqual([ARQUIVADO]);
  });

  it("false: só o ativo", async () => {
    expect(await lista({ archived: "false" })).toEqual([ATIVO]);
  });

  it("ausente: só o ativo — o arquivado sai da biblioteca por padrão", async () => {
    expect(await lista({})).toEqual([ATIVO]);
  });

  it("texto fora de true/false é 400, nunca lista", async () => {
    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await app.inject({ method: "GET", url: url(caminho, { archived: valor }) });
      obtidos.push([valor, desfecho(resposta, chave)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: "archived" }] });
      }
    }
    expect(obtidos, `${caminho}?archived`).toEqual(RECUSADOS.map((valor) => [valor, "400"]));
  });
});
