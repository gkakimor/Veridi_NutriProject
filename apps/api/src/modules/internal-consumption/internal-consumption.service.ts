import { Prisma } from "@prisma/client";
import type { Item, InternalConsumption, Lot } from "@prisma/client";
import type {
  InternalConsumptionAvailabilityDTO,
  InternalConsumptionDTO,
  InternalConsumptionListResponse,
} from "@veridi/shared";
import {
  INTERNAL_CONSUMPTION_CODE_PREFIX,
  hojeComercial,
  inicioDoDiaComercial,
  intervaloDeDiasComerciais,
  limitesDoDiaComercial,
  podeSairPorConsumoInterno,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getConsumedLotCostReference } from "../../lib/cost-reference.js";
import { Decimal } from "../../lib/decimal.js";
import {
  getAvailableByItems,
  getOnHand,
  getOnHandByLots,
  getReservedByItems,
  getReservedByLots,
  isLotAvailableForUse,
} from "../../lib/inventory-ledger.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { fecharPrecoTecnicoPersistido } from "../../lib/technical-price.js";
import { fecharTotalTecnicoPersistido } from "../../lib/technical-total.js";
import { lockStockScope } from "../inventory/inventory.service.js";
import { chaveDaPosicao } from "../inventory/stock-count.service.js";
import {
  BackdatedConsumptionAfterCountError,
  BackdatedConsumptionInOpenCountError,
  CustomerOwnedLotNotAllowedError,
  FutureInternalConsumptionDateError,
  InsufficientInternalConsumptionStockError,
  InternalConsumptionConcurrentWriteError,
  InternalConsumptionItemNotFoundError,
  InternalConsumptionLotNotFoundError,
  InvalidInternalConsumptionItemTypeError,
  LotNotEligibleForInternalConsumptionError,
  MissingInternalConsumptionLotError,
  UnexpectedInternalConsumptionLotError,
} from "./internal-consumption.errors.js";
import type {
  CreateInternalConsumptionBody,
  ListInternalConsumptionsQuery,
} from "./internal-consumption.schemas.js";

/**
 * CONSUMO INTERNO (CI-) — Uso e consumo, Fatia 2.
 *
 * Decisões estruturais desta capacidade:
 * - consumo interno NÃO é `ADJUSTMENT_OUT`. Ajuste existe para CORRIGIR um
 *   saldo errado; aqui o saldo estava certo e a empresa usou o material. Com
 *   um tipo só, nenhum relatório conseguiria separar erro de inventário de
 *   despesa operacional;
 * - a baixa sai do MESMO ledger de todo o resto, com tipo próprio
 *   (`INTERNAL_CONSUMPTION`). Nunca uma segunda fonte de saldo;
 * - o custo REUTILIZA `getConsumedLotCostReference`, a mesma hierarquia do
 *   consumo de produção (lote real → 30d → 90d → último real → `NO_COST`), e
 *   é CONGELADO no registro: uma compra posterior não reescreve a despesa que
 *   já aconteceu;
 * - só Item `INTERNAL_CONSUMABLE` (`ITEM_TYPES_DO_CONSUMO_INTERNO`);
 * - consumo de DIA PASSADO que uma contagem de inventário já viu é recusado
 *   (`recusarSeAContagemJaViuASaida`): a contagem já baixou a saída.
 *
 * Correção é o ESTORNO próprio (INTERNAL-CONSUMPTION-REVERSAL-01,
 * `internal-consumption-reversal.service.ts`): uma entrada nova, com motivo e
 * autoria, que nunca edita nem apaga o CI. Estornado e saldo estornável são
 * SOMA dos estornos, lida aqui junto do registro.
 */

const CODE_SEQUENCE = "internal_consumption_code_seq";

export const internalConsumptionInclude = {
  item: true,
  lot: true,
  // Só o que a soma precisa: a lista e o R-21 leem páginas, e cada CI tem
  // poucos estornos.
  reversals: { select: { quantity: true, totalCost: true } },
} as const;

type ConsumptionWithRelations = InternalConsumption & {
  item: Item;
  lot: Lot | null;
  reversals: { quantity: Prisma.Decimal; totalCost: Prisma.Decimal | null }[];
};

/**
 * Os números do consumo diante dos estornos — derivados, nunca gravados.
 *
 * Custo `null` no CI (`NO_COST`) fica `null` no estornado e no líquido: a
 * ausência de custo atravessa, nunca vira zero.
 */
export function numerosDoEstorno(consumption: {
  quantity: Prisma.Decimal;
  totalCost: Prisma.Decimal | null;
  reversals: { quantity: Prisma.Decimal; totalCost: Prisma.Decimal | null }[];
}): Pick<
  InternalConsumptionDTO,
  "reversedQuantity" | "reversibleQuantity" | "reversedTotalCost" | "netTotalCost" | "reversalStatus" | "reversalCount"
> {
  const estornado = consumption.reversals.reduce((soma, estorno) => soma.plus(estorno.quantity), new Decimal(0));
  const saldo = consumption.quantity.minus(estornado);
  const custoEstornado =
    consumption.totalCost === null
      ? null
      : consumption.reversals.reduce((soma, estorno) => soma.plus(estorno.totalCost ?? 0), new Decimal(0));
  return {
    reversedQuantity: estornado.toString(),
    reversibleQuantity: saldo.toString(),
    reversedTotalCost: custoEstornado === null ? null : custoEstornado.toString(),
    netTotalCost:
      consumption.totalCost === null || custoEstornado === null
        ? null
        : consumption.totalCost.minus(custoEstornado).toString(),
    reversalStatus: estornado.isZero() ? "NOT_REVERSED" : saldo.isZero() ? "REVERSED" : "PARTIALLY_REVERSED",
    reversalCount: consumption.reversals.length,
  };
}

/** O registro como a tela, o histórico e o relatório R-21 o leem — um mapeamento só. */
export function internalConsumptionToDTO(consumption: ConsumptionWithRelations): InternalConsumptionDTO {
  return {
    id: consumption.id,
    code: consumption.code,
    itemId: consumption.itemId,
    itemCode: consumption.item.code,
    itemName: consumption.item.name,
    itemType: consumption.item.type,
    lotId: consumption.lotId,
    lotCode: consumption.lot ? consumption.lot.code : null,
    quantity: consumption.quantity.toString(),
    uomCode: consumption.uomCode,
    occurredAt: consumption.occurredAt.toISOString(),
    purpose: consumption.purpose,
    notes: consumption.notes,
    // `null` atravessa como `null` — ausência de custo nunca vira "0".
    unitCost: consumption.unitCost ? consumption.unitCost.toString() : null,
    totalCost: consumption.totalCost ? consumption.totalCost.toString() : null,
    costSource: consumption.costSource,
    costDetails: consumption.costDetails,
    inventoryMovementId: consumption.inventoryMovementId,
    registeredByUserId: consumption.registeredByUserId,
    registeredByName: consumption.registeredByNameSnapshot,
    createdAt: consumption.createdAt.toISOString(),
    ...numerosDoEstorno(consumption),
  };
}

/**
 * O INSTANTE do consumo, a partir do dia que a pessoa escolheu.
 *
 * O dia é civil; o ledger guarda instante. A ponte não pode ser a meia-noite
 * UTC do dia: em São Paulo ela é 21h do dia ANTERIOR, e a hierarquia de custo
 * — que pergunta `hojeComercial(occurredAt)` — passaria a somar as compras do
 * dia errado.
 *
 * Hoje é agora, de verdade. Um dia passado é o FIM daquele dia comercial: o
 * último instante em que o consumo ainda pode ter acontecido, e o que faz o
 * movimento aparecer no extrato depois de tudo que aconteceu naquele dia.
 * Dia futuro não existe — consumo é registro do que já aconteceu.
 */
export function instanteDoConsumo(diaISO: string | undefined, agora: Date = new Date()): Date {
  const hoje = hojeComercial(agora);
  if (!diaISO || diaISO === hoje) return agora;
  if (diaISO > hoje) throw new FutureInternalConsumptionDateError(diaISO);
  return limitesDoDiaComercial(diaISO).fim;
}

/**
 * Saldo DISPONÍVEL do escopo do consumo — a mesma conta da Visão Geral do
 * Estoque (`On Hand - Reserved`, nunca negativo), nunca On Hand cru.
 *
 * Uso e consumo não entra em reserva nenhuma hoje (não é componente de receita
 * nem produto acabado), então na prática `Reserved` é zero. Descontá-lo mesmo
 * assim é o que impede a regra de ficar errada no dia em que passar a entrar.
 */
async function disponivelNoEscopo(
  tx: Prisma.TransactionClient,
  item: Item,
  lot: Lot | null,
): Promise<Prisma.Decimal> {
  if (lot) {
    const onHand = await getOnHand(tx, { itemId: item.id, lotId: lot.id });
    const reserved = (await getReservedByLots(tx, [lot.id])).get(lot.id) ?? new Decimal(0);
    return Decimal.max(onHand.minus(reserved), 0);
  }
  const onHand = await getOnHand(tx, { itemId: item.id, lotId: null });
  const reserved = (await getReservedByItems(tx, [item.id])).get(item.id) ?? new Decimal(0);
  return Decimal.max(onHand.minus(reserved), 0);
}

/**
 * CONSUMO DE DATA PASSADA × INVENTÁRIO — INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01.
 *
 * Uma contagem compara o físico com o saldo do ledger NAQUELE instante. Se o
 * material saiu antes dela e o consumo só entra no ledger depois, o físico já
 * não tinha o material e o esperado ainda tinha: a diferença da contagem É a
 * saída, e o ajuste do encerramento já a baixou. O consumo lançado depois
 * baixaria de novo. É o espelho da guarda do estorno (§126).
 *
 * As duas pontas:
 * - o registro (`createdAt`) é agora, depois de toda contagem existente — o
 *   esperado de nenhuma delas tinha este consumo;
 * - a saída física é do DIA informado, sem hora. `occurredAt` grava o fim do
 *   dia só para ordenar o extrato; a saída pode ter sido antes de uma contagem
 *   do mesmo dia. Na dúvida, recusa: a fronteira é o INÍCIO do dia comercial
 *   do consumo, contra o `countedAt` do registro que vale.
 *
 * Recusa, na posição do consumo (item, ou item + lote — outro lote não conta):
 * 1. inventário ABERTO que já contou a posição no dia do consumo ou depois: o
 *    encerramento aplicaria a diferença congelada, que já tem a saída. Posição
 *    ainda não contada, ou contada antes do dia, passa — a contagem vai ler o
 *    consumo no esperado, e a marca de movimentação durante o inventário segue;
 * 2. inventário ENCERRADO, sessão ou Contagem rápida, que reconciliou a posição
 *    numa contagem do dia do consumo ou posterior: ajustou a diferença ou
 *    conferiu sem diferença. "Não ajustar" não reconciliou — o saldo ficou o do
 *    sistema, e o consumo lançado depois é a baixa única. Posição retirada e
 *    inventário cancelado não contam.
 *
 * Consumo de hoje não passa por aqui: o instante dele é o do registro, depois
 * de toda contagem já feita.
 */
async function recusarSeAContagemJaViuASaida(
  tx: Prisma.TransactionClient,
  consumo: { item: Item; lot: Lot | null; dia: string },
): Promise<void> {
  const positionKey = chaveDaPosicao(consumo.item.id, consumo.lot ? consumo.lot.id : null);
  const inicioDoDia = inicioDoDiaComercial(consumo.dia);
  const contagem = (stockCount: { id: string; code: string }, countedAt: Date) => ({
    consumptionDate: consumo.dia,
    itemCode: consumo.item.code,
    lotCode: consumo.lot ? consumo.lot.code : null,
    stockCountId: stockCount.id,
    stockCountCode: stockCount.code,
    countedAt,
  });

  /*
   * 1. A posição aberta, TRAVADA: registro de contagem, recontagem, decisão e
   * encerramento da mesma posição esperam este consumo terminar — ou ele
   * espera por eles e relê. Sem a trava, uma contagem gravada entre a leitura
   * e o commit teria o esperado sem este consumo.
   */
  const [travada] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM stock_count_positions WHERE "openPositionKey" = ${positionKey} FOR SHARE`;
  if (travada) {
    const aberta = await tx.stockCountPosition.findUnique({
      where: { id: travada.id },
      select: {
        validEntry: { select: { countedAt: true } },
        stockCount: { select: { id: true, code: true } },
      },
    });
    if (aberta?.validEntry && aberta.validEntry.countedAt >= inicioDoDia) {
      throw new BackdatedConsumptionInOpenCountError(contagem(aberta.stockCount, aberta.validEntry.countedAt));
    }
  }

  // 2. Depois do aberto, nunca antes: se um encerramento segurava a posição, a
  // trava acima esperou o commit dele — e esta leitura, nova, já o vê encerrado.
  const reconciliada = await tx.stockCountPosition.findFirst({
    where: {
      positionKey,
      removedAt: null,
      stockCount: { status: "COMPLETED" },
      validEntry: { is: { countedAt: { gte: inicioDoDia } } },
      OR: [{ decision: null }, { decision: "ADJUST" }],
    },
    orderBy: { validEntry: { countedAt: "desc" } },
    select: {
      validEntry: { select: { countedAt: true } },
      stockCount: { select: { id: true, code: true, completedAt: true } },
    },
  });
  if (reconciliada?.validEntry) {
    throw new BackdatedConsumptionAfterCountError(
      contagem(reconciliada.stockCount, reconciliada.validEntry.countedAt),
      reconciliada.stockCount.completedAt,
    );
  }
}

/**
 * Registra o consumo interno: valida, baixa o ledger e congela o custo.
 *
 * Tudo numa transação só — um registro sem movimento seria despesa sem baixa,
 * e um movimento sem registro seria baixa sem destino nem custo.
 */
export async function registerInternalConsumption(
  input: CreateInternalConsumptionBody,
  actor: { id: string; name: string },
  agora: Date = new Date(),
): Promise<InternalConsumptionDTO> {
  const occurredAt = instanteDoConsumo(input.occurredOn, agora);
  // Só o consumo de DIA PASSADO pode ter saído antes de uma contagem já feita.
  const diaRetroativo = input.occurredOn && input.occurredOn < hojeComercial(agora) ? input.occurredOn : null;
  const prisma = getPrisma();

  const consumptionId = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new InternalConsumptionItemNotFoundError(input.itemId);
    // Lista de PERMISSÃO — ver `ITEM_TYPES_DO_CONSUMO_INTERNO` no shared.
    if (!podeSairPorConsumoInterno(item.type)) {
      throw new InvalidInternalConsumptionItemTypeError(item.code, item.type);
    }
    /*
     * Item inativo SAI. §107: inativar interrompe compromisso novo, não
     * prende material no depósito — ajuste de saída e perda seguem
     * permitidos, e o detergente que sobrou depois de descontinuado continua
     * sendo usado até acabar. O que o cadastro inativo barra é a entrada.
     */

    const quantity = new Decimal(input.quantity);

    let lot: Lot | null = null;
    if (item.controlsLot) {
      if (!input.lotId) throw new MissingInternalConsumptionLotError(item.code);
      lot = await tx.lot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.itemId !== item.id) {
        throw new InternalConsumptionLotNotFoundError(input.lotId);
      }
      // Qualidade, validade e CoA valem igual — sem bypass "porque é interno".
      if (!isLotAvailableForUse(lot, agora)) {
        throw new LotNotEligibleForInternalConsumptionError(lot.code);
      }
      if (lot.ownerType === "CUSTOMER") throw new CustomerOwnedLotNotAllowedError(lot.code);
    } else if (input.lotId) {
      throw new UnexpectedInternalConsumptionLotError(item.code);
    }

    await lockStockScope(tx, { itemId: item.id, lotId: lot ? lot.id : null });

    // Depois da trava do escopo: a Contagem rápida da mesma posição trava o
    // mesmo escopo, então a leitura abaixo já vê a que terminou antes.
    if (diaRetroativo) await recusarSeAContagemJaViuASaida(tx, { item, lot, dia: diaRetroativo });

    const disponivel = await disponivelNoEscopo(tx, item, lot);
    if (quantity.greaterThan(disponivel)) {
      throw new InsufficientInternalConsumptionStockError(
        lot ? lot.code : item.code,
        disponivel.toString(),
      );
    }

    /*
     * Custo: a MESMA hierarquia do consumo de produção, com a data do próprio
     * consumo — nunca "hoje" —, para que um registro atrasado não use compras
     * posteriores ao que aconteceu. `NO_COST` devolve `unitCost: null`, e é
     * `null` que fica gravado: zero é custo real zero.
     */
    const custo = await getConsumedLotCostReference(tx, {
      itemId: item.id,
      lotId: lot ? lot.id : null,
      consumedAt: occurredAt,
    });
    const unitCost = custo.unitCost ? fecharPrecoTecnicoPersistido(custo.unitCost) : null;
    const totalCost = custo.unitCost
      ? fecharTotalTecnicoPersistido(custo.unitCost.times(quantity))
      : null;

    const code = await nextSequenceCode(tx, CODE_SEQUENCE, INTERNAL_CONSUMPTION_CODE_PREFIX);
    const consumption = await tx.internalConsumption.create({
      data: {
        code,
        itemId: item.id,
        lotId: lot ? lot.id : null,
        quantity,
        uomCode: item.unitCode,
        occurredAt,
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
        unitCost,
        totalCost,
        costSource: custo.source,
        costDetails: custo.details,
        registeredByUserId: actor.id,
        registeredByNameSnapshot: actor.name,
      },
    });

    // A baixa é do ledger — nunca uma segunda contabilidade paralela.
    const movement = await tx.inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId: lot ? lot.id : null,
        type: "INTERNAL_CONSUMPTION",
        quantity,
        occurredAt,
        sourceType: "INTERNAL_CONSUMPTION",
        sourceId: consumption.id,
        createdBy: actor.name,
      },
    });
    await tx.internalConsumption.update({
      where: { id: consumption.id },
      data: { inventoryMovementId: movement.id },
    });

    return consumption.id;
  }).catch(recusarConcorrencia);

  return (await getInternalConsumptionById(consumptionId))!;
}

/**
 * P2034: conflito de escrita ou deadlock. P2028: a transação expirou esperando
 * a trava do escopo ou da posição de inventário. Nada foi gravado — é recusa
 * de tentar de novo, nunca 500.
 */
function recusarConcorrencia(erro: unknown): never {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && (erro.code === "P2034" || erro.code === "P2028")) {
    throw new InternalConsumptionConcurrentWriteError();
  }
  throw erro;
}

export async function getInternalConsumptionById(
  id: string,
): Promise<InternalConsumptionDTO | null> {
  const consumption = await getPrisma().internalConsumption.findUnique({
    where: { id },
    include: internalConsumptionInclude,
  });
  return consumption ? internalConsumptionToDTO(consumption) : null;
}

/**
 * Histórico operacional dos consumos — quem, quando, o quê, quanto, destino e
 * custo. O relatório gerencial é a Fatia 3; aqui basta rastrear.
 */
export async function listInternalConsumptions(
  query: ListInternalConsumptionsQuery,
): Promise<InternalConsumptionListResponse> {
  const prisma = getPrisma();
  const where: Prisma.InternalConsumptionWhereInput = {};

  if (query.itemId) where.itemId = query.itemId;
  if (query.search) {
    where.OR = [
      { code: { contains: query.search, mode: "insensitive" } },
      { purpose: { contains: query.search, mode: "insensitive" } },
      { item: { code: { contains: query.search, mode: "insensitive" } } },
      { item: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }
  // `occurredAt` é INSTANTE: o período é de DIAS COMERCIAIS, e o fim é
  // exclusivo — nenhum `23:59:59.999` inventado.
  const periodo = intervaloDeDiasComerciais(query.dateFrom, query.dateTo);
  if (periodo.inicio || periodo.fimExclusivo) {
    where.occurredAt = {
      ...(periodo.inicio ? { gte: periodo.inicio } : {}),
      ...(periodo.fimExclusivo ? { lt: periodo.fimExclusivo } : {}),
    };
  }

  const [total, consumptions] = await Promise.all([
    prisma.internalConsumption.count({ where }),
    prisma.internalConsumption.findMany({
      where,
      include: internalConsumptionInclude,
      orderBy: [{ occurredAt: "desc" }, { code: "desc" }],
      ...pageArgs(query),
    }),
  ]);

  return { consumptions: consumptions.map(internalConsumptionToDTO), ...pageMeta(query, total) };
}

/**
 * Disponibilidade do item para a TELA do consumo.
 *
 * A mesma conta que a gravação vai conferir — `getAvailableByItems`, a
 * interpretação canônica de Available. Uma segunda leitura aqui faria a tela
 * prometer saldo que o `POST` recusa.
 */
export async function getInternalConsumptionAvailability(
  itemId: string,
  agora: Date = new Date(),
): Promise<InternalConsumptionAvailabilityDTO | null> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return null;
  if (!podeSairPorConsumoInterno(item.type)) {
    throw new InvalidInternalConsumptionItemTypeError(item.code, item.type);
  }

  const [onHand, availableByItem] = await Promise.all([
    getOnHand(prisma, { itemId: item.id }),
    getAvailableByItems(prisma, [item], undefined, agora),
  ]);

  const lots: InternalConsumptionAvailabilityDTO["lots"] = [];
  if (item.controlsLot) {
    const doItem = await prisma.lot.findMany({
      where: { itemId: item.id, ownerType: "VERIDI" },
      orderBy: [{ expiryDate: "asc" }, { code: "asc" }],
    });
    const elegiveis = doItem.filter((lot) => isLotAvailableForUse(lot, agora));
    const [onHandByLot, reservedByLot] = await Promise.all([
      getOnHandByLots(
        prisma,
        elegiveis.map((lot) => lot.id),
      ),
      getReservedByLots(
        prisma,
        elegiveis.map((lot) => lot.id),
      ),
    ]);
    for (const lot of elegiveis) {
      const disponivel = Decimal.max(
        (onHandByLot.get(lot.id) ?? new Decimal(0)).minus(reservedByLot.get(lot.id) ?? new Decimal(0)),
        0,
      );
      if (disponivel.lessThanOrEqualTo(0)) continue;
      lots.push({
        lotId: lot.id,
        lotCode: lot.code,
        expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
        available: disponivel.toString(),
      });
    }
  }

  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    unitCode: item.unitCode,
    controlsLot: item.controlsLot,
    itemActive: item.active,
    onHand: onHand.toString(),
    available: (availableByItem.get(item.id) ?? new Decimal(0)).toString(),
    lots,
  };
}

