import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Situação comercial na lista de Clientes — CUSTOMER-COMMERCIAL-STATUS-01, §86.
 *
 * A lista abre em "Clientes ativos" (padrão registrado no BACKLOG), cada
 * filtro pede o seu recorte ao servidor — quem deriva é a API — e a situação
 * comercial é uma coluna diferente do cadastro ativo/inativo.
 */

vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(),
  setCustomerActive: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

import { listCustomers } from "../../lib/customers-api";
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
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: null,
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: null,
    ...overrides,
  };
}

/** Cadastro INATIVO e Cliente ativo: as duas perguntas convivem. */
const ATIVO_COM_CADASTRO_INATIVO = cliente({
  active: false,
  commercial: { status: "ACTIVE", reason: "Projeto aprovado (PROJ-000001)", customerSince: "2026-03-18" },
});
const PROSPECT = cliente({
  id: "cli-2",
  code: "CLI-000002",
  legalName: "Vida Saudável LTDA",
  commercial: { status: "PROSPECT", reason: "Projeto PROJ-000009 em andamento", customerSince: null },
});

function abrir(rota = "/cadastros/clientes") {
  render(
    <MemoryRouter initialEntries={[rota]}>
      <CustomersPage />
    </MemoryRouter>,
  );
}

const ultimaConsulta = () => vi.mocked(listCustomers).mock.lastCall?.[0] ?? {};
const filtro = () => screen.getByLabelText("Filtrar por situação comercial") as HTMLSelectElement;

beforeEach(() => {
  vi.mocked(listCustomers).mockReset();
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [ATIVO_COM_CADASTRO_INATIVO, PROSPECT],
    page: 1,
    pageSize: 20,
    total: 2,
  });
});

describe("CUSTOMER-COMMERCIAL-STATUS-01 — lista de Clientes", () => {
  it("abre em Clientes ativos e pede essa situação ao servidor", async () => {
    abrir();
    await screen.findByText("CLI-000001");
    expect(filtro().value).toBe("ACTIVE");
    expect(ultimaConsulta()).toEqual(expect.objectContaining({ commercialStatus: "ACTIVE" }));
  });

  it("Prospects, Inativos e Todos pedem cada um o seu recorte", async () => {
    abrir();
    await screen.findByText("CLI-000001");

    fireEvent.change(filtro(), { target: { value: "PROSPECT" } });
    await waitFor(() => expect(ultimaConsulta().commercialStatus).toBe("PROSPECT"));
    fireEvent.change(filtro(), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(ultimaConsulta().commercialStatus).toBe("INACTIVE"));
    fireEvent.change(filtro(), { target: { value: "ALL" } });
    await waitFor(() => expect(vi.mocked(listCustomers).mock.calls.length).toBeGreaterThan(3));
    await waitFor(() => expect(ultimaConsulta().commercialStatus).toBeUndefined());
  });

  it("situação comercial e cadastro são colunas diferentes, com o motivo no rótulo", async () => {
    abrir();
    const linha = (await screen.findByText("CLI-000001")).closest("tr")!;
    expect(within(linha).getByText("Cliente ativo")).toBeInTheDocument();
    // O cadastro inativo continua sendo dito — na coluna dele.
    expect(within(linha).getByText("Inativo")).toBeInTheDocument();

    const cabecalhos = screen.getAllByRole("columnheader").map((celula) => celula.textContent ?? "");
    expect(cabecalhos).toContain("Situação comercial");
    expect(cabecalhos.some((texto) => texto.startsWith("Cadastro"))).toBe(true);

    const outra = screen.getByText("CLI-000002").closest("tr")!;
    expect(within(outra).getByText("Prospect")).toHaveAttribute("title", "Projeto PROJ-000009 em andamento");
  });

  it("lista vazia no padrão diz a situação e oferece ver todos", async () => {
    vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 });
    abrir();
    expect(await screen.findByText(/Nenhum cliente com a situação comercial/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos" }));
    await waitFor(() => expect(filtro().value).toBe("ALL"));
    await waitFor(() => expect(ultimaConsulta().commercialStatus).toBeUndefined());
  });

  it("a chegada por contexto mostra o registro, seja qual for a situação dele", async () => {
    abrir("/cadastros/clientes?ids=cli-2");
    await screen.findByText("CLI-000002");
    await waitFor(() => expect(ultimaConsulta()).toEqual(expect.objectContaining({ ids: ["cli-2"] })));
    expect(ultimaConsulta().commercialStatus).toBeUndefined();
  });
});
