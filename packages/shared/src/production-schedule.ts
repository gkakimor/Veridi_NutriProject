import type { IndustrialResourceType } from "./industrial-resources.js";
import { FUSO_COMERCIAL, diaCivil, instanteComercial, minutoDoDiaComercial } from "./business-timezone.js";
import {
  type MomentoDaJornada,
  type ProductionCalendarConfigInput,
  janelasDoDia,
  proximoDiaOperacional,
  proximoInicioUtil,
} from "./production-calendar.js";

/**
 * AGENDA DE UMA ORDEM DE PRODUÇÃO — PLANNING-CAPACITY-BOARD-01.
 *
 * O que este arquivo faz: pega a duração que o motor do Roteiro já calculou,
 * um instante de início escolhido POR UMA PESSOA e o Calendário de Produção,
 * e projeta as etapas sobre as janelas em que a fábrica realmente trabalha.
 *
 * O que ele NÃO faz, e não deve passar a fazer sem uma decisão do Product
 * Owner: procurar sozinho o primeiro horário livre, priorizar ordens,
 * paralelizar etapas, empurrar agenda por causa de conflito. Conflito aqui é
 * AVISO — a decisão continua sendo de quem planeja.
 *
 * Duas grandezas que costumam ser confundidas, e que aqui são separadas:
 *
 * - **envelope** (`plannedStartAt` … `plannedEndAt`): de quando a etapa começa
 *   até quando ela termina, noite e fim de semana no meio inclusive;
 * - **ocupação** (`workSegments`): só os trechos efetivamente trabalhados.
 *
 * Uma etapa que começa sexta às 16:00 e termina segunda às 09:00 tem um
 * envelope de três dias e duas horas de ocupação. Contar capacidade pelo
 * envelope diria que a encapsuladora passou o fim de semana ocupada.
 */

/** Recusa de entrada de agenda — regra de negócio, nunca 500. */
export class ProductionScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionScheduleInputError";
  }
}

/** Um recurso que a etapa ocupa, congelado por valor na agenda. */
export interface AgendaRecurso {
  industrialResourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  /** Quantos deste recurso trabalham AO MESMO TEMPO na etapa. */
  resourceQuantity: number;
}

/** Um trecho efetivamente trabalhado. Nunca atravessa a meia-noite. */
export interface SegmentoDeTrabalho {
  /** Dia civil da fábrica a que o trecho pertence. */
  diaISO: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
}

export interface AgendaEtapa {
  sequence: number;
  name: string;
  durationMinutes: number;
  plannedStartAt: string;
  plannedEndAt: string;
  resources: AgendaRecurso[];
  workSegments: SegmentoDeTrabalho[];
}

export interface AgendaCalculada {
  plannedStartAt: string;
  plannedEndAt: string;
  /** Soma dos segmentos — o trabalho real, sem noite nem fim de semana. */
  workingMinutes: number;
  steps: AgendaEtapa[];
}

/** A etapa como ela chega para ser posicionada no tempo. */
export interface EtapaParaAgendar {
  sequence: number;
  name: string;
  /** Preparação + execução já resolvidas para a quantidade da ordem. */
  durationMinutes: number;
  resources: readonly AgendaRecurso[];
}

/**
 * Quantos dias à frente a projeção aceita caminhar.
 *
 * Existe para TERMINAR: um calendário com um único dia operante e uma etapa
 * longa consome muitos dias legitimamente, mas uma configuração impossível
 * não pode virar laço infinito dentro de uma requisição.
 */
const HORIZONTE_DE_DIAS = 400;

/** O instante de um momento da jornada, em ISO. */
function instanteDe(momento: MomentoDaJornada): string {
  return instanteComercial(momento.diaISO, momento.minutoDoDia).toISOString();
}

/**
 * A projeção das etapas sobre as janelas úteis.
 *
 * Sequencial por definição nesta fase: a etapa seguinte só começa quando a
 * anterior termina. Etapas paralelas exigiriam um grafo, e um grafo exige uma
 * decisão de produto que ainda não foi tomada.
 */
export function programarEtapas(entrada: {
  etapas: readonly EtapaParaAgendar[];
  inicio: MomentoDaJornada;
  calendario: ProductionCalendarConfigInput;
  excecoes?: ReadonlySet<string>;
}): AgendaCalculada {
  const excecoes = entrada.excecoes ?? new Set<string>();
  const etapas = [...entrada.etapas].sort((a, b) => a.sequence - b.sequence);
  if (etapas.length === 0) {
    throw new ProductionScheduleInputError("A ordem não tem etapas para programar.");
  }

  let cursor = proximoInicioUtil(entrada.inicio, entrada.calendario, excecoes);
  if (!cursor) {
    throw new ProductionScheduleInputError(
      "O calendário não tem nenhum dia operante a partir desta data.",
    );
  }
  const inicioDaOrdem = instanteDe(cursor);

  const passos: AgendaEtapa[] = [];
  for (const etapa of etapas) {
    const duracao = Math.round(etapa.durationMinutes);
    if (!Number.isFinite(duracao) || duracao < 0) {
      throw new ProductionScheduleInputError(
        `Etapa ${etapa.sequence}: duração inválida para programar.`,
      );
    }

    const comeco = instanteDe(cursor);
    const segmentos: SegmentoDeTrabalho[] = [];
    let restante = duracao;
    let dias = 0;

    while (restante > 0) {
      if (dias > HORIZONTE_DE_DIAS) {
        throw new ProductionScheduleInputError(
          "A programação não termina dentro de um ano — confira a jornada do calendário.",
        );
      }
      const janelas = janelasDoDia(cursor.diaISO, entrada.calendario, excecoes);
      const janela = janelas.find((atual) => cursor!.minutoDoDia < atual.fimMinuto);
      if (!janela) {
        const proximo = proximoDiaOperacional(cursor.diaISO, entrada.calendario, excecoes);
        if (!proximo) {
          throw new ProductionScheduleInputError(
            "O calendário não tem dia operante suficiente para esta ordem.",
          );
        }
        const primeira = janelasDoDia(proximo, entrada.calendario, excecoes)[0];
        if (!primeira) {
          throw new ProductionScheduleInputError(
            "O calendário não tem janela de trabalho no próximo dia operante.",
          );
        }
        cursor = { diaISO: proximo, minutoDoDia: primeira.inicioMinuto };
        dias += 1;
        continue;
      }

      const de = Math.max(cursor.minutoDoDia, janela.inicioMinuto);
      const cabe = Math.min(restante, janela.fimMinuto - de);
      if (cabe > 0) {
        segmentos.push({
          diaISO: cursor.diaISO,
          startAt: instanteDe({ diaISO: cursor.diaISO, minutoDoDia: de }),
          endAt: instanteDe({ diaISO: cursor.diaISO, minutoDoDia: de + cabe }),
          durationMinutes: cabe,
        });
        restante -= cabe;
      }
      cursor = { diaISO: cursor.diaISO, minutoDoDia: de + cabe };
      if (restante > 0) {
        // A janela acabou: o próximo início útil salta a pausa ou o dia.
        const seguinte = proximoInicioUtil(
          { diaISO: cursor.diaISO, minutoDoDia: cursor.minutoDoDia },
          entrada.calendario,
          excecoes,
        );
        if (!seguinte) {
          throw new ProductionScheduleInputError(
            "O calendário não tem dia operante suficiente para esta ordem.",
          );
        }
        if (seguinte.diaISO !== cursor.diaISO) dias += 1;
        cursor = seguinte;
      }
    }

    const fim = segmentos.length > 0 ? segmentos[segmentos.length - 1]!.endAt : comeco;
    passos.push({
      sequence: etapa.sequence,
      name: etapa.name,
      durationMinutes: duracao,
      plannedStartAt: segmentos[0]?.startAt ?? comeco,
      plannedEndAt: fim,
      resources: etapa.resources.map((recurso) => ({ ...recurso })),
      workSegments: segmentos,
    });
  }

  const ultimo = passos[passos.length - 1]!;
  return {
    plannedStartAt: passos[0]?.plannedStartAt ?? inicioDaOrdem,
    plannedEndAt: ultimo.plannedEndAt,
    workingMinutes: passos.reduce(
      (soma, passo) => soma + passo.workSegments.reduce((s, seg) => s + seg.durationMinutes, 0),
      0,
    ),
    steps: passos,
  };
}

// ───────────────────────────────────────────── início escolhido pela pessoa

export interface AvaliacaoDeInicio {
  /** O instante escolhido cai dentro de uma janela de trabalho? */
  operacional: boolean;
  /** Por que não, em português. `null` quando serve. */
  motivo: string | null;
  /** O primeiro instante que serviria. `null` quando não há nenhum. */
  sugestaoAt: string | null;
}

/**
 * O início escolhido serve?
 *
 * NUNCA desloca em silêncio (decisão de produto): responde o que há de errado
 * e qual seria o próximo horário válido. Aceitar e corrigir por baixo faria a
 * pessoa programar um turno e descobrir outro.
 */
export function avaliarInicio(
  inicioAt: Date,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
): AvaliacaoDeInicio {
  const diaISO = diaCivil(inicioAt, FUSO_COMERCIAL);
  const minuto = minutoDoDiaComercial(inicioAt);
  const janelas = janelasDoDia(diaISO, calendario, excecoes);
  const dentro = janelas.some(
    (janela) => minuto >= janela.inicioMinuto && minuto < janela.fimMinuto,
  );
  if (dentro) return { operacional: true, motivo: null, sugestaoAt: null };

  const sugestao = proximoInicioUtil({ diaISO, minutoDoDia: minuto }, calendario, excecoes);
  const motivo =
    janelas.length === 0
      ? "Este dia não é operacional no calendário de produção."
      : janelas.some((janela) => minuto >= janela.fimMinuto) &&
          janelas.some((janela) => minuto < janela.inicioMinuto)
        ? "Este horário cai no intervalo."
        : "Este horário não é operacional.";
  return {
    operacional: false,
    motivo,
    sugestaoAt: sugestao ? instanteDe(sugestao) : null,
  };
}

// ───────────────────────────────────────────────── capacidade e conflitos

/** Um trecho em que uma ordem ocupa um recurso. */
export interface OcupacaoDeRecurso {
  productionOrderId: string;
  productionOrderCode: string;
  industrialResourceId: string;
  resourceQuantity: number;
  startAt: string;
  endAt: string;
  diaISO: string;
}

/** As ocupações que uma agenda gera — uma por segmento e por recurso. */
export function ocupacoesDaAgenda(
  agenda: { steps: readonly AgendaEtapa[] },
  ordem: { productionOrderId: string; productionOrderCode: string },
): OcupacaoDeRecurso[] {
  const saida: OcupacaoDeRecurso[] = [];
  for (const etapa of agenda.steps) {
    for (const segmento of etapa.workSegments) {
      for (const recurso of etapa.resources) {
        saida.push({
          productionOrderId: ordem.productionOrderId,
          productionOrderCode: ordem.productionOrderCode,
          industrialResourceId: recurso.industrialResourceId,
          resourceQuantity: recurso.resourceQuantity,
          startAt: segmento.startAt,
          endAt: segmento.endAt,
          diaISO: segmento.diaISO,
        });
      }
    }
  }
  return saida;
}

export interface CapacidadeDoRecurso {
  industrialResourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  /** `null` = capacidade ainda não cadastrada. NUNCA leia isto como zero. */
  capacityQuantity: number | null;
  active: boolean;
}

export interface ConflitoDeCapacidade {
  industrialResourceId: string;
  resourceName: string;
  capacityQuantity: number;
  /** Quantos recursos deste tipo as ordens pedem ao mesmo tempo. */
  demanda: number;
  startAt: string;
  endAt: string;
  ordens: { productionOrderId: string; productionOrderCode: string }[];
}

/**
 * Onde a demanda simultânea passa da capacidade cadastrada.
 *
 * Varredura por fronteiras: os instantes de início e fim de cada ocupação
 * cortam a linha do tempo em trechos onde o conjunto de ordens não muda. Num
 * trecho, a demanda é a soma das quantidades — 2 operadores de uma ordem mais
 * 4 de outra são 6 ao mesmo tempo, não 2 e 4 em momentos diferentes.
 *
 * Recurso sem capacidade cadastrada NÃO entra aqui: "não sei quantos existem"
 * não é "existem zero", e marcá-lo como sobrecarga encheria a tela de alarme
 * falso. Ele vira um aviso próprio, em `avisosDeCapacidade`.
 */
export function conflitosDeCapacidade(
  ocupacoes: readonly OcupacaoDeRecurso[],
  capacidades: readonly CapacidadeDoRecurso[],
): ConflitoDeCapacidade[] {
  const porRecurso = new Map<string, OcupacaoDeRecurso[]>();
  for (const ocupacao of ocupacoes) {
    const lista = porRecurso.get(ocupacao.industrialResourceId) ?? [];
    lista.push(ocupacao);
    porRecurso.set(ocupacao.industrialResourceId, lista);
  }

  const conflitos: ConflitoDeCapacidade[] = [];
  for (const capacidade of capacidades) {
    if (capacidade.capacityQuantity === null) continue;
    const lista = porRecurso.get(capacidade.industrialResourceId) ?? [];
    if (lista.length === 0) continue;

    const fronteiras = [
      ...new Set(lista.flatMap((o) => [Date.parse(o.startAt), Date.parse(o.endAt)])),
    ].sort((a, b) => a - b);

    let aberto: ConflitoDeCapacidade | null = null;
    for (let i = 0; i < fronteiras.length - 1; i += 1) {
      const de = fronteiras[i]!;
      const ate = fronteiras[i + 1]!;
      const ativas = lista.filter((o) => Date.parse(o.startAt) <= de && Date.parse(o.endAt) >= ate);
      const demanda = ativas.reduce((soma, o) => soma + o.resourceQuantity, 0);

      if (demanda > capacidade.capacityQuantity) {
        const ordens = [
          ...new Map(
            ativas.map((o) => [
              o.productionOrderId,
              { productionOrderId: o.productionOrderId, productionOrderCode: o.productionOrderCode },
            ]),
          ).values(),
        ].sort((a, b) => a.productionOrderCode.localeCompare(b.productionOrderCode));
        // Trechos vizinhos com a MESMA demanda e as mesmas ordens são um
        // conflito só: a fronteira ali é de outra ordem, não do problema.
        if (
          aberto &&
          Date.parse(aberto.endAt) === de &&
          aberto.demanda === demanda &&
          aberto.ordens.length === ordens.length &&
          aberto.ordens.every((o, k) => o.productionOrderId === ordens[k]!.productionOrderId)
        ) {
          aberto.endAt = new Date(ate).toISOString();
        } else {
          aberto = {
            industrialResourceId: capacidade.industrialResourceId,
            resourceName: capacidade.resourceName,
            capacityQuantity: capacidade.capacityQuantity,
            demanda,
            startAt: new Date(de).toISOString(),
            endAt: new Date(ate).toISOString(),
            ordens,
          };
          conflitos.push(aberto);
        }
      } else {
        aberto = null;
      }
    }
  }
  return conflitos.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Minutos-recurso planejados por recurso e por dia civil. */
export function cargaPorRecursoEDia(
  ocupacoes: readonly OcupacaoDeRecurso[],
): Map<string, Map<string, number>> {
  const saida = new Map<string, Map<string, number>>();
  for (const ocupacao of ocupacoes) {
    const minutos = Math.round((Date.parse(ocupacao.endAt) - Date.parse(ocupacao.startAt)) / 60000);
    const porDia = saida.get(ocupacao.industrialResourceId) ?? new Map<string, number>();
    porDia.set(
      ocupacao.diaISO,
      (porDia.get(ocupacao.diaISO) ?? 0) + minutos * ocupacao.resourceQuantity,
    );
    saida.set(ocupacao.industrialResourceId, porDia);
  }
  return saida;
}

// ─────────────────────────────────────────────────────────────── avisos

export type TipoDeAvisoDeAgenda =
  | "CAPACIDADE_NAO_CADASTRADA"
  | "RECURSO_INATIVO"
  | "SOBRECARGA"
  | "SEM_ROTEIRO"
  | "SEM_DURACAO"
  | "ETAPA_SEM_RECURSO"
  | "PRAZO_DO_CLIENTE"
  | "CALENDARIO_SEM_INTERVALO";

export interface AvisoDeAgenda {
  tipo: TipoDeAvisoDeAgenda;
  texto: string;
}

export const AVISO_DE_AGENDA_LABELS: Record<TipoDeAvisoDeAgenda, string> = {
  CAPACIDADE_NAO_CADASTRADA: "Capacidade não cadastrada",
  RECURSO_INATIVO: "Recurso inativo",
  SOBRECARGA: "Sobrecarga",
  SEM_ROTEIRO: "Sem roteiro",
  SEM_DURACAO: "Sem duração prevista",
  ETAPA_SEM_RECURSO: "Etapa sem recurso",
  PRAZO_DO_CLIENTE: "Prazo do cliente em risco",
  CALENDARIO_SEM_INTERVALO: "Intervalo sem horário",
};

/**
 * Os avisos de uma agenda — tudo o que a pessoa precisa ver e nada que o
 * sistema corrija por conta própria.
 *
 * "Capacidade não cadastrada" é dito com essas palavras, e nunca como "sem
 * capacidade": a primeira é uma lacuna de cadastro, a segunda seria uma
 * afirmação sobre a fábrica.
 */
export function avisosDaAgenda(entrada: {
  agenda: AgendaCalculada;
  capacidades: readonly CapacidadeDoRecurso[];
  conflitos: readonly ConflitoDeCapacidade[];
  /** Data prometida ao cliente, quando a ordem tem uma. */
  promessaAt?: string | null;
}): AvisoDeAgenda[] {
  const avisos: AvisoDeAgenda[] = [];
  const porId = new Map(entrada.capacidades.map((c) => [c.industrialResourceId, c]));

  for (const etapa of entrada.agenda.steps) {
    if (etapa.resources.length === 0) {
      avisos.push({
        tipo: "ETAPA_SEM_RECURSO",
        texto: `Etapa ${etapa.sequence} (${etapa.name}) não ocupa nenhum recurso: ela só conta tempo.`,
      });
    }
    if (etapa.durationMinutes === 0) {
      avisos.push({
        tipo: "SEM_DURACAO",
        texto: `Etapa ${etapa.sequence} (${etapa.name}) está sem duração prevista.`,
      });
    }
  }

  const usados = new Map<string, AgendaRecurso>();
  for (const etapa of entrada.agenda.steps) {
    for (const recurso of etapa.resources) usados.set(recurso.industrialResourceId, recurso);
  }
  for (const [id, recurso] of usados) {
    const capacidade = porId.get(id);
    if (!capacidade || capacidade.capacityQuantity === null) {
      avisos.push({
        tipo: "CAPACIDADE_NAO_CADASTRADA",
        texto: `${recurso.resourceName}: capacidade não cadastrada — a sobrecarga não é conferida.`,
      });
    }
    if (capacidade && !capacidade.active) {
      avisos.push({
        tipo: "RECURSO_INATIVO",
        texto: `${recurso.resourceName} está inativo e continua ocupado por esta programação.`,
      });
    }
  }

  for (const conflito of entrada.conflitos) {
    avisos.push({
      tipo: "SOBRECARGA",
      texto: `${conflito.resourceName}: ${conflito.demanda} em uso ao mesmo tempo para uma capacidade de ${conflito.capacityQuantity}.`,
    });
  }

  if (entrada.promessaAt && entrada.agenda.plannedEndAt > entrada.promessaAt) {
    avisos.push({
      tipo: "PRAZO_DO_CLIENTE",
      texto: "Prazo do cliente em risco: o fim previsto passa da data prometida.",
    });
  }

  return avisos;
}

// ────────────────────────────────────────────────── contratos de API/tela

/** A agenda gravada de uma ordem. */
export interface ProductionOrderScheduleDTO {
  productionOrderId: string;
  productionOrderCode: string;
  plannedStartAt: string;
  plannedEndAt: string;
  workingMinutes: number;
  steps: AgendaEtapa[];
  scheduledAt: string;
  scheduledBy: string | null;
  updatedAt: string;
  notes: string | null;
}

/** O que a tela mostra ANTES de gravar — nada disto persiste. */
export interface ProductionSchedulePreviewDTO {
  schedule: AgendaCalculada;
  warnings: AvisoDeAgenda[];
  conflicts: ConflitoDeCapacidade[];
  /** A promessa ao cliente, quando a ordem tem uma rastreável. */
  customerPromiseAt: string | null;
}

export interface ProductionScheduleInput {
  /** Instante escolhido pela pessoa. Nunca deslocado em silêncio. */
  startAt: string;
  notes?: string | null;
  /**
   * Confirmação explícita exigida quando a ordem já foi liberada: mover a
   * agenda de uma ordem em separação é decisão, não ajuste.
   */
  confirmReleased?: boolean;
}

export type ProductionBoardView = "DAY" | "WEEK";

export interface ProductionBoardOrderDTO {
  productionOrderId: string;
  code: string;
  productCode: string;
  productName: string;
  plannedQuantity: string;
  outputUnitCode: string;
  status: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  workingMinutes: number | null;
  warnings: AvisoDeAgenda[];
}

export type SituacaoDoRecursoNoQuadro = "OK" | "SOBRECARGA" | "CAPACIDADE_NAO_CADASTRADA";

export interface ProductionBoardResourceDTO {
  industrialResourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  capacityQuantity: number | null;
  /** Minutos-recurso planejados no período. */
  plannedMinutes: number;
  /** Minutos-recurso disponíveis: capacidade × jornada dos dias operantes. */
  availableMinutes: number | null;
  situacao: SituacaoDoRecursoNoQuadro;
}

export interface ProductionBoardResponse {
  from: string;
  to: string;
  view: ProductionBoardView;
  /** Avisa quando o calendário ainda não permite horário exato. */
  calendarWarning: string | null;
  orders: ProductionBoardOrderDTO[];
  /** Ordens abertas do período sem programação definida. */
  unscheduled: ProductionBoardOrderDTO[];
  resources: ProductionBoardResourceDTO[];
  conflicts: ConflitoDeCapacidade[];
}
