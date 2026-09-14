import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";
import type { ListProductsParams } from "../../lib/products-api";

/**
 * Planejamento de Produção — o `?productId=` ganha nome pelo id
 * (SELECTOR-CUTOFF-WAVE-01).
 *
 * O filtro de Produto já buscava no servidor, mas o `porId` procurava o id
 * dentro dos 20 primeiros produtos: do 21º em diante o quadro vinha filtrado
 * por um produto e o campo, vazio. Agora o nome vem de `productId` no
 * servidor, esteja o produto na primeira página ou na milésima.
 *
 * O mesmo para o `?industrialResourceId=` (SELECTOR-CUTOFF-WAVE-02): o
 * `porId` do Recurso procurava o id nos 100 primeiros recursos, e do 101º em
 * diante o quadro ficava filtrado com o campo vazio. Agora pergunta pelo
 * próprio recurso.
 */

vi.mock("../../lib/production-schedules-api", () => ({
  getProductionBoard: vi.fn(),
  getProductionOrderSchedule: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
  unscheduleProductionOrder: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(async () => ({ resources: [], page: 1, pageSize: 50, total: 0 })),
  getIndustrialResource: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u1", name: "Usuário", role: "ADMIN" } }) }));

import { getProductionBoard } from "../../lib/production-schedules-api";
import { listProducts } from "../../lib/products-api";
import { getIndustrialResource, listIndustrialResources } from "../../lib/industrial-resources-api";
import { ProductionBoardPage } from "./ProductionBoardPage";

const RUIDO = 1000;

function produto(numero: number, extra: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: `prod-${numero}`,
    code: `PROD-${String(numero).padStart(6, "0")}`,
    name: `Produto de Volume ${String(numero).padStart(4, "0")}`,
    active: true,
    ...extra,
  } as unknown as ProductDTO;
}

const ALVO = produto(RUIDO + 1, { name: "Cápsulas Zeta Alvo" });
const UNIVERSO = [...Array.from({ length: RUIDO }, (_, indice) => produto(indice + 1)), ALVO];

function servidor(params: ListProductsParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.productId || registro.id === params.productId)
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo))
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { products: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProducts).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(getProductionBoard).mockResolvedValue({
    from: "2026-09-07",
    to: "2026-09-13",
    view: "WEEK",
    calendarWarning: null,
    orders: [],
    unscheduled: [],
    resources: [],
    conflicts: [],
    pendencies: [],
    pendenciesTotal: 0,
  } as never);
});

describe("Planejamento — produto do link resolvido pelo id", () => {
  it("o produto #1001 do `?productId=` aparece com nome, sem busca e sem varrer página", async () => {
    render(
      <MemoryRouter initialEntries={[`/planejamento/quadro?productId=${ALVO.id}`]}>
        <ProductionBoardPage />
      </MemoryRouter>,
    );

    const campo = await screen.findByRole("combobox", { name: "Produto" });
    await waitFor(() => expect(campo).toHaveValue(`${ALVO.code} · ${ALVO.name}`));
    expect(listProducts).toHaveBeenCalledWith({ productId: ALVO.id, pageSize: 1 });
    for (const [params] of vi.mocked(listProducts).mock.calls) {
      expect(params?.search).toBeUndefined();
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
    await waitFor(() =>
      expect(vi.mocked(getProductionBoard).mock.calls.some(([consulta]) => consulta?.productId === ALVO.id)).toBe(true),
    );
  });

  it("guarda estrutural: o `porId` não procura o id numa página carregada", () => {
    const fonte = readFileSync(join(process.cwd(), "src", "pages", "planning", "ProductionBoardPage.tsx"), "utf8");
    expect(fonte).not.toMatch(/listProducts\(\{ pageSize: 20 \}\)\)\.products\.find/);
    expect(fonte).toMatch(/listProducts\(\{ productId: id, pageSize: 1 \}\)/);
  });
});

describe("Planejamento — recurso do link resolvido pelo id", () => {
  const RECURSO_ALVO = {
    id: "rin-101",
    code: "RIN-000101",
    name: "Encapsuladora Zeta Alvo",
    type: "EQUIPMENT",
    active: true,
    rates: [],
  };

  it("o recurso #101 do `?industrialResourceId=` aparece com nome, pelo próprio recurso e uma vez", async () => {
    vi.mocked(getIndustrialResource).mockResolvedValue(RECURSO_ALVO as never);
    render(
      <MemoryRouter initialEntries={[`/planejamento/quadro?industrialResourceId=${RECURSO_ALVO.id}`]}>
        <ProductionBoardPage />
      </MemoryRouter>,
    );

    const campo = await screen.findByRole("combobox", { name: "Recurso" });
    await waitFor(() => expect(campo).toHaveValue(`${RECURSO_ALVO.code} · ${RECURSO_ALVO.name}`));
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(RECURSO_ALVO.id);
    for (const [params] of vi.mocked(listIndustrialResources).mock.calls) {
      expect(params?.search).toBeUndefined();
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(50);
    }
    await waitFor(() =>
      expect(
        vi.mocked(getProductionBoard).mock.calls.some(([consulta]) => consulta?.industrialResourceId === RECURSO_ALVO.id),
      ).toBe(true),
    );
  });

  it("recurso que não existe mais: o quadro segue filtrado, sem rótulo e sem perguntar de novo", async () => {
    vi.mocked(getIndustrialResource).mockRejectedValue(new Error("Recurso não encontrado"));
    render(
      <MemoryRouter initialEntries={["/planejamento/quadro?industrialResourceId=rin-sumiu"]}>
        <ProductionBoardPage />
      </MemoryRouter>,
    );

    const campo = await screen.findByRole("combobox", { name: "Recurso" });
    await waitFor(() => expect(getIndustrialResource).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        vi.mocked(getProductionBoard).mock.calls.some(([consulta]) => consulta?.industrialResourceId === "rin-sumiu"),
      ).toBe(true),
    );
    expect(campo).toHaveValue("");
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
  });

  it("guarda estrutural: o `porId` do recurso não procura o id numa página carregada", () => {
    const fonte = readFileSync(join(process.cwd(), "src", "pages", "planning", "ProductionBoardPage.tsx"), "utf8");
    expect(fonte).not.toMatch(/listIndustrialResources\(\{ pageSize: 100 \}\)\)\.resources\.find/);
    expect(fonte).toMatch(/await getIndustrialResource\(id\)/);
  });
});
