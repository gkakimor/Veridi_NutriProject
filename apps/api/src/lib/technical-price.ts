import { Decimal } from "./decimal.js";
import { ESCALA_PRECO_UNITARIO } from "./decimal-serialization.js";

/**
 * A fronteira de PERSISTÊNCIA do preço técnico.
 *
 * `PRODUCT_RULES.md` §60. O motor de precificação calcula em 40 dígitos
 * significativos (§59) e a coluna guarda oito casas. Alguém tem de decidir o
 * que acontece entre um e outro — e até o PREC-P-TECH esse alguém era o
 * PostgreSQL, na hora do `INSERT`, sem `.toFixed()` no código e sem registro.
 *
 * Aqui a redução é do domínio, com o modo de arredondamento **declarado**. Não
 * é o mesmo que confiar no default: `ROUND_HALF_UP` é o default de hoje do
 * `decimal.js`, e um arredondamento que virou regra de domínio não pode
 * depender de um default que outra capability pode mudar de carona. Trocar o
 * modo global passa a ser uma mudança que este arquivo ignora — e que os
 * testes desta fronteira acusam.
 *
 * Simétrica de `fecharPrecoUnitarioComercial` (`commercial-price.ts`), que faz
 * o mesmo do outro lado da cadeia, em quatro casas.
 */

/** Escala do preço técnico persistido — `DECIMAL(20,8)`, §58. */
export const ESCALA_PRECO_TECNICO = ESCALA_PRECO_UNITARIO;

/**
 * Fecha o resultado do motor no preço técnico que a coluna guarda.
 *
 * `4.0531876412345` → `4.05318764`.
 *
 * `ROUND_HALF_UP` **explícito**: metade para cima, afastando-se do zero, o
 * mesmo critério que o PostgreSQL aplicaria e o mesmo que o produto usa no
 * fechamento comercial. Passá-lo na chamada é o que garante que a regra
 * sobreviva a uma mudança do `Decimal.rounding` global.
 */
export function fecharPrecoTecnicoPersistido(valorDoMotor: Decimal): Decimal {
  return valorDoMotor.toDecimalPlaces(ESCALA_PRECO_TECNICO, Decimal.ROUND_HALF_UP);
}
