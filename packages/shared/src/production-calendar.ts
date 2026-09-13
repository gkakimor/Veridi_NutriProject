/**
 * CALENDÁRIO DE PRODUÇÃO — PLANNING-CALENDAR-01, com jornada POR DIA DA SEMANA
 * desde PLANNING-CALENDAR-WEEKLY-SCHEDULE-01.
 *
 * Responde uma pergunta só: **em que janelas a fábrica trabalha neste dia?**
 * Nada aqui agenda Ordem de Produção, ocupa recurso ou desenha quadro — o
 * motor da agenda (`production-schedule.ts`) CONSOME estas janelas, e não
 * existe um segundo.
 *
 * **A regra canônica de um dia, nesta ordem:**
 *
 * 1. a data tem exceção? `SEM_OPERACAO` → nenhuma janela; `HORARIO_ESPECIAL`
 *    → as janelas da exceção, opere ou não aquele dia da semana;
 * 2. sem exceção, vale a jornada daquele dia da semana — e dia que não opera
 *    não tem janela.
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
 * Os dias da semana, de segunda a domingo — o mesmo nome do enum do banco.
 *
 * A ordem é a da semana brasileira, e o índice 0 é segunda — não domingo.
 * `Date#getUTCDay` usa a convenção oposta (0 = domingo), e é exatamente aí
 * que nasce o erro de um dia: a conversão acontece num lugar só,
 * `diaDaSemanaComercial`, e nenhuma outra função olha para números.
 */
export const DIAS_DA_SEMANA = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

export const DIA_DA_SEMANA_LABELS: Record<DiaDaSemana, string> = {
  MONDAY: "Segunda-feira",
  TUESDAY: "Terça-feira",
  WEDNESDAY: "Quarta-feira",
  THURSDAY: "Quinta-feira",
  FRIDAY: "Sexta-feira",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

/** Rótulo curto, para cabeçalho de tabela e chip. */
export const DIA_DA_SEMANA_LABELS_CURTOS: Record<DiaDaSemana, string> = {
  MONDAY: "Seg",
  TUESDAY: "Ter",
  WEDNESDAY: "Qua",
  THURSDAY: "Qui",
  FRIDAY: "Sex",
  SATURDAY: "Sáb",
  SUNDAY: "Dom",
};

/** O MOTIVO de uma exceção. Não decide se a fábrica opera — isso é o funcionamento. */
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

/**
 * COMO a fábrica funciona numa data com exceção.
 *
 * Separado do motivo de propósito: feriado pode ser dia fechado OU expediente
 * até meio-dia. Não existe "meio dia" — o caso real é "jornada diferente
 * nesta data", e 08–12, 13–17 e 08–14 são todos horário especial.
 */
export type ProductionCalendarExceptionOperation = "SEM_OPERACAO" | "HORARIO_ESPECIAL";

export const PRODUCTION_CALENDAR_EXCEPTION_OPERATIONS: readonly ProductionCalendarExceptionOperation[] =
  ["SEM_OPERACAO", "HORARIO_ESPECIAL"];

export const PRODUCTION_CALENDAR_EXCEPTION_OPERATION_LABELS: Record<
  ProductionCalendarExceptionOperation,
  string
> = {
  SEM_OPERACAO: "Sem operação",
  HORARIO_ESPECIAL: "Horário especial",
};

/** O horário de um dia que opera: janela e intervalo opcional, em minutos do dia. */
export interface JornadaDoDia {
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  /** Os dois nulos = dia sem intervalo. Nunca um só. */
  breakStartMinuteOfDay: number | null;
  breakEndMinuteOfDay: number | null;
}

/** O horário como chega do formulário ou do banco — qualquer parte pode faltar. */
export interface HorarioInformado {
  startMinuteOfDay: number | null;
  endMinuteOfDay: number | null;
  breakStartMinuteOfDay: number | null;
  breakEndMinuteOfDay: number | null;
}

/** O que se salva para UM dia da semana — uma linha, sem mexer nas outras. */
export interface ProductionCalendarWeekdayInput extends HorarioInformado {
  enabled: boolean;
}

/** Um dia da semana como o motor o consome. */
export interface JornadaDaSemana extends ProductionCalendarWeekdayInput {
  weekday: DiaDaSemana;
  /**
   * LEGADO: minutos de intervalo SEM horário, herdados da jornada única em que
   * só a duração da pausa estava cadastrada (e da sugestão de calendário
   * novo). O dia rende `fim − início − N`, mas não produz hora exata: as
   * janelas RECUSAM até alguém salvar o dia — com o horário da pausa ou sem
   * pausa. Nenhuma escrita da API grava valor aqui.
   */
  unpositionedBreakMinutes: number | null;
}

export interface ProductionCalendarWeekdayDTO extends JornadaDaSemana {
  /** Derivado — janela menos intervalo; zero no dia que não opera. Nunca coluna. */
  workingMinutes: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProductionCalendarDTO {
  /**
   * `false` enquanto ninguém salvou: a tela mostra a semana sugerida e diz que
   * ela ainda não foi confirmada. Ler nunca cria o calendário.
   */
  configured: boolean;
  /** Os sete dias, de segunda a domingo — sempre os sete. */
  weekdays: ProductionCalendarWeekdayDTO[];
  /**
   * A frase que falta quando algum dia tem intervalo sem horário, e `null`
   * quando não falta nada. O calendário continua válido para o resto; só a
   * agenda com horário exato é que depende disto.
   */
  breakPositionWarning: string | null;
  /** Último salvamento de qualquer dia. */
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Uma exceção como o motor a consome. */
export interface ExcecaoDoCalendario extends HorarioInformado {
  /** DATA CIVIL `YYYY-MM-DD`. Não é instante e não ganha hora. */
  date: string;
  operation: ProductionCalendarExceptionOperation;
}

export interface ProductionCalendarExceptionDTO extends ExcecaoDoCalendario {
  id: string;
  type: ProductionCalendarExceptionType;
  /** Observação livre. */
  reason: string | null;
  /** Derivado — zero em SEM_OPERACAO. */
  workingMinutes: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ProductionCalendarExceptionListResponse {
  exceptions: ProductionCalendarExceptionDTO[];
}

/** Cadastro de exceção. Sem `operation`, a exceção é SEM_OPERACAO — o que toda exceção era. */
export interface ProductionCalendarExceptionInput extends Partial<HorarioInformado> {
  date: string;
  type: ProductionCalendarExceptionType;
  reason?: string | null;
  operation?: ProductionCalendarExceptionOperation;
}

/**
 * Edição de exceção. A DATA não muda. Com `operation`, o funcionamento
 * inteiro é substituído — horário omitido vira nulo; sem ela, só motivo e
 * observação mudam.
 */
export interface ProductionCalendarExceptionUpdateInput extends Partial<HorarioInformado> {
  type?: ProductionCalendarExceptionType;
  reason?: string | null;
  operation?: ProductionCalendarExceptionOperation;
}

/** A semana inteira e as exceções, prontas para o motor. */
export interface CalendarioDeProducao {
  semana: Readonly<Record<DiaDaSemana, JornadaDaSemana>>;
  excecoes: ReadonlyMap<string, ExcecaoDoCalendario>;
}

/**
 * A semana de um calendário NOVO — segunda a sexta, 08:00 às 17:00, 1 h de
 * intervalo; sábado e domingo sem operação. Sugestão de partida para quem
 * ainda não configurou; quem já salvou nunca é sobrescrito por ela.
 *
 * O intervalo vai SEM horário, de propósito: a posição da pausa é decisão da
 * fábrica, e um palpite gravado de 12:00–13:00 vira horário de produção errado
 * sem ninguém perceber. Enquanto o dia não for salvo, a agenda recusa.
 */
export const SEMANA_PADRAO: readonly JornadaDaSemana[] = DIAS_DA_SEMANA.map((weekday) =>
  weekday === "SATURDAY" || weekday === "SUNDAY"
    ? {
        weekday,
        enabled: false,
        startMinuteOfDay: null,
        endMinuteOfDay: null,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
        unpositionedBreakMinutes: null,
      }
    : {
        weekday,
        enabled: true,
        startMinuteOfDay: 8 * 60,
        endMinuteOfDay: 17 * 60,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
        unpositionedBreakMinutes: 60,
      },
);

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

/** `480, 720` vira `08:00–12:00`. */
export function formatarJanela(inicio: number, fim: number): string {
  return `${formatarMinutoDoDia(inicio)}–${formatarMinutoDoDia(fim)}`;
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

/** Algum horário foi informado? Dia fechado e SEM_OPERACAO não aceitam nenhum. */
function temAlgumHorario(horario: HorarioInformado): boolean {
  return (
    (horario.startMinuteOfDay ?? null) !== null ||
    (horario.endMinuteOfDay ?? null) !== null ||
    (horario.breakStartMinuteOfDay ?? null) !== null ||
    (horario.breakEndMinuteOfDay ?? null) !== null
  );
}

/**
 * As recusas do horário de um dia que opera, em português, na ordem em que a
 * tela as mostra.
 *
 * Uma definição para os dois lados — dia da semana e horário especial —, e
 * para as três camadas: a tela avisa antes de enviar, o servidor recusa com a
 * mesma frase e o banco confirma em CHECK. Lista vazia é horário válido.
 */
export function validarHorario(horario: HorarioInformado): string[] {
  const problemas: string[] = [];
  /* `?? null`: chamador em JS puro — e fixture de teste — manda `undefined`
     onde o tipo diz `null`, e `undefined !== null` entraria no ramo errado. */
  const inicio = horario.startMinuteOfDay ?? null;
  const fim = horario.endMinuteOfDay ?? null;
  const pausaDe = horario.breakStartMinuteOfDay ?? null;
  const pausaAte = horario.breakEndMinuteOfDay ?? null;

  const inteiroDoDia = (valor: number) =>
    Number.isInteger(valor) && valor >= 0 && valor <= MINUTOS_DO_DIA;

  let janelaValida = false;
  if (inicio === null || fim === null) {
    problemas.push("Informe o horário inicial e o final.");
  } else if (!inteiroDoDia(inicio) || !inteiroDoDia(fim)) {
    problemas.push("Informe o horário inicial e o final entre 00:00 e 24:00.");
  } else if (inicio >= fim) {
    problemas.push("O horário final tem de ser depois do inicial.");
  } else {
    janelaValida = true;
  }

  if ((pausaDe === null) !== (pausaAte === null)) {
    problemas.push("O intervalo precisa de início E fim, ou de nenhum dos dois.");
  } else if (pausaDe !== null && pausaAte !== null) {
    if (!inteiroDoDia(pausaDe) || !inteiroDoDia(pausaAte) || pausaDe >= pausaAte) {
      problemas.push("O fim do intervalo tem de ser depois do início dele.");
    } else if (janelaValida && (pausaDe < inicio! || pausaAte > fim!)) {
      problemas.push("O intervalo tem de ficar dentro da jornada.");
    } else if (janelaValida && pausaAte - pausaDe >= fim! - inicio!) {
      // Pausa do tamanho da jornada é dia sem trabalho — e isso é "não opera".
      problemas.push("O intervalo não pode ocupar a jornada inteira.");
    }
  }

  return problemas;
}

/** As recusas de UM dia da semana. Dia que não opera não tem horário. */
export function validarDiaDaSemana(entrada: ProductionCalendarWeekdayInput): string[] {
  if (!entrada.enabled) {
    return temAlgumHorario(entrada)
      ? ["Dia que não opera não tem horário: deixe início, fim e intervalo em branco."]
      : [];
  }
  return validarHorario(entrada);
}

/** As recusas do funcionamento de uma exceção. */
export function validarExcecao(
  entrada: { operation: ProductionCalendarExceptionOperation } & HorarioInformado,
): string[] {
  if (entrada.operation === "SEM_OPERACAO") {
    return temAlgumHorario(entrada)
      ? ["Sem operação fecha o dia inteiro: deixe início, fim e intervalo em branco."]
      : [];
  }
  return validarHorario(entrada);
}

/**
 * A jornada de um horário que TEM de estar completo — dia da semana que opera
 * ou horário especial. O banco garante por CHECK; a recusa aqui existe para o
 * motor nunca somar `null` em silêncio.
 */
function jornadaCompleta(horario: HorarioInformado, rotulo: string): JornadaDoDia {
  const inicio = horario.startMinuteOfDay ?? null;
  const fim = horario.endMinuteOfDay ?? null;
  if (inicio === null || fim === null) {
    throw new ProductionCalendarInputError(`${rotulo} está sem horário inicial ou final.`);
  }
  return {
    startMinuteOfDay: inicio,
    endMinuteOfDay: fim,
    breakStartMinuteOfDay: horario.breakStartMinuteOfDay ?? null,
    breakEndMinuteOfDay: horario.breakEndMinuteOfDay ?? null,
  };
}

/** Quanto uma jornada rende: janela menos intervalo. */
export function minutosUteisDaJornada(jornada: JornadaDoDia): number {
  const pausa =
    jornada.breakStartMinuteOfDay !== null && jornada.breakEndMinuteOfDay !== null
      ? jornada.breakEndMinuteOfDay - jornada.breakStartMinuteOfDay
      : 0;
  return jornada.endMinuteOfDay - jornada.startMinuteOfDay - pausa;
}

/**
 * Quanto um dia da semana rende. Zero quando não opera; o legado sem horário
 * de pausa rende `fim − início − N` — o mesmo que rendia antes da jornada
 * semanal, para o quadro não mudar de número por causa da migração.
 */
export function minutosUteisDoDiaDaSemana(dia: JornadaDaSemana): number {
  if (!dia.enabled) return 0;
  const jornada = jornadaCompleta(dia, DIA_DA_SEMANA_LABELS[dia.weekday]);
  return minutosUteisDaJornada(jornada) - (dia.unpositionedBreakMinutes ?? 0);
}

/** Quanto uma exceção rende. Zero em SEM_OPERACAO. */
export function minutosUteisDaExcecao(excecao: ExcecaoDoCalendario): number {
  if (excecao.operation === "SEM_OPERACAO") return 0;
  return minutosUteisDaJornada(jornadaCompleta(excecao, `A exceção de ${excecao.date}`));
}

/** Os dias que ainda carregam intervalo sem horário. */
export function diasComIntervaloSemHorario(semana: readonly JornadaDaSemana[]): DiaDaSemana[] {
  return DIAS_DA_SEMANA.filter((weekday) =>
    semana.some(
      (dia) =>
        dia.weekday === weekday && dia.enabled && (dia.unpositionedBreakMinutes ?? null) !== null,
    ),
  );
}

/**
 * A mensagem única de intervalo sem horário, nomeando os dias.
 *
 * Uma frase só, na tela e na API: o calendário continua válido para o resto —
 * só a agenda com horário exato é que não sai daqui. `null` sem dia pendente.
 */
export function avisoDeIntervaloSemHorario(dias: readonly DiaDaSemana[]): string | null {
  if (dias.length === 0) return null;
  const nomes = dias.map((dia) => DIA_DA_SEMANA_LABELS[dia]);
  const lista =
    nomes.length === 1 ? nomes[0]! : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `Defina o horário do intervalo de ${lista} antes de calcular horários de produção.`;
}

/**
 * Monta o calendário que o motor consome.
 *
 * RECUSA semana incompleta: um dia sem linha não é "dia fechado" nem "dia de
 * 08 às 17" — é um cadastro que falta, e escolher por ele seria usar horário
 * que ninguém definiu.
 */
export function montarCalendario(
  semana: readonly JornadaDaSemana[],
  excecoes: readonly ExcecaoDoCalendario[] = [],
): CalendarioDeProducao {
  const porDia = new Map(semana.map((dia) => [dia.weekday, dia]));
  const faltando = DIAS_DA_SEMANA.filter((dia) => !porDia.has(dia));
  if (faltando.length > 0) {
    throw new ProductionCalendarInputError(
      `A jornada semanal está incompleta: falta ${faltando.map((dia) => DIA_DA_SEMANA_LABELS[dia]).join(", ")}.`,
    );
  }
  return {
    semana: Object.fromEntries(porDia) as Record<DiaDaSemana, JornadaDaSemana>,
    excecoes: new Map(excecoes.map((excecao) => [excecao.date, excecao])),
  };
}

/**
 * A fábrica opera neste dia?
 *
 * A exceção da data vence a semana, para mais e para menos: um sábado que não
 * opera trabalha na data com horário especial, e uma segunda que opera fecha
 * na data sem operação.
 */
export function ehDiaOperacional(diaISO: string, calendario: CalendarioDeProducao): boolean {
  const weekday = diaDaSemanaComercial(diaISO);
  const excecao = calendario.excecoes.get(diaISO);
  if (excecao) return excecao.operation === "HORARIO_ESPECIAL";
  return calendario.semana[weekday].enabled;
}

/** Minutos úteis DESTE dia, pela mesma precedência das janelas. */
export function minutosUteisDoDia(diaISO: string, calendario: CalendarioDeProducao): number {
  const weekday = diaDaSemanaComercial(diaISO);
  const excecao = calendario.excecoes.get(diaISO);
  if (excecao) return minutosUteisDaExcecao(excecao);
  return minutosUteisDoDiaDaSemana(calendario.semana[weekday]);
}

/** Um trecho contínuo de trabalho dentro de um dia, em minutos do dia. */
export interface JanelaDeTrabalho {
  inicioMinuto: number;
  fimMinuto: number;
}

/** As janelas de uma jornada: uma sem intervalo, duas com ele. */
function janelasDaJornada(jornada: JornadaDoDia): JanelaDeTrabalho[] {
  const { startMinuteOfDay: abre, endMinuteOfDay: fecha } = jornada;
  if (jornada.breakStartMinuteOfDay === null || jornada.breakEndMinuteOfDay === null) {
    return [{ inicioMinuto: abre, fimMinuto: fecha }];
  }
  const pausaDe = jornada.breakStartMinuteOfDay;
  const pausaAte = jornada.breakEndMinuteOfDay;
  // Pausa colada na abertura ou no fechamento não vira janela de zero minuto.
  return [
    { inicioMinuto: abre, fimMinuto: Math.min(pausaDe, fecha) },
    { inicioMinuto: Math.max(pausaAte, abre), fimMinuto: fecha },
  ].filter((janela) => janela.fimMinuto > janela.inicioMinuto);
}

/**
 * As janelas em que a fábrica realmente trabalha num dia — A REGRA CANÔNICA.
 *
 * 1. exceção da data: `SEM_OPERACAO` → `[]`; `HORARIO_ESPECIAL` → as janelas
 *    dela, opere ou não aquele dia da semana;
 * 2. sem exceção: a jornada daquele dia da semana, e `[]` se ele não opera.
 *
 * Dia fechado devolve LISTA VAZIA, e não uma janela de zero minuto: "não se
 * trabalha" e "trabalha-se nada" são a mesma resposta para quem soma, e
 * respostas diferentes para quem procura onde encaixar a próxima etapa.
 *
 * RECUSA o dia da semana com intervalo sem horário: devolver a janela inteira
 * contaria a hora do almoço como produção, e devolver janela nenhuma
 * esconderia o dia. Fail-closed, com o motivo.
 */
export function janelasDoDia(diaISO: string, calendario: CalendarioDeProducao): JanelaDeTrabalho[] {
  const weekday = diaDaSemanaComercial(diaISO);
  const excecao = calendario.excecoes.get(diaISO);
  if (excecao) {
    if (excecao.operation === "SEM_OPERACAO") return [];
    return janelasDaJornada(jornadaCompleta(excecao, `A exceção de ${diaISO}`));
  }

  const dia = calendario.semana[weekday];
  if (!dia.enabled) return [];
  if ((dia.unpositionedBreakMinutes ?? null) !== null) {
    throw new ProductionCalendarInputError(avisoDeIntervaloSemHorario([weekday])!);
  }
  return janelasDaJornada(jornadaCompleta(dia, DIA_DA_SEMANA_LABELS[weekday]));
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
  calendario: CalendarioDeProducao,
  opcoes: { incluirOProprio?: boolean } = {},
): string | null {
  let candidato = opcoes.incluirOProprio ? diaISO : diaCivilDeslocado(diaISO, 1);
  for (let passo = 0; passo <= HORIZONTE_DE_BUSCA; passo += 1) {
    if (ehDiaOperacional(candidato, calendario)) return candidato;
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
 * Três casos, nesta ordem: já está dentro de uma janela do dia e o próprio
 * momento serve; está antes de uma janela do mesmo dia e a resposta é a
 * abertura dela (o fim da pausa, quando o momento cai no intervalo); está
 * depois da última janela, ou o dia não opera, e a resposta é a abertura do
 * próximo dia operante — com a jornada DAQUELE dia, não a deste.
 *
 * Ele não agenda nada: recebe um ponto e devolve outro.
 */
export function proximoInicioUtil(
  momento: MomentoDaJornada,
  calendario: CalendarioDeProducao,
): MomentoDaJornada | null {
  const janelas = janelasDoDia(momento.diaISO, calendario);
  for (const janela of janelas) {
    if (momento.minutoDoDia <= janela.inicioMinuto) {
      return { diaISO: momento.diaISO, minutoDoDia: janela.inicioMinuto };
    }
    if (momento.minutoDoDia < janela.fimMinuto) {
      return { diaISO: momento.diaISO, minutoDoDia: momento.minutoDoDia };
    }
  }
  const proximo = proximoDiaOperacional(momento.diaISO, calendario);
  if (!proximo) return null;
  const primeira = janelasDoDia(proximo, calendario)[0];
  return primeira ? { diaISO: proximo, minutoDoDia: primeira.inicioMinuto } : null;
}
