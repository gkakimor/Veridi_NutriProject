/** Formata um decimal-string (ex.: "48.60") como moeda BRL para exibição. */
export function formatBRL(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
