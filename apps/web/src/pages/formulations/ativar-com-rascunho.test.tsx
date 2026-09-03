import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO } from "@veridi/shared";

/**
 * Ativar uma versão nunca pode descartar o que está na tela.
 *
 * O defeito: `Ativar versão` chamava a API de ativação direto. Quem editava a
 * receita e clicava em Ativar sem passar por "Salvar rascunho" ativava a
 * versão SEM a alteração, em silêncio. Versão ativa é documento histórico e
 * não se edita — quem percebesse depois não conseguiria consertar, só criar
 * outra versão.
 *
 * A correção grava antes de ativar, e trata a gravação como CONDIÇÃO: se ela
 * falhar, a ativação não acontece. Ativação parcial seria pior que o defeito
 * original.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import {
  activateFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente() {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "200",
    unitCode: "mg",
    basis: "PER_BATCH" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: null,
    overagePercent: null,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockEquivalentQuantity: "0.0002",
    stockUnitCode: "kg",
    notes: null,
    position: 0,
  };
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Cafeína 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1000",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Cafeína 60 cápsulas",
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
}

/**
 * Edita a base da formulação — campo simples, sem depender do catálogo.
 *
 * Busca pelo `id` e não pelo rótulo: o rótulo carrega o ⓘ de ajuda, e o
 * texto dele bate em mais de um nó.
 */
function editarBase(valor: string) {
  const campo = document.getElementById("version-basis") as HTMLInputElement;
  if (!campo) throw new Error("Campo da base não está na tela.");
  fireEvent.change(campo, { target: { value: valor } });
  return campo;
}

async function ativar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Ativar versão/ }));
  await screen.findByRole("alertdialog");
  await user.click(screen.getByRole("button", { name: "Ativar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao({ basisQuantity: "2500" }));
  vi.mocked(activateFormulationVersion).mockResolvedValue(
    versao({ status: "ACTIVE", basisQuantity: "2500" }),
  );
});

describe("Ativar versão com alteração pendente", () => {
  it("A · a alteração feita na tela vai para a versão ativada", async () => {
    const user = userEvent.setup();
    await abrir();

    editarBase("2500");
    await ativar(user);

    await waitFor(() => expect(vi.mocked(activateFormulationVersion)).toHaveBeenCalled());

    // Gravou o que estava na tela…
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledWith(
      "fv-1",
      expect.objectContaining({ basisQuantity: "2500" }),
    );
    // …e só depois ativou.
    const ordemSalvar = vi.mocked(updateFormulationVersion).mock.invocationCallOrder[0]!;
    const ordemAtivar = vi.mocked(activateFormulationVersion).mock.invocationCallOrder[0]!;
    expect(ordemSalvar).toBeLessThan(ordemAtivar);
  });

  it("B · gravação recusada por validação não ativa nada", async () => {
    const user = userEvent.setup();
    vi.mocked(updateFormulationVersion).mockRejectedValue(
      new ApiValidationError([
        { path: "basisQuantity", message: "Base precisa ser maior que zero." },
      ]),
    );
    await abrir();

    editarBase("0");
    await ativar(user);

    await waitFor(() =>
      expect(screen.getByText("Corrija os campos destacados.")).toBeInTheDocument(),
    );
    // A regra que importa: a versão continua rascunho.
    expect(vi.mocked(activateFormulationVersion)).not.toHaveBeenCalled();
    // E o erro do servidor aparece no campo, não numa segunda lista de regras.
    expect(screen.getByText("Base precisa ser maior que zero.")).toBeInTheDocument();
  });

  it("D · falha de rede ao gravar também impede a ativação", async () => {
    const user = userEvent.setup();
    vi.mocked(updateFormulationVersion).mockRejectedValue(new Error("Failed to fetch"));
    await abrir();

    editarBase("2500");
    await ativar(user);

    await waitFor(() => expect(screen.getByText("Failed to fetch")).toBeInTheDocument());
    expect(vi.mocked(activateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("C · sem alteração pendente, ativar não grava nada", async () => {
    const user = userEvent.setup();
    await abrir();

    await ativar(user);

    await waitFor(() => expect(vi.mocked(activateFormulationVersion)).toHaveBeenCalledTimes(1));
    // Gravar por gravar tocaria `updatedAt` e o autor da última alteração sem
    // que ninguém tenha alterado nada.
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("C2 · reeditar até o valor original conta como sem alteração", async () => {
    const user = userEvent.setup();
    await abrir();

    editarBase("9999");
    editarBase("1000");
    await ativar(user);

    await waitFor(() => expect(vi.mocked(activateFormulationVersion)).toHaveBeenCalled());
    // O detector compara com o que o servidor devolveu, não com "alguém
    // digitou": voltar ao valor de origem não é alteração pendente.
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("E · duplo clique não grava nem ativa duas vezes", async () => {
    const user = userEvent.setup();
    // Segura o salvamento para os dois cliques caírem dentro da mesma janela.
    let liberar: (dto: FormulationVersionDTO) => void = () => {};
    vi.mocked(updateFormulationVersion).mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve;
      }) as ReturnType<typeof updateFormulationVersion>,
    );
    await abrir();

    editarBase("2500");
    await user.click(screen.getByRole("button", { name: /Ativar versão/ }));
    await screen.findByRole("alertdialog");
    const confirmar = screen.getByRole("button", { name: "Ativar" });
    await user.click(confirmar);
    // O diálogo fecha no primeiro clique; o segundo cai no botão da página,
    // que é o caminho realmente alcançável por quem clica duas vezes.
    await user.click(screen.getByRole("button", { name: /Ativar versão/ }));

    liberar(versao({ basisQuantity: "2500" }));

    await waitFor(() => expect(vi.mocked(activateFormulationVersion)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledTimes(1);
  });
});
