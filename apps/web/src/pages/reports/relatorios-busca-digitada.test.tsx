import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { BillingPeriodRowDTO } from "@veridi/shared";

/**
 * Relatórios — busca e datas DIGITADAS consultam quando a digitação para
 * (REPORTS-SEARCH-UX-01).
 *
 * Cada tecla virava consulta: "abc" pedia "a", "ab" e "abc", e a tabela
 * piscava a cada letra, porque filtro novo esconde o recorte anterior até a
 * resposta (SMALL-UX-CLEANUP-WAVE-01). A data digitada no Chromium passa por
 * valores válidos no meio — dia de um dígito, mês incompleto (vazio: ponta
 * aberta) e os anos 0002, 0020 e 0202 —, e cada um consultava; no "até", o
 * ano do meio fazia a recusa do período piscar. Erro de consulta ainda
 * aparecia junto da frase de vazio, como se a consulta tivesse concluído
 * "nenhum registro".
 *
 * Agora o campo mostra cada tecla na hora e a consulta, o CSV, o PDF e a
 * recusa do período recebem o valor quando a digitação para por
 * `PAUSA_DA_DIGITACAO_MS` (ou no Enter), numa consulta só e na página 1.
 * Seletores seguem imediatos. Relógio falso: a pausa é medida, não esperada.
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
  getIndustrialCostByProductReport: vi.fn(),
  getPricingByProductReport: vi.fn(),
  getQuotePricingAuditReport: vi.fn(),
}));
vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn(), getProductionOrder: vi.fn() }));
vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn(), getCustomerOrder: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
// R-19 e R-20 são da proveniência econômica: a tela precisa de um perfil que os vê.
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Ana", role: "ADMIN" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", name: "Ana", role: "ADMIN" } }),
}));

import * as relatorios from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { AwaitingBillingReportPage, BillingPeriodReportPage, OrderDeliveredBilledReportPage } from "./BillingReports";
import { CustomerOrdersReportPage, FulfillmentReportPage } from "./CommercialReports";
import {
  IndustrialCostByProductReportPage,
  PricingByProductReportPage,
  QuotePricingAuditReportPage,
} from "./CostReports";
import { ExpiryReportPage, InventoryPositionReportPage, MovementsReportPage } from "./InventoryReports";
import { ConsumptionReportPage, PlannedActualReportPage, RequirementsReportPage } from "./ProductionReports";
import { OnOrderReportPage, PurchaseOrdersReportPage, ReceiptsReportPage } from "./PurchasingReports";
import { PAUSA_DA_DIGITACAO_MS as PAUSA } from "./useFiltrosDigitados";

type Filtros = Record<string, unknown>;
type Consulta = (filters: Filtros) => Promise<unknown>;
type Resposta = Awaited<ReturnType<typeof relatorios.getBillingPeriodReport>>;

/** 13/09/2026, meio-dia em São Paulo: R-15 abre de 15/08 a 13/09. */
const AGORA = new Date("2026-09-13T15:00:00.000Z");
const VAZIO = "Nenhum faturamento para os filtros informados.";
const RECUSA = "A data inicial não pode ser posterior à data final.";
const FALHA = "Não foi possível carregar o relatório: Serviço indisponível.";

function faturamento(n: number): BillingPeriodRowDTO {
  return {
    billingId: `fat-${n}`,
    code: `FAT-${String(n).padStart(6, "0")}`,
    issuedAt: "2026-09-10T15:00:00.000Z",
    customerOrderId: `co-${n}`,
    customerOrderCode: null,
    shipmentId: `exp-${n}`,
    shipmentCode: null,
    customerId: "cli-1",
    customerName: "NutriViva",
    lineCount: 1,
    totalAmount: "100.00",
    hasCompletePricing: true,
    externalReference: null,
  };
}

/** A página pedida de um recorte com `total` faturamentos, numerados a partir de `primeiro`. */
function recorte(total: number, primeiro = 1) {
  return (filters: Filtros): Resposta => {
    const page = Number(filters["page"] ?? 1);
    const quantos = Math.max(0, Math.min(25, total - (page - 1) * 25));
    return {
      rows: Array.from({ length: quantos }, (_, indice) => faturamento(primeiro + (page - 1) * 25 + indice)),
      page,
      pageSize: 25,
      total,
      summary: { billingCount: total, billingsWithCompletePricing: total, totalAmount: `${total * 100}.00` },
    };
  };
}

/** Cada consulta do R-15 fica pendente até o teste responder. */
let pendentes: { filters: Filtros; responder: (r: Resposta) => void; recusar: (e: unknown) => void }[];

async function responder(indice: number, montar: (filters: Filtros) => Resposta) {
  const pendente = pendentes[indice]!;
  await act(async () => pendente.responder(montar(pendente.filters)));
}

async function recusar(indice: number) {
  await act(async () => pendentes[indice]!.recusar(new Error("Serviço indisponível.")));
}

function Destino() {
  const location = useLocation();
  return <p data-testid="destino">{`${location.pathname}${location.search}`}</p>;
}

function abrir(Componente: ComponentType = BillingPeriodReportPage) {
  return render(
    <MemoryRouter initialEntries={["/relatorio"]}>
      <Routes>
        <Route path="/relatorio" element={<Componente />} />
        <Route path="/print/relatorios/:code" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** O relógio anda `ms` — a pausa da digitação é medida aqui, nunca esperada. */
function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function digitar(campo: HTMLElement, valor: string) {
  fireEvent.change(campo, { target: { value: valor } });
}

/** Tecla a tecla, com o intervalo de quem digita rápido. */
function digitarEmSequencia(campo: HTMLElement, valores: readonly string[]) {
  for (const valor of valores) {
    digitar(campo, valor);
    passar(60);
  }
}

/**
 * O que o `<input type="date">` do Chromium entrega a cada tecla digitada em
 * dd/mm/aaaa sobre `atual` — medido no navegador real: dia de um dígito já
 * vale, mês começando em 0 esvazia o campo, e o ano passa por 000A, 00AA e 0AAA.
 */
function digitacaoDoChromium(atual: string, dia: string, mes: string, ano: string): string[] {
  const [anoAtual, mesAtual] = atual.split("-") as [string, string, string];
  return [
    dia[0] === "0" ? "" : `${anoAtual}-${mesAtual}-0${dia[0]}`,
    `${anoAtual}-${mesAtual}-${dia}`,
    mes[0] === "0" ? "" : `${anoAtual}-0${mes[0]}-${dia}`,
    `${anoAtual}-${mes}-${dia}`,
    `000${ano[0]}-${mes}-${dia}`,
    `00${ano.slice(0, 2)}-${mes}-${dia}`,
    `0${ano.slice(0, 3)}-${mes}-${dia}`,
    `${ano}-${mes}-${dia}`,
  ];
}

const busca = () => screen.getByRole("searchbox");
const campoDe = () => screen.getByLabelText("De") as HTMLInputElement;
const campoAte = () => screen.getByLabelText("até") as HTMLInputElement;
const faturamentoNaTela = (n: number) =>
  screen.queryByRole("button", { name: `FAT-${String(n).padStart(6, "0")}` });
const linkDoCsv = () => screen.queryByRole("link", { name: "Exportar CSV" });

beforeEach(() => {
  vi.clearAllMocks();
  // Sem `setInterval`: nada aqui usa `waitFor`/`findBy`, que dependem do relógio.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(AGORA);
  pendentes = [];
  vi.mocked(relatorios.getBillingPeriodReport).mockImplementation(
    (filters) =>
      new Promise<Resposta>((ok, falha) => {
        pendentes.push({ filters, responder: ok, recusar: falha });
      }),
  );
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("busca digitada: uma consulta por valor que parou", () => {
  it("rápida: a, ab, abc é UMA consulta, de abc, na página 1 — e o campo mostra cada tecla na hora", async () => {
    abrir();
    expect(pendentes).toHaveLength(1);
    await responder(0, recorte(2));

    for (const valor of ["a", "ab", "abc"]) {
      digitar(busca(), valor);
      expect(busca()).toHaveValue(valor);
      passar(100);
    }
    passar(PAUSA - 101);
    // Até a pausa: nenhuma consulta, e a tela segue a do filtro aplicado.
    expect(pendentes).toHaveLength(1);
    expect(faturamentoNaTela(1)).not.toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();

    passar(1);
    expect(pendentes.map((pendente) => pendente.filters["search"])).toEqual(["", "abc"]);
    expect(pendentes[1]!.filters).toMatchObject({ search: "abc", page: 1 });
    // Aplicada, a busca esconde o recorte anterior até a resposta.
    expect(faturamentoNaTela(1)).toBeNull();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(2);
  });

  it("lenta: a e depois ab, cada um parado, são duas consultas; voltar ao aplicado antes da pausa não consulta", async () => {
    abrir();
    await responder(0, recorte(2));

    digitar(busca(), "a");
    passar(PAUSA);
    digitar(busca(), "ab");
    passar(PAUSA);
    expect(pendentes.map((pendente) => pendente.filters["search"])).toEqual(["", "a", "ab"]);

    digitar(busca(), "abx");
    passar(100);
    digitar(busca(), "ab");
    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(3);
  });

  it("Enter aplica na hora, sem esperar a pausa, e a pausa não repete a consulta", async () => {
    abrir();
    await responder(0, recorte(2));

    digitar(busca(), "FAT-9");
    fireEvent.keyDown(busca(), { key: "Enter" });
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ search: "FAT-9", page: 1 });

    passar(10 * PAUSA);
    fireEvent.keyDown(busca(), { key: "Enter" });
    expect(pendentes).toHaveLength(2);
  });

  it("na página 2, a busca aplicada volta à página 1 numa consulta só; durante a pausa a página aberta fica", async () => {
    abrir();
    await responder(0, recorte(30));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await responder(1, recorte(30));
    expect(screen.getByText("Página 2 de 2 · 30 registros")).toBeInTheDocument();

    digitar(busca(), "NutriViva");
    passar(PAUSA - 1);
    expect(pendentes).toHaveLength(2);
    expect(screen.getByText("Página 2 de 2 · 30 registros")).toBeInTheDocument();

    passar(1);
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.filters).toMatchObject({ search: "NutriViva", page: 1 });
    await responder(2, recorte(3, 901));
    expect(screen.getByText("Página 1 de 1 · 3 registros")).toBeInTheDocument();
    expect(faturamentoNaTela(901)).not.toBeNull();
    expect(pendentes).toHaveLength(3);
  });

  it("A, AB e ABC consultados e respondidos ao contrário: só ABC aparece", async () => {
    abrir();
    await responder(0, recorte(2));
    for (const valor of ["A", "AB", "ABC"]) {
      digitar(busca(), valor);
      passar(PAUSA);
    }
    expect(pendentes.map((pendente) => pendente.filters["search"])).toEqual(["", "A", "AB", "ABC"]);

    await responder(3, recorte(1, 701));
    expect(faturamentoNaTela(701)).not.toBeNull();
    await responder(2, recorte(1, 501));
    await responder(1, recorte(1, 301));
    expect(faturamentoNaTela(501)).toBeNull();
    expect(faturamentoNaTela(301)).toBeNull();
    expect(faturamentoNaTela(701)).not.toBeNull();
    expect(busca()).toHaveValue("ABC");
  });
});

describe("carga, erro e vazio", () => {
  it("primeira carga: 'Carregando…', sem frase de vazio e sem alerta antes da resposta", () => {
    const { container } = abrir();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(VAZIO)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector(".table-container")).toHaveAttribute("aria-busy", "true");
  });

  it("consulta que falha mostra o alerta e NÃO a frase de vazio — na primeira carga e depois de uma busca", async () => {
    abrir();
    await recusar(0);
    expect(screen.getByRole("alert")).toHaveTextContent(FALHA);
    expect(screen.queryByText(VAZIO)).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();

    // Resposta vazia de verdade continua dizendo que não há registro.
    digitar(busca(), "X");
    passar(PAUSA);
    await responder(1, recorte(0));
    expect(screen.getByText(VAZIO)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    digitar(busca(), "XY");
    passar(PAUSA);
    await recusar(2);
    expect(screen.getByRole("alert")).toHaveTextContent(FALHA);
    expect(screen.queryByText(VAZIO)).toBeNull();
    expect(screen.queryByText(/^Página \d+ de \d+ ·/)).toBeNull();
  });
});

describe("datas digitadas", () => {
  it("De digitado passa por dia, vazio e anos 0002/0020/0202: uma consulta, do dia final", async () => {
    abrir();
    await responder(0, recorte(2));
    expect(campoDe()).toHaveValue("2026-08-15");

    digitarEmSequencia(campoDe(), digitacaoDoChromium("2026-08-15", "01", "09", "2026"));
    expect(campoDe()).toHaveValue("2026-09-01");
    expect(pendentes).toHaveLength(1);

    passar(PAUSA);
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ from: "2026-09-01", to: "2026-09-13", page: 1 });
    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(2);
  });

  it("até digitado antes do De: nenhuma consulta nem recusa no meio; a recusa só quando para, e corrigir consulta uma vez", async () => {
    abrir();
    await responder(0, recorte(2));

    const sequencia = digitacaoDoChromium("2026-09-13", "10", "08", "2026");
    for (const valor of sequencia) {
      digitar(campoAte(), valor);
      expect(screen.queryByRole("alert")).toBeNull();
      passar(60);
    }
    passar(PAUSA - 61);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(pendentes).toHaveLength(1);

    passar(1);
    expect(screen.getByRole("alert")).toHaveTextContent(RECUSA);
    expect(campoDe()).toHaveAttribute("aria-invalid", "true");
    expect(campoAte()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(1);

    digitar(campoAte(), "2026-09-10");
    fireEvent.keyDown(campoAte(), { key: "Enter" });
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ from: "2026-08-15", to: "2026-09-10", page: 1 });
    expect(screen.queryByRole("alert")).toBeNull();
    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(2);
  });

  it("De e até digitados em sequência saem numa consulta só", async () => {
    abrir();
    await responder(0, recorte(2));

    digitar(campoDe(), "2026-09-01");
    passar(200);
    digitar(campoAte(), "2026-09-05");
    passar(PAUSA - 1);
    expect(pendentes).toHaveLength(1);
    passar(1);
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ from: "2026-09-01", to: "2026-09-05", page: 1 });
  });
});

describe("CSV e PDF levam o filtro aplicado", () => {
  it("com a digitação pendente não se oferecem; aplicada, os dois levam o texto do campo", async () => {
    abrir();
    await responder(0, recorte(2));
    expect(new URL(linkDoCsv()!.getAttribute("href")!, "http://x.invalid").searchParams.has("search")).toBe(false);

    digitar(busca(), "abc");
    expect(linkDoCsv()).toBeNull();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();

    passar(PAUSA);
    // Aplicada e ainda carregando: o arquivo já é do recorte novo.
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    const csv = new URL(linkDoCsv()!.getAttribute("href")!, "http://x.invalid");
    expect(csv.searchParams.get("search")).toBe("abc");
    expect(csv.searchParams.get("page")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const pdf = new URL(screen.getByTestId("destino").textContent ?? "", "http://x.invalid");
    expect(pdf.pathname).toBe("/print/relatorios/R-15");
    expect(pdf.searchParams.get("search")).toBe("abc");
  });
});

describe("sair da tela", () => {
  it("digitação pendente não consulta depois de desmontar, e nenhum timer fica agendado", async () => {
    const { unmount } = abrir();
    await responder(0, recorte(2));

    digitar(busca(), "abc");
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    passar(10 * PAUSA);
    expect(pendentes).toHaveLength(1);
  });
});

interface Tela {
  codigo: string;
  Componente: ComponentType;
  consulta: unknown;
  /** Dia inicial do campo De. */
  de?: string;
  /** R-02 só mostra o período na janela personalizada. */
  abrirPeriodo?: () => void;
}

const TELAS: Tela[] = [
  { codigo: "R-01", Componente: InventoryPositionReportPage, consulta: relatorios.getInventoryPositionReport },
  {
    codigo: "R-02",
    Componente: ExpiryReportPage,
    consulta: relatorios.getExpiryReport,
    de: "2026-09-13",
    abrirPeriodo: () =>
      fireEvent.change(screen.getByRole("combobox", { name: "Janela de vencimento" }), {
        target: { value: "CUSTOM" },
      }),
  },
  { codigo: "R-03", Componente: MovementsReportPage, consulta: relatorios.getMovementsReport, de: "2026-08-15" },
  { codigo: "R-04", Componente: RequirementsReportPage, consulta: relatorios.getRequirementsReport },
  { codigo: "R-05", Componente: PlannedActualReportPage, consulta: relatorios.getPlannedActualReport, de: "2026-08-15" },
  { codigo: "R-07", Componente: ConsumptionReportPage, consulta: relatorios.getConsumptionReport, de: "2026-08-15" },
  { codigo: "R-08", Componente: PurchaseOrdersReportPage, consulta: relatorios.getPurchaseOrdersReport, de: "2026-06-16" },
  { codigo: "R-09", Componente: ReceiptsReportPage, consulta: relatorios.getReceiptsReport, de: "2026-08-15" },
  { codigo: "R-10", Componente: OnOrderReportPage, consulta: relatorios.getOnOrderReport },
  { codigo: "R-12", Componente: CustomerOrdersReportPage, consulta: relatorios.getCustomerOrdersReport, de: "2026-06-16" },
  { codigo: "R-13", Componente: FulfillmentReportPage, consulta: relatorios.getFulfillmentReport },
  { codigo: "R-15", Componente: BillingPeriodReportPage, consulta: relatorios.getBillingPeriodReport, de: "2026-08-15" },
  { codigo: "R-16", Componente: AwaitingBillingReportPage, consulta: relatorios.getAwaitingBillingReport },
  { codigo: "R-17", Componente: OrderDeliveredBilledReportPage, consulta: relatorios.getOrderDeliveredBilledReport },
  { codigo: "R-18", Componente: IndustrialCostByProductReportPage, consulta: relatorios.getIndustrialCostByProductReport },
  { codigo: "R-19", Componente: PricingByProductReportPage, consulta: relatorios.getPricingByProductReport },
  { codigo: "R-20", Componente: QuotePricingAuditReportPage, consulta: relatorios.getQuotePricingAuditReport },
];

function chamadas(consulta: unknown): Filtros[] {
  return vi.mocked(consulta as Consulta).mock.calls.map(([filtros]) => filtros);
}

/** Abre a tela com respostas imediatas e devolve quantas consultas a abertura fez. */
async function abrirTela({ Componente, consulta, abrirPeriodo }: Tela): Promise<number> {
  vi.mocked(consulta as Consulta).mockImplementation(async (filters) => ({
    rows: [],
    page: Number(filters["page"] ?? 1),
    pageSize: 25,
    total: 0,
    summary: { billingCount: 0, billingsWithCompletePricing: 0, totalAmount: null },
  }));
  abrir(Componente);
  abrirPeriodo?.();
  await act(async () => {});
  return chamadas(consulta).length;
}

describe("as dezessete telas com busca", () => {
  it.each(TELAS)("$codigo: a, ab, abc digitados rápido são uma consulta de abc, na página 1", async (tela) => {
    const abertura = await abrirTela(tela);
    for (const valor of ["a", "ab", "abc"]) {
      digitar(busca(), valor);
      passar(50);
    }
    passar(PAUSA - 51);
    expect(chamadas(tela.consulta)).toHaveLength(abertura);
    passar(1);
    const novas = chamadas(tela.consulta).slice(abertura);
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ search: "abc", page: 1 });
  });
});

describe("as oito telas com período", () => {
  it.each(TELAS.filter((tela) => tela.de))(
    "$codigo: De digitado é uma consulta; até digitado antes do De é nenhuma",
    async (tela) => {
      const abertura = await abrirTela(tela);
      const ate = campoAte().value;

      digitarEmSequencia(campoDe(), digitacaoDoChromium(tela.de!, "01", "09", "2026"));
      passar(PAUSA);
      const novas = chamadas(tela.consulta).slice(abertura);
      expect(novas).toHaveLength(1);
      expect(novas[0]).toMatchObject({ from: "2026-09-01", to: ate, page: 1 });

      digitarEmSequencia(campoAte(), digitacaoDoChromium(ate, "10", "05", "2026"));
      passar(10 * PAUSA);
      expect(screen.getByRole("alert")).toHaveTextContent(RECUSA);
      expect(chamadas(tela.consulta)).toHaveLength(abertura + 1);
    },
  );
});

describe("guarda estrutural", () => {
  it("todo campo de busca e de data dos Relatórios passa por `useFiltrosDigitados`", () => {
    const pasta = join(process.cwd(), "src", "pages", "reports");
    const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fontes = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith("Reports.tsx"))
      .map((arquivo) => semComentarios(readFileSync(join(pasta, arquivo), "utf8")));
    const contar = (padrao: RegExp) => fontes.reduce((soma, fonte) => soma + (fonte.match(padrao)?.length ?? 0), 0);

    // Tela nova com busca entra em TELAS acima e ganha os testes da pausa.
    expect(contar(/type="search"/g)).toBe(TELAS.length);
    expect(contar(/\{\.\.\.digitados\.campo\("search"\)\}/g)).toBe(TELAS.length);
    expect(contar(/type="date"/g)).toBe(TELAS.filter((tela) => tela.de).length * 2);
    expect(contar(/\{\.\.\.digitados\.campo\("(from|to)"\)\}/g)).toBe(TELAS.filter((tela) => tela.de).length * 2);
    expect(contar(/useFiltrosDigitados\(/g)).toBe(TELAS.length);
    expect(contar(/filtersPending=\{digitados\.pendente\}/g)).toBe(TELAS.length);
  });
});
