import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialResourceDetailDTO } from "@veridi/shared";

/**
 * INDUSTRIAL-RATE-VALIDITY-01 na tela do recurso.
 *
 * A situação de cada tarifa é decidida no BACKEND — `isRateCurrent`, sobre o
 * dia comercial da Veridi. O que estes casos protegem é que a tela continue
 * apresentando esse veredito em vez de recalcular vigência no navegador: uma
 * segunda interpretação temporal no React seria exatamente a assimetria que
 * a correção acabou de tirar do servidor.
 *
 * A borda que interessa é a do último dia: uma tarifa com `validUntil` igual
 * a hoje chega com `isCurrent: true` e precisa aparecer como **Vigente**
 * durante o dia inteiro.
 */

vi.mock("../../lib/industrial-resources-api", () => ({
  getIndustrialResource: vi.fn(),
  updateIndustrialResource: vi.fn(),
  createIndustrialResourceRate: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { getIndustrialResource } from "../../lib/industrial-resources-api";
import { useAuth } from "../../app/AuthProvider";
import { IndustrialResourceDetailPage } from "./IndustrialResourceDetailPage";

type Rate = IndustrialResourceDetailDTO["rates"][number];

function tarifa(overrides: Partial<Rate> & { id: string }): Rate {
  return {
    rateValue: "30.0000",
    currencyCode: "BRL",
    rateUom: "HOUR",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    validUntil: null,
    source: "MANUAL",
    notes: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByName: "Analista",
    isCurrent: false,
    ...overrides,
  } as Rate;
}

function recurso(rates: Rate[]): IndustrialResourceDetailDTO {
  const current = rates.find((rate) => rate.isCurrent) ?? null;
  return {
    id: "res-1",
    code: "REC-000001",
    name: "Operador de produção",
    type: "LABOR",
    description: null,
    defaultUsageUom: "HOUR",
    powerKw: null,
    notes: null,
    active: true,
    currentRate: current,
    rateCount: rates.length,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: "Analista",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedByName: "Analista",
    rates,
  } as unknown as IndustrialResourceDetailDTO;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gestao/recursos-industriais/res-1"]}>
      <Routes>
        <Route
          path="/gestao/recursos-industriais/:id"
          element={<IndustrialResourceDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * A linha do histórico daquela tarifa, pelo valor que só ela tem.
 *
 * A célula é `{moeda} {valor}` — dois nós de texto —, então a busca é pelo
 * conteúdo da LINHA, não por um nó isolado.
 */
function linhaDaTarifa(valor: string): HTMLElement {
  const linha = screen
    .getAllByRole("row")
    .find((candidata) => candidata.textContent?.includes(valor));
  if (!linha) throw new Error(`Nenhuma linha do histórico com o valor ${valor}`);
  return linha;
}

/** Espera o histórico chegar — a página carrega o recurso por efeito. */
async function esperarHistorico(valor: string): Promise<HTMLElement> {
  await screen.findByText("Histórico de tarifas");
  return linhaDaTarifa(valor);
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
});

describe("Histórico de tarifas — a borda do último dia", () => {
  it("tarifa que vale ATÉ hoje aparece como Vigente", async () => {
    vi.mocked(getIndustrialResource).mockResolvedValue(
      recurso([
        tarifa({
          id: "r1",
          rateValue: "30.0000",
          effectiveAt: "2026-09-01T00:00:00.000Z",
          validUntil: "2026-09-09T00:00:00.000Z",
          isCurrent: true,
        }),
      ]),
    );
    renderPage();

    const linha = await esperarHistorico("30.0000");
    expect(within(linha).getByText("Vigente")).toBeTruthy();
    // A data impressa é a mesma que o backend recebeu — sem deslocamento de
    // fuso na leitura de uma data civil.
    expect(linha.textContent).toContain("09/09/2026");
  });

  it("tarifa vencida ontem aparece como Histórica", async () => {
    vi.mocked(getIndustrialResource).mockResolvedValue(
      recurso([
        tarifa({
          id: "r1",
          rateValue: "27.5000",
          effectiveAt: "2026-01-01T00:00:00.000Z",
          validUntil: "2026-09-08T00:00:00.000Z",
          isCurrent: false,
        }),
      ]),
    );
    renderPage();

    const linha = await esperarHistorico("27.5000");
    expect(within(linha).getByText("Histórica")).toBeTruthy();
    expect(screen.queryByText("Vigente")).toBeNull();
  });

  it("a tela não recalcula vigência: dois vereditos diferentes na mesma data são respeitados", async () => {
    /*
     * Cenário artificial de propósito — duas tarifas com a MESMA `validUntil`
     * e situações opostas. Nenhuma regra de negócio produz isso; ele existe
     * para provar que a tela lê `isCurrent` e não deduz nada da data. Se
     * alguém puser uma comparação de data no React, este caso quebra.
     */
    vi.mocked(getIndustrialResource).mockResolvedValue(
      recurso([
        tarifa({
          id: "r1",
          rateValue: "42.0000",
          validUntil: "2026-09-09T00:00:00.000Z",
          isCurrent: true,
        }),
        tarifa({
          id: "r2",
          rateValue: "31.0000",
          validUntil: "2026-09-09T00:00:00.000Z",
          isCurrent: false,
        }),
      ]),
    );
    renderPage();

    await esperarHistorico("42.0000");
    expect(within(linhaDaTarifa("42.0000")).getByText("Vigente")).toBeTruthy();
    expect(within(linhaDaTarifa("31.0000")).getByText("Histórica")).toBeTruthy();
  });
});
