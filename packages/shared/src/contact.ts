/**
 * E-mail e telefone brasileiro — normalização, validação e máscara,
 * compartilhados entre `apps/api` e `apps/web`.
 *
 * Regra de fronteira: a máscara é apresentação, a validação é regra. O
 * servidor revalida tudo o que a tela já validou, porque a máscara pode ser
 * contornada e o formulário não é a única porta de entrada.
 */

/**
 * Formato de e-mail, não existência da caixa postal.
 *
 * Deliberadamente prático em vez de RFC 5322 completo: exige exatamente um
 * `@`, parte local e domínio sem espaço, e um domínio com ponto e TLD de pelo
 * menos duas letras. Endereço sintaticamente exótico e válido pela RFC é raro
 * no cadastro de clientes; erro de digitação é o caso comum.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length === 0 || email.length > 200) return false;
  return EMAIL_PATTERN.test(email);
}

/** DDDs efetivamente em uso no Brasil. "10" e "20" não são DDD de ninguém. */
const BR_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Remove tudo que não for dígito — espaço, parênteses e hífen entram. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Telefone brasileiro **com DDD**: 10 dígitos (fixo) ou 11 (celular).
 *
 * No celular a nona posição é obrigatoriamente `9`, e no fixo o primeiro
 * dígito do número fica entre 2 e 5 — é o que separa um telefone de uma
 * sequência qualquer de dez dígitos.
 */
export function isValidBrPhone(value: string): boolean {
  const digits = normalizePhone(value);
  if (digits.length !== 10 && digits.length !== 11) return false;

  const areaCode = Number(digits.slice(0, 2));
  if (!BR_AREA_CODES.has(areaCode)) return false;

  const subscriber = digits.slice(2);
  if (subscriber.length === 9) return subscriber.startsWith("9");
  return /^[2-5]/.test(subscriber);
}

/** `1133334444` → `(11) 3333-4444`; `11999998888` → `(11) 99999-8888`. */
export function formatBrPhone(value: string | null): string | null {
  if (!value) return value;
  const digits = normalizePhone(value);
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return value;
}

/** Máscara progressiva para digitação, sem exigir o número completo. */
export function maskPhoneInput(raw: string): string {
  const digits = normalizePhone(raw).slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const areaCode = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${areaCode}) ${rest}`;
  if (rest.length <= 8) return `(${areaCode}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${areaCode}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** Remove tudo que não for dígito. O CEP é guardado só com dígitos. */
export function normalizeZipCode(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Máscara progressiva de CEP: `04816100` → `04816-100`. */
export function maskZipCodeInput(raw: string): string {
  const digits = normalizeZipCode(raw).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
