import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProjectProductDTO, PurchaseOrderDTO, ReceiptDTO } from "@veridi/shared";

/**
 * Referência a outro documento é LINK; ação sobre a tela é BOTÃO.
 *
 * A distinção não é decoração. Um `<button onClick={() => navigate(...)}>`
 * navega igual ao link enquanto o clique é o esquerdo e único — e some com
 * tudo o que um endereço oferece: abrir em outra aba, clique do meio, copiar
 * o endereço para colar num chamado, e a palavra "link" que o leitor de tela
 * anuncia. Quem confere um pedido com a expedição aberta ao lado perde
 * exatamente isso.
 *
 * O que estes testes travam:
 *
 * 1. nas telas convertidas a referência é `<a href>` de verdade, e o `href`
 *    é a rota canônica do documento (a mesma que `EntityLink` resolve);
 * 2. o botão homônimo NÃO sobrou junto — converter e esquecer o original
 *    passaria neste teste sem corrigir nada;
 * 3. endereço inválido mostra "não encontrada" e não vira Dashboard em
 *    silêncio.
 */

const listReceipts = vi.fn();
const listPurchaseOrders = vi.fn();
const listSuppliers = vi.fn();
const listProducts = vi.fn();

vi.mock("../lib/receiving-api", () => ({
  listReceipts: (...args: unknown[]) => listReceipts(...args),
}));
vi.mock("../lib/purchase-orders-api", () => ({
  listPurchaseOrders: (...args: unknown[]) => listPurchaseOrders(...args),
}));
vi.mock("../lib/suppliers-api", () => ({
  listSuppliers: (...args: unknown[]) => listSuppliers(...args),
}));
vi.mock("../lib/products-api", () => ({
  listProducts: (...args: unknown[]) => listProducts(...args),
}));
vi.mock("../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
}));

import { ReceiptsPage } from "./receiving/ReceiptsPage";
import { PurchaseOrdersPage } from "./purchase-orders/PurchaseOrdersPage";
import { ProjectProductsSection } from "./projects/ProjectProductsSection";
import { ProductRelatedLinks } from "../components/ProductRelatedLinks";
import { NotFoundPage } from "./NotFoundPage";

function receipt(overrides: Partial<ReceiptDTO> = {}): ReceiptDTO {
  return {
    id: "rec-1",
    code: "REC-000007",
    sourceType: "PURCHASE_ORDER",
    purchaseOrderId: "po-9",
    purchaseOrderCode: "OC-000009",
    supplierId: "sup-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    customerId: null,
    customerCode: null,
    customerName: null,
    receivedAt: "2026-08-20T11:00:00.000Z",
    invoiceNumber: null,
    documentReference: null,
    notes: null,
    lines: [],
    createdAt: "2026-08-20T11:00:00.000Z",
    createdBy: "Admin",
    ...overrides,
  };
}

function purchaseOrder(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-9",
    code: "OC-000009",
    supplierId: "sup-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierCnpj: null,
    orderDate: "2026-08-18T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "ORDERED",
    notes: null,
    lines: [],
    orderTotal: "100.00",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    receipts: [],
    ...overrides,
  };
}

function projectProduct(overrides: Partial<ProjectProductDTO> = {}): ProjectProductDTO {
  return {
    id: "pp-1",
    projectId: "prj-1",
    productId: "prod-1",
    productCode: "PROD-000012",
    productName: "Pré-Treino Frutas Vermelhas",
    productLifecycle: "DEVELOPMENT",
    productActive: true,
    sequence: 1,
    status: "ACTIVE",
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    createdByName: "Admin",
    ...overrides,
  };
}

/** Referência que virou link tem `href`; e o botão homônimo não sobrou. */
function esperarLink(nome: RegExp | string, href: string) {
  const link = screen.getByRole("link", { name: nome });
  expect(link).toHaveAttribute("href", href);
  expect(screen.queryByRole("button", { name: nome })).toBeNull();
  return link;
}

beforeEach(() => {
  listReceipts.mockReset();
  listPurchaseOrders.mockReset();
  listSuppliers.mockReset();
  listProducts.mockReset();
  listSuppliers.mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 });
  listProducts.mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 });
});

describe("Recebimentos — a lista cita documento, então cita com link", () => {
  it("abre o recebimento pelo código e pela ação, os dois com href", async () => {
    listReceipts.mockResolvedValue({ receipts: [receipt()], page: 1, pageSize: 20, total: 1 });

    render(
      <MemoryRouter>
        <ReceiptsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("REC-000007")).toBeInTheDocument());

    // O código identifica o documento da linha: é o alvo natural do clique.
    esperarLink("REC-000007", "/compras/recebimentos/rec-1");
    // "Abrir" era `<button onClick={() => navigate(...)}>` — navegação
    // disfarçada de ação.
    esperarLink("Abrir", "/compras/recebimentos/rec-1");
  });

  it("cita a Ordem de Compra de origem pelo endereço dela", async () => {
    listReceipts.mockResolvedValue({ receipts: [receipt()], page: 1, pageSize: 20, total: 1 });

    render(
      <MemoryRouter>
        <ReceiptsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("OC-000009")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "OC-000009" })).toHaveAttribute(
      "href",
      "/compras/ordens/po-9",
    );
  });

  it("material do cliente não tem OC: sem id, o traço continua texto", async () => {
    listReceipts.mockResolvedValue({
      receipts: [
        receipt({
          sourceType: "CUSTOMER_SUPPLIED",
          purchaseOrderId: null,
          purchaseOrderCode: null,
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(
      <MemoryRouter>
        <ReceiptsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("REC-000007")).toBeInTheDocument());
    // Link que chuta destino leva ao registro errado com cara de certo.
    expect(screen.queryByRole("link", { name: "—" })).toBeNull();
  });
});

describe("Ordens de Compra — o código da linha navega, como em Projetos", () => {
  it("o código é link para a própria ordem, e 'Abrir' também", async () => {
    listPurchaseOrders.mockResolvedValue({
      purchaseOrders: [purchaseOrder()],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(
      <MemoryRouter>
        <PurchaseOrdersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("OC-000009")).toBeInTheDocument());

    esperarLink("OC-000009", "/compras/ordens/po-9");
    esperarLink("Abrir", "/compras/ordens/po-9");
  });
});

describe("Projeto — a cadeia técnica do produto", () => {
  function renderSection() {
    render(
      <MemoryRouter>
        <ProjectProductsSection
          projectId="prj-1"
          customerId="cli-1"
          products={[projectProduct()]}
          editable
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );
  }

  it("os quatro destinos são links de verdade, nas rotas canônicas", () => {
    renderSection();

    const linha = screen.getAllByRole("row")[1]!;
    const destinos = within(linha);

    expect(destinos.getByRole("link", { name: "Formulação" })).toHaveAttribute(
      "href",
      "/producao/formulacoes/prod-1",
    );
    expect(destinos.getByRole("link", { name: "Custos industriais" })).toHaveAttribute(
      "href",
      "/produtos/prod-1/custos",
    );
    expect(destinos.getByRole("link", { name: "CMV" })).toHaveAttribute(
      "href",
      "/produtos/prod-1/cmv?projectId=prj-1",
    );
    expect(destinos.getByRole("link", { name: "Precificação" })).toHaveAttribute(
      "href",
      "/gestao/precificacao?productId=prod-1",
    );
  });

  it("parecem link, como o Produto e o Cliente da mesma tela", () => {
    renderSection();

    const linha = screen.getAllByRole("row")[1]!;
    const produto = within(linha).getByRole("link", { name: /PROD-000012/ });
    const formulacao = within(linha).getByRole("link", { name: "Formulação" });

    // A referência ao Produto é a régua: a cadeia técnica usa a MESMA classe
    // de link. Vestida de `btn--ghost` ela era texto cinza sem sublinhado, e
    // só o cursor no hover dizia que levava a algum lugar.
    expect(produto).toHaveClass("entity-link");
    expect(formulacao).toHaveClass("entity-link");
    expect(formulacao.className).not.toContain("btn--ghost");
  });
});

describe("Barra 'Ver do produto'", () => {
  it("usa o estilo de link, não o de botão fantasma", () => {
    render(
      <MemoryRouter>
        <ProductRelatedLinks productId="prod-1" current="costs" />
      </MemoryRouter>,
    );

    const formulacao = screen.getByRole("link", { name: "Formulação" });
    expect(formulacao).toHaveAttribute("href", "/producao/formulacoes/prod-1");
    expect(formulacao).toHaveClass("entity-link");
    expect(formulacao.className).not.toContain("btn--ghost");
  });
});

describe("Endereço que não existe", () => {
  it("mostra a página de não encontrada, com o endereço pedido e a volta", () => {
    render(
      <MemoryRouter initialEntries={["/compras/ordens-que-nao-existem"]}>
        <Routes>
          <Route path="/" element={<h1>Dashboard</h1>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Página não encontrada" })).toBeInTheDocument();
    // Sem o endereço na tela não há o que copiar para um chamado.
    expect(screen.getByText("/compras/ordens-que-nao-existem")).toBeInTheDocument();
    // Redirecionar levaria ao Dashboard sem dizer nada.
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();

    expect(screen.getByRole("link", { name: /Voltar para o Dashboard/ })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("o roteador não tem mais o catch-all que redirecionava calado", () => {
    // A rota mora em `App.tsx` e montar o App inteiro exigiria sessão e API.
    // O que precisa ficar travado é a decisão: `*` renderiza a página de
    // não encontrada, e não um `<Navigate>` que apaga o endereço errado do
    // histórico com `replace`.
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(app).toContain('<Route path="*" element={<NotFoundPage />} />');
    expect(app).not.toContain('<Navigate to="/" replace />');
  });
});
