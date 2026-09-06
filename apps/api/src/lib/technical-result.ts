import { Decimal } from "./decimal.js";
import { ESCALA_TECNICA } from "./decimal-serialization.js";

/**
 * A fronteira de PERSISTÊNCIA do RESULTADO TÉCNICO.
 *
 * `PRODUCT_RULES.md` §58 e §60. O motor calcula em 40 dígitos significativos
 * (§59) e a coluna guarda doze casas. Alguém tem de decidir o que acontece
 * entre um e outro — e até o PREC-MIG-D esse alguém era o PostgreSQL, na hora
 * do `UPDATE`, sem `.toFixed()` no código e sem registro. Medido contra o
 * banco antes da migration: `0.2026593333333333` gravava `0.202659`.
 *
 * Aqui a redução é do domínio, com o modo de arredondamento **declarado**. Não
 * é o mesmo que confiar no default: `ROUND_HALF_UP` é o default de hoje do
 * `decimal.js`, e um arredondamento que virou regra de domínio não pode
 * depender de um default que outra capability pode mudar de carona. Trocar o
 * modo global passa a ser uma mudança que este arquivo ignora — e que os
 * testes desta fronteira acusam.
 *
 * **Não é um segundo motor.** Não há aritmética aqui: só a decisão de escala e
 * de modo de arredondamento, sobre o `Decimal` canônico da API. Nenhuma
 * semântica comercial entra — comissão e contribuição por unidade são leitura
 * econômica, e o preço do documento tem fronteira própria
 * (`fecharPrecoUnitarioComercial`, quatro casas).
 *
 * Irmã de `fecharPrecoTecnicoPersistido` (`technical-price.ts`), que faz o
 * mesmo para o PREÇO técnico, em oito casas. Duas funções e não uma porque a
 * escala pertence à CATEGORIA do campo, não a quem chama: quem fecha resultado
 * técnico não deve passar a fechar preço porque o número coincide hoje.
 */

/** Escala do resultado técnico persistido — `DECIMAL(24,12)`, §58. */
export const ESCALA_RESULTADO_TECNICO = ESCALA_TECNICA;

/**
 * Fecha o resultado do motor no resultado técnico que a coluna guarda.
 *
 * `0.2026593333333333` → `0.202659333333`.
 *
 * `ROUND_HALF_UP` **explícito**: metade para cima, afastando-se do zero, o
 * mesmo critério que o PostgreSQL aplicaria e o mesmo que o produto usa nas
 * outras fronteiras. Passá-lo na chamada é o que garante que a regra sobreviva
 * a uma mudança do `Decimal.rounding` global.
 *
 * Valor negativo é resultado legítimo — contribuição abaixo do custo — e
 * atravessa a fronteira como qualquer outro: `-2.4444444444445` fecha em
 * `-2.444444444445`, afastando-se do zero.
 */
export function fecharResultadoTecnicoPersistido(valorDoMotor: Decimal): Decimal {
  return valorDoMotor.toDecimalPlaces(ESCALA_RESULTADO_TECNICO, Decimal.ROUND_HALF_UP);
}
