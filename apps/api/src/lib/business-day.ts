import { diaCivil, hojeComercial } from "@veridi/shared";

/**
 * Data civil no domínio — o que "até quando vale" significa.
 *
 * Os primitivos do fuso comercial vivem em `@veridi/shared`
 * (`business-timezone.ts`), uma definição para a API e para a web. Aqui
 * ficam só as perguntas que são de NEGÓCIO.
 *
 * `QuoteVersion.validUntil` é uma DATA CIVIL, não um instante. O campo é um
 * `<input type="date">`: a pessoa escolhe 15/09/2026 e nunca escolhe hora. O
 * valor viaja como `2026-09-15`, `z.coerce.date()` o materializa em
 * `2026-09-15T00:00:00.000Z` e a coluna `TIMESTAMP(3)` guarda essa meia-noite
 * UTC como MARCADOR do dia — não como o momento em que algo aconteceu. A tela
 * lê de volta pelos componentes UTC (`web lib/dates.ts`), e por isso 15/09
 * continua 15/09 em qualquer fuso.
 *
 * A pergunta do domínio é: **o dia 15/09 já acabou na operação da Veridi?**
 * Ela se responde comparando DIAS, não instantes. A tentativa anterior
 * transformava a validade num instante artificial — o fim do dia em UTC — e
 * com isso a proposta vencia às 21h de São Paulo do próprio dia impresso nela,
 * três horas antes da hora. O erro não era o fuso do servidor: era comparar um
 * marcador de dia com um relógio.
 *
 * Aqui não existe fim de dia. Existe "que dia é hoje na Veridi" e "que dia está
 * escrito na proposta", os dois em `YYYY-MM-DD`, e o resto é uma comparação de
 * texto — que para datas ISO é a mesma coisa que uma comparação cronológica.
 */

/*
 * O fuso vem de `@veridi/shared`: uma definição para a API e para a web.
 * Nenhum outro arquivo escreve o nome do fuso, e nenhum lugar codifica
 * `-03:00` — quem decide o deslocamento de cada data é a base do `Intl`.
 */

/**
 * O dia escrito numa coluna de data-só.
 *
 * Lido em UTC porque é assim que ele foi gravado: a meia-noite UTC é o
 * marcador do dia escolhido, e seus componentes UTC são exatamente esse dia.
 * Ler no fuso comercial devolveria o dia anterior.
 */
export function diaDaColunaDeData(valor: Date): string {
  return diaCivil(valor, "UTC");
}

/**
 * O dia da validade já passou?
 *
 * Sem validade não há vencimento: `null` nunca vence. Quem exige a validade é
 * a regra de envio, não esta função.
 */
export function venceuEm(validUntil: Date | null | undefined, agora: Date): boolean {
  if (!validUntil) return false;
  return hojeComercial(agora) > diaDaColunaDeData(validUntil);
}

/** `15/09/2026` — o dia como o cliente o leu na proposta. */
export function diaComercialPorExtenso(dia: Date): string {
  return dia.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
