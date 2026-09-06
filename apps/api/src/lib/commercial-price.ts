import { Decimal } from "./decimal.js";

/**
 * A fronteira entre preço TÉCNICO e preço COMERCIAL.
 *
 * `PRODUCT_RULES.md` §60. A precificação produz um preço técnico em alta
 * precisão — o motor calcula `P = C ÷ (1 − margem − comissão)` em 40 dígitos e
 * `PricingTier.selectedPriceSnapshot` guarda oito casas. O documento comercial
 * congela quatro. **A redução de oito para quatro não é perda, é fechamento**:
 * o preço unitário que vai para a proposta é um número acordado, e um acordo
 * tem a precisão do documento que o registra.
 *
 * O que esta função existe para impedir é que esse fechamento aconteça
 * **sozinho**. Antes dela o corte estava escrito como `.toFixed(4)` no meio de
 * um `update`, indistinguível dos cortes acidentais que a fundação numérica
 * passou a caçar — e um `.toFixed(4)` que ninguém sabe explicar acaba
 * "corrigido" por engano na próxima capability. Aqui ele tem nome, tem regra
 * citada e tem teste.
 *
 * Fluxo completo, para quem chegar por aqui:
 *
 *     custo preciso (20,8)
 *       → motor de precificação (40 dígitos)
 *       → preço técnico (20,8) — `fecharPrecoTecnicoPersistido`
 *       → FECHAMENTO COMERCIAL EXPLÍCITO (esta função, 4 casas)
 *       → QuoteLine.unitPrice (14,4)
 *       → CustomerOrderLine.agreedUnitPrice → BillingLine (cópias exatas)
 *       → total documental em 2 casas, regra #15
 *
 * **Não é um segundo motor monetário.** Não há aritmética aqui: só a decisão
 * de escala e de modo de arredondamento, sobre o `Decimal` canônico da API.
 *
 * **Não é formatação.** Formatter visual pode mostrar duas casas sem tocar no
 * que está gravado; isto produz o valor que será persistido, e o resultado sai
 * como `Decimal`, nunca como `Number`.
 */

/** Escala do preço unitário comercial — `DECIMAL(14,4)`, §58. */
export const ESCALA_PRECO_COMERCIAL = 4;

/**
 * Fecha um preço unitário técnico no preço unitário comercial do documento.
 *
 * `4.05318764` → `4.0532`.
 *
 * `ROUND_HALF_UP` **explícito**, e não herdado do default do `decimal.js`.
 * `decimal-config.ts` continua mexendo só em `precision` (§59) — o modo de
 * arredondamento desta fronteira é decisão de domínio e viaja na chamada, para
 * que uma mudança global do `Decimal.rounding` não mova em silêncio o centavo
 * de todo documento comercial do sistema. `ROUND_HALF_UP` é o mesmo critério
 * que o PostgreSQL aplica ao gravar e o mesmo que o `.toFixed(4)` anterior já
 * usava: o comportamento publicado não muda, só deixa de depender de um
 * default.
 */
export function fecharPrecoUnitarioComercial(precoTecnico: Decimal): Decimal {
  return precoTecnico.toDecimalPlaces(ESCALA_PRECO_COMERCIAL, Decimal.ROUND_HALF_UP);
}
