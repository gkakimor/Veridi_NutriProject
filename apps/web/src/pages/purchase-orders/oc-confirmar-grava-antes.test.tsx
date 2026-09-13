import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";
import { PurchaseOrderPage } from "./PurchaseOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

/**
 * Confirmar a OC com alteração pendente grava antes (CONFIRM-DISCARDS-DIRTY-01).
 *
 * Confirmada, a OC trava fornecedor, itens, quantidades e preços — e o servidor
 * confirma a OC GRAVADA. "Confirmar OC" chamava a confirmação direto: o preço
 * digitado e não salvo não entrava no pedido ao fornecedor, e a releitura o
 * apagava da tela, sem aviso. Com pendência, a tela grava pelo salvar normal,
 * espera a resposta, fica com o gravado e só então confirma; sem pendência,
 * confirma direto.
 *
 * O servidor é um `fetch` falso com estado: o PATCH grava quando responde, e a
 * confirmação trava o que estiver gravado no instante em que chega — como o
 * real. Recusas passam pelo cliente HTTP de verdade (`parseJsonOrThrow`).
 */

vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: () =>
    Promise.resolve({
      suppliers: [{ id: "for-1", code: "FOR-000001", legalName: "Fornecedor Teste", tradeName: null, active: true }],
    }),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: () => Promise.resolve({ supplierItems: [] }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));

function linha(quantidade: string, preco: string | null) {
  const total = preco === null ? "0.00" : (Number(quantidade) * Number(preco)).toFixed(2);
  return {
    id: "pol-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    unitCode: "kg",
    orderedQuantity: quantidade,
    unitPrice: preco,
    lineTotal: total,
    receivedQuantity: "0",
    openQuantity: quantidade,
  };
}

function ordem(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "oc-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierCnpj: null,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [linha("10.000000", "12.5000")],
    orderTotal: "125.00",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    ...overrides,
  } as PurchaseOrderDTO;
}

/* ── O servidor de mentira ─────────────────────────────────────────────── */

interface Resposta {
  status: number;
  corpo?: unknown;
}

function adiada() {
  let soltar!: () => void;
  const promessa = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  return { promessa, soltar };
}

let gravada: PurchaseOrderDTO;
/** A OC como a confirmação a travou — `null` enquanto ninguém confirmou. */
let travada: PurchaseOrderDTO | null;
let eventos: string[];
let segurarGravacao: ReturnType<typeof adiada> | null;
let segurarConfirmacao: ReturnType<typeof adiada> | null;
let recusaDaGravacao: Resposta | null;
let recusaDaConfirmacao: Resposta | null;

/** O PATCH do rascunho, aplicado à OC gravada. */
function gravar(atual: PurchaseOrderDTO, corpo: Record<string, unknown>): PurchaseOrderDTO {
  const linhas = corpo["lines"] as { itemId: string; orderedQuantity: string; unitPrice?: string }[] | undefined;
  const novas = linhas
    ? linhas.map((entrada) =>
        linha(
          Number(entrada.orderedQuantity).toFixed(6),
          entrada.unitPrice === undefined ? null : Number(entrada.unitPrice).toFixed(4),
        ),
      )
    : atual.lines;
  const previsao = corpo["expectedDeliveryDate"];
  return {
    ...atual,
    notes: typeof corpo["notes"] === "string" && corpo["notes"] !== "" ? (corpo["notes"] as string) : null,
    expectedDeliveryDate:
      typeof previsao === "string" ? (previsao === "" ? null : previsao) : atual.expectedDeliveryDate,
    lines: novas,
    orderTotal: novas.reduce((soma, entrada) => soma + Number(entrada.lineTotal), 0).toFixed(2),
  } as PurchaseOrderDTO;
}

beforeEach(() => {
  gravada = ordem();
  travada = null;
  eventos = [];
  segurarGravacao = null;
  segurarConfirmacao = null;
  recusaDaGravacao = null;
  recusaDaConfirmacao = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada));
      const metodo = (init?.method ?? "GET").toUpperCase();
      const corpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const responder = ({ status, corpo: dados }: Resposta) =>
        new Response(dados === undefined ? null : JSON.stringify(dados), {
          status,
          headers: { "Content-Type": "application/json" },
        });

      if (metodo === "GET" && url.pathname === "/purchase-orders/oc-1") return responder({ status: 200, corpo: gravada });
      if (metodo === "PATCH" && url.pathname === "/purchase-orders/oc-1") {
        eventos.push("PATCH");
        if (segurarGravacao) await segurarGravacao.promessa;
        if (recusaDaGravacao) {
          eventos.push("PATCH recusado");
          return responder(recusaDaGravacao);
        }
        gravada = gravar(gravada, corpo);
        eventos.push("PATCH gravado");
        return responder({ status: 200, corpo: gravada });
      }
      if (metodo === "POST" && url.pathname === "/purchase-orders/oc-1/confirm") {
        eventos.push("CONFIRM");
        if (segurarConfirmacao) await segurarConfirmacao.promessa;
        if (recusaDaConfirmacao) {
          eventos.push("CONFIRM recusado");
          return responder(recusaDaConfirmacao);
        }
        // Trava a OC GRAVADA no instante em que a confirmação chega.
        travada = {
          ...gravada,
          status: "ORDERED",
          orderedAt: "2026-09-13T15:00:00.000Z",
          orderedBy: "Sistema",
          lines: gravada.lines.map((entrada) => ({ ...entrada })),
        } as PurchaseOrderDTO;
        gravada = travada;
        eventos.push("CONFIRM confirmado");
        return responder({ status: 200, corpo: travada });
      }
      throw new Error(`rota não prevista: ${metodo} ${url.pathname}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── A tela ────────────────────────────────────────────────────────────── */

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(entrada: string) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  render(<RouterProvider router={router} />);
}

async function abrir() {
  montar("/compras/ordens/oc-1");
  await screen.findByRole("heading", { name: "OC-000001" });
  await waitFor(() => expect(quantidade()).toHaveValue("10.000000"));
}

const quantidade = () => screen.getByRole("textbox", { name: "Quantidade de MP-000001" }) as HTMLInputElement;
const preco = () => screen.getByRole("textbox", { name: "Preço unitário de MP-000001" }) as HTMLInputElement;
const observacoes = () => screen.getByLabelText("Notas internas") as HTMLTextAreaElement;
const previsao = () => document.getElementById("po-expected-date") as HTMLInputElement;
const botao = (nome: string) => screen.getByRole("button", { name: nome });
const escritas = () => eventos.filter((evento) => evento === "PATCH" || evento === "CONFIRM");

async function confirmar() {
  fireEvent.click(botao("Confirmar OC"));
  const dialogo = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
}

function editar() {
  fireEvent.change(quantidade(), { target: { value: "12" } });
  fireEvent.change(preco(), { target: { value: "13,40" } });
  fireEvent.change(previsao(), { target: { value: "2026-10-05" } });
  fireEvent.change(observacoes(), { target: { value: "Entregar na doca 2" } });
  expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
}

async function esperarConfirmada() {
  expect(await screen.findByRole("button", { name: "Salvar previsão e observações" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmando…" })).toBeNull());
}

describe("OC nova, ainda não gravada", () => {
  it("não oferece confirmar: o caminho é salvar o rascunho, que cria a OC", async () => {
    montar("/compras/ordens/nova");
    await screen.findByRole("heading", { name: "Nova ordem de compra" });
    fireEvent.change(observacoes(), { target: { value: "Cotação por telefone" } });

    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar OC" })).toBeNull();
    expect(escritas()).toEqual([]);
  });
});

describe("sem alteração pendente", () => {
  it("confirma direto: uma confirmação e nenhuma gravação", async () => {
    await abrir();
    expect(botao("Salvar rascunho")).toBeDisabled();

    await confirmar();
    await esperarConfirmada();

    expect(escritas()).toEqual(["CONFIRM"]);
    expect(travada?.lines[0]?.unitPrice).toBe("12.5000");
  });
});

describe("com alteração pendente — gravar antes de agir", () => {
  it("grava, espera a resposta real e só então confirma; o botão diz a etapa", async () => {
    segurarGravacao = adiada();
    segurarConfirmacao = adiada();
    await abrir();
    editar();

    await confirmar();

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(escritas()).toEqual(["PATCH"]);
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();

    segurarGravacao.soltar();

    expect(await screen.findByRole("button", { name: "Confirmando…" })).toBeDisabled();
    expect(eventos).toEqual(["PATCH", "PATCH gravado", "CONFIRM"]);

    segurarConfirmacao.soltar();
    await esperarConfirmada();
    expect(eventos).toEqual(["PATCH", "PATCH gravado", "CONFIRM", "CONFIRM confirmado"]);
  });

  it("o salvar enviado é o normal da tela: fornecedor, linhas, previsão e observações", async () => {
    await abrir();
    editar();
    await confirmar();
    await esperarConfirmada();

    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      supplierId: "for-1",
      notes: "Entregar na doca 2",
      lines: [{ itemId: "item-1", orderedQuantity: "12", unitPrice: "13.40" }],
    });
    expect(JSON.parse(String(patch?.[1]?.body)).expectedDeliveryDate).toMatch(/^2026-10-05/);
  });

  it("o travado é o digitado — quantidade, preço, previsão e observações novos", async () => {
    await abrir();
    editar();
    await confirmar();
    await esperarConfirmada();

    expect(travada?.status).toBe("ORDERED");
    expect(travada?.lines[0]?.orderedQuantity).toBe("12.000000");
    expect(travada?.lines[0]?.unitPrice).toBe("13.4000");
    expect(travada?.orderTotal).toBe("160.80");
    expect(travada?.notes).toBe("Entregar na doca 2");
    expect(travada?.expectedDeliveryDate).toMatch(/^2026-10-05/);
    // A tela confirmada mostra o que foi digitado, sem pendência.
    expect(observacoes()).toHaveValue("Entregar na doca 2");
    expect(previsao()).toHaveValue("2026-10-05");
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Preço unitário de MP-000001" })).toBeNull();
  });

  it("gravação recusada: não confirma; o digitado, a pendência e a mensagem ficam", async () => {
    recusaDaGravacao = {
      status: 409,
      corpo: { error: "inactive_supplier", message: "Fornecedor FOR-000001 está inativo." },
    };
    await abrir();
    editar();

    await confirmar();

    expect(await screen.findByRole("alert")).toHaveTextContent("Fornecedor FOR-000001 está inativo.");
    expect(eventos).toEqual(["PATCH", "PATCH recusado"]);
    expect(quantidade()).toHaveValue("12");
    expect(preco()).toHaveValue("13,40");
    expect(observacoes()).toHaveValue("Entregar na doca 2");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(botao("Confirmar OC")).toBeEnabled();
    expect(botao("Salvar rascunho")).toBeEnabled();

    recusaDaGravacao = null;
    await confirmar();
    await esperarConfirmada();
    expect(escritas()).toEqual(["PATCH", "PATCH", "CONFIRM"]);
    expect(travada?.lines[0]?.unitPrice).toBe("13.4000");
  });

  it("preço ilegível: a gravação nem sai, e a confirmação também não", async () => {
    await abrir();
    fireEvent.change(preco(), { target: { value: "13,4,0" } });

    await confirmar();

    expect(await screen.findByRole("alert")).toHaveTextContent("Preço unitário de MP-000001");
    expect(escritas()).toEqual([]);
    expect(preco()).toHaveValue("13,4,0");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });

  it.each([
    [409, { error: "inactive_item", message: "Item MP-000001 está inativo." }, "Item MP-000001 está inativo."],
    [500, { error: "internal_error" }, "Erro interno do servidor (500)"],
  ])(
    "gravou e a confirmação voltou %i: fica o gravado, sem pendência, em rascunho, com o erro",
    async (status, corpo, mensagem) => {
      recusaDaConfirmacao = { status, corpo };
      await abrir();
      editar();

      await confirmar();

      expect(await screen.findByRole("alert")).toHaveTextContent(mensagem);
      expect(eventos).toEqual(["PATCH", "PATCH gravado", "CONFIRM", "CONFIRM recusado"]);
      expect(quantidade()).toHaveValue("12.000000");
      expect(preco()).toHaveValue("13.4000");
      expect(observacoes()).toHaveValue("Entregar na doca 2");
      expect(screen.queryByText("Alterações não salvas")).toBeNull();
      expect(screen.getByText("Rascunho")).toBeInTheDocument();
      expect(botao("Salvar rascunho")).toBeDisabled();
      expect(botao("Confirmar OC")).toBeEnabled();

      recusaDaConfirmacao = null;
      await confirmar();
      await esperarConfirmada();
      expect(escritas()).toEqual(["PATCH", "CONFIRM", "CONFIRM"]);
      expect(travada?.lines[0]?.unitPrice).toBe("13.4000");
    },
  );

  it("clique repetido durante gravar e confirmar: uma gravação e uma confirmação", async () => {
    const user = userEvent.setup();
    segurarGravacao = adiada();
    segurarConfirmacao = adiada();
    await abrir();
    editar();
    await confirmar();

    await user.click(await screen.findByRole("button", { name: "Salvando…" }));
    await user.click(botao("Salvar rascunho"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    segurarGravacao.soltar();

    await user.click(await screen.findByRole("button", { name: "Confirmando…" }));
    segurarConfirmacao.soltar();
    await esperarConfirmada();

    expect(escritas()).toEqual(["PATCH", "CONFIRM"]);
  });

  it("a guarda de saída não pergunta pela gravação interna, e continua valendo para sair", async () => {
    const user = userEvent.setup();
    recusaDaGravacao = { status: 409, corpo: { error: "conflict", message: "OC alterada por outra pessoa." } };
    await abrir();
    editar();

    await confirmar();
    expect(await screen.findByRole("alert")).toHaveTextContent("OC alterada por outra pessoa.");
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Estoque" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });
});
