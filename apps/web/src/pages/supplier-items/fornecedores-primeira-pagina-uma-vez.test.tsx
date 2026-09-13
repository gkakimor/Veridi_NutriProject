import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, SupplierDTO } from "@veridi/shared";
import type { ListSuppliersParams } from "../../lib/suppliers-api";

/**
 * Item × Fornecedor pede a primeira página de fornecedores UMA vez por montagem
 * (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * A barra (filtro por fornecedor) e o formulário de nova relação abrem com a
 * MESMA página — 20 ativos — e cada um a pedia por conta própria: duas consultas
 * idênticas a cada vez que a tela montava, com o formulário aberto ou não. Agora
 * a listagem pede uma vez e entrega aos dois; busca e nome pelo id continuam
 * indo ao servidor. Nada é guardado entre montagens.
 */

vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }) }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [{ code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" }]),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  createSupplierItem: vi.fn(),
  getSupplierItem: vi.fn(() => new Promise(() => undefined)),
}));

import { listSuppliers } from "../../lib/suppliers-api";
import { listItems } from "../../lib/items-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { SupplierItemsPage } from "./SupplierItemsPage";

const ROTA = "/compras/item-fornecedor";
const PAGINA = 20;

function fornecedor(numero: number): SupplierDTO {
  return {
    id: `for-${numero}`,
    code: `FOR-${String(numero).padStart(6, "0")}`,
    legalName: `Fornecedor de Volume ${String(numero).padStart(4, "0")} Ltda`,
    tradeName: null,
    cnpj: null,
    active: true,
  } as unknown as SupplierDTO;
}

const UNIVERSO = Array.from({ length: 1002 }, (_, indice) => fornecedor(indice + 1));
const ALVO = UNIVERSO[1000]!;

function servidor(params: ListSuppliersParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.ids?.length || params.ids.includes(registro.id)).filter(
    (registro) => !termo || `${registro.code} ${registro.legalName}`.toLowerCase().includes(termo),
  );
  const pageSize = params.pageSize ?? 20;
  return { suppliers: linhas.slice(0, pageSize), page: 1, pageSize, total: linhas.length };
}

/** As consultas da primeira página — sem busca e sem id. */
const primeirasPaginas = () =>
  vi
    .mocked(listSuppliers)
    .mock.calls.map(([params]) => params ?? {})
    .filter((params) => !params.search && !params.ids);

function tela(endereco: string) {
  return (
    <MemoryRouter initialEntries={[endereco]}>
      <Routes>
        <Route path={ROTA} element={<SupplierItemsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/* Pelo id: com o formulário aberto a listagem fica `inert`, fora da árvore acessível. */
const filtro = () => document.getElementById("supplier-items-supplier") as HTMLInputElement;
const fecharFormulario = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: /Nova relação item × fornecedor/ })).toBeNull());
};
const campoDoFormulario = () => document.getElementById("supplier-item-supplier") as HTMLInputElement;

async function opcoesDaLista(campo: HTMLInputElement) {
  fireEvent.focus(campo);
  const lista = await screen.findByRole("listbox");
  await waitFor(() =>
    expect(within(lista).getAllByRole("option").filter((opcao) => /^FOR-/.test(opcao.textContent ?? ""))).toHaveLength(PAGINA),
  );
  const codigos = within(lista)
    .getAllByRole("option")
    .map((opcao) => opcao.textContent ?? "")
    .filter((texto) => /^FOR-/.test(texto));
  fireEvent.keyDown(campo, { key: "Escape" });
  return codigos;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listSuppliers).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] as ItemDTO[], page: 1, pageSize: 50, total: 0 } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [], page: 1, pageSize: 20, total: 0 });
});

describe("uma consulta da primeira página por montagem", () => {
  it("listagem sem o formulário: uma consulta, e a barra abre com os 20", async () => {
    render(tela(ROTA));
    const codigos = await opcoesDaLista(filtro());

    expect(codigos).toHaveLength(PAGINA);
    expect(primeirasPaginas()).toEqual([{ active: true, pageSize: PAGINA }]);
  });

  it("com o formulário aberto: uma consulta, e barra e formulário abrem com os mesmos 20", async () => {
    render(tela(`${ROTA}?nova=1`));
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });

    const doFormulario = await opcoesDaLista(campoDoFormulario());
    await fecharFormulario();
    const daBarra = await opcoesDaLista(filtro());

    expect(doFormulario.map((texto) => texto.slice(0, 10))).toEqual(daBarra.map((texto) => texto.slice(0, 10)));
    expect(primeirasPaginas()).toEqual([{ active: true, pageSize: PAGINA }]);
  });

  it("abrir o formulário depois não pede a página de novo", async () => {
    render(tela(ROTA));
    await waitFor(() => expect(primeirasPaginas()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Nova relação" }));
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });
    expect(await opcoesDaLista(campoDoFormulario())).toHaveLength(PAGINA);

    expect(primeirasPaginas()).toHaveLength(1);
  });

  it("em StrictMode (dev): a montagem dobrada também pede uma vez", async () => {
    render(<StrictMode>{tela(`${ROTA}?nova=1`)}</StrictMode>);
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });
    expect(await opcoesDaLista(campoDoFormulario())).toHaveLength(PAGINA);

    expect(primeirasPaginas()).toEqual([{ active: true, pageSize: PAGINA }]);
  });

  it("nada fica guardado entre montagens: montar de novo pergunta de novo", async () => {
    const primeira = render(tela(ROTA));
    await waitFor(() => expect(primeirasPaginas()).toHaveLength(1));
    primeira.unmount();

    render(tela(ROTA));
    await waitFor(() => expect(primeirasPaginas()).toHaveLength(2));
    expect(await opcoesDaLista(filtro())).toHaveLength(PAGINA);
  });
});

describe("o resto continua indo ao servidor", () => {
  it("busca da barra e do formulário: só ativos, pela busca, sem repetir a página", async () => {
    render(tela(`${ROTA}?nova=1`));
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });

    // Formulário primeiro; a barra só é alcançável com ele fechado.
    for (const campo of [campoDoFormulario, filtro]) {
      if (campo === filtro) await fecharFormulario();
      const elemento = campo();
      fireEvent.focus(elemento);
      fireEvent.change(elemento, { target: { value: ALVO.code } });
      await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, search: ALVO.code, pageSize: PAGINA }));
      expect(await screen.findByRole("option", { name: new RegExp(`^${ALVO.code}`) })).toBeInTheDocument();
      fireEvent.keyDown(elemento, { key: "Escape" });
      vi.mocked(listSuppliers).mockClear();
    }
    expect(primeirasPaginas()).toEqual([]);
  });

  it("filtro lembrado com o fornecedor #1001: nome pelo id, uma vez", async () => {
    localStorage.clear();
    render(tela(`${ROTA}?supplierId=${ALVO.id}`));

    await waitFor(() => expect(filtro()).toHaveValue(`${ALVO.code} · ${ALVO.legalName}`));
    expect(vi.mocked(listSuppliers).mock.calls.filter(([params]) => params?.ids)).toEqual([[{ ids: [ALVO.id], pageSize: 1 }]]);
    expect(primeirasPaginas()).toHaveLength(1);
  });

  it("primeira página recusada: barra e formulário abrem vazios, e a busca ainda acha", async () => {
    vi.mocked(listSuppliers).mockImplementation(async (params) => {
      if (!params?.search && !params?.ids) throw new Error("fora do ar");
      return servidor(params) as never;
    });
    render(tela(`${ROTA}?nova=1`));
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });
    await waitFor(() => expect(primeirasPaginas()).toHaveLength(1));

    fireEvent.focus(campoDoFormulario());
    fireEvent.change(campoDoFormulario(), { target: { value: ALVO.code } });
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, search: ALVO.code, pageSize: PAGINA }));
    expect(await screen.findByRole("option", { name: new RegExp(`^${ALVO.code}`) })).toBeInTheDocument();
    expect(primeirasPaginas()).toHaveLength(1);
  });
});
