import { diaCivilDeslocado, ehDiaCivil, hojeComercial } from "./business-timezone.js";
import type { CustomerOrderStatus } from "./customer-orders.js";
import { Decimal } from "./decimal-config.js";
import { recusaDoPeriodo } from "./period-range.js";
import type { PurchaseOrderStatus } from "./purchase-orders.js";
import type { UserRole } from "./users.js";

/**
 * Painel Gerencial — o contrato da tela e as regras de calendário dela
 * (MANAGEMENT-DASHBOARD-V1-01, decisões D1–D5 de
 * FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01).
 *
 * Valores COMERCIAIS, nunca financeiros. Faturado não é recebido, compra
 * contratada não é paga, e esta tela não tem contas a receber, contas a pagar,
 * caixa, imposto, margem nem CMV do período: o domínio não registra esses
 * fatos, e inferi-los de preço ou de custo seria inventar dinheiro.
 *
 * Três horizontes que nunca se misturam:
 * - RESULTADO DO PERÍODO — responde ao período escolhido;
 * - POSIÇÃO ATUAL — a carteira de agora, que ignora o período;
 * - PRÓXIMOS COMPROMISSOS — o que já está registrado para hoje e os 29 dias
 *   seguintes, sem previsão estatística.
 */

/**
 * Quem vê o Painel Gerencial (decisão D4). A API recusa os demais perfis com
 * 403; o menu e a tela usam a MESMA lista só para não oferecer o que seria
 * negado. A restrição é da tela, não do dado: os mesmos valores continuam nas
 * telas operacionais e nos relatórios abertos.
 */
export const MANAGEMENT_DASHBOARD_ROLES: readonly UserRole[] = ["COMMERCIAL", "ADMIN"];

/**
 * Pedido que conta em "Pedidos confirmados": confirmado e ainda de pé.
 * Rascunho nunca confirmou. O cancelado sai da conta também no período
 * passado — confirmado que não virou compromisso não é carteira (§6.3 do
 * discovery).
 */
export const CONFIRMED_ORDER_STATUSES: readonly CustomerOrderStatus[] = [
  "CONFIRMED",
  "IN_FULFILLMENT",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
];

/**
 * A CARTEIRA: Pedidos com saldo a expedir. `SHIPPED` já não tem saldo, e
 * rascunho e cancelado não são compromisso. É também o grupo "Carteira" da
 * lista de Pedidos — o destino do "A expedir" filtra exatamente isto.
 */
export const PORTFOLIO_ORDER_STATUSES: readonly CustomerOrderStatus[] = [
  "CONFIRMED",
  "IN_FULFILLMENT",
  "PARTIALLY_SHIPPED",
];

/**
 * Ordem de Compra CONTRATADA: confirmada ao fornecedor, recebida em parte ou
 * inteira. Rascunho não foi pedido e cancelada não vale. É o grupo
 * "Contratadas" da lista de Ordens de Compra.
 */
export const CONTRACTED_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
];

/** Quantos clientes e quantos produtos cada ranking mostra. */
export const MANAGEMENT_RANKING_LIMIT = 10;

/** Quantos documentos cada lista curta cita — sem valor, entregas, compras. */
export const MANAGEMENT_LIST_LIMIT = 10;

/** Próximos compromissos: hoje e os 29 dias civis seguintes. */
export const MANAGEMENT_COMMITMENT_WINDOW_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Período e comparação
 * ------------------------------------------------------------------ */

export type ManagementPeriodPreset = "mes-atual" | "mes-anterior" | "acumulado-ano" | "custom";

export const MANAGEMENT_PERIOD_PRESETS: readonly ManagementPeriodPreset[] = [
  "mes-atual",
  "mes-anterior",
  "acumulado-ano",
  "custom",
];

/** Gestão pergunta por mês e por ano. "Acumulado no ano", nunca a sigla em inglês. */
export const MANAGEMENT_PERIOD_PRESET_LABELS: Record<ManagementPeriodPreset, string> = {
  "mes-atual": "Mês atual",
  "mes-anterior": "Mês anterior",
  "acumulado-ano": "Acumulado no ano",
  custom: "Personalizado",
};

export function ehPeriodoGerencial(valor: string): valor is ManagementPeriodPreset {
  return (MANAGEMENT_PERIOD_PRESETS as readonly string[]).includes(valor);
}

/** Dias civis `YYYY-MM-DD`, as duas pontas inclusivas. */
export interface IntervaloDeDias {
  from: string;
  to: string;
}

/** O período escolhido e o período equivalente com que ele se compara. */
export interface PeriodoGerencial {
  current: IntervaloDeDias;
  previous: IntervaloDeDias;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

function partesDoDia(diaISO: string): [number, number, number] {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  return [ano, mes, dia];
}

function diaDoCalendario(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Quantos dias o mês tem — `mes` de 1 a 12. Conta em UTC: calendário, não relógio. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function mesAnterior(ano: number, mes: number): [number, number] {
  return mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
}

/** O mesmo dia noutro mês — ou o último dia dele, quando o mês é mais curto (31 → 28/02). */
function mesmoDiaNoMes(ano: number, mes: number, dia: number): string {
  return diaDoCalendario(ano, mes, Math.min(dia, ultimoDiaDoMes(ano, mes)));
}

/** Quantos dias o intervalo cobre, contando as duas pontas — `from` = `to` é 1. */
export function diasDoIntervalo({ from, to }: IntervaloDeDias): number {
  const [anoDe, mesDe, diaDe] = partesDoDia(from);
  const [anoAte, mesAte, diaAte] = partesDoDia(to);
  return Math.round((Date.UTC(anoAte, mesAte - 1, diaAte) - Date.UTC(anoDe, mesDe - 1, diaDe)) / UM_DIA_MS) + 1;
}

/** Por que o período não se consulta: a ponta a corrigir e a frase. */
export interface RecusaDoPeriodoGerencial {
  campo: "dateFrom" | "dateTo";
  mensagem: string;
}

export const MENSAGEM_PERIODO_SEM_INICIO = "Informe a data inicial do período personalizado.";
export const MENSAGEM_PERIODO_SEM_FIM = "Informe a data final do período personalizado.";

/**
 * Por que o período do Painel Gerencial não pode ser consultado — `null` quando
 * pode. A mesma regra no servidor (que recusa com 400) e na tela (que não pede
 * o que seria recusado).
 *
 * Os atalhos não recebem datas: quem resolve o mês e o ano é o servidor, no dia
 * comercial da requisição. O Personalizado exige as DUAS pontas — ao contrário
 * do Painel Operacional, a ponta vazia não vira hoje, porque a comparação
 * precisa de um intervalo concreto para achar o equivalente anterior.
 */
export function recusaDoPeriodoGerencial(
  preset: ManagementPeriodPreset,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): RecusaDoPeriodoGerencial | null {
  if (preset !== "custom") return null;
  if (!dateFrom || !ehDiaCivil(dateFrom)) return { campo: "dateFrom", mensagem: MENSAGEM_PERIODO_SEM_INICIO };
  if (!dateTo || !ehDiaCivil(dateTo)) return { campo: "dateTo", mensagem: MENSAGEM_PERIODO_SEM_FIM };
  const invertido = recusaDoPeriodo(dateFrom, dateTo);
  return invertido ? { campo: "dateFrom", mensagem: invertido } : null;
}

/**
 * Os dias do período e do período equivalente anterior, no dia comercial de
 * `agora` (São Paulo — nunca o relógio da máquina nem o do navegador).
 *
 * - **Mês atual** — do dia 1 até hoje; compara com o mês anterior do dia 1 até
 *   o mesmo dia, ou até o último dia dele quando é mais curto (31/03 compara
 *   com 01/02 a 28/02).
 * - **Mês anterior** — o mês fechado; compara com o mês fechado antes dele.
 * - **Acumulado no ano** — de 1º de janeiro até hoje, no ano CIVIL (o ERP não
 *   tem exercício fiscal); compara com o mesmo intervalo do ano anterior, e
 *   29/02 compara com 28/02.
 * - **Personalizado** — as datas escolhidas; compara com o intervalo de mesmo
 *   número de dias imediatamente antes.
 *
 * Período personalizado recusado (`recusaDoPeriodoGerencial`) não se resolve:
 * quem chama recusa antes.
 */
export function resolverPeriodoGerencial(
  preset: ManagementPeriodPreset,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  agora: Date = new Date(),
): PeriodoGerencial {
  const hoje = hojeComercial(agora);
  const [ano, mes, dia] = partesDoDia(hoje);

  switch (preset) {
    case "mes-atual": {
      const [anoDoAnterior, mesDoAnterior] = mesAnterior(ano, mes);
      return {
        current: { from: diaDoCalendario(ano, mes, 1), to: hoje },
        previous: {
          from: diaDoCalendario(anoDoAnterior, mesDoAnterior, 1),
          to: mesmoDiaNoMes(anoDoAnterior, mesDoAnterior, dia),
        },
      };
    }
    case "mes-anterior": {
      const [anoDoMes, mesFechado] = mesAnterior(ano, mes);
      const [anoDoAnterior, mesDoAnterior] = mesAnterior(anoDoMes, mesFechado);
      return {
        current: {
          from: diaDoCalendario(anoDoMes, mesFechado, 1),
          to: diaDoCalendario(anoDoMes, mesFechado, ultimoDiaDoMes(anoDoMes, mesFechado)),
        },
        previous: {
          from: diaDoCalendario(anoDoAnterior, mesDoAnterior, 1),
          to: diaDoCalendario(anoDoAnterior, mesDoAnterior, ultimoDiaDoMes(anoDoAnterior, mesDoAnterior)),
        },
      };
    }
    case "acumulado-ano":
      return {
        current: { from: diaDoCalendario(ano, 1, 1), to: hoje },
        previous: { from: diaDoCalendario(ano - 1, 1, 1), to: mesmoDiaNoMes(ano - 1, mes, dia) },
      };
    case "custom": {
      if (recusaDoPeriodoGerencial(preset, dateFrom, dateTo) || !dateFrom || !dateTo) {
        throw new Error("Período personalizado recusado: recuse com recusaDoPeriodoGerencial antes de resolver.");
      }
      const current = { from: dateFrom, to: dateTo };
      const dias = diasDoIntervalo(current);
      return {
        current,
        previous: { from: diaCivilDeslocado(dateFrom, -dias), to: diaCivilDeslocado(dateFrom, -1) },
      };
    }
  }
}

/**
 * A variação percentual do valor atual sobre o anterior, com uma casa
 * (`"8.2"`, `"-100.0"`, `"0.0"`).
 *
 * `null` é "Sem base de comparação": falta um dos dois valores (incompleto) ou
 * o anterior não é maior que zero — nunca "+∞%" nem um "+100%" inventado.
 */
export function variacaoPercentual(atual: string | null, anterior: string | null): string | null {
  if (atual === null || anterior === null) return null;
  const base = new Decimal(anterior);
  if (!base.greaterThan(0)) return null;
  const variacao = new Decimal(atual)
    .minus(base)
    .dividedBy(base)
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return variacao.isZero() ? "0.0" : variacao.toFixed(1);
}

/* ------------------------------------------------------------------ *
 * Tendência
 * ------------------------------------------------------------------ */

export type GranularidadeDaTendencia = "day" | "week" | "month";

/**
 * Barra por dia até 31 dias (um mês), por semana até 62 e por mês acima disso
 * — o Acumulado no ano vira meses. Poucas barras legíveis, sem complexidade.
 */
export function granularidadeDaTendencia(intervalo: IntervaloDeDias): GranularidadeDaTendencia {
  const dias = diasDoIntervalo(intervalo);
  if (dias <= 31) return "day";
  if (dias <= 62) return "week";
  return "month";
}

/**
 * Os intervalos das barras, contíguos e sem sobra: dia a dia; semanas de 7
 * dias contadas do início do período (a última pode ser mais curta); ou meses
 * civis, com o primeiro e o último cortados pelo período. Cada barra é um
 * intervalo de dias de verdade — é ele que o link da barra filtra.
 */
export function baldesDaTendencia(intervalo: IntervaloDeDias): IntervaloDeDias[] {
  const granularidade = granularidadeDaTendencia(intervalo);
  const baldes: IntervaloDeDias[] = [];
  let inicio = intervalo.from;
  while (inicio <= intervalo.to) {
    let fim: string;
    if (granularidade === "day") {
      fim = inicio;
    } else if (granularidade === "week") {
      fim = diaCivilDeslocado(inicio, 6);
    } else {
      const [ano, mes] = partesDoDia(inicio);
      fim = diaDoCalendario(ano, mes, ultimoDiaDoMes(ano, mes));
    }
    if (fim > intervalo.to) fim = intervalo.to;
    baldes.push({ from: inicio, to: fim });
    inicio = diaCivilDeslocado(fim, 1);
  }
  return baldes;
}

/* ------------------------------------------------------------------ *
 * Contrato da resposta — `GET /management-dashboard`
 * ------------------------------------------------------------------ */

/**
 * Um valor em reais de um recorte, e o que falta para ele existir (§30, D2).
 *
 * - `count` 0: não há documento — a tela diz "—" e a frase do vazio, nunca
 *   "R$ 0,00" nem "Valores incompletos";
 * - `amount` nulo com `count` > 0: algum documento não tem valor — "Valores
 *   incompletos" e "N de M", sem subtotal que pareça total;
 * - `amount` preenchido: todos têm valor, e a soma é o total.
 */
export interface ValorDoRecorteDTO {
  count: number;
  withValue: number;
  amount: string | null;
}

/** Um documento citado pela tela: o código que a pessoa lê e o id que abre. */
export interface DocumentoCitadoDTO {
  id: string;
  code: string;
}

/**
 * O valor que entra na comparação: sem documento é zero de verdade; incompleto
 * não compara.
 */
export function valorComparavel(recorte: ValorDoRecorteDTO): string | null {
  if (recorte.count === 0) return "0.00";
  return recorte.amount;
}

export interface IndicadorMonetarioDTO {
  current: ValorDoRecorteDTO;
  previous: ValorDoRecorteDTO;
  /** Uma casa, com sinal. `null` = "Sem base de comparação". */
  variationPercent: string | null;
  /** Os primeiros documentos do período atual sem valor — para completar o dado. */
  withoutValue: DocumentoCitadoDTO[];
}

export interface IndicadorDeContagemDTO {
  current: number;
  previous: number;
  variationPercent: string | null;
}

/** Posição atual em reais: a contagem é de Pedidos (A expedir) ou de Expedições (A faturar). */
export interface PosicaoMonetariaDTO extends ValorDoRecorteDTO {
  withoutValue: DocumentoCitadoDTO[];
}

export interface BaldeDaTendenciaDTO extends IntervaloDeDias, ValorDoRecorteDTO {}

export interface ClienteDoRankingDTO {
  customerId: string;
  code: string | null;
  name: string | null;
  amount: string;
  billingCount: number;
}

/** Cliente com faturamento sem valor no período: fora do ranking, e nomeado. */
export interface ClienteForaDoRankingDTO {
  customerId: string;
  code: string | null;
  name: string | null;
  billingCount: number;
  withoutValue: number;
}

/** Quantidade de um produto numa unidade — nunca somada com outra unidade. */
export interface QuantidadeNaUnidadeDTO {
  unitCode: string;
  quantity: string;
}

export interface ProdutoDoRankingDTO {
  productId: string;
  code: string;
  name: string;
  /** O dono do produto — destino da Visão do Cliente. */
  customerId: string | null;
  /** Soma das linhas faturadas, cada uma arredondada, ANTES do desconto do Pedido. */
  amount: string;
  quantities: QuantidadeNaUnidadeDTO[];
}

/** Produto com linha faturada sem preço no período: fora do ranking, e nomeado. */
export interface ProdutoForaDoRankingDTO {
  productId: string;
  code: string;
  name: string;
  customerId: string | null;
  linesWithoutPrice: number;
}

export interface EntregaDoCompromissoDTO {
  deliveryId: string;
  customerOrderId: string;
  customerOrderCode: string;
  sequence: number;
  /** Dia civil prometido, `YYYY-MM-DD`. */
  scheduledDate: string;
  customerName: string | null;
}

export interface CompraEsperadaDTO {
  purchaseOrderId: string;
  code: string;
  supplierName: string;
  /** Dia civil previsto, `YYYY-MM-DD`. */
  expectedDeliveryDate: string;
}

export interface ManagementDashboardDTO {
  /** O instante único da requisição. */
  generatedAt: string;
  /** Hoje, no dia comercial da requisição. */
  today: string;
  period: {
    preset: ManagementPeriodPreset;
    current: IntervaloDeDias;
    previous: IntervaloDeDias;
  };
  result: {
    /** Faturamentos emitidos, por `issuedAt`, pelo valor do documento (D1). */
    billed: IndicadorMonetarioDTO;
    /** Pedidos confirmados, por `confirmedAt`, pelo total acordado. */
    confirmedOrders: IndicadorMonetarioDTO;
    /** Ordens de Compra contratadas, por `orderDate`, pelo total da OC (§61). */
    contractedPurchases: IndicadorMonetarioDTO;
    /** Clientes distintos com faturamento emitido. */
    billedCustomers: IndicadorDeContagemDTO;
  };
  /** Não responde ao período. Preço acordado, antes do desconto do Pedido (D5). */
  position: {
    toShip: PosicaoMonetariaDTO;
    toBill: PosicaoMonetariaDTO;
  };
  trend: {
    granularity: GranularidadeDaTendencia;
    buckets: BaldeDaTendenciaDTO[];
  };
  rankings: {
    customers: {
      rows: ClienteDoRankingDTO[];
      excluded: ClienteForaDoRankingDTO[];
      excludedTotal: number;
    };
    products: {
      rows: ProdutoDoRankingDTO[];
      excluded: ProdutoForaDoRankingDTO[];
      excludedTotal: number;
    };
  };
  /** Não responde ao período. Só o que está registrado. */
  commitments: {
    window: IntervaloDeDias;
    /** Entregas com saldo no dia prometido dentro da janela; valor acordado antes do desconto. */
    scheduledDeliveries: ValorDoRecorteDTO & { items: EntregaDoCompromissoDTO[] };
    /** Entregas com saldo cujo dia prometido já passou. */
    lateDeliveries: { count: number; items: EntregaDoCompromissoDTO[] };
    /** OCs abertas com saldo e previsão dentro da janela — contagem, sem valor previsto. */
    expectedPurchases: { count: number; items: CompraEsperadaDTO[] };
  };
}
