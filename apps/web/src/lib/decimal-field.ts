import { mensagemDecimalInvalido, parseDecimalInput } from "./decimal-input";

/**
 * O parser central, no formato que as telas usam.
 *
 * `parseDecimalInput` devolve `null` e não decide nada — de propósito: quem
 * sabe se ausência é erro é o formulário. Só que quase toda tela deste ERP
 * responde a `null` da mesma forma: interromper a ação e mostrar a mensagem
 * que cita o separador. Repetir esse `if` em cinquenta lugares é o convite
 * para esquecer dele em um, e o campo esquecido é justamente o que volta a
 * recusar `0,85` sem explicar.
 *
 * A recusa vira `Error`. Cada tela já tem um funil com `catch` que escreve na
 * faixa de erro, então a mensagem chega sem estado novo — e o `throw`
 * acontece antes do `await`, então a requisição nunca sai.
 *
 * Não há tradução de volta aqui: quem exibe usa `formatDecimalInput`.
 */

/** Converte o que foi digitado, ou interrompe a ação nomeando o campo. */
export function exigirDecimal(texto: string, rotulo: string): string {
  const valor = parseDecimalInput(texto);
  if (valor === null) throw new Error(mensagemDecimalInvalido(rotulo));
  return valor;
}

/**
 * O mesmo, para campo que pode ficar em branco.
 *
 * Vazio devolve `null` — ausência é resposta legítima e não é erro. Só o que
 * foi digitado precisa ser legível.
 */
export function exigirDecimalOpcional(texto: string, rotulo: string): string | null {
  if (texto.trim() === "") return null;
  return exigirDecimal(texto, rotulo);
}
