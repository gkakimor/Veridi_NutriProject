import { describe, expect, it } from "vitest";
import type {
  AgendaCalculada,
  CalendarioDeProducao,
  DiaDaSemana,
  ExcecaoDoCalendario,
  JornadaDaSemana,
} from "./index.js";
import {
  DIAS_DA_SEMANA,
  ProductionCalendarInputError,
  avaliarInicio,
  avisosDaAgenda,
  cargaPorRecursoEDia,
  conflitosDeCapacidade,
  instanteComercial,
  janelasDoDia,
  montarCalendario,
  ocupacoesDaAgenda,
  programarEtapas,
} from "./index.js";

/**
 * A AGENDA DE UMA ORDEM — PLANNING-CAPACITY-BOARD-01, sobre a jornada semanal
 * do PLANNING-CALENDAR-WEEKLY-SCHEDULE-01.
 *
 * O que estes testes protegem, e que nenhuma revisão de código pega sozinha:
 *
 * 1. **cada dia trabalha a SUA jornada.** Uma etapa que sai da quinta longa
 *    passa pela sexta curta, pelo sábado curto, pula o domingo fechado — e o
 *    `workSegments` diz exatamente isso, trecho por trecho;
 * 2. **a exceção da data vence a semana.** Terça com horário especial até
 *    12:00 não trabalha a tarde; domingo com horário especial trabalha;
 * 3. **o intervalo tem horário, ou não há hora exata.** Sem a posição da
 *    pausa, projetar é escolher entre contar o almoço como produção e inventar
 *    12:00–13:00. As duas estão erradas, e a função recusa;
 * 4. **envelope não é ocupação.** Uma etapa que atravessa a noite, o fim de
 *    semana ou um feriado NÃO ocupa recurso nesse meio-tempo;
 * 5. **capacidade desconhecida não é capacidade zero.**
 */

const aberto = (
  weekday: DiaDaSemana,
  inicio: number,
  fim: number,
  pausa: [number, number] | null = null,
): JornadaDaSemana => ({
  weekday,
  enabled: true,
  startMinuteOfDay: inicio,
  endMinuteOfDay: fim,
  breakStartMinuteOfDay: pausa ? pausa[0] : null,
  breakEndMinuteOfDay: pausa ? pausa[1] : null,
  unpositionedBreakMinutes: null,
});

const fechado = (weekday: DiaDaSemana): JornadaDaSemana => ({
  weekday,
  enabled: false,
  startMinuteOfDay: null,
  endMinuteOfDay: null,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
  unpositionedBreakMinutes: null,
});

const ALMOCO: [number, number] = [720, 780];

/** Segunda a sexta 08:00–17:00 com almoço das 12:00 às 13:00 — 480 min úteis. */
const SEG_A_SEX = DIAS_DA_SEMANA.map((dia) =>
  dia === "SATURDAY" || dia === "SUNDAY" ? fechado(dia) : aberto(dia, 480, 1020, ALMOCO),
);

/** A semana real da Veridi: seg–qui longa, sex e sáb até 12:00, domingo fechado. */
const SEMANA_VERIDI = DIAS_DA_SEMANA.map((dia) => {
  if (dia === "SUNDAY") return fechado(dia);
  if (dia === "FRIDAY" || dia === "SATURDAY") return aberto(dia, 480, 720);
  return aberto(dia, 480, 1020, ALMOCO);
});

const JORNADA = montarCalendario(SEG_A_SEX);
const VERIDI = montarCalendario(SEMANA_VERIDI);

/** A jornada de antes da posição do intervalo: duração da pausa, sem horário. */
const SEM_POSICAO = montarCalendario(
  SEG_A_SEX.map((dia) =>
    dia.enabled
      ? { ...dia, breakStartMinuteOfDay: null, breakEndMinuteOfDay: null, unpositionedBreakMinutes: 60 }
      : dia,
  ),
);

const semOperacao = (date: string): ExcecaoDoCalendario => ({
  date,
  operation: "SEM_OPERACAO",
  startMinuteOfDay: null,
  endMinuteOfDay: null,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
});

const horarioEspecial = (date: string, inicio: number, fim: number): ExcecaoDoCalendario => ({
  date,
  operation: "HORARIO_ESPECIAL",
  startMinuteOfDay: inicio,
  endMinuteOfDay: fim,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
});

const comExcecoes = (semana: readonly JornadaDaSemana[], ...excecoes: ExcecaoDoCalendario[]) =>
  montarCalendario(semana, excecoes);

const operador = (quantidade: number) => ({
  industrialResourceId: "op",
  resourceCode: "RIN-op",
  resourceName: "Mão de obra — Produção",
  resourceType: "LABOR" as const,
  resourceQuantity: quantidade,
});

const etapa = (sequence: number, name: string, durationMinutes: number, quantidade = 1) => ({
  sequence,
  name,
  durationMinutes,
  resources: [operador(quantidade)],
});

/** `2026-09-14` é segunda-feira. */
const SEGUNDA = "2026-09-14";
const TERCA = "2026-09-15";
const QUARTA = "2026-09-16";
const QUINTA = "2026-09-17";
const SEXTA = "2026-09-18";
const SABADO = "2026-09-19";
const DOMINGO = "2026-09-20";
const SEGUNDA_SEGUINTE = "2026-09-21";

const em = (diaISO: string, hora: number, minuto = 0) =>
  instanteComercial(diaISO, hora * 60 + minuto).toISOString();

const trecho = (diaISO: string, de: number, ate: number) => ({
  diaISO,
  startAt: em(diaISO, Math.floor(de / 60), de % 60),
  endAt: em(diaISO, Math.floor(ate / 60), ate % 60),
  durationMinutes: ate - de,
});

function programar(
  etapas: Parameters<typeof programarEtapas>[0]["etapas"],
  inicio: { diaISO: string; minutoDoDia: number },
  calendario: CalendarioDeProducao = JORNADA,
): AgendaCalculada {
  return programarEtapas({ etapas, inicio, calendario });
}

describe("janelas do dia", () => {
  it("a jornada com almoço posicionado vira DUAS janelas de trabalho", () => {
    expect(janelasDoDia(SEGUNDA, JORNADA)).toEqual([
      { inicioMinuto: 480, fimMinuto: 720 },
      { inicioMinuto: 780, fimMinuto: 1020 },
    ]);
  });

  it("dia não operante não tem janela nenhuma — e não uma janela de zero", () => {
    expect(janelasDoDia(SABADO, JORNADA)).toEqual([]);
    expect(janelasDoDia(SEGUNDA, comExcecoes(SEG_A_SEX, semOperacao(SEGUNDA)))).toEqual([]);
  });

  it("intervalo sem horário RECUSA em vez de chutar a posição", () => {
    expect(() => janelasDoDia(SEGUNDA, SEM_POSICAO)).toThrowError(ProductionCalendarInputError);
    expect(() => janelasDoDia(SEGUNDA, SEM_POSICAO)).toThrowError(
      "Defina o horário do intervalo de Segunda-feira antes de calcular horários de produção.",
    );
  });

  it("sem intervalo nenhum, o dia é uma janela só", () => {
    expect(janelasDoDia(SEXTA, VERIDI)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
  });
});

describe("início escolhido pela pessoa", () => {
  it("dentro da jornada serve", () => {
    const avaliacao = avaliarInicio(new Date(em(SEGUNDA, 9)), JORNADA);
    expect(avaliacao.operacional).toBe(true);
    expect(avaliacao.sugestaoAt).toBeNull();
  });

  it("domingo é recusado COM o próximo horário, e nunca deslocado em silêncio", () => {
    const avaliacao = avaliarInicio(new Date(em(DOMINGO, 9)), JORNADA);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.motivo).toBe("Este dia não é operacional no calendário de produção.");
    expect(avaliacao.sugestaoAt).toBe(em(SEGUNDA_SEGUINTE, 8));
  });

  it("feriado também, e a sugestão pula para o dia seguinte que opera", () => {
    const avaliacao = avaliarInicio(new Date(em(TERCA, 9)), comExcecoes(SEG_A_SEX, semOperacao(TERCA)));
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.sugestaoAt).toBe(em(QUARTA, 8));
  });

  it("dentro do almoço é recusado e a sugestão é o fim da pausa", () => {
    const avaliacao = avaliarInicio(new Date(em(SEGUNDA, 12, 30)), JORNADA);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.motivo).toBe("Este horário cai no intervalo.");
    expect(avaliacao.sugestaoAt).toBe(em(SEGUNDA, 13));
  });

  it("antes de abrir é recusado e a sugestão é a abertura do mesmo dia", () => {
    const avaliacao = avaliarInicio(new Date(em(SEGUNDA, 6)), JORNADA);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.sugestaoAt).toBe(em(SEGUNDA, 8));
  });

  it("sexta à tarde na Veridi é recusada: a sexta fecha às 12:00, e a sugestão é o sábado", () => {
    const avaliacao = avaliarInicio(new Date(em(SEXTA, 14)), VERIDI);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.sugestaoAt).toBe(em(SABADO, 8));
  });

  it("domingo com horário especial serve", () => {
    const calendario = comExcecoes(SEMANA_VERIDI, horarioEspecial(DOMINGO, 480, 720));
    expect(avaliarInicio(new Date(em(DOMINGO, 9)), calendario).operacional).toBe(true);
  });
});

describe("projeção das etapas", () => {
  it("etapa curta cabe na manhã, sem tocar no almoço", () => {
    const agenda = programar([etapa(1, "Pesagem", 120)], { diaISO: SEGUNDA, minutoDoDia: 480 });
    expect(agenda.plannedStartAt).toBe(em(SEGUNDA, 8));
    expect(agenda.plannedEndAt).toBe(em(SEGUNDA, 10));
    expect(agenda.workingMinutes).toBe(120);
    expect(agenda.steps[0]!.workSegments).toHaveLength(1);
  });

  it("etapa que atravessa o almoço trabalha em DOIS trechos, e a pausa não conta", () => {
    // 11:00 + 3 h de trabalho: 11:00–12:00, almoço, 13:00–15:00.
    const agenda = programar([etapa(1, "Mistura", 180)], { diaISO: SEGUNDA, minutoDoDia: 660 });
    const passo = agenda.steps[0]!;
    expect(passo.plannedStartAt).toBe(em(SEGUNDA, 11));
    expect(passo.plannedEndAt).toBe(em(SEGUNDA, 15));
    expect(passo.workSegments).toEqual([trecho(SEGUNDA, 660, 720), trecho(SEGUNDA, 780, 900)]);
    // O envelope tem 4 h; o trabalho, 3 h. A hora do almoço não é ocupação.
    expect(agenda.workingMinutes).toBe(180);
  });

  it("etapa que passa do fim do dia continua na abertura do dia seguinte", () => {
    // 16:00 + 2 h: 16:00–17:00 e 08:00–09:00 do dia seguinte.
    const agenda = programar([etapa(1, "Encapsulamento", 120)], {
      diaISO: SEGUNDA,
      minutoDoDia: 960,
    });
    expect(agenda.steps[0]!.workSegments).toEqual([
      trecho(SEGUNDA, 960, 1020),
      trecho(TERCA, 480, 540),
    ]);
  });

  it("sexta 16:00 continua na segunda — e o fim de semana NÃO é ocupação", () => {
    const agenda = programar([etapa(1, "Embalagem", 120)], { diaISO: SEXTA, minutoDoDia: 960 });
    expect(agenda.plannedStartAt).toBe(em(SEXTA, 16));
    expect(agenda.plannedEndAt).toBe(em(SEGUNDA_SEGUINTE, 9));
    const dias = agenda.steps[0]!.workSegments.map((s) => s.diaISO);
    expect(dias).toEqual([SEXTA, SEGUNDA_SEGUINTE]);
    expect(agenda.workingMinutes).toBe(120);
  });

  it("feriado sem operação no meio é pulado, e o dia da exceção fica sem segmento", () => {
    const agenda = programar(
      [etapa(1, "Mistura", 120)],
      { diaISO: SEGUNDA, minutoDoDia: 960 },
      comExcecoes(SEG_A_SEX, semOperacao(TERCA)),
    );
    const dias = agenda.steps[0]!.workSegments.map((s) => s.diaISO);
    expect(dias).toEqual([SEGUNDA, QUARTA]);
  });

  it("etapas acontecem em ordem, uma depois da outra", () => {
    const agenda = programar(
      [etapa(1, "Pesagem", 60), etapa(2, "Mistura", 60), etapa(3, "Embalagem", 60)],
      { diaISO: SEGUNDA, minutoDoDia: 480 },
    );
    expect(agenda.steps.map((p) => p.plannedStartAt)).toEqual([
      em(SEGUNDA, 8),
      em(SEGUNDA, 9),
      em(SEGUNDA, 10),
    ]);
    expect(agenda.plannedEndAt).toBe(em(SEGUNDA, 11));
  });

  it("calendário sem posição de intervalo não produz agenda nenhuma", () => {
    expect(() =>
      programar([etapa(1, "Mistura", 60)], { diaISO: SEGUNDA, minutoDoDia: 480 }, SEM_POSICAO),
    ).toThrowError(/Defina o horário do intervalo/);
  });
});

describe("jornadas diferentes na mesma semana", () => {
  it("CASO CRÍTICO: quinta 16:00 → sexta curta → sábado curto → domingo fechado → segunda", () => {
    /*
     * 15 h de trabalho a partir da quinta às 16:00, na semana da Veridi:
     * quinta 16–17 (60), sexta 08–12 (240), sábado 08–12 (240), domingo
     * nada, segunda 08–12 (240) e 13–15 (120). Cada dia com a SUA jornada.
     */
    const agenda = programar(
      [etapa(1, "Encapsulamento", 900)],
      { diaISO: QUINTA, minutoDoDia: 960 },
      VERIDI,
    );
    const passo = agenda.steps[0]!;
    expect(passo.workSegments).toEqual([
      trecho(QUINTA, 960, 1020),
      trecho(SEXTA, 480, 720),
      trecho(SABADO, 480, 720),
      trecho(SEGUNDA_SEGUINTE, 480, 720),
      trecho(SEGUNDA_SEGUINTE, 780, 900),
    ]);
    // Nem a tarde da sexta, nem a do sábado, nem o domingo viram trabalho.
    expect(passo.workSegments.map((s) => s.diaISO)).not.toContain(DOMINGO);
    expect(passo.workSegments.some((s) => s.diaISO === SEXTA && s.endAt > em(SEXTA, 12))).toBe(false);
    expect(agenda.plannedStartAt).toBe(em(QUINTA, 16));
    expect(agenda.plannedEndAt).toBe(em(SEGUNDA_SEGUINTE, 15));
    expect(agenda.workingMinutes).toBe(900);
  });

  it("a etapa seguinte começa onde a anterior terminou, na jornada daquele dia", () => {
    // Pesagem termina sexta 12:00 (fechamento); Mistura começa no sábado 08:00.
    const agenda = programar(
      [etapa(1, "Pesagem", 300), etapa(2, "Mistura", 60)],
      { diaISO: QUINTA, minutoDoDia: 960 },
      VERIDI,
    );
    expect(agenda.steps[0]!.plannedEndAt).toBe(em(SEXTA, 12));
    expect(agenda.steps[1]!.workSegments).toEqual([trecho(SABADO, 480, 540)]);
  });
});

describe("exceção com horário especial na agenda", () => {
  it("terça com horário especial até 12:00: a etapa NÃO trabalha a tarde e segue no próximo dia", () => {
    // Terça normal é 08–17; nesta data, só 08–12. 10:00 + 3 h de trabalho.
    const calendario = comExcecoes(SEG_A_SEX, horarioEspecial(TERCA, 480, 720));
    const agenda = programar([etapa(1, "Mistura", 180)], { diaISO: TERCA, minutoDoDia: 600 }, calendario);
    expect(agenda.steps[0]!.workSegments).toEqual([
      trecho(TERCA, 600, 720),
      trecho(QUARTA, 480, 540),
    ]);
    expect(
      agenda.steps[0]!.workSegments.some((s) => s.diaISO === TERCA && s.endAt > em(TERCA, 12)),
    ).toBe(false);
  });

  it("sábado fechado com horário especial numa data trabalha naquela data", () => {
    // Sexta 16:00 + 3 h no calendário seg–sex: sexta 16–17, SÁBADO 08–10 (exceção).
    const calendario = comExcecoes(SEG_A_SEX, horarioEspecial(SABADO, 480, 720));
    const agenda = programar([etapa(1, "Embalagem", 180)], { diaISO: SEXTA, minutoDoDia: 960 }, calendario);
    expect(agenda.steps[0]!.workSegments).toEqual([
      trecho(SEXTA, 960, 1020),
      trecho(SABADO, 480, 600),
    ]);
  });

  it("exceção sem operação fecha a data mesmo na semana da Veridi", () => {
    const calendario = comExcecoes(SEMANA_VERIDI, semOperacao(SABADO));
    const agenda = programar([etapa(1, "Embalagem", 300)], { diaISO: SEXTA, minutoDoDia: 480 }, calendario);
    expect(agenda.steps[0]!.workSegments).toEqual([
      trecho(SEXTA, 480, 720),
      trecho(SEGUNDA_SEGUINTE, 480, 540),
    ]);
  });
});

describe("capacidade e conflito", () => {
  const capacidade = (quantidade: number | null) => [
    {
      industrialResourceId: "op",
      resourceCode: "RIN-op",
      resourceName: "Mão de obra — Produção",
      resourceType: "LABOR" as const,
      capacityQuantity: quantidade,
      active: true,
    },
  ];

  const ocupacoesDe = (agenda: AgendaCalculada, id: string, code: string) =>
    ocupacoesDaAgenda(agenda, { productionOrderId: id, productionOrderCode: code });

  it("duas ordens em horários diferentes não conflitam", () => {
    const manha = programar([etapa(1, "Mistura", 120, 2)], { diaISO: SEGUNDA, minutoDoDia: 480 });
    const tarde = programar([etapa(1, "Mistura", 120, 2)], { diaISO: SEGUNDA, minutoDoDia: 840 });
    const conflitos = conflitosDeCapacidade(
      [...ocupacoesDe(manha, "a", "OP-1"), ...ocupacoesDe(tarde, "b", "OP-2")],
      capacidade(2),
    );
    expect(conflitos).toEqual([]);
  });

  it("duas ordens sobrepostas somam a demanda e passam da capacidade", () => {
    const uma = programar([etapa(1, "Mistura", 120, 2)], { diaISO: SEGUNDA, minutoDoDia: 480 });
    const outra = programar([etapa(1, "Mistura", 120, 2)], { diaISO: SEGUNDA, minutoDoDia: 540 });
    const conflitos = conflitosDeCapacidade(
      [...ocupacoesDe(uma, "a", "OP-1"), ...ocupacoesDe(outra, "b", "OP-2")],
      capacidade(3),
    );
    expect(conflitos).toHaveLength(1);
    expect(conflitos[0]).toMatchObject({
      demanda: 4,
      capacityQuantity: 3,
      startAt: em(SEGUNDA, 9),
      endAt: em(SEGUNDA, 10),
    });
    expect(conflitos[0]!.ordens.map((o) => o.productionOrderCode)).toEqual(["OP-1", "OP-2"]);
  });

  it("o fim de semana entre duas ordens NÃO cria conflito", () => {
    // Uma trabalha sexta à tarde e segunda de manhã; a outra, segunda às 10:00.
    // Se o conflito olhasse o envelope, elas se cruzariam.
    const atravessa = programar([etapa(1, "Embalagem", 120, 2)], {
      diaISO: SEXTA,
      minutoDoDia: 960,
    });
    const segundaCedo = programar([etapa(1, "Pesagem", 60, 2)], {
      diaISO: SEGUNDA_SEGUINTE,
      minutoDoDia: 600,
    });
    const conflitos = conflitosDeCapacidade(
      [...ocupacoesDe(atravessa, "a", "OP-1"), ...ocupacoesDe(segundaCedo, "b", "OP-2")],
      capacidade(2),
    );
    expect(conflitos).toEqual([]);
  });

  it("capacidade não cadastrada não vira sobrecarga — vira aviso de lacuna", () => {
    const agenda = programar([etapa(1, "Mistura", 120, 99)], {
      diaISO: SEGUNDA,
      minutoDoDia: 480,
    });
    const ocupacoes = ocupacoesDe(agenda, "a", "OP-1");
    expect(conflitosDeCapacidade(ocupacoes, capacidade(null))).toEqual([]);

    const avisos = avisosDaAgenda({ agenda, capacidades: capacidade(null), conflitos: [] });
    expect(avisos.map((a) => a.tipo)).toContain("CAPACIDADE_NAO_CADASTRADA");
    expect(avisos.find((a) => a.tipo === "CAPACIDADE_NAO_CADASTRADA")!.texto).toContain(
      "capacidade não cadastrada",
    );
  });

  it("recurso inativo continua ocupado, e a tela fica sabendo", () => {
    const agenda = programar([etapa(1, "Mistura", 60, 1)], { diaISO: SEGUNDA, minutoDoDia: 480 });
    const inativo = capacidade(2).map((c) => ({ ...c, active: false }));
    const avisos = avisosDaAgenda({ agenda, capacidades: inativo, conflitos: [] });
    expect(avisos.map((a) => a.tipo)).toContain("RECURSO_INATIVO");
  });

  it("etapa sem recurso é dita, e prazo do cliente estourado também", () => {
    const agenda = programar(
      [{ sequence: 1, name: "Descanso", durationMinutes: 60, resources: [] }],
      { diaISO: SEGUNDA, minutoDoDia: 480 },
    );
    const avisos = avisosDaAgenda({
      agenda,
      capacidades: [],
      conflitos: [],
      promessaAt: em(SEGUNDA, 8),
    });
    expect(avisos.map((a) => a.tipo)).toContain("ETAPA_SEM_RECURSO");
    expect(avisos.map((a) => a.tipo)).toContain("PRAZO_DO_CLIENTE");
  });

  it("a carga por dia soma minutos-RECURSO, e não minutos de relógio", () => {
    const agenda = programar([etapa(1, "Mistura", 120, 2)], { diaISO: SEGUNDA, minutoDoDia: 480 });
    const carga = cargaPorRecursoEDia(ocupacoesDe(agenda, "a", "OP-1"));
    // 2 h de etapa × 2 operadores = 240 minutos-recurso.
    expect(carga.get("op")!.get(SEGUNDA)).toBe(240);
  });
});
