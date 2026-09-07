import { splitDecimal } from "@veridi/shared";
import { formatQuantity } from "./quantity";

/**
 * O rateio de um material pelas partes da Ordem de Produção, para leitura.
 *
 * O documento impresso da OP tinha a própria divisão:
 * `(Number(requiredQuantity) / numberOfParts).toFixed(6)`, exibida como
 * `X × N`. Dois defeitos num só lugar.
 *
 * O primeiro é o float. O segundo é maior: o papel afirmava N partes IGUAIS, e
 * o motor da produção nunca dividiu assim. `splitDecimal` trunca as N-1
 * primeiras em seis casas e dá o resto à última, para que a soma feche
 * exatamente com o total planejado. Com 2 kg em 3 partes o motor planeja
 * 0,666666 / 0,666666 / 0,666668 — e o papel dizia 0,666667 nas três, um valor
 * que parte nenhuma seria pesada, somando 2,000001. A Folha de Receita, que é
 * o documento de execução, mostrava os números certos: os dois documentos da
 * MESMA ordem discordavam.
 *
 * Aqui o cálculo é o do domínio, importado — não recriado —, e a apresentação
 * é a de sempre (`formatQuantity`, seis casas, `PRODUCT_RULES.md` §65). São
 * duas etapas: Decimal exato primeiro, formatação depois.
 *
 * O texto acompanha o rateio em vez de impor uma forma fixa:
 *
 *     9 kg em 3   →  3 × 3                    (divisão exata)
 *     2 kg em 3   →  0,666666 × 2 + 0,666668  (a última absorve o resto)
 *     1 kg em 2   →  0,5 + 0,5
 *
 * Parte única não tem rateio a mostrar: o travessão significa "não se aplica",
 * como em todo o resto do documento.
 */
export function formatPartShare(
  total: string | null | undefined,
  parts: number,
): string {
  if (total === null || total === undefined || total === "") return "—";
  // `parts` é `Int` no domínio — contagem de frações, nunca Decimal (§66).
  if (!Number.isInteger(parts) || parts <= 1) return "—";

  let partes;
  try {
    partes = splitDecimal(total, parts);
  } catch {
    // Quantidade ilegível não derruba o documento inteiro; ela some, como em
    // qualquer outro campo que o formatador não consegue ler.
    return "—";
  }

  const primeira = partes[0]!;
  const ultima = partes[partes.length - 1]!;
  const inicio = formatQuantity(primeira.toString());

  // Divisão exata: todas as partes valem o mesmo, e a forma curta é a verdade.
  if (ultima.equals(primeira)) return `${inicio} × ${parts}`;

  const fim = formatQuantity(ultima.toString());
  // Em duas partes, `× 1` seria ruído: são só as duas parcelas.
  if (parts === 2) return `${inicio} + ${fim}`;
  return `${inicio} × ${parts - 1} + ${fim}`;
}
