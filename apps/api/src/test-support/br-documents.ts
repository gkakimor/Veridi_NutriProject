/**
 * Geradores de documentos brasileiros válidos para fixtures.
 *
 * Existe porque o CNPJ passou a ter dígito verificador conferido: um número
 * montado com `Date.now()` deixou de ser aceito, e a alternativa — fixar
 * um punhado de CNPJs literais — quebra os testes que precisam de
 * unicidade entre execuções.
 */

const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(chars: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < chars.length; i += 1) {
    sum += (chars.charCodeAt(i) - 48) * weights[i]!;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Completa uma base de 12 posições com os dois dígitos verificadores. */
export function withCheckDigits(base12: string): string {
  if (base12.length !== 12) {
    throw new Error(`base de CNPJ precisa de 12 posições, recebeu ${base12.length}`);
  }
  const dv1 = checkDigit(base12, DV1_WEIGHTS);
  const dv2 = checkDigit(`${base12}${dv1}`, DV2_WEIGHTS);
  return `${base12}${dv1}${dv2}`;
}

let sequence = 0;

/** CNPJ numérico válido e distinto a cada chamada. */
export function uniqueCnpj(): string {
  sequence += 1;
  const base = `${Date.now()}${sequence}`.slice(-12).padStart(12, "1");
  return withCheckDigits(base);
}

/** CNPJ alfanumérico válido e distinto — letras nas posições permitidas. */
export function uniqueAlphanumericCnpj(): string {
  sequence += 1;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const suffix = `${Date.now()}${sequence}`.slice(-6);
  const root = `${letters[sequence % 26]}${letters[(sequence + 7) % 26]}`;
  return withCheckDigits(`${root}${suffix}${"0000"}`.slice(0, 12));
}

/** `00000000000000` → `00.000.000/0000-00`, com letras quando houver. */
export function maskCnpj(value: string): string {
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12, 14)}`;
}
