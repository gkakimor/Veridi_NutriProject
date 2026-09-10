/**
 * Entrada de número INTEIRO — o par de `decimal-input.ts` para contagens: prazo
 * em dias, número de parcelas.
 *
 * `Number(texto)` não serve. `Number("abc")` é `NaN`, e o JSON escreve `NaN`
 * como `null`: um erro de digitação chegava ao servidor como a decisão de
 * apagar o campo (QUOTE-INT-FIELDS-01). `Number("1e2")` é 100, `Number("0x1E")`
 * é 30 e `Number("")` é 0 — o que a pessoa não escreveu virava número. Aqui a
 * leitura é estrita, e o resultado diz qual dos três casos é: nunca `NaN`.
 *
 * Aceito: só dígitos, com espaços nas pontas e zeros à esquerda (`" 030 "` é
 * 30). Recusado: sinal, vírgula, ponto, expoente, texto — nada é truncado nem
 * arredondado.
 */

export type LeituraDeInteiro =
  | { tipo: "vazio" }
  | { tipo: "valido"; valor: number }
  | { tipo: "invalido" };

export function lerInteiroOpcional(texto: string): LeituraDeInteiro {
  const limpo = texto.trim();
  if (limpo === "") return { tipo: "vazio" };
  if (!/^\d+$/.test(limpo)) return { tipo: "invalido" };
  const valor = Number(limpo);
  return Number.isSafeInteger(valor) ? { tipo: "valido", valor } : { tipo: "invalido" };
}

export interface LimitesDeInteiro {
  readonly minimo: number;
  /** `null` é sem teto. */
  readonly maximo: number | null;
}

/** O que dizer quando o campo inteiro não serve — com a regra, sem jargão. */
export function mensagemInteiroInvalido(rotulo: string, limites: LimitesDeInteiro): string {
  const faixa =
    limites.maximo !== null
      ? `de ${limites.minimo} a ${limites.maximo}`
      : limites.minimo === 1
        ? "maior que zero"
        : `a partir de ${limites.minimo}`;
  return `${rotulo}: informe um número inteiro ${faixa}.`;
}

/**
 * O erro do campo inteiro, ou `null` quando ele pode seguir. Vazio segue: é
 * "não informado", e quem decide se o campo é obrigatório é o formulário.
 */
export function erroDeInteiro(
  rotulo: string,
  texto: string,
  limites: LimitesDeInteiro,
): string | null {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo === "vazio") return null;
  const dentro =
    leitura.tipo === "valido" &&
    leitura.valor >= limites.minimo &&
    (limites.maximo === null || leitura.valor <= limites.maximo);
  return dentro ? null : mensagemInteiroInvalido(rotulo, limites);
}
