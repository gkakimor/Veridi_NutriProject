import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_URL, apiFetch } from "../../lib/api";
import { COLUNA_NUMERICA, PrintTable } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";

/**
 * Impressão dos relatórios R-01…R-20 em ROTA DEDICADA.
 *
 * Política oficial (capacidade 42): `window.print()` é só o mecanismo de
 * saída; a origem nunca é a tela operacional. Aqui o documento é montado do
 * zero, fora do AppShell, a partir do MESMO endpoint de exportação que a
 * tela usa — o que garante o resultado filtrado COMPLETO (`ALL_ROWS`) e as
 * mesmas colunas rotuladas, sem reimplementar 17 relatórios nem duplicar
 * definição de coluna.
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
  },
  "R-02": {
    code: "R-02",
    title: "Vencimentos",
    csvPath: "/reports/inventory/expiry/export.csv",
    screenPath: "/relatorios/estoque/vencimentos",
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
  },
  "R-05": {
    code: "R-05",
    title: "Planejado x Realizado",
    csvPath: "/reports/production/planned-actual/export.csv",
    screenPath: "/relatorios/producao/planejado-realizado",
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

export function ReportPrintPage() {
  const { reportCode } = useParams<{ reportCode: string }>();
  const [params] = useSearchParams();
  const definition = reportCode ? REPORT_PRINT_DEFINITIONS[reportCode.toUpperCase()] : undefined;

  const [data, setData] = useState<{ header: string[]; rows: string[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = params.toString();

  useEffect(() => {
    if (!definition) return;
    apiFetch(`${API_URL}${definition.csvPath}${query ? `?${query}` : ""}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ao carregar o relatório (${response.status})`);
        setData(parseReportCsv(await response.text()));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o relatório"),
      );
    // A carga depende só do relatório e dos filtros da URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.csvPath, query]);

  if (!definition) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert">Relatório desconhecido: {reportCode}</p>
        </article>
      </div>
    );
  }

  if (error) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert">{error}</p>
        </article>
      </div>
    );
  }

  if (!data) return <div className="print-screen">Carregando…</div>;

  const appliedFilters = [...params.entries()]
    .filter(([key, value]) => value !== "" && key !== "all" && key !== "page")
    .map(([key, value]) => ({ label: FILTER_LABELS[key] ?? key, value }));

  // Relatório largo vira paisagem por decisão de layout, não do usuário.
  const landscape = data.header.length > 7;

  // Índices das colunas principais (na ordem declarada) e das demais, que
  // descem para a linha de detalhe.
  const primaryIndexes = (definition.primaryColumns ?? [])
    .map((column) => data.header.indexOf(column))
    .filter((index) => index >= 0);
  const hierarchical = primaryIndexes.length > 0;
  const detailIndexes = hierarchical
    ? data.header.map((_, index) => index).filter((index) => !primaryIndexes.includes(index))
    : [];
  const columns = hierarchical ? primaryIndexes.map((index) => data.header[index]!) : data.header;

  /**
   * Alinhamento numérico da célula, pela mesma regra do cabeçalho.
   *
   * `PrintTable` classificava só o `th`: no papel a coluna "Total" tinha o
   * título à direita e os valores à esquerda, exatamente nos relatórios que
   * carregam custo e margem. Aqui a linha vem de CSV, então quem conhece o
   * nome da coluna é esta página.
   */
  function numericCellProps(column: string): { className?: string } {
    return COLUNA_NUMERICA.test(column.trim()) ? { className: "is-number" } : {};
  }

  return (
    <PrintSheet
      sheetCode={definition.code}
      title={definition.title}
      backTo={definition.screenPath}
      {...(landscape ? { landscape: true } : {})}
      filters={[...appliedFilters, { label: "Registros", value: String(data.rows.length) }]}
    >
      {definition.internal && (
        <p className="print-doc__notice">
          Documento interno. Contém custo e margem — não é o orçamento entregue ao cliente.
        </p>
      )}

      <PrintTable
        columns={columns}
        isEmpty={data.rows.length === 0}
        emptyMessage="Nenhum registro para os filtros aplicados."
      >
        {data.rows.map((cells, index) => {
          const key = `${index}-${cells[0] ?? ""}`;
          if (!hierarchical) {
            return (
              <tr key={key}>
                {data.header.map((column, position) => (
                  // Valor desconhecido continua vindo como "—" do próprio
                  // read model: o papel nunca inventa zero.
                  <td key={column} {...numericCellProps(column)}>
                    {cells[position]?.trim() || "—"}
                  </td>
                ))}
              </tr>
            );
          }
          return [
            <tr key={`${key}-principal`} className="print-row--primary">
              {primaryIndexes.map((position) => (
                <td
                  key={data.header[position]}
                  {...numericCellProps(data.header[position] ?? "")}
                >
                  {cells[position]?.trim() || "—"}
                </td>
              ))}
            </tr>,
            <tr key={`${key}-detalhe`} className="print-row--detail">
              <td colSpan={primaryIndexes.length}>
                <dl className="print-detail">
                  {detailIndexes.map((position) => (
                    <div key={data.header[position]}>
                      <dt>{data.header[position]}</dt>
                      <dd>{cells[position]?.trim() || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </td>
            </tr>,
          ];
        })}
      </PrintTable>
    </PrintSheet>
  );
}
