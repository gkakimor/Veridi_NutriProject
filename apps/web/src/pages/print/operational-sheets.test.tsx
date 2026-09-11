import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  InventoryPositionRowDTO,
  ProductionOrderDTO,
  QualityQueueRowDTO,
  ShipmentDTO,
} from "@veridi/shared";
import {
  InventoryCountSheetPage,
  InventoryPositionSheetPage,
  ProductionPickingSheetPage,
  QualityPendingSheetPage,
  ShipmentPickingSheetPage,
} from "./OperationalSheets";
import { getInventoryPositionReport } from "../../lib/reports-api";
import { listQualityQueue } from "../../lib/attachments-api";
import { getProductionOrder } from "../../lib/production-orders-api";
import { getShipment } from "../../lib/shipments-api";

// A folha é PDF: as primitivas do renderer são lidas como DOM.
vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../../pdf/testing/react-pdf-dom")) }));

/*
 * O arquivo em si (A4, paginação, rodapé em toda folha) é provado em
 * `pdf/documents/operational-sheets-documents.test.tsx`. Aqui interessa o que
 * a PÁGINA entrega ao gerador: a folha montada com o dado que ela carregou,
 * lida de volta como DOM.
 */
const renderPdfBlob = vi.fn();
vi.mock("../../pdf/render", () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlob(...args),
  downloadPdf: vi.fn(),
}));

const sessao = vi.hoisted(() => ({ atual: null as { user: { name: string } } | null }));
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => sessao.atual }));

vi.mock("../../lib/reports-api", () => ({
  getInventoryPositionReport: vi.fn(),
}));
vi.mock("../../lib/attachments-api", () => ({ listQualityQueue: vi.fn() }));
vi.mock("../../lib/production-orders-api", () => ({ getProductionOrder: vi.fn() }));
vi.mock("../../lib/shipments-api", () => ({ getShipment: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  sessao.atual = null;
  renderPdfBlob.mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn(() => "blob:veridi/folha");
  URL.revokeObjectURL = vi.fn();
});

const lotEmEspera = {
  itemId: "item-1",
  itemCode: "MP-000001",
  itemName: "Coenzima Q10",
  itemType: "RAW_MATERIAL",
  unitCode: "kg",
  lotId: "lot-1",
  lotCode: "LT-20260810-000001",
  lotOrigin: "RECEIPT",
  supplierLot: "F-778",
  businessLotNumber: null,
  supplierName: "Insumos Ltda",
  ownerType: "VERIDI",
  ownerCustomerId: null,
  ownerCustomerName: null,
  coaStatus: "PENDING",
  expiryDate: "2027-01-31T00:00:00.000Z",
  location: "A-01",
  onHand: "500",
  reserved: "0",
  available: "0",
  status: "AWAITING_RELEASE",
  isExpired: false,
} as unknown as InventoryPositionRowDTO;

function posicao(rows: InventoryPositionRowDTO[]) {
  return { rows, page: 1, pageSize: 25, total: rows.length } as Awaited<
    ReturnType<typeof getInventoryPositionReport>
  >;
}

/** Destino do "Voltar". */
function Origem() {
  const { pathname } = useLocation();
  return <p>Voltou para {pathname}</p>;
}

/** Abre a rota da folha e devolve a folha que a página mandou gerar, lida como DOM. */
async function abrirFolha(rota: string, caminho: string, pagina: ReactElement) {
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path={caminho} element={pagina} />
        <Route path="*" element={<Origem />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(renderPdfBlob).toHaveBeenCalledTimes(1));
  const documento = renderPdfBlob.mock.calls[0]![0] as ReactElement;
  const { container } = render(documento);
  return { container, folha: within(container) };
}

/** Texto de cada célula da linha, na ordem das colunas. */
function celulas(linha: Element): string[] {
  return [...linha.querySelectorAll('[data-pdf-role="cell"]')].map((celula) => celula.textContent ?? "");
}

function abrirFO02() {
  return abrirFolha("/print/posicao-estoque", "/print/posicao-estoque", <InventoryPositionSheetPage />);
}

/**
 * FO-02 saía com Físico 500, Reservado 0 e Disponível 0 sem dizer por quê.
 * Quem faz a contagem está no estoque com o papel na mão: se a folha não
 * explica o bloqueio, o número zerado parece erro do sistema — ou pior,
 * parece material que sumiu.
 */
describe("FO-02 — posição de estoque impressa", () => {
  it("explica por que o lote em espera da Qualidade tem disponível zero", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue(posicao([lotEmEspera]));

    const { container, folha } = await abrirFO02();

    // A situação do lote vira coluna: quem lê a linha vê o motivo ao lado do
    // número, não precisa deduzir.
    expect(folha.getByText("Aguardando liberação")).toBeTruthy();
    expect(folha.getByText("Situação do lote")).toBeTruthy();

    // E a regra fica escrita no papel, não só implícita na coluna.
    const aviso = container.querySelector('[data-pdf-role="notice"]');
    expect(aviso).toBeTruthy();
    expect(aviso?.textContent).toMatch(/Disponível = Físico/);
    expect(aviso?.textContent).toMatch(/Aguardando liberação/);
    expect(aviso?.textContent).toMatch(/conta zero no disponível/);
  });

  it("mostra o físico bloqueado sem apagá-lo do estoque", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue(
      posicao([{ ...lotEmEspera, status: "BLOCKED" }]),
    );

    const { folha } = await abrirFO02();

    // Material bloqueado continua contando no Físico — a folha de contagem
    // precisa dele para bater com o que está na prateleira.
    expect(folha.getByText("Bloqueado")).toBeTruthy();
    expect(folha.getByText("500")).toBeTruthy();
  });

  it("vencimento manda sobre o estado gravado", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue(
      posicao([{ ...lotEmEspera, status: "AVAILABLE", isExpired: true }]),
    );

    const { folha } = await abrirFO02();

    // Lote fora da validade não pode aparecer no papel como disponível.
    const linha = folha.getByText("LT-20260810-000001").closest('[data-pdf-role="row"]')!;
    expect(linha.textContent).toContain("Vencido");
    expect(linha.textContent).not.toContain("Disponível");
  });
});

/**
 * A rota continua a mesma; o que muda é o papel: a página carrega com os
 * parâmetros de sempre, monta a folha PDF, dá nome ao arquivo e volta para
 * a tela de origem.
 */
describe("Folhas operacionais — a rota gera o PDF da folha", () => {
  it("FO-01 leva busca e contagem cega da rota para a carga e para o papel", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue(posicao([lotEmEspera]));

    const { folha } = await abrirFolha(
      "/print/contagem-fisica?cega=1&search=coenzima",
      "/print/contagem-fisica",
      <InventoryCountSheetPage />,
    );

    // Resultado filtrado completo — nunca só a página aberta na tela.
    expect(getInventoryPositionReport).toHaveBeenCalledWith({ all: true, page: 1, search: "coenzima" });
    expect(folha.getByText("Contagem cega — saldo do sistema omitido")).toBeTruthy();
    expect(folha.getByText("coenzima")).toBeTruthy();
    expect(folha.getByText("Contagem cega")).toBeTruthy();
    // Quem conta não vê o número esperado.
    expect(folha.queryByText("Saldo sistema")).toBeNull();
    expect(folha.queryByText("500")).toBeNull();
    // O arquivo cego não se confunde com o que traz o saldo.
    expect(
      await screen.findByTitle(/^Documento FO-01-contagem-fisica-cega-\d{4}-\d{2}-\d{2}\.pdf$/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Voltou para /estoque/inventario")).toBeInTheDocument();
  });

  it("FO-01 com saldo do sistema traz a coluna do saldo e quem gerou", async () => {
    sessao.atual = { user: { name: "Maria Operadora" } };
    vi.mocked(getInventoryPositionReport).mockResolvedValue(posicao([lotEmEspera]));

    const { container, folha } = await abrirFolha(
      "/print/contagem-fisica",
      "/print/contagem-fisica",
      <InventoryCountSheetPage />,
    );

    expect(getInventoryPositionReport).toHaveBeenCalledWith({ all: true, page: 1 });
    expect(folha.getByText("Saldo sistema")).toBeTruthy();
    expect(folha.getByText("500")).toBeTruthy();
    expect(folha.getByText("Com saldo do sistema")).toBeTruthy();
    // Quem gerou o papel vem da sessão — não substitui quem executa no sistema.
    expect(folha.getByText("Gerado por Maria Operadora")).toBeTruthy();
    // Contagem, diferença e observação: três linhas de escrita, nenhum campo.
    expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(3);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(
      await screen.findByTitle(/^Documento FO-01-contagem-fisica-\d{4}-\d{2}-\d{2}\.pdf$/),
    ).toBeInTheDocument();
  });

  it("FO-02 leva a busca da tela para a carga e para o papel", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue(posicao([lotEmEspera]));

    const { folha } = await abrirFolha(
      "/print/posicao-estoque?search=vitamina",
      "/print/posicao-estoque",
      <InventoryPositionSheetPage />,
    );

    expect(getInventoryPositionReport).toHaveBeenCalledWith({ all: true, page: 1, search: "vitamina" });
    expect(folha.getByText("Busca")).toBeTruthy();
    expect(folha.getByText("vitamina")).toBeTruthy();
    expect(folha.getByText("Gerado por —")).toBeTruthy();
    expect(
      await screen.findByTitle(/^Documento FO-02-posicao-estoque-\d{4}-\d{2}-\d{2}\.pdf$/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Voltou para /estoque")).toBeInTheDocument();
  });

  it("FO-03 separa a pendência pela situação do laudo", async () => {
    const base: QualityQueueRowDTO = {
      lotId: "lot-q1",
      lotCode: "LT-20260901-000001",
      itemId: "item-1",
      itemCode: "MP-000001",
      itemName: "Coenzima Q10",
      sourceName: null,
      declaredNutrient: null,
      lotOrigin: "RECEIPT",
      supplierName: "Insumos Ltda",
      ownerType: "VERIDI",
      ownerCustomerName: null,
      receivedAt: "2026-09-01T13:00:00.000Z",
      expiryDate: "2027-09-01T00:00:00.000Z",
      isExpired: false,
      requiresCoa: true,
      coaStatus: "PENDING",
      coaReviewedByName: null,
      coaReviewNote: null,
      lotStatus: "AWAITING_RELEASE",
      onHand: "25",
      unitCode: "kg",
    };
    vi.mocked(listQualityQueue).mockResolvedValue({
      rows: [
        base,
        { ...base, lotId: "lot-q2", lotCode: "LT-20260901-000002", coaStatus: "RECEIVED" },
        {
          ...base,
          lotId: "lot-q3",
          lotCode: "LT-20260901-000003",
          requiresCoa: false,
          coaStatus: "NOT_REQUIRED",
          ownerType: "CUSTOMER",
          ownerCustomerName: "Alpha Nutrition",
        },
      ],
      page: 1,
      pageSize: 100,
      total: 3,
    });

    const { container, folha } = await abrirFolha(
      "/print/qualidade-pendencias",
      "/print/qualidade-pendencias",
      <QualityPendingSheetPage />,
    );

    expect(listQualityQueue).toHaveBeenCalledWith({ pageSize: 100 });
    const linha = (lote: string) => celulas(folha.getByText(lote).closest('[data-pdf-role="row"]')!);
    // Colunas: Lote, Item, Fornecedor / proprietário, CoA, Qualidade, …, Pendência.
    expect(linha("LT-20260901-000001")[7]).toBe("Laudo não recebido");
    expect(linha("LT-20260901-000002")[7]).toBe("Laudo aguardando análise");
    const semLaudo = linha("LT-20260901-000003");
    expect(semLaudo[2]).toBe("Cliente — Alpha Nutrition");
    expect(semLaudo[3]).toBe("Não exigido");
    expect(semLaudo[7]).toBe("Aguardando liberação");
    // "Tratado / observação" é papel: uma linha de escrita por lote.
    expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(3);
    expect(folha.getByText("Qualidade — responsável")).toBeTruthy();
    expect(
      await screen.findByTitle(/^Documento FO-03-pendencias-qualidade-\d{4}-\d{2}-\d{2}\.pdf$/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Voltou para /qualidade/documentos")).toBeInTheDocument();
  });

  it("FO-04 identifica a OP no código da folha e no nome do arquivo", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue({
      id: "op-1",
      code: "OP-000123",
      officialNumber: "007/26",
      productCode: "PA-000010",
      productName: "Whey Protein Baunilha 900 g",
      customerName: "Alpha Nutrition Ltda",
      plannedQuantity: "1000",
      outputUnitCode: "un",
      status: "RELEASED",
      requirements: [
        {
          id: "req-1",
          itemCode: "MP-000002",
          itemName: "Whey Protein Concentrado 80%",
          supplyResponsibility: "VERIDI",
          requiredQuantity: "12.5",
          stockUnitCode: "kg",
          reservationLines: [
            {
              id: "rl-1",
              lotCode: "LT-20260810-000002",
              expiryDate: "2027-01-31T00:00:00.000Z",
              location: "A-02",
              quantity: "12.5",
              pickingStatus: "CONFIRMED",
              pickedBy: "Ana Separadora",
              pickedAt: "2026-09-10T14:00:00.000Z",
            },
          ],
        },
        {
          id: "req-2",
          itemCode: "MP-000011",
          itemName: "Aroma de Baunilha",
          supplyResponsibility: "CUSTOMER",
          requiredQuantity: "0.8",
          stockUnitCode: "kg",
          reservationLines: [
            {
              id: "rl-2",
              lotCode: "LT-20260812-000044",
              expiryDate: null,
              location: null,
              quantity: "0.8",
              pickingStatus: "PENDING",
              pickedBy: null,
              pickedAt: null,
            },
          ],
        },
      ],
    } as unknown as ProductionOrderDTO);

    const { container, folha } = await abrirFolha(
      "/print/producao-picking/op-1",
      "/print/producao-picking/:id",
      <ProductionPickingSheetPage />,
    );

    expect(getProductionOrder).toHaveBeenCalledWith("op-1");
    // Cabeçalho e rodapé: o código da folha carrega a OP.
    expect(folha.getAllByText("FO-04 · OP 007/26")).toHaveLength(2);
    expect(folha.getByText("Material do cliente")).toBeTruthy();
    // O que o sistema já sabe aparece ao lado, sem preencher o quadrado.
    expect(folha.getByText("Ana Separadora · 10/09/2026")).toBeTruthy();
    expect(container.querySelectorAll('[data-pdf-role="checkbox"]')).toHaveLength(2);
    expect(await screen.findByTitle("Documento FO-04-OP-007-26.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Voltou para /producao/ordens/op-1")).toBeInTheDocument();
  });

  it("FO-05 identifica a expedição e traz a quantidade a separar preenchida", async () => {
    vi.mocked(getShipment).mockResolvedValue({
      id: "exp-1",
      code: "EXP-000012",
      customerOrderCode: "PED-000045",
      customerName: "Alpha Nutrition Ltda",
      status: "DRAFT",
      createdAt: "2026-09-10T15:00:00.000Z",
      lines: [
        {
          id: "sl-1",
          productCode: "PA-000010",
          productName: "Whey Protein Baunilha 900 g",
          quantity: "120",
          unitCode: "un",
          lotCode: "LT-20260905-000321",
          expiryDate: "2027-09-05T00:00:00.000Z",
          location: "EXP-01",
        },
      ],
    } as unknown as ShipmentDTO);

    const { container, folha } = await abrirFolha(
      "/print/expedicao-separacao/exp-1",
      "/print/expedicao-separacao/:id",
      <ShipmentPickingSheetPage />,
    );

    expect(getShipment).toHaveBeenCalledWith("exp-1");
    expect(folha.getAllByText("FO-05 · EXP-000012")).toHaveLength(2);
    // Uma coluna de quantidade, preenchida, e o visto de conferência ao lado.
    expect(folha.getAllByText("Qtd. separar")).toHaveLength(1);
    expect(folha.getByText("120 un")).toBeTruthy();
    expect(container.querySelectorAll('[data-pdf-role="checkbox"]')).toHaveLength(1);
    expect(await screen.findByTitle("Documento FO-05-EXP-000012.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Voltou para /comercial/expedicoes/exp-1")).toBeInTheDocument();
  });
});
