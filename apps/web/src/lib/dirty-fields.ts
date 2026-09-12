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
