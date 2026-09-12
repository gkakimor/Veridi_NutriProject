import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-04 no Modelo de Formulação.
 *
 * A tela já sabia que um painel de ajustes aberto e não aplicado é pendência —
 * é o que prende "Salvar rascunho". A guarda de saída passa a somar as outras
 * duas: identificação e rascunho, que gravam separado. Quantidade física, modo
 * de cálculo, pureza, overage e componentes entram; o resumo da linha e a
 * comparação entre versões, não.
 */

const getFormulationTemplate = vi.fn();
const updateFormulationTemplate = vi.fn();
const updateFormulationTemplateVersion = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: vi.fn(),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  updateFormulationTemplateVersion: (...a: unknown[]) => updateFormulationTemplateVersion(...a),
  updateFormulationTemplate: (...a: unknown[]) => updateFormulationTemplate(...a),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () =>
    Promise.resolve({
      items: [
        {
          id: "i1",
          code: "MP-000001",
          name: "Biotina",
          unitCode: "kg",
          unit: { code: "kg", dimension: "MASS" },
          active: true,
        },
      ],
    }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function componente(
  overrides: Partial<FormulationTemplateComponentDTO> = {},
): FormulationTemplateComponentDTO {
  return {
    id: "c1",
    itemId: "i1",
    itemCode: "MP-000001",
    itemName: "Biotina",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "0.5",
    unitCode: "g",
    basis: "PER_FINISHED_UNIT",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    notes: "observação técnica",
    position: 0,
    ...overrides,
  };
}

function versao(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return {
    id: "ftv-4",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000008",
    templateName: "Biotina — Cápsulas Base",
    versionNumber: 4,
    versionLabel: "V4",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function template(overrides: Partial<FormulationTemplateDTO> = {}): FormulationTemplateDTO {
  const rascunho = versao();
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/comercial/pedidos">Pedidos</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/producao/modelos-formulacao/:templateId"
          element={<FormulationTemplateDetailPage />}
        />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/producao/modelos-formulacao/ft-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText(/^Rascunho —/)).toBeInTheDocument());
}

const nome = () => screen.getByLabelText("Nome");
/* O ⓘ do rótulo também responde por ele: o campo é o input. */
const base = () => screen.getByLabelText(/Base da formulação/, { selector: "input" });
/** A quantidade da linha não tem rótulo próprio: é o decimal da tabela. */
const quantidadeDaLinha = () =>
  document.querySelectorAll<HTMLInputElement>(
    'table input[inputmode="decimal"]',
  )[0] as HTMLInputElement;
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const pergunta = () => screen.queryByText("Sair sem salvar?");

beforeEach(() => {
  vi.clearAllMocks();
  getFormulationTemplate.mockResolvedValue(template());
});

describe("Modelo de Formulação — guarda de alterações não salvas", () => {
  it("modelo carregado e não tocado sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a quantidade física de um componente pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidadeDaLinha(), { target: { value: "0,8" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(
      screen.getByText(/alterações não salvas neste modelo de formulação/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("redigitar a mesma quantidade em outra forma não é alteração", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidadeDaLinha(), { target: { value: "0,50" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a base da formulação pergunta, e desfazer limpa", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "1000" } });
    await user.click(menuPedidos());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    fireEvent.change(base(), { target: { value: "1" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
  });

  it("o painel de ajustes em edição continua sendo pendência — agora também na saída", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));
    await user.click(screen.getByRole("radio", { name: "Calcular quantidade física" }));
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();

    // E a recusa de salvar com ajuste por aplicar não mudou.
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(
      screen.getByText("Aplique ou cancele os ajustes de MP-000001 antes de salvar."),
    ).toBeInTheDocument();
    expect(updateFormulationTemplateVersion).not.toHaveBeenCalled();
  });

  it("Cancelar no painel devolve a tela ao estado limpo", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));
    await user.click(screen.getByRole("radio", { name: "Calcular quantidade física" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar a identificação não absolve o rascunho ainda alterado", async () => {
    const user = userEvent.setup();
    await abrir();

    // Bloco A: identificação. Bloco B: rascunho.
    fireEvent.change(nome(), { target: { value: "Biotina — Cápsulas Revisada" } });
    fireEvent.change(base(), { target: { value: "1000" } });

    updateFormulationTemplate.mockResolvedValue(undefined);
    getFormulationTemplate.mockResolvedValue(template({ name: "Biotina — Cápsulas Revisada" }));
    await user.click(screen.getByRole("button", { name: "Salvar identificação" }));
    await waitFor(() => expect(updateFormulationTemplate).toHaveBeenCalled());
    await waitFor(() => expect(nome()).toHaveValue("Biotina — Cápsulas Revisada"));
    expect(base()).toHaveValue("1000");

    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("salvar o rascunho fecha a pendência dele", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "1000" } });

    updateFormulationTemplateVersion.mockResolvedValue(undefined);
    getFormulationTemplate.mockResolvedValue(
      template({ draftVersion: versao({ basisQuantity: "1000" }) }),
    );
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalled());

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("componente em branco não conta como trabalho a perder", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "+ Adicionar componente" }));
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
