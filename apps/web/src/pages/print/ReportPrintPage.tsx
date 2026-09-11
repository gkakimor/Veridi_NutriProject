import { useParams, useSearchParams } from "react-router-dom";
import { useOptionalAuth } from "../../app/AuthProvider";
import { API_URL, apiFetch } from "../../lib/api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Relatórios R-01…R-20 em PDF, em ROTA DEDICADA.
 *
 * A origem nunca é a tela operacional: o documento é montado do zero, fora do
 * AppShell, a partir do MESMO endpoint de exportação que a tela usa — o que
 * garante o resultado filtrado COMPLETO (`ALL_ROWS`) e as mesmas colunas
 * rotuladas, sem reimplementar 17 relatórios nem duplicar definição de
 * coluna. O arquivo é PDF de verdade, gerado no navegador sobre o dado que
 * esta página buscou com a sessão do usuário; o módulo do documento só
 * carrega quando alguém gera o PDF.
 */

/** Separador e BOM usados pelo `buildCsv` da API. */
const SEPARATOR = ";";

interface ReportPrintDefinition {
  code: string;
  title: string;
  /** Endpoint de exportação — mesmo filtro da tela, sempre `ALL_ROWS`. */
  csvPath: string;
  /** Volta para a tela do relatório. */
  screenPath: string;
  /** Contém custo/margem: documento interno, nunca entregue ao cliente. */
  internal?: boolean;
  /**
   * Relatório largo demais para uma linha só. As colunas listadas aqui viram
   * a linha principal; TODAS as outras aparecem logo abaixo, rotuladas, na
   * mesma linha de detalhe. Nada some do papel — só deixa de disputar largura.
   */
  primaryColumns?: string[];
}

export const REPORT_PRINT_DEFINITIONS: Record<string, ReportPrintDefinition> = {
  "R-01": {
    code: "R-01",
    title: "Posição de Estoque",
    csvPath: "/reports/inventory/position/export.csv",
    screenPath: "/relatorios/estoque/posicao",
    // 16 colunas não cabem numa linha da folha: lote do fornecedor, lote
    // Veridi, proprietário, fornecedor, tipo e CoA descem para o detalhe.
    primaryColumns: [
      "Item",
      "Descrição",
      "Lote interno",
      "Validade",
      "Localização",
      "On Hand",
      "Reservado",
      "Disponível",
      "Unidade",
      "Qualidade",
    ],
  },
  "R-02": {
    code: "R-02",
    title: "Vencimentos",
    csvPath: "/reports/inventory/expiry/export.csv",
    screenPath: "/relatorios/estoque/vencimentos",
    primaryColumns: [
      "Item",
      "Descrição",
      "Lote interno",
      "Validade",
      "Dias até vencer",
      "On Hand",
      "Reservado",
      "Disponível",
      "Unidade",
      "Qualidade",
    ],
  },
  "R-03": {
    code: "R-03",
    title: "Movimentações",
    csvPath: "/reports/inventory/movements/export.csv",
    screenPath: "/relatorios/estoque/movimentacoes",
  },
  "R-04": {
    code: "R-04",
    title: "Necessidade / Falta para OP",
    csvPath: "/reports/production/requirements/export.csv",
    screenPath: "/relatorios/producao/necessidades",
    primaryColumns: [
      "OP",
      "Produto",
      "Item",
      "Descrição",
      "Necessário",
      "Reservado",
      "Disponível",
      "Em compra",
      "Falta",
      "Unidade",
    ],
  },
  "R-05": {
    code: "R-05",
    title: "Planejado x Realizado",
    csvPath: "/reports/production/planned-actual/export.csv",
    screenPath: "/relatorios/producao/planejado-realizado",
    // O custo e a qualidade que o explica ficam lado a lado.
    primaryColumns: [
      "OP",
      "Produto",
      "Nome do produto",
      "Planejado",
      "Produzido",
      "Variação",
      "Rendimento (%)",
      "Unidade",
      "Status",
      "Custo material unitário",
      "Qualidade do custo",
    ],
  },
  "R-07": {
    code: "R-07",
    title: "Consumo por período",
    csvPath: "/reports/production/consumption/export.csv",
    screenPath: "/relatorios/producao/consumo",
  },
  "R-08": {
    code: "R-08",
    title: "Ordens de Compra",
    csvPath: "/reports/purchasing/orders/export.csv",
    screenPath: "/relatorios/compras/ordens",
  },
  "R-09": {
    code: "R-09",
    title: "Recebimentos",
    csvPath: "/reports/purchasing/receipts/export.csv",
    screenPath: "/relatorios/compras/recebimentos",
    primaryColumns: [
      "Recebimento",
      "Data",
      "OC",
      "Fornecedor",
      "Item",
      "Descrição",
      "Lote interno",
      "Quantidade",
      "Unidade",
      "Custo efetivo",
      "Qualidade do custo",
    ],
  },
  "R-10": {
    code: "R-10",
    title: "Em Compra",
    csvPath: "/reports/purchasing/on-order/export.csv",
    screenPath: "/relatorios/compras/em-compra",
  },
  "R-11": {
    code: "R-11",
    title: "OCs atrasadas",
    csvPath: "/reports/purchasing/late/export.csv",
    screenPath: "/relatorios/compras/atrasadas",
  },
  "R-12": {
    code: "R-12",
    title: "Pedidos do Cliente",
    csvPath: "/reports/commercial/orders/export.csv",
    screenPath: "/relatorios/comercial/pedidos",
  },
  "R-13": {
    code: "R-13",
    title: "Atendimento dos Pedidos",
    csvPath: "/reports/commercial/fulfillment/export.csv",
    screenPath: "/relatorios/comercial/atendimento",
    primaryColumns: [
      "Pedido",
      "Cliente",
      "Produto",
      "Nome do produto",
      "Qtd. pedida",
      "Expedido",
      "Faturado",
      "Falta expedir",
      "Unidade",
    ],
  },
  "R-15": {
    code: "R-15",
    title: "Faturamento por período",
    csvPath: "/reports/billing/period/export.csv",
    screenPath: "/relatorios/faturamento/periodo",
  },
  "R-16": {
    code: "R-16",
    title: "Aguardando faturamento",
    csvPath: "/reports/billing/awaiting/export.csv",
    screenPath: "/relatorios/faturamento/pendentes",
  },
  "R-17": {
    code: "R-17",
    title: "Pedido x Entregue x Faturado",
    csvPath: "/reports/billing/order-delivered-billed/export.csv",
    screenPath: "/relatorios/faturamento/pedido-entregue-faturado",
    primaryColumns: [
      "Pedido",
      "Cliente",
      "Produto",
      "Nome do produto",
      "Qtd. pedida",
      "Expedido",
      "Faturado",
      "Expedido sem faturar",
      "Falta entregar",
      "Unidade",
    ],
  },
  "R-18": {
    code: "R-18",
    title: "Custo industrial por produto",
    csvPath: "/reports/costs/industrial-by-product/export.csv",
    screenPath: "/relatorios/custos/industrial-por-produto",
    // Custo industrial por produto: documento interno, como o R-20.
    internal: true,
    primaryColumns: [
      "Produto",
      "Nome",
      "Cliente",
      "Qualidade",
      "Custo industrial total",
      "Custo/unidade",
      "Custo/1.000",
    ],
  },
  "R-19": {
    code: "R-19",
    title: "Precificação por produto",
    csvPath: "/reports/costs/pricing-by-product/export.csv",
    screenPath: "/relatorios/custos/precificacao-por-produto",
    // Preço, margem e contribuição: documento interno, como o R-20.
    internal: true,
    primaryColumns: [
      "Produto",
      "Nome",
      "Cliente",
      "Quantidade",
      "Unidade",
      "Custo/unidade",
      "Preço",
      "Margem de contribuição (%)",
      "Contribuição/unidade",
      "Qualidade do custo",
    ],
  },
  "R-20": {
    code: "R-20",
    title: "Orçamento × Precificação",
    csvPath: "/reports/commercial/quote-pricing/export.csv",
    screenPath: "/relatorios/comercial/orcamento-precificacao",
    // Contém custo e margem: nunca é o documento entregue ao cliente.
    internal: true,
    primaryColumns: [
      "Orçamento",
      "Projeto",
      "Cliente",
      "Produto",
      "Status",
      "Quantidade",
      "Unidade",
      "Preço unitário",
      "Total",
      "Origem do preço",
    ],
  },
};

/** Rótulos legíveis dos filtros — o papel precisa dizer o que está mostrando. */
const FILTER_LABELS: Record<string, string> = {
  search: "Busca",
  from: "De",
  to: "Até",
  itemId: "Item",
  itemType: "Tipo de item",
  lotId: "Lote",
  status: "Status",
  supplierId: "Fornecedor",
  customerId: "Cliente",
  productId: "Produto",
  productionOrderId: "Ordem de produção",
  customerOrderId: "Pedido",
  type: "Tipo",
  sourceType: "Origem",
  onlyWithStock: "Somente com saldo",
  daysAhead: "Dias à frente",
};

/**
 * Filtros da URL, rotulados, na ordem em que vieram.
 *
 * Paginação da tela (`page`, `pageSize`) não é filtro: o documento traz o
 * recorte inteiro, e "pageSize 25" no papel sugeriria um corte que não existe.
 */
export function reportAppliedFilters(params: URLSearchParams): { label: string; value: string }[] {
  return [...params.entries()]
    .filter(([key, value]) => value !== "" && key !== "all" && key !== "page" && key !== "pageSize")
    .map(([key, value]) => ({ label: FILTER_LABELS[key] ?? key, value }));
}

/** Parser do CSV gerado pela API (`;`, aspas duplas, BOM). */
export function parseReportCsv(content: string): { header: string[]; rows: string[][] } {
  const text = content.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === SEPARATOR) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header = [], ...body] = rows;
  return {
    header,
    rows: body.filter((cells) => cells.some((value) => value.trim().length > 0)),
  };
}

type ReportPrintData = {
  definition: ReportPrintDefinition;
  header: string[];
  rows: string[][];
  filters: { label: string; value: string }[];
};

export function ReportPrintPage() {
  const { reportCode } = useParams<{ reportCode: string }>();
  const [params] = useSearchParams();
  // Quem gerou o documento — não substitui quem executou cada ato no sistema.
  const generatedBy = useOptionalAuth()?.user?.name ?? null;
  const definition = reportCode ? REPORT_PRINT_DEFINITIONS[reportCode.toUpperCase()] : undefined;
  const query = params.toString();

  return (
    <PdfScreen<ReportPrintData>
      // Outro relatório ou outro filtro na mesma rota é outro documento.
      key={`${reportCode ?? ""}?${query}`}
      load={async () => {
        if (!definition) throw new Error(`Relatório desconhecido: ${reportCode ?? ""}`);
        const response = await apiFetch(`${API_URL}${definition.csvPath}${query ? `?${query}` : ""}`);
        if (!response.ok) throw new Error(`Falha ao carregar o relatório (${response.status})`);
        return {
          definition,
          ...parseReportCsv(await response.text()),
          filters: reportAppliedFilters(params),
        };
      }}
      build={async ({ definition: relatorio, header, rows, filters }) => {
        const { ReportPdf, reportPdfFileName } = await import("../../pdf/documents/ReportPdf");
        const generatedAt = new Date();
        return {
          document: (
            <ReportPdf
              report={{
                code: relatorio.code,
                title: relatorio.title,
                internal: relatorio.internal,
                primaryColumns: relatorio.primaryColumns,
                header,
                rows,
                filters,
                generatedBy,
              }}
              generatedAt={generatedAt}
            />
          ),
          fileName: reportPdfFileName(relatorio.code, generatedAt),
        };
      }}
      backTo={definition?.screenPath ?? "/relatorios"}
    />
  );
}
