/** Normalização/formatação de CNPJ, compartilhada entre `apps/api` e `apps/web`. */

/** Remove tudo que não for dígito. */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `00000000000000` → `00.000.000/0000-00`. Retorna a entrada se não tiver 14 dígitos. */
export function formatCnpj(digits: string): string {
  if (digits.length !== 14) return digits;
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}
