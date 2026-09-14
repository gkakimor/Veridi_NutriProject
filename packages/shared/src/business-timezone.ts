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

/**
 * Uma forma de ler um instante no `Intl`: o idioma e as opções de sempre, menos o
 * fuso — e os formatadores já criados dela, um por fuso.
 */
interface FormaDeLeitura {
  idioma: string;
  opcoes: Intl.DateTimeFormatOptions;
  porFuso: Map<string, Intl.DateTimeFormat>;
}

/** O dia: `diaCivil`. */
const DIA: FormaDeLeitura = {
  idioma: "pt-BR",
  opcoes: { year: "numeric", month: "2-digit", day: "2-digit" },
  porFuso: new Map(),
};

/** Data e hora até o segundo: o deslocamento do fuso, que limita dia e hora comerciais. */
const RELOGIO: FormaDeLeitura = {
  idioma: "en-US",
  opcoes: {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
  porFuso: new Map(),
};

/** Hora e minuto: `minutoDoDiaComercial`. */
const HORA_E_MINUTO: FormaDeLeitura = {
  idioma: "en-US",
  opcoes: { hour12: false, hour: "2-digit", minute: "2-digit" },
  porFuso: new Map(),
};

/**
 * Data e hora por extenso, `08/09/2026, 22:30:00`: `instanteComercialPorExtenso`.
 *
 * São as opções que `toLocaleString` preenche quando não recebe nenhuma além do fuso —
 * ano, mês, dia, hora, minuto e segundo `numeric` —, e o pt-BR decide o resto: zeros à
 * esquerda, vírgula, 24 horas. `Intl.DateTimeFormat` sem elas formataria só o dia.
 */
const DATA_E_HORA_POR_EXTENSO: FormaDeLeitura = {
  idioma: "pt-BR",
  opcoes: {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  },
  porFuso: new Map(),
};

/** O dia por extenso, `08/09/2026`: as opções que `toLocaleDateString` preenche sozinho. */
const DIA_POR_EXTENSO: FormaDeLeitura = {
  idioma: "pt-BR",
  opcoes: { year: "numeric", month: "numeric", day: "numeric" },
  porFuso: new Map(),
};

/**
 * Quantos fusos cada forma guarda. O produto usa dois (`FUSO_COMERCIAL`, `"UTC"`),
 * mas o `Intl` aceita o mesmo fuso escrito de muitos jeitos (`america/sao_paulo`):
 * sem limite, um nome qualquer faria o mapa crescer. Passou do limite, o formatador
 * sai novo a cada chamada — mais lento, com o mesmo resultado.
 */
const LIMITE_DE_FUSOS_POR_FORMA = 16;

/**
 * O formatador de `forma` em `fuso`, criado na primeira pergunta e reaproveitado
 * (PERFORMANCE-CLEANUP-WAVE-01 no dia; TZ-FORMATTER-REUSE-01 no relógio e na hora).
 *
 * Criar um `Intl.DateTimeFormat` custava ~55 µs a CADA leitura — o Painel lê um dia
 * por movimento da janela e um por consumo no custo das OPs, e cada limite de dia
 * comercial criava quatro. Formatar num que já existe custa poucos µs. Fica guardado
 * só o formatador, que não muda nem lembra a data anterior — nunca a data, o "agora"
 * ou o resultado. O fuso continua indo nele pelo nome IANA: quem decide o
 * deslocamento de cada data, horário de verão incluído, segue sendo a base de fusos
 * do `Intl`. Nome inválido lança na criação e não entra no mapa.
 */
function formatador(forma: FormaDeLeitura, fuso: string): Intl.DateTimeFormat {
  let guardado = forma.porFuso.get(fuso);
  if (!guardado) {
    guardado = new Intl.DateTimeFormat(forma.idioma, { ...forma.opcoes, timeZone: fuso });
    if (forma.porFuso.size < LIMITE_DE_FUSOS_POR_FORMA) forma.porFuso.set(fuso, guardado);
  }
  return guardado;
}

/** `YYYY-MM-DD` de um instante, lido em `fuso`. */
export function diaCivil(instante: Date, fuso: string): string {
  const partes = formatador(DIA, fuso).formatToParts(instante);
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
  const partes = formatador(RELOGIO, fuso).formatToParts(instante);
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
 * O instante de uma HORA CIVIL da fábrica: dia + minuto do dia.
 *
 * `08:00` não é instante — vira um quando se diz em que dia ele acontece e em
 * que fuso a fábrica vive. As duas passadas são as mesmas de
 * `meiaNoiteComercial`: chutar, medir o deslocamento ali, medir de novo no
 * instante corrigido. É isso que mantém a conta certa se o horário de verão
 * voltar — somar minutos à meia-noite erraria uma hora no dia da virada.
 *
 * PLANNING-CAPACITY-BOARD-01: é por aqui que a agenda de uma OP vira
 * `timestamptz`, e por aqui que ela volta a ser hora de relógio na tela.
 */
export function instanteComercial(diaISO: string, minutoDoDia: number): Date {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const palpite = Date.UTC(ano, mes - 1, dia, 0, minutoDoDia, 0, 0);
  const primeiro = deslocamentoDoFuso(new Date(palpite), FUSO_COMERCIAL);
  const segundo = deslocamentoDoFuso(new Date(palpite - primeiro), FUSO_COMERCIAL);
  return new Date(palpite - segundo);
}

/** O minuto do dia que um instante marca no relógio da fábrica. */
export function minutoDoDiaComercial(instante: Date): number {
  const partes = formatador(HORA_E_MINUTO, FUSO_COMERCIAL).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return (valor("hour") % 24) * 60 + valor("minute");
}
/**
 * O instante em que um dia comercial começa — a fronteira `>=` de um filtro.
 */
export function inicioDoDiaComercial(diaISO: string): Date {
  return meiaNoiteComercial(diaISO);
}

/**
 * O instante em que o dia comercial SEGUINTE começa — a fronteira `<` de um
 * filtro por período.
 *
 * Fim EXCLUSIVO é a forma canônica de fechar um intervalo, e o inclusivo se
 * deriva dele (`-1ms`), nunca o contrário. `23:59:59.999` é um fim inventado:
 * ele depende da precisão da coluna, e num `TIMESTAMP` de microssegundos um
 * evento das 23:59:59.9995 fica fora do próprio dia em que aconteceu. O dia
 * seguinte, esse, não tem precisão nem arredondamento — é o mesmo instante em
 * qualquer coluna.
 */
export function fimExclusivoDoDiaComercial(diaISO: string): Date {
  return meiaNoiteComercial(diaCivilDeslocado(diaISO, 1));
}

/**
 * Os instantes que limitam um dia comercial — início e fim, fim inclusivo.
 *
 * É o que "hoje" significa numa consulta: de 00:00:00.000 a 23:59:59.999 em
 * São Paulo, expressos nos instantes que o banco entende. Sem isto, "hoje"
 * resolvido no servidor é o dia do RELÓGIO DA MÁQUINA — em Railway, UTC —, e o
 * KPI do dia passa a incluir a noite anterior.
 *
 * Preferir `intervaloDeDiasComerciais` em consulta nova: o fim exclusivo não
 * depende da precisão da coluna. Esta forma continua para quem já a lê.
 */
export function limitesDoDiaComercial(diaISO: string): { inicio: Date; fim: Date } {
  return {
    inicio: inicioDoDiaComercial(diaISO),
    fim: new Date(fimExclusivoDoDiaComercial(diaISO).getTime() - 1),
  };
}

/** `YYYY-MM-DD` bem formado E existente no calendário — `2026-02-30` não é. */
export function ehDiaCivil(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split("-").map(Number) as [number, number, number];
  const reconstruido = new Date(Date.UTC(ano, mes - 1, dia));
  return reconstruido.toISOString().slice(0, 10) === valor;
}

/**
 * O intervalo de um período de dias comerciais — `[inicio, fimExclusivo)`.
 *
 * É a ÚNICA conversão de filtro por período do sistema: o usuário escolhe
 * dois dias de calendário (`<input type="date">` manda `YYYY-MM-DD`) e a
 * consulta recebe dois instantes. Cada ponta é independente — filtrar só
 * "a partir de" ou só "até" é pergunta legítima.
 *
 * "De 10/09 até 10/09" cobre o dia comercial INTEIRO de 10/09, porque o fim
 * é a meia-noite de 11/09 e ele é exclusivo. Interpretar `2026-09-10` como um
 * instante (`new Date`, `z.coerce.date`) devolve a meia-noite UTC — que em São
 * Paulo é 21h do dia 09 — e com `lte` o filtro terminava o dia antes de ele
 * começar. Foi essa a causa do bug do período do Faturamento.
 */
export function intervaloDeDiasComerciais(
  deDiaISO: string | null | undefined,
  ateDiaISO: string | null | undefined,
): { inicio?: Date; fimExclusivo?: Date } {
  const intervalo: { inicio?: Date; fimExclusivo?: Date } = {};
  if (deDiaISO) intervalo.inicio = inicioDoDiaComercial(deDiaISO);
  if (ateDiaISO) intervalo.fimExclusivo = fimExclusivoDoDiaComercial(ateDiaISO);
  return intervalo;
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

/** `YYYY-MM-01` — o primeiro dia do mês comercial corrente. */
export function primeiroDiaDoMesComercial(agora: Date = new Date()): string {
  return `${hojeComercial(agora).slice(0, 7)}-01`;
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
 * Um instante por extenso, num formatador guardado (TZ-LOCALE-STRING-REUSE-01).
 *
 * `toLocaleString`/`toLocaleDateString` com `{ timeZone }` criavam um formatador a
 * cada chamada, ~54 µs — o V8 só guarda o dele quando não há opções —, e o CSV chama
 * por célula. O texto é o mesmo: as opções da forma são as que o `toLocale*` preenche.
 * Data inválida continua saindo `"Invalid Date"`, que o `format` recusaria com
 * `RangeError`.
 */
function porExtenso(forma: FormaDeLeitura, instante: Date, fuso: string): string {
  if (Number.isNaN(instante.getTime())) return "Invalid Date";
  return formatador(forma, fuso).format(instante);
}

/**
 * Instante para leitura humana: `08/09/2026, 22:30:00`.
 *
 * Carimbo de tempo É instante, e quem o lê está na Veridi. No navegador do
 * operador brasileiro o fuso local dava no mesmo por acaso; no SERVIDOR não —
 * CSV, alertas e textos gerados na API saíam no fuso da máquina.
 */
export function instanteComercialPorExtenso(instante: Date): string {
  return porExtenso(DATA_E_HORA_POR_EXTENSO, instante, FUSO_COMERCIAL);
}

/**
 * O dia de um instante, por extenso.
 *
 * Data civil NÃO passa por aqui: ela é lida em UTC, porque o valor guardado é
 * o marcador do dia escolhido, não um momento.
 */
export function diaDoInstantePorExtenso(instante: Date): string {
  return porExtenso(DIA_POR_EXTENSO, instante, FUSO_COMERCIAL);
}

/**
 * DATA CIVIL por extenso, `15/09/2026` — validade, vigência, data de documento.
 *
 * O valor é a meia-noite UTC do dia escolhido, e o dia são os componentes UTC dele:
 * o texto é o de `toLocaleDateString("pt-BR", { timeZone: "UTC" })`, que CSV, textos
 * da API e telas escreviam cada um à sua maneira.
 */
export function dataCivilPorExtenso(dia: Date): string {
  return porExtenso(DIA_POR_EXTENSO, dia, "UTC");
}
