import { z } from "zod";

/**
 * Decimal como string — nunca usar float JS como fonte de precisao para
 * quantidade/preco. Aceita number tambem (conveniencia de payload), mas
 * sempre normaliza para string antes de repassar ao Prisma.
 *
 * ACEITA VIRGULA. O sistema inteiro e em portugues e a pessoa digita `0,85`;
 * antes disto o campo recusava com "Valor decimal invalido", que nao dizia
 * qual era o problema. A tela normaliza antes de enviar, e isto aqui e a
 * segunda linha: uma tela nova que esqueca de normalizar passa a funcionar em
 * vez de falhar de um jeito que ninguem entende.
 *
 * SEPARADOR DE MILHAR CONTINUA RECUSADO, de proposito. `1.234` e ambiguo — mil
 * duzentos e trinta e quatro para quem escreve em portugues, um virgula
 * duzentos e trinta e quatro para quem escreve o contrato. Adivinhar erra por
 * um fator de mil em silencio, num campo que costuma ser preco ou peso. Um
 * separador so, seja qual for, e sempre a casa decimal: a leitura que nunca
 * infla o numero.
 */

const AJUDA = "Use vírgula ou ponto para a casa decimal, sem separador de milhar.";

/** Normaliza para o formato canonico; devolve o texto original se nao der. */
function normalizarDecimal(texto: string): string {
  const virgulas = (texto.match(/,/g) ?? []).length;
  const pontos = (texto.match(/\./g) ?? []).length;
  if (virgulas + pontos > 1) return texto;
  return texto.replace(",", ".");
}

/**
 * Decimal OPCIONAL que aceita `null` explícito (limpar o campo).
 *
 * O módulo de Projetos mantinha uma cópia própria disto que não aceitava
 * vírgula e, ao recusar, respondia "Valor inválido (não pode ser negativo)".
 * `4,05` não é negativo: a mensagem descrevia um defeito diferente do que
 * havia acontecido, e mandava o operador procurar erro onde não existia.
 *
 * Duas implementações da mesma regra divergem por definição — a que está
 * fora do caminho principal é a que fica para trás. Uma só.
 */
/**
 * Casas decimais de uma grandeza técnica — o scale de `DECIMAL(24,12)`.
 *
 * `PRODUCT_RULES.md` §58. Quem valida quantidade usa `quantityDecimalSchema`,
 * que recusa acima disto em vez de deixar o PostgreSQL arredondar em silêncio.
 */
export const CASAS_QUANTIDADE = 12;

/**
 * Casas decimais de um custo unitário — o scale de `DECIMAL(20,8)`.
 *
 * `PRODUCT_RULES.md` §58, PREC-MIG-B. Mesma regra da quantidade e pelo mesmo
 * motivo: a fronteira recusa acima do que a coluna guarda, em vez de deixar o
 * PostgreSQL arredondar sem dizer.
 */
export const CASAS_CUSTO_UNITARIO = 8;

/**
 * Casas decimais de um preço unitário técnico/operacional — `DECIMAL(20,8)`.
 *
 * `PRODUCT_RULES.md` §58, PREC-MIG-P. O número coincide com o do custo
 * unitário e a constante é outra de propósito: UNIT_PRICE e UNIT_COST são
 * categorias distintas, com decisões distintas, e uma delas pode mudar sem a
 * outra. Uma constante só faria a próxima decisão arrastar a família errada.
 *
 * Vale para o preço da OC. **Não vale para preço contratual** — orçamento,
 * pedido e faturamento seguem a precisão do documento comercial, §58.
 */
export const CASAS_PRECO_UNITARIO = 8;

/**
 * Casas decimais de um percentual técnico — o scale de `DECIMAL(9,6)`.
 *
 * `PRODUCT_RULES.md` §58, PREC-MIG-C. Vale para pureza e overage. Antes da
 * migration a coluna guardava três casas e `99,9995%` de um laudo de ensaio
 * era gravado como `100,000` — "100% puro" é uma afirmação diferente da que o
 * laudo faz, e ninguém era avisado da troca. Seis casas resolvem o laudo; a
 * sétima o PostgreSQL voltaria a arredondar em silêncio, então a fronteira
 * recusa em vez de deixar o banco decidir.
 */
export const CASAS_PERCENTUAL_TECNICO = 6;

/** Quantas casas decimais o texto declara. */
export function casasDecimais(valor: string): number {
  const ponto = valor.indexOf(".");
  return ponto === -1 ? 0 : valor.length - ponto - 1;
}

function mensagemCasas(maximo: number): string {
  return `Valor com precisão acima do suportado: no máximo ${maximo} casas decimais.`;
}

export function optionalDecimalStringSchema(options: { maxDecimals?: number } = {}) {
  const schema = z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const texto = normalizarDecimal(String(value).trim());
      return texto === "" ? null : texto;
    })
    .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
      message: `Valor decimal inválido. ${AJUDA}`,
    });
  const maximo = options.maxDecimals;
  if (maximo === undefined) return schema;
  return schema.refine(
    (value) => value === undefined || value === null || casasDecimais(value) <= maximo,
    { message: mensagemCasas(maximo) },
  );
}

export function decimalStringSchema(options: { allowZero?: boolean; maxDecimals?: number } = {}) {
  const schema = z
    .union([z.string(), z.number()])
    .transform((value) => normalizarDecimal(String(value).trim()))
    .refine((value) => /^\d+(\.\d+)?$/.test(value), {
      message: `Valor decimal inválido. ${AJUDA}`,
    })
    .refine((value) => (options.allowZero ? Number(value) >= 0 : Number(value) > 0), {
      message: options.allowZero
        ? "Valor não pode ser negativo"
        : "Valor deve ser maior que zero",
    });
  const maximo = options.maxDecimals;
  if (maximo === undefined) return schema;
  return schema.refine((value) => casasDecimais(value) <= maximo, {
    message: mensagemCasas(maximo),
  });
}

/**
 * Quantidade física ou grandeza técnica: até 12 casas, recusando acima.
 *
 * Antes do PREC-MIG-A a coluna guardava seis casas e o PostgreSQL arredondava
 * a sétima em silêncio — o operador digitava um número e o banco gravava
 * outro, sem dizer. Ampliar o scale para doze mudaria só o ponto onde o
 * silêncio acontece. A fronteira agora recusa e explica: perda de precisão em
 * quantidade é resposta errada, não formatação.
 */
export function quantityDecimalSchema(options: { allowZero?: boolean } = {}) {
  return decimalStringSchema({ ...options, maxDecimals: CASAS_QUANTIDADE });
}

/** A mesma regra para campo que pode ficar em branco. */
export function optionalQuantityDecimalSchema() {
  return optionalDecimalStringSchema({ maxDecimals: CASAS_QUANTIDADE });
}

/**
 * Mensagem única para custo unitário acima do scale — PREC-MIG-B.
 *
 * Dois schemas de custo têm forma própria (string vazia limpa o valor, zero é
 * válido e distinto de ausente) e não cabem em `decimalStringSchema`. Em vez de
 * duplicar o texto, ambos usam esta mensagem e `casasDecimais`.
 */
export function mensagemCasasCustoUnitario(): string {
  return mensagemCasas(CASAS_CUSTO_UNITARIO);
}

/**
 * Mesma mensagem para pureza e overage acima do scale — PREC-MIG-C.
 *
 * Pureza e overage têm forma própria (`null` é DESCONHECIDA e distinta de
 * zero; pureza tem faixa de negócio e overage não) e não cabem em
 * `decimalStringSchema`. O texto do limite, porém, é o mesmo do resto do
 * sistema: duas redações da mesma regra divergem com o tempo.
 */
export function mensagemCasasPercentualTecnico(): string {
  return mensagemCasas(CASAS_PERCENTUAL_TECNICO);
}
