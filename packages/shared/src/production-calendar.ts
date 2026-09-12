/**
 * CALENDÁRIO DE PRODUÇÃO — PLANNING-CALENDAR-01.
 *
 * Responde uma pergunta só: **a fábrica opera neste dia, e por quantos
 * minutos?** Nada aqui agenda Ordem de Produção, ocupa recurso ou desenha
 * quadro — isso é PLANNING-CAPACITY-BOARD-01.
 *
 * **Dois vocabulários temporais, e este módulo vive no primeiro.**
 *
 * 1. **DIA CIVIL** (`YYYY-MM-DD`) e **MINUTO DO DIA** (0…1440). É onde a
 *    jornada mora: `08:00` não tem data, não tem fuso e não muda em outubro.
 *    Toda conta daqui é aritmética de calendário, e por isso o horário de
 *    verão não a alcança.
 * 2. **INSTANTE**, que é carimbo de tempo real. Só aparece quando alguém
 *    precisa saber que DIA CIVIL um instante é — e aí a resposta vem de
 *    `hojeComercial`/`diaCivil` (`business-timezone.ts`), no `FUSO_COMERCIAL`,
 *    nunca de um `-03:00` escrito à mão.
 *
 * Misturar os dois é exatamente o erro que faria a jornada andar uma hora
 * cinco meses por ano: somar 24 h a um instante atravessa a meia-noite
 * comercial na hora errada num dia de 23 ou 25 horas. Aqui não se soma hora
 * nenhuma — soma-se DIA, em `diaCivilDeslocado`, onde todo dia tem o mesmo
 * tamanho.
 *
 * O calendário é **um só e global**: mão de obra e equipamento continuam
 * pools e herdam esta jornada. E é domínio exclusivo de planejamento
 * produtivo — tarifa, oferta de fornecedor, `ItemCostReference`, validade de
 * lote, faturamento e promessa de entrega ao cliente (§75) não passam a
 * depender de dia útil por causa dele.
 */

import { diaCivilDeslocado, ehDiaCivil } from "./business-timezone.js";

/** Minutos de um dia civil. `1440` é 24:00 — fim de janela legítimo. */
export const MINUTOS_DO_DIA = 1440;

/**
 * Os dias da semana, de segunda a domingo.
 *
 * A ordem é a da semana brasileira, e o índice 0 é segunda — não domingo.
 * `Date#getUTCDay` usa a convenção oposta (0 = domingo), e é exatamente aí
 * que nasce o erro de um dia: a conversão acontece num lugar só,
 * `diaDaSemanaComercial`, e nenhuma outra função olha para números.
 */
export const DIAS_DA_SEMANA = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

export const DIA_DA_SEMANA_LABELS: Record<DiaDaSemana, string> = {
  monday: "Segunda-feira",
  tuesday: "Terça-feira",
  wednesday: "Quarta-feira",
  thursday: "Quinta-feira",
  friday: "Sexta-feira",
  saturday: "Sábado",
  sunday: "Domingo",
};

/** Rótulo curto, para cabeçalho de tabela e chip. */
export const DIA_DA_SEMANA_LABELS_CURTOS: Record<DiaDaSemana, string> = {
  monday: "Seg",
  tuesday: "Ter",
  wednesday: "Qua",
  thursday: "Qui",
  friday: "Sex",
  saturday: "Sáb",
  sunday: "Dom",
};

/** Em que dias da semana a fábrica opera. */
export type DiasOperantes = Record<DiaDaSemana, boolean>;

export type ProductionCalendarExceptionType =
  | "FERIADO"
  | "RECESSO"
  | "PARADA_OPERACIONAL"
  | "OUTRO";

export const PRODUCTION_CALENDAR_EXCEPTION_TYPES: readonly ProductionCalendarExceptionType[] = [
  "FERIADO",
  "RECESSO",
  "PARADA_OPERACIONAL",
  "OUTRO",
];

export const PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS: Record<
  ProductionCalendarExceptionType,
  string
> = {
  FERIADO: "Feriado",
  RECESSO: "Recesso",
  PARADA_OPERACIONAL: "Parada operacional",
  OUTRO: "Outro",
};

/** A jornada: janela do dia, intervalo e dias operantes. */
export interface ProductionCalendarConfigInput {
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  /**
   * Intervalo TOTAL do dia, em minutos. Continua sendo a soma que responde
   * "quanto rende um dia" — e, quando o intervalo tem horário, é DERIVADO
   * dele: `breakEndMinuteOfDay - breakStartMinuteOfDay`.
   */
  breakMinutes: number;
  /**
   * ONDE o intervalo cai no dia. `null` nos dois = posição não configurada.
   *
   * Sem isto não existe horário exato de etapa: "60 min de intervalo" diz
   * quanto o dia rende, não em que momento a linha para. Inferir 12:00–13:00
   * seria inventar a jornada de uma fábrica que ninguém consultou — por isso
   * `janelasDoDia` RECUSA em vez de chutar (PLANNING-CAPACITY-BOARD-01).
   */
  breakStartMinuteOfDay: number | null;
  breakEndMinuteOfDay: number | null;
  weekdays: DiasOperantes;
}

export interface ProductionCalendarDTO extends ProductionCalendarConfigInput {
  /**
   * `false` enquanto ninguém salvou: a tela mostra o padrão sugerido e diz
   * que ele ainda não foi confirmado. Ler nunca cria o calendário.
   */
  configured: boolean;
  /**
   * A frase que falta quando há intervalo sem horário, e `null` quando não
   * falta nada. Derivado: o calendário continua válido para tudo o mais, e é
   * só a agenda com horário exato que depende disto.
   */
  breakPositionWarning: string | null;
  /** Derivado — janela menos intervalo. Nunca uma coluna. */
  workingMinutesPerDay: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProductionCalendarExceptionDTO {
  id: string;
  /** DATA CIVIL `YYYY-MM-DD`. Não é instante e não ganha hora. */
  date: string;
  type: ProductionCalendarExceptionType;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ProductionCalendarExceptionListResponse {
  exceptions: ProductionCalendarExceptionDTO[];
}

export interface ProductionCalendarExceptionInput {
  date: string;
  type: ProductionCalendarExceptionType;
  reason?: string | null;
}

/**
 * O padrão de um calendário NOVO — segunda a sexta, 08:00 às 17:00, 1 h de
 * intervalo. Sugestão de partida para quem ainda não configurou; quem já
 * salvou nunca é sobrescrito por ele.
 */
export const CALENDARIO_PADRAO: ProductionCalendarConfigInput = {
  startMinuteOfDay: 8 * 60,
  endMinuteOfDay: 17 * 60,
  breakMinutes: 60,
  // NÃO sugerimos 12:00–13:00: a posição do intervalo é decisão da fábrica, e
  // um palpite gravado vira horário de produção errado sem ninguém perceber.
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
  weekdays: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
};

/** Entrada temporal inválida — recusa de negócio, nunca 500. */
export class ProductionCalendarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionCalendarInputError";
  }
}

/** `480` vira `08:00`; `1440` vira `24:00`. */
export function formatarMinutoDoDia(minuto: number): string {
  const horas = Math.floor(minuto / 60);
  const minutos = minuto % 60;
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

/** `"08:00"` vira `480`. Texto fora do formato ou fora do dia devolve `null`. */
export function lerMinutoDoDia(texto: string): number | null {
  const encontrado = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!encontrado) return null;
  const horas = Number(encontrado[1]);
  const minutos = Number(encontrado[2]);
  if (minutos > 59) return null;
  const total = horas * 60 + minutos;
  return total >= 0 && total <= MINUTOS_DO_DIA ? total : null;
}

/** `90` vira `1 h 30 min`; `0` vira `0 min`. */
export function formatarDuracaoEmMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  if (resto === 0) return `${horas} h`;
  return `${horas} h ${resto} min`;
}

/**
 * O dia da semana de um DIA CIVIL.
 *
 * A conta é sobre o dia, em UTC, e não sobre relógio nenhum: `2026-09-11` é
 * sexta-feira em qualquer fuso, e o horário de verão não muda isso. Quem tem
 * um INSTANTE converte antes com `hojeComercial`/`diaCivil` — é lá que o
 * `FUSO_COMERCIAL` entra, uma vez só.
 */
export function diaDaSemanaComercial(diaISO: string): DiaDaSemana {
  if (!ehDiaCivil(diaISO)) {
    throw new ProductionCalendarInputError(`Data inválida: ${diaISO}.`);
  }
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [number, number, number];
  const domingoPrimeiro = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  // getUTCDay: 0 = domingo. DIAS_DA_SEMANA: 0 = segunda.
  return DIAS_DA_SEMANA[(domingoPrimeiro + 6) % 7]!;
}

/** A janela bruta do dia, em minutos — antes do intervalo. */
export function janelaEmMinutos(calendario: ProductionCalendarConfigInput): number {
  return calendario.endMinuteOfDay - calendario.startMinuteOfDay;
}

/** Quanto um dia OPERANTE rende: janela menos intervalo. */
export function minutosUteisPorDia(calendario: ProductionCalendarConfigInput): number {
  return janelaEmMinutos(calendario) - calendario.breakMinutes;
}

/** As datas civis com exceção, no formato que as funções de dia consomem. */
export function conjuntoDeExcecoes(excecoes: readonly { date: string }[]): ReadonlySet<string> {
  return new Set(excecoes.map((excecao) => excecao.date));
}

/**
 * A fábrica opera neste dia?
 *
 * Duas metades independentes, e as duas precisam ser verdade: o dia da semana
 * é operante **e** a data não está cadastrada como exceção. Exceção é sempre
 * o DIA INTEIRO nesta fase — não existe parada parcial por hora.
 */
export function ehDiaOperacional(
  diaISO: string,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
): boolean {
  if (excecoes.has(diaISO)) return false;
  return calendario.weekdays[diaDaSemanaComercial(diaISO)];
}

/** Minutos úteis DESTE dia: a jornada num dia operante, zero nos demais. */
export function minutosUteisDoDia(
  diaISO: string,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
): number {
  return ehDiaOperacional(diaISO, calendario, excecoes) ? minutosUteisPorDia(calendario) : 0;
}

/** Um trecho contínuo de trabalho dentro de um dia, em minutos do dia. */
export interface JanelaDeTrabalho {
  inicioMinuto: number;
  fimMinuto: number;
}

/** O intervalo tem horário, e não só duração? */
export function intervaloPosicionado(calendario: ProductionCalendarConfigInput): boolean {
  return (
    calendario.breakStartMinuteOfDay !== null &&
    calendario.breakStartMinuteOfDay !== undefined &&
    calendario.breakEndMinuteOfDay !== null &&
    calendario.breakEndMinuteOfDay !== undefined &&
    calendario.breakEndMinuteOfDay > calendario.breakStartMinuteOfDay
  );
}

/**
 * A mensagem única de calendário sem posição de intervalo.
 *
 * Uma frase só, na tela e na API: o calendário continua válido para o resto —
 * só a agenda com horário exato é que não sai daqui.
 */
export const AVISO_INTERVALO_SEM_HORARIO =
  "Defina o horário do intervalo antes de calcular horários de produção.";

/**
 * As janelas em que a fábrica realmente trabalha num dia.
 *
 * Dia não operante — fim de semana, feriado, recesso — devolve LISTA VAZIA, e
 * não uma janela de zero minuto: "não se trabalha" e "trabalha-se nada" são a
 * mesma resposta para quem soma, e respostas diferentes para quem procura
 * onde encaixar a próxima etapa.
 *
 * RECUSA quando há intervalo sem horário: com `breakMinutes > 0` e posição
 * ausente, devolver a janela inteira contaria a hora do almoço como produção,
 * e devolver janela nenhuma esconderia o dia. Fail-closed, com o motivo.
 */
export function janelasDoDia(
  diaISO: string,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
): JanelaDeTrabalho[] {
  if (!ehDiaOperacional(diaISO, calendario, excecoes)) return [];

  const { startMinuteOfDay: abre, endMinuteOfDay: fecha } = calendario;
  if (calendario.breakMinutes <= 0) return [{ inicioMinuto: abre, fimMinuto: fecha }];

  if (!intervaloPosicionado(calendario)) {
    throw new ProductionCalendarInputError(AVISO_INTERVALO_SEM_HORARIO);
  }

  const pausaDe = calendario.breakStartMinuteOfDay as number;
  const pausaAte = calendario.breakEndMinuteOfDay as number;
  // Pausa colada na abertura ou no fechamento não vira janela de zero minuto.
  return [
    { inicioMinuto: abre, fimMinuto: Math.min(pausaDe, fecha) },
    { inicioMinuto: Math.max(pausaAte, abre), fimMinuto: fecha },
  ].filter((janela) => janela.fimMinuto > janela.inicioMinuto);
}

/**
 * Quantos dias à frente vale procurar por um dia operante.
 *
 * Um ano e um dia cobre o pior caso legítimo — um único dia da semana
 * operante mais um recesso longo — e, acima de tudo, garante fim: um
 * calendário cadastrado errado devolve `null`, nunca trava o processo.
 */
const HORIZONTE_DE_BUSCA = 366;

/**
 * O próximo dia em que a fábrica opera.
 *
 * Por padrão a busca é ESTRITAMENTE depois de `diaISO` — "o próximo" numa
 * sexta-feira operante é a segunda, não ela mesma. `incluirOProprio`
 * responde a outra pergunta: "a partir de quando dá para começar".
 *
 * `null` quando nada foi encontrado no horizonte — resposta honesta, e não um
 * dia inventado.
 */
export function proximoDiaOperacional(
  diaISO: string,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
  opcoes: { incluirOProprio?: boolean } = {},
): string | null {
  let candidato = opcoes.incluirOProprio ? diaISO : diaCivilDeslocado(diaISO, 1);
  for (let passo = 0; passo <= HORIZONTE_DE_BUSCA; passo += 1) {
    if (ehDiaOperacional(candidato, calendario, excecoes)) return candidato;
    candidato = diaCivilDeslocado(candidato, 1);
  }
  return null;
}

/** Um ponto da agenda: o dia civil e o minuto dentro dele. */
export interface MomentoDaJornada {
  diaISO: string;
  minutoDoDia: number;
}

/**
 * O primeiro momento de trabalho a partir de um ponto qualquer.
 *
 * Três casos, nesta ordem: já está dentro da jornada de um dia operante e o
 * próprio momento serve; está antes da abertura e a resposta é a abertura do
 * mesmo dia; está depois do fechamento, ou o dia não opera, e a resposta é a
 * abertura do próximo dia operante.
 *
 * O intervalo É respeitado desde o PLANNING-CAPACITY-BOARD-01: um momento
 * dentro da pausa devolve o fim dela, porque agora a pausa tem horário. Sem
 * posição configurada a função RECUSA, como `janelasDoDia` — devolver a hora
 * do almoço como início de etapa seria pior que não responder.
 *
 * Ele não agenda nada: recebe um ponto e devolve outro.
 */
export function proximoInicioUtil(
  momento: MomentoDaJornada,
  calendario: ProductionCalendarConfigInput,
  excecoes: ReadonlySet<string> = new Set(),
): MomentoDaJornada | null {
  const janelas = janelasDoDia(momento.diaISO, calendario, excecoes);
  for (const janela of janelas) {
    if (momento.minutoDoDia <= janela.inicioMinuto) {
      return { diaISO: momento.diaISO, minutoDoDia: janela.inicioMinuto };
    }
    if (momento.minutoDoDia < janela.fimMinuto) {
      return { diaISO: momento.diaISO, minutoDoDia: momento.minutoDoDia };
    }
  }
  const proximo = proximoDiaOperacional(momento.diaISO, calendario, excecoes);
  if (!proximo) return null;
  const primeira = janelasDoDia(proximo, calendario, excecoes)[0];
  return primeira ? { diaISO: proximo, minutoDoDia: primeira.inicioMinuto } : null;
}

/**
 * As recusas da configuração, em português, na ordem em que a tela as mostra.
 *
 * Uma definição para os dois lados: o servidor recusa com ela e a tela avisa
 * antes de enviar. Lista vazia é configuração válida. O banco confirma as
 * mesmas regras em CHECK — a validação aqui existe para dar a MENSAGEM, nunca
 * para ser a única guarda.
 */
export function validarConfiguracaoDeCalendario(entrada: ProductionCalendarConfigInput): string[] {
  const problemas: string[] = [];
  const { startMinuteOfDay: inicio, endMinuteOfDay: fim, breakMinutes: intervalo } = entrada;

  const inteiroDoDia = (valor: number) =>
    Number.isInteger(valor) && valor >= 0 && valor <= MINUTOS_DO_DIA;

  if (!inteiroDoDia(inicio) || !inteiroDoDia(fim)) {
    problemas.push("Informe o horário inicial e o final entre 00:00 e 24:00.");
  } else if (inicio >= fim) {
    problemas.push("O horário final tem de ser depois do inicial.");
  }

  if (!Number.isInteger(intervalo) || intervalo < 0) {
    problemas.push("O intervalo é um número inteiro de minutos, nunca negativo.");
  } else if (inicio < fim && intervalo >= fim - inicio) {
    problemas.push("O intervalo tem de caber dentro da jornada.");
  }

  /* `?? null`: chamador em JS puro — e fixture de teste — manda `undefined`
     onde o tipo diz `null`, e `undefined !== null` entraria no ramo errado. */
  const pausaDe = entrada.breakStartMinuteOfDay ?? null;
  const pausaAte = entrada.breakEndMinuteOfDay ?? null;
  if ((pausaDe === null) !== (pausaAte === null)) {
    problemas.push("O intervalo precisa de início E fim, ou de nenhum dos dois.");
  } else if (pausaDe !== null && pausaAte !== null) {
    if (!inteiroDoDia(pausaDe) || !inteiroDoDia(pausaAte) || pausaDe >= pausaAte) {
      problemas.push("O fim do intervalo tem de ser depois do início dele.");
    } else if (pausaDe < inicio || pausaAte > fim) {
      problemas.push("O intervalo tem de ficar dentro da jornada.");
    } else if (pausaAte - pausaDe !== intervalo) {
      // Os minutos do intervalo são DERIVADOS do horário: duas verdades sobre
      // a mesma pausa viram jornada com rendimento inventado.
      problemas.push("Os minutos do intervalo têm de bater com o horário informado.");
    }
  }

  if (!DIAS_DA_SEMANA.some((dia) => entrada.weekdays[dia])) {
    problemas.push("Selecione ao menos um dia operante.");
  }

  return problemas;
}
