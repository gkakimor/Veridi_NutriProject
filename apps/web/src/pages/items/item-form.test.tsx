import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * Item de estoque pelas duas portas: a página `/cadastros/itens/novo` e o
 * modal aberto da listagem.
 *
 * Os campos são os mesmos — vêm de `item-form`. O que estes testes protegem é
 * o que difere entre as portas (para onde cada uma volta) e o que NÃO pode
 * diferir: Produto acabado continua fora da criação manual nos dois lugares.
 */

vi.mock("../../lib/items-api", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
// Só aparece na edição e bate na API por conta própria.
vi.mock("../../components/SupplierItemsSection", () => ({
  SupplierItemsSection: () => null,
}));

import { createItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import {
  discardContextualCreate,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";
import { ItemCreatePage } from "./ItemCreatePage";
import { ItemFormModal } from "./ItemFormModal";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000777",
    type: "RAW_MATERIAL",
    name: "Creatina monoidratada",
    unitCode: "kg",
    unit: UNIDADES[0]!,
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: null,
    externalBarcode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...overrides,
  } as ItemDTO;
}

/**
 * A página com as rotas que ela pode alcançar: a lista, para onde o caminho
 * direto termina, e uma tela de origem, para onde a criação contextual volta.
 */
function renderPagina(entrada = "/cadastros/itens/novo") {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
        <Route path="/cadastros/itens" element={<p>lista de itens</p>} />
        <Route path="/producao/formulacoes" element={<p>tela de origem</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const seletor = (id: string) => document.getElementById(id) as HTMLSelectElement;

/** As opções oferecidas pelo seletor de tipo, sem o "Selecione…". */
function opcoesDeTipo(): string[] {
  return Array.from(seletor("item-type").options)
    .map((option) => option.value)
    .filter((value) => value !== "");
}

/** Preenche o mínimo que a API exige. */
async function preencherObrigatorios(tipo = "RAW_MATERIAL") {
  await waitFor(() => expect(seletor("item-unit").options.length).toBeGreaterThan(1));
  fireEvent.change(seletor("item-type"), { target: { value: tipo } });
  fireEvent.change(seletor("item-unit"), { target: { value: "kg" } });
  fireEvent.change(document.getElementById("item-name")!, {
    target: { value: "Creatina monoidratada" },
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createItem).mockReset();
  vi.mocked(listUnits).mockReset();
  vi.mocked(createItem).mockResolvedValue(item());
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
});

describe("Item — página oficial de criação", () => {
  it("acesso direto: salva e termina na lista", async () => {
    renderPagina();

    // A página carrega as unidades por conta própria: no modal elas chegavam
    // prontas da listagem, que não existe atrás desta tela.
    await waitFor(() => expect(listUnits).toHaveBeenCalled());
    await preencherObrigatorios();

    fireEvent.click(screen.getByRole("button", { name: "Criar item" }));

    await waitFor(() => expect(createItem).toHaveBeenCalled());
    expect(vi.mocked(createItem).mock.calls[0]?.[0]).toMatchObject({
      type: "RAW_MATERIAL",
      name: "Creatina monoidratada",
      unitCode: "kg",
    });
    expect(await screen.findByText("lista de itens")).toBeTruthy();
  });

  it("acesso direto: cancelar volta para a lista sem salvar", async () => {
    renderPagina();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("lista de itens")).toBeTruthy();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("a trilha é a canônica, não o caminho de volta", async () => {
    renderPagina();

    const trilha = screen.getByRole("navigation", { name: "Trilha da página" });
    expect(trilha.textContent).toContain("Cadastros");
    expect(trilha.textContent).toContain("Itens de estoque");
    expect(trilha.textContent).toContain("Novo item de estoque");
    // Fora do modo contextual não há para onde voltar além da lista.
    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();
  });

  it("estrutura travada é regra de edição: na criação tipo e unidade abrem", async () => {
    renderPagina();
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(seletor("item-type").disabled).toBe(false);
    expect(seletor("item-unit").disabled).toBe(false);
  });
});

describe("Item — criação contextual", () => {
  function abrirComContexto() {
    const token = startContextualCreate({
      originRoute: "/producao/formulacoes",
      fieldKey: "componente-2",
      entityType: "item",
      draft: { basisQuantity: "25" },
    })!;
    renderPagina(`/cadastros/itens/novo?origem=${token}`);
    return token;
  }

  it("salvar devolve à origem com o item registrado, em vez de ir para a lista", async () => {
    const token = abrirComContexto();

    // O botão diz PARA ONDE volta — quem saiu do meio de um documento
    // precisa saber disso antes de clicar.
    expect(screen.getByRole("button", { name: "← Voltar para Formulação" })).toBeTruthy();

    await preencherObrigatorios();
    fireEvent.click(screen.getByRole("button", { name: "Criar item" }));

    expect(await screen.findByText("tela de origem")).toBeTruthy();
    expect(screen.queryByText("lista de itens")).toBeNull();
    // O registro criado viaja pelo id: casar por nome escolheria outro item.
    expect(readContextualCreate(token)?.result).toMatchObject({
      entityType: "item",
      entityId: "item-1",
      label: "Creatina monoidratada",
    });
  });

  it("cancelar também devolve à origem — sem resultado, com o rascunho de pé", async () => {
    const token = abrirComContexto();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("tela de origem")).toBeTruthy();
    expect(screen.queryByText("lista de itens")).toBeNull();
    const registro = readContextualCreate(token);
    // Sem `result` a origem entende cancelamento; o rascunho ainda é dela.
    expect(registro?.result).toBeUndefined();
    expect(registro?.draft).toMatchObject({ basisQuantity: "25" });
    discardContextualCreate(token);
  });

  it("contexto de outro tipo de entidade não sequestra a tela", async () => {
    const token = startContextualCreate({
      originRoute: "/producao/formulacoes",
      fieldKey: "cliente",
      entityType: "customer",
      draft: {},
    })!;
    renderPagina(`/cadastros/itens/novo?origem=${token}`);

    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();

    await preencherObrigatorios();
    fireEvent.click(screen.getByRole("button", { name: "Criar item" }));

    // Comporta-se como criação normal: a lista, não a origem alheia.
    expect(await screen.findByText("lista de itens")).toBeTruthy();
  });
});

describe("Item — Produto acabado fora da criação manual", () => {
  it("a página não oferece Produto acabado no seletor de tipo", async () => {
    renderPagina();
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(opcoesDeTipo()).toEqual(["RAW_MATERIAL", "PACKAGING"]);
    expect(screen.queryByRole("option", { name: "Produto acabado" })).toBeNull();
  });

  it("o modal de criação também não oferece Produto acabado", () => {
    render(
      <MemoryRouter>
        <ItemFormModal
          mode="create"
          item={null}
          units={UNIDADES}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </MemoryRouter>,
    );

    expect(opcoesDeTipo()).toEqual(["RAW_MATERIAL", "PACKAGING"]);
  });

  it("na edição o tipo continua inteiro — item existente não perde a identidade", () => {
    render(
      <MemoryRouter>
        <ItemFormModal
          mode="edit"
          item={item({ type: "FINISHED_PRODUCT", operationallyUsed: false })}
          units={UNIDADES}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </MemoryRouter>,
    );

    expect(opcoesDeTipo()).toContain("FINISHED_PRODUCT");
    expect(seletor("item-type").value).toBe("FINISHED_PRODUCT");
  });
});

describe("Item — tipo pré-escolhido pela URL", () => {
  it("?tipo=RAW_MATERIAL abre com matéria-prima já escolhida", async () => {
    renderPagina("/cadastros/itens/novo?tipo=RAW_MATERIAL");
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(seletor("item-type").value).toBe("RAW_MATERIAL");
  });

  it("o tipo pré-escolhido traz os mesmos defaults do seletor", async () => {
    // Chegar por link não pode produzir um item diferente do que a mesma
    // escolha produziria na tela: embalagem não controla validade.
    renderPagina("/cadastros/itens/novo?tipo=PACKAGING");
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(seletor("item-type").value).toBe("PACKAGING");
    expect((document.getElementById("item-controls-expiry") as HTMLInputElement).checked).toBe(
      false,
    );
    expect((document.getElementById("item-controls-lot") as HTMLInputElement).checked).toBe(true);
  });

  it("valor inválido é ignorado e a tela começa sem tipo", async () => {
    renderPagina("/cadastros/itens/novo?tipo=BANANA");
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(seletor("item-type").value).toBe("");
  });

  it("?tipo=FINISHED_PRODUCT não abre por fora a porta que o seletor fecha", async () => {
    // A conveniência não pode virar o caminho que cria um acabado sem dono.
    renderPagina("/cadastros/itens/novo?tipo=FINISHED_PRODUCT");
    await waitFor(() => expect(listUnits).toHaveBeenCalled());

    expect(seletor("item-type").value).toBe("");
    expect(opcoesDeTipo()).toEqual(["RAW_MATERIAL", "PACKAGING"]);
  });
});

describe("Item — o modal continua sendo o modal", () => {
  it("cria pelo modal e devolve o registro a quem abriu", async () => {
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <ItemFormModal
          mode="create"
          item={null}
          units={UNIDADES}
          onClose={() => {}}
          onSaved={onSaved}
        />
      </MemoryRouter>,
    );

    fireEvent.change(seletor("item-type"), { target: { value: "RAW_MATERIAL" } });
    fireEvent.change(seletor("item-unit"), { target: { value: "kg" } });
    fireEvent.change(document.getElementById("item-name")!, {
      target: { value: "Creatina monoidratada" },
    });

    // O botão de commit vive no rodapé, FORA do `<form>`: quem o liga é o
    // atributo `form`, e é isso que permite a mesma casca em modal e página.
    const criar = screen.getByRole("button", { name: "Criar item" });
    expect(criar.getAttribute("form")).toBe("item-form");
    fireEvent.click(criar);

    await waitFor(() => expect(createItem).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(item());
  });

  it("as unidades continuam chegando por prop no modal", () => {
    render(
      <MemoryRouter>
        <ItemFormModal
          mode="create"
          item={null}
          units={UNIDADES}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </MemoryRouter>,
    );

    expect(listUnits).not.toHaveBeenCalled();
    expect(
      Array.from(seletor("item-unit").options)
        .map((option) => option.value)
        .filter((value) => value !== ""),
    ).toEqual(["kg", "un"]);
  });
});
