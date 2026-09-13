import { afterEach, describe, expect, it } from "vitest";
import { FUSO_COMERCIAL, diaCivil, hojeComercial, limitesDoDiaComercial } from "./business-timezone.js";

/**
 * `diaCivil` reaproveita o formatador do fuso (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * Criava um `Intl.DateTimeFormat` a cada chamada. A troca é só de custo: o dia
 * de cada instante, em cada fuso, tem de ser exatamente o que a implementação
 * anterior dizia — nas bordas do dia, na virada do horário de verão, com
 * deslocamento de meia hora e com o fuso do PROCESSO mudando depois de o
 * formatador já existir.
 */

/** A implementação anterior, copiada: um formatador novo por chamada. */
function diaCivilAnterior(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/** UTC, UTC-07 fixo e com horário de verão, São Paulo, e deslocamentos fracionários. */
const FUSOS = ["UTC", "Etc/GMT+7", "America/Vancouver", FUSO_COMERCIAL, "Asia/Kolkata", "Pacific/Chatham", "Asia/Tokyo"];

const PROCESSO_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (PROCESSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = PROCESSO_ORIGINAL;
});

/** Amostra fixa de 1900 a 2100 — o mesmo conjunto a cada execução. */
function amostra(tamanho: number): Date[] {
  let semente = 20260913;
  const inicio = Date.UTC(1900, 0, 1);
  const fim = Date.UTC(2100, 11, 31);
  return Array.from({ length: tamanho }, () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return new Date(inicio + Math.floor((semente / 2147483648) * (fim - inicio)));
  });
}

/**
 * As duas viradas do horário de verão de São Paulo em 2018/19, em instantes
 * escritos à mão: 04/11/2018 começou à 01:00 (GMT-2) e 16/02/2019 teve 25 horas
 * (às 00:00 de 17/02 o relógio voltou para 23:00 de 16/02).
 */
const VIRADAS_DE_VERAO: [string, string][] = [
  ["2018-11-04T02:59:59.999Z", "2018-11-03"],
  ["2018-11-04T03:00:00.000Z", "2018-11-04"],
  ["2018-11-05T01:59:59.999Z", "2018-11-04"],
  ["2018-11-05T02:00:00.000Z", "2018-11-05"],
  ["2019-02-17T01:59:59.999Z", "2019-02-16"],
  ["2019-02-17T02:00:00.000Z", "2019-02-16"],
  ["2019-02-17T02:59:59.999Z", "2019-02-16"],
  ["2019-02-17T03:00:00.000Z", "2019-02-17"],
];

/**
 * Bordas do dia comercial: o último milissegundo da véspera, o primeiro do dia,
 * o último do dia e o primeiro do seguinte — meio de ano, virada de mês e de ano
 * —, mais as viradas do horário de verão.
 */
function bordas(): Date[] {
  const dias = ["2026-09-13", "2026-09-30", "2026-12-31", "2027-01-01"];
  return [
    ...dias.flatMap((dia) => {
      const { inicio, fim } = limitesDoDiaComercial(dia);
      return [new Date(inicio.getTime() - 1), inicio, fim, new Date(fim.getTime() + 1)];
    }),
    ...VIRADAS_DE_VERAO.map(([instante]) => new Date(instante)),
  ];
}

describe("mesmo dia que a implementação anterior", () => {
  it("bordas do dia comercial, em cada fuso", () => {
    for (const fuso of FUSOS) {
      for (const instante of bordas()) {
        expect(diaCivil(instante, fuso), `${instante.toISOString()} em ${fuso}`).toBe(diaCivilAnterior(instante, fuso));
      }
    }
  });

  it("as bordas em São Paulo caem no dia certo — inclusive na virada do horário de verão", () => {
    for (const [instante, dia] of VIRADAS_DE_VERAO) {
      expect(diaCivil(new Date(instante), FUSO_COMERCIAL), instante).toBe(dia);
    }
    expect(hojeComercial(new Date("2026-09-13T02:59:59.999Z"))).toBe("2026-09-12");
    expect(hojeComercial(new Date("2026-09-13T03:00:00.000Z"))).toBe("2026-09-13");
  });

  it("amostra grande de instantes, em cada fuso", () => {
    const instantes = amostra(4000);
    for (const fuso of FUSOS) {
      const divergentes = instantes.filter((instante) => diaCivil(instante, fuso) !== diaCivilAnterior(instante, fuso));
      expect(divergentes.map((instante) => instante.toISOString()), fuso).toEqual([]);
    }
  });

  it("o fuso do processo não entra: formatador criado num TZ responde igual em outro", () => {
    const instantes = [...bordas(), ...amostra(300)];
    // Formatadores já criados antes de o processo trocar de fuso.
    for (const fuso of FUSOS) diaCivil(instantes[0]!, fuso);
    for (const processo of ["UTC", "America/Vancouver", "America/Sao_Paulo"]) {
      process.env.TZ = processo;
      for (const fuso of FUSOS) {
        for (const instante of instantes) {
          expect(diaCivil(instante, fuso), `processo ${processo}, ${fuso}`).toBe(diaCivilAnterior(instante, fuso));
        }
      }
    }
  });

  it("sai `YYYY-MM-DD`, sempre", () => {
    for (const fuso of FUSOS) {
      for (const instante of amostra(200)) expect(diaCivil(instante, fuso)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("o formatador é reaproveitado", () => {
  it("mil dias num fuso novo criam um formatador, e o fuso já usado não cria nenhum", () => {
    const Original = Intl.DateTimeFormat;
    let criados = 0;
    const Contado = function (this: unknown, ...argumentos: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      criados += 1;
      return new Original(...argumentos);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = Contado;
    try {
      const instantes = amostra(1000);
      for (const instante of instantes) diaCivil(instante, "Asia/Kathmandu");
      expect(criados).toBe(1);

      criados = 0;
      diaCivil(instantes[0]!, FUSO_COMERCIAL); // garante que já existe
      criados = 0;
      for (const instante of instantes) diaCivil(instante, FUSO_COMERCIAL);
      expect(criados).toBe(0);
    } finally {
      Intl.DateTimeFormat = Original;
    }
  });

  it("fuso inválido continua recusado, e não vira formatador guardado", () => {
    expect(() => diaCivil(new Date(), "America/Nao_Existe")).toThrow(RangeError);
    expect(() => diaCivil(new Date(), "America/Nao_Existe")).toThrow(RangeError);
  });
});
