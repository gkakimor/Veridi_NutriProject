import { Decimal } from "@veridi/shared";
import { parseDecimalInput } from "./decimal-input";

/**
 * Normalização de campo para responder "há alteração pendente?".
 *
 * A guarda de alterações não salvas compara o documento na tela com o
 * documento de referência. Comparar o texto cru gera pergunta onde não há
 * perda — o servidor devolve `1000.000000` e a pessoa redigita `1000`, devolve
 * `null` e o campo vazio é `""`, devolve `0,85` e o contrato fala `0.85`. Uma
 * guarda que pergunta por isso é ruído, e ruído ensina a ignorar a pergunta
 * que importa.
 *
 * Normalizar não é afrouxar: `1000` e `1000,5` continuam diferentes, e texto
 * ilegível continua diferente de tudo — inclusive de si mesmo escrito de outro
 * jeito, porque o que a tela não sabe ler ela não sabe comparar.
 */

/** Texto de campo livre. Ausência e vazio são a mesma coisa: não informado. */
export function textoComparavel(valor: string | null | undefined): string | null {
  const limpo = (valor ?? "").trim();
  return limpo === "" ? null : limpo;
}

/**
 * Decimal digitado ou vindo do servidor, na MESMA forma canônica.
 *
 * Vazio é `null`. Ilegível vira uma marca que só é igual a si mesma: o que
 * está na tela não é o que está gravado, e isso é alteração pendente por
 * definição — a mesma leitura que prende salvar.
 */
export function decimalComparavel(valor: string | null | undefined): string | null {
  const limpo = (valor ?? "").trim();
  if (limpo === "") return null;
  const lido = parseDecimalInput(limpo);
  if (lido === null) return `ilegível:${limpo}`;
  return new Decimal(lido).toString();
}

/** Inteiro de contagem — partes, parcelas. Mesma regra do decimal. */
export function inteiroComparavel(valor: string | number | null | undefined): string | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : null;
  return decimalComparavel(valor);
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
