import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Erro de campo precisa ser LIGADO ao campo, não só aparecer perto dele.
 *
 * A auditoria de acessibilidade achou nove formulários em que a mensagem de
 * erro era visível e desconectada: sem `aria-invalid` e sem `aria-describedby`,
 * quem tabula por leitor de tela passa pelo campo inválido sem nenhum sinal de
 * que há erro nem de qual é. Os dois formulários mais extensos do sistema —
 * produto e item — estavam entre eles.
 *
 * O contrato aqui é o mesmo de `customer-form`: sem erro, nenhum atributo;
 * com erro, `aria-invalid="true"` e `aria-describedby` apontando para o
 * elemento que contém a mensagem.
 */

vi.mock("../lib/products-api", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  listProducts: vi.fn(async () => ({ products: [], total: 0 })),
  getProduct: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("../lib/items-api", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../lib/customers-api", () => ({
  listCustomers: vi.fn(async () => ({ customers: [], total: 0 })),
}));
vi.mock("../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ]),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { useAuth } from "../app/AuthProvider";
import { ApiValidationError } from "../lib/api-errors";
import { createItem } from "../lib/items-api";
import { createProduct } from "../lib/products-api";
import { ProductCreatePage } from "./products/ProductCreatePage";
import { PRODUCT_FORM_ID } from "./products/product-form";
import { ItemCreatePage } from "./items/ItemCreatePage";
import { ITEM_FORM_ID } from "./items/item-form";

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u-1", name: "Admin", email: "a@v.com", role: "ADMIN" },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

function renderizar(rota: string, elemento: React.ReactElement, caminho: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path={caminho} element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * O erro de campo destes formulários nasce SÓ da API: a tela não valida no
 * blur, ela mapeia `ApiValidationError.issues` campo a campo. Então a prova
 * é a API recusar o nome — e a tela ligar a recusa ao input.
 */
async function submeter(formId: string) {
  const form = await waitFor(() => {
    const el = document.getElementById(formId);
    if (!el) throw new Error(`formulário ${formId} ainda não montou`);
    return el;
  });
  fireEvent.submit(form);
}

const RECUSA_DE_NOME = new ApiValidationError([
  { path: "name", message: "Nome já existe para este cliente." },
]);

describe("erro de campo ligado ao campo", () => {
  it("produto: sem erro não há atributo; com erro, aria-invalid e describedby apontam certo", async () => {
    vi.mocked(createProduct).mockRejectedValue(RECUSA_DE_NOME);
    renderizar("/cadastros/produtos/novo", <ProductCreatePage />, "/cadastros/produtos/novo");

    const nome = (await screen.findByLabelText(/^Nome/)) as HTMLInputElement;
    expect(nome).not.toHaveAttribute("aria-invalid");
    expect(nome).not.toHaveAttribute("aria-describedby");

    fireEvent.change(nome, { target: { value: "Produto de teste" } });
    await submeter(PRODUCT_FORM_ID);

    await waitFor(() => expect(nome).toHaveAttribute("aria-invalid", "true"));
    const alvo = nome.getAttribute("aria-describedby")!;
    expect(alvo).toBeTruthy();
    // O id aponta para um elemento que EXISTE e que carrega a mensagem — um
    // `aria-describedby` para o vazio é pior que nenhum: promete e não entrega.
    const mensagem = document.getElementById(alvo);
    expect(mensagem).not.toBeNull();
    expect(mensagem!.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("item: sem erro não há atributo; com erro, aria-invalid e describedby apontam certo", async () => {
    vi.mocked(createItem).mockRejectedValue(RECUSA_DE_NOME);
    renderizar("/cadastros/itens/novo", <ItemCreatePage />, "/cadastros/itens/novo");

    const nome = (await screen.findByLabelText(/^Nome/)) as HTMLInputElement;
    expect(nome).not.toHaveAttribute("aria-invalid");

    fireEvent.change(nome, { target: { value: "Item de teste" } });
    // O formulário de item barra o envio sem tipo ANTES de chamar a API — e a
    // prova aqui é a API recusar. Então o tipo precisa estar escolhido.
    fireEvent.change(screen.getByLabelText(/^Tipo/), { target: { value: "RAW_MATERIAL" } });
    await submeter(ITEM_FORM_ID);

    await waitFor(() => expect(nome).toHaveAttribute("aria-invalid", "true"));
    const alvo = nome.getAttribute("aria-describedby")!;
    const mensagem = document.getElementById(alvo);
    expect(mensagem).not.toBeNull();
    expect(mensagem!.textContent?.trim().length).toBeGreaterThan(0);
  });
});
