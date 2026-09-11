// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type {
  InventoryPositionRowDTO,
  LotStatus,
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
import { renderPdfBlob } from "../render";
import { lerPdf, type PdfLido } from "../testing/pdf-text";

/**
 * As folhas operacionais de verdade: arquivo PDF real, lido de volta página
 * por página, com amostra realista de cada folha.
 *
 * O teste de conteúdo (`operational-sheets-pdf.test.tsx`) diz o que a folha
 * escreve; este prova o que só existe no arquivo — A4 (paisagem onde a
 * largura exige, retrato na expedição), "Página X de Y" em toda folha,
 * cabeçalho da tabela repetido quando ela continua, linha que não se divide
 * entre páginas, código FO no rodapé de toda folha e nenhum rastro de
 * navegador (URL, localhost, data automática).
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");
const EMISSAO = { generatedAt: GERADO_EM, generatedBy: "Maria Operadora" };
/** Folha com dezenas de linhas leva alguns segundos para compor. */
const TEMPO = 60_000;

/** A4 = 595,28 × 841,89 pt (o arquivo grava com casas): em pé no retrato, deitada na paisagem. */
function ehA4(mediaBox: string, largura: number, altura: number): boolean {
  const [x, y, l, a] = mediaBox
    .trim()
    .split(/\s+/)
    .map((valor) => +valor);
  return x === 0 && y === 0 && Math.abs((l ?? 0) - largura) < 0.01 && Math.abs((a ?? 0) - altura) < 0.01;
}
const ehA4Retrato = (mediaBox: string) => ehA4(mediaBox, 595.28, 841.89);
const ehA4Paisagem = (mediaBox: string) => ehA4(mediaBox, 841.89, 595.28);

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

type Folha = {
  /** Identificação do cabeçalho e do rodapé: "FO-04 · OP 007/26". */
  codigo: string;
  titulo: string;
  paisagem: boolean;
  /** Rótulo de coluna que só existe no cabeçalho da tabela. */
  cabecalho: string;
  /** Linhas da tabela: um valor único e outro da mesma linha, que precisa cair junto. */
  linhas: { chave: string; junto: string }[];
};

/** O que toda folha operacional precisa provar no arquivo. */
function provarFolha(pdf: PdfLido, folha: Folha) {
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(pdf.folhas.every(folha.paisagem ? ehA4Paisagem : ehA4Retrato), pdf.folhas.join(" | ")).toBe(true);

  const total = pdf.paginas.length;
  const titulo = folha.titulo.toUpperCase();
  pdf.paginas.forEach((texto, indice) => {
    const pagina = `página ${indice + 1}`;
    // Rodapé em toda folha: página X de Y, código FO e carimbo sem segundos.
    expect(texto, pagina).toContain(`Página ${indice + 1} de ${total}`);
    expect(texto, pagina).toContain(folha.codigo);
    expect(texto, pagina).toContain("Gerado em 11/09/2026 09:30");
    // Da página 2 em diante, a folha que se solta da pilha diz de onde veio.
    if (indice > 0) expect(texto, pagina).toContain(titulo);
  });

  // Linha nunca se divide: os valores da mesma linha caem na mesma linha de
  // base da mesma folha — e toda folha com linha tem o cabeçalho da tabela.
  const folhasComLinha = new Set<number>();
  for (const { chave, junto } of folha.linhas) {
    const pagina = pdf.paginas.findIndex((texto) => texto.includes(chave));
    expect(pagina, chave).toBeGreaterThanOrEqual(0);
    folhasComLinha.add(pagina);
    const linha = pdf.paginas[pagina]!.split("\n").find((trecho) => trecho.includes(chave));
    expect(linha, chave).toContain(junto);
  }
  for (const pagina of folhasComLinha) {
    expect(pdf.paginas[pagina], `cabeçalho da tabela na página ${pagina + 1}`).toContain(folha.cabecalho);
  }

  for (const rastro of ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"]) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(pdf.paginas.join("\n")).not.toContain(rastro);
  }
}

/* ─────────────── amostras ─────────────── */

const ITENS = [
  ["MP-000001", "Coenzima Q10", "kg"],
  ["MP-000002", "Whey Protein Concentrado 80%", "kg"],
  ["MP-000003", "Maltodextrina DE 20", "kg"],
  ["MP-000004", "Creatina Monohidratada 200 mesh", "kg"],
  ["MP-000005", "Vitamina D3 100.000 UI/g", "g"],
  ["MP-000006", "Colágeno Hidrolisado Bovino", "kg"],
  ["MP-000007", "Cafeína Anidra", "kg"],
  ["MP-000008", "L-Glutamina", "kg"],
  ["MP-000009", "Ácido Cítrico Anidro", "kg"],
  ["MP-000010", "Sucralose", "g"],
  ["MP-000011", "Aroma Idêntico ao Natural de Baunilha", "kg"],
  ["ME-000001", "Pote PEAD 900 g Branco", "un"],
  ["ME-000002", "Tampa Rosca 110 mm com Lacre", "un"],
  ["ME-000003", "Rótulo BOPP Whey Baunilha 900 g", "un"],
  ["MP-000012", "Cloreto de Magnésio Hexa-hidratado", "kg"],
  ["MP-000013", "Bicarbonato de Sódio", "kg"],
  ["MP-000014", "Beta-Alanina", "kg"],
  ["MP-000015", "Taurina", "kg"],
  ["MP-000016", "Picolinato de Cromo", "g"],
  ["MP-000017", "Óleo de Coco em Pó MCT 70%", "kg"],
] as const;

const dois = (n: number) => String(n).padStart(2, "0");
const seis = (n: number) => String(n).padStart(6, "0");
const FORNECEDORES = ["Insumos Brasil Ltda", "Nutriquímica Comércio de Insumos S.A."] as const;

/** Situação gravada e vencimento — o mix que a folha precisa explicar. */
function situacao(i: number): { status: LotStatus; isExpired: boolean } {
  if (i % 9 === 1) return { status: "AWAITING_RELEASE", isExpired: false };
  if (i % 9 === 4) return { status: "BLOCKED", isExpired: false };
  if (i % 9 === 7) return { status: "AVAILABLE", isExpired: true };
  return { status: "AVAILABLE", isExpired: false };
}

function estoque(quantidade: number): InventoryPositionRowDTO[] {
  return Array.from({ length: quantidade }, (_, i): InventoryPositionRowDTO => {
    const [itemCode, itemName, unitCode] = ITENS[i % ITENS.length]!;
    // Item sem controle de lote: uma linha no nível do item, lote "—".
    const semLote = i % 13 === 12;
    const cliente = i % 7 === 3;
    const { status, isExpired } = situacao(i);
    const reservado = !semLote && status === "AVAILABLE" && !isExpired && i % 5 === 0;
    const onHand = `${i + 1}2.5`;
    return {
      itemId: `item-${i % ITENS.length}`,
      itemCode,
      itemName,
      itemType: itemCode.startsWith("ME") ? "PACKAGING" : "RAW_MATERIAL",
      unitCode,
      lotId: semLote ? null : `lot-${i + 1}`,
      lotCode: semLote ? null : `LT-202608${dois((i % 28) + 1)}-${seis(i + 1)}`,
      lotOrigin: semLote ? null : "RECEIPT",
      supplierLot: semLote ? null : `F-${700 + i}`,
      businessLotNumber: null,
      supplierName: FORNECEDORES[i % 2]!,
      ownerType: cliente ? "CUSTOMER" : "VERIDI",
      ownerCustomerId: cliente ? "cli-1" : null,
      ownerCustomerName: cliente ? "Alpha Nutrition Ltda" : null,
      coaStatus: status === "AWAITING_RELEASE" ? "RECEIVED" : "APPROVED",
      expiryDate: semLote ? null : `2027-${dois((i % 12) + 1)}-${dois((i % 28) + 1)}T00:00:00.000Z`,
      location: semLote ? null : `Rua ${"ABCDEF"[i % 6]}-${dois(i + 1)}`,
      onHand,
      reserved: reservado ? `${i + 1}0` : "0",
      available: status !== "AVAILABLE" || isExpired ? "0" : reservado ? "2.5" : onHand,
      status: semLote ? null : status,
      isExpired: semLote ? false : isExpired,
    };
  });
}

/** Linhas com lote: o lote é único, e a localização é da mesma linha. */
function linhasDoEstoque(rows: InventoryPositionRowDTO[]) {
  return rows
    .filter((row) => row.lotCode && row.location)
    .map((row) => ({ chave: row.lotCode!, junto: row.location! }));
}

function pendencias(quantidade: number): QualityQueueRowDTO[] {
  const laudos = [
    { requiresCoa: true, coaStatus: "PENDING", lotStatus: "AWAITING_RELEASE" },
    { requiresCoa: true, coaStatus: "RECEIVED", lotStatus: "AWAITING_RELEASE" },
    { requiresCoa: true, coaStatus: "REJECTED", lotStatus: "BLOCKED" },
    { requiresCoa: false, coaStatus: "NOT_REQUIRED", lotStatus: "AWAITING_RELEASE" },
  ] as const;
  return Array.from({ length: quantidade }, (_, i): QualityQueueRowDTO => {
    const [itemCode, itemName, unitCode] = ITENS[i % ITENS.length]!;
    const laudo = laudos[i % laudos.length]!;
    const cliente = i % 6 === 5;
    return {
      lotId: `lot-q${i + 1}`,
      lotCode: `LT-202609${dois((i % 10) + 1)}-${seis(i + 101)}`,
      itemId: `item-${i % ITENS.length}`,
      itemCode,
      itemName,
      sourceName: null,
      declaredNutrient: null,
      lotOrigin: "RECEIPT",
      supplierName: FORNECEDORES[i % 2]!,
      ownerType: cliente ? "CUSTOMER" : "VERIDI",
      ownerCustomerName: cliente ? "Alpha Nutrition Ltda" : null,
      receivedAt: `2026-09-${dois((i % 10) + 1)}T13:00:00.000Z`,
      expiryDate: `2027-${dois((i % 12) + 1)}-15T00:00:00.000Z`,
      isExpired: false,
      requiresCoa: laudo.requiresCoa,
      coaStatus: laudo.coaStatus,
      coaReviewedByName: null,
      coaReviewNote: null,
      lotStatus: laudo.lotStatus,
      onHand: `${i + 1}0`,
      unitCode,
    };
  });
}

function ordemDeProducao(materiais: number): ProductionOrderDTO {
  const requirements = Array.from({ length: materiais }, (_, i) => {
    const [itemCode, itemName, unitCode] = ITENS[i % ITENS.length]!;
    // Um de cada três materiais sai de dois lotes.
    const lotes = i % 3 === 0 ? 2 : 1;
    const confirmado = i % 4 === 0;
    return {
      id: `req-${i + 1}`,
      itemCode,
      itemName,
      supplyResponsibility: i % 5 === 4 ? "CUSTOMER" : "VERIDI",
      requiredQuantity: `${i + 1}.25`,
      stockUnitCode: unitCode,
      reservationLines: Array.from({ length: lotes }, (_, j) => ({
        id: `rl-${i + 1}-${j + 1}`,
        lotCode: `LT-202608${dois((i % 28) + 1)}-${seis(200 + i * 2 + j)}`,
        expiryDate: `2027-${dois((i % 12) + 1)}-20T00:00:00.000Z`,
        location: `Rua ${"ABCDEF"[i % 6]}-${dois(i + 1)}${j === 0 ? "" : "B"}`,
        quantity: lotes === 2 ? (j === 0 ? `${i + 1}` : "0.25") : `${i + 1}.25`,
        pickingStatus: confirmado ? "CONFIRMED" : "PENDING",
        pickedBy: confirmado ? "Ana Separadora" : null,
        pickedAt: confirmado ? "2026-09-10T14:00:00.000Z" : null,
      })),
    };
  });
  return {
    id: "op-1",
    code: "OP-000123",
    officialNumber: "007/26",
    productCode: "PA-000010",
    productName: "Whey Protein Isolado 900 g — Baunilha",
    customerName: "Alpha Nutrition Ltda",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    status: "RELEASED",
    requirements,
  } as unknown as ProductionOrderDTO;
}

function expedicao(code: string, quantidade: number): ShipmentDTO {
  const produtos = [
    ["PA-000010", "Whey Protein Isolado 900 g — Baunilha"],
    ["PA-000011", "Whey Protein Isolado 900 g — Chocolate"],
    ["PA-000012", "Creatina Monohidratada 300 g"],
    ["PA-000013", "Colágeno Hidrolisado com Vitamina C — Sachê 10 g — Frutas Vermelhas"],
    ["PA-000014", "Pré-treino Cafeína + Beta-Alanina 300 g — Limão"],
  ] as const;
  return {
    id: "exp-1",
    code,
    customerOrderCode: "PED-000045",
    customerName: "Nutri Distribuidora de Suplementos Ltda",
    status: "DRAFT",
    createdAt: "2026-09-10T15:00:00.000Z",
    lines: Array.from({ length: quantidade }, (_, i) => {
      const [productCode, productName] = produtos[i % produtos.length]!;
      return {
        id: `sl-${i + 1}`,
        productCode,
        productName,
        quantity: `${(i % 7) + 1}20`,
        unitCode: "un",
        lotCode: `LT-202609${dois((i % 9) + 1)}-${seis(300 + i)}`,
        expiryDate: `2028-${dois((i % 12) + 1)}-01T00:00:00.000Z`,
        location: `Doca ${dois(i + 1)}`,
      };
    }),
  } as unknown as ShipmentDTO;
}

function linhasComLote(linhas: { lotCode: string | null; location: string | null }[]) {
  return linhas.map((linha) => ({ chave: linha.lotCode!, junto: linha.location! }));
}

/* ─────────────── folhas ─────────────── */

describe("gerador de PDF — folhas operacionais", () => {
  it(
    "FO-01 com saldo: A4 paisagem, várias folhas, cabeçalho repetido e linha inteira",
    async () => {
      const rows = estoque(80);
      const pdf = await gerar(
        <InventoryCountPdf rows={rows} blind={false} search="" itemType="" {...EMISSAO} />,
        inventoryCountPdfFileName({ blind: false, generatedAt: GERADO_EM }),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      provarFolha(pdf, {
        codigo: "FO-01",
        titulo: "Folha de contagem física de estoque",
        paisagem: true,
        cabecalho: "DIFERENÇA",
        linhas: linhasDoEstoque(rows),
      });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("FILTROS APLICADOS");
      expect(primeira).toContain("Com saldo do sistema");
      expect(primeira).toContain("Gerado por Maria Operadora");
      expect(primeira).toContain("SALDO");
      expect(pdf.paginas.at(-1)).toContain("Contagem realizada por");
    },
    TEMPO,
  );

  it(
    "FO-01 cega: o saldo do sistema não chega ao arquivo",
    async () => {
      const rows = estoque(80);
      const pdf = await gerar(
        <InventoryCountPdf rows={rows} blind search="" itemType="" {...EMISSAO} />,
        inventoryCountPdfFileName({ blind: true, generatedAt: GERADO_EM }),
      );

      provarFolha(pdf, {
        codigo: "FO-01",
        titulo: "Folha de contagem física de estoque",
        paisagem: true,
        cabecalho: "DIFERENÇA",
        linhas: linhasDoEstoque(rows),
      });
      expect(pdf.paginas[0]).toContain("Contagem cega — saldo do sistema omitido");
      const todas = pdf.paginas.join("\n");
      expect(todas).not.toContain("SALDO");
      // Nenhuma quantidade do sistema: toda folha cega só tem espaço para escrever.
      expect(todas).not.toMatch(/\d,5\b/);
    },
    TEMPO,
  );

  it(
    "FO-02: aviso do disponível e situação do lote em toda linha",
    async () => {
      const rows = estoque(80);
      const pdf = await gerar(
        <InventoryPositionPdf rows={rows} search="whey" {...EMISSAO} />,
        inventoryPositionPdfFileName(GERADO_EM),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      provarFolha(pdf, {
        codigo: "FO-02",
        titulo: "Posição / levantamento de estoque",
        paisagem: true,
        cabecalho: "DISPONÍVEL",
        linhas: linhasDoEstoque(rows),
      });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("Disponível = Físico");
      expect(primeira).toContain("whey");
      const todas = pdf.paginas.join("\n");
      expect(todas).toContain("Vencido");
      expect(todas).toContain("Bloqueado");
      expect(todas).toContain("Aguardando");
    },
    TEMPO,
  );

  it(
    "FO-03: pendências em várias folhas, assinatura da Qualidade no fim",
    async () => {
      const rows = pendencias(40);
      const pdf = await gerar(<QualityPendingPdf rows={rows} {...EMISSAO} />, qualityPendingPdfFileName(GERADO_EM));

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      provarFolha(pdf, {
        codigo: "FO-03",
        titulo: "Pendências de qualidade / CoA",
        paisagem: true,
        cabecalho: "PENDÊNCIA",
        linhas: rows.map((row) => ({ chave: row.lotCode, junto: row.itemCode })),
      });
      const todas = pdf.paginas.join("\n");
      expect(todas).toContain("Laudo não recebido");
      expect(todas).toContain("Não exigido");
      expect(pdf.paginas.at(-1)).toContain("Qualidade — responsável");
    },
    TEMPO,
  );

  it(
    "FO-04: OP no rodapé de toda folha, conferência em papel ao lado do picking do sistema",
    async () => {
      const order = ordemDeProducao(20);
      const pdf = await gerar(<ProductionPickingPdf order={order} {...EMISSAO} />, productionPickingPdfFileName(order));

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      provarFolha(pdf, {
        codigo: "FO-04 · OP 007/26",
        titulo: "Folha de separação / picking da produção",
        paisagem: true,
        cabecalho: "LOCALIZAÇÃO",
        linhas: linhasComLote(order.requirements.flatMap((requirement) => requirement.reservationLines)),
      });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("OP-000123");
      expect(primeira).toContain("Whey Protein Isolado 900 g — Baunilha");
      expect(pdf.paginas.join("\n")).toContain("Ana Separadora");
      expect(pdf.paginas.at(-1)).toContain("Separado por");
    },
    TEMPO,
  );

  it(
    "FO-05: retrato — muitas linhas em várias folhas",
    async () => {
      const shipment = expedicao("EXP-000012", 34);
      const pdf = await gerar(<ShipmentPickingPdf shipment={shipment} {...EMISSAO} />, shipmentPickingPdfFileName(shipment));

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      provarFolha(pdf, {
        codigo: "FO-05 · EXP-000012",
        titulo: "Folha de separação / expedição",
        paisagem: false,
        cabecalho: "LOCALIZAÇÃO",
        linhas: linhasComLote(shipment.lines),
      });
      expect(pdf.paginas[0]).toContain("PED-000045");
      expect(pdf.paginas.at(-1)).toContain("Separado por");
    },
    TEMPO,
  );

  it(
    "FO-05: expedição curta cabe em uma folha A4 retrato",
    async () => {
      const shipment = expedicao("EXP-000013", 3);
      const pdf = await gerar(<ShipmentPickingPdf shipment={shipment} {...EMISSAO} />, shipmentPickingPdfFileName(shipment));

      expect(pdf.paginas).toHaveLength(1);
      provarFolha(pdf, {
        codigo: "FO-05 · EXP-000013",
        titulo: "Folha de separação / expedição",
        paisagem: false,
        cabecalho: "LOCALIZAÇÃO",
        linhas: linhasComLote(shipment.lines),
      });
      expect(pdf.paginas[0]).toContain("Página 1 de 1");
      expect(pdf.paginas[0]).toContain("Conferido por");
    },
    TEMPO,
  );
});
