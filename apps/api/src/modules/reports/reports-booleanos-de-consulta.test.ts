import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * REPORTS-QUERY-BOOLEAN-PERMISSIVE-01 — booleano da query dos relatórios é
 * `"true"` ou `"false"`, exatos.
 *
 * `booleanFlag` e `all` liam todo texto fora de `false`/`0`/`no`/vazio como
 * `true`: `?all=abc` e `?all=off` devolviam o relatório inteiro em vez da
 * página, e `?onlyWithBalance=off` escondia o item sem saldo. Agora leem
 * `booleanoDeConsultaSchema` (`lib/boolean-schema.ts`), o contrato do Estoque:
 * o resto é 400 antes de montar relatório.
 *
 * O efeito se prova pela rota: `false` tira o filtro de saldo e `all=false`
 * devolve a página — na tela e no CSV, que o PDF lê.
 */

type App = ReturnType<typeof buildTestApp>;
type Linha = { itemCode: string; onHand: string };
type Pagina = { rows: Linha[]; total: number; page: number; pageSize: number };

/** Nada disto é booleano de URL — nem o que já foi lido como `false` (`0`, `no`, vazio). */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];

let app: App;
let m: string;
const itens: string[] = [];
/** Códigos dos dois itens sem lote do teste — o saldo mora no Item. */
let comSaldo: string;
let semSaldo: string;

/** Query montada à mão: espaço vai como `%20`, nunca `+`. */
function url(caminho: string, query: Record<string, string>): string {
  const pares = Object.entries(query).map(([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`);
  return `${caminho}?${pares.join("&")}`;
}

async function posicao(query: Record<string, string>): Promise<Pagina> {
  const resposta = await app.inject({ method: "GET", url: url("/reports/inventory/position", query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return resposta.json() as Pagina;
}

const codigos = (pagina: Pagina) => pagina.rows.map((linha) => linha.itemCode);

/** O que a rota fez com o valor: o status e, com 200, o que devolveu. É o que a falha mostra. */
function desfecho(resposta: { statusCode: number; body: string }): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  if (!resposta.body.startsWith("{")) {
    const presentes = [comSaldo, semSaldo].filter((codigo) => resposta.body.includes(codigo));
    return `200, CSV com ${presentes.join(" e ") || "nenhum item"}`;
  }
  const pagina = JSON.parse(resposta.body) as Pagina;
  return `200, ${pagina.rows.length} de ${pagina.total}: ${codigos(pagina).join(" e ") || "nenhum item"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });

  m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const base = {
    type: "RAW_MATERIAL" as const,
    unitCode: "kg",
    controlsLot: false,
    controlsExpiry: false,
    requiresQualityRelease: false,
    active: true,
  };
  const com = await prisma.item.create({ data: { ...base, code: `MP-${m}-1`, name: `Com saldo ${m}` } });
  const sem = await prisma.item.create({ data: { ...base, code: `MP-${m}-2`, name: `Sem saldo ${m}` } });
  itens.push(com.id, sem.id);
  comSaldo = com.code;
  semSaldo = sem.code;

  // Só o primeiro tem movimento: o segundo existe, com saldo zero no ledger.
  await prisma.inventoryMovement.create({
    data: {
      itemId: com.id,
      type: "ADJUSTMENT_IN",
      quantity: "250",
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo de teste",
      createdBy: "Teste",
    },
  });

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  await app?.close();
});

describe("R-01 pela rota — onlyWithBalance", () => {
  it("ausente e true: só o item com saldo", async () => {
    expect(codigos(await posicao({ search: m }))).toEqual([comSaldo]);
    expect(codigos(await posicao({ search: m, onlyWithBalance: "true" }))).toEqual([comSaldo]);
  });

  it("false tira o filtro: o item sem saldo volta, com saldo zero", async () => {
    const pagina = await posicao({ search: m, onlyWithBalance: "false" });
    expect(codigos(pagina)).toEqual([comSaldo, semSaldo]);
    expect(pagina.rows[1]?.onHand).toBe("0");
  });
});

describe("R-01 pela rota — all", () => {
  it("ausente e false: a página pedida; true: o resultado filtrado inteiro", async () => {
    const filtro = { search: m, onlyWithBalance: "false", pageSize: "1" };

    for (const pedido of [filtro, { ...filtro, all: "false" }]) {
      const pagina = await posicao(pedido);
      expect(pagina, JSON.stringify(pedido)).toMatchObject({ total: 2, page: 1, pageSize: 1 });
      expect(codigos(pagina)).toEqual([comSaldo]);
    }

    const inteiro = await posicao({ ...filtro, all: "true" });
    expect(inteiro).toMatchObject({ total: 2, page: 1, pageSize: 2 });
    expect(codigos(inteiro)).toEqual([comSaldo, semSaldo]);
  });
});

describe("texto fora de true/false é 400 — nunca relatório", () => {
  const CASOS: { caminho: string; parametro: string; filtro?: Record<string, string> }[] = [
    { caminho: "/reports/inventory/position", parametro: "onlyWithBalance" },
    // Com o item sem saldo no filtro, página e resultado inteiro se distinguem: 1 × 2 linhas.
    { caminho: "/reports/inventory/position", parametro: "all", filtro: { onlyWithBalance: "false" } },
    { caminho: "/reports/inventory/expiry", parametro: "onlyWithBalance" },
    { caminho: "/reports/production/requirements", parametro: "onlyShortage" },
    { caminho: "/reports/production/planned-actual", parametro: "includeCost" },
    { caminho: "/reports/purchasing/orders", parametro: "all" },
    { caminho: "/reports/inventory/position/export.csv", parametro: "onlyWithBalance" },
    { caminho: "/reports/production/requirements/export.csv", parametro: "onlyShortage" },
  ];

  it.each(CASOS)("$caminho?$parametro", async ({ caminho, parametro, filtro }) => {
    const pedir = (valor: string) =>
      app.inject({ method: "GET", url: url(caminho, { search: m, pageSize: "1", ...filtro, [parametro]: valor }) });

    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await pedir(valor);
      obtidos.push([valor, desfecho(resposta)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: parametro }] });
      }
    }
    expect(obtidos, `${caminho}?${parametro}`).toEqual(RECUSADOS.map((valor) => [valor, "400"]));

    // A mesma rota, com o literal certo, responde.
    for (const valor of ["true", "false"]) {
      const resposta = await pedir(valor);
      expect(resposta.statusCode, `${parametro}=${valor}: ${resposta.body.slice(0, 200)}`).toBe(200);
    }
  });
});
