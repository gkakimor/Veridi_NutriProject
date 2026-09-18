import type {
  BillingPeriodSummaryDTO,
  InternalConsumptionReportDTO,
  InternalConsumptionReportSummaryDTO,
} from "@veridi/shared";
import { CUSTO_NAO_DISPONIVEL, SEM_DESTINO_INFORMADO } from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
// Só o tipo: o motor de PDF continua carregando apenas quando alguém gera o documento.
import type { ReportPdfSummary } from "../../pdf/documents/ReportPdf";

/**
 * Resumos dos relatórios — o que a tela mostra ACIMA da tabela, escrito uma
 * vez para a tela e para o papel (REPORTS-PDF-SUMMARY-01).
 *
 * Todo número vem do servidor, do recorte inteiro; aqui só se escreve. O
 * indicador da tela e o do PDF saem da mesma função — rótulo, valor e
 * ressalva não têm como divergir entre os dois.
 */

/** Um indicador do resumo, já escrito. */
export type ReportKpi = { label: string; value: string };

/** Custo numa célula: `null` é "Custo não disponível", nunca R$ 0,00. */
export function custo(valor: string | null, formatar: (valor: string) => string): string {
  return valor === null ? CUSTO_NAO_DISPONIVEL : formatar(valor);
}

/* ─────────────── R-21 Uso e consumo ─────────────── */

/**
 * O que o valor total NÃO contém, dito ao lado dele. Um total de custo
 * conhecido sem essa frase seria lido como a despesa inteira do recorte.
 */
export function avisoDoValorDoUsoEConsumo(resumo: InternalConsumptionReportSummaryDTO): string | null {
  if (resumo.missingCostCount === 0) return null;
  if (resumo.knownCostCount === 0) {
    return "Nenhum consumo do recorte tem custo conhecido: o valor total é desconhecido, não R$ 0,00.";
  }
  const semCusto = resumo.missingCostCount;
  return semCusto === 1
    ? `Valor parcial: 1 consumo com ${CUSTO_NAO_DISPONIVEL.toLowerCase()} não entra na soma.`
    : `Valor parcial: ${formatIntegerPtBr(semCusto)} consumos com ${CUSTO_NAO_DISPONIVEL.toLowerCase()} não entram na soma.`;
}

/** Os quatro indicadores do R-21, na ordem da tela. */
export function indicadoresDoUsoEConsumo(resumo: InternalConsumptionReportSummaryDTO): ReportKpi[] {
  return [
    { label: "Consumos", value: formatIntegerPtBr(resumo.consumptionCount) },
    { label: "Valor total conhecido", value: custo(resumo.knownCostTotal, formatBRL) },
    { label: "Consumos sem custo", value: formatIntegerPtBr(resumo.missingCostCount) },
    { label: "Itens distintos", value: formatIntegerPtBr(resumo.distinctItemCount) },
  ];
}

/**
 * R-21 no papel: os indicadores, a ressalva do valor e os dois agrupamentos,
 * com as colunas que o papel já usa na tabela de registros (código e descrição
 * do item separados; quantidade e unidade também). Recorte sem consumo não tem
 * resumo — como na tela, o vazio é dito pela tabela.
 */
export function resumoDoUsoEConsumo(dados: InternalConsumptionReportDTO): ReportPdfSummary | null {
  const { summary } = dados;
  if (summary.consumptionCount === 0) return null;
  const aviso = avisoDoValorDoUsoEConsumo(summary);
  return {
    kpis: indicadoresDoUsoEConsumo(summary),
    notes: aviso ? [aviso] : [],
    tables: [
      {
        title: "Resumo por item",
        header: ["Item", "Descrição", "Consumos", "Quantidade", "Unidade", "Valor conhecido", "Sem custo"],
        rows: dados.byItem.map((grupo) => [
          grupo.itemCode,
          grupo.itemName,
          formatIntegerPtBr(grupo.consumptionCount),
          formatQuantity(grupo.quantity),
          grupo.uomCode,
          custo(grupo.knownCostTotal, formatBRL),
          formatIntegerPtBr(grupo.missingCostCount),
        ]),
      },
      {
        title: "Resumo por destino/uso",
        header: ["Destino/uso", "Consumos", "Valor conhecido", "Sem custo"],
        rows: dados.byPurpose.map((grupo) => [
          grupo.purpose ?? SEM_DESTINO_INFORMADO,
          formatIntegerPtBr(grupo.consumptionCount),
          custo(grupo.knownCostTotal, formatBRL),
          formatIntegerPtBr(grupo.missingCostCount),
        ]),
      },
    ],
    detailTitle: "Consumos",
  };
}

/* ─────────────── R-15 Faturamento por período ─────────────── */

/** Os três indicadores do R-15, na ordem da tela. */
export function indicadoresDoFaturamentoPorPeriodo(resumo: BillingPeriodSummaryDTO): ReportKpi[] {
  return [
    { label: "Documentos emitidos", value: formatIntegerPtBr(resumo.billingCount) },
    {
      label: "Com preço completo",
      value: `${formatIntegerPtBr(resumo.billingsWithCompletePricing)} de ${formatIntegerPtBr(resumo.billingCount)}`,
    },
    // Total só existe quando TODOS os documentos têm preço completo: soma parcial nunca é o total.
    { label: "Valor faturado", value: resumo.totalAmount ? formatBRL(resumo.totalAmount) : "Valores incompletos" },
  ];
}

/**
 * R-15 no papel: só os indicadores — a tela não agrupa. Sem documento no
 * recorte não há resumo: "Valores incompletos" apontaria um preço faltando que
 * não existe.
 */
export function resumoDoFaturamentoPorPeriodo(dados: { summary: BillingPeriodSummaryDTO }): ReportPdfSummary | null {
  if (dados.summary.billingCount === 0) return null;
  return { kpis: indicadoresDoFaturamentoPorPeriodo(dados.summary), detailTitle: "Faturamentos" };
}
