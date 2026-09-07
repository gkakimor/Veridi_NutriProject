/**
 * Formatação decimal por TEXTO — PREC-FMT-01.
 *
 * Todo formatter de dinheiro, percentual e quantidade desta base passava o
 * valor por `Number` antes de `toLocaleString`. Funciona no caso comum e
 * mente no caso grande: `9007199254740993.12` vira `9007199254740994` no
 * `double` **antes** de a formatação começar, e a tela exibe um número que
 * nunca existiu. A fundação numérica levou o dado a doze casas no banco e à
 * fronteira da API sem perder nada; o último trecho, da API até o pixel, ainda
 * atravessava um float de 53 bits.
 *
 * Este módulo fecha esse trecho. Ele não calcula: recebe o decimal como a API
 * o entrega — string —, escolhe casas, arredonda e agrupa, tudo sobre dígitos.
 *
 * **O contrato visual não muda.** O comportamento é o mesmo que o
 * `Intl.NumberFormat` pt-BR produzia, medido caso a caso: separador de milhar
 * `.`, decimal `,`, espaço não-quebrável depois de `R$`, sinal antes do
 * símbolo, e arredondamento *half-expand* — que é o `ROUND_HALF_UP` do
 * domínio (`PRODUCT_RULES.md` §60, §62 e §63). O que deixa de existir é a
 * conversão para float no meio do caminho.
 *
 * **Não é helper de cálculo.** Nada aqui volta para payload, comparação ou
 * persistência: a saída é texto para leitura humana.
 */

/** Espaço não-quebrável — o mesmo que o `Intl` insere depois de `R$`. */
export const ESPACO_MOEDA = " ";

interface DecimalTexto {
  negativo: boolean;
  /** Dígitos da parte inteira, sem sinal e sem zeros à esquerda supérfluos. */
  inteiro: string;
  /** Dígitos da parte fracionária, sem o ponto. */
  fracao: string;
}

/**
 * Lê um decimal em string, inclusive em notação científica.
 *
 * `Decimal.toString()` emite expoente para valores muito pequenos ou muito
 * grandes — `1e-12` —, e um formatter que não o entenda mostraria a letra `e`
 * na tela. Aqui o expoente é resolvido movendo o ponto, sem aritmética.
 */
function lerDecimal(valor: string): DecimalTexto | null {
  const texto = valor.trim();
  const partes = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(texto);
  if (!partes) return null;

  const [, sinal, inteiroBruto = "", fracaoBruta = "", expoenteBruto] = partes;
  if (inteiroBruto === "" && fracaoBruta === "") return null;

  let inteiro = inteiroBruto;
  let fracao = fracaoBruta;

  // `parseInt` sobre o EXPOENTE, que é um inteiro pequeno de posicionamento —
  // não sobre o valor. Nenhum dígito significativo passa por aqui.
  const expoente = expoenteBruto ? Number.parseInt(expoenteBruto, 10) : 0;
  if (expoente > 0) {
    // Move o ponto para a direita, puxando dígitos da fração.
    const puxados = fracao.slice(0, expoente).padEnd(expoente, "0");
    inteiro += puxados;
    fracao = fracao.slice(expoente);
  } else if (expoente < 0) {
    // Move para a esquerda, empurrando dígitos da parte inteira para a fração.
    const casas = -expoente;
    const preenchido = inteiro.padStart(casas, "0");
    fracao = preenchido.slice(preenchido.length - casas) + fracao;
    inteiro = preenchido.slice(0, preenchido.length - casas);
  }

  inteiro = inteiro.replace(/^0+(?=\d)/, "");
  if (inteiro === "") inteiro = "0";

  return { negativo: sinal === "-", inteiro, fracao };
}

/** O dígito seguinte, por tabela: nem `Number`, nem aritmética. */
const PROXIMO_DIGITO: Record<string, string> = {
  "0": "1",
  "1": "2",
  "2": "3",
  "3": "4",
  "4": "5",
  "5": "6",
  "6": "7",
  "7": "8",
  "8": "9",
};

/** Soma 1 a uma sequência de dígitos, propagando o carry. */
function incrementar(digitos: string): string {
  const saida = digitos.split("");
  let i = saida.length - 1;
  while (i >= 0) {
    const atual = saida[i]!;
    if (atual === "9") {
      saida[i] = "0";
      i -= 1;
    } else {
      saida[i] = PROXIMO_DIGITO[atual]!;
      return saida.join("");
    }
  }
  return `1${saida.join("")}`;
}

/**
 * Reduz a fração a `casas`, com `ROUND_HALF_UP` — metade para cima, afastando
 * do zero, exatamente como o `Intl` fazia e como o domínio decide em §60, §62
 * e §63. Nenhum `Math.round`, nenhum `Number`.
 */
function arredondar(valor: DecimalTexto, casas: number): DecimalTexto {
  if (valor.fracao.length <= casas) {
    return { ...valor, fracao: valor.fracao.padEnd(casas, "0") };
  }
  const mantido = valor.fracao.slice(0, casas);
  const primeiroDescartado = valor.fracao[casas]!;
  if (primeiroDescartado < "5") {
    return { ...valor, fracao: mantido };
  }
  const somado = incrementar(valor.inteiro + mantido);
  // O carry pode ter feito a parte inteira crescer um dígito.
  const tamanhoInteiro = somado.length - casas;
  return {
    negativo: valor.negativo,
    inteiro: somado.slice(0, tamanhoInteiro),
    fracao: somado.slice(tamanhoInteiro),
  };
}

/** Separador de milhar a cada três dígitos, da direita para a esquerda. */
function agrupar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export interface OpcoesDeFormato {
  /** Casas decimais que aparecem sempre, mesmo zeradas. */
  minimo: number;
  /** Teto de casas. Acima dele o valor é arredondado com `ROUND_HALF_UP`. */
  maximo: number;
  /** Separador de milhar. Dinheiro agrupa; quantidade não — ela é copiada. */
  agruparMilhar?: boolean;
}

/**
 * O decimal como texto pt-BR, sem passar por float.
 *
 * Devolve `null` quando a entrada não é um decimal legível — cabe a quem chama
 * decidir o que mostrar no lugar, como já fazia com `NaN`.
 *
 * O sinal acompanha o VALOR ORIGINAL, não o arredondado: `-0,001` exibido com
 * duas casas continua sendo `-0,00`, porque era negativo. É o que o `Intl`
 * fazia, e esconder o sinal diria que o valor é zero neutro.
 */
export function formatarDecimalTexto(
  valor: string,
  { minimo, maximo, agruparMilhar = true }: OpcoesDeFormato,
): string | null {
  const lido = lerDecimal(valor);
  if (!lido) return null;

  const arredondado = arredondar(lido, maximo);

  let fracao = arredondado.fracao;
  while (fracao.length > minimo && fracao.endsWith("0")) {
    fracao = fracao.slice(0, -1);
  }

  const inteiro = agruparMilhar ? agrupar(arredondado.inteiro) : arredondado.inteiro;
  const corpo = fracao.length > 0 ? `${inteiro},${fracao}` : inteiro;
  return arredondado.negativo ? `-${corpo}` : corpo;
}

/**
 * `true` quando o valor não é zero mas some ao ser exibido com `casas`.
 *
 * Mostrar `R$ 0,00` para uma cápsula de `R$ 0,0032` diria que ela é de graça.
 * A pergunta é feita sobre os dígitos, não sobre um float: o valor é zero
 * depois de arredondado, e não era zero antes.
 */
export function sumiriaAoExibir(valor: string, casas: number): boolean {
  const lido = lerDecimal(valor);
  if (!lido) return false;
  const ehZero = (d: DecimalTexto) => /^0*$/.test(d.inteiro) && /^0*$/.test(d.fracao);
  if (ehZero(lido)) return false;
  return ehZero(arredondar(lido, casas));
}

/**
 * `true` quando o valor não é zero e é menor, em módulo, que `10^-casas`.
 *
 * Diferente de `sumiriaAoExibir`: aqui não há arredondamento. `0,0000005` com
 * seis casas **arredondaria** para `0,000001`, mas é menor que `10^-6` — e a
 * quantidade prefere dizer `≈ 0` a afirmar uma casa que o sistema não guarda.
 */
export function abaixoDaMenorCasa(valor: string, casas: number): boolean {
  const lido = lerDecimal(valor);
  if (!lido) return false;
  if (/^0*$/.test(lido.inteiro) === false) return false;
  const significativos = lido.fracao.slice(casas);
  return /^0*$/.test(lido.fracao.slice(0, casas)) && /[1-9]/.test(significativos);
}

/**
 * O sinal e o módulo do decimal, sem passar por float.
 *
 * A tela de impacto de override mostrava `+`/`−` e o valor absoluto, e chegava
 * lá por `String(Math.abs(Number(x)))` — o valor voltava a texto depois de um
 * `double`. Aqui a pergunta é sobre o primeiro caractere, e o módulo é a mesma
 * string sem o sinal.
 */
export function sinalEModulo(valor: string): { negativo: boolean; modulo: string } {
  const lido = lerDecimal(valor);
  if (!lido) return { negativo: false, modulo: valor };
  const ehZero = /^0*$/.test(lido.inteiro) && /^0*$/.test(lido.fracao);
  const texto = valor.trim();
  const modulo = texto.startsWith("-") || texto.startsWith("+") ? texto.slice(1) : texto;
  return { negativo: lido.negativo && !ehZero, modulo };
}

/** `true` quando o valor é zero, qualquer que seja a forma escrita. */
export function ehZeroDecimal(valor: string): boolean {
  const lido = lerDecimal(valor);
  if (!lido) return false;
  return /^0*$/.test(lido.inteiro) && /^0*$/.test(lido.fracao);
}

/**
 * Moeda brasileira a partir do texto já formatado.
 *
 * O sinal vem ANTES do símbolo — `-R$ 1.234,57` —, como o `Intl` produz e como
 * se lê em português.
 */
export function comSimboloReal(corpo: string): string {
  return corpo.startsWith("-")
    ? `-R$${ESPACO_MOEDA}${corpo.slice(1)}`
    : `R$${ESPACO_MOEDA}${corpo}`;
}
