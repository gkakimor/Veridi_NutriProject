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
import type { ShipmentDTO, ShipmentLineDTO, ShipmentProductGroupDTO } from "@veridi/shared";
import { ShipmentPage } from "./ShipmentPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

/**
 * SAVE-FLOW-HARDENING-01 na Expedição.
 *
 * Dois achados de SAVE-FEEDBACK-REMAINING-01:
 *
 * - sair pelo menu ou pela trilha descartava as quantidades da separação e as
 *   notas digitadas sem perguntar (BILLING-SHIPMENT-UNSAVED-GUARD-01). A tela
 *   agora registra a guarda global com a assinatura do que "Salvar separação"
 *   envia; conferir, confirmar e cancelar gravam e releem, então o que já foi
 *   gravado não pesa;
 * - confirmar e conferir gravam a separação e só então confirmam/conferem. O
 *   salvamento recria as linhas no servidor; com ele aceito e a segunda chamada
 *   recusada, a tela seguia com as linhas lidas antes (SAVE-THEN-COMMIT-STALE-01).
 *
 * O servidor é um `fetch` falso com status HTTP de verdade: a recusa passa pelo
 * cliente real (`parseJsonOrThrow`), como na tela.
 */

interface Chamada {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

interface Resposta {
  status: number;
  corpo?: unknown;
}

let rotas: Record<string, () => Resposta> = {};
let chamadas: Chamada[] = [];

beforeEach(() => {
  rotas = {};
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada));
      const metodo = (init?.method ?? "GET").toUpperCase();
      const corpo = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      chamadas.push({ metodo, caminho: url.pathname, corpo });
      const rota = rotas[`${metodo} ${url.pathname}`];
      if (!rota) throw new Error(`rota não prevista: ${metodo} ${url.pathname}`);
      const resposta = rota();
      return new Response(resposta.corpo === undefined ? null : JSON.stringify(resposta.corpo), {
        status: resposta.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function linha(overrides: Partial<ShipmentLineDTO> = {}): ShipmentLineDTO {
  return {
    id: "sl-a",
    customerOrderLineId: "col-1",
    customerOrderReservationLineId: "res-a",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    lotId: "lot-a",
    lotCode: "LT-000010",
    businessLotNumber: null,
    expiryDate: null,
    location: null,
    quantity: "20",
    unitCode: "kg",
    position: 0,
    reservedRemaining: "30.5",
    requiresVerification: false,
    verifiedAt: null,
    verifiedBy: null,
    deliverySequence: null,
    deliveryScheduledDate: null,
    ...overrides,
  };
}

function grupo(overrides: Partial<ShipmentProductGroupDTO> = {}): ShipmentProductGroupDTO {
  return {
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    unitCode: "kg",
    orderedQuantity: "100",
    shippedQuantity: "60",
    outstandingQuantity: "40",
    reservedRemaining: "30.5",
    shippingNow: "20",
    lotsRequired: 0,
    lotsVerified: 0,
    status: "READY",
    ...overrides,
  };
}

function expedicao(overrides: Partial<ShipmentDTO> = {}): ShipmentDTO {
  return {
    id: "exp-1",
    code: "EXP-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    customerId: "cli-1",
    customerName: "NutriViva",
    status: "DRAFT",
    shipmentDate: null,
    notes: null,
    lines: [linha()],
    products: [grupo()],
    verification: { productCount: 1, lotsRequired: 0, lotsVerified: 0, allLotsVerified: true },
    totalQuantity: "20",
    billingStatus: "NONE",
    billingId: null,
    billingCode: null,
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "Teste",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as ShipmentDTO;
}

/** Lote que exige conferência, ainda não conferido. */
function aConferir(overrides: Partial<ShipmentDTO> = {}): ShipmentDTO {
  return expedicao({
    lines: [linha({ requiresVerification: true })],
    products: [grupo({ lotsRequired: 1 })],
    verification: { productCount: 1, lotsRequired: 1, lotsVerified: 0, allLotsVerified: false },
    ...overrides,
  });
}

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

async function abrir(dto = expedicao()) {
  rotas["GET /shipments/exp-1"] = () => ({ status: 200, corpo: dto });
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/expedicoes" element={<h1>Expedições</h1>} />
        <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: ["/comercial/expedicoes/exp-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "EXP-000001" });
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const salvar = () => botao("Salvar separação");
const quantidade = () =>
  screen.getByRole("textbox", { name: "Quantidade do lote LT-000010" }) as HTMLInputElement;
const loteLido = () =>
  screen.getByRole("textbox", { name: "Lote conferido da linha LT-000010" }) as HTMLInputElement;
const notas = () => screen.getByLabelText("Notas internas") as HTMLTextAreaElement;
const pergunta = () => screen.queryByRole("alertdialog", { name: "Sair sem salvar?" });
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const gravacoes = () =>
  chamadas.filter((chamada) => chamada.metodo !== "GET").map((c) => `${c.metodo} ${c.caminho}`);

describe("Expedição — guarda de alterações não salvas", () => {
  it("carregada e não tocada: nada a gravar, e sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("quantidade digitada: a faixa e o botão acordam, e sair pelo menu pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "25" } });
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(salvar()).toBeEnabled();

    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta expedição/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByText("Sair sem salvar?")).toBeNull());
    expect(quantidade()).toHaveValue("25");
  });

  it("notas pesam igual — e a trilha da página também pergunta; desfazer devolve o descanso", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(notas(), { target: { value: "Doca 2" } });
    await user.click(screen.getByRole("link", { name: "Expedições" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByText("Sair sem salvar?")).toBeNull());

    fireEvent.change(notas(), { target: { value: "" } });
    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Expedições" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Expedições" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("digitar o reservado exibido é o mesmo número gravado: não é alteração", async () => {
    /* A reserva inteira tem doze casas e a tela mostra seis. Quem digita o
       número da tela está pedindo tudo — e é isso que já está gravado. */
    await abrir(
      expedicao({
        lines: [linha({ quantity: "6.122448979592", reservedRemaining: "6.122448979592" })],
        products: [grupo({ reservedRemaining: "6.122448979592", shippingNow: "6.122448979592" })],
      }),
    );

    fireEvent.change(quantidade(), { target: { value: "6,122449" } });
    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(quantidade(), { target: { value: "6" } });
    expect(salvar()).toBeEnabled();
  });

  it("o lote digitado para conferir não é pendência", async () => {
    const user = userEvent.setup();
    await abrir(aConferir());

    fireEvent.change(loteLido(), { target: { value: "LT-000010" } });
    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar: a guarda some, o botão volta a descansar, e sai sem perguntar", async () => {
    const user = userEvent.setup();
    rotas["PATCH /shipments/exp-1"] = () => ({
      status: 200,
      corpo: expedicao({ notes: "Doca 2", lines: [linha({ id: "sl-b", quantity: "25" })] }),
    });
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "25" } });
    fireEvent.change(notas(), { target: { value: "Doca 2" } });
    await user.click(salvar());

    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();
    expect(chamadas.find((chamada) => chamada.metodo === "PATCH")?.corpo).toEqual({
      notes: "Doca 2",
      lines: [{ customerOrderReservationLineId: "res-a", quantity: "25" }],
    });

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("recusa ao salvar: a pendência, o botão e a guarda continuam", async () => {
    const user = userEvent.setup();
    rotas["PATCH /shipments/exp-1"] = () => ({
      status: 409,
      corpo: { error: "reservation_released", message: "A reserva deste lote foi liberada." },
    });
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "25" } });
    await user.click(salvar());

    expect(await screen.findByRole("alert")).toHaveTextContent("A reserva deste lote foi liberada.");
    expect(quantidade()).toHaveValue("25");
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(salvar()).toBeEnabled();

    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("conferir lote grava e confere: o que foi gravado não fica pendente", async () => {
    const user = userEvent.setup();
    rotas["PATCH /shipments/exp-1"] = () => ({
      status: 200,
      corpo: aConferir({ lines: [linha({ id: "sl-b", quantity: "25", requiresVerification: true })] }),
    });
    rotas["POST /shipments/exp-1/lines/sl-b/verify"] = () => ({
      status: 200,
      corpo: expedicao({
        lines: [
          linha({
            id: "sl-b",
            quantity: "25",
            requiresVerification: true,
            verifiedAt: "2026-09-02T10:00:00.000Z",
            verifiedBy: "Ana",
          }),
        ],
        products: [grupo({ lotsRequired: 1, lotsVerified: 1, status: "VERIFIED" })],
        verification: { productCount: 1, lotsRequired: 1, lotsVerified: 1, allLotsVerified: true },
      }),
    });
    await abrir(aConferir());

    fireEvent.change(quantidade(), { target: { value: "25" } });
    fireEvent.change(loteLido(), { target: { value: "LT-000010" } });
    await user.click(botao("Conferir lote"));

    // Selo do lote e situação do produto dizem "Conferido" os dois.
    expect((await screen.findAllByText("Conferido")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Conferir lote" })).toBeNull();
    expect(gravacoes()).toEqual(["PATCH /shipments/exp-1", "POST /shipments/exp-1/lines/sl-b/verify"]);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});

describe("Expedição — confirmar grava, e a confirmação é recusada", () => {
  /*
   * A separação de 400 atendia a entrega 1. Com 500 o servidor reparte: 400 na
   * entrega 1 e 100 na entrega 2, em linhas NOVAS. Se a confirmação é recusada,
   * a tela tem de mostrar essa separação gravada — não a de antes.
   */
  const entrega1 = { deliverySequence: 1, deliveryScheduledDate: "2026-09-20T12:00:00.000Z" };
  const entrega2 = { deliverySequence: 2, deliveryScheduledDate: "2026-10-20T12:00:00.000Z" };
  const antes = () =>
    expedicao({
      lines: [linha({ quantity: "400", reservedRemaining: "600", ...entrega1 })],
      products: [
        grupo({
          orderedQuantity: "1000",
          shippedQuantity: "0",
          outstandingQuantity: "1000",
          reservedRemaining: "600",
          shippingNow: "400",
        }),
      ],
    });
  const gravada = () =>
    expedicao({
      lines: [
        linha({ id: "sl-b", quantity: "400", reservedRemaining: "600", ...entrega1 }),
        linha({ id: "sl-c", quantity: "100", reservedRemaining: "600", position: 1, ...entrega2 }),
      ],
      products: [
        grupo({
          orderedQuantity: "1000",
          shippedQuantity: "0",
          outstandingQuantity: "1000",
          reservedRemaining: "600",
          shippingNow: "500",
        }),
      ],
    });

  it.each([
    {
      caso: "recusa de negócio (409)",
      status: 409,
      corpo: { error: "insufficient_stock", message: "Saldo físico insuficiente no lote LT-000010." },
      mensagem: "Saldo físico insuficiente no lote LT-000010.",
    },
    {
      caso: "falha do servidor (500)",
      status: 500,
      corpo: undefined,
      mensagem: "Erro interno do servidor (500). Tente novamente ou avise o suporte.",
    },
  ])("$caso: a tela fica com a separação gravada, e o erro da confirmação aparece", async ({ status, corpo, mensagem }) => {
    const user = userEvent.setup();
    rotas["PATCH /shipments/exp-1"] = () => ({ status: 200, corpo: gravada() });
    rotas["POST /shipments/exp-1/confirm"] = () => ({ status, corpo });
    await abrir(antes());

    expect(screen.getByText(/Entrega 1 · 400/)).toBeInTheDocument();
    fireEvent.change(quantidade(), { target: { value: "500" } });
    await user.click(botao("Confirmar expedição"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(mensagem);
    // As duas chamadas saíram, nesta ordem: a gravação valeu, a confirmação não.
    expect(gravacoes()).toEqual(["PATCH /shipments/exp-1", "POST /shipments/exp-1/confirm"]);
    expect(chamadas.find((chamada) => chamada.metodo === "PATCH")?.corpo).toEqual({
      notes: "",
      lines: [{ customerOrderReservationLineId: "res-a", quantity: "500" }],
    });

    // A tela mostra a separação que o servidor guardou, com as duas entregas.
    expect(screen.getByText(/Entrega 1 · 400 · Entrega 2 · 100/)).toBeInTheDocument();
    expect(quantidade()).toHaveValue("500");

    // O que estava na tela foi gravado: nada pendente, nada a salvar.
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();

    // Continua rascunho, sem frase de sucesso, e confirmar de novo é possível.
    expect(screen.queryByText("Confirmada em")).toBeNull();
    expect(screen.queryByText("Separação salva.")).toBeNull();
    expect(botao("Confirmar expedição")).toBeEnabled();
  });
});

describe("Expedição — conferir grava, e a conferência é recusada", () => {
  it("lote errado (409): a separação gravada fica na tela, e o erro fica no lote", async () => {
    const user = userEvent.setup();
    rotas["PATCH /shipments/exp-1"] = () => ({
      status: 200,
      corpo: aConferir({
        lines: [linha({ id: "sl-b", quantity: "25", requiresVerification: true })],
        products: [grupo({ lotsRequired: 1, shippingNow: "25" })],
      }),
    });
    rotas["POST /shipments/exp-1/lines/sl-b/verify"] = () => ({
      status: 409,
      corpo: {
        error: "lot_mismatch",
        message: "O lote lido (LT-999999) não é o lote reservado (LT-000010).",
        expectedLotCode: "LT-000010",
        scannedLotCode: "LT-999999",
      },
    });
    await abrir(aConferir());

    fireEvent.change(quantidade(), { target: { value: "25" } });
    fireEvent.change(loteLido(), { target: { value: "LT-999999" } });
    await user.click(botao("Conferir lote"));

    expect(await screen.findByText("O lote lido (LT-999999) não é o lote reservado (LT-000010).")).toBeInTheDocument();
    // A conferência usou a linha que o salvamento devolveu.
    expect(gravacoes()).toEqual(["PATCH /shipments/exp-1", "POST /shipments/exp-1/lines/sl-b/verify"]);

    // O lote lido fica para comparar; a quantidade é a gravada.
    expect(loteLido()).toHaveValue("LT-999999");
    expect(quantidade()).toHaveValue("25");

    // A quantidade foi gravada: nada pendente, e sair não pergunta.
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("lote em duas linhas: a primeira conferência vale mesmo com a segunda recusada", async () => {
    /* A quantidade do lote atravessa duas entregas, então o lote tem duas
       linhas e conferir chama o servidor uma vez por linha. */
    const user = userEvent.setup();
    const linhasDoLote = (primeiraConferida: boolean) => [
      linha({
        id: "sl-b",
        quantity: "400",
        reservedRemaining: "600",
        requiresVerification: true,
        deliverySequence: 1,
        deliveryScheduledDate: "2026-09-20T12:00:00.000Z",
        ...(primeiraConferida ? { verifiedAt: "2026-09-02T10:00:00.000Z", verifiedBy: "Ana" } : {}),
      }),
      linha({
        id: "sl-c",
        quantity: "100",
        reservedRemaining: "600",
        position: 1,
        requiresVerification: true,
        deliverySequence: 2,
        deliveryScheduledDate: "2026-10-20T12:00:00.000Z",
      }),
    ];
    const comConferencia = (primeiraConferida: boolean) =>
      expedicao({
        lines: linhasDoLote(primeiraConferida),
        products: [
          grupo({
            outstandingQuantity: "1000",
            reservedRemaining: "600",
            shippingNow: "500",
            lotsRequired: 2,
            lotsVerified: primeiraConferida ? 1 : 0,
          }),
        ],
        verification: {
          productCount: 1,
          lotsRequired: 2,
          lotsVerified: primeiraConferida ? 1 : 0,
          allLotsVerified: false,
        },
      });
    rotas["PATCH /shipments/exp-1"] = () => ({ status: 200, corpo: comConferencia(false) });
    rotas["POST /shipments/exp-1/lines/sl-b/verify"] = () => ({ status: 200, corpo: comConferencia(true) });
    rotas["POST /shipments/exp-1/lines/sl-c/verify"] = () => ({ status: 500 });
    await abrir(comConferencia(false));

    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    fireEvent.change(loteLido(), { target: { value: "LT-000010" } });
    await user.click(botao("Conferir lote"));

    expect(
      await screen.findByText("Erro interno do servidor (500). Tente novamente ou avise o suporte."),
    ).toBeInTheDocument();
    expect(gravacoes()).toEqual([
      "PATCH /shipments/exp-1",
      "POST /shipments/exp-1/lines/sl-b/verify",
      "POST /shipments/exp-1/lines/sl-c/verify",
    ]);
    // A tela conta a conferência que o servidor gravou, não a leitura do salvamento.
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("0 / 2")).toBeNull();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });
});
