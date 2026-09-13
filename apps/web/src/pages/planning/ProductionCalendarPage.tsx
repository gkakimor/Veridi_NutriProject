import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  DiaDaSemana,
  HorarioInformado,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarExceptionOperation,
  ProductionCalendarExceptionType,
  ProductionCalendarWeekdayDTO,
  ProductionCalendarWeekdayInput,
} from "@veridi/shared";
import {
  DIA_DA_SEMANA_LABELS,
  PRODUCTION_CALENDAR_EXCEPTION_OPERATIONS,
  PRODUCTION_CALENDAR_EXCEPTION_OPERATION_LABELS,
  PRODUCTION_CALENDAR_EXCEPTION_TYPES,
  PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS,
  diaDaSemanaComercial,
  formatarDuracaoEmMinutos,
  formatarJanela,
  formatarMinutoDoDia,
  hojeComercial,
  lerMinutoDoDia,
  minutosUteisDaJornada,
  validarDiaDaSemana,
  validarExcecao,
} from "@veridi/shared";
import {
  createProductionCalendarException,
  deleteProductionCalendarException,
  getProductionCalendar,
  listProductionCalendarExceptions,
  updateProductionCalendarException,
  updateProductionCalendarWeekday,
} from "../../lib/production-calendar-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { useAuth } from "../../app/AuthProvider";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import "./planning.css";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01, jornada por dia
 * da semana e horário especial desde PLANNING-CALENDAR-WEEKLY-SCHEDULE-01).
 *
 * A jornada de cada dia e as regras de cada data. É UM calendário — o título
 * é singular de propósito, e não há lista para escolher.
 *
 * **Uma linha em edição por vez.** Editar a sexta abre os campos DA sexta; as
 * outras seis continuam em leitura com o que está gravado. Tentar editar outro
 * dia com a sexta alterada passa pela mesma guarda de alterações não salvas do
 * ERP — nada de sete rascunhos simultâneos.
 *
 * A tela não agenda Ordem de Produção, não guarda capacidade de recurso e
 * não move promessa de entrega ao cliente.
 */

type CampoDeHorario = keyof HorarioInformado;

interface RascunhoDoDia extends ProductionCalendarWeekdayInput {
  weekday: DiaDaSemana;
}

interface FormularioDeExcecao extends HorarioInformado {
  date: string;
  type: ProductionCalendarExceptionType;
  operation: ProductionCalendarExceptionOperation;
  reason: string;
}

const EXCECAO_VAZIA: FormularioDeExcecao = {
  date: "",
  type: "FERIADO",
  operation: "SEM_OPERACAO",
  startMinuteOfDay: null,
  endMinuteOfDay: null,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
  reason: "",
};

const SEM_HORARIO: HorarioInformado = {
  startMinuteOfDay: null,
  endMinuteOfDay: null,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
};

/**
 * Ao marcar "opera" num dia que não tinha horário, os campos já aparecem com
 * 08:00–17:00 — à vista, e só valendo depois de "Salvar". Sem intervalo: a
 * posição da pausa é da fábrica, não um palpite da tela.
 */
const HORARIO_AO_ATIVAR = { startMinuteOfDay: 8 * 60, endMinuteOfDay: 17 * 60 };

/** Sábado e Domingo pedem "salvo"; os dias "-feira", "salva". */
function diaSalvo(weekday: DiaDaSemana): string {
  const masculino = weekday === "SATURDAY" || weekday === "SUNDAY";
  return `${DIA_DA_SEMANA_LABELS[weekday]} ${masculino ? "salvo" : "salva"}.`;
}

/** A janela que a lista mostra: do começo do ano corrente a um ano à frente. */
function janelaDaLista(hoje: string): { from: string; to: string } {
  const ano = Number(hoje.slice(0, 4));
  return { from: `${ano}-01-01`, to: `${ano + 1}-12-31` };
}

function rascunhoDoDia(dia: ProductionCalendarWeekdayDTO): RascunhoDoDia {
  return {
    weekday: dia.weekday,
    enabled: dia.enabled,
    startMinuteOfDay: dia.startMinuteOfDay,
    endMinuteOfDay: dia.endMinuteOfDay,
    breakStartMinuteOfDay: dia.breakStartMinuteOfDay,
    breakEndMinuteOfDay: dia.breakEndMinuteOfDay,
  };
}

/** O que realmente seria gravado: dia que não opera não leva horário nenhum. */
function entradaDoRascunho(rascunho: RascunhoDoDia): ProductionCalendarWeekdayInput {
  if (!rascunho.enabled) return { enabled: false, ...SEM_HORARIO };
  return {
    enabled: true,
    startMinuteOfDay: rascunho.startMinuteOfDay,
    endMinuteOfDay: rascunho.endMinuteOfDay,
    breakStartMinuteOfDay: rascunho.breakStartMinuteOfDay,
    breakEndMinuteOfDay: rascunho.breakEndMinuteOfDay,
  };
}

function mesmaEntrada(a: ProductionCalendarWeekdayInput, b: ProductionCalendarWeekdayInput): boolean {
  return (
    a.enabled === b.enabled &&
    a.startMinuteOfDay === b.startMinuteOfDay &&
    a.endMinuteOfDay === b.endMinuteOfDay &&
    a.breakStartMinuteOfDay === b.breakStartMinuteOfDay &&
    a.breakEndMinuteOfDay === b.breakEndMinuteOfDay
  );
}

/** Horas úteis de um horário ainda em edição — travessão enquanto ele não fecha. */
function horasUteisDoHorario(horario: HorarioInformado, problemas: readonly string[]): string {
  if (problemas.length > 0 || horario.startMinuteOfDay === null || horario.endMinuteOfDay === null) {
    return "—";
  }
  return formatarDuracaoEmMinutos(
    minutosUteisDaJornada({
      startMinuteOfDay: horario.startMinuteOfDay,
      endMinuteOfDay: horario.endMinuteOfDay,
      breakStartMinuteOfDay: horario.breakStartMinuteOfDay,
      breakEndMinuteOfDay: horario.breakEndMinuteOfDay,
    }),
  );
}

function valorDoHorario(minuto: number | null): string {
  return minuto === null ? "" : formatarMinutoDoDia(minuto);
}

/** `2026-12-25` vira `25/12/2026` — data civil, lida em UTC como foi gravada. */
function diaPorExtenso(diaISO: string): string {
  const [ano, mes, dia] = diaISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function ProductionCalendarPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const hoje = useMemo(() => hojeComercial(), []);
  const janela = useMemo(() => janelaDaLista(hoje), [hoje]);

  const [calendario, setCalendario] = useState<ProductionCalendarDTO | null>(null);
  const [excecoes, setExcecoes] = useState<ProductionCalendarExceptionDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  /* Jornada semanal — no máximo UMA linha em edição. */
  const [editando, setEditando] = useState<RascunhoDoDia | null>(null);
  const [salvandoDia, setSalvandoDia] = useState(false);
  const [erroDia, setErroDia] = useState<string | null>(null);
  const [avisoDia, setAvisoDia] = useState<string | null>(null);

  /* Formulário de exceção — `editandoExcecaoId` separa cadastrar de editar. */
  const [editandoExcecaoId, setEditandoExcecaoId] = useState<string | null>(null);
  const [formExcecao, setFormExcecao] = useState<FormularioDeExcecao>(EXCECAO_VAZIA);
  const [salvandoExcecao, setSalvandoExcecao] = useState(false);
  const [erroExcecao, setErroExcecao] = useState<string | null>(null);
  const [avisoExcecao, setAvisoExcecao] = useState<string | null>(null);

  const persistido = editando
    ? (calendario?.weekdays.find((dia) => dia.weekday === editando.weekday) ?? null)
    : null;
  const diaAlterado =
    editando !== null &&
    persistido !== null &&
    !mesmaEntrada(entradaDoRascunho(rascunhoDoDia(persistido)), entradaDoRascunho(editando));
  const { confirmarDescarte } = useUnsavedChangesGuard({
    isDirty: diaAlterado,
    substantivo: editando ? `jornada de ${DIA_DA_SEMANA_LABELS[editando.weekday]}` : "jornada",
    genero: "a",
  });

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    Promise.all([getProductionCalendar(), listProductionCalendarExceptions(janela)])
      .then(([config, lista]) => {
        setCalendario(config);
        setExcecoes(lista.exceptions);
      })
      .catch((err: unknown) => setErro(apiErrorMessage(err, "Falha ao carregar o calendário")))
      .finally(() => setCarregando(false));
  }, [janela]);

  useEffect(() => recarregar(), [recarregar]);

  // ───────────────────────────────────────────── jornada semanal, uma linha

  const problemasDoDia = editando ? validarDiaDaSemana(entradaDoRascunho(editando)) : [];
  /*
   * Dia com intervalo legado sem horário se salva mesmo sem alteração: é
   * justamente salvar que diz "sem intervalo" ou "das 12:00 às 13:00".
   */
  const legadoPendente = persistido !== null && persistido.unpositionedBreakMinutes !== null;
  const podeSalvarDia = problemasDoDia.length === 0 && (diaAlterado || legadoPendente);

  function iniciarEdicao(dia: ProductionCalendarWeekdayDTO) {
    confirmarDescarte(() => {
      setEditando(rascunhoDoDia(dia));
      setErroDia(null);
      setAvisoDia(null);
    });
  }

  /** Cancelar é descartar o rascunho: a linha volta a mostrar o que está gravado. */
  function cancelarEdicao() {
    setEditando(null);
    setErroDia(null);
  }

  function alterarHorarioDoDia(campo: CampoDeHorario, texto: string) {
    const minuto = texto.trim() === "" ? null : lerMinutoDoDia(texto);
    if (texto.trim() !== "" && minuto === null) return;
    setEditando((atual) => (atual ? { ...atual, [campo]: minuto } : atual));
  }

  function alternarOpera(opera: boolean) {
    setEditando((atual) => {
      if (!atual) return atual;
      if (!opera) return { ...atual, enabled: false };
      const semHorario = atual.startMinuteOfDay === null && atual.endMinuteOfDay === null;
      return { ...atual, enabled: true, ...(semHorario ? HORARIO_AO_ATIVAR : {}) };
    });
  }

  async function salvarDia() {
    if (!editando || !podeSalvarDia) return;
    const { weekday } = editando;
    setSalvandoDia(true);
    setErroDia(null);
    setAvisoDia(null);
    try {
      const salvo = await updateProductionCalendarWeekday(weekday, entradaDoRascunho(editando));
      setCalendario(salvo);
      setEditando(null);
      setAvisoDia(diaSalvo(weekday));
    } catch (err) {
      setErroDia(apiErrorMessage(err, `Falha ao salvar ${DIA_DA_SEMANA_LABELS[weekday]}`));
    } finally {
      setSalvandoDia(false);
    }
  }

  // ─────────────────────────────────────────────────────────────── exceções

  const funcionamento = {
    operation: formExcecao.operation,
    ...(formExcecao.operation === "HORARIO_ESPECIAL"
      ? {
          startMinuteOfDay: formExcecao.startMinuteOfDay,
          endMinuteOfDay: formExcecao.endMinuteOfDay,
          breakStartMinuteOfDay: formExcecao.breakStartMinuteOfDay,
          breakEndMinuteOfDay: formExcecao.breakEndMinuteOfDay,
        }
      : SEM_HORARIO),
  };
  const problemasDaExcecao = validarExcecao(funcionamento);

  function alterarHorarioDaExcecao(campo: CampoDeHorario, texto: string) {
    const minuto = texto.trim() === "" ? null : lerMinutoDoDia(texto);
    if (texto.trim() !== "" && minuto === null) return;
    setFormExcecao((atual) => ({ ...atual, [campo]: minuto }));
  }

  function limparFormularioDeExcecao() {
    setEditandoExcecaoId(null);
    setFormExcecao(EXCECAO_VAZIA);
    setErroExcecao(null);
  }

  function editarExcecao(excecao: ProductionCalendarExceptionDTO) {
    setEditandoExcecaoId(excecao.id);
    setFormExcecao({
      date: excecao.date,
      type: excecao.type,
      operation: excecao.operation,
      startMinuteOfDay: excecao.startMinuteOfDay,
      endMinuteOfDay: excecao.endMinuteOfDay,
      breakStartMinuteOfDay: excecao.breakStartMinuteOfDay,
      breakEndMinuteOfDay: excecao.breakEndMinuteOfDay,
      reason: excecao.reason ?? "",
    });
    setErroExcecao(null);
    setAvisoExcecao(null);
  }

  async function salvarExcecao() {
    if (!formExcecao.date || problemasDaExcecao.length > 0) return;
    const data = diaPorExtenso(formExcecao.date);
    const editandoId = editandoExcecaoId;
    setSalvandoExcecao(true);
    setErroExcecao(null);
    setAvisoExcecao(null);
    try {
      const comum = {
        type: formExcecao.type,
        reason: formExcecao.reason.trim() || null,
        ...funcionamento,
      };
      if (editandoId) {
        await updateProductionCalendarException(editandoId, comum);
      } else {
        await createProductionCalendarException({ date: formExcecao.date, ...comum });
      }
      const lista = await listProductionCalendarExceptions(janela);
      setExcecoes(lista.exceptions);
      limparFormularioDeExcecao();
      setAvisoExcecao(editandoId ? `Exceção de ${data} salva.` : `Exceção de ${data} cadastrada.`);
    } catch (err) {
      setErroExcecao(apiErrorMessage(err, "Falha ao salvar a exceção"));
    } finally {
      setSalvandoExcecao(false);
    }
  }

  async function excluirExcecao(excecao: ProductionCalendarExceptionDTO) {
    const data = diaPorExtenso(excecao.date);
    const diaDaSemana = DIA_DA_SEMANA_LABELS[diaDaSemanaComercial(excecao.date)];
    if (
      !window.confirm(
        `Excluir a exceção de ${data}? A data volta a seguir a jornada de ${diaDaSemana}.`,
      )
    ) {
      return;
    }
    setErroExcecao(null);
    setAvisoExcecao(null);
    try {
      await deleteProductionCalendarException(excecao.id);
      if (editandoExcecaoId === excecao.id) limparFormularioDeExcecao();
      const lista = await listProductionCalendarExceptions(janela);
      setExcecoes(lista.exceptions);
      setAvisoExcecao(`Exceção de ${data} excluída.`);
    } catch (err) {
      setErroExcecao(apiErrorMessage(err, "Falha ao excluir a exceção"));
    }
  }

  const colunasDaSemana = canEdit ? 7 : 6;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Calendário de Produção</h1>
          <p className="page__subtitle">
            A jornada de cada dia da semana e as regras de cada data. É um calendário só: mão de
            obra e equipamento seguem esta mesma jornada. Não define capacidade de recurso — isso é
            do cadastro de Recursos industriais — e não programa Ordem de Produção, que é o
            Planejamento de Produção.
          </p>
        </div>
      </div>

      <ContextHelp topic={helpTopics["planejamento.calendario"]} />

      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}

      {calendario?.breakPositionWarning && (
        <p className="pendency-panel" role="status">
          <span className="pendency-panel__title">{calendario.breakPositionWarning}</span>
          <span className="pendency-panel__sub">
            O calendário continua valendo para o resto. Só a programação com horas exatas é que
            espera por isto: edite o dia e informe o intervalo, ou deixe-o em branco se o dia não
            tem pausa.
          </span>
        </p>
      )}

      {carregando && <p className="field__hint">Carregando…</p>}

      {!carregando && calendario && (
        <>
          <section className="form-section calendar-section" aria-label="Jornada semanal">
            <h3>Jornada semanal</h3>
            <p className="form-section__sub">
              O horário normal de cada dia, no relógio de São Paulo. Cada dia se edita e se salva
              sozinho — mudar a sexta não mexe na segunda. Dia sem intervalo deixa os dois campos
              do intervalo em branco.
              {!calendario.configured && (
                <>
                  {" "}
                  <b>Ainda não configurado:</b> a semana abaixo é uma sugestão de partida. Ao salvar
                  o primeiro dia, os outros passam a valer com o que está na tela, e continuam
                  editáveis.
                </>
              )}
            </p>

            <div className="table-container">
              <table className="table calendar-cards calendar-week">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Opera</th>
                    <th>Início</th>
                    <th>Intervalo</th>
                    <th>Fim</th>
                    <th className="is-numeric">Horas úteis</th>
                    {canEdit && <th>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {calendario.weekdays.map((dia) => {
                    const rotulo = DIA_DA_SEMANA_LABELS[dia.weekday];
                    const emEdicao = editando?.weekday === dia.weekday ? editando : null;

                    if (!emEdicao) {
                      return (
                        <tr key={dia.weekday} data-weekday={dia.weekday}>
                          <td className="calendar-cards__title">{rotulo}</td>
                          <td data-label="Opera">
                            <span>{dia.enabled ? "Sim" : "Não"}</span>
                          </td>
                          <td data-label="Início">
                            <span>
                              {dia.enabled && dia.startMinuteOfDay !== null
                                ? formatarMinutoDoDia(dia.startMinuteOfDay)
                                : "—"}
                            </span>
                          </td>
                          <td data-label="Intervalo">
                            <span>
                              {!dia.enabled ? (
                                "—"
                              ) : dia.breakStartMinuteOfDay !== null &&
                                dia.breakEndMinuteOfDay !== null ? (
                                formatarJanela(dia.breakStartMinuteOfDay, dia.breakEndMinuteOfDay)
                              ) : dia.unpositionedBreakMinutes !== null ? (
                                <span className="calendar-week__pending">
                                  {formatarDuracaoEmMinutos(dia.unpositionedBreakMinutes)} sem
                                  horário
                                </span>
                              ) : (
                                "—"
                              )}
                            </span>
                          </td>
                          <td data-label="Fim">
                            <span>
                              {dia.enabled && dia.endMinuteOfDay !== null
                                ? formatarMinutoDoDia(dia.endMinuteOfDay)
                                : "—"}
                            </span>
                          </td>
                          <td data-label="Horas úteis" className="is-numeric">
                            <span>
                              {dia.enabled ? formatarDuracaoEmMinutos(dia.workingMinutes) : "—"}
                            </span>
                          </td>
                          {canEdit && (
                            <td className="calendar-cards__actions">
                              {/* O nome acessível começa pelo texto visível e diz o
                                  dia: sete "Editar" iguais não se distinguem. */}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                aria-label={`Editar ${rotulo}`}
                                disabled={salvandoDia}
                                onClick={() => iniciarEdicao(dia)}
                              >
                                Editar
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    }

                    return (
                      <Fragment key={dia.weekday}>
                        <tr data-weekday={dia.weekday} className="calendar-week__row--editing">
                          <td className="calendar-cards__title">{rotulo}</td>
                          <td data-label="Opera">
                            <span>
                              <input
                                type="checkbox"
                                aria-label={`${rotulo} opera`}
                                checked={emEdicao.enabled}
                                disabled={salvandoDia}
                                onChange={(event) => alternarOpera(event.target.checked)}
                              />
                            </span>
                          </td>
                          <td data-label="Início">
                            {emEdicao.enabled ? (
                              <input
                                type="time"
                                step={60}
                                aria-label={`Início — ${rotulo}`}
                                disabled={salvandoDia}
                                value={valorDoHorario(emEdicao.startMinuteOfDay)}
                                onChange={(event) =>
                                  alterarHorarioDoDia("startMinuteOfDay", event.target.value)
                                }
                              />
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td data-label="Intervalo">
                            {emEdicao.enabled ? (
                              <span className="calendar-week__break">
                                <input
                                  type="time"
                                  step={60}
                                  aria-label={`Início do intervalo — ${rotulo}`}
                                  disabled={salvandoDia}
                                  value={valorDoHorario(emEdicao.breakStartMinuteOfDay)}
                                  onChange={(event) =>
                                    alterarHorarioDoDia("breakStartMinuteOfDay", event.target.value)
                                  }
                                />
                                <span aria-hidden="true">–</span>
                                <input
                                  type="time"
                                  step={60}
                                  aria-label={`Fim do intervalo — ${rotulo}`}
                                  disabled={salvandoDia}
                                  value={valorDoHorario(emEdicao.breakEndMinuteOfDay)}
                                  onChange={(event) =>
                                    alterarHorarioDoDia("breakEndMinuteOfDay", event.target.value)
                                  }
                                />
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td data-label="Fim">
                            {emEdicao.enabled ? (
                              <input
                                type="time"
                                step={60}
                                aria-label={`Fim — ${rotulo}`}
                                disabled={salvandoDia}
                                value={valorDoHorario(emEdicao.endMinuteOfDay)}
                                onChange={(event) =>
                                  alterarHorarioDoDia("endMinuteOfDay", event.target.value)
                                }
                              />
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td data-label="Horas úteis" className="is-numeric">
                            <output aria-label={`Horas úteis — ${rotulo}`}>
                              {emEdicao.enabled
                                ? horasUteisDoHorario(emEdicao, problemasDoDia)
                                : "—"}
                            </output>
                          </td>
                          <td className="calendar-cards__actions">
                            <div className="form-actions calendar-week__form-actions">
                              <button
                                type="button"
                                className="btn btn--accent btn--sm"
                                disabled={!podeSalvarDia || salvandoDia}
                                onClick={() => void salvarDia()}
                              >
                                {salvandoDia ? "Salvando…" : "Salvar"}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={salvandoDia}
                                onClick={cancelarEdicao}
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                        {(legadoPendente || problemasDoDia.length > 0 || erroDia) && (
                          <tr className="calendar-week__feedback">
                            <td colSpan={colunasDaSemana}>
                              {legadoPendente && persistido?.unpositionedBreakMinutes != null && (
                                <p className="field__hint">
                                  A configuração gravada tem{" "}
                                  {formatarDuracaoEmMinutos(persistido.unpositionedBreakMinutes)} de
                                  intervalo sem horário. Informe o início e o fim do intervalo, ou
                                  deixe os dois em branco se {rotulo.toLowerCase()} não tem pausa.
                                </p>
                              )}
                              {problemasDoDia.length > 0 && (
                                <ul className="form-alert calendar-problems" role="alert">
                                  {problemasDoDia.map((problema) => (
                                    <li key={problema}>{problema}</li>
                                  ))}
                                </ul>
                              )}
                              {erroDia && (
                                <p className="form-alert" role="alert">
                                  {erroDia}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {avisoDia && (
              <p className="form-status calendar-status" role="status">
                {avisoDia}
              </p>
            )}
          </section>

          <section className="form-section calendar-section" aria-label="Exceções do calendário">
            <h3>Exceções do calendário</h3>
            <p className="form-section__sub">
              Uma regra específica para uma data: o motivo (feriado, recesso, parada) e como a
              fábrica funciona nela — <b>sem operação</b> o dia inteiro, ou em <b>horário
              especial</b>, para menos ou para mais do que a jornada daquele dia. Uma exceção por
              data; para trocar a data, exclua e cadastre de novo.
            </p>

            {canEdit && (
              <div className="calendar-exception-form">
                <div className="field">
                  <label htmlFor="exception-date">Data</label>
                  <input
                    id="exception-date"
                    type="date"
                    value={formExcecao.date}
                    disabled={editandoExcecaoId !== null || salvandoExcecao}
                    onChange={(event) =>
                      setFormExcecao((atual) => ({ ...atual, date: event.target.value }))
                    }
                  />
                  {editandoExcecaoId !== null && (
                    <p className="field__hint">
                      A data não muda: para outro dia, exclua esta e cadastre a nova.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="exception-type">Motivo</label>
                  <select
                    id="exception-type"
                    value={formExcecao.type}
                    disabled={salvandoExcecao}
                    onChange={(event) =>
                      setFormExcecao((atual) => ({
                        ...atual,
                        type: event.target.value as ProductionCalendarExceptionType,
                      }))
                    }
                  >
                    {PRODUCTION_CALENDAR_EXCEPTION_TYPES.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[tipo]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="exception-operation">Funcionamento</label>
                  <select
                    id="exception-operation"
                    value={formExcecao.operation}
                    disabled={salvandoExcecao}
                    onChange={(event) =>
                      setFormExcecao((atual) => ({
                        ...atual,
                        operation: event.target.value as ProductionCalendarExceptionOperation,
                      }))
                    }
                  >
                    {PRODUCTION_CALENDAR_EXCEPTION_OPERATIONS.map((operacao) => (
                      <option key={operacao} value={operacao}>
                        {PRODUCTION_CALENDAR_EXCEPTION_OPERATION_LABELS[operacao]}
                      </option>
                    ))}
                  </select>
                </div>

                {formExcecao.operation === "HORARIO_ESPECIAL" && (
                  <div className="calendar-exception-form__hours">
                    <div className="field">
                      <label htmlFor="exception-start">Início</label>
                      <input
                        id="exception-start"
                        type="time"
                        step={60}
                        disabled={salvandoExcecao}
                        value={valorDoHorario(formExcecao.startMinuteOfDay)}
                        onChange={(event) =>
                          alterarHorarioDaExcecao("startMinuteOfDay", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="exception-end">Fim</label>
                      <input
                        id="exception-end"
                        type="time"
                        step={60}
                        disabled={salvandoExcecao}
                        value={valorDoHorario(formExcecao.endMinuteOfDay)}
                        onChange={(event) =>
                          alterarHorarioDaExcecao("endMinuteOfDay", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="exception-break-start">Intervalo — início</label>
                      <input
                        id="exception-break-start"
                        type="time"
                        step={60}
                        disabled={salvandoExcecao}
                        value={valorDoHorario(formExcecao.breakStartMinuteOfDay)}
                        onChange={(event) =>
                          alterarHorarioDaExcecao("breakStartMinuteOfDay", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="exception-break-end">Intervalo — fim</label>
                      <input
                        id="exception-break-end"
                        type="time"
                        step={60}
                        disabled={salvandoExcecao}
                        value={valorDoHorario(formExcecao.breakEndMinuteOfDay)}
                        onChange={(event) =>
                          alterarHorarioDaExcecao("breakEndMinuteOfDay", event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <span className="calendar-derived__label">Horas úteis na data</span>
                      <output className="calendar-derived__value">
                        {horasUteisDoHorario(funcionamento, problemasDaExcecao)}
                      </output>
                    </div>
                  </div>
                )}

                <div className="field calendar-exception-form__reason">
                  <label htmlFor="exception-reason">Observação</label>
                  <input
                    id="exception-reason"
                    type="text"
                    maxLength={500}
                    placeholder="Ex.: Natal, véspera de Natal, manutenção elétrica"
                    disabled={salvandoExcecao}
                    value={formExcecao.reason}
                    onChange={(event) =>
                      setFormExcecao((atual) => ({ ...atual, reason: event.target.value }))
                    }
                  />
                </div>

                {formExcecao.operation === "HORARIO_ESPECIAL" && problemasDaExcecao.length > 0 && (
                  <ul className="form-alert calendar-problems" role="alert">
                    {problemasDaExcecao.map((problema) => (
                      <li key={problema}>{problema}</li>
                    ))}
                  </ul>
                )}

                <div className="form-actions calendar-exception-form__actions">
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={!formExcecao.date || problemasDaExcecao.length > 0 || salvandoExcecao}
                    onClick={() => void salvarExcecao()}
                  >
                    {salvandoExcecao
                      ? "Salvando…"
                      : editandoExcecaoId
                        ? "Salvar exceção"
                        : "Cadastrar exceção"}
                  </button>
                  {editandoExcecaoId && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={salvandoExcecao}
                      onClick={limparFormularioDeExcecao}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            )}

            {erroExcecao && (
              <p className="form-alert" role="alert">
                {erroExcecao}
              </p>
            )}
            {avisoExcecao && (
              <p className="form-status calendar-status" role="status">
                {avisoExcecao}
              </p>
            )}

            <div className="table-container">
              <table className="table calendar-cards calendar-exceptions">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Motivo</th>
                    <th>Funcionamento</th>
                    <th>Horário</th>
                    <th>Observação</th>
                    {canEdit && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {excecoes.map((excecao) => (
                    <tr key={excecao.id}>
                      <td className="calendar-cards__title">
                        {diaPorExtenso(excecao.date)}
                        <span className="cell-sub">
                          {DIA_DA_SEMANA_LABELS[diaDaSemanaComercial(excecao.date)]}
                        </span>
                      </td>
                      <td data-label="Motivo">
                        <span>{PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[excecao.type]}</span>
                      </td>
                      <td data-label="Funcionamento">
                        <span>{PRODUCTION_CALENDAR_EXCEPTION_OPERATION_LABELS[excecao.operation]}</span>
                      </td>
                      <td data-label="Horário">
                        {excecao.operation === "HORARIO_ESPECIAL" &&
                        excecao.startMinuteOfDay !== null &&
                        excecao.endMinuteOfDay !== null ? (
                          <span>
                            {formatarJanela(excecao.startMinuteOfDay, excecao.endMinuteOfDay)}
                            <span className="cell-sub">
                              {excecao.breakStartMinuteOfDay !== null &&
                              excecao.breakEndMinuteOfDay !== null
                                ? `intervalo ${formatarJanela(excecao.breakStartMinuteOfDay, excecao.breakEndMinuteOfDay)}`
                                : "sem intervalo"}
                              {` · ${formatarDuracaoEmMinutos(excecao.workingMinutes)} úteis`}
                            </span>
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td data-label="Observação" className="calendar-exceptions__reason">
                        <span>{excecao.reason ?? "—"}</span>
                      </td>
                      {canEdit && (
                        <td className="calendar-cards__actions">
                          <div className="calendar-row-actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => editarExcecao(excecao)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => void excluirExcecao(excecao)}
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {excecoes.length === 0 && (
                    <tr>
                      <td colSpan={canEdit ? 6 : 5} className="table__empty">
                        Nenhuma exceção cadastrada de {janela.from.slice(0, 4)} a{" "}
                        {janela.to.slice(0, 4)}. Toda data segue a jornada do seu dia da semana.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
