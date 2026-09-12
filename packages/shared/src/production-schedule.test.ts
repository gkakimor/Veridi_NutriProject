import { describe, expect, it } from "vitest";
import type { AgendaCalculada, ProductionCalendarConfigInput } from "./index.js";
import {
  AVISO_INTERVALO_SEM_HORARIO,
  ProductionCalendarInputError,
  avaliarInicio,
  avisosDaAgenda,
  cargaPorRecursoEDia,
  conflitosDeCapacidade,
  conjuntoDeExcecoes,
  instanteComercial,
  intervaloPosicionado,
  janelasDoDia,
  ocupacoesDaAgenda,
  programarEtapas,
} from "./index.js";

/**
 * A AGENDA DE UMA ORDEM — PLANNING-CAPACITY-BOARD-01.
 *
 * O que estes testes protegem, e que nenhuma revisão de código pega sozinha:
 *
 * 1. **o intervalo tem horário, ou não há hora exata.** Sem a posição da
 *    pausa, projetar é escolher entre contar o almoço como produção e inventar
 *    12:00–13:00. As duas estão erradas, e a função recusa;
 * 2. **envelope não é ocupação.** Uma etapa que atravessa a noite, o fim de
 *    semana ou um feriado NÃO ocupa recurso nesse meio-tempo. Contar pelo
 *    envelope diria que a encapsuladora passou o domingo ligada;
 * 3. **capacidade desconhecida não é capacidade zero.** Recurso sem número
 *    cadastrado vira aviso de lacuna, nunca acusação de sobrecarga.
 */

const SEG_A_SEX = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

/** 08:00–17:00 com almoço das 12:00 às 13:00 — 480 min úteis. */
const JORNADA: ProductionCalendarConfigInput = {
  startMinuteOfDay: 480,
  endMinuteOfDay: 1020,
  breakMinutes: 60,
  breakStartMinuteOfDay: 720,
  breakEndMinuteOfDay: 780,
  weekdays: SEG_A_SEX,
};

/** A mesma jornada de antes desta capacidade: duração da pausa, sem horário. */
const SEM_POSICAO: ProductionCalendarConfigInput = {
  ...JORNADA,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
};

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
const SEXTA = "2026-09-18";

const em = (diaISO: string, hora: number, minuto = 0) =>
  instanteComercial(diaISO, hora * 60 + minuto).toISOString();

function programar(
  etapas: Parameters<typeof programarEtapas>[0]["etapas"],
  inicio: { diaISO: string; minutoDoDia: number },
  calendario = JORNADA,
  excecoes: ReadonlySet<string> = new Set(),
): AgendaCalculada {
  return programarEtapas({ etapas, inicio, calendario, excecoes });
}

describe("janelas do dia", () => {
  it("a jornada com almoço posicionado vira DUAS janelas de trabalho", () => {
    expect(janelasDoDia(SEGUNDA, JORNADA)).toEqual([
      { inicioMinuto: 480, fimMinuto: 720 },
      { inicioMinuto: 780, fimMinuto: 1020 },
    ]);
  });

  it("dia não operante não tem janela nenhuma — e não uma janela de zero", () => {
    expect(janelasDoDia("2026-09-19", JORNADA)).toEqual([]);
    expect(janelasDoDia(SEGUNDA, JORNADA, conjuntoDeExcecoes([{ date: SEGUNDA }]))).toEqual([]);
  });

  it("intervalo sem horário RECUSA em vez de chutar a posição", () => {
    expect(intervaloPosicionado(SEM_POSICAO)).toBe(false);
    expect(() => janelasDoDia(SEGUNDA, SEM_POSICAO)).toThrowError(ProductionCalendarInputError);
    expect(() => janelasDoDia(SEGUNDA, SEM_POSICAO)).toThrowError(AVISO_INTERVALO_SEM_HORARIO);
  });

  it("sem intervalo nenhum, o dia é uma janela só", () => {
    const direto = { ...SEM_POSICAO, breakMinutes: 0 };
    expect(janelasDoDia(SEGUNDA, direto)).toEqual([{ inicioMinuto: 480, fimMinuto: 1020 }]);
  });
});

describe("início escolhido pela pessoa", () => {
  it("dentro da jornada serve", () => {
    const avaliacao = avaliarInicio(new Date(em(SEGUNDA, 9)), JORNADA);
    expect(avaliacao.operacional).toBe(true);
    expect(avaliacao.sugestaoAt).toBeNull();
  });

  it("domingo é recusado COM o próximo horário, e nunca deslocado em silêncio", () => {
    const avaliacao = avaliarInicio(new Date(em("2026-09-20", 9)), JORNADA);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.motivo).toBe("Este dia não é operacional no calendário de produção.");
    expect(avaliacao.sugestaoAt).toBe(em("2026-09-21", 8));
  });

  it("feriado também, e a sugestão pula para o dia seguinte que opera", () => {
    const excecoes = conjuntoDeExcecoes([{ date: "2026-09-15" }]);
    const avaliacao = avaliarInicio(new Date(em("2026-09-15", 9)), JORNADA, excecoes);
    expect(avaliacao.operacional).toBe(false);
    expect(avaliacao.sugestaoAt).toBe(em("2026-09-16", 8));
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
    expect(passo.workSegments).toEqual([
      { diaISO: SEGUNDA, startAt: em(SEGUNDA, 11), endAt: em(SEGUNDA, 12), durationMinutes: 60 },
      { diaISO: SEGUNDA, startAt: em(SEGUNDA, 13), endAt: em(SEGUNDA, 15), durationMinutes: 120 },
    ]);
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
      { diaISO: SEGUNDA, startAt: em(SEGUNDA, 16), endAt: em(SEGUNDA, 17), durationMinutes: 60 },
      {
        diaISO: "2026-09-15",
        startAt: em("2026-09-15", 8),
        endAt: em("2026-09-15", 9),
        durationMinutes: 60,
      },
    ]);
  });

  it("sexta 16:00 continua na segunda — e o fim de semana NÃO é ocupação", () => {
    const agenda = programar([etapa(1, "Embalagem", 120)], { diaISO: SEXTA, minutoDoDia: 960 });
    expect(agenda.plannedStartAt).toBe(em(SEXTA, 16));
    expect(agenda.plannedEndAt).toBe(em("2026-09-21", 9));
    const dias = agenda.steps[0]!.workSegments.map((s) => s.diaISO);
    expect(dias).toEqual([SEXTA, "2026-09-21"]);
    // Sábado e domingo não aparecem em segmento nenhum.
    expect(dias).not.toContain("2026-09-19");
    expect(dias).not.toContain("2026-09-20");
    expect(agenda.workingMinutes).toBe(120);
  });

  it("feriado no meio é pulado, e o dia da exceção fica sem segmento", () => {
    const excecoes = conjuntoDeExcecoes([{ date: "2026-09-15" }]);
    const agenda = programar(
      [etapa(1, "Mistura", 120)],
      { diaISO: SEGUNDA, minutoDoDia: 960 },
      JORNADA,
      excecoes,
    );
    const dias = agenda.steps[0]!.workSegments.map((s) => s.diaISO);
    expect(dias).toEqual([SEGUNDA, "2026-09-16"]);
    expect(dias).not.toContain("2026-09-15");
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
    ).toThrowError(AVISO_INTERVALO_SEM_HORARIO);
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
    // Uma trabalha sexta à tarde e segunda de manhã; a outra, sábado — que não
    // existe na jornada. Se o conflito olhasse o envelope, elas se cruzariam.
    const atravessa = programar([etapa(1, "Embalagem", 120, 2)], {
      diaISO: SEXTA,
      minutoDoDia: 960,
    });
    const segundaCedo = programar([etapa(1, "Pesagem", 60, 2)], {
      diaISO: "2026-09-21",
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
