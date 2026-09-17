import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * LABEL-ATTACHMENTS-01 — onde a seção "Arquivo do rótulo" aparece.
 *
 * Só no Item gravado como embalagem com subtipo Rótulo — pelo tipo e pelo
 * subtipo, nunca pelo nome —, na edição e também em consulta (a seção tem
 * permissão própria). Nenhum outro Item ganha arquivo genérico, e a criação
 * não mostra a seção: o Item ainda não existe.
 */

vi.mock("../../lib/items-api", () => ({ createItem: vi.fn(), updateItem: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../supplier-items/FornecedoresDoItem", () => ({ FornecedoresDoItemSection: () => null }));
vi.mock("../../components/ItemCostReferenceSection", () => ({ ItemCostReferenceSection: () => null }));
vi.mock("../../components/ItemLabelFileSection", () => ({
  ItemLabelFileSection: ({ itemId }: { itemId: string }) => <p>seção do arquivo do rótulo de {itemId}</p>,
}));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: "VIEWER" } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { listUnits } from "../../lib/units-api";
import { ItemFormModal } from "./ItemFormModal";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-rotulo",
    code: "ME-000321",
    type: "PACKAGING",
    name: "Etiqueta frontal 60x40",
    unitCode: "un",
    unit: UNIDADES[0]!,
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: "LABEL",
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function abrir(props: { mode: "create" | "edit"; item: ItemDTO | null; readOnly?: boolean }) {
  return render(
    <MemoryRouter>
      <ItemFormModal units={UNIDADES} onClose={() => {}} onSaved={() => {}} {...props} />
    </MemoryRouter>,
  );
}

const SECAO = /seção do arquivo do rótulo/;

beforeEach(() => {
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
});

describe("Item — seção Arquivo do rótulo", () => {
  it("Rótulo na edição mostra a seção, com o id do Item", () => {
    abrir({ mode: "edit", item: item() });
    expect(screen.getByText("seção do arquivo do rótulo de item-rotulo")).toBeInTheDocument();
  });

  it("Rótulo em consulta também mostra — quem só consulta baixa o arquivo", () => {
    abrir({ mode: "edit", item: item(), readOnly: true });
    expect(screen.getByText(SECAO)).toBeInTheDocument();
  });

  it("Rótulo inativo continua mostrando — o histórico segue consultável", () => {
    abrir({ mode: "edit", item: item({ active: false }) });
    expect(screen.getByText(SECAO)).toBeInTheDocument();
  });

  it.each([
    ["embalagem Pote chamada 'Rótulo'", item({ packagingSubtype: "POT", name: "Rótulo frontal" })],
    ["embalagem sem subtipo", item({ packagingSubtype: null })],
    ["matéria-prima", item({ type: "RAW_MATERIAL", packagingSubtype: null, name: "Rótulo (erro de cadastro)" })],
    ["produto acabado", item({ type: "FINISHED_PRODUCT", packagingSubtype: null })],
  ])("%s não mostra nada", (_caso, alvo) => {
    abrir({ mode: "edit", item: alvo });
    expect(screen.queryByText(SECAO)).not.toBeInTheDocument();
  });

  it("criação não mostra a seção: o Item ainda não existe", () => {
    abrir({ mode: "create", item: null });
    expect(screen.queryByText(SECAO)).not.toBeInTheDocument();
  });
});
