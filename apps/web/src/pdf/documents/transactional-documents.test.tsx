// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { calcularTotaisOrdemCompra, Decimal, totalDoFaturamento } from "@veridi/shared";
import type {
  BillingDTO,
  BillingLineDTO,
  ControlledDocumentRevisionDTO,
  CustomerOrderDTO,
  CustomerOrderLineDTO,
  FinishedLotTraceabilityDTO,
  LotDTO,
  MaterialReservationLineDTO,
  ProductionOrderDTO,
  ProductionOrderMaterialCostDTO,
  ProductionOrderRequirementDTO,
  PurchaseOrderDTO,
  PurchaseOrderLineDTO,
  RawMaterialLotTraceabilityDTO,
  ReceiptDTO,
  ReceiptLineDTO,
  RecipeSheetDTO,
  RecipeSheetPartDTO,
  RecipeSheetRequirementDTO,
  RecipeWeighingDTO,
  ShipmentDTO,
  ShipmentLineDTO,
} from "@veridi/shared";
import { formatPartShare } from "../../lib/part-share";
import { renderPdfBlob } from "../render";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { BillingPdf, billingPdfFileName } from "./BillingPdf";
import { CustomerOrderPdf, customerOrderPdfFileName } from "./CustomerOrderPdf";
import { LotTraceabilityPdf, lotTraceabilityPdfFileName } from "./LotTraceabilityPdf";
import { ProductionOrderPdf, productionOrderPdfFileName } from "./ProductionOrderPdf";
import { PurchaseOrderPdf, purchaseOrderPdfFileName } from "./PurchaseOrderPdf";
import { ReceiptPdf, receiptPdfFileName } from "./ReceiptPdf";
import { RecipeSheetPdf, recipeSheetPdfFileName } from "./RecipeSheetPdf";
import { ShipmentPdf, shipmentPdfFileName } from "./ShipmentPdf";

/**
 * Os documentos transacionais como ARQUIVO: PDF real, lido de volta página por
 * página (a fundação é provada com o Orçamento em `pdf-generator.test.tsx`).
 *
 * Cada documento sai com dados realistas e linhas bastantes para passar de uma
 * folha: A4 (paisagem só na Folha de Receita), "Página X de Y" em toda folha,
 * cabeçalho da tabela repetido na folha em que ela continua, linha e detalhe
 * na mesma folha e nenhum rastro de navegador.
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");
const TEMPO = 60_000;

const n3 = (numero: number) => String(numero).padStart(3, "0");
const NOME_LONGO =
  "Colágeno Hidrolisado com Vitamina C e Ácido Hialurônico — Sachê 10 g — Sabor Frutas Vermelhas";
const NOME_LONGO_MP = "Óxido de Magnésio Pesado Grau Alimentício — Malha 325 — Origem Importada";
const CLIENTE = "Nutri Distribuidora de Suplementos Ltda";
const FORNECEDOR = "Fornecedora Brasileira de Insumos Nutricionais S.A.";

// ---------------------------------------------------------------- leitura

type Orientacao = "retrato" | "paisagem";

/** A4: 595,28 × 841,89 pt (o arquivo grava com 6 casas); paisagem troca os lados. */
function ehA4(mediaBox: string, orientacao: Orientacao): boolean {
  const [x, y, largura, altura] = mediaBox.split(/\s+/).map((valor) => Number.parseFloat(valor));
  const [l, a] = orientacao === "retrato" ? [595.28, 841.89] : [841.89, 595.28];
  return x === 0 && y === 0 && Math.abs((largura ?? 0) - l) < 0.01 && Math.abs((altura ?? 0) - a) < 0.01;
}

async function gerar(documento: ReactElement, amostra: string): Promise<PdfLido> {
  const blob = await renderPdfBlob(documento);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pasta = process.env["PDF_SAMPLES_DIR"];
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, amostra), bytes);
  }
  return lerPdf(bytes);
}

/** O que todo documento prova no arquivo: folha, paginação, identidade e nenhum rastro de navegador. */
function conferirArquivo(
  pdf: PdfLido,
  esperado: { titulo: string; codigo: string; orientacao?: Orientacao; minimoDePaginas?: number },
) {
  const total = pdf.paginas.length;
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(total).toBeGreaterThanOrEqual(esperado.minimoDePaginas ?? 1);
  expect(
    pdf.folhas.every((folha) => ehA4(folha, esperado.orientacao ?? "retrato")),
    pdf.folhas.join(" | "),
  ).toBe(true);

  pdf.paginas.forEach((texto, indice) => {
    expect(texto, `folha ${indice + 1}`).toContain(`Página ${indice + 1} de ${total}`);
    expect(texto, `folha ${indice + 1}`).toContain("Gerado em 11/09/2026 09:30");
    // Cabeçalho na primeira, cabeçalho corrido nas seguintes: a folha solta diz de onde é.
    expect(texto, `folha ${indice + 1}`).toContain(esperado.titulo);
    expect(texto, `folha ${indice + 1}`).toContain(esperado.codigo);
  });

  for (const rastro of ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"]) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(pdf.paginas.join("\n")).not.toContain(rastro);
  }
}

/**
 * Toda folha que tem linha da tabela longa tem o cabeçalho da tabela no topo
 * — e a tabela passa, de fato, de uma folha.
 */
function conferirCabecalhoRepetido(
  pdf: PdfLido,
  marcador: string,
  cabecalho: string[] | ((linha: string) => boolean),
) {
  const ehCabecalho =
    typeof cabecalho === "function" ? cabecalho : (linha: string) => cabecalho.every((c) => linha.includes(c));
  let folhasComLinha = 0;
  pdf.paginas.forEach((texto, indice) => {
    if (!texto.includes(marcador)) return;
    folhasComLinha += 1;
    expect(texto.split("\n").some(ehCabecalho), `folha ${indice + 1} sem o cabeçalho da tabela`).toBe(true);
  });
  expect(folhasComLinha, `"${marcador}" em uma folha só`).toBeGreaterThanOrEqual(2);
}

/** Linha principal e linha de detalhe nunca se separam entre folhas. */
function mesmaFolha(pdf: PdfLido, principal: string, detalhe: string) {
  const folha = pdf.paginas.findIndex((texto) => texto.includes(principal));
  expect(folha, principal).toBeGreaterThanOrEqual(0);
  expect(pdf.paginas[folha], `${principal} e ${detalhe} em folhas diferentes`).toContain(detalhe);
}

function folhaCom(pdf: PdfLido, trecho: string): number {
  const folha = pdf.paginas.findIndex((texto) => texto.includes(trecho));
  expect(folha, trecho).toBeGreaterThanOrEqual(0);
  return folha;
}

// ---------------------------------------------------------------- amostras

function pedidoDoCliente(): CustomerOrderDTO {
  const lines = Array.from({ length: 48 }, (_, i): CustomerOrderLineDTO => {
    const n = n3(i + 1);
    return {
      id: `col-${n}`,
      productId: `prd-${n}`,
      productCode: `PRD-${n}`,
      productName: i === 4 ? NOME_LONGO : `Produto de teste ${n}`,
      finishedItemId: `pa-${n}`,
      finishedItemCode: `PA-${n}`,
      finishedItemName: `Produto de teste ${n}`,
      orderedQuantity: `${1000 + i}`,
      unitCode: "un",
      position: i,
      shippedQuantity: "400",
      outstandingQuantity: `${600 + i}`,
      pendingProductionQuantity: "0",
      billedQuantity: i % 3 === 0 ? "400" : "0",
      unbilledShippedQuantity: i % 3 === 0 ? "0" : "400",
      sourceQuoteLineId: null,
      agreedPrice: null,
      productCustomerMismatch: false,
    };
  });
  return {
    id: "ord-45",
    code: "PED-000045",
    customerId: "cus-7",
    customerCode: "CLI-000007",
    customerName: CLIENTE,
    customerTradeName: "NutriMais",
    customerCnpj: "11222333000181",
    customerAddress: null,
    orderDate: "2026-08-01T00:00:00.000Z",
    requestedDeliveryDate: "2026-09-20T00:00:00.000Z",
    status: "IN_FULFILLMENT",
    notes: "Entrega fracionada conforme cronograma acordado com o cliente.",
    lines,
    commercialOrigin: {
      quoteVersionId: "qv-12",
      quoteCode: "ORC-000012",
      quoteVersionNumber: 2,
      projectId: "prj-12",
      projectCode: "PRJ-000012",
      subtotalAmount: null,
      discountPercent: null,
      totalAmount: null,
      paymentSchedule: null,
    },
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "PARTIALLY_BILLED",
    confirmedAt: "2026-08-02T13:00:00.000Z",
    confirmedBy: "Comercial",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    createdBy: "Comercial",
    updatedAt: "2026-09-10T12:00:00.000Z",
  } as unknown as CustomerOrderDTO;
}

function ordemDeCompra(): PurchaseOrderDTO {
  const base = Array.from({ length: 42 }, (_, i) => ({
    i,
    n: n3(i + 1),
    orderedQuantity: `${25 + i}.5`,
    unitPrice: i % 5 === 0 ? "4.0531" : "12.5",
  }));
  // O total é o do domínio: linha fechada em duas casas, soma das linhas.
  const { lineTotals, orderTotal } = calcularTotaisOrdemCompra(
    base.map(({ orderedQuantity, unitPrice }) => ({ orderedQuantity, unitPrice })),
  );
  const lines = base.map(
    ({ i, n, orderedQuantity, unitPrice }): PurchaseOrderLineDTO => ({
      id: `pol-${n}`,
      itemId: `mp-${n}`,
      itemCode: `MP-${n}`,
      itemName: i === 3 ? "Citrato de Magnésio Tri-hidratado Grau Farmacêutico — Pó Fino Micronizado" : `Insumo de teste ${n}`,
      unitCode: "kg",
      orderedQuantity,
      unitPrice,
      lineTotal: lineTotals[i] ?? null,
      receivedQuantity: i < 12 ? orderedQuantity : "0",
      openQuantity: i < 12 ? "0" : orderedQuantity,
    }),
  );
  return {
    id: "po-12",
    code: "OC-000012",
    supplierId: "sup-3",
    supplierCode: "FOR-000003",
    supplierName: FORNECEDOR,
    supplierCnpj: "11444777000161",
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: "2026-09-15T00:00:00.000Z",
    status: "PARTIALLY_RECEIVED",
    notes: "Entregar no recebimento de matérias-primas, doca 2, das 8h às 16h. Laudo (CoA) obrigatório por lote.",
    lines,
    orderTotal,
    origin: "CUSTOMER_ORDER",
    customerOrderId: "ord-45",
    customerOrderCode: "PED-000045",
    orderedAt: "2026-09-01T13:00:00.000Z",
    orderedBy: "Compras",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
    receipts: [],
  };
}

function recebimento(): ReceiptDTO {
  const lines = Array.from({ length: 30 }, (_, i): ReceiptLineDTO => {
    const n = n3(i + 1);
    return {
      id: `rl-${n}`,
      purchaseOrderLineId: `pol-${n}`,
      itemId: `mp-${n}`,
      itemCode: `MP-${n}`,
      itemName: i === 2 ? "Citrato de Magnésio Tri-hidratado Grau Farmacêutico — Pó Fino Micronizado" : `Insumo recebido ${n}`,
      unitCode: "kg",
      receivedQuantity: `${25 + i}.5`,
      supplierLot: i === 7 ? null : `FORN-LOTE-${n}`,
      expiryDate: i === 9 ? null : "2027-10-10T00:00:00.000Z",
      location: i % 6 === 0 ? null : `Estante A-${n}`,
      lotId: `lot-${n}`,
      lotCode: `LT-20260910-000${n}`,
      ownerType: "VERIDI",
      coaStatus: "APPROVED",
      purchaseUnitPrice: i % 5 === 0 ? "4.0531" : "12.5",
      actualUnitCost: i % 4 === 0 ? null : "12.87",
      costUpdatedAt: null,
      costUpdatedBy: null,
      costNote: null,
    };
  });
  return {
    id: "rec-31",
    code: "REC-000031",
    sourceType: "PURCHASE_ORDER",
    purchaseOrderId: "po-12",
    purchaseOrderCode: "OC-000012",
    supplierId: "sup-3",
    supplierCode: "FOR-000003",
    supplierName: FORNECEDOR,
    customerId: null,
    customerCode: null,
    customerName: null,
    receivedAt: "2026-09-10T00:00:00.000Z",
    invoiceNumber: "NF 18.452",
    documentReference: "Romaneio 7781",
    notes: null,
    lines,
    createdAt: "2026-09-10T14:00:00.000Z",
    createdBy: "Recebimento — Doca 2",
  };
}

const REVISAO_OP: ControlledDocumentRevisionDTO = {
  id: "rev-op-3",
  type: "PRODUCTION_ORDER",
  documentCode: "R.PRO.002",
  title: "Ordem de Produção",
  revision: "03",
  revisionDate: "2026-02-01T00:00:00.000Z",
  preparedByUserId: "u-1",
  preparedByName: "Mariana Albuquerque (Qualidade)",
  approvedByUserId: "u-2",
  approvedByName: "Ricardo Menezes (Responsável Técnico)",
  active: true,
  createdAt: "2026-02-01T12:00:00.000Z",
};

function requisito(numero: number, tipo: "RAW_MATERIAL" | "PACKAGING"): ProductionOrderRequirementDTO {
  const n = n3(numero);
  const materiaPrima = tipo === "RAW_MATERIAL";
  const doCliente = materiaPrima && numero % 7 === 0;
  const necessario = materiaPrima ? `${2 + numero}.125` : `${4850 + numero}`;
  return {
    id: `req-${tipo}-${n}`,
    itemId: `item-${tipo}-${n}`,
    itemCode: materiaPrima ? `MP-${n}` : `EMB-${n}`,
    itemName: materiaPrima ? (numero === 5 ? NOME_LONGO_MP : `Matéria-prima de teste ${n}`) : `Embalagem de teste ${n}`,
    itemType: tipo,
    formulaQuantity: "1",
    formulaUnitCode: materiaPrima ? "kg" : "un",
    supplyResponsibility: doCliente ? "CUSTOMER" : "VERIDI",
    eligibleOwnerType: doCliente ? "CUSTOMER" : "VERIDI",
    eligibleOwnerCustomerId: doCliente ? "cus-7" : null,
    eligibleOwnerCustomerName: doCliente ? CLIENTE : null,
    requiredQuantity: necessario,
    stockUnitCode: materiaPrima ? "kg" : "un",
    position: numero,
    onHand: "500",
    reserved: necessario,
    available: "480",
    onOrder: "0",
    shortage: numero === 9 ? "1.5" : "0",
    availabilityStatus: numero === 9 ? "SHORTAGE" : "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: necessario,
    consumedQuantity: materiaPrima ? necessario : "0",
    remainingReservedQuantity: "0",
    reservationLines: [],
    reconciliationStatus: "RECONCILED",
    unreconciledQuantity: "0",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  };
}

const AMPLIACAO: MaterialReservationLineDTO = {
  id: "rl-extra-1",
  itemId: "item-RAW_MATERIAL-003",
  itemCode: "MP-003",
  itemName: "Matéria-prima de teste 003",
  lotId: "lot-x",
  lotCode: "LT-20260901-000077",
  supplierLot: "FORN-77",
  expiryDate: null,
  location: null,
  lotStatus: "AVAILABLE",
  quantity: "1.5",
  unitCode: "kg",
  consumedQuantity: "1.5",
  remainingQuantity: "0",
  pickingStatus: "CONFIRMED",
  pickedAt: "2026-09-03T14:00:00.000Z",
  pickedBy: "Operador Silva",
  releasedAt: null,
  releasedBy: null,
  releaseReason: null,
  replacesLineId: null,
  extraReason: "Perda na peneiração — reposição autorizada pela supervisão",
  extraRequestedBy: "Supervisora Andrade",
  extraRequestedAt: "2026-09-03T14:10:00.000Z",
  lotFreeQuantity: "10",
};

function ordemDeProducao(): ProductionOrderDTO {
  const materiasPrimas = Array.from({ length: 24 }, (_, i) => requisito(i + 1, "RAW_MATERIAL"));
  materiasPrimas[2] = { ...materiasPrimas[2]!, reservationLines: [AMPLIACAO] };
  const embalagens = Array.from({ length: 4 }, (_, i) => requisito(i + 1, "PACKAGING"));
  return {
    id: "op-10",
    code: "OP-000010",
    productId: "prd-12",
    productCode: "PRD-012",
    productName: "Whey Protein Isolado 900 g — Baunilha",
    finishedItemId: "pa-12",
    finishedItemCode: "PA-000012",
    finishedItemName: "Whey Protein Isolado 900 g — Baunilha",
    formulationVersionId: "fv-2",
    formulationVersionNumber: 2,
    formulationVersionLabel: "V2",
    plannedQuantity: "5000",
    outputUnitCode: "un",
    productionFactor: "5",
    status: "IN_PRODUCTION",
    origin: "CUSTOMER_ORDER",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 1,
    materialReconciliation: {
      totalRequirements: 28,
      reconciledRequirements: 24,
      pendingRequirements: 4,
      canComplete: false,
    },
    notes: null,
    customerId: "cus-7",
    customerCode: "CLI-000007",
    customerName: CLIENTE,
    customerCnpj: "11222333000181",
    customerTradeName: "NutriMais",
    customerZipCode: "13010-000",
    customerStreet: "Rua das Palmeiras",
    customerNumber: "1234",
    customerComplement: "Sala 5",
    customerDistrict: "Centro",
    customerCity: "Campinas",
    customerState: "SP",
    hasCustomerSuppliedRequirements: true,
    officialNumber: "007/26",
    numberOfParts: 3,
    labelInstructions: "Imprimir lote e validade no fundo da lata; não usar etiqueta adesiva.",
    shelfLifeMonths: 24,
    suggestedBusinessLotNumber: "260903-A",
    productionOrderRevision: REVISAO_OP,
    recipeSheetRevision: null,
    requirements: [...materiasPrimas, ...embalagens],
    plannedAt: "2026-09-01T12:00:00.000Z",
    plannedBy: "PCP",
    releasedAt: "2026-09-02T12:00:00.000Z",
    releasedBy: "PCP",
    reservation: null,
    startedAt: "2026-09-03T11:00:00.000Z",
    startedBy: "Operador Silva",
    consumptions: materiasPrimas.map((requirement, i) => ({
      id: `cons-${n3(i + 1)}`,
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      lotId: `lot-c-${n3(i + 1)}`,
      lotCode: `LT-20260820-000${n3(i + 1)}`,
      quantity: requirement.requiredQuantity,
      unitCode: "kg",
      consumedAt: "2026-09-03T11:15:00.000Z",
      consumedBy: i % 2 === 0 ? "Operador Silva" : "Operadora Lima",
    })),
    producedQuantity: "4850",
    remainingQuantity: "150",
    outputs: [
      {
        id: "out-1",
        quantity: "2500",
        lotId: "lot-pa-1",
        lotCode: "LT-20260903-000101",
        businessLotNumber: "260903-A",
        producedAt: "2026-09-03T18:00:00.000Z",
        producedBy: "Operador Silva",
        notes: null,
      },
      {
        id: "out-2",
        quantity: "2350",
        lotId: "lot-pa-1",
        lotCode: "LT-20260903-000101",
        businessLotNumber: "260903-A",
        producedAt: "2026-09-04T12:30:00.000Z",
        producedBy: "Operadora Lima",
        notes: null,
      },
    ],
    eligibleFinishedLots: [],
    customerOrderId: "ord-45",
    customerOrderCode: "PED-000045",
    customerOrderLineId: "col-001",
    completedAt: null,
    completedBy: null,
    completionReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T11:00:00.000Z",
    createdBy: "PCP",
    updatedAt: "2026-09-04T12:30:00.000Z",
  };
}

const CUSTO_REAL: ProductionOrderMaterialCostDTO = {
  productionOrderId: "op-10",
  consumptions: [],
  quality: "REAL",
  hasCustomerSuppliedMaterials: true,
  customerSuppliedConsumptionCount: 3,
  totalMaterialCost: "18734.52",
  knownMaterialCostSubtotal: "18734.52",
  producedQuantity: "4850",
  outputUnitCode: "un",
  materialUnitCost: "3.86",
  missingCostItems: [],
};

function parteDaFolha(
  numero: number,
  status: RecipeSheetPartDTO["status"],
  pesagens: number,
  consumido: string,
): RecipeSheetPartDTO {
  const requisitos = Array.from({ length: 14 }, (_, i): RecipeSheetRequirementDTO => {
    const n = n3(i + 1);
    return {
      requirementId: `req-RAW_MATERIAL-${n}`,
      itemId: `item-RAW_MATERIAL-${n}`,
      itemCode: `MP-${n}`,
      itemName: i === 4 ? NOME_LONGO_MP : `Matéria-prima de teste ${n}`,
      sourceName: i % 3 === 0 ? "Citrato de magnésio (fonte de Mg)" : null,
      declaredNutrient: null,
      supplyResponsibility: i % 7 === 6 ? "CUSTOMER" : "VERIDI",
      expectedOwnerCustomerName: i % 7 === 6 ? CLIENTE : null,
      plannedQuantity: "2.041666",
      weighedQuantity: "0",
      consumedQuantity: consumido,
      differenceQuantity: "0",
      unitCode: "kg",
      reservedLots: [],
    };
  });
  const weighings = Array.from({ length: pesagens }, (_, i): RecipeWeighingDTO => {
    const requisito = requisitos[i]!;
    return {
      id: `w-${numero}-${n3(i + 1)}`,
      productionOrderPartId: `part-${numero}`,
      productionOrderRequirementId: requisito.requirementId,
      itemId: requisito.itemId,
      itemCode: requisito.itemCode,
      itemName: requisito.itemName,
      lotId: `lot-c-${n3(i + 1)}`,
      lotCode: `LT-20260820-000${n3(i + 1)}`,
      supplierLot: i === 3 ? null : `FORN-${n3(i + 1)}`,
      ownerType: i % 7 === 6 ? "CUSTOMER" : "VERIDI",
      plannedQuantity: "2.041666",
      actualQuantity: i === 1 ? "2.0433" : "2.041666",
      uomCode: "kg",
      executedByUserId: "u-9",
      executedByName: i % 2 === 0 ? "Operador Silva" : "Operadora Lima",
      executedAt: `2026-09-03T1${numero}:${String(10 + i).padStart(2, "0")}:00.000Z`,
      productionConsumptionId: null,
      notes: i === 2 ? "Balança 2 recalibrada antes da pesagem; tara conferida" : null,
    };
  });
  return {
    id: `part-${numero}`,
    partNumber: numero,
    status,
    startedAt: status === "PENDING" ? null : "2026-09-03T11:00:00.000Z",
    startedByName: status === "PENDING" ? null : "Operador Silva",
    completedAt: status === "COMPLETED" ? "2026-09-03T15:40:00.000Z" : null,
    completedByName: status === "COMPLETED" ? "Supervisora Andrade" : null,
    requirements: requisitos,
    weighings,
  };
}

function folhaDeReceita(): RecipeSheetDTO {
  return {
    productionOrderId: "op-10",
    recipeSheetRevision: {
      ...REVISAO_OP,
      id: "rev-fr-2",
      type: "RECIPE_SHEET",
      documentCode: "R.COQ.003",
      title: "Folha de Receita",
      revision: "02",
    },
    productionOrderCode: "OP-000010",
    officialNumber: "007/26",
    productId: "prd-12",
    productCode: "PRD-012",
    productName: "Whey Protein Isolado 900 g — Baunilha",
    customerName: CLIENTE,
    formulationVersionLabel: "V2",
    plannedQuantity: "5000",
    outputUnitCode: "un",
    numberOfParts: 3,
    status: "IN_PRODUCTION",
    parts: [
      parteDaFolha(1, "COMPLETED", 14, "0"),
      parteDaFolha(2, "IN_PROGRESS", 8, "0"),
      // Parte sem pesagem numa OP que já baixou material pelo Consumo Real.
      parteDaFolha(3, "PENDING", 0, "2.041666"),
    ],
    packagingRequirements: Array.from({ length: 4 }, (_, i) => ({
      requirementId: `req-PACKAGING-${n3(i + 1)}`,
      itemId: `item-PACKAGING-${n3(i + 1)}`,
      itemCode: `EMB-${n3(i + 1)}`,
      itemName: `Embalagem de teste ${n3(i + 1)}`,
      supplyResponsibility: i === 1 ? "CUSTOMER" : "VERIDI",
      totalQuantity: `${4850 + i}`,
      unitCode: "un",
    })),
  };
}

function expedicao(): ShipmentDTO {
  const lines = Array.from({ length: 36 }, (_, i): ShipmentLineDTO => {
    const n = n3(i + 1);
    return {
      id: `sl-${n}`,
      customerOrderLineId: `col-${n}`,
      customerOrderReservationLineId: `crl-${n}`,
      productId: `prd-${n}`,
      productCode: `PRD-${n}`,
      productName: i === 3 ? NOME_LONGO : `Produto expedido ${n}`,
      itemId: `pa-${n}`,
      finishedItemCode: `PA-${n}`,
      finishedItemName: `Produto expedido ${n}`,
      lotId: `lot-${n}`,
      lotCode: `LT-20260905-000${n}`,
      businessLotNumber: `260905-${n}`,
      expiryDate: "2028-09-05T00:00:00.000Z",
      location: "Expedição",
      quantity: `${120 + i}`,
      unitCode: "un",
      position: i,
      reservedRemaining: "0",
      requiresVerification: true,
      verifiedAt: "2026-09-10T13:05:00.000Z",
      verifiedBy: `Conferente ${n}`,
      deliverySequence: null,
      deliveryScheduledDate: null,
    };
  });
  return {
    id: "shp-31",
    code: "EXP-000031",
    customerOrderId: "ord-45",
    customerOrderCode: "PED-000045",
    customerId: "cus-7",
    customerName: CLIENTE,
    status: "CONFIRMED",
    shipmentDate: "2026-09-10T00:00:00.000Z",
    notes: null,
    lines,
    products: [],
    verification: { productCount: 36, lotsRequired: 36, lotsVerified: 36, allLotsVerified: true },
    totalQuantity: "4950",
    billingStatus: "PENDING",
    billingId: null,
    billingCode: null,
    confirmedAt: "2026-09-10T17:40:00.000Z",
    confirmedBy: "Expedição — Souza",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-10T12:00:00.000Z",
    createdBy: "Expedição",
    updatedAt: "2026-09-10T17:40:00.000Z",
  };
}

function faturamento(): BillingDTO {
  const lines = Array.from({ length: 36 }, (_, i): BillingLineDTO => {
    const n = n3(i + 1);
    const quantity = `${120 + i}`;
    const unitPrice = i % 4 === 0 ? "10.4531" : "10";
    return {
      id: `bl-${n}`,
      shipmentLineId: `sl-${n}`,
      customerOrderLineId: `col-${n}`,
      productId: `prd-${n}`,
      productCode: `PRD-${n}`,
      productName: i === 3 ? NOME_LONGO : `Produto faturado ${n}`,
      itemId: `pa-${n}`,
      itemCode: `PA-${n}`,
      itemName: `Produto faturado ${n}`,
      lotId: `lot-${n}`,
      lotCode: `LT-20260905-000${n}`,
      businessLotNumber: `260905-${n}`,
      quantity,
      unitCode: "un",
      agreedUnitPrice: unitPrice,
      unitPrice,
      lineTotal: new Decimal(quantity).times(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      priceOverridden: false,
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
      position: i,
    };
  });
  const grossAmount = lines.reduce((soma, linha) => soma.plus(linha.lineTotal!), new Decimal(0)).toFixed(2);
  const discountAmount = new Decimal(grossAmount).times("0.05").toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  const commercialAdjustmentAmount = "-0.03";
  return {
    id: "bil-123",
    code: "FAT-000123",
    customerOrderId: "ord-45",
    customerOrderCode: "PED-000045",
    shipmentId: "shp-31",
    shipmentCode: "EXP-000031",
    shipmentDate: "2026-09-10T00:00:00.000Z",
    customerId: "cus-7",
    customerCode: "CLI-000007",
    customerName: CLIENTE,
    customerTradeName: "NutriMais",
    customerCnpj: "11222333000181",
    status: "ISSUED",
    externalReference: "NF 4567",
    notes: null,
    lines,
    totalQuantity: "4950",
    grossAmount,
    discountPercentSnapshot: "5.0000",
    discountAmount,
    commercialAdjustmentAmount,
    totalAmount: totalDoFaturamento(grossAmount, discountAmount, commercialAdjustmentAmount),
    hasCompletePricing: true,
    issuedAt: "2026-09-11T12:00:00.000Z",
    issuedBy: "Faturamento — Oliveira",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-11T11:00:00.000Z",
    createdBy: "Faturamento — Oliveira",
    updatedAt: "2026-09-11T12:00:00.000Z",
  };
}

function lote(extra: Partial<LotDTO>): LotDTO {
  return {
    id: "lot",
    code: "LT",
    qrPayload: "LOT:LT",
    origin: "PRODUCTION",
    itemId: "item",
    itemCode: "ITEM",
    itemName: "Item",
    unitCode: "un",
    ownerType: "VERIDI",
    ownerCustomerId: null,
    ownerCustomerCode: null,
    ownerCustomerName: null,
    requiresCoa: false,
    coaStatus: "NOT_REQUIRED",
    coaReviewedAt: null,
    coaReviewedByName: null,
    coaReviewNote: null,
    supplierId: null,
    supplierCode: null,
    supplierName: null,
    supplierLot: null,
    businessLotNumber: null,
    expiryDate: null,
    isExpired: false,
    initialReceivedQuantity: "0",
    producedQuantity: null,
    onHand: "0",
    reserved: "0",
    available: "0",
    status: "AVAILABLE",
    location: null,
    receiptId: null,
    receiptCode: null,
    purchaseOrderId: null,
    purchaseOrderCode: null,
    productionOrderId: null,
    productionOrderCode: null,
    createdAt: "2026-09-03T18:00:00.000Z",
    createdBy: "Operador Silva",
    releasedAt: null,
    releasedBy: null,
    blockedAt: null,
    blockedBy: null,
    blockReason: null,
    shipments: [],
    ...extra,
  };
}

const LOTE_ACABADO = lote({
  id: "lot-pa-1",
  code: "LT-20260903-000101",
  qrPayload: "LOT:LT-20260903-000101",
  itemId: "pa-12",
  itemCode: "PA-000012",
  itemName: "Whey Protein Isolado 900 g — Baunilha",
  businessLotNumber: "260903-A",
  expiryDate: "2028-09-03T00:00:00.000Z",
  initialReceivedQuantity: "2500",
  producedQuantity: "4850",
  onHand: "1200",
  available: "1200",
  productionOrderId: "op-10",
  productionOrderCode: "OP-000010",
});

function rastroAcabado(): FinishedLotTraceabilityDTO {
  return {
    kind: "FINISHED_GOOD",
    lotId: "lot-pa-1",
    lotCode: "LT-20260903-000101",
    businessLotNumber: "260903-A",
    productionOrderId: "op-10",
    productionOrderCode: "OP-000010",
    productId: "prd-12",
    productCode: "PRD-012",
    productName: "Whey Protein Isolado 900 g — Baunilha",
    producedQuantity: "4850",
    unitCode: "un",
    consumedMaterials: Array.from({ length: 34 }, (_, i) => {
      const n = n3(i + 1);
      const doCliente = i % 7 === 6;
      return {
        itemId: `item-${n}`,
        itemCode: `MP-${n}`,
        itemName: i === 4 ? NOME_LONGO_MP : `Matéria-prima consumida ${n}`,
        lotId: `lot-c-${n}`,
        lotCode: `LT-20260820-000${n}`,
        supplierLot: doCliente ? null : `FORN-${n}`,
        supplierName: doCliente ? null : FORNECEDOR,
        ownerType: doCliente ? ("CUSTOMER" as const) : ("VERIDI" as const),
        ownerCustomerName: doCliente ? CLIENTE : null,
        coaStatus: "APPROVED" as const,
        quantity: `${2 + i}.125`,
        unitCode: "kg",
      };
    }),
    commercialDestination: {
      customerOrderId: "ord-45",
      customerOrderCode: "PED-000045",
      customerId: "cus-7",
      customerCode: "CLI-000007",
      customerName: CLIENTE,
      projectId: "prj-12",
      projectCode: "PRJ-000012",
      projectName: "Linha Whey Premium",
      shipments: Array.from({ length: 12 }, (_, i) => {
        // Um lote produzido para um pedido pode sair atendendo outro.
        const outroPedido = i === 5;
        return {
          shipmentId: `shp-${n3(i + 1)}`,
          shipmentCode: `EXP-000${n3(30 + i)}`,
          shipmentDate: "2026-09-10T00:00:00.000Z",
          quantity: `${100 + i * 5}`,
          customerOrderId: outroPedido ? "ord-46" : "ord-45",
          customerOrderCode: outroPedido ? "PED-000046" : "PED-000045",
          customerId: outroPedido ? "cus-9" : "cus-7",
          customerCode: outroPedido ? "CLI-000009" : "CLI-000007",
          customerName: outroPedido ? "Academia Força Total Comércio de Suplementos Eireli" : CLIENTE,
        };
      }),
    },
  };
}

const LOTE_INSUMO = lote({
  id: "lot-mp-3",
  code: "LT-20260820-000003",
  qrPayload: "LOT:LT-20260820-000003",
  origin: "RECEIPT",
  itemId: "mp-3",
  itemCode: "MP-003",
  itemName: "Citrato de Magnésio Tri-hidratado Grau Farmacêutico",
  unitCode: "kg",
  requiresCoa: true,
  coaStatus: "APPROVED",
  supplierId: "sup-3",
  supplierCode: "FOR-000003",
  supplierName: FORNECEDOR,
  supplierLot: "FORN-003",
  expiryDate: "2027-08-20T00:00:00.000Z",
  initialReceivedQuantity: "250",
  onHand: "118.5",
  available: "118.5",
  receiptId: "rec-29",
  receiptCode: "REC-000029",
  purchaseOrderId: "po-11",
  purchaseOrderCode: "OC-000011",
});

function rastroInsumo(): RawMaterialLotTraceabilityDTO {
  return {
    kind: "RAW_MATERIAL",
    lotId: "lot-mp-3",
    lotCode: "LT-20260820-000003",
    itemId: "mp-3",
    itemCode: "MP-003",
    itemName: "Citrato de Magnésio Tri-hidratado Grau Farmacêutico",
    coaStatus: "APPROVED",
    coaDocuments: [],
    usedIn: Array.from({ length: 14 }, (_, i) => ({
      productionOrderId: `op-${n3(10 + i)}`,
      productionOrderCode: `OP-000${n3(10 + i)}`,
      productId: `prd-${n3(12 + i)}`,
      productCode: `PRD-${n3(12 + i)}`,
      productName: i === 2 ? NOME_LONGO : `Produto acabado de teste ${n3(12 + i)}`,
      consumedQuantity: `${3 + i}.5`,
      unitCode: "kg",
      finishedLots:
        i % 3 === 0
          ? []
          : [
              { lotId: `lot-pa-${i}`, lotCode: `LT-20260903-000${n3(101 + i)}`, businessLotNumber: null, producedQuantity: "2500" },
              ...(i % 3 === 2
                ? [{ lotId: `lot-pb-${i}`, lotCode: `LT-20260904-000${n3(201 + i)}`, businessLotNumber: null, producedQuantity: "2350" }]
                : []),
            ],
    })),
    usedInSamples: Array.from({ length: 5 }, (_, i) => ({
      sampleId: `amo-${i + 1}`,
      sampleCode: `AMO-${n3(i + 1)}`,
      testLabel: `Teste de solubilidade — piloto ${i + 1}`,
      projectId: "prj-12",
      projectCode: "PRJ-000012",
      projectName: "Linha Whey Premium",
      customerName: CLIENTE,
      sampleStatus: "PRODUCED" as const,
      consumedQuantity: "0.25",
      unitCode: "kg",
      consumedAt: "2026-08-25T15:00:00.000Z",
    })),
  };
}

// ---------------------------------------------------------------- provas

describe("gerador de PDF — documentos transacionais", () => {
  it(
    "Pedido do cliente: várias folhas, cabeçalho de tabela repetido e aviso interno em toda folha",
    async () => {
      const pdf = await gerar(<CustomerOrderPdf order={pedidoDoCliente()} generatedAt={GERADO_EM} />, "PED-000045.pdf");

      conferirArquivo(pdf, { titulo: "PEDIDO DO CLIENTE", codigo: "PED-000045", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(pdf, "Produto de teste", ["PRODUTO", "PEDIDO", "FATURADO", "UNIDADE"]);
      for (const texto of pdf.paginas) expect(texto).toContain("Documento interno");
      expect(pdf.paginas[0]).toContain("Status: Em atendimento");
      // Paridade com o impresso HTML (PDF-DATA-PARITY-01): o cliente está no papel.
      expect(pdf.paginas[0]).toContain(CLIENTE);
    },
    TEMPO,
  );

  it(
    "Ordem de compra: várias folhas e o valor previsto depois da última linha",
    async () => {
      const pdf = await gerar(<PurchaseOrderPdf order={ordemDeCompra()} generatedAt={GERADO_EM} />, "OC-000012.pdf");

      conferirArquivo(pdf, { titulo: "ORDEM DE COMPRA", codigo: "OC-000012", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(pdf, "Insumo de teste", ["ITEM", "QUANTIDADE", "RECEBIDO", "UNIDADE"]);
      expect(folhaCom(pdf, "VALOR PREVISTO")).toBeGreaterThanOrEqual(folhaCom(pdf, "Insumo de teste 042"));
      // Paridade com o impresso HTML (PDF-DATA-PARITY-01): o fornecedor está no papel.
      expect(pdf.paginas[0]).toContain(FORNECEDOR);
    },
    TEMPO,
  );

  it(
    "Recebimento: várias folhas, e o lote do fornecedor na mesma folha do item",
    async () => {
      const dados = recebimento();
      const pdf = await gerar(<ReceiptPdf receipt={dados} generatedAt={GERADO_EM} />, "REC-000031.pdf");

      conferirArquivo(pdf, { titulo: "RECEBIMENTO", codigo: "REC-000031", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(pdf, "Insumo recebido", ["ITEM", "LOTE INTERNO", "QUANTIDADE", "UNIDADE"]);
      for (const linha of dados.lines.filter((l) => l.itemName.startsWith("Insumo recebido") && l.supplierLot)) {
        mesmaFolha(pdf, linha.itemName, linha.supplierLot!);
      }
      // Paridade com o impresso HTML (PDF-DATA-PARITY-01): o fornecedor está no papel.
      expect(pdf.paginas[0]).toContain(FORNECEDOR);
    },
    TEMPO,
  );

  it(
    "Ordem de produção: documento controlado em toda folha, várias folhas e o rateio do motor",
    async () => {
      const ordem = ordemDeProducao();
      const pdf = await gerar(<ProductionOrderPdf order={ordem} cost={CUSTO_REAL} generatedAt={GERADO_EM} />, "OP-007-26.pdf");

      conferirArquivo(pdf, { titulo: "ORDEM DE PRODUÇÃO", codigo: "007/26", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(
        pdf,
        "Matéria-prima de teste",
        (linha) => linha.includes("ITEM") && (linha.includes("NECESSÁRIO") || linha.includes("QUANTIDADE")),
      );
      for (const texto of pdf.paginas) expect(texto).toContain("R.PRO.002");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("DOCUMENTO CONTROLADO");
      expect(tudo).toContain("CONSUMO EXTRA AUTORIZADO");
      // A coluna "Por parte" é o rateio do motor, e cabe inteira na célula.
      expect(tudo).toContain(formatPartShare(ordem.requirements[0]!.requiredQuantity, 3));
    },
    TEMPO,
  );

  it(
    "Folha de receita: paisagem, 11 colunas por parte e o registro via Consumo Real",
    async () => {
      const pdf = await gerar(
        <RecipeSheetPdf sheet={folhaDeReceita()} generatedAt={GERADO_EM} />,
        "Folha-de-Receita-OP-007-26.pdf",
      );

      conferirArquivo(pdf, {
        titulo: "FOLHA DE RECEITA",
        codigo: "007/26",
        orientacao: "paisagem",
        minimoDePaginas: 2,
      });
      // O lote interno tem largura fixa e não quebra: marca a folha que tem pesagem.
      conferirCabecalhoRepetido(pdf, "LT-20260820-000", ["ITEM", "FONTE", "PLANEJADO", "PESADO"]);
      for (const texto of pdf.paginas) expect(texto).toContain("R.COQ.003");
      const tudo = pdf.paginas.join("\n");
      // A coluna onde a operação escreve cabe na folha.
      expect(tudo).toContain("OBSERVAÇÃO");
      expect(tudo).toContain("Material registrado via Consumo Real da OP.");
    },
    TEMPO,
  );

  it(
    "Expedição: aviso fiscal em toda folha, e produto e conferência na mesma folha",
    async () => {
      const dados = expedicao();
      const pdf = await gerar(<ShipmentPdf shipment={dados} generatedAt={GERADO_EM} />, "EXP-000031.pdf");

      conferirArquivo(pdf, { titulo: "EXPEDIÇÃO", codigo: "EXP-000031", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(pdf, "Produto expedido", ["PRODUTO", "LOTE", "QUANTIDADE", "UNIDADE"]);
      for (const texto of pdf.paginas) expect(texto).toContain("não é Nota Fiscal");
      for (const linha of dados.lines.filter((l) => l.productName.startsWith("Produto expedido"))) {
        mesmaFolha(pdf, linha.productName, linha.verifiedBy!);
      }
    },
    TEMPO,
  );

  it(
    "Faturamento: aviso fiscal em toda folha, lotes junto da linha e totais depois da última",
    async () => {
      const dados = faturamento();
      const pdf = await gerar(<BillingPdf billing={dados} generatedAt={GERADO_EM} />, "FAT-000123.pdf");

      conferirArquivo(pdf, { titulo: "FATURAMENTO", codigo: "FAT-000123", minimoDePaginas: 2 });
      conferirCabecalhoRepetido(pdf, "Produto faturado", ["PRODUTO", "QUANTIDADE", "PREÇO UNITÁRIO", "TOTAL"]);
      for (const texto of pdf.paginas) expect(texto).toContain("não é Nota Fiscal");
      for (const linha of dados.lines.filter((l) => l.productName.startsWith("Produto faturado"))) {
        mesmaFolha(pdf, linha.productName, linha.businessLotNumber!);
      }
      const folhaDoTotal = folhaCom(pdf, "VALOR TOTAL");
      expect(folhaDoTotal).toBeGreaterThanOrEqual(folhaCom(pdf, "Produto faturado 036"));
      expect(pdf.paginas[folhaDoTotal]).toContain("Desconto comercial");
      expect(pdf.paginas[folhaDoTotal]).toContain("Ajuste de fechamento");
    },
    TEMPO,
  );

  it(
    "Rastreabilidade de lote acabado: consumo real em várias folhas e destino comercial",
    async () => {
      const pdf = await gerar(
        <LotTraceabilityPdf lot={LOTE_ACABADO} traceability={rastroAcabado()} generatedAt={GERADO_EM} />,
        "Rastreabilidade-LT-20260903-000101.pdf",
      );

      conferirArquivo(pdf, {
        titulo: "RASTREABILIDADE DE LOTE",
        codigo: "LT-20260903-000101",
        minimoDePaginas: 2,
      });
      conferirCabecalhoRepetido(pdf, "LT-20260820-000", ["ITEM", "LOTE INTERNO", "QUANTIDADE"]);
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("DESTINO COMERCIAL");
      // A saída que atendeu outro pedido aparece com o pedido dela.
      expect(tudo).toContain("PED-000046");
    },
    TEMPO,
  );

  it(
    "Rastreabilidade de insumo: ordens e amostras que consumiram o lote",
    async () => {
      const pdf = await gerar(
        <LotTraceabilityPdf lot={LOTE_INSUMO} traceability={rastroInsumo()} generatedAt={GERADO_EM} />,
        "Rastreabilidade-LT-20260820-000003.pdf",
      );

      conferirArquivo(pdf, { titulo: "RASTREABILIDADE DE LOTE", codigo: "LT-20260820-000003" });
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("ORDENS DE PRODUÇÃO QUE CONSUMIRAM ESTE LOTE");
      expect(tudo).toContain("AMOSTRAS QUE CONSUMIRAM ESTE LOTE");
      expect(tudo).toContain("FORN-003");
    },
    TEMPO,
  );
});

describe("gerador de PDF — casos de borda dos transacionais", () => {
  it(
    "OC sem preço, faturamento em rascunho sem precificação e recebimento de material do cliente",
    async () => {
      const semPreco = ordemDeCompra();
      const oc = await gerar(
        <PurchaseOrderPdf
          order={{
            ...semPreco,
            code: "OC-000013",
            status: "DRAFT",
            lines: semPreco.lines.slice(0, 3).map((linha) => ({ ...linha, unitPrice: null, lineTotal: null })),
            orderTotal: null,
          }}
          generatedAt={GERADO_EM}
        />,
        "OC-000013-sem-preco.pdf",
      );
      conferirArquivo(oc, { titulo: "ORDEM DE COMPRA", codigo: "OC-000013" });
      // Sem preço não há valor previsto: a frase cabe no bloco de totais e nada vira zero.
      expect(oc.paginas[0]).toContain("Valor previsto Preço incompleto — total não disponível");
      expect(oc.paginas[0]).toContain("RASCUNHO");
      expect(oc.paginas[0]).not.toContain("R$ 0,00");

      const rascunho = faturamento();
      const fat = await gerar(
        <BillingPdf
          billing={{
            ...rascunho,
            code: "FAT-000124",
            status: "DRAFT",
            issuedAt: null,
            issuedBy: null,
            hasCompletePricing: false,
            grossAmount: null,
            totalAmount: null,
            lines: rascunho.lines
              .slice(0, 4)
              .map((linha, indice) => (indice === 1 ? { ...linha, unitPrice: null, lineTotal: null } : linha)),
          }}
          generatedAt={GERADO_EM}
        />,
        "FAT-000124-rascunho.pdf",
      );
      conferirArquivo(fat, { titulo: "FATURAMENTO", codigo: "FAT-000124" });
      expect(fat.paginas[0]).toContain("Valor total Precificação incompleta — total não disponível");
      expect(fat.paginas[0]).toContain("RASCUNHO");
      expect(fat.paginas[0]).not.toContain("VALOR TOTAL");

      const doCliente = recebimento();
      const rec = await gerar(
        <ReceiptPdf
          receipt={{
            ...doCliente,
            code: "REC-000032",
            sourceType: "CUSTOMER_SUPPLIED",
            purchaseOrderId: null,
            purchaseOrderCode: null,
            supplierId: null,
            supplierCode: null,
            supplierName: null,
            customerId: "cus-7",
            customerCode: "CLI-000007",
            customerName: CLIENTE,
            invoiceNumber: null,
            lines: doCliente.lines.slice(0, 3).map((linha) => ({
              ...linha,
              purchaseOrderLineId: null,
              ownerType: "CUSTOMER" as const,
              purchaseUnitPrice: null,
              actualUnitCost: null,
            })),
          }}
          generatedAt={GERADO_EM}
        />,
        "REC-000032-material-do-cliente.pdf",
      );
      conferirArquivo(rec, { titulo: "RECEBIMENTO", codigo: "REC-000032" });
      expect(rec.paginas[0]).toContain("Material enviado pelo cliente");
      expect(rec.paginas[0]).toContain(CLIENTE);
      expect(rec.paginas[0]).not.toContain("FORNECEDOR");
    },
    TEMPO,
  );
});

describe("nome do arquivo sai do código real", () => {
  it("cada documento transacional baixa com o código que o identifica — nunca document.pdf", () => {
    expect(customerOrderPdfFileName({ code: "PED-000045" })).toBe("PED-000045.pdf");
    expect(purchaseOrderPdfFileName({ code: "OC-000012" })).toBe("OC-000012.pdf");
    expect(receiptPdfFileName({ code: "REC-000031" })).toBe("REC-000031.pdf");
    expect(productionOrderPdfFileName({ code: "OP-000010", officialNumber: "007/26" })).toBe("OP-007-26.pdf");
    expect(productionOrderPdfFileName({ code: "OP-000010", officialNumber: null })).toBe("OP-000010.pdf");
    expect(recipeSheetPdfFileName({ productionOrderCode: "OP-000010", officialNumber: "007/26" })).toBe(
      "Folha-de-Receita-OP-007-26.pdf",
    );
    expect(recipeSheetPdfFileName({ productionOrderCode: "OP-000010", officialNumber: null })).toBe(
      "Folha-de-Receita-OP-000010.pdf",
    );
    expect(shipmentPdfFileName({ code: "EXP-000031" })).toBe("EXP-000031.pdf");
    expect(billingPdfFileName({ code: "FAT-000123" })).toBe("FAT-000123.pdf");
    expect(lotTraceabilityPdfFileName({ code: "LT-20260903-000101" })).toBe(
      "Rastreabilidade-LT-20260903-000101.pdf",
    );
  });
});
