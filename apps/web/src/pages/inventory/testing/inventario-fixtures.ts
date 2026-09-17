import type {
  StockCountDetailDTO,
  StockCountEntryDTO,
  StockCountPositionDTO,
  StockCountPreviewDTO,
  StockCountPreviewPositionDTO,
  StockCountSummaryDTO,
} from "@veridi/shared";

/**
 * Fixtures do Inventário Físico para os testes das telas (Fatia 2A).
 *
 * `SALDO_SENTINELA` é o número que um servidor vazando poria na resposta. Os
 * testes da contagem cega o enviam de propósito, onde a leitura cega traria
 * `null`: a tela não pode mostrá-lo nem assim.
 */
export const SALDO_SENTINELA = "4321.5";
export const SALDO_SENTINELA_NA_TELA = "4.321,5";

export function resumo(overrides: Partial<StockCountSummaryDTO> = {}): StockCountSummaryDTO {
  return {
    id: "inv-1",
    code: "INV-000014",
    kind: "SESSION",
    mode: "BLIND",
    status: "IN_PROGRESS",
    description: "Matérias-primas — setembro",
    referenceAt: "2026-09-15T11:02:00.000Z",
    createdAt: "2026-09-15T11:02:00.000Z",
    createdByName: "Ana Administradora",
    firstRoundClosedAt: null,
    firstRoundClosedByName: null,
    completedAt: null,
    completedByName: null,
    cancelledAt: null,
    cancelledByName: null,
    cancelReason: null,
    positionCount: 3,
    removedCount: 0,
    countedCount: 0,
    divergentCount: null,
    ...overrides,
  };
}

export function registro(overrides: Partial<StockCountEntryDTO> = {}): StockCountEntryDTO {
  return {
    id: "e-1",
    round: 1,
    countedQuantity: "5",
    expectedQuantity: null,
    difference: null,
    countedAt: "2026-09-15T12:10:00.000Z",
    countedByName: "Ana Administradora",
    source: "GRID",
    note: null,
    ...overrides,
  };
}

export function posicao(overrides: Partial<StockCountPositionDTO> = {}): StockCountPositionDTO {
  return {
    id: "p-1",
    sequence: 1,
    positionKey: "item-1:lote-1",
    origin: "SCOPE",
    itemId: "item-1",
    itemCode: "MP-000431",
    itemName: "Vitamina C",
    itemType: "RAW_MATERIAL",
    unitCode: "kg",
    lotId: "lote-1",
    lotCode: "LT-20260902-000118",
    ownerType: "VERIDI",
    ownerCustomerId: null,
    ownerCustomerCode: null,
    ownerCustomerName: null,
    lotStatusAtReference: "AVAILABLE",
    expiryDateAtReference: "2027-03-31T00:00:00.000Z",
    locationAtReference: "A-03",
    referenceAt: "2026-09-15T11:02:00.000Z",
    referenceQuantity: null,
    currentRound: 1,
    lastEntryId: null,
    validEntryId: null,
    finalDifference: null,
    hasConcurrentMovement: null,
    situation: "PENDING",
    entries: [],
    recountRequestedRound: null,
    recountRequestedAt: null,
    recountRequestedByName: null,
    recountedByRequester: false,
    addedAt: null,
    addedByName: null,
    addReason: null,
    removedAt: null,
    removedByName: null,
    removeReason: null,
    decision: null,
    decisionReason: null,
    decidedAt: null,
    decidedByName: null,
    concurrentMovementConfirmed: false,
    adjustmentMovementId: null,
    ...overrides,
  };
}

/** Posição contada: o registro vale na rodada atual. */
export function posicaoContada(
  overrides: Partial<StockCountPositionDTO> = {},
  entrada: Partial<StockCountEntryDTO> = {},
): StockCountPositionDTO {
  const valido = registro(entrada);
  return posicao({
    situation: "COUNTED",
    lastEntryId: valido.id,
    validEntryId: valido.id,
    entries: [valido],
    ...overrides,
  });
}

export function detalhe(overrides: Partial<StockCountDetailDTO> = {}): StockCountDetailDTO {
  const positions = overrides.positions ?? [
    posicao(),
    posicao({ id: "p-2", sequence: 2, positionKey: "item-1:lote-2", lotId: "lote-2", lotCode: "LT-20260910-000140" }),
    posicao({
      id: "p-3",
      sequence: 3,
      positionKey: "item-2",
      itemId: "item-2",
      itemCode: "ME-000077",
      itemName: "Pote PET 500 ml",
      itemType: "PACKAGING",
      unitCode: "un",
      lotId: null,
      lotCode: null,
      lotStatusAtReference: null,
      expiryDateAtReference: null,
      locationAtReference: null,
    }),
  ];
  return {
    ...resumo(),
    view: "counting",
    balancesHidden: true,
    scopeFilters: { scope: { balance: "WITH_BALANCE", owner: "ALL", itemTypes: ["RAW_MATERIAL"] }, excludedCount: 0, heldByOpenCounts: [] },
    completedByCounter: false,
    positions,
    findings: [],
    ...overrides,
  };
}

export function linhaDaPrevia(overrides: Partial<StockCountPreviewPositionDTO> = {}): StockCountPreviewPositionDTO {
  return {
    positionKey: "item-1:lote-1",
    sequence: 1,
    itemId: "item-1",
    itemCode: "MP-000431",
    itemName: "Vitamina C",
    itemType: "RAW_MATERIAL",
    unitCode: "kg",
    lotId: "lote-1",
    lotCode: "LT-20260902-000118",
    ownerType: "VERIDI",
    ownerCustomerId: null,
    ownerCustomerCode: null,
    ownerCustomerName: null,
    lotStatus: "AVAILABLE",
    expiryDate: "2027-03-31T00:00:00.000Z",
    isExpired: false,
    location: "A-03",
    balance: null,
    ...overrides,
  };
}

export function previa(overrides: Partial<StockCountPreviewDTO> = {}): StockCountPreviewDTO {
  const positions = overrides.positions ?? [
    linhaDaPrevia(),
    linhaDaPrevia({ positionKey: "item-1:lote-2", sequence: 2, lotId: "lote-2", lotCode: "LT-20260910-000140" }),
  ];
  return {
    positions,
    itemCount: 1,
    heldByOpenCounts: [],
    excludedCount: 0,
    excludedPositions: [],
    maxPositions: 3000,
    ...overrides,
  };
}

/** `window.matchMedia` que casa só a largura de celular (abaixo de 640px). */
export function emularCelular(celular: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (consulta: string) => ({
      matches: celular && consulta.includes("max-width: 639px"),
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
