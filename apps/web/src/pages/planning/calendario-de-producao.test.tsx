import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionCalendarDTO, ProductionCalendarExceptionDTO } from "@veridi/shared";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * O que a tela precisa garantir: é UM calendário (título no singular, sem
 * lista); a hora aparece como `HH:mm` e viaja como minuto do dia; os minutos
 * úteis são derivados na frente de quem edita; configuração inválida não
 * chega a ser enviada; e a exceção é uma por data, com editar e excluir na
 * própria lista.
 */

const getProductionCalendar = vi.fn();
const updateProductionCalendar = vi.fn();
const listProductionCalendarExceptions = vi.fn();
const createProductionCalendarException = vi.fn();
const updateProductionCalendarException = vi.fn();
const deleteProductionCalendarException = vi.fn();

vi.mock("../../lib/production-calendar-api", () => ({
  getProductionCalendar: (...a: unknown[]) => getProductionCalendar(...a),
  updateProductionCalendar: (...a: unknown[]) => updateProductionCalendar(...a),
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

const CONFIGURADO: ProductionCalendarDTO = {
  configured: true,
  startMinuteOfDay: 480,
  endMinuteOfDay: 1020,
  breakMinutes: 60,
  weekdays: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
  workingMinutesPerDay: 480,
  updatedAt: "2026-09-12T12:00:00.000Z",
  updatedBy: "Admin",
};

const NATAL: ProductionCalendarExceptionDTO = {
  id: "exc-1",
  date: "2026-12-25",
  type: "FERIADO",
  reason: "Natal",
  createdAt: "2026-09-12T12:00:00.000Z",
  createdBy: "Admin",
  updatedAt: "2026-09-12T12:00:00.000Z",
  updatedBy: "Admin",
};

function montar() {
  return render(
    <MemoryRouter>
      <ProductionCalendarPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  perfil = "ADMIN";
  getProductionCalendar.mockResolvedValue({ ...CONFIGURADO });
  listProductionCalendarExceptions.mockResolvedValue({ exceptions: [{ ...NATAL }] });
  updateProductionCalendar.mockImplementation((entrada: ProductionCalendarDTO) =>
    Promise.resolve({ ...CONFIGURADO, ...entrada, configured: true }),
  );
  createProductionCalendarException.mockResolvedValue({ ...NATAL, id: "exc-2" });
  updateProductionCalendarException.mockResolvedValue({ ...NATAL });
  deleteProductionCalendarException.mockResolvedValue(undefined);
});

describe("jornada padrão", () => {
  it("o calendário é um só: título no singular, sem lista para escolher", async () => {
    montar();
    expect(
      await screen.findByRole("heading", { name: "Calendário de Produção", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /novo calendário/i })).not.toBeInTheDocument();
  });

  it("a hora aparece como HH:mm, e o minuto do dia é o que viaja", async () => {
    montar();
    const inicio = await screen.findByLabelText("Horário inicial");
    expect(inicio).toHaveValue("08:00");
    expect(screen.getByLabelText("Horário final")).toHaveValue("17:00");
    expect(screen.getByLabelText("Intervalo (minutos)")).toHaveValue(60);

    fireEvent.change(inicio, { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar jornada" }));

    await waitFor(() => expect(updateProductionCalendar).toHaveBeenCalledTimes(1));
    expect(updateProductionCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ startMinuteOfDay: 450, endMinuteOfDay: 1020, breakMinutes: 60 }),
    );
  });

  it("os minutos úteis são derivados na tela, antes de salvar", async () => {
    montar();
    await screen.findByLabelText("Horário inicial");
    expect(screen.getByText("480 min (8 h)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Intervalo (minutos)"), { target: { value: "30" } });
    expect(await screen.findByText("510 min (8 h 30 min)")).toBeInTheDocument();
  });

  it("sábado e domingo chegam desmarcados e são jornada, não exceção", async () => {
    montar();
    expect(await screen.findByRole("checkbox", { name: "Segunda-feira" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sábado" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Domingo" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Sábado" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar jornada" }));
    await waitFor(() => expect(updateProductionCalendar).toHaveBeenCalled());
    expect(updateProductionCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ weekdays: expect.objectContaining({ saturday: true }) }),
    );
  });

  it("configuração inválida avisa e não chega a ser enviada", async () => {
    montar();
    await screen.findByLabelText("Horário final");
    fireEvent.change(screen.getByLabelText("Horário final"), { target: { value: "07:00" } });

    expect(
      await screen.findByText("O horário final tem de ser depois do inicial."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar jornada" })).toBeDisabled();
    expect(updateProductionCalendar).not.toHaveBeenCalled();
  });

  it("intervalo maior que a jornada é recusado antes do envio", async () => {
    montar();
    await screen.findByLabelText("Intervalo (minutos)");
    fireEvent.change(screen.getByLabelText("Intervalo (minutos)"), { target: { value: "600" } });

    expect(await screen.findByText("O intervalo tem de caber dentro da jornada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar jornada" })).toBeDisabled();
  });

  it("nenhum dia operante é recusado antes do envio", async () => {
    montar();
    await screen.findByRole("checkbox", { name: "Segunda-feira" });
    for (const dia of [
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: dia }));
    }
    expect(await screen.findByText("Selecione ao menos um dia operante.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar jornada" })).toBeDisabled();
  });

  it("sem alteração não há o que salvar", async () => {
    montar();
    await screen.findByLabelText("Horário inicial");
    expect(screen.getByRole("button", { name: "Salvar jornada" })).toBeDisabled();
  });

  it("ainda não configurado: a tela diz que o valor é sugestão", async () => {
    getProductionCalendar.mockResolvedValue({ ...CONFIGURADO, configured: false, updatedBy: null });
    montar();
    expect(await screen.findByText("Ainda não configurado:")).toBeInTheDocument();
  });
});

describe("exceções do calendário", () => {
  it("a lista mostra data, dia da semana, tipo e motivo", async () => {
    montar();
    const linha = (await screen.findByText("25/12/2026")).closest("tr")!;
    expect(within(linha).getByText("Sexta-feira")).toBeInTheDocument();
    expect(within(linha).getByText("Feriado")).toBeInTheDocument();
    expect(within(linha).getByText("Natal")).toBeInTheDocument();
  });

  it("cadastra uma exceção e recarrega a lista", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Data"), { target: { value: "2026-12-24" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "RECESSO" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Véspera" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar exceção" }));

    await waitFor(() => expect(createProductionCalendarException).toHaveBeenCalledTimes(1));
    expect(createProductionCalendarException).toHaveBeenCalledWith({
      date: "2026-12-24",
      type: "RECESSO",
      reason: "Véspera",
    });
    expect(listProductionCalendarExceptions).toHaveBeenCalledTimes(2);
  });

  it("editar troca tipo e motivo, e a data fica travada", async () => {
    montar();
    const linha = (await screen.findByText("25/12/2026")).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText("Data")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toHaveValue("Natal");

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "PARADA_OPERACIONAL" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exceção" }));

    await waitFor(() => expect(updateProductionCalendarException).toHaveBeenCalledTimes(1));
    expect(updateProductionCalendarException).toHaveBeenCalledWith("exc-1", {
      type: "PARADA_OPERACIONAL",
      reason: "Natal",
    });
    expect(createProductionCalendarException).not.toHaveBeenCalled();
  });

  it("excluir pede confirmação e recarrega", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    montar();
    const linha = (await screen.findByText("25/12/2026")).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteProductionCalendarException).toHaveBeenCalledWith("exc-1"));
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

    expect(await screen.findByText(/já está cadastrado como Feriado/)).toBeInTheDocument();
  });

  it("lista vazia explica o que isso significa", async () => {
    listProductionCalendarExceptions.mockResolvedValue({ exceptions: [] });
    montar();
    expect(await screen.findByText(/Nenhuma exceção cadastrada/)).toBeInTheDocument();
  });
});

describe("permissão de leitura", () => {
  it("VIEWER lê a jornada e as exceções, e não vê nenhuma ação de escrita", async () => {
    perfil = "VIEWER";
    montar();
    expect(await screen.findByLabelText("Horário inicial")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Segunda-feira" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar jornada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar exceção" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(screen.getByText("25/12/2026")).toBeInTheDocument();
  });
});
