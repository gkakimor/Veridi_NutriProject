import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * As listas que a primeira onda não cobriu — o resultado do filtro anterior
 * não se passa pelo do filtro novo (LISTS-LOADING-STALE-DATA-02).
 *
 * Cadastros, bibliotecas de modelos, Precificação, Roteiros, Estoque,
 * Movimentações, Materiais de Clientes e a busca da Visão do Cliente guardavam
 * linhas, total e erro em `useState` soltos, trocados por qualquer resposta que
 * chegasse: filtro novo deixava a tabela, o total e as páginas do anterior à
 * vista, a última resposta a CHEGAR virava a tela, e a falha vinha junto das
 * linhas de antes — ou, na primeira carga, do "Nenhum … encontrado". A página
 * voltava à 1 por efeito: filtro trocado fora da primeira página consultava
 * duas vezes.
 *
 * Agora (`useListQuery` + `useFilteredPage` + `ListStatusRow`), as mesmas
 * provas de `listas-consulta-em-curso.test.tsx`, com os filtros de cada tela, e
 * o vazio real — só com a resposta do recorte atual. O mecanismo é provado em
 * `lib/list-query.test.tsx`.
 */

vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));
vi.mock("../lib/customers-api", async (original) => ({ ...(await original<object>()), listCustomers: vi.fn() }));
vi.mock("../lib/suppliers-api", async (original) => ({ ...(await original<object>()), listSuppliers: vi.fn() }));
vi.mock("../lib/items-api", async (original) => ({ ...(await original<object>()), listItems: vi.fn() }));
vi.mock("../lib/units-api", async (original) => ({ ...(await original<object>()), listUnits: vi.fn() }));
vi.mock("../lib/products-api", async (original) => ({ ...(await original<object>()), listProducts: vi.fn() }));
vi.mock("../lib/supplier-items-api", async (original) => ({
  ...(await original<object>()),
  listSupplierItems: vi.fn(),
}));
vi.mock("../lib/formulations-api", async (original) => ({
  ...(await original<object>()),
  listFormulations: vi.fn(),
}));
vi.mock("../lib/formulation-templates-api", async (original) => ({
  ...(await original<object>()),
  listFormulationTemplates: vi.fn(),
}));
vi.mock("../lib/industrial-resources-api", async (original) => ({
  ...(await original<object>()),
  listIndustrialResources: vi.fn(),
}));
vi.mock("../lib/cost-pricing-templates-api", async (original) => ({
  ...(await original<object>()),
  listCostTemplates: vi.fn(),
  listPricingPolicies: vi.fn(),
}));
vi.mock("../lib/pricing-api", async (original) => ({ ...(await original<object>()), listPricingVersions: vi.fn() }));
vi.mock("../lib/production-profiles-api", async (original) => ({
  ...(await original<object>()),
  listProductionProfiles: vi.fn(),
}));
vi.mock("../lib/inventory-api", async (original) => ({
  ...(await original<object>()),
  listInventory: vi.fn(),
  listInventoryMovements: vi.fn(),
}));
vi.mock("../lib/customer-materials-api", async (original) => ({
  ...(await original<object>()),
  listCustomerMaterials: vi.fn(),
}));

import { listCostTemplates, listPricingPolicies } from "../lib/cost-pricing-templates-api";
import { listCustomerMaterials } from "../lib/customer-materials-api";
import { listCustomers } from "../lib/customers-api";
import { listFormulationTemplates } from "../lib/formulation-templates-api";
import { listFormulations } from "../lib/formulations-api";
import { listIndustrialResources } from "../lib/industrial-resources-api";
import { listInventory, listInventoryMovements } from "../lib/inventory-api";
import { listItems } from "../lib/items-api";
import { listPricingVersions } from "../lib/pricing-api";
import { listProductionProfiles } from "../lib/production-profiles-api";
import { listProducts } from "../lib/products-api";
import { listSupplierItems } from "../lib/supplier-items-api";
import { listSuppliers } from "../lib/suppliers-api";
import { listUnits } from "../lib/units-api";
import { CostTemplatesPage } from "./cost-templates/CostTemplatesPage";
import { PricingPoliciesPage } from "./cost-templates/PricingPoliciesPage";
import { ConsultationSearchPage } from "./customer-consultation/ConsultationSearchPage";
import { CustomersPage } from "./customers/CustomersPage";
import { FormulationTemplatesPage } from "./formulation-templates/FormulationTemplatesPage";
import { FormulationsPage } from "./formulations/FormulationsPage";
import { IndustrialResourcesPage } from "./industrial-resources/IndustrialResourcesPage";
import { CustomerMaterialsPage } from "./inventory/CustomerMaterialsPage";
import { InventoryMovementsPage } from "./inventory/InventoryMovementsPage";
import { InventoryOverviewPage } from "./inventory/InventoryOverviewPage";
import { ItemsPage } from "./items/ItemsPage";
import { ProductionProfilesPage } from "./planning/ProductionProfilesPage";
import { PricingListPage } from "./pricing/PricingListPage";
import { ProductsPage } from "./products/ProductsPage";
import { SupplierItemsPage } from "./supplier-items/SupplierItemsPage";
import { SuppliersPage } from "./suppliers/SuppliersPage";

type Filtros = Record<string, unknown>;

const AGORA = new Date("2026-09-11T15:00:00.000Z");
const INSTANTE = "2026-09-10T15:00:00.000Z";
/** Três páginas de 20. */
const TOTAL = 45;
const CARREGANDO = "Carregando…";
const PAGINACAO = /Página \d+ de \d+/;

interface Gesto {
  nome: string;
  aplicar: () => Promise<void>;
  /** O que a consulta nova leva. */
  espera: (filtros: Filtros) => void;
}

interface Lista {
  nome: string;
  Componente: ComponentType;
  consulta: unknown;
  /** O corpo da resposta com UMA linha, identificada pelo código. */
  resposta: (codigo: string, total: number) => Record<string, unknown>;
  /**
   * O total como a tela escreve, para `n` registros — `null` nas bibliotecas,
   * que só paginam. Com `\d+` casa qualquer total, inclusive o "0" de uma
   * resposta que ainda não chegou.
   */
  contagem: ((n: string) => RegExp) | null;
  /** O vazio da tela — nunca antes da resposta, nunca junto de uma falha. */
  vazio: RegExp;
  gestos: [Gesto, Gesto, ...Gesto[]];
}

/* ---------- gestos ---------- */

async function flush() {
  await act(async () => {});
}

function busca(rotulo: string, termo = "X-9"): Gesto {
  return {
    nome: `busca ${termo}`,
    aplicar: async () => {
      fireEvent.change(screen.getByLabelText(rotulo), { target: { value: termo } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
    },
    espera: (filtros) => expect(filtros).toMatchObject({ search: termo }),
  };
}

function seletor(nome: string, rotulo: string, valor: string, espera: Gesto["espera"]): Gesto {
  return {
    nome,
    aplicar: async () => {
      fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
    },
    espera,
  };
}

function caixa(nome: string, rotulo: string, espera: Gesto["espera"]): Gesto {
  return {
    nome,
    aplicar: async () => {
      fireEvent.click(screen.getByLabelText(rotulo));
    },
    espera,
  };
}

function entidade(nome: string, rotulo: string, codigo: string, espera: Gesto["espera"]): Gesto {
  return {
    nome,
    aplicar: async () => {
      fireEvent.focus(screen.getByRole("combobox", { name: rotulo }));
      await flush();
      fireEvent.mouseDown(screen.getByRole("option", { name: new RegExp(`^${codigo}`) }));
      await flush();
    },
    espera,
  };
}

/* ---------- linhas ---------- */

const pagina = (total: number) => ({ page: 1, pageSize: 20, total });

function cliente(codigo: string) {
  return {
    id: codigo, code: codigo, legalName: "Nutrifarm", tradeName: null, cnpj: null, city: null, state: null,
    phone: null, commercial: null, active: true, blocked: false, status: "ACTIVE", block: null,
  };
}

const LISTAS: Lista[] = [
  {
    nome: "Clientes",
    Componente: CustomersPage,
    consulta: listCustomers,
    resposta: (codigo, total) => ({ customers: [cliente(codigo)], ...pagina(total) }),
    contagem: (n) => new RegExp(`^${n} clientes?$`),
    vazio: /Nenhum cliente/,
    gestos: [
      busca("Buscar clientes"),
      seletor("UF", "Filtrar por UF", "SP", (f) => expect(f).toMatchObject({ state: "SP" })),
      seletor("situação comercial", "Filtrar por situação comercial", "PROSPECT", (f) =>
        expect(f).toMatchObject({ commercialStatus: "PROSPECT" }),
      ),
      seletor("situação cadastral", "Filtrar por situação cadastral", "INACTIVE", (f) =>
        expect(f).toMatchObject({ status: ["INACTIVE"] }),
      ),
    ],
  },
  {
    nome: "Fornecedores",
    Componente: SuppliersPage,
    consulta: listSuppliers,
    resposta: (codigo, total) => ({
      suppliers: [
        { id: codigo, code: codigo, legalName: "Fornecedor Um", tradeName: null, cnpj: null, phone: null, active: true },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} fornecedor(es)?$`),
    vazio: /Nenhum fornecedor/,
    gestos: [
      busca("Buscar fornecedores"),
      seletor("status", "Filtrar por status", "active", (f) => expect(f).toMatchObject({ active: true })),
    ],
  },
  {
    nome: "Itens de estoque",
    Componente: ItemsPage,
    consulta: listItems,
    resposta: (codigo, total) => ({
      items: [
        {
          id: codigo, code: codigo, name: "Vitamina C", declaredNutrient: null, type: "RAW_MATERIAL", family: null,
          sourceName: null, unit: { id: "un-kg", code: "kg" }, controlsLot: true, controlsExpiry: true, active: true,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} (item|itens)$`),
    vazio: /Nenhum item/,
    gestos: [
      busca("Buscar itens"),
      seletor("tipo", "Filtrar por tipo", "PACKAGING", (f) => expect(f).toMatchObject({ type: "PACKAGING" })),
      seletor("status", "Filtrar por status", "inactive", (f) => expect(f).toMatchObject({ active: false })),
    ],
  },
  {
    nome: "Produtos Acabados",
    Componente: ProductsPage,
    consulta: listProducts,
    resposta: (codigo, total) => ({
      products: [
        {
          id: codigo, code: codigo, name: "Produto Um", lifecycle: "APPROVED", customer: null, dosageForm: null,
          presentationType: null, finishedProductItem: null, shelfLifeMonths: null,
          activeFormulationVersionLabel: null, active: true,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} produtos?$`),
    vazio: /Nenhum produto/,
    gestos: [
      busca("Buscar produtos"),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
      seletor("status", "Filtrar por status", "inactive", (f) => expect(f).toMatchObject({ active: false })),
      seletor("ciclo de vida", "Filtrar por ciclo de vida", "DEVELOPMENT", (f) =>
        expect(f).toMatchObject({ lifecycle: "DEVELOPMENT" }),
      ),
    ],
  },
  {
    nome: "Item × Fornecedor",
    Componente: SupplierItemsPage,
    consulta: listSupplierItems,
    resposta: (codigo, total) => ({
      supplierItems: [
        {
          id: codigo, itemId: "itm-1", itemCode: codigo, itemName: "Vitamina C", supplierName: "Fornecedor Um",
          supplierItemCode: null, qualificationStatus: "APPROVED", preferred: false, costSourceAmbiguous: false,
          currentOffer: null, latestLegacyOffer: null, offerCount: 0, active: true,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`— ${n} relação\\(ões\\)$`),
    vazio: /Nenhuma relação item × fornecedor/,
    gestos: [
      busca("Buscar"),
      seletor("homologação", "Filtrar por homologação", "APPROVED", (f) =>
        expect(f).toMatchObject({ qualificationStatus: "APPROVED" }),
      ),
      entidade("fornecedor", "Filtrar por fornecedor", "FOR-000001", (f) =>
        expect(f).toMatchObject({ supplierId: "sup-1" }),
      ),
      seletor("família", "Filtrar por família", "VITAMIN", (f) => expect(f).toMatchObject({ itemFamily: "VITAMIN" })),
      caixa("preferenciais", "Só preferenciais", (f) => expect(f).toMatchObject({ preferred: true })),
      caixa("ativas", "Só ativas", (f) => expect(f).not.toHaveProperty("active")),
    ],
  },
  {
    nome: "Formulações",
    Componente: FormulationsPage,
    consulta: listFormulations,
    resposta: (codigo, total) => ({
      formulations: [
        {
          productId: codigo, productCode: codigo, productName: "Produto Um", customerName: null,
          finishedProductItemId: null, finishedProductItemCode: null, activeVersionLabel: null, hasFormulation: false,
          updatedAt: INSTANTE,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} produtos?$`),
    vazio: /Nenhum produto encontrado/,
    gestos: [busca("Buscar produtos"), busca("Buscar produtos", "Y-8")],
  },
  {
    nome: "Modelos de Formulação",
    Componente: FormulationTemplatesPage,
    consulta: listFormulationTemplates,
    resposta: (codigo, total) => ({
      templates: [
        {
          id: codigo, code: codigo, name: "Base", description: null, activeVersionNumber: null, hasDraft: false,
          basisQuantity: null, outputUnitCode: null, calculationMode: null, componentCount: 0, updatedAt: INSTANTE,
          archived: false,
        },
      ],
      ...pagina(total),
    }),
    contagem: null,
    vazio: /Nenhum modelo encontrado|A biblioteca ainda está vazia/,
    gestos: [
      busca("Buscar modelos"),
      caixa("arquivados", "Mostrar arquivados", (f) => expect(f).toMatchObject({ archived: true })),
    ],
  },
  {
    nome: "Recursos industriais",
    Componente: IndustrialResourcesPage,
    consulta: listIndustrialResources,
    resposta: (codigo, total) => ({
      resources: [
        { id: codigo, code: codigo, name: "Mão de obra", type: "LABOR", powerKw: null, currentRate: null, rateCount: 0, active: true },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} recursos?$`),
    vazio: /Nenhum recurso industrial/,
    gestos: [
      busca("Buscar recursos"),
      seletor("tipo", "Filtrar por tipo", "EQUIPMENT", (f) => expect(f).toMatchObject({ type: "EQUIPMENT" })),
      seletor("status", "Filtrar por status", "active", (f) => expect(f).toMatchObject({ active: true })),
    ],
  },
  {
    nome: "Modelos de Estrutura de Custo",
    Componente: CostTemplatesPage,
    consulta: listCostTemplates,
    resposta: (codigo, total) => ({
      templates: [
        {
          id: codigo, code: codigo, name: "Linha", resourceNames: [], activeVersionNumber: null, hasDraft: false,
          referenceOutputQuantity: null, referenceOutputUomCode: null, resourceCount: 0, additionalCostCount: 0,
          updatedAt: INSTANTE, archived: false,
        },
      ],
      ...pagina(total),
    }),
    contagem: null,
    vazio: /Nenhum modelo encontrado|A biblioteca ainda está vazia/,
    gestos: [
      busca("Buscar modelos de estrutura"),
      caixa("arquivados", "Mostrar arquivados", (f) => expect(f).toMatchObject({ archived: true })),
    ],
  },
  {
    nome: "Políticas de Precificação",
    Componente: PricingPoliciesPage,
    consulta: listPricingPolicies,
    resposta: (codigo, total) => ({
      policies: [
        {
          id: codigo, code: codigo, name: "Padrão", tierQuantities: [], activeVersionNumber: null, hasDraft: false,
          tierCount: 0, updatedAt: INSTANTE, archived: false,
        },
      ],
      ...pagina(total),
    }),
    contagem: null,
    vazio: /Nenhuma política encontrada|A biblioteca ainda está vazia/,
    gestos: [
      busca("Buscar políticas"),
      caixa("arquivados", "Mostrar arquivados", (f) => expect(f).toMatchObject({ archived: true })),
    ],
  },
  {
    nome: "Precificação",
    Componente: PricingListPage,
    consulta: listPricingVersions,
    resposta: (codigo, total) => ({
      pricingVersions: [
        {
          id: codigo, label: codigo, productId: "prd-1", productCode: "PROD-000001", productName: "Produto Um",
          customerName: null, status: "ACTIVE", calculationCode: "CALC-000001", industrialCostVersionLabel: "v1",
          costReferenceDate: "2026-09-10", costQuality: "NO_COST", tierCount: 1, activatedAt: INSTANTE,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} precificaç(ão|ões)$`),
    vazio: /Nenhuma precificação encontrada/,
    gestos: [
      busca("Buscar precificações"),
      seletor("situação", "Filtrar por situação", "DRAFT", (f) => expect(f).toMatchObject({ status: "DRAFT" })),
      seletor("qualidade", "Filtrar por qualidade do custo", "PARTIAL", (f) =>
        expect(f).toMatchObject({ quality: "PARTIAL" }),
      ),
    ],
  },
  {
    nome: "Roteiros de Produção",
    Componente: ProductionProfilesPage,
    consulta: listProductionProfiles,
    resposta: (codigo, total) => ({
      profiles: [
        {
          id: codigo, code: codigo, name: "Cápsulas", stepNames: [], activeVersionNumber: null, hasDraft: false,
          referenceQuantity: null, referenceUomCode: null, activeVersionId: null, defaultProductCount: 0,
          updatedAt: INSTANTE,
        },
      ],
      ...pagina(total),
    }),
    contagem: null,
    vazio: /Nenhum roteiro encontrado|Nenhum Roteiro de Produção/,
    gestos: [busca("Buscar roteiros"), busca("Buscar roteiros", "Y-8")],
  },
  {
    nome: "Estoque",
    Componente: InventoryOverviewPage,
    consulta: listInventory,
    resposta: (codigo, total) => ({
      items: [
        {
          itemId: codigo, itemCode: codigo, itemName: "Vitamina C", itemType: "RAW_MATERIAL", unitCode: "kg",
          onHand: "1", reserved: "0", available: "1", unavailable: [], onOrder: "0",
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} (item|itens)$`),
    vazio: /Nenhum item encontrado/,
    gestos: [
      busca("Buscar itens"),
      seletor("tipo", "Filtrar por tipo", "PACKAGING", (f) => expect(f).toMatchObject({ type: "PACKAGING" })),
      caixa("com estoque", "Somente com estoque", (f) => expect(f).toMatchObject({ onlyWithStock: true })),
    ],
  },
  {
    nome: "Movimentações",
    Componente: InventoryMovementsPage,
    consulta: listInventoryMovements,
    resposta: (codigo, total) => ({
      movements: [
        {
          id: codigo, occurredAt: INSTANTE, itemId: "itm-1", itemCode: codigo, itemName: "Vitamina C", lotId: null,
          lotCode: null, type: "RECEIPT_IN", quantity: "1", receiptId: null, receiptCode: null, shipmentId: null,
          shipmentCode: null, productionOrderId: null, productionOrderCode: null, projectSampleId: null,
          projectSampleCode: null, sourceType: "RECEIPT", createdBy: null, reason: null,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} movimentaç(ão|ões)$`),
    vazio: /Nenhuma movimentação/,
    gestos: [
      busca("Buscar movimentações"),
      seletor("tipo", "Filtrar por tipo", "LOSS", (f) => expect(f).toMatchObject({ type: "LOSS" })),
    ],
  },
  {
    nome: "Materiais de Clientes",
    Componente: CustomerMaterialsPage,
    consulta: listCustomerMaterials,
    resposta: (codigo, total) => ({
      rows: [
        {
          lotId: codigo, lotCode: codigo, customerId: "cli-1", customerCode: "CLI-000001", customerName: "Nutrifarm",
          itemId: "itm-1", itemCode: "MP-000001", itemName: "Vitamina C", supplierLot: null, expiryDate: null,
          location: null, onHand: "1", reserved: "0", available: "1", unitCode: "kg", status: "AVAILABLE",
          isExpired: false,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`— ${n} lote\\(s\\)$`),
    vazio: /Nenhum material de cliente/,
    gestos: [
      busca("Buscar material de cliente"),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
      seletor("qualidade", "Filtrar por qualidade", "AWAITING_RELEASE", (f) =>
        expect(f).toMatchObject({ status: "AWAITING_RELEASE" }),
      ),
      caixa("com saldo", "Somente com saldo", (f) => expect(f).not.toHaveProperty("onlyWithBalance")),
    ],
  },
  {
    nome: "Visão do Cliente (busca)",
    Componente: ConsultationSearchPage,
    consulta: listCustomers,
    resposta: (codigo, total) => ({ customers: [cliente(codigo)], ...pagina(total) }),
    contagem: (n) => new RegExp(`^${n} clientes?$`),
    vazio: /Nenhum cliente encontrado/,
    gestos: [busca("Buscar clientes"), busca("Buscar clientes", "Y-8")],
  },
];

/* ---------- consulta pendente ---------- */

let pendentes: { filtros: Filtros; responder: (r: unknown) => void; recusar: (e: unknown) => void }[];

const codigo = (lista: Lista, n: number) => `${lista.nome.slice(0, 3).toUpperCase()}-9${String(n).padStart(5, "0")}`;

async function responder(lista: Lista, indice: number, n: number) {
  await act(async () => pendentes[indice]!.responder(lista.resposta(codigo(lista, n), TOTAL)));
}

async function recusar(indice: number) {
  await act(async () => pendentes[indice]!.recusar(new Error("Serviço indisponível.")));
}

/** A mesma resposta, sem nenhuma linha: o vazio de verdade. */
function semLinhas(lista: Lista): Record<string, unknown> {
  const corpo = lista.resposta(codigo(lista, 0), 0);
  for (const chave of Object.keys(corpo)) if (Array.isArray(corpo[chave])) corpo[chave] = [];
  return corpo;
}

async function abrir(lista: Lista, rota = "/") {
  vi.mocked(lista.consulta as (f: Filtros) => Promise<unknown>).mockImplementation(
    (filtros) =>
      new Promise((responder, recusar) => {
        pendentes.push({ filtros, responder, recusar });
      }),
  );
  const { Componente } = lista;
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Componente />
    </MemoryRouter>,
  );
  // As opções dos filtros por entidade e os catálogos de apoio chegam; a lista continua pendente.
  await flush();
  expect(pendentes).toHaveLength(1);
}

/** A linha está na tela? Códigos de largura fixa: um não é pedaço do outro. */
const naTela = (texto: string) => (document.body.textContent ?? "").includes(texto);

function semResposta(lista: Lista) {
  expect(screen.queryByText(lista.vazio)).toBeNull();
  if (lista.contagem) expect(screen.queryByText(lista.contagem("\\d+"))).toBeNull();
  expect(screen.queryByText(PAGINACAO)).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  // Sem `waitFor`/`findBy`: a pausa da busca é medida no relógio falso.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(AGORA);
  pendentes = [];
  vi.mocked(listUnits).mockResolvedValue([] as never);
  // Fontes dos filtros por entidade; na tela cuja lista é a mesma função, `abrir` a troca pela consulta pendente.
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [{ id: "cli-1", code: "CLI-000001", legalName: "Nutrifarm", tradeName: null, cnpj: null, active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listSuppliers).mockResolvedValue({
    suppliers: [{ id: "sup-1", code: "FOR-000001", legalName: "Fornecedor Um", tradeName: null, active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listItems).mockResolvedValue({
    items: [{ id: "itm-1", code: "MP-000001", name: "Vitamina C", unitCode: "kg", active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ id: "prd-1", code: "PROD-000001", name: "Produto Um", customer: null, active: true }],
    ...pagina(1),
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(LISTAS)("$nome", (lista) => {
  it("primeira carga e cada filtro: nada do recorte anterior enquanto o novo carrega, uma consulta por gesto", async () => {
    await abrir(lista);
    // Antes da primeira resposta: carregando, e nenhum "nenhum registro", total ou página.
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
    semResposta(lista);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await responder(lista, 0, 0);
    expect(naTela(codigo(lista, 0))).toBe(true);
    if (lista.contagem) expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 1 de 3");
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();

    let anterior = codigo(lista, 0);
    for (const [indice, gesto] of lista.gestos.entries()) {
      const antes = pendentes.length;
      await gesto.aplicar();
      expect(pendentes, `${gesto.nome}: uma consulta`).toHaveLength(antes + 1);
      const filtros = pendentes[antes]!.filtros;
      gesto.espera(filtros);
      expect(filtros).toMatchObject({ page: 1 });

      // Durante: nada de A se passando pelo recorte novo.
      expect(naTela(anterior), `${gesto.nome}: linha anterior`).toBe(false);
      expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
      semResposta(lista);
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

      const novo = codigo(lista, indice + 1);
      await responder(lista, antes, indice + 1);
      expect(naTela(novo)).toBe(true);
      if (lista.contagem) expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
      expect(screen.queryByText(CARREGANDO)).toBeNull();
      expect(pendentes).toHaveLength(antes + 1);
      anterior = novo;
    }
  });

  it("outra página do mesmo recorte: a aberta fica até a próxima chegar; filtro depois dela volta à 1 numa consulta", async () => {
    await abrir(lista);
    await responder(lista, 0, 0);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filtros).toMatchObject({ page: 2 });
    // O recorte é o mesmo: linhas, total e páginas continuam, sem esvaziar a tabela.
    expect(naTela(codigo(lista, 0))).toBe(true);
    if (lista.contagem) expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
    expect(screen.getByText(PAGINACAO)).toBeInTheDocument();
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await responder(lista, 1, 1);
    expect(naTela(codigo(lista, 1))).toBe(true);
    expect(naTela(codigo(lista, 0))).toBe(false);
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 2 de 3");

    // A página voltava à 1 por efeito: saía a página 2 do filtro novo, e depois a 1.
    await lista.gestos[1].aplicar();
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.filtros).toMatchObject({ page: 1 });
    expect(naTela(codigo(lista, 1))).toBe(false);
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
    await flush();
    expect(pendentes).toHaveLength(3);
  });

  it("respostas fora de ordem: filtro A, B e C respondendo C, B, A — só C vira tela", async () => {
    await abrir(lista);
    await lista.gestos[0].aplicar();
    await lista.gestos[1].aplicar();
    expect(pendentes).toHaveLength(3);

    await responder(lista, 2, 3);
    expect(naTela(codigo(lista, 3))).toBe(true);

    await responder(lista, 1, 2);
    expect(naTela(codigo(lista, 2))).toBe(false);
    expect(naTela(codigo(lista, 3))).toBe(true);

    await responder(lista, 0, 1);
    expect(naTela(codigo(lista, 1))).toBe(false);
    expect(naTela(codigo(lista, 3))).toBe(true);
    expect(screen.queryByText(CARREGANDO)).toBeNull();
  });

  it("falha: o alerta, sem vazio falso, sem carregando e sem linhas, total ou páginas de outro recorte", async () => {
    await abrir(lista);
    // Primeira carga que falha.
    await recusar(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    semResposta(lista);

    // A consulta seguinte tira o alerta enquanto carrega.
    await lista.gestos[0].aplicar();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
    await responder(lista, 1, 1);
    expect(naTela(codigo(lista, 1))).toBe(true);

    // Recorte novo que falha: as linhas do anterior não ficam debaixo do alerta.
    await lista.gestos[1].aplicar();
    await recusar(2);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Serviço indisponível.");
    expect(naTela(codigo(lista, 1))).toBe(false);
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    semResposta(lista);

    // O alerta fica entre a busca e a tabela que ficou sem linhas.
    const tabela = document.querySelector(".table-container")!;
    const seguinte = (antes: Node, depois: Node) =>
      Boolean(antes.compareDocumentPosition(depois) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(seguinte(screen.getByRole("searchbox"), alerta)).toBe(true);
    expect(seguinte(alerta, tabela)).toBe(true);
  });

  it("vazio real: só com a resposta do recorte, e sem carregando nem alerta junto", async () => {
    await abrir(lista);
    expect(screen.queryByText(lista.vazio)).toBeNull();

    await act(async () => pendentes[0]!.responder(semLinhas(lista)));
    expect(screen.getByText(lista.vazio)).toBeInTheDocument();
    if (lista.contagem) expect(screen.getByText(lista.contagem("0"))).toBeInTheDocument();
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(pendentes).toHaveLength(1);

    // O vazio é do recorte que respondeu: filtro novo não o herda enquanto carrega.
    await lista.gestos[1].aplicar();
    expect(screen.queryByText(lista.vazio)).toBeNull();
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
  });
});

describe("chegada por link de contexto", () => {
  const clientes = LISTAS.find((lista) => lista.nome === "Clientes")!;
  const produtos = LISTAS.find((lista) => lista.nome === "Produtos Acabados")!;

  it("Clientes com `?ids=`: uma consulta só, pelo registro citado e sem a situação comercial padrão", async () => {
    await abrir(clientes, "/cadastros/clientes?ids=cli-9");
    expect(pendentes[0]!.filtros).toEqual({ ids: ["cli-9"], page: 1, pageSize: 20 });
    // O contexto limpa os filtros da tela por efeito; o recorte consultado não muda, e não sai outra consulta.
    await flush();
    expect(pendentes).toHaveLength(1);
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();

    await responder(clientes, 0, 0);
    expect(naTela(codigo(clientes, 0))).toBe(true);
    expect(screen.getByText(/Mostrando apenas o cliente/)).toHaveTextContent(codigo(clientes, 0));
  });

  it("Produtos com `?productId=`: o produto do aviso vem da resposta do próprio recorte", async () => {
    await abrir(produtos, "/cadastros/produtos?productId=PRO-900000");
    expect(pendentes[0]!.filtros).toEqual({ productId: "PRO-900000", page: 1, pageSize: 20 });
    expect(screen.getByText(/Mostrando apenas o produto/)).toHaveTextContent("selecionado");

    await responder(produtos, 0, 0);
    expect(screen.getByText(/Mostrando apenas o produto/)).toHaveTextContent(codigo(produtos, 0));
    await flush();
    expect(pendentes).toHaveLength(1);
  });
});
