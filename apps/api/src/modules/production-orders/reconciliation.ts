import { Prisma } from "@prisma/client";
import type { MaterialReconciliationStatus } from "@veridi/shared";

/**
 * Reconciliação de material da Ordem de Produção.
 *
 * A pergunta é uma só: o que a fórmula pediu foi mesmo gasto, e se não foi,
 * alguém explicou por quê?
 *
 * O defeito que isto fecha era mudo. `completeProductionOrder` exigia um
 * apontamento de produção e um motivo quando se produzia menos que o
 * planejado, mas nunca olhava para os materiais. Uma OP com seis requisitos e
 * um consumo concluía normalmente: os outros cinco nunca baixavam do estoque,
 * o saldo em livro passava a divergir do chão sem ajuste que registrasse a
 * diferença, e o lote de produto acabado nascia declarando seis componentes
 * com registro de um.
 *
 * NÃO HÁ TOLERÂNCIA, e isso é deliberado. O domínio já tomou essa posição em
 * `RecipeWeighing`: "diferença é registrada, nunca escondida". Uma folga
 * percentual aqui seria exatamente o contrário — sumir com a diferença
 * pequena, que é como a grande começa. Consumir a mais também não precisa de
 * nada: sobra material explicado é problema que não existe, e ampliar a
 * reserva já tem caminho próprio com justificativa em `extraReason`.
 */

export interface ReconciliationInput {
  /** Necessidade física final da linha, já com pureza e overage. */
  requiredQuantity: Prisma.Decimal;
  /** Soma dos `ProductionConsumption` confirmados para esta linha. */
  consumedQuantity: Prisma.Decimal;
  /** Justificativa aceita para a diferença, quando houver. */
  varianceReason: string | null;
}

/** `max(necessidade - consumido, 0)` — o que a fórmula pediu e não foi gasto. */
export function unreconciledQuantity(input: ReconciliationInput): Prisma.Decimal {
  return Prisma.Decimal.max(input.requiredQuantity.minus(input.consumedQuantity), 0);
}

export function reconciliationStatus(input: ReconciliationInput): MaterialReconciliationStatus {
  if (unreconciledQuantity(input).lessThanOrEqualTo(0)) return "RECONCILED";
  if (input.varianceReason && input.varianceReason.trim().length > 0) return "VARIANCE_ACCEPTED";
  // Consumo zero e consumo parcial pendem igual, mas não são a mesma história:
  // zero costuma ser registro esquecido, parcial costuma ser sobra ou perda
  // real. A tela pergunta diferente para cada um.
  return input.consumedQuantity.greaterThan(0) ? "PENDING_PARTIAL" : "PENDING_NONE";
}

export function isPending(status: MaterialReconciliationStatus): boolean {
  return status === "PENDING_PARTIAL" || status === "PENDING_NONE";
}
