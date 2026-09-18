import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { buildTestApp } from "../test-support/authenticated-app.js";
import { listBillingsQuerySchema } from "./billings/billings.schemas.js";
import { listTemplatesQuerySchema } from "./cost-templates/cost-templates.schemas.js";
import { finishedGoodsQuerySchema } from "./customer-consultation/customer-consultation.schemas.js";
import { listCustomerOrdersQuerySchema } from "./customer-orders/customer-orders.schemas.js";
import { listCustomersQuerySchema } from "./customers/customers.schemas.js";
import { listFinishedGoodsQuerySchema } from "./finished-goods/finished-goods.schemas.js";
import { listFormulationTemplatesQuerySchema } from "./formulation-templates/formulation-templates.schemas.js";
import { listFormulationsQuerySchema } from "./formulations/formulations.schemas.js";
import { listResourcesQuerySchema } from "./industrial-resources/industrial-resources.schemas.js";
import { listInternalConsumptionsQuerySchema } from "./internal-consumption/internal-consumption.schemas.js";
import {
  listCustomerMaterialsQuerySchema,
  listInventoryMovementsQuerySchema,
  listInventoryQuerySchema,
} from "./inventory/inventory.schemas.js";
import { listStockCountsQuerySchema } from "./inventory/stock-count.schemas.js";
import { listItemsQuerySchema } from "./items/items.schemas.js";
import { listLotsQuerySchema } from "./lots/lots.schemas.js";
import { listPricingVersionsQuerySchema } from "./pricing/pricing.schemas.js";
import { listProductionOrdersQuerySchema } from "./production-orders/production-orders.schemas.js";
import { listProductionProfilesQuerySchema } from "./production-profiles/production-profiles.schemas.js";
import { listProductsQuerySchema } from "./products/products.schemas.js";
import { listProjectsQuerySchema, listQuoteVersionsQuerySchema } from "./projects/projects.schemas.js";
import { listPurchaseOrdersQuerySchema } from "./purchase-orders/purchase-orders.schemas.js";
import { listQualityQueueQuerySchema } from "./quality/quality.schemas.js";
import { listReceiptsQuerySchema } from "./receiving/receiving.schemas.js";
import { paginationFields } from "./reports/reports.schemas.js";
import { listSamplesQuerySchema } from "./samples/samples.schemas.js";
import { listShipmentsQuerySchema } from "./shipments/shipments.schemas.js";
import { listSupplierItemsQuerySchema } from "./supplier-items/supplier-items.schemas.js";
import { listSuppliersQuerySchema } from "./suppliers/suppliers.schemas.js";
import { listUsersQuerySchema } from "./users/users.schemas.js";

/**
 * API-PAGINATION-COERCION-01 — `page` e `pageSize` são inteiros decimais.
 *
 * As 28 consultas paginadas liam `Number()`: `?page=1e1` abria a página 10,
 * `?pageSize=0x10` devolvia 16 linhas e `?page=99999999999999999999` passava
 * (página sem teto). Agora leem como a escrita (`lib/integer-schema.ts`).
 * Padrão, mínimo e teto de cada consulta são os de antes — a tabela abaixo é
 * o retrato deles, e a guarda do fim obriga consulta nova a entrar nela.
 */

type Campos = { page: ZodTypeAny; pageSize: ZodTypeAny };

/** Campos de paginação de um `z.object`, com ou sem `superRefine` por fora. */
function camposDe(schema: ZodTypeAny): Campos {
  let atual: ZodTypeAny = schema;
  while (atual instanceof z.ZodEffects) atual = atual.innerType();
  if (!(atual instanceof z.ZodObject)) throw new Error("consulta sem z.object");
  const shape = atual.shape as Partial<Campos>;
  if (!shape.page || !shape.pageSize) throw new Error("consulta sem page/pageSize");
  return { page: shape.page, pageSize: shape.pageSize };
}

const CONSULTAS: { nome: string; campos: Campos; maximo: number; padrao: number }[] = [
  { nome: "billings", campos: camposDe(listBillingsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "cost-templates", campos: camposDe(listTemplatesQuerySchema), maximo: 100, padrao: 20 },
  { nome: "customer-consultation", campos: camposDe(finishedGoodsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "customer-orders", campos: camposDe(listCustomerOrdersQuerySchema), maximo: 100, padrao: 20 },
  { nome: "customers", campos: camposDe(listCustomersQuerySchema), maximo: 1000, padrao: 20 },
  { nome: "finished-goods", campos: camposDe(listFinishedGoodsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "formulation-templates", campos: camposDe(listFormulationTemplatesQuerySchema), maximo: 100, padrao: 20 },
  { nome: "formulations", campos: camposDe(listFormulationsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "industrial-resources", campos: camposDe(listResourcesQuerySchema), maximo: 1000, padrao: 20 },
  // INTERNAL-CONSUMPTION-01: o histórico de Uso e consumo (`GET /internal-consumptions`).
  { nome: "internal-consumptions", campos: camposDe(listInternalConsumptionsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "inventory", campos: camposDe(listInventoryQuerySchema), maximo: 100, padrao: 20 },
  { nome: "inventory/movements", campos: camposDe(listInventoryMovementsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "inventory/customer-materials", campos: camposDe(listCustomerMaterialsQuerySchema), maximo: 100, padrao: 20 },
  // INVENTORY-PHYSICAL-COUNT-01: as sessões de Inventário Físico (`GET /stock-counts`).
  { nome: "stock-counts", campos: camposDe(listStockCountsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "items", campos: camposDe(listItemsQuerySchema), maximo: 1000, padrao: 20 },
  { nome: "lots", campos: camposDe(listLotsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "pricing", campos: camposDe(listPricingVersionsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "production-orders", campos: camposDe(listProductionOrdersQuerySchema), maximo: 100, padrao: 20 },
  { nome: "production-profiles", campos: camposDe(listProductionProfilesQuerySchema), maximo: 100, padrao: 20 },
  { nome: "products", campos: camposDe(listProductsQuerySchema), maximo: 1000, padrao: 20 },
  { nome: "projects", campos: camposDe(listProjectsQuerySchema), maximo: 100, padrao: 20 },
  // QUOTES-HUB-01: a lista geral de Orçamentos.
  { nome: "quote-versions", campos: camposDe(listQuoteVersionsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "purchase-orders", campos: camposDe(listPurchaseOrdersQuerySchema), maximo: 100, padrao: 20 },
  { nome: "quality", campos: camposDe(listQualityQueueQuerySchema), maximo: 100, padrao: 20 },
  { nome: "receiving", campos: camposDe(listReceiptsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "reports", campos: paginationFields, maximo: 500, padrao: 25 },
  { nome: "samples", campos: camposDe(listSamplesQuerySchema), maximo: 100, padrao: 20 },
  { nome: "shipments", campos: camposDe(listShipmentsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "supplier-items", campos: camposDe(listSupplierItemsQuerySchema), maximo: 100, padrao: 20 },
  { nome: "suppliers", campos: camposDe(listSuppliersQuerySchema), maximo: 1000, padrao: 20 },
  { nome: "users", campos: camposDe(listUsersQuerySchema), maximo: 100, padrao: 20 },
];

/** Nenhum destes é página nem tamanho de página, em nenhuma consulta. */
const RECUSADOS: unknown[] = [
  "1e1",
  "1E1",
  "0x10",
  "0b10",
  "1.0",
  "12.5",
  "12,5",
  "+1",
  "Infinity",
  "NaN",
  "abc",
  "10abc",
  "1 000",
  "",
  " ",
  "9007199254740993",
  "99999999999999999999",
  12.5,
  Number.POSITIVE_INFINITY,
  true,
  ["1", "2"],
];

describe.each(CONSULTAS)("paginação de $nome", ({ campos, maximo, padrao }) => {
  it("ausente continua sendo o padrão", () => {
    expect(campos.page.parse(undefined)).toBe(1);
    expect(campos.pageSize.parse(undefined)).toBe(padrao);
  });

  it("inteiro decimal vale, em texto ou número, zeros à esquerda incluídos", () => {
    expect(campos.page.parse("1")).toBe(1);
    expect(campos.page.parse("10")).toBe(10);
    expect(campos.page.parse("007")).toBe(7);
    expect(campos.page.parse(3)).toBe(3);
    expect(campos.pageSize.parse("10")).toBe(10);
  });

  it("mínimo e teto de antes", () => {
    for (const campo of [campos.page, campos.pageSize]) {
      expect(campo.safeParse("0").success).toBe(false);
      expect(campo.safeParse("-1").success).toBe(false);
    }
    expect(campos.pageSize.parse(String(maximo))).toBe(maximo);
    expect(campos.pageSize.safeParse(String(maximo + 1)).success).toBe(false);
    // Página não tem teto, só o limite do inteiro seguro.
    expect(campos.page.parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each(RECUSADOS.map((valor) => [valor]))("%j é recusado", (valor) => {
    expect(campos.page.safeParse(valor).success).toBe(false);
    expect(campos.pageSize.safeParse(valor).success).toBe(false);
  });
});

describe("rotas paginadas — entrada inválida é 400, válida responde como antes", () => {
  const app = buildTestApp();
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it.each([
    "/items?page=1e1",
    "/items?pageSize=0x10",
    "/users?pageSize=12.5",
    "/users?page=%2B1",
    "/reports/inventory/position?page=Infinity",
    "/reports/inventory/position?pageSize=12%2C5",
    "/reports/inventory/position?pageSize=501",
  ])("GET %s é 400", async (url) => {
    const resposta = await app.inject({ method: "GET", url });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("zeros à esquerda e ausência mantêm página e tamanho", async () => {
    const itens = await app.inject({ method: "GET", url: "/items?page=007&pageSize=5" });
    expect(itens.statusCode).toBe(200);
    expect(itens.json()).toMatchObject({ page: 7, pageSize: 5 });

    const usuarios = await app.inject({ method: "GET", url: "/users" });
    expect(usuarios.statusCode).toBe(200);
    expect(usuarios.json()).toMatchObject({ page: 1, pageSize: 20 });

    const relatorio = await app.inject({ method: "GET", url: "/reports/inventory/position?pageSize=500" });
    expect(relatorio.statusCode).toBe(200);
  });
});

describe("guarda — paginação de consulta não volta a ler Number()", () => {
  const RAIZ = join(import.meta.dirname, "..");
  /** `page:`/`pageSize:` montado direto num construtor do zod (`z.coerce`, `z.number`, `z.preprocess`…). */
  const PAGINACAO_SOLTA = /\b(?:page|pageSize)\s*:\s*z\s*\./;
  const PAGINACAO_ESTRITA = /\b(?:page|pageSize)\s*:\s*inteiroDeConsultaSchema\(/g;

  function fontesDeProducao(diretorio: string): string[] {
    return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
      const caminho = join(diretorio, entrada.name);
      if (entrada.isDirectory()) return fontesDeProducao(caminho);
      return entrada.name.endsWith(".ts") && !entrada.name.includes(".test.") ? [caminho] : [];
    });
  }

  it("a guarda pega a paginação solta e só ela", () => {
    expect(PAGINACAO_SOLTA.test("  page: z.coerce.number().int().min(1).default(1),")).toBe(true);
    expect(PAGINACAO_SOLTA.test("pageSize: z.coerce.number().int().max(100)")).toBe(true);
    expect(PAGINACAO_SOLTA.test("page: z.preprocess(Number, z.number())")).toBe(true);
    expect(PAGINACAO_SOLTA.test("  quantity: z.coerce.number().int(),")).toBe(false);
    expect(PAGINACAO_SOLTA.test("  API_PORT: z.coerce.number().int().positive().default(3333),")).toBe(false);
    expect(PAGINACAO_SOLTA.test("  pageCount: z.coerce.number()")).toBe(false);
    expect(PAGINACAO_SOLTA.test("  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),")).toBe(false);
  });

  it("nenhum fonte de produção da API monta page/pageSize direto no zod", () => {
    const achados = fontesDeProducao(RAIZ).flatMap((arquivo) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .filter((linha) => !/^\s*(?:\/\/|\*|\/\*)/.test(linha) && PAGINACAO_SOLTA.test(linha))
        .map((linha) => `${relative(RAIZ, arquivo)}: ${linha.trim()}`),
    );
    expect(achados).toEqual([]);
  });

  it("toda consulta paginada está na tabela acima", () => {
    const declaracoes = fontesDeProducao(RAIZ).reduce(
      (total, arquivo) => total + (readFileSync(arquivo, "utf8").match(PAGINACAO_ESTRITA)?.length ?? 0),
      0,
    );
    expect(declaracoes).toBe(CONSULTAS.length * 2);
  });
});
