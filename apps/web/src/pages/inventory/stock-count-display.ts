import type {
  ItemType,
  LotStatus,
  StockCountPositionDTO,
  StockCountPositionSituation,
  StockCountStatus,
  StockCountSummaryDTO,
} from "@veridi/shared";
import { ITEM_TYPE_LABELS, LOT_STATUS_LABELS } from "@veridi/shared";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";

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
