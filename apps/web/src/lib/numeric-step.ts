import { formatDecimalInput } from "./decimal-input";
import { parsePtBrNumber } from "./numeric-ptbr";
import type { NumericOptions } from "./numeric-ptbr";

/**
 * Um passo na ÚLTIMA CASA que a pessoa escreveu.
 *
 * O passo do campo não é fixo: ele é a casa decimal em que o número está.
 * `1` sobe para `2`; `1,1` sobe para `1,2`; `0,0026` sobe para `0,0027`. É o
 * comportamento que se espera de uma seta ao lado de um número — incrementar o
 * dígito que está à mostra, não uma unidade inteira sobre um valor com quatro
 * casas.
 *
 * A conta é feita em inteiros (`BigInt`), sobre o texto: `0,1 + 0,2` em ponto
 * flutuante é `0,30000000000000004`, e um campo que mostra isso depois de dois
 * cliques perdeu a confiança de quem digita. O número é levado para a escala da
 * casa, somado 1, e devolvido para a escala de origem.
 */

export interface OpcoesDoPasso extends NumericOptions {
  /** Menor valor aceito, em forma canônica (`"0"`). Sem limite quando ausente. */
  min?: string;
  /** Maior valor aceito, em forma canônica (`"100"`). Sem limite quando ausente. */
  max?: string;
}

/** Quantas casas decimais o texto TEM — o que a pessoa vê, não o que cabe. */
function casasDoTexto(texto: string): number {
  const separador = Math.max(texto.lastIndexOf(","), texto.lastIndexOf("."));
  if (separador === -1) return 0;
  const depois = texto.slice(separador + 1);
  return /^\d*$/.test(depois) ? depois.length : 0;
}

/** O decimal canônico (`"-1.25"`) como inteiro na escala pedida. */
function emUnidades(canonico: string, casas: number): bigint {
  const negativo = canonico.startsWith("-");
  const semSinal = negativo ? canonico.slice(1) : canonico;
  const [inteiro, fracao = ""] = semSinal.split(".");
  const ajustada = fracao.padEnd(casas, "0").slice(0, casas);
  const bruto = BigInt((inteiro === "" ? "0" : inteiro) + ajustada);
  return negativo ? -bruto : bruto;
}

/** O inteiro da escala de volta a texto em português. */
function paraTextoPtBr(unidades: bigint, casas: number): string {
  const negativo = unidades < 0n;
  const digitos = (negativo ? -unidades : unidades).toString().padStart(casas + 1, "0");
  const inteiro = digitos.slice(0, digitos.length - casas);
  const fracao = casas === 0 ? "" : `,${digitos.slice(digitos.length - casas)}`;
  return `${negativo ? "-" : ""}${inteiro}${fracao}`;
}

/**
 * O texto do campo depois de um passo para cima (`1`) ou para baixo (`-1`).
 *
 * Devolve `null` quando não há passo a dar: texto ilegível, ou o valor já está
 * no limite daquela direção. `null` é "não faça nada" — nunca um valor
 * inventado para o clique ter efeito.
 *
 * Campo VAZIO é ponto de partida, não zero gravado: o primeiro passo para cima
 * escreve `1` (ou o mínimo, quando ele é maior), e o primeiro para baixo
 * escreve o mínimo quando existe. Sem mínimo declarado e sem negativo
 * permitido, descer a partir do vazio não faz nada.
 */
export function passoNaUltimaCasa(
  texto: string,
  direcao: 1 | -1,
  opcoes: OpcoesDoPasso,
): string | null {
  const leitura = parsePtBrNumber(texto, opcoes);
  if (leitura.tipo === "invalido") return null;

  const vazio = leitura.tipo === "vazio";
  const canonico = vazio ? "0" : leitura.valor;
  // A casa do passo vem do que está escrito, limitada ao que o domínio aceita.
  const casas = Math.min(casasDoTexto(texto), opcoes.scale);

  const atual = emUnidades(canonico, casas);
  const passo = BigInt(direcao);
  let proximo = vazio && direcao === 1 ? emUnidades("1", casas) : atual + passo;

  const minimo = opcoes.min === undefined ? null : emUnidades(opcoes.min, casas);
  const maximo = opcoes.max === undefined ? null : emUnidades(opcoes.max, casas);
  if (minimo !== null && proximo < minimo) proximo = minimo;
  if (maximo !== null && proximo > maximo) proximo = maximo;
  if (!opcoes.allowNegative && proximo < 0n) proximo = 0n;

  // Nada mudou: o valor já estava no limite, e um clique sem efeito não deve
  // reescrever o texto (nem marcar o rascunho como alterado).
  if (!vazio && proximo === atual) return null;
  if (vazio && proximo === 0n && direcao === -1) return null;

  const resultado = paraTextoPtBr(proximo, casas);
  // Passa pela mesma normalização da saída do campo, para o texto guardado ser
  // sempre o mesmo, venha ele do teclado ou da seta.
  const conferido = parsePtBrNumber(resultado, opcoes);
  return conferido.tipo === "valido" ? formatDecimalInput(conferido.valor) : resultado;
}
