import { describe, expect, it } from "vitest";
import { hojeComercial } from "./business-timezone.js";
import {
  DIAS_DA_SEMANA,
  MINUTOS_DO_DIA,
  ProductionCalendarInputError,
  SEMANA_PADRAO,
  avisoDeIntervaloSemHorario,
  diaDaSemanaComercial,
  diasComIntervaloSemHorario,
  ehDiaOperacional,
  formatarDuracaoEmMinutos,
  formatarJanela,
  formatarMinutoDoDia,
  janelasDoDia,
  lerMinutoDoDia,
  minutosUteisDaJornada,
  minutosUteisDoDia,
  montarCalendario,
  proximoDiaOperacional,
  proximoInicioUtil,
  validarDiaDaSemana,
  validarExcecao,
} from "./production-calendar.js";
import type {
  DiaDaSemana,
  ExcecaoDoCalendario,
  JornadaDaSemana,
  ProductionCalendarExceptionOperation,
} from "./production-calendar.js";

/**
 * PLANNING-CALENDAR-01 e PLANNING-CALENDAR-WEEKLY-SCHEDULE-01 — a jornada
 * operacional da fábrica, dia a dia.
 *
 * O que estas provas protegem, acima de tudo:
 *
 * 1. **cada dia tem a sua jornada.** Sexta curta não herda o almoço da
 *    quinta, e domingo fechado não tem janela nenhuma;
 * 2. **a exceção da data vence a semana**, para menos (véspera de Natal até
 *    12:00) e para mais (sábado fechado que trabalha) — e motivo não decide
 *    funcionamento;
 * 3. **o calendário vive em DIA CIVIL e MINUTO DO DIA**, e por isso o horário
 *    de verão não o alcança. Um offset fixo `-03:00` passaria em setembro e
 *    erraria em novembro — e é isso que os casos de DST histórico pegam.
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

const excecao = (
  date: string,
  operation: ProductionCalendarExceptionOperation,
  horario: [number, number] | null = null,
  pausa: [number, number] | null = null,
): ExcecaoDoCalendario => ({
  date,
  operation,
  startMinuteOfDay: horario ? horario[0] : null,
  endMinuteOfDay: horario ? horario[1] : null,
  breakStartMinuteOfDay: pausa ? pausa[0] : null,
  breakEndMinuteOfDay: pausa ? pausa[1] : null,
});

/** 08:00 às 17:00 com almoço das 12:00 às 13:00 — 480 min úteis. */
const LONGO = [480, 1020] as const;
const ALMOCO: [number, number] = [720, 780];

/** A semana real da Veridi: seg–qui longa com almoço, sex e sáb até 12:00, domingo fechado. */
const SEMANA_VERIDI: JornadaDaSemana[] = [
  aberto("MONDAY", ...LONGO, ALMOCO),
  aberto("TUESDAY", ...LONGO, ALMOCO),
  aberto("WEDNESDAY", ...LONGO, ALMOCO),
  aberto("THURSDAY", ...LONGO, ALMOCO),
  aberto("FRIDAY", 480, 720),
  aberto("SATURDAY", 480, 720),
  fechado("SUNDAY"),
];

/** Segunda a sexta 08–17 com almoço; fim de semana fechado. */
const SEG_A_SEX: JornadaDaSemana[] = DIAS_DA_SEMANA.map((dia) =>
  dia === "SATURDAY" || dia === "SUNDAY" ? fechado(dia) : aberto(dia, ...LONGO, ALMOCO),
);

const VERIDI = montarCalendario(SEMANA_VERIDI);
const COMERCIAL = montarCalendario(SEG_A_SEX);

/* Semana de referência: 2026-09-14 é segunda-feira. */
const SEGUNDA = "2026-09-14";
const TERCA = "2026-09-15";
const QUINTA = "2026-09-17";
const SEXTA = "2026-09-18";
const SABADO = "2026-09-19";
const DOMINGO = "2026-09-20";

describe("dia da semana comercial", () => {
  it("11/09/2026 é sexta-feira", () => {
    expect(diaDaSemanaComercial("2026-09-11")).toBe("FRIDAY");
  });

  it("a semana inteira, de segunda a domingo", () => {
    expect(diaDaSemanaComercial("2026-09-07")).toBe("MONDAY");
    expect(diaDaSemanaComercial("2026-09-08")).toBe("TUESDAY");
    expect(diaDaSemanaComercial("2026-09-09")).toBe("WEDNESDAY");
    expect(diaDaSemanaComercial("2026-09-10")).toBe("THURSDAY");
    expect(diaDaSemanaComercial("2026-09-11")).toBe("FRIDAY");
    expect(diaDaSemanaComercial("2026-09-12")).toBe("SATURDAY");
    expect(diaDaSemanaComercial("2026-09-13")).toBe("SUNDAY");
  });

  it("data inexistente no calendário é recusa de negócio, nunca 500", () => {
    expect(() => diaDaSemanaComercial("2026-02-30")).toThrow(ProductionCalendarInputError);
    expect(() => diaDaSemanaComercial("11/09/2026")).toThrow(ProductionCalendarInputError);
  });
});

describe("fuso comercial e horário de verão", () => {
  /*
   * A ponte entre INSTANTE e DIA CIVIL é `hojeComercial`, no fuso
   * America/Sao_Paulo. O calendário só entra depois dela — e é a combinação
   * das duas que um offset fixo quebraria.
   */
  it("22:30 de uma sexta em São Paulo ainda é sexta, embora em UTC já seja sábado", () => {
    const instante = new Date("2026-09-12T01:30:00.000Z");
    expect(hojeComercial(instante)).toBe("2026-09-11");
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("FRIDAY");
  });

  it("DST histórico: 02:30Z de 07/11/2018 é QUARTA em São Paulo, não terça", () => {
    /*
     * Em novembro de 2018 o Brasil estava em horário de verão e o
     * deslocamento era −02:00: 02:30Z é 00:30 do dia 07, uma quarta-feira.
     * Com `-03:00` cravado à mão daria 23:30 do dia 06 — terça —, e a fábrica
     * planejaria o dia errado durante cinco meses por ano.
     */
    const instante = new Date("2018-11-07T02:30:00.000Z");
    expect(hojeComercial(instante)).toBe("2018-11-07");
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("WEDNESDAY");
  });

  it("fora do horário de verão o mesmo instante cai no dia anterior", () => {
    // Setembro de 2018: deslocamento −03:00. 02:30Z é 23:30 do dia 11, terça.
    const instante = new Date("2018-09-12T02:30:00.000Z");
    expect(hojeComercial(instante)).toBe("2018-09-11");
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("TUESDAY");
  });

  it("o dia da virada do horário de verão continua sendo o dia que é", () => {
    // 04/11/2018: o relógio pulou de 00:00 para 01:00. O dia teve 23 horas e
    // continuou sendo um domingo — a jornada não encolhe por causa disso.
    expect(diaDaSemanaComercial("2018-11-04")).toBe("SUNDAY");
    const comDomingo = montarCalendario(
      SEG_A_SEX.map((dia) => (dia.weekday === "SUNDAY" ? aberto("SUNDAY", ...LONGO, ALMOCO) : dia)),
    );
    expect(minutosUteisDoDia("2018-11-04", comDomingo)).toBe(480);
  });
});

describe("jornada semanal — cada dia com a sua", () => {
  it("segunda longa: duas janelas, 480 min úteis", () => {
    expect(janelasDoDia(SEGUNDA, VERIDI)).toEqual([
      { inicioMinuto: 480, fimMinuto: 720 },
      { inicioMinuto: 780, fimMinuto: 1020 },
    ]);
    expect(minutosUteisDoDia(SEGUNDA, VERIDI)).toBe(480);
  });

  it("sexta curta: 08:00–12:00 sem intervalo, 240 min", () => {
    expect(janelasDoDia(SEXTA, VERIDI)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
    expect(minutosUteisDoDia(SEXTA, VERIDI)).toBe(240);
  });

  it("sábado curto também opera: 08:00–12:00, 240 min", () => {
    expect(ehDiaOperacional(SABADO, VERIDI)).toBe(true);
    expect(janelasDoDia(SABADO, VERIDI)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
    expect(minutosUteisDoDia(SABADO, VERIDI)).toBe(240);
  });

  it("domingo fechado: nenhuma janela — e não uma janela de zero minuto", () => {
    expect(ehDiaOperacional(DOMINGO, VERIDI)).toBe(false);
    expect(janelasDoDia(DOMINGO, VERIDI)).toEqual([]);
    expect(minutosUteisDoDia(DOMINGO, VERIDI)).toBe(0);
  });

  it("intervalo é opcional: sem ele o dia é uma janela só", () => {
    expect(janelasDoDia(SEXTA, VERIDI)).toHaveLength(1);
    expect(janelasDoDia(QUINTA, VERIDI)).toHaveLength(2);
  });

  it("minutos úteis são derivados do horário, nunca guardados", () => {
    expect(
      minutosUteisDaJornada({
        startMinuteOfDay: 480,
        endMinuteOfDay: 1020,
        breakStartMinuteOfDay: 720,
        breakEndMinuteOfDay: 780,
      }),
    ).toBe(480);
    expect(
      minutosUteisDaJornada({
        startMinuteOfDay: 480,
        endMinuteOfDay: 720,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
      }),
    ).toBe(240);
  });

  it("trocar a jornada da sexta não muda a segunda", () => {
    const outraSexta = montarCalendario(
      SEMANA_VERIDI.map((dia) => (dia.weekday === "FRIDAY" ? aberto("FRIDAY", 420, 960) : dia)),
    );
    expect(janelasDoDia(SEXTA, outraSexta)).toEqual([{ inicioMinuto: 420, fimMinuto: 960 }]);
    expect(janelasDoDia(SEGUNDA, outraSexta)).toEqual(janelasDoDia(SEGUNDA, VERIDI));
    expect(janelasDoDia(SABADO, outraSexta)).toEqual(janelasDoDia(SABADO, VERIDI));
  });

  it("semana incompleta é recusada, e não completada com um palpite", () => {
    expect(() => montarCalendario(SEMANA_VERIDI.slice(0, 6))).toThrow(/falta Domingo/);
  });

  it("a sugestão de calendário novo é segunda a sexta 08–17, com 1 h de pausa SEM horário", () => {
    const porDia = new Map(SEMANA_PADRAO.map((dia) => [dia.weekday, dia]));
    expect(porDia.get("MONDAY")).toMatchObject({
      enabled: true,
      startMinuteOfDay: 480,
      endMinuteOfDay: 1020,
      breakStartMinuteOfDay: null,
      unpositionedBreakMinutes: 60,
    });
    expect(porDia.get("SATURDAY")!.enabled).toBe(false);
    expect(porDia.get("SUNDAY")!.enabled).toBe(false);
    expect(minutosUteisDoDia(SEGUNDA, montarCalendario(SEMANA_PADRAO))).toBe(480);
  });
});

describe("intervalo legado sem horário", () => {
  /*
   * A jornada única do PLANNING-CALENDAR-01 podia ter "60 min de intervalo"
   * sem dizer onde. A migração copia esse número em vez de apagá-lo: o dia
   * continua rendendo o que rendia, e continua sem hora exata.
   */
  const legado = montarCalendario(
    SEG_A_SEX.map((dia) =>
      dia.weekday === "TUESDAY"
        ? { ...aberto("TUESDAY", ...LONGO), unpositionedBreakMinutes: 60 }
        : dia,
    ),
  );

  it("o dia rende o mesmo que rendia: janela menos a pausa", () => {
    expect(minutosUteisDoDia(TERCA, legado)).toBe(480);
  });

  it("mas não produz janela: recusa nomeando o dia, em vez de contar o almoço", () => {
    expect(() => janelasDoDia(TERCA, legado)).toThrow(ProductionCalendarInputError);
    expect(() => janelasDoDia(TERCA, legado)).toThrow(
      "Defina o horário do intervalo de Terça-feira antes de calcular horários de produção.",
    );
    // Os outros dias seguem normais.
    expect(janelasDoDia(SEGUNDA, legado)).toHaveLength(2);
  });

  it("o aviso nomeia todos os dias pendentes", () => {
    expect(diasComIntervaloSemHorario(SEMANA_PADRAO)).toEqual([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
    ]);
    expect(avisoDeIntervaloSemHorario(["MONDAY", "FRIDAY"])).toBe(
      "Defina o horário do intervalo de Segunda-feira e Sexta-feira antes de calcular horários de produção.",
    );
    expect(avisoDeIntervaloSemHorario([])).toBeNull();
  });

  it("horário especial na data vence o legado, sem recusa", () => {
    const comEspecial = montarCalendario(Object.values(legado.semana), [
      excecao(TERCA, "HORARIO_ESPECIAL", [480, 720]),
    ]);
    expect(janelasDoDia(TERCA, comEspecial)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
  });
});

describe("exceções — motivo não é funcionamento", () => {
  it("feriado SEM OPERAÇÃO numa segunda derruba o dia inteiro", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [excecao(SEGUNDA, "SEM_OPERACAO")]);
    expect(ehDiaOperacional(SEGUNDA, calendario)).toBe(false);
    expect(janelasDoDia(SEGUNDA, calendario)).toEqual([]);
    expect(minutosUteisDoDia(SEGUNDA, calendario)).toBe(0);
  });

  it("feriado com HORÁRIO ESPECIAL: véspera de Natal só até 12:00", () => {
    // 24/12/2026 é quinta-feira — normalmente 08–17 com almoço.
    const vespera = "2026-12-24";
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(vespera, "HORARIO_ESPECIAL", [480, 720]),
    ]);
    expect(diaDaSemanaComercial(vespera)).toBe("THURSDAY");
    expect(janelasDoDia(vespera, calendario)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
    expect(minutosUteisDoDia(vespera, calendario)).toBe(240);
  });

  it("horário especial REDUZ a jornada: terça normal vira 08–12", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(TERCA, "HORARIO_ESPECIAL", [480, 720]),
    ]);
    const janelas = janelasDoDia(TERCA, calendario);
    expect(janelas).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
    // A tarde da terça normal não sobrevive à exceção.
    expect(janelas.some((janela) => janela.fimMinuto > 780)).toBe(false);
  });

  it("horário especial AMPLIA a jornada: sexta curta vira dia longo", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(SEXTA, "HORARIO_ESPECIAL", [...LONGO], ALMOCO),
    ]);
    expect(minutosUteisDoDia(SEXTA, calendario)).toBe(480);
    expect(janelasDoDia(SEXTA, calendario)).toHaveLength(2);
  });

  it("horário especial num dia que normalmente NÃO opera: o domingo trabalha", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(DOMINGO, "HORARIO_ESPECIAL", [480, 720]),
    ]);
    expect(ehDiaOperacional(DOMINGO, calendario)).toBe(true);
    expect(janelasDoDia(DOMINGO, calendario)).toEqual([{ inicioMinuto: 480, fimMinuto: 720 }]);
    // E SEM OPERAÇÃO num domingo continua fechado.
    const fechadoMesmo = montarCalendario(SEMANA_VERIDI, [excecao(DOMINGO, "SEM_OPERACAO")]);
    expect(janelasDoDia(DOMINGO, fechadoMesmo)).toEqual([]);
  });

  it("horário especial com intervalo próprio", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(SABADO, "HORARIO_ESPECIAL", [780, 1020], [900, 915]),
    ]);
    expect(janelasDoDia(SABADO, calendario)).toEqual([
      { inicioMinuto: 780, fimMinuto: 900 },
      { inicioMinuto: 915, fimMinuto: 1020 },
    ]);
    expect(minutosUteisDoDia(SABADO, calendario)).toBe(225);
  });

  it("uma exceção por data: a data é a chave", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [excecao(SEGUNDA, "SEM_OPERACAO")]);
    expect(calendario.excecoes.size).toBe(1);
    expect(calendario.excecoes.get(SEGUNDA)?.operation).toBe("SEM_OPERACAO");
    expect(janelasDoDia(TERCA, calendario)).toEqual(janelasDoDia(TERCA, VERIDI));
  });
});

describe("próximo dia operacional", () => {
  it("depois de uma sexta vem a segunda — quando o sábado não opera", () => {
    expect(proximoDiaOperacional(SEXTA, COMERCIAL)).toBe("2026-09-21");
  });

  it("com o sábado curto da Veridi, depois da sexta vem o sábado, e o domingo é pulado", () => {
    expect(proximoDiaOperacional(SEXTA, VERIDI)).toBe(SABADO);
    expect(proximoDiaOperacional(SABADO, VERIDI)).toBe("2026-09-21");
  });

  it("o próprio dia não conta, a menos que se peça", () => {
    expect(proximoDiaOperacional("2026-09-09", COMERCIAL)).toBe("2026-09-10");
    expect(proximoDiaOperacional("2026-09-09", COMERCIAL, { incluirOProprio: true })).toBe(
      "2026-09-09",
    );
  });

  it("um feriado sem operação na segunda empurra para a terça", () => {
    const calendario = montarCalendario(SEG_A_SEX, [excecao("2026-09-21", "SEM_OPERACAO")]);
    expect(proximoDiaOperacional(SEXTA, calendario)).toBe("2026-09-22");
  });

  it("um domingo com horário especial vira o próximo dia operacional", () => {
    const calendario = montarCalendario(SEMANA_VERIDI, [
      excecao(DOMINGO, "HORARIO_ESPECIAL", [480, 720]),
    ]);
    expect(proximoDiaOperacional(SABADO, calendario)).toBe(DOMINGO);
  });

  it("calendário impossível devolve null em vez de girar para sempre", () => {
    /*
     * Só a segunda opera, e todas as segundas do horizonte estão cadastradas
     * sem operação. Não existe resposta certa — e a função tem de dizer isso,
     * não travar o processo procurando.
     */
    const soSegunda = DIAS_DA_SEMANA.map((dia) =>
      dia === "MONDAY" ? aberto(dia, ...LONGO, ALMOCO) : fechado(dia),
    );
    const todasAsSegundas: ExcecaoDoCalendario[] = [];
    for (let semana = 0; semana < 60; semana += 1) {
      todasAsSegundas.push(
        excecao(
          new Date(Date.UTC(2026, 8, 14 + semana * 7)).toISOString().slice(0, 10),
          "SEM_OPERACAO",
        ),
      );
    }
    expect(proximoDiaOperacional("2026-09-11", montarCalendario(soSegunda, todasAsSegundas))).toBeNull();
  });
});

describe("próximo início útil", () => {
  it("antes da abertura, o próprio dia às 08:00", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-09", minutoDoDia: 300 }, VERIDI)).toEqual({
      diaISO: "2026-09-09",
      minutoDoDia: 480,
    });
  });

  it("dentro da jornada, o próprio momento", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-09", minutoDoDia: 600 }, VERIDI)).toEqual({
      diaISO: "2026-09-09",
      minutoDoDia: 600,
    });
  });

  it("dentro do almoço, o fim da pausa", () => {
    expect(proximoInicioUtil({ diaISO: QUINTA, minutoDoDia: 740 }, VERIDI)).toEqual({
      diaISO: QUINTA,
      minutoDoDia: 780,
    });
  });

  it("depois do fechamento da sexta curta, a abertura do sábado — não a tarde da sexta", () => {
    expect(proximoInicioUtil({ diaISO: SEXTA, minutoDoDia: 780 }, VERIDI)).toEqual({
      diaISO: SABADO,
      minutoDoDia: 480,
    });
  });

  it("num dia não operante, a abertura do próximo que opera, com a jornada DELE", () => {
    const tardeDeSegunda = montarCalendario(
      SEMANA_VERIDI.map((dia) => (dia.weekday === "MONDAY" ? aberto("MONDAY", 780, 1020) : dia)),
    );
    expect(proximoInicioUtil({ diaISO: DOMINGO, minutoDoDia: 600 }, tardeDeSegunda)).toEqual({
      diaISO: "2026-09-21",
      minutoDoDia: 780,
    });
  });
});

describe("hora do dia como minuto, nunca DateTime", () => {
  it("formata e lê de volta o mesmo minuto", () => {
    expect(formatarMinutoDoDia(480)).toBe("08:00");
    expect(formatarMinutoDoDia(1020)).toBe("17:00");
    expect(formatarMinutoDoDia(0)).toBe("00:00");
    expect(formatarMinutoDoDia(MINUTOS_DO_DIA)).toBe("24:00");
    expect(formatarJanela(720, 780)).toBe("12:00–13:00");
    expect(lerMinutoDoDia("08:00")).toBe(480);
    expect(lerMinutoDoDia("8:30")).toBe(510);
    expect(lerMinutoDoDia("24:00")).toBe(MINUTOS_DO_DIA);
  });

  it("texto fora do formato ou fora do dia é null", () => {
    expect(lerMinutoDoDia("")).toBeNull();
    expect(lerMinutoDoDia("08h00")).toBeNull();
    expect(lerMinutoDoDia("08:60")).toBeNull();
    expect(lerMinutoDoDia("25:00")).toBeNull();
  });

  it("duração legível para a tela", () => {
    expect(formatarDuracaoEmMinutos(0)).toBe("0 min");
    expect(formatarDuracaoEmMinutos(45)).toBe("45 min");
    expect(formatarDuracaoEmMinutos(60)).toBe("1 h");
    expect(formatarDuracaoEmMinutos(480)).toBe("8 h");
    expect(formatarDuracaoEmMinutos(90)).toBe("1 h 30 min");
  });
});

describe("validação de um dia da semana", () => {
  const segunda = { enabled: true, ...aberto("MONDAY", ...LONGO, ALMOCO) };

  it("jornada longa com almoço e jornada curta sem intervalo são válidas", () => {
    expect(validarDiaDaSemana(segunda)).toEqual([]);
    expect(validarDiaDaSemana(aberto("FRIDAY", 480, 720))).toEqual([]);
  });

  it("dia que não opera não exige horário — e não aceita nenhum", () => {
    expect(validarDiaDaSemana(fechado("SUNDAY"))).toEqual([]);
    expect(validarDiaDaSemana({ ...fechado("SUNDAY"), startMinuteOfDay: 480 })).toEqual([
      "Dia que não opera não tem horário: deixe início, fim e intervalo em branco.",
    ]);
  });

  it("dia que opera sem início ou fim é recusado", () => {
    expect(validarDiaDaSemana({ ...segunda, startMinuteOfDay: null })).toContain(
      "Informe o horário inicial e o final.",
    );
  });

  it("fim antes do início, ou igual, é recusado", () => {
    expect(validarDiaDaSemana({ ...segunda, endMinuteOfDay: 300 })).toContain(
      "O horário final tem de ser depois do inicial.",
    );
    expect(validarDiaDaSemana({ ...segunda, endMinuteOfDay: 480 })).toContain(
      "O horário final tem de ser depois do inicial.",
    );
  });

  it("horário fora do dia é recusado", () => {
    expect(validarDiaDaSemana({ ...segunda, endMinuteOfDay: 1441 })).toContain(
      "Informe o horário inicial e o final entre 00:00 e 24:00.",
    );
  });

  it("só o início do intervalo, ou só o fim, é recusado", () => {
    expect(validarDiaDaSemana({ ...segunda, breakEndMinuteOfDay: null })).toContain(
      "O intervalo precisa de início E fim, ou de nenhum dos dois.",
    );
    expect(validarDiaDaSemana({ ...segunda, breakStartMinuteOfDay: null })).toContain(
      "O intervalo precisa de início E fim, ou de nenhum dos dois.",
    );
  });

  it("intervalo fora da jornada, invertido ou do tamanho dela é recusado", () => {
    expect(
      validarDiaDaSemana({ ...segunda, breakStartMinuteOfDay: 420, breakEndMinuteOfDay: 500 }),
    ).toContain("O intervalo tem de ficar dentro da jornada.");
    expect(
      validarDiaDaSemana({ ...segunda, breakStartMinuteOfDay: 780, breakEndMinuteOfDay: 720 }),
    ).toContain("O fim do intervalo tem de ser depois do início dele.");
    expect(
      validarDiaDaSemana({ ...segunda, breakStartMinuteOfDay: 480, breakEndMinuteOfDay: 1020 }),
    ).toContain("O intervalo não pode ocupar a jornada inteira.");
  });
});

describe("validação do funcionamento da exceção", () => {
  it("SEM OPERAÇÃO tem horários nulos — e recusa qualquer um", () => {
    expect(validarExcecao(excecao(SEGUNDA, "SEM_OPERACAO"))).toEqual([]);
    expect(validarExcecao({ ...excecao(SEGUNDA, "SEM_OPERACAO"), endMinuteOfDay: 720 })).toEqual([
      "Sem operação fecha o dia inteiro: deixe início, fim e intervalo em branco.",
    ]);
  });

  it("HORÁRIO ESPECIAL segue as regras da jornada semanal", () => {
    expect(validarExcecao(excecao("2026-12-24", "HORARIO_ESPECIAL", [480, 720]))).toEqual([]);
    expect(validarExcecao(excecao("2026-12-24", "HORARIO_ESPECIAL"))).toContain(
      "Informe o horário inicial e o final.",
    );
    expect(
      validarExcecao(excecao("2026-12-24", "HORARIO_ESPECIAL", [480, 720], [700, 800])),
    ).toContain("O intervalo tem de ficar dentro da jornada.");
  });
});
