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
import {
  REPORT_PRINT_DEFINITIONS,
  ReportPrintPage,
  reportAppliedFilters,
} from "../../pages/print/ReportPrintPage";

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

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../lib/auth-api", () => ({
  fetchCurrentUser: () =>
    Promise.resolve({ id: "u-1", code: "USR-000001", name: "Ana Souza", email: "ana@veridi.test", role: sessao.role }),
  logout: vi.fn(),
}));

beforeEach(() => {
  sessao.role = "ADMIN";
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

/** Cliente como `GET /customers` o devolve — o que o seletor de Cliente lê. */
const CLIENTE_A = {
  id: "7d3f0c2e-5b1a-4c8e-9f00-1a2b3c4d5e6f",
  code: "CLI-000012",
  legalName: "Nutri Alfa Suplementos Ltda",
  tradeName: "Nutri Alfa",
  cnpj: "12345678000190",
};

/**
 * `apiFetch` por destino: o CSV do relatório e a consulta do cliente por id.
 * `falha` simula a consulta do cliente recusada pelo servidor.
 */
function responderPorUrl(
  csv: ReturnType<typeof respostaCsv>,
  cliente: { clientes: (typeof CLIENTE_A)[] } | { falha: true },
) {
  apiFetch.mockImplementation(async (url: string) => {
    if (!url.startsWith(`${API_URL}/customers?`)) return csv;
    if ("falha" in cliente) {
      return { ok: false, status: 500, json: () => Promise.resolve({ error: "internal_error" }) };
    }
    const corpo = { customers: cliente.clientes, total: cliente.clientes.length, page: 1, pageSize: 1 };
    return { ok: true, status: 200, json: () => Promise.resolve(corpo) };
  });
}

/** Fornecedor como `GET /suppliers` o devolve — o que o seletor de Fornecedor lê. */
const FORNECEDOR_A = {
  id: "3b9e1c7a-2f4d-4e8b-a1c0-9d8e7f6a5b4c",
  code: "FOR-000003",
  legalName: "Insumos Sul Comércio de Matérias-Primas Ltda",
  tradeName: "Insumos Sul",
};

const FORNECEDOR_SEM_FANTASIA = {
  id: "c0ffee00-1234-4abc-8def-0123456789ab",
  code: "FOR-000004",
  legalName: "Laticínios Serra Azul Ltda",
  tradeName: null,
};

/**
 * `apiFetch` por destino: o CSV do relatório e a consulta do fornecedor por
 * id. `falha` simula a consulta do fornecedor recusada pelo servidor.
 */
function responderComFornecedor(
  csv: ReturnType<typeof respostaCsv>,
  fornecedor: { fornecedores: { id: string; code: string; legalName: string; tradeName: string | null }[] } | { falha: true },
) {
  apiFetch.mockImplementation(async (url: string) => {
    if (!url.startsWith(`${API_URL}/suppliers?`)) return csv;
    if ("falha" in fornecedor) {
      return { ok: false, status: 500, json: () => Promise.resolve({ error: "internal_error" }) };
    }
    const corpo = { suppliers: fornecedor.fornecedores, total: fornecedor.fornecedores.length, page: 1, pageSize: 1 };
    return { ok: true, status: 200, json: () => Promise.resolve(corpo) };
  });
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
    // O rótulo do seletor da tela, nunca o valor da API (REPORTS-PRESENTATION-WAVE-01).
    expect(campo(documento, "Status")).toBe("Disponível");
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

  it("R-15: o período do papel é o dia da tela, repassado ao CSV sem conversão", async () => {
    apiFetch.mockResolvedValue(respostaCsv([["Faturamento", "Data"], ["FAT-000001", "12/09/2026"]]));
    // O que o botão PDF da tela manda desde REPORTS-BUSINESS-DATE-01.
    abrir("/print/relatorios/R-15?from=2026-09-12&to=2026-09-12");

    const documento = await documentoGerado("R-15-2026-09-11.pdf");
    // Mesmo endpoint, mesmo dia: o PDF é o CSV, e o CSV é o mesmo recorte da tela.
    expect(apiFetch).toHaveBeenCalledWith(
      `${API_URL}/reports/billing/period/export.csv?from=2026-09-12&to=2026-09-12`,
    );
    expect(campo(documento, "De")).toBe("2026-09-12");
    expect(campo(documento, "Até")).toBe("2026-09-12");
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

  it("R-20: cliente, status e período chegam JUNTOS ao CSV que vira o papel", async () => {
    responderPorUrl(respostaCsv([["Orçamento", "Status"], ["ORC-000001 · V1", "Enviado"]]), {
      clientes: [CLIENTE_A],
    });
    // R20-QUOTE-FILTER-COMPOSITION-01: o servidor compõe os três em AND; o
    // papel não pode perder nenhum no caminho até ele.
    abrir(`/print/relatorios/R-20?customerId=${CLIENTE_A.id}&status=SENT&from=2026-09-01&to=2026-09-30`);

    const documento = await documentoGerado("R-20-2026-09-11.pdf");
    expect(apiFetch).toHaveBeenCalledWith(
      `${API_URL}/reports/commercial/quote-pricing/export.csv?customerId=${CLIENTE_A.id}&status=SENT&from=2026-09-01&to=2026-09-30`,
    );
    // O cliente sai como o seletor da tela o escreve (R20-UX-CLEANUP-WAVE-01).
    expect(campo(documento, "Cliente")).toBe("CLI-000012 · Nutri Alfa Suplementos Ltda");
    expect(campo(documento, "Status")).toBe("Enviado");
    expect(campo(documento, "De")).toBe("2026-09-01");
    expect(campo(documento, "Até")).toBe("2026-09-30");
  });

  describe("R-20: o cliente do filtro no papel é nome, nunca id técnico (R20-UX-CLEANUP-WAVE-01)", () => {
    const CSV_R20 = [
      ["Orçamento", "Cliente", "Produto", "Total"],
      ["ORC-000001 · V1", "Nutri Alfa Suplementos Ltda", "PROD-000001", "100,00"],
    ];

    it("cliente resolvido: código e razão social, uma consulta por id, e o UUID fora do documento", async () => {
      responderPorUrl(respostaCsv(CSV_R20), { clientes: [CLIENTE_A] });
      abrir(`/print/relatorios/R-20?customerId=${CLIENTE_A.id}`);

      const documento = await documentoGerado("R-20-2026-09-11.pdf");
      expect(campo(documento, "Cliente")).toBe("CLI-000012 · Nutri Alfa Suplementos Ltda");
      expect(documento.textContent).not.toContain(CLIENTE_A.id);
      // A consulta do seletor de Cliente, por identidade — inclusive inativo.
      const consultas = apiFetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/customers?"));
      expect(consultas).toHaveLength(1);
      expect(new URL(consultas[0]!).searchParams.get("ids")).toBe(CLIENTE_A.id);
      expect(new URL(consultas[0]!).searchParams.has("active")).toBe(false);
      expect(linhas(documento)).toHaveLength(1);
    });

    it("id legado sem cadastro: Cliente sai —, sem o id, e o documento é gerado", async () => {
      const LEGADO = "cli-legado-0001";
      responderPorUrl(respostaCsv(CSV_R20), { clientes: [] });
      abrir(`/print/relatorios/R-20?customerId=${LEGADO}&status=SENT`);

      const documento = await documentoGerado("R-20-2026-09-11.pdf");
      expect(campo(documento, "Cliente")).toBe("—");
      expect(documento.textContent).not.toContain(LEGADO);
      expect(campo(documento, "Status")).toBe("Enviado");
      expect(campo(documento, "Registros")).toBe("1");
    });

    it("consulta do cliente falha: Cliente sai —, e o documento é gerado mesmo assim", async () => {
      responderPorUrl(respostaCsv(CSV_R20), { falha: true });
      abrir(`/print/relatorios/R-20?customerId=${CLIENTE_A.id}`);

      const documento = await documentoGerado("R-20-2026-09-11.pdf");
      expect(campo(documento, "Cliente")).toBe("—");
      expect(documento.textContent).not.toContain(CLIENTE_A.id);
      expect(linhas(documento)).toHaveLength(1);
    });

    it("sem cliente no filtro: nenhuma consulta de cliente e nenhum campo Cliente", async () => {
      responderPorUrl(respostaCsv(CSV_R20), { clientes: [CLIENTE_A] });
      abrir("/print/relatorios/R-20?status=SENT");

      const documento = await documentoGerado("R-20-2026-09-11.pdf");
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch).toHaveBeenCalledWith(`${API_URL}/reports/commercial/quote-pricing/export.csv?status=SENT`);
      expect(campo(documento, "Cliente")).toBeNull();
    });

    it("perfil sem autorização com cliente no filtro: nem CSV, nem consulta do cliente", async () => {
      sessao.role = "PRODUCTION";
      responderPorUrl(respostaCsv(CSV_R20), { clientes: [CLIENTE_A] });
      abrir(`/print/relatorios/R-20?customerId=${CLIENTE_A.id}`);

      expect(await screen.findByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(apiFetch).not.toHaveBeenCalled();
      expect(renderPdfBlob).not.toHaveBeenCalled();
    });
  });

  describe("R-08…R-11: o fornecedor do filtro no papel é código e nome, nunca id técnico (REPORTS-PRESENTATION-WAVE-01)", () => {
    const CSV_COMPRAS = [
      ["OC", "Fornecedor", "Item"],
      ["OC-000031", "Insumos Sul", "MP-000001"],
    ];

    /** URLs das consultas de fornecedor que a página fez. */
    function consultasDeFornecedor(): string[] {
      return apiFetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/suppliers?"));
    }

    it.each(["R-08", "R-09", "R-10", "R-11"])(
      "%s: código e nome do fornecedor, uma consulta por id, e o UUID fora do documento",
      async (codigo) => {
        responderComFornecedor(respostaCsv(CSV_COMPRAS), { fornecedores: [FORNECEDOR_A] });
        abrir(`/print/relatorios/${codigo}?supplierId=${FORNECEDOR_A.id}`);

        const documento = await documentoGerado(`${codigo}-2026-09-11.pdf`);
        expect(campo(documento, "Fornecedor")).toBe("FOR-000003 · Insumos Sul");
        expect(documento.textContent).not.toContain(FORNECEDOR_A.id);
        // O CSV recebe o id como sempre: o recorte é o mesmo, só o papel muda.
        const csv = String(apiFetch.mock.calls[0]?.[0]);
        expect(new URL(csv).searchParams.get("supplierId")).toBe(FORNECEDOR_A.id);
        // A consulta do seletor de Fornecedor, por identidade — inclusive inativo.
        const consultas = consultasDeFornecedor();
        expect(consultas).toHaveLength(1);
        expect(new URL(consultas[0]!).searchParams.get("ids")).toBe(FORNECEDOR_A.id);
        expect(new URL(consultas[0]!).searchParams.has("active")).toBe(false);
        expect(linhas(documento)).toHaveLength(1);
      },
    );

    it("fornecedor sem nome fantasia: código e razão social, como o seletor escreve", async () => {
      responderComFornecedor(respostaCsv(CSV_COMPRAS), { fornecedores: [FORNECEDOR_SEM_FANTASIA] });
      abrir(`/print/relatorios/R-09?supplierId=${FORNECEDOR_SEM_FANTASIA.id}&from=2026-09-01`);

      const documento = await documentoGerado("R-09-2026-09-11.pdf");
      expect(campo(documento, "Fornecedor")).toBe("FOR-000004 · Laticínios Serra Azul Ltda");
      expect(documento.textContent).not.toContain(FORNECEDOR_SEM_FANTASIA.id);
      expect(campo(documento, "De")).toBe("2026-09-01");
    });

    it("id inexistente ou legado: Fornecedor sai —, sem o id, e o documento é gerado", async () => {
      const LEGADO = "for-legado-0001";
      responderComFornecedor(respostaCsv(CSV_COMPRAS), { fornecedores: [] });
      abrir(`/print/relatorios/R-11?supplierId=${LEGADO}`);

      const documento = await documentoGerado("R-11-2026-09-11.pdf");
      expect(campo(documento, "Fornecedor")).toBe("—");
      expect(documento.textContent).not.toContain(LEGADO);
      expect(campo(documento, "Registros")).toBe("1");
    });

    it("consulta do fornecedor falha: Fornecedor sai —, e o documento é gerado mesmo assim", async () => {
      responderComFornecedor(respostaCsv(CSV_COMPRAS), { falha: true });
      abrir(`/print/relatorios/R-10?supplierId=${FORNECEDOR_A.id}`);

      const documento = await documentoGerado("R-10-2026-09-11.pdf");
      expect(campo(documento, "Fornecedor")).toBe("—");
      expect(documento.textContent).not.toContain(FORNECEDOR_A.id);
      expect(linhas(documento)).toHaveLength(1);
    });

    it("sem fornecedor no filtro: nenhuma consulta extra e nenhum campo Fornecedor", async () => {
      responderComFornecedor(respostaCsv(CSV_COMPRAS), { fornecedores: [FORNECEDOR_A] });
      abrir("/print/relatorios/R-08?search=OC-000031");

      const documento = await documentoGerado("R-08-2026-09-11.pdf");
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch).toHaveBeenCalledWith(`${API_URL}/reports/purchasing/orders/export.csv?search=OC-000031`);
      expect(campo(documento, "Fornecedor")).toBeNull();
    });

    it("CSV recusado pelo servidor: nem consulta o fornecedor, nem gera documento", async () => {
      responderComFornecedor(
        { ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) } as never,
        { fornecedores: [FORNECEDOR_A] },
      );
      abrir(`/print/relatorios/R-08?supplierId=${FORNECEDOR_A.id}`);

      expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar o relatório (403)");
      expect(consultasDeFornecedor()).toHaveLength(0);
      expect(renderPdfBlob).not.toHaveBeenCalled();
    });

    it("R-08 com cliente na URL: o schema não aceita cliente — nem consulta, nem Cliente no papel (REPORTS-PRINT-UNACCEPTED-FILTER-01)", async () => {
      apiFetch.mockImplementation(async (url: string) => {
        if (url.startsWith(`${API_URL}/suppliers?`)) {
          return { ok: true, status: 200, json: () => Promise.resolve({ suppliers: [FORNECEDOR_A], total: 1, page: 1, pageSize: 1 }) };
        }
        if (url.startsWith(`${API_URL}/customers?`)) {
          return { ok: true, status: 200, json: () => Promise.resolve({ customers: [CLIENTE_A], total: 1, page: 1, pageSize: 1 }) };
        }
        return respostaCsv(CSV_COMPRAS);
      });
      // Nenhuma tela manda os dois; a URL digitada pode — e a API descarta o cliente.
      abrir(`/print/relatorios/R-08?supplierId=${FORNECEDOR_A.id}&customerId=${CLIENTE_A.id}&foo=bar`);

      const documento = await documentoGerado("R-08-2026-09-11.pdf");
      expect(campo(documento, "Fornecedor")).toBe("FOR-000003 · Insumos Sul");
      expect(campo(documento, "Cliente")).toBeNull();
      expect(campo(documento, "foo")).toBeNull();
      const texto = documento.textContent ?? "";
      for (const vestigio of ["Nutri Alfa", "CLI-000012", CLIENTE_A.id]) expect(texto, vestigio).not.toContain(vestigio);
      const consultas = apiFetch.mock.calls.map(([url]) => String(url)).filter((url) => !url.includes("/export.csv"));
      expect(consultas).toHaveLength(1);
      expect(consultas[0]).toContain(`${API_URL}/suppliers?`);
      // O CSV continua recebendo a URL como veio: quem descarta é o servidor.
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(`customerId=${CLIENTE_A.id}`));
    });
  });

  describe("filtro por id que só a URL manda: código e nome, nunca o id técnico (REPORTS-PRESENTATION-WAVE-02)", () => {
    const UUID = {
      item: "0b6f8a52-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
      produto: "1c7a9b63-2d4e-4f60-9b0c-1d2e3f4a5b6c",
      pedido: "2d8bac74-3e5f-4071-8c1d-2e3f4a5b6c7d",
      ordemDeProducao: "3e9cbd85-4f60-4182-9d2e-3f4a5b6c7d8e",
      ordemDeCompra: "4fadce96-5071-4293-8e3f-4a5b6c7d8e9f",
      lote: "5abedfa7-6182-43a4-9f4a-5b6c7d8e9fa0",
    };

    const CSV_UMA_LINHA = [["Documento", "Descrição"], ["DOC-000001", "Registro do recorte"]];

    const ok = (corpo: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
    const lista = (chave: string, entidades: unknown[]) =>
      ok({ [chave]: entidades, total: entidades.length, page: 1, pageSize: 1 });

    /**
     * `apiFetch` por destino, como a API responde: o CSV do relatório e a
     * consulta por id de cada seletor — lista por `ids`/`productId` ou o
     * documento pelo caminho. `acha: false` é o id sem cadastro; `falha`, a
     * consulta recusada.
     */
    function responderComEntidades(modo: { acha: boolean } | { falha: true }) {
      apiFetch.mockImplementation(async (url: string) => {
        const caminho = url.slice(API_URL.length);
        if (caminho.includes("/export.csv")) return respostaCsv(CSV_UMA_LINHA);
        if ("falha" in modo) return { ok: false, status: 500, json: () => Promise.resolve({ error: "internal_error" }) };
        const naoAchou = { ok: false, status: 404, json: () => Promise.resolve({ error: "not_found" }) };
        const { acha } = modo;
        if (caminho.startsWith("/items?")) {
          return lista("items", acha ? [{ id: UUID.item, code: "MP-000007", name: "Maltodextrina", unitCode: "kg" }] : []);
        }
        if (caminho.startsWith("/products?")) {
          return lista(
            "products",
            acha ? [{ id: UUID.produto, code: "PROD-000123", name: "Whey Protein Isolado 900 g", customer: null }] : [],
          );
        }
        if (caminho.startsWith("/customers?")) return lista("customers", acha ? [CLIENTE_A] : []);
        if (caminho.startsWith("/customer-orders/")) {
          return acha
            ? ok({ id: UUID.pedido, code: "PED-000045", customerName: "Nutri Distribuidora de Suplementos Ltda" })
            : naoAchou;
        }
        if (caminho.startsWith("/production-orders/")) {
          return acha
            ? ok({ id: UUID.ordemDeProducao, code: "OP-000010", productName: "Whey Protein Isolado 900 g" })
            : naoAchou;
        }
        if (caminho.startsWith("/purchase-orders/")) {
          return acha
            ? ok({ id: UUID.ordemDeCompra, code: "OC-000031", supplierName: "Insumos Sul", status: "RECEIVED" })
            : naoAchou;
        }
        return { ok: false, status: 599, json: () => Promise.resolve({ error: `consulta inesperada ${caminho}` }) };
      });
    }

    /** Toda requisição que não é o CSV do relatório. */
    function consultas(): string[] {
      return apiFetch.mock.calls.map(([url]) => String(url)).filter((url) => !url.includes("/export.csv"));
    }

    const CASOS: [string, string, string, string, string, string][] = [
      // relatório, chave da URL, id, rótulo no papel, nome resolvido, consulta
      ["R-09", "itemId", UUID.item, "Item", "MP-000007 · Maltodextrina", `/items?ids=${UUID.item}`],
      ["R-05", "productId", UUID.produto, "Produto", "PROD-000123 · Whey Protein Isolado 900 g", `/products?productId=${UUID.produto}`],
      [
        "R-13",
        "customerOrderId",
        UUID.pedido,
        "Pedido",
        "PED-000045 · Nutri Distribuidora de Suplementos Ltda",
        `/customer-orders/${UUID.pedido}`,
      ],
      [
        "R-07",
        "productionOrderId",
        UUID.ordemDeProducao,
        "Ordem de produção",
        "OP-000010 · Whey Protein Isolado 900 g",
        `/production-orders/${UUID.ordemDeProducao}`,
      ],
      ["R-09", "purchaseOrderId", UUID.ordemDeCompra, "Ordem de compra", "OC-000031 · Insumos Sul", `/purchase-orders/${UUID.ordemDeCompra}`],
      [
        "R-01",
        "ownerCustomerId",
        CLIENTE_A.id,
        "Cliente proprietário",
        "CLI-000012 · Nutri Alfa Suplementos Ltda",
        `/customers?ids=${CLIENTE_A.id}`,
      ],
    ];

    it.each(CASOS)("%s?%s: nome do seletor, uma consulta pelo id, e o id fora do documento", async (codigo, chave, id, rotulo, nome, consulta) => {
      responderComEntidades({ acha: true });
      abrir(`/print/relatorios/${codigo}?${chave}=${id}`);

      const documento = await documentoGerado(`${codigo}-2026-09-11.pdf`);
      expect(campo(documento, rotulo)).toBe(nome);
      expect(documento.textContent).not.toContain(id);
      // O CSV recebe o id como sempre: o recorte é o mesmo, só o papel muda.
      expect(new URL(String(apiFetch.mock.calls[0]?.[0])).searchParams.get(chave)).toBe(id);
      expect(consultas()).toHaveLength(1);
      expect(consultas()[0]).toContain(`${API_URL}${consulta}`);
      expect(campo(documento, "Registros")).toBe("1");
    });

    it.each(CASOS)("%s?%s inexistente: o campo sai —, sem o id, e o documento é gerado", async (codigo, chave, id, rotulo) => {
      responderComEntidades({ acha: false });
      abrir(`/print/relatorios/${codigo}?${chave}=${id}`);

      const documento = await documentoGerado(`${codigo}-2026-09-11.pdf`);
      expect(campo(documento, rotulo)).toBe("—");
      expect(documento.textContent).not.toContain(id);
      expect(campo(documento, "Registros")).toBe("1");
    });

    it("consultas que falham: cada filtro sai —, sem id, e o documento é gerado mesmo assim", async () => {
      responderComEntidades({ falha: true });
      abrir(`/print/relatorios/R-13?customerOrderId=${UUID.pedido}&productId=${UUID.produto}&customerId=${CLIENTE_A.id}`);

      const documento = await documentoGerado("R-13-2026-09-11.pdf");
      expect(campo(documento, "Pedido")).toBe("—");
      expect(campo(documento, "Produto")).toBe("—");
      expect(campo(documento, "Cliente")).toBe("—");
      for (const id of [UUID.pedido, UUID.produto, CLIENTE_A.id]) expect(documento.textContent).not.toContain(id);
      expect(campo(documento, "Registros")).toBe("1");
    });

    it("R-03 com lote: sem seletor de lote na aplicação, não se inventa consulta — Lote sai —", async () => {
      responderComEntidades({ acha: true });
      abrir(`/print/relatorios/R-03?lotId=${UUID.lote}&itemId=${UUID.item}`);

      const documento = await documentoGerado("R-03-2026-09-11.pdf");
      expect(campo(documento, "Lote")).toBe("—");
      expect(campo(documento, "Item")).toBe("MP-000007 · Maltodextrina");
      expect(documento.textContent).not.toContain(UUID.lote);
      expect(documento.textContent).not.toContain(UUID.item);
      // Só a consulta do item: nenhuma pelo lote.
      expect(consultas()).toEqual([`${API_URL}/items?ids=${UUID.item}&page=1&pageSize=1`]);
    });

    it("vários ids juntos e 40 linhas: uma consulta por filtro, nunca uma por linha", async () => {
      responderComEntidades({ acha: true });
      apiFetch.mockImplementationOnce(async () =>
        respostaCsv([CSV_UMA_LINHA[0]!, ...Array.from({ length: 40 }, (_, i) => [`DOC-${i}`, "Registro"])]),
      );
      abrir(`/print/relatorios/R-07?itemId=${UUID.item}&productId=${UUID.produto}&productionOrderId=${UUID.ordemDeProducao}`);

      const documento = await documentoGerado("R-07-2026-09-11.pdf");
      expect(campo(documento, "Registros")).toBe("40");
      expect(consultas()).toHaveLength(3);
      expect(campo(documento, "Item")).toBe("MP-000007 · Maltodextrina");
      expect(campo(documento, "Produto")).toBe("PROD-000123 · Whey Protein Isolado 900 g");
      expect(campo(documento, "Ordem de produção")).toBe("OP-000010 · Whey Protein Isolado 900 g");
    });

    it("sem filtro por id: nenhuma consulta além do CSV", async () => {
      responderComEntidades({ acha: true });
      abrir("/print/relatorios/R-09?from=2026-09-01&to=2026-09-30");

      await documentoGerado("R-09-2026-09-11.pdf");
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(consultas()).toHaveLength(0);
    });

    it.each(["R-19", "R-20"])("%s com perfil recusado e cliente no filtro: nem CSV, nem consulta", async (codigo) => {
      sessao.role = "VIEWER";
      responderComEntidades({ acha: true });
      abrir(`/print/relatorios/${codigo}?customerId=${CLIENTE_A.id}`);

      expect(await screen.findByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(apiFetch).not.toHaveBeenCalled();
      expect(renderPdfBlob).not.toHaveBeenCalled();
    });

    it("CSV recusado pelo servidor: nenhum id é consultado", async () => {
      apiFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) });
      abrir(`/print/relatorios/R-07?itemId=${UUID.item}&productId=${UUID.produto}&productionOrderId=${UUID.ordemDeProducao}`);

      expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar o relatório (403)");
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(consultas()).toHaveLength(0);
      expect(renderPdfBlob).not.toHaveBeenCalled();
    });

    it("todo id que os schemas dos relatórios aceitam tem rótulo e nunca sai como veio", () => {
      const ids = [
        "itemId",
        "lotId",
        "productId",
        "productionOrderId",
        "customerOrderId",
        "purchaseOrderId",
        "supplierId",
        "customerId",
        "ownerCustomerId",
      ];
      const params = new URLSearchParams(ids.map((chave) => [chave, `${chave}-${UUID.lote}`]));

      const filtros = reportAppliedFilters(params, { filterKeys: ids });
      expect(filtros).toHaveLength(ids.length);
      for (const [indice, filtro] of filtros.entries()) {
        expect(filtro.label, ids[indice]).not.toBe(ids[indice]);
        expect(filtro.value, ids[indice]).toBe("");
      }
    });
  });

  it.each<[string, string[], string[]]>([
    [
      "R-05",
      [
        "OP", "Produto", "Nome do produto", "Formulação", "Planejado", "Produzido", "Variação", "Rendimento (%)",
        "Unidade", "Início", "Conclusão", "Status", "Custo material unitário", "Qualidade do custo",
      ],
      ["Real", "Estimado", "Parcial", "Sem custo"],
    ],
    [
      "R-09",
      [
        "Recebimento", "Data", "OC", "Fornecedor", "Item", "Descrição", "Lote interno", "Lote do fornecedor",
        "Quantidade", "Unidade", "CoA", "Preço previsto (OC)", "Custo efetivo", "Qualidade do custo",
      ],
      ["Real", "Sem custo"],
    ],
  ])(
    "%s: a qualidade do custo chega ao papel como a API a escreve — o rótulo, sem enum (REPORTS-PRESENTATION-WAVE-02)",
    async (codigo, cabecalho, qualidades) => {
      const registros = qualidades.map((qualidade, indice) =>
        cabecalho.map((coluna) => (coluna === "Qualidade do custo" ? qualidade : `${coluna}-${indice}`)),
      );
      apiFetch.mockResolvedValue(respostaCsv([cabecalho, ...registros]));
      abrir(`/print/relatorios/${codigo}`);

      const documento = await documentoGerado(`${codigo}-2026-09-11.pdf`);
      const principais = linhas(documento).filter((_, indice) => indice % 2 === 0);
      // A qualidade é a última coluna da linha principal: fica ao lado do custo que explica.
      expect(principais.map((linha) => linha.at(-1))).toEqual(qualidades);
      for (const enumCru of ["REAL", "ESTIMATED", "PARTIAL", "NO_COST"]) {
        expect(documento.textContent, enumCru).not.toContain(enumCru);
      }
    },
  );

  describe("filtro de lista fechada no papel: o rótulo da tela, nunca o valor da API (REPORTS-PRESENTATION-WAVE-01)", () => {
    it.each<[string, string, Record<string, string>, string[]]>([
      [
        "R-01",
        "itemType=RAW_MATERIAL&status=BLOCKED&onlyWithBalance=true",
        { "Tipo de item": "Matéria-prima", Status: "Bloqueado", "Somente com saldo": "Sim" },
        ["RAW_MATERIAL", "BLOCKED", "onlyWithBalance"],
      ],
      [
        "R-02",
        "window=D30&itemType=PACKAGING",
        { "Janela de vencimento": "Próximos 30 dias", "Tipo de item": "Material de embalagem" },
        ["D30", "PACKAGING", "window"],
      ],
      ["R-03", "type=ADJUSTMENT_IN", { Tipo: "Ajuste de entrada" }, ["ADJUSTMENT_IN"]],
      [
        "R-04",
        "status=IN_PRODUCTION&onlyShortage=false",
        { Status: "Em produção", "Somente com falta": "Não" },
        ["IN_PRODUCTION", "onlyShortage"],
      ],
      [
        "R-05",
        "status=COMPLETED&includeCost=true",
        { Status: "Concluída", "Incluir custo": "Sim" },
        ["COMPLETED", "includeCost"],
      ],
      [
        "R-08",
        "status=PARTIALLY_RECEIVED&origin=CUSTOMER_ORDER",
        { Status: "Recebido parcialmente", Origem: "Pedido do Cliente" },
        ["PARTIALLY_RECEIVED", "CUSTOMER_ORDER"],
      ],
      // Aceitos pela API sem seletor na tela (REPORTS-PRESENTATION-WAVE-02).
      [
        "R-01",
        "ownerType=CUSTOMER&location=A1",
        { Proprietário: "Cliente", Localização: "A1" },
        ["CUSTOMER", "ownerType", "location"],
      ],
      ["R-03", "sourceType=RECEIPT", { Origem: "Recebimento" }, ["RECEIPT", "sourceType"]],
      ["R-18", "active=false", { "Produto ativo": "Não" }, ["active", "false"]],
      ["R-12", "status=IN_FULFILLMENT", { Status: "Em atendimento" }, ["IN_FULFILLMENT"]],
      ["R-13", "status=PARTIALLY_SHIPPED", { Status: "Parcialmente expedido" }, ["PARTIALLY_SHIPPED"]],
      ["R-17", "status=CANCELLED", { Status: "Cancelado" }, ["CANCELLED"]],
      [
        "R-20",
        "status=SENT&priceSource=PRICING_TIER",
        { Status: "Enviado", "Origem do preço": "Faixa de precificação" },
        ["SENT", "PRICING_TIER", "priceSource"],
      ],
    ])("%s?%s", async (codigo, filtros, esperados, crus) => {
      apiFetch.mockResolvedValue(respostaCsv([["Documento"], ["DOC-000001"]]));
      abrir(`/print/relatorios/${codigo}?${filtros}`);

      const documento = await documentoGerado(`${codigo}-2026-09-11.pdf`);
      for (const [rotulo, valor] of Object.entries(esperados)) expect(campo(documento, rotulo), rotulo).toBe(valor);
      const texto = documento.textContent ?? "";
      for (const cru of crus) expect(texto, cru).not.toContain(cru);
      // A URL do CSV não muda: o servidor continua recebendo o valor dele.
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(`export.csv?${filtros}`));
    });

    it("valor fora do mapa sai como veio — nem some, nem vira o protótipo do objeto", () => {
      const filtros = reportAppliedFilters(
        new URLSearchParams("itemType=constructor&status=toString&onlyWithBalance=hasOwnProperty&search=SENT"),
        REPORT_PRINT_DEFINITIONS["R-01"]!,
      );
      expect(filtros).toEqual([
        { label: "Tipo de item", value: "constructor" },
        { label: "Status", value: "toString" },
        { label: "Somente com saldo", value: "hasOwnProperty" },
        // Busca é texto livre: "SENT" digitado é o que a pessoa procurou.
        { label: "Busca", value: "SENT" },
      ]);
    });
  });

  it.each(["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"])(
    "R-20 como %s: nem pede o CSV, nem gera documento — a recusa de verdade é do servidor",
    async (role) => {
      sessao.role = role;
      abrir("/print/relatorios/R-20?search=ORC-000001");

      expect(await screen.findByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(apiFetch).not.toHaveBeenCalled();
      expect(renderPdfBlob).not.toHaveBeenCalled();
    },
  );

  it("R-20 como COMMERCIAL: o documento sai como para ADMIN", async () => {
    sessao.role = "COMMERCIAL";
    apiFetch.mockResolvedValue(respostaCsv([["Orçamento", "Total"], ["ORC-000001 · V1", "100,00"]]));
    abrir("/print/relatorios/R-20");

    await documentoGerado("R-20-2026-09-11.pdf");
    expect(apiFetch).toHaveBeenCalledWith(`${API_URL}/reports/commercial/quote-pricing/export.csv`);
  });

  // R19-REPORT-AUTHORIZATION-01: margem e markup das faixas, a mesma autoridade do R-20.
  it.each(["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"])(
    "R-19 como %s: nem pede o CSV, nem gera documento — a recusa de verdade é do servidor",
    async (role) => {
      sessao.role = role;
      abrir("/print/relatorios/R-19?search=PROD-000001");

      expect(await screen.findByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(apiFetch).not.toHaveBeenCalled();
      expect(renderPdfBlob).not.toHaveBeenCalled();
    },
  );

  it.each(["COMMERCIAL", "ADMIN"])("R-19 como %s: o documento sai normalmente", async (role) => {
    sessao.role = role;
    apiFetch.mockResolvedValue(
      respostaCsv([["Produto", "Precificação", "Margem de contribuição (%)", "Markup (%)"], ["PROD-000001", "PREC-000001 · V1", "32,5", "48,1"]]),
    );
    abrir("/print/relatorios/R-19?search=PROD-000001");

    const documento = await documentoGerado("R-19-2026-09-11.pdf");
    expect(apiFetch).toHaveBeenCalledWith(`${API_URL}/reports/costs/pricing-by-product/export.csv?search=PROD-000001`);
    expect(documento.textContent).toContain("PREC-000001 · V1");
  });

  it("relatório desconhecido não gera documento", async () => {
    abrir("/print/relatorios/R-99");

    expect(await screen.findByRole("alert")).toHaveTextContent("Relatório desconhecido: R-99");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });

  // PERIOD-RANGE-VALIDATION-WAVE-01: o PDF lê o CSV, e o CSV recusa o que a tela recusa.
  it("período invertido na URL: a frase do servidor, e nenhum documento", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: "validation_error",
          issues: [{ path: "from", message: "A data inicial não pode ser posterior à data final." }],
        }),
    });
    abrir("/print/relatorios/R-03?from=2026-09-13&to=2026-09-12");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível gerar o documento: A data inicial não pode ser posterior à data final.",
    );
    expect(apiFetch).toHaveBeenCalledWith(`${API_URL}/reports/inventory/movements/export.csv?from=2026-09-13&to=2026-09-12`);
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });

  it("outra falha do CSV continua dizendo o status", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: "internal_error" }) });
    abrir("/print/relatorios/R-03?from=2026-09-01");

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar o relatório (500)");
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
    expect(campo(documento, "Planejado × produzido")).toBe("1.000 / 985,5 un");
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
