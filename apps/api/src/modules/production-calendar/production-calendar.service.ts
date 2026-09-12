import { Prisma } from "@prisma/client";
import type { ProductionCalendar, ProductionCalendarException, User } from "@prisma/client";
import type {
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarExceptionListResponse,
} from "@veridi/shared";
import {
  AVISO_INTERVALO_SEM_HORARIO,
  CALENDARIO_PADRAO,
  PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS,
  intervaloPosicionado,
  minutosUteisPorDia,
  validarConfiguracaoDeCalendario,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDoDiaCivil } from "../../lib/business-day.js";
import {
  ProductionCalendarConfigInvalidError,
  ProductionCalendarExceptionDateTakenError,
  ProductionCalendarExceptionNotFoundError,
} from "./production-calendar.errors.js";
import type {
  CreateProductionCalendarExceptionParsed,
  ListProductionCalendarExceptionsQuery,
  UpdateProductionCalendarExceptionParsed,
  UpdateProductionCalendarParsed,
} from "./production-calendar.schemas.js";

/**
 * CALENDÁRIO DE PRODUÇÃO — PLANNING-CALENDAR-01.
 *
 * A jornada operacional da fábrica e os dias em que ela não opera. Absorve o
 * OPS-CALENDAR-01 do BACKLOG: um conceito só, nunca dois.
 *
 * **Singleton.** Existe UM calendário. A linha tem id fixo e o banco recusa
 * qualquer outro (CHECK) — não há lista, não há "ativo", não há calendário
 * por recurso, setor ou cliente. Mão de obra e equipamento continuam pools e
 * herdam esta jornada.
 *
 * **Ler nunca cria.** Antes do primeiro salvamento o GET devolve o padrão
 * sugerido com `configured: false`: a tela mostra de onde partir sem que
 * abrir a página vire um cadastro que ninguém fez. O default de segunda a
 * sexta vale só nesse momento — quem salvou nunca é sobrescrito por ele.
 *
 * **O que este módulo NÃO faz:** não agenda Ordem de Produção, não guarda
 * capacidade de recurso, não tem turno e não move promessa de entrega. E não
 * toca vigência: tarifa, oferta de fornecedor, `ItemCostReference`, validade
 * de lote e faturamento seguem exatamente como estavam — nenhum deles passa a
 * depender de dia útil.
 */

/** A chave do singleton. O banco confirma com CHECK ("id" = 'GLOBAL'). */
const CALENDARIO_GLOBAL = "GLOBAL";

function toCalendarDTO(linha: ProductionCalendar | null): ProductionCalendarDTO {
  const config = linha
    ? {
        startMinuteOfDay: linha.startMinuteOfDay,
        endMinuteOfDay: linha.endMinuteOfDay,
        breakMinutes: linha.breakMinutes,
        breakStartMinuteOfDay: linha.breakStartMinuteOfDay,
        breakEndMinuteOfDay: linha.breakEndMinuteOfDay,
        weekdays: {
          monday: linha.monday,
          tuesday: linha.tuesday,
          wednesday: linha.wednesday,
          thursday: linha.thursday,
          friday: linha.friday,
          saturday: linha.saturday,
          sunday: linha.sunday,
        },
      }
    : CALENDARIO_PADRAO;

  return {
    ...config,
    configured: linha !== null,
    /*
     * O calendário continua válido sem a posição do intervalo — só a agenda
     * com horário exato é que não sai daqui. A tela avisa com esta frase em
     * vez de inventar 12:00–13:00 (PLANNING-CAPACITY-BOARD-01).
     */
    breakPositionWarning:
      config.breakMinutes > 0 && !intervaloPosicionado(config)
        ? AVISO_INTERVALO_SEM_HORARIO
        : null,
    workingMinutesPerDay: minutosUteisPorDia(config),
    updatedAt: linha ? linha.updatedAt.toISOString() : null,
    updatedBy: linha?.updatedBy ?? null,
  };
}

function toExceptionDTO(linha: ProductionCalendarException): ProductionCalendarExceptionDTO {
  return {
    id: linha.id,
    date: diaDaColunaDeData(linha.date),
    type: linha.type,
    reason: linha.reason,
    createdAt: linha.createdAt.toISOString(),
    createdBy: linha.createdBy,
    updatedAt: linha.updatedAt.toISOString(),
    updatedBy: linha.updatedBy,
  };
}

/** A jornada de hoje, ou o padrão sugerido enquanto ninguém configurou. */
export async function getProductionCalendar(): Promise<ProductionCalendarDTO> {
  const linha = await getPrisma().productionCalendar.findUnique({
    where: { id: CALENDARIO_GLOBAL },
  });
  return toCalendarDTO(linha);
}

/**
 * Salva a jornada. Primeiro salvamento cria a única linha; os seguintes a
 * atualizam — nunca há uma segunda.
 *
 * A validação é a MESMA regra do `@veridi/shared` que a tela usa para avisar
 * antes de enviar, e o banco a confirma em CHECK. Três camadas, uma definição.
 */
export async function updateProductionCalendar(
  entrada: UpdateProductionCalendarParsed,
  actor: User | null,
): Promise<ProductionCalendarDTO> {
  const problemas = validarConfiguracaoDeCalendario(entrada);
  if (problemas.length > 0) throw new ProductionCalendarConfigInvalidError(problemas);

  const dados = {
    startMinuteOfDay: entrada.startMinuteOfDay,
    endMinuteOfDay: entrada.endMinuteOfDay,
    breakMinutes: entrada.breakMinutes,
    breakStartMinuteOfDay: entrada.breakStartMinuteOfDay,
    breakEndMinuteOfDay: entrada.breakEndMinuteOfDay,
    ...entrada.weekdays,
    updatedBy: actor?.name ?? null,
  };

  const linha = await getPrisma().productionCalendar.upsert({
    where: { id: CALENDARIO_GLOBAL },
    create: { id: CALENDARIO_GLOBAL, ...dados },
    update: dados,
  });
  return toCalendarDTO(linha);
}

/**
 * As exceções, em ordem de data.
 *
 * O intervalo é opcional e cada ponta é independente — a tela pede a janela
 * que está mostrando, e "tudo" continua sendo uma pergunta legítima. As
 * fronteiras comparam MARCADORES de dia civil, não instantes: é a mesma
 * ponte que a validade de lote e a promessa de entrega já usam.
 */
export async function listProductionCalendarExceptions(
  query: ListProductionCalendarExceptionsQuery = {},
): Promise<ProductionCalendarExceptionListResponse> {
  const filtroDeData: Prisma.DateTimeFilter = {};
  if (query.from) filtroDeData.gte = marcadorDoDiaCivil(query.from);
  if (query.to) filtroDeData.lte = marcadorDoDiaCivil(query.to);

  const linhas = await getPrisma().productionCalendarException.findMany({
    ...(query.from || query.to ? { where: { date: filtroDeData } } : {}),
    orderBy: { date: "asc" },
  });
  return { exceptions: linhas.map(toExceptionDTO) };
}

/**
 * Cadastra um dia não operacional.
 *
 * Uma exceção por data (decisão do PO): a data já cadastrada é RECUSADA com o
 * motivo que já está lá, e não sobrescrita em silêncio. Editar o que existe é
 * uma ação consciente, não um efeito colateral de cadastrar de novo.
 */
export async function createProductionCalendarException(
  entrada: CreateProductionCalendarExceptionParsed,
  actor: User | null,
): Promise<ProductionCalendarExceptionDTO> {
  const prisma = getPrisma();
  const marcador = marcadorDoDiaCivil(entrada.date);

  const existente = await prisma.productionCalendarException.findUnique({
    where: { date: marcador },
  });
  if (existente) {
    throw new ProductionCalendarExceptionDateTakenError(
      entrada.date,
      PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[existente.type],
    );
  }

  const linha = await prisma.productionCalendarException.create({
    data: {
      date: marcador,
      type: entrada.type,
      reason: entrada.reason ?? null,
      createdBy: actor?.name ?? null,
      updatedBy: actor?.name ?? null,
    },
  });
  return toExceptionDTO(linha);
}

/**
 * Edita tipo e motivo de uma exceção. A DATA não muda: mudar de dia é apagar
 * esta e cadastrar a outra — o unique da data garantiria a regra de qualquer
 * jeito, e trocar a data em silêncio faria um feriado "andar" sem registro.
 */
export async function updateProductionCalendarException(
  id: string,
  entrada: UpdateProductionCalendarExceptionParsed,
  actor: User | null,
): Promise<ProductionCalendarExceptionDTO> {
  const prisma = getPrisma();
  const atual = await prisma.productionCalendarException.findUnique({ where: { id } });
  if (!atual) throw new ProductionCalendarExceptionNotFoundError();

  const linha = await prisma.productionCalendarException.update({
    where: { id },
    data: {
      ...(entrada.type ? { type: entrada.type } : {}),
      ...(entrada.reason !== undefined ? { reason: entrada.reason } : {}),
      updatedBy: actor?.name ?? null,
    },
  });
  return toExceptionDTO(linha);
}

/**
 * Remove uma exceção — o dia volta a operar pela regra da semana.
 *
 * Excluir é seguro nesta fase porque nenhum planejamento depende do
 * calendário ainda: não há agenda de OP para reescrever. Quando
 * PLANNING-CAPACITY-BOARD-01 existir, é aqui que entra a decisão sobre data
 * que já participou de planejamento calculado.
 */
export async function deleteProductionCalendarException(id: string): Promise<void> {
  const prisma = getPrisma();
  const atual = await prisma.productionCalendarException.findUnique({ where: { id } });
  if (!atual) throw new ProductionCalendarExceptionNotFoundError();
  await prisma.productionCalendarException.delete({ where: { id } });
}
