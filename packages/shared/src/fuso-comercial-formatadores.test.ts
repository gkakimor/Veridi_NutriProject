import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FUSO_COMERCIAL,
  diaCivil,
  fimExclusivoDoDiaComercial,
  inicioDoDiaComercial,
  instanteComercial,
  limitesDeDiasComerciais,
  limitesDoDiaComercial,
  minutoDoDiaComercial,
} from "./business-timezone.js";

/**
 * `instanteComercial`, `minutoDoDiaComercial` e `limitesDoDiaComercial` reaproveitam
 * o formatador do fuso (TZ-FORMATTER-REUSE-01), como `diaCivil` já fazia
 * (`dia-civil-formatador.test.ts`).
 *
 * Cada chamada criava um `Intl.DateTimeFormat` — quatro por limite de dia. A troca é
 * só de custo: cada resultado tem de ser o da implementação anterior, ao
 * milissegundo — nas bordas do dia, nas viradas do horário de verão de São Paulo, em
 * anos antigos e futuros, e com o fuso do PROCESSO trocado depois de o formatador
 * já existir.
 */

// A implementação anterior, copiada: um formatador novo por chamada.

function deslocamentoAnterior(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  const comoSeFosseUTC = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour") % 24,
    valor("minute"),
    valor("second"),
  );
  return comoSeFosseUTC - Math.floor(instante.getTime() / 1000) * 1000;
}

function meiaNoiteAnterior(diaISO: string): Date {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const palpite = Date.UTC(ano, mes - 1, dia, 0, 0, 0, 0);
  const primeiro = deslocamentoAnterior(new Date(palpite), FUSO_COMERCIAL);
  const segundo = deslocamentoAnterior(new Date(palpite - primeiro), FUSO_COMERCIAL);
  return new Date(palpite - segundo);
}

function instanteComercialAnterior(diaISO: string, minutoDoDia: number): Date {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const palpite = Date.UTC(ano, mes - 1, dia, 0, minutoDoDia, 0, 0);
  const primeiro = deslocamentoAnterior(new Date(palpite), FUSO_COMERCIAL);
  const segundo = deslocamentoAnterior(new Date(palpite - primeiro), FUSO_COMERCIAL);
  return new Date(palpite - segundo);
}

function minutoDoDiaComercialAnterior(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_COMERCIAL,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return (valor("hour") % 24) * 60 + valor("minute");
}

function diaCivilDeslocadoAnterior(diaISO: string, dias: number): string {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function limitesDoDiaComercialAnterior(diaISO: string): { inicio: Date; fim: Date } {
  return {
    inicio: meiaNoiteAnterior(diaISO),
    fim: new Date(meiaNoiteAnterior(diaCivilDeslocadoAnterior(diaISO, 1)).getTime() - 1),
  };
}

function diaCivilNovoFormatador(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

// Amostras e bordas.

/** Instantes fixos entre `de` e `ate` — o mesmo conjunto a cada execução. */
function amostraDeInstantes(
  tamanho: number,
  semente: number,
  de = Date.UTC(1900, 0, 1),
  ate = Date.UTC(2100, 11, 31, 23, 59, 59, 999),
): Date[] {
  let estado = semente;
  return Array.from({ length: tamanho }, () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return new Date(de + Math.floor((estado / 2147483648) * (ate - de)));
  });
}

const diaDe = (instante: Date) => instante.toISOString().slice(0, 10);

/**
 * Dias de borda: meio de ano, virada de mês e de ano, 29/02; as duas viradas do
 * horário de verão de 2018/19 (04/11/2018 pulou a meia-noite, 16/02/2019 teve 25
 * horas) e seus vizinhos; a troca da hora local média em 1914; anos futuros.
 */
const DIAS_DE_BORDA = [
  "2026-09-13",
  "2026-09-30",
  "2026-12-31",
  "2027-01-01",
  "2024-02-29",
  "2018-11-03",
  "2018-11-04",
  "2018-11-05",
  "2018-11-15",
  "2019-02-15",
  "2019-02-16",
  "2019-02-17",
  "1913-12-31",
  "1914-01-01",
  "1900-01-01",
  "1969-12-31",
  "1970-01-01",
  "2038-01-19",
  "2099-12-31",
  "2100-01-01",
];

/** 00:00, 00:01, a hora que o verão pulava, meio-dia, 23:00 repetida, 23:59 e 24:00. */
const MINUTOS_DE_BORDA = [0, 1, 59, 60, 61, 120, 180, 720, 1380, 1438, 1439, 1440];

/** O último ms da véspera, 00:00, 00:01, 23:59, o último ms do dia e 00:00 do seguinte. */
function instantesDeBorda(): Date[] {
  return DIAS_DE_BORDA.flatMap((dia) => {
    const { inicio, fim } = limitesDoDiaComercialAnterior(dia);
    return [
      new Date(inicio.getTime() - 1),
      inicio,
      new Date(inicio.getTime() + 60_000),
      new Date(fim.getTime() - 59_999),
      fim,
      new Date(fim.getTime() + 1),
    ];
  });
}

/** As viradas do horário de verão de 2018/19, ao milissegundo, e uma hora em volta. */
const VIRADAS_DE_VERAO = ["2018-11-04T03:00:00.000Z", "2019-02-17T02:00:00.000Z"].flatMap((virada) =>
  [-3_600_000, -60_000, -1, 0, 1, 60_000, 3_600_000].map((delta) => new Date(new Date(virada).getTime() + delta)),
);

/** UTC (servidor), São Paulo, UTC-07 fixo e Vancouver (a máquina do laboratório). */
const FUSOS_DO_PROCESSO: [string, number][] = [
  ["UTC", 0],
  ["America/Sao_Paulo", 180],
  ["Etc/GMT+7", 420],
  ["America/Vancouver", 420],
];

const PROCESSO_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (PROCESSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = PROCESSO_ORIGINAL;
});

/** Roda `conferir` em cada fuso do processo — com os formatadores já criados antes. */
function emCadaFusoDoProcesso(conferir: (fusoDoProcesso: string) => void) {
  instanteComercial("2026-09-13", 480);
  minutoDoDiaComercial(new Date());
  for (const [fuso, deslocamento] of FUSOS_DO_PROCESSO) {
    process.env.TZ = fuso;
    // Sem isto o teste passaria sem ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00Z").getTimezoneOffset(), fuso).toBe(deslocamento);
    conferir(fuso);
  }
}

describe("mesmo resultado que a implementação anterior", () => {
  it("instanteComercial: amostra de 1900 a 2100, dias e minutos de borda, anos extremos", () => {
    const dias = amostraDeInstantes(1000, 20260913).map(diaDe);
    const extremos = amostraDeInstantes(200, 424242, Date.UTC(1700, 0, 1), Date.UTC(2500, 11, 31)).map(diaDe);
    const pares: [string, number][] = [
      ...dias.map((dia, i): [string, number] => [dia, (i * 97) % 1441]),
      ...extremos.map((dia, i): [string, number] => [dia, (i * 131) % 1441]),
      ...DIAS_DE_BORDA.flatMap((dia) => MINUTOS_DE_BORDA.map((minuto): [string, number] => [dia, minuto])),
    ];
    emCadaFusoDoProcesso((processo) => {
      const divergentes = pares.filter(
        ([dia, minuto]) => instanteComercial(dia, minuto).getTime() !== instanteComercialAnterior(dia, minuto).getTime(),
      );
      expect(divergentes, `processo ${processo}`).toEqual([]);
    });
  });

  it("instanteComercial: cada minuto dos dias das viradas do horário de verão", () => {
    const pares = ["2018-11-04", "2019-02-16"].flatMap((dia) =>
      Array.from({ length: 1441 }, (_, minuto): [string, number] => [dia, minuto]),
    );
    const divergentes = pares.filter(
      ([dia, minuto]) => instanteComercial(dia, minuto).getTime() !== instanteComercialAnterior(dia, minuto).getTime(),
    );
    expect(divergentes).toEqual([]);
  });

  it("minutoDoDiaComercial: amostra, 00:00, 23:59, virada do dia e do horário de verão", () => {
    const instantes = [
      ...amostraDeInstantes(2000, 777),
      ...amostraDeInstantes(200, 99, Date.UTC(1700, 0, 1), Date.UTC(2500, 11, 31)),
      ...instantesDeBorda(),
      ...VIRADAS_DE_VERAO,
    ];
    emCadaFusoDoProcesso((processo) => {
      const divergentes = instantes.filter(
        (instante) => minutoDoDiaComercial(instante) !== minutoDoDiaComercialAnterior(instante),
      );
      expect(divergentes.map((instante) => instante.toISOString()), `processo ${processo}`).toEqual([]);
    });
  });

  it("limitesDoDiaComercial: início inclusivo e fim, ao milissegundo", () => {
    const dias = [
      ...amostraDeInstantes(1000, 31337).map(diaDe),
      ...amostraDeInstantes(200, 4242, Date.UTC(1700, 0, 1), Date.UTC(2500, 11, 31)).map(diaDe),
      ...DIAS_DE_BORDA,
    ];
    emCadaFusoDoProcesso((processo) => {
      const divergentes = dias.filter((dia) => {
        const novo = limitesDoDiaComercial(dia);
        const anterior = limitesDoDiaComercialAnterior(dia);
        return (
          Object.keys(novo).join() !== "inicio,fim" ||
          novo.inicio.getTime() !== anterior.inicio.getTime() ||
          novo.fim.getTime() !== anterior.fim.getTime()
        );
      });
      expect(divergentes, `processo ${processo}`).toEqual([]);
    });
  });

  it("os derivados do limite do dia seguem a mesma conta", () => {
    for (const dia of DIAS_DE_BORDA) {
      const anterior = limitesDoDiaComercialAnterior(dia);
      expect(inicioDoDiaComercial(dia).getTime(), dia).toBe(anterior.inicio.getTime());
      expect(fimExclusivoDoDiaComercial(dia).getTime(), dia).toBe(anterior.fim.getTime() + 1);
    }
    const agora = new Date("2026-09-14T02:30:00.000Z"); // 13/09 às 23:30 em São Paulo
    const semana = limitesDeDiasComerciais(7, agora);
    expect(semana.inicio.getTime()).toBe(limitesDoDiaComercialAnterior("2026-09-07").inicio.getTime());
    expect(semana.fim.getTime()).toBe(limitesDoDiaComercialAnterior("2026-09-13").fim.getTime());
  });

  it("entrada inválida continua lançando o mesmo erro", () => {
    for (const [dia, minuto] of [["abc", 0], ["", 480], ["2026-09-13", Number.NaN]] as [string, number][]) {
      expect(() => instanteComercialAnterior(dia, minuto)).toThrow(RangeError);
      expect(() => instanteComercial(dia, minuto)).toThrow(RangeError);
    }
    expect(() => limitesDoDiaComercialAnterior("abc")).toThrow(RangeError);
    expect(() => limitesDoDiaComercial("abc")).toThrow(RangeError);
    expect(() => minutoDoDiaComercial(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("valores escritos à mão", () => {
  it("o dia comercial de hoje: 00:00, 23:59 e 24:00 em São Paulo", () => {
    expect(instanteComercial("2026-09-13", 0).toISOString()).toBe("2026-09-13T03:00:00.000Z");
    expect(instanteComercial("2026-09-13", 1439).toISOString()).toBe("2026-09-14T02:59:00.000Z");
    expect(instanteComercial("2026-09-13", 1440).toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(minutoDoDiaComercial(new Date("2026-09-13T03:00:00.000Z"))).toBe(0);
    expect(minutoDoDiaComercial(new Date("2026-09-14T02:59:59.999Z"))).toBe(1439);
  });

  it("horário de verão: o relógio pulou 00:00 em 04/11/2018 e repetiu 23:00 em 16/02/2019", () => {
    expect(instanteComercial("2018-11-15", 480).toISOString()).toBe("2018-11-15T10:00:00.000Z");
    expect(minutoDoDiaComercial(new Date("2018-11-04T02:59:59.999Z"))).toBe(1439);
    expect(minutoDoDiaComercial(new Date("2018-11-04T03:00:00.000Z"))).toBe(60);
    expect(minutoDoDiaComercial(new Date("2019-02-17T01:59:59.999Z"))).toBe(1439);
    expect(minutoDoDiaComercial(new Date("2019-02-17T02:00:00.000Z"))).toBe(1380);
    const { inicio, fim } = limitesDoDiaComercial("2019-02-16");
    expect(inicio.toISOString()).toBe("2019-02-16T02:00:00.000Z");
    expect(fim.toISOString()).toBe("2019-02-17T02:59:59.999Z");
  });
});

/** Quantos `Intl.DateTimeFormat` `fazer` cria. */
function contarFormatadores(fazer: () => void): number {
  const Original = Intl.DateTimeFormat;
  let criados = 0;
  const Contado = function (...argumentos: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    criados += 1;
    return new Original(...argumentos);
  } as unknown as typeof Intl.DateTimeFormat;
  Intl.DateTimeFormat = Contado;
  try {
    fazer();
  } finally {
    Intl.DateTimeFormat = Original;
  }
  return criados;
}

describe("o formatador é reaproveitado", () => {
  it("um por forma de leitura: o relógio dos limites e dos instantes, a hora do minuto, o dia", async () => {
    vi.resetModules();
    const modulo = await import("./business-timezone.js");
    const dias = amostraDeInstantes(1000, 1).map(diaDe);
    const instantes = amostraDeInstantes(1000, 2);

    expect(contarFormatadores(() => dias.forEach((dia) => modulo.limitesDoDiaComercial(dia)))).toBe(1);
    expect(contarFormatadores(() => dias.forEach((dia) => modulo.instanteComercial(dia, 480)))).toBe(0);
    // Hora e minuto não é o relógio: opções diferentes, formatador próprio.
    expect(contarFormatadores(() => instantes.forEach((instante) => modulo.minutoDoDiaComercial(instante)))).toBe(1);
    expect(contarFormatadores(() => instantes.forEach((instante) => modulo.diaCivil(instante, FUSO_COMERCIAL)))).toBe(1);
    expect(
      contarFormatadores(() => {
        for (const dia of dias) {
          modulo.limitesDoDiaComercial(dia);
          modulo.instanteComercial(dia, 0);
        }
        for (const instante of instantes) {
          modulo.minutoDoDiaComercial(instante);
          modulo.diaCivil(instante, FUSO_COMERCIAL);
        }
      }),
    ).toBe(0);

    for (const instante of instantes.slice(0, 50)) {
      expect(modulo.minutoDoDiaComercial(instante)).toBe(minutoDoDiaComercialAnterior(instante));
      expect(modulo.diaCivil(instante, FUSO_COMERCIAL)).toBe(diaCivilNovoFormatador(instante, FUSO_COMERCIAL));
    }
    for (const dia of dias.slice(0, 50)) {
      expect(modulo.limitesDoDiaComercial(dia).fim.getTime()).toBe(limitesDoDiaComercialAnterior(dia).fim.getTime());
    }
  });

  it("guarda no máximo 16 fusos por forma; do 17º em diante cria a cada chamada, com o mesmo dia", async () => {
    vi.resetModules();
    const modulo = await import("./business-timezone.js");
    const instante = new Date("2026-09-14T02:30:00.000Z");
    const fusos = Intl.supportedValuesOf("timeZone").slice(0, 17);
    expect(fusos).toHaveLength(17);

    // Fuso inválido lança todas as vezes e não ocupa lugar.
    for (let i = 0; i < 20; i++) expect(() => modulo.diaCivil(instante, "America/Nao_Existe")).toThrow(RangeError);

    expect(contarFormatadores(() => fusos.slice(0, 16).forEach((fuso) => modulo.diaCivil(instante, fuso)))).toBe(16);
    expect(contarFormatadores(() => fusos.slice(0, 16).forEach((fuso) => modulo.diaCivil(instante, fuso)))).toBe(0);
    expect(contarFormatadores(() => [1, 2, 3].forEach(() => modulo.diaCivil(instante, fusos[16]!)))).toBe(3);
    // O mesmo fuso escrito de outro jeito é outro nome: fica fora, não cresce o mapa.
    expect(contarFormatadores(() => [1, 2, 3].forEach(() => modulo.diaCivil(instante, "america/sao_paulo")))).toBe(3);

    expect(modulo.diaCivil(instante, "america/sao_paulo")).toBe("2026-09-13");
    for (const fuso of fusos) expect(modulo.diaCivil(instante, fuso), fuso).toBe(diaCivilNovoFormatador(instante, fuso));
    // As outras formas não dividem o limite do dia.
    expect(contarFormatadores(() => modulo.minutoDoDiaComercial(instante))).toBe(1);
    expect(modulo.minutoDoDiaComercial(instante)).toBe(1410);
  });
});
