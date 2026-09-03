import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * O item que está DEPOIS da primeira página ainda precisa ser encontrável.
 *
 * As telas de escolha carregavam uma página fixa do catálogo e filtravam no
 * navegador: acima do teto o item existia e não aparecia na busca, sem
 * aviso. A correção passou a perguntar ao servidor — este teste é a parte
 * do contrato que o servidor tem de cumprir para a correção valer:
 * `GET /items?search=` procura no catálogo INTEIRO, não na página corrente.
 *
 * Por isso o alvo é criado por último de propósito. O código do item é
 * sequencial e a listagem ordena por código, então nascer por último é
 * nascer fora da primeira página.
 */

const marcador = `zzbusca${Date.now().toString(36)}`;
const criados: string[] = [];
let codigoDoAlvo = "";

/** Uma página inteira de ruído antes do alvo — e mais uma linha de folga. */
const RUIDO = 21;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });

  const app = buildTestApp();
  await app.ready();

  async function criar(name: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name, unitCode: "kg", ...overrides },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    criados.push(body.id);
    return body;
  }

  for (let indice = 1; indice <= RUIDO; indice += 1) {
    await criar(`Excipiente ${marcador} ${String(indice).padStart(2, "0")}`);
  }
  // Depois de todo o ruído: o alvo recebe o maior código do lote.
  const alvo = await criar(`Beta-Alanina ${marcador} alvo`);
  codigoDoAlvo = alvo.code;

  await app.close();
});

afterAll(async () => {
  if (criados.length === 0) return;
  const prisma = getPrisma();
  // Lot.itemId é RESTRICT — sai antes do Item.
  await prisma.lot.deleteMany({ where: { itemId: { in: criados } } });
  await prisma.item.deleteMany({ where: { id: { in: criados } } });
  criados.length = 0;
});

describe("Busca de item além da primeira página", () => {
  it("a primeira página não traz o alvo", async () => {
    const app = buildTestApp();
    await app.ready();

    const primeiraPagina = await app.inject({
      method: "GET",
      url: "/items?type=RAW_MATERIAL&active=true&page=1&pageSize=20",
    });

    expect(primeiraPagina.statusCode).toBe(200);
    const codigos = primeiraPagina.json().items.map((item: { code: string }) => item.code);
    expect(codigos).toHaveLength(20);
    expect(codigos).not.toContain(codigoDoAlvo);

    await app.close();
  });

  it("a busca por código acha o alvo, mesmo fora da primeira página", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: `/items?search=${codigoDoAlvo}` });

    expect(response.statusCode).toBe(200);
    const codigos = response.json().items.map((item: { code: string }) => item.code);
    expect(codigos).toContain(codigoDoAlvo);

    await app.close();
  });

  it("a busca por nome acha o alvo e devolve o lote todo pelo marcador", async () => {
    const app = buildTestApp();
    await app.ready();

    const porNome = await app.inject({
      method: "GET",
      url: `/items?search=Beta-Alanina%20${marcador}`,
    });
    expect(porNome.statusCode).toBe(200);
    expect(porNome.json().items.map((item: { code: string }) => item.code)).toEqual([
      codigoDoAlvo,
    ]);

    // O marcador sozinho casa com o lote inteiro — o total conta o catálogo,
    // não a página, que é exatamente a informação que faltava à tela.
    const loteInteiro = await app.inject({ method: "GET", url: `/items?search=${marcador}` });
    expect(loteInteiro.json().total).toBe(RUIDO + 1);

    await app.close();
  });

  it("a busca respeita os filtros de negócio que a tela envia junto", async () => {
    const app = buildTestApp();
    await app.ready();

    const elegivel = await app.inject({
      method: "GET",
      url: `/items?search=${marcador}&type=RAW_MATERIAL&active=true&pageSize=50`,
    });
    expect(elegivel.json().items.map((item: { code: string }) => item.code)).toContain(
      codigoDoAlvo,
    );

    // Mesmo termo, filtro que o alvo não satisfaz: continua fora.
    const outroTipo = await app.inject({
      method: "GET",
      url: `/items?search=${marcador}&type=PACKAGING&pageSize=50`,
    });
    expect(outroTipo.json().items).toHaveLength(0);

    const inativos = await app.inject({
      method: "GET",
      url: `/items?search=${marcador}&active=false&pageSize=50`,
    });
    expect(inativos.json().items).toHaveLength(0);

    await app.close();
  });
});
