import { describe, expect, it } from "vitest";
import { hojeComercial } from "./business-timezone.js";
import {
  CALENDARIO_PADRAO,
  MINUTOS_DO_DIA,
  ProductionCalendarInputError,
  conjuntoDeExcecoes,
  diaDaSemanaComercial,
  ehDiaOperacional,
  formatarDuracaoEmMinutos,
  formatarMinutoDoDia,
  janelaEmMinutos,
  lerMinutoDoDia,
  minutosUteisDoDia,
  minutosUteisPorDia,
  proximoDiaOperacional,
  proximoInicioUtil,
  validarConfiguracaoDeCalendario,
} from "./production-calendar.js";
import type { DiasOperantes, ProductionCalendarConfigInput } from "./production-calendar.js";

/**
 * PLANNING-CALENDAR-01 — a jornada operacional da fábrica.
 *
 * O que estas provas protegem, acima de tudo: o calendário vive em DIA CIVIL
 * e MINUTO DO DIA, e por isso o horário de verão não o alcança. Um offset
 * fixo `-03:00` passaria em setembro e erraria em novembro — e é isso que os
 * casos de DST histórico pegam.
 */

const SEG_A_SEX: DiasOperantes = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

/** 08:00 às 17:00 com 1 h de intervalo — 480 min úteis. */
const JORNADA: ProductionCalendarConfigInput = {
  startMinuteOfDay: 480,
  endMinuteOfDay: 1020,
  breakMinutes: 60,
  weekdays: SEG_A_SEX,
};

describe("dia da semana comercial", () => {
  it("11/09/2026 é sexta-feira", () => {
    expect(diaDaSemanaComercial("2026-09-11")).toBe("friday");
  });

  it("a semana inteira, de segunda a domingo", () => {
    expect(diaDaSemanaComercial("2026-09-07")).toBe("monday");
    expect(diaDaSemanaComercial("2026-09-08")).toBe("tuesday");
    expect(diaDaSemanaComercial("2026-09-09")).toBe("wednesday");
    expect(diaDaSemanaComercial("2026-09-10")).toBe("thursday");
    expect(diaDaSemanaComercial("2026-09-11")).toBe("friday");
    expect(diaDaSemanaComercial("2026-09-12")).toBe("saturday");
    expect(diaDaSemanaComercial("2026-09-13")).toBe("sunday");
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
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("friday");
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
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("wednesday");
  });

  it("fora do horário de verão o mesmo instante cai no dia anterior", () => {
    // Setembro de 2018: deslocamento −03:00. 02:30Z é 23:30 do dia 11, terça.
    const instante = new Date("2018-09-12T02:30:00.000Z");
    expect(hojeComercial(instante)).toBe("2018-09-11");
    expect(diaDaSemanaComercial(hojeComercial(instante))).toBe("tuesday");
  });

  it("o dia da virada do horário de verão continua sendo o dia que é", () => {
    // 04/11/2018: o relógio pulou de 00:00 para 01:00. O dia teve 23 horas e
    // continuou sendo um domingo — a jornada não encolhe por causa disso.
    expect(diaDaSemanaComercial("2018-11-04")).toBe("sunday");
    expect(minutosUteisDoDia("2018-11-04", { ...JORNADA, weekdays: { ...SEG_A_SEX, sunday: true } })).toBe(480);
  });
});

describe("dias operantes", () => {
  it("segunda a sexta operam", () => {
    expect(ehDiaOperacional("2026-09-07", JORNADA)).toBe(true);
    expect(ehDiaOperacional("2026-09-11", JORNADA)).toBe(true);
  });

  it("sábado e domingo não operam no padrão", () => {
    expect(ehDiaOperacional("2026-09-12", JORNADA)).toBe(false);
    expect(ehDiaOperacional("2026-09-13", JORNADA)).toBe(false);
    expect(minutosUteisDoDia("2026-09-12", JORNADA)).toBe(0);
  });

  it("sábado operante é configuração, não exceção", () => {
    const comSabado = { ...JORNADA, weekdays: { ...SEG_A_SEX, saturday: true } };
    expect(ehDiaOperacional("2026-09-12", comSabado)).toBe(true);
    expect(minutosUteisDoDia("2026-09-12", comSabado)).toBe(480);
  });
});

describe("janela e minutos úteis", () => {
  it("08:00 às 17:00 são 540 min de janela e 480 úteis com 1 h de intervalo", () => {
    expect(janelaEmMinutos(JORNADA)).toBe(540);
    expect(minutosUteisPorDia(JORNADA)).toBe(480);
  });

  it("sem intervalo a janela inteira é útil", () => {
    expect(minutosUteisPorDia({ ...JORNADA, breakMinutes: 0 })).toBe(540);
  });

  it("o padrão de calendário novo é segunda a sexta, 08:00–17:00, 1 h", () => {
    expect(CALENDARIO_PADRAO.startMinuteOfDay).toBe(480);
    expect(CALENDARIO_PADRAO.endMinuteOfDay).toBe(1020);
    expect(CALENDARIO_PADRAO.breakMinutes).toBe(60);
    expect(CALENDARIO_PADRAO.weekdays.saturday).toBe(false);
    expect(CALENDARIO_PADRAO.weekdays.sunday).toBe(false);
    expect(minutosUteisPorDia(CALENDARIO_PADRAO)).toBe(480);
  });
});

describe("exceções do calendário", () => {
  const excecoes = conjuntoDeExcecoes([
    { date: "2026-09-07" },
    { date: "2026-12-24" },
    { date: "2026-12-25" },
  ]);

  it("feriado numa segunda derruba o dia inteiro", () => {
    expect(ehDiaOperacional("2026-09-07", JORNADA, excecoes)).toBe(false);
    expect(minutosUteisDoDia("2026-09-07", JORNADA, excecoes)).toBe(0);
  });

  it("recesso de vários dias é uma exceção por data", () => {
    expect(ehDiaOperacional("2026-12-24", JORNADA, excecoes)).toBe(false);
    expect(ehDiaOperacional("2026-12-25", JORNADA, excecoes)).toBe(false);
    // 23/12/2026 é uma quarta-feira sem exceção: opera.
    expect(ehDiaOperacional("2026-12-23", JORNADA, excecoes)).toBe(true);
  });

  it("exceção num dia que já não operava não muda nada", () => {
    const comSabado = conjuntoDeExcecoes([{ date: "2026-09-12" }]);
    expect(ehDiaOperacional("2026-09-12", JORNADA, comSabado)).toBe(false);
  });
});

describe("próximo dia operacional", () => {
  it("depois de uma sexta vem a segunda", () => {
    expect(proximoDiaOperacional("2026-09-11", JORNADA)).toBe("2026-09-14");
  });

  it("o próprio dia não conta, a menos que se peça", () => {
    expect(proximoDiaOperacional("2026-09-09", JORNADA)).toBe("2026-09-10");
    expect(proximoDiaOperacional("2026-09-09", JORNADA, new Set(), { incluirOProprio: true })).toBe(
      "2026-09-09",
    );
  });

  it("um feriado na segunda empurra para a terça", () => {
    const excecoes = conjuntoDeExcecoes([{ date: "2026-09-14" }]);
    expect(proximoDiaOperacional("2026-09-11", JORNADA, excecoes)).toBe("2026-09-15");
  });

  it("a sexta operante é ela mesma quando se pede a partir de quando dá para começar", () => {
    const excecoes = conjuntoDeExcecoes([{ date: "2026-09-14" }]);
    expect(proximoDiaOperacional("2026-09-11", JORNADA, excecoes, { incluirOProprio: true })).toBe(
      "2026-09-11",
    );
  });

  it("calendário impossível devolve null em vez de girar para sempre", () => {
    /*
     * Só a segunda opera, e todas as segundas do horizonte estão cadastradas
     * como exceção. Não existe resposta certa — e a função tem de dizer isso,
     * não travar o processo procurando.
     */
    const soSegunda: ProductionCalendarConfigInput = {
      ...JORNADA,
      weekdays: {
        monday: true,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      },
    };
    const todasAsSegundas = new Set<string>();
    for (let semana = 0; semana < 60; semana += 1) {
      todasAsSegundas.add(new Date(Date.UTC(2026, 8, 14 + semana * 7)).toISOString().slice(0, 10));
    }
    expect(proximoDiaOperacional("2026-09-11", soSegunda, todasAsSegundas)).toBeNull();
  });
});

describe("próximo início útil", () => {
  it("antes da abertura, o próprio dia às 08:00", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-09", minutoDoDia: 300 }, JORNADA)).toEqual({
      diaISO: "2026-09-09",
      minutoDoDia: 480,
    });
  });

  it("dentro da jornada, o próprio momento", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-09", minutoDoDia: 600 }, JORNADA)).toEqual({
      diaISO: "2026-09-09",
      minutoDoDia: 600,
    });
  });

  it("depois do fechamento, a abertura do próximo dia operante", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-11", minutoDoDia: 1100 }, JORNADA)).toEqual({
      diaISO: "2026-09-14",
      minutoDoDia: 480,
    });
  });

  it("num dia não operante, a abertura do próximo que opera", () => {
    expect(proximoInicioUtil({ diaISO: "2026-09-12", minutoDoDia: 600 }, JORNADA)).toEqual({
      diaISO: "2026-09-14",
      minutoDoDia: 480,
    });
  });

  it("feriado no caminho é pulado", () => {
    const excecoes = conjuntoDeExcecoes([{ date: "2026-09-14" }]);
    expect(proximoInicioUtil({ diaISO: "2026-09-11", minutoDoDia: 1100 }, JORNADA, excecoes)).toEqual(
      { diaISO: "2026-09-15", minutoDoDia: 480 },
    );
  });
});

describe("hora do dia como minuto, nunca DateTime", () => {
  it("formata e lê de volta o mesmo minuto", () => {
    expect(formatarMinutoDoDia(480)).toBe("08:00");
    expect(formatarMinutoDoDia(1020)).toBe("17:00");
    expect(formatarMinutoDoDia(0)).toBe("00:00");
    expect(formatarMinutoDoDia(MINUTOS_DO_DIA)).toBe("24:00");
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

describe("validação da configuração", () => {
  it("a jornada padrão é válida", () => {
    expect(validarConfiguracaoDeCalendario(JORNADA)).toEqual([]);
    expect(validarConfiguracaoDeCalendario(CALENDARIO_PADRAO)).toEqual([]);
  });

  it("fim antes do início é recusado", () => {
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, endMinuteOfDay: 300 })).toContain(
      "O horário final tem de ser depois do inicial.",
    );
  });

  it("início igual ao fim é recusado", () => {
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, endMinuteOfDay: 480 })).toContain(
      "O horário final tem de ser depois do inicial.",
    );
  });

  it("horário fora do dia é recusado", () => {
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, endMinuteOfDay: 1441 })).toContain(
      "Informe o horário inicial e o final entre 00:00 e 24:00.",
    );
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, startMinuteOfDay: -1 })).toContain(
      "Informe o horário inicial e o final entre 00:00 e 24:00.",
    );
  });

  it("intervalo negativo é recusado", () => {
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, breakMinutes: -1 })).toContain(
      "O intervalo é um número inteiro de minutos, nunca negativo.",
    );
  });

  it("intervalo igual ou maior que a jornada é recusado", () => {
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, breakMinutes: 540 })).toContain(
      "O intervalo tem de caber dentro da jornada.",
    );
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, breakMinutes: 600 })).toContain(
      "O intervalo tem de caber dentro da jornada.",
    );
  });

  it("nenhum dia operante é recusado", () => {
    const semDia: DiasOperantes = {
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    };
    expect(validarConfiguracaoDeCalendario({ ...JORNADA, weekdays: semDia })).toContain(
      "Selecione ao menos um dia operante.",
    );
  });
});
