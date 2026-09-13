import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, SupplierDTO } from "@veridi/shared";
import type { ListSuppliersParams } from "../../lib/suppliers-api";

/**
 * Nova relação Item × Fornecedor — fornecedor sem corte (SELECTOR-CUTOFF-WAVE-01).
 *
 * A listagem pedia `listSuppliers({ active: true, pageSize: 1000 })` e passava
 * a lista ao formulário, que só filtrava no navegador. Do fornecedor ativo
 * 1001 em diante ele existia, o servidor aceitaria a relação, e o campo não o
 * achava — com "+ Novo fornecedor" logo ali convidando a duplicar.
 *
 * Agora a listagem passa só a primeira página (20), o campo busca no servidor
 * entre ativos, e o escolhido que chega de fora (cadastro no contexto,
 * rascunho) ganha nome pelo id, com o mesmo filtro. O servidor aqui guarda
 * 1002 fornecedores e filtra, ordena e pagina o universo inteiro.
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
  // O detalhe abre depois de criar; aqui ele fica carregando — não é o assunto.
  getSupplierItem: vi.fn(() => new Promise(() => undefined)),
}));

import { listSuppliers } from "../../lib/suppliers-api";
import { getItem, listItems } from "../../lib/items-api";
import { createSupplierItem, listSupplierItems } from "../../lib/supplier-items-api";
import { PARAM_RETOMAR, finishContextualCreate, startContextualCreate } from "../../lib/contextual-create";
import { SupplierItemsPage } from "./SupplierItemsPage";

const ROTA = "/compras/item-fornecedor";
const PAGINA = 20;
const RUIDO = 1000;

function fornecedor(numero: number, extra: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: `for-${numero}`,
    code: `FOR-${String(numero).padStart(6, "0")}`,
    legalName: `Fornecedor de Volume ${String(numero).padStart(4, "0")} Ltda`,
    tradeName: null,
    cnpj: null,
    active: true,
    ...extra,
  } as unknown as SupplierDTO;
}

const ALVO = fornecedor(RUIDO + 1, { legalName: "Zeta Insumos Alvo Ltda", tradeName: "Zeta Insumos" });
const INATIVO = fornecedor(RUIDO + 2, { legalName: "Zeta Insumos Inativa Ltda", active: false });
const UNIVERSO = [...Array.from({ length: RUIDO }, (_, indice) => fornecedor(indice + 1)), ALVO, INATIVO];

function servidor(params: ListSuppliersParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter(
      (registro) =>
        !termo ||
        [registro.code, registro.legalName, registro.tradeName ?? ""].some((campo) => campo.toLowerCase().includes(termo)),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { suppliers: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

const ITEM = {
  id: "item-1",
  code: "MP-000001",
  name: "Vitamina C",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
} as unknown as ItemDTO;

const ROTULO_ALVO = `${ALVO.code} · ${ALVO.legalName}`;

function abrir(endereco = `${ROTA}?nova=1`) {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <Routes>
        <Route path={ROTA} element={<SupplierItemsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const campoFornecedor = () => document.getElementById("supplier-item-supplier") as HTMLInputElement;
const campoItem = () => document.getElementById("supplier-item-item") as HTMLInputElement;
const chamadas = () => vi.mocked(listSuppliers).mock.calls.map(([params]) => params ?? {});

function nenhumaConsultaAlemDaPagina() {
  expect(chamadas().length).toBeGreaterThan(0);
  for (const params of chamadas()) expect(params.pageSize ?? 20).toBeLessThanOrEqual(PAGINA);
}

async function buscarFornecedor(termo: string) {
  await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });
  await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
  fireEvent.focus(campoFornecedor());
  fireEvent.change(campoFornecedor(), { target: { value: termo } });
  await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, search: termo, pageSize: PAGINA }));
}

function rascunho(supplierId: string) {
  return {
    itemId: ITEM.id,
    supplierId,
    supplierItemCode: "ZT-0001",
    commercialNotes: "",
    qualificationStatus: "PENDING" as const,
    qualificationNote: "",
    preferred: false,
    unitPrice: "",
    priceUomCode: "",
    minimumOrderQuantity: "",
    minimumOrderUomCode: "",
    effectiveAt: "",
    validUntil: "",
    offerNotes: "",
  };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listSuppliers).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(listItems).mockResolvedValue({ items: [ITEM], page: 1, pageSize: 50, total: 1 } as never);
  vi.mocked(getItem).mockResolvedValue(ITEM);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(createSupplierItem).mockResolvedValue({ id: "rel-1" } as never);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 1000 ativos de antes não alcançavam o fornecedor #1001", () => {
    const antigos = servidor({ active: true, pageSize: 1000 }).suppliers;
    expect(antigos).toHaveLength(RUIDO);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
  });
});

describe("Nova relação — fornecedor com busca no servidor", () => {
  it("o formulário abre com a primeira página — 20 ativos — e o resto se alcança buscando", async () => {
    abrir();
    await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ });
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, pageSize: PAGINA }));

    fireEvent.focus(campoFornecedor());
    const lista = await screen.findByRole("listbox");
    // As 20 do servidor — "+ Novo fornecedor" também é opção, e não conta.
    await waitFor(() =>
      expect(within(lista).getAllByRole("option").filter((opcao) => /^FOR-/.test(opcao.textContent ?? ""))).toHaveLength(PAGINA),
    );
    expect(within(lista).queryByRole("option", { name: new RegExp(`^${ALVO.code}`) })).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("fornecedor #1001 achado pelo código, escolhido, e a relação é criada com ele", async () => {
    abrir();
    fireEvent.focus(campoItem());
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(`^${ITEM.code}`) }));
    await waitFor(() => expect(campoItem()).toHaveValue(`${ITEM.code} · ${ITEM.name}`));

    await buscarFornecedor(ALVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(`^${ALVO.code}`) }));
    await waitFor(() => expect(campoFornecedor()).toHaveValue(ROTULO_ALVO));

    const criar = screen.getByRole("button", { name: "Criar relação" }) as HTMLButtonElement;
    await waitFor(() => expect(criar.disabled).toBe(false));
    fireEvent.click(criar);
    await waitFor(() =>
      expect(createSupplierItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: ITEM.id, supplierId: ALVO.id })),
    );
    // Achado pela busca: nenhuma pergunta extra pelo id.
    expect(chamadas().some((params) => params.ids)).toBe(false);
    nenhumaConsultaAlemDaPagina();
  });

  it("a busca continua só entre ativos: o inativo não é oferecido nem pelo nome", async () => {
    abrir();
    await buscarFornecedor("Zeta");
    expect(await screen.findByRole("option", { name: new RegExp(`^${ALVO.code}`) })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: new RegExp(`^${INATIVO.code}`) })).toBeNull();
    for (const params of chamadas().filter((consulta) => consulta.search)) expect(params.active).toBe(true);
  });
});

describe("Nova relação — fornecedor que chega de fora, pelo id", () => {
  it("cadastro no contexto volta com o fornecedor #1001: nome resolvido pelo id, sem busca", async () => {
    const token = startContextualCreate({
      originRoute: `${ROTA}?nova=1`,
      fieldKey: "supplierId",
      entityType: "supplier",
      draft: rascunho(""),
    })!;
    finishContextualCreate(token, { entityType: "supplier", entityId: ALVO.id, label: ALVO.legalName });

    abrir(`${ROTA}?nova=1&${PARAM_RETOMAR}=${token}`);
    await waitFor(() => expect(campoFornecedor()).toHaveValue(ROTULO_ALVO));
    expect(listSuppliers).toHaveBeenCalledWith({ ids: [ALVO.id], active: true, pageSize: 1 });
    expect(vi.mocked(listSuppliers).mock.calls.filter(([params]) => params?.ids)).toHaveLength(1);
    expect(chamadas().some((params) => params.search)).toBe(false);
    expect(screen.getByDisplayValue("ZT-0001")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("rascunho com fornecedor que ficou inativo: o id pergunta com o mesmo filtro e não volta como escolhível", async () => {
    const token = startContextualCreate({
      originRoute: `${ROTA}?nova=1`,
      fieldKey: "itemId",
      entityType: "item",
      draft: rascunho(INATIVO.id),
    })!;

    abrir(`${ROTA}?nova=1&${PARAM_RETOMAR}=${token}`);
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ ids: [INATIVO.id], active: true, pageSize: 1 }));
    expect(screen.getByDisplayValue("ZT-0001")).toBeInTheDocument();
    expect(campoFornecedor()).toHaveValue("");
  });
});

describe("guarda estrutural", () => {
  it("listagem e formulário não carregam fornecedores com teto", () => {
    const listagem = readFileSync(join(process.cwd(), "src", "pages", "supplier-items", "SupplierItemsPage.tsx"), "utf8");
    const formulario = readFileSync(
      join(process.cwd(), "src", "pages", "supplier-items", "SupplierItemFormModal.tsx"),
      "utf8",
    );
    for (const fonte of [listagem, formulario]) {
      expect(fonte).not.toMatch(/pageSize:\s*\d{3,}/);
      expect(fonte).not.toMatch(/PRIMEIRA_PAGINA_DE_FORNECEDORES = \d{3,}/);
    }
    expect(formulario).toMatch(/onSearch=\{buscarFornecedores\}/);
  });
});
