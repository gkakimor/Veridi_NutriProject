import { Prisma } from "@prisma/client";
import {
  convertUomDecimal,
  isUomCompatible,
  type UnitOfMeasureDecimalLike,
} from "../items/uom.js";
import { InvalidTierQuantityError } from "./pricing.errors.js";
// Precisão canônica do motor decimal — `PRODUCT_RULES.md` §59.
import "../../lib/decimal.js";

/**
 * Identidade de uma faixa de precificação — PREC-CMP-02.
 *
 * Uma faixa é identificada pela QUANTIDADE FÍSICA, não pelo par
 * `quantity`+`uomCode` como texto e não pela `quantity` isolada. `1 kg` e
 * `1000 g` são a mesma faixa; `500 g` e `500 kg` são duas.
 *
 * O PREC-CMP-01 já tinha tirado o `Number` da comparação. O que faltava era a
 * unidade participar da pergunta: comparar `quantity` crua diz que `500 g` e
 * `500 kg` são a mesma faixa — quinhentas vezes mais produto tratado como
 * repetição — e que `1 kg` e `1000 g` são duas, criando faixa duplicada para a
 * mesma quantidade de produto acabado.
 *
 * **Compatível não é igual.** Compatibilidade responde "posso converter?";
 * igualdade responde "depois de converter, é a mesma quantidade física?". São
 * duas perguntas, e este módulo faz as duas em ordem.
 *
 * A conversão é a oficial (`convertUomDecimal`, via `toBaseFactor` da
 * `UnitOfMeasure`), em `Decimal` de ponta a ponta. Nenhum fator vive aqui.
 */

/**
 * A unidade canônica da faixa: a do Item de produto acabado do Produto.
 *
 * `finishedProductItemId` é opcional no schema — produto sem Item de produto
 * acabado cai em `un`, que é o que a criação de faixa já assumia. A unidade é a
 * DO PRODUTO, não qualquer unidade válida do catálogo: uma política em `kg` não
 * se aplica a um produto vendido por unidade só porque `kg` existe no ERP.
 */
export function unidadeCanonicaDaFaixa(unidadeDoItemDeProdutoAcabado: string | null | undefined): string {
  return unidadeDoItemDeProdutoAcabado ?? "un";
}

export interface QuantidadeDeFaixa {
  quantity: Prisma.Decimal;
  uomCode: string;
}

/**
 * A quantidade da faixa expressa na unidade canônica do produto.
 *
 * Recusa unidade de outra dimensão com erro de domínio — nunca converte massa
 * em volume, nunca devolve zero e nunca ignora a faixa em silêncio. Não fecha
 * escala: o valor sai íntegro do motor, e quem grava é que encontra o
 * `DECIMAL(24,12)` da coluna.
 */
export function normalizarQuantidadeDeFaixa(
  { quantity, uomCode }: QuantidadeDeFaixa,
  unidadeCanonica: string,
  unidades: readonly UnitOfMeasureDecimalLike[],
): Prisma.Decimal {
  if (!isUomCompatible(uomCode, unidadeCanonica, unidades)) {
    throw new InvalidTierQuantityError(
      `Unidade ${uomCode} não é compatível com a unidade do produto acabado (${unidadeCanonica}).`,
    );
  }
  // Mesma unidade: nada a converter. `1000 un` e `1000,000000000000 un` já são
  // o mesmo número, e uma conversão por fator 1 só adicionaria uma operação.
  if (uomCode === unidadeCanonica) return quantity;
  return convertUomDecimal(quantity, uomCode, unidadeCanonica, unidades);
}

/**
 * `true` quando as duas faixas representam a MESMA quantidade física.
 *
 * A comparação é numérica sobre o valor convertido, nunca textual: `"1000"`,
 * `"1000.0"` e `"1000.000000000000"` continuam sendo a mesma faixa (§66). O
 * valor não é truncado antes de comparar — uma diferença na décima segunda casa
 * é uma faixa diferente.
 *
 * Uma faixa JÁ GRAVADA em unidade de outra dimensão não é equivalente a nada:
 * ela devolve `false` em vez de erro, porque só pode ter nascido antes desta
 * regra e não deve impedir a criação de uma faixa nova e válida. O lado NOVO,
 * esse sim, é recusado por `normalizarQuantidadeDeFaixa`.
 */
export function quantidadesDeFaixaEquivalentes(
  gravada: QuantidadeDeFaixa,
  nova: Prisma.Decimal,
  unidadeCanonica: string,
  unidades: readonly UnitOfMeasureDecimalLike[],
): boolean {
  if (!isUomCompatible(gravada.uomCode, unidadeCanonica, unidades)) return false;
  return normalizarQuantidadeDeFaixa(gravada, unidadeCanonica, unidades).equals(nova);
}
