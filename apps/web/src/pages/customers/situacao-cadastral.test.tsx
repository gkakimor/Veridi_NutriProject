import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Situação cadastral na lista de Clientes — CUSTOMER-STATUS-LIFECYCLE-01, §95.
 *
 * A lista abre em "Ativos": bloqueado e inativo ficam arquivados fora da
 * abertura. As ações de cada linha seguem a situação dela, e nenhuma acontece
 * sem motivo — o botão de confirmar não liga enquanto o campo está vazio.
 */

vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(),
  changeCustomerStatus: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

import { changeCustomerStatus, listCustomers } from "../../lib/customers-api";
import { CustomersPage } from "./CustomersPage";

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000001",
    legalName: "IGEIA Suplementos LTDA",
    tradeName: "IGEIA",
    cnpj: null,
    email: null,
    phone: null,
    taxProfile: "NOT_INFORMED",
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: "São Paulo",
    state: "SP",
    notes: null,
    businessLotSuffix: null,
    active: true,
    blocked: false,
    status: "ACTIVE",
    block: null,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: null,
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: null,
    ...overrides,
  };
}

const ATIVO = cliente();
const BLOQUEADO = cliente({
  id: "cli-2",
  code: "CLI-000002",
  legalName: "Vida Saudável LTDA",
  tradeName: null,
  blocked: true,
  status: "BLOCKED",
  block: {
    reason: "Inadimplência desde março",
    blockedAt: "2026-09-01T12:00:00.000Z",
    blockedByName: "Ana",
  },
});
/** Arquivado com bloqueio latente: reativar devolve o BLOQUEADO, não o ATIVO. */
const INATIVO_QUE_ESTAVA_BLOQUEADO = cliente({
  id: "cli-3",
  code: "CLI-000003",
  legalName: "Nutri Forte LTDA",
  tradeName: null,
  active: false,
  blocked: true,
  status: "INACTIVE",
  block: {
    reason: "Inadimplência desde março",
    blockedAt: "2026-09-01T12:00:00.000Z",
    blockedByName: "Ana",
  },
});

function abrir() {
  render(
    <MemoryRouter initialEntries={["/cadastros/clientes"]}>
      <CustomersPage />
    </MemoryRouter>,
  );
}

const ultimaConsulta = () => vi.mocked(listCustomers).mock.lastCall?.[0] ?? {};
const filtro = () => screen.getByLabelText("Filtrar por situação cadastral") as HTMLSelectElement;
const menuDaLinha = (code: string) => screen.getByLabelText(`Mais ações de ${code}`);

beforeEach(() => {
  vi.mocked(listCustomers).mockReset();
  vi.mocked(changeCustomerStatus).mockReset();
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [ATIVO, BLOQUEADO, INATIVO_QUE_ESTAVA_BLOQUEADO],
    page: 1,
    pageSize: 20,
    total: 3,
  });
  vi.mocked(changeCustomerStatus).mockResolvedValue(BLOQUEADO);
});

describe("CUSTOMER-STATUS-LIFECYCLE-01 — lista de Clientes", () => {
  it("abre em Ativos e pede essa situação ao servidor", async () => {
    abrir();
    await screen.findByText("CLI-000001");
    expect(filtro().value).toBe("ACTIVE");
    expect(ultimaConsulta().status).toEqual(["ACTIVE"]);
  });

  it("Bloqueados, Inativos e Todos pedem cada um o seu recorte", async () => {
    abrir();
    await screen.findByText("CLI-000001");

    fireEvent.change(filtro(), { target: { value: "BLOCKED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["BLOCKED"]));
    fireEvent.change(filtro(), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["INACTIVE"]));
    fireEvent.change(filtro(), { target: { value: "ALL" } });
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
  });

  it("a situação de cada linha aparece com o motivo do bloqueio no rótulo", async () => {
    abrir();
    const bloqueada = (await screen.findByText("CLI-000002")).closest("tr")!;
    expect(within(bloqueada).getByText("Bloqueado")).toHaveAttribute(
      "title",
      "Motivo: Inadimplência desde março",
    );

    const inativa = screen.getByText("CLI-000003").closest("tr")!;
    expect(within(inativa).getByText("Inativo")).toBeInTheDocument();
  });

  it("as ações de cada linha seguem a situação dela", async () => {
    abrir();
    await screen.findByText("CLI-000001");

    /*
     * Cada menu é da SUA linha: um `queryByText` na tela inteira acharia a
     * ação da linha vizinha, cujo menu continua aberto (em jsdom o clique não
     * tira o foco do anterior).
     */
    const linha = (code: string) => within(screen.getByText(code).closest("tr")!);

    fireEvent.click(menuDaLinha("CLI-000001"));
    expect(linha("CLI-000001").getByText("Bloquear")).toBeInTheDocument();
    expect(linha("CLI-000001").getByText("Inativar")).toBeInTheDocument();
    expect(linha("CLI-000001").queryByText("Desbloquear")).toBeNull();

    fireEvent.click(menuDaLinha("CLI-000002"));
    expect(linha("CLI-000002").getByText("Desbloquear")).toBeInTheDocument();
    expect(linha("CLI-000002").queryByText("Bloquear")).toBeNull();

    fireEvent.click(menuDaLinha("CLI-000003"));
    expect(linha("CLI-000003").getByText("Reativar")).toBeInTheDocument();
    expect(linha("CLI-000003").queryByText("Inativar")).toBeNull();
  });

  it("bloquear exige motivo: confirmar só liga com o campo preenchido", async () => {
    abrir();
    await screen.findByText("CLI-000001");

    fireEvent.click(menuDaLinha("CLI-000001"));
    fireEvent.click(screen.getByText("Bloquear"));

    const confirmar = screen.getByRole("button", { name: "Bloquear cliente" });
    expect(confirmar).toBeDisabled();

    // Só espaço não é motivo.
    const campo = screen.getByLabelText(/Motivo do bloqueio/);
    fireEvent.change(campo, { target: { value: "   " } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(campo, { target: { value: "Inadimplência desde março" } });
    expect(confirmar).toBeEnabled();

    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(changeCustomerStatus).toHaveBeenCalledWith(
        "cli-1",
        "BLOCK",
        "Inadimplência desde março",
      ),
    );
    // Gravou: a lista recarrega, e o diálogo sai.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("reativar avisa que o cliente volta BLOQUEADO, com o motivo em vigor", async () => {
    abrir();
    await screen.findByText("CLI-000003");

    fireEvent.click(menuDaLinha("CLI-000003"));
    fireEvent.click(screen.getByText("Reativar"));

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveTextContent(/volta para a lista de Clientes como BLOQUEADO/);
    expect(dialogo).toHaveTextContent(/Inadimplência desde março/);
  });

  it("a recusa do servidor mantém o diálogo aberto, com o motivo digitado", async () => {
    vi.mocked(changeCustomerStatus).mockRejectedValue(new Error("Cliente já está bloqueado."));
    abrir();
    await screen.findByText("CLI-000001");

    fireEvent.click(menuDaLinha("CLI-000001"));
    fireEvent.click(screen.getByText("Bloquear"));
    fireEvent.change(screen.getByLabelText(/Motivo do bloqueio/), {
      target: { value: "Inadimplência" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bloquear cliente" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cliente já está bloqueado.");
    expect(screen.getByLabelText(/Motivo do bloqueio/)).toHaveValue("Inadimplência");
  });
});
