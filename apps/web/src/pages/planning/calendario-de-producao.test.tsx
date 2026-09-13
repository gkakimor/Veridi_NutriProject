import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  DiaDaSemana,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarWeekdayDTO,
} from "@veridi/shared";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01 e
 * PLANNING-CALENDAR-WEEKLY-SCHEDULE-01).
 *
 * O que a tela precisa garantir: é UM calendário; a jornada são sete linhas, e
 * se edita UMA por vez — salvar a sexta envia só a sexta; cancelar devolve o
 * que está gravado; a confirmação só aparece depois da resposta da API; e a
 * exceção tem motivo E funcionamento, com o horário aparecendo só quando o
 * funcionamento é horário especial.
 */

const getProductionCalendar = vi.fn();
const updateProductionCalendarWeekday = vi.fn();
const listProductionCalendarExceptions = vi.fn();
const createProductionCalendarException = vi.fn();
const updateProductionCalendarException = vi.fn();
const deleteProductionCalendarException = vi.fn();

vi.mock("../../lib/production-calendar-api", () => ({
  getProductionCalendar: (...a: unknown[]) => getProductionCalendar(...a),
  updateProductionCalendarWeekday: (...a: unknown[]) => updateProductionCalendarWeekday(...a),
  listProductionCalendarExceptions: (...a: unknown[]) => listProductionCalendarExceptions(...a),
  createProductionCalendarException: (...a: unknown[]) => createProductionCalendarException(...a),
  updateProductionCalendarException: (...a: unknown[]) => updateProductionCalendarException(...a),
  deleteProductionCalendarException: (...a: unknown[]) => deleteProductionCalendarException(...a),
}));

let perfil = "ADMIN";
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: perfil } }),
}));

const { ProductionCalendarPage } = await import("./ProductionCalendarPage");

function dia(
  weekday: DiaDaSemana,
  horario: [number, number] | null,
  pausa: [number, number] | null = null,
  workingMinutes = 0,
): ProductionCalendarWeekdayDTO {
  return {
    weekday,
    enabled: horario !== null,
    startMinuteOfDay: horario ? horario[0] : null,
    endMinuteOfDay: horario ? horario[1] : null,
    breakStartMinuteOfDay: pausa ? pausa[0] : null,
    breakEndMinuteOfDay: pausa ? pausa[1] : null,
    unpositionedBreakMinutes: null,
    workingMinutes,
    updatedAt: "2026-09-12T12:00:00.000Z",
    updatedBy: "Admin",
  };
}

/** A semana da Veridi: seg–qui 08–17 com almoço, sex e sáb 08–12, domingo fechado. */
const SEMANA: ProductionCalendarDTO = {
  configured: true,
  weekdays: [
    dia("MONDAY", [480, 1020], [720, 780], 480),
    dia("TUESDAY", [480, 1020], [720, 780], 480),
    dia("WEDNESDAY", [480, 1020], [720, 780], 480),
    dia("THURSDAY", [480, 1020], [720, 780], 480),
    dia("FRIDAY", [480, 720], null, 240),
    dia("SATURDAY", [480, 720], null, 240),
    dia("SUNDAY", null),
  ],
  breakPositionWarning: null,
  updatedAt: "2026-09-12T12:00:00.000Z",
  updatedBy: "Admin",
};

const NATAL: ProductionCalendarExceptionDTO = {
  id: "exc-1",
  date: "2026-12-25",
  type: "FERIADO",
  reason: "Natal",
  operation: "SEM_OPERACAO",
  startMinuteOfDay: null,
  endMinuteOfDay: null,
  breakStartMinuteOfDay: null,
  breakEndMinuteOfDay: null,
  workingMinutes: 0,
  createdAt: "2026-09-12T12:00:00.000Z",
  createdBy: "Admin",
  updatedAt: "2026-09-12T12:00:00.000Z",
  updatedBy: "Admin",
};

const VESPERA: ProductionCalendarExceptionDTO = {
  ...NATAL,
  id: "exc-2",
  date: "2026-12-24",
  reason: "Véspera de Natal",
  operation: "HORARIO_ESPECIAL",
  startMinuteOfDay: 480,
  endMinuteOfDay: 720,
  workingMinutes: 240,
};

function montar() {
  return render(
    <MemoryRouter>
      <ProductionCalendarPage />
    </MemoryRouter>,
  );
}

/** Com a guarda de alterações não salvas do ERP — precisa de router de dados. */
function montarComGuarda() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route path="/planejamento/calendario" element={<ProductionCalendarPage />} />
      </Route>,
    ),
    { initialEntries: ["/planejamento/calendario"] },
  );
  return render(<RouterProvider router={router} />);
}

const linhaDo = async (rotulo: string) => (await screen.findByText(rotulo, { selector: "td" })).closest("tr")!;

async function editar(rotulo: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Editar ${rotulo}` }));
}

function comDia(weekday: DiaDaSemana, novo: ProductionCalendarWeekdayDTO): ProductionCalendarDTO {
  return {
    ...SEMANA,
    weekdays: SEMANA.weekdays.map((linha) => (linha.weekday === weekday ? novo : linha)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  perfil = "ADMIN";
  getProductionCalendar.mockResolvedValue(structuredClone(SEMANA));
  listProductionCalendarExceptions.mockResolvedValue({
    exceptions: [structuredClone(VESPERA), structuredClone(NATAL)],
  });
  updateProductionCalendarWeekday.mockImplementation(
    (weekday: DiaDaSemana, entrada: Omit<ProductionCalendarWeekdayDTO, "weekday">) =>
      Promise.resolve(
        comDia(weekday, { ...dia(weekday, null), ...entrada, weekday, workingMinutes: 180 }),
      ),
  );
  createProductionCalendarException.mockResolvedValue({ ...NATAL, id: "exc-3" });
  updateProductionCalendarException.mockResolvedValue({ ...NATAL });
  deleteProductionCalendarException.mockResolvedValue(undefined);
});

describe("jornada semanal — sete linhas", () => {
  it("o calendário é um só, e os sete dias aparecem com a jornada de cada um", async () => {
    montar();
    expect(
      await screen.findByRole("heading", { name: "Calendário de Produção", level: 1 }),
    ).toBeInTheDocument();
    for (const rotulo of [
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
      "Domingo",
    ]) {
      expect(await linhaDo(rotulo)).toBeInTheDocument();
    }

    const segunda = within(await linhaDo("Segunda-feira"));
    expect(segunda.getByText("Sim")).toBeInTheDocument();
    expect(segunda.getByText("08:00")).toBeInTheDocument();
    expect(segunda.getByText("12:00–13:00")).toBeInTheDocument();
    expect(segunda.getByText("17:00")).toBeInTheDocument();
    expect(segunda.getByText("8 h")).toBeInTheDocument();

    const sexta = within(await linhaDo("Sexta-feira"));
    expect(sexta.getByText("12:00")).toBeInTheDocument();
    expect(sexta.getByText("4 h")).toBeInTheDocument();
  });

  it("dia que não opera aparece como tal, sem horário nenhum", async () => {
    montar();
    const domingo = within(await linhaDo("Domingo"));
    expect(domingo.getByText("Não")).toBeInTheDocument();
    expect(domingo.getAllByText("—")).toHaveLength(4);
  });

  it("em leitura não há campo editável; Editar abre os campos SÓ daquela linha", async () => {
    montar();
    await linhaDo("Sexta-feira");
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);

    await editar("Sexta-feira");
    const sexta = await linhaDo("Sexta-feira");
    expect(within(sexta).getByLabelText("Início — Sexta-feira")).toHaveValue("08:00");
    expect(within(sexta).getByLabelText("Fim — Sexta-feira")).toHaveValue("12:00");
    expect(within(sexta).getByLabelText("Início do intervalo — Sexta-feira")).toHaveValue("");
    expect(screen.queryByLabelText("Início — Segunda-feira")).not.toBeInTheDocument();
    expect(within(await linhaDo("Segunda-feira")).getByText("08:00")).toBeInTheDocument();
  });

  it("salvar envia UMA linha — o dia e o horário dele — e confirma com o nome do dia", async () => {
    montar();
    await editar("Sexta-feira");
    fireEvent.change(screen.getByLabelText("Fim — Sexta-feira"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateProductionCalendarWeekday).toHaveBeenCalledTimes(1));
    expect(updateProductionCalendarWeekday).toHaveBeenCalledWith("FRIDAY", {
      enabled: true,
      startMinuteOfDay: 480,
      endMinuteOfDay: 660,
      breakStartMinuteOfDay: null,
      breakEndMinuteOfDay: null,
    });
    expect(await screen.findByText("Sexta-feira salva.")).toHaveAttribute("role", "status");
    // A linha volta à leitura com o que o servidor devolveu.
    expect(within(await linhaDo("Sexta-feira")).getByText("11:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fim — Sexta-feira")).not.toBeInTheDocument();
  });

  it("sábado e domingo confirmam no masculino", async () => {
    montar();
    await editar("Sábado");
    fireEvent.change(screen.getByLabelText("Fim — Sábado"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Sábado salvo.")).toHaveAttribute("role", "status");
  });

  it("horas úteis são derivadas enquanto se digita, antes de salvar", async () => {
    montar();
    await editar("Segunda-feira");
    const horas = screen.getByLabelText("Horas úteis — Segunda-feira");
    expect(horas).toHaveTextContent("8 h");
    fireEvent.change(screen.getByLabelText("Fim do intervalo — Segunda-feira"), {
      target: { value: "12:30" },
    });
    expect(horas).toHaveTextContent("8 h 30 min");
    expect(updateProductionCalendarWeekday).not.toHaveBeenCalled();
  });

  it("Salvando… enquanto a API responde; a confirmação só vem com a resposta", async () => {
    let responder!: (valor: ProductionCalendarDTO) => void;
    updateProductionCalendarWeekday.mockImplementation(
      () => new Promise<ProductionCalendarDTO>((resolve) => (responder = resolve)),
    );
    montar();
    await editar("Sexta-feira");
    fireEvent.change(screen.getByLabelText("Fim — Sexta-feira"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.queryByText("Sexta-feira salva.")).not.toBeInTheDocument();

    await act(async () => responder(comDia("FRIDAY", dia("FRIDAY", [480, 660], null, 180))));
    expect(await screen.findByText("Sexta-feira salva.")).toBeInTheDocument();
  });

  it("recusa da API aparece como alerta, a linha continua em edição e nada vira sucesso", async () => {
    updateProductionCalendarWeekday.mockRejectedValue(
      new Error("Ao menos um dia da semana precisa operar."),
    );
    montar();
    await editar("Sábado");
    fireEvent.click(screen.getByRole("checkbox", { name: "Sábado opera" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ao menos um dia da semana precisa operar.");
    expect(screen.queryByText("Sábado salvo.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sábado opera" })).not.toBeChecked();
  });

  it("cancelar devolve a linha ao que está gravado, sem tocar nas outras", async () => {
    montar();
    await editar("Sexta-feira");
    fireEvent.change(screen.getByLabelText("Fim — Sexta-feira"), { target: { value: "16:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    const sexta = within(await linhaDo("Sexta-feira"));
    expect(sexta.getByText("12:00")).toBeInTheDocument();
    expect(sexta.queryByText("16:00")).not.toBeInTheDocument();
    expect(within(await linhaDo("Quinta-feira")).getByText("17:00")).toBeInTheDocument();
    expect(updateProductionCalendarWeekday).not.toHaveBeenCalled();

    // E editar de novo começa do gravado, não do rascunho descartado.
    await editar("Sexta-feira");
    expect(screen.getByLabelText("Fim — Sexta-feira")).toHaveValue("12:00");
  });

  it("sem alteração não há o que salvar", async () => {
    montar();
    await editar("Quinta-feira");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("desmarcar 'opera' esconde o horário e envia o dia sem horário", async () => {
    montar();
    await editar("Sábado");
    fireEvent.click(screen.getByRole("checkbox", { name: "Sábado opera" }));
    expect(screen.queryByLabelText("Início — Sábado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateProductionCalendarWeekday).toHaveBeenCalledWith("SATURDAY", {
        enabled: false,
        startMinuteOfDay: null,
        endMinuteOfDay: null,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
      }),
    );
  });

  it("ativar um dia fechado mostra os campos, já preenchidos à vista", async () => {
    montar();
    await editar("Domingo");
    expect(screen.queryByLabelText("Início — Domingo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Domingo opera" }));

    expect(screen.getByLabelText("Início — Domingo")).toHaveValue("08:00");
    expect(screen.getByLabelText("Fim — Domingo")).toHaveValue("17:00");
    fireEvent.change(screen.getByLabelText("Fim — Domingo"), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateProductionCalendarWeekday).toHaveBeenCalledWith("SUNDAY", {
        enabled: true,
        startMinuteOfDay: 480,
        endMinuteOfDay: 720,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
      }),
    );
  });

  it("linha inválida avisa e não chega a ser enviada", async () => {
    montar();
    await editar("Segunda-feira");
    fireEvent.change(screen.getByLabelText("Fim — Segunda-feira"), { target: { value: "07:00" } });
    expect(await screen.findByText("O horário final tem de ser depois do inicial.")).toBeInTheDocument();
    expect(screen.getByLabelText("Horas úteis — Segunda-feira")).toHaveTextContent("—");

    fireEvent.change(screen.getByLabelText("Fim — Segunda-feira"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText("Fim do intervalo — Segunda-feira"), {
      target: { value: "" },
    });
    expect(
      await screen.findByText("O intervalo precisa de início E fim, ou de nenhum dos dois."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(updateProductionCalendarWeekday).not.toHaveBeenCalled();
  });

  it("intervalo legado sem horário aparece como pendência e se salva mesmo sem mudar nada", async () => {
    getProductionCalendar.mockResolvedValue(
      {
        ...comDia("TUESDAY", { ...dia("TUESDAY", [480, 1020], null, 480), unpositionedBreakMinutes: 60 }),
        breakPositionWarning:
          "Defina o horário do intervalo de Terça-feira antes de calcular horários de produção.",
      },
    );
    montar();
    expect(
      await screen.findByText(
        "Defina o horário do intervalo de Terça-feira antes de calcular horários de produção.",
      ),
    ).toBeInTheDocument();
    expect(within(await linhaDo("Terça-feira")).getByText("1 h sem horário")).toBeInTheDocument();

    await editar("Terça-feira");
    expect(screen.getByText(/1 h de intervalo sem horário/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("ainda não configurado: a tela diz que a semana é sugestão", async () => {
    getProductionCalendar.mockResolvedValue({ ...structuredClone(SEMANA), configured: false });
    montar();
    expect(await screen.findByText("Ainda não configurado:")).toBeInTheDocument();
  });

  it("390px: cada valor da linha leva o seu rótulo, para virar cartão sem rolagem lateral", async () => {
    montar();
    const sexta = await linhaDo("Sexta-feira");
    expect(sexta.closest("table")).toHaveClass("calendar-cards");
    const rotulos = Array.from(sexta.querySelectorAll("td[data-label]")).map((td) =>
      td.getAttribute("data-label"),
    );
    expect(rotulos).toEqual(["Opera", "Início", "Intervalo", "Fim", "Horas úteis"]);

    await editar("Sexta-feira");
    const emEdicao = await linhaDo("Sexta-feira");
    expect(
      Array.from(emEdicao.querySelectorAll("td[data-label]")).map((td) => td.getAttribute("data-label")),
    ).toEqual(["Opera", "Início", "Intervalo", "Fim", "Horas úteis"]);
  });
});

describe("uma linha em edição por vez", () => {
  it("sem alteração, editar outro dia troca a linha direto", async () => {
    montarComGuarda();
    await editar("Sexta-feira");
    await editar("Segunda-feira");
    expect(screen.queryByText("Sair sem salvar?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Início — Segunda-feira")).toBeInTheDocument();
    expect(screen.queryByLabelText("Início — Sexta-feira")).not.toBeInTheDocument();
  });

  it("com a sexta alterada, editar a segunda pergunta — e só troca em Sair sem salvar", async () => {
    montarComGuarda();
    await editar("Sexta-feira");
    fireEvent.change(screen.getByLabelText("Fim — Sexta-feira"), { target: { value: "11:00" } });
    await editar("Segunda-feira");

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta jornada de Sexta-feira/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByLabelText("Fim — Sexta-feira")).toHaveValue("11:00");
    expect(screen.queryByLabelText("Início — Segunda-feira")).not.toBeInTheDocument();

    await editar("Segunda-feira");
    fireEvent.click(await screen.findByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByLabelText("Início — Segunda-feira")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fim — Sexta-feira")).not.toBeInTheDocument();
    expect(within(await linhaDo("Sexta-feira")).getByText("12:00")).toBeInTheDocument();
    expect(updateProductionCalendarWeekday).not.toHaveBeenCalled();
  });
});

describe("exceções — motivo e funcionamento", () => {
  it("a lista mostra data, motivo, funcionamento, horário e observação", async () => {
    montar();
    const natal = (await screen.findByText("25/12/2026")).closest("tr")!;
    expect(within(natal).getByText("Sexta-feira")).toBeInTheDocument();
    expect(within(natal).getByText("Feriado")).toBeInTheDocument();
    expect(within(natal).getByText("Sem operação")).toBeInTheDocument();
    expect(within(natal).getByText("Natal")).toBeInTheDocument();

    const vespera = (await screen.findByText("24/12/2026")).closest("tr")!;
    expect(within(vespera).getByText("Horário especial")).toBeInTheDocument();
    expect(within(vespera).getByText("08:00–12:00")).toBeInTheDocument();
    expect(within(vespera).getByText(/sem intervalo · 4 h úteis/)).toBeInTheDocument();
    expect(within(vespera).getByText("Véspera de Natal")).toBeInTheDocument();
  });

  it("sem operação é o padrão, e o horário nem aparece", async () => {
    montar();
    expect(await screen.findByLabelText("Funcionamento")).toHaveValue("SEM_OPERACAO");
    expect(screen.queryByLabelText("Início")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Intervalo — início")).not.toBeInTheDocument();
  });

  it("cadastra feriado sem operação: horários vão nulos, e a confirmação cita a data", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "Finados" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));

    await waitFor(() => expect(createProductionCalendarException).toHaveBeenCalledTimes(1));
    expect(createProductionCalendarException).toHaveBeenCalledWith({
      date: "2026-11-02",
      type: "FERIADO",
      reason: "Finados",
      operation: "SEM_OPERACAO",
      startMinuteOfDay: null,
      endMinuteOfDay: null,
      breakStartMinuteOfDay: null,
      breakEndMinuteOfDay: null,
    });
    expect(await screen.findByText("Exceção de 02/11/2026 cadastrada.")).toBeInTheDocument();
    expect(listProductionCalendarExceptions).toHaveBeenCalledTimes(2);
  });

  it("horário especial mostra início, fim e intervalo, e envia o horário da data", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Funcionamento"), {
      target: { value: "HORARIO_ESPECIAL" },
    });

    expect(screen.getByLabelText("Início")).toBeInTheDocument();
    expect(screen.getByLabelText("Fim")).toBeInTheDocument();
    expect(screen.getByLabelText("Intervalo — início")).toBeInTheDocument();
    expect(screen.getByLabelText("Intervalo — fim")).toBeInTheDocument();
    // Sem horário, o cadastro não sai.
    expect(screen.getByText("Informe o horário inicial e o final.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar exceção" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "12:00" } });
    expect(within(screen.getByText("Horas úteis na data").parentElement!).getByText("4 h")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));

    await waitFor(() =>
      expect(createProductionCalendarException).toHaveBeenCalledWith({
        date: "2026-12-31",
        type: "FERIADO",
        reason: null,
        operation: "HORARIO_ESPECIAL",
        startMinuteOfDay: 480,
        endMinuteOfDay: 720,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
      }),
    );
  });

  it("voltar para sem operação esconde o horário e não o envia", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Funcionamento"), {
      target: { value: "HORARIO_ESPECIAL" },
    });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Funcionamento"), { target: { value: "SEM_OPERACAO" } });

    expect(screen.queryByLabelText("Início")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));
    await waitFor(() =>
      expect(createProductionCalendarException).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "SEM_OPERACAO", startMinuteOfDay: null }),
      ),
    );
  });

  it("editar traz motivo e funcionamento, trava a data e envia o funcionamento inteiro", async () => {
    montar();
    const vespera = (await screen.findByText("24/12/2026")).closest("tr")!;
    fireEvent.click(within(vespera).getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText("Data")).toBeDisabled();
    expect(screen.getByLabelText("Funcionamento")).toHaveValue("HORARIO_ESPECIAL");
    expect(screen.getByLabelText("Início")).toHaveValue("08:00");
    expect(screen.getByLabelText("Observação")).toHaveValue("Véspera de Natal");

    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "OUTRO" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exceção" }));

    await waitFor(() => expect(updateProductionCalendarException).toHaveBeenCalledTimes(1));
    expect(updateProductionCalendarException).toHaveBeenCalledWith("exc-2", {
      type: "OUTRO",
      reason: "Véspera de Natal",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 780,
      breakStartMinuteOfDay: null,
      breakEndMinuteOfDay: null,
    });
    expect(createProductionCalendarException).not.toHaveBeenCalled();
    expect(await screen.findByText("Exceção de 24/12/2026 salva.")).toBeInTheDocument();
  });

  it("Salvando… no botão da exceção enquanto a API responde", async () => {
    let responder!: (valor: ProductionCalendarExceptionDTO) => void;
    createProductionCalendarException.mockImplementation(
      () => new Promise<ProductionCalendarExceptionDTO>((resolve) => (responder = resolve)),
    );
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByText("Exceção de 02/11/2026 cadastrada.")).not.toBeInTheDocument();
    await act(async () => responder({ ...NATAL, id: "exc-9", date: "2026-11-02" }));
    expect(await screen.findByText("Exceção de 02/11/2026 cadastrada.")).toBeInTheDocument();
  });

  it("excluir pede confirmação e recarrega", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    montar();
    const linha = (await screen.findByText("25/12/2026")).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteProductionCalendarException).toHaveBeenCalledWith("exc-1"));
    expect(confirmar).toHaveBeenCalledWith(
      "Excluir a exceção de 25/12/2026? A data volta a seguir a jornada de Sexta-feira.",
    );
    expect(await screen.findByText("Exceção de 25/12/2026 excluída.")).toBeInTheDocument();
    confirmar.mockRestore();
  });

  it("cancelar a confirmação não exclui nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    const linha = (await screen.findByText("25/12/2026")).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteProductionCalendarException).not.toHaveBeenCalled());
    confirmar.mockRestore();
  });

  it("data já cadastrada: a recusa do servidor aparece, sem sobrescrever", async () => {
    createProductionCalendarException.mockRejectedValue(
      new Error("O dia 2026-12-25 já está cadastrado como Feriado."),
    );
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-12-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/já está cadastrado como Feriado/);
    expect(screen.queryByText(/cadastrada\./)).not.toBeInTheDocument();
  });

  it("lista vazia explica o que isso significa", async () => {
    listProductionCalendarExceptions.mockResolvedValue({ exceptions: [] });
    montar();
    expect(await screen.findByText(/Nenhuma exceção cadastrada/)).toBeInTheDocument();
  });
});

describe("permissão de leitura", () => {
  it("VIEWER lê a semana e as exceções, e não vê nenhuma ação de escrita", async () => {
    perfil = "VIEWER";
    montar();
    expect(await linhaDo("Segunda-feira")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar exceção" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(screen.getByText("25/12/2026")).toBeInTheDocument();
  });
});
