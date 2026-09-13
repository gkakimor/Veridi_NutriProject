import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type {
  ProductListResponse,
  ProductionOrderDTO,
  ProductionOrderListResponse,
  ProductionOrderSelectionDocument,
  ProductionOrderSelectionDocumentsResponse,
} from "@veridi/shared";

/**
 * Ordens de Produção — documentos da seleção em massa (BULK-DOCUMENTS-01).
 *
 * O mesmo par de ações de Pedidos, com os filtros da OP. O ponto próprio: o
 * filtro "sem roteiro" entrou depois da foundation e tem de viajar no
 * descritor com a mesma forma da consulta — senão o servidor resolveria outro
 * universo.
 */

vi.mock("../../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrderSelectionDocuments: vi.fn(),
  exportProductionOrderSelectionCsv: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "VIEWER" } }),
}));
vi.mock("../../pdf/render", () => ({ renderPdfBlob: vi.fn(), downloadPdf: vi.fn() }));
vi.mock("../../pdf/documents/SelectionPdf", () => ({
  CustomerOrdersSelectionPdf: () => null,
  ProductionOrdersSelectionPdf: () => null,
  selectionPdfFileName: (base: string) => `${base}-2026-09-12.pdf`,
}));
vi.mock("../../lib/download-file", () => ({ downloadFile: vi.fn() }));

import { downloadFile } from "../../lib/download-file";
import {
  exportProductionOrderSelectionCsv,
  getProductionOrderSelectionDocuments,
  listProductionOrders,
} from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { downloadPdf, renderPdfBlob } from "../../pdf/render";
import { ProductionOrdersPage } from "./ProductionOrdersPage";

const TOTAL = 45;

function ordem(n: number): ProductionOrderDTO {
  return {
    id: `op-${n}`,
    code: `OP-${String(n).padStart(6, "0")}`,
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey Isolado",
    customerOrderId: null,
    customerOrderCode: null,
    formulationVersionLabel: "v1",
    plannedQuantity: "100",
    outputUnitCode: "un",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    status: "DRAFT",
    createdAt: "2026-09-10T12:00:00.000Z",
    planning: { routePending: true },
  } as unknown as ProductionOrderDTO;
}

const cabecalho = () => screen.getByLabelText("Selecionar todos os registros desta página") as HTMLInputElement;
const caixa = (n: number) =>
  screen.getByLabelText(`Selecionar ordem de produção OP-${String(n).padStart(6, "0")}`) as HTMLInputElement;
const barra = () => screen.queryByRole("group", { name: "Seleção em massa" });
const contagem = () => barra()?.querySelector(".bulk-bar__count")?.textContent ?? null;
const botao = (nome: string) => within(barra()!).getByRole("button", { name: nome });
const PDF_BLOB = new Blob(["%PDF-1.3"], { type: "application/pdf" });

async function abrir(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ProductionOrdersPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(caixa(1)).not.toBeDisabled());
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "production-orders");
  vi.mocked(listProductionOrders).mockReset();
  vi.mocked(listProductionOrders).mockImplementation(async (params) => {
    const pagina = params?.page ?? 1;
    return {
      productionOrders: Array.from({ length: 20 }, (_, i) => ordem((pagina - 1) * 20 + i + 1)),
      page: pagina,
      pageSize: 20,
      total: TOTAL,
    } as ProductionOrderListResponse;
  });
  vi.mocked(listProducts).mockReset();
  vi.mocked(listProducts).mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 } as unknown as ProductListResponse);
  vi.mocked(getProductionOrderSelectionDocuments).mockReset();
  vi.mocked(exportProductionOrderSelectionCsv).mockReset();
  vi.mocked(renderPdfBlob).mockReset();
  vi.mocked(renderPdfBlob).mockResolvedValue(PDF_BLOB);
  vi.mocked(downloadPdf).mockReset();
  vi.mocked(downloadFile).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OPs — PDF e CSV da seleção", () => {
  it("todos os filtrados com SEM ROTEIRO: o descritor leva o filtro na forma da consulta, e o PDF é UM arquivo", async () => {
    const documentos: ProductionOrderSelectionDocument[] = [
      { order: ordem(2), cost: null },
      { order: ordem(1), cost: null },
    ];
    vi.mocked(getProductionOrderSelectionDocuments).mockResolvedValue({
      total: 2,
      documents: documentos,
    } as ProductionOrderSelectionDocumentsResponse);
    await abrir("/producao/ordens?semRoteiro=1&productId=prod-1&search=Whey");
    // A consulta da tela usa o booleano — o descritor tem de dizer o mesmo.
    expect(vi.mocked(listProductionOrders).mock.calls.at(-1)?.[0]).toMatchObject({ semRoteiro: true });

    fireEvent.click(cabecalho());
    fireEvent.click(screen.getByRole("button", { name: `Selecionar todos os ${TOTAL} resultados filtrados` }));
    await waitFor(() => expect(contagem()).toBe(`${TOTAL} selecionados`));
    fireEvent.click(caixa(7));

    fireEvent.click(botao("Baixar PDF"));
    expect(await within(barra()!).findByRole("status")).toHaveTextContent("PDF gerado.");

    expect(getProductionOrderSelectionDocuments).toHaveBeenCalledWith({
      mode: "filtered",
      filters: {
        productId: "prod-1",
        search: "Whey",
        semRoteiro: true,
        status: ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"],
      },
      excludedIds: ["op-7"],
    });
    const documento = vi.mocked(renderPdfBlob).mock.calls[0]![0] as ReactElement<{
      documents: ProductionOrderSelectionDocument[];
    }>;
    expect(documento.props.documents).toBe(documentos);
    expect(downloadPdf).toHaveBeenCalledWith(PDF_BLOB, "ordens-producao-selecionadas-2026-09-12.pdf");
    expect(contagem()).toBe(`${TOTAL - 1} selecionados`);
  });

  it("com roteiro também viaja — como `false`, não some do filtro", async () => {
    vi.mocked(exportProductionOrderSelectionCsv).mockResolvedValue({
      blob: new Blob(["﻿OP\r\n"]),
      fileName: "ordens-producao-selecionadas-2026-09-12.csv",
    });
    await abrir("/producao/ordens?semRoteiro=0&status=todos");
    fireEvent.click(cabecalho());
    fireEvent.click(screen.getByRole("button", { name: `Selecionar todos os ${TOTAL} resultados filtrados` }));

    fireEvent.click(botao("Exportar CSV"));
    expect(await within(barra()!).findByRole("status")).toHaveTextContent("CSV exportado.");
    expect(exportProductionOrderSelectionCsv).toHaveBeenCalledWith({
      mode: "filtered",
      filters: { semRoteiro: false },
      excludedIds: [],
    });
    expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), "ordens-producao-selecionadas-2026-09-12.csv");
  });

  it("IDS: CSV das ordens marcadas, e quem só lê a OP também gera", async () => {
    vi.mocked(exportProductionOrderSelectionCsv).mockResolvedValue({
      blob: new Blob(["﻿OP\r\n"]),
      fileName: "ordens-producao-selecionadas-2026-09-12.csv",
    });
    await abrir("/producao/ordens");
    fireEvent.click(caixa(4));
    fireEvent.click(caixa(9));

    fireEvent.click(botao("Exportar CSV"));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(exportProductionOrderSelectionCsv).toHaveBeenCalledWith({ mode: "ids", ids: ["op-4", "op-9"] });
    expect(contagem()).toBe("2 selecionados");
  });

  it("trocar o filtro de roteiro limpa a seleção antes de qualquer documento", async () => {
    await abrir("/producao/ordens?semRoteiro=1");
    fireEvent.click(caixa(1));
    expect(botao("Baixar PDF")).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Filtrar por roteiro de produção"), { target: { value: "0" } });
    await waitFor(() => expect(barra()).toBeNull());
    expect(getProductionOrderSelectionDocuments).not.toHaveBeenCalled();
  });
});
