// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { COST_PER_1000_LABEL } from "@veridi/shared";
import type { OrderOperationDTO, ProductionTraceabilityDTO } from "@veridi/shared";
import {
  REPORT_PRINT_DEFINITIONS,
  parseReportCsv,
  reportAppliedFilters,
} from "../../pages/print/ReportPrintPage";
import { renderPdfBlob } from "../render";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { PDF_PAGE } from "../theme";
import { OrderOperationReportPdf, orderOperationPdfFileName } from "./OrderOperationReportPdf";
import {
  ProductionTraceabilityReportPdf,
  productionTraceabilityPdfFileName,
} from "./ProductionTraceabilityReportPdf";
import {
  REPORT_EMPTY_MESSAGE,
  ReportPdf,
  reportPdfFileName,
  reportPdfLayout,
  type ReportPdfInput,
} from "./ReportPdf";

/**
 * Relatórios em PDF — o ARQUIVO real, lido de volta página por página.
 *
 * O teste de conteúdo (`report-content.test.tsx`) diz o que o relatório
 * escreve; este prova o que só existe no arquivo: folha A4 (paisagem nos
 * relatórios largos), "Página X de Y" em toda folha, cabeçalho da tabela
 * repetido, registro que não se divide entre páginas e nenhum rastro de
 * navegador.
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");

type Orientacao = "retrato" | "paisagem";

/** A4 (595,28 × 841,89 pt), em pé ou deitado — com a tolerância das casas gravadas. */
function ehA4(mediaBox: string, orientacao: Orientacao): boolean {
  const [x, y, largura, altura] = mediaBox.split(/\s+/).map((valor) => +valor);
  const [esperadaLargura, esperadaAltura] = orientacao === "retrato" ? [595.28, 841.89] : [841.89, 595.28];
  return (
    x === 0 &&
    y === 0 &&
    Math.abs((largura ?? 0) - esperadaLargura) < 0.01 &&
    Math.abs((altura ?? 0) - esperadaAltura) < 0.01
  );
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

/** O que vale para todo arquivo: A4, paginação do sistema e nada de navegador. */
function conferirArquivo(pdf: PdfLido, orientacao: Orientacao) {
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(pdf.folhas.every((folha) => ehA4(folha, orientacao)), pdf.folhas.join(" | ")).toBe(true);
  const total = pdf.paginas.length;
  pdf.paginas.forEach((texto, indice) => {
    expect(texto).toContain(`Página ${indice + 1} de ${total}`);
    expect(texto).toContain("Gerado em 11/09/2026 09:30");
  });
  for (const rastro of ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"]) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(pdf.paginas.join("\n")).not.toContain(rastro);
  }
}

/** Texto da folha em uma linha só — título longo pode quebrar em duas no cabeçalho. */
function corrido(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

// ------------------------------------------------------------ relatórios CSV

/** Cabeçalhos exatamente como o `report-exports.ts` da API escreve. */
const CABECALHOS: Record<string, string[]> = {
  "R-01": [
    "Item", "Descrição", "Tipo", "Lote interno", "Lote do fornecedor", "Lote Veridi", "Proprietário",
    "Fornecedor", "Validade", "Localização", "On Hand", "Reservado", "Disponível", "Unidade", "Qualidade", "CoA",
  ],
  "R-02": [
    "Item", "Descrição", "Lote interno", "Lote Veridi", "Origem", "Validade", "Dias até vencer", "On Hand",
    "Reservado", "Disponível", "Unidade", "Qualidade", "Localização",
  ],
  "R-03": ["Data/Hora", "Tipo", "Item", "Descrição", "Lote", "Quantidade", "Unidade", "Documento", "Motivo", "Usuário"],
  "R-04": [
    "OP", "Produto", "Nome do produto", "Status da OP", "Item", "Descrição", "Fornecimento", "Cliente",
    "Necessário", "Reservado", "Disponível", "Em compra", "Falta", "Unidade",
  ],
  "R-05": [
    "OP", "Produto", "Nome do produto", "Formulação", "Planejado", "Produzido", "Variação", "Rendimento (%)",
    "Unidade", "Início", "Conclusão", "Status", "Custo material unitário", "Qualidade do custo",
  ],
  "R-07": [
    "Data", "Item", "Descrição", "Lote", "Produto", "OP", "Quantidade consumida", "Unidade", "Custo unitário",
    "Origem do custo", "Custo do consumo",
  ],
  "R-08": [
    "OC", "Fornecedor", "Origem", "Pedido relacionado", "Status", "Data", "Previsão", "Itens", "Valor previsto",
    "Linhas com preço", "Recebimentos",
  ],
  "R-09": [
    "Recebimento", "Data", "OC", "Fornecedor", "Item", "Descrição", "Lote interno", "Lote do fornecedor",
    "Quantidade", "Unidade", "CoA", "Preço previsto (OC)", "Custo efetivo", "Qualidade do custo",
  ],
  "R-10": [
    "OC", "Fornecedor", "Item", "Descrição", "Pedido", "Recebido", "Em aberto", "Unidade", "Previsão", "Status",
    "Pedido do cliente",
  ],
  "R-11": [
    "OC", "Fornecedor", "Item", "Descrição", "Pedido", "Recebido", "Em aberto", "Unidade", "Previsão", "Status",
    "Pedido do cliente", "Dias de atraso",
  ],
  "R-12": [
    "Pedido", "Cliente", "Data", "Entrega solicitada", "Status", "Faturamento", "Linhas", "Produtos", "Expedições",
    "Faturamentos",
  ],
  "R-13": [
    "Pedido", "Cliente", "Produto", "Nome do produto", "Qtd. pedida", "Reservado", "Produzido", "OPs", "Expedido",
    "Faturado", "Falta expedir", "Unidade", "Status", "Faturamento",
  ],
  "R-15": [
    "Faturamento", "Data de emissão", "Pedido", "Expedição", "Cliente", "Linhas", "Valor", "Precificação",
    "Referência externa",
  ],
  "R-16": [
    "Expedição", "Confirmada em", "Pedido", "Cliente", "Produtos", "Situação", "Faturamento em preparação",
    "Dias aguardando",
  ],
  "R-17": [
    "Pedido", "Cliente", "Produto", "Nome do produto", "Qtd. pedida", "Expedido", "Faturado", "Expedido sem faturar",
    "Falta entregar", "Unidade", "Status", "Faturamento",
  ],
  "R-18": [
    "Produto", "Nome", "Cliente", "Estrutura ativa", "Último cálculo", "Data de referência", "Calculado em",
    "Qualidade", "Quantidade calculada", "Unidade da base", "Custo industrial total", "Subtotal conhecido",
    "Custo/unidade", COST_PER_1000_LABEL,
  ],
  "R-19": [
    "Produto", "Nome", "Cliente", "Precificação", "Quantidade", "Unidade", "Modo de preço", "Cálculo de custo",
    "Data do custo", "Qualidade do custo", "Custo/unidade", "Comissão (%)", "Preço", "Margem de contribuição (%)",
    "Markup (%)", "Contribuição/unidade", "Ativada em",
  ],
  "R-20": [
    "Orçamento", "Projeto", "Nome do projeto", "Cliente", "Produto", "Status", "Quantidade", "Unidade",
    "Preço unitário", "Total", "Origem do preço", "Precificação", "Faixa", "Cálculo", "Qualidade do custo",
    "Custo industrial/un", "Margem de contribuição (%)", "Enviado em", "Aceito em",
  ],
};

/** Filtros como a tela os manda para a rota de impressão. */
const FILTROS: Record<string, Record<string, string>> = {
  "R-01": { search: "whey", itemType: "RAW_MATERIAL", status: "AVAILABLE", page: "1", pageSize: "25" },
  "R-03": { from: "2026-09-01", to: "2026-09-11", type: "ADJUSTMENT_IN" },
  "R-20": { search: "PRJ-000012" },
};

const DESCRICOES = [
  "Proteína isolada de soro de leite 90% (WPI) — importada",
  "Maltodextrina",
  "Pote PEAD 900 g branco com tampa flip-top e lacre de indução",
  "Creatina monoidratada micronizada 200 mesh",
];

const EMPRESAS = [
  "Nutri Distribuidora de Suplementos Ltda",
  "Alpha Nutrition",
  "Laboratório Farmacêutico Integrado do Brasil S.A.",
];

const STATUS: Record<string, string> = {
  "R-05": "Em produção",
  "R-08": "Recebido parcialmente",
  "R-10": "Recebido parcialmente",
  "R-11": "Recebido parcialmente",
  "R-20": "Substituído",
};

/** Número de linha em 6 dígitos: cada registro tem códigos únicos para achar na folha. */
function numero(indice: number): string {
  return String(indice + 1).padStart(6, "0");
}

/**
 * Valor de amostra por coluna: o pior caso realista — código de lote inteiro,
 * nome longo, número com todas as casas. A cada cinco registros, o que pode
 * faltar vem vazio (desconhecido), como a API escreve.
 */
function amostra(codigo: string, coluna: string, indice: number): string {
  const n = numero(indice);
  const desconhecido = indice % 5 === 3;
  switch (coluna) {
    case "Item":
      return `MP-${n}`;
    case "Produto":
      return `PROD-${n}`;
    case "OP":
      return `OP-${n}`;
    case "OC":
      return `OC-${n}`;
    case "Pedido":
      return codigo === "R-10" || codigo === "R-11" ? "12500,123456" : `PED-${n}`;
    case "Pedido relacionado":
    case "Pedido do cliente":
      return desconhecido ? "" : `PED-${n}`;
    case "Recebimento":
    case "Documento":
      return `REC-${n}`;
    case "Expedição":
      return `EXP-${n}`;
    case "Faturamento":
      return codigo === "R-15" ? `FAT-${n}` : "Sem expedição confirmada";
    case "Faturamento em preparação":
      return desconhecido ? "" : `FAT-${n}`;
    case "Lote interno":
    case "Lote":
      return `LT-20260903-${n}`;
    case "Lote do fornecedor":
      return desconhecido ? "" : `F2026/${n}-AB`;
    case "Lote Veridi":
      return desconhecido ? "" : `2603${n}A3`;
    case "Projeto":
      return `PRJ-${n}`;
    case "Orçamento":
      return `ORC-${n} · V12`;
    case "Precificação":
      return codigo === "R-15" ? "Incompleta" : `PREC-${n} · V3`;
    case "Último cálculo":
    case "Cálculo de custo":
    case "Cálculo":
      return `CALC-${n}`;
    case "Formulação":
      return "v12";
    case "Descrição":
    case "Nome do produto":
    case "Nome":
      return DESCRICOES[indice % DESCRICOES.length]!;
    case "Cliente":
    case "Fornecedor":
    case "Proprietário":
      return EMPRESAS[indice % EMPRESAS.length]!;
    case "Nome do projeto":
      return "Linha Whey Premium para academias — revisão de embalagem";
    case "Motivo":
      return desconhecido ? "" : "Ajuste de inventário após contagem física do almoxarifado";
    case "Usuário":
      return "Maria Aparecida dos Santos";
    case "Localização":
      return "Almoxarifado 2 — Prateleira B-14";
    case "Referência externa":
      return desconhecido ? "" : "NF-e 000123456 série 1";
    case "Produtos":
      return "PROD-000001, PROD-000002, PROD-000003";
    case "Estrutura ativa":
      return "EC-000012 · V4 — Whey 900 g";
    case "Tipo":
      return codigo === "R-03" ? "Saldo de abertura (migração)" : "Material de embalagem";
    case "Status":
      return STATUS[codigo] ?? "Parcialmente expedido";
    case "Status da OP":
      return "Em produção";
    case "Qualidade":
      return codigo === "R-18" ? "Parcial — há custos não informados" : "Aguardando liberação";
    case "Qualidade do custo":
      return codigo === "R-05" || codigo === "R-09" ? "ESTIMATED" : "Completo — referências reais de compra";
    case "CoA":
      return "Pendente de documento";
    case "Origem":
      return codigo === "R-08" ? "Pedido do cliente" : "Recebimento";
    case "Situação":
      return "Em preparação";
    case "Fornecimento":
      return "Cliente";
    case "Modo de preço":
      return "Calcular pela margem";
    case "Origem do custo":
      return "Estimado 30 dias";
    case "Origem do preço":
      return "Faixa de precificação";
    case "Unidade":
    case "Unidade da base":
      return "kg";
    case "Data/Hora":
    case "Calculado em":
    case "Ativada em":
    case "Enviado em":
    case "Aceito em":
      return desconhecido ? "" : "08/09/2026, 22:14:03";
    case "Linhas com preço":
      return "12/12";
    case "Dias até vencer":
    case "Dias de atraso":
    case "Dias aguardando":
    case "Linhas":
    case "Itens":
    case "OPs":
    case "Recebimentos":
    case "Expedições":
    case "Faturamentos":
      return "365";
    case "Rendimento (%)":
    case "Comissão (%)":
    case "Margem de contribuição (%)":
    case "Markup (%)":
      return "35,2531";
    case "Custo material unitário":
    case "Custo unitário":
    case "Custo do consumo":
    case "Valor previsto":
    case "Preço previsto (OC)":
    case "Custo efetivo":
    case "Valor":
    case "Custo industrial total":
    case "Subtotal conhecido":
    case "Custo/unidade":
    case "Preço":
    case "Contribuição/unidade":
    case "Preço unitário":
    case "Total":
    case "Custo industrial/un":
    case COST_PER_1000_LABEL:
      return desconhecido ? "" : "1234567,89";
    default:
      break;
  }
  if (/^(Data|Validade|Previsão|Início|Conclusão|Entrega|Confirmada)/.test(coluna)) return "10/10/2026";
  // Quantidade: o maior número que a coluna precisa comportar.
  return "12500,123456";
}

/** CSV como o `buildCsv` da API: BOM, `;`, CRLF e aspas quando precisa. */
function csv(header: string[], linhas: string[][]): string {
  const celula = (valor: string) => (/[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor);
  return `﻿${[header, ...linhas].map((linha) => linha.map(celula).join(";")).join("\r\n")}\r\n`;
}

/** O caminho real: CSV da API → parser da página → documento. */
function relatorio(codigo: string, registros: number): ReportPdfInput {
  const definicao = REPORT_PRINT_DEFINITIONS[codigo]!;
  const cabecalho = CABECALHOS[codigo]!;
  const corpo = Array.from({ length: registros }, (_, indice) =>
    cabecalho.map((coluna) => amostra(codigo, coluna, indice)),
  );
  const { header, rows } = parseReportCsv(csv(cabecalho, corpo));
  return {
    code: definicao.code,
    title: definicao.title,
    internal: definicao.internal,
    primaryColumns: definicao.primaryColumns,
    header,
    rows,
    filters: reportAppliedFilters(new URLSearchParams(FILTROS[codigo] ?? {})),
    generatedBy: "Maria Aparecida dos Santos",
  };
}

function gerarRelatorio(dados: ReportPdfInput, amostraArquivo: string) {
  return gerar(<ReportPdf report={dados} generatedAt={GERADO_EM} />, amostraArquivo);
}

describe("relatórios R-01…R-20 — arquivo", () => {
  const codigos = Object.keys(REPORT_PRINT_DEFINITIONS);

  it("toda definição de relatório tem cabeçalho de amostra", () => {
    expect(codigos.sort()).toEqual(Object.keys(CABECALHOS).sort());
  });

  it("nenhuma linha principal passa da folha: sobra largura para o texto livre", () => {
    for (const codigo of codigos) {
      const definicao = REPORT_PRINT_DEFINITIONS[codigo]!;
      const layout = reportPdfLayout({
        code: codigo,
        header: CABECALHOS[codigo]!,
        primaryColumns: definicao.primaryColumns,
      });
      const folha = layout.landscape ? 841.89 : 595.28;
      const util = folha - 2 * PDF_PAGE.marginX;
      const fixas = layout.columns.reduce((soma, coluna) => soma + (coluna.width ?? 0), 0);
      const pesos = layout.columns.reduce((soma, coluna) => soma + (coluna.width === undefined ? (coluna.flex ?? 1) : 0), 0);
      expect(fixas, `${codigo}: colunas fixas somam ${fixas} pt em ${util} pt`).toBeLessThan(util);
      // A coluna de texto mais estreita ainda cabe uma palavra longa.
      for (const coluna of layout.columns.filter((c) => c.width === undefined)) {
        const largura = ((util - fixas) * (coluna.flex ?? 1)) / pesos;
        expect(largura, `${codigo}: "${coluna.header}" fica com ${largura} pt`).toBeGreaterThan(70);
      }
    }
  });

  for (const codigo of Object.keys(CABECALHOS)) {
    it(`${codigo}: 1 folha A4 paisagem, nome, código, filtros e registros`, async () => {
      const dados = relatorio(codigo, 4);
      const pdf = await gerarRelatorio(dados, `${codigo}-1-pagina.pdf`);

      expect(pdf.paginas).toHaveLength(1);
      conferirArquivo(pdf, "paisagem");
      const [pagina = ""] = pdf.paginas;
      expect(corrido(pagina)).toContain(dados.title.toUpperCase());
      expect(pagina).toContain("Gerado por Maria Aparecida dos Santos");
      expect(pagina).toContain("FILTROS APLICADOS");
      expect(pagina).toContain("REGISTROS");
      // Os quatro registros estão na folha, com a primeira coluna do CSV.
      for (let indice = 0; indice < 4; indice += 1) {
        expect(pagina).toContain(amostra(codigo, dados.header[0]!, indice).split(" ")[0]!);
      }
      if (dados.internal) {
        expect(pagina).toContain("Documento interno. Contém custo e margem");
        expect(pagina).toContain("Documento interno — contém custo e margem.");
      }
    }, 30_000);
  }

  // Amostras multipágina com até 10 folhas: é o que a inspeção visual abre de uma vez.
  it("R-01 com 80 registros: várias folhas, cabeçalho repetido e registro inteiro na mesma folha", async () => {
    const registros = 80;
    const dados = relatorio("R-01", registros);
    const pdf = await gerarRelatorio(dados, "R-01-multipagina.pdf");

    expect(pdf.paginas.length).toBeGreaterThanOrEqual(3);
    conferirArquivo(pdf, "paisagem");
    pdf.paginas.forEach((texto) => {
      // Folha com registro tem o cabeçalho da tabela no topo.
      if (texto.includes("LT-20260903-")) {
        expect(texto).toContain("LOTE INTERNO");
        expect(texto).toContain("ON HAND");
      }
    });
    // Da página 2 em diante, a folha solta diz de que relatório é.
    for (const texto of pdf.paginas.slice(1)) {
      expect(texto).toContain("POSIÇÃO DE ESTOQUE");
      expect(texto).toContain("R-01");
    }
    // Linha principal e linha de detalhe nunca se separam.
    for (let indice = 0; indice < registros; indice += 1) {
      const n = numero(indice);
      const folha = pdf.paginas.findIndex((texto) => texto.includes(`LT-20260903-${n}`));
      expect(folha, `registro ${n}`).toBeGreaterThanOrEqual(0);
      if (indice % 5 !== 3) expect(pdf.paginas[folha], `detalhe do registro ${n}`).toContain(`F2026/${n}-AB`);
    }
    expect(pdf.paginas.at(-1)).toContain(`LT-20260903-${numero(registros - 1)}`);
  }, 60_000);

  it("R-03 com 100 registros (sem linha de detalhe): cabeçalho repetido e linha inteira", async () => {
    const registros = 100;
    const pdf = await gerarRelatorio(relatorio("R-03", registros), "R-03-multipagina.pdf");

    expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
    conferirArquivo(pdf, "paisagem");
    for (const texto of pdf.paginas) {
      if (texto.includes("LT-20260903-")) expect(texto).toContain("DATA/HORA");
    }
    for (let indice = 0; indice < registros; indice += 1) {
      const n = numero(indice);
      const folha = pdf.paginas.findIndex((texto) => texto.includes(`LT-20260903-${n}`));
      expect(folha, `registro ${n}`).toBeGreaterThanOrEqual(0);
      expect(pdf.paginas[folha]).toContain(`REC-${n}`);
    }
  }, 60_000);

  it("R-20 interno com 60 registros: a ressalva abre o documento e o rodapé a repete em toda folha", async () => {
    const pdf = await gerarRelatorio(relatorio("R-20", 60), "R-20-multipagina.pdf");

    expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
    conferirArquivo(pdf, "paisagem");
    expect(pdf.paginas[0]).toContain("Documento interno. Contém custo e margem");
    for (const texto of pdf.paginas) expect(texto).toContain("Documento interno — contém custo e margem.");
  }, 60_000);

  it("sem registros: a folha diz que não há registro para os filtros, e o total é 0", async () => {
    const pdf = await gerarRelatorio(relatorio("R-08", 0), "R-08-sem-registros.pdf");

    expect(pdf.paginas).toHaveLength(1);
    conferirArquivo(pdf, "paisagem");
    expect(pdf.paginas[0]).toContain(REPORT_EMPTY_MESSAGE);
  }, 30_000);
});

// ------------------------------------------------------------ R-06

function rastreabilidade(consumidos: number): ProductionTraceabilityDTO {
  return {
    productionOrderId: "op-1",
    productionOrderCode: "OP-000010",
    productId: "prd-1",
    productCode: "PROD-000123",
    productName: "Whey Protein Isolado 900 g — Baunilha",
    status: "COMPLETED",
    plannedQuantity: "1000",
    producedQuantity: "985.5",
    unitCode: "un",
    completedAt: "2026-09-08T00:00:00.000Z",
    consumed: Array.from({ length: consumidos }, (_, indice) => {
      const n = numero(indice);
      const semLote = indice % 7 === 6;
      const semFornecedor = indice % 3 === 2;
      return {
        itemId: `item-${n}`,
        itemCode: `MP-${n}`,
        itemName: DESCRICOES[indice % DESCRICOES.length]!,
        lotId: semLote ? null : `lot-${n}`,
        lotCode: semLote ? null : `LT-20260903-${n}`,
        supplierLot: semFornecedor ? null : `F2026/${n}-AB`,
        supplierName: semFornecedor ? null : EMPRESAS[indice % EMPRESAS.length]!,
        quantity: "12500.123456",
        unitCode: "kg",
      };
    }),
    produced: [
      {
        lotId: "lf-1",
        lotCode: "LT-20260908-000901",
        businessLotNumber: "26090340A3",
        quantity: "985.5",
        unitCode: "un",
        status: "AVAILABLE",
        isExpired: false,
        expiryDate: "2028-09-08T00:00:00.000Z",
      },
      {
        lotId: "lf-2",
        lotCode: "LT-20260908-000902",
        businessLotNumber: null,
        quantity: "14.5",
        unitCode: "un",
        status: "BLOCKED",
        isExpired: true,
        expiryDate: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
}

function gerarR06(dados: ProductionTraceabilityDTO, amostraArquivo: string) {
  return gerar(
    <ProductionTraceabilityReportPdf data={dados} generatedAt={GERADO_EM} generatedBy="Maria Aparecida dos Santos" />,
    amostraArquivo,
  );
}

describe("R-06 Rastreabilidade por OP — arquivo", () => {
  it("OP com poucos consumos: 1 folha A4 retrato", async () => {
    const pdf = await gerarR06(rastreabilidade(7), "R-06-1-pagina.pdf");

    expect(pdf.paginas).toHaveLength(1);
    conferirArquivo(pdf, "retrato");
    const [pagina = ""] = pdf.paginas;
    expect(corrido(pagina)).toContain("RASTREABILIDADE POR ORDEM DE PRODUÇÃO");
    expect(pagina).toContain("R-06 · OP-000010");
    expect(pagina).toContain("MATERIAIS CONSUMIDOS");
    expect(pagina).toContain("PRODUTO ACABADO PRODUZIDO");
    expect(pagina).toContain("Bloqueado — vencido");
  }, 30_000);

  it("OP com 90 consumos: várias folhas, cabeçalho repetido e linha inteira", async () => {
    const pdf = await gerarR06(rastreabilidade(90), "R-06-multipagina.pdf");

    expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
    conferirArquivo(pdf, "retrato");
    for (const texto of pdf.paginas) {
      if (texto.includes("MP-0")) expect(texto).toContain("LOTE DO FORNECEDOR");
    }
    for (const texto of pdf.paginas.slice(1)) expect(texto).toContain("R-06 · OP-000010");
    for (let indice = 0; indice < 90; indice += 1) {
      const n = numero(indice);
      const folha = pdf.paginas.findIndex((texto) => texto.includes(`MP-${n}`));
      expect(folha, `consumo ${n}`).toBeGreaterThanOrEqual(0);
      if (indice % 7 !== 6) expect(pdf.paginas[folha]).toContain(`LT-20260903-${n}`);
    }
    expect(pdf.paginas.at(-1)).toContain("PRODUTO ACABADO PRODUZIDO");
  }, 60_000);
});

// ------------------------------------------------------------ R-14

function operacao(escala: number): OrderOperationDTO {
  const serie = (quantidade: number) => Array.from({ length: quantidade }, (_, indice) => numero(indice));
  return {
    customerOrderId: "ped-1",
    code: "PED-000045",
    customerId: "cli-1",
    customerName: "Nutri Distribuidora de Suplementos Ltda",
    status: "IN_FULFILLMENT",
    orderDate: "2026-09-01T00:00:00.000Z",
    requestedDeliveryDate: null,
    lines: serie(escala * 3).map((n, indice) => ({
      customerOrderLineId: `linha-${n}`,
      productId: `prd-${n}`,
      productCode: `PROD-${n}`,
      productName: DESCRICOES[indice % DESCRICOES.length]!,
      orderedQuantity: "12500",
      unitCode: "un",
    })),
    reservations: [],
    productionOrders: serie(escala * 2).map((n) => ({
      productionOrderId: `op-${n}`,
      code: `OP-${n}`,
      productId: `prd-${n}`,
      productCode: `PROD-${n}`,
      productName: "Whey Protein Isolado 900 g",
      plannedQuantity: "12500",
      producedQuantity: "12499.5",
      unitCode: "un",
      status: "IN_PRODUCTION" as const,
    })),
    purchaseOrders: serie(escala).map((n, indice) => ({
      purchaseOrderId: `oc-${n}`,
      code: `OC-${n}`,
      supplierName: EMPRESAS[indice % EMPRESAS.length]!,
      status: "PARTIALLY_RECEIVED" as const,
      itemCount: 12,
      expectedDeliveryDate: indice % 2 === 1 ? null : "2026-09-20T00:00:00.000Z",
    })),
    shipments: serie(escala).map((n, indice) => ({
      shipmentId: `exp-${n}`,
      code: `EXP-${n}`,
      status: indice % 2 === 1 ? "DRAFT" : "CONFIRMED",
      confirmedAt: indice % 2 === 1 ? null : "2026-09-05T00:00:00.000Z",
      lines: [{ productCode: "PROD-000001", lotCode: null, quantity: "10", unitCode: "un" }],
    })),
    billings: serie(escala).map((n, indice) => ({
      billingId: `fat-${n}`,
      code: `FAT-${n}`,
      shipmentId: `exp-${n}`,
      shipmentCode: indice % 3 === 2 ? null : `EXP-${n}`,
      status: "ISSUED" as const,
      issuedAt: "2026-09-06T00:00:00.000Z",
      lineCount: 1,
      totalAmount: indice % 2 === 1 ? null : "2848.60",
    })),
  };
}

function gerarR14(dados: OrderOperationDTO, amostraArquivo: string) {
  return gerar(
    <OrderOperationReportPdf data={dados} generatedAt={GERADO_EM} generatedBy="Maria Aparecida dos Santos" />,
    amostraArquivo,
  );
}

describe("R-14 Pedido → Operação — arquivo", () => {
  it("pedido pequeno: 1 folha A4 retrato com a cadeia inteira", async () => {
    const pdf = await gerarR14(operacao(2), "R-14-1-pagina.pdf");

    expect(pdf.paginas).toHaveLength(1);
    conferirArquivo(pdf, "retrato");
    const [pagina = ""] = pdf.paginas;
    expect(pagina).toContain("PEDIDO › OPERAÇÃO");
    expect(pagina).toContain("R-14 · PED-000045");
    for (const secao of ["ITENS DO PEDIDO", "ORDENS DE PRODUÇÃO", "ORDENS DE COMPRA", "EXPEDIÇÕES", "FATURAMENTO"]) {
      expect(pagina).toContain(secao);
    }
  }, 30_000);

  it("pedido grande: várias folhas, cabeçalho repetido e X de Y em toda folha", async () => {
    const pdf = await gerarR14(operacao(24), "R-14-multipagina.pdf");

    expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
    conferirArquivo(pdf, "retrato");
    for (const texto of pdf.paginas.slice(1)) expect(texto).toContain("R-14 · PED-000045");
    // Toda folha que continua a tabela de itens repete o cabeçalho dela.
    for (const texto of pdf.paginas) {
      if (/PROD-0000\d\d — /.test(texto)) expect(texto).toContain("QUANTIDADE");
    }
    expect(pdf.paginas.at(-1)).toContain("FAT-000024");
  }, 60_000);
});

// ------------------------------------------------------------ nomes

describe("nome do arquivo", () => {
  it("sai do código real do relatório + dia da geração, no fuso da operação", () => {
    expect(reportPdfFileName("R-01", GERADO_EM)).toBe("R-01-2026-09-11.pdf");
    // 23:30 de 11/09 em Brasília já é dia 12 em UTC: o arquivo é do dia 11.
    expect(reportPdfFileName("R-20", new Date("2026-09-12T02:30:00.000Z"))).toBe("R-20-2026-09-11.pdf");
    expect(productionTraceabilityPdfFileName({ productionOrderCode: "OP-001/26" }, GERADO_EM)).toBe(
      "R-06-OP-001-26-2026-09-11.pdf",
    );
    expect(orderOperationPdfFileName({ code: "PED-000045" }, GERADO_EM)).toBe("R-14-PED-000045-2026-09-11.pdf");
  });
});
