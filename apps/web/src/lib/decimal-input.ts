/**
 * Decimal canônico de volta para o texto em português.
 *
 * Só troca o separador: arredondar ou completar casas aqui esconderia precisão
 * que o servidor guardou. É a normalização que `DecimalField` e
 * `normalizePastedNumber` aplicam sobre a leitura de `parsePtBrNumber`.
 *
 * A LEITURA do que foi digitado não mora mais aqui. `parseDecimalInput` lia um
 * separador só como decimal e recusava milhar; os campos numéricos passaram a
 * ler com o parser canônico de `numeric-ptbr.ts` — que aceita `1.234,56` e
 * acusa o `1.234` ambíguo — e ele foi aposentado com o PTBR-NUMERIC-INPUT-
 * ROLLOUT-01. Carregar valor da API num campo é `toPtBrEditText`, com o `scale`
 * do campo.
 */
export function formatDecimalInput(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return String(valor).replace(".", ",");
}
