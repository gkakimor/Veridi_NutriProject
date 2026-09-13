import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Relatórios — período invertido não se consulta; ponta vazia é aberta
 * (PERIOD-RANGE-VALIDATION-WAVE-01).
 *
 * "De 11/09 até 10/09" pedia o relatório e o servidor respondia vazio: a tabela
 * dizia "nenhuma movimentação no período" para uma pergunta inválida. Agora a
 * tela usa a mesma regra do servidor (`recusaDoPeriodo`): as duas datas
 * preenchidas e invertidas não consultam, a frase aparece embaixo dos filtros,
 * a tabela não diz "nenhum registro" e CSV e PDF não se oferecem. Uma ponta
 * vazia consulta, sem completar com hoje. Corrigir consulta uma vez.
 *
 * O servidor recusa o mesmo em `api lib/periodo-invertido.test.ts`; o PDF com a
 * frase do servidor está em `pdf/documents/report-content.test.tsx`.
 *
 * Data escolhida vale quando a digitação para (REPORTS-SEARCH-UX-01): cada
 * mudança aqui deixa a pausa passar. Os valores do meio de uma data digitada,
 * inclusive invertidos, estão em `relatorios-busca-digitada.test.tsx`.
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
  },
  { codigo: "R-03", Componente: MovementsReportPage, consulta: getMovementsReport },
  { codigo: "R-05", Componente: PlannedActualReportPage, consulta: getPlannedActualReport },
  { codigo: "R-07", Componente: ConsumptionReportPage, consulta: getConsumptionReport },
  { codigo: "R-08", Componente: PurchaseOrdersReportPage, consulta: getPurchaseOrdersReport },
  { codigo: "R-09", Componente: ReceiptsReportPage, consulta: getReceiptsReport },
  { codigo: "R-12", Componente: CustomerOrdersReportPage, consulta: getCustomerOrdersReport },
  { codigo: "R-15", Componente: BillingPeriodReportPage, consulta: getBillingPeriodReport },
];

const RECUSA = "A data inicial não pode ser posterior à data final.";
const DICA_DA_TABELA = "Corrija o período para consultar.";
/** 13/09/2026 às 12:00 em São Paulo — a janela padrão dos relatórios sai daqui. */
const AGORA = new Date("2026-09-13T15:00:00.000Z");
const TOTAL = 60;
const PAGINACAO = `Página 1 de ${Math.ceil(TOTAL / 25)} · ${TOTAL} registros`;

function chamadas(consulta: unknown): Filtros[] {
  return vi.mocked(consulta as Consulta).mock.calls.map(([filtros]) => filtros);
}

const campoDe = () => screen.getByLabelText("De") as HTMLInputElement;
const campoAte = () => screen.getByLabelText("até") as HTMLInputElement;

/** Escolhe a data e deixa a pausa da digitação passar. */
function escolher(campo: HTMLInputElement, valor: string) {
  fireEvent.change(campo, { target: { value: valor } });
  act(() => {
    vi.advanceTimersByTime(PAUSA_DA_DIGITACAO_MS);
  });
}
const mudar = (campo: HTMLInputElement, valor: string) => () => escolher(campo, valor);

/** Uma consulta nova, com estes filtros, e a resposta dela na tela. */
async function umaConsulta(consulta: unknown, acao: () => void, esperado: Filtros) {
  const antes = chamadas(consulta).length;
  acao();
  expect(await screen.findByText(PAGINACAO)).toBeInTheDocument();
  const novas = chamadas(consulta).slice(antes);
  expect(novas).toHaveLength(1);
  expect(novas[0]).toMatchObject(esperado);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("link", { name: "Exportar CSV" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
}

function linkDoCsv(): URL {
  return new URL(
    screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "",
    "http://exemplo.invalid",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // `shouldAdvanceTime`: `findBy` precisa do relógio andando; a pausa, `escolher` adianta.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
  for (const tela of TELAS) {
    vi.mocked(tela.consulta as Consulta).mockImplementation(async (filters) => ({
      rows: [],
      page: Number(filters["page"] ?? 1),
      pageSize: 25,
      total: TOTAL,
      summary: { billingCount: TOTAL, billingsWithCompletePricing: TOTAL, totalAmount: "10.00" },
    }));
  }
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("as seis perguntas do período, tela por tela", () => {
  it.each(TELAS)("$codigo", async ({ Componente, consulta, abrirPeriodo }) => {
    render(
      <MemoryRouter>
        <Componente />
      </MemoryRouter>,
    );
    abrirPeriodo?.();
    // Janela padrão: as duas pontas, a inicial antes da final.
    expect(await screen.findByText(PAGINACAO)).toBeInTheDocument();
    const padrao = chamadas(consulta).at(-1)!;
    expect(String(padrao["from"]) <= String(padrao["to"])).toBe(true);

    // Inicial antes da final.
    await umaConsulta(consulta, mudar(campoDe(), "2026-09-01"), { from: "2026-09-01", to: padrao["to"], page: 1 });
    // O mesmo dia nas duas.
    await umaConsulta(consulta, mudar(campoAte(), "2026-09-01"), { from: "2026-09-01", to: "2026-09-01" });
    // Só a inicial: aberta para frente — nada completa a final com hoje.
    await umaConsulta(consulta, mudar(campoAte(), ""), { from: "2026-09-01", to: "" });
    expect(linkDoCsv().searchParams.get("from")).toBe("2026-09-01");
    expect(linkDoCsv().searchParams.has("to")).toBe(false);
    // Nenhuma ponta.
    await umaConsulta(consulta, mudar(campoDe(), ""), { from: "", to: "" });
    // Só a final: aberta para trás.
    await umaConsulta(consulta, mudar(campoAte(), "2026-09-10"), { from: "", to: "2026-09-10" });

    // Inicial depois da final: nenhuma consulta, a frase, e nada que se leia como resposta.
    const antes = chamadas(consulta).length;
    escolher(campoDe(), "2026-09-11");
    expect(await screen.findByRole("alert")).toHaveTextContent(RECUSA);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chamadas(consulta)).toHaveLength(antes);
    for (const campo of [campoDe(), campoAte()]) {
      expect(campo).toHaveAttribute("aria-invalid", "true");
      expect(campo).toHaveAttribute("aria-describedby", "report-period-error");
    }
    expect(screen.getByText(DICA_DA_TABELA)).toBeInTheDocument();
    expect(screen.queryByText(PAGINACAO)).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();
    // CSV e PDF perguntariam o mesmo período ao servidor: não se oferecem.
    expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();

    // Corrigir consulta uma vez, com o recorte corrigido.
    await umaConsulta(consulta, mudar(campoAte(), "2026-09-11"), { from: "2026-09-11", to: "2026-09-11", page: 1 });
    expect(campoDe()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(DICA_DA_TABELA)).toBeNull();
  });
});

describe("R-02: as datas só são filtro na janela personalizada", () => {
  it("personalizado invertido recusa; voltar a uma janela pronta consulta sem as datas", async () => {
    render(
      <MemoryRouter>
        <ExpiryReportPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(PAGINACAO)).toBeInTheDocument();
    const janela = screen.getByRole("combobox", { name: "Janela de vencimento" });
    await umaConsulta(getExpiryReport, () => fireEvent.change(janela, { target: { value: "CUSTOM" } }), {
      window: "CUSTOM",
    });

    const antes = chamadas(getExpiryReport).length;
    fireEvent.change(campoDe(), { target: { value: "2026-12-31" } });
    escolher(campoAte(), "2026-12-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(RECUSA);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chamadas(getExpiryReport)).toHaveLength(antes);

    await umaConsulta(getExpiryReport, () => fireEvent.change(janela, { target: { value: "D30" } }), { window: "D30" });
    expect(chamadas(getExpiryReport).at(-1)).not.toHaveProperty("from");
    expect(chamadas(getExpiryReport).at(-1)).not.toHaveProperty("to");
  });
});

describe("guarda estrutural", () => {
  it("toda tela de relatório com campo de data passa a recusa ao esqueleto e desliga a consulta", () => {
    const pasta = join(process.cwd(), "src", "pages", "reports");
    const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fontes = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith("Reports.tsx"))
      .map((arquivo) => semComentarios(readFileSync(join(pasta, arquivo), "utf8")));
    const contar = (padrao: RegExp) => fontes.reduce((soma, fonte) => soma + (fonte.match(padrao)?.length ?? 0), 0);

    expect(contar(/type="date"/g)).toBe(TELAS.length * 2);
    expect(contar(/periodRefusal=\{periodoRecusado\}/g)).toBe(TELAS.length);
    expect(contar(/enabled: periodoRecusado === null/g)).toBe(TELAS.length);
    expect(contar(/\{\.\.\.ariaDoPeriodoRecusado\(periodoRecusado\)\}/g)).toBe(TELAS.length * 2);
  });
});
