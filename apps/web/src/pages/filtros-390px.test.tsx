import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * 390px — as telas migradas para a foundation de filtros
 * (FILTER-OPERATIONS-WAVE-01 e -02).
 *
 * jsdom não faz layout, então o que se prova é a REGRA e a estrutura: os
 * controles de filtro com largura mínima em pixel passam a ocupar a linha
 * inteira em tela estreita, os atalhos e os chips quebram linha, e nenhuma
 * tabela larga fica fora de um `.table-container`. Rolagem horizontal
 * continua existindo só onde ela é honesta — dentro do container da tabela,
 * nunca na página.
 *
 * A medição de verdade (`scrollWidth` contra `clientWidth` em 390px) é do
 * smoke com navegador; aqui fica a guarda que roda em toda alteração.
 */

vi.mock("../lib/receiving-api", () => ({ listReceipts: vi.fn().mockResolvedValue({ receipts: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/finished-goods-api", () => ({ listFinishedGoods: vi.fn().mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/production-orders-api", () => ({ listProductionOrders: vi.fn().mockResolvedValue({ productionOrders: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/attachments-api", () => ({
  listQualityQueue: vi.fn().mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0 }),
  approveCoa: vi.fn(),
  rejectCoa: vi.fn(),
}));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn().mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/lots-api", () => ({ listLots: vi.fn().mockResolvedValue({ lots: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn().mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 }) }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listReceipts } from "../lib/receiving-api";
import { listFinishedGoods } from "../lib/finished-goods-api";
import { listProductionOrders } from "../lib/production-orders-api";
import { listQualityQueue } from "../lib/attachments-api";
import { listLots } from "../lib/lots-api";
import { clearStoredFilters } from "../lib/stored-filters";
import { ReceiptsPage } from "./receiving/ReceiptsPage";
import { FinishedGoodsPage } from "./finished-goods/FinishedGoodsPage";
import { PickingConsumptionPage } from "./production-orders/PickingConsumptionPage";
import { CoaQueuePage } from "./quality/CoaQueuePage";
import { LotsPage } from "./lots/LotsPage";

const TELAS = [
  { nome: "Recebimentos", Tela: ReceiptsPage, carregou: listReceipts, escopo: "receipts" },
  { nome: "Produto Acabado", Tela: FinishedGoodsPage, carregou: listFinishedGoods, escopo: "finished-goods" },
  { nome: "Picking / Consumo", Tela: PickingConsumptionPage, carregou: listProductionOrders, escopo: "picking" },
  { nome: "Documentos / CoA", Tela: CoaQueuePage, carregou: listQualityQueue, escopo: "coa-queue" },
  // Lotes é também "Liberação de lotes" (`?status=AWAITING_RELEASE`).
  { nome: "Lotes", Tela: LotsPage, carregou: listLots, escopo: "lots" },
];

const css = () =>
  readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");

beforeEach(() => {
  for (const { escopo } of TELAS) clearStoredFilters("u-1", escopo);
});

describe("a regra de tela estreita", () => {
  it("os controles com largura mínima em pixel ocupam a linha inteira", () => {
    const folha = css();
    const estreita = folha.slice(folha.lastIndexOf("@media (max-width: 640px)"));
    expect(estreita.length).toBeLessThan(folha.length);
    for (const seletor of [".toolbar__search", ".toolbar__entity", ".filter-period__custom"]) {
      expect(estreita).toContain(seletor);
    }
    expect(estreita).toContain("min-width: 100%");
  });

  it("atalhos de período e chips quebram linha em vez de esticar a página", () => {
    const folha = css();
    for (const seletor of [".filter-period {", ".filter-chips {", ".toolbar {"]) {
      const bloco = folha.slice(folha.indexOf(seletor), folha.indexOf("}", folha.indexOf(seletor)));
      expect(bloco).toContain("flex-wrap: wrap");
    }
  });
});

describe.each(TELAS)("$nome em 390px", ({ Tela, carregou }) => {
  it("toolbar sem tabela larga, e toda tabela dentro do próprio container", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Tela />
      </MemoryRouter>,
    );
    await waitFor(() => expect(carregou).toHaveBeenCalled());

    const toolbar = container.querySelector(".toolbar") as HTMLElement;
    expect(toolbar).not.toBeNull();
    // Tabela dentro da barra de filtros é largura fixa disfarçada.
    expect(toolbar.querySelector("table")).toBeNull();

    for (const tabela of container.querySelectorAll("table")) {
      expect(tabela.closest(".table-container")).not.toBeNull();
    }

    // Nenhuma largura em pixel escrita à mão no JSX dos filtros.
    for (const elemento of container.querySelectorAll<HTMLElement>(
      ".toolbar [style], .filter-period [style], .filter-chips [style]",
    )) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
  });
});
