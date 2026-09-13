import type { ProductionOrderSchedule, User } from "@prisma/client";
import type {
  AgendaCalculada,
  AgendaEtapa,
  AgendaRecurso,
  AvisoDeAgenda,
  CalendarioDeProducao,
  CapacidadeDoRecurso,
  EtapaParaAgendar,
  OcupacaoDeRecurso,
  ProductionBoardOrderDTO,
  ProductionBoardResourceDTO,
  ProductionBoardResponse,
  ProductionOrderScheduleDTO,
  ProductionSchedulePreviewDTO,
} from "@veridi/shared";
import {
  FUSO_COMERCIAL,
  ProductionCalendarInputError,
  ProductionScheduleInputError,
  avaliarInicio,
  avisosDaAgenda,
  cargaPorRecursoEDia,
  conflitosDeCapacidade,
  diaCivil,
  diaCivilDeslocado,
  fimExclusivoDoDiaComercial,
  inicioDoDiaComercial,
  isCapacityResourceType,
  minutoDoDiaComercial,
  minutosUteisDoDia,
  ocupacoesDaAgenda,
  planProductionProfileSnapshot,
  programarEtapas,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getProductionCalendarForPlanning } from "../production-calendar/production-calendar.service.js";
import { readPlanningSnapshot } from "../production-orders/planning-snapshot.js";
import {
  CalendarBreakNotPositionedError,
  CalendarNotConfiguredError,
  ProductionOrderNotFoundError,
  ProductionOrderWithoutRouteError,
  ScheduleLockedError,
  ScheduleNeedsConfirmationError,
  ScheduleNotFoundError,
  ScheduleStartNotOperationalError,
} from "./production-schedules.errors.js";
import type {
  ProductionBoardQuery,
  ScheduleProductionOrderInput,
} from "./production-schedules.schemas.js";

/**
 * PROGRAMAÇÃO DE PRODUÇÃO — PLANNING-CAPACITY-BOARD-01.
 *
 * Junta três coisas que já existiam e nunca tinham se encontrado: o Roteiro
 * (quanto trabalho existe), o Calendário (quando a fábrica trabalha) e a
 * capacidade do recurso (quantos existem). O resultado é uma resposta a
 * "quando esta ordem está prevista" e "onde há conflito".
 *
 * Três recusas deliberadas, todas de produto:
 *
 * - **não escolhe horário por você.** O início é humano; o sistema projeta.
 * - **não desloca em silêncio.** Início fora da jornada é recusado COM a
 *   sugestão do próximo horário válido, e usá-la é outra ação.
 * - **conflito não bloqueia.** Sobrecarga é AVISO: quem planeja decide se
 *   aceita, e o sistema não tem contexto para decidir por ele.
 *
 * E uma recusa técnica: sem a POSIÇÃO do intervalo no calendário não sai
 * horário exato. Inferir 12:00–13:00 seria inventar a jornada de uma fábrica
 * que ninguém consultou.
 */

const ORDEM_INCLUDE = {
  product: true,
  planningSnapshot: true,
  schedule: true,
  customerOrder: { select: { requestedDeliveryDate: true } },
} as const;

/** Situações em que a agenda ainda se define ou se move. */
const EDITAVEIS = new Set(["DRAFT", "PLANNED", "RELEASED"]);
/** Situação em que a agenda já é histórico. */
const SITUACAO_TRAVADA: Record<string, string> = {
  IN_PRODUCTION: "em produção",
  COMPLETED: "concluída",
  CANCELLED: "cancelada",
  BLOCKED: "bloqueada",
};

/**
 * A jornada semanal gravada e as exceções, ou a recusa de quem nunca
 * configurou o calendário.
 *
 * Dia com intervalo sem horário recusa ANTES de projetar, mesmo que a ordem
 * não chegue a ele: uma agenda que sai ou não conforme a duração alcança a
 * terça seria uma resposta que muda sem ninguém entender por quê.
 */
async function jornadaConfigurada(): Promise<CalendarioDeProducao> {
  const { dto, calendario } = await getProductionCalendarForPlanning();
  if (!dto.configured) throw new CalendarNotConfiguredError();
  if (dto.breakPositionWarning) throw new CalendarBreakNotPositionedError(dto.breakPositionWarning);
  return calendario;
}

/** As capacidades cadastradas, por recurso. Energia fica de fora. */
async function capacidadesDeCapacidade(): Promise<CapacidadeDoRecurso[]> {
  const recursos = await getPrisma().industrialResource.findMany({
    orderBy: { name: "asc" },
  });
  return recursos
    .filter((recurso) => isCapacityResourceType(recurso.type))
    .map((recurso) => ({
      industrialResourceId: recurso.id,
      resourceCode: recurso.code,
      resourceName: recurso.name,
      resourceType: recurso.type,
      capacityQuantity: recurso.capacityQuantity,
      active: recurso.active,
    }));
}

/** As etapas da ordem, já com a duração da quantidade dela. */
function etapasDaOrdem(ordem: {
  code: string;
  plannedQuantity: { toString(): string };
  planningSnapshot: { steps: unknown } | null;
}): EtapaParaAgendar[] {
  if (!ordem.planningSnapshot) throw new ProductionOrderWithoutRouteError(ordem.code);
  const snapshot = readPlanningSnapshot(
    ordem.planningSnapshot as Parameters<typeof readPlanningSnapshot>[0],
  );
  // O MESMO motor da tela do Roteiro e do Planejamento previsto. Duração de
  // OP não tem um segundo cálculo neste repositório.
  const plano = planProductionProfileSnapshot(snapshot, ordem.plannedQuantity.toString());
  const porSequencia = new Map(snapshot.steps.map((etapa) => [etapa.sequence, etapa]));
  return plano.steps.map((etapa) => {
    const origem = porSequencia.get(etapa.sequence);
    const recursos: AgendaRecurso[] = (origem?.resources ?? []).map((recurso) => ({
      industrialResourceId: recurso.industrialResourceId,
      resourceCode: recurso.resourceCode,
      resourceName: recurso.resourceName,
      resourceType: recurso.resourceType,
      resourceQuantity: recurso.resourceQuantity,
    }));
    return {
      sequence: etapa.sequence,
      name: etapa.name,
      durationMinutes: Number(etapa.durationMinutes),
      resources: recursos,
    };
  });
}

/** As ocupações de todas as agendas gravadas, menos a da ordem em foco. */
async function ocupacoesGravadas(exceto?: string): Promise<OcupacaoDeRecurso[]> {
  const linhas = await getPrisma().productionOrderSchedule.findMany({
    include: { productionOrder: { select: { code: true, status: true } } },
  });
  return linhas
    .filter((linha) => linha.productionOrderId !== exceto)
    // Ordem cancelada não disputa recurso com ninguém.
    .filter((linha) => linha.productionOrder.status !== "CANCELLED")
    .flatMap((linha) =>
      ocupacoesDaAgenda(
        { steps: linha.steps as unknown as AgendaEtapa[] },
        {
          productionOrderId: linha.productionOrderId,
          productionOrderCode: linha.productionOrder.code,
        },
      ),
    );
}

/** Traduz a recusa do motor compartilhado para o erro de domínio da API. */
function comoRecusaDeDominio(erro: unknown): never {
  if (erro instanceof ProductionCalendarInputError) {
    throw new CalendarBreakNotPositionedError(erro.message);
  }
  if (erro instanceof ProductionScheduleInputError) {
    throw new ProductionScheduleInputError(erro.message);
  }
  throw erro;
}

/**
 * A projeção de uma ordem para um início — sem gravar nada.
 *
 * É esta função que a tela chama antes de confirmar: a pessoa vê início, fim,
 * tempo útil, etapas, recursos e avisos ANTES de decidir.
 */
export async function previewProductionOrderSchedule(
  orderId: string,
  startAtISO: string,
): Promise<ProductionSchedulePreviewDTO> {
  const prisma = getPrisma();
  const ordem = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: ORDEM_INCLUDE,
  });
  if (!ordem) throw new ProductionOrderNotFoundError(orderId);

  const calendario = await jornadaConfigurada();
  const inicio = new Date(startAtISO);

  let avaliacao: ReturnType<typeof avaliarInicio>;
  try {
    avaliacao = avaliarInicio(inicio, calendario);
  } catch (erro) {
    comoRecusaDeDominio(erro);
  }
  if (!avaliacao.operacional) {
    throw new ScheduleStartNotOperationalError(avaliacao.motivo!, avaliacao.sugestaoAt);
  }

  const etapas = etapasDaOrdem(ordem);
  let agenda: AgendaCalculada;
  try {
    agenda = programarEtapas({
      etapas,
      inicio: {
        diaISO: diaCivil(inicio, FUSO_COMERCIAL),
        minutoDoDia: minutoDoDiaComercial(inicio),
      },
      calendario,
    });
  } catch (erro) {
    comoRecusaDeDominio(erro);
  }

  const capacidades = await capacidadesDeCapacidade();
  const outras = await ocupacoesGravadas(orderId);
  const minhas = ocupacoesDaAgenda(agenda, {
    productionOrderId: ordem.id,
    productionOrderCode: ordem.code,
  });
  const conflitos = conflitosDeCapacidade([...outras, ...minhas], capacidades).filter((conflito) =>
    conflito.ordens.some((o) => o.productionOrderId === ordem.id),
  );

  const promessa = ordem.customerOrder?.requestedDeliveryDate ?? null;
  return {
    schedule: agenda,
    conflicts: conflitos,
    warnings: avisosDaAgenda({
      agenda,
      capacidades,
      conflitos,
      promessaAt: promessa ? promessa.toISOString() : null,
    }),
    customerPromiseAt: promessa ? promessa.toISOString() : null,
  };
}

function toScheduleDTO(
  linha: ProductionOrderSchedule,
  code: string,
): ProductionOrderScheduleDTO {
  return {
    productionOrderId: linha.productionOrderId,
    productionOrderCode: code,
    plannedStartAt: linha.plannedStartAt.toISOString(),
    plannedEndAt: linha.plannedEndAt.toISOString(),
    workingMinutes: linha.workingMinutes,
    steps: linha.steps as unknown as AgendaEtapa[],
    scheduledAt: linha.scheduledAt.toISOString(),
    scheduledBy: linha.scheduledBy,
    updatedAt: linha.updatedAt.toISOString(),
    notes: linha.notes,
  };
}

/** A agenda gravada de uma ordem, quando existe. */
export async function getProductionOrderSchedule(
  orderId: string,
): Promise<ProductionOrderScheduleDTO | null> {
  const ordem = await getPrisma().productionOrder.findUnique({
    where: { id: orderId },
    include: { schedule: true },
  });
  if (!ordem) throw new ProductionOrderNotFoundError(orderId);
  return ordem.schedule ? toScheduleDTO(ordem.schedule, ordem.code) : null;
}

/**
 * Grava (ou move) a programação.
 *
 * O ciclo de vida manda: rascunho e planejada se movem à vontade; LIBERADA
 * exige confirmação explícita, porque já há separação em curso do outro lado;
 * em produção, concluída, cancelada e bloqueada a agenda é histórico.
 */
export async function scheduleProductionOrder(
  orderId: string,
  entrada: ScheduleProductionOrderInput,
  actor: User | null,
): Promise<ProductionOrderScheduleDTO> {
  const prisma = getPrisma();
  const ordem = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: ORDEM_INCLUDE,
  });
  if (!ordem) throw new ProductionOrderNotFoundError(orderId);

  if (!EDITAVEIS.has(ordem.status)) {
    throw new ScheduleLockedError(ordem.code, SITUACAO_TRAVADA[ordem.status] ?? ordem.status);
  }
  if (ordem.status === "RELEASED" && entrada.confirmReleased !== true) {
    throw new ScheduleNeedsConfirmationError(ordem.code);
  }

  const previa = await previewProductionOrderSchedule(orderId, entrada.startAt);
  const dados = {
    plannedStartAt: new Date(previa.schedule.plannedStartAt),
    plannedEndAt: new Date(previa.schedule.plannedEndAt),
    workingMinutes: previa.schedule.workingMinutes,
    steps: previa.schedule.steps as unknown as object,
    notes: entrada.notes ?? null,
    scheduledBy: actor?.name ?? null,
  };

  const linha = await prisma.productionOrderSchedule.upsert({
    where: { productionOrderId: orderId },
    create: { productionOrderId: orderId, ...dados },
    // Reprogramar carimba de novo: quem olhar a agenda depois precisa saber
    // quando ela passou a ser esta.
    update: { ...dados, scheduledAt: new Date() },
  });
  return toScheduleDTO(linha, ordem.code);
}

/** Tira a programação. A ordem continua existindo, sem previsão. */
export async function unscheduleProductionOrder(orderId: string): Promise<void> {
  const prisma = getPrisma();
  const ordem = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { schedule: true },
  });
  if (!ordem) throw new ProductionOrderNotFoundError(orderId);
  if (!ordem.schedule) throw new ScheduleNotFoundError(ordem.code);
  if (!EDITAVEIS.has(ordem.status)) {
    throw new ScheduleLockedError(ordem.code, SITUACAO_TRAVADA[ordem.status] ?? ordem.status);
  }
  await prisma.productionOrderSchedule.delete({ where: { productionOrderId: orderId } });
}

// ──────────────────────────────────────────────────────────── o quadro

/** Os dias civis de um recorte, fim inclusivo. */
function diasDoPeriodo(from: string, to: string): string[] {
  const dias: string[] = [];
  let atual = from;
  for (let passo = 0; passo <= 370 && atual <= to; passo += 1) {
    dias.push(atual);
    atual = diaCivilDeslocado(atual, 1);
  }
  return dias;
}

/**
 * O quadro do período: ordens programadas, ordens sem programação, carga por
 * recurso e os conflitos.
 *
 * O calendário sem posição de intervalo NÃO derruba a tela: ela mostra o que
 * já está gravado e diz, numa frase, o que falta para programar horários
 * novos. Quem lê o quadro não é necessariamente quem configura a jornada.
 */
export async function getProductionBoard(
  query: ProductionBoardQuery,
): Promise<ProductionBoardResponse> {
  const prisma = getPrisma();
  const inicio = inicioDoDiaComercial(query.from);
  const fim = fimExclusivoDoDiaComercial(query.to);

  const { dto, calendario } = await getProductionCalendarForPlanning();

  const filtroDeOrdem = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
  };

  const agendadas = await prisma.productionOrderSchedule.findMany({
    where: {
      // Envelope que ENCOSTA no período: uma ordem que começa antes e termina
      // dentro pertence ao quadro tanto quanto a que nasce nele.
      plannedStartAt: { lt: fim },
      plannedEndAt: { gte: inicio },
      productionOrder: filtroDeOrdem,
    },
    include: { productionOrder: { include: { product: true } } },
    orderBy: { plannedStartAt: "asc" },
  });

  const capacidades = await capacidadesDeCapacidade();

  const ocupacoes = agendadas
    .filter((linha) => linha.productionOrder.status !== "CANCELLED")
    .flatMap((linha) =>
      ocupacoesDaAgenda(
        { steps: linha.steps as unknown as AgendaEtapa[] },
        {
          productionOrderId: linha.productionOrderId,
          productionOrderCode: linha.productionOrder.code,
        },
      ),
    );
  const conflitos = conflitosDeCapacidade(ocupacoes, capacidades);

  const ordens: ProductionBoardOrderDTO[] = agendadas
    .filter((linha) => {
      if (!query.industrialResourceId) return true;
      const etapas = linha.steps as unknown as AgendaEtapa[];
      return etapas.some((etapa) =>
        etapa.resources.some((r) => r.industrialResourceId === query.industrialResourceId),
      );
    })
    .map((linha) => {
      const agenda: AgendaCalculada = {
        plannedStartAt: linha.plannedStartAt.toISOString(),
        plannedEndAt: linha.plannedEndAt.toISOString(),
        workingMinutes: linha.workingMinutes,
        steps: linha.steps as unknown as AgendaEtapa[],
      };
      const meus = conflitos.filter((conflito) =>
        conflito.ordens.some((o) => o.productionOrderId === linha.productionOrderId),
      );
      const avisos: AvisoDeAgenda[] = avisosDaAgenda({
        agenda,
        capacidades,
        conflitos: meus,
      });
      return {
        productionOrderId: linha.productionOrderId,
        code: linha.productionOrder.code,
        productCode: linha.productionOrder.product.code,
        productName: linha.productionOrder.product.name,
        plannedQuantity: linha.productionOrder.plannedQuantity.toString(),
        outputUnitCode: linha.productionOrder.outputUnitCode,
        status: linha.productionOrder.status,
        plannedStartAt: agenda.plannedStartAt,
        plannedEndAt: agenda.plannedEndAt,
        workingMinutes: agenda.workingMinutes,
        warnings: avisos,
      };
    });

  /*
   * Sem programação: ordens ABERTAS que ainda não têm agenda. Elas não têm
   * data para cair num dia do quadro — aparecem numa faixa própria, que é
   * justamente a lista de quem falta programar.
   */
  const semAgenda = await prisma.productionOrder.findMany({
    where: {
      schedule: { is: null },
      status: { in: ["DRAFT", "PLANNED", "RELEASED"] },
      ...filtroDeOrdem,
    },
    include: { product: true, planningSnapshot: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unscheduled: ProductionBoardOrderDTO[] = semAgenda.map((ordem) => ({
    productionOrderId: ordem.id,
    code: ordem.code,
    productCode: ordem.product.code,
    productName: ordem.product.name,
    plannedQuantity: ordem.plannedQuantity.toString(),
    outputUnitCode: ordem.outputUnitCode,
    status: ordem.status,
    plannedStartAt: null,
    plannedEndAt: null,
    workingMinutes: null,
    warnings: ordem.planningSnapshot
      ? []
      : [
          {
            tipo: "SEM_ROTEIRO" as const,
            texto: `${ordem.code} não tem roteiro de produção aplicado: sem etapas não há o que programar.`,
          },
        ],
  }));

  // Minutos-recurso disponíveis no período: capacidade × a jornada DE CADA DIA
  // — sexta curta rende menos que quinta, e horário especial conta o que ele
  // declara. Só faz sentido onde a capacidade está cadastrada.
  const dias = diasDoPeriodo(query.from, query.to);
  const minutosOperantes = dias.reduce((soma, dia) => soma + minutosUteisDoDia(dia, calendario), 0);
  const carga = cargaPorRecursoEDia(ocupacoes);

  const recursos: ProductionBoardResourceDTO[] = capacidades
    .filter((capacidade) => !query.industrialResourceId || capacidade.industrialResourceId === query.industrialResourceId)
    .map((capacidade) => {
      const porDia = carga.get(capacidade.industrialResourceId);
      const planejado = dias.reduce((soma, dia) => soma + (porDia?.get(dia) ?? 0), 0);
      const temConflito = conflitos.some(
        (conflito) => conflito.industrialResourceId === capacidade.industrialResourceId,
      );
      return {
        industrialResourceId: capacidade.industrialResourceId,
        resourceCode: capacidade.resourceCode,
        resourceName: capacidade.resourceName,
        resourceType: capacidade.resourceType,
        capacityQuantity: capacidade.capacityQuantity,
        plannedMinutes: planejado,
        availableMinutes:
          capacidade.capacityQuantity === null
            ? null
            : capacidade.capacityQuantity * minutosOperantes,
        situacao:
          capacidade.capacityQuantity === null
            ? ("CAPACIDADE_NAO_CADASTRADA" as const)
            : temConflito
              ? ("SOBRECARGA" as const)
              : ("OK" as const),
      };
    })
    .filter((recurso) => recurso.plannedMinutes > 0 || recurso.capacityQuantity !== null);

  return {
    from: query.from,
    to: query.to,
    view: query.view,
    calendarWarning: dto.configured
      ? dto.breakPositionWarning
      : "O calendário de produção ainda não foi configurado.",
    orders: ordens,
    unscheduled,
    resources: recursos,
    conflicts: conflitos,
  };
}
