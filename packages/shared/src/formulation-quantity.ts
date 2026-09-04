import Decimal from "decimal.js";

/**
 * Quantidade física do componente — a conta, num lugar só, usável dos dois
 * lados.
 *
 * Ela vivia apenas na API. A tela da Formulação, que é onde a pessoa DECIDE a
 * quantidade, só via o resultado depois de salvar: enquanto digitava, a coluna
 * do físico mostrava um travessão. Quem edita uma receita precisa ver o efeito
 * do que está fazendo antes de gravar, senão descobre o número errado depois de
 * ter confirmado.
 *
 * A saída óbvia — recalcular no navegador — criaria um segundo motor, que é
 * exatamente o que o domínio proíbe: duas contas para o mesmo número acabam
 * discordando, e a que aparece na tela seria a que ninguém usa. Por isso a
 * função está AQUI, no pacote compartilhado, e a API delega para ela. Não é uma
 * cópia sincronizada: é a mesma função.
 *
 * `decimal.js` é a mesma biblioteca que o `Prisma.Decimal` usa por dentro, então
 * os dois lados fazem aritmética idêntica — nenhum float participa.
 */

export type FormulationComponentBasisLike = "FIXED_BASIS" | "PER_DOSE" | "PER_FINISHED_UNIT";
export type FormulationComponentQuantityModeLike =
  | "PHYSICAL_DIRECT"
  | "THEORETICAL_WITH_ADJUSTMENTS";

/** Unidade com fator para a base da sua dimensão. */
export interface UomFactorLike {
  code: string;
  dimension: string;
  toBaseFactor: Decimal.Value;
}

export interface ComponentQuantityInput {
  basis: FormulationComponentBasisLike;
  /** Significado depende de `basis`: base da versão, por dose, por unidade. */
  quantity: Decimal.Value;
  unitCode: string;
  /** Unidade de estoque do item — destino da conversão. */
  stockUnitCode: string;
  purityPercent: Decimal.Value | null;
  overagePercent: Decimal.Value | null;
  quantityMode?: FormulationComponentQuantityModeLike | null;
  applyPurityAdjustment?: boolean | null;
  applyOverageAdjustment?: boolean | null;
}

export interface VersionQuantityContext {
  basisQuantity: Decimal.Value;
  /** Obrigatório para qualquer componente `PER_DOSE`. */
  dosesPerPackage: number | null;
}

export interface ComponentQuantityResult {
  /** Antes dos ajustes, já na unidade de estoque. */
  theoretical: Decimal;
  /** Depois dos ajustes autorizados — o que a fábrica separa. */
  physical: Decimal;
}

/**
 * Por que a conta não pôde ser feita.
 *
 * `null` não é resultado: uma premissa em branco é cálculo inválido, e a versão
 * anterior desta matemática tratava `dosesPerPackage` ausente como zero, o que
 * zerava a fórmula inteira e anunciava custo R$ 0,00 como completo.
 */
export type FormulationQuantityBlock =
  | "DOSES_PER_PACKAGE"
  | "BASE_DESCONHECIDA"
  | "UOM_DESCONHECIDA"
  | "UOM_INCOMPATIVEL";

const CEM = new Decimal(100);

/** Quais ajustes ESTE componente autoriza — registrar não é autorizar. */
export function ajustesAutorizados(component: {
  quantityMode?: FormulationComponentQuantityModeLike | null;
  applyPurityAdjustment?: boolean | null;
  applyOverageAdjustment?: boolean | null;
}): { purity: boolean; overage: boolean } {
  const modo = component.quantityMode ?? "PHYSICAL_DIRECT";
  if (modo !== "THEORETICAL_WITH_ADJUSTMENTS") return { purity: false, overage: false };
  return {
    purity: component.applyPurityAdjustment === true,
    overage: component.applyOverageAdjustment === true,
  };
}

/**
 * Aplica pureza e overage sobre a quantidade teórica.
 *
 * Um insumo com 98% de pureza exige MAIS massa para entregar o mesmo teor; um
 * overage de 20% acrescenta a perda esperada de processo. Pureza ausente ou
 * zero não corrige — nunca se assume 100% para o número fechar, e dividir por
 * zero não é correção.
 */
export function aplicarAjustes(
  theoretical: Decimal,
  purityPercent: Decimal.Value | null,
  overagePercent: Decimal.Value | null,
  autorizados: { purity: boolean; overage: boolean },
): Decimal {
  let physical = theoretical;
  if (autorizados.purity && purityPercent !== null) {
    const pureza = new Decimal(purityPercent);
    if (pureza.greaterThan(0)) physical = physical.dividedBy(pureza.dividedBy(CEM));
  }
  if (autorizados.overage && overagePercent !== null) {
    const overage = new Decimal(overagePercent);
    if (overage.greaterThanOrEqualTo(0)) physical = physical.times(CEM.plus(overage).dividedBy(CEM));
  }
  return physical;
}

/**
 * Quantas vezes a quantidade declarada entra na produção pedida.
 *
 * O `default` não é decoração de switch exaustivo: o tipo garante o contrato em
 * compilação, e nada garante o que chega em execução — DTO antigo, campo novo
 * no banco, payload de terceiro. Uma base que o motor não reconhece BLOQUEIA.
 * Cair fora do switch devolvia `undefined`, e a multiplicação seguinte
 * derrubava a tela inteira lá dentro do decimal.js; devolver zero seria pior
 * ainda, porque "não precisa de material" é uma resposta plausível e errada.
 */
function fatorDaBase(
  basis: FormulationComponentBasisLike,
  produzido: Decimal,
  context: VersionQuantityContext,
): Decimal | FormulationQuantityBlock {
  switch (basis) {
    case "FIXED_BASIS": {
      const base = new Decimal(context.basisQuantity);
      return base.isZero() ? new Decimal(0) : produzido.dividedBy(base);
    }
    case "PER_DOSE": {
      const doses = context.dosesPerPackage;
      if (typeof doses !== "number" || !Number.isFinite(doses) || doses <= 0) {
        return "DOSES_PER_PACKAGE";
      }
      return new Decimal(doses).times(produzido);
    }
    case "PER_FINISHED_UNIT":
      // Embalagem: uma tampa por pote, independentemente da dose.
      return produzido;
    default:
      return "BASE_DESCONHECIDA";
  }
}

/**
 * Necessidade física de UM componente para produzir `producedQuantity`
 * unidades. Devolve o motivo quando a conta não é possível, em vez de um
 * número que parece resultado.
 */
export function calcularQuantidadeDoComponente(
  component: ComponentQuantityInput,
  producedQuantity: Decimal.Value,
  context: VersionQuantityContext,
  units: readonly UomFactorLike[],
): ComponentQuantityResult | FormulationQuantityBlock {
  const fator = fatorDaBase(component.basis, new Decimal(producedQuantity), context);
  if (typeof fator === "string") return fator;

  const declarado = new Decimal(component.quantity).times(fator);

  const de = units.find((u) => u.code === component.unitCode);
  const para = units.find((u) => u.code === component.stockUnitCode);
  if (!de || !para) return "UOM_DESCONHECIDA";
  if (de.dimension !== para.dimension) return "UOM_INCOMPATIVEL";

  // Converte ANTES do ajuste, para pureza e overage operarem sempre na unidade
  // de estoque — a mesma ordem que a API sempre usou.
  const theoretical = declarado.times(de.toBaseFactor).dividedBy(para.toBaseFactor);

  return {
    theoretical,
    physical: aplicarAjustes(
      theoretical,
      component.purityPercent,
      component.overagePercent,
      ajustesAutorizados(component),
    ),
  };
}
