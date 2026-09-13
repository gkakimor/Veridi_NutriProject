import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * Relatórios — a data escolhida é o dia da Veridi, em qualquer fuso de quem
 * abre a tela (REPORTS-BUSINESS-DATE-01).
 *
 * As telas mandavam `new Date(`${dia}T00:00:00`).toISOString()` e
 * `...T23:59:59.999`: a meia-noite do NAVEGADOR. A mesma escolha de 12/09 era
 * um recorte em UTC, outro em UTC-07 e outro em São Paulo — e o CSV e o PDF,
 * que recebem os mesmos filtros, erravam junto. Agora o dia viaja como
 * `YYYY-MM-DD` e o servidor o abre pela espécie da coluna; a borda do dia
 * comercial, a virada UTC das 01:30 e o fim exclusivo são provados em
 * `api modules/reports/reports-dia-comercial.test.ts`.
 *
 * Aqui: a tela, o link do CSV e o endereço do PDF levam o MESMO dia nos três
 * fusos; a janela padrão nasce no dia comercial, inclusive às 01:30 UTC; campo
 * limpo deixa a ponta aberta em vez de derrubar a tela; e nenhum código de
 * Relatórios volta a montar período com o relógio do navegador.
 */

vi.mock("../../lib/reports-api", () => ({
  getInventoryPositionReport: vi.fn(),
  getExpiryReport: vi.fn(),
  getMovementsReport: vi.fn(),
  getRequirementsReport: vi.fn(),
  getPlannedActualReport: vi.fn(),
  getProductionTraceabilityReport: vi.fn(),
  getConsumptionReport: vi.fn(),
  getPurchaseOrdersReport: vi.fn(),
  getReceiptsReport: vi.fn(),
  getOnOrderReport: vi.fn(),
  getLatePurchaseOrdersReport: vi.fn(),
  getCustomerOrdersReport: vi.fn(),
  getFulfillmentReport: vi.fn(),
  getOrderOperationReport: vi.fn(),
  getBillingPeriodReport: vi.fn(),
  getAwaitingBillingReport: vi.fn(),
  getOrderDeliveredBilledReport: vi.fn(),
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

/** Os três navegadores do handoff, com o deslocamento que cada um tem em 12/09. */
const FUSOS = [
  { nome: "UTC", fuso: "UTC", deslocamentoEmMinutos: 0 },
  { nome: "UTC-07", fuso: "Etc/GMT+7", deslocamentoEmMinutos: 420 },
  { nome: "São Paulo", fuso: "America/Sao_Paulo", deslocamentoEmMinutos: 180 },
];

type Consulta = (filters: Record<string, unknown>) => Promise<unknown>;

interface Tela {
  codigo: string;
  Componente: ComponentType;
  consulta: unknown;
  /** Dias a partir de hoje que abrem os campos De/até. */
  janelaPadrao: [string, string];
  /** R-02 só mostra o período na janela personalizada. */
  abrirPeriodo?: () => void;
}

/** Janela padrão quando o dia comercial é 12/09/2026. */
const TRINTA_DIAS: [string, string] = ["2026-08-14", "2026-09-12"];
const NOVENTA_DIAS: [string, string] = ["2026-06-15", "2026-09-12"];

const TELAS: Tela[] = [
  {
    codigo: "R-02",
    Componente: ExpiryReportPage,
    consulta: getExpiryReport,
    janelaPadrao: ["2026-09-12", "2026-11-11"],
    abrirPeriodo: () =>
      fireEvent.change(screen.getByRole("combobox", { name: "Janela de vencimento" }), {
        target: { value: "CUSTOM" },
      }),
  },
  { codigo: "R-03", Componente: MovementsReportPage, consulta: getMovementsReport, janelaPadrao: TRINTA_DIAS },
  { codigo: "R-05", Componente: PlannedActualReportPage, consulta: getPlannedActualReport, janelaPadrao: TRINTA_DIAS },
  { codigo: "R-07", Componente: ConsumptionReportPage, consulta: getConsumptionReport, janelaPadrao: TRINTA_DIAS },
  { codigo: "R-08", Componente: PurchaseOrdersReportPage, consulta: getPurchaseOrdersReport, janelaPadrao: NOVENTA_DIAS },
  { codigo: "R-09", Componente: ReceiptsReportPage, consulta: getReceiptsReport, janelaPadrao: TRINTA_DIAS },
  { codigo: "R-12", Componente: CustomerOrdersReportPage, consulta: getCustomerOrdersReport, janelaPadrao: NOVENTA_DIAS },
  { codigo: "R-15", Componente: BillingPeriodReportPage, consulta: getBillingPeriodReport, janelaPadrao: TRINTA_DIAS },
];

function ultimaChamada(consulta: unknown): Record<string, unknown> {
  const chamadas = vi.mocked(consulta as Consulta).mock.calls;
  return (chamadas[chamadas.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

/** Onde o botão PDF levou — a rota de impressão recebe os filtros pela URL. */
function Destino() {
  const location = useLocation();
  return <p data-testid="destino">{`${location.pathname}${location.search}`}</p>;
}

function abrir(Componente: ComponentType) {
  return render(
    <MemoryRouter initialEntries={["/relatorio"]}>
      <Routes>
        <Route path="/relatorio" element={<Componente />} />
        <Route path="/print/relatorios/:code" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Roda `corpo` com o navegador no fuso pedido — e confere que o fuso pegou. */
async function noFuso<T>(
  { fuso, deslocamentoEmMinutos }: (typeof FUSOS)[number],
  corpo: () => Promise<T> | T,
): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = fuso;
  try {
    // Sem isto o teste passaria sem nunca ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamentoEmMinutos);
    return await corpo();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

function periodoDoLink(href: string): [string | null, string | null] {
  const url = new URL(href, "http://exemplo.invalid");
  return [url.searchParams.get("from"), url.searchParams.get("to")];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const tela of TELAS) {
    vi.mocked(tela.consulta as Consulta).mockImplementation(async (filters) => ({
      rows: [],
      page: Number(filters["page"] ?? 1),
      pageSize: 25,
      total: 0,
      summary: { billingCount: 0, billingsWithCompletePricing: 0, totalAmount: null },
    }));
  }
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("o bug: a meia-noite do navegador", () => {
  it("a conversão antiga fazia da mesma escolha três instantes diferentes", async () => {
    const instantes: string[] = [];
    for (const fuso of FUSOS) {
      // Reprodução do que as oito telas faziam — só aqui, nunca no código delas.
      instantes.push(await noFuso(fuso, () => new Date("2026-09-12T00:00:00").toISOString()));
    }
    expect(instantes).toEqual([
      "2026-09-12T00:00:00.000Z",
      "2026-09-12T07:00:00.000Z",
      "2026-09-12T03:00:00.000Z",
    ]);
  });
});

describe("a mesma seleção é o mesmo dia — tela, CSV e PDF", () => {
  it.each(TELAS)("$codigo: 12/09 em UTC, UTC-07 e São Paulo", async ({ Componente, consulta, abrirPeriodo }) => {
    const medidos: string[] = [];
    for (const fuso of FUSOS) {
      medidos.push(
        await noFuso(fuso, async () => {
          vi.mocked(consulta as Consulta).mockClear();
          const { unmount } = abrir(Componente);
          abrirPeriodo?.();
          fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-12" } });
          fireEvent.change(screen.getByLabelText("até"), { target: { value: "2026-09-12" } });
          await waitFor(() =>
            expect(ultimaChamada(consulta)).toMatchObject({ from: "2026-09-12", to: "2026-09-12" }),
          );
          const csv = periodoDoLink(
            screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "",
          );
          fireEvent.click(screen.getByRole("button", { name: "PDF" }));
          const pdf = periodoDoLink((await screen.findByTestId("destino")).textContent ?? "");
          const { from, to } = ultimaChamada(consulta);
          unmount();
          return JSON.stringify({ tela: [from, to], csv, pdf });
        }),
      );
    }
    expect(new Set(medidos).size).toBe(1);
    expect(JSON.parse(medidos[0]!)).toEqual({
      tela: ["2026-09-12", "2026-09-12"],
      csv: ["2026-09-12", "2026-09-12"],
      pdf: ["2026-09-12", "2026-09-12"],
    });
  });
});

describe("janela padrão no dia comercial", () => {
  it.each(TELAS)(
    "$codigo: às 01:30 UTC (22:30 de 12/09 em São Paulo) abre terminando em 12/09 nos três fusos",
    async ({ Componente, consulta, janelaPadrao, abrirPeriodo }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-13T01:30:00.000Z"));
      for (const fuso of FUSOS) {
        await noFuso(fuso, async () => {
          vi.mocked(consulta as Consulta).mockClear();
          const { unmount } = abrir(Componente);
          abrirPeriodo?.();
          expect(screen.getByLabelText("De")).toHaveValue(janelaPadrao[0]);
          expect(screen.getByLabelText("até")).toHaveValue(janelaPadrao[1]);
          await waitFor(() =>
            expect(ultimaChamada(consulta)).toMatchObject({ from: janelaPadrao[0], to: janelaPadrao[1] }),
          );
          unmount();
        });
      }
    },
  );
});

describe("campo de data limpo", () => {
  it("deixa a ponta aberta — antes, `new Date('T00:00:00')` derrubava a tela", async () => {
    abrir(BillingPeriodReportPage);
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    await waitFor(() => expect(ultimaChamada(getBillingPeriodReport)).toMatchObject({ from: "" }));
    expect(screen.getByRole("heading", { name: "R-15 · Faturamento por período" })).toBeInTheDocument();
    const [from, to] = periodoDoLink(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "");
    expect(from).toBeNull();
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("guarda estrutural", () => {
  /** Tira comentário: a explicação do bug pode citar o padrão; o código, não. */
  function semComentarios(fonte: string): string {
    return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("nenhum código de Relatórios monta período com a meia-noite ou o dia do navegador", () => {
    const src = join(process.cwd(), "src");
    const pasta = join(src, "pages", "reports");
    const arquivos = [
      ...readdirSync(pasta)
        .filter((arquivo) => /\.(ts|tsx)$/.test(arquivo) && !arquivo.includes(".test."))
        .map((arquivo) => join(pasta, arquivo)),
      join(src, "pages", "print", "ReportPrintPage.tsx"),
      join(src, "lib", "reports-api.ts"),
    ];
    expect(arquivos.length).toBeGreaterThanOrEqual(10);
    for (const arquivo of arquivos) {
      const codigo = semComentarios(readFileSync(arquivo, "utf8"));
      // `new Date(`${dia}T00:00:00`)`, `new Date(dia + "T00:00")` e o fim inventado.
      expect(codigo, arquivo).not.toMatch(/T00:00/);
      expect(codigo, arquivo).not.toMatch(/T23:59/);
      expect(codigo, arquivo).not.toMatch(/new Date\(\s*`/);
      expect(codigo, arquivo).not.toMatch(/new Date\([^)]*\+\s*["'`]T/);
      // Dia do navegador e limites em ISO são do Dashboard, não dos Relatórios.
      expect(codigo, arquivo).not.toMatch(/\b(dateInputValueOffset|startOfDay|endOfDay|resolvePeriodBounds)\b/);
    }
  });
});
