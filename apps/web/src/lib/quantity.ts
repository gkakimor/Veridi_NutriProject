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

  const numero = Number(valor);
  if (!Number.isFinite(numero)) return String(valor);

  /*
   * Um valor pequeno o bastante para sumir com seis casas vira "≈ 0" em vez de
   * "0": dizer zero para material que existe seria mentir na direção perigosa,
   * já que zero significa "não precisa de material".
   */
  if (numero !== 0 && Math.abs(numero) < 10 ** -CASAS) {
    return numero > 0 ? "≈ 0" : "≈ -0";
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
  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: CASAS,
    useGrouping: false,
  });
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
