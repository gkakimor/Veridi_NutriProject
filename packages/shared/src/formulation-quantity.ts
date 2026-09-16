import { Decimal, type DecimalInstance, type DecimalValue } from "./decimal-config.js";

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
  toBaseFactor: DecimalValue;
}

export interface ComponentQuantityInput {
  basis: FormulationComponentBasisLike;
  /** Significado depende de `basis`: base da versão, por dose, por unidade. */
  quantity: DecimalValue;
  unitCode: string;
  /** Unidade de estoque do item — destino da conversão. */
  stockUnitCode: string;
  purityPercent: DecimalValue | null;
  overagePercent: DecimalValue | null;
  quantityMode?: FormulationComponentQuantityModeLike | null;
  applyPurityAdjustment?: boolean | null;
  applyOverageAdjustment?: boolean | null;
}

export interface VersionQuantityContext {
  basisQuantity: DecimalValue;
  /** Obrigatório para qualquer componente `PER_DOSE`. */
  dosesPerPackage: number | null;
}

export interface ComponentQuantityResult {
  /** Antes dos ajustes, já na unidade de estoque. */
  theoretical: DecimalInstance;
  /** Depois dos ajustes autorizados — o que a fábrica separa. */
  physical: DecimalInstance;
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

/**
 * A conversão canônica entre unidades: pela unidade-base da dimensão de cada
 * uma. 2 kg viram 2 × 1000 ÷ 1 = 2000 g.
 *
 * Uma função só para a Formulação (componente na unidade de estoque) e para o
 * Roteiro (quantidade da ordem na unidade de referência). Unidade desconhecida
 * ou de outra dimensão devolve o MOTIVO, nunca um número: quantidade crua usada
 * como se estivesse convertida é exatamente o erro que ela existe para impedir.
 */
export function converterQuantidadeDeUnidade(
  quantity: DecimalValue,
  fromCode: string,
  toCode: string,
  units: readonly UomFactorLike[],
): DecimalInstance | "UOM_DESCONHECIDA" | "UOM_INCOMPATIVEL" {
  const de = units.find((u) => u.code === fromCode);
  const para = units.find((u) => u.code === toCode);
  if (!de || !para) return "UOM_DESCONHECIDA";
  if (de.dimension !== para.dimension) return "UOM_INCOMPATIVEL";
  return new Decimal(quantity).times(de.toBaseFactor).dividedBy(para.toBaseFactor);
}

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
  theoretical: DecimalInstance,
  purityPercent: DecimalValue | null,
  overagePercent: DecimalValue | null,
  autorizados: { purity: boolean; overage: boolean },
): DecimalInstance {
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
  produzido: DecimalInstance,
  context: VersionQuantityContext,
): DecimalInstance | FormulationQuantityBlock {
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
  producedQuantity: DecimalValue,
  context: VersionQuantityContext,
  units: readonly UomFactorLike[],
): ComponentQuantityResult | FormulationQuantityBlock {
  const fator = fatorDaBase(component.basis, new Decimal(producedQuantity), context);
  if (typeof fator === "string") return fator;

  const declarado = new Decimal(component.quantity).times(fator);

  // Converte ANTES do ajuste, para pureza e overage operarem sempre na unidade
  // de estoque — a mesma ordem que a API sempre usou.
  const theoretical = converterQuantidadeDeUnidade(
    declarado,
    component.unitCode,
    component.stockUnitCode,
    units,
  );
  if (typeof theoretical === "string") return theoretical;

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

/*
 * BANCADA DA FORMULAÇÃO — dose, cápsula e apresentação (FORMULATION-WORKBENCH-01).
 *
 * A pessoa que monta a receita pensa como a planilha da Veridi: miligramas por
 * dose, miligramas por cápsula, cápsulas por embalagem. O motor acima responde
 * por embalagem, na unidade de estoque — que é o que a Ordem de Produção separa.
 * As funções abaixo respondem as perguntas da bancada SEM outra conta: chamam o
 * motor, e a única aritmética nova é a divisão pelas cápsulas de uma dose e pela
 * dose do pó.
 */

/** Forma do produto — o mesmo vocabulário do cadastro do Produto. */
export type DosageFormLike = "CAPSULE" | "POWDER" | "TABLET" | "LIQUID" | "OTHER";

/** Unidade em que a bancada soma massa por dose — a da planilha da Veridi. */
export const UNIDADE_DE_MASSA_DA_DOSE = "mg";

/** Maior número de doses que a coluna `dosesPerPackage` (Int) guarda. */
const LIMITE_DE_DOSES = 2_147_483_647;

function inteiroPositivo(valor: number | null | undefined): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

function decimalPositivo(valor: DecimalValue | null | undefined): DecimalInstance | null {
  if (valor === null || valor === undefined || valor === "") return null;
  try {
    const numero = new Decimal(valor);
    return numero.isFinite() && numero.greaterThan(0) ? numero : null;
  } catch {
    return null;
  }
}

export interface QuantidadeDaDose {
  /** O que a linha declara para UMA dose, na unidade declarada — o alvo. */
  teorica: DecimalInstance;
  /** O que a fábrica pesa para UMA dose: o alvo com os ajustes autorizados. */
  fisica: DecimalInstance;
  /** A física de uma dose dividida pelas cápsulas da dose; `null` fora da cápsula. */
  porCapsula: DecimalInstance | null;
}

/**
 * Quanto de UM componente entra numa dose — e numa cápsula, na forma cápsula.
 *
 * É `calcularQuantidadeDoComponente` pedindo a necessidade de uma embalagem com
 * uma dose, na própria unidade declarada: base por dose, conversão e ajustes
 * autorizados continuam os do motor, na mesma ordem. Pureza corrige a massa
 * física (alvo ÷ pureza/100); overage só entra se autorizado, e é outro ajuste.
 *
 * `null` quando a base da linha não é por dose — em base fixa ou por unidade
 * acabada, "por dose" não é grandeza da linha. Conta impossível devolve o
 * motivo, como no motor; nunca zero.
 */
export function calcularQuantidadeDaDose(
  component: Omit<ComponentQuantityInput, "stockUnitCode">,
  capsulasPorDose: number | null,
  units: readonly UomFactorLike[],
): QuantidadeDaDose | FormulationQuantityBlock | null {
  if (component.basis !== "PER_DOSE") return null;
  const resultado = calcularQuantidadeDoComponente(
    { ...component, stockUnitCode: component.unitCode },
    1,
    { basisQuantity: 1, dosesPerPackage: 1 },
    units,
  );
  if (typeof resultado === "string") return resultado;
  const capsulas = inteiroPositivo(capsulasPorDose);
  return {
    teorica: resultado.theoretical,
    fisica: resultado.physical,
    porCapsula: capsulas === null ? null : resultado.physical.dividedBy(capsulas),
  };
}

export interface ResumoDaDose {
  /** Soma dos alvos por dose, em `mg`. */
  teoricaTotal: DecimalInstance;
  /** Soma das quantidades físicas por dose, em `mg` — o que uma dose pesa. */
  fisicaTotal: DecimalInstance;
  /** O que cada cápsula leva, em `mg`; `null` fora da forma cápsula. */
  porCapsulaTotal: DecimalInstance | null;
  /** Linhas que entraram na soma. */
  somadas: number;
  /** Linhas por dose FORA da soma: unidade que não é massa ou desconhecida. */
  foraDaSoma: number;
}

/**
 * Totais técnicos de uma dose.
 *
 * Soma em mg só o que é massa: "2 un" mais "500 mg" não é número nenhum. O que
 * fica fora é contado, para a tela dizer que ficou — total que omite linha em
 * silêncio parece completo e não é.
 */
export function resumirDoses(
  linhas: readonly { teorica: DecimalValue; fisica: DecimalValue; unitCode: string }[],
  capsulasPorDose: number | null,
  units: readonly UomFactorLike[],
): ResumoDaDose {
  let teoricaTotal = new Decimal(0);
  let fisicaTotal = new Decimal(0);
  let somadas = 0;
  let foraDaSoma = 0;
  const destino = units.find((u) => u.code === UNIDADE_DE_MASSA_DA_DOSE);
  for (const linha of linhas) {
    const origem = units.find((u) => u.code === linha.unitCode);
    if (!destino || !origem || origem.dimension !== destino.dimension) {
      foraDaSoma += 1;
      continue;
    }
    const teorica = converterQuantidadeDeUnidade(
      linha.teorica,
      linha.unitCode,
      UNIDADE_DE_MASSA_DA_DOSE,
      units,
    );
    const fisica = converterQuantidadeDeUnidade(
      linha.fisica,
      linha.unitCode,
      UNIDADE_DE_MASSA_DA_DOSE,
      units,
    );
    if (typeof teorica === "string" || typeof fisica === "string") {
      foraDaSoma += 1;
      continue;
    }
    teoricaTotal = teoricaTotal.plus(teorica);
    fisicaTotal = fisicaTotal.plus(fisica);
    somadas += 1;
  }
  const capsulas = inteiroPositivo(capsulasPorDose);
  return {
    teoricaTotal,
    fisicaTotal,
    porCapsulaTotal: capsulas === null ? null : fisicaTotal.dividedBy(capsulas),
    somadas,
    foraDaSoma,
  };
}

/** Premissas da apresentação de uma versão, como a bancada as edita. */
export interface PremissasDaApresentacao {
  dosageForm: DosageFormLike | null;
  capsulesPerDose: number | null;
  capsulesPerPackage: number | null;
  doseAmount: DecimalValue | null;
  doseUomCode: string | null;
  packageContentAmount: DecimalValue | null;
  packageContentUomCode: string | null;
}

/** Por que as premissas não fecham um número de doses. */
export type ApresentacaoBlock =
  | "CAPSULAS_NAO_DIVIDEM"
  | "DOSES_NAO_INTEIRAS"
  | "UOM_DESCONHECIDA"
  | "UOM_INCOMPATIVEL";

/** A frase de cada recusa — a mesma na tela e na resposta da API. */
export const MENSAGENS_DA_APRESENTACAO: Record<ApresentacaoBlock, string> = {
  CAPSULAS_NAO_DIVIDEM:
    "Cápsulas por embalagem precisa ser múltiplo de cápsulas por dose: cada dose leva um número inteiro de cápsulas.",
  DOSES_NAO_INTEIRAS:
    "O conteúdo da embalagem dividido pela dose precisa dar um número inteiro de doses.",
  UOM_DESCONHECIDA: "Informe a unidade da dose e a do conteúdo da embalagem.",
  UOM_INCOMPATIVEL: "Dose e conteúdo da embalagem precisam estar em unidade de massa.",
};

/**
 * Em que formas as doses por embalagem são RESULTADO das premissas.
 *
 * Cápsula: cápsulas por embalagem ÷ cápsulas por dose. Pó: conteúdo ÷ dose.
 * Nas demais formas o número continua digitado, como sempre foi.
 */
export function formaDerivaDoses(forma: DosageFormLike | null | undefined): boolean {
  return forma === "CAPSULE" || forma === "POWDER";
}

/**
 * Doses por embalagem a partir das premissas da apresentação.
 *
 * `null` = premissa ainda em branco (rascunho pode ficar incompleto; a ativação
 * já recusa doses ausentes). Divisão que não fecha devolve o motivo:
 * arredondar doses mudaria em silêncio o material de toda linha por dose.
 */
export function dosesPorEmbalagemDaApresentacao(
  premissas: PremissasDaApresentacao,
  units: readonly UomFactorLike[],
): number | null | ApresentacaoBlock {
  if (premissas.dosageForm === "CAPSULE") {
    const porDose = inteiroPositivo(premissas.capsulesPerDose);
    const porEmbalagem = inteiroPositivo(premissas.capsulesPerPackage);
    if (porDose === null || porEmbalagem === null) return null;
    if (porEmbalagem % porDose !== 0) return "CAPSULAS_NAO_DIVIDEM";
    return porEmbalagem / porDose;
  }
  if (premissas.dosageForm === "POWDER") {
    const dose = decimalPositivo(premissas.doseAmount);
    const conteudo = decimalPositivo(premissas.packageContentAmount);
    if (dose === null || conteudo === null) return null;
    if (!premissas.doseUomCode || !premissas.packageContentUomCode) return "UOM_DESCONHECIDA";
    const unidadeDaDose = units.find((u) => u.code === premissas.doseUomCode);
    const unidadeDoConteudo = units.find((u) => u.code === premissas.packageContentUomCode);
    if (!unidadeDaDose || !unidadeDoConteudo) return "UOM_DESCONHECIDA";
    if (unidadeDaDose.dimension !== "MASS" || unidadeDoConteudo.dimension !== "MASS") {
      return "UOM_INCOMPATIVEL";
    }
    const conteudoNaUnidadeDaDose = converterQuantidadeDeUnidade(
      conteudo,
      premissas.packageContentUomCode,
      premissas.doseUomCode,
      units,
    );
    if (typeof conteudoNaUnidadeDaDose === "string") return conteudoNaUnidadeDaDose;
    const doses = conteudoNaUnidadeDaDose.dividedBy(dose);
    if (!doses.isInteger() || doses.greaterThan(LIMITE_DE_DOSES)) return "DOSES_NAO_INTEIRAS";
    return doses.toNumber();
  }
  return null;
}

/*
 * PERDA PREVISTA DE PRODUÇÃO — premissa GLOBAL da versão (FORMULATION-WORKBENCH-01).
 *
 * É a perda normal esperada do processo produtivo, e não tem nada a ver com a
 * pureza do insumo nem com a reserva de matéria-prima da linha:
 *
 * - PUREZA corrige a massa de UM ingrediente para entregar o mesmo teor ativo;
 * - RESERVA DE MATÉRIA-PRIMA é um adicional POR LINHA, registrado para o lote;
 * - PERDA PREVISTA é da VERSÃO inteira e responde outra pergunta: quanto
 *   precisa ENTRAR na produção para SAIR a quantidade líquida desejada.
 *
 * Por isso ela não muda a composição de uma dose nem de uma cápsula — só a
 * quantidade planejada do lote. E nunca muda quantidade COMERCIAL: Orçamento,
 * Pedido e faturamento continuam na quantidade contratada com o cliente.
 */

/** Por que a perda prevista não fecha um número. */
export type PerdaPrevistaBlock = "PERDA_INVALIDA";

/** Perda de 100% ou mais não tem quantidade bruta: nada sai da produção. */
const PERDA_MAXIMA_EXCLUSIVA = new Decimal(100);

/**
 * A perda declarada, quando ela é utilizável.
 *
 * `null` = NÃO INFORMADA, que é diferente de zero: versão gravada antes desta
 * premissa não declarou nada, e assumir 0% silencioso seria inventar premissa
 * em nome de quem não a declarou. Fora da faixa `[0, 100)` devolve o motivo.
 */
export function lerPerdaPrevista(
  perdaPercent: DecimalValue | null | undefined,
): DecimalInstance | null | PerdaPrevistaBlock {
  if (perdaPercent === null || perdaPercent === undefined || perdaPercent === "") return null;
  let perda: DecimalInstance;
  try {
    perda = new Decimal(perdaPercent);
  } catch {
    return "PERDA_INVALIDA";
  }
  if (!perda.isFinite() || perda.lessThan(0) || perda.greaterThanOrEqualTo(PERDA_MAXIMA_EXCLUSIVA)) {
    return "PERDA_INVALIDA";
  }
  return perda;
}

/**
 * Rendimento esperado (%) = 100 − perda prevista.
 *
 * É DERIVADO, nunca digitado: dois campos para a mesma premissa divergem no
 * primeiro que alguém esquecer de atualizar. `null` quando não há perda
 * declarada — rendimento de 100% presumido seria a mesma invenção.
 */
export function rendimentoEsperado(
  perdaPercent: DecimalValue | null | undefined,
): DecimalInstance | null | PerdaPrevistaBlock {
  const perda = lerPerdaPrevista(perdaPercent);
  if (perda === null || typeof perda === "string") return perda;
  return CEM.minus(perda);
}

/**
 * Quantidade BRUTA planejada: quanto entra na produção para sair a líquida.
 *
 *     bruta = líquida ÷ (1 − perda/100)
 *
 * 5.000 un com 1% de perda = 5.000 ÷ 0,99 = 5.050,505050… Não é
 * `líquida × (1 + perda)`, que dá 5.050 e continua entregando menos que 5.000
 * depois da perda — a diferença cresce com o percentual e o erro é sempre para
 * menos, que é o lado que falta material.
 *
 * Sem perda declarada a bruta É a líquida: nada some, nada é presumido. O
 * arredondamento é de quem PLANEJA, com a unidade e o contexto reais; aqui o
 * número sai inteiro em decimal, sem float em nenhuma etapa.
 */
export function quantidadeBrutaPlanejada(
  quantidadeLiquida: DecimalValue,
  perdaPercent: DecimalValue | null | undefined,
): DecimalInstance | PerdaPrevistaBlock {
  const perda = lerPerdaPrevista(perdaPercent);
  if (typeof perda === "string") return perda;
  const liquida = new Decimal(quantidadeLiquida);
  if (perda === null || perda.isZero()) return liquida;
  return liquida.dividedBy(CEM.minus(perda).dividedBy(CEM));
}

/**
 * Esta base acompanha a quantidade PRODUZIDA ou a quantidade VENDÁVEL?
 *
 * É a distinção que decide quem a perda prevista afeta, e ela já existia no
 * domínio — nenhuma classificação nova foi inventada para esta premissa:
 *
 * - `PER_DOSE` e `FIXED_BASIS` declaram quanto de material forma o que é
 *   produzido. Produzir mais para compensar a perda consome mais deles;
 * - `PER_FINISHED_UNIT` declara o que acompanha CADA unidade acabada — um
 *   pote, uma tampa, um rótulo. Continua atrelado à quantidade vendável.
 *
 * Um componente declarado `PER_FINISHED_UNIT` NÃO é escalado pela perda, ainda
 * que fisicamente pudesse ser (cápsula vazia é o caso real): quem declara a
 * base é a receita, e mudar isso por dentro seria o motor decidir sozinho uma
 * regra de custo que ninguém escreveu.
 */
export function baseSegueQuantidadeProduzida(basis: FormulationComponentBasisLike): boolean {
  return basis === "PER_DOSE" || basis === "FIXED_BASIS";
}

/** Cápsulas por embalagem de uma versão: cápsulas por dose × doses por embalagem. */
export function capsulasPorEmbalagem(
  capsulasPorDose: number | null,
  dosesPorEmbalagem: number | null,
): number | null {
  const porDose = inteiroPositivo(capsulasPorDose);
  const doses = inteiroPositivo(dosesPorEmbalagem);
  return porDose === null || doses === null ? null : porDose * doses;
}
