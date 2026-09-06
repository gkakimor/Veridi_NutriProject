import DecimalJs from "decimal.js";

/**
 * A configuração canônica do motor decimal — uma só, para todo o sistema.
 *
 * `decimal.js` roda em 20 dígitos significativos por default, e a auditoria
 * PREC-01 mediu a consequência: uma coluna `DECIMAL(24,12)` guardaria um número
 * que a aritmética do sistema não é capaz de produzir. Ampliar a coluna sem
 * ampliar o motor cria coluna que ninguém consegue preencher.
 *
 * Quarenta é margem sobre os 24 dígitos da maior persistência técnica
 * planejada, porque as operações intermediárias — multiplicação, divisão,
 * média ponderada, conversão de unidade, pureza, overage, CMV e precificação —
 * encadeiam antes de qualquer arredondamento. Regra em `PRODUCT_RULES.md` §59.
 *
 * **Existem DOIS construtores nesta base**, e essa é a razão de este módulo
 * existir em vez de um `Decimal.set()` solto:
 *
 * - o `Decimal` de `decimal.js`, que `@veridi/shared` usa;
 * - `Prisma.Decimal`, que o Prisma empacota por dentro e que roda quase todo o
 *   cálculo de domínio de `apps/api`.
 *
 * Eles são objetos diferentes: `Prisma.Decimal !== Decimal`, e configurar um
 * não toca no outro. Configurar só `decimal.js` deixaria a API inteira em 20
 * dígitos — exatamente as "duas configurações divergentes" que §59 proíbe.
 * Por isso `configurarDecimal` é exportada: `apps/api` a aplica ao
 * `Prisma.Decimal` em `src/lib/decimal.ts`.
 *
 * **Sem dependência de ordem de import.** Quem precisa de um Decimal
 * configurado importa o construtor DAQUI, e o import é o que o configura. Não
 * existe janela em que um módulo de domínio veja o construtor cru.
 */

/** Dígitos significativos do motor. Decisão de PO, `PRODUCT_RULES.md` §59. */
export const PRECISAO_DECIMAL_CANONICA = 40;

/**
 * Aplica a precisão canônica a um construtor decimal.
 *
 * Mexe em `precision` e **em nada mais**. `rounding`, `toExpNeg`, `toExpPos`,
 * `minE`, `maxE`, `modulo` e `crypto` ficam como estão: o arredondamento
 * `ROUND_HALF_UP` do default é o mesmo que o PostgreSQL aplica ao gravar, e
 * trocá-lo de carona num aumento de precisão mudaria silenciosamente o
 * resultado de todo cálculo monetário do sistema.
 */
export function configurarDecimal<T extends { set(config: { precision: number }): unknown }>(
  construtor: T,
): T {
  construtor.set({ precision: PRECISAO_DECIMAL_CANONICA });
  return construtor;
}

configurarDecimal(DecimalJs);

/**
 * O construtor canônico. Importe daqui, nunca de `decimal.js` direto.
 *
 * O tipo é anotado à mão, e não inferido. Sob `verbatimModuleSyntax` um
 * `export { DecimalJs as Decimal }` reexporta a ligação crua, e do outro lado
 * da fronteira do pacote o TypeScript passava a enxergar o namespace do módulo
 * em vez da classe: `Decimal.precision` não resolvia e `new Decimal(...)` não
 * compilava em `apps/api`. `Decimal.Constructor` é `typeof Decimal` — a classe
 * com os estáticos, que é o que o consumidor precisa ver.
 */
export const Decimal: DecimalJs.Constructor = DecimalJs;

/**
 * O que a aritmética aceita como entrada: `string`, `number` ou `Decimal`.
 *
 * Existe porque a exportação acima carrega o valor, não o namespace de tipos
 * que `decimal.js` funde ao construtor — `Decimal.Value` deixaria de resolver.
 */
export type DecimalValue = DecimalJs.Value;

/** A instância, para quem precisa do tipo do valor e não do construtor. */
export type DecimalInstance = DecimalJs;

export default Decimal;
