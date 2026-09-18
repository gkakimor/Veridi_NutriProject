import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  Item,
  Lot,
  StockCount,
  StockCountEntry,
  StockCountFinding,
  StockCountPosition,
  User,
} from "@prisma/client";
import {
  STOCK_COUNT_CODE_PREFIX,
  STOCK_COUNT_MAX_POSITIONS,
  STOCK_COUNT_POSITION_MOVEMENTS_LIMIT,
  diaCivilDeslocado,
  hojeComercial,
  intervaloDeDiasComerciais,
} from "@veridi/shared";
import type {
  StockCountCloseIssue,
  StockCountCloseIssueDTO,
  StockCountDetailDTO,
  StockCountEntryDTO,
  StockCountExpectedAdjustment,
  StockCountFindingDTO,
  StockCountHeldPositionDTO,
  StockCountListResponse,
  StockCountMode,
  StockCountPositionDTO,
  StockCountPositionMovementsDTO,
  StockCountPositionSituation,
  StockCountPreviewDTO,
  StockCountPreviewPositionDTO,
  StockCountQuickResultDTO,
  StockCountResultDTO,
  StockCountSummaryDTO,
  StockCountView,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData } from "../../lib/business-day.js";
import {
  getOnHand,
  getOnHandByLots,
  getOnHandWithoutLotByItems,
  getReservedByItems,
  getReservedByLots,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { statusDoWhere } from "../../lib/status-list-schema.js";
import { CountBelowReservedError, MissingCountReasonError } from "./inventory.errors.js";
import type { StockCountInput } from "./inventory.schemas.js";
import { getMovementById, getMovementsByIds, lockStockScope, resolveItemAndLot } from "./inventory.service.js";
import {
  ClientRequestReusedError,
  FractionalCountQuantityError,
  InvalidStockCountStatusError,
  PositionAlreadyInCountError,
  PositionHeldByOpenCountError,
  StockCountActionNotAllowedError,
  StockCountChangedError,
  StockCountCloseBlockedError,
  StockCountConcurrentWriteError,
  StockCountCustomerNotFoundError,
  StockCountDecisionNotAllowedError,
  StockCountEntryConflictError,
  StockCountEntryNotAllowedError,
  StockCountFindingInvalidError,
  StockCountFirstRoundIncompleteError,
  StockCountNothingToReviewError,
  StockCountNotFoundError,
  StockCountPositionNotFoundError,
  StockCountRecountNotAllowedError,
  StockCountScopeChangedError,
  StockCountScopeEmptyError,
  StockCountScopeTooLargeError,
  SystemQuantityChangedError,
} from "./stock-count.errors.js";
import type {
  AddStockCountPositionBody,
  CreateStockCountFindingBody,
  DecideStockCountBody,
  ListStockCountsQuery,
  PreviewStockCountQuery,
  RegisterStockCountEntryBody,
  StartStockCountQuery,
} from "./stock-count.schemas.js";

/**
 * Inventário Físico em sessão (INVENTORY-PHYSICAL-COUNT-01, Fatia 1).
 *
 * Três números por posição, e só um vira ajuste:
 *
 * - `R`, saldo de referência, lido quando a posição entra. Explica a revisão.
 * - `E`, saldo esperado, lido NA transação de cada registro de contagem e
 *   gravado junto da contagem `C`. A diferença do registro é `C − E`.
 * - `A`, o ajuste do encerramento, é a diferença congelada do registro que vale,
 *   aplicada como DELTA sobre o saldo daquele instante. Nunca `C − saldo do
 *   encerramento`, nunca `C − R`: o que o ledger recebeu depois da contagem
 *   continua lá e não é contado de novo.
 *
 * Nada bloqueia Recebimento, Produção, Expedição ou Ajuste. A única
 * exclusividade é entre inventários: uma posição física está em no máximo um
 * inventário aberto, garantido pelo índice único de `openPositionKey`.
 */

type Tx = Prisma.TransactionClient;
type PrismaOuTx = ReturnType<typeof getPrisma> | Tx;

/** Quem age: sempre o usuário da sessão de login, nunca texto do corpo. */
export type StockCountActor = Pick<User, "id" | "name">;

type LoteComDono = Lot & { ownerCustomer: { code: string; legalName: string } | null };
type ItemDoRetrato = Pick<Item, "id" | "code" | "name" | "type" | "unitCode">;
type PosicaoComRegistros = StockCountPosition & { entries: StockCountEntry[] };

const SEQUENCE_DO_CODIGO = "stock_count_code_seq";

/** Início e encerramento de até 3.000 posições cabem aqui; o resto é transação curta. */
const TRANSACAO_LONGA = { maxWait: 10_000, timeout: 60_000 };

const ZERO = new Prisma.Decimal(0);
const COLACAO = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const DONO_DO_LOTE = { ownerCustomer: { select: { code: true, legalName: true } } } as const;
const ORDEM_DOS_REGISTROS = [{ countedAt: "asc" as const }, { id: "asc" as const }];

/** Decisão sempre vale para UM número: registro novo ou recontagem a apagam. */
const SEM_DECISAO = {
  decision: null,
  decisionReason: null,
  decidedAt: null,
  decidedByUserId: null,
  decidedByName: null,
  concurrentMovementConfirmed: false,
} satisfies Prisma.StockCountPositionUncheckedUpdateInput;

/**
 * `itemId` ou `itemId:lotId` — a identidade da posição física. Exportada para
 * o estorno de consumo interno conferir inventário aberto e contagem posterior
 * pela MESMA chave, nunca por uma segunda montagem dela.
 */
export function chaveDaPosicao(itemId: string, lotId: string | null): string {
  return lotId ? `${itemId}:${lotId}` : itemId;
}

function rodadaAtual(posicao: { recountRequestedRound: number | null }): number {
  return posicao.recountRequestedRound ?? 1;
}

function recontagemPendente(
  posicao: { recountRequestedRound: number | null },
  valido: { round: number } | null,
): boolean {
  return posicao.recountRequestedRound !== null && (valido === null || valido.round < posicao.recountRequestedRound);
}

/**
 * A cegueira é do servidor. Contagem com saldo nunca esconde. Contagem cega
 * esconde saldo de referência, esperado e diferença sempre na leitura de quem
 * conta, e na leitura de revisão até a primeira rodada terminar.
 */
function saldosEscondidos(
  sessao: Pick<StockCount, "mode" | "firstRoundClosedAt">,
  view: StockCountView,
): boolean {
  if (sessao.mode === "ASSISTED") return false;
  if (view === "counting") return true;
  return sessao.firstRoundClosedAt === null;
}

function iso(data: Date | null): string | null {
  return data ? data.toISOString() : null;
}

async function travarSessao(tx: Tx, id: string, modo: "UPDATE" | "SHARE"): Promise<StockCount> {
  const linhas =
    modo === "UPDATE"
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_counts WHERE id = ${id} FOR SHARE`;
  if (linhas.length === 0) throw new StockCountNotFoundError();
  const sessao = await tx.stockCount.findUnique({ where: { id } });
  if (!sessao) throw new StockCountNotFoundError();
  return sessao;
}

function exigirStatus(sessao: StockCount, permitidos: readonly StockCount["status"][], acao: string): void {
  if (!permitidos.includes(sessao.status)) throw new InvalidStockCountStatusError(sessao.status, acao);
}

const SESSAO_ABERTA = ["IN_PROGRESS", "IN_REVIEW"] as const;

/** Trava posições sempre na mesma ordem — duas escritas cruzadas esperam, nunca em ciclo. */
async function travarPosicoes(tx: Tx, stockCountId: string, ids: readonly string[]): Promise<void> {
  const ordenados = [...new Set(ids)].sort();
  if (ordenados.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM stock_count_positions
    WHERE "stockCountId" = ${stockCountId} AND id IN (${Prisma.join(ordenados)})
    ORDER BY id
    FOR UPDATE`;
}

/** Unidade de dimensão COUNT conta unidades inteiras (P2); as demais aceitam fração. */
async function exigirInteiroSeContagem(
  prisma: PrismaOuTx,
  unitCode: string,
  quantidade: Prisma.Decimal,
): Promise<void> {
  if (quantidade.isInteger()) return;
  const unidade = await prisma.unitOfMeasure.findUnique({
    where: { code: unitCode },
    select: { dimension: true },
  });
  if (unidade?.dimension === "COUNT") throw new FractionalCountQuantityError(unitCode);
}

/** Retrato de cadastro da posição no instante em que ela entra — nunca muda depois. */
function retratoDaPosicao(item: ItemDoRetrato, lote: LoteComDono | null) {
  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemType: item.type,
    unitCode: item.unitCode,
    lotId: lote?.id ?? null,
    lotCode: lote?.code ?? null,
    ownerType: lote?.ownerType ?? "VERIDI",
    ownerCustomerId: lote?.ownerCustomerId ?? null,
    ownerCustomerCode: lote?.ownerCustomer?.code ?? null,
    ownerCustomerName: lote?.ownerCustomer?.legalName ?? null,
    lotStatusAtReference: lote?.status ?? null,
    expiryDateAtReference: lote?.expiryDate ?? null,
    locationAtReference: lote?.location ?? null,
  } satisfies Partial<Prisma.StockCountPositionUncheckedCreateInput>;
}

/** Posições que já estão num inventário aberto, com o código que as segura. */
async function retencoes(prisma: PrismaOuTx, chaves: readonly string[]): Promise<StockCountHeldPositionDTO[]> {
  if (chaves.length === 0) return [];
  const abertas = await prisma.stockCountPosition.findMany({
    where: { openPositionKey: { in: [...chaves] } },
    select: {
      positionKey: true,
      itemCode: true,
      lotCode: true,
      stockCount: { select: { id: true, code: true } },
    },
    orderBy: { positionKey: "asc" },
  });
  return abertas.map((posicao) => ({
    positionKey: posicao.positionKey,
    itemCode: posicao.itemCode,
    lotCode: posicao.lotCode,
    stockCountId: posicao.stockCount.id,
    stockCountCode: posicao.stockCount.code,
  }));
}

function alvoDoConflito(erro: Prisma.PrismaClientKnownRequestError): string {
  const alvo = (erro.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(alvo) ? alvo.join(",") : String(alvo ?? "");
}

/**
 * Violação do índice único de `openPositionKey` é a exclusividade funcionando
 * contra uma transação simultânea que a checagem prévia não enxergava; o resto
 * é escrita cruzada no mesmo inventário. Nenhum dos dois vira 500.
 */
async function traduzirConflito(erro: unknown, chaves: readonly string[] = []): Promise<unknown> {
  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    if (erro.code === "P2002" && alvoDoConflito(erro).includes("openPositionKey")) {
      return new PositionHeldByOpenCountError(await retencoes(getPrisma(), chaves));
    }
    // P2034: conflito de escrita ou deadlock. P2028: a transação expirou esperando
    // uma trava de outra escrita. Nada foi gravado; tentar de novo resolve.
    if (erro.code === "P2002" || erro.code === "P2034" || erro.code === "P2028") {
      return new StockCountConcurrentWriteError();
    }
  }
  return erro;
}

// ─── Escopo ──────────────────────────────────────────────────────────────────

interface Candidata {
  positionKey: string;
  item: ItemDoRetrato;
  lote: LoteComDono | null;
  saldo: Prisma.Decimal;
}

/** Percurso físico: local informado no recebimento, depois código do item e do lote. */
function ordemDePercurso(a: Candidata, b: Candidata): number {
  const localA = a.lote?.location?.trim() || null;
  const localB = b.lote?.location?.trim() || null;
  if (localA !== localB) {
    if (localA === null) return 1;
    if (localB === null) return -1;
    const porLocal = COLACAO.compare(localA, localB);
    if (porLocal !== 0) return porLocal;
  }
  const porItem = COLACAO.compare(a.item.code, b.item.code);
  if (porItem !== 0) return porItem;
  return COLACAO.compare(a.lote?.code ?? "", b.lote?.code ?? "");
}

/** Algum filtro que só um lote tem: local, situação ou validade (Fatia 2B). */
function temFiltroDeLote(scope: PreviewStockCountQuery["scope"]): boolean {
  return (
    scope.locationContains !== undefined ||
    (scope.lotStatuses !== undefined && scope.lotStatuses.length > 0) ||
    (scope.expiry !== undefined && scope.expiry !== "ANY")
  );
}

/** A validade do lote pedida pelo escopo, na régua de `isLotExpired` (o dia da validade vale inteiro). */
function cabeNaValidade(lote: Pick<Lot, "expiryDate">, scope: PreviewStockCountQuery["scope"], agora: Date): boolean {
  switch (scope.expiry) {
    case "EXPIRED":
      return isLotExpired(lote, agora);
    case "NOT_EXPIRED":
      return !isLotExpired(lote, agora);
    case "EXPIRING":
      return (
        lote.expiryDate !== null &&
        !isLotExpired(lote, agora) &&
        diaDaColunaDeData(lote.expiryDate) <= diaCivilDeslocado(hojeComercial(agora), scope.expiringWithinDays ?? 0)
      );
    default:
      return true;
  }
}

/**
 * O conjunto de posições que os filtros selecionam, hoje.
 *
 * Item sem controle de lote é uma posição; item com lote, uma por lote — nunca
 * uma posição "item inteiro" por cima dos lotes. "Somente com saldo" exclui
 * saldo zero; "com ou sem saldo" inclui o lote zerado (P5). Item inativo entra
 * só com saldo. Posição que já está em outro inventário aberto fica de fora e
 * volta listada com o código que a segura. Filtro de local, situação ou
 * validade seleciona lotes: a posição de item sem lote não tem nenhum dos três.
 */
async function avaliarEscopo(prisma: PrismaOuTx, pedido: PreviewStockCountQuery) {
  const { scope } = pedido;
  const agora = new Date();
  if (scope.customerId) {
    const cliente = await prisma.customer.findUnique({ where: { id: scope.customerId }, select: { id: true } });
    if (!cliente) throw new StockCountCustomerNotFoundError();
  }

  const itens = await prisma.item.findMany({
    where: {
      ...(scope.itemTypes && scope.itemTypes.length > 0 ? { type: { in: scope.itemTypes } } : {}),
      ...(scope.itemIds ? { id: { in: scope.itemIds } } : {}),
    },
    select: { id: true, code: true, name: true, type: true, unitCode: true, controlsLot: true, active: true },
  });
  const itemPorId = new Map(itens.map((item) => [item.id, item]));

  // Material de cliente exige lote, e filtro por lote seleciona lotes: nos dois
  // casos não existe posição de item sem lote.
  const itensSemLote =
    scope.owner === "CUSTOMER" || scope.lotIds || temFiltroDeLote(scope) ? [] : itens.filter((item) => !item.controlsLot);
  const itensComLote = itens.filter((item) => item.controlsLot);

  const donoDoLote: Prisma.LotWhereInput =
    scope.owner === "VERIDI"
      ? { ownerType: "VERIDI" }
      : scope.owner === "CUSTOMER"
        ? { ownerType: "CUSTOMER", ...(scope.customerId ? { ownerCustomerId: scope.customerId } : {}) }
        : {};
  const lotes: LoteComDono[] =
    itensComLote.length === 0
      ? []
      : (
          await prisma.lot.findMany({
            where: {
              itemId: { in: itensComLote.map((item) => item.id) },
              ...(scope.lotIds ? { id: { in: scope.lotIds } } : {}),
              ...donoDoLote,
              ...(scope.locationContains
                ? { location: { contains: scope.locationContains, mode: "insensitive" as const } }
                : {}),
              ...(scope.lotStatuses && scope.lotStatuses.length > 0 ? { status: { in: scope.lotStatuses } } : {}),
            },
            include: DONO_DO_LOTE,
          })
        ).filter((lote) => cabeNaValidade(lote, scope, agora));

  const saldoPorLote = await getOnHandByLots(
    prisma,
    lotes.map((lote) => lote.id),
  );
  const saldoPorItem = await getOnHandWithoutLotByItems(
    prisma,
    itensSemLote.map((item) => item.id),
  );
  const entra = (ativo: boolean, saldo: Prisma.Decimal) =>
    !saldo.isZero() || (scope.balance === "ANY" && ativo);

  const todas: Candidata[] = [];
  for (const item of itensSemLote) {
    const saldo = saldoPorItem.get(item.id) ?? ZERO;
    if (entra(item.active, saldo)) {
      todas.push({ positionKey: chaveDaPosicao(item.id, null), item, lote: null, saldo });
    }
  }
  for (const lote of lotes) {
    const item = itemPorId.get(lote.itemId);
    if (!item) continue;
    const saldo = saldoPorLote.get(lote.id) ?? ZERO;
    if (entra(item.active, saldo)) {
      todas.push({ positionKey: chaveDaPosicao(item.id, lote.id), item, lote, saldo });
    }
  }

  const retiradasNoPreview = new Set(pedido.excludedPositionKeys ?? []);
  const semRetiradas = todas.filter((candidata) => !retiradasNoPreview.has(candidata.positionKey));
  const retiradas = todas.filter((candidata) => retiradasNoPreview.has(candidata.positionKey));
  const retidas = await retencoes(
    prisma,
    semRetiradas.map((candidata) => candidata.positionKey),
  );
  const chavesRetidas = new Set(retidas.map((retida) => retida.positionKey));
  const candidatas = semRetiradas.filter((candidata) => !chavesRetidas.has(candidata.positionKey));
  candidatas.sort(ordemDePercurso);
  retiradas.sort(ordemDePercurso);

  if (candidatas.length > STOCK_COUNT_MAX_POSITIONS) {
    throw new StockCountScopeTooLargeError(candidatas.length, STOCK_COUNT_MAX_POSITIONS);
  }
  return { candidatas, retidas, retiradas, excluidas: retiradas.length };
}

function linhaDoPreview(
  candidata: Candidata,
  sequence: number,
  mode: StockCountMode,
  agora: Date,
): StockCountPreviewPositionDTO {
  const { item, lote } = candidata;
  return {
    positionKey: candidata.positionKey,
    sequence,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemType: item.type,
    unitCode: item.unitCode,
    lotId: lote?.id ?? null,
    lotCode: lote?.code ?? null,
    ownerType: lote?.ownerType ?? "VERIDI",
    ownerCustomerId: lote?.ownerCustomerId ?? null,
    ownerCustomerCode: lote?.ownerCustomer?.code ?? null,
    ownerCustomerName: lote?.ownerCustomer?.legalName ?? null,
    lotStatus: lote?.status ?? null,
    expiryDate: iso(lote?.expiryDate ?? null),
    isExpired: lote ? isLotExpired(lote, agora) : false,
    location: lote?.location ?? null,
    balance: mode === "BLIND" ? null : candidata.saldo.toString(),
  };
}

/** Preview sem estado: nada é gravado até iniciar. */
export async function previewStockCount(pedido: PreviewStockCountQuery): Promise<StockCountPreviewDTO> {
  const agora = new Date();
  const { candidatas, retidas, retiradas, excluidas } = await avaliarEscopo(getPrisma(), pedido);
  return {
    positions: candidatas.map((candidata, indice) => linhaDoPreview(candidata, indice + 1, pedido.mode, agora)),
    itemCount: new Set(candidatas.map((candidata) => candidata.item.id)).size,
    heldByOpenCounts: retidas,
    excludedCount: excluidas,
    // A retirada continua no escopo e volta com os dados da linha, para a tela
    // oferecer "Recolocar" — e com o saldo escondido na contagem cega, como as outras.
    excludedPositions: retiradas.map((candidata) => {
      const { sequence: _foraDoPercurso, ...linha } = linhaDoPreview(candidata, 0, pedido.mode, agora);
      return linha;
    }),
    maxPositions: STOCK_COUNT_MAX_POSITIONS,
  };
}

/**
 * Inicia o inventário: reavalia o escopo, congela posições e saldo de
 * referência numa transação só, e marca cada posição como aberta no índice de
 * exclusividade.
 */
export async function startStockCount(pedido: StartStockCountQuery, actor: StockCountActor): Promise<string> {
  let chavesDoEscopo: string[] = [];
  try {
    return await getPrisma().$transaction(async (tx) => {
      /*
       * A referência é o relógio do processo, o mesmo que carimba o `createdAt`
       * que o Prisma grava no ledger; tomada ANTES de somar os saldos. Movimento
       * carimbado depois dela é "movimentação durante o inventário", tenha
       * entrado ou não na soma — o engano possível é marcar a mais, nunca a menos.
       */
      const referenceAt = new Date();
      const { candidatas, retidas, excluidas } = await avaliarEscopo(tx, pedido);
      chavesDoEscopo = candidatas.map((candidata) => candidata.positionKey);

      if (pedido.expectedPositionKeys) {
        const vistas = new Set(pedido.expectedPositionKeys);
        const atuais = new Set(candidatas.map((candidata) => candidata.positionKey));
        const novas = [...atuais].filter((chave) => !vistas.has(chave));
        const sairam = [...vistas].filter((chave) => !atuais.has(chave));
        if (novas.length > 0 || sairam.length > 0) throw new StockCountScopeChangedError(novas, sairam);
      }
      if (candidatas.length === 0) throw new StockCountScopeEmptyError();

      const code = await nextSequenceCode(tx, SEQUENCE_DO_CODIGO, STOCK_COUNT_CODE_PREFIX);
      const retratoDoEscopo = JSON.parse(
        JSON.stringify({
          scope: pedido.scope,
          excludedPositionKeys: pedido.excludedPositionKeys ?? [],
          excludedCount: excluidas,
          heldByOpenCounts: retidas.map((retida) => ({
            positionKey: retida.positionKey,
            stockCountCode: retida.stockCountCode,
          })),
        }),
      ) as Prisma.InputJsonObject;

      const sessao = await tx.stockCount.create({
        data: {
          code,
          kind: "SESSION",
          mode: pedido.mode,
          status: "IN_PROGRESS",
          description: pedido.description?.trim() || null,
          scopeFilters: retratoDoEscopo,
          referenceAt,
          createdByUserId: actor.id,
          createdByName: actor.name,
        },
      });

      const posicoes: Prisma.StockCountPositionCreateManyInput[] = candidatas.map((candidata, indice) => ({
        ...retratoDaPosicao(candidata.item, candidata.lote),
        stockCountId: sessao.id,
        sequence: indice + 1,
        positionKey: candidata.positionKey,
        openPositionKey: candidata.positionKey,
        origin: "SCOPE",
        referenceQuantity: candidata.saldo,
        referenceAt,
      }));
      // Inserção sempre na mesma ordem de chave: dois inícios com escopos que se
      // cruzam esperam um pelo outro no índice único, nunca em ciclo.
      posicoes.sort((a, b) => (a.positionKey < b.positionKey ? -1 : a.positionKey > b.positionKey ? 1 : 0));
      await tx.stockCountPosition.createMany({ data: posicoes });

      return sessao.id;
    }, TRANSACAO_LONGA);
  } catch (erro) {
    throw await traduzirConflito(erro, chavesDoEscopo);
  }
}

// ─── Posições ────────────────────────────────────────────────────────────────

/** Adiciona item/lote que EXISTE no ERP, com motivo. O que não existe vira ocorrência. */
export async function addStockCountPosition(
  stockCountId: string,
  corpo: AddStockCountPositionBody,
  actor: StockCountActor,
): Promise<string> {
  const { item, lot } = await resolveItemAndLot(corpo.itemId, corpo.lotId);
  const positionKey = chaveDaPosicao(item.id, lot?.id ?? null);
  try {
    return await getPrisma().$transaction(async (tx) => {
      // UPDATE: o número da posição é o próximo da sessão, e duas adições não
      // podem escolher o mesmo.
      const sessao = await travarSessao(tx, stockCountId, "UPDATE");
      exigirStatus(sessao, SESSAO_ABERTA, "adicionar posição");

      const existente = await tx.stockCountPosition.findUnique({
        where: { stockCountId_positionKey: { stockCountId, positionKey } },
        select: { id: true },
      });
      if (existente) throw new PositionAlreadyInCountError();

      const ativas = await tx.stockCountPosition.count({ where: { stockCountId, removedAt: null } });
      if (ativas >= STOCK_COUNT_MAX_POSITIONS) {
        throw new StockCountScopeTooLargeError(ativas + 1, STOCK_COUNT_MAX_POSITIONS);
      }
      const retidas = await retencoes(tx, [positionKey]);
      if (retidas.length > 0) throw new PositionHeldByOpenCountError(retidas);

      const lote = lot ? await tx.lot.findUnique({ where: { id: lot.id }, include: DONO_DO_LOTE }) : null;
      const ultima = await tx.stockCountPosition.aggregate({ where: { stockCountId }, _max: { sequence: true } });
      const referenceAt = new Date();
      const saldo = await getOnHand(tx, { itemId: item.id, lotId: lot?.id ?? null });

      const posicao = await tx.stockCountPosition.create({
        data: {
          ...retratoDaPosicao(item, lote),
          stockCountId,
          sequence: (ultima._max.sequence ?? 0) + 1,
          positionKey,
          openPositionKey: positionKey,
          origin: "ADDED",
          addedAt: referenceAt,
          addedByUserId: actor.id,
          addedByName: actor.name,
          addReason: corpo.reason,
          referenceQuantity: saldo,
          referenceAt,
        },
      });
      return posicao.id;
    });
  } catch (erro) {
    throw await traduzirConflito(erro, [positionKey]);
  }
}

/** Retira a posição da primeira contagem, com motivo. Registros ficam; a exclusividade é liberada. */
export async function removeStockCountPosition(
  stockCountId: string,
  positionId: string,
  reason: string,
  actor: StockCountActor,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "SHARE");
    exigirStatus(sessao, ["IN_PROGRESS"], "retirar posição");
    await travarPosicoes(tx, stockCountId, [positionId]);
    const posicao = await tx.stockCountPosition.findFirst({ where: { id: positionId, stockCountId } });
    if (!posicao) throw new StockCountPositionNotFoundError();
    if (posicao.removedAt) throw new StockCountActionNotAllowedError("A posição já foi retirada.");

    await tx.stockCountPosition.update({
      where: { id: positionId },
      data: {
        removedAt: new Date(),
        removedByUserId: actor.id,
        removedByName: actor.name,
        removeReason: reason,
        openPositionKey: null,
      },
    });
  });
}

// ─── Registros de contagem ───────────────────────────────────────────────────

/**
 * Registra uma contagem — só acrescenta.
 *
 * O esperado `E` é lido nesta transação e congelado no registro. O registro
 * novo passa a valer e apaga a decisão anterior. Conflito otimista: a tela
 * informa a rodada e o último registro que viu; se mudou, 409 — salvo quando o
 * registro atual já tem exatamente a mesma quantidade (nada a decidir).
 */
export async function registerStockCountEntry(
  stockCountId: string,
  positionId: string,
  corpo: RegisterStockCountEntryBody,
  actor: StockCountActor,
): Promise<{ created: boolean; entryId: string }> {
  const quantidade = new Prisma.Decimal(corpo.countedQuantity);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const sessao = await travarSessao(tx, stockCountId, "SHARE");
      exigirStatus(sessao, SESSAO_ABERTA, "registrar contagem");
      await travarPosicoes(tx, stockCountId, [positionId]);
      const posicao = await tx.stockCountPosition.findFirst({
        where: { id: positionId, stockCountId },
        include: { validEntry: true },
      });
      if (!posicao) throw new StockCountPositionNotFoundError();

      // Reenvio do mesmo envio (rede caiu depois de gravar): devolve o que já existe.
      const repetido = await tx.stockCountEntry.findUnique({ where: { clientRequestId: corpo.clientRequestId } });
      if (repetido) {
        if (repetido.positionId !== positionId) throw new ClientRequestReusedError();
        return { created: false, entryId: repetido.id };
      }

      if (posicao.removedAt) {
        throw new StockCountEntryNotAllowedError("A posição foi retirada do inventário e não recebe contagem.");
      }
      const rodada = rodadaAtual(posicao);
      if (sessao.status === "IN_REVIEW" && rodada === 1 && posicao.validEntry) {
        throw new StockCountEntryNotAllowedError(
          "A primeira contagem já foi concluída. Para contar de novo, peça recontagem.",
        );
      }

      await exigirInteiroSeContagem(tx, posicao.unitCode, quantidade);

      const ultimoDaRodada = posicao.validEntry?.round === rodada ? posicao.validEntry : null;
      if (corpo.round !== rodada || corpo.expectedLastEntryId !== (ultimoDaRodada?.id ?? null)) {
        if (corpo.round === rodada && ultimoDaRodada?.countedQuantity.equals(quantidade)) {
          return { created: false, entryId: ultimoDaRodada.id };
        }
        throw new StockCountEntryConflictError(positionId);
      }

      const countedAt = new Date();
      const esperado = await getOnHand(tx, { itemId: posicao.itemId, lotId: posicao.lotId });
      const registro = await tx.stockCountEntry.create({
        data: {
          positionId,
          round: rodada,
          countedQuantity: quantidade,
          expectedQuantity: esperado,
          countedAt,
          countedByUserId: actor.id,
          countedByName: actor.name,
          source: "GRID",
          clientRequestId: corpo.clientRequestId,
          note: corpo.note?.trim() || null,
        },
      });
      await tx.stockCountPosition.update({
        where: { id: positionId },
        data: { validEntryId: registro.id, ...SEM_DECISAO },
      });
      return { created: true, entryId: registro.id };
    });
  } catch (erro) {
    throw await traduzirConflito(erro);
  }
}

// ─── Rodadas, revisão e decisão ──────────────────────────────────────────────

/** Fecha a primeira rodada: toda posição contada ou retirada. Revela a contagem cega. */
export async function closeStockCountFirstRound(stockCountId: string, actor: StockCountActor): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "UPDATE");
    exigirStatus(sessao, ["IN_PROGRESS"], "concluir a primeira contagem");
    const ativas = await tx.stockCountPosition.count({ where: { stockCountId, removedAt: null } });
    if (ativas === 0) throw new StockCountNothingToReviewError();
    const pendentes = await tx.stockCountPosition.count({
      where: { stockCountId, removedAt: null, validEntryId: null },
    });
    if (pendentes > 0) throw new StockCountFirstRoundIncompleteError(pendentes);

    await tx.stockCount.update({
      where: { id: stockCountId },
      data: {
        status: "IN_REVIEW",
        firstRoundClosedAt: new Date(),
        firstRoundClosedByUserId: actor.id,
        firstRoundClosedByName: actor.name,
      },
    });
  });
}

/** Recontagem é opcional e da posição: a rodada seguinte congela o próprio esperado. */
export async function requestStockCountRecount(
  stockCountId: string,
  positionIds: readonly string[],
  actor: StockCountActor,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "SHARE");
    exigirStatus(sessao, ["IN_REVIEW"], "pedir recontagem");
    await travarPosicoes(tx, stockCountId, positionIds);
    const posicoes = await tx.stockCountPosition.findMany({
      where: { stockCountId, id: { in: [...positionIds] } },
      include: { validEntry: { select: { round: true } } },
    });
    if (posicoes.length !== positionIds.length) throw new StockCountPositionNotFoundError();

    const porProximaRodada = new Map<number, string[]>();
    for (const posicao of posicoes) {
      if (posicao.removedAt) {
        throw new StockCountRecountNotAllowedError(`A posição ${posicao.sequence} foi retirada.`);
      }
      if (!posicao.validEntry) {
        throw new StockCountRecountNotAllowedError(`A posição ${posicao.sequence} ainda não tem contagem.`);
      }
      if (recontagemPendente(posicao, posicao.validEntry)) {
        throw new StockCountRecountNotAllowedError(`A posição ${posicao.sequence} já aguarda recontagem.`);
      }
      const proxima = posicao.validEntry.round + 1;
      porProximaRodada.set(proxima, [...(porProximaRodada.get(proxima) ?? []), posicao.id]);
    }

    const agora = new Date();
    for (const [rodada, ids] of porProximaRodada) {
      await tx.stockCountPosition.updateMany({
        where: { id: { in: ids } },
        data: {
          recountRequestedRound: rodada,
          recountRequestedAt: agora,
          recountRequestedByUserId: actor.id,
          recountRequestedByName: actor.name,
          ...SEM_DECISAO,
        },
      });
    }
  }, TRANSACAO_LONGA);
}

/** Ajustar ou Não ajustar a diferença do registro que vale — sempre com motivo. */
export async function decideStockCountPositions(
  stockCountId: string,
  decisoes: DecideStockCountBody["decisions"],
  actor: StockCountActor,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "SHARE");
    exigirStatus(sessao, ["IN_REVIEW"], "decidir posições");
    const ids = decisoes.map((decisao) => decisao.positionId);
    await travarPosicoes(tx, stockCountId, ids);
    const posicoes = await tx.stockCountPosition.findMany({
      where: { stockCountId, id: { in: ids } },
      include: { validEntry: true },
    });
    if (posicoes.length !== ids.length) throw new StockCountPositionNotFoundError();
    const porId = new Map(posicoes.map((posicao) => [posicao.id, posicao]));

    for (const decisao of decisoes) {
      const posicao = porId.get(decisao.positionId);
      if (!posicao) throw new StockCountPositionNotFoundError();
      if (posicao.removedAt) {
        throw new StockCountDecisionNotAllowedError(`A posição ${posicao.sequence} foi retirada.`);
      }
      if (!posicao.validEntry) {
        throw new StockCountDecisionNotAllowedError(`A posição ${posicao.sequence} ainda não tem contagem.`);
      }
      if (recontagemPendente(posicao, posicao.validEntry)) {
        throw new StockCountDecisionNotAllowedError(`A posição ${posicao.sequence} aguarda recontagem.`);
      }
      if (posicao.validEntry.countedQuantity.equals(posicao.validEntry.expectedQuantity)) {
        throw new StockCountDecisionNotAllowedError(
          `A posição ${posicao.sequence} confere: não há diferença a decidir.`,
        );
      }
    }

    const agora = new Date();
    for (const decisao of decisoes) {
      await tx.stockCountPosition.update({
        where: { id: decisao.positionId },
        data: {
          decision: decisao.decision,
          decisionReason: decisao.reason,
          decidedAt: agora,
          decidedByUserId: actor.id,
          decidedByName: actor.name,
          concurrentMovementConfirmed: decisao.confirmConcurrentMovement === true,
        },
      });
    }
  }, TRANSACAO_LONGA);
}

interface PosicaoParaMarca {
  id: string;
  itemId: string;
  lotId: string | null;
  referenceAt: Date;
  referenceQuantity: Prisma.Decimal;
  validEntry: Pick<StockCountEntry, "expectedQuantity"> | null;
}

/**
 * Posições com movimentação durante o inventário: o ledger da posição recebeu
 * movimento carimbado depois da referência, ou o esperado do registro que vale
 * difere da referência. Listas de movimento saem de `createdAt`; os números do
 * ajuste nunca — eles vêm das somas gravadas no registro.
 *
 * O ajuste de inventário não conta como movimentação da própria sessão, e nada
 * depois do fim da sessão importa para ela.
 */
async function posicoesComMovimentacao(
  prisma: PrismaOuTx,
  posicoes: readonly PosicaoParaMarca[],
  fimDaSessao: Date | null,
): Promise<Set<string>> {
  const marcadas = new Set<string>();
  if (posicoes.length === 0) return marcadas;
  const desde = new Date(
    posicoes.reduce((menor, posicao) => Math.min(menor, posicao.referenceAt.getTime()), Number.POSITIVE_INFINITY),
  );
  const janela: Prisma.DateTimeFilter = fimDaSessao ? { gt: desde, lte: fimDaSessao } : { gt: desde };
  const semAjusteDeInventario: Prisma.InventoryMovementWhereInput = { stockCountPosition: { is: null } };

  const lotIds = [...new Set(posicoes.flatMap((posicao) => (posicao.lotId ? [posicao.lotId] : [])))];
  const itemIds = [...new Set(posicoes.filter((posicao) => !posicao.lotId).map((posicao) => posicao.itemId))];

  const ultimoPorLote = new Map<string, Date>();
  if (lotIds.length > 0) {
    const grupos = await prisma.inventoryMovement.groupBy({
      by: ["lotId"],
      where: { lotId: { in: lotIds }, createdAt: janela, ...semAjusteDeInventario },
      _max: { createdAt: true },
    });
    for (const grupo of grupos) {
      if (grupo.lotId && grupo._max.createdAt) ultimoPorLote.set(grupo.lotId, grupo._max.createdAt);
    }
  }
  const ultimoPorItem = new Map<string, Date>();
  if (itemIds.length > 0) {
    const grupos = await prisma.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { itemId: { in: itemIds }, lotId: null, createdAt: janela, ...semAjusteDeInventario },
      _max: { createdAt: true },
    });
    for (const grupo of grupos) {
      if (grupo._max.createdAt) ultimoPorItem.set(grupo.itemId, grupo._max.createdAt);
    }
  }

  for (const posicao of posicoes) {
    const ultimo = posicao.lotId ? ultimoPorLote.get(posicao.lotId) : ultimoPorItem.get(posicao.itemId);
    const moveuDepois = ultimo !== undefined && ultimo.getTime() > posicao.referenceAt.getTime();
    const esperadoMudou =
      posicao.validEntry !== null && !posicao.validEntry.expectedQuantity.equals(posicao.referenceQuantity);
    if (moveuDepois || esperadoMudou) marcadas.add(posicao.id);
  }
  return marcadas;
}

function problema(
  posicao: Pick<StockCountPosition, "id" | "sequence" | "itemCode" | "lotCode">,
  issue: StockCountCloseIssue,
  numeros?: { saldo: Prisma.Decimal; ajuste: Prisma.Decimal; reservado: Prisma.Decimal },
): StockCountCloseIssueDTO {
  return {
    positionId: posicao.id,
    sequence: posicao.sequence,
    itemCode: posicao.itemCode,
    lotCode: posicao.lotCode,
    issue,
    balance: numeros ? numeros.saldo.toString() : null,
    adjustment: numeros ? numeros.ajuste.toString() : null,
    reserved: numeros ? numeros.reservado.toString() : null,
  };
}

/**
 * Encerra e gera os ajustes, numa transação só.
 *
 * Guardas antes de qualquer escrita: toda posição contada, sem recontagem
 * pendente; toda diferença decidida; divergência com movimentação durante o
 * inventário recontada ou confirmada. Depois, com item e lote travados SÓ nas
 * posições com ajuste (itens por id, depois lotes por id — a ordem da
 * Expedição), a unidade tem de ser a do retrato e o saldo que fica
 * (`saldo agora + diferença congelada`) não pode ser negativo nem, num ajuste de
 * saída, menor que o reservado. Um movimento por posição ajustada, com FK 1:1.
 *
 * `esperados` (Fatia 2B) são os ajustes que o diálogo de encerramento mostrou.
 * Com a sessão travada, decisão e recontagem esperam; se o conjunto que seria
 * aplicado não é o mostrado, recusa antes de qualquer escrita.
 */
export async function completeStockCount(
  stockCountId: string,
  actor: StockCountActor,
  esperados?: readonly StockCountExpectedAdjustment[],
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "UPDATE");
    exigirStatus(sessao, ["IN_REVIEW"], "encerrar");

    const posicoes = await tx.stockCountPosition.findMany({
      where: { stockCountId, removedAt: null },
      include: { validEntry: true },
      orderBy: { sequence: "asc" },
    });
    const marcadas = await posicoesComMovimentacao(tx, posicoes, null);

    const problemas: StockCountCloseIssueDTO[] = [];
    const ajustes: { posicao: (typeof posicoes)[number]; diferenca: Prisma.Decimal }[] = [];
    for (const posicao of posicoes) {
      const valido = posicao.validEntry;
      if (!valido) {
        problemas.push(problema(posicao, "PENDING_COUNT"));
        continue;
      }
      if (recontagemPendente(posicao, valido)) {
        problemas.push(problema(posicao, "PENDING_RECOUNT"));
        continue;
      }
      const diferenca = valido.countedQuantity.minus(valido.expectedQuantity);
      if (diferenca.isZero()) continue;
      if (!posicao.decision) {
        problemas.push(problema(posicao, "UNDECIDED"));
        continue;
      }
      if (marcadas.has(posicao.id) && valido.round === 1 && !posicao.concurrentMovementConfirmed) {
        problemas.push(problema(posicao, "CONCURRENT_MOVEMENT_UNCONFIRMED"));
        continue;
      }
      if (posicao.decision === "ADJUST") ajustes.push({ posicao, diferenca });
    }
    if (problemas.length > 0) throw new StockCountCloseBlockedError(problemas);

    if (esperados) {
      const vistos = new Set(esperados.map((esperado) => `${esperado.positionId}:${esperado.entryId}`));
      const aplicaveis = ajustes.map(({ posicao }) => `${posicao.id}:${posicao.validEntryId}`);
      if (vistos.size !== aplicaveis.length || aplicaveis.some((chave) => !vistos.has(chave))) {
        throw new StockCountChangedError();
      }
    }

    if (ajustes.length > 0) {
      const itemIds = [...new Set(ajustes.map((ajuste) => ajuste.posicao.itemId))].sort();
      const lotIds = [
        ...new Set(ajustes.flatMap((ajuste) => (ajuste.posicao.lotId ? [ajuste.posicao.lotId] : []))),
      ].sort();
      await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) ORDER BY id FOR UPDATE`;
      if (lotIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM lots WHERE id IN (${Prisma.join(lotIds)}) ORDER BY id FOR UPDATE`;
      }

      const unidadePorItem = new Map(
        (await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, unitCode: true } })).map(
          (item) => [item.id, item.unitCode],
        ),
      );
      const itensSemLote = ajustes.filter((ajuste) => !ajuste.posicao.lotId).map((ajuste) => ajuste.posicao.itemId);
      const saldoPorLote = await getOnHandByLots(tx, lotIds);
      const saldoPorItem = await getOnHandWithoutLotByItems(tx, itensSemLote);
      const reservadoPorLote = await getReservedByLots(tx, lotIds);
      const reservadoPorItem = await getReservedByItems(tx, itensSemLote);

      for (const { posicao, diferenca } of ajustes) {
        if (unidadePorItem.get(posicao.itemId) !== posicao.unitCode) {
          problemas.push(problema(posicao, "UNIT_CHANGED"));
          continue;
        }
        const saldo = posicao.lotId
          ? (saldoPorLote.get(posicao.lotId) ?? ZERO)
          : (saldoPorItem.get(posicao.itemId) ?? ZERO);
        const reservado = posicao.lotId
          ? (reservadoPorLote.get(posicao.lotId) ?? ZERO)
          : (reservadoPorItem.get(posicao.itemId) ?? ZERO);
        const depois = saldo.plus(diferenca);
        const numeros = { saldo, ajuste: diferenca, reservado };
        if (depois.lessThan(0)) {
          problemas.push(problema(posicao, "NEGATIVE_BALANCE", numeros));
        } else if (diferenca.lessThan(0) && depois.lessThan(reservado)) {
          problemas.push(problema(posicao, "BELOW_RESERVED", numeros));
        }
      }
      if (problemas.length > 0) throw new StockCountCloseBlockedError(problemas);

      const agora = new Date();
      const vinculos = ajustes.map(({ posicao, diferenca }) => ({
        posicaoId: posicao.id,
        movimento: {
          id: randomUUID(),
          itemId: posicao.itemId,
          lotId: posicao.lotId,
          type: diferenca.greaterThan(0) ? ("ADJUSTMENT_IN" as const) : ("ADJUSTMENT_OUT" as const),
          quantity: diferenca.abs(),
          // Instante do encerramento, nunca retroativo à contagem: movimento
          // retroativo é o que confundiria a reconciliação do próximo inventário.
          occurredAt: agora,
          sourceType: "STOCK_COUNT" as const,
          sourceId: posicao.id,
          reason: posicao.decisionReason,
          createdBy: actor.name,
        },
      }));
      await tx.inventoryMovement.createMany({ data: vinculos.map((vinculo) => vinculo.movimento) });
      const pares = vinculos.map((vinculo) => Prisma.sql`(${vinculo.posicaoId}, ${vinculo.movimento.id})`);
      const ligadas = await tx.$executeRaw`
        UPDATE stock_count_positions AS p
        SET "adjustmentMovementId" = v.movimento
        FROM (VALUES ${Prisma.join(pares)}) AS v(posicao, movimento)
        WHERE p.id = v.posicao AND p."adjustmentMovementId" IS NULL`;
      // A FK 1:1 é a segunda barreira contra ajuste em dobro: posição que já
      // tinha ajuste não é religada, e o encerramento inteiro volta.
      if (ligadas !== vinculos.length) throw new StockCountConcurrentWriteError();
    }

    await tx.stockCountPosition.updateMany({ where: { stockCountId }, data: { openPositionKey: null } });
    await tx.stockCount.update({
      where: { id: stockCountId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedByUserId: actor.id,
        completedByName: actor.name,
      },
    });
  }, TRANSACAO_LONGA);
}

/** Cancela em contagem ou revisão, com motivo. Nada é apagado e nenhum movimento é criado. */
export async function cancelStockCount(stockCountId: string, reason: string, actor: StockCountActor): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "UPDATE");
    exigirStatus(sessao, SESSAO_ABERTA, "cancelar");
    await tx.stockCountPosition.updateMany({ where: { stockCountId }, data: { openPositionKey: null } });
    await tx.stockCount.update({
      where: { id: stockCountId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: actor.id,
        cancelledByName: actor.name,
        cancelReason: reason,
      },
    });
  });
}

/** Ocorrência: material que não cabe numa posição. Nunca cria item, lote nem movimento. */
export async function createStockCountFinding(
  stockCountId: string,
  corpo: CreateStockCountFindingBody,
  actor: StockCountActor,
): Promise<string> {
  return getPrisma().$transaction(async (tx) => {
    const sessao = await travarSessao(tx, stockCountId, "SHARE");
    exigirStatus(sessao, SESSAO_ABERTA, "registrar ocorrência");

    const item = corpo.itemId
      ? await tx.item.findUnique({ where: { id: corpo.itemId }, select: { id: true, controlsLot: true, unitCode: true } })
      : null;
    if (corpo.itemId && !item) throw new StockCountFindingInvalidError("Item não encontrado.");
    if (corpo.kind === "UNREGISTERED_LOT" && item && !item.controlsLot) {
      throw new StockCountFindingInvalidError(
        "O item não controla lote: a contagem dele é registrada na posição do item.",
      );
    }

    const unitCode = corpo.unitCode ?? item?.unitCode ?? null;
    if (unitCode) {
      const unidade = await tx.unitOfMeasure.findUnique({ where: { code: unitCode }, select: { code: true } });
      if (!unidade) throw new StockCountFindingInvalidError("Unidade não encontrada.");
    }
    const quantidade = corpo.quantity ? new Prisma.Decimal(corpo.quantity) : null;
    if (quantidade) {
      if (!unitCode) throw new StockCountFindingInvalidError("Informe a unidade da quantidade encontrada.");
      await exigirInteiroSeContagem(tx, unitCode, quantidade);
    }

    const ocorrencia = await tx.stockCountFinding.create({
      data: {
        stockCountId,
        kind: corpo.kind,
        itemId: item?.id ?? null,
        identification: corpo.identification,
        quantity: quantidade,
        unitCode: quantidade ? unitCode : (corpo.unitCode ?? null),
        note: corpo.note?.trim() || null,
        createdByUserId: actor.id,
        createdByName: actor.name,
      },
    });
    return ocorrencia.id;
  });
}

// ─── Contagem rápida ─────────────────────────────────────────────────────────

/**
 * Contagem rápida: uma posição, contada e encerrada no mesmo passo.
 *
 * Passou a gravar o documento INV- (kind QUICK) com posição, registro e, havendo
 * diferença, o ajuste ligado à posição — inclusive quando confere, e é isso que
 * faz "última contagem" existir. Recusa posição em inventário aberto. O
 * contrato de resposta da tela atual está preservado e só ganhou campos.
 */
export async function createQuickStockCount(
  input: StockCountInput,
  actor: StockCountActor,
): Promise<StockCountResultDTO> {
  const { item, lot } = await resolveItemAndLot(input.itemId, input.lotId);
  const countedQuantity = new Prisma.Decimal(input.countedQuantity);
  await exigirInteiroSeContagem(getPrisma(), item.unitCode, countedQuantity);
  const positionKey = chaveDaPosicao(item.id, lot?.id ?? null);

  let gravado: {
    systemQuantity: Prisma.Decimal;
    difference: Prisma.Decimal;
    movementId: string | null;
    stockCountId: string;
    stockCountCode: string;
    positionId: string;
    entryId: string;
  };
  try {
    gravado = await getPrisma().$transaction(async (tx) => {
      await lockStockScope(tx, { itemId: item.id, lotId: lot?.id ?? null });

      const retidas = await retencoes(tx, [positionKey]);
      if (retidas.length > 0) throw new PositionHeldByOpenCountError(retidas);

      const instante = new Date();
      const systemQuantity = await getOnHand(tx, { itemId: item.id, lotId: lot?.id ?? null });
      if (input.expectedSystemQuantity !== undefined && !systemQuantity.equals(input.expectedSystemQuantity)) {
        throw new SystemQuantityChangedError(
          new Prisma.Decimal(input.expectedSystemQuantity).toString(),
          systemQuantity.toString(),
        );
      }
      const difference = countedQuantity.minus(systemQuantity);

      if (difference.lessThan(0)) {
        const reserved = lot
          ? ((await getReservedByLots(tx, [lot.id])).get(lot.id) ?? ZERO)
          : ((await getReservedByItems(tx, [item.id])).get(item.id) ?? ZERO);
        // Nao resolve automaticamente cancelando reservas — rejeita e deixa o
        // usuario revisar as reservas antes de ajustar o estoque.
        if (countedQuantity.lessThan(reserved)) throw new CountBelowReservedError();
      }
      if (!difference.isZero() && !input.reason) throw new MissingCountReasonError();

      const lote = lot ? await tx.lot.findUnique({ where: { id: lot.id }, include: DONO_DO_LOTE }) : null;
      const code = await nextSequenceCode(tx, SEQUENCE_DO_CODIGO, STOCK_COUNT_CODE_PREFIX);
      const sessao = await tx.stockCount.create({
        data: {
          code,
          kind: "QUICK",
          mode: "ASSISTED",
          status: "COMPLETED",
          referenceAt: instante,
          createdByUserId: actor.id,
          createdByName: actor.name,
          firstRoundClosedAt: instante,
          firstRoundClosedByUserId: actor.id,
          firstRoundClosedByName: actor.name,
          completedAt: instante,
          completedByUserId: actor.id,
          completedByName: actor.name,
        },
      });
      // Nasce aberta de propósito: é o índice de exclusividade que barra uma
      // sessão iniciando no mesmo instante. Fecha antes do commit.
      const posicao = await tx.stockCountPosition.create({
        data: {
          ...retratoDaPosicao(item, lote),
          stockCountId: sessao.id,
          sequence: 1,
          positionKey,
          openPositionKey: positionKey,
          origin: "SCOPE",
          referenceQuantity: systemQuantity,
          referenceAt: instante,
        },
      });
      const registro = await tx.stockCountEntry.create({
        data: {
          positionId: posicao.id,
          round: 1,
          countedQuantity,
          expectedQuantity: systemQuantity,
          countedAt: instante,
          countedByUserId: actor.id,
          countedByName: actor.name,
          source: "QUICK",
        },
      });

      let movementId: string | null = null;
      if (!difference.isZero()) {
        const movimento = await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            lotId: lot?.id ?? null,
            type: difference.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
            quantity: difference.abs(),
            occurredAt: new Date(),
            sourceType: "STOCK_COUNT",
            sourceId: posicao.id,
            reason: input.reason ?? null,
            createdBy: actor.name,
          },
        });
        movementId = movimento.id;
      }

      await tx.stockCountPosition.update({
        where: { id: posicao.id },
        data: {
          validEntryId: registro.id,
          openPositionKey: null,
          adjustmentMovementId: movementId,
          ...(movementId
            ? {
                decision: "ADJUST" as const,
                decisionReason: input.reason ?? null,
                decidedAt: instante,
                decidedByUserId: actor.id,
                decidedByName: actor.name,
              }
            : {}),
        },
      });

      return {
        systemQuantity,
        difference,
        movementId,
        stockCountId: sessao.id,
        stockCountCode: code,
        positionId: posicao.id,
        entryId: registro.id,
      };
    });
  } catch (erro) {
    throw await traduzirConflito(erro, [positionKey]);
  }

  return {
    itemId: item.id,
    lotId: lot?.id ?? null,
    systemQuantity: gravado.systemQuantity.toString(),
    countedQuantity: countedQuantity.toString(),
    difference: gravado.difference.toString(),
    movementCreated: gravado.movementId ? await getMovementById(gravado.movementId) : null,
    stockCountId: gravado.stockCountId,
    stockCountCode: gravado.stockCountCode,
    positionId: gravado.positionId,
    entryId: gravado.entryId,
  };
}

// ─── Leituras ────────────────────────────────────────────────────────────────

interface Contadores {
  positionCount: number;
  removedCount: number;
  countedCount: number;
  divergentCount: number;
}

const SEM_CONTADORES: Contadores = { positionCount: 0, removedCount: 0, countedCount: 0, divergentCount: 0 };

type PosicaoRapida = StockCountPosition & {
  validEntry: StockCountEntry | null;
  adjustmentMovement: { type: string; quantity: Prisma.Decimal } | null;
};

const LEITURA_DA_RAPIDA = {
  validEntry: true,
  adjustmentMovement: { select: { type: true, quantity: true } },
} as const;

/** O resultado da Contagem rápida, do registro gravado e do ajuste ligado à posição (Fatia 2B). */
function resultadoRapido(posicao: PosicaoRapida | undefined): StockCountQuickResultDTO | null {
  const valido = posicao?.validEntry;
  if (!posicao || !valido) return null;
  const movimento = posicao.adjustmentMovement;
  return {
    positionId: posicao.id,
    itemId: posicao.itemId,
    itemCode: posicao.itemCode,
    itemName: posicao.itemName,
    unitCode: posicao.unitCode,
    lotId: posicao.lotId,
    lotCode: posicao.lotCode,
    ownerType: posicao.ownerType,
    ownerCustomerCode: posicao.ownerCustomerCode,
    ownerCustomerName: posicao.ownerCustomerName,
    countedQuantity: valido.countedQuantity.toString(),
    systemQuantity: valido.expectedQuantity.toString(),
    difference: valido.countedQuantity.minus(valido.expectedQuantity).toString(),
    adjustmentMovementId: posicao.adjustmentMovementId,
    adjustmentType:
      movimento?.type === "ADJUSTMENT_IN" || movimento?.type === "ADJUSTMENT_OUT" ? movimento.type : null,
    adjustmentQuantity: movimento ? movimento.quantity.toString() : null,
    reason: posicao.decisionReason,
    countedByName: valido.countedByName,
  };
}

function resumoDaSessao(
  sessao: StockCount,
  contadores: Contadores,
  escondido: boolean,
  quickResult: StockCountQuickResultDTO | null = null,
): StockCountSummaryDTO {
  return {
    id: sessao.id,
    code: sessao.code,
    kind: sessao.kind,
    mode: sessao.mode,
    status: sessao.status,
    description: sessao.description,
    referenceAt: sessao.referenceAt.toISOString(),
    createdAt: sessao.createdAt.toISOString(),
    createdByName: sessao.createdByName,
    firstRoundClosedAt: iso(sessao.firstRoundClosedAt),
    firstRoundClosedByName: sessao.firstRoundClosedByName,
    completedAt: iso(sessao.completedAt),
    completedByName: sessao.completedByName,
    cancelledAt: iso(sessao.cancelledAt),
    cancelledByName: sessao.cancelledByName,
    cancelReason: sessao.cancelReason,
    positionCount: contadores.positionCount,
    removedCount: contadores.removedCount,
    countedCount: contadores.countedCount,
    divergentCount: escondido ? null : contadores.divergentCount,
    quickResult: sessao.kind === "QUICK" ? quickResult : null,
  };
}

/** Contadores da lista numa consulta só — derivados das posições, nunca gravados. */
async function contadoresPorSessao(prisma: PrismaOuTx, ids: readonly string[]): Promise<Map<string, Contadores>> {
  const mapa = new Map<string, Contadores>();
  if (ids.length === 0) return mapa;
  const linhas = await prisma.$queryRaw<(Contadores & { stockCountId: string })[]>`
    SELECT p."stockCountId" AS "stockCountId",
      count(*) FILTER (WHERE p."removedAt" IS NULL)::int AS "positionCount",
      count(*) FILTER (WHERE p."removedAt" IS NOT NULL)::int AS "removedCount",
      count(*) FILTER (
        WHERE p."removedAt" IS NULL AND e.id IS NOT NULL
          AND e.round >= COALESCE(p."recountRequestedRound", 1)
      )::int AS "countedCount",
      count(*) FILTER (
        WHERE p."removedAt" IS NULL AND e.id IS NOT NULL
          AND e."countedQuantity" <> e."expectedQuantity"
      )::int AS "divergentCount"
    FROM stock_count_positions p
    LEFT JOIN stock_count_entries e ON e.id = p."validEntryId"
    WHERE p."stockCountId" IN (${Prisma.join([...ids])})
    GROUP BY p."stockCountId"`;
  for (const linha of linhas) mapa.set(linha.stockCountId, linha);
  return mapa;
}

export async function listStockCounts(query: ListStockCountsQuery): Promise<StockCountListResponse> {
  const prisma = getPrisma();
  const status = statusDoWhere(query.status);
  // O dia de início é o do documento no fuso da operação: fim exclusivo, nunca `lte` 23:59.
  const periodo = intervaloDeDiasComerciais(query.dateFrom, query.dateTo);
  const where: Prisma.StockCountWhereInput = {
    ...(status ? { status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.mode ? { mode: query.mode } : {}),
    ...(periodo.inicio || periodo.fimExclusivo
      ? {
          createdAt: {
            ...(periodo.inicio ? { gte: periodo.inicio } : {}),
            ...(periodo.fimExclusivo ? { lt: periodo.fimExclusivo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" as const } },
            { description: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [sessoes, total] = await Promise.all([
    prisma.stockCount.findMany({ where, orderBy: [{ createdAt: "desc" }, { code: "desc" }], ...pageArgs(query) }),
    prisma.stockCount.count({ where }),
  ]);
  const contadores = await contadoresPorSessao(
    prisma,
    sessoes.map((sessao) => sessao.id),
  );
  // A Contagem rápida mostra o que contou: uma consulta para as da página, só com a posição única.
  const rapidas = sessoes.filter((sessao) => sessao.kind === "QUICK").map((sessao) => sessao.id);
  const posicoesRapidas: PosicaoRapida[] =
    rapidas.length === 0
      ? []
      : await prisma.stockCountPosition.findMany({
          where: { stockCountId: { in: rapidas }, sequence: 1 },
          include: LEITURA_DA_RAPIDA,
        });
  const rapidaPorSessao = new Map(posicoesRapidas.map((posicao) => [posicao.stockCountId, posicao]));
  return {
    stockCounts: sessoes.map((sessao) =>
      resumoDaSessao(
        sessao,
        contadores.get(sessao.id) ?? SEM_CONTADORES,
        saldosEscondidos(sessao, "review"),
        resultadoRapido(rapidaPorSessao.get(sessao.id)),
      ),
    ),
    ...pageMeta(query, total),
  };
}

function registroDTO(registro: StockCountEntry, escondido: boolean): StockCountEntryDTO {
  return {
    id: registro.id,
    round: registro.round,
    countedQuantity: registro.countedQuantity.toString(),
    expectedQuantity: escondido ? null : registro.expectedQuantity.toString(),
    difference: escondido ? null : registro.countedQuantity.minus(registro.expectedQuantity).toString(),
    countedAt: registro.countedAt.toISOString(),
    countedByName: registro.countedByName,
    source: registro.source,
    note: registro.note,
  };
}

function registroValido(posicao: PosicaoComRegistros): StockCountEntry | null {
  return posicao.entries.find((registro) => registro.id === posicao.validEntryId) ?? null;
}

function paraMarca(posicao: PosicaoComRegistros): PosicaoParaMarca {
  return { ...posicao, validEntry: registroValido(posicao) };
}

function posicaoDTO(
  posicao: PosicaoComRegistros,
  escondido: boolean,
  view: StockCountView,
  marcada: boolean,
): StockCountPositionDTO {
  const rodada = rodadaAtual(posicao);
  const valido = registroValido(posicao);
  const pendente = recontagemPendente(posicao, valido);
  const diferenca = valido ? valido.countedQuantity.minus(valido.expectedQuantity) : null;
  // Quem reconta às cegas não vê a contagem das rodadas anteriores.
  const registros =
    escondido && view === "counting" && rodada > 1
      ? posicao.entries.filter((registro) => registro.round === rodada)
      : posicao.entries;

  let situation: StockCountPositionSituation;
  if (posicao.removedAt) situation = "REMOVED";
  else if (pendente) situation = "RECOUNT_REQUESTED";
  else if (!diferenca) situation = "PENDING";
  else if (escondido) situation = "COUNTED";
  else if (diferenca.isZero()) situation = "MATCHES";
  else if (posicao.decision) situation = "DECIDED";
  else situation = "DIVERGENT";

  return {
    id: posicao.id,
    sequence: posicao.sequence,
    positionKey: posicao.positionKey,
    origin: posicao.origin,
    itemId: posicao.itemId,
    itemCode: posicao.itemCode,
    itemName: posicao.itemName,
    itemType: posicao.itemType,
    unitCode: posicao.unitCode,
    lotId: posicao.lotId,
    lotCode: posicao.lotCode,
    ownerType: posicao.ownerType,
    ownerCustomerId: posicao.ownerCustomerId,
    ownerCustomerCode: posicao.ownerCustomerCode,
    ownerCustomerName: posicao.ownerCustomerName,
    lotStatusAtReference: posicao.lotStatusAtReference,
    expiryDateAtReference: iso(posicao.expiryDateAtReference),
    locationAtReference: posicao.locationAtReference,
    referenceAt: posicao.referenceAt.toISOString(),
    referenceQuantity: escondido ? null : posicao.referenceQuantity.toString(),
    currentRound: rodada,
    lastEntryId: valido && valido.round === rodada ? valido.id : null,
    validEntryId: posicao.validEntryId,
    finalDifference: escondido || !diferenca ? null : diferenca.toString(),
    hasConcurrentMovement: escondido ? null : marcada,
    situation,
    entries: registros.map((registro) => registroDTO(registro, escondido)),
    recountRequestedRound: posicao.recountRequestedRound,
    recountRequestedAt: iso(posicao.recountRequestedAt),
    recountRequestedByName: posicao.recountRequestedByName,
    recountedByRequester:
      valido !== null &&
      valido.round > 1 &&
      posicao.recountRequestedByUserId !== null &&
      valido.countedByUserId === posicao.recountRequestedByUserId,
    addedAt: iso(posicao.addedAt),
    addedByName: posicao.addedByName,
    addReason: posicao.addReason,
    removedAt: iso(posicao.removedAt),
    removedByName: posicao.removedByName,
    removeReason: posicao.removeReason,
    decision: escondido ? null : posicao.decision,
    decisionReason: escondido ? null : posicao.decisionReason,
    decidedAt: escondido ? null : iso(posicao.decidedAt),
    decidedByName: escondido ? null : posicao.decidedByName,
    concurrentMovementConfirmed: escondido ? false : posicao.concurrentMovementConfirmed,
    adjustmentMovementId: escondido ? null : posicao.adjustmentMovementId,
  };
}

function ocorrenciaDTO(
  ocorrencia: StockCountFinding & { item: { code: string; name: string } | null },
): StockCountFindingDTO {
  return {
    id: ocorrencia.id,
    kind: ocorrencia.kind,
    itemId: ocorrencia.itemId,
    itemCode: ocorrencia.item?.code ?? null,
    itemName: ocorrencia.item?.name ?? null,
    identification: ocorrencia.identification,
    quantity: ocorrencia.quantity ? ocorrencia.quantity.toString() : null,
    unitCode: ocorrencia.unitCode,
    note: ocorrencia.note,
    createdAt: ocorrencia.createdAt.toISOString(),
    createdByName: ocorrencia.createdByName,
  };
}

export async function getStockCountDetail(id: string, view: StockCountView): Promise<StockCountDetailDTO | null> {
  const prisma = getPrisma();
  const sessao = await prisma.stockCount.findUnique({
    where: { id },
    include: {
      positions: {
        orderBy: { sequence: "asc" },
        include: {
          entries: { orderBy: ORDEM_DOS_REGISTROS },
          adjustmentMovement: LEITURA_DA_RAPIDA.adjustmentMovement,
        },
      },
      findings: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { item: { select: { code: true, name: true } } },
      },
    },
  });
  if (!sessao) return null;

  const escondido = saldosEscondidos(sessao, view);
  const marcadas = escondido
    ? new Set<string>()
    : await posicoesComMovimentacao(prisma, sessao.positions.map(paraMarca), sessao.completedAt ?? sessao.cancelledAt);

  const contadores = { ...SEM_CONTADORES };
  for (const posicao of sessao.positions) {
    if (posicao.removedAt) {
      contadores.removedCount += 1;
      continue;
    }
    contadores.positionCount += 1;
    const valido = registroValido(posicao);
    if (valido && !recontagemPendente(posicao, valido)) contadores.countedCount += 1;
    if (valido && !valido.countedQuantity.equals(valido.expectedQuantity)) contadores.divergentCount += 1;
  }

  const encerrador = sessao.completedByUserId;
  const [primeira] = sessao.positions;
  const quickResult =
    sessao.kind === "QUICK" && primeira ? resultadoRapido({ ...primeira, validEntry: registroValido(primeira) }) : null;
  return {
    ...resumoDaSessao(sessao, contadores, escondido, quickResult),
    view,
    balancesHidden: escondido,
    scopeFilters: sessao.scopeFilters ?? null,
    completedByCounter:
      encerrador !== null &&
      sessao.positions.some((posicao) => posicao.entries.some((registro) => registro.countedByUserId === encerrador)),
    positions: sessao.positions.map((posicao) => posicaoDTO(posicao, escondido, view, marcadas.has(posicao.id))),
    findings: sessao.findings.map(ocorrenciaDTO),
  };
}

export async function getStockCountPosition(
  stockCountId: string,
  positionId: string,
  view: StockCountView,
): Promise<StockCountPositionDTO | null> {
  const prisma = getPrisma();
  const posicao = await prisma.stockCountPosition.findFirst({
    where: { id: positionId, stockCountId },
    include: {
      entries: { orderBy: ORDEM_DOS_REGISTROS },
      stockCount: { select: { mode: true, firstRoundClosedAt: true, completedAt: true, cancelledAt: true } },
    },
  });
  if (!posicao) return null;
  const escondido = saldosEscondidos(posicao.stockCount, view);
  const marcada = escondido
    ? false
    : (
        await posicoesComMovimentacao(
          prisma,
          [paraMarca(posicao)],
          posicao.stockCount.completedAt ?? posicao.stockCount.cancelledAt,
        )
      ).has(posicao.id);
  return posicaoDTO(posicao, escondido, view, marcada);
}

/**
 * Movimentos da posição depois da referência (Fatia 2B) — a lista que explica
 * "com movimentação durante o inventário". Mesma janela e mesmo recorte da
 * marca: lançados (`createdAt`) depois da referência, até o fim da sessão, sem
 * ajuste de inventário. Cada um diz se veio depois da contagem que vale e se é
 * lançamento retroativo — depois da contagem, com ocorrência anterior a ela.
 *
 * Contagem cega antes da revelação não lista nada: é a leitura de revisão.
 */
export async function getStockCountPositionMovements(
  stockCountId: string,
  positionId: string,
): Promise<StockCountPositionMovementsDTO | null> {
  const prisma = getPrisma();
  const posicao = await prisma.stockCountPosition.findFirst({
    where: { id: positionId, stockCountId },
    include: {
      validEntry: { select: { countedAt: true } },
      stockCount: { select: { mode: true, firstRoundClosedAt: true, completedAt: true, cancelledAt: true } },
    },
  });
  if (!posicao) return null;

  const countedAt = posicao.validEntry?.countedAt ?? null;
  const base = {
    positionId: posicao.id,
    referenceAt: posicao.referenceAt.toISOString(),
    countedAt: iso(countedAt),
  };
  if (saldosEscondidos(posicao.stockCount, "review")) {
    return { ...base, balancesHidden: true, movements: [], total: 0 };
  }

  const fim = posicao.stockCount.completedAt ?? posicao.stockCount.cancelledAt;
  const where: Prisma.InventoryMovementWhereInput = {
    ...(posicao.lotId ? { lotId: posicao.lotId } : { itemId: posicao.itemId, lotId: null }),
    createdAt: fim ? { gt: posicao.referenceAt, lte: fim } : { gt: posicao.referenceAt },
    stockCountPosition: { is: null },
  };
  const [linhas, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: STOCK_COUNT_POSITION_MOVEMENTS_LIMIT,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);
  const movimentos = await getMovementsByIds(linhas.map((linha) => linha.id));
  return {
    ...base,
    balancesHidden: false,
    movements: movimentos.map((movimento) => {
      const depois = countedAt !== null && new Date(movimento.createdAt).getTime() > countedAt.getTime();
      return {
        ...movimento,
        afterCount: depois,
        retroactive: countedAt !== null && depois && new Date(movimento.occurredAt).getTime() < countedAt.getTime(),
      };
    }),
    total,
  };
}

export async function getStockCountFinding(id: string): Promise<StockCountFindingDTO | null> {
  const ocorrencia = await getPrisma().stockCountFinding.findUnique({
    where: { id },
    include: { item: { select: { code: true, name: true } } },
  });
  return ocorrencia ? ocorrenciaDTO(ocorrencia) : null;
}
