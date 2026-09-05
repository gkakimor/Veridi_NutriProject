import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";
import { ApiValidationError } from "../../lib/api-errors";

/**
 * Validação inline por componente (BACKLOG #3).
 *
 * Numa receita grande, "valor inválido" no topo obrigava a procurar a linha.
 * Cada campo inválido agora carrega `aria-invalid`, uma mensagem ligada por
 * `aria-describedby` que nomeia o componente E o campo, e a tentativa de
 * salvar ou ativar leva o foco ao primeiro erro — abrindo o painel de ajustes
 * quando o erro mora lá. Digitar nunca rola a tela.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "g", label: "grama", dimension: "MASS", toBaseFactor: "0.001" },
      { code: "kg", label: "quilograma", dimension: "MASS", toBaseFactor: "1" },
    ]),
}));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import {
  activateFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente(overrides: Partial<FormulationComponentDTO> = {}): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Coenzima Q10",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "220",
    unitCode: "g",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockEquivalentQuantity: null,
    stockUnitCode: "kg",
    notes: null,
    position: 0,
    ...overrides,
  } as FormulationComponentDTO;
}

const segundo = () =>
  componente({ id: "cmp-2", itemId: "item-2", itemCode: "MP-000004", itemName: "Magnésio", quantity: "5", position: 1 });

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Produto de teste",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Produto de teste",
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
}

async function abrir(dto = versao()) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(document.querySelectorAll("tbody tr select option").length).toBeGreaterThan(1),
  );
}

const quantidadeDe = (codigo: string) =>
  screen.getByRole("textbox", { name: `Quantidade de ${codigo}` }) as HTMLInputElement;

const salvar = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

/** Mensagem ligada ao campo por `aria-describedby`. */
function mensagemDo(campo: HTMLElement): string {
  const id = campo.getAttribute("aria-describedby");
  expect(id, "campo sem aria-describedby").toBeTruthy();
  return document.getElementById(id!)?.textContent ?? "";
}

const rolagem = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao());
  vi.mocked(activateFormulationVersion).mockResolvedValue(versao({ status: "ACTIVE" }));
  // jsdom não implementa `scrollIntoView`; aqui ele é o que se quer observar.
  Element.prototype.scrollIntoView = rolagem;
});

describe("Validação inline por componente", () => {
  it("campo inválido ganha aria-invalid e uma mensagem que nomeia o componente e o campo", async () => {
    const user = userEvent.setup();
    await abrir();
    const campo = quantidadeDe("MP-000003");
    expect(campo).not.toHaveAttribute("aria-invalid");

    fireEvent.change(campo, { target: { value: "abc" } });
    await salvar(user);

    await waitFor(() => expect(campo).toHaveAttribute("aria-invalid", "true"));
    expect(mensagemDo(campo)).toMatch(/^MP-000003 — Quantidade: informe um valor numérico válido/);
    expect(screen.getByText("Corrija os campos destacados.")).toBeInTheDocument();
    // Salvar bloqueado: nada foi ao servidor.
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("quantidade zero ou negativa é recusada antes de enviar, com a regra dita", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "0" } });
    await salvar(user);

    await waitFor(() => expect(quantidadeDe("MP-000003")).toHaveAttribute("aria-invalid", "true"));
    expect(mensagemDo(quantidadeDe("MP-000003"))).toBe("MP-000003 — Quantidade deve ser maior que zero.");
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("tentar salvar leva foco e rolagem ao primeiro erro", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "x" } });
    expect(rolagem).not.toHaveBeenCalled();

    await salvar(user);

    await waitFor(() => expect(document.activeElement).toBe(quantidadeDe("MP-000003")));
    expect(rolagem).toHaveBeenCalledTimes(1);
  });

  it("erro escondido no painel de ajustes fechado: o painel abre e o campo recebe o foco", async () => {
    const user = userEvent.setup();
    // Pureza ilegível já gravada, painel fechado — o erro não está na tela.
    await abrir(versao({ components: [componente({ purityPercentApplied: "abc" })] }));
    expect(document.querySelector("tr.ajuste-quantidade__linha")).toBeNull();

    await salvar(user);

    await waitFor(() => expect(document.querySelector("tr.ajuste-quantidade__linha")).not.toBeNull());
    const pureza = screen.getByRole("textbox", { name: "Pureza aplicada" });
    expect(pureza).toHaveAttribute("aria-invalid", "true");
    expect(mensagemDo(pureza)).toMatch(/^MP-000003 — Pureza %: informe um valor numérico válido/);
    await waitFor(() => expect(document.activeElement).toBe(pureza));
    // A linha avisa que há o que corrigir mesmo com o painel fechado de novo.
    expect(screen.getByRole("button", { name: /corrigir/ })).toBeInTheDocument();
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("vários erros ficam todos marcados; corrigido o primeiro, a próxima tentativa vai ao seguinte", async () => {
    const user = userEvent.setup();
    await abrir(versao({ components: [componente(), segundo()] }));
    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "" } });
    fireEvent.change(quantidadeDe("MP-000004"), { target: { value: "0" } });

    await salvar(user);
    await waitFor(() => expect(document.activeElement).toBe(quantidadeDe("MP-000003")));
    expect(quantidadeDe("MP-000003")).toHaveAttribute("aria-invalid", "true");
    expect(quantidadeDe("MP-000004")).toHaveAttribute("aria-invalid", "true");
    expect(mensagemDo(quantidadeDe("MP-000003"))).toBe("MP-000003 — Quantidade é obrigatória.");
    expect(mensagemDo(quantidadeDe("MP-000004"))).toBe("MP-000004 — Quantidade deve ser maior que zero.");

    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "10" } });
    await salvar(user);

    await waitFor(() => expect(document.activeElement).toBe(quantidadeDe("MP-000004")));
    expect(quantidadeDe("MP-000003")).not.toHaveAttribute("aria-invalid");
    expect(rolagem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("digitar não rola a tela nem rouba o foco", async () => {
    const user = userEvent.setup();
    await abrir();
    const campo = quantidadeDe("MP-000003");
    await user.click(campo);
    await user.type(campo, "5");
    fireEvent.change(campo, { target: { value: "abc" } });

    expect(rolagem).not.toHaveBeenCalled();
    expect(campo).not.toHaveAttribute("aria-invalid");
  });

  it("Ativar versão é bloqueado enquanto houver erro de validação", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "abc" } });

    await user.click(screen.getByRole("button", { name: /Ativar versão/ }));
    await user.click(await screen.findByRole("button", { name: /^Ativar$/ }));

    await waitFor(() => expect(quantidadeDe("MP-000003")).toHaveAttribute("aria-invalid", "true"));
    expect(vi.mocked(activateFormulationVersion)).not.toHaveBeenCalled();
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
    expect(screen.getByText("Corrija os campos destacados.")).toBeInTheDocument();
  });

  it("recusa do servidor cai no campo certo, com o componente nomeado", async () => {
    const user = userEvent.setup();
    await abrir(versao({ components: [componente(), segundo()] }));
    vi.mocked(updateFormulationVersion).mockRejectedValueOnce(
      new ApiValidationError([{ path: "components.1.quantity", message: "Quantidade deve ser maior que zero" }]),
    );

    await salvar(user);

    await waitFor(() => expect(quantidadeDe("MP-000004")).toHaveAttribute("aria-invalid", "true"));
    expect(mensagemDo(quantidadeDe("MP-000004"))).toBe("MP-000004 — Quantidade deve ser maior que zero");
    expect(quantidadeDe("MP-000003")).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(document.activeElement).toBe(quantidadeDe("MP-000004")));
  });

  it("salvar segue normalmente quando tudo é válido", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(quantidadeDe("MP-000003"), { target: { value: "250" } });
    await salvar(user);

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    expect(rolagem).not.toHaveBeenCalled();
    expect(screen.queryByText("Corrija os campos destacados.")).not.toBeInTheDocument();
  });
});
