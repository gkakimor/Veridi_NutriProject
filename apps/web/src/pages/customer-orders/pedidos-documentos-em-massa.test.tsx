import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type {
  CustomerListResponse,
  CustomerOrderDTO,
  CustomerOrderListResponse,
  CustomerOrderSelectionDocumentsResponse,
} from "@veridi/shared";

/**
 * Pedidos — documentos da seleção em massa (BULK-DOCUMENTS-01).
 *
 * A barra da seleção ganha "Baixar PDF" e "Exportar CSV". O que se prova: as
 * ações só existem com seleção, mandam o DESCRITOR (ids, ou filtro com as
 * exceções) e nunca buscam os 300 ids no navegador; o PDF é UM arquivo e o
 * CSV é o do servidor; cada clique roda uma vez; sucesso e erro respondem na
 * barra; e a seleção continua depois do download.
 */

vi.mock("../../lib/customer-orders-api", () => ({
  listCustomerOrders: vi.fn(),
  getCustomerOrderSelectionDocuments: vi.fn(),
  exportCustomerOrderSelectionCsv: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));
vi.mock("../../pdf/render", () => ({ renderPdfBlob: vi.fn(), downloadPdf: vi.fn() }));
vi.mock("../../pdf/documents/SelectionPdf", () => ({
  CustomerOrdersSelectionPdf: () => null,
  ProductionOrdersSelectionPdf: () => null,
  selectionPdfFileName: (base: string) => `${base}-2026-09-12.pdf`,
}));
vi.mock("../../lib/download-file", () => ({ downloadFile: vi.fn() }));

import {
  exportCustomerOrderSelectionCsv,
  getCustomerOrderSelectionDocuments,
  listCustomerOrders,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { downloadFile } from "../../lib/download-file";
import { clearStoredFilters } from "../../lib/stored-filters";
import { downloadPdf, renderPdfBlob } from "../../pdf/render";
import { CustomerOrdersPage } from "./CustomerOrdersPage";

const EM_ABERTO = ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"];
const TOTAL = 300;

function pedido(n: number): CustomerOrderDTO {
  return {
    id: `co-${n}`,
    code: `PED-${String(n).padStart(6, "0")}`,
    customerId: "cli-1",
    customerName: "NutriViva",
    orderDate: "2026-09-10T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "CONFIRMED",
    billingStatus: "NOT_BILLED",
    lines: [],
    reservation: null,
    generatedProductionOrders: [],
  } as unknown as CustomerOrderDTO;
}

function adiada<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

const cabecalho = () => screen.getByLabelText("Selecionar todos os registros desta página") as HTMLInputElement;
const caixa = (n: number) =>
  screen.getByLabelText(`Selecionar pedido PED-${String(n).padStart(6, "0")}`) as HTMLInputElement;
const barra = () => screen.queryByRole("group", { name: "Seleção em massa" });
const contagem = () => barra()?.querySelector(".bulk-bar__count")?.textContent ?? null;
const botao = (nome: string) => within(barra()!).getByRole("button", { name: nome });
const PDF_BLOB = new Blob(["%PDF-1.3"], { type: "application/pdf" });
const CSV_BLOB = new Blob(["﻿Pedido;Cliente\r\n"], { type: "text/csv" });

async function abrir(url = "/comercial/pedidos") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <CustomerOrdersPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(caixa(1)).not.toBeDisabled());
}

async function todosOsFiltrados() {
  fireEvent.click(cabecalho());
  fireEvent.click(screen.getByRole("button", { name: `Selecionar todos os ${TOTAL} resultados filtrados` }));
  await waitFor(() => expect(contagem()).toBe(`${TOTAL} selecionados`));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "customer-orders");
  vi.mocked(listCustomerOrders).mockReset();
  vi.mocked(listCustomerOrders).mockImplementation(
    async (params) =>
      ({
        customerOrders: Array.from({ length: 20 }, (_, i) => pedido(((params?.page ?? 1) - 1) * 20 + i + 1)),
        page: params?.page ?? 1,
        pageSize: 20,
        total: TOTAL,
      }) as unknown as CustomerOrderListResponse,
  );
  vi.mocked(listCustomers).mockReset();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as unknown as CustomerListResponse);
  vi.mocked(getCustomerOrderSelectionDocuments).mockReset();
  vi.mocked(getCustomerOrderSelectionDocuments).mockResolvedValue({
    total: 2,
    documents: [pedido(5), pedido(2)],
  } as CustomerOrderSelectionDocumentsResponse);
  vi.mocked(exportCustomerOrderSelectionCsv).mockReset();
  vi.mocked(exportCustomerOrderSelectionCsv).mockResolvedValue({
    blob: CSV_BLOB,
    fileName: "pedidos-selecionados-2026-09-12.csv",
  });
  vi.mocked(renderPdfBlob).mockReset();
  vi.mocked(renderPdfBlob).mockResolvedValue(PDF_BLOB);
  vi.mocked(downloadPdf).mockReset();
  vi.mocked(downloadFile).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ações documentais na barra da seleção", () => {
  it("só existem com seleção, e saem com ela", async () => {
    await abrir();
    expect(screen.queryByRole("button", { name: "Baixar PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Exportar CSV" })).toBeNull();

    fireEvent.click(caixa(2));
    expect(botao("Baixar PDF")).toBeEnabled();
    expect(botao("Exportar CSV")).toBeEnabled();
    // Documental: nenhuma das duas tem o peso de uma ação que grava.
    expect(botao("Baixar PDF").className).not.toContain("btn--accent");
    expect(botao("Exportar CSV").className).not.toContain("btn--accent");

    fireEvent.click(botao("Limpar seleção"));
    expect(screen.queryByRole("button", { name: "Baixar PDF" })).toBeNull();
  });

  it("IDS: o PDF sai de UM pedido ao servidor, UM arquivo, e a seleção fica", async () => {
    await abrir();
    fireEvent.click(caixa(2));
    fireEvent.click(caixa(5));

    fireEvent.click(botao("Baixar PDF"));
    expect(await within(barra()!).findByRole("status")).toHaveTextContent("PDF gerado.");

    expect(getCustomerOrderSelectionDocuments).toHaveBeenCalledTimes(1);
    expect(getCustomerOrderSelectionDocuments).toHaveBeenCalledWith({ mode: "ids", ids: ["co-2", "co-5"] });
    expect(renderPdfBlob).toHaveBeenCalledTimes(1);
    // O documento montado recebe os pedidos na ordem que o servidor devolveu.
    const documento = vi.mocked(renderPdfBlob).mock.calls[0]![0] as ReactElement<{ orders: CustomerOrderDTO[] }>;
    expect(documento.props.orders.map((p) => p.code)).toEqual(["PED-000005", "PED-000002"]);
    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(downloadPdf).toHaveBeenCalledWith(PDF_BLOB, "pedidos-selecionados-2026-09-12.pdf");

    expect(contagem()).toBe("2 selecionados");
    expect(caixa(2).checked).toBe(true);
  });

  it("TODOS OS FILTRADOS menos exceções: o CSV leva filtro e excludedIds, nunca os 300 ids", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.click(caixa(3));
    fireEvent.click(caixa(4));
    expect(contagem()).toBe("298 selecionados");
    const consultasAntes = vi.mocked(listCustomerOrders).mock.calls.length;

    fireEvent.click(botao("Exportar CSV"));
    expect(await within(barra()!).findByRole("status")).toHaveTextContent("CSV exportado.");

    expect(exportCustomerOrderSelectionCsv).toHaveBeenCalledTimes(1);
    expect(exportCustomerOrderSelectionCsv).toHaveBeenCalledWith({
      mode: "filtered",
      filters: { status: EM_ABERTO },
      excludedIds: ["co-3", "co-4"],
    });
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledWith(CSV_BLOB, "pedidos-selecionados-2026-09-12.csv");
    // Nenhuma consulta nova para juntar ids: a tela continua pedindo só a página.
    expect(vi.mocked(listCustomerOrders).mock.calls).toHaveLength(consultasAntes);
    expect(contagem()).toBe("298 selecionados");
  });

  it("gerando: o botão diz o que faz, trava, e o clique duplo roda UMA vez", async () => {
    const pdf = adiada<CustomerOrderSelectionDocumentsResponse>();
    vi.mocked(getCustomerOrderSelectionDocuments).mockReturnValue(pdf.promessa);
    const csv = adiada<{ blob: Blob; fileName: string }>();
    vi.mocked(exportCustomerOrderSelectionCsv).mockReturnValue(csv.promessa);
    await abrir();
    fireEvent.click(caixa(1));

    const baixar = botao("Baixar PDF");
    fireEvent.click(baixar);
    fireEvent.click(baixar);
    expect(baixar).toHaveTextContent("Gerando PDF…");
    expect(baixar).toBeDisabled();

    const exportar = botao("Exportar CSV");
    fireEvent.click(exportar);
    fireEvent.click(exportar);
    expect(exportar).toHaveTextContent("Gerando CSV…");
    expect(exportar).toBeDisabled();

    expect(getCustomerOrderSelectionDocuments).toHaveBeenCalledTimes(1);
    expect(exportCustomerOrderSelectionCsv).toHaveBeenCalledTimes(1);

    await act(async () => {
      pdf.resolver({ total: 1, documents: [pedido(1)] } as CustomerOrderSelectionDocumentsResponse);
      csv.resolver({ blob: CSV_BLOB, fileName: "pedidos-selecionados-2026-09-12.csv" });
    });
    await waitFor(() => expect(botao("Baixar PDF")).toBeEnabled());
    expect(botao("Exportar CSV")).toBeEnabled();
    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it("recusa do servidor vira alerta na barra, sem download e sem perder a seleção", async () => {
    vi.mocked(getCustomerOrderSelectionDocuments).mockRejectedValue(
      new Error("A seleção contém mais de 500 documentos. Refine os filtros e tente novamente."),
    );
    await abrir();
    await todosOsFiltrados();

    fireEvent.click(botao("Baixar PDF"));
    expect(await within(barra()!).findByRole("alert")).toHaveTextContent(
      "A seleção contém mais de 500 documentos. Refine os filtros e tente novamente.",
    );
    expect(renderPdfBlob).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(within(barra()!).queryByRole("status")).toBeNull();
    expect(contagem()).toBe("300 selecionados");
    expect(botao("Baixar PDF")).toBeEnabled();
  });

  it("mudar a seleção tira o recado da geração anterior", async () => {
    await abrir();
    fireEvent.click(caixa(1));
    fireEvent.click(botao("Baixar PDF"));
    expect(await within(barra()!).findByRole("status")).toHaveTextContent("PDF gerado.");

    fireEvent.click(caixa(2));
    await waitFor(() => expect(within(barra()!).queryByRole("status")).toBeNull());
  });

  it("filtro novo limpa a seleção: não há como gerar o documento do conjunto antigo", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CONFIRMED" } });
    await waitFor(() => expect(barra()).toBeNull());
    expect(screen.queryByRole("button", { name: "Baixar PDF" })).toBeNull();
    expect(getCustomerOrderSelectionDocuments).not.toHaveBeenCalled();
  });
});
