import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * WEB-DATE-DEFAULT-TZ-01 — o "hoje" que as telas de custo propõem é o dia
 * comercial de São Paulo (§72), nunca o dia UTC nem o do navegador.
 *
 * Antes: CMV e referência manual de custo liam o fuso do navegador; cálculo de
 * custo, impresso do CMV e resumo de custo do Produto liam o dia UTC. Entre 21h
 * e meia-noite de São Paulo o dia UTC já é amanhã; num navegador em Vancouver,
 * entre 0h e 4h de São Paulo, o dia local ainda é ontem; em Tóquio, o dia local
 * vira antes. Cada combinação abaixo reprova pelo menos uma das duas leituras
 * antigas, e todas esperam o mesmo `YYYY-MM-DD` de São Paulo.
 *
 * Só o `Date` é falso; o fuso do processo é trocado de verdade e conferido pelo
 * deslocamento, para o teste não passar sem ter mudado de fuso. Data que veio
 * explícita (URL) não muda.
 */

vi.mock("../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../lib/industrial-costs-api", () => ({ getProductIndustrialCosts: vi.fn() }));
vi.mock("../lib/pricing-api", () => ({ getProductPricing: vi.fn(), createPricingVersion: vi.fn() }));
vi.mock("../lib/cost-calculation-api", () => ({
  calculateIndustrialCost: vi.fn(),
  previewIndustrialCost: vi.fn(),
  saveIndustrialCostCalculation: vi.fn(),
  discardIndustrialCostCalculation: vi.fn(),
  listProductCostCalculations: () => Promise.resolve([]),
}));
vi.mock("../lib/cost-pricing-templates-api", () => ({ applyPricingPolicyToProduct: vi.fn() }));
vi.mock("./cost-templates/UsePricingPolicyDialog", () => ({ UsePricingPolicyDialog: () => null }));
vi.mock("../components/ProjectOriginLink", () => ({ ProjectOriginLink: () => null }));
vi.mock("../lib/items-api", () => ({ getItemCostReferences: vi.fn(), createItemCostReference: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../app/AuthProvider", async (original) => ({
  ...(await original<typeof import("../app/AuthProvider")>()),
  useAuth: () => ({ user: { role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));
vi.mock("../pdf/render", () => ({ renderPdfBlob: vi.fn(), downloadPdf: vi.fn() }));

import { getProductCmv } from "../lib/product-cmv-api";
import { getProductIndustrialCosts } from "../lib/industrial-costs-api";
import { getProductPricing } from "../lib/pricing-api";
import { getItemCostReferences } from "../lib/items-api";
import { ProductCmvPage } from "./product-cmv/ProductCmvPage";
import { CmvPrintPage } from "./print/CmvPrintPage";
import { CostCalculationSection } from "./industrial-costs/CostCalculationSection";
import { ProductIndustrialCostSummary } from "./products/ProductIndustrialCostSummary";
import { ItemCostReferenceSection } from "../components/ItemCostReferenceSection";

const FUSO_ORIGINAL = process.env.TZ;

/** Fuso do "navegador" e o deslocamento que prova que ele pegou (em 12/09/2026). */
const FUSOS = [
  ["UTC", 0],
  ["America/Vancouver", 420],
  ["Asia/Tokyo", -540],
] as const;

/** Instantes na virada do dia de São Paulo, com o dia comercial esperado. */
const BORDAS = [
  ["2026-09-12T01:30:00.000Z", "2026-09-11"], // 22:30 em SP: UTC já é dia 12
  ["2026-09-12T02:59:59.000Z", "2026-09-11"], // 23:59:59 em SP: último segundo do dia 11
  ["2026-09-12T03:30:00.000Z", "2026-09-12"], // 00:30 em SP: Vancouver ainda no dia 11
] as const;

const CASOS = FUSOS.flatMap(([fuso, deslocamento]) =>
  BORDAS.map(([instante, dia]) => [fuso, deslocamento, instante, dia] as const),
);

/** Promise que nunca resolve: basta ver com que data a tela pediu. */
const pendente = () => new Promise<never>(() => {});

function noInstante(fuso: string, deslocamento: number, instante: string) {
  process.env.TZ = fuso;
  expect(new Date("2026-09-12T12:00:00Z").getTimezoneOffset(), `fuso ${fuso} não pegou`).toBe(deslocamento);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instante));
}

function naRota(caminho: string, rota: string, elemento: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path={rota} element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductCmv).mockReturnValue(pendente());
  vi.mocked(getProductPricing).mockReturnValue(pendente());
  vi.mocked(getProductIndustrialCosts).mockResolvedValue({
    productId: "prod-1",
    current: {
      id: "ec-1",
      label: "EC-000001 · V1",
      status: "ACTIVE",
      complete: true,
      formulationVersionNumber: 1,
      referenceOutputQuantity: "300",
      referenceOutputUomCode: "un",
      pendencies: [],
    },
    draft: null,
    versions: [],
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = FUSO_ORIGINAL;
});

afterAll(() => {
  process.env.TZ = FUSO_ORIGINAL;
});

describe("CMV — tela", () => {
  it.each(CASOS)("navegador em %s (%i), às %s: abre e simula em %s", async (fuso, deslocamento, instante, dia) => {
    noInstante(fuso, deslocamento, instante);
    naRota("/produtos/prod-1/cmv?quantity=300", "/produtos/:productId/cmv", <ProductCmvPage />);

    await waitFor(() => expect(getProductCmv).toHaveBeenCalled());
    expect(vi.mocked(getProductCmv).mock.calls[0]![1].referenceDate).toBe(dia);
    expect(screen.getByDisplayValue(dia)).toHaveAttribute("type", "date");
  });

  it("data explícita na URL não muda, nem na virada do dia", async () => {
    noInstante("Asia/Tokyo", -540, "2026-09-12T01:30:00.000Z");
    naRota("/produtos/prod-1/cmv?quantity=300&referenceDate=2026-08-18", "/produtos/:productId/cmv", <ProductCmvPage />);

    await waitFor(() => expect(getProductCmv).toHaveBeenCalled());
    expect(vi.mocked(getProductCmv).mock.calls[0]![1].referenceDate).toBe("2026-08-18");
  });
});

describe("CMV — impresso", () => {
  it.each(CASOS)("navegador em %s (%i), às %s: carrega o dia %s", async (fuso, deslocamento, instante, dia) => {
    noInstante(fuso, deslocamento, instante);
    naRota("/impressos/cmv/prod-1?quantity=300", "/impressos/cmv/:productId", <CmvPrintPage />);

    await waitFor(() =>
      expect(getProductCmv).toHaveBeenCalledWith("prod-1", { quantity: "300", referenceDate: dia }),
    );
  });

  it("data explícita na URL não muda, nem na virada do dia", async () => {
    noInstante("UTC", 0, "2026-09-12T01:30:00.000Z");
    naRota("/impressos/cmv/prod-1?quantity=300&referenceDate=2026-09-12", "/impressos/cmv/:productId", <CmvPrintPage />);

    await waitFor(() =>
      expect(getProductCmv).toHaveBeenCalledWith("prod-1", { quantity: "300", referenceDate: "2026-09-12" }),
    );
  });
});

describe("Cálculo padrão da Estrutura de Custos", () => {
  it.each(CASOS)("navegador em %s (%i), às %s: referência nasce em %s", (fuso, deslocamento, instante, dia) => {
    noInstante(fuso, deslocamento, instante);
    render(
      <MemoryRouter>
        <CostCalculationSection productId="prod-1" versionId="ec-1" canSave />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Data de referência de custo")).toHaveValue(dia);
  });
});

describe("Resumo de custo no Produto (mesmo resíduo, mesmo achado)", () => {
  it.each(CASOS)("navegador em %s (%i), às %s: consulta o CMV de %s", async (fuso, deslocamento, instante, dia) => {
    noInstante(fuso, deslocamento, instante);
    render(
      <MemoryRouter>
        <ProductIndustrialCostSummary productId="prod-1" />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(getProductCmv).toHaveBeenCalledWith("prod-1", { quantity: "300", referenceDate: dia }),
    );
  });
});

describe("Referência manual de custo do Item (mesmo resíduo, mesmo achado)", () => {
  it.each(CASOS)("navegador em %s (%i), às %s: vigência nasce em %s", async (fuso, deslocamento, instante, dia) => {
    noInstante(fuso, deslocamento, instante);
    vi.mocked(getItemCostReferences).mockResolvedValue({
      itemId: "item-1",
      itemCode: "MP-000001",
      itemName: "Coenzima Q10",
      itemUnitCode: "kg",
      current: null,
      history: [],
      automatic: { unitCost: null, unitCode: "kg", source: "NO_COST", details: null, referenceDate: instante },
    });
    render(<ItemCostReferenceSection itemId="item-1" />);

    (await screen.findByRole("button", { name: "Definir referência" })).click();
    await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());
    expect(document.querySelector('input[type="date"]')).toHaveValue(dia);
  });
});
