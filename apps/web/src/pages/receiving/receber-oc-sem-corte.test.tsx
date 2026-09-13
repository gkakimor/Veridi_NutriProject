import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, PurchaseOrderDTO, PurchaseOrderStatus } from "@veridi/shared";
import type { ListPurchaseOrdersParams } from "../../lib/purchase-orders-api";

/**
 * Receber OC sem corte silencioso (RECEIVING-OPEN-PO-CUTOFF-01).
 *
 * O seletor pedia `status=ORDERED` e `status=PARTIALLY_RECEIVED`, 100 de cada,
 * e somava as duas listas num `<select>`. Da 101ª OC de cada status em diante
 * a ordem estava aberta, o servidor aceitaria o recebimento, e a tela não a
 * oferecia — sem aviso nenhum.
 *
 * O seletor passou à foundation dos filtros: primeira página de 20, busca no
 * servidor por código ou fornecedor, e quais status recebem é o servidor quem
 * diz (`receivable`). O servidor aqui é de mentira, mas honesto: guarda 213
 * OCs e filtra, ordena e pagina o universo inteiro a cada pedido — não
 * devolve 20 prontas. A prova com banco real está em
 * `apps/api/src/modules/purchase-orders/receber-oc-sem-corte.test.ts`.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({ getItem: vi.fn(), listItems: vi.fn() }));
vi.mock("../../lib/receiving-api", () => ({ createReceipt: vi.fn() }));

import { getPurchaseOrder, listPurchaseOrders } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { createReceipt } from "../../lib/receiving-api";
import { ReceivePurchaseOrderPage } from "./ReceivePurchaseOrderPage";

const PAGINA_DO_SELETOR = 20;

/**
 * A fila, na ordem do servidor (código decrescente; posição 1 = mais recente),
 * montada para que as duas listas de 100 de antes percam os três alvos: a
 * posição 150 é confirmada com 100 confirmadas acima (a OC #150), a 202 é
 * parcial com 100 parciais acima, e a 205 é do fornecedor B.
 */
const FILA = 210;
const POSICAO_OC_150 = 150;
const POSICAO_PARCIAL = 202;
const POSICAO_FORNECEDOR_B = 205;

const numeroDaPosicao = (posicao: number) => FILA + 1 - posicao;
const codigo = (numero: number) => `OC-${String(numero).padStart(6, "0")}`;
const codigoDoItem = (numero: number) => `MP-${String(numero).padStart(6, "0")}`;
const OC_150 = numeroDaPosicao(POSICAO_OC_150);
const PARCIAL = numeroDaPosicao(POSICAO_PARCIAL);
const DO_FORNECEDOR_B = numeroDaPosicao(POSICAO_FORNECEDOR_B);

function statusNaPosicao(posicao: number): PurchaseOrderStatus {
  if (posicao <= 100) return "ORDERED";
  if (posicao < POSICAO_OC_150) return "PARTIALLY_RECEIVED";
  if (posicao === POSICAO_OC_150) return "ORDERED";
  if (posicao <= POSICAO_PARCIAL) return "PARTIALLY_RECEIVED";
  return "ORDERED";
}

interface Registro {
  numero: number;
  status: PurchaseOrderStatus;
  fornecedor: string;
  recebido: string;
}

const UNIVERSO: Registro[] = [
  ...Array.from({ length: FILA }, (_, indice): Registro => {
    const posicao = indice + 1;
    const numero = numeroDaPosicao(posicao);
    const status = statusNaPosicao(posicao);
    return {
      numero,
      status,
      fornecedor:
        posicao === POSICAO_FORNECEDOR_B
          ? "Distribuidora Omega"
          : `Fornecedor ${String(numero).padStart(3, "0")}`,
      recebido: posicao === POSICAO_PARCIAL ? "40" : status === "PARTIALLY_RECEIVED" ? "10" : "0",
    };
  }),
  // Fora da fila — e os códigos mais altos de todos.
  { numero: 901, status: "RECEIVED", fornecedor: "Fornecedor Encerrado", recebido: "100" },
  { numero: 902, status: "CANCELLED", fornecedor: "Fornecedor Cancelado", recebido: "0" },
  { numero: 903, status: "DRAFT", fornecedor: "Fornecedor Rascunho", recebido: "0" },
];

function ordemDeCompra(registro: Registro): PurchaseOrderDTO {
  const numero = String(registro.numero).padStart(6, "0");
  return {
    id: `po-${registro.numero}`,
    code: codigo(registro.numero),
    supplierId: `sup-${registro.numero}`,
    supplierCode: `FOR-${numero}`,
    supplierName: registro.fornecedor,
    supplierCnpj: null,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: registro.status,
    notes: null,
    lines: [
      {
        id: `poline-${registro.numero}`,
        itemId: `item-${registro.numero}`,
        itemCode: codigoDoItem(registro.numero),
        itemName: `Insumo ${registro.numero}`,
        unitCode: "kg",
        orderedQuantity: "100",
        receivedQuantity: registro.recebido,
        openQuantity: String(100 - Number(registro.recebido)),
        unitPrice: null,
        lineTotal: null,
      },
    ],
    orderTotal: null,
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  } as unknown as PurchaseOrderDTO;
}

/** O conjunto do servidor real. A tela não o conhece — só pergunta `receivable`. */
const RECEBEM_NO_SERVIDOR: PurchaseOrderStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];

function servidor(params: ListPurchaseOrdersParams = {}) {
  const statuses =
    params.status === undefined ? null : Array.isArray(params.status) ? params.status : [params.status];
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.receivable || RECEBEM_NO_SERVIDOR.includes(registro.status))
    .filter((registro) => !statuses || statuses.includes(registro.status))
    .filter(
      (registro) =>
        !termo ||
        codigo(registro.numero).toLowerCase().includes(termo) ||
        registro.fornecedor.toLowerCase().includes(termo),
    )
    .sort((a, b) => b.numero - a.numero);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return {
    purchaseOrders: linhas.slice((page - 1) * pageSize, page * pageSize).map(ordemDeCompra),
    page,
    pageSize,
    total: linhas.length,
  };
}

function item(id: string): ItemDTO {
  return {
    id,
    code: id.toUpperCase(),
    name: `Item ${id}`,
    type: "PACKAGING",
    unitCode: "kg",
    controlsLot: false,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
  } as unknown as ItemDTO;
}

function abrir(endereco = "/compras/recebimentos/novo") {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <Routes>
        <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const seletor = () => screen.getByRole("combobox", { name: "Ordem de compra" });

/** Digita no seletor e escolhe a opção que o SERVIDOR devolveu. */
async function buscarEEscolher(termo: string, opcao: RegExp) {
  await waitFor(() => expect(listPurchaseOrders).toHaveBeenCalled());
  const campo = seletor();
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: opcao }));
}

/** A seção de uma linha da OC, achada pelo título que a pessoa lê. */
async function secaoDoItem(itemCode: string): Promise<HTMLElement> {
  const titulo = await screen.findByText(new RegExp(`^${itemCode} —`));
  return titulo.closest("section") as HTMLElement;
}

/** Toda consulta de lista: página do seletor, fila do servidor, nenhum status escrito pela tela. */
function nenhumaConsultaAlemDaPagina() {
  const chamadas = vi.mocked(listPurchaseOrders).mock.calls;
  expect(chamadas.length).toBeGreaterThan(0);
  for (const [params] of chamadas) {
    expect(params?.pageSize).toBeLessThanOrEqual(PAGINA_DO_SELETOR);
    expect(params?.receivable).toBe(true);
    expect(params?.status).toBeUndefined();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPurchaseOrders).mockImplementation(async (params) => servidor(params));
  vi.mocked(getPurchaseOrder).mockImplementation(async (id) => {
    const registro = UNIVERSO.find((candidato) => `po-${candidato.numero}` === id);
    if (!registro) throw new Error("Ordem de compra não encontrada");
    return ordemDeCompra(registro);
  });
  vi.mocked(getItem).mockImplementation(async (id) => item(id));
  vi.mocked(createReceipt).mockResolvedValue({ id: "rec-1" } as Awaited<ReturnType<typeof createReceipt>>);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("as duas listas de 100 não alcançavam a OC #150, a 101ª parcial nem a OC do fornecedor B", () => {
    const antigas = new Set(
      [
        ...servidor({ status: "ORDERED", pageSize: 100 }).purchaseOrders,
        ...servidor({ status: "PARTIALLY_RECEIVED", pageSize: 100 }).purchaseOrders,
      ].map((ordem) => ordem.code),
    );
    expect(antigas.size).toBe(200);
    for (const numero of [OC_150, PARCIAL, DO_FORNECEDOR_B]) {
      expect(antigas.has(codigo(numero)), codigo(numero)).toBe(false);
    }
    expect(servidor({ receivable: true }).total).toBe(FILA);
  });
});

describe("Receber OC — seletor com busca no servidor", () => {
  it("abre com a primeira página do servidor — 20 de 210 — e diz que o resto se alcança buscando", async () => {
    abrir();
    await waitFor(() =>
      expect(listPurchaseOrders).toHaveBeenCalledWith({ receivable: true, pageSize: PAGINA_DO_SELETOR }),
    );

    fireEvent.focus(seletor());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA_DO_SELETOR));
    expect(within(lista).getAllByRole("option")[0]).toHaveTextContent(codigo(FILA));
    expect(within(lista).queryByRole("option", { name: new RegExp(codigo(OC_150)) })).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();

    expect(listPurchaseOrders).toHaveBeenCalledTimes(1);
    nenhumaConsultaAlemDaPagina();
  });

  it("OC #150 — fora das 100 de antes e da primeira página — achada pelo código, selecionada e recebida", async () => {
    abrir();
    await buscarEEscolher(codigo(OC_150), new RegExp(codigo(OC_150)));

    expect(listPurchaseOrders).toHaveBeenCalledWith({
      receivable: true,
      search: codigo(OC_150),
      pageSize: PAGINA_DO_SELETOR,
    });
    expect(await screen.findByRole("heading", { name: codigo(OC_150) })).toBeInTheDocument();
    expect(getPurchaseOrder).toHaveBeenCalledWith(`po-${OC_150}`);
    expect(screen.getByText("Fornecedor 061")).toBeInTheDocument();

    const secao = await secaoDoItem(codigoDoItem(OC_150));
    expect(secao).toHaveTextContent("Aberto: 100 kg");
    fireEvent.change(within(secao).getByLabelText(/Receber agora/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar recebimento/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(createReceipt).toHaveBeenCalledWith(
        `po-${OC_150}`,
        expect.objectContaining({
          lines: [expect.objectContaining({ purchaseOrderLineId: `poline-${OC_150}` })],
        }),
      ),
    );
    expect(await screen.findByText("Recebimento gravado")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("fornecedor fora das 100: a busca pelo nome acha a OC e a tela abre com ele", async () => {
    abrir();
    await buscarEEscolher("Omega", new RegExp(codigo(DO_FORNECEDOR_B)));

    expect(listPurchaseOrders).toHaveBeenCalledWith({ receivable: true, search: "Omega", pageSize: PAGINA_DO_SELETOR });
    expect(await screen.findByRole("heading", { name: codigo(DO_FORNECEDOR_B) })).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Omega")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("PARTIALLY_RECEIVED fora do antigo corte continua selecionável, com o saldo recebível", async () => {
    abrir();
    await buscarEEscolher(codigo(PARCIAL), new RegExp(`${codigo(PARCIAL)}.*Recebido parcialmente`));

    expect(await screen.findByRole("heading", { name: codigo(PARCIAL) })).toBeInTheDocument();
    const secao = await secaoDoItem(codigoDoItem(PARCIAL));
    expect(secao).toHaveTextContent("Pedido: 100 kg");
    expect(secao).toHaveTextContent("Recebido: 40 kg");
    expect(secao).toHaveTextContent("Aberto: 60 kg");

    const campo = within(secao).getByLabelText(/Receber agora/);
    const confirmar = () => screen.getByRole("button", { name: /Confirmar recebimento/ }) as HTMLButtonElement;
    fireEvent.change(campo, { target: { value: "61" } });
    expect(await within(secao).findByText("Máximo 60 kg — é o saldo em aberto desta linha.")).toBeInTheDocument();
    expect(confirmar().disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "60" } });
    await waitFor(() => expect(confirmar().disabled).toBe(false));
    nenhumaConsultaAlemDaPagina();
  });

  it.each([
    [901, "finalizada"],
    [902, "cancelada"],
    [903, "rascunho"],
  ])("OC %s (%s) não aparece nem pela busca exata do código", async (numero) => {
    abrir();
    await waitFor(() => expect(listPurchaseOrders).toHaveBeenCalled());
    const campo = seletor();
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: codigo(numero) } });

    expect(await screen.findByText("Nenhum resultado.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: new RegExp(codigo(numero)) })).toBeNull();
    expect(listPurchaseOrders).toHaveBeenCalledWith({
      receivable: true,
      search: codigo(numero),
      pageSize: PAGINA_DO_SELETOR,
    });
    nenhumaConsultaAlemDaPagina();
  });

  it("escolhida que não carrega: o erro aparece e a escolha continua no campo", async () => {
    vi.mocked(getPurchaseOrder).mockRejectedValueOnce(new Error("Falha de rede ao abrir a OC"));
    abrir();
    await buscarEEscolher(codigo(OC_150), new RegExp(codigo(OC_150)));

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede ao abrir a OC");
    expect(seletor()).toHaveValue(`${codigo(OC_150)} · Fornecedor 061`);
  });
});

describe("Receber OC — contexto da OC pela URL", () => {
  it("`?purchaseOrderId=` resolve pelo id — fora da primeira página — sem lista nenhuma", async () => {
    abrir(`/compras/recebimentos/novo?purchaseOrderId=po-${PARCIAL}`);

    expect(await screen.findByRole("heading", { name: codigo(PARCIAL) })).toBeInTheDocument();
    expect(getPurchaseOrder).toHaveBeenCalledWith(`po-${PARCIAL}`);
    expect(await secaoDoItem(codigoDoItem(PARCIAL))).toHaveTextContent("Aberto: 60 kg");
    expect(screen.queryByRole("combobox", { name: "Ordem de compra" })).toBeNull();
    expect(listPurchaseOrders).not.toHaveBeenCalled();
  });
});

describe("guarda estrutural", () => {
  it("a tela e a source não carregam catálogo nem repetem quais status recebem", () => {
    const tela = readFileSync(join(process.cwd(), "src", "pages", "receiving", "ReceivePurchaseOrderPage.tsx"), "utf8");
    expect(tela).not.toMatch(/\blistPurchaseOrders\(/);
    expect(tela).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(tela).not.toMatch(/\ball:\s*true/);
    expect(tela).not.toMatch(/"ORDERED"|"PARTIALLY_RECEIVED"/);

    const fontes = readFileSync(join(process.cwd(), "src", "lib", "filter-sources.ts"), "utf8");
    // Os comentários de cima citam os tetos antigos das outras sources; o que
    // se guarda aqui é o código da source do Recebimento.
    const source = fontes.slice(fontes.indexOf("export const ordemDeCompraParaReceberSource"));
    expect(source.match(/listPurchaseOrders\(\{ receivable: true,/g)).toHaveLength(2);
    expect(source).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(fontes).not.toMatch(/"ORDERED"|"PARTIALLY_RECEIVED"/);
  });

  it("em 390px: seletor na regra de tela estreita, sem <select> nem largura em pixel", async () => {
    const { container } = abrir();
    await waitFor(() => expect(container.querySelector(".toolbar__entity [role='combobox']")).not.toBeNull());
    expect(container.querySelector("select#receiving-po-picker")).toBeNull();
    for (const elemento of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
  });
});
