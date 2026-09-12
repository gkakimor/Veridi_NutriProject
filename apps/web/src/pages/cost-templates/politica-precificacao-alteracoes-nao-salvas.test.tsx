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
import type { PricingPolicyDTO, PricingPolicyVersionDTO } from "@veridi/shared";
import { DEFAULT_PRICING_MODEL } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-04 na Política de Precificação.
 *
 * Dois blocos gravam separado — identificação e rascunho (Modelo + faixas) —,
 * e a guarda soma os dois. Ativar grava e termina a decisão: a tela sai limpa
 * e não pergunta de novo. Preço não existe aqui: ele nasce quando a política é
 * aplicada a um produto, e por isso não há nada derivado a proteger.
 */

const getPricingPolicy = vi.fn();
const updatePricingPolicy = vi.fn();
const updatePricingPolicyVersion = vi.fn();
const activatePricingPolicyVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getPricingPolicy: (...a: unknown[]) => getPricingPolicy(...a),
  updatePricingPolicy: (...a: unknown[]) => updatePricingPolicy(...a),
  updatePricingPolicyVersion: (...a: unknown[]) => updatePricingPolicyVersion(...a),
  activatePricingPolicyVersion: (...a: unknown[]) => activatePricingPolicyVersion(...a),
  setPricingPolicyArchived: vi.fn(),
  createPolicyVersionFrom: vi.fn(),
  comparePricingPolicyVersions: vi.fn(),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { PricingPolicyDetailPage } from "./PricingPolicyDetailPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function rascunho(overrides: Partial<PricingPolicyVersionDTO> = {}): PricingPolicyVersionDTO {
  return {
    id: "tppv-2",
    pricingPolicyTemplateId: "tpp-1",
    templateCode: "TPP-000002",
    templateName: "Private Label — Padrão",
    versionNumber: 2,
    versionLabel: "TPP-000002 V2",
    status: "DRAFT",
    notes: null,
    tiers: [
      {
        id: "t1",
        quantity: "500",
        uomCode: "un",
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "35.0000",
        commissionPercent: "5.0000",
        notes: null,
        sortOrder: 0,
      },
    ],
    pricingModel: { ...DEFAULT_PRICING_MODEL },
    applicableTaxProfiles: [],
    createdAt: "2026-09-01T12:00:00.000Z",
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

function policy(overrides: Partial<PricingPolicyDTO> = {}): PricingPolicyDTO {
  const draft = rascunho();
  return {
    id: "tpp-1",
    code: "TPP-000002",
    name: "Private Label — Padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
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
          path="/gestao/politicas-precificacao/:policyId"
          element={<PricingPolicyDetailPage />}
        />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/gestao/politicas-precificacao/tpp-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveValue("Private Label — Padrão"));
}

const nome = () => screen.getByLabelText("Nome");
const margem = () => screen.getAllByLabelText("Margem alvo")[0] as HTMLInputElement;
const quantidade = () => screen.getAllByLabelText("Quantidade da faixa")[0] as HTMLInputElement;
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const pergunta = () => screen.queryByText("Sair sem salvar?");

beforeEach(() => {
  vi.clearAllMocks();
  getPricingPolicy.mockResolvedValue(policy());
});

describe("Política de Precificação — guarda de alterações não salvas", () => {
  it("política carregada e não tocada sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a margem alvo de uma faixa pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(margem(), { target: { value: "40" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(
      screen.getByText(/alterações não salvas nesta política de precificação/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("redigitar a mesma margem em outra forma não é alteração", async () => {
    const user = userEvent.setup();
    await abrir();

    // O servidor devolve 35.0000; quem redigita escreve 35.
    fireEvent.change(margem(), { target: { value: "35" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar a identificação não absolve a faixa ainda alterada", async () => {
    const user = userEvent.setup();
    await abrir();

    // Bloco A: identificação. Bloco B: rascunho.
    fireEvent.change(nome(), { target: { value: "Private Label — Revisada" } });
    fireEvent.change(quantidade(), { target: { value: "800" } });

    updatePricingPolicy.mockResolvedValue(undefined);
    getPricingPolicy.mockResolvedValue(policy({ name: "Private Label — Revisada" }));
    await user.click(screen.getByRole("button", { name: "Salvar identificação" }));
    await waitFor(() => expect(updatePricingPolicy).toHaveBeenCalled());
    await waitFor(() => expect(nome()).toHaveValue("Private Label — Revisada"));
    expect(quantidade()).toHaveValue("800");

    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("salvar o rascunho fecha a pendência dele", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "800" } });

    updatePricingPolicyVersion.mockResolvedValue(undefined);
    const salvo = rascunho();
    salvo.tiers = [{ ...salvo.tiers[0]!, quantity: "800" }];
    getPricingPolicy.mockResolvedValue(policy({ draftVersion: salvo, versions: [salvo] }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updatePricingPolicyVersion).toHaveBeenCalled());

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("ativar é ação de domínio: persistida, não pergunta ao sair", async () => {
    const user = userEvent.setup();
    await abrir();

    const ativa = rascunho({ status: "ACTIVE", activatedAt: "2026-09-12T12:00:00.000Z" });
    activatePricingPolicyVersion.mockResolvedValue(undefined);
    getPricingPolicy.mockResolvedValue(
      policy({ activeVersion: ativa, draftVersion: null, versions: [ativa] }),
    );
    await user.click(screen.getByRole("button", { name: "Ativar versão" }));
    await waitFor(() => expect(activatePricingPolicyVersion).toHaveBeenCalled());

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("faixa em branco não conta como trabalho a perder", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "+ Adicionar faixa" }));
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
