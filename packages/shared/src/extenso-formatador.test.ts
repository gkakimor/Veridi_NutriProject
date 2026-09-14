import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FUSO_COMERCIAL,
  dataCivilPorExtenso,
  diaDoInstantePorExtenso,
  instanteComercialPorExtenso,
} from "./business-timezone.js";

/**
 * `instanteComercialPorExtenso`, `diaDoInstantePorExtenso` e `dataCivilPorExtenso`
 * formatam num formatador guardado (TZ-LOCALE-STRING-REUSE-01).
 *
 * Antes eram `toLocaleString`/`toLocaleDateString` com `{ timeZone }`, que criam um
 * formatador por chamada. A troca é só de custo: o texto tem de ser o mesmo, caractere
 * a caractere — zeros à esquerda, vírgula, segundos, anos de três e cinco dígitos, as
 * viradas do horário de verão, a hora local média de antes de 1914, `"Invalid Date"` —,
 * com qualquer fuso no PROCESSO, trocado depois de o formatador já existir.
 */

// A implementação anterior, copiada.
const instanteAnterior = (instante: Date) => instante.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const diaDoInstanteAnterior = (instante: Date) =>
  instante.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dataCivilAnterior = (dia: Date) => dia.toLocaleDateString("pt-BR", { timeZone: "UTC" });

const PARES: [string, (data: Date) => string, (data: Date) => string][] = [
  ["instanteComercialPorExtenso", instanteComercialPorExtenso, instanteAnterior],
  ["diaDoInstantePorExtenso", diaDoInstantePorExtenso, diaDoInstanteAnterior],
  ["dataCivilPorExtenso", dataCivilPorExtenso, dataCivilAnterior],
];

/** Instantes fixos entre `de` e `ate` — o mesmo conjunto a cada execução. */
function amostraDeInstantes(tamanho: number, semente: number, de: number, ate: number): Date[] {
  let estado = semente;
  return Array.from({ length: tamanho }, () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return new Date(de + Math.floor((estado / 2147483648) * (ate - de)));
  });
}

const aoRedor = (iso: string, deltas: number[]) => deltas.map((delta) => new Date(new Date(iso).getTime() + delta));
const MS_EM_VOLTA = [-3_600_000, -60_000, -1_000, -1, 0, 1, 999, 1_000, 60_000, 3_600_000];

/**
 * Bordas: meia-noite UTC (a data civil) e meia-noite de São Paulo, ±1 ms; virada de mês
 * e de ano; 29/02; as viradas do horário de verão de São Paulo (2018/19), de Vancouver
 * (2026) e a hora local média de São Paulo trocada em 1914; epoch, 2038, 2100.
 */
const BORDAS = [
  "2026-09-15T00:00:00.000Z",
  "2026-09-15T03:00:00.000Z",
  "2026-12-31T00:00:00.000Z",
  "2027-01-01T02:59:59.999Z",
  "2027-01-01T03:00:00.000Z",
  "2024-02-29T00:00:00.000Z",
  "2018-11-04T03:00:00.000Z",
  "2019-02-17T02:00:00.000Z",
  "2026-03-08T10:00:00.000Z",
  "2026-11-01T09:00:00.000Z",
  "1914-01-01T03:06:28.000Z",
  "1900-01-01T00:00:00.000Z",
  "1970-01-01T00:00:00.000Z",
  "2038-01-19T03:14:07.000Z",
  "2100-01-01T00:00:00.000Z",
].flatMap((iso) => aoRedor(iso, MS_EM_VOLTA));

/** Cada minuto de uma hora em volta das viradas do horário de verão de São Paulo. */
const MINUTOS_DAS_VIRADAS = ["2018-11-04T03:00:00.000Z", "2019-02-17T02:00:00.000Z"].flatMap((iso) =>
  Array.from({ length: 121 }, (_, i) => new Date(new Date(iso).getTime() + (i - 60) * 60_000)),
);

const INSTANTES = [
  ...amostraDeInstantes(4000, 20260914, Date.UTC(1900, 0, 1), Date.UTC(2100, 11, 31, 23, 59, 59, 999)),
  ...amostraDeInstantes(1500, 777, Date.UTC(2020, 0, 1), Date.UTC(2035, 11, 31)),
  ...amostraDeInstantes(500, 4242, Date.UTC(1, 0, 1), Date.UTC(1899, 11, 31)),
  ...amostraDeInstantes(300, 99, Date.UTC(2101, 0, 1), Date.UTC(99999, 11, 31)),
  // Meia-noite UTC: é assim que a data civil chega.
  ...amostraDeInstantes(1000, 31337, Date.UTC(1900, 0, 1), Date.UTC(2100, 0, 1)).map(
    (instante) => new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth(), instante.getUTCDate())),
  ),
  ...BORDAS,
  ...MINUTOS_DAS_VIRADAS,
];

/** UTC (servidor), São Paulo, Vancouver (a máquina do laboratório), Tóquio e UTC-07 fixo. */
const FUSOS_DO_PROCESSO: [string, number][] = [
  ["UTC", 0],
  ["America/Sao_Paulo", 180],
  ["America/Vancouver", 420],
  ["Asia/Tokyo", -540],
  ["Etc/GMT+7", 420],
];

const PROCESSO_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (PROCESSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = PROCESSO_ORIGINAL;
});

/** Roda `conferir` em cada fuso do processo — com os formatadores já criados antes. */
function emCadaFusoDoProcesso(conferir: (fusoDoProcesso: string) => void) {
  for (const [, novo] of PARES) novo(new Date());
  for (const [fuso, deslocamento] of FUSOS_DO_PROCESSO) {
    process.env.TZ = fuso;
    // Sem isto o teste passaria sem ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00Z").getTimezoneOffset(), fuso).toBe(deslocamento);
    conferir(fuso);
  }
}

describe("mesmo texto que a implementação anterior", () => {
  it.each(PARES)("%s: amostra de 0001 a 99999, meia-noite UTC, bordas e viradas de verão", (_, novo, anterior) => {
    emCadaFusoDoProcesso((processo) => {
      const divergentes = INSTANTES.filter((instante) => novo(instante) !== anterior(instante));
      expect(divergentes.map((instante) => instante.toISOString()), `processo ${processo}`).toEqual([]);
    });
  });

  it.each(PARES)("%s: data inválida continua 'Invalid Date'", (_, novo, anterior) => {
    const invalida = new Date(Number.NaN);
    expect(anterior(invalida)).toBe("Invalid Date");
    expect(novo(invalida)).toBe("Invalid Date");
    expect(novo(new Date("abc"))).toBe(anterior(new Date("abc")));
  });
});

describe("valores escritos à mão", () => {
  it("instante e dia do instante em São Paulo, data civil em UTC", () => {
    const noite = new Date("2026-09-09T01:30:05.000Z"); // 08/09 às 22:30:05 em São Paulo
    expect(instanteComercialPorExtenso(noite)).toBe("08/09/2026, 22:30:05");
    expect(diaDoInstantePorExtenso(noite)).toBe("08/09/2026");
    expect(dataCivilPorExtenso(noite)).toBe("09/09/2026");
    expect(dataCivilPorExtenso(new Date("2026-09-15T00:00:00.000Z"))).toBe("15/09/2026");
    expect(instanteComercialPorExtenso(new Date("2026-01-01T03:00:00.000Z"))).toBe("01/01/2026, 00:00:00");
    // 16/02/2019 teve 25 horas: 23:00 repetida, com o segundo deslocamento.
    expect(instanteComercialPorExtenso(new Date("2019-02-17T01:59:59.000Z"))).toBe("16/02/2019, 23:59:59");
    expect(instanteComercialPorExtenso(new Date("2019-02-17T02:00:00.000Z"))).toBe("16/02/2019, 23:00:00");
    expect(FUSO_COMERCIAL).toBe("America/Sao_Paulo");
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
  it("um por forma e fuso: data e hora em São Paulo, dia em São Paulo, dia em UTC", async () => {
    vi.resetModules();
    const modulo = await import("./business-timezone.js");
    const instantes = INSTANTES.slice(0, 1000);

    expect(contarFormatadores(() => instantes.forEach((i) => modulo.instanteComercialPorExtenso(i)))).toBe(1);
    expect(contarFormatadores(() => instantes.forEach((i) => modulo.diaDoInstantePorExtenso(i)))).toBe(1);
    // Mesma forma do dia, outro fuso: outro formatador.
    expect(contarFormatadores(() => instantes.forEach((i) => modulo.dataCivilPorExtenso(i)))).toBe(1);
    expect(
      contarFormatadores(() => {
        for (const instante of instantes) {
          modulo.instanteComercialPorExtenso(instante);
          modulo.diaDoInstantePorExtenso(instante);
          modulo.dataCivilPorExtenso(instante);
        }
        modulo.dataCivilPorExtenso(new Date(Number.NaN));
      }),
    ).toBe(0);
    // O dia civil do `diaCivil` é outra forma (`YYYY-MM-DD`): não divide formatador.
    expect(contarFormatadores(() => modulo.diaCivil(instantes[0]!, FUSO_COMERCIAL))).toBe(1);

    for (const instante of instantes.slice(0, 50)) {
      expect(modulo.instanteComercialPorExtenso(instante)).toBe(instanteAnterior(instante));
      expect(modulo.dataCivilPorExtenso(instante)).toBe(dataCivilAnterior(instante));
    }
  });
});
