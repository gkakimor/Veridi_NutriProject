import { Decimal } from "@veridi/shared";
import { parseDecimalInput } from "./decimal-input";
import { formatQuantity } from "./quantity";

/**
 * Quantidade digitada contra um teto exato.
 *
 * O teto é `DECIMAL(24,12)` e a tela mostra seis casas: uma reserva de
 * `6.122448979592 kg` aparece como `6,122449 kg`. O corte é deliberado — seis
 * casas é o que se confere contra uma balança —, mas ele criava um número que
 * a própria tela recusava: `ROUND_HALF_UP` sobe a última casa, o valor exibido
 * fica MAIOR que o teto real, e a validação compara com o real. Digitar o que
 * estava escrito na frente do operador era a única entrada impossível.
 *
 * Arredondar o teto para baixo tiraria o "acima do limite" e criaria coisa
 * pior: consumir `6,122448` deixa `0,000000979592` de reserva, e
 * `reconciliation.ts` não tem tolerância por decisão — a Ordem de Produção
 * ficaria `PENDING_PARTIAL` pedindo justificativa de variância para um
 * resíduo que ninguém criou.
 *
 * A regra é o ROUND-TRIP: **digitar o valor exibido significa "usar tudo"**, e
 * o que vai para o servidor é o teto canônico, com as doze casas. Digitar
 * menos continua sendo consumo parcial legítimo, e vai como foi digitado.
 * Digitar mais continua recusado, sem tolerância — inclusive por
 * `10^-12`, que é diferença real e não ruído.
 *
 * Nada aqui passa por `Number`: §66 é explícita de que quantidade de domínio
 * se compara com `Decimal`.
 */

export type QuantidadeContraLimite =
  | { status: "vazio" }
  | { status: "ilegivel" }
  | { status: "acima" }
  /** `valorCanonico` é o que deve ir no payload — nunca o texto digitado. */
  | { status: "ok"; valorCanonico: string; usouTodoOLimite: boolean };

/**
 * Interpreta o que foi digitado à luz do teto e devolve o que enviar.
 *
 * `limiteCanonico` é o valor cru da API, com toda a precisão. Quem chama
 * exibe `formatQuantity(limiteCanonico)`; é exatamente esse texto que o
 * round-trip reconhece.
 */
export function resolverQuantidadeContraLimite(
  digitado: string,
  limiteCanonico: string,
): QuantidadeContraLimite {
  const texto = digitado.trim();
  if (texto === "") return { status: "vazio" };

  const normalizado = parseDecimalInput(texto);
  if (normalizado === null) return { status: "ilegivel" };

  const valor = new Decimal(normalizado);
  const limite = new Decimal(limiteCanonico);

  // O teto tal como a tela o escreveu. `formatQuantity` devolve vírgula e
  // nunca separador de milhar — de propósito, justamente para poder ser
  // copiado de volta —, então o mesmo parser de entrada o entende.
  const limiteExibido = parseDecimalInput(formatQuantity(limiteCanonico));
  if (limiteExibido !== null && valor.equals(new Decimal(limiteExibido))) {
    return { status: "ok", valorCanonico: limite.toString(), usouTodoOLimite: true };
  }

  if (valor.greaterThan(limite)) return { status: "acima" };

  return { status: "ok", valorCanonico: normalizado, usouTodoOLimite: valor.equals(limite) };
}

/**
 * Só a pergunta "isto passa do teto?", para quem ainda não precisa do payload.
 *
 * Responde `false` para o valor exibido do teto: quem digita o que a tela
 * mostra está pedindo o limite inteiro, não excedendo-o.
 */
export function excedeLimiteExibido(digitado: string, limiteCanonico: string): boolean {
  return resolverQuantidadeContraLimite(digitado, limiteCanonico).status === "acima";
}
