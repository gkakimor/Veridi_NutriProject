import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PAUSA_DO_PERIODO_MS } from "../components/filters/DateRangeFilter";

/**
 * Listas — o resultado do filtro anterior não se passa pelo do filtro novo
 * (LISTS-LOADING-STALE-DATA-01).
 *
 * Cada lista guardava linhas, total e erro até a resposta seguinte chegar:
 * trocar a busca, o status, o cliente, o fornecedor ou o período deixava a
 * tabela, o total e as páginas do recorte velho à vista, sem nada dizendo que
 * a consulta nova ainda não tinha voltado. A resposta que chegasse por último
 * virava a tela, mesmo sendo de um filtro já trocado; a falha aparecia junto
 * das linhas de antes.
 *
 * Agora (`useListQuery` + `ListStatusRow`): recorte novo mostra "Carregando…"
 * e nada do anterior; só a consulta atual vira estado; falha é o alerta, sem
 * linhas, total, páginas ou "nenhum registro"; trocar de PÁGINA mantém a
 * página aberta até a próxima chegar. O mecanismo é provado em
 * `lib/list-query.test.tsx`; aqui, que cada tela o usa com os filtros que tem.
 * Período recusado segue em `periodo-invertido-listas.test.tsx`.
 *
 * Data digitada (LISTS-LOADING-DATES-GESTURE-01): desde LISTS-FILTER-INPUT-UX-01
 * o `DateRangeFilter` só aplica a data depois de `PAUSA_DO_PERIODO_MS` sem
 * digitar, ou no Enter — no Chromium cada tecla passa por valores do meio, e
 * cada um era uma consulta. O gesto "datas" daqui continuou disparando um
 * `change` só e contando a consulta na hora, sem pausa: caía em Faturamento,
 * Recebimentos, Ordens de Compra e Produto Acabado com 4 consultas em vez de 5.
 * A tela estava certa; o gesto agora é o da pessoa — digita, para — e confere
 * as duas pontas da pausa. O fim deste arquivo prova o período digitado com
 * outra consulta em curso: página, URL, sessão e resposta atrasada.
 */

vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));
vi.mock("../lib/billings-api", async (original) => ({
  ...(await original<object>()),
  listBillings: vi.fn(),
  listAwaitingBilling: vi.fn(),
}));
vi.mock("../lib/receiving-api", async (original) => ({ ...(await original<object>()), listReceipts: vi.fn() }));
vi.mock("../lib/purchase-orders-api", async (original) => ({
  ...(await original<object>()),
  listPurchaseOrders: vi.fn(),
}));
vi.mock("../lib/finished-goods-api", async (original) => ({
  ...(await original<object>()),
  listFinishedGoods: vi.fn(),
}));
vi.mock("../lib/projects-api", async (original) => ({
  ...(await original<object>()),
  listProjects: vi.fn(),
  getProjectVocabulary: vi.fn(),
}));
vi.mock("../lib/samples-api", async (original) => ({ ...(await original<object>()), listSamples: vi.fn() }));
vi.mock("../lib/customer-orders-api", async (original) => ({
  ...(await original<object>()),
  listCustomerOrders: vi.fn(),
}));
vi.mock("../lib/shipments-api", async (original) => ({ ...(await original<object>()), listShipments: vi.fn() }));
vi.mock("../lib/production-orders-api", async (original) => ({
  ...(await original<object>()),
  listProductionOrders: vi.fn(),
}));
vi.mock("../lib/lots-api", async (original) => ({ ...(await original<object>()), listLots: vi.fn() }));
vi.mock("../lib/attachments-api", async (original) => ({
  ...(await original<object>()),
  listQualityQueue: vi.fn(),
  approveCoa: vi.fn(),
}));
vi.mock("../lib/customers-api", async (original) => ({ ...(await original<object>()), listCustomers: vi.fn() }));
vi.mock("../lib/suppliers-api", async (original) => ({ ...(await original<object>()), listSuppliers: vi.fn() }));
vi.mock("../lib/products-api", async (original) => ({ ...(await original<object>()), listProducts: vi.fn() }));
vi.mock("../lib/items-api", async (original) => ({ ...(await original<object>()), listItems: vi.fn() }));

import { approveCoa, listQualityQueue } from "../lib/attachments-api";
import { listAwaitingBilling, listBillings } from "../lib/billings-api";
import { listCustomerOrders } from "../lib/customer-orders-api";
import { listCustomers } from "../lib/customers-api";
import { listFinishedGoods } from "../lib/finished-goods-api";
import { listItems } from "../lib/items-api";
import { listLots } from "../lib/lots-api";
import { listProducts } from "../lib/products-api";
import { listProductionOrders } from "../lib/production-orders-api";
import { getProjectVocabulary, listProjects } from "../lib/projects-api";
import { listPurchaseOrders } from "../lib/purchase-orders-api";
import { listReceipts } from "../lib/receiving-api";
import { listSamples } from "../lib/samples-api";
import { listShipments } from "../lib/shipments-api";
import { listSuppliers } from "../lib/suppliers-api";
import { BillingsPage } from "./billings/BillingsPage";
import { CustomerOrdersPage } from "./customer-orders/CustomerOrdersPage";
import { FinishedGoodsPage } from "./finished-goods/FinishedGoodsPage";
import { LotsPage } from "./lots/LotsPage";
import { PickingConsumptionPage } from "./production-orders/PickingConsumptionPage";
import { ProductionOrdersPage } from "./production-orders/ProductionOrdersPage";
import { ProjectsPage } from "./projects/ProjectsPage";
import { PurchaseOrdersPage } from "./purchase-orders/PurchaseOrdersPage";
import { CoaQueuePage } from "./quality/CoaQueuePage";
import { ReceiptsPage } from "./receiving/ReceiptsPage";
import { SamplesPage } from "./samples/SamplesPage";
import { ShipmentsPage } from "./shipments/ShipmentsPage";

type Filtros = Record<string, unknown>;

/** 11/09/2026 às 12:00 em São Paulo: "Mês atual" do Faturamento é 01/09..11/09. */
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
  resposta: (codigo: string, total: number) => unknown;
  /**
   * O total como a tela escreve, para `n` registros. Com `\d+` casa qualquer
   * total — inclusive o "0" de uma resposta que ainda não chegou.
   */
  contagem: (n: string) => RegExp;
  /** O vazio da tela — nunca antes da resposta, nunca junto de uma falha. */
  vazio: RegExp;
  csv: boolean;
  gestos: [Gesto, Gesto, ...Gesto[]];
}

/* ---------- gestos ---------- */

async function flush() {
  await act(async () => {});
}

function busca(rotulo: string): Gesto {
  return {
    nome: "busca",
    aplicar: async () => {
      fireEvent.change(screen.getByLabelText(rotulo), { target: { value: "X-9" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
    },
    espera: (filtros) => expect(filtros).toMatchObject({ search: "X-9" }),
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

function esperar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

interface GestoDeDatas extends Gesto {
  /** O rótulo da data inicial e o dia digitado nela. */
  rotuloDe: string;
  dia: string;
}

/**
 * "Personalizado" (semeado com o período da tela, sem consulta), a data inicial
 * digitada e a pausa. 1 ms antes da pausa nada foi consultado — nem o semear,
 * nem a data —; na pausa sai a consulta.
 */
function periodo(rotuloDe: string, dia: string, espera: Gesto["espera"]): GestoDeDatas {
  return {
    nome: "datas",
    rotuloDe,
    dia,
    aplicar: async () => {
      const antes = pendentes.length;
      fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
      fireEvent.change(screen.getByLabelText(rotuloDe), { target: { value: dia } });
      esperar(PAUSA_DO_PERIODO_MS - 1);
      expect(pendentes, "datas: nada antes da pausa").toHaveLength(antes);
      esperar(1);
    },
    espera,
  };
}

/* ---------- linhas ---------- */

const pagina = (total: number) => ({ page: 1, pageSize: 20, total });

function ordemDeProducao(codigo: string, status: string) {
  return {
    id: codigo, code: codigo, productId: "prd-1", productCode: "PROD-000001", productName: "Produto Um",
    customerId: null, customerCode: null, customerName: null, customerOrderId: null, customerOrderCode: null,
    formulationVersionLabel: "v1", plannedQuantity: "100", outputUnitCode: "un",
    materialsStatus: "MATERIALS_AVAILABLE", shortageItemCount: 0, status, createdAt: INSTANTE, planning: null,
    requirements: [],
  };
}

const LISTAS: Lista[] = [
  {
    nome: "Faturamento",
    Componente: BillingsPage,
    consulta: listBillings,
    resposta: (codigo, total) => ({
      billings: [
        {
          id: codigo, code: codigo, shipmentId: "shp-1", shipmentCode: "EXP-000001", customerOrderId: "co-1",
          customerOrderCode: "PED-000001", customerId: "cli-1", customerName: "Nutrifarm", totalQuantity: "1",
          totalAmount: "10.00", status: "ISSUED", issuedAt: INSTANTE,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} faturamentos?$`),
    vazio: /Nenhum faturamento/,
    csv: true,
    gestos: [
      busca("Buscar faturamentos"),
      seletor("status", "Filtrar por status", "ISSUED", (f) => expect(f).toMatchObject({ status: "ISSUED" })),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
      periodo("Emitido a partir de", "2026-08-15", (f) =>
        expect(f).toMatchObject({ dateFrom: "2026-08-15", dateTo: "2026-09-11" }),
      ),
    ],
  },
  {
    nome: "Recebimentos",
    Componente: ReceiptsPage,
    consulta: listReceipts,
    resposta: (codigo, total) => ({
      receipts: [
        {
          id: codigo, code: codigo, sourceType: "PURCHASE_ORDER", purchaseOrderId: "po-1",
          purchaseOrderCode: "OC-000001", supplierId: "sup-1", supplierName: "Fornecedor Um", customerId: null,
          customerName: null, receivedAt: INSTANTE, lines: [],
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} recebimentos?$`),
    vazio: /Nenhum recebimento/,
    csv: true,
    gestos: [
      busca("Buscar recebimentos"),
      seletor("origem", "Filtrar por origem", "CUSTOMER_SUPPLIED", (f) =>
        expect(f).toMatchObject({ sourceType: "CUSTOMER_SUPPLIED" }),
      ),
      entidade("fornecedor", "Filtrar por fornecedor", "FOR-000001", (f) =>
        expect(f).toMatchObject({ supplierId: "sup-1" }),
      ),
      periodo("Recebido a partir de", "2026-09-01", (f) => {
        expect(f).toMatchObject({ dateFrom: "2026-09-01" });
        expect(f).not.toHaveProperty("dateTo");
      }),
    ],
  },
  {
    nome: "Ordens de Compra",
    Componente: PurchaseOrdersPage,
    consulta: listPurchaseOrders,
    resposta: (codigo, total) => ({
      purchaseOrders: [
        {
          id: codigo, code: codigo, supplierId: "sup-1", supplierCode: "FOR-000001", supplierName: "Fornecedor Um",
          orderDate: "2026-09-10T00:00:00.000Z", expectedDeliveryDate: null, lines: [], orderTotal: "10.00",
          status: "ORDERED",
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} orde(m|ns) de compra$`),
    vazio: /Nenhuma ordem de compra/,
    csv: true,
    gestos: [
      busca("Buscar ordens de compra"),
      seletor("status", "Filtrar por status", "RECEIVED", (f) => expect(f).toMatchObject({ status: ["RECEIVED"] })),
      entidade("fornecedor", "Filtrar por fornecedor", "FOR-000001", (f) =>
        expect(f).toMatchObject({ supplierId: "sup-1" }),
      ),
      periodo("Pedido a partir de", "2026-09-01", (f) => expect(f).toMatchObject({ dateFrom: "2026-09-01" })),
    ],
  },
  {
    nome: "Produto Acabado",
    Componente: FinishedGoodsPage,
    consulta: listFinishedGoods,
    resposta: (codigo, total) => ({
      rows: [
        {
          lotId: codigo, lotCode: codigo, businessLotNumber: null, productId: "prd-1", productCode: "PROD-000001",
          productName: "Produto Um", itemId: "itm-9", itemCode: "PA-000001", itemName: "Produto Um", unitCode: "un",
          productionOrderId: "op-1", productionOrderCode: "OP-000001", producedAt: INSTANTE, producedQuantity: "1",
          onHand: "1", reserved: "0", available: "1", status: "AVAILABLE", isExpired: false, expiryDate: null,
          location: null, materialUnitCost: null, costQuality: "NO_COST", costSource: null,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} lotes? produzidos?$`),
    vazio: /Nenhum produto acabado/,
    csv: true,
    gestos: [
      busca("Buscar produto acabado"),
      seletor("qualidade", "Filtrar por qualidade", "AVAILABLE", (f) => expect(f).toMatchObject({ status: "AVAILABLE" })),
      entidade("produto", "Filtrar por produto", "PROD-000001", (f) => expect(f).toMatchObject({ productId: "prd-1" })),
      periodo("Produzido a partir de", "2026-09-01", (f) => expect(f).toMatchObject({ dateFrom: "2026-09-01" })),
    ],
  },
  {
    nome: "Projetos",
    Componente: ProjectsPage,
    consulta: listProjects,
    resposta: (codigo, total) => ({
      projects: [
        {
          id: codigo, code: codigo, name: "Projeto Um", externalCode: null, entryDate: "2026-09-10",
          customerId: "cli-1", customerCode: "CLI-000001", customerName: "Nutrifarm", concept: null, channel: null,
          responsibleUserName: null, latestQuoteLabel: null, status: "APPROVED", productCode: null,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`— ${n} projeto\\(s\\)$`),
    vazio: /Nenhum projeto/,
    csv: true,
    gestos: [
      busca("Buscar projetos"),
      seletor("status", "Filtrar por status", "APPROVED", (f) => expect(f).toMatchObject({ status: "APPROVED" })),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
      seletor("canal", "Filtrar por canal", "Farma", (f) => expect(f).toMatchObject({ channel: "Farma" })),
    ],
  },
  {
    nome: "Amostras",
    Componente: SamplesPage,
    consulta: listSamples,
    resposta: (codigo, total) => ({
      samples: [
        {
          id: codigo, code: codigo, testLabel: "T1", projectId: "prj-1", projectCode: "PRJ-000001",
          projectName: "Projeto Um", productId: null, productCode: null, productName: null, customerId: "cli-1",
          customerName: "Nutrifarm", description: null, status: "APPROVED", consumptions: [], producedAt: INSTANTE,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`— ${n} amostra\\(s\\)$`),
    vazio: /Nenhuma amostra/,
    csv: true,
    gestos: [
      busca("Buscar amostras"),
      seletor("status", "Filtrar por status", "APPROVED", (f) => expect(f).toMatchObject({ status: "APPROVED" })),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
    ],
  },
  {
    nome: "Pedidos",
    Componente: CustomerOrdersPage,
    consulta: listCustomerOrders,
    resposta: (codigo, total) => ({
      customerOrders: [
        {
          id: codigo, code: codigo, customerId: "cli-1", customerName: "Nutrifarm", orderDate: INSTANTE,
          requestedDeliveryDate: null, status: "CONFIRMED", billingStatus: "NOT_BILLED", lines: [],
          reservation: null, generatedProductionOrders: [],
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} pedidos?$`),
    vazio: /Nenhum pedido/,
    csv: true,
    gestos: [
      busca("Buscar pedidos"),
      seletor("status", "Filtrar por status", "todos", (f) => expect(f).not.toHaveProperty("status")),
      entidade("cliente", "Filtrar por cliente", "CLI-000001", (f) => expect(f).toMatchObject({ customerId: "cli-1" })),
    ],
  },
  {
    nome: "Expedições",
    Componente: ShipmentsPage,
    consulta: listShipments,
    resposta: (codigo, total) => ({
      shipments: [
        {
          id: codigo, code: codigo, customerOrderId: "co-1", customerOrderCode: "PED-000001", customerId: "cli-1",
          customerName: "Nutrifarm", shipmentDate: INSTANTE, totalQuantity: "1", status: "DRAFT",
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} expediç(ão|ões)$`),
    vazio: /Nenhuma expedição/,
    csv: true,
    gestos: [
      busca("Buscar expedições"),
      seletor("status", "Filtrar por status", "CONFIRMED", (f) => expect(f).toMatchObject({ status: "CONFIRMED" })),
      entidade("pedido", "Filtrar por pedido", "PED-000001", (f) => expect(f).toMatchObject({ customerOrderId: "co-1" })),
    ],
  },
  {
    nome: "Ordens de Produção",
    Componente: ProductionOrdersPage,
    consulta: listProductionOrders,
    resposta: (codigo, total) => ({ productionOrders: [ordemDeProducao(codigo, "PLANNED")], ...pagina(total) }),
    contagem: (n) => new RegExp(`^${n} orde(m|ns) de produção$`),
    vazio: /Nenhuma ordem de produção/,
    csv: true,
    gestos: [
      busca("Buscar ordens de produção"),
      seletor("status", "Filtrar por status", "todos", (f) => expect(f).not.toHaveProperty("status")),
      seletor("roteiro", "Filtrar por roteiro de produção", "1", (f) => expect(f).toMatchObject({ semRoteiro: true })),
      entidade("produto", "Filtrar por produto", "PROD-000001", (f) => expect(f).toMatchObject({ productId: "prd-1" })),
    ],
  },
  {
    nome: "Lotes",
    Componente: LotsPage,
    consulta: listLots,
    resposta: (codigo, total) => ({
      lots: [
        {
          id: codigo, code: codigo, itemId: "itm-1", itemCode: "MP-000001", itemName: "Vitamina C",
          status: "AVAILABLE", isExpired: false, ownerType: "VERIDI", ownerCustomerName: null, supplierLot: null,
          supplierId: null, supplierCode: null, supplierName: null, businessLotNumber: null,
          initialReceivedQuantity: "10", unitCode: "kg", expiryDate: null, location: null, origin: "RECEIPT",
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`^${n} lotes?$`),
    vazio: /Nenhum lote/,
    csv: true,
    gestos: [
      busca("Buscar lotes"),
      seletor("status", "Filtrar por status", "AVAILABLE", (f) => expect(f).toMatchObject({ status: "AVAILABLE" })),
      seletor("proprietário", "Filtrar por proprietário", "CUSTOMER", (f) =>
        expect(f).toMatchObject({ ownerType: "CUSTOMER" }),
      ),
      entidade("item", "Filtrar por item", "MP-000001", (f) => expect(f).toMatchObject({ itemId: "itm-1" })),
    ],
  },
  {
    nome: "Documentos / CoA",
    Componente: CoaQueuePage,
    consulta: listQualityQueue,
    resposta: (codigo, total) => ({
      rows: [
        {
          lotId: codigo, lotCode: codigo, itemId: "itm-1", itemCode: "MP-000001", itemName: "Vitamina C",
          sourceName: null, ownerType: "VERIDI", ownerCustomerName: null, supplierName: "Fornecedor Um",
          receivedAt: INSTANTE, expiryDate: null, coaStatus: "PENDING", coaReviewNote: null, isExpired: false,
          lotStatus: "AVAILABLE", onHand: "1", unitCode: "kg", requiresCoa: true,
        },
      ],
      ...pagina(total),
    }),
    contagem: (n) => new RegExp(`— ${n} lote\\(s\\)$`),
    vazio: /Nenhum lote nesta situação/,
    csv: false,
    gestos: [
      busca("Buscar lote ou item"),
      seletor("situação", "Filtrar por situação documental", "todos", (f) => expect(f).not.toHaveProperty("onlyPending")),
      {
        nome: "saldo",
        aplicar: async () => {
          fireEvent.click(screen.getByLabelText("Somente com saldo"));
        },
        espera: (f) => expect(f).toMatchObject({ onlyWithBalance: true }),
      },
    ],
  },
  {
    nome: "Picking / Consumo",
    Componente: PickingConsumptionPage,
    consulta: listProductionOrders,
    resposta: (codigo, total) => ({ productionOrders: [ordemDeProducao(codigo, "RELEASED")], ...pagina(total) }),
    contagem: (n) => new RegExp(`^${n} orde(m|ns)$`),
    vazio: /Nenhuma ordem/,
    csv: false,
    gestos: [
      busca("Buscar ordens de produção"),
      seletor("situação", "Filtrar por situação", "liberada", (f) => expect(f).toMatchObject({ status: ["RELEASED"] })),
      entidade("produto", "Filtrar por produto", "PROD-000001", (f) => expect(f).toMatchObject({ productId: "prd-1" })),
    ],
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

/** A query string da tela, como a URL está agora. */
let endereco = "";

function Endereco() {
  endereco = useLocation().search;
  return null;
}

async function abrir(lista: Lista, inicial = "/") {
  vi.mocked(lista.consulta as (f: Filtros) => Promise<unknown>).mockImplementation(
    (filtros) =>
      new Promise((responder, recusar) => {
        pendentes.push({ filtros, responder, recusar });
      }),
  );
  const { Componente } = lista;
  render(
    <MemoryRouter initialEntries={[inicial]}>
      <Componente />
      <Endereco />
    </MemoryRouter>,
  );
  // As opções dos filtros por entidade chegam; a lista continua pendente.
  await flush();
  expect(pendentes).toHaveLength(1);
}

/** A linha está na tela? Códigos de largura fixa: um não é pedaço do outro. */
const naTela = (texto: string) => (document.body.textContent ?? "").includes(texto);

function semResposta(lista: Lista) {
  expect(screen.queryByText(lista.vazio)).toBeNull();
  expect(screen.queryByText(lista.contagem("\\d+"))).toBeNull();
  expect(screen.queryByText(PAGINACAO)).toBeNull();
}

function conferirCsv(filtros: Filtros) {
  const esperado = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (chave === "page" || chave === "pageSize" || valor === undefined || valor === "") continue;
    esperado.set(chave, Array.isArray(valor) ? valor.join(",") : String(valor));
  }
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  const noLink = new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid").searchParams;
  esperado.sort();
  noLink.sort();
  expect(noLink.toString()).toBe(esperado.toString());
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  // Sem `waitFor`/`findBy`: a pausa da busca é medida no relógio falso.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(AGORA);
  pendentes = [];
  vi.mocked(listAwaitingBilling).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getProjectVocabulary).mockResolvedValue({ concepts: [], channels: ["Farma"] } as never);
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [{ id: "cli-1", code: "CLI-000001", legalName: "Nutrifarm", tradeName: null, cnpj: null, active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listSuppliers).mockResolvedValue({
    suppliers: [{ id: "sup-1", code: "FOR-000001", legalName: "Fornecedor Um", tradeName: null, active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ id: "prd-1", code: "PROD-000001", name: "Produto Um", customer: null, active: true }],
    ...pagina(1),
  } as never);
  vi.mocked(listItems).mockResolvedValue({
    items: [{ id: "itm-1", code: "MP-000001", name: "Vitamina C", unitCode: "kg", active: true }],
    ...pagina(1),
  } as never);
  // A fonte do filtro "Pedido" das Expedições; na tela de Pedidos, `abrir` a troca pela consulta pendente.
  vi.mocked(listCustomerOrders).mockResolvedValue({
    customerOrders: [{ id: "co-1", code: "PED-000001", customerId: "cli-1", customerName: "Nutrifarm" }],
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
    expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
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
      // O CSV já é o do filtro atual, não o da tabela que carregava.
      if (lista.csv) conferirCsv(filtros);

      const novo = codigo(lista, indice + 1);
      await responder(lista, antes, indice + 1);
      expect(naTela(novo)).toBe(true);
      expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
      expect(screen.queryByText(CARREGANDO)).toBeNull();
      expect(pendentes).toHaveLength(antes + 1);
      anterior = novo;
    }
  });

  it("outra página do mesmo recorte: a aberta fica até a próxima chegar; filtro depois dela volta à 1", async () => {
    await abrir(lista);
    await responder(lista, 0, 0);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filtros).toMatchObject({ page: 2 });
    // O recorte é o mesmo: linhas, total e páginas continuam, sem esvaziar a tabela.
    expect(naTela(codigo(lista, 0))).toBe(true);
    expect(screen.getByText(lista.contagem(String(TOTAL)))).toBeInTheDocument();
    expect(screen.getByText(PAGINACAO)).toBeInTheDocument();
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await responder(lista, 1, 1);
    expect(naTela(codigo(lista, 1))).toBe(true);
    expect(naTela(codigo(lista, 0))).toBe(false);
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 2 de 3");

    await lista.gestos[1].aplicar();
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.filtros).toMatchObject({ page: 1 });
    expect(naTela(codigo(lista, 1))).toBe(false);
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
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

    // O alerta fica entre a barra de filtros e a tabela que ficou sem linhas — à
    // vista de quem acabou de filtrar, não no topo da página.
    const tabelas = document.querySelectorAll(".table-container");
    const tabelaDaLista = tabelas[tabelas.length - 1]!;
    const seguinte = (antes: Node, depois: Node) =>
      Boolean(antes.compareDocumentPosition(depois) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(seguinte(screen.getByRole("searchbox"), alerta)).toBe(true);
    expect(seguinte(alerta, tabelaDaLista)).toBe(true);
  });
});

/* ---------- período digitado com outra consulta em curso ---------- */

/** A data inicial guardada na sessão da tela (`veridi:filters:<usuário>:<tela>:dateFrom`). */
function dataInicialDaSessao(): string | null {
  const chave = Object.keys(sessionStorage).find(
    (guardada) => guardada.startsWith("veridi:filters:u-1:") && guardada.endsWith(":dateFrom"),
  );
  return chave === undefined ? null : (JSON.parse(sessionStorage.getItem(chave) ?? "null") as string);
}

const LISTAS_COM_PERIODO = LISTAS.flatMap((lista) => {
  const datas = lista.gestos.find((gesto): gesto is GestoDeDatas => gesto.nome === "datas");
  return datas ? [{ nome: lista.nome, lista, datas }] : [];
});

it("período digitado: as quatro listas com `DateRangeFilter` deste arquivo entram", () => {
  expect(LISTAS_COM_PERIODO.map(({ nome }) => nome)).toEqual([
    "Faturamento",
    "Recebimentos",
    "Ordens de Compra",
    "Produto Acabado",
  ]);
});

describe.each(LISTAS_COM_PERIODO)("$nome — período digitado", ({ lista, datas }) => {
  it("com a página seguinte carregando: nada até a pausa; nela, uma consulta na página 1, URL e sessão com a data, e a página atrasada não vira tela", async () => {
    // Já no Personalizado, pontas abertas, na página 2: o semear do botão fica fora deste caso.
    await abrir(lista, "/?period=custom&page=2");
    expect(pendentes[0]!.filtros).toMatchObject({ page: 2 });
    expect(pendentes[0]!.filtros).not.toHaveProperty("dateFrom");
    await responder(lista, 0, 0);
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 2 de 3");

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filtros).toMatchObject({ page: 3 });

    // Digitada com a página 3 em curso: ainda não é filtro — nem consulta, nem URL, nem sessão.
    fireEvent.change(screen.getByLabelText(datas.rotuloDe), { target: { value: datas.dia } });
    esperar(PAUSA_DO_PERIODO_MS - 1);
    expect(pendentes).toHaveLength(2);
    expect(new URLSearchParams(endereco).get("dateFrom")).toBeNull();
    expect(new URLSearchParams(endereco).get("page")).toBe("3");
    expect(dataInicialDaSessao()).toBeNull();
    // Mesmo recorte em outra página: a aberta continua à vista, ocupada.
    expect(naTela(codigo(lista, 0))).toBe(true);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    esperar(1);
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.filtros).toMatchObject({ dateFrom: datas.dia, page: 1 });
    const url = new URLSearchParams(endereco);
    expect(url.get("dateFrom")).toBe(datas.dia);
    expect(url.get("page")).toBeNull();
    expect(dataInicialDaSessao()).toBe(datas.dia);
    // Recorte novo: nada da página anterior enquanto carrega.
    expect(naTela(codigo(lista, 0))).toBe(false);
    expect(screen.getByText(CARREGANDO)).toBeInTheDocument();
    semResposta(lista);
    if (lista.csv) conferirCsv(pendentes[2]!.filtros);

    await responder(lista, 2, 2);
    expect(naTela(codigo(lista, 2))).toBe(true);
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 1 de 3");
    expect(screen.queryByText(CARREGANDO)).toBeNull();

    // A página 3 do recorte sem data responde por último: não sobrescreve a resposta nova.
    await responder(lista, 1, 1);
    expect(naTela(codigo(lista, 1))).toBe(false);
    expect(naTela(codigo(lista, 2))).toBe(true);
    expect(screen.getByText(PAGINACAO)).toHaveTextContent("Página 1 de 3");
    expect(screen.queryByText(CARREGANDO)).toBeNull();
    // Nenhuma pausa sobrando consulta de novo.
    esperar(PAUSA_DO_PERIODO_MS * 3);
    expect(pendentes).toHaveLength(3);
  });
});

describe("Documentos / CoA — Aprovar consulta de novo o mesmo recorte", () => {
  const coa = LISTAS.find((lista) => lista.nome === "Documentos / CoA")!;

  /** A mesma linha da fila, com o laudo recebido: é o que oferece "Aprovar". */
  function comLaudoRecebido(n: number) {
    const corpo = coa.resposta(codigo(coa, n), TOTAL) as { rows: Record<string, unknown>[] };
    return { ...corpo, rows: corpo.rows.map((linha) => ({ ...linha, coaStatus: "RECEIVED" })) };
  }

  it("a fila recarrega a mesma página, as linhas ficam até a resposta, e a falha da ação não esconde a fila", async () => {
    await abrir(coa);
    await act(async () => pendentes[0]!.responder(comLaudoRecebido(0)));
    expect(naTela(codigo(coa, 0))).toBe(true);

    vi.mocked(approveCoa).mockResolvedValueOnce(undefined as never);
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    await flush();
    expect(approveCoa).toHaveBeenCalledWith(codigo(coa, 0));
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.filtros).toEqual(pendentes[0]!.filtros);
    // Recarga do MESMO recorte: a fila à vista continua sendo a resposta dele.
    expect(naTela(codigo(coa, 0))).toBe(true);
    expect(screen.getByText(coa.contagem(String(TOTAL)))).toBeInTheDocument();
    expect(screen.queryByText(CARREGANDO)).toBeNull();

    await act(async () => pendentes[1]!.responder(comLaudoRecebido(1)));
    expect(naTela(codigo(coa, 1))).toBe(true);
    expect(naTela(codigo(coa, 0))).toBe(false);

    vi.mocked(approveCoa).mockRejectedValueOnce(new Error("Laudo já revisado."));
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Laudo já revisado.");
    expect(naTela(codigo(coa, 1))).toBe(true);
    expect(pendentes).toHaveLength(2);
  });
});
