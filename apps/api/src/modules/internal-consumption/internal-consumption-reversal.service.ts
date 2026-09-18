import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { InternalConsumptionReversal } from "@prisma/client";
import type { InternalConsumptionDetailDTO, InternalConsumptionReversalDTO } from "@veridi/shared";
import { INTERNAL_CONSUMPTION_REVERSAL_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { Decimal } from "../../lib/decimal.js";
import { isLotExpired } from "../../lib/inventory-ledger.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { fecharTotalTecnicoPersistido } from "../../lib/technical-total.js";
import { lockStockScope } from "../inventory/inventory.service.js";
import { chaveDaPosicao } from "../inventory/stock-count.service.js";
import {
  InternalConsumptionNotFoundError,
  NothingToReverseError,
  ReversalConcurrentWriteError,
  ReversalExceedsBalanceError,
  ReversalPositionCountedAfterConsumptionError,
  ReversalPositionInOpenCountError,
  ReversalStateChangedError,
} from "./internal-consumption.errors.js";
import type { CreateInternalConsumptionReversalBody } from "./internal-consumption.schemas.js";
import { internalConsumptionToDTO } from "./internal-consumption.service.js";

/**
 * ESTORNO DE CONSUMO INTERNO (ECI-) — INTERNAL-CONSUMPTION-REVERSAL-01.
 *
 * Decisões do PO (INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01, P1–P10):
 *
 * - o estorno é uma ENTRADA própria do ledger (`INTERNAL_CONSUMPTION_REVERSAL`),
 *   datada no instante do estorno. O CI original nunca é editado nem apagado,
 *   e nada é retroativo: o ledger continua só de acréscimo;
 * - total, parcial e vários estornos, até a quantidade do CI. Estornado e
 *   saldo estornável são SOMA dos registros, nunca um contador guardado;
 * - a quantidade volta SEMPRE ao escopo do CI — item, ou item + o MESMO lote,
 *   mesmo bloqueado ou vencido; a situação do lote não muda;
 * - item inativo pode ser estornado: é a anulação de uma saída histórica, não
 *   uma entrada operacional nova;
 * - o custo é CÓPIA do snapshot do CI, nunca recalculado. O total é pró-rata
 *   (ROUND_HALF_UP, 4 casas) e o estorno que zera o saldo leva o resto, para
 *   o estorno integral fechar exatamente o total original;
 * - posição em Inventário Físico aberto, ou contada num inventário encerrado
 *   DEPOIS do registro do CI, recusa: a contagem já acertou (ou vai acertar)
 *   o saldo, e o estorno corrigiria duas vezes;
 * - não existe estorno de estorno.
 */

const CODE_SEQUENCE = "internal_consumption_reversal_code_seq";

/** Quantos ajustes manuais posteriores o diálogo lista — o resto vira contagem. */
const AJUSTES_POSTERIORES_NA_TELA = 5;

type ReversalWithOriginal = InternalConsumptionReversal & {
  originalConsumption: { code: string; uomCode: string };
};

const reversalInclude = { originalConsumption: { select: { code: true, uomCode: true } } } as const;

export function internalConsumptionReversalToDTO(reversal: ReversalWithOriginal): InternalConsumptionReversalDTO {
  return {
    id: reversal.id,
    code: reversal.code,
    originalConsumptionId: reversal.originalConsumptionId,
    originalConsumptionCode: reversal.originalConsumption.code,
    quantity: reversal.quantity.toString(),
    uomCode: reversal.originalConsumption.uomCode,
    reason: reversal.reason,
    // `null` atravessa como `null` — ausência de custo nunca vira "0".
    unitCost: reversal.unitCost ? reversal.unitCost.toString() : null,
    totalCost: reversal.totalCost ? reversal.totalCost.toString() : null,
    costSource: reversal.costSource,
    costDetails: reversal.costDetails,
    inventoryMovementId: reversal.inventoryMovementId,
    registeredByUserId: reversal.registeredByUserId,
    registeredByName: reversal.registeredByNameSnapshot,
    createdAt: reversal.createdAt.toISOString(),
  };
}

/**
 * O custo total do estorno, a partir do snapshot do CI.
 *
 * Parcial = ROUND_HALF_UP_4(total do CI × quantidade / quantidade do CI). O
 * estorno que zera o saldo estornável leva o RESTO (total do CI − estornos
 * anteriores): a soma dos estornos de um CI estornado por inteiro é
 * exatamente o total dele, e o líquido fica 0,0000.
 *
 * O parcial nunca passa do que ainda resta do total: com total ínfimo e
 * muitos parciais, o arredondamento para cima de cada um poderia somar mais
 * que o original e deixar o último estorno negativo.
 */
export function custoTotalDoEstorno(params: {
  totalDoConsumo: Prisma.Decimal | null;
  quantidadeDoConsumo: Prisma.Decimal;
  quantidade: Prisma.Decimal;
  custoJaEstornado: Prisma.Decimal;
  zeraOSaldo: boolean;
}): Prisma.Decimal | null {
  if (params.totalDoConsumo === null) return null;
  const restante = Decimal.max(params.totalDoConsumo.minus(params.custoJaEstornado), 0);
  if (params.zeraOSaldo) return restante;
  const proRata = fecharTotalTecnicoPersistido(
    params.totalDoConsumo.times(params.quantidade).dividedBy(params.quantidadeDoConsumo),
  );
  return Decimal.min(proRata, restante);
}

/**
 * Estorna um consumo interno: devolve a quantidade ao mesmo escopo e grava o
 * registro ECI- com motivo, autoria e o custo copiado.
 *
 * Uma transação só, nesta ordem (handoff): trava o CI, trava o escopo do
 * saldo, confere inventário aberto e contagem posterior, soma os estornos,
 * confere o "já estornado" que a tela mostrou, gera o código, grava o
 * movimento e o estorno. Dois estornos do mesmo CI esperam um pelo outro na
 * trava do CI — a soma nunca passa da quantidade original.
 */
export async function reverseInternalConsumption(
  consumptionId: string,
  input: CreateInternalConsumptionReversalBody,
  actor: { id: string; name: string },
): Promise<InternalConsumptionReversalDTO> {
  const quantidade = new Decimal(input.quantity);
  const esperado = new Decimal(input.expectedReversedQuantity);

  let reversalId: string;
  try {
    reversalId = await getPrisma().$transaction(async (tx) => {
      // 1. O CI, travado: estornos do mesmo consumo passam um de cada vez.
      const travado = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM internal_consumptions WHERE id = ${consumptionId} FOR UPDATE`;
      if (travado.length === 0) throw new InternalConsumptionNotFoundError();
      const consumo = await tx.internalConsumption.findUnique({ where: { id: consumptionId } });
      if (!consumo) throw new InternalConsumptionNotFoundError();

      // 2. O escopo do saldo: serializa com CI novo, ajuste e Contagem rápida
      // da mesma posição.
      await lockStockScope(tx, { itemId: consumo.itemId, lotId: consumo.lotId });

      const positionKey = chaveDaPosicao(consumo.itemId, consumo.lotId);

      // 3. Posição em Inventário Físico aberto.
      const aberta = await tx.stockCountPosition.findFirst({
        where: { openPositionKey: positionKey },
        select: { stockCount: { select: { code: true } } },
      });
      if (aberta) throw new ReversalPositionInOpenCountError(consumo.code, aberta.stockCount.code);

      /*
       * 4. Contagem encerrada DEPOIS do registro do CI. A fronteira é o
       * `createdAt` do CI — quando a baixa entrou no ledger —, não o
       * `occurredAt`: um consumo de dia passado grava o FIM daquele dia, e o
       * saldo esperado de uma contagem feita antes do lançamento não tinha a
       * baixa. Posição retirada e inventário cancelado não contam; Contagem
       * rápida é `COMPLETED` como a sessão e conta.
       */
      const contadaDepois = await tx.stockCountPosition.findFirst({
        where: {
          positionKey,
          removedAt: null,
          stockCount: { status: "COMPLETED" },
          validEntry: { is: { countedAt: { gt: consumo.createdAt } } },
        },
        orderBy: { validEntry: { countedAt: "desc" } },
        select: { stockCount: { select: { code: true } } },
      });
      if (contadaDepois) {
        throw new ReversalPositionCountedAfterConsumptionError(consumo.code, contadaDepois.stockCount.code);
      }

      // 5. O que já foi estornado — soma, nunca contador.
      const soma = await tx.internalConsumptionReversal.aggregate({
        where: { originalConsumptionId: consumo.id },
        _sum: { quantity: true, totalCost: true },
      });
      const jaEstornado = soma._sum.quantity ?? new Decimal(0);

      // 6. O "já estornado" que a tela mostrou.
      if (!jaEstornado.equals(esperado)) {
        throw new ReversalStateChangedError(consumo.code, esperado.toString(), jaEstornado.toString());
      }

      const saldo = consumo.quantity.minus(jaEstornado);
      if (saldo.lessThanOrEqualTo(0)) throw new NothingToReverseError();
      if (quantidade.greaterThan(saldo)) {
        throw new ReversalExceedsBalanceError(consumo.code, quantidade.toString(), saldo.toString());
      }

      const totalCost = custoTotalDoEstorno({
        totalDoConsumo: consumo.totalCost,
        quantidadeDoConsumo: consumo.quantity,
        quantidade,
        custoJaEstornado: soma._sum.totalCost ?? new Decimal(0),
        zeraOSaldo: quantidade.equals(saldo),
      });

      // 7. Código. 8. Movimento. 9. Estorno — o id nasce antes, para o
      // `sourceId` do movimento e a FK 1:1 do estorno se apontarem.
      const code = await nextSequenceCode(tx, CODE_SEQUENCE, INTERNAL_CONSUMPTION_REVERSAL_CODE_PREFIX);
      const id = randomUUID();
      const agora = new Date();
      const movimento = await tx.inventoryMovement.create({
        data: {
          itemId: consumo.itemId,
          lotId: consumo.lotId,
          type: "INTERNAL_CONSUMPTION_REVERSAL",
          quantity: quantidade,
          occurredAt: agora,
          sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
          sourceId: id,
          reason: input.reason,
          createdBy: actor.name,
        },
      });
      await tx.internalConsumptionReversal.create({
        data: {
          id,
          code,
          originalConsumptionId: consumo.id,
          quantity: quantidade,
          reason: input.reason,
          // Cópia exata do snapshot — o estorno nunca chama a hierarquia de custo.
          unitCost: consumo.unitCost,
          totalCost,
          costSource: consumo.costSource,
          costDetails: consumo.costDetails,
          inventoryMovementId: movimento.id,
          registeredByUserId: actor.id,
          registeredByNameSnapshot: actor.name,
          createdAt: agora,
        },
      });
      return id;
    });
  } catch (erro) {
    // P2034: conflito de escrita ou deadlock. P2028: a transação expirou
    // esperando a trava. Nada foi gravado; tentar de novo resolve.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && (erro.code === "P2034" || erro.code === "P2028")) {
      throw new ReversalConcurrentWriteError();
    }
    throw erro;
  }

  const gravado = await getPrisma().internalConsumptionReversal.findUniqueOrThrow({
    where: { id: reversalId },
    include: reversalInclude,
  });
  return internalConsumptionReversalToDTO(gravado);
}

/**
 * O consumo aberto para estornar: a linha do histórico, os estornos (do mais
 * recente para o mais antigo) e o que a tela avisa sem bloquear.
 */
export async function getInternalConsumptionDetail(id: string): Promise<InternalConsumptionDetailDTO | null> {
  const prisma = getPrisma();
  const consumo = await prisma.internalConsumption.findUnique({
    where: { id },
    include: {
      item: true,
      lot: true,
      reversals: {
        include: reversalInclude,
        orderBy: [{ createdAt: "desc" }, { code: "desc" }],
      },
    },
  });
  if (!consumo) return null;

  /*
   * Ajuste MANUAL de entrada na mesma posição depois do registro do CI. O
   * sistema não deduz que ele corrigiu este consumo nem bloqueia por causa
   * dele (PO): só mostra, para quem estorna conferir.
   */
  const posteriores = {
    itemId: consumo.itemId,
    lotId: consumo.lotId,
    type: "ADJUSTMENT_IN",
    sourceType: "MANUAL_ADJUSTMENT",
    createdAt: { gt: consumo.createdAt },
  } satisfies Prisma.InventoryMovementWhereInput;
  const [ajustes, totalDeAjustes] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: posteriores,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AJUSTES_POSTERIORES_NA_TELA,
    }),
    prisma.inventoryMovement.count({ where: posteriores }),
  ]);

  return {
    ...internalConsumptionToDTO(consumo),
    reversals: consumo.reversals.map(internalConsumptionReversalToDTO),
    itemActive: consumo.item.active,
    lotStatus: consumo.lot ? consumo.lot.status : null,
    lotExpired: consumo.lot ? isLotExpired(consumo.lot) : false,
    laterManualAdjustments: ajustes.map((ajuste) => ({
      id: ajuste.id,
      quantity: ajuste.quantity.toString(),
      occurredAt: ajuste.occurredAt.toISOString(),
      reason: ajuste.reason,
      createdBy: ajuste.createdBy,
    })),
    laterManualAdjustmentCount: totalDeAjustes,
  };
}
