/**
 * O fuso operacional da Veridi, e os poucos conceitos temporais que dependem
 * dele. **Uma definição no monorepo inteiro** — API e web importam daqui.
 *
 * A regra do produto: salvo quando uma regra de domínio disser explicitamente
 * o contrário, toda interpretação humana e de negócio de data/hora usa este
 * fuso — "hoje", início e fim do dia, filtros por período, KPIs, documentos e
 * o que a tela mostra.
 *
 * O que NÃO muda por causa disso: carimbo de tempo continua persistido em UTC,
 * e cálculo cuja semântica é explicitamente UTC continua em UTC. O fuso é da
 * LEITURA, não do armazenamento.
 *
 * São três conceitos, e só três:
 *
 * 1. **data civil** — `YYYY-MM-DD`, um dia de calendário. Validade, data de
 *    documento, vigência. Não é instante e não ganha hora.
 * 2. **instante** — um carimbo de tempo. Persistido em UTC, lido no fuso.
 * 3. **dia comercial** — o dia civil da Veridi, e os instantes que o limitam.
 *
 * O identificador é IANA de propósito. Offset fixo — `-03:00`, `UTC-3`, somar
 * três horas — é proibido: o Brasil já teve horário de verão e pode ter de
 * novo, e um número escrito à mão erra cinco meses por ano em silêncio. Quem
 * decide o deslocamento de cada data é a base de fusos do `Intl`.
 */
export const FUSO_COMERCIAL = "America/Sao_Paulo";

/** `YYYY-MM-DD` de um instante, lido em `fuso`. */
export function diaCivil(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/** Que dia é hoje para quem opera a Veridi. */
export function hojeComercial(agora: Date = new Date()): string {
  return diaCivil(agora, FUSO_COMERCIAL);
}

/**
 * O deslocamento do fuso comercial num instante, em milissegundos.
 *
 * Sai da base de fusos do `Intl`, nunca de um número escrito à mão: em 2018
 * este mesmo cálculo devolve −2h em novembro e −3h em setembro, porque o
 * Brasil tinha horário de verão.
 */
function deslocamentoDoFuso(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  const comoSeFosseUTC = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour") % 24,
    valor("minute"),
    valor("second"),
  );
  return comoSeFosseUTC - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * O instante em que um dia comercial começa.
 *
 * Duas passadas: a primeira chuta a meia-noite como se o fuso fosse UTC e mede
 * o deslocamento ali; a segunda mede no instante já corrigido. É o que mantém
 * a conta certa nos dias em que o próprio deslocamento muda.
 */
function meiaNoiteComercial(diaISO: string): Date {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const palpite = Date.UTC(ano, mes - 1, dia, 0, 0, 0, 0);
  const primeiro = deslocamentoDoFuso(new Date(palpite), FUSO_COMERCIAL);
  const segundo = deslocamentoDoFuso(new Date(palpite - primeiro), FUSO_COMERCIAL);
  return new Date(palpite - segundo);
}

/**
 * Os instantes que limitam um dia comercial — início e fim, fim inclusivo.
 *
 * É o que "hoje" significa numa consulta: de 00:00:00.000 a 23:59:59.999 em
 * São Paulo, expressos nos instantes que o banco entende. Sem isto, "hoje"
 * resolvido no servidor é o dia do RELÓGIO DA MÁQUINA — em Railway, UTC —, e o
 * KPI do dia passa a incluir a noite anterior.
 */
export function limitesDoDiaComercial(diaISO: string): { inicio: Date; fim: Date } {
  const inicio = meiaNoiteComercial(diaISO);
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const seguinte = new Date(Date.UTC(ano, mes - 1, dia + 1));
  const diaSeguinte = seguinte.toISOString().slice(0, 10);
  return { inicio, fim: new Date(meiaNoiteComercial(diaSeguinte).getTime() - 1) };
}

/** Os limites do dia comercial que contém `agora`. */
export function limitesDeHojeComercial(agora: Date = new Date()): { inicio: Date; fim: Date } {
  return limitesDoDiaComercial(hojeComercial(agora));
}

/**
 * Um dia civil deslocado em dias INTEIROS — `-30` é trinta dias antes.
 *
 * A conta é feita sobre o DIA, em UTC, e nunca sobre o relógio: subtrair
 * `30 x 24h` de um instante atravessa a meia-noite comercial na hora errada
 * e, numa mudança de horário de verão, pula ou repete um dia. Em UTC todo dia
 * tem exatamente 24 horas, então o calendário é aritmética exata — o fuso só
 * volta a entrar quando este dia vira instante, em `limitesDoDiaComercial`.
 */
export function diaCivilDeslocado(diaISO: string, dias: number): string {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** Janela de `dias` dias comerciais terminando hoje — `1` é só hoje. */
export function limitesDeDiasComerciais(
  dias: number,
  agora: Date = new Date(),
): { inicio: Date; fim: Date } {
  const hoje = hojeComercial(agora);
  const primeiro = diaCivilDeslocado(hoje, -(dias - 1));
  return { inicio: limitesDoDiaComercial(primeiro).inicio, fim: limitesDoDiaComercial(hoje).fim };
}

/**
 * O ano comercial de um instante.
 *
 * Numeração oficial de documento usa o ano em que o ato aconteceu PARA A
 * VERIDI. Uma Ordem de Produção liberada em 31/12 às 22h leva o ano velho,
 * embora em UTC já seja janeiro.
 */
export function anoComercial(instante: Date): number {
  return Number(hojeComercial(instante).slice(0, 4));
}

/** `YYYYMMDD` do dia comercial de um instante — para código de documento. */
export function diaComercialCompacto(instante: Date): string {
  return hojeComercial(instante).replace(/-/g, "");
}

/**
 * Instante para leitura humana: `08/09/2026 22:30`.
 *
 * Carimbo de tempo É instante, e quem o lê está na Veridi. No navegador do
 * operador brasileiro o fuso local dava no mesmo por acaso; no SERVIDOR não —
 * CSV, alertas e textos gerados na API saíam no fuso da máquina.
 */
export function instanteComercialPorExtenso(instante: Date): string {
  return instante.toLocaleString("pt-BR", { timeZone: FUSO_COMERCIAL });
}

/**
 * O dia de um instante, por extenso.
 *
 * Data civil NÃO passa por aqui: ela é lida em UTC, porque o valor guardado é
 * o marcador do dia escolhido, não um momento.
 */
export function diaDoInstantePorExtenso(instante: Date): string {
  return instante.toLocaleDateString("pt-BR", { timeZone: FUSO_COMERCIAL });
}
