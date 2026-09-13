import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Relatórios — mudar o recorte volta a tabela para a página 1
 * (REPORTS-PAGE-RESET-ON-PERIOD-01).
 *
 * Cliente, status, tipo e busca já faziam `setPage(1)` no próprio evento; os
 * campos De/até não. Quem estava na página 6 e encurtava o período pedia a
 * página 6 do universo NOVO — que tem duas —, e a tabela vazia dizia "nenhum
 * registro no período" com trinta registros no servidor.
 *
 * O reinício mora no mesmo gesto que APLICA o filtro, e não num efeito que
 * observa o filtro: as duas atualizações saem num render só, e a primeira
 * consulta do novo recorte já é a da página 1 — sem a consulta da página 6
 * antes, nem uma segunda depois. Seletor aplica no próprio evento; busca e
 * datas, quando a digitação para (REPORTS-SEARCH-UX-01, `useFiltrosDigitados`),
 * e cada mudança aqui deixa a pausa passar. Anterior/Próxima só mudam a página.
 *
 * "Incluir custo de material" (R-05) não muda o universo — só acrescenta uma
 * coluna às linhas da página — e por isso não reinicia.
 */

vi.mock("../../lib/reports-api", () => ({
  getExpiryReport: vi.fn(),
  getMovementsReport: vi.fn(),
  getPlannedActualReport: vi.fn(),
  getConsumptionReport: vi.fn(),
  getPurchaseOrdersReport: vi.fn(),
  getReceiptsReport: vi.fn(),
  getCustomerOrdersReport: vi.fn(),
  getBillingPeriodReport: vi.fn(),
}));
vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn(), getProductionOrder: vi.fn() }));
vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn(), getCustomerOrder: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));

import {
  getBillingPeriodReport,
  getConsumptionReport,
  getCustomerOrdersReport,
  getExpiryReport,
  getMovementsReport,
  getPlannedActualReport,
  getPurchaseOrdersReport,
  getReceiptsReport,
} from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { BillingPeriodReportPage } from "./BillingReports";
import { CustomerOrdersReportPage } from "./CommercialReports";
import { ExpiryReportPage, MovementsReportPage } from "./InventoryReports";
import { ConsumptionReportPage, PlannedActualReportPage } from "./ProductionReports";
import { PurchaseOrdersReportPage, ReceiptsReportPage } from "./PurchasingReports";
import { PAUSA_DA_DIGITACAO_MS } from "./useFiltrosDigitados";

type Filtros = Record<string, unknown>;
type Consulta = (filters: Filtros) => Promise<unknown>;

interface Tela {
  codigo: string;
  Componente: ComponentType;
  consulta: unknown;
  /** R-02 só mostra o período na janela personalizada. */
  abrirPeriodo?: () => void;
  /** Um filtro da tela que não é o período: um `<select>` pelo nome, ou a busca. */
  outroFiltro: { select: string; campo: string } | { busca: true };
}

const TELAS: Tela[] = [
  {
    codigo: "R-02",
    Componente: ExpiryReportPage,
    consulta: getExpiryReport,
    abrirPeriodo: () =>
      fireEvent.change(screen.getByRole("combobox", { name: "Janela de vencimento" }), {
        target: { value: "CUSTOM" },
      }),
    outroFiltro: { busca: true },
  },
  {
    codigo: "R-03",
    Componente: MovementsReportPage,
    consulta: getMovementsReport,
    outroFiltro: { select: "Tipo de movimento", campo: "type" },
  },
  {
    codigo: "R-05",
    Componente: PlannedActualReportPage,
    consulta: getPlannedActualReport,
    outroFiltro: { select: "Status da OP", campo: "status" },
  },
  { codigo: "R-07", Componente: ConsumptionReportPage, consulta: getConsumptionReport, outroFiltro: { busca: true } },
  {
    codigo: "R-08",
    Componente: PurchaseOrdersReportPage,
    consulta: getPurchaseOrdersReport,
    outroFiltro: { select: "Status", campo: "status" },
  },
  { codigo: "R-09", Componente: ReceiptsReportPage, consulta: getReceiptsReport, outroFiltro: { busca: true } },
  {
    codigo: "R-12",
    Componente: CustomerOrdersReportPage,
    consulta: getCustomerOrdersReport,
    outroFiltro: { select: "Status", campo: "status" },
  },
  { codigo: "R-15", Componente: BillingPeriodReportPage, consulta: getBillingPeriodReport, outroFiltro: { busca: true } },
];

/** 137 registros na janela padrão (6 páginas); 30 a partir de 01/09 (2 páginas). */
const UNIVERSO = 137;
const UNIVERSO_CURTO = 30;
const NOVO_INICIO = "2026-09-01";
const NOVO_FIM = "2026-09-10";

function chamadas(consulta: unknown): Filtros[] {
  return vi.mocked(consulta as Consulta).mock.calls.map(([filtros]) => filtros);
}

function paginacao(pagina: number, total: number) {
  return `Página ${pagina} de ${Math.ceil(total / 25)} · ${total} registros`;
}

/**
 * Faz `acao` e espera a resposta aparecer na paginação. Exatamente UMA consulta
 * nova, e com estes filtros: consulta da página antiga antes, ou repetida
 * depois, reprova.
 */
async function umaConsulta(consulta: unknown, acao: () => void, esperado: Filtros, total: number) {
  const antes = chamadas(consulta).length;
  acao();
  expect(await screen.findByText(paginacao(Number(esperado["page"]), total))).toBeInTheDocument();
  const novas = chamadas(consulta).slice(antes);
  expect(novas).toHaveLength(1);
  expect(novas[0]).toMatchObject(esperado);
}

const proxima = () => fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
const anterior = () => fireEvent.click(screen.getByRole("button", { name: "Anterior" }));

/** Digita no campo e deixa a pausa da digitação passar. */
function digitar(campo: HTMLElement, valor: string) {
  fireEvent.change(campo, { target: { value: valor } });
  act(() => {
    vi.advanceTimersByTime(PAUSA_DA_DIGITACAO_MS);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `shouldAdvanceTime`: `findBy` precisa do relógio andando; a pausa, `digitar` adianta.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  for (const tela of TELAS) {
    vi.mocked(tela.consulta as Consulta).mockImplementation(async (filters) => {
      // O servidor responde pelo recorte: encurtar o período encolhe o universo.
      const total = filters["from"] === NOVO_INICIO ? UNIVERSO_CURTO : UNIVERSO;
      return {
        rows: [],
        page: Number(filters["page"] ?? 1),
        pageSize: 25,
        total,
        summary: { billingCount: total, billingsWithCompletePricing: total, totalAmount: null },
      };
    });
  }
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mudar o recorte volta para a página 1; Anterior/Próxima só mudam a página", () => {
  it.each(TELAS)("$codigo", async ({ Componente, consulta, abrirPeriodo, outroFiltro }) => {
    render(
      <MemoryRouter>
        <Componente />
      </MemoryRouter>,
    );
    abrirPeriodo?.();
    await waitFor(() => expect(chamadas(consulta).at(-1)?.["from"]).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    expect(await screen.findByText(paginacao(1, UNIVERSO))).toBeInTheDocument();
    const { from: inicio, to: fim } = chamadas(consulta).at(-1)!;

    // Até a última página: cada clique é uma consulta, com o período intacto.
    for (let pagina = 2; pagina <= 6; pagina += 1) {
      await umaConsulta(consulta, proxima, { from: inicio, to: fim, page: pagina }, UNIVERSO);
    }
    await umaConsulta(consulta, anterior, { from: inicio, to: fim, page: 5 }, UNIVERSO);
    await umaConsulta(consulta, proxima, { from: inicio, to: fim, page: 6 }, UNIVERSO);

    // De: a primeira consulta do universo novo já é a página 1 — nunca a 6.
    await umaConsulta(
      consulta,
      () => digitar(screen.getByLabelText("De"), NOVO_INICIO),
      { from: NOVO_INICIO, to: fim, page: 1 },
      UNIVERSO_CURTO,
    );
    await umaConsulta(consulta, proxima, { from: NOVO_INICIO, to: fim, page: 2 }, UNIVERSO_CURTO);

    // até
    await umaConsulta(
      consulta,
      () => digitar(screen.getByLabelText("até"), NOVO_FIM),
      { from: NOVO_INICIO, to: NOVO_FIM, page: 1 },
      UNIVERSO_CURTO,
    );
    await umaConsulta(consulta, proxima, { from: NOVO_INICIO, to: NOVO_FIM, page: 2 }, UNIVERSO_CURTO);

    // Outro filtro da mesma tela.
    let campo: string;
    let valor: string;
    let aplicar: () => void;
    if ("busca" in outroFiltro) {
      campo = "search";
      valor = "LOT";
      aplicar = () => digitar(screen.getByRole("searchbox"), valor);
    } else {
      const select = screen.getByRole("combobox", { name: outroFiltro.select }) as HTMLSelectElement;
      const opcao = Array.from(select.options).find((option) => option.value !== "" && option.value !== select.value);
      campo = outroFiltro.campo;
      valor = opcao!.value;
      aplicar = () => fireEvent.change(select, { target: { value: valor } });
    }
    await umaConsulta(consulta, aplicar, { from: NOVO_INICIO, to: NOVO_FIM, [campo]: valor, page: 1 }, UNIVERSO_CURTO);

    // Navegar de novo não reinicia nem perde filtro.
    await umaConsulta(
      consulta,
      proxima,
      { from: NOVO_INICIO, to: NOVO_FIM, [campo]: valor, page: 2 },
      UNIVERSO_CURTO,
    );
    await umaConsulta(
      consulta,
      anterior,
      { from: NOVO_INICIO, to: NOVO_FIM, [campo]: valor, page: 1 },
      UNIVERSO_CURTO,
    );

    // O CSV é o recorte inteiro: leva o período, nunca a página.
    const csv = new URL(
      screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "",
      "http://exemplo.invalid",
    );
    expect(csv.searchParams.get("from")).toBe(NOVO_INICIO);
    expect(csv.searchParams.get("to")).toBe(NOVO_FIM);
    expect(csv.searchParams.get("page")).toBeNull();
    expect(csv.searchParams.get("pageSize")).toBeNull();
  });
});

describe("R-05: custo de material não é recorte", () => {
  it("marcar 'Incluir custo de material' mantém a página", async () => {
    render(
      <MemoryRouter>
        <PlannedActualReportPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(paginacao(1, UNIVERSO))).toBeInTheDocument();
    await umaConsulta(getPlannedActualReport, proxima, { page: 2, includeCost: false }, UNIVERSO);
    await umaConsulta(getPlannedActualReport, proxima, { page: 3, includeCost: false }, UNIVERSO);

    const antes = chamadas(getPlannedActualReport).length;
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir custo de material" }));
    // Mesma página e mesmo total: o texto da paginação não muda, então espera a
    // resposta sair do "Carregando…" antes de contar.
    await waitFor(() => expect(screen.queryByText("Carregando…")).toBeNull());
    const novas = chamadas(getPlannedActualReport).slice(antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ page: 3, includeCost: true });
    expect(screen.getByText(paginacao(3, UNIVERSO))).toBeInTheDocument();
  });
});

describe("guarda estrutural", () => {
  it("todo campo de data dos Relatórios está na lista acima", () => {
    const pasta = join(process.cwd(), "src", "pages", "reports");
    const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const campos = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith(".tsx") && !arquivo.includes(".test."))
      .flatMap((arquivo) => semComentarios(readFileSync(join(pasta, arquivo), "utf8")).match(/type="date"/g) ?? []);
    // Relatório novo com período entra em TELAS e ganha o teste do reinício.
    expect(campos).toHaveLength(TELAS.length * 2);
  });
});
