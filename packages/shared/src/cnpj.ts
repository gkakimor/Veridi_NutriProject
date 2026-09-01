/**
 * Normalização, formatação e validação de CNPJ, compartilhada entre
 * `apps/api` e `apps/web`.
 *
 * Desde a IN RFB nº 2.229/2024 o CNPJ tem duas formas em circulação ao mesmo
 * tempo, e as duas precisam funcionar:
 *
 * - **numérico** — os 14 dígitos de sempre (`11.222.333/0001-81`);
 * - **alfanumérico** — as 12 primeiras posições podem conter letras
 *   (`00.000.000/E08G-12`). Os 2 dígitos verificadores continuam numéricos.
 *
 * O DV usa o mesmo módulo 11 de sempre; o que muda é o valor de cada
 * posição, que passa a ser `código ASCII − 48`. Isso mantém `'0'..'9'` em
 * `0..9` e coloca `'A'..'Z'` em `17..42` — por isso o numérico é apenas um
 * caso particular do alfanumérico, e um único algoritmo atende aos dois.
 */

/** Posições da raiz + ordem, onde letras são permitidas. */
const BASE_LENGTH = 12;
/** Dígitos verificadores, sempre numéricos. */
const DV_LENGTH = 2;
export const CNPJ_LENGTH = BASE_LENGTH + DV_LENGTH;

const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Remove a pontuação e padroniza em maiúsculas, preservando letras.
 *
 * Nunca usar `replace(/\D/g, "")` aqui: descartar letras transformaria um
 * CNPJ alfanumérico válido em lixo de 8 caracteres, e o registro seria salvo
 * com uma identidade que não é a dele.
 */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Valor da posição no cálculo do DV: ASCII − 48 (`'0'`→0, `'A'`→17). */
function positionValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function checkDigit(chars: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < chars.length; i += 1) {
    sum += positionValue(chars[i]!) * weights[i]!;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * `true` para CNPJ numérico ou alfanumérico com dígitos verificadores
 * corretos. Espera o valor já normalizado (ou aceita formatado).
 *
 * Rejeita repetição total (`00000000000000`, `AAAAAAAAAAAA00`): passa no
 * módulo 11 em alguns casos e não é CNPJ de ninguém.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== CNPJ_LENGTH) return false;

  const base = cnpj.slice(0, BASE_LENGTH);
  const dv = cnpj.slice(BASE_LENGTH);

  if (!/^[0-9A-Z]{12}$/.test(base)) return false;
  if (!/^\d{2}$/.test(dv)) return false;
  if (new Set(base).size === 1) return false;

  const dv1 = checkDigit(base, DV1_WEIGHTS);
  if (dv1 !== Number(dv[0])) return false;

  const dv2 = checkDigit(base + String(dv1), DV2_WEIGHTS);
  return dv2 === Number(dv[1]);
}

/**
 * `00000000E08G12` → `00.000.000/E08G-12`. Retorna a entrada quando não tem
 * 14 posições — formatar um valor incompleto esconderia o erro do operador.
 */
export function formatCnpj(value: string): string {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== CNPJ_LENGTH) return value;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

/**
 * Máscara progressiva para digitação: formata o que já foi digitado sem
 * exigir o CNPJ completo.
 */
export function maskCnpjInput(raw: string): string {
  const cnpj = normalizeCnpj(raw).slice(0, CNPJ_LENGTH);
  if (cnpj.length <= 2) return cnpj;
  if (cnpj.length <= 5) return `${cnpj.slice(0, 2)}.${cnpj.slice(2)}`;
  if (cnpj.length <= 8) return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5)}`;
  if (cnpj.length <= 12) {
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8)}`;
  }
  return formatCnpj(cnpj);
}
