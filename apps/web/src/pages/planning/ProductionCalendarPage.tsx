import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DiaDaSemana,
  DiasOperantes,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarExceptionType,
} from "@veridi/shared";
import {
  CALENDARIO_PADRAO,
  DIAS_DA_SEMANA,
  DIA_DA_SEMANA_LABELS,
  PRODUCTION_CALENDAR_EXCEPTION_TYPES,
  PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS,
  diaDaSemanaComercial,
  formatarDuracaoEmMinutos,
  formatarMinutoDoDia,
  intervaloPosicionado,
  hojeComercial,
  lerMinutoDoDia,
  minutosUteisPorDia,
  validarConfiguracaoDeCalendario,
} from "@veridi/shared";
import {
  createProductionCalendarException,
  deleteProductionCalendarException,
  getProductionCalendar,
  listProductionCalendarExceptions,
  updateProductionCalendar,
  updateProductionCalendarException,
} from "../../lib/production-calendar-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { useAuth } from "../../app/AuthProvider";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import "./planning.css";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * A jornada da fábrica e os dias em que ela não opera. É UM calendário — o
 * título é singular de propósito, e não há lista para escolher.
 *
 * A tela não agenda Ordem de Produção, não guarda capacidade de recurso e
 * não move promessa de entrega ao cliente. Ela responde duas perguntas:
 * quando a fábrica trabalha, e em que dias não trabalha.
 */

const TIPO_PADRAO: ProductionCalendarExceptionType = "FERIADO";

/** A janela que a lista mostra: do começo do ano corrente a um ano à frente. */
function janelaDaLista(hoje: string): { from: string; to: string } {
  const ano = Number(hoje.slice(0, 4));
  return { from: `${ano}-01-01`, to: `${ano + 1}-12-31` };
}

function mesmaJornada(a: ProductionCalendarDTO | null, b: FormularioDeJornada): boolean {
  if (!a) return false;
  return (
    a.startMinuteOfDay === b.startMinuteOfDay &&
    a.endMinuteOfDay === b.endMinuteOfDay &&
    a.breakMinutes === b.breakMinutes &&
    a.breakStartMinuteOfDay === b.breakStartMinuteOfDay &&
    a.breakEndMinuteOfDay === b.breakEndMinuteOfDay &&
    DIAS_DA_SEMANA.every((dia) => a.weekdays[dia] === b.weekdays[dia])
  );
}

interface FormularioDeJornada {
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  breakMinutes: number;
  breakStartMinuteOfDay: number | null;
  breakEndMinuteOfDay: number | null;
  weekdays: DiasOperantes;
}

function jornadaDoDTO(dto: ProductionCalendarDTO): FormularioDeJornada {
  return {
    startMinuteOfDay: dto.startMinuteOfDay,
    endMinuteOfDay: dto.endMinuteOfDay,
    breakMinutes: dto.breakMinutes,
    breakStartMinuteOfDay: dto.breakStartMinuteOfDay,
    breakEndMinuteOfDay: dto.breakEndMinuteOfDay,
    weekdays: { ...dto.weekdays },
  };
}

export function ProductionCalendarPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const hoje = useMemo(() => hojeComercial(), []);
  const janela = useMemo(() => janelaDaLista(hoje), [hoje]);

  const [calendario, setCalendario] = useState<ProductionCalendarDTO | null>(null);
  const [jornada, setJornada] = useState<FormularioDeJornada>(() => ({
    ...CALENDARIO_PADRAO,
    weekdays: { ...CALENDARIO_PADRAO.weekdays },
  }));
  const [excecoes, setExcecoes] = useState<ProductionCalendarExceptionDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /* Formulário de exceção — `editandoId` é o que separa cadastrar de editar. */
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [novaData, setNovaData] = useState("");
  const [novoTipo, setNovoTipo] = useState<ProductionCalendarExceptionType>(TIPO_PADRAO);
  const [novoMotivo, setNovoMotivo] = useState("");
  const [salvandoExcecao, setSalvandoExcecao] = useState(false);
  const [erroExcecao, setErroExcecao] = useState<string | null>(null);

  const jornadaAlterada = calendario !== null && !mesmaJornada(calendario, jornada);
  // Gênero masculino é o padrão da guarda — "neste calendário de produção".
  useUnsavedChangesGuard({ isDirty: jornadaAlterada, substantivo: "calendário de produção" });

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    Promise.all([getProductionCalendar(), listProductionCalendarExceptions(janela)])
      .then(([config, lista]) => {
        setCalendario(config);
        setJornada(jornadaDoDTO(config));
        setExcecoes(lista.exceptions);
      })
      .catch((err: unknown) => setErro(apiErrorMessage(err, "Falha ao carregar o calendário")))
      .finally(() => setCarregando(false));
  }, [janela]);

  useEffect(() => recarregar(), [recarregar]);

  const problemas = validarConfiguracaoDeCalendario(jornada);
  const minutosUteis = problemas.length === 0 ? minutosUteisPorDia(jornada) : 0;

  function alterarHorario(campo: "startMinuteOfDay" | "endMinuteOfDay", texto: string) {
    const minuto = lerMinutoDoDia(texto);
    if (minuto === null) return;
    setJornada((atual) => ({ ...atual, [campo]: minuto }));
  }

  /*
   * O horário do intervalo MANDA nos minutos dele.
   *
   * Enquanto "60 min" era a única verdade, o dia sabia quanto rendia e não em
   * que momento a linha parava — e por isso nenhuma etapa podia ter horário
   * exato. Com as duas pontas preenchidas, os minutos passam a ser derivados:
   * duas verdades sobre a mesma pausa fariam o rendimento divergir do relógio.
   *
   * Campo em branco devolve a posição para "não configurada", e aí os minutos
   * voltam a ser digitáveis — é assim que se diz "a fábrica não para".
   */
  function alterarIntervalo(campo: "breakStartMinuteOfDay" | "breakEndMinuteOfDay", texto: string) {
    const minuto = texto.trim() === "" ? null : lerMinutoDoDia(texto);
    if (texto.trim() !== "" && minuto === null) return;
    setJornada((atual) => {
      const proxima = { ...atual, [campo]: minuto };
      const de = proxima.breakStartMinuteOfDay;
      const ate = proxima.breakEndMinuteOfDay;
      if (de !== null && ate !== null && ate > de) proxima.breakMinutes = ate - de;
      return proxima;
    });
  }

  function alternarDia(dia: DiaDaSemana) {
    setJornada((atual) => ({
      ...atual,
      weekdays: { ...atual.weekdays, [dia]: !atual.weekdays[dia] },
    }));
  }

  async function salvarJornada() {
    if (problemas.length > 0) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const salvo = await updateProductionCalendar(jornada);
      setCalendario(salvo);
      setJornada(jornadaDoDTO(salvo));
      setAviso("Jornada salva.");
    } catch (err) {
      setErro(apiErrorMessage(err, "Falha ao salvar a jornada"));
    } finally {
      setSalvando(false);
    }
  }

  function limparFormularioDeExcecao() {
    setEditandoId(null);
    setNovaData("");
    setNovoTipo(TIPO_PADRAO);
    setNovoMotivo("");
    setErroExcecao(null);
  }

  function editarExcecao(excecao: ProductionCalendarExceptionDTO) {
    setEditandoId(excecao.id);
    setNovaData(excecao.date);
    setNovoTipo(excecao.type);
    setNovoMotivo(excecao.reason ?? "");
    setErroExcecao(null);
  }

  async function salvarExcecao() {
    if (!novaData) return;
    setSalvandoExcecao(true);
    setErroExcecao(null);
    try {
      if (editandoId) {
        await updateProductionCalendarException(editandoId, {
          type: novoTipo,
          reason: novoMotivo.trim() || null,
        });
      } else {
        await createProductionCalendarException({
          date: novaData,
          type: novoTipo,
          reason: novoMotivo.trim() || null,
        });
      }
      const lista = await listProductionCalendarExceptions(janela);
      setExcecoes(lista.exceptions);
      limparFormularioDeExcecao();
    } catch (err) {
      setErroExcecao(apiErrorMessage(err, "Falha ao salvar a exceção"));
    } finally {
      setSalvandoExcecao(false);
    }
  }

  async function excluirExcecao(excecao: ProductionCalendarExceptionDTO) {
    const rotulo = PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[excecao.type];
    if (
      !window.confirm(
        `Excluir ${rotulo} de ${diaPorExtenso(excecao.date)}? O dia volta a operar pela regra da semana.`,
      )
    ) {
      return;
    }
    setErroExcecao(null);
    try {
      await deleteProductionCalendarException(excecao.id);
      if (editandoId === excecao.id) limparFormularioDeExcecao();
      const lista = await listProductionCalendarExceptions(janela);
      setExcecoes(lista.exceptions);
    } catch (err) {
      setErroExcecao(apiErrorMessage(err, "Falha ao excluir a exceção"));
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Calendário de Produção</h1>
          <p className="page__subtitle">
            Em que dias e em que horário a fábrica opera, e quais datas não operam. É um
            calendário só: mão de obra e equipamento seguem esta mesma jornada. Não define
            capacidade de recurso — isso é do cadastro de Recursos industriais — e não programa
            Ordem de Produção, que é o Planejamento de Produção.
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
            espera por isto.
          </span>
        </p>
      )}

      {carregando && <p className="field__hint">Carregando…</p>}

      {!carregando && (
        <>
          <section className="form-section calendar-section" aria-label="Jornada padrão">
            <h3>Jornada padrão</h3>
            <p className="form-section__sub">
              Horário civil da fábrica, no fuso de São Paulo. O intervalo tem hora de início e de
              fim — é ela que permite dizer que uma etapa começa às 11:40 e termina às 13:20.
              {calendario && !calendario.configured && (
                <>
                  {" "}
                  <b>Ainda não configurado:</b> os valores abaixo são uma sugestão de partida e só
                  valem depois de salvos.
                </>
              )}
            </p>

            <div className="field-grid-2 calendar-journey">
              <div className="field">
                <label htmlFor="calendar-start">Horário inicial</label>
                <input
                  id="calendar-start"
                  type="time"
                  step={60}
                  disabled={!canEdit}
                  value={formatarMinutoDoDia(jornada.startMinuteOfDay)}
                  onChange={(event) => alterarHorario("startMinuteOfDay", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="calendar-end">Horário final</label>
                <input
                  id="calendar-end"
                  type="time"
                  step={60}
                  disabled={!canEdit}
                  value={formatarMinutoDoDia(jornada.endMinuteOfDay)}
                  onChange={(event) => alterarHorario("endMinuteOfDay", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="calendar-break-start">Intervalo — início</label>
                <input
                  id="calendar-break-start"
                  type="time"
                  step={60}
                  disabled={!canEdit}
                  value={
                    jornada.breakStartMinuteOfDay === null
                      ? ""
                      : formatarMinutoDoDia(jornada.breakStartMinuteOfDay)
                  }
                  onChange={(event) => alterarIntervalo("breakStartMinuteOfDay", event.target.value)}
                />
                <p className="field__hint">
                  Em branco: intervalo sem horário — a produção não recebe horas exatas.
                </p>
              </div>
              <div className="field">
                <label htmlFor="calendar-break-end">Intervalo — fim</label>
                <input
                  id="calendar-break-end"
                  type="time"
                  step={60}
                  disabled={!canEdit}
                  value={
                    jornada.breakEndMinuteOfDay === null
                      ? ""
                      : formatarMinutoDoDia(jornada.breakEndMinuteOfDay)
                  }
                  onChange={(event) => alterarIntervalo("breakEndMinuteOfDay", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="calendar-break">Intervalo (minutos)</label>
                <input
                  id="calendar-break"
                  type="number"
                  min={0}
                  step={5}
                  /* Com horário, os minutos são DERIVADOS da diferença. */
                  disabled={!canEdit || intervaloPosicionado(jornada)}
                  value={jornada.breakMinutes}
                  onChange={(event) =>
                    setJornada((atual) => ({
                      ...atual,
                      breakMinutes: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="field">
                <span className="calendar-derived__label">Minutos úteis por dia operante</span>
                <output className="calendar-derived__value" htmlFor="calendar-start calendar-end calendar-break">
                  {problemas.length === 0
                    ? `${minutosUteis} min (${formatarDuracaoEmMinutos(minutosUteis)})`
                    : "—"}
                </output>
              </div>
            </div>

            <h3 className="calendar-subtitle">Dias operantes</h3>
            <p className="form-section__sub">
              Sábado e domingo entram aqui quando a fábrica opera neles — não são exceção, são
              jornada.
            </p>
            <div className="calendar-weekdays">
              {DIAS_DA_SEMANA.map((dia) => (
                <label
                  key={dia}
                  className={`toggle-card${canEdit ? "" : " toggle-card--disabled"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={jornada.weekdays[dia]}
                    onChange={() => alternarDia(dia)}
                  />
                  <b>{DIA_DA_SEMANA_LABELS[dia]}</b>
                </label>
              ))}
            </div>

            {problemas.length > 0 && (
              <ul className="form-alert calendar-problems" role="alert">
                {problemas.map((problema) => (
                  <li key={problema}>{problema}</li>
                ))}
              </ul>
            )}

            {canEdit && (
              <div className="calendar-actions">
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={problemas.length > 0 || salvando || !jornadaAlterada}
                  onClick={() => void salvarJornada()}
                >
                  {salvando ? "Salvando…" : "Salvar jornada"}
                </button>
                {jornadaAlterada && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={salvando}
                    onClick={() => calendario && setJornada(jornadaDoDTO(calendario))}
                  >
                    Descartar alterações
                  </button>
                )}
                {aviso && !jornadaAlterada && (
                  <span className="field__hint" role="status">
                    {aviso}
                  </span>
                )}
              </div>
            )}
          </section>

          <section className="form-section calendar-section" aria-label="Exceções do calendário">
            <h3>Exceções do calendário</h3>
            <p className="form-section__sub">
              Dias inteiros sem operação: feriado, recesso ou parada. Uma exceção por data — a
              data já cadastrada se edita, nunca se duplica. Parada por algumas horas não existe
              nesta fase.
            </p>

            {erroExcecao && (
              <p className="form-alert" role="alert">
                {erroExcecao}
              </p>
            )}

            {canEdit && (
              <div className="calendar-exception-form">
                <div className="field">
                  <label htmlFor="exception-date">Data</label>
                  <input
                    id="exception-date"
                    type="date"
                    value={novaData}
                    disabled={editandoId !== null}
                    onChange={(event) => setNovaData(event.target.value)}
                  />
                  {editandoId !== null && (
                    <p className="field__hint">
                      A data não muda: para outro dia, exclua esta e cadastre a nova.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="exception-type">Tipo</label>
                  <select
                    id="exception-type"
                    value={novoTipo}
                    onChange={(event) =>
                      setNovoTipo(event.target.value as ProductionCalendarExceptionType)
                    }
                  >
                    {PRODUCTION_CALENDAR_EXCEPTION_TYPES.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[tipo]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field calendar-exception-form__reason">
                  <label htmlFor="exception-reason">Motivo</label>
                  <input
                    id="exception-reason"
                    type="text"
                    maxLength={500}
                    placeholder="Ex.: Natal, recesso de fim de ano, manutenção elétrica"
                    value={novoMotivo}
                    onChange={(event) => setNovoMotivo(event.target.value)}
                  />
                </div>
                <div className="calendar-exception-form__actions">
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={!novaData || salvandoExcecao}
                    onClick={() => void salvarExcecao()}
                  >
                    {editandoId ? "Salvar exceção" : "Cadastrar exceção"}
                  </button>
                  {editandoId && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={limparFormularioDeExcecao}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Dia da semana</th>
                    <th>Tipo</th>
                    <th>Motivo</th>
                    {canEdit && <th aria-hidden="true" />}
                  </tr>
                </thead>
                <tbody>
                  {excecoes.map((excecao) => (
                    <tr key={excecao.id}>
                      <td>{diaPorExtenso(excecao.date)}</td>
                      <td>{DIA_DA_SEMANA_LABELS[diaDaSemanaComercial(excecao.date)]}</td>
                      <td>{PRODUCTION_CALENDAR_EXCEPTION_TYPE_LABELS[excecao.type]}</td>
                      <td>{excecao.reason ?? "—"}</td>
                      {canEdit && (
                        <td className="calendar-row-actions">
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
                        </td>
                      )}
                    </tr>
                  ))}
                  {excecoes.length === 0 && (
                    <tr>
                      <td colSpan={canEdit ? 5 : 4} className="table__empty">
                        Nenhuma exceção cadastrada de {janela.from.slice(0, 4)} a{" "}
                        {janela.to.slice(0, 4)}. A fábrica opera em todos os dias da semana
                        marcados acima.
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

/** `2026-12-25` vira `25/12/2026` — data civil, lida em UTC como foi gravada. */
function diaPorExtenso(diaISO: string): string {
  const [ano, mes, dia] = diaISO.split("-");
  return `${dia}/${mes}/${ano}`;
}
