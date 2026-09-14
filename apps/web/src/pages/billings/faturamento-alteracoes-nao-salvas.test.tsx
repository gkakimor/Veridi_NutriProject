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
import type { BillingDTO, BillingLineDTO } from "@veridi/shared";
import { BillingPage } from "./BillingPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

/**
 * SAVE-FLOW-HARDENING-01 no Faturamento.
 *
 * Dois achados de SAVE-FEEDBACK-REMAINING-01:
 *
 * - sair pelo menu ou pelo "← Voltar" descartava preço, referência externa e
 *   notas digitados sem perguntar (BILLING-SHIPMENT-UNSAVED-GUARD-01). A tela
 *   agora registra a guarda global com a assinatura do que "Salvar rascunho"
 *   envia, e a mesma pendência acende a faixa e acorda o botão de salvar;
 * - emitir grava e depois emite, em duas chamadas. Com a gravação aceita e a
 *   emissão recusada, a tela ficava com a leitura de antes do salvamento — o
 *   preço como digitado e o "Subtotal gravado" antigo (SAVE-THEN-COMMIT-STALE-01).
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

function linha(overrides: Partial<BillingLineDTO> = {}): BillingLineDTO {
  return {
    id: "bl-1",
    shipmentLineId: "sl-1",
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Produto A",
    itemId: "item-1",
    itemCode: "PA-000001",
    itemName: "Produto A",
    lotId: "lot-1",
    lotCode: "LT-20260901-000001",
    businessLotNumber: null,
    quantity: "100",
    unitCode: "un",
    agreedUnitPrice: null,
    unitPrice: "12.5000",
    lineTotal: "1250.00",
    priceOverridden: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    position: 0,
    ...overrides,
  };
}

function faturamento(overrides: Partial<BillingDTO> = {}): BillingDTO {
  return {
    id: "fat-1",
    code: "FAT-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    shipmentId: "sh-1",
    shipmentCode: "EXP-000001",
    shipmentDate: "2026-09-01T00:00:00.000Z",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: null,
    customerCnpj: null,
    status: "DRAFT",
    externalReference: null,
    notes: null,
    totalQuantity: "100",
    grossAmount: "1250.00",
    discountPercentSnapshot: null,
    discountAmount: null,
    commercialAdjustmentAmount: null,
    totalAmount: "1250.00",
    hasCompletePricing: true,
    issuedAt: null,
    issuedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    lines: [linha()],
    ...overrides,
  };
}

/** O que o servidor guardou depois de "13,25" e "Conferido". */
function gravado(): BillingDTO {
  return faturamento({
    notes: "Conferido",
    grossAmount: "1325.00",
    totalAmount: "1325.00",
    lines: [linha({ unitPrice: "13.2500", lineTotal: "1325.00" })],
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

async function abrir(dto = faturamento()) {
  rotas["GET /billings/fat-1"] = () => ({ status: 200, corpo: dto });
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/faturamento" element={<h1>Faturamentos</h1>} />
        <Route path="/comercial/faturamento/:id" element={<BillingPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: ["/comercial/faturamento/fat-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "FAT-000001" });
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const salvar = () => botao("Salvar rascunho");
const preco = () => screen.getByLabelText("Preço faturado de PROD-000001") as HTMLInputElement;
const referencia = () => screen.getByLabelText("Referência externa") as HTMLInputElement;
const notas = () => screen.getByLabelText("Notas internas") as HTMLTextAreaElement;
const pergunta = () => screen.queryByRole("alertdialog", { name: "Sair sem salvar?" });
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
/* Moeda pt-BR sai com espaço fixo (`R$ `) — a leitura normaliza. */
const rodape = () =>
  (document.querySelector(".table-foot")?.textContent ?? "").replace(/[  ]/g, " ");
const gravacoes = () =>
  chamadas.filter((chamada) => chamada.metodo !== "GET").map((c) => `${c.metodo} ${c.caminho}`);

describe("Faturamento — guarda de alterações não salvas", () => {
  it("carregado e não tocado: nada a gravar, e sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("preço digitado: a faixa e o botão acordam, e sair pelo menu pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(salvar()).toBeEnabled();

    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste faturamento/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByText("Sair sem salvar?")).toBeNull());
    expect(preco()).toHaveValue("13,25");
    expect(screen.getByRole("heading", { level: 1, name: "FAT-000001" })).toBeInTheDocument();
  });

  it("referência externa e notas pesam igual — e o ← Voltar da página também pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(referencia(), { target: { value: "NF 123" } });
    await user.click(botao("← Voltar"));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByText("Sair sem salvar?")).toBeNull());

    fireEvent.change(referencia(), { target: { value: "" } });
    expect(salvar()).toBeDisabled();

    fireEvent.change(notas(), { target: { value: "Conferido" } });
    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("reescrever o mesmo preço não é alteração, e desfazer devolve o descanso", async () => {
    await abrir();

    // O servidor guarda 12.5000; a pessoa escreve 12,5.
    fireEvent.change(preco(), { target: { value: "12,5" } });
    expect(salvar()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(preco(), { target: { value: "13" } });
    expect(salvar()).toBeEnabled();
    fireEvent.change(preco(), { target: { value: "12.5000" } });
    expect(salvar()).toBeDisabled();
  });

  it("salvar: a guarda some, o botão volta a descansar, e sai sem perguntar", async () => {
    const user = userEvent.setup();
    rotas["PATCH /billings/fat-1"] = () => ({ status: 200, corpo: gravado() });
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    fireEvent.change(notas(), { target: { value: "Conferido" } });
    await user.click(salvar());

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();
    expect(chamadas.find((chamada) => chamada.metodo === "PATCH")?.corpo).toEqual({
      externalReference: "",
      notes: "Conferido",
      lines: [{ billingLineId: "bl-1", unitPrice: "13.25" }],
    });

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("recusa ao salvar: a pendência, o botão e a guarda continuam", async () => {
    const user = userEvent.setup();
    rotas["PATCH /billings/fat-1"] = () => ({
      status: 409,
      corpo: { error: "billing_not_draft", message: "Faturamento já emitido não aceita alteração." },
    });
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    await user.click(salvar());

    expect(await screen.findByRole("alert")).toHaveTextContent("Faturamento já emitido não aceita alteração.");
    expect(preco()).toHaveValue("13,25");
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(salvar()).toBeEnabled();

    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("alterar o preço acordado grava na hora: não deixa pendência", async () => {
    const user = userEvent.setup();
    const acordada = linha({ agreedUnitPrice: "12.5000" });
    rotas["POST /billings/fat-1/lines/bl-1/price-override"] = () => ({
      status: 200,
      corpo: faturamento({
        lines: [
          {
            ...acordada,
            unitPrice: "13.2500",
            lineTotal: "1325.00",
            priceOverridden: true,
            overrideReason: "Desconto acordado",
            overriddenBy: "Ana",
            overriddenAt: "2026-09-02T10:00:00.000Z",
          },
        ],
      }),
    });
    await abrir(faturamento({ lines: [acordada] }));

    await user.click(botao("Alterar preço de faturamento"));
    await screen.findByRole("heading", { name: "Alterar preço de faturamento" });
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });
    await user.click(botao("Alterar preço"));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Alterar preço de faturamento" })).toBeNull(),
    );
    expect(await screen.findByText("Alterado")).toBeInTheDocument();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});

describe("Faturamento — emitir grava, e a emissão é recusada", () => {
  it.each([
    {
      caso: "recusa de negócio (409)",
      status: 409,
      corpo: { error: "shipment_cancelled", message: "Expedição cancelada não pode ser faturada." },
      mensagem: "Expedição cancelada não pode ser faturada.",
    },
    {
      caso: "falha do servidor (500)",
      status: 500,
      corpo: undefined,
      mensagem: "Erro interno do servidor (500). Tente novamente ou avise o suporte.",
    },
  ])("$caso: a tela fica com o que foi gravado, e o erro da emissão aparece", async ({ status, corpo, mensagem }) => {
    const user = userEvent.setup();
    rotas["PATCH /billings/fat-1"] = () => ({ status: 200, corpo: gravado() });
    rotas["POST /billings/fat-1/issue"] = () => ({ status, corpo });
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    fireEvent.change(notas(), { target: { value: "Conferido" } });
    await user.click(botao("Emitir faturamento"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Emitir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(mensagem);
    // As duas chamadas saíram, nesta ordem: a gravação valeu, a emissão não.
    expect(gravacoes()).toEqual(["PATCH /billings/fat-1", "POST /billings/fat-1/issue"]);

    // A tela mostra o que o servidor guardou — nem a leitura de antes, nem o digitado cru.
    expect(preco()).toHaveValue("13,25");
    expect(preco()).not.toHaveValue("12,50");
    expect(notas()).toHaveValue("Conferido");
    expect(rodape()).toContain("Subtotal bruto (prévia): R$ 1.325,00");
    expect(rodape()).not.toContain("Subtotal gravado");

    // O que estava na tela foi gravado: nada pendente, nada a salvar.
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(salvar()).toBeDisabled();

    // Continua rascunho, sem frase de sucesso, e emitir de novo é possível.
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.queryByText("Emitido em")).toBeNull();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(botao("Emitir faturamento")).toBeEnabled();
  });
});
