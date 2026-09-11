// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QuoteLineDTO, QuotePaymentScheduleDTO, QuoteVersionDTO } from "@veridi/shared";
import { PdfDocument, PdfParagraph, PdfSection, PdfTable, PdfTd, PdfTr } from "./components";
import { QuotePdf, quotePdfFileName } from "./documents/QuotePdf";
import { formatPdfDateTime, pdfFileName, pdfSafe } from "./format";
import { renderPdfBlob } from "./render";
import { lerPdf } from "./testing/pdf-text";

/**
 * O gerador de verdade: arquivo PDF real, lido de volta página por página.
 *
 * O teste de conteúdo (DOM) diz o que o documento escreve; este prova o que
 * só existe no arquivo — folha A4, paginação calculada pelo sistema, rodapé
 * "Página X de Y" em toda folha, cabeçalho de tabela repetido, linha que não
 * se divide entre páginas e nenhum rastro de navegador (URL, localhost, data
 * automática).
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");

function linha(numero: number, extra: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  const n = String(numero).padStart(3, "0");
  return {
    id: `line-${n}`,
    quoteVersionId: "qv-1",
    projectProductId: null,
    productId: `prd-${n}`,
    productCode: `PRD-${n}`,
    productName: `Produto de teste ${n}`,
    sortOrder: numero,
    quotedQuantity: `${1000 + numero}`,
    uomCode: "un",
    unitPrice: "2.8486",
    total: "2848.60",
    priceSource: "MANUAL",
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing: null,
    ...extra,
  } as unknown as QuoteLineDTO;
}

const A_VISTA_COM_DESCONTO: QuotePaymentScheduleDTO = {
  subtotal: "2848.60",
  discountPercent: "5.0000",
  discountAmount: "142.43",
  total: "2706.17",
  method: "CASH",
  downPaymentPercent: null,
  downPayment: null,
  financedAmount: null,
  monthlyInterestPercent: null,
  installmentIntervalDays: null,
  installments: [],
  totalPayable: "2706.17",
  interestAmount: "0.00",
};

function orcamento(lines: QuoteLineDTO[], extra: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "qv-1",
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    externalCode: null,
    status: "SENT",
    source: "MANUAL",
    quoteDate: "2026-09-10T00:00:00.000Z",
    validUntil: "2026-10-10T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines,
    total: "2706.17",
    subtotal: "2848.60",
    discountPercent: "5.0000",
    paymentMethod: "CASH",
    downPaymentPercent: null,
    installmentCount: null,
    installmentIntervalDays: null,
    monthlyInterestPercent: null,
    paymentSchedule: A_VISTA_COM_DESCONTO,
    sourcedOrder: null,
    commercialNotes: "Frete FOB. Rotulagem conforme arte aprovada pelo cliente.",
    paymentTerms: "Boleto bancário",
    leadTimeDays: 30,
    sentAt: "2026-09-10T17:05:00.000Z",
    sentByName: "Comercial",
    acceptedAt: null,
    acceptedByName: null,
    rejectedAt: null,
    rejectedByName: null,
    rejectionReason: null,
    customerCode: "CLI-000007",
    customerName: "Nutri Distribuidora de Suplementos Ltda",
    customerTradeName: "NutriMais",
    customerCnpj: "11222333000181",
    customerZipCode: "13010-000",
    customerStreet: "Rua das Palmeiras",
    customerNumber: "1234",
    customerComplement: "Sala 5",
    customerDistrict: "Centro",
    customerCity: "Campinas",
    customerState: "SP",
    projectCode: "PRJ-000012",
    projectName: "Linha Whey Premium",
    projectConcept: "Proteína para academia",
    projectChannel: "Distribuidor",
    createdAt: "2026-09-10T12:00:00.000Z",
    createdByName: "Comercial",
    ...extra,
  } as unknown as QuoteVersionDTO;
}

/** A4 retrato: 595,28 × 841,89 pt (o arquivo grava com 6 casas). */
function ehA4Retrato(mediaBox: string): boolean {
  const [x, y, largura, altura] = mediaBox.split(/\s+/).map((valor) => Number.parseFloat(valor));
  return (
    x === 0 &&
    y === 0 &&
    Math.abs((largura ?? 0) - 595.28) < 0.01 &&
    Math.abs((altura ?? 0) - 841.89) < 0.01
  );
}

async function gerar(quote: QuoteVersionDTO, amostra: string) {
  const blob = await renderPdfBlob(<QuotePdf quote={quote} generatedAt={GERADO_EM} />);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pasta = process.env["PDF_SAMPLES_DIR"];
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, amostra), bytes);
  }
  return lerPdf(bytes);
}

/** A linha do texto extraído que contém o trecho — valor e vizinho saem na mesma linha de base. */
function linhaQueContem(pagina: string, trecho: string): string {
  return pagina.split("\n").find((texto) => texto.includes(trecho)) ?? "";
}

describe("Orçamento — cliente e projeto no papel (PDF-DATA-PARITY-01)", () => {
  it("rascunho com o cadastro que o servidor entrega: razão social, fantasia, CNPJ, endereço e projeto", async () => {
    const pdf = await gerar(
      orcamento([linha(1)], { status: "DRAFT", sentAt: null, sentByName: null }),
      "ORC-000001-V1-rascunho-com-cliente.pdf",
    );
    const [pagina = ""] = pdf.paginas;

    expect(linhaQueContem(pagina, "Nutri Distribuidora de Suplementos Ltda")).toContain(
      "11.222.333/0001-81",
    );
    expect(pagina).toContain("NutriMais");
    expect(pagina).toContain("Rua das Palmeiras, 1234, Sala 5, Centro");
    expect(pagina).toContain("Campinas / SP");
    expect(pagina).toContain("PRJ-000012 — Linha Whey Premium");
    expect(pagina).toContain("Proteína para academia");
    expect(pagina).toContain("Distribuidor");
    for (const rastro of ["http", "localhost", "127.0.0.1", "about:blank"]) {
      expect(pdf.bruto).not.toContain(rastro);
    }
  });

  it("o que o cadastro não tem continua ausente: CNPJ sai —; fantasia, endereço, conceito e canal não aparecem", async () => {
    const pdf = await gerar(
      orcamento([linha(1)], {
        status: "DRAFT",
        sentAt: null,
        sentByName: null,
        customerCnpj: null,
        customerTradeName: null,
        customerZipCode: null,
        customerStreet: null,
        customerNumber: null,
        customerComplement: null,
        customerDistrict: null,
        customerCity: null,
        customerState: null,
        projectConcept: null,
        projectChannel: null,
      }),
      "ORC-000001-V1-rascunho-sem-opcionais.pdf",
    );
    const [pagina = ""] = pdf.paginas;

    // CNPJ é campo fixo do cliente: ausente vira "—", nunca some nem é inventado.
    expect(linhaQueContem(pagina, "Nutri Distribuidora de Suplementos Ltda").trim()).toMatch(/—$/);
    for (const rotulo of ["NOME FANTASIA", "ENDEREÇO", "CIDADE / UF", "CONCEITO", "CANAL"]) {
      expect(pagina, rotulo).not.toContain(rotulo);
    }
    expect(pagina).toContain("PRJ-000012 — Linha Whey Premium");
  });
});

describe("gerador de PDF — Orçamento", () => {
  it("1 item: 1 folha A4, rodapé controlado e nenhum rastro de navegador", async () => {
    const pdf = await gerar(
      orcamento([
        linha(1, { productName: "Whey Protein Isolado 900 g — Baunilha", quotedQuantity: "1000" }),
      ]),
      "ORC-000001-V1-1-item.pdf",
    );

    expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
    expect(pdf.paginas).toHaveLength(1);
    expect(pdf.folhas.every(ehA4Retrato), pdf.folhas.join(" | ")).toBe(true);

    const [pagina = ""] = pdf.paginas;
    // Hierarquia: título → identificação → cliente → proposta → totais → condições → rodapé.
    const ordem = [
      "ORÇAMENTO COMERCIAL",
      "ORC-000001 · V1",
      "CLIENTE",
      "PROPOSTA",
      "PRODUTOS",
      "TOTAL GERAL",
      "CONDIÇÕES COMERCIAIS",
      "Página 1 de 1",
    ].map((trecho) => pagina.indexOf(trecho));
    expect(ordem.every((posicao) => posicao >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(pagina).toContain("ORÇAMENTO COMERCIAL");
    expect(pagina).toContain("ORC-000001 · V1");
    expect(pagina).toContain("Status: Enviado");
    expect(pagina).toContain("Página 1 de 1");
    expect(pagina).toContain("Gerado em 11/09/2026 09:30");
    expect(pagina).toContain("não constitui documento fiscal");
    // Coluna Moeda saiu da tabela; a moeda é informação do documento.
    const cabecalhoDaTabela = pagina.split("\n").find((linha) => linha.includes("PREÇO UNITÁRIO"));
    expect(cabecalhoDaTabela).toBe("PRODUTO QUANTIDADE UNIDADE PREÇO UNITÁRIO TOTAL");
    expect(pagina).toContain("BRL");
    expect(pagina).toContain("TOTAL GERAL");

    for (const rastro of ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"]) {
      expect(pdf.bruto).not.toContain(rastro);
      expect(pdf.paginas.join("\n")).not.toContain(rastro);
    }
  });

  it("muitos itens: 2+ folhas, cabeçalho da tabela repetido, X de Y em toda folha, linha inteira", async () => {
    const linhas = Array.from({ length: 40 }, (_, i) =>
      linha(
        i + 1,
        i === 4
          ? {
              productName:
                "Colágeno Hidrolisado com Vitamina C e Ácido Hialurônico — Sachê 10 g — Sabor Frutas Vermelhas",
            }
          : {},
      ),
    );
    const pdf = await gerar(
      orcamento(linhas, {
        paymentMethod: "INSTALLMENTS",
        paymentSchedule: {
          ...A_VISTA_COM_DESCONTO,
          method: "INSTALLMENTS",
          downPaymentPercent: "20.0000",
          downPayment: "541.23",
          financedAmount: "2164.94",
          monthlyInterestPercent: "2.0000",
          installmentIntervalDays: 30,
          installments: [
            { number: 1, amount: "750.61", dueInDays: 30 },
            { number: 2, amount: "750.61", dueInDays: 60 },
            { number: 3, amount: "750.61", dueInDays: 90 },
          ],
          totalPayable: "2793.06",
          interestAmount: "86.89",
        },
      }),
      "ORC-000001-V1-40-itens.pdf",
    );

    const total = pdf.paginas.length;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(pdf.folhas.every(ehA4Retrato), pdf.folhas.join(" | ")).toBe(true);

    pdf.paginas.forEach((texto, indice) => {
      expect(texto).toContain(`Página ${indice + 1} de ${total}`);
      // Folha com linha de produto tem o cabeçalho da tabela no topo.
      if (texto.includes("Produto de teste")) expect(texto).toContain("PREÇO UNITÁRIO");
    });
    // Da página 2 em diante, a folha solta diz de que documento é.
    for (const texto of pdf.paginas.slice(1)) {
      expect(texto).toContain("ORÇAMENTO COMERCIAL");
      expect(texto).toContain("ORC-000001 · V1");
    }
    // Linha nunca se divide: nome e quantidade na mesma folha.
    for (const item of linhas.filter((l) => l.productName.startsWith("Produto de teste"))) {
      const folha = pdf.paginas.findIndex((texto) => texto.includes(item.productName));
      expect(folha, item.productName).toBeGreaterThanOrEqual(0);
      expect(pdf.paginas[folha]).toContain(item.quotedQuantity!);
    }
    // Totais depois da última linha; o plano de pagamento fecha o documento.
    const folhaDaUltimaLinha = pdf.paginas.findIndex((texto) => texto.includes("Produto de teste 040"));
    const folhaDoTotal = pdf.paginas.findIndex((texto) => texto.includes("TOTAL GERAL"));
    expect(folhaDoTotal).toBeGreaterThanOrEqual(folhaDaUltimaLinha);
    expect(pdf.paginas[total - 1]).toContain("PLANO DE PAGAMENTO");
    expect(pdf.paginas[total - 1]).toContain("Total a prazo");
  });
});

describe("fundação — paginação", () => {
  it("título de seção nunca fica sozinho no pé da folha", async () => {
    // Enche a folha 1 aos poucos: em algum passo o título cai na faixa do
    // pé da página. Em todos, ele tem de estar na mesma folha que a 1ª linha.
    for (let enchimento = 30; enchimento <= 60; enchimento += 1) {
      const blob = await renderPdfBlob(
        <PdfDocument title="Teste de paginação" code="T-1" generatedAt={GERADO_EM}>
          {Array.from({ length: enchimento }, (_, i) => (
            <PdfParagraph key={i}>Linha de enchimento {i + 1}</PdfParagraph>
          ))}
          <PdfSection title="Seção de teste">
            <PdfTable
              columns={[
                { header: "Descrição", flex: 1 },
                { header: "Valor", width: 80, align: "right" },
              ]}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <PdfTr key={i}>
                  <PdfTd>{`Primeira linha ${i + 1}`}</PdfTd>
                  <PdfTd>{`${i + 1}`}</PdfTd>
                </PdfTr>
              ))}
            </PdfTable>
          </PdfSection>
        </PdfDocument>,
      );
      const pdf = lerPdf(new Uint8Array(await blob.arrayBuffer()));
      const folhaDoTitulo = pdf.paginas.findIndex((texto) => texto.includes("SEÇÃO DE TESTE"));
      expect(folhaDoTitulo, `enchimento ${enchimento}`).toBeGreaterThanOrEqual(0);
      expect(pdf.paginas[folhaDoTitulo], `enchimento ${enchimento}`).toContain("Primeira linha 1");
      // E nenhuma folha sai só com cabeçalho e rodapé.
      for (const texto of pdf.paginas) {
        expect(texto, `enchimento ${enchimento}`).toMatch(/Linha de enchimento|Primeira linha/);
      }
    }
  }, 30_000);
});

describe("apoios do documento", () => {
  it("nome de arquivo sai do código real", () => {
    expect(quotePdfFileName({ code: "ORC-000001", versionNumber: 1 })).toBe("ORC-000001-V1.pdf");
    expect(pdfFileName("OP-001/26")).toBe("OP-001-26.pdf");
    expect(pdfFileName("PED-000001")).toBe("PED-000001.pdf");
    expect(pdfFileName("Rastreabilidade", "LT 2026·01")).toBe("Rastreabilidade-LT-2026-01.pdf");
    expect(pdfFileName(null, "")).toBe("documento-veridi.pdf");
  });

  it("carimbo sem segundos, no fuso da operação", () => {
    expect(formatPdfDateTime(GERADO_EM)).toBe("11/09/2026 09:30");
    expect(formatPdfDateTime(null)).toBe("—");
  });

  it("texto fora da fonte vira equivalente visível, nunca some", () => {
    expect(pdfSafe("− R$ 10,00")).toBe("– R$ 10,00");
    expect(pdfSafe("≈ 0 kg")).toBe("~ 0 kg");
    expect(pdfSafe("Magnésio · Ação — 2ª")).toBe("Magnésio · Ação — 2ª");
    expect(pdfSafe("ő")).toBe("o");
    expect(pdfSafe("漢")).toBe("?");
  });
});
