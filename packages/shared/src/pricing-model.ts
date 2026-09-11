import { Decimal, type DecimalInstance } from "./decimal-config.js";
import { CUSTOMER_TAX_PROFILES, type CustomerTaxProfile } from "./customers.js";
import type {
  IndustrialCostQuality,
  IndustrialCostWarningDTO,
} from "./industrial-cost-calculation.js";

/**
 * Modelo de Precificação flexível — PRICING-TEMPLATE-FLEX-01, `PRODUCT_RULES.md` §84.
 *
 * O Modelo (a Política de Precificação, TPP) sempre disse margem e comissão.
 * Agora diz também O QUE ENTRA NO CUSTO que forma o preço: o custo industrial
 * e os impostos estimados podem vir do cálculo do ERP, de um valor que a
 * Veridi informa, ou ficar de fora — porque parte desses custos é administrada
 * pelo financeiro, fora do ERP.
 *
 * Três regras sustentam o módulo:
 *
 * 1. **"Não considerar" não é zero.** O modo é guardado explicitamente;
 *    `R$ 0,00` informado é um valor, e ausência de linha é outra coisa.
 * 2. **Desligar não apaga.** Cada modo lê o SEU campo de valor, e cada campo
 *    carrega a base no nome — "12" em `industrialCostPercentOfMaterials` é 12%
 *    do custo de materiais, nunca "12%" de algo não dito. Trocar de modo ou
 *    ligar a gestão externa não toca em nenhum valor guardado.
 * 3. **Uma conta só.** API e tela chamam as funções daqui; a API continua
 *    sendo quem valida e persiste.
 *
 * Não é motor fiscal: percentual e valor de imposto vêm da Veridi, e o perfil
 * tributário do Cliente só serve para SUGERIR o Modelo (§83).
 */

const HUNDRED = new Decimal(100);

// ───────────────────────────────────────────────────────── custo industrial

/**
 * `CALCULATED` é o comportamento anterior ao Modelo flexível: o custo
 * industrial vem da Estrutura de Custos, pelo cálculo do ERP. É o default do
 * banco, e é nele que todo Modelo existente continua — mesmo preço de antes.
 */
export type PricingIndustrialCostMode =
  | "CALCULATED"
  | "IGNORE"
  | "PERCENT_MATERIAL_COST"
  | "PER_UNIT"
  | "TOTAL";

export const PRICING_INDUSTRIAL_COST_MODES = [
  "CALCULATED",
  "IGNORE",
  "PERCENT_MATERIAL_COST",
  "PER_UNIT",
  "TOTAL",
] as const satisfies readonly PricingIndustrialCostMode[];

export const PRICING_INDUSTRIAL_COST_MODE_LABELS: Record<PricingIndustrialCostMode, string> = {
  CALCULATED: "Conforme a Estrutura de Custos (cálculo do ERP)",
  IGNORE: "Não considerar",
  PERCENT_MATERIAL_COST: "% sobre custo de materiais",
  PER_UNIT: "R$ por unidade",
  TOTAL: "R$ total",
};

// ───────────────────────────────────────────────────────── impostos estimados

export type PricingEstimatedTaxMode = "IGNORE" | "PERCENT_SALE_PRICE" | "PER_UNIT" | "TOTAL";

export const PRICING_ESTIMATED_TAX_MODES = [
  "IGNORE",
  "PERCENT_SALE_PRICE",
  "PER_UNIT",
  "TOTAL",
] as const satisfies readonly PricingEstimatedTaxMode[];

export const PRICING_ESTIMATED_TAX_MODE_LABELS: Record<PricingEstimatedTaxMode, string> = {
  IGNORE: "Não considerar",
  PERCENT_SALE_PRICE: "% sobre preço de venda",
  PER_UNIT: "R$ por unidade",
  TOTAL: "R$ total",
};

// ───────────────────────────────────────────────────────── configuração

export interface PricingModelConfig {
  industrialCostMode: PricingIndustrialCostMode;
  /** Percentual SOBRE O CUSTO DE MATERIAIS da quantidade (12 = 12%). */
  industrialCostPercentOfMaterials: string | null;
  /** R$ por unidade produzida. */
  industrialCostAmountPerUnit: string | null;
  /** R$ uma vez no cálculo da faixa, qualquer que seja a quantidade. */
  industrialCostAmountTotal: string | null;
  estimatedTaxMode: PricingEstimatedTaxMode;
  /** Percentual SOBRE O PREÇO DE VENDA — vai ao divisor, com margem e comissão. */
  estimatedTaxPercentOfSalePrice: string | null;
  /** R$ por unidade vendida. */
  estimatedTaxAmountPerUnit: string | null;
  /** R$ uma vez no cálculo da faixa. */
  estimatedTaxAmountTotal: string | null;
  /**
   * Custos adicionais administrados externamente: custo industrial e impostos
   * do Modelo ficam fora da conta, com os valores guardados intactos. O custo
   * de materiais continua sendo calculado; margem e comissão continuam no preço.
   */
  externalAdditionalCosts: boolean;
}

export type PricingModelValueField =
  | "industrialCostPercentOfMaterials"
  | "industrialCostAmountPerUnit"
  | "industrialCostAmountTotal"
  | "estimatedTaxPercentOfSalePrice"
  | "estimatedTaxAmountPerUnit"
  | "estimatedTaxAmountTotal";

/** O Modelo de antes da capacidade — os defaults do banco. */
export const DEFAULT_PRICING_MODEL: PricingModelConfig = {
  industrialCostMode: "CALCULATED",
  industrialCostPercentOfMaterials: null,
  industrialCostAmountPerUnit: null,
  industrialCostAmountTotal: null,
  estimatedTaxMode: "IGNORE",
  estimatedTaxPercentOfSalePrice: null,
  estimatedTaxAmountPerUnit: null,
  estimatedTaxAmountTotal: null,
  externalAdditionalCosts: false,
};

/** Qual campo de valor cada modo de custo industrial lê. */
export const PRICING_INDUSTRIAL_COST_MODE_FIELD: Record<
  PricingIndustrialCostMode,
  PricingModelValueField | null
> = {
  CALCULATED: null,
  IGNORE: null,
  PERCENT_MATERIAL_COST: "industrialCostPercentOfMaterials",
  PER_UNIT: "industrialCostAmountPerUnit",
  TOTAL: "industrialCostAmountTotal",
};

/** Qual campo de valor cada modo de imposto lê. */
export const PRICING_ESTIMATED_TAX_MODE_FIELD: Record<
  PricingEstimatedTaxMode,
  PricingModelValueField | null
> = {
  IGNORE: null,
  PERCENT_SALE_PRICE: "estimatedTaxPercentOfSalePrice",
  PER_UNIT: "estimatedTaxAmountPerUnit",
  TOTAL: "estimatedTaxAmountTotal",
};

export const PRICING_MODEL_VALUE_LABELS: Record<PricingModelValueField, string> = {
  industrialCostPercentOfMaterials: "Custo industrial (% sobre custo de materiais)",
  industrialCostAmountPerUnit: "Custo industrial (R$ por unidade)",
  industrialCostAmountTotal: "Custo industrial (R$ total)",
  estimatedTaxPercentOfSalePrice: "Impostos estimados (% sobre preço de venda)",
  estimatedTaxAmountPerUnit: "Impostos estimados (R$ por unidade)",
  estimatedTaxAmountTotal: "Impostos estimados (R$ total)",
};

/**
 * Limites de cada valor — a faixa de negócio e o que a coluna guarda (§58).
 *
 * Percentual sobre materiais pode passar de 100% (conversão mais cara que o
 * insumo é legítima) e para no teto de `DECIMAL(7,4)`. Percentual sobre o
 * preço de venda é fração do preço: fica abaixo de 100%, como a comissão.
 */
const VALUE_LIMITS: Record<
  PricingModelValueField,
  { maxDecimals: number; maxIntegerDigits: number; lessThan?: string }
> = {
  industrialCostPercentOfMaterials: { maxDecimals: 4, maxIntegerDigits: 3, lessThan: "1000" },
  industrialCostAmountPerUnit: { maxDecimals: 8, maxIntegerDigits: 12 },
  industrialCostAmountTotal: { maxDecimals: 4, maxIntegerDigits: 10 },
  estimatedTaxPercentOfSalePrice: { maxDecimals: 4, maxIntegerDigits: 2, lessThan: "100" },
  estimatedTaxAmountPerUnit: { maxDecimals: 8, maxIntegerDigits: 12 },
  estimatedTaxAmountTotal: { maxDecimals: 4, maxIntegerDigits: 10 },
};

const VALUE_FIELDS = Object.keys(VALUE_LIMITS) as PricingModelValueField[];

/** Número em pt-BR para mensagem: `12.5000` → `12,5`. */
function pt(valor: string): string {
  return new Decimal(valor).toString().replace(".", ",");
}

function problemaDoValor(campo: PricingModelValueField, valor: string): string | null {
  const rotulo = PRICING_MODEL_VALUE_LABELS[campo];
  // NaN, Infinity, negativo, notação científica e texto arbitrário param aqui.
  if (!/^\d+(\.\d+)?$/.test(valor)) {
    return `${rotulo}: informe um valor numérico válido, sem sinal e sem separador de milhar.`;
  }
  const limite = VALUE_LIMITS[campo];
  const [inteira = "", decimais = ""] = valor.split(".");
  if (decimais.length > limite.maxDecimals) {
    return `${rotulo}: no máximo ${limite.maxDecimals} casas decimais.`;
  }
  if (limite.lessThan !== undefined) {
    if (new Decimal(valor).greaterThanOrEqualTo(limite.lessThan)) {
      return `${rotulo}: o percentual deve ficar abaixo de ${limite.lessThan}%.`;
    }
  } else if (inteira.replace(/^0+(?=\d)/, "").length > limite.maxIntegerDigits) {
    return `${rotulo}: valor acima do suportado.`;
  }
  return null;
}

/**
 * O primeiro problema do Modelo, em português — ou `null` quando ele é válido.
 *
 * Todo valor guardado precisa ser legível, mesmo o de um modo desligado: ele
 * volta a valer quando o modo for religado. E o modo que lê um valor exige
 * esse valor — zero vale, ausência não, porque zero é informação e ausência é
 * "não considerar" disfarçado.
 */
export function validarModeloDePrecificacao(model: PricingModelConfig): string | null {
  for (const campo of VALUE_FIELDS) {
    const valor = model[campo];
    if (valor === null) continue;
    const problema = problemaDoValor(campo, valor);
    if (problema) return problema;
  }
  const industrial = PRICING_INDUSTRIAL_COST_MODE_FIELD[model.industrialCostMode];
  if (industrial && model[industrial] === null) {
    return `${PRICING_MODEL_VALUE_LABELS[industrial]}: informe o valor — o modo escolhido usa ele. Para deixar fora da conta, escolha "Não considerar".`;
  }
  const imposto = PRICING_ESTIMATED_TAX_MODE_FIELD[model.estimatedTaxMode];
  if (imposto && model[imposto] === null) {
    return `${PRICING_MODEL_VALUE_LABELS[imposto]}: informe o valor — o modo escolhido usa ele. Para deixar fora da conta, escolha "Não considerar".`;
  }
  return null;
}

/**
 * O percentual sobre o preço de venda que o Modelo põe no divisor — `null`
 * quando os impostos não entram (outro modo, ou gestão externa ligada).
 */
export function percentualDeImpostoSobreVenda(model: PricingModelConfig): string | null {
  if (model.externalAdditionalCosts) return null;
  if (model.estimatedTaxMode !== "PERCENT_SALE_PRICE") return null;
  return model.estimatedTaxPercentOfSalePrice;
}

/**
 * O divisor de `P = C ÷ (1 − margem − comissão − impostos sobre a venda)`.
 *
 * Devolve a recusa em português quando ele não fica positivo — nunca preço
 * infinito, negativo ou `NaN`. Sem imposto, a mensagem é a de sempre.
 */
export function problemaDoDivisorDoPreco(input: {
  targetMarginPercent: string | null;
  commissionPercent: string;
  estimatedTaxPercent: string | null;
}): string | null {
  const margem = new Decimal(input.targetMarginPercent ?? "0");
  const comissao = new Decimal(input.commissionPercent);
  const imposto = new Decimal(input.estimatedTaxPercent ?? "0");
  if (margem.plus(comissao).plus(imposto).lessThan(HUNDRED)) return null;
  if (input.estimatedTaxPercent === null) {
    return "Margem somada à comissão atinge 100% — não existe preço que satisfaça.";
  }
  return `Margem (${pt(margem.toString())}%) + comissão (${pt(comissao.toString())}%) + impostos sobre a venda (${pt(imposto.toString())}%) somam 100% ou mais — não existe preço que satisfaça.`;
}

/** O Modelo se comporta como o de antes: cálculo do ERP, sem impostos, sem gestão externa. */
export function isDefaultPricingModel(model: PricingModelConfig): boolean {
  return (
    !model.externalAdditionalCosts &&
    model.industrialCostMode === "CALCULATED" &&
    model.estimatedTaxMode === "IGNORE"
  );
}

// ───────────────────────────────────────────────────────── efeito na faixa

export interface PricingModelEffectInput {
  quantity: string;
  /** Σ necessidade × custo dos materiais Veridi. `null` quando algum material está sem custo. */
  materialCostTotal: string | null;
  materialCostQuality: IndustrialCostQuality;
  /** Custo total do cálculo do ERP (materiais + conversão). `null` quando incompleto. */
  calculatedCostTotal: string | null;
  calculatedCostQuality: IndustrialCostQuality;
  model: PricingModelConfig;
}

export interface PricingModelEffect {
  /**
   * Custo que FORMA o preço, total da faixa: materiais + custo industrial do
   * Modelo + impostos em R$. `null` quando a base está incompleta.
   */
  pricingCostTotal: string | null;
  pricingCostPerUnit: string | null;
  /**
   * Qualidade DESTA base: a do cálculo do ERP quando o Modelo usa o cálculo, a
   * dos materiais quando não usa — energia sem tarifa não torna incompleto um
   * preço que não depende dela.
   */
  pricingCostQuality: IndustrialCostQuality;
  /** Custo industrial que entrou na conta; `null` quando ficou de fora ou é desconhecido. */
  industrialCostAmount: string | null;
  /** Impostos em R$ que entraram no custo; `null` quando não entraram. */
  estimatedTaxAmount: string | null;
  /** Percentual sobre o preço de venda que vai ao divisor; `null` quando não entra. */
  estimatedTaxPercent: string | null;
  warnings: IndustrialCostWarningDTO[];
}

const texto = (value: DecimalInstance | null): string | null => (value === null ? null : value.toString());

/**
 * O efeito do Modelo no custo de UMA faixa — a função canônica.
 *
 * - custo industrial `CALCULATED`: o custo do cálculo do ERP, inteiro — o
 *   comportamento de antes, com o mesmo número;
 * - `PERCENT_MATERIAL_COST`: custo de materiais × percentual;
 * - `PER_UNIT`: valor × quantidade; `TOTAL`: o valor, uma vez;
 * - `IGNORE`: fora da conta — o preço se forma sobre os materiais;
 * - impostos `PER_UNIT`/`TOTAL` somam ao custo; `PERCENT_SALE_PRICE` não é
 *   custo: vai ao divisor do preço, por `computePrice`;
 * - gestão externa ligada: custo industrial e impostos fora, valores intactos.
 *
 * Valor exigido pelo modo e ausente não vira zero: a base fica incompleta, com
 * aviso — a validação da API impede que isso chegue aqui.
 */
export function computePricingModelEffect(input: PricingModelEffectInput): PricingModelEffect {
  const { model } = input;
  const warnings: IndustrialCostWarningDTO[] = [];
  const quantity = new Decimal(input.quantity);
  const externo = model.externalAdditionalCosts;
  const modoIndustrial: PricingIndustrialCostMode = externo ? "IGNORE" : model.industrialCostMode;
  const modoImposto: PricingEstimatedTaxMode = externo ? "IGNORE" : model.estimatedTaxMode;
  const materiais = input.materialCostTotal === null ? null : new Decimal(input.materialCostTotal);

  const valorDoModo = (campo: PricingModelValueField | null): DecimalInstance | null => {
    if (!campo) return null;
    const valor = model[campo];
    if (valor === null) {
      warnings.push({
        code: "PRICING_MODEL_VALUE_MISSING",
        message: `${PRICING_MODEL_VALUE_LABELS[campo]} sem valor no Modelo de Precificação.`,
      });
      return null;
    }
    return new Decimal(valor);
  };

  let baseCompleta = true;
  let base: DecimalInstance | null;
  let industrial: DecimalInstance | null = null;

  if (modoIndustrial === "CALCULATED") {
    base = input.calculatedCostTotal === null ? null : new Decimal(input.calculatedCostTotal);
    if (base !== null && materiais !== null) industrial = base.minus(materiais);
  } else {
    base = materiais;
    if (modoIndustrial !== "IGNORE") {
      const valor = valorDoModo(PRICING_INDUSTRIAL_COST_MODE_FIELD[modoIndustrial]);
      if (valor === null) baseCompleta = false;
      else if (modoIndustrial === "PERCENT_MATERIAL_COST") {
        industrial = materiais === null ? null : materiais.times(valor).dividedBy(HUNDRED);
      } else if (modoIndustrial === "PER_UNIT") industrial = valor.times(quantity);
      else industrial = valor;
      base = base !== null && industrial !== null ? base.plus(industrial) : null;
    }
  }

  let imposto: DecimalInstance | null = null;
  let impostoPercentual: string | null = null;
  if (modoImposto === "PERCENT_SALE_PRICE") {
    const valor = valorDoModo(PRICING_ESTIMATED_TAX_MODE_FIELD[modoImposto]);
    if (valor === null) baseCompleta = false;
    else impostoPercentual = valor.toString();
  } else if (modoImposto !== "IGNORE") {
    const valor = valorDoModo(PRICING_ESTIMATED_TAX_MODE_FIELD[modoImposto]);
    if (valor === null) baseCompleta = false;
    else imposto = modoImposto === "PER_UNIT" ? valor.times(quantity) : valor;
  }

  const total = !baseCompleta || base === null ? null : imposto === null ? base : base.plus(imposto);
  const perUnit = total !== null && quantity.greaterThan(0) ? total.dividedBy(quantity) : null;

  let quality =
    modoIndustrial === "CALCULATED" ? input.calculatedCostQuality : input.materialCostQuality;
  if (total === null && (quality === "COMPLETE_REAL_REFERENCE" || quality === "COMPLETE_WITH_ESTIMATES")) {
    quality = "PARTIAL";
  }

  return {
    pricingCostTotal: texto(total),
    pricingCostPerUnit: texto(perUnit),
    pricingCostQuality: quality,
    industrialCostAmount: texto(industrial),
    estimatedTaxAmount: texto(imposto),
    estimatedTaxPercent: impostoPercentual,
    warnings,
  };
}

// ───────────────────────────────────────────── perfil tributário do Cliente

/**
 * Perfis que um Modelo pode declarar. "Não informado" fica de fora: não é
 * regime tributário, é a ausência dele.
 */
export const PRICING_MODEL_TAX_PROFILES = [
  "MEI",
  "SIMPLES_NACIONAL",
  "LUCRO_PRESUMIDO",
  "LUCRO_REAL",
  "OTHER",
] as const satisfies readonly Exclude<CustomerTaxProfile, "NOT_INFORMED">[];

/** Ordena e tira repetição, na ordem do seletor do Cliente. */
export function normalizarPerfisDoModelo(perfis: readonly CustomerTaxProfile[]): CustomerTaxProfile[] {
  return CUSTOMER_TAX_PROFILES.filter((perfil) => perfis.includes(perfil));
}

/**
 * Compatibilidade do Modelo com o perfil do Cliente — SUGESTÃO, não trava.
 *
 * Nenhum perfil declarado é Modelo para todos. Cliente sem perfil informado
 * não é dito incompatível: é desconhecido. Nada aqui calcula imposto.
 */
export type TaxProfileFit =
  | "UNRESTRICTED"
  | "COMPATIBLE"
  | "NOT_RECOMMENDED"
  | "CUSTOMER_PROFILE_UNKNOWN";

export const TAX_PROFILE_FIT_LABELS: Record<TaxProfileFit, string> = {
  UNRESTRICTED: "Todos os perfis",
  COMPATIBLE: "Indicado para o perfil do cliente",
  NOT_RECOMMENDED: "Não indicado para o perfil do cliente",
  CUSTOMER_PROFILE_UNKNOWN: "Perfil tributário do cliente não informado",
};

export function taxProfileFit(
  applicableProfiles: readonly CustomerTaxProfile[],
  customerProfile: CustomerTaxProfile | null,
): TaxProfileFit {
  if (applicableProfiles.length === 0) return "UNRESTRICTED";
  if (customerProfile === null || customerProfile === "NOT_INFORMED") {
    return "CUSTOMER_PROFILE_UNKNOWN";
  }
  return applicableProfiles.includes(customerProfile) ? "COMPATIBLE" : "NOT_RECOMMENDED";
}
