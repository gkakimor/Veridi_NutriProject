import type {
  DecimalInstance,
  ItemType,
  LotStatus,
  StockCountDetailDTO,
  StockCountEntryDTO,
  StockCountExpectedAdjustment,
  StockCountExpiryFilter,
  StockCountPositionDTO,
  StockCountPositionSituation,
  StockCountStatus,
  StockCountSummaryDTO,
} from "@veridi/shared";
import {
  Decimal,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
  STOCK_COUNT_EXPIRY_FILTER_LABELS,
  textoDecimal,
} from "@veridi/shared";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";

/**
 * Como o Inventário Físico se lê na tela — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * Nada aqui calcula diferença, saldo nem "confere": o que revela a contagem
 * vem do servidor, já escondido quando a leitura é cega. A tela só escolhe o
 * rótulo e a cor.
 */

export const ROTA_DOS_INVENTARIOS = "/estoque/inventario";

export function rotaDoInventario(id: string): string {
  return `${ROTA_DOS_INVENTARIOS}/${id}`;
}

export function rotaDaContagem(id: string): string {
  return `${ROTA_DOS_INVENTARIOS}/${id}/contagem`;
}

export function statusBadgeClass(status: StockCountStatus): string {
  if (status === "IN_PROGRESS") return "badge badge--info";
  if (status === "IN_REVIEW") return "badge badge--warn";
  if (status === "COMPLETED") return "badge badge--active";
  return "badge badge--neutral";
}

export function situacaoBadgeClass(situacao: StockCountPositionSituation): string {
  if (situacao === "COUNTED" || situacao === "DECIDED") return "badge badge--info";
  if (situacao === "MATCHES") return "badge badge--active";
  if (situacao === "DIVERGENT" || situacao === "RECOUNT_REQUESTED") return "badge badge--warn";
  return "badge badge--neutral";
}

export function estaAberto(status: StockCountStatus): boolean {
  return status === "IN_PROGRESS" || status === "IN_REVIEW";
}

/** Posição que ainda espera contagem na rodada atual — inclusive a recontagem pedida. */
export function aguardaContagem(posicao: Pick<StockCountPositionDTO, "situation">): boolean {
  return posicao.situation === "PENDING" || posicao.situation === "RECOUNT_REQUESTED";
}

/** O registro que vale para a decisão — de qualquer rodada. */
export function registroQueVale(
  posicao: Pick<StockCountPositionDTO, "entries" | "validEntryId">,
): StockCountEntryDTO | null {
  return posicao.entries.find((registro) => registro.id === posicao.validEntryId) ?? null;
}

/**
 * A decisão desta posição só fecha com confirmação explícita da movimentação:
 * divergência marcada e ainda na primeira contagem — a mesma regra que o
 * encerramento aplica. Recontada, a rodada nova já congelou o próprio esperado.
 */
export function pedeConfirmacaoDeMovimentacao(
  posicao: Pick<StockCountPositionDTO, "hasConcurrentMovement" | "entries" | "validEntryId">,
): boolean {
  return posicao.hasConcurrentMovement === true && registroQueVale(posicao)?.round === 1;
}

/** Ajustar ou Não ajustar: só onde há diferença que vale — divergente ou já decidida. */
export function podeDecidir(posicao: Pick<StockCountPositionDTO, "situation">): boolean {
  return posicao.situation === "DIVERGENT" || posicao.situation === "DECIDED";
}

/** Recontagem: posição contada que não espera recontagem — confira ou não. */
export function podePedirRecontagem(posicao: Pick<StockCountPositionDTO, "situation">): boolean {
  return posicao.situation === "DIVERGENT" || posicao.situation === "DECIDED" || posicao.situation === "MATCHES";
}

/** "+0,5" / "-1" — a diferença com o sinal explícito; `null` é "—". */
export function diferencaComSinal(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const numero = new Decimal(valor);
  return numero.greaterThan(0) ? `+${formatQuantity(valor)}` : formatQuantity(valor);
}

/** "Entrada de 0,5 kg" / "Saída de 1 kg" — o ajuste que a diferença geraria. */
export function ajusteDaDiferenca(diferenca: string | null | undefined, unidade: string): string {
  if (diferenca === null || diferenca === undefined || diferenca === "") return "—";
  const numero = new Decimal(diferenca);
  if (numero.isZero()) return "Nenhum";
  return `${numero.greaterThan(0) ? "Entrada" : "Saída"} de ${formatQuantityWithUnit(textoDecimal(numero.abs()), unidade)}`;
}

export interface TotalDaUnidade {
  unitCode: string;
  /** Soma das entradas, em texto decimal. */
  entradas: string;
  /** Soma das saídas, em magnitude. */
  saidas: string;
}

export interface ResumoDoEncerramento {
  ajustes: number;
  entradas: number;
  saidas: number;
  /** Uma linha por unidade — nunca uma soma entre unidades diferentes. */
  porUnidade: TotalDaUnidade[];
  itens: number;
  lotes: number;
  naoAjustar: number;
  conferem: number;
  ocorrencias: number;
  /** O que a tela mostra como consequência, e o que o encerramento confere no servidor. */
  ajustesEsperados: StockCountExpectedAdjustment[];
  /** O que esta leitura já sabe que impede o encerramento — quem decide é o servidor. */
  semContagem: number;
  recontagemPedida: number;
  semDecisao: number;
  semConfirmacao: number;
}

/**
 * A consequência do encerramento lida da revisão: quantos ajustes de entrada e
 * de saída, as somas por unidade em `Decimal` do shared, quantas posições
 * ficam sem ajuste, quantas conferem e as ocorrências. É a leitura desta tela;
 * o servidor recalcula tudo no encerramento e recusa se os ajustes mudaram.
 */
export function resumoDoEncerramento(
  inventario: Pick<StockCountDetailDTO, "positions" | "findings">,
): ResumoDoEncerramento {
  const resumo: ResumoDoEncerramento = {
    ajustes: 0,
    entradas: 0,
    saidas: 0,
    porUnidade: [],
    itens: 0,
    lotes: 0,
    naoAjustar: 0,
    conferem: 0,
    ocorrencias: inventario.findings.length,
    ajustesEsperados: [],
    semContagem: 0,
    recontagemPedida: 0,
    semDecisao: 0,
    semConfirmacao: 0,
  };
  const somas = new Map<string, { entradas: DecimalInstance; saidas: DecimalInstance }>();
  const itens = new Set<string>();
  const lotes = new Set<string>();

  for (const posicao of inventario.positions) {
    if (posicao.situation === "REMOVED") continue;
    if (posicao.situation === "PENDING") resumo.semContagem += 1;
    else if (posicao.situation === "RECOUNT_REQUESTED") resumo.recontagemPedida += 1;
    else if (posicao.situation === "MATCHES") resumo.conferem += 1;
    else if (posicao.situation === "DIVERGENT") resumo.semDecisao += 1;
    if (posicao.situation !== "DIVERGENT" && posicao.situation !== "DECIDED") continue;
    if (pedeConfirmacaoDeMovimentacao(posicao) && !posicao.concurrentMovementConfirmed) resumo.semConfirmacao += 1;
    if (posicao.situation !== "DECIDED") continue;

    if (posicao.decision === "NO_ADJUSTMENT") {
      resumo.naoAjustar += 1;
      continue;
    }
    if (posicao.decision !== "ADJUST" || posicao.finalDifference === null || posicao.validEntryId === null) continue;
    const diferenca = new Decimal(posicao.finalDifference);
    if (diferenca.isZero()) continue;

    resumo.ajustes += 1;
    resumo.ajustesEsperados.push({ positionId: posicao.id, entryId: posicao.validEntryId });
    itens.add(posicao.itemId);
    if (posicao.lotId) lotes.add(posicao.lotId);
    const soma = somas.get(posicao.unitCode) ?? { entradas: new Decimal(0), saidas: new Decimal(0) };
    if (diferenca.greaterThan(0)) {
      resumo.entradas += 1;
      soma.entradas = soma.entradas.plus(diferenca);
    } else {
      resumo.saidas += 1;
      soma.saidas = soma.saidas.plus(diferenca.abs());
    }
    somas.set(posicao.unitCode, soma);
  }

  resumo.itens = itens.size;
  resumo.lotes = lotes.size;
  resumo.porUnidade = [...somas.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([unitCode, soma]) => ({
      unitCode,
      entradas: textoDecimal(soma.entradas),
      saidas: textoDecimal(soma.saidas),
    }));
  return resumo;
}

/** "51 / 91 · 56%". Sem posição ativa, só "0 / 0". */
export function progressoDoInventario(resumo: Pick<StockCountSummaryDTO, "countedCount" | "positionCount">): string {
  const base = `${formatIntegerPtBr(resumo.countedCount)} / ${formatIntegerPtBr(resumo.positionCount)}`;
  if (resumo.positionCount === 0) return base;
  const percentual = Math.floor((resumo.countedCount * 100) / resumo.positionCount);
  return `${base} · ${formatIntegerPtBr(percentual)}%`;
}

/** Divergências só existem depois de reveladas: `null` é "—", nunca zero. */
export function divergenciasDoInventario(resumo: Pick<StockCountSummaryDTO, "divergentCount">): string {
  return resumo.divergentCount === null ? "—" : formatIntegerPtBr(resumo.divergentCount);
}

export function donoDaPosicao(
  posicao: Pick<StockCountPositionDTO, "ownerType" | "ownerCustomerCode" | "ownerCustomerName">,
): string {
  if (posicao.ownerType === "VERIDI") return "Veridi";
  return posicao.ownerCustomerCode ?? posicao.ownerCustomerName ?? "Cliente";
}

export function situacaoDoLote(status: LotStatus | null, vencido = false): string {
  if (status === null) return "—";
  if (vencido && status !== "EXPIRED") return `${LOT_STATUS_LABELS[status]} · vencido`;
  return LOT_STATUS_LABELS[status];
}

/** Busca da contagem: item, código, lote — e `LOT:<código>`, o conteúdo do QR, casa só aquele lote. */
export function casaComBusca(
  posicao: Pick<StockCountPositionDTO, "itemCode" | "itemName" | "lotCode">,
  termo: string,
): boolean {
  const busca = termo.trim().toLocaleLowerCase("pt-BR");
  if (!busca) return true;
  if (busca.startsWith("lot:")) {
    const lote = busca.slice(4).trim();
    return lote.length > 0 && (posicao.lotCode ?? "").toLocaleLowerCase("pt-BR") === lote;
  }
  return [posicao.itemCode, posicao.itemName, posicao.lotCode ?? ""].some((campo) =>
    campo.toLocaleLowerCase("pt-BR").includes(busca),
  );
}

interface EscopoGravado {
  scope?: {
    itemTypes?: ItemType[];
    balance?: "WITH_BALANCE" | "ANY";
    owner?: "ALL" | "VERIDI" | "CUSTOMER";
    customerId?: string;
    itemIds?: string[];
    lotIds?: string[];
    locationContains?: string;
    lotStatuses?: LotStatus[];
    expiry?: StockCountExpiryFilter;
    expiringWithinDays?: number;
  };
  excludedCount?: number;
  heldByOpenCounts?: { positionKey: string; stockCountCode: string }[];
}

/**
 * O escopo com que o inventário começou, em frases — lido do retrato gravado
 * no início (`scopeFilters`). O que o retrato não tem, a tela não inventa.
 */
export function descreverEscopo(scopeFilters: unknown): { rotulo: string; valor: string }[] {
  if (scopeFilters === null || typeof scopeFilters !== "object") return [];
  const gravado = scopeFilters as EscopoGravado;
  const escopo = gravado.scope;
  if (!escopo) return [];
  const linhas: { rotulo: string; valor: string }[] = [];

  const tipos = escopo.itemTypes ?? [];
  linhas.push({
    rotulo: "Tipo de item",
    valor: tipos.length === 0 ? "Todos" : tipos.map((tipo) => ITEM_TYPE_LABELS[tipo] ?? tipo).join(", "),
  });
  linhas.push({
    rotulo: "Saldo",
    valor: escopo.balance === "ANY" ? "Com ou sem saldo" : "Somente com saldo",
  });
  const propriedade =
    escopo.owner === "VERIDI"
      ? "Veridi"
      : escopo.owner === "CUSTOMER"
        ? escopo.customerId
          ? "Material de um cliente"
          : "Material de clientes"
        : "Todas";
  linhas.push({ rotulo: "Propriedade", valor: propriedade });
  if (escopo.itemIds && escopo.itemIds.length > 0) {
    linhas.push({
      rotulo: "Seleção",
      valor: `${formatIntegerPtBr(escopo.itemIds.length)} ${escopo.itemIds.length === 1 ? "item escolhido" : "itens escolhidos"}`,
    });
  }
  if (escopo.lotIds && escopo.lotIds.length > 0) {
    linhas.push({
      rotulo: "Seleção",
      valor: `${formatIntegerPtBr(escopo.lotIds.length)} ${escopo.lotIds.length === 1 ? "lote escolhido" : "lotes escolhidos"}`,
    });
  }
  if (escopo.locationContains) {
    linhas.push({ rotulo: "Local contém", valor: escopo.locationContains });
  }
  if (escopo.lotStatuses && escopo.lotStatuses.length > 0) {
    linhas.push({
      rotulo: "Situação do lote",
      valor: escopo.lotStatuses.map((situacao) => LOT_STATUS_LABELS[situacao] ?? situacao).join(", "),
    });
  }
  if (escopo.expiry && escopo.expiry !== "ANY") {
    linhas.push({
      rotulo: "Validade",
      valor:
        escopo.expiry === "EXPIRING"
          ? `Vence em até ${formatIntegerPtBr(escopo.expiringWithinDays ?? 0)} ${escopo.expiringWithinDays === 1 ? "dia" : "dias"}`
          : (STOCK_COUNT_EXPIRY_FILTER_LABELS[escopo.expiry] ?? escopo.expiry),
    });
  }
  if (gravado.excludedCount && gravado.excludedCount > 0) {
    linhas.push({ rotulo: "Retiradas na prévia", valor: formatIntegerPtBr(gravado.excludedCount) });
  }
  const retidas = gravado.heldByOpenCounts ?? [];
  if (retidas.length > 0) {
    const codigos = [...new Set(retidas.map((retida) => retida.stockCountCode))].join(", ");
    linhas.push({
      rotulo: "Fora por estar em outro inventário",
      valor: `${formatIntegerPtBr(retidas.length)} (${codigos})`,
    });
  }
  return linhas;
}
