import { Decimal } from "@veridi/shared";
import { parsePtBrNumber } from "./numeric-ptbr";
import { CASAS_QUANTIDADE } from "./numeric-scales";

/**
 * Normalização de campo para responder "há alteração pendente?".
 *
 * A guarda de alterações não salvas compara o documento na tela com o
 * documento de referência. Comparar o texto cru gera pergunta onde não há
 * perda — o servidor devolve `1000.000000` e a pessoa redigita `1000`, devolve
 * `null` e o campo vazio é `""`, o campo mostra `250,5` e o servidor guarda
 * `250.5`. Uma guarda que pergunta por isso é ruído, e ruído ensina a ignorar a
 * pergunta que importa.
 *
 * Normalizar não é afrouxar: `1000` e `1000,5` continuam diferentes, e texto
 * ilegível continua diferente de tudo — inclusive de si mesmo escrito de outro
 * jeito, porque o que a tela não sabe ler ela não sabe comparar.
 *
 * Dois lados, duas leituras (PTBR-NUMERIC-INPUT-ROLLOUT-01): o TEXTO DO CAMPO
 * se lê em português, com o parser dos campos numéricos; o VALOR DA API já é
 * canônico e se lê como `Decimal`. Passar valor da API pela leitura do campo
 * erraria o caso que o campo existe para barrar: `1.234` da API é um vírgula
 * duzentos e trinta e quatro, e escrito no campo seria ambíguo.
 */

/** Texto de campo livre. Ausência e vazio são a mesma coisa: não informado. */
export function textoComparavel(valor: string | null | undefined): string | null {
  const limpo = (valor ?? "").trim();
  return limpo === "" ? null : limpo;
}

/**
 * Decimal DIGITADO — o texto de `DecimalField`, `MoneyField` ou `PercentField`
 * (ou o texto que o formulário montou da API com `toPtBrEditText`) — em forma
 * canônica.
 *
 * A leitura é a do campo, com o teto de casas do sistema (as doze da
 * quantidade): o campo nunca guarda mais casas que o próprio `scale`, então o
 * teto não recusa texto que o campo aceitou. `1.234` sozinho é ambíguo no
 * campo decimal e aqui também.
 *
 * Vazio é `null`. Ilegível vira uma marca que só é igual a si mesma: o que
 * está na tela não é o que está gravado, e isso é alteração pendente por
 * definição — a mesma leitura que prende salvar.
 */
export function decimalComparavel(valor: string | null | undefined): string | null {
  const limpo = (valor ?? "").trim();
  if (limpo === "") return null;
  const leitura = parsePtBrNumber(limpo, { scale: CASAS_QUANTIDADE });
  if (leitura.tipo !== "valido") return `ilegível:${limpo}`;
  return new Decimal(leitura.valor).toString();
}

/**
 * Decimal VINDO DA API — já canônico (`"250.5"`, `"1000.000000000000"`) — na
 * mesma forma de `decimalComparavel`. Vazio e ausente são `null`.
 */
export function decimalDaApiComparavel(valor: string | null | undefined): string | null {
  const limpo = (valor ?? "").trim();
  if (limpo === "") return null;
  try {
    return new Decimal(limpo).toString();
  } catch {
    return `ilegível:${limpo}`;
  }
}

/** Inteiro de contagem — partes, parcelas: número da API ou texto do `IntegerField`. */
export function inteiroComparavel(valor: string | number | null | undefined): string | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : null;
  const limpo = (valor ?? "").trim();
  if (limpo === "") return null;
  const leitura = parsePtBrNumber(limpo, { scale: 0 });
  return leitura.tipo === "valido" ? leitura.valor : `ilegível:${limpo}`;
}

/**
 * A assinatura do documento: uma string por estado.
 *
 * Serializar em vez de comparar campo a campo porque a comparação campo a
 * campo esquece o campo acrescentado depois — e esquece em silêncio, que é o
 * modo de falha que a guarda existe para eliminar.
 */
export function assinaturaDoDocumento(projecao: unknown): string {
  return JSON.stringify(projecao);
}

/** Valor de campo de formulário: texto, marca de sim/não, ou ausência. */
export type ValorDeCampo = string | boolean | null | undefined;

/**
 * A assinatura de um formulário plano — os cadastros mestres.
 *
 * Item, Cliente, Fornecedor e Produto guardam o formulário como um objeto de
 * campos simples, e todos comparam do mesmo jeito: texto normalizado, marca de
 * sim/não como está, e os campos que são NÚMERO em forma canônica.
 *
 * A lista de decimais é explícita porque ela também documenta: quem lê a
 * chamada vê quais campos daquele cadastro são número, e quem acrescenta um
 * campo numérico sem pô-lo aqui ganha uma pergunta de descarte por ter
 * redigitado `10` como `10,0`.
 *
 * As chaves são percorridas em ordem alfabética: a assinatura não pode mudar
 * porque alguém reordenou a declaração do `FormState`.
 */
export function assinaturaDoFormulario(
  campos: object,
  decimais: readonly string[] = [],
): string {
  // `object` e não `Record`: os `FormState` dos cadastros são interfaces, e
  // interface não tem índice de string — pedi-lo obrigaria a mexer nos quatro.
  const bruto = campos as Record<string, ValorDeCampo>;
  const comparavel: Record<string, string | boolean | null> = {};
  for (const chave of Object.keys(bruto).sort()) {
    const valor = bruto[chave];
    if (typeof valor === "boolean") {
      comparavel[chave] = valor;
      continue;
    }
    comparavel[chave] = decimais.includes(chave)
      ? decimalComparavel(valor)
      : textoComparavel(valor);
  }
  return assinaturaDoDocumento(comparavel);
}
