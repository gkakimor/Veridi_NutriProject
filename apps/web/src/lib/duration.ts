import { Decimal } from "@veridi/shared";
import type { DecimalInstance } from "@veridi/shared";
import { formatQuantity } from "./quantity";

/**
 * Minutos de trabalho em leitura de gente — Perfil de Produção (§89).
 *
 * O motor devolve minutos como decimal-string canônica. A tela lê "30 min",
 * "3 h" e "6 h 30 min"; minuto fracionário aparece com até duas casas e
 * vírgula ("8,64 min"), porque arredondar para o minuto inteiro esconderia a
 * conta que a explicação ao lado mostra. Valor ausente ou ilegível vira
 * travessão, nunca zero.
 */

function ler(valor: string | number | null | undefined): DecimalInstance | null {
  if (valor === null || valor === undefined || valor === "") return null;
  try {
    const numero = new Decimal(valor);
    return numero.isFinite() && !numero.isNegative() ? numero : null;
  } catch {
    return null;
  }
}

/** Sem separador de milhar, como `formatQuantity`: "1000 h", nunca "1.000 h". */
const inteiro = (numero: DecimalInstance) => numero.toFixed(0);
const minutosComVirgula = (numero: DecimalInstance) => numero.toFixed().replace(".", ",");

export function formatMinutes(valor: string | number | null | undefined): string {
  const lido = ler(valor);
  if (!lido) return "—";
  const minutos = lido.toDecimalPlaces(2);
  const horas = minutos.dividedToIntegerBy(60);
  const resto = minutos.minus(horas.times(60));
  if (horas.isZero()) return `${minutosComVirgula(resto)} min`;
  if (resto.isZero()) return `${inteiro(horas)} h`;
  return `${inteiro(horas)} h ${minutosComVirgula(resto)} min`;
}

/**
 * Os mesmos minutos, sem converter em horas — é a forma que a explicação de
 * cálculo precisa para ser refeita à mão ("120 min × 3.000 ÷ 1.000").
 */
export function formatMinutesPlain(valor: string | number | null | undefined): string {
  const lido = ler(valor);
  return lido ? `${formatQuantity(lido.toFixed())} min` : "—";
}
