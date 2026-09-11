import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { OrderOperationDTO, ProductionTraceabilityDTO } from "@veridi/shared";
import { AuthProvider, useAuth } from "../../app/AuthProvider";
import { API_URL } from "../../lib/api";
import {
  OrderOperationPrintPage,
  ProductionTraceabilityPrintPage,
} from "../../pages/print/DocumentReportPrints";
import { ReportPrintPage } from "../../pages/print/ReportPrintPage";

/**
 * Relatórios em PDF — o que o papel DIZ, da rota ao documento.
 *
 * A página carrega pela API com os filtros da URL, monta o documento e o
 * entrega ao gerador. Aqui o gerador só guarda o documento montado, e as
 * primitivas do renderer viram DOM: o teste lê nome, código, filtros
 * aplicados, total de registros e "—" no lugar do desconhecido. O arquivo
 * real (A4, paginação, rodapé) é de `report-documents.test.tsx`.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../testing/react-pdf-dom")) }));

const renderPdfBlob = vi.fn();
vi.mock("../render", () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlob(...args),
  downloadPdf: vi.fn(),
}));

const apiFetch = vi.fn();
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const getProductionTraceabilityReport = vi.fn();
const getOrderOperationReport = vi.fn();
vi.mock("../../lib/reports-api", () => ({
  getProductionTraceabilityReport: (...args: unknown[]) => getProductionTraceabilityReport(...args),
  getOrderOperationReport: (...args: unknown[]) => getOrderOperationReport(...args),
}));

vi.mock("../../lib/auth-api", () => ({
  fetchCurrentUser: () =>
    Promise.resolve({ id: "u-1", code: "USR-000001", name: "Ana Souza", email: "ana@veridi.test", role: "ADMIN" }),
  logout: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-11T12:30:00.000Z"));
  renderPdfBlob.mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  apiFetch.mockReset();
  getProductionTraceabilityReport.mockReset();
  getOrderOperationReport.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:veridi/relatorio");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Como no App: as rotas de impressão só abrem com a sessão resolvida. */
function Sessao({ children }: { children: ReactNode }) {
  return useAuth().loading ? null : <>{children}</>;
}

function abrir(url: string) {
  render(
    <AuthProvider>
      <Sessao>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/print/relatorios/R-06" element={<ProductionTraceabilityPrintPage />} />
            <Route path="/print/relatorios/R-14" element={<OrderOperationPrintPage />} />
            <Route path="/print/relatorios/:reportCode" element={<ReportPrintPage />} />
          </Routes>
        </MemoryRouter>
      </Sessao>
    </AuthProvider>,
  );
}

/** Resposta do endpoint de exportação: o CSV da API (BOM, `;`, CRLF). */
function respostaCsv(linhas: string[][]) {
  const texto = `﻿${linhas.map((linha) => linha.join(";")).join("\r\n")}\r\n`;
  return { ok: true, status: 200, text: () => Promise.resolve(texto) };
}

/** Espera o arquivo ficar pronto e devolve o documento montado, desenhado como DOM. */
async function documentoGerado(nomeDoArquivo: string): Promise<HTMLElement> {
  await screen.findByTitle(`Documento ${nomeDoArquivo}`);
  const [documento] = renderPdfBlob.mock.calls.at(-1) as [ReactElement];
  return render(documento).container;
}

/** Valor de um campo rotulado (filtro, total, dado do documento). */
function campo(documento: HTMLElement, rotulo: string): string | null {
  for (const field of documento.querySelectorAll('[data-pdf-role="field"]')) {
    const [label, value] = [...field.children];
    if (label?.textContent === rotulo) return value?.textContent ?? null;
  }
  return null;
}

/** Linhas da tabela, célula por célula. */
function linhas(documento: HTMLElement): string[][] {
  return [...documento.querySelectorAll('[data-pdf-role="row"]')].map((row) =>
    [...row.querySelectorAll('[data-pdf-role="cell"]')].map((cell) => cell.textContent ?? ""),
  );
}

const R01_CABECALHO = [
  "Item", "Descrição", "Tipo", "Lote interno", "Lote do fornecedor", "Lote Veridi", "Proprietário", "Fornecedor",
  "Validade", "Localização", "On Hand", "Reservado", "Disponível", "Unidade", "Qualidade", "CoA",
];

describe("relatórios R-01…R-20 em PDF", () => {
  it("R-01: nome, código, quem gerou, filtros aplicados, total de registros e desconhecido como —", async () => {
    apiFetch.mockResolvedValue(
      respostaCsv([
        R01_CABECALHO,
        ["MP-000001", "Maltodextrina", "Matéria-prima", "LT-20260903-000001", "", "", "Veridi", "", "10/10/2026",
          "A1", "12,5", "0", "12,5", "kg", "Disponível", "Aprovado"],
        ["MP-000002", "Creatina", "Matéria-prima", "LT-20260903-000002", "F-77", "", "Veridi", "Alpha", "",
          "", "3", "1", "2", "kg", "Bloqueado", ""],
      ]),
    );
    abrir("/print/relatorios/r-01?search=whey&status=AVAILABLE&page=3&all=true");

    const documento = await documentoGerado("R-01-2026-09-11.pdf");
    // Mesmo endpoint e mesmos filtros da tela — o resultado completo, não a página.
    expect(apiFetch).toHaveBeenCalledWith(
      `${API_URL}/reports/inventory/position/export.csv?search=whey&status=AVAILABLE&page=3&all=true`,
    );
    const texto = documento.textContent ?? "";
    expect(texto).toContain("Posição de Estoque");
    expect(texto).toContain("R-01");
    expect(texto).toContain("Gerado por Ana Souza");
    expect(campo(documento, "Busca")).toBe("whey");
    expect(campo(documento, "Status")).toBe("AVAILABLE");
    // Paginação da tela não é filtro do documento.
    expect(campo(documento, "page")).toBeNull();
    expect(campo(documento, "all")).toBeNull();
    expect(campo(documento, "Registros")).toBe("2");

    // Linha principal + detalhe: nada some, o desconhecido vira "—".
    const [principal, detalhe] = linhas(documento);
    expect(principal).toEqual([
      "MP-000001", "Maltodextrina", "LT-20260903-000001", "10/10/2026", "A1", "12,5", "0", "12,5", "kg", "Disponível",
    ]);
    expect(detalhe?.[0]).toContain("Lote do fornecedor: —");
    expect(detalhe?.[0]).toContain("Fornecedor: —");
    expect(detalhe?.[0]).toContain("CoA: Aprovado");
    expect(linhas(documento)[2]).toContain("—");
  });

  it("relatório sem linha de detalhe: célula vazia sai —, nunca zero nem branco", async () => {
    apiFetch.mockResolvedValue(
      respostaCsv([
        ["Data/Hora", "Tipo", "Item", "Descrição", "Lote", "Quantidade", "Unidade", "Documento", "Motivo", "Usuário"],
        ["08/09/2026, 22:14:03", "Ajuste de entrada", "MP-000001", "Maltodextrina", "", "5", "kg", "", "", "Ana"],
      ]),
    );
    abrir("/print/relatorios/R-03?from=2026-09-01");

    const documento = await documentoGerado("R-03-2026-09-11.pdf");
    expect(campo(documento, "De")).toBe("2026-09-01");
    expect(linhas(documento)).toEqual([
      ["08/09/2026, 22:14:03", "Ajuste de entrada", "MP-000001", "Maltodextrina", "—", "5", "kg", "—", "—", "Ana"],
    ]);
  });

  it("sem registros para o filtro: a folha diz isso e o total é 0", async () => {
    apiFetch.mockResolvedValue(respostaCsv([["OC", "Fornecedor", "Status"]]));
    abrir("/print/relatorios/R-08?status=CANCELLED");

    const documento = await documentoGerado("R-08-2026-09-11.pdf");
    expect(documento.textContent).toContain("Nenhum registro para os filtros aplicados.");
    expect(campo(documento, "Registros")).toBe("0");
  });

  it("relatório com custo e margem sai como documento interno", async () => {
    apiFetch.mockResolvedValue(respostaCsv([["Orçamento", "Total"], ["ORC-000001 · V1", "100,00"]]));
    abrir("/print/relatorios/R-20");

    const documento = await documentoGerado("R-20-2026-09-11.pdf");
    const texto = documento.textContent ?? "";
    expect(texto).toContain("Documento interno. Contém custo e margem — não é o orçamento entregue ao cliente.");
    expect(texto).toContain("Documento interno — contém custo e margem.");
  });

  it("relatório desconhecido não gera documento", async () => {
    abrir("/print/relatorios/R-99");

    expect(await screen.findByRole("alert")).toHaveTextContent("Relatório desconhecido: R-99");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });
});

const RASTREABILIDADE: ProductionTraceabilityDTO = {
  productionOrderId: "op-1",
  productionOrderCode: "OP-000010",
  productId: "prd-1",
  productCode: "PROD-000123",
  productName: "Whey Protein Isolado 900 g",
  status: "COMPLETED",
  plannedQuantity: "1000",
  producedQuantity: "985.5",
  unitCode: "un",
  completedAt: "2026-09-08T00:00:00.000Z",
  consumed: [
    {
      itemId: "item-1",
      itemCode: "MP-000001",
      itemName: "Maltodextrina",
      lotId: null,
      lotCode: null,
      supplierLot: null,
      supplierName: null,
      quantity: "12.5",
      unitCode: "kg",
    },
  ],
  produced: [],
};

describe("R-06 Rastreabilidade por OP em PDF", () => {
  it("diz de que OP é, o que foi consumido e marca o desconhecido com —", async () => {
    getProductionTraceabilityReport.mockResolvedValue(RASTREABILIDADE);
    abrir("/print/relatorios/R-06?productionOrderId=op-1");

    const documento = await documentoGerado("R-06-OP-000010-2026-09-11.pdf");
    expect(getProductionTraceabilityReport).toHaveBeenCalledWith({ productionOrderId: "op-1" });
    const texto = documento.textContent ?? "";
    expect(texto).toContain("Rastreabilidade por Ordem de Produção");
    expect(texto).toContain("R-06 · OP-000010");
    expect(texto).toContain("Gerado por Ana Souza");
    expect(campo(documento, "Ordem de produção")).toBe("OP-000010");
    expect(campo(documento, "Produto")).toBe("PROD-000123 — Whey Protein Isolado 900 g");
    expect(campo(documento, "Situação")).toBe("Concluída");
    expect(campo(documento, "Planejado × produzido")).toBe("1000 / 985,5 un");
    expect(campo(documento, "Concluída em")).toBe("08/09/2026");
    expect(linhas(documento)[0]).toEqual(["MP-000001 — Maltodextrina", "—", "—", "—", "12,5", "kg"]);
    expect(texto).toContain("Nenhuma produção apontada.");
  });

  it("sem OP escolhida não chama a API nem gera documento", async () => {
    abrir("/print/relatorios/R-06");

    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione a Ordem de Produção antes de imprimir.");
    expect(getProductionTraceabilityReport).not.toHaveBeenCalled();
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });
});

const OPERACAO: OrderOperationDTO = {
  customerOrderId: "ped-1",
  code: "PED-000045",
  customerId: "cli-1",
  customerName: "Nutri Distribuidora de Suplementos Ltda",
  status: "IN_FULFILLMENT",
  orderDate: "2026-09-01T00:00:00.000Z",
  requestedDeliveryDate: null,
  lines: [
    {
      customerOrderLineId: "linha-1",
      productId: "prd-1",
      productCode: "PROD-000123",
      productName: "Whey Protein Isolado 900 g",
      orderedQuantity: "500",
      unitCode: "un",
    },
  ],
  reservations: [],
  productionOrders: [],
  purchaseOrders: [],
  shipments: [
    {
      shipmentId: "exp-1",
      code: "EXP-000031",
      status: "CONFIRMED",
      confirmedAt: "2026-09-05T00:00:00.000Z",
      lines: [{ productCode: "PROD-000123", lotCode: null, quantity: "500", unitCode: "un" }],
    },
  ],
  billings: [
    {
      billingId: "fat-1",
      code: "FAT-000123",
      shipmentId: "exp-1",
      shipmentCode: "EXP-000031",
      status: "ISSUED",
      issuedAt: "2026-09-06T00:00:00.000Z",
      lineCount: 1,
      totalAmount: null,
    },
  ],
};

describe("R-14 Pedido → Operação em PDF", () => {
  it("diz de que pedido é, mostra a cadeia e nunca inventa valor", async () => {
    getOrderOperationReport.mockResolvedValue(OPERACAO);
    abrir("/print/relatorios/R-14?customerOrderId=ped-1");

    const documento = await documentoGerado("R-14-PED-000045-2026-09-11.pdf");
    expect(getOrderOperationReport).toHaveBeenCalledWith({ customerOrderId: "ped-1" });
    const texto = documento.textContent ?? "";
    expect(texto).toContain("R-14 · PED-000045");
    expect(texto).toContain("Gerado por Ana Souza");
    expect(campo(documento, "Cliente")).toBe("Nutri Distribuidora de Suplementos Ltda");
    expect(campo(documento, "Situação")).toBe("Em atendimento");
    expect(campo(documento, "Entrega solicitada")).toBe("—");
    expect(texto).toContain("Nenhuma ordem de produção vinculada.");
    expect(texto).toContain("Nenhuma ordem de compra vinculada.");
    const tabela = linhas(documento);
    expect(tabela).toContainEqual(["PROD-000123 — Whey Protein Isolado 900 g", "500", "un"]);
    expect(tabela).toContainEqual(["EXP-000031", "Confirmada", "05/09/2026", "1"]);
    // Faturamento sem precificação completa: valor desconhecido, nunca zero.
    expect(tabela).toContainEqual(["FAT-000123", "EXP-000031", "Emitido", "06/09/2026", "—"]);
  });

  it("sem pedido escolhido não chama a API nem gera documento", async () => {
    abrir("/print/relatorios/R-14");

    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o pedido antes de imprimir.");
    expect(getOrderOperationReport).not.toHaveBeenCalled();
  });
});
