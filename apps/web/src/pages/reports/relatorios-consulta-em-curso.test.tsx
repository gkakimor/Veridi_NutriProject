import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BillingPeriodRowDTO } from "@veridi/shared";

/**
 * Relatórios — o resultado do filtro anterior não se passa pelo do filtro novo
 * (SMALL-UX-CLEANUP-WAVE-01).
 *
 * `useReport` guardava a resposta anterior até a nova chegar: trocar o
 * período, o cliente ou a busca deixava tabela, resumo e paginação do recorte
 * velho à vista, com um "Carregando…" em cima — e o que se lia era o total do
 * filtro de antes como se fosse o do filtro escolhido. Agora resposta de OUTRO
 * recorte some enquanto o novo carrega, e a tabela não diz "nenhum
 * faturamento" antes de saber. Trocar de página é o mesmo recorte: a página
 * aberta e o resumo ficam até a próxima chegar.
 *
 * Página 1 no filtro novo e uma consulta por gesto são de
 * REPORTS-PAGE-RESET-ON-PERIOD-01 (`relatorios-pagina-ao-filtrar.test.tsx`);
 * aqui só não podem voltar.
 *
 * Busca e datas digitadas só viram consulta quando a digitação para
 * (REPORTS-SEARCH-UX-01, `relatorios-busca-digitada.test.tsx`): antes da pausa
 * a tela ainda é a do filtro aplicado. O "durante" daqui começa quando o filtro
 * novo é aplicado.
 */

vi.mock("../../lib/reports-api", () => ({ getBillingPeriodReport: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));

import { getBillingPeriodReport } from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import { BillingPeriodReportPage } from "./BillingReports";
import { PAUSA_DA_DIGITACAO_MS } from "./useFiltrosDigitados";

type Filtros = Record<string, unknown>;
type Resposta = Awaited<ReturnType<typeof getBillingPeriodReport>>;

const VAZIO = "Nenhum faturamento para os filtros informados.";

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

/** A página pedida de um recorte com `total` faturamentos de R$ 100, numerados a partir de `primeiro`. */
function recorte(filters: Filtros, total: number, primeiro: number): Resposta {
  const page = Number(filters["page"] ?? 1);
  const quantos = Math.max(0, Math.min(25, total - (page - 1) * 25));
  return {
    rows: Array.from({ length: quantos }, (_, indice) => faturamento(primeiro + (page - 1) * 25 + indice)),
    page,
    pageSize: 25,
    total,
    summary: { billingCount: total, billingsWithCompletePricing: total, totalAmount: `${total * 100}.00` },
  };
}

/** Cada consulta fica pendente até o teste responder — é o "durante" que se prova. */
let pendentes: { filters: Filtros; responder: (r: Resposta) => void; recusar: (e: unknown) => void }[];

async function responder(indice: number, montar: (filters: Filtros) => Resposta) {
  const pendente = pendentes[indice]!;
  await act(async () => pendente.responder(montar(pendente.filters)));
}

/** Digita no campo e deixa a pausa da digitação passar: o filtro é aplicado. */
function aplicar(campo: HTMLElement, valor: string) {
  fireEvent.change(campo, { target: { value: valor } });
  act(() => {
    vi.advanceTimersByTime(PAUSA_DA_DIGITACAO_MS);
  });
}

async function abrir() {
  const tela = render(
    <MemoryRouter>
      <BillingPeriodReportPage />
    </MemoryRouter>,
  );
  expect(pendentes).toHaveLength(1);
  return {
    resumo: () => tela.container.querySelector<HTMLElement>(".report-summary"),
    tabela: () => tela.container.querySelector<HTMLElement>(".table-container"),
  };
}

const faturamentoNaTela = (n: number) =>
  screen.queryByRole("button", { name: `FAT-${String(n).padStart(6, "0")}` });
const paginacao = () => screen.queryByText(/^Página \d+ de \d+ ·/);

beforeEach(() => {
  vi.clearAllMocks();
  // Sem `waitFor`/`findBy` aqui: com o relógio falso, a pausa é medida.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  pendentes = [];
  vi.mocked(getBillingPeriodReport).mockImplementation(
    (filters) =>
      new Promise<Resposta>((responder, recusar) => {
        pendentes.push({ filters, responder, recusar });
      }),
  );
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("filtro novo: nada do recorte anterior até a resposta nova", () => {
  it("período: some tabela, resumo e paginação de A; B chega na página 1, numa consulta só", async () => {
    const { resumo, tabela } = await abrir();
    // Antes da primeira resposta a tabela não diz que não há faturamento.
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(VAZIO)).toBeNull();

    // A: 30 faturamentos, e a pessoa está na página 2.
    await responder(0, (filters) => recorte(filters, 30, 1));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await responder(1, (filters) => recorte(filters, 30, 1));
    expect(screen.getByText("Página 2 de 2 · 30 registros")).toBeInTheDocument();
    expect(faturamentoNaTela(26)).not.toBeNull();
    expect(within(resumo()!).getByText("R$ 3.000,00")).toBeInTheDocument();

    aplicar(screen.getByLabelText("De"), "2026-09-01");

    // Uma consulta, do recorte novo, já na página 1.
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.filters).toMatchObject({ from: "2026-09-01", page: 1 });

    // Durante: nenhuma linha, total ou página de A se passando por B.
    expect(faturamentoNaTela(26)).toBeNull();
    expect(resumo()).toBeNull();
    expect(paginacao()).toBeNull();
    expect(screen.queryByText("R$ 3.000,00")).toBeNull();
    expect(screen.queryByText(VAZIO)).toBeNull();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(tabela()).toHaveAttribute("aria-busy", "true");

    // B: 3 faturamentos.
    await responder(2, (filters) => recorte(filters, 3, 901));
    expect(faturamentoNaTela(901)).not.toBeNull();
    expect(screen.getByText("Página 1 de 1 · 3 registros")).toBeInTheDocument();
    expect(within(resumo()!).getByText("R$ 300,00")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(tabela()).not.toHaveAttribute("aria-busy");
    expect(pendentes).toHaveLength(3);
  });

  it("busca: resultado vazio só aparece como vazio depois da resposta", async () => {
    const { resumo } = await abrir();
    await responder(0, (filters) => recorte(filters, 2, 1));
    expect(faturamentoNaTela(1)).not.toBeNull();

    aplicar(screen.getByRole("searchbox"), "FAT-9");
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ search: "FAT-9", page: 1 });
    expect(faturamentoNaTela(1)).toBeNull();
    expect(resumo()).toBeNull();
    expect(screen.queryByText(VAZIO)).toBeNull();

    await responder(1, (filters) => recorte(filters, 0, 1));
    expect(screen.getByText(VAZIO)).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(pendentes).toHaveLength(2);
  });

  it("resposta atrasada de um recorte já trocado não aparece", async () => {
    await abrir();
    await responder(0, (filters) => recorte(filters, 2, 1));

    aplicar(screen.getByRole("searchbox"), "B");
    aplicar(screen.getByRole("searchbox"), "BC");
    expect(pendentes.map((pendente) => pendente.filters["search"])).toEqual(["", "B", "BC"]);

    await responder(1, (filters) => recorte(filters, 1, 501));
    expect(faturamentoNaTela(501)).toBeNull();
    expect(faturamentoNaTela(1)).toBeNull();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    await responder(2, (filters) => recorte(filters, 1, 701));
    expect(faturamentoNaTela(701)).not.toBeNull();
    expect(faturamentoNaTela(501)).toBeNull();
  });

  it("recusa do recorte novo: alerta, e as linhas do anterior não voltam", async () => {
    const { resumo } = await abrir();
    await responder(0, (filters) => recorte(filters, 2, 1));

    aplicar(screen.getByRole("searchbox"), "X");
    await act(async () => pendentes[1]!.recusar(new Error("Serviço indisponível.")));

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar o relatório: Serviço indisponível.");
    expect(faturamentoNaTela(1)).toBeNull();
    expect(resumo()).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();
    // Falha não é conclusão: nada de "nenhum faturamento" (REPORTS-SEARCH-UX-01).
    expect(screen.queryByText(VAZIO)).toBeNull();

    // A recusa era da busca "X": outra busca carrega sem o alerta dela.
    aplicar(screen.getByRole("searchbox"), "XY");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    await responder(2, (filters) => recorte(filters, 1, 301));
    expect(faturamentoNaTela(301)).not.toBeNull();
    expect(pendentes).toHaveLength(3);
  });
});

describe("mesma consulta, outra página: a página aberta fica até a próxima chegar", () => {
  it("Próxima mantém linhas, resumo e paginação durante a carga, e troca com a resposta", async () => {
    const { resumo, tabela } = await abrir();
    await responder(0, (filters) => recorte(filters, 30, 1));
    expect(screen.getByText("Página 1 de 2 · 30 registros")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filters).toMatchObject({ page: 2 });

    // Sem esvaziar a tabela a cada página: o recorte é o mesmo.
    expect(faturamentoNaTela(1)).not.toBeNull();
    expect(within(resumo()!).getByText("R$ 3.000,00")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 2 · 30 registros")).toBeInTheDocument();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(tabela()).toHaveAttribute("aria-busy", "true");

    await responder(1, (filters) => recorte(filters, 30, 1));
    expect(faturamentoNaTela(26)).not.toBeNull();
    expect(faturamentoNaTela(1)).toBeNull();
    expect(screen.getByText("Página 2 de 2 · 30 registros")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(pendentes).toHaveLength(2);
  });
});
