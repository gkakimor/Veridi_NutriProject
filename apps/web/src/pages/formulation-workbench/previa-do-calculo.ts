import type { UnitOfMeasureDTO } from "@veridi/shared";
import { calcularQuantidadeDaDose, calcularQuantidadeDoComponente } from "@veridi/shared";
import { decimalLegivel } from "../../lib/decimal-field";
import { formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL_TECNICO, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { formatQuantity } from "../../lib/quantity";
import type { LinhaDaReceita } from "./linha-da-receita";

/** As unidades como o motor compartilhado as consome. */
export function unidadesDoMotor(units: UnitOfMeasureDTO[]) {
  return units.map((unit) => ({
    code: unit.code,
    dimension: unit.dimension,
    toBaseFactor: unit.toBaseFactor,
  }));
}

/**
 * Prévia do físico ENQUANTO se digita.
 *
 * As colunas de equivalente e de físico vinham do servidor, então uma linha
 * nova ou recém-editada mostrava um travessão até salvar — e é justamente
 * enquanto se edita que a pessoa precisa ver o efeito do que está fazendo.
 * Descobrir o número depois de gravar é descobrir tarde.
 *
 * A conta vem de `@veridi/shared`, a MESMA função que a API chama. Recalcular
 * aqui com uma cópia da fórmula criaria um segundo motor, e duas contas para o
 * mesmo número acabam discordando — com a agravante de que a que aparece na
 * tela seria a que ninguém usa.
 *
 * Devolve `null` quando a conta não é possível (premissa ausente, unidade
 * incompatível). `null` vira travessão, nunca zero: zero seria "não precisa de
 * material".
 */
export function previaDoComponente(
  row: LinhaDaReceita,
  basisQuantity: string,
  dosesPerPackage: number | null,
  units: UnitOfMeasureDTO[],
): { teorico: string; fisico: string } | null {
  const quantidade = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade === null) return null;

  const resultado = calcularQuantidadeDoComponente(
    {
      basis: row.basis,
      quantity: quantidade,
      unitCode: row.unitCode,
      stockUnitCode: row.stockUnitCode,
      purityPercent: decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
      overagePercent: decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO),
      quantityMode: row.quantityMode,
      applyPurityAdjustment: row.applyPurityAdjustment,
      applyOverageAdjustment: row.applyOverageAdjustment,
    },
    1,
    { basisQuantity: decimalLegivel(basisQuantity, OPCOES_QUANTIDADE) ?? "0", dosesPerPackage },
    units.map((u) => ({ code: u.code, dimension: u.dimension, toBaseFactor: u.toBaseFactor })),
  );

  if (typeof resultado === "string") return null;
  return { teorico: resultado.theoretical.toString(), fisico: resultado.physical.toString() };
}

/**
 * Prévia da DOSE — alvo, física e por cápsula — enquanto se digita.
 *
 * É a mesma função que a API chama (`calcularQuantidadeDaDose`), pelo mesmo
 * motivo da prévia por embalagem: a bancada existe para mostrar o efeito da
 * pureza e das cápsulas ANTES de gravar, e um número que a API não confirmaria
 * é pior que número nenhum. `null` vira travessão — nunca zero.
 */
export function previaDaDose(
  row: LinhaDaReceita,
  capsulasPorDose: number | null,
  units: UnitOfMeasureDTO[],
): { teorica: string; fisica: string; porCapsula: string | null } | null {
  const quantidade = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade === null) return null;

  const resultado = calcularQuantidadeDaDose(
    {
      basis: row.basis,
      quantity: quantidade,
      unitCode: row.unitCode,
      purityPercent: decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
      overagePercent: decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO),
      quantityMode: row.quantityMode,
      applyPurityAdjustment: row.applyPurityAdjustment,
      applyOverageAdjustment: row.applyOverageAdjustment,
    },
    capsulasPorDose,
    unidadesDoMotor(units),
  );
  if (resultado === null || typeof resultado === "string") return null;
  return {
    teorica: resultado.teorica.toFixed(),
    fisica: resultado.fisica.toFixed(),
    porCapsula: resultado.porCapsula ? resultado.porCapsula.toFixed() : null,
  };
}

/** Um operando do `CalcHint` — valor lido, papel na conta e o número que ele vale. */
export interface OperandoDoCalculo {
  valor: string;
  papel: string;
  operador?: string;
  numero?: number;
}

/**
 * A conta da dose, escrita como se lê: alvo ativo ÷ pureza.
 *
 * É a mesma aritmética da planilha da Veridi, com os números desta linha. O
 * `CalcHint` confere a explicação contra o resultado exibido, então o que
 * aparece aqui não pode ser uma versão resumida da conta.
 */
export function operandosDaDose(row: LinhaDaReceita): OperandoDoCalculo[] {
  const alvo = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  const operandos: OperandoDoCalculo[] = [
    {
      valor: `${formatQuantity(alvo ?? row.quantity)} ${row.unitCode}`,
      papel: "alvo ativo por dose",
      numero: Number(alvo),
    },
  ];
  const teorico = row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS";
  if (teorico && row.applyPurityAdjustment && row.purityPercentApplied) {
    const pureza = Number(decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO));
    if (pureza > 0) {
      operandos.push({
        valor: formatPercentPtBr(
          decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
          OPCOES_PERCENTUAL_TECNICO,
        ),
        papel: "pureza",
        operador: "÷",
        numero: pureza / 100,
      });
    }
  }
  if (teorico && row.applyOverageAdjustment && row.overagePercent) {
    const overage = Number(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO));
    if (overage >= 0) {
      operandos.push({
        valor: `(1 + ${formatPercentPtBr(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO), OPCOES_PERCENTUAL_TECNICO)})`,
        papel: "reserva de produção",
        numero: 1 + overage / 100,
      });
    }
  }
  return operandos;
}

/**
 * A conta da quantidade física, escrita como se lê — e refazível à mão.
 *
 * A versão anterior listava só `quantidade × (1 + overage) ÷ pureza` e omitia
 * dois fatores que o motor aplica: a base da fórmula e a conversão de unidade.
 * Com base 300, isso mostrava `22 kg × 1,23 ÷ 0,99`, que dá 27,33, ao lado do
 * valor exibido de 0,091111 kg. O número da tela estava certo; a explicação,
 * não — e explicação errada convence mais do que explicação nenhuma.
 *
 * A ordem segue a do motor: base, unidade, pureza, reserva.
 */
export function operandosDoFisico(
  row: LinhaDaReceita,
  basisQuantity: string,
  dosesPerPackage: number | null,
  units: UnitOfMeasureDTO[],
): OperandoDoCalculo[] {
  const teorico = row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS";
  const operandos: OperandoDoCalculo[] = [
    {
      valor: `${formatQuantity(decimalLegivel(row.quantity, OPCOES_QUANTIDADE) ?? row.quantity)} ${row.unitCode}`,
      papel: teorico ? "quantidade teórica" : "quantidade informada",
      numero: Number(decimalLegivel(row.quantity, OPCOES_QUANTIDADE)),
    },
  ];

  if (row.basis === "FIXED_BASIS") {
    const base = decimalLegivel(basisQuantity, OPCOES_QUANTIDADE);
    if (base !== null && Number(base) !== 0) {
      operandos.push({
        valor: formatQuantity(base),
        papel: "base da fórmula",
        operador: "÷",
        numero: Number(base),
      });
    }
  } else if (row.basis === "PER_DOSE" && dosesPerPackage) {
    operandos.push({
      valor: formatIntegerPtBr(dosesPerPackage),
      papel: "doses por embalagem",
      numero: dosesPerPackage,
    });
  }

  // Conversão de unidade só entra na conta quando as duas diferem.
  const de = units.find((u) => u.code === row.unitCode);
  const para = units.find((u) => u.code === row.stockUnitCode);
  if (de && para && de.code !== para.code && Number(para.toBaseFactor) !== 0) {
    const fator = Number(de.toBaseFactor) / Number(para.toBaseFactor);
    operandos.push({
      valor: formatQuantity(String(fator)),
      papel: `${de.code} para ${para.code}`,
      numero: fator,
    });
  }

  if (teorico && row.applyPurityAdjustment && row.purityPercentApplied) {
    const pureza = Number(decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO));
    if (pureza > 0) {
      operandos.push({
        valor: formatPercentPtBr(
          decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
          OPCOES_PERCENTUAL_TECNICO,
        ),
        papel: "pureza",
        operador: "÷",
        numero: pureza / 100,
      });
    }
  }
  if (teorico && row.applyOverageAdjustment && row.overagePercent) {
    const overage = Number(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO));
    if (overage >= 0) {
      operandos.push({
        valor: `(1 + ${formatPercentPtBr(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO), OPCOES_PERCENTUAL_TECNICO)})`,
        papel: "reserva de produção",
        numero: 1 + overage / 100,
      });
    }
  }
  return operandos;
}
