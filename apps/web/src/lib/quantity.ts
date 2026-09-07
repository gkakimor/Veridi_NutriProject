import { abaixoDaMenorCasa, formatarDecimalTexto } from "./decimal-format";

/**
 * Quantidade para leitura humana.
 *
 * O domínio guarda quantidade como `Decimal(18,6)`: seis casas é a precisão
 * que o sistema realmente tem. Valores DERIVADOS — necessidade por unidade,
 * rateio, conversão — nascem de divisão e chegam à tela com vinte e duas
 * casas: `0.0061224489795918367347 kg`.
 *
 * Isso não é precisão, é ruído com aparência de precisão. E aparece justamente
 * nas telas em que alguém compara o número com a realidade física — pesar um
 * componente, bater uma contagem de estoque. Quem lê tem que arredondar de
 * cabeça antes de conseguir usar, e arredondar de cabeça é onde o erro entra.
 *
 * O corte é em seis casas porque é o que o banco guarda; passar disso seria
 * afirmar uma exatidão que não existe em lugar nenhum do sistema. Zeros à
 * direita saem, porque `2,500000 kg` não diz nada que `2,5 kg` não diga.
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
   * `10^-6` e o sistema não guarda essa casa em quantidade nenhuma.
   */
  if (abaixoDaMenorCasa(texto, CASAS)) {
    return texto.trim().startsWith("-") ? "≈ -0" : "≈ 0";
  }

  /*
   * SEM separador de milhar, e isto é decisão.
   *
   * `1.000 un` é o português correto para ler, e é veneno para copiar: o campo
   * decimal deste sistema trata um separador único como casa decimal — de
   * propósito, porque adivinhar milhar erra por um fator de mil. Então o valor
   * exibido com agrupamento, colado num campo, viraria 1.
   *
   * Quantidade é número que a pessoa confere contra balança e redigita. Ela
   * precisa poder copiar o que vê. Dinheiro é outro caso e tem formatador
   * próprio, onde o agrupamento ajuda e ninguém copia de volta.
   */
  const corpo = formatarDecimalTexto(texto, {
    minimo: 0,
    maximo: CASAS,
    agruparMilhar: false,
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
