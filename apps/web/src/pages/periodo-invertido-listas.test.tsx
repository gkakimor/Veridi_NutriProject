import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Listas com período — invertido não se consulta; ponta vazia é aberta
 * (PERIOD-RANGE-VALIDATION-WAVE-01).
 *
 * `/billings?dateFrom=2026-09-13&dateTo=2026-09-12` respondia 200 vazio e a
 * tela dizia "Nenhum faturamento encontrado para os filtros atuais" — pergunta
 * inválida lida como resposta. Agora o Personalizado com a data inicial depois
 * da final mostra a frase junto dos campos, não consulta, não mostra linhas,
 * total nem páginas de outro recorte, e o CSV não se oferece. Só a inicial, só
 * a final ou nenhuma consultam — nada completa a ponta vazia com hoje (essa é
 * regra só do Painel). O servidor recusa o mesmo em `api lib/periodo-invertido.test.ts`.
 */

vi.mock("../lib/billings-api", () => ({ listBillings: vi.fn(), listAwaitingBilling: vi.fn(), createBilling: vi.fn() }));
vi.mock("../lib/receiving-api", () => ({ listReceipts: vi.fn() }));
vi.mock("../lib/purchase-orders-api", () => ({ listPurchaseOrders: vi.fn() }));
vi.mock("../lib/finished-goods-api", () => ({ listFinishedGoods: vi.fn() }));
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listAwaitingBilling, listBillings } from "../lib/billings-api";
import { listCustomers } from "../lib/customers-api";
import { listFinishedGoods } from "../lib/finished-goods-api";
import { listProducts } from "../lib/products-api";
import { listPurchaseOrders } from "../lib/purchase-orders-api";
import { listReceipts } from "../lib/receiving-api";
import { clearStoredFilters } from "../lib/stored-filters";
import { listSuppliers } from "../lib/suppliers-api";
import { BillingsPage } from "./billings/BillingsPage";
import { FinishedGoodsPage } from "./finished-goods/FinishedGoodsPage";
import { PurchaseOrdersPage } from "./purchase-orders/PurchaseOrdersPage";
import { ReceiptsPage } from "./receiving/ReceiptsPage";

type Filtros = Record<string, unknown>;
type Consulta = (filters: Filtros) => Promise<unknown>;

interface Lista {
  nome: string;
  Componente: ComponentType;
  consulta: unknown;
  escopo: string;
  de: string;
  ate: string;
  /** Resposta com uma linha à vista e 45 registros — três páginas de 20. */
  resposta: Record<string, unknown>;
  /** O código da linha: com o período recusado, ela não pode ficar na tela. */
  codigo: string;
  contagem: string;
}

const TOTAL = 45;
const pagina = { page: 1, pageSize: 20, total: TOTAL };
const INSTANTE = "2026-09-10T15:00:00.000Z";

const LISTAS: Lista[] = [
  {
    nome: "Faturamento",
    Componente: BillingsPage,
    consulta: listBillings,
    escopo: "billings",
    de: "Emitido a partir de",
    ate: "Emitido até",
    resposta: {
      billings: [
        {
          id: "bil-1", code: "FAT-000901", shipmentId: "shp-1", shipmentCode: "EXP-000901", customerOrderId: "co-1",
          customerOrderCode: "PED-000901", customerId: "cus-1", customerName: "Cliente Um", totalQuantity: "1",
          totalAmount: "10.00", status: "ISSUED", issuedAt: INSTANTE,
        },
      ],
      ...pagina,
    },
    codigo: "FAT-000901",
    contagem: `${TOTAL} faturamentos`,
  },
  {
    nome: "Recebimentos",
    Componente: ReceiptsPage,
    consulta: listReceipts,
    escopo: "receipts",
    de: "Recebido a partir de",
    ate: "Recebido até",
    resposta: {
      receipts: [
        {
          id: "rec-1", code: "REC-000901", sourceType: "PURCHASE_ORDER", purchaseOrderId: "po-1",
          purchaseOrderCode: "OC-000901", supplierId: "sup-1", supplierName: "Fornecedor Um", customerId: null,
          customerName: null, receivedAt: INSTANTE, lines: [],
        },
      ],
      ...pagina,
    },
    codigo: "REC-000901",
    contagem: `${TOTAL} recebimentos`,
  },
  {
    nome: "Ordens de Compra",
    Componente: PurchaseOrdersPage,
    consulta: listPurchaseOrders,
    escopo: "purchase-orders",
    de: "Pedido a partir de",
    ate: "Pedido até",
    resposta: {
      purchaseOrders: [
        {
          id: "po-1", code: "OC-000902", supplierId: "sup-1", supplierCode: "FOR-000901", supplierName: "Fornecedor Um",
          orderDate: "2026-09-10T00:00:00.000Z", expectedDeliveryDate: null, lines: [], orderTotal: "10.00",
          status: "ORDERED",
        },
      ],
      ...pagina,
    },
    codigo: "OC-000902",
    contagem: `${TOTAL} ordens de compra`,
  },
  {
    nome: "Produto Acabado",
    Componente: FinishedGoodsPage,
    consulta: listFinishedGoods,
    escopo: "finished-goods",
    de: "Produzido a partir de",
    ate: "Produzido até",
    resposta: {
      rows: [
        {
          lotId: "lot-1", lotCode: "LT-20260910-000901", businessLotNumber: null, productId: "prd-1",
          productCode: "PROD-000901", productName: "Produto Um", itemId: "itm-1", itemCode: "PA-000901",
          itemName: "Produto Um", unitCode: "un", productionOrderId: "op-1", productionOrderCode: "OP-000901",
          producedAt: INSTANTE, producedQuantity: "1", onHand: "1", reserved: "0", available: "1", status: "AVAILABLE",
          isExpired: false, expiryDate: null, location: null, materialUnitCost: null, costQuality: "NO_COST",
          costSource: null,
        },
      ],
      ...pagina,
    },
    codigo: "LT-20260910-000901",
    contagem: `${TOTAL} lotes produzidos`,
  },
];

const RECUSA = "A data inicial não pode ser posterior à data final.";
const DICA_DA_TABELA = "Corrija o período para consultar.";
const PAGINAS = "Página 1 de 3";

function chamadas(consulta: unknown): Filtros[] {
  return vi.mocked(consulta as Consulta).mock.calls.map(([filtros]) => filtros);
}

const esperar = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function abrir({ Componente, consulta, contagem }: Lista, url: string, consultaEsperada = true) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Componente />
    </MemoryRouter>,
  );
  if (consultaEsperada) {
    await waitFor(() => expect(chamadas(consulta).length).toBeGreaterThan(0));
    expect(await screen.findByText(contagem)).toBeInTheDocument();
  }
}

/** Exatamente uma consulta nova, com estas pontas — e a ausência das que não vieram. */
async function umaConsulta(lista: Lista, acao: () => void, pontas: { dateFrom?: string; dateTo?: string }) {
  const antes = chamadas(lista.consulta).length;
  acao();
  await waitFor(() => expect(chamadas(lista.consulta).length).toBe(antes + 1));
  await esperar();
  const novas = chamadas(lista.consulta).slice(antes);
  expect(novas).toHaveLength(1);
  expect(novas[0]?.["dateFrom"]).toBe(pontas.dateFrom);
  expect(novas[0]?.["dateTo"]).toBe(pontas.dateTo);
  expect(await screen.findByText(lista.contagem)).toBeInTheDocument();
  expect(screen.getByText(lista.codigo)).toBeInTheDocument();
  expect(screen.getByText(PAGINAS)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("link", { name: "Exportar CSV" })).toBeInTheDocument();
}

/** A tela com o período recusado: a frase, e nada que se leia como resposta. */
function conferirRecusa(lista: Lista) {
  expect(screen.getByRole("alert")).toHaveTextContent(RECUSA);
  for (const rotulo of [lista.de, lista.ate]) {
    expect(screen.getByLabelText(rotulo)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(rotulo)).toHaveAttribute("aria-describedby", expect.stringMatching(/-period-error$/));
  }
  expect(screen.getByText(DICA_DA_TABELA)).toBeInTheDocument();
  // Nenhuma célula de vazio diz "nenhum … encontrado": não é resposta vazia.
  const vazios = [...document.querySelectorAll("td.table__empty")].map((celula) => celula.textContent ?? "");
  expect(vazios.filter((texto) => /encontrad/.test(texto))).toEqual([]);
  // A linha do recorte anterior não fica à vista como se respondesse a este.
  expect(screen.queryByText(lista.codigo)).toBeNull();
  expect(screen.queryByText(lista.contagem)).toBeNull();
  expect(screen.queryByText(PAGINAS)).toBeNull();
  expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull();
  expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const lista of LISTAS) {
    clearStoredFilters("u-1", lista.escopo);
    vi.mocked(lista.consulta as Consulta).mockResolvedValue(lista.resposta);
  }
  vi.mocked(listAwaitingBilling).mockResolvedValue({ rows: [] } as never);
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("as seis perguntas do período, lista por lista", () => {
  it.each(LISTAS)("$nome", async (lista) => {
    await abrir(lista, "/?period=custom&dateFrom=2026-09-10&dateTo=2026-09-12");
    // Inicial antes da final.
    expect(chamadas(lista.consulta).at(-1)).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-12" });
    const campo = (rotulo: string) => screen.getByLabelText(rotulo);
    const mudar = (rotulo: string, valor: string) => () => fireEvent.change(campo(rotulo), { target: { value: valor } });

    // O mesmo dia nas duas.
    await umaConsulta(lista, mudar(lista.ate, "2026-09-10"), { dateFrom: "2026-09-10", dateTo: "2026-09-10" });
    // Só a inicial: aberta para frente, sem hoje no lugar da final.
    await umaConsulta(lista, mudar(lista.ate, ""), { dateFrom: "2026-09-10" });
    // Nenhuma ponta.
    await umaConsulta(lista, mudar(lista.de, ""), {});
    // Só a final: aberta para trás.
    await umaConsulta(lista, mudar(lista.ate, "2026-09-10"), { dateTo: "2026-09-10" });

    // Inicial depois da final: nenhuma consulta.
    const antes = chamadas(lista.consulta).length;
    fireEvent.change(campo(lista.de), { target: { value: "2026-09-11" } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await esperar();
    expect(chamadas(lista.consulta)).toHaveLength(antes);
    conferirRecusa(lista);

    // Corrigir consulta uma vez.
    await umaConsulta(lista, mudar(lista.ate, "2026-09-11"), { dateFrom: "2026-09-11", dateTo: "2026-09-11" });
    expect(campo(lista.de)).not.toHaveAttribute("aria-invalid");
  });
});

describe("endereço com o período invertido (link colado, filtro lembrado)", () => {
  it.each(LISTAS)("$nome: abre com a recusa e sem nenhuma consulta", async (lista) => {
    await abrir(lista, "/?period=custom&dateFrom=2026-09-13&dateTo=2026-09-12", false);
    expect(await screen.findByRole("alert")).toHaveTextContent(RECUSA);
    await esperar();
    expect(chamadas(lista.consulta)).toHaveLength(0);
    conferirRecusa(lista);
  });

  it.each(LISTAS)("$nome: atalho com datas velhas na URL não é recusa — as datas só valem no Personalizado", async (lista) => {
    await abrir(lista, "/?period=todos&dateFrom=2026-09-13&dateTo=2026-09-12");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(chamadas(lista.consulta).at(-1)).not.toHaveProperty("dateFrom");
    expect(chamadas(lista.consulta).at(-1)).not.toHaveProperty("dateTo");
  });
});
