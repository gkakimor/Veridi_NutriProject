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
import type { PricingTierPreviewDTO, PricingVersionDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-04 na Precificação.
 *
 * Um bloco grava aqui: a faixa em montagem. O que a guarda protege é o
 * DIGITADO — quantidade e preço unitário. Preço sugerido, margem calculada,
 * contribuição e markup vêm de `computePrice` a cada tecla e se refazem
 * sozinhos: a prévia inteira mudar não é trabalho a perder.
 */

vi.mock("../../lib/pricing-api", () => ({
  getPricingVersion: vi.fn(),
  previewPricingTier: vi.fn(),
  createPricingTier: vi.fn(),
  deletePricingTier: vi.fn(),
  activatePricingVersion: vi.fn(),
  getPricingRebasePreview: vi.fn(() => Promise.reject(new Error("sem base nova"))),
  rebasePricingVersion: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("../cost-templates/PricingPolicyOrigin", () => ({ PricingPolicyOrigin: () => null }));
vi.mock("../../components/ProjectOriginLink", () => ({ ProjectOriginLink: () => null }));
vi.mock("../../components/ProductRelatedLinks", () => ({ ProductRelatedLinks: () => null }));

import { createPricingTier, getPricingVersion, previewPricingTier } from "../../lib/pricing-api";
import { PricingPage } from "./PricingPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function custo(): PricingTierPreviewDTO {
  return {
    quantity: "500",
    uomCode: "un",
    priceMode: "MANUAL_PRICE",
    targetContributionMarginPercent: null,
    commissionPercent: "0.0000",
    manualUnitPrice: null,
    industrialCostTotal: "1600.00",
    industrialCostPerUnit: "3.200000",
    costPer1000: "3200.00",
    knownSubtotal: "1600.00",
    costQuality: "COMPLETE_REAL_REFERENCE",
    batchCount: "1",
    suggestedUnitPrice: null,
    selectedUnitPrice: null,
    commissionPerUnit: null,
    commissionTotal: null,
    grossRevenue: null,
    contributionPerUnit: null,
    contributionTotal: null,
    contributionMarginPercent: null,
    markupPercent: null,
    warnings: [],
  };
}

function versao(overrides: Partial<PricingVersionDTO> = {}): PricingVersionDTO {
  return {
    id: "prec-1",
    code: "PREC-000001",
    label: "PREC-000001 V1",
    versionNumber: 1,
    status: "DRAFT",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    customerName: "NutriViva",
    industrialCostCalculationId: "calc-1",
    calculationCode: "CALC-000001",
    originPricingPolicyVersionId: null,
    originPricingPolicyCode: null,
    originPricingPolicyVersionNumber: null,
    originPricingPolicyName: null,
    industrialCostVersionLabel: "EC-000001 · V1",
    formulationVersionNumber: 1,
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    costQuality: "COMPLETE_REAL_REFERENCE",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    minimumBatchQuantity: null,
    tiers: [],
    pricingComplete: false,
    hasCustomerSuppliedMaterials: false,
    warnings: [],
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Teste",
    activatedAt: null,
    activatedByName: null,
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

async function abrir(dto = versao()) {
  vi.mocked(getPricingVersion).mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/gestao/precificacao/:pricingId" element={<PricingPage />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/gestao/precificacao/prec-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText("Prévia da faixa");
}

const campo = (nome: string) => screen.getByLabelText(nome) as HTMLInputElement;
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const pergunta = () => screen.queryByText("Sair sem salvar?");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewPricingTier).mockResolvedValue(custo());
});

describe("Precificação — guarda de alterações não salvas", () => {
  it("precificação carregada e não tocada sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("quantidade digitada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta precificação/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("a prévia recalculada sozinha não deixa a tela suja", async () => {
    const user = userEvent.setup();
    await abrir();

    // A margem move preço sugerido, contribuição e markup na hora — e nada
    // disso é digitação que se perca: a faixa não começou a ser montada.
    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "45" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("apagar a quantidade devolve a tela ao estado limpo", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    fireEvent.change(campo("Quantidade"), { target: { value: "" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("gravar a faixa limpa a pendência: sair depois não pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    await waitFor(() => expect(previewPricingTier).toHaveBeenCalled(), { timeout: 2000 });

    vi.mocked(createPricingTier).mockResolvedValue(versao());
    vi.mocked(getPricingVersion).mockResolvedValue(versao());
    await user.click(screen.getByRole("button", { name: "Adicionar faixa" }));
    await waitFor(() => expect(createPricingTier).toHaveBeenCalled());
    await waitFor(() => expect(campo("Quantidade")).toHaveValue(""));

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("com faixa em montagem o beforeunload avisa; sem ela, não", async () => {
    await abrir();

    const antes = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(antes);
    expect(antes.defaultPrevented).toBe(false);

    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    await waitFor(() => {
      const evento = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evento);
      expect(evento.defaultPrevented).toBe(true);
    });
  });
});
