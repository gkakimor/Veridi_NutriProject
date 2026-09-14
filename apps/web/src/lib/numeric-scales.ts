/**
 * Casas decimais de cada categoria de campo — o `scale` que as telas passam a
 * `DecimalField`, `MoneyField` e `PercentField` e à leitura da borda
 * (PTBR-NUMERIC-INPUT-ROLLOUT-01).
 *
 * É o espelho das colunas `DECIMAL` e de `apps/api/src/lib/decimal-schema.ts`
 * (`PRODUCT_RULES.md` §58): o campo aceita as casas que o banco guarda, nem
 * mais — a casa a mais o PostgreSQL arredondaria em silêncio, ou a API
 * recusaria — nem menos — o campo cortaria precisão que o domínio tem.
 *
 * Uma constante por categoria, e não um número solto em cada tela: a escolha
 * pertence à categoria do campo, como no servidor. Se a coluna mudar, muda
 * aqui.
 */

/** Quantidade física e grandeza técnica — `DECIMAL(24,12)`: base, uso, lote mínimo, dose. */
export const CASAS_QUANTIDADE = 12;

/** Custo unitário — `DECIMAL(20,8)`: custo de referência, custo efetivo do recebimento. */
export const CASAS_CUSTO_UNITARIO = 8;

/**
 * Preço unitário técnico/operacional — `DECIMAL(20,8)`: OC, oferta de
 * fornecedor, preço manual da faixa, valores "por unidade" do modelo de preço.
 */
export const CASAS_PRECO_UNITARIO = 8;

/** Preço unitário comercial — `DECIMAL(14,4)`: linha do Orçamento, preço faturado. */
export const CASAS_PRECO_COMERCIAL = 4;

/** Percentual técnico — `DECIMAL(9,6)`: pureza e overage. */
export const CASAS_PERCENTUAL_TECNICO = 6;

/**
 * Percentual comercial e de precificação — colunas de quatro casas: desconto,
 * entrada, juros, reajuste, margem, comissão, percentuais do modelo de preço.
 */
export const CASAS_PERCENTUAL = 4;

/**
 * Valor de quatro casas que não é preço de documento — tarifa de recurso,
 * valor de custo adicional, potência e o total do modelo de preço.
 */
export const CASAS_VALOR_INDUSTRIAL = 4;

/*
 * As mesmas casas no formato que a leitura pede (`parsePtBrNumber`,
 * `exigirDecimal`, `toPtBrEditText`) — o campo e a borda com o mesmo número.
 */
export const OPCOES_QUANTIDADE = { scale: CASAS_QUANTIDADE } as const;
export const OPCOES_CUSTO_UNITARIO = { scale: CASAS_CUSTO_UNITARIO } as const;
export const OPCOES_PRECO_UNITARIO = { scale: CASAS_PRECO_UNITARIO } as const;
export const OPCOES_PRECO_COMERCIAL = { scale: CASAS_PRECO_COMERCIAL } as const;
export const OPCOES_PERCENTUAL_TECNICO = { scale: CASAS_PERCENTUAL_TECNICO } as const;
export const OPCOES_PERCENTUAL = { scale: CASAS_PERCENTUAL } as const;
export const OPCOES_VALOR_INDUSTRIAL = { scale: CASAS_VALOR_INDUSTRIAL } as const;
