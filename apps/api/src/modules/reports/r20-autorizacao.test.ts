import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { PRICING_PROVENANCE_ROLES, USER_ROLES } from "@veridi/shared";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { csvExportPaths } from "../exports/exports.routes.js";

/**
 * R-20 — a mesma autorização em qualquer formato (R20-EXPORT-AUTHORIZATION-01).
 *
 * O R-20 mostra custo e margem por proposta. A rota JSON recusava PRODUCTION
 * com 403, mas `export.csv` respondia 200 com os mesmos dados — e o PDF do
 * R-20 é gerado a partir desse CSV. Era bypass de autorização por formato.
 *
 * A autoridade é UMA: `PRICING_PROVENANCE_ROLES` (`@veridi/shared`), a regra
 * da proveniência econômica (§5.11). A rota JSON e a exportação a declaram;
 * nada aqui lista perfis à mão. Os perfis são os seis reais do sistema, e as
 * chamadas vão direto ao servidor, sem tela.
 */

type App = ReturnType<typeof buildTestApp>;

const m = `AUT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const CODIGO = `ORC-${m}`;
const MARGEM = "37.2500";
const criados = { cliente: "", item: "", produto: "", projeto: "" };
const cookies = new Map<UserRole, string>();

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const cliente = await prisma.customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Autorização ${m}`, active: true },
  });
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-${m}`,
      name: `Acabado ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  const produto = await prisma.product.create({
    data: { code: `PROD-${m}`, name: `Produto ${m}`, customerId: cliente.id, finishedProductItemId: item.id },
  });
  const projeto = await prisma.project.create({
    data: { code: `PROJ-${m}`, customerId: cliente.id, name: `Projeto ${m}`, entryDate: new Date() },
  });
  Object.assign(criados, { cliente: cliente.id, item: item.id, produto: produto.id, projeto: projeto.id });

  // Proposta enviada com a proveniência congelada: é isto que não pode vazar.
  await prisma.quoteVersion.create({
    data: {
      code: CODIGO,
      projectId: projeto.id,
      versionNumber: 1,
      status: "SENT",
      quoteDate: new Date(),
      lines: {
        create: [
          {
            productId: produto.id,
            quotedQuantity: "100",
            uomCode: "kg",
            unitPrice: "12.5",
            priceSource: "PRICING_TIER",
            pricingCodeSnapshot: `PREC-${m}`,
            pricingVersionNumberSnapshot: 1,
            costCalculationCodeSnapshot: `CALC-${m}`,
            industrialCostPerUnitSnapshot: "7.84",
            contributionMarginSnapshot: MARGEM,
          },
        ],
      },
    },
  });

  for (const papel of USER_ROLES) cookies.set(papel, (await createAuthenticatedUser(papel)).cookie);
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  // Versão e linha saem em cascata com o projeto.
  if (criados.projeto) await prisma.project.delete({ where: { id: criados.projeto } });
  if (criados.produto) await prisma.product.delete({ where: { id: criados.produto } });
  if (criados.item) await prisma.item.delete({ where: { id: criados.item } });
  if (criados.cliente) await prisma.customer.delete({ where: { id: criados.cliente } });
  await app?.close();
});

function como(papel: UserRole, url: string) {
  return app.inject({ method: "GET", url, headers: { cookie: cookies.get(papel)! } });
}

const pode = (papel: UserRole) => PRICING_PROVENANCE_ROLES.includes(papel);
const PROIBIDO = { error: "forbidden", message: "Seu perfil não permite esta ação." };

describe("R-20 — matriz de perfis × formatos", () => {
  it("a autoridade é a da proveniência econômica, com perfis reais dos dois lados", () => {
    expect([...PRICING_PROVENANCE_ROLES].sort()).toEqual(["ADMIN", "COMMERCIAL"]);
    expect(USER_ROLES.filter((papel) => !pode(papel)).length).toBeGreaterThan(0);
  });

  it.each(USER_ROLES.map((papel) => ({ papel, esperado: pode(papel) ? 200 : 403 })))(
    "$papel: JSON, CSV e o CSV do PDF respondem $esperado",
    async ({ papel, esperado }) => {
      const json = await como(papel, `/reports/commercial/quote-pricing?search=${CODIGO}`);
      const csv = await como(papel, `/reports/commercial/quote-pricing/export.csv?search=${CODIGO}`);
      // O PDF pede o CSV com os filtros da tela, paginação incluída.
      const pdf = await como(
        papel,
        `/reports/commercial/quote-pricing/export.csv?search=${CODIGO}&page=1&pageSize=25`,
      );
      expect([json.statusCode, csv.statusCode, pdf.statusCode]).toEqual([esperado, esperado, esperado]);

      if (esperado === 200) {
        const [linha] = json.json().rows as { quoteLabel: string; contributionMarginPercent: string }[];
        expect(linha?.quoteLabel).toBe(`${CODIGO} · V1`);
        expect(linha?.contributionMarginPercent).toBe(MARGEM);
        for (const arquivo of [csv, pdf]) {
          expect(arquivo.headers["content-type"]).toContain("text/csv");
          expect(arquivo.body).toContain("Margem de contribuição (%)");
          expect(arquivo.body).toContain(CODIGO);
        }
        return;
      }

      // Recusa padrão do projeto, sem nenhum dado do relatório no corpo.
      for (const resposta of [json, csv, pdf]) {
        expect(resposta.json()).toEqual(PROIBIDO);
        expect(resposta.body).not.toContain(CODIGO);
        expect(resposta.body).not.toContain("Margem");
        expect(resposta.headers["content-disposition"]).toBeUndefined();
      }
    },
  );

  it("PRODUCTION direto no servidor: o perfil é conferido antes da validação do filtro", async () => {
    // Filtro inválido não vira 400: quem não pode ver não aprende nada do contrato.
    for (const url of [
      "/reports/commercial/quote-pricing?from=nao-e-data",
      "/reports/commercial/quote-pricing/export.csv?from=nao-e-data",
    ]) {
      const resposta = await como("PRODUCTION", url);
      expect(resposta.statusCode, url).toBe(403);
      expect(resposta.json()).toEqual(PROIBIDO);
    }
    // O perfil autorizado continua recebendo a validação normal.
    expect((await como("COMMERCIAL", "/reports/commercial/quote-pricing/export.csv?from=nao-e-data")).statusCode).toBe(400);
  });
});

describe("exportações — formato nunca amplia a autorização", () => {
  it(
    "para toda exportação CSV e todo perfil: se o JSON do mesmo read model recusa, o CSV recusa",
    { timeout: 120_000 },
    async () => {
      expect(csvExportPaths.length).toBeGreaterThanOrEqual(38);
      const recusas: string[] = [];
      for (const csvPath of csvExportPaths) {
        const jsonPath = csvPath.replace(/\/export\.csv$/, "");
        for (const papel of USER_ROLES) {
          const json = await como(papel, `${jsonPath}?pageSize=1`);
          if (json.statusCode !== 403) continue;
          recusas.push(`${jsonPath} ${papel}`);
          const csv = await como(papel, csvPath);
          expect(csv.statusCode, `${csvPath} como ${papel}`).toBe(403);
        }
      }
      // A guarda precisa ter visto ao menos a recusa do R-20 para valer alguma coisa.
      expect(recusas).toContain("/reports/commercial/quote-pricing PRODUCTION");
    },
  );
});
