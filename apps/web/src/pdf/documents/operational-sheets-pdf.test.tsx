import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  InventoryPositionRowDTO,
  ProductionOrderDTO,
  QualityQueueRowDTO,
  ShipmentDTO,
} from "@veridi/shared";
import {
  InventoryCountPdf,
  InventoryPositionPdf,
  ProductionPickingPdf,
  QualityPendingPdf,
  ShipmentPickingPdf,
  inventoryCountPdfFileName,
  inventoryPositionPdfFileName,
  productionPickingPdfFileName,
  qualityPendingPdfFileName,
  shipmentPickingPdfFileName,
} from "./OperationalSheetsPdf";

// Teste de CONTEÚDO: as primitivas do renderer são lidas como DOM.
vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../testing/react-pdf-dom")) }));

/**
 * Folhas operacionais em PDF.
 *
 * O que estes testes protegem não é a aparência: é a promessa de que o papel
 * é um DOCUMENTO (identidade, código FO, filtros, quem gerou, espaço de
 * anotação) e não uma captura da tela operacional — a mesma de
 * `print/sheets.test.tsx`, agora sobre a folha PDF. A4, paginação e rodapé em
 * toda página são do arquivo real (`operational-sheets-documents.test.tsx`).
 */

/** 09:30:45 em Brasília — os segundos não chegam ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");

function linhaDeEstoque(extra: Partial<InventoryPositionRowDTO> = {}): InventoryPositionRowDTO {
  return {
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
    coaStatus: "APPROVED",
    expiryDate: "2027-01-31T00:00:00.000Z",
    location: "A-01",
    onHand: "500",
    reserved: "0",
    available: "500",
    status: "AVAILABLE",
    isExpired: false,
    ...extra,
  };
}

function pendencia(extra: Partial<QualityQueueRowDTO> = {}): QualityQueueRowDTO {
  return {
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
    ...extra,
  };
}

function ordem(extra: Partial<ProductionOrderDTO> = {}): ProductionOrderDTO {
  return {
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
    ...extra,
  } as unknown as ProductionOrderDTO;
}

function expedicao(extra: Partial<ShipmentDTO> = {}): ShipmentDTO {
  return {
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
    ...extra,
  } as unknown as ShipmentDTO;
}

/** Texto de cada célula da linha, na ordem das colunas. */
function celulas(linha: Element): string[] {
  return [...linha.querySelectorAll('[data-pdf-role="cell"]')].map((celula) => celula.textContent ?? "");
}

describe("Folha operacional em PDF", () => {
  it("traz identidade, código do documento, filtros e quem gerou", () => {
    render(
      <InventoryCountPdf
        rows={[linhaDeEstoque()]}
        blind={false}
        search="vitamina"
        itemType=""
        generatedAt={GERADO_EM}
        generatedBy="Maria Operadora"
      />,
    );

    expect(screen.getByText("Folha de contagem física de estoque")).toBeTruthy();
    // O código aparece DUAS vezes de propósito: no cabeçalho e no rodapé,
    // que se repete em toda página do arquivo.
    expect(screen.getAllByText("FO-01")).toHaveLength(2);
    // Filtros aplicados viajam com o papel: sem isso ninguém sabe o que a
    // folha está mostrando.
    expect(screen.getByText("Filtros aplicados")).toBeTruthy();
    expect(screen.getByText("Busca")).toBeTruthy();
    expect(screen.getByText("vitamina")).toBeTruthy();
    expect(screen.getByText("Com saldo do sistema")).toBeTruthy();
    // Quem gerou a folha e quando — carimbo do sistema, sem segundos.
    expect(screen.getByText("Gerado por Maria Operadora")).toBeTruthy();
    expect(screen.getByText("Gerado em 11/09/2026 09:30")).toBeTruthy();
  });

  it("sem sessão, quem gerou é travessão — nunca um nome inventado", () => {
    render(<QualityPendingPdf rows={[pendencia()]} generatedAt={GERADO_EM} generatedBy={null} />);

    expect(screen.getByText("Gerado por —")).toBeTruthy();
  });

  /**
   * Folha operacional sai com dezenas de páginas. A folha que se separa da
   * pilha precisa dizer de que documento veio: o rodapé de toda página traz o
   * código FO (e a OP/expedição), a natureza do papel e o carimbo.
   */
  it("repete a identidade do documento em rodapé corrido", () => {
    render(<ProductionPickingPdf order={ordem()} generatedAt={GERADO_EM} generatedBy={null} />);

    const rodape = screen.getByText("Página 1 de 1").parentElement!.parentElement!;
    expect(rodape.textContent).toContain("FO-04 · OP 007/26");
    expect(rodape.textContent).toContain("Folha operacional de papel");
    expect(rodape.textContent).toContain("Gerado em 11/09/2026 09:30");
    expect(screen.getAllByText("FO-04 · OP 007/26")).toHaveLength(2);
  });

  it("mantém os controles fora do documento impresso", () => {
    const { container } = render(
      <QualityPendingPdf rows={[pendencia()]} generatedAt={GERADO_EM} generatedBy={null} />,
    );

    // Baixar, imprimir e voltar são da tela (`PdfScreen`); o papel não tem
    // botão, campo nem resquício do shell operacional.
    expect(container.querySelectorAll("button, input, select, textarea, a")).toHaveLength(0);
    for (const controle of ["Imprimir", "Baixar PDF", "Voltar", "Salvar PDF"]) {
      expect(container.textContent).not.toContain(controle);
    }
    expect(container.querySelector(".app-shell__sidebar")).toBeNull();
    expect(container.querySelector(".toolbar")).toBeNull();
  });

  it("imprime campos de anotação manual sem persistir nada", () => {
    const { container } = render(
      <ProductionPickingPdf order={ordem()} generatedAt={GERADO_EM} generatedBy={null} />,
    );

    // Caixa de conferência é papel: não existe input, não existe estado — e
    // sai vazia mesmo com o picking já confirmado no sistema.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    const caixas = container.querySelectorAll('[data-pdf-role="checkbox"]');
    expect(caixas).toHaveLength(2);
    for (const caixa of caixas) expect(caixa.textContent).toBe("");
    // Observação: uma linha de escrita por linha de material.
    expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(2);
    const assinaturas = within(container.querySelector('[data-pdf-role="signatures"]') as HTMLElement);
    expect(assinaturas.getByText("Separado por")).toBeTruthy();
    expect(assinaturas.getByText("Conferido por")).toBeTruthy();
    expect(assinaturas.getByText("Data")).toBeTruthy();
  });

  it("usa retrato por padrão e paisagem só quando a largura exige", () => {
    const emissao = { generatedAt: GERADO_EM, generatedBy: null };
    // A orientação é decisão da folha (o arquivo real é medido no teste de
    // arquivo): as quatro tabelas largas deitam; a expedição cabe em pé.
    const paisagem = [
      InventoryCountPdf({ rows: [], blind: false, search: "", itemType: "", ...emissao }),
      InventoryPositionPdf({ rows: [], search: "", ...emissao }),
      QualityPendingPdf({ rows: [], ...emissao }),
      ProductionPickingPdf({ order: ordem(), ...emissao }),
    ];
    for (const folha of paisagem) expect(folha.props.landscape).toBe(true);
    expect(ShipmentPickingPdf({ shipment: expedicao(), ...emissao }).props.landscape).toBeFalsy();
  });

  it("mostra valor desconhecido como travessão, nunca zero", () => {
    const { container } = render(
      <InventoryCountPdf
        rows={[linhaDeEstoque({ lotId: null, lotCode: null, expiryDate: null, location: null, onHand: "12.5" })]}
        blind={false}
        search=""
        itemType=""
        generatedAt={GERADO_EM}
        generatedBy={null}
      />,
    );

    const [lote, validade, localizacao] = [2, 4, 5].map(
      (coluna) => celulas(container.querySelector('[data-pdf-role="row"]')!)[coluna],
    );
    expect([lote, validade, localizacao]).toEqual(["—", "—", "—"]);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("R$ 0,00")).toBeNull();
  });

  it("cliente ausente na expedição sai como travessão", () => {
    render(
      <ShipmentPickingPdf
        shipment={expedicao({ customerName: null })}
        generatedAt={GERADO_EM}
        generatedBy={null}
      />,
    );

    expect(screen.getByText("Cliente").closest('[data-pdf-role="field"]')?.textContent).toBe("Cliente—");
  });
});

describe("FO-01 — contagem física", () => {
  it("contagem cega não mostra o saldo do sistema", () => {
    const { container } = render(
      <InventoryCountPdf
        rows={[linhaDeEstoque({ onHand: "4321.5" })]}
        blind
        search=""
        itemType=""
        generatedAt={GERADO_EM}
        generatedBy={null}
      />,
    );

    expect(screen.getByText("Contagem cega — saldo do sistema omitido")).toBeTruthy();
    expect(screen.getByText("Contagem cega")).toBeTruthy();
    expect(screen.queryByText("Saldo sistema")).toBeNull();
    expect(container.textContent).not.toContain("4321");
    // As colunas de escrita continuam: contagem, diferença e observação.
    expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(3);
  });

  it("diz de quem é o material contado", () => {
    const { container } = render(
      <InventoryCountPdf
        rows={[
          linhaDeEstoque(),
          linhaDeEstoque({
            lotId: "lot-2",
            lotCode: "LT-20260811-000002",
            ownerType: "CUSTOMER",
            ownerCustomerId: "cli-1",
            ownerCustomerName: "Alpha Nutrition",
          }),
        ]}
        blind={false}
        search=""
        itemType=""
        generatedAt={GERADO_EM}
        generatedBy={null}
      />,
    );

    const [veridi, cliente] = [...container.querySelectorAll('[data-pdf-role="row"]')].map(celulas);
    expect(veridi?.[3]).toBe("Veridi");
    expect(cliente?.[3]).toBe("Cliente — Alpha Nutrition");
  });
});

describe("FO-02 — posição de estoque", () => {
  it("material de cliente diz de quem é; o da Veridi, de quem veio", () => {
    const { container } = render(
      <InventoryPositionPdf
        rows={[
          linhaDeEstoque(),
          linhaDeEstoque({
            lotId: "lot-2",
            lotCode: "LT-20260811-000002",
            ownerType: "CUSTOMER",
            ownerCustomerId: "cli-1",
            ownerCustomerName: "Alpha Nutrition",
          }),
        ]}
        search=""
        generatedAt={GERADO_EM}
        generatedBy={null}
      />,
    );

    const [veridi, cliente] = [...container.querySelectorAll('[data-pdf-role="row"]')].map(celulas);
    expect(veridi?.[3]).toBe("Insumos Ltda");
    expect(cliente?.[3]).toBe("Cliente — Alpha Nutrition");
  });
});

describe("apoios das folhas", () => {
  it("nome do arquivo sai do código FO e do contexto real", () => {
    expect(inventoryCountPdfFileName({ blind: false, generatedAt: GERADO_EM })).toBe(
      "FO-01-contagem-fisica-2026-09-11.pdf",
    );
    expect(inventoryCountPdfFileName({ blind: true, generatedAt: GERADO_EM })).toBe(
      "FO-01-contagem-fisica-cega-2026-09-11.pdf",
    );
    expect(inventoryPositionPdfFileName(GERADO_EM)).toBe("FO-02-posicao-estoque-2026-09-11.pdf");
    expect(qualityPendingPdfFileName(GERADO_EM)).toBe("FO-03-pendencias-qualidade-2026-09-11.pdf");
    expect(productionPickingPdfFileName({ code: "OP-000123", officialNumber: "007/26" })).toBe(
      "FO-04-OP-007-26.pdf",
    );
    expect(productionPickingPdfFileName({ code: "OP-000123", officialNumber: null })).toBe(
      "FO-04-OP-000123.pdf",
    );
    expect(shipmentPickingPdfFileName({ code: "EXP-000012" })).toBe("FO-05-EXP-000012.pdf");
  });

  it("o dia do arquivo é o dia da operação, não o do relógio UTC", () => {
    // 01:30 UTC do dia 12 ainda é 22:30 do dia 11 em Brasília.
    expect(inventoryPositionPdfFileName(new Date("2026-09-12T01:30:00.000Z"))).toBe(
      "FO-02-posicao-estoque-2026-09-11.pdf",
    );
  });
});
