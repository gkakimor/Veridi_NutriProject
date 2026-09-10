import { Prisma } from "@prisma/client";
import type { ItemCostReference, PrismaClient, User } from "@prisma/client";
import type {
  CreateItemCostReferenceInput,
  ItemCostReferenceDTO,
  ItemCostReferencesResponse,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  diaDaColunaDeData,
  marcadorDeHojeComercial,
  marcadorDoDiaCivil,
} from "../../lib/business-day.js";
import {
  COST_REFERENCE_VALIDITY_ORDER,
  getManualCostReference,
  selectItemCostSource,
} from "../../lib/cost-source-selection.js";
import { isUomCompatible } from "./uom.js";
import { custoUnitario } from "../../lib/decimal-serialization.js";
import {
  CASAS_CUSTO_UNITARIO,
  casasDecimais,
  mensagemCasasCustoUnitario,
} from "../../lib/decimal-schema.js";
import {
  CostReferenceUnitIncompatibleError,
  InvalidCostReferenceError,
  ItemNotFoundError,
  UnitNotFoundError,
} from "./items.errors.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Referência manual de custo do Item.
 *
 * Uma referência é uma ESTIMATIVA declarada por gente — não é compra,
 * recebimento nem valor pago. O histórico é por vigência: cada alteração
 * INSERE uma linha; nada é atualizado nem apagado. Um cálculo salvo congela
 * o valor que usou, então mudar a referência depois não altera nenhum CMV
 * histórico (a regra durável está em PRODUCT_RULES §53).
 */

function toDTO(row: ItemCostReference, currentId: string | null): ItemCostReferenceDTO {
  return {
    id: row.id,
    itemId: row.itemId,
    unitCost: row.unitCost.toString(),
    currencyCode: row.currencyCode,
    uomCode: row.uomCode,
    effectiveFrom: row.effectiveFrom.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByNameSnapshot,
    current: row.id === currentId,
  };
}

/**
 * Validação de domínio da referência, compartilhada entre "criar item já
 * com referência" e "alterar referência" — duas portas, uma regra.
 */
async function prepareReferenceData(
  prisma: PrismaOrTx,
  item: { id: string; unitCode: string },
  input: CreateItemCostReferenceInput,
  actor: Pick<User, "id" | "name"> | null,
): Promise<Prisma.ItemCostReferenceUncheckedCreateInput> {
  const raw = input.unitCost.trim();
  if (raw === "") throw new InvalidCostReferenceError("Informe o custo de referência.");
  let unitCost: Prisma.Decimal;
  try {
    unitCost = new Prisma.Decimal(raw.replace(",", "."));
  } catch {
    throw new InvalidCostReferenceError("Custo de referência inválido.");
  }
  if (!unitCost.isFinite() || unitCost.lessThan(0)) {
    throw new InvalidCostReferenceError("Custo de referência não pode ser negativo.");
  }
  // A coluna guarda 8 casas (`DECIMAL(20,8)`, PREC-MIG-B). Aceitar mais e
  // deixar o PostgreSQL arredondar gravaria um custo diferente do informado,
  // em silêncio — e este valor é uma das fontes do seletor canônico.
  if (casasDecimais(raw.replace(",", ".")) > CASAS_CUSTO_UNITARIO) {
    throw new InvalidCostReferenceError(mensagemCasasCustoUnitario());
  }

  const uomCode = input.uomCode?.trim() || item.unitCode;
  const units = await prisma.unitOfMeasure.findMany();
  if (!units.some((unit) => unit.code === uomCode)) throw new UnitNotFoundError(uomCode);
  // Referência em unidade que não converte para a do item nunca viraria
  // custo — melhor recusar na entrada do que gravar um número inútil.
  if (!isUomCompatible(uomCode, item.unitCode, units)) {
    throw new CostReferenceUnitIncompatibleError(uomCode, item.unitCode);
  }

  /*
   * "Válido desde" é DATA CIVIL, e a coluna guarda o marcador do dia.
   *
   * Vindo da tela, o dia é explícito e passa intacto: `2026-09-15` continua
   * 15/09, sem releitura pelo relógio de quem gravou. Ausente, o padrão é
   * HOJE — e "hoje" é o dia comercial de São Paulo, não o dia UTC. Às 22:30
   * os dois já discordam: a referência criada "a partir de hoje" nascia com
   * o marcador de amanhã e voltava `NOT_YET_EFFECTIVE` no próprio dia em que
   * a pessoa a cadastrou. A API não pode depender de a tela sempre mandar a
   * data — o padrão do serviço é a única defesa de quem chama pela rota.
   */
  const informada = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
  if (informada && Number.isNaN(informada.getTime())) {
    throw new InvalidCostReferenceError("Data de início da vigência inválida.");
  }
  const effectiveFrom = informada
    ? marcadorDoDiaCivil(diaDaColunaDeData(informada))
    : marcadorDeHojeComercial();

  return {
    itemId: item.id,
    unitCost,
    currencyCode: "BRL",
    uomCode,
    effectiveFrom,
    note: input.note?.trim() || null,
    createdByUserId: actor?.id ?? null,
    createdByNameSnapshot: actor?.name ?? null,
  };
}

/** Cria uma vigência nova — usado pela criação do item e pela alteração. */
export async function insertItemCostReference(
  prisma: PrismaOrTx,
  item: { id: string; unitCode: string },
  input: CreateItemCostReferenceInput,
  actor: Pick<User, "id" | "name"> | null,
): Promise<ItemCostReference> {
  const data = await prepareReferenceData(prisma, item, input, actor);
  return prisma.itemCostReference.create({ data });
}

export async function createItemCostReference(
  itemId: string,
  input: CreateItemCostReferenceInput,
  actor: Pick<User, "id" | "name">,
): Promise<ItemCostReferencesResponse> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new ItemNotFoundError(itemId);
  await insertItemCostReference(prisma, item, input, actor);
  return listItemCostReferences(itemId);
}

/**
 * Vigência atual, histórico completo e — ao lado — o que a seleção
 * automática escolhe HOJE. É esta última linha que diz ao usuário se a
 * referência está sendo usada ou se uma compra real (ou oferta) vence.
 */
export async function listItemCostReferences(
  itemId: string,
  referenceDate: Date = marcadorDeHojeComercial(),
): Promise<ItemCostReferencesResponse> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new ItemNotFoundError(itemId);

  const [rows, current, units] = await Promise.all([
    prisma.itemCostReference.findMany({
      where: { itemId },
      orderBy: [...COST_REFERENCE_VALIDITY_ORDER],
    }),
    getManualCostReference(prisma, itemId, referenceDate),
    prisma.unitOfMeasure.findMany(),
  ]);
  const automatic = await selectItemCostSource(
    prisma,
    { itemId, itemUnitCode: item.unitCode, referenceDate },
    units,
  );

  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemUnitCode: item.unitCode,
    current: current ? toDTO(current, current.id) : null,
    history: rows.map((row) => toDTO(row, current?.id ?? null)),
    automatic: {
      unitCost: automatic.unitCost ? custoUnitario(automatic.unitCost) : null,
      unitCode: item.unitCode,
      source: automatic.source,
      details: automatic.details,
      referenceDate: referenceDate.toISOString(),
    },
  };
}
