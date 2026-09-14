import { numericInvalidMessage, parsePtBrNumber } from "./numeric-ptbr";
import type { NumericOptions } from "./numeric-ptbr";

/**
 * A borda dos campos numéricos, no formato que as telas usam.
 *
 * O parser é o canônico, `parsePtBrNumber` (`numeric-ptbr.ts`) — o mesmo que
 * `DecimalField`, `MoneyField` e `PercentField` usam para decidir o que entra
 * e o que acusar. Borda e campo leem igual: o texto que o campo aceitou é o
 * texto que a gravação entende, com o mesmo `scale` (PTBR-NUMERIC-INPUT-
 * ROLLOUT-01). Antes disto a borda era `parseDecimalInput`, que lia `1.234`
 * como um vírgula duzentos e trinta e quatro e recusava `1.234,56`.
 *
 * Quase toda tela deste ERP responde ao texto ilegível da mesma forma:
 * interromper a ação e mostrar a mensagem que diz o que escrever. A recusa
 * vira `Error`. Cada tela já tem um funil com `catch` que escreve na faixa de
 * erro, então a mensagem chega sem estado novo — e o `throw` acontece antes do
 * `await`, então a requisição nunca sai. Nada vira zero em silêncio.
 *
 * Não há tradução de volta aqui: carregar valor da API no campo é
 * `toPtBrEditText`, com o mesmo `scale`.
 */

/** Campo obrigatório deixado em branco. */
export function mensagemNumeroVazio(rotulo: string): string {
  return `${rotulo}: informe um valor.`;
}

/** Converte o que foi digitado, ou interrompe a ação nomeando o campo. */
export function exigirDecimal(texto: string, rotulo: string, opcoes: NumericOptions): string {
  const leitura = parsePtBrNumber(texto, opcoes);
  if (leitura.tipo === "valido") return leitura.valor;
  throw new Error(
    leitura.tipo === "vazio"
      ? mensagemNumeroVazio(rotulo)
      : numericInvalidMessage(rotulo, leitura.motivo, opcoes),
  );
}

/**
 * O mesmo, para campo que pode ficar em branco.
 *
 * Vazio devolve `null` — ausência é resposta legítima e não é erro. Só o que
 * foi digitado precisa ser legível.
 */
export function exigirDecimalOpcional(
  texto: string,
  rotulo: string,
  opcoes: NumericOptions,
): string | null {
  const leitura = parsePtBrNumber(texto, opcoes);
  if (leitura.tipo === "vazio") return null;
  if (leitura.tipo === "valido") return leitura.valor;
  throw new Error(numericInvalidMessage(rotulo, leitura.motivo, opcoes));
}

/**
 * O valor canônico, ou `null` quando o campo está vazio ou ilegível — para
 * prévia de cálculo e para habilitar botão, onde não há o que interromper.
 */
export function decimalLegivel(texto: string, opcoes: NumericOptions): string | null {
  const leitura = parsePtBrNumber(texto, opcoes);
  return leitura.tipo === "valido" ? leitura.valor : null;
}

/**
 * A mensagem do texto que não é número, ou `null` — vazio segue (quem decide
 * se o campo é obrigatório é o formulário) e legível segue.
 */
export function erroDoDecimal(rotulo: string, texto: string, opcoes: NumericOptions): string | null {
  const leitura = parsePtBrNumber(texto, opcoes);
  return leitura.tipo === "invalido" ? numericInvalidMessage(rotulo, leitura.motivo, opcoes) : null;
}
