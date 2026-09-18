import { describe, expect, it } from "vitest";
import { REPORT_FILTER_CONTRACTS } from "@veridi/shared";
import { REPORT_PRINT_DEFINITIONS, reportAppliedFilters, reportSummaryPath } from "./ReportPrintPage";

/**
 * Contrato de filtros de cada relatório no papel (REPORTS-PRINT-UNACCEPTED-FILTER-01).
 *
 * "Filtros aplicados" só declara o que o schema DAQUELE relatório aceita: a
 * chave de outro relatório, a digitada à mão e a paginação a API descarta, e o
 * papel que as declarasse diria um recorte que não aconteceu.
 */

const definicao = (codigo: string) => REPORT_PRINT_DEFINITIONS[codigo]!;

function filtros(codigo: string, query: string, nomes: Record<string, string> = {}) {
  return reportAppliedFilters(new URLSearchParams(query), definicao(codigo), nomes);
}

// relatório, filtro aceito, [rótulo, valor] no papel, filtro de OUTRO relatório
const MATRIZ: [string, string, [string, string], string][] = [
  ["R-01", "ownerType=CUSTOMER", ["Proprietário", "Cliente"], "supplierId=for-1"],
  ["R-02", "window=D30", ["Janela de vencimento", "Próximos 30 dias"], "status=AVAILABLE"],
  ["R-03", "type=ADJUSTMENT_IN", ["Tipo", "Ajuste de entrada"], "customerId=cli-1"],
  ["R-04", "onlyShortage=true", ["Somente com falta", "Sim"], "from=2026-09-01"],
  ["R-05", "includeCost=true", ["Incluir custo", "Sim"], "supplierId=for-1"],
  ["R-07", "search=whey", ["Busca", "whey"], "status=COMPLETED"],
  ["R-08", "origin=CUSTOMER_ORDER", ["Origem", "Pedido do Cliente"], "customerId=cli-1"],
  ["R-09", "search=OC-000031", ["Busca", "OC-000031"], "status=RECEIVED"],
  ["R-10", "search=MP-000007", ["Busca", "MP-000007"], "from=2026-09-01"],
  ["R-11", "search=MP-000007", ["Busca", "MP-000007"], "status=ORDERED"],
  ["R-12", "status=IN_FULFILLMENT", ["Status", "Em atendimento"], "productId=prod-1"],
  ["R-13", "status=PARTIALLY_SHIPPED", ["Status", "Parcialmente expedido"], "supplierId=for-1"],
  ["R-15", "from=2026-09-01", ["De", "2026-09-01"], "status=SHIPPED"],
  ["R-16", "search=PED-000045", ["Busca", "PED-000045"], "from=2026-09-01"],
  ["R-17", "status=CANCELLED", ["Status", "Cancelado"], "itemId=item-1"],
  ["R-18", "active=false", ["Produto ativo", "Não"], "status=SENT"],
  ["R-19", "search=PROD-000123", ["Busca", "PROD-000123"], "active=true"],
  ["R-20", "priceSource=PRICING_TIER", ["Origem do preço", "Faixa de precificação"], "itemId=item-1"],
  ["R-21", "hasCost=false", ["Custo", "Custo não disponível"], "customerId=cli-1"],
];

describe("filtros aplicados no PDF: só o contrato de cada relatório", () => {
  it("a matriz cobre toda definição de relatório", () => {
    expect(MATRIZ.map(([codigo]) => codigo).sort()).toEqual(Object.keys(REPORT_PRINT_DEFINITIONS).sort());
  });

  it.each(MATRIZ)("%s?%s aparece; %s de outro relatório, chave desconhecida, paginação e vazio não", (codigo, aceito, [rotulo, valor], alheio) => {
    const chaveAlheia = alheio.split("=")[0]!;
    expect(definicao(codigo).filterKeys, chaveAlheia).not.toContain(chaveAlheia);

    const papel = filtros(codigo, `${alheio}&${aceito}&foo=bar&page=3&pageSize=25&all=true&search=`);
    expect(papel).toEqual([{ label: rotulo, value: valor }]);
  });

  it.each(Object.keys(REPORT_PRINT_DEFINITIONS))("%s: toda chave do contrato tem rótulo e todo mapa de valores é de chave do contrato", (codigo) => {
    const { filterKeys, filterValues = {} } = definicao(codigo);
    for (const chave of Object.keys(filterValues)) expect(filterKeys, chave).toContain(chave);
    for (const chave of ["page", "pageSize", "all"]) expect(filterKeys, chave).not.toContain(chave);
    const papel = filtros(codigo, filterKeys.map((chave) => `${chave}=x`).join("&") + "&window=CUSTOM");
    for (const { label } of papel) expect(filterKeys, label).not.toContain(label);
  });

  it("id aceito sai pelo nome resolvido; o mesmo id num relatório que não o aceita não sai", () => {
    const nomes = { customerId: "CLI-000012 · Nutri Alfa Suplementos Ltda" };
    expect(filtros("R-20", "customerId=cli-1", nomes)).toEqual([{ label: "Cliente", value: nomes.customerId }]);
    expect(filtros("R-08", "customerId=cli-1", nomes)).toEqual([]);
  });

  it("R-02: De/Até só na janela personalizada — nas prontas a API não lê as pontas", () => {
    expect(filtros("R-02", "window=D30&from=2026-09-01&to=2026-09-30")).toEqual([
      { label: "Janela de vencimento", value: "Próximos 30 dias" },
    ]);
    // Sem janela a API usa D30: as pontas também não valem.
    expect(filtros("R-02", "from=2026-09-01")).toEqual([]);
    expect(filtros("R-02", "window=CUSTOM&from=2026-09-01&to=2026-09-30").map((filtro) => filtro.label)).toEqual([
      "Janela de vencimento",
      "De",
      "Até",
    ]);
  });

  it("chave do protótipo não passa por aceita", () => {
    expect(filtros("R-02", "constructor=x&toString=y&hasOwnProperty=z")).toEqual([]);
  });
});

/**
 * REPORTS-PRINT-FILTER-KEYS-DRIFT-01: a lista de chaves não mora mais aqui. Ela
 * vem de `REPORT_FILTER_CONTRACTS` (shared), que o teste de contrato da API
 * compara com o schema de cada rota. Este lado garante que a web lê o contrato
 * e não o reescreve — a cópia à mão era o que ficava desatualizada em silêncio.
 */
describe("filtros do PDF saem do contrato compartilhado", () => {
  it("todo relatório impresso tem contrato, e todo contrato tem relatório impresso", () => {
    expect(Object.keys(REPORT_PRINT_DEFINITIONS).sort()).toEqual(Object.keys(REPORT_FILTER_CONTRACTS).sort());
  });

  it.each(Object.entries(REPORT_FILTER_CONTRACTS))("%s: chaves e rota são as do contrato, sem cópia", (codigo, contrato) => {
    // Mesma referência: a lista não foi reescrita na web.
    expect(definicao(codigo).filterKeys).toBe(contrato.filterKeys);
    expect(definicao(codigo).csvPath).toBe(contrato.csvPath);
  });
});

/**
 * REPORTS-PDF-SUMMARY-01: o resumo da tela (KPIs e agrupamentos) vai ao papel
 * pela leitura JSON da tela — a rota do CSV sem `/export.csv`, que a API
 * registra com o MESMO schema de filtros. O recorte é o mesmo por construção.
 */
describe("resumo da tela no PDF", () => {
  it("os relatórios com resumo na tela o levam ao papel: R-15 e R-21", () => {
    const comResumo = Object.values(REPORT_PRINT_DEFINITIONS).filter((definicao) => definicao.summary);
    expect(comResumo.map((definicao) => definicao.code).sort()).toEqual(["R-15", "R-21"]);
  });

  it.each(["R-15", "R-21"])("%s: a leitura do resumo é a rota JSON da tela", (codigo) => {
    const { csvPath } = definicao(codigo);
    expect(csvPath).toMatch(/^\/reports\/[a-z-]+\/[a-z-]+\/export\.csv$/);
    expect(reportSummaryPath(csvPath)).toBe(csvPath.slice(0, -"/export.csv".length));
  });

  it("R-21 e R-15: as rotas que a tela lê", () => {
    expect(reportSummaryPath(definicao("R-21").csvPath)).toBe("/reports/inventory/internal-consumption");
    expect(reportSummaryPath(definicao("R-15").csvPath)).toBe("/reports/billing/period");
  });
});
