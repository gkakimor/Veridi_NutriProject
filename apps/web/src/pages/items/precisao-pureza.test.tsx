import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * PREC-MIG-C — a tela não é onde a pureza perde casas.
 *
 * O risco que este arquivo fecha é o de PRECISÃO ESCONDIDA: o banco guarda
 * `99,999500`, a tela mostra o campo, ninguém edita nada, e o valor volta ao
 * servidor cortado — porque o formulário o passou por uma máscara, um
 * `Number` ou um `toFixed` no caminho. O dado seria destruído por uma tela de
 * leitura, sem nenhuma decisão humana no meio.
 *
 * O que se prova aqui é o caminho `web → API`: abrir sem editar e salvar
 * devolve à API exatamente o que veio dela. A ida `API → banco` é provada em
 * `apps/api/src/modules/formulations/precisao-pureza-overage.test.ts`.
 */

vi.mock("../../lib/items-api", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../components/SupplierItemsSection", () => ({
  SupplierItemsSection: () => null,
}));
vi.mock("../../components/ItemCostReferenceSection", () => ({
  ItemCostReferenceSection: () => null,
}));

import { updateItem } from "../../lib/items-api";
import { ItemFormModal } from "./ItemFormModal";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

/** O item como a API o entrega: pureza é STRING, com as seis casas. */
function itemComPureza(pureza: string | null): ItemDTO {
  return {
    id: "item-prec-c",
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
    defaultPurityPercent: pureza,
    packagingSubtype: null,
    externalBarcode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
  } as ItemDTO;
}

function abrirEdicao(pureza: string | null) {
  const item = itemComPureza(pureza);
  render(
    <MemoryRouter>
      <ItemFormModal
        mode="edit"
        item={item}
        units={UNIDADES}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </MemoryRouter>,
  );
  return item;
}

const campoPureza = () => document.getElementById("item-purity") as HTMLInputElement;

beforeEach(() => {
  vi.mocked(updateItem).mockReset();
  vi.mocked(updateItem).mockImplementation(async (_id, payload) =>
    itemComPureza((payload as { defaultPurityPercent?: string | null }).defaultPurityPercent ?? null),
  );
});

describe("PREC-MIG-C: pureza no formulário de item", () => {
  it("abrir e salvar sem editar devolve 99.9995 intacto à API", async () => {
    abrirEdicao("99.9995");

    // O campo mostra o que o servidor guardou, sem completar nem cortar casas.
    expect(campoPureza().value).toBe("99.9995");

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalled());
    expect(vi.mocked(updateItem).mock.calls[0]?.[1]).toMatchObject({
      defaultPurityPercent: "99.9995",
    });
  });

  it("seis casas atravessam a tela sem virar cinco", async () => {
    abrirEdicao("98.123456");
    expect(campoPureza().value).toBe("98.123456");

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalled());
    expect(vi.mocked(updateItem).mock.calls[0]?.[1]).toMatchObject({
      defaultPurityPercent: "98.123456",
    });
  });

  it("digitar com vírgula chega à API com ponto, e com todas as casas", async () => {
    abrirEdicao(null);

    fireEvent.change(campoPureza(), { target: { value: "99,999500" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalled());
    expect(vi.mocked(updateItem).mock.calls[0]?.[1]).toMatchObject({
      defaultPurityPercent: "99.999500",
    });
  });

  it("pureza em branco continua sendo AUSENTE, nunca 100", async () => {
    abrirEdicao(null);
    expect(campoPureza().value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalled());
    expect(vi.mocked(updateItem).mock.calls[0]?.[1]).toMatchObject({
      defaultPurityPercent: "",
    });
  });
});
