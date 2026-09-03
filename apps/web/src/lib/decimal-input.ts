/**
 * Entrada decimal em português.
 *
 * Num ERP inteiro em português, a pessoa digita `0,85`. A API fala o contrato
 * com ponto, e antes disto cada tela resolvia por conta própria: dez arquivos
 * com `replace(",", ".")` solto e todo o resto sem nada. Quem caísse numa tela
 * sem tradução via "Erro de validação" e nenhuma pista de que o problema era a
 * vírgula — o valor parecia certo na tela e a operação simplesmente falhava.
 *
 * Aqui a tradução acontece num lugar só, e a regra é conservadora de
 * propósito.
 *
 * SEPARADOR DE MILHAR NÃO É ACEITO, e isso é decisão, não esquecimento.
 * `1.234` é ambíguo: mil duzentos e trinta e quatro para quem escreve em
 * português, um vírgula duzentos e trinta e quatro para quem escreve o
 * contrato. Adivinhar erra por um fator de mil em silêncio, e é um erro de
 * preço ou de peso. Um separador só, seja ele qual for, é sempre a casa
 * decimal — a leitura que nunca infla o número. Dois separadores devolvem
 * inválido, e a tela pede para reescrever.
 */

/** Como a pessoa deve ver o formato aceito, em qualquer mensagem de erro. */
export const AJUDA_DECIMAL = "Use vírgula ou ponto para a casa decimal, sem separador de milhar.";

/**
 * Converte o que foi digitado no formato que a API espera.
 *
 * Devolve `null` quando não dá para converter com segurança — nunca um palpite.
 * Texto vazio também devolve `null`: campo em branco é ausência, e quem decide
 * se ausência é erro é o formulário, não este módulo.
 */
export function parseDecimalInput(texto: string): string | null {
  const limpo = texto.trim();
  if (limpo === "") return null;

  const virgulas = (limpo.match(/,/g) ?? []).length;
  const pontos = (limpo.match(/\./g) ?? []).length;
  // Dois separadores é sempre milhar, e milhar não se adivinha.
  if (virgulas + pontos > 1) return null;

  const normalizado = limpo.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  return normalizado;
}

/** `true` quando `parseDecimalInput` conseguiria converter. */
export function isValidDecimalInput(texto: string): boolean {
  return parseDecimalInput(texto) !== null;
}

/**
 * Converte para exibição em português — o caminho de volta.
 *
 * Só troca o separador: arredondar ou completar casas aqui esconderia
 * precisão que o servidor guardou.
 */
export function formatDecimalInput(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return String(valor).replace(".", ",");
}

/**
 * Mensagem de erro para um campo decimal.
 *
 * Diz o que fazer, não só que falhou: "Erro de validação" foi exatamente o que
 * fez a pessoa digitar de novo o mesmo valor esperando outro resultado.
 */
export function mensagemDecimalInvalido(rotulo?: string): string {
  const alvo = rotulo ? `${rotulo}: informe` : "Informe";
  return `${alvo} um valor numérico válido. ${AJUDA_DECIMAL}`;
}
