import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionOrderDTO, ProjectSampleDTO } from "@veridi/shared";
import { SamplesPage } from "./samples/SamplesPage";
import { ProductionOrdersPage } from "./production-orders/ProductionOrdersPage";

/**
 * Continuidade entre módulos.
 *
 * O que estes testes protegem é a pergunta que a pessoa faz na frente da
 * tela: "para quem é esta ordem?" e "o que esta amostra testou?". As duas
 * respostas existiam no banco e não apareciam em lugar nenhum — e a lista de
 * amostras de um projeto com três sabores era uma coluna de T1, T2, T3 sem
 * nada que dissesse qual era qual.
 */

vi.mock("../lib/samples-api", () => ({ listSamples: vi.fn() }));
vi.mock("../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../lib/production-orders-api", () => ({ listProductionOrders: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));

import { listSamples } from "../lib/samples-api";
import { listProductionOrders } from "../lib/production-orders-api";

function sample(overrides: Partial<ProjectSampleDTO>): ProjectSampleDTO {
  return {
    id: "am-1",
    code: "AM-000001",
    externalCode: null,
    projectId: "prj-1",
    projectCode: "PROJ-000001",
    projectName: "Linha Performance",
    customerId: "cli-1",
    customerName: "NutriViva",
    projectProductId: null,
    productId: null,
    productCode: null,
    productName: null,
    testSequence: 1,
    testLabel: "T1",
    status: "PRODUCED",
    source: "MANUAL",
    description: null,
    productionNotes: null,
    decisionNotes: null,
    outputQuantity: null,
    outputUomCode: null,
    customerNameSnapshot: null,
    projectCodeSnapshot: null,
    projectNameSnapshot: null,
    qrPayload: "SAMPLE:AM-000001",
    consumptions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
    startedAt: null,
    startedByName: null,
    producedAt: null,
    producedByName: null,
    approvedAt: null,
    approvedByName: null,
    rejectedAt: null,
    rejectedByName: null,
    cancelledAt: null,
    cancelledByName: null,
    ...overrides,
  } as ProjectSampleDTO;
}

function productionOrder(overrides: Partial<ProductionOrderDTO>): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino Limão",
    finishedItemId: null,
    finishedItemCode: null,
    finishedItemName: null,
    formulationVersionId: null,
    formulationVersionNumber: null,
    formulationVersionLabel: "V1",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    productionFactor: null,
    status: "RELEASED",
    origin: "CUSTOMER_ORDER",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    notes: null,
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    customerCnpj: null,
    customerOrderId: "ped-1",
    customerOrderCode: "PED-000001",
    customerOrderLineId: "linha-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProductionOrderDTO;
}

describe("Amostra sabe qual produto testou", () => {
  it("mostra o produto na lista e não inventa um quando o vínculo não existe", async () => {
    vi.mocked(listSamples).mockResolvedValue({
      samples: [
        sample({
          id: "am-1",
          code: "AM-000001",
          projectProductId: "pp-1",
          productId: "prod-1",
          productCode: "PROD-000001",
          productName: "Pré-Treino Limão",
        }),
        sample({ id: "am-2", code: "AM-000002", testLabel: "T2" }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });

    render(
      <MemoryRouter>
        <SamplesPage />
      </MemoryRouter>,
    );

    const produto = await screen.findByRole("link", { name: /Pré-Treino Limão/ });
    // Destino por identidade: o link leva ao produto, não a uma busca pelo nome.
    expect(produto.getAttribute("href")).toContain("prod-1");
    // Amostra legada continua dizendo que não sabe.
    expect(screen.getByText("Produto não identificado")).toBeTruthy();
  });
});

describe("Ordem de produção sabe para quem produz", () => {
  it("liga cliente e pedido direto da lista", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue({
      productionOrders: [productionOrder({})],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(
      <MemoryRouter>
        <ProductionOrdersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("OP-000001")).toBeTruthy());
    const pedido = screen.getByRole("link", { name: "PED-000001" });
    expect(pedido.getAttribute("href")).toContain("/comercial/pedidos/ped-1");
    const cliente = screen.getByRole("link", { name: /NutriViva/ });
    expect(cliente.getAttribute("href")).toContain("cli-1");
    // A unidade acompanha o número — "1000" sozinho não diz se são caixas.
    expect(screen.getByText(/1000 un/)).toBeTruthy();
  });

  it("não mostra vínculo de pedido quando a ordem é de estoque próprio", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue({
      productionOrders: [
        productionOrder({
          id: "op-2",
          code: "OP-000002",
          origin: "STOCK_PRODUCTION",
          customerOrderId: null,
          customerOrderCode: null,
          customerOrderLineId: null,
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(
      <MemoryRouter>
        <ProductionOrdersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("OP-000002")).toBeTruthy());
    expect(screen.queryByRole("link", { name: /^PED-/ })).toBeNull();
  });
});
