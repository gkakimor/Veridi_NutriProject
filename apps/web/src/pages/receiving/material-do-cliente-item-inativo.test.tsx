import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO } from "@veridi/shared";
import type { ListItemsParams } from "../../lib/items-api";

/**
 * Material do cliente — item inativado depois de escolhido
 * (CUSTOMER-MATERIAL-INACTIVE-GATE-01).
 *
 * O seletor continua pedindo só item ativo e elegível. Quem decide é o
 * servidor, no estado de agora: se o item foi inativado entre a escolha e a
 * confirmação, `POST /receipts/customer-supplied` responde 400
 * `item_inactive`. Aqui a resposta passa pelo cliente de API de verdade
 * (`receiving-api` + `parseJsonOrThrow`): a mensagem aparece, nada de sucesso,
 * e o formulário continua preenchido para a pessoa escolher outro item.
 * A recusa com banco real está em
 * `apps/api/src/modules/receiving/material-do-cliente-item-inativo.test.ts`.
 */

vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
const apiFetch = vi.fn();
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { listCustomers } from "../../lib/customers-api";
import { listItems } from "../../lib/items-api";
import { ReceiveCustomerMaterialPage } from "./ReceiveCustomerMaterialPage";

const ROTA = "/compras/recebimentos/material-do-cliente";

function item(id: string, code: string, name: string, extra: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id,
    code,
    name,
    type: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
    ...extra,
  } as unknown as ItemDTO;
}

const ATIVO = item("item-ativo", "MP-000101", "Beta-Alanina Doca");
const INATIVO = item("item-inativo", "MP-000102", "Colageno Inativo", { active: false });
const UNIVERSO = [ATIVO, INATIVO];
const CLIENTE = { id: "cli-a", code: "CLI-000001", legalName: "Alfa Suplementos Ltda", tradeName: null, cnpj: null };
const RECUSA = `O item ${ATIVO.code} está inativo e não pode receber novo material.`;

/** Servidor de mentira, honesto nos filtros que a tela manda. */
function servidor(params: ListItemsParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo));
  return { items: linhas, page: 1, pageSize: params.pageSize ?? 20, total: linhas.length };
}

function abrir() {
  return render(
    <MemoryRouter initialEntries={[ROTA]}>
      <Routes>
        <Route path={ROTA} element={<ReceiveCustomerMaterialPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function escolherCliente() {
  const campo = document.getElementById("customer-receipt-customer") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(CLIENTE.code) }));
}

async function buscarNoSeletor(termo: string) {
  await waitFor(() => expect(listItems).toHaveBeenCalled());
  const campo = screen.getAllByRole("combobox", { name: "Item recebido" })[0]!;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  await waitFor(() => expect(listItems).toHaveBeenCalledWith(expect.objectContaining({ search: termo })));
  return campo;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE], total: 1 } as never);
  vi.mocked(listItems).mockImplementation(async (params) => servidor(params) as never);
});

describe("material do cliente — item inativo", () => {
  it("o seletor não oferece item inativo: pergunta só ativo e elegível, nem pela busca", async () => {
    abrir();
    await buscarNoSeletor("Colageno");

    for (const [params] of vi.mocked(listItems).mock.calls) {
      expect(params).toEqual(expect.objectContaining({ customerSupplied: true, active: true }));
    }
    await waitFor(() => expect(screen.queryByRole("option", { name: new RegExp(INATIVO.code) })).toBeNull());
  });

  it("item escolhido ativo e inativado antes de confirmar: a recusa aparece, sem sucesso, e o formulário fica", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // O servidor já vê o item inativo: a resposta real do endpoint.
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "item_inactive", message: RECUSA }),
    });

    abrir();
    await escolherCliente();
    const campo = await buscarNoSeletor(ATIVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(ATIVO.code) }));
    await waitFor(() => expect(campo).toHaveValue(`${ATIVO.code} · ${ATIVO.name}`));

    const linha = campo.closest("tr") as HTMLElement;
    fireEvent.change(within(linha).getByLabelText(`Quantidade recebida de ${ATIVO.code}`), { target: { value: "12,5" } });
    fireEvent.change(within(linha).getByLabelText("Lote do fabricante"), { target: { value: "FAB-2026-09" } });

    const confirmar = screen.getByRole("button", { name: /Confirmar recebimento/ }) as HTMLButtonElement;
    await waitFor(() => expect(confirmar.disabled).toBe(false));
    fireEvent.click(confirmar);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(RECUSA);
    // O alerta fica no topo e o botão no fim: a recusa é trazida para a vista.
    await waitFor(() => expect(document.activeElement).toBe(alerta));
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/receipts/customer-supplied"), expect.anything());
    expect(screen.queryByText("Recebimento gravado")).toBeNull();

    // Nada se perde: cliente, item, quantidade e lote continuam; dá para tentar de novo.
    expect(document.getElementById("customer-receipt-customer")).toHaveValue(`${CLIENTE.code} · ${CLIENTE.legalName}`);
    expect(campo).toHaveValue(`${ATIVO.code} · ${ATIVO.name}`);
    expect(within(linha).getByLabelText(`Quantidade recebida de ${ATIVO.code}`)).toHaveValue("12,5");
    expect(within(linha).getByLabelText("Lote do fabricante")).toHaveValue("FAB-2026-09");
    await waitFor(() => expect(confirmar.disabled).toBe(false));
    expect(aviso).toHaveBeenCalledWith("API 400 item_inactive");
    aviso.mockRestore();
  });
});
