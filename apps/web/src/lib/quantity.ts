import { abaixoDaMenorCasa, formatarDecimalTexto } from "./decimal-format";

/**
 * Quantidade para leitura humana.
 *
 * O domínio guarda quantidade como `DECIMAL(24,12)` desde o PREC-MIG-A — doze
 * casas, não seis. Valores DERIVADOS — necessidade por unidade, rateio,
 * conversão — nascem de divisão e chegam à tela com ainda mais que isso:
 * `0.0061224489795918367347 kg`.
 *
 * Isso não é precisão, é ruído com aparência de precisão. E aparece justamente
 * nas telas em que alguém compara o número com a realidade física — pesar um
 * componente, bater uma contagem de estoque. Quem lê tem que arredondar de
 * cabeça antes de conseguir usar, e arredondar de cabeça é onde o erro entra.
 *
 * O corte em seis casas é decisão de LEITURA, não limite de armazenamento: é a
 * resolução com que a operação pesa e confere. Zeros à direita saem, porque
 * `2,500000 kg` não diz nada que `2,5 kg` não diga.
 *
 * Consequência que custou o F-08-1: exibido ≠ guardado. Com `ROUND_HALF_UP` o
 * texto pode ficar ACIMA do valor real, e comparar o que foi digitado direto
 * contra o limite exato recusa o próprio número impresso na tela. Campo com
 * teto não compara na mão — usa `resolverQuantidadeContraLimite`
 * (`quantity-limit.ts`), que trata "digitou o exibido" como "usar todo o
 * limite" e envia o valor canônico.
 *
 * O valor completo continua intacto no dado — isto é formatação de exibição,
 * nunca de armazenamento nem de cálculo.
 */

const CASAS = 6;

export function formatQuantity(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";

  /*
   * A API entrega quantidade como STRING — `DECIMAL(24,12)` desde o
   * PREC-MIG-A. O `number` na assinatura sobrou de chamadores antigos e é
   * convertido para texto sem passar por aritmética; quem entrega `number` já
   * perdeu o que houvesse a perder antes de chegar aqui.
   */
  const texto = typeof valor === "number" ? String(valor) : valor;

  /*
   * Um valor pequeno o bastante para sumir com seis casas vira "≈ 0" em vez de
   * "0": dizer zero para material que existe seria mentir na direção perigosa,
   * já que zero significa "não precisa de material".
   *
   * A pergunta é feita sobre os dígitos, e é de MAGNITUDE, não de
   * arredondamento: `0,0000005` arredondaria para `0,000001`, mas é menor que
   * `10^-6`, que é a menor casa que esta tela mostra. O dado continua lá, com
   * as doze casas; o "≈" existe para não afirmar zero sobre o que não é zero.
   */
  if (abaixoDaMenorCasa(texto, CASAS)) {
    return texto.trim().startsWith("-") ? "≈ -0" : "≈ 0";
  }

  /*
   * COM separador de milhar desde PTBR-NUMERIC-DISPLAY-AUDIT-01.
   *
   * Até ali a quantidade saía sem agrupamento, para poder ser copiada de volta
   * num campo. O preço era a mesma informação com duas caras: o campo, fora do
   * foco, mostra `1.234,5`, e a leitura ao lado mostrava `1234,5`. Número
   * exibido segue a convenção pt-BR, como o campo.
   *
   * Copiar de volta continua funcionando no caso comum: `1.234,5` e
   * `12.345,678` são lidos pelo parser do campo (`numeric-ptbr.ts`). O único
   * texto que ele recusa é `1.234` sozinho — milhar sem casa decimal, ambíguo
   * em campo decimal —, com mensagem dizendo como escrever. Recusar é o lado
   * seguro: errar esse número é errar por mil. Quem compara digitado com o
   * exibido (`quantity-limit.ts`) tira os pontos antes de ler.
   */
  const corpo = formatarDecimalTexto(texto, {
    minimo: 0,
    maximo: CASAS,
    agruparMilhar: true,
  });
  return corpo ?? String(valor);
}

/** A mesma quantidade com a unidade colada, que é como ela deve ser lida. */
export function formatQuantityWithUnit(
  valor: string | number | null | undefined,
  unidade: string | null | undefined,
): string {
  const numero = formatQuantity(valor);
  if (numero === "—") return "—";
  return unidade ? `${numero} ${unidade}` : numero;
}
