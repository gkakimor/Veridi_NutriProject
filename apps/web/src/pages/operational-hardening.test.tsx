import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { InventoryItemSummaryDTO } from "@veridi/shared";

/**
 * Correções de operação vindas da auditoria VAL-LEG-01.
 *
 * Cada teste aqui existe porque um operador tropeçou no comportamento
 * antigo enquanto tentava levar um produto real de cliente até custo.
 */

vi.mock("../lib/inventory-api", () => ({ listInventory: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("../lib/supplier-items-api", () => ({
  createSupplierItem: vi.fn(),
  getSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    ]),
}));

import { listInventory } from "../lib/inventory-api";
import { createSupplierItem } from "../lib/supplier-items-api";
import { InventoryOverviewPage } from "./inventory/InventoryOverviewPage";
import { SupplierItemFormModal } from "./supplier-items/SupplierItemFormModal";

function linhaEstoque(overrides: Partial<InventoryItemSummaryDTO> = {}): InventoryItemSummaryDTO {
  return {
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: true,
    onHand: "5",
    reserved: "0",
    available: "0",
    onOrder: "0",
    unavailable: [{ reason: "AWAITING_QUALITY_RELEASE", quantity: "5" }],
    ...overrides,
  };
}

async function abrirEstoque(item: InventoryItemSummaryDTO) {
  vi.mocked(listInventory).mockResolvedValue({ items: [item], page: 1, pageSize: 20, total: 1 });
  render(
    <MemoryRouter>
      <InventoryOverviewPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("MP-000003")).toBeTruthy());
}

describe("Posição de estoque explica o que está retido", () => {
  it("diz por que o disponível é zero, na própria linha", async () => {
    await abrirEstoque(linhaEstoque());
    // Antes: Físico 5, Disponível 0, e nada mais.
    expect(screen.getByText(/5 kg aguardando liberação da Qualidade/)).toBeTruthy();
  });

  it("soma causas diferentes sem misturá-las", async () => {
    await abrirEstoque(
      linhaEstoque({
        onHand: "17",
        available: "10",
        unavailable: [
          { reason: "AWAITING_QUALITY_RELEASE", quantity: "5" },
          { reason: "EXPIRED", quantity: "2" },
        ],
      }),
    );
    const texto = screen.getByText(/aguardando liberação da Qualidade/).textContent ?? "";
    expect(texto).toContain("5 kg aguardando liberação da Qualidade");
    expect(texto).toContain("2 kg vencido");
  });

  it("não escreve nada quando não há retenção", async () => {
    await abrirEstoque(linhaEstoque({ available: "5", unavailable: [] }));
    expect(screen.queryByText(/aguardando liberação/)).toBeNull();
  });
});

describe("Cadastro de Item × Fornecedor", () => {
  beforeEach(() => {
    vi.mocked(createSupplierItem).mockClear();
  });

  const itens = [
    {
      id: "item-1",
      code: "MP-000003",
      name: "Cafeína",
      type: "RAW_MATERIAL" as const,
      unitCode: "kg",
    },
  ];
  const fornecedores = [{ id: "for-1", code: "FOR-000003", legalName: "SWEETMIX" }];

  /**
   * Typeahead: digita e escolhe a opção que aparece.
   *
   * A busca é escopada ao `listbox` do combobox — as opções de um `select`
   * nativo na mesma tela também têm role "option".
   */
  function escolher(placeholder: RegExp, termo: string) {
    const campo = screen.getByPlaceholderText(placeholder);
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: termo } });
    const lista = screen.getAllByRole("listbox").at(-1)!;
    // "+ Novo …" encabeça a lista sempre: escolher é pegar o primeiro
    // RESULTADO, que é o que a pessoa faz ao digitar o código e confirmar.
    const resultado = within(lista)
      .getAllByRole("option")
      .find((opcao) => !opcao.classList.contains("entity-select__create"));
    fireEvent.mouseDown(resultado!);
  }

  function abrirFormulario() {
    render(
      <SupplierItemFormModal
        // Os DTOs completos trazem dezenas de campos que este formulário não
        // lê; o teste fornece os que ele usa.
        items={itens as never}
        suppliers={fornecedores as never}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
  }

  it("item e fornecedor são busca, não lista rolável", () => {
    abrirFormulario();
    // O catálogo passa de mil itens e o `select` vinha truncado em 100.
    expect(screen.getByPlaceholderText(/Digite código ou nome do item/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Digite código ou nome do fornecedor/)).toBeTruthy();
  });

  it("pede preço, MOQ, homologação e preferencial na mesma tela", async () => {
    abrirFormulario();
    // As quatro colunas que a grade mostra e o formulário não pedia.
    expect(screen.getByLabelText(/^Preço$/)).toBeTruthy();
    expect(screen.getByLabelText(/Pedido mínimo$/)).toBeTruthy();
    expect(screen.getByLabelText(/Situação/)).toBeTruthy();
    expect(screen.getByLabelText(/Fornecedor preferencial/)).toBeTruthy();
  });

  it("avisa que vai nascer sem oferta, em vez de fingir completude", () => {
    abrirFormulario();
    // Rodapé do modal: o resumo do que vai ser criado.
    expect(screen.getByText(/Será criada sem oferta cadastrada/i)).toBeTruthy();
  });

  it("preferencial só é possível com homologação", () => {
    abrirFormulario();
    const preferencial = screen.getByLabelText(/Fornecedor preferencial/) as HTMLInputElement;
    expect(preferencial.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Situação/), { target: { value: "APPROVED" } });
    expect((screen.getByLabelText(/Fornecedor preferencial/) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("manda tudo numa chamada só", async () => {
    vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-1" } as never);
    abrirFormulario();

    escolher(/Digite código ou nome do item/, "MP-000003");
    escolher(/Digite código ou nome do fornecedor/, "SWEETMIX");
    fireEvent.change(screen.getByLabelText(/Situação/), { target: { value: "APPROVED" } });
    fireEvent.click(screen.getByLabelText(/Fornecedor preferencial/));
    fireEvent.change(screen.getByLabelText(/^Preço$/), { target: { value: "272" } });
    fireEvent.change(screen.getByLabelText(/Pedido mínimo$/), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar relação/ }));

    await waitFor(() => expect(createSupplierItem).toHaveBeenCalled());
    const payload = vi.mocked(createSupplierItem).mock.calls[0]![0];
    expect(payload.qualificationStatus).toBe("APPROVED");
    expect(payload.preferred).toBe(true);
    expect(payload.initialOffer?.unitPrice).toBe("272");
    expect(payload.initialOffer?.minimumOrderQuantity).toBe("25");
    // A unidade acompanha o item sem obrigar a repetir "kg".
    expect(payload.initialOffer?.priceUomCode).toBe("kg");
  });

  it("sem preço não manda oferta nenhuma", async () => {
    vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-2" } as never);
    abrirFormulario();

    escolher(/Digite código ou nome do item/, "MP-000003");
    escolher(/Digite código ou nome do fornecedor/, "SWEETMIX");
    fireEvent.click(screen.getByRole("button", { name: /Criar relação/ }));

    await waitFor(() => expect(createSupplierItem).toHaveBeenCalled());
    const payload = vi.mocked(createSupplierItem).mock.calls[0]![0];
    expect(payload.initialOffer).toBeUndefined();
  });

  it("observações comerciais cabem em várias linhas", () => {
    abrirFormulario();
    const campo = screen.getByLabelText(/Observações comerciais/);
    // Texto de frase inteira aparecia cortado num input de uma linha.
    expect(campo.tagName).toBe("TEXTAREA");
  });
});
