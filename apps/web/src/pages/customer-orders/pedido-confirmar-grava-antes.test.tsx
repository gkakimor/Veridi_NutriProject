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
import type { CustomerOrderDTO } from "@veridi/shared";
import { CustomerOrderPage } from "./CustomerOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

/**
 * Confirmar o Pedido com alteração pendente grava antes (CONFIRM-DISCARDS-DIRTY-01).
 *
 * O servidor confirma o pedido GRAVADO e congela produtos, quantidades e o
 * cliente. "Confirmar pedido" chamava a confirmação direto: com a quantidade
 * digitada e não salva, o documento congelava a quantidade antiga e a releitura
 * apagava da tela o que foi digitado, sem aviso. Regra do produto: gravar antes
 * de agir — com pendência, o salvar normal da tela, a resposta real, a tela com
 * o gravado e só então a confirmação; sem pendência, só a confirmação.
 *
 * O servidor aqui é um `fetch` falso com estado: o PATCH grava quando responde,
 * e a confirmação congela o que estiver gravado no instante em que chega — como
 * o real. As recusas passam pelo cliente HTTP de verdade (`parseJsonOrThrow`).
 */

vi.mock("../../lib/customer-orders-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/customer-orders-api")>()),
  // Seções do pedido confirmado que não são o assunto: nunca respondem.
  getFulfillmentPlan: () => new Promise(() => undefined),
  getPlanPurchaseSourcing: () => new Promise(() => undefined),
  getPurchaseSuggestion: () => new Promise(() => undefined),
}));
vi.mock("../../lib/customers-api", () => ({
  listCustomers: () => Promise.resolve({ customers: [CLIENTE], total: 1 }),
}));
vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [PRODUTO], total: 1 }),
  getProduct: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: () => Promise.resolve({ suppliers: [] }) }));
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: () => new Promise(() => undefined),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));
vi.mock("../../lib/delivery-schedule-api", () => ({
  getDeliverySchedule: () => new Promise(() => undefined),
  createDeliverySchedule: vi.fn(),
  cancelDeliverySchedule: vi.fn(),
  rescheduleDelivery: vi.fn(),
  prepareShipmentForDelivery: vi.fn(),
}));

const CLIENTE = vi.hoisted(() => ({
  id: "cli-a",
  code: "CLI-000001",
  legalName: "Alfa Suplementos Ltda",
  tradeName: "Alfa",
}));

const PRODUTO = vi.hoisted(() => ({
  id: "prod-a",
  code: "PROD-000101",
  name: "Whey Alfa 900g",
  customerId: "cli-a",
  finishedProductItem: { id: "pa-a", code: "PA-000101", name: "Whey Alfa 900g" },
}));

function linha(quantidade: string) {
  return {
    id: "col-1",
    productId: PRODUTO.id,
    productCode: PRODUTO.code,
    productName: PRODUTO.name,
    unitCode: "un",
    orderedQuantity: quantidade,
    shippedQuantity: "0",
    outstandingQuantity: quantidade,
    billedQuantity: "0",
    unbilledShippedQuantity: "0",
    pendingProductionQuantity: "0",
    agreedPrice: null,
    productCustomerMismatch: false,
  };
}

function pedido(overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: CLIENTE.id,
    customerCode: CLIENTE.code,
    customerName: CLIENTE.legalName,
    customerTradeName: CLIENTE.tradeName,
    customerCnpj: null,
    customerAddress: {
      street: null,
      number: null,
      complement: null,
      district: null,
      zipCode: null,
      city: null,
      state: null,
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [linha("10.000000")],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "NOT_BILLED",
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  } as unknown as CustomerOrderDTO;
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

let gravado: CustomerOrderDTO;
/** O pedido como a confirmação o congelou — `null` enquanto ninguém confirmou. */
let congelado: CustomerOrderDTO | null;
/** Pedidos de escrita e respostas, na ordem em que aconteceram. */
let eventos: string[];
let segurarGravacao: ReturnType<typeof adiada> | null;
let segurarConfirmacao: ReturnType<typeof adiada> | null;
let recusaDaGravacao: Resposta | null;
let recusaDaConfirmacao: Resposta | null;

/** O PATCH do rascunho, aplicado ao gravado — linhas trocadas, notas e prazo. */
function gravar(atual: CustomerOrderDTO, corpo: Record<string, unknown>): CustomerOrderDTO {
  const linhas = corpo["lines"] as { productId: string; orderedQuantity: string }[] | undefined;
  return {
    ...atual,
    notes: typeof corpo["notes"] === "string" && corpo["notes"] !== "" ? (corpo["notes"] as string) : null,
    requestedDeliveryDate: (corpo["requestedDeliveryDate"] as string | undefined) ?? atual.requestedDeliveryDate,
    lines: linhas
      ? linhas.map((entrada) => linha(Number(entrada.orderedQuantity).toFixed(6)))
      : atual.lines,
  } as CustomerOrderDTO;
}

beforeEach(() => {
  gravado = pedido();
  congelado = null;
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

      if (metodo === "GET" && url.pathname === "/customer-orders/co-1") return responder({ status: 200, corpo: gravado });
      if (metodo === "PATCH" && url.pathname === "/customer-orders/co-1") {
        eventos.push("PATCH");
        if (segurarGravacao) await segurarGravacao.promessa;
        if (recusaDaGravacao) {
          eventos.push("PATCH recusado");
          return responder(recusaDaGravacao);
        }
        gravado = gravar(gravado, corpo);
        eventos.push("PATCH gravado");
        return responder({ status: 200, corpo: gravado });
      }
      if (metodo === "POST" && url.pathname === "/customer-orders/co-1/confirm") {
        eventos.push("CONFIRM");
        if (segurarConfirmacao) await segurarConfirmacao.promessa;
        if (recusaDaConfirmacao) {
          eventos.push("CONFIRM recusado");
          return responder(recusaDaConfirmacao);
        }
        // Congela o GRAVADO no instante em que a confirmação chega.
        congelado = {
          ...gravado,
          status: "CONFIRMED",
          confirmedAt: "2026-09-13T15:00:00.000Z",
          confirmedBy: "Sistema",
          lines: gravado.lines.map((entrada) => ({ ...entrada })),
        } as CustomerOrderDTO;
        gravado = congelado;
        eventos.push("CONFIRM confirmado");
        return responder({ status: 200, corpo: congelado });
      }
      if (metodo === "POST" && url.pathname === "/customer-orders/co-1/cancel") {
        eventos.push("CANCEL");
        return responder({
          status: 409,
          corpo: { error: "invalid_transition", message: "Este pedido não pode mais ser cancelado." },
        });
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
        <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  render(<RouterProvider router={router} />);
}

async function abrir() {
  montar("/comercial/pedidos/co-1");
  await screen.findByRole("heading", { name: "PED-000001" });
  await waitFor(() => expect(quantidade()).toHaveValue("10"));
}

const quantidade = () => screen.getByRole("textbox", { name: `Quantidade de ${PRODUTO.code}` }) as HTMLInputElement;
const observacoes = () => screen.getByLabelText("Notas internas") as HTMLTextAreaElement;
const botao = (nome: string) => screen.getByRole("button", { name: nome });
const escritas = () => eventos.filter((evento) => evento === "PATCH" || evento === "CONFIRM");

/** "Confirmar pedido" e o "Confirmar" do diálogo. */
async function confirmar() {
  fireEvent.click(botao("Confirmar pedido"));
  const dialogo = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
}

function editar() {
  fireEvent.change(quantidade(), { target: { value: "12" } });
  fireEvent.change(observacoes(), { target: { value: "Entregar em caixas fechadas" } });
  expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
}

async function esperarConfirmado() {
  expect(await screen.findByText("Confirmado")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmando…" })).toBeNull());
}

describe("pedido novo, ainda não gravado", () => {
  it("não oferece confirmar: o caminho é salvar o rascunho, que cria o pedido", async () => {
    montar("/comercial/pedidos/novo");
    await screen.findByRole("heading", { name: "Novo pedido" });
    fireEvent.change(observacoes(), { target: { value: "Primeiro contato" } });

    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(escritas()).toEqual([]);
  });
});

describe("sem alteração pendente", () => {
  it("confirma direto: uma confirmação e nenhuma gravação", async () => {
    await abrir();
    expect(botao("Salvar rascunho")).toBeDisabled();

    await confirmar();
    await esperarConfirmado();

    expect(escritas()).toEqual(["CONFIRM"]);
    expect(congelado?.lines[0]?.orderedQuantity).toBe("10.000000");
  });
});

describe("com alteração pendente — gravar antes de agir", () => {
  it("grava, espera a resposta real e só então confirma; o botão diz a etapa", async () => {
    segurarGravacao = adiada();
    segurarConfirmacao = adiada();
    await abrir();
    editar();

    await confirmar();

    // Gravando: a confirmação ainda não saiu.
    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(escritas()).toEqual(["PATCH"]);
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();

    segurarGravacao.soltar();

    // Gravou: agora, e só agora, confirma.
    expect(await screen.findByRole("button", { name: "Confirmando…" })).toBeDisabled();
    expect(eventos).toEqual(["PATCH", "PATCH gravado", "CONFIRM"]);

    segurarConfirmacao.soltar();
    await esperarConfirmado();
    expect(eventos).toEqual(["PATCH", "PATCH gravado", "CONFIRM", "CONFIRM confirmado"]);
  });

  it("o salvar enviado é o normal da tela, com o que foi digitado", async () => {
    await abrir();
    editar();
    await confirmar();
    await esperarConfirmado();

    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      customerId: CLIENTE.id,
      notes: "Entregar em caixas fechadas",
      lines: [{ productId: PRODUTO.id, orderedQuantity: "12" }],
    });
  });

  it("o congelado é o digitado — quantidade e notas novas, não as gravadas antes", async () => {
    await abrir();
    editar();
    await confirmar();
    await esperarConfirmado();

    expect(congelado?.status).toBe("CONFIRMED");
    expect(congelado?.lines[0]?.orderedQuantity).toBe("12.000000");
    expect(congelado?.notes).toBe("Entregar em caixas fechadas");
    // A tela mostra o confirmado com o que a pessoa digitou, sem pendência.
    expect(screen.getAllByText("12.000000").length).toBeGreaterThan(0);
    expect(screen.queryByText("10.000000")).toBeNull();
    expect(observacoes()).toHaveValue("Entregar em caixas fechadas");
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });

  it("gravação recusada: não confirma; o digitado, a pendência e a mensagem ficam", async () => {
    recusaDaGravacao = {
      status: 409,
      corpo: { error: "inactive_product", message: "Produto PROD-000101 está inativo e não pode entrar no pedido." },
    };
    await abrir();
    editar();

    await confirmar();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Produto PROD-000101 está inativo e não pode entrar no pedido.",
    );
    expect(eventos).toEqual(["PATCH", "PATCH recusado"]);
    expect(quantidade()).toHaveValue("12");
    expect(observacoes()).toHaveValue("Entregar em caixas fechadas");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(botao("Confirmar pedido")).toBeEnabled();
    expect(botao("Salvar rascunho")).toBeEnabled();

    // Corrigido do lado do servidor, tentar de novo grava e confirma.
    recusaDaGravacao = null;
    await confirmar();
    await esperarConfirmado();
    expect(escritas()).toEqual(["PATCH", "PATCH", "CONFIRM"]);
    expect(congelado?.lines[0]?.orderedQuantity).toBe("12.000000");
  });

  it("quantidade ilegível: a gravação nem sai, e a confirmação também não", async () => {
    await abrir();
    // Letra e vírgula dupla nem entram no campo; o ambíguo entra e trava na borda.
    fireEvent.change(quantidade(), { target: { value: "1.234" } });

    await confirmar();

    expect(await screen.findByRole("alert")).toHaveTextContent(`Quantidade de ${PRODUTO.code}`);
    expect(escritas()).toEqual([]);
    expect(quantidade()).toHaveValue("1.234");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });

  it.each([
    [409, { error: "inactive_customer", message: "Cliente inativo não pode ter pedido confirmado." }, "Cliente inativo não pode ter pedido confirmado."],
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
      // Nada do que foi gravado volta atrás na tela.
      expect(quantidade()).toHaveValue("12");
      expect(observacoes()).toHaveValue("Entregar em caixas fechadas");
      expect(screen.queryByText("Alterações não salvas")).toBeNull();
      expect(screen.getByText("Rascunho")).toBeInTheDocument();
      expect(botao("Salvar rascunho")).toBeDisabled();
      expect(botao("Confirmar pedido")).toBeEnabled();

      // Tentar de novo: sem pendência, só a confirmação — nenhuma gravação repetida.
      recusaDaConfirmacao = null;
      await confirmar();
      await esperarConfirmado();
      expect(escritas()).toEqual(["PATCH", "CONFIRM", "CONFIRM"]);
      expect(congelado?.lines[0]?.orderedQuantity).toBe("12.000000");
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
    await esperarConfirmado();

    expect(escritas()).toEqual(["PATCH", "CONFIRM"]);
  });

  it("a guarda de saída não pergunta pela gravação interna, e continua valendo para sair", async () => {
    const user = userEvent.setup();
    recusaDaGravacao = { status: 409, corpo: { error: "conflict", message: "Pedido alterado por outra pessoa." } };
    await abrir();
    editar();

    await confirmar();
    expect(await screen.findByRole("alert")).toHaveTextContent("Pedido alterado por outra pessoa.");
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();

    // A pendência que sobrou da recusa ainda prende a saída.
    await user.click(screen.getByRole("link", { name: "Estoque" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });
});

/**
 * FORM-ERROR-VISIBILITY-01 — o erro de uma ação aparece onde a pessoa está.
 *
 * O alerta mora no topo do documento e salvar, confirmar e cancelar ficam no
 * fim: em 390px a recusa ficava fora da vista e o clique parecia não ter
 * efeito. O MESMO alerta — nenhuma cópia perto do botão — vem à vista e recebe
 * o foco; com o diálogo de cancelamento aberto, o erro aparece dentro dele.
 */
describe("erro de ação vem à vista", () => {
  let rolados: Element[];

  beforeEach(() => {
    rolados = [];
    // jsdom não implementa `scrollIntoView`: aqui ele é o que se quer observar.
    Element.prototype.scrollIntoView = function (this: Element) {
      rolados.push(this);
    };
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("confirmação recusada: o alerta único rola à vista e recebe o foco", async () => {
    recusaDaConfirmacao = {
      status: 409,
      corpo: { error: "inactive_customer", message: "Cliente inativo não pode ter pedido confirmado." },
    };
    await abrir();

    await confirmar();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Cliente inativo não pode ter pedido confirmado.");
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(rolados).toContain(alerta);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("Salvar rascunho recusado: o mesmo alerta vem à vista", async () => {
    recusaDaGravacao = { status: 409, corpo: { error: "conflict", message: "Pedido alterado por outra pessoa." } };
    await abrir();
    editar();

    fireEvent.click(botao("Salvar rascunho"));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Pedido alterado por outra pessoa.");
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(rolados).toContain(alerta);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("cancelamento recusado: o erro aparece dentro do diálogo, não atrás dele", async () => {
    await abrir();

    fireEvent.click(botao("Cancelar pedido"));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo do cancelamento/), {
      target: { value: "Cliente desistiu" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar pedido" }));

    const alerta = await within(dialogo).findByRole("alert");
    expect(alerta).toHaveTextContent("Este pedido não pode mais ser cancelado.");
    await waitFor(() => expect(alerta).toHaveFocus());
    // Contando também o que o diálogo esconde: nenhuma cópia atrás dele.
    expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(1);
    expect(eventos).toContain("CANCEL");
  });
});
