import { afterEach, describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatEventDate } from "./dates";

/**
 * `formatDate`, `formatDateTime` e `formatEventDate` deixaram de criar um formatador por
 * data (TZ-LOCALE-STRING-REUSE-01). O texto e o fallback são os de antes, com qualquer
 * fuso no navegador — inclusive o fallback de `formatDate` para valor com hora, que
 * segue no fuso de quem lê.
 */

// A implementação anterior, copiada.
function isDateOnlyAnterior(value: string): boolean {
  return /T00:00:00(\.000)?Z$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function formatDateAnterior(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", isDateOnlyAnterior(value) ? { timeZone: "UTC" } : {});
}
function formatDateTimeAnterior(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function formatEventDateAnterior(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function amostraDeInstantes(tamanho: number, semente: number, de: number, ate: number): Date[] {
  let estado = semente;
  return Array.from({ length: tamanho }, () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return new Date(de + Math.floor((estado / 2147483648) * (ate - de)));
  });
}

const aoRedor = (iso: string) =>
  [-3_600_000, -1, 0, 1, 3_600_000].map((delta) => new Date(new Date(iso).getTime() + delta).toISOString());

const instantes = [
  ...amostraDeInstantes(1500, 20260914, Date.UTC(1900, 0, 1), Date.UTC(2100, 11, 31)),
  ...amostraDeInstantes(500, 7, Date.UTC(2024, 0, 1), Date.UTC(2030, 11, 31)),
];

const VALORES: (string | null | undefined)[] = [
  // Instantes em ISO, com e sem milissegundos.
  ...instantes.map((instante) => instante.toISOString()),
  ...instantes.slice(0, 200).map((instante) => instante.toISOString().replace(".000Z", "Z")),
  // Data de documento: meia-noite UTC completa, sem milissegundos e curta.
  ...instantes.map((instante) => `${instante.toISOString().slice(0, 10)}T00:00:00.000Z`),
  ...instantes.slice(0, 200).map((instante) => `${instante.toISOString().slice(0, 10)}T00:00:00Z`),
  ...instantes.map((instante) => instante.toISOString().slice(0, 10)),
  // Virada do dia em São Paulo e em UTC; horário de verão de São Paulo, Vancouver e Tóquio (sem).
  ...aoRedor("2026-09-15T03:00:00.000Z"),
  ...aoRedor("2026-09-15T00:00:00.000Z"),
  ...aoRedor("2018-11-04T03:00:00.000Z"),
  ...aoRedor("2019-02-17T02:00:00.000Z"),
  ...aoRedor("2026-03-08T10:00:00.000Z"),
  ...aoRedor("2026-11-01T09:00:00.000Z"),
  ...aoRedor("1914-01-01T03:06:28.000Z"),
  // Com deslocamento escrito, e o que não é data.
  "2026-09-08T22:30:00-03:00",
  "2026-09-08T00:00:00+09:00",
  "2026-02-30",
  "abc",
  "",
  null,
  undefined,
];

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

const PARES: [string, (v: string | null | undefined) => string, (v: string | null | undefined) => string][] = [
  ["formatDate", formatDate, formatDateAnterior],
  ["formatDateTime", formatDateTime, formatDateTimeAnterior],
  ["formatEventDate", formatEventDate, formatEventDateAnterior],
];

describe("mesmo texto que a implementação anterior", () => {
  it.each(PARES)("%s: instantes, datas de documento, bordas e inválidos em cada fuso do navegador", (_, novo, anterior) => {
    for (const valor of VALORES) novo(valor);
    for (const [fuso, deslocamento] of FUSOS_DO_PROCESSO) {
      process.env.TZ = fuso;
      expect(new Date("2026-09-12T12:00:00Z").getTimezoneOffset(), fuso).toBe(deslocamento);
      const divergentes = VALORES.filter((valor) => novo(valor) !== anterior(valor));
      expect(divergentes, `navegador em ${fuso}`).toEqual([]);
    }
  });

  it("valores escritos à mão", () => {
    process.env.TZ = "America/Vancouver";
    expect(formatDate("2026-09-15")).toBe("15/09/2026");
    expect(formatDate("2026-09-15T00:00:00.000Z")).toBe("15/09/2026");
    // Com hora, o fallback é o fuso de quem lê: 08/09 às 15:30 em Vancouver.
    expect(formatDate("2026-09-08T22:30:00.000Z")).toBe("08/09/2026");
    expect(formatDateTime("2026-09-09T01:30:00.000Z")).toBe("08/09/2026, 22:30:00");
    expect(formatEventDate("2026-09-09T01:30:00.000Z")).toBe("08/09/2026");
    process.env.TZ = "Asia/Tokyo";
    expect(formatDate("2026-09-08T22:30:00.000Z")).toBe("09/09/2026");
    for (const [, novo] of PARES) {
      expect(novo("abc")).toBe("—");
      expect(novo(null)).toBe("—");
    }
  });
});
