import { comSimboloReal, formatarDecimalTexto } from "./decimal-format";
import { formatDecimalInput } from "./decimal-input";

/**
 * Número em português — a foundation de entrada e exibição numérica
 * (PTBR-NUMERIC-INPUT-FOUNDATION-01). Os campos que usam isto moram em
 * `components/NumericField.tsx`; a regra de uso, em `docs/UI_BRAND.md`,
 * "Campos numéricos e valores pt-BR".
 *
 * Três valores, cada um com seu nome, para não se confundirem:
 *
 * - **digitado** — o texto do campo, em português, como a pessoa escreveu:
 *   `"1234,5"`, `"12,"`, `"1.234,56"`. É o `value` dos campos e o estado que o
 *   formulário guarda. `""` é campo vazio — nunca zero;
 * - **normalizado** — a string decimal canônica que a API entende, `"1234.56"`.
 *   Sai de `parsePtBrNumber`, na borda: prévia de cálculo, gravação;
 * - **exibido** — o número formatado para leitura: `"1.234,56"`,
 *   `"R$ 1.234,56"`, `"12,50%"`. Nunca volta para payload.
 *
 * Nada aqui passa valor por `Number`: leitura, arredondamento e agrupamento são
 * feitos sobre dígitos, como em `decimal-format.ts`.
 *
 * ## Milhar e decimal
 *
 * `decimal-input.ts` recusa separador de milhar, e as telas que ainda o usam
 * continuam assim até migrarem (PTBR-NUMERIC-INPUT-ROLLOUT-01). Aqui o
 * separador de milhar é aceito, porque é o que vem colado de planilha
 * (`1.234,56`) — mas a regra continua sendo não adivinhar:
 *
 * - vírgula é sempre a casa decimal, e pontos antes dela são milhar, em grupos
 *   de três (`1.234.567,89`);
 * - sem vírgula, dois ou mais pontos só podem ser milhar (`1.234.567`);
 * - sem vírgula, um ponto que não forma grupo de milhar é casa decimal
 *   (`1234.56`, `0.125`, `12.5`) — o formato de sistema e planilha em inglês;
 * - `1.234` sozinho — um ponto e exatamente três dígitos — é **ambíguo** em
 *   campo decimal: mil duzentos e trinta e quatro para quem escreve em
 *   português, um vírgula duzentos e trinta e quatro para quem copia de outro
 *   sistema. Errar é errar por um fator de mil, em preço ou peso. É recusado e
 *   a mensagem diz como escrever. Em campo inteiro a leitura decimal não
 *   existe, e `1.234` é 1234.
 *
 * Nenhum valor é arredondado na entrada: casa além do `scale` só passa se for
 * zero (`12,340` num campo de 2 casas é `12.34`); dígito que não seja zero é
 * recusado — o domínio decide o fechamento, não o campo.
 */

export interface NumericOptions {
  /** Casas decimais aceitas — decisão do domínio. `0` é número inteiro. */
  readonly scale: number;
  /** Aceita sinal de menos. Padrão `false`: a maior parte do ERP não tem negativo. */
  readonly allowNegative?: boolean;
}

export type NumericInvalidReason =
  /** Letra, símbolo, espaço no meio, sinal fora do começo, ou nenhum dígito. */
  | "caractere"
  /** Sinal de menos num campo que não aceita negativo. */
  | "negativo"
  /** Vírgula repetida, ou ponto depois da vírgula (`1,234.56`). */
  | "separador"
  /** Ponto de milhar fora do lugar (`1.23,45`, `1.2.3`). */
  | "agrupamento"
  /** `1.234` em campo decimal: milhar ou decimal, não dá para saber. */
  | "ambiguo"
  /** Casa decimal além do `scale` que não é zero — ou fração em campo inteiro. */
  | "casas";

export type NumericReading =
  | { readonly tipo: "vazio" }
  | { readonly tipo: "valido"; readonly valor: string }
  | { readonly tipo: "invalido"; readonly motivo: NumericInvalidReason };

type Invalido = Extract<NumericReading, { tipo: "invalido" }>;

function invalido(motivo: NumericInvalidReason): Invalido {
  return { tipo: "invalido", motivo };
}

/** Milhar completo: primeiro grupo de 1 a 3 dígitos sem zero à esquerda, os outros de 3. */
const MILHAR = /^[1-9]\d{0,2}(?:\.\d{3})+$/;

/** Milhar ainda sendo digitado: `1.`, `1.2`, `1.234.5`. */
const MILHAR_EM_CONSTRUCAO = /^[1-9]\d{0,2}(?:\.\d{3})*\.\d{0,3}$/;

function conferirScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`scale inválido (${scale}): use um inteiro a partir de 0.`);
  }
}

/** Parte inteira e fração, já sem os pontos de milhar. */
function separar(corpo: string, scale: number): { inteiro: string; fracao: string } | Invalido {
  const virgulas = corpo.split(",").length - 1;
  if (virgulas > 1) return invalido("separador");

  if (virgulas === 1) {
    const [antes = "", depois = ""] = corpo.split(",");
    if (depois.includes(".")) return invalido("separador");
    if (antes.includes(".") && !MILHAR.test(antes)) return invalido("agrupamento");
    return { inteiro: antes.replaceAll(".", ""), fracao: depois };
  }

  if (!corpo.includes(".")) return { inteiro: corpo, fracao: "" };

  if (MILHAR.test(corpo)) {
    const pontos = corpo.split(".").length - 1;
    if (scale > 0 && pontos === 1) return invalido("ambiguo");
    return { inteiro: corpo.replaceAll(".", ""), fracao: "" };
  }

  const [antes = "", depois = "", ...resto] = corpo.split(".");
  if (resto.length > 0) return invalido("agrupamento");
  // Um ponto só, que não é milhar: casa decimal — que campo inteiro não tem.
  if (scale === 0) return invalido("casas");
  return { inteiro: antes, fracao: depois };
}

/**
 * O parser canônico: texto em português para a string decimal da API.
 *
 * `"1.234,56"`, `"1234,56"` e `"1234.56"` dão `"1234.56"`. Zeros da parte
 * inteira à esquerda saem, zeros da fração dentro do `scale` ficam (`"0,00"` é
 * `"0.00"` — zero é valor), e zero não tem sinal. Espaços nas pontas são
 * ignorados; no meio, recusados.
 *
 * Vazio devolve `vazio`, e não erro nem zero: quem decide se o campo é
 * obrigatório é o formulário.
 */
export function parsePtBrNumber(texto: string, options: NumericOptions): NumericReading {
  const { scale, allowNegative = false } = options;
  conferirScale(scale);

  const limpo = texto.trim();
  if (limpo === "") return { tipo: "vazio" };

  const negativo = limpo.startsWith("-");
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/^[\d.,]*\d[\d.,]*$/.test(corpo)) return invalido("caractere");
  if (negativo && !allowNegative) return invalido("negativo");

  const partes = separar(corpo, scale);
  if ("tipo" in partes) return partes;

  if (/[1-9]/.test(partes.fracao.slice(scale))) return invalido("casas");
  const fracao = partes.fracao.slice(0, scale);
  const inteiro = partes.inteiro.replace(/^0+(?=\d)/, "") || "0";
  const zero = inteiro === "0" && /^0*$/.test(fracao);
  const sinal = negativo && !zero ? "-" : "";
  return { tipo: "valido", valor: `${sinal}${inteiro}${fracao ? `.${fracao}` : ""}` };
}

/**
 * `true` quando o texto é um estado aceitável DURANTE a digitação.
 *
 * Mais largo que `parsePtBrNumber`: aceita o que ainda pode virar número
 * válido — `""`, `"-"`, `"12,"`, `","`, `"1."`, `"1.234"` (que pode seguir para
 * `1.234,5`). Recusa o que nenhuma tecla a mais conserta: letra, segunda
 * vírgula, ponto depois da vírgula, casa além do `scale`, sinal fora do começo
 * ou em campo sem negativo. Campo inteiro aceita só dígitos.
 *
 * É a guarda de cada tecla. A leitura final — inclusive o ambíguo — é do
 * `parsePtBrNumber`, na saída do campo e na borda.
 */
export function isPtBrNumberDraft(texto: string, options: NumericOptions): boolean {
  const { scale, allowNegative = false } = options;
  conferirScale(scale);

  const negativo = texto.startsWith("-");
  if (negativo && !allowNegative) return false;
  const corpo = negativo ? texto.slice(1) : texto;

  if (/^\d*$/.test(corpo)) return true;
  if (scale === 0) return false;

  const comVirgula = /^([\d.]*),(\d*)$/.exec(corpo);
  if (comVirgula) {
    const [, antes = "", depois = ""] = comVirgula;
    return depois.length <= scale && (!antes.includes(".") || MILHAR.test(antes));
  }

  return MILHAR_EM_CONSTRUCAO.test(corpo) || new RegExp(`^\\d*\\.\\d{0,${scale}}$`).test(corpo);
}

export interface PasteOptions extends NumericOptions {
  /** O símbolo que a planilha costuma trazer junto e que sai na colagem. */
  readonly simbolo?: "moeda" | "percentual";
}

/**
 * O que inserir quando a pessoa cola um texto no campo.
 *
 * Número completo e legível vira texto digitado normalizado: `1.234,56`,
 * `1234.56` e `R$ 1.234,56` (em campo de moeda) viram `1234,56`; `12,5%` (em
 * percentual) vira `12,5`. Qualquer outra coisa volta só sem os espaços das
 * pontas — e o campo decide, pela mesma guarda da digitação, se aceita. Texto
 * absurdo é recusado inteiro; nada é adivinhado nem cortado.
 */
export function normalizePastedNumber(texto: string, options: PasteOptions): string {
  let limpo = texto.trim();
  if (options.simbolo === "moeda") limpo = limpo.replace(/^(-?)\s*R\$\s*/, "$1");
  if (options.simbolo === "percentual") limpo = limpo.replace(/\s*%$/, "");
  const leitura = parsePtBrNumber(limpo, options);
  return leitura.tipo === "valido" ? formatDecimalInput(leitura.valor) : limpo;
}

/** Notação científica (`Decimal.toString` de valor minúsculo) em dígitos, sem aritmética. */
function semExpoente(texto: string): string {
  const expoente = /[eE]([+-]?\d+)$/.exec(texto);
  if (!expoente) return texto;
  // `parseInt` no EXPOENTE, que só posiciona o ponto — não no valor.
  const casas = texto.length + Math.abs(Number.parseInt(expoente[1] ?? "0", 10));
  const corpo = formatarDecimalTexto(texto, { minimo: 0, maximo: casas, agruparMilhar: false });
  return corpo === null ? texto : corpo.replace(",", ".");
}

/**
 * Valor da API para o texto do campo — a carga do formulário.
 *
 * Troca o ponto pela vírgula e preserva os dígitos: salvar sem editar devolve
 * o que o servidor mandou (`NUMERIC_PRECISION_AUDIT.md` §11.5). Só saem os
 * zeros além do `scale`, que a fronteira da API recusaria (`"12.50000000"` num
 * campo de 4 casas vira `"12,5000"`). Casa além do `scale` que não é zero fica,
 * e o campo acusa — cortar seria arredondar escondido.
 */
export function toPtBrEditText(
  valor: string | null | undefined,
  options: Pick<NumericOptions, "scale">,
): string {
  conferirScale(options.scale);
  if (valor === null || valor === undefined) return "";
  const texto = semExpoente(String(valor).trim());
  const partes = /^(-?)(\d+)(?:\.(\d*))?$/.exec(texto);
  if (!partes) return texto;
  const [, sinal = "", inteiro = "", fracaoBruta = ""] = partes;
  const fracao = /[1-9]/.test(fracaoBruta.slice(options.scale))
    ? fracaoBruta
    : fracaoBruta.slice(0, options.scale);
  return `${sinal}${inteiro}${fracao ? `,${fracao}` : ""}`;
}

export interface DisplayOptions {
  /** Teto de casas. Acima dele a apresentação arredonda (`ROUND_HALF_UP`). */
  readonly scale: number;
  /** Casas que aparecem mesmo zeradas. */
  readonly minFractionDigits?: number;
}

function corpoPtBr(valor: string | null | undefined, scale: number, minimo: number): string | null {
  conferirScale(scale);
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (texto === "") return null;
  return formatarDecimalTexto(texto, { minimo: Math.min(minimo, scale), maximo: scale });
}

/** Inteiro para leitura: `"1234"` → `"1.234"`. Vazio ou ilegível → `"—"`. */
export function formatIntegerPtBr(valor: string | null | undefined): string {
  return corpoPtBr(valor, 0, 0) ?? "—";
}

/** Decimal para leitura: `"1234.5"` → `"1.234,5"` (ou `"1.234,50"` com mínimo 2). */
export function formatDecimalPtBr(valor: string | null | undefined, options: DisplayOptions): string {
  return corpoPtBr(valor, options.scale, options.minFractionDigits ?? 0) ?? "—";
}

/**
 * Dinheiro para leitura: `"1234.56"` → `"R$ 1.234,56"`; preço unitário com
 * `scale: 4` → `"R$ 12,3456"`. Mínimo de 2 casas por padrão. Com `scale: 2` é
 * o `formatBRL`; com `scale: 4`, o `formatUnitPriceBRL`.
 */
export function formatMoneyPtBr(valor: string | null | undefined, options: DisplayOptions): string {
  const corpo = corpoPtBr(valor, options.scale, options.minFractionDigits ?? 2);
  return corpo === null ? "—" : comSimboloReal(corpo);
}

/**
 * Percentual para leitura: `"12.5"` → `"12,5%"`, ou `"12,50%"` com mínimo 2.
 *
 * O valor já vem em pontos percentuais e é exibido como veio: nada é
 * multiplicado nem dividido. Contrato em fração (`0.125`) converte na borda de
 * quem o tem, antes de chegar aqui.
 */
export function formatPercentPtBr(valor: string | null | undefined, options: DisplayOptions): string {
  const corpo = corpoPtBr(valor, options.scale, options.minFractionDigits ?? 0);
  return corpo === null ? "—" : `${corpo}%`;
}

/** O que dizer quando o texto não é número — com a regra, sem jargão. */
export function numericInvalidMessage(
  rotulo: string,
  motivo: NumericInvalidReason,
  options: Pick<NumericOptions, "scale">,
): string {
  const inteiro = options.scale === 0;
  switch (motivo) {
    case "negativo":
      return `${rotulo}: o valor não pode ser negativo.`;
    case "casas":
      return inteiro
        ? `${rotulo}: informe um número inteiro, sem casas decimais.`
        : `${rotulo}: use no máximo ${options.scale} ${options.scale === 1 ? "casa decimal" : "casas decimais"}.`;
    case "ambiguo":
      return `${rotulo}: ponto seguido de três dígitos pode ser milhar ou decimal. Para milhar, digite sem o ponto (1234); para decimal, use vírgula (1,234).`;
    case "agrupamento":
      return inteiro
        ? `${rotulo}: separador de milhar fora do lugar. Escreva 1234 ou 1.234.`
        : `${rotulo}: separador de milhar fora do lugar. Escreva 1234,56 ou 1.234,56.`;
    case "separador":
      return inteiro
        ? `${rotulo}: informe um número inteiro, sem casas decimais.`
        : `${rotulo}: use uma vírgula só, para as casas decimais (1234,56).`;
    case "caractere":
      return inteiro
        ? `${rotulo}: use só números.`
        : `${rotulo}: use só números, com vírgula para as casas decimais.`;
  }
}
