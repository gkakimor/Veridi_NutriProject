import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  BillingDTO,
  CustomerOrderDTO,
  ProductionOrderDTO,
  ProductionOrderMaterialCostDTO,
} from "@veridi/shared";
import { BILLING_NON_FISCAL_NOTICE, Decimal, splitDecimal } from "@veridi/shared";
import { BillingPdf } from "../pdf/documents/BillingPdf";
import { CustomerOrderPdf } from "../pdf/documents/CustomerOrderPdf";
import { ProductionOrderPdf } from "../pdf/documents/ProductionOrderPdf";

/*
 * Os impressos transacionais são PDF (`src/pdf/documents/`). As primitivas do
 * renderer são lidas como DOM: o teste lê o que o documento ESCREVE. O arquivo
 * real — A4, paginação, rodapé em toda folha — é provado em
 * `src/pdf/documents/transactional-documents.test.tsx`.
 */
vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../pdf/testing/react-pdf-dom")) }));

const GERADO_EM = new Date("2026-09-11T12:30:00.000Z");

/** A linha do bloco de totais: o rótulo e o valor que ele anuncia. */
function linhaDoTotal(rotulo: string): HTMLElement {
  const noPapel = screen.getByText(rotulo);
  expect(noPapel.closest('[data-pdf-role="totals"]'), `"${rotulo}" fora do bloco de totais`).not.toBeNull();
  return noPapel.parentElement!;
}

/** O campo rotulado do documento — rótulo e valor juntos. */
function campo(rotulo: string): HTMLElement {
  const noPapel = screen.getByText(rotulo).closest<HTMLElement>('[data-pdf-role="field"]');
  expect(noPapel, `campo "${rotulo}"`).not.toBeNull();
  return noPapel!;
}

const billingBase: BillingDTO = {
  id: "bil-1",
  code: "FAT-000123",
  customerOrderId: "ord-1",
  customerOrderCode: "PED-000045",
  shipmentId: "shp-1",
  shipmentCode: "EXP-000031",
  shipmentDate: "2026-08-10T12:00:00.000Z",
  customerId: "cus-1",
  customerCode: "CLI-000007",
  customerName: "Cliente Snapshot Ltda",
  customerTradeName: null,
  customerCnpj: "11222333000181",
  status: "ISSUED",
  externalReference: "NF 4567",
  notes: null,
  lines: [
    {
      id: "line-1",
      shipmentLineId: "sl-1",
      customerOrderLineId: "col-1",
      productId: "prd-1",
      productCode: "PRD-001",
      productName: "Magnésio",
      itemId: "item-1",
      itemCode: "PA-000010",
      itemName: "Magnésio 60 caps",
      lotId: "lot-1",
      lotCode: "LT-20260810-000001",
      businessLotNumber: "260810-A",
      quantity: "100",
      unitCode: "un",
      agreedUnitPrice: "10.00",
      unitPrice: "10.00",
      lineTotal: "1000.00",
      priceOverridden: false,
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
      position: 0,
    },
  ],
  totalQuantity: "100",
  grossAmount: "1000.00",
  discountPercentSnapshot: null,
  discountAmount: null,
  commercialAdjustmentAmount: null,
  totalAmount: "1000.00",
  hasCompletePricing: true,
  issuedAt: "2026-08-11T09:00:00.000Z",
  issuedBy: "Ambiente local",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-08-11T08:00:00.000Z",
  createdBy: "Ambiente local",
  updatedAt: "2026-08-11T09:00:00.000Z",
};

describe("Faturamento impresso", () => {
  it("deixa inequívoco que não é Nota Fiscal", () => {
    const { container } = render(<BillingPdf billing={billingBase} generatedAt={GERADO_EM} />);
    expect(screen.getByText(BILLING_NON_FISCAL_NOTICE)).toHaveAttribute("data-pdf-role", "notice");
    expect(BILLING_NON_FISCAL_NOTICE).toContain("não é Nota Fiscal");
    // E o rodapé repete a natureza do documento em toda folha.
    expect(container.textContent).toContain(`Veridi Nutrition · ${BILLING_NON_FISCAL_NOTICE}`);
  });

  it("imprime o snapshot do documento e o total quando a precificação está completa", () => {
    render(<BillingPdf billing={billingBase} generatedAt={GERADO_EM} />);
    // O código identifica a folha: cabeçalho e rodapé.
    expect(screen.getAllByText("FAT-000123").length).toBeGreaterThanOrEqual(1);
    // Snapshot histórico do cliente manda sobre o cadastro atual.
    expect(screen.getByText("Cliente Snapshot Ltda")).toBeInTheDocument();
    expect(screen.getByText("LT-20260810-000001")).toBeInTheDocument();
    expect(linhaDoTotal("Valor total")).toHaveTextContent("1.000,00");
  });

  /*
   * O papel tem de fechar na conferência.
   *
   * Este é o lugar onde mais pesa: na tela ainda dá para clicar e ver o número
   * inteiro; no papel, não. O documento imprimia `R$ 4,05` ao lado de um total
   * de `R$ 498,53` calculado sobre `4,0531`, e quem conferisse com a
   * calculadora chegava a R$ 498,15.
   *
   * A correção da tela passou por aqui sem pegar: os documentos usavam um
   * helper `money` próprio, e a varredura estava ancorada em `formatBRL`. Um
   * teste no papel é o que impede a próxima passada de repetir isso.
   */
  it("preço unitário de quatro casas chega inteiro ao papel, e o total fecha", () => {
    const quebrado: BillingDTO = {
      ...billingBase,
      lines: [
        {
          ...billingBase.lines[0]!,
          quantity: "123",
          agreedUnitPrice: "4.0531",
          unitPrice: "4.0531",
          lineTotal: "498.53",
        },
      ],
      totalQuantity: "123",
      totalAmount: "498.53",
    };
    render(<BillingPdf billing={quebrado} generatedAt={GERADO_EM} />);

    expect(screen.getByText(/4,0531/)).toBeInTheDocument();
    // Aparece na linha e no bloco de totais — as duas ocorrencias sao o ponto.
    expect(screen.getAllByText(/498,53/).length).toBeGreaterThanOrEqual(2);
    // A conta que o operador faz com o que está impresso.
    expect((4.0531 * 123).toFixed(2)).toBe("498.53");
  });

  it("total de linha continua em duas casas — não é preço", () => {
    render(<BillingPdf billing={billingBase} generatedAt={GERADO_EM} />);
    expect(linhaDoTotal("Valor total")).toHaveTextContent("1.000,00");
    expect(screen.queryByText(/1\.000,0000/)).not.toBeInTheDocument();
  });

  it("com preço incompleto não apresenta total parcial como total", () => {
    const incomplete: BillingDTO = {
      ...billingBase,
      hasCompletePricing: false,
      totalAmount: null,
      lines: [{ ...billingBase.lines[0]!, unitPrice: null, lineTotal: null }],
    };
    render(<BillingPdf billing={incomplete} generatedAt={GERADO_EM} />);
    expect(linhaDoTotal("Valor total")).toHaveTextContent("Precificação incompleta");
    expect(screen.queryByText(/1\.000,00/)).toBeNull();
  });

  it("rascunho é rotulado como tal, nunca parece documento final", () => {
    const { container } = render(
      <BillingPdf billing={{ ...billingBase, status: "DRAFT", issuedAt: null }} generatedAt={GERADO_EM} />,
    );
    expect(container.querySelector('[data-pdf-role="draft"]')).toHaveTextContent("Rascunho");
  });
});

const productionOrderBase = {
  id: "op-1",
  code: "OP-000010",
  productId: "prd-1",
  productCode: "PRD-001",
  productName: "Magnésio",
  finishedItemId: "item-1",
  finishedItemCode: "PA-000010",
  finishedItemName: "Magnésio 60 caps",
  formulationVersionId: "fv-1",
  formulationVersionNumber: 2,
  formulationVersionLabel: "v2",
  plannedQuantity: "100",
  outputUnitCode: "un",
  productionFactor: "100",
  status: "COMPLETED",
  origin: "MANUAL",
  materialsStatus: "MATERIALS_AVAILABLE",
  shortageItemCount: 0,
  materialReconciliation: {
    totalRequirements: 0,
    reconciledRequirements: 0,
    pendingRequirements: 0,
    canComplete: true,
  },
  notes: null,
  customerId: null,
  customerTradeName: null,
  customerZipCode: null,
  customerStreet: null,
  customerNumber: null,
  customerComplement: null,
  customerDistrict: null,
  customerCity: null,
  customerState: null,
  officialNumber: "007/26",
  numberOfParts: 1,
  labelInstructions: null,
  shelfLifeMonths: null,
  suggestedBusinessLotNumber: null,
  planning: {
    snapshot: null,
    plan: null,
    appliedAt: null,
    appliedBy: null,
    availableProfile: null,
    canApply: false,
    canUpdate: false,
  },
  productionOrderRevision: null,
  recipeSheetRevision: null,
  customerCode: null,
  customerName: null,
  customerCnpj: null,
  hasCustomerSuppliedRequirements: false,
  requirements: [],
  plannedAt: "2026-08-01T10:00:00.000Z",
  plannedBy: "Ambiente local",
  releasedAt: "2026-08-02T10:00:00.000Z",
  releasedBy: "Ambiente local",
  reservation: null,
  startedAt: "2026-08-03T10:00:00.000Z",
  startedBy: "Ambiente local",
  consumptions: [],
  producedQuantity: "100",
  remainingQuantity: "0",
  outputs: [],
  eligibleFinishedLots: [],
  customerOrderId: null,
  customerOrderCode: null,
  customerOrderLineId: null,
  completedAt: "2026-08-04T10:00:00.000Z",
  completedBy: "Ambiente local",
  completionReason: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-08-01T09:00:00.000Z",
  createdBy: "Ambiente local",
  updatedAt: "2026-08-04T10:00:00.000Z",
} as ProductionOrderDTO;

describe("Ordem de Produção impressa", () => {
  it("custo PARTIAL nunca aparece como custo total fechado", () => {
    const partialCost: ProductionOrderMaterialCostDTO = {
      productionOrderId: "op-1",
      consumptions: [],
      quality: "PARTIAL",
      hasCustomerSuppliedMaterials: false,
      customerSuppliedConsumptionCount: 0,
      totalMaterialCost: null,
      knownMaterialCostSubtotal: "250.00",
      producedQuantity: "100",
      outputUnitCode: "un",
      materialUnitCost: null,
      missingCostItems: ["MP-000001"],
    };

    render(<ProductionOrderPdf order={productionOrderBase} cost={partialCost} generatedAt={GERADO_EM} />);

    expect(campo("Qualidade do custo")).toHaveTextContent("Parcial");
    const total = campo("Custo total de material");
    expect(total).toHaveTextContent("Indisponível");
    // O subtotal conhecido aparece rotulado como subtotal, nunca como total.
    expect(total).toHaveTextContent("subtotal conhecido");
    expect(campo("Custo por unidade produzida")).toHaveTextContent("—");
  });
});

const customerOrderBase = {
  id: "ord-1",
  code: "PED-000045",
  customerId: "cus-1",
  customerCode: "CLI-000007",
  customerName: "Cliente Snapshot Ltda",
  customerTradeName: null,
  customerCnpj: "11222333000181",
  customerAddress: null,
  orderDate: "2026-08-01T10:00:00.000Z",
  requestedDeliveryDate: "2026-08-20T10:00:00.000Z",
  status: "IN_FULFILLMENT",
  notes: null,
  lines: [
    {
      id: "col-1",
      productId: "prd-1",
      productCode: "PRD-001",
      productName: "Magnésio",
      finishedItemId: "item-1",
      finishedItemCode: "PA-000010",
      finishedItemName: "Magnésio 60 caps",
      orderedQuantity: "100",
      unitCode: "un",
      position: 0,
      shippedQuantity: "40",
      outstandingQuantity: "60",
      pendingProductionQuantity: "60",
      billedQuantity: "40",
      unbilledShippedQuantity: "0",
      sourceQuoteLineId: null,
      agreedPrice: null,
    },
  ],
  commercialOrigin: null,
  reservation: null,
  generatedProductionOrders: [],
  linkedPurchaseOrders: [],
  shipments: [],
  billings: [],
  billingStatus: "PARTIALLY_BILLED",
  confirmedAt: "2026-08-02T10:00:00.000Z",
  confirmedBy: "Ambiente local",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-08-01T09:00:00.000Z",
  createdBy: "Ambiente local",
  updatedAt: "2026-08-05T10:00:00.000Z",
} as unknown as CustomerOrderDTO;

describe("Pedido do Cliente impresso", () => {
  /**
   * A folha mostra reservado, faturado e falta expedir — posição de
   * atendimento, assunto de dentro da fábrica. Os três documentos irmãos que
   * vão ao cliente já se declaram; este saía mudo e podia ser entregue no
   * balcão como se fosse confirmação de pedido.
   */
  it("declara que é documento interno", () => {
    const { container } = render(<CustomerOrderPdf order={customerOrderBase} generatedAt={GERADO_EM} />);

    const aviso = container.querySelector('[data-pdf-role="notice"]');
    expect(aviso).toBeTruthy();
    expect(aviso?.textContent).toMatch(/interno/i);
    expect(aviso?.textContent).toMatch(/não é documento fiscal/i);
  });

  it("continua trazendo as colunas internas que motivam o aviso", () => {
    render(<CustomerOrderPdf order={customerOrderBase} generatedAt={GERADO_EM} />);
    for (const coluna of ["Faturado", "Falta expedir"]) {
      expect(screen.getByText(coluna).closest('[data-pdf-role="header-row"]'), coluna).not.toBeNull();
    }
  });
});

/**
 * Rateio por parte na Ordem de Produção impressa — #21.
 *
 * A coluna "Por parte" dividia sozinha, em `Number`, e anunciava N partes
 * iguais. O motor da produção nunca dividiu assim: as N-1 primeiras são
 * truncadas em seis casas e a última absorve o resto, para que a soma feche
 * com o total. Os dois documentos da MESMA ordem — este e a Folha de Receita,
 * que é onde a pesagem acontece — diziam números diferentes.
 */
function materiaPrima(requiredQuantity: string) {
  return {
    id: "req-1",
    itemId: "item-mp-1",
    itemCode: "MP-000001",
    itemName: "Óxido de magnésio",
    itemType: "RAW_MATERIAL",
    formulaQuantity: requiredQuantity,
    formulaUnitCode: "kg",
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity,
    stockUnitCode: "kg",
    position: 0,
    onHand: "0",
    reserved: "0",
    available: "0",
    onOrder: "0",
    shortage: "0",
    availabilityStatus: "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: "0",
    consumedQuantity: "0",
    remainingReservedQuantity: "0",
    reservationLines: [],
    reconciliationStatus: "PENDING",
    unreconciledQuantity: "0",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  };
}

function ordemFracionada(requiredQuantity: string, numberOfParts: number): ProductionOrderDTO {
  return {
    ...productionOrderBase,
    numberOfParts,
    requirements: [materiaPrima(requiredQuantity)],
  } as unknown as ProductionOrderDTO;
}

/**
 * As células da linha da matéria-prima, na tabela "Matérias-primas" — a
 * primeira do documento a listar o item.
 */
function celulasDaMateriaPrima(container: HTMLElement): Element[] {
  const linha = [...container.querySelectorAll('[data-pdf-role="row"]')].find((row) =>
    row.textContent?.includes("MP-000001"),
  );
  expect(linha, "linha da matéria-prima").toBeDefined();
  // A 6ª coluna da tabela é mesmo "Por parte" — a prova não depende de sorte.
  const cabecalho = linha!.parentElement!.querySelector('[data-pdf-role="header-row"]')!;
  expect(cabecalho.children[5]?.textContent).toBe("Por parte");
  return [...linha!.querySelectorAll('[data-pdf-role="cell"]')];
}

/** A célula "Por parte" da linha da matéria-prima. */
function celulaPorParte(container: HTMLElement): string {
  return celulasDaMateriaPrima(container)[5]!.textContent!;
}

describe("Ordem de Produção impressa — rateio por parte (#21)", () => {
  it("não anuncia mais um valor que parte nenhuma seria pesada", () => {
    // 2 kg em 3 partes. O motor planeja 0,666666 / 0,666666 / 0,666668.
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("2", 3)} cost={null} generatedAt={GERADO_EM} />,
    );

    expect(celulaPorParte(container)).toBe("0,666666 × 2 + 0,666668");
    // O número que o documento inventava — `(2/3).toFixed(6)` — sumiu.
    expect(container.textContent).not.toContain("0,666667");
    expect(container.textContent).not.toContain("0.666667");
  });

  it("as parcelas impressas somam exatamente o total da ordem", () => {
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("10", 3)} cost={null} generatedAt={GERADO_EM} />,
    );

    const celula = celulaPorParte(container);
    expect(celula).toBe("3,333333 × 2 + 3,333334");
    // 3,333333 × 2 + 3,333334 = 10 — o mesmo "Necessário" da própria linha.
    const soma = splitDecimal("10", 3).reduce(
      (total, parte) => total.plus(parte),
      new Decimal(0),
    );
    expect(soma.toString()).toBe("10");
  });

  it("divisão exata mantém a forma curta do documento antigo", () => {
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("9", 3)} cost={null} generatedAt={GERADO_EM} />,
    );
    expect(celulaPorParte(container)).toBe("3 × 3");
  });

  it("parte única continua sem rateio", () => {
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("10", 1)} cost={null} generatedAt={GERADO_EM} />,
    );
    expect(celulaPorParte(container)).toBe("—");
  });

  it("quantidade que não cabe num double sai íntegra no papel", () => {
    // `DECIMAL(24,12)`: 24 dígitos significativos contra os ~15 do float.
    const { container } = render(
      <ProductionOrderPdf
        order={ordemFracionada("999999999999.000000000003", 3)}
        cost={null}
        generatedAt={GERADO_EM}
      />,
    );
    expect(celulaPorParte(container)).toBe("333333333333 × 2 + 333333333333");
    expect(container.textContent).toContain("999999999999");
  });

  it("nenhum NaN, Infinity ou [object Object] no documento", () => {
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("2", 3)} cost={null} generatedAt={GERADO_EM} />,
    );
    for (const lixo of ["NaN", "Infinity", "[object Object]", "undefined", "null"]) {
      expect(container.textContent).not.toContain(lixo);
    }
  });

  it("a unidade da coluna é a mesma antes e depois da divisão", () => {
    // Dividir por uma CONTAGEM não muda a unidade: kg dividido em 3 partes
    // continua kg. A coluna "Unidade" da linha é a única que a declara.
    const { container } = render(
      <ProductionOrderPdf order={ordemFracionada("2", 3)} cost={null} generatedAt={GERADO_EM} />,
    );
    const colunas = celulasDaMateriaPrima(container);
    expect(colunas[2]!.textContent).toBe("kg");
  });
});

/** Toda fonte de `src/pdf` que monta documento — teste e apoio de teste ficam fora. */
function fontesDoPdf(): string[] {
  const raiz = process.cwd();
  const achadas: string[] = [];
  const visitar = (pasta: string) => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== "testing") visitar(caminho);
      } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
        achadas.push(relative(raiz, caminho).split(sep).join("/"));
      }
    }
  };
  visitar(join(raiz, "src/pdf"));
  return achadas.sort();
}

describe("impressos não recalculam Decimal de domínio por Number", () => {
  it("a fonte de `src/print/` prova", () => {
    /*
     * Gate de fonte: um teste de saída sozinho não pega a reintrodução de um
     * float que só erra em valor grande ou em divisão inexata. O documento não
     * decide regra e não inventa precisão — ele lê o resultado autoritativo.
     *
     * Os documentos saíram de `src/print/documents.tsx` para `src/pdf/`, e a
     * varredura foi junto: toda fonte de `src/pdf` (menos teste e apoio de
     * teste), o rateio por parte e o esqueleto de impressão HTML que ainda
     * serve às páginas pendentes.
     */
    const pdf = fontesDoPdf();
    // A varredura acha o que precisa achar: caminho errado não passa em branco.
    for (const esperado of [
      "src/pdf/components.tsx",
      "src/pdf/format.ts",
      "src/pdf/documents/QuotePdf.tsx",
      "src/pdf/documents/CustomerOrderPdf.tsx",
      "src/pdf/documents/PurchaseOrderPdf.tsx",
      "src/pdf/documents/ReceiptPdf.tsx",
      "src/pdf/documents/ProductionOrderPdf.tsx",
      "src/pdf/documents/RecipeSheetPdf.tsx",
      "src/pdf/documents/ShipmentPdf.tsx",
      "src/pdf/documents/BillingPdf.tsx",
      "src/pdf/documents/LotTraceabilityPdf.tsx",
    ]) {
      expect(pdf).toContain(esperado);
    }

    const violacoes: string[] = [];
    for (const arquivo of [
      ...pdf,
      "src/lib/part-share.ts",
    ]) {
      const fonte = readFileSync(join(process.cwd(), arquivo), "utf8");
      const corpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/Number\(/.test(corpo)) violacoes.push(`${arquivo} converte Decimal para Number`);
      if (corpo.includes("parseFloat")) violacoes.push(`${arquivo} usa parseFloat`);
      if (corpo.includes("Math.round")) violacoes.push(`${arquivo} usa Math.round`);
      if (corpo.includes("toFixed")) violacoes.push(`${arquivo} usa toFixed`);
      /*
       * `toLocaleString` NÃO entra no gate: nos helpers de data ele formata
       * `Date`, que é o uso legítimo. O que o documento não pode fazer é
       * aritmética de Decimal — e nenhum valor decimal chega aqui como
       * `number`, então não há caminho para formatá-lo por locale sem antes
       * passar por um `Number(`, que o gate acima já barra.
       */
    }
    // Todas de uma vez: o gate diz cada arquivo que precisa de conserto.
    expect(violacoes).toEqual([]);
  });
});
