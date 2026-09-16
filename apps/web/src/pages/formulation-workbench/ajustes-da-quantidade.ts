import type { FormulationComponentQuantityMode } from "@veridi/shared";
import { Decimal } from "@veridi/shared";
import { numericInvalidMessage, parsePtBrNumber } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL_TECNICO } from "../../lib/numeric-scales";

/**
 * Ajustes da quantidade de um componente — a MESMA configuração na Formulação
 * e no Modelo de Formulação (§52, FORMULATION-ADJUSTMENTS-UX-01).
 *
 * O painel "O que a quantidade informada significa" NÃO EXISTE MAIS em tela
 * nenhuma (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 2): pureza e reserva de
 * produção são COLUNAS da linha nas duas bancadas, e a coluna preenchida É a
 * resposta. Sobraram o CONTRATO — o que a quantidade significa e quais ajustes
 * ela autoriza — e a VALIDAÇÃO dos dois percentuais, que é a mesma nas duas
 * telas e não pode divergir.
 *
 * A conta da quantidade física não mora aqui: quem precisa dela chama o motor
 * canônico (`calcularQuantidadeDoComponente`).
 */
export interface AjustesDaQuantidade {
  quantityMode: FormulationComponentQuantityMode;
  /**
   * Texto do campo, em português (`98,5`); vazio = não informado — nunca 0%
   * nem 100% implícito. Valor da API entra por `toPtBrEditText`.
   */
  purityPercentApplied: string;
  overagePercent: string;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
}

export type CampoDeAjuste = "purityPercentApplied" | "overagePercent";

/**
 * As regras da bancada, ditas antes de gravar: pureza 0 < x ≤ 100, reserva
 * ≥ 0, vazio = não informado. A mensagem nomeia o componente, porque numa
 * receita de doze linhas "Pureza inválida" não diz onde procurar.
 */
export function errosDosAjustes(
  ajustes: AjustesDaQuantidade,
  nome: string,
  /**
   * Como o segundo percentual se chama NESTA tela.
   *
   * A regra é a mesma nos dois lugares — não negativo, seis casas — e por isso
   * vive numa função só. O NOME não é: a bancada o chama de reserva de
   * matéria-prima, e uma recusa que nomeia um campo que a pessoa não vê na
   * tela manda procurar o que não existe.
   */
  rotuloDoOverage = "Overage %",
): Partial<Record<CampoDeAjuste, string>> {
  const erros: Partial<Record<CampoDeAjuste, string>> = {};
  const pureza = parsePtBrNumber(ajustes.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO);
  if (pureza.tipo === "invalido") {
    erros.purityPercentApplied = `${nome} — ${numericInvalidMessage("Pureza %", pureza.motivo, OPCOES_PERCENTUAL_TECNICO)}`;
  } else if (pureza.tipo === "valido") {
    const valor = new Decimal(pureza.valor);
    if (valor.lte(0) || valor.gt(100)) {
      erros.purityPercentApplied = `${nome} — Pureza % deve ser maior que zero e no máximo 100.`;
    }
  }
  const overage = parsePtBrNumber(ajustes.overagePercent, OPCOES_PERCENTUAL_TECNICO);
  if (overage.tipo === "invalido") {
    erros.overagePercent = `${nome} — ${numericInvalidMessage(rotuloDoOverage, overage.motivo, OPCOES_PERCENTUAL_TECNICO)}`;
  }
  return erros;
}
