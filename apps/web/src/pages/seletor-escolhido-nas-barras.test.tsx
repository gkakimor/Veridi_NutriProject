import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import type { ListCustomersParams } from "../lib/customers-api";

/**
 * Nome longo escolhido nas barras de filtro (MOBILE-UX-CLEANUP-WAVE-01).
 *
 * SELECTOR-CUTOFF-WAVE-01 passou estas barras ao `EntityFilterSelect`, e o
 * nome de cliente real é longo: "CLI-000134 · AMAZÔNIA DO BRASIL COMÉRCIO E
 * DSITRIBUIÇÃO DE ALIMENTOS LTDA - ME" corria 14px por baixo do ✕ em 240px e
 * em 390px. A regra que tira o texto de lá mora no componente
 * (`components/filters/seletor-escolhido-cabe-no-campo.test.tsx`); aqui se
 * prova que cada tela a recebe: campo e ✕ no mesmo `.entity-select`, dentro da
 * `.toolbar__entity` da barra, sem largura em pixel escrita na tela — e que o
 * ✕ continua desfazendo o filtro da consulta, com o contrato da wave de corte
 * (primeira página de 20, busca no servidor) intacto.
 */

vi.mock("../app/AuthProvider", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }) }));
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/projects-api", () => ({ listProjects: vi.fn(), getProjectVocabulary: vi.fn() }));
vi.mock("../lib/customer-materials-api", () => ({ listCustomerMaterials: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn(), setProductActive: vi.fn() }));
vi.mock("../lib/billings-api", () => ({
  listBillings: vi.fn(),
  listAwaitingBilling: vi.fn(),
  createBilling: vi.fn(),
}));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));

import { listCustomers } from "../lib/customers-api";
import { getProjectVocabulary, listProjects } from "../lib/projects-api";
import { listCustomerMaterials } from "../lib/customer-materials-api";
import { listProducts } from "../lib/products-api";
import { listAwaitingBilling, listBillings } from "../lib/billings-api";
import { listItems } from "../lib/items-api";
import { ProjectsPage } from "./projects/ProjectsPage";
import { ProductsPage } from "./products/ProductsPage";
import { BillingsPage } from "./billings/BillingsPage";
import { CustomerMaterialsPage } from "./inventory/CustomerMaterialsPage";

const LONGO = {
  id: "cli-134",
  code: "CLI-000134",
  legalName: "AMAZÔNIA DO BRASIL COMÉRCIO E DSITRIBUIÇÃO DE ALIMENTOS LTDA - ME",
  tradeName: "STARTUP AMAZÔNIA",
  cnpj: null,
  active: true,
} as unknown as CustomerDTO;
const CURTO = { id: "cli-1", code: "CLI-000001", legalName: "Alfa Ltda", tradeName: null, cnpj: null, active: true } as unknown as CustomerDTO;
const ROTULO_LONGO = `${LONGO.code} · ${LONGO.legalName}`;

function servidorDeClientes(params: ListCustomersParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = [CURTO, LONGO]
    .filter((cliente) => !params.ids?.length || params.ids.includes(cliente.id))
    .filter(
      (cliente) =>
        !termo ||
        [cliente.code, cliente.legalName, cliente.tradeName ?? ""].some((campo) => campo.toLowerCase().includes(termo)),
    );
  return { customers: linhas, page: 1, pageSize: params.pageSize ?? 20, total: linhas.length };
}

const ultima = (mock: unknown) => {
  const chamadas = vi.mocked(mock as (...args: never[]) => unknown).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as Record<string, unknown> | undefined;
};

const montar = (tela: ReactElement, url: string) =>
  render(<MemoryRouter initialEntries={[url]}>{tela}</MemoryRouter>);

const TELAS = [
  { tela: "Projetos", abrir: () => montar(<ProjectsPage />, "/comercial/projetos"), lista: listProjects },
  { tela: "Produtos", abrir: () => montar(<ProductsPage />, "/cadastros/produtos"), lista: listProducts },
  { tela: "Faturamento", abrir: () => montar(<BillingsPage />, "/comercial/faturamento"), lista: listBillings },
  {
    tela: "Materiais de Clientes",
    abrir: () => montar(<CustomerMaterialsPage />, "/estoque/materiais-de-clientes"),
    lista: listCustomerMaterials,
  },
];

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockImplementation(async (params) => servidorDeClientes(params) as never);
  vi.mocked(listProjects).mockResolvedValue({ projects: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(getProjectVocabulary).mockResolvedValue({ concepts: [], channels: [] } as never);
  vi.mocked(listCustomerMaterials).mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listBillings).mockResolvedValue({ billings: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listAwaitingBilling).mockResolvedValue({ rows: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 } as never);
});

describe.each(TELAS)("$tela — cliente de nome longo escolhido", ({ abrir, lista }) => {
  const campo = () => screen.getByRole("combobox", { name: "Filtrar por cliente" });

  it("o ✕ fica no contêiner do campo, dentro da barra, e desfaz o filtro da consulta", async () => {
    const { container } = abrir();
    await waitFor(() => expect(listCustomers).toHaveBeenCalled());

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: "AMAZÔNIA" } });
    // A busca vai ao servidor antes de escolher (a lista local responderia antes dele).
    await waitFor(() =>
      expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ search: "AMAZÔNIA", pageSize: 20 })),
    );
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(`^${LONGO.code}`) }));

    await waitFor(() => expect(campo()).toHaveValue(ROTULO_LONGO));
    await waitFor(() => expect(ultima(lista)?.customerId).toBe(LONGO.id));

    const contêiner = campo().closest(".entity-select") as HTMLElement;
    const limpar = within(contêiner).getByRole("button", { name: "Limpar seleção" });
    const barra = campo().closest(".toolbar__entity");
    expect(barra).not.toBeNull();
    expect(barra!.closest(".toolbar")).not.toBeNull();
    for (const elemento of container.querySelectorAll<HTMLElement>(".toolbar [style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }

    fireEvent.click(limpar);

    await waitFor(() => expect(campo()).toHaveValue(""));
    await waitFor(() => expect(ultima(lista)?.customerId ?? "").toBe(""));
    expect(contêiner.querySelector(".entity-select__clear")).toBeNull();
    for (const [params] of vi.mocked(listCustomers).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });
});
