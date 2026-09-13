import { Prisma } from "@prisma/client";
import type { ProductionCalendarException, ProductionCalendarWeekday, User } from "@prisma/client";
import type {
  CalendarioDeProducao,
  ExcecaoDoCalendario,
  JornadaDaSemana,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarExceptionListResponse,
  ProductionCalendarWeekdayDTO,
} from "@veridi/shared";
import {
  DIAS_DA_SEMANA,
  DIA_DA_SEMANA_LABELS,
  PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS,
  SEMANA_PADRAO,
  avisoDeIntervaloSemHorario,
  diasComIntervaloSemHorario,
  minutosUteisDaExcecao,
  minutosUteisDoDiaDaSemana,
  montarCalendario,
  validarDiaDaSemana,
  validarExcecao,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDoDiaCivil } from "../../lib/business-day.js";
import {
  ProductionCalendarConfigInvalidError,
  ProductionCalendarExceptionDateTakenError,
  ProductionCalendarExceptionInvalidError,
  ProductionCalendarExceptionNotFoundError,
  ProductionCalendarWeekIncompleteError,
} from "./production-calendar.errors.js";
import type {
  CreateProductionCalendarExceptionParsed,
  ListProductionCalendarExceptionsQuery,
  UpdateProductionCalendarExceptionParsed,
  UpdateProductionCalendarWeekdayParsed,
  WeekdayParams,
} from "./production-calendar.schemas.js";

/**
 * CALENDÁRIO DE PRODUÇÃO — PLANNING-CALENDAR-01, com jornada POR DIA DA SEMANA
 * e exceção com horário especial desde PLANNING-CALENDAR-WEEKLY-SCHEDULE-01.
 *
 * **Singleton.** Existe UM calendário. A linha tem id fixo e o banco recusa
 * qualquer outro (CHECK) — não há lista, não há "ativo", não há calendário
 * por recurso, setor ou cliente. Mão de obra e equipamento continuam pools e
 * herdam esta jornada.
 *
 * **A jornada são sete linhas, e cada uma se salva sozinha.** Mudar a sexta
 * não reenvia nem reescreve a segunda. A fonte canônica é
 * `ProductionCalendarWeekday`; as colunas de jornada única de
 * `ProductionCalendar` estão deprecadas e ninguém aqui as lê.
 *
 * **Ler nunca cria.** Antes do primeiro salvamento o GET devolve a semana
 * sugerida com `configured: false`. O primeiro salvamento de QUALQUER dia cria
 * o calendário com os sete — o dia salvo com o que a pessoa informou, os
 * outros seis com a sugestão que a tela mostrava. Um dia salvo sozinho não
 * pode deixar os outros sem jornada.
 *
 * **O que este módulo NÃO faz:** não agenda Ordem de Produção, não guarda
 * capacidade de recurso, não tem turno e não move promessa de entrega. E não
 * toca vigência: tarifa, oferta de fornecedor, `ItemCostReference`, validade
 * de lote e faturamento seguem exatamente como estavam.
 */

/** A chave do singleton. O banco confirma com CHECK ("id" = 'GLOBAL'). */
const CALENDARIO_GLOBAL = "GLOBAL";

type LinhaDaSemana = JornadaDaSemana & { updatedAt: Date | null; updatedBy: string | null };

function toWeekdayDTO(dia: LinhaDaSemana): ProductionCalendarWeekdayDTO {
  return {
    weekday: dia.weekday,
    enabled: dia.enabled,
    startMinuteOfDay: dia.startMinuteOfDay,
    endMinuteOfDay: dia.endMinuteOfDay,
    breakStartMinuteOfDay: dia.breakStartMinuteOfDay,
    breakEndMinuteOfDay: dia.breakEndMinuteOfDay,
    unpositionedBreakMinutes: dia.unpositionedBreakMinutes,
    workingMinutes: minutosUteisDoDiaDaSemana(dia),
    updatedAt: dia.updatedAt ? dia.updatedAt.toISOString() : null,
    updatedBy: dia.updatedBy,
  };
}

/** Os sete dias gravados, de segunda a domingo — ou a recusa do que falta. */
function semanaGravada(linhas: readonly ProductionCalendarWeekday[]): ProductionCalendarWeekdayDTO[] {
  const porDia = new Map(linhas.map((linha) => [linha.weekday, linha]));
  const faltando = DIAS_DA_SEMANA.filter((dia) => !porDia.has(dia));
  if (faltando.length > 0) {
    throw new ProductionCalendarWeekIncompleteError(faltando.map((dia) => DIA_DA_SEMANA_LABELS[dia]));
  }
  return DIAS_DA_SEMANA.map((dia) => toWeekdayDTO(porDia.get(dia)!));
}

function excecaoDoMotor(linha: ProductionCalendarException): ExcecaoDoCalendario {
  return {
    date: diaDaColunaDeData(linha.date),
    operation: linha.operation,
    startMinuteOfDay: linha.startMinuteOfDay,
    endMinuteOfDay: linha.endMinuteOfDay,
    breakStartMinuteOfDay: linha.breakStartMinuteOfDay,
    breakEndMinuteOfDay: linha.breakEndMinuteOfDay,
  };
}

function toExceptionDTO(linha: ProductionCalendarException): ProductionCalendarExceptionDTO {
  const funcionamento = excecaoDoMotor(linha);
  return {
    id: linha.id,
    ...funcionamento,
    type: linha.type,
    reason: linha.reason,
    workingMinutes: minutosUteisDaExcecao(funcionamento),
    createdAt: linha.createdAt.toISOString(),
    createdBy: linha.createdBy,
    updatedAt: linha.updatedAt.toISOString(),
    updatedBy: linha.updatedBy,
  };
}

/** A jornada semanal gravada, ou a sugestão enquanto ninguém configurou. */
export async function getProductionCalendar(): Promise<ProductionCalendarDTO> {
  const linha = await getPrisma().productionCalendar.findUnique({
    where: { id: CALENDARIO_GLOBAL },
    include: { weekdayJourneys: true },
  });

  const weekdays = linha
    ? semanaGravada(linha.weekdayJourneys)
    : SEMANA_PADRAO.map((dia) => toWeekdayDTO({ ...dia, updatedAt: null, updatedBy: null }));

  return {
    configured: linha !== null,
    weekdays,
    /*
     * O calendário continua válido sem a posição do intervalo — só a agenda
     * com horário exato é que não sai daqui. A tela avisa com esta frase, com
     * os dias nomeados, em vez de inventar 12:00–13:00.
     */
    breakPositionWarning: avisoDeIntervaloSemHorario(diasComIntervaloSemHorario(weekdays)),
    updatedAt: linha ? linha.updatedAt.toISOString() : null,
    updatedBy: linha?.updatedBy ?? null,
  };
}

/**
 * O calendário pronto para o motor de agenda: a semana e TODAS as exceções.
 *
 * Um lugar só monta isto — a programação da ordem e o quadro leem daqui, e o
 * motor que recebe é o mesmo `janelasDoDia` do `@veridi/shared`.
 */
export async function getProductionCalendarForPlanning(): Promise<{
  dto: ProductionCalendarDTO;
  calendario: CalendarioDeProducao;
}> {
  const dto = await getProductionCalendar();
  const excecoes = await getPrisma().productionCalendarException.findMany();
  return { dto, calendario: montarCalendario(dto.weekdays, excecoes.map(excecaoDoMotor)) };
}

/**
 * Salva a jornada de UM dia da semana.
 *
 * A validação é a MESMA regra do `@veridi/shared` que a tela usa para avisar
 * antes de enviar, e o banco a confirma em CHECK. Dia que não opera é gravado
 * sem horário nenhum; e salvar o dia apaga o intervalo legado sem horário —
 * quem salva está dizendo, com todas as letras, qual é a pausa.
 *
 * Transação com o calendário travado: "ao menos um dia opera" lê as outras
 * linhas, e duas pessoas fechando os dois últimos dias ao mesmo tempo não
 * podem passar as duas.
 */
export async function updateProductionCalendarWeekday(
  { weekday }: WeekdayParams,
  entrada: UpdateProductionCalendarWeekdayParsed,
  actor: User | null,
): Promise<ProductionCalendarDTO> {
  const problemas = validarDiaDaSemana(entrada);
  if (problemas.length > 0) throw new ProductionCalendarConfigInvalidError(problemas);

  const quem = actor?.name ?? null;
  const horario = entrada.enabled
    ? {
        startMinuteOfDay: entrada.startMinuteOfDay,
        endMinuteOfDay: entrada.endMinuteOfDay,
        breakStartMinuteOfDay: entrada.breakStartMinuteOfDay,
        breakEndMinuteOfDay: entrada.breakEndMinuteOfDay,
      }
    : {
        startMinuteOfDay: null,
        endMinuteOfDay: null,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
      };

  await getPrisma().$transaction(async (tx) => {
    await tx.productionCalendar.upsert({
      where: { id: CALENDARIO_GLOBAL },
      create: { id: CALENDARIO_GLOBAL, updatedBy: quem },
      update: { updatedBy: quem },
    });
    await tx.$queryRaw`SELECT "id" FROM "production_calendars" WHERE "id" = ${CALENDARIO_GLOBAL} FOR UPDATE`;

    // Primeiro salvamento: os sete dias nascem juntos, com a sugestão que a
    // tela mostrava. Nos seguintes, nada é inserido.
    await tx.productionCalendarWeekday.createMany({
      data: SEMANA_PADRAO.map((dia) => ({ calendarId: CALENDARIO_GLOBAL, ...dia, updatedBy: quem })),
      skipDuplicates: true,
    });

    await tx.productionCalendarWeekday.update({
      where: { calendarId_weekday: { calendarId: CALENDARIO_GLOBAL, weekday } },
      data: { enabled: entrada.enabled, ...horario, unpositionedBreakMinutes: null, updatedBy: quem },
    });

    const operantes = await tx.productionCalendarWeekday.count({
      where: { calendarId: CALENDARIO_GLOBAL, enabled: true },
    });
    if (operantes === 0) {
      throw new ProductionCalendarConfigInvalidError([
        "Ao menos um dia da semana precisa operar. Ative outro dia antes de desativar este.",
      ]);
    }
  });

  return getProductionCalendar();
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

async function recusaDeDataOcupada(diaISO: string): Promise<never> {
  const existente = await getPrisma().productionCalendarException.findUnique({
    where: { date: marcadorDoDiaCivil(diaISO) },
  });
  throw new ProductionCalendarExceptionDateTakenError(
    diaISO,
    existente ? PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[existente.type] : "outra exceção",
  );
}

/**
 * Cadastra uma regra para uma data.
 *
 * Uma exceção por data (decisão do PO): a data já cadastrada é RECUSADA com o
 * motivo que já está lá, e não sobrescrita em silêncio. Editar o que existe é
 * uma ação consciente, não um efeito colateral de cadastrar de novo.
 */
export async function createProductionCalendarException(
  entrada: CreateProductionCalendarExceptionParsed,
  actor: User | null,
): Promise<ProductionCalendarExceptionDTO> {
  const funcionamento = {
    operation: entrada.operation,
    startMinuteOfDay: entrada.startMinuteOfDay,
    endMinuteOfDay: entrada.endMinuteOfDay,
    breakStartMinuteOfDay: entrada.breakStartMinuteOfDay,
    breakEndMinuteOfDay: entrada.breakEndMinuteOfDay,
  };
  const problemas = validarExcecao(funcionamento);
  if (problemas.length > 0) throw new ProductionCalendarExceptionInvalidError(problemas);

  const prisma = getPrisma();
  const marcador = marcadorDoDiaCivil(entrada.date);
  if (await prisma.productionCalendarException.findUnique({ where: { date: marcador } })) {
    return recusaDeDataOcupada(entrada.date);
  }

  try {
    const linha = await prisma.productionCalendarException.create({
      data: {
        date: marcador,
        type: entrada.type,
        reason: entrada.reason ?? null,
        ...funcionamento,
        createdBy: actor?.name ?? null,
        updatedBy: actor?.name ?? null,
      },
    });
    return toExceptionDTO(linha);
  } catch (erro) {
    // Duas pessoas cadastrando a mesma data ao mesmo tempo: o unique decide,
    // e a segunda recebe a mesma recusa explícita — nunca um 500.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return recusaDeDataOcupada(entrada.date);
    }
    throw erro;
  }
}

/**
 * Edita motivo, observação e funcionamento de uma exceção. A DATA não muda:
 * mudar de dia é apagar esta e cadastrar a outra — o unique da data garantiria
 * a regra de qualquer jeito, e trocar a data em silêncio faria um feriado
 * "andar" sem registro.
 *
 * Com `operation`, o funcionamento inteiro é substituído: trocar horário
 * especial por sem operação limpa o horário, e o contrário exige o horário
 * novo por inteiro.
 */
export async function updateProductionCalendarException(
  id: string,
  entrada: UpdateProductionCalendarExceptionParsed,
  actor: User | null,
): Promise<ProductionCalendarExceptionDTO> {
  const prisma = getPrisma();
  const atual = await prisma.productionCalendarException.findUnique({ where: { id } });
  if (!atual) throw new ProductionCalendarExceptionNotFoundError();

  let funcionamento = {};
  if (entrada.operation) {
    const novo = {
      operation: entrada.operation,
      startMinuteOfDay: entrada.startMinuteOfDay ?? null,
      endMinuteOfDay: entrada.endMinuteOfDay ?? null,
      breakStartMinuteOfDay: entrada.breakStartMinuteOfDay ?? null,
      breakEndMinuteOfDay: entrada.breakEndMinuteOfDay ?? null,
    };
    const problemas = validarExcecao(novo);
    if (problemas.length > 0) throw new ProductionCalendarExceptionInvalidError(problemas);
    funcionamento = novo;
  }

  const linha = await prisma.productionCalendarException.update({
    where: { id },
    data: {
      ...(entrada.type ? { type: entrada.type } : {}),
      ...(entrada.reason !== undefined ? { reason: entrada.reason } : {}),
      ...funcionamento,
      updatedBy: actor?.name ?? null,
    },
  });
  return toExceptionDTO(linha);
}

/**
 * Remove uma exceção — a data volta a seguir a jornada do seu dia da semana.
 *
 * Programação já gravada NÃO muda por causa disto: a agenda da ordem é
 * snapshot, e recalcular é definir o início de novo (§91).
 */
export async function deleteProductionCalendarException(id: string): Promise<void> {
  const prisma = getPrisma();
  const atual = await prisma.productionCalendarException.findUnique({ where: { id } });
  if (!atual) throw new ProductionCalendarExceptionNotFoundError();
  await prisma.productionCalendarException.delete({ where: { id } });
}
