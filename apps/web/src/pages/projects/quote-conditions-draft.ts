import type {
  CustomerPaymentDefaultsDTO,
  LIMITES_INTEIROS_DAS_CONDICOES,
  PaymentInstrument,
  QuotePaymentMethod,
  QuoteVersionDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";
import { Decimal } from "@veridi/shared";
import { decimalComparavel } from "../../lib/dirty-fields";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { parsePtBrNumber, toPtBrEditText } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL } from "../../lib/numeric-scales";

/**
 * O rascunho das condições comerciais da proposta — QUOTE-DRAFT-STATE-01.
 *
 * Dois estados convivem no formulário, e a diferença entre eles é a
 * "alteração pendente":
 *
 * - `base` — o que o servidor tem GRAVADO para esta versão, na última leitura;
 * - `campos` — o que está nos campos agora.
 *
 * Toda leitura da proposta chega como objeto novo, inclusive a recarga que vem
 * depois de adicionar, editar ou remover uma linha, com as condições gravadas
 * intactas. Objeto novo bastava para o formulário se refazer a partir do
 * servidor, e o que estava digitado sumia sem aviso. Aqui quem decide é a
 * IDENTIDADE da versão (`quote.id`) e o VALOR de cada campo:
 *
 * - outra versão é outro documento: o formulário passa a ser dela;
 * - versão que deixou de ser editável mostra o que está gravado;
 * - a mesma versão preserva cada campo alterado aqui e acompanha o servidor
 *   nos campos que ninguém tocou.
 *
 * Nada aqui grava: salvar continua sendo o botão "Salvar condições".
 */

export interface CamposDasCondicoes {
  validUntil: string;
  leadTimeDays: string;
  commercialNotes: string;
  discountPercent: string;
  /** Forma de pagamento; `""` é "Não informada". */
  paymentInstrument: PaymentInstrument | "";
  /** Condição de pagamento — à vista ou parcelado. */
  paymentMethod: QuotePaymentMethod;
  downPaymentPercent: string;
  installmentCount: string;
  installmentIntervalDays: string;
  monthlyInterestPercent: string;
}

export type ChaveDaCondicao = keyof CamposDasCondicoes;

/** Os inteiros das condições — as chaves dos limites que a API aplica. */
export type ChaveInteiraDaCondicao = keyof typeof LIMITES_INTEIROS_DAS_CONDICOES;

/** Como cada condição é escrita e lida. */
export type TipoDaCondicao = "data" | "inteiro" | "texto" | "percentual" | "opcao";

/**
 * A classificação das dez condições, num lugar só. O tipo exige uma entrada
 * por chave — condição nova sem classificação não compila —, e é esta tabela
 * que decide como cada campo se compara (QUOTE-INT-FIELDS-01). A forma de
 * pagamento entrou aqui, e não numa segunda mecânica: pendência, simulação,
 * salvar e o envio preso leem esta mesma tabela (CUSTOMER-PAYMENT-DEFAULTS-01).
 */
export const TIPO_DA_CONDICAO: Record<ChaveDaCondicao, TipoDaCondicao> = {
  validUntil: "data",
  leadTimeDays: "inteiro",
  commercialNotes: "texto",
  discountPercent: "percentual",
  paymentInstrument: "opcao",
  paymentMethod: "opcao",
  downPaymentPercent: "percentual",
  installmentCount: "inteiro",
  installmentIntervalDays: "inteiro",
  monthlyInterestPercent: "percentual",
};

export interface RascunhoDasCondicoes {
  /** A versão a que o rascunho pertence — identidade, nunca o objeto da leitura. */
  versaoId: string;
  /** O que o servidor tem gravado, na última leitura desta versão. */
  base: CamposDasCondicoes;
  /** O que está nos campos agora. */
  campos: CamposDasCondicoes;
}

/**
 * Percentual guardado com 4 casas vira "10" na tela, não "10,0000" — e em
 * português: "7,5", no texto que o `PercentField` edita.
 */
function percentualNoCampo(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === ""
    ? ""
    : toPtBrEditText(new Decimal(value).toString(), OPCOES_PERCENTUAL);
}

function inteiroNoCampo(value: number | null | undefined): string {
  return value ? String(value) : "";
}

export function camposDe(quote: QuoteVersionDTO): CamposDasCondicoes {
  return {
    validUntil: quote.validUntil ? quote.validUntil.slice(0, 10) : "",
    leadTimeDays: inteiroNoCampo(quote.leadTimeDays),
    commercialNotes: quote.commercialNotes ?? "",
    discountPercent: percentualNoCampo(quote.discountPercent),
    paymentInstrument: quote.paymentInstrument ?? "",
    paymentMethod: quote.paymentMethod,
    downPaymentPercent: percentualNoCampo(quote.downPaymentPercent),
    installmentCount: inteiroNoCampo(quote.installmentCount),
    installmentIntervalDays: inteiroNoCampo(quote.installmentIntervalDays),
    monthlyInterestPercent: percentualNoCampo(quote.monthlyInterestPercent),
  };
}

/** O cliente tem algum pagamento padrão — forma, condição ou as duas? */
export function temPadraoDoCliente(
  padrao: CustomerPaymentDefaultsDTO | null | undefined,
): padrao is CustomerPaymentDefaultsDTO {
  return Boolean(padrao && (padrao.defaultPaymentInstrument || padrao.defaultPaymentMethod));
}

/**
 * "Aplicar padrão do cliente": o padrão ATUAL do cliente escrito nos campos —
 * na tela, sem gravar. Vira alteração pendente como qualquer digitação, e só
 * chega ao servidor por "Salvar condições".
 *
 * Só forma e condição. Validade, prazo, desconto e observações ficam como
 * estão, e o que o cliente não tem padrão também: cliente só com forma não
 * mexe na condição, e vice-versa. A condição vem inteira — parcelado com os
 * seus quatro campos, à vista sem nenhum.
 */
export function aplicarPadraoDoCliente(
  campos: CamposDasCondicoes,
  padrao: CustomerPaymentDefaultsDTO | null | undefined,
): CamposDasCondicoes {
  if (!temPadraoDoCliente(padrao)) return campos;
  return {
    ...campos,
    ...(padrao.defaultPaymentInstrument
      ? { paymentInstrument: padrao.defaultPaymentInstrument }
      : {}),
    ...(padrao.defaultPaymentMethod
      ? {
          paymentMethod: padrao.defaultPaymentMethod,
          downPaymentPercent: percentualNoCampo(padrao.defaultDownPaymentPercent),
          installmentCount: inteiroNoCampo(padrao.defaultInstallmentCount),
          installmentIntervalDays: inteiroNoCampo(padrao.defaultInstallmentIntervalDays),
          monthlyInterestPercent: percentualNoCampo(padrao.defaultMonthlyInterestPercent),
        }
      : {}),
  };
}

/**
 * Aplicar o padrão mudaria o que a proposta diz?
 *
 * Compara o que VALE, pelo valor: à vista, entrada, parcelas, intervalo e juros
 * não aparecem nem vão ao servidor, e texto que ficou escondido neles não faz o
 * botão aparecer.
 */
export function padraoDoClienteDifere(
  campos: CamposDasCondicoes,
  padrao: CustomerPaymentDefaultsDTO | null | undefined,
): boolean {
  if (!temPadraoDoCliente(padrao)) return false;
  const emVigor = (c: CamposDasCondicoes): CamposDasCondicoes =>
    c.paymentMethod === "INSTALLMENTS"
      ? c
      : {
          ...c,
          downPaymentPercent: "",
          installmentCount: "",
          installmentIntervalDays: "",
          monthlyInterestPercent: "",
        };
  return (
    condicoesAlteradas(emVigor(campos), emVigor(aplicarPadraoDoCliente(campos, padrao))).length > 0
  );
}

export function paraEnvio(campos: CamposDasCondicoes): UpdateQuoteVersionInput {
  const texto = (value: string) => (value.trim() === "" ? null : value.trim());
  /*
   * Inteiro passa pela leitura estrita (QUOTE-INT-FIELDS-01). Ilegível não tem
   * representação no pedido: `Number("abc")` era `NaN`, o JSON escrevia `null`,
   * e o valor gravado era apagado. Salvar e simular ficam presos enquanto
   * houver inteiro ilegível na tela — chegar aqui assim é defeito, e falha alto.
   *
   * À vista, parcelas e intervalo não aparecem nem valem (o servidor os limpa):
   * o texto que ficou escondido neles não vai e não trava.
   */
  const parcelado = campos.paymentMethod === "INSTALLMENTS";
  const inteiro = (value: string, emVigor = true) => {
    const leitura = lerInteiroOpcional(value);
    if (leitura.tipo === "valido") return leitura.valor;
    if (leitura.tipo === "vazio" || !emVigor) return null;
    throw new Error("Inteiro ilegível não vai ao servidor.");
  };
  /*
   * Percentual passa pelo parser dos campos numéricos, com as casas da coluna.
   * Ilegível em vigor falha alto, como o inteiro: os botões ficam
   * desabilitados enquanto algum percentual for ilegível, e mandar `null` no
   * lugar apagaria o desconto em silêncio. À vista, entrada e juros não
   * aparecem nem valem (o servidor os limpa): o escondido não vai e não trava.
   */
  const percentual = (value: string, emVigor = true) => {
    const leitura = parsePtBrNumber(value, OPCOES_PERCENTUAL);
    if (leitura.tipo === "valido") return leitura.valor;
    if (leitura.tipo === "vazio" || !emVigor) return null;
    throw new Error("Percentual ilegível não vai ao servidor.");
  };
  return {
    validUntil: texto(campos.validUntil),
    leadTimeDays: inteiro(campos.leadTimeDays),
    commercialNotes: texto(campos.commercialNotes),
    discountPercent: percentual(campos.discountPercent),
    paymentInstrument: campos.paymentInstrument === "" ? null : campos.paymentInstrument,
    paymentMethod: campos.paymentMethod,
    downPaymentPercent: percentual(campos.downPaymentPercent, parcelado),
    installmentCount: inteiro(campos.installmentCount, parcelado),
    installmentIntervalDays: inteiro(campos.installmentIntervalDays, parcelado),
    monthlyInterestPercent: percentual(campos.monthlyInterestPercent, parcelado),
  };
}

/**
 * Uma condição na forma em que se compara: o valor que ela mandaria ao
 * servidor.
 *
 * Percentual viaja como texto decimal, e "7,5", "7.50" e "7.5" são o mesmo
 * desconto — comparar o texto diria que há o que salvar logo depois de salvar,
 * porque o servidor devolve `7.5000`. Inteiro passa pela leitura estrita:
 * " 030 " é 30. O ILEGÍVEL — inteiro ou percentual — é um valor próprio, que
 * nunca empata com vazio nem com número: "abc" sobre um campo vazio continua
 * sendo alteração (QUOTE-INT-FIELDS-01).
 */
function valorComparavel(tipo: TipoDaCondicao, texto: string): unknown {
  // Opção vem do select, e se compara como veio.
  if (tipo === "opcao") return texto;
  const limpo = texto.trim();
  if (tipo === "inteiro") {
    const leitura = lerInteiroOpcional(texto);
    if (leitura.tipo === "vazio") return null;
    return leitura.tipo === "valido" ? leitura.valor : `ilegível:${limpo}`;
  }
  if (limpo === "") return null;
  if (tipo === "percentual") return decimalComparavel(limpo);
  return limpo;
}

/**
 * As condições em que `para` difere de `de` — pelo VALOR, não pelo texto.
 *
 * `condicoesAlteradas(base, campos)` é a alteração pendente: a lista do que
 * "Salvar condições" mudaria no servidor.
 */
export function condicoesAlteradas(
  de: CamposDasCondicoes,
  para: CamposDasCondicoes,
): ChaveDaCondicao[] {
  return (Object.keys(TIPO_DA_CONDICAO) as ChaveDaCondicao[]).filter((chave) => {
    const tipo = TIPO_DA_CONDICAO[chave];
    return valorComparavel(tipo, de[chave]) !== valorComparavel(tipo, para[chave]);
  });
}

export function rascunhoDe(quote: QuoteVersionDTO): RascunhoDasCondicoes {
  const gravado = camposDe(quote);
  return { versaoId: quote.id, base: gravado, campos: gravado };
}

function mesmoTexto(a: CamposDasCondicoes, b: CamposDasCondicoes): boolean {
  return (Object.keys(a) as ChaveDaCondicao[]).every((chave) => a[chave] === b[chave]);
}

function manter<K extends ChaveDaCondicao>(
  destino: CamposDasCondicoes,
  origem: CamposDasCondicoes,
  chave: K,
) {
  destino[chave] = origem[chave];
}

/**
 * Absorve uma leitura nova da proposta no rascunho.
 *
 * Devolve o MESMO objeto quando nada muda — uma recarga que só trouxe linhas
 * não re-renderiza o formulário.
 */
export function hidratarRascunho(
  atual: RascunhoDasCondicoes,
  quote: QuoteVersionDTO,
  editavel: boolean,
): RascunhoDasCondicoes {
  const servidor = camposDe(quote);

  // Outra versão é outro documento, e versão que não se edita mais é o que
  // está gravado: rascunho de outro momento ali seria número que ninguém enviou.
  if (atual.versaoId !== quote.id || !editavel) {
    const gravado = { versaoId: quote.id, base: servidor, campos: servidor };
    return atual.versaoId === quote.id &&
      mesmoTexto(atual.base, servidor) &&
      mesmoTexto(atual.campos, servidor)
      ? atual
      : gravado;
  }

  // As condições gravadas não mudaram: o rascunho fica exatamente como está.
  if (mesmoTexto(atual.base, servidor)) return atual;

  /*
   * O servidor mudou. Campo alterado aqui continua o digitado — a não ser que
   * o servidor já tenha exatamente esse valor (é o que acontece depois de
   * salvar), e aí a tela passa a mostrar o gravado. Campo que ninguém tocou
   * acompanha o servidor.
   */
  const tocadas = condicoesAlteradas(atual.base, atual.campos);
  const aindaDiferentes = condicoesAlteradas(servidor, atual.campos);
  const campos = { ...servidor };
  for (const chave of tocadas) {
    if (aindaDiferentes.includes(chave)) manter(campos, atual.campos, chave);
  }
  return { versaoId: quote.id, base: servidor, campos };
}
