import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { helpHints, helpTopics } from "../help/help-content";
import type { HelpHintId, HelpTopic, HelpTopicId } from "../help/help-content";

/**
 * Ajuda contextual das telas de COMPRAS e ESTOQUE — o que se protege aqui é
 * a LIGAÇÃO, não o comportamento do painel.
 *
 * O painel em si (abre no teclado, devolve o foco, desenha as caixas) tem
 * suíte própria em `components/help/help-kit.test.tsx`. O que pode quebrar
 * sem ninguém perceber é outra coisa: a tela de Lotes exibindo a explicação
 * do Recebimento, o painel nascendo aberto e empurrando a tabela para baixo,
 * o glossário sumindo — e, principalmente, a regra que motivou a ajuda
 * ("recebimento parcial é normal", "o dono é imutável", "o saldo é somado,
 * não digitado") sendo reescrita até deixar de dizer o que precisava dizer.
 *
 * Por isso `regraEsperada` é literal: reescrever a frase continua permitido,
 * mas não em silêncio.
 */

vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

vi.mock("../lib/receiving-api", () => ({ listReceipts: vi.fn() }));
vi.mock("../lib/lots-api", () => ({ listLots: vi.fn() }));
vi.mock("../lib/inventory-api", () => ({ listInventory: vi.fn() }));
vi.mock("../lib/customer-materials-api", () => ({ listCustomerMaterials: vi.fn() }));
vi.mock("../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));

import { listReceipts } from "../lib/receiving-api";
import { listLots } from "../lib/lots-api";
import { listInventory } from "../lib/inventory-api";
import { listCustomerMaterials } from "../lib/customer-materials-api";

import { ReceiptsPage } from "./receiving/ReceiptsPage";
import { LotsPage } from "./lots/LotsPage";
import { InventoryOverviewPage } from "./inventory/InventoryOverviewPage";
import { CustomerMaterialsPage } from "./inventory/CustomerMaterialsPage";

function renderRota(url: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * `helpTopics` é um literal, então indexá-lo por uma união de chaves devolve
 * uma união de tipos concretos — e `topico.flows` não existe em todos eles.
 * A anotação recoloca a leitura no contrato, que é o que o teste quer.
 */
function topico(id: HelpTopicId): HelpTopic {
  return helpTopics[id];
}

/** O contrato do painel: nasce fechado, abre com o tópico daquela tela, fecha. */
async function verificaPainel(id: HelpTopicId, regraEsperada: RegExp) {
  const user = userEvent.setup();
  const esperado = topico(id);
  const gatilho = screen.getByRole("button", { name: /Como funciona/ });

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: esperado.title })).toBeNull();

  await user.click(gatilho);

  expect(gatilho).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: esperado.title })).toBeInTheDocument();
  expect(screen.getByText(regraEsperada)).toBeInTheDocument();

  // A ajuda é modal: o gatilho fica atrás do overlay enquanto está aberta,
  // então quem fecha é o botão do próprio diálogo.
  await user.click(screen.getByRole("button", { name: "Fechar" }));

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: esperado.title })).toBeNull();
}

/**
 * As caixas numeradas de um fluxo, na ordem — `1Rótulo`, `2Rótulo`, …
 *
 * O número é o que amarra o desenho ao passo a passo logo abaixo: clicar na
 * caixa 3 tem de destacar a explicação 3.
 */
function verificaFluxoNumerado(id: HelpTopicId, nomeDoFluxo: string) {
  const alvo = topico(id);
  const etapas =
    alvo.flows?.find((fluxo) => fluxo.name === nomeDoFluxo)?.steps ?? alvo.flow ?? [];

  expect(etapas.length).toBeGreaterThan(0);

  const lista = screen.getByRole("list", { name: `Fluxo: ${nomeDoFluxo}` });
  expect(Array.from(lista.querySelectorAll("li")).map((item) => item.textContent)).toEqual(
    etapas.map((etapa, indice) => `${indice + 1}${etapa.label}`),
  );
}

/** O vocabulário da tela é apresentado — e vem ANTES do primeiro fluxo. */
function verificaGlossarioAntesDoFluxo(id: HelpTopicId) {
  const conceitos = topico(id).concepts ?? [];
  expect(conceitos.length).toBeGreaterThanOrEqual(4);

  const titulo = screen.getByRole("heading", { name: "Nesta tela" });
  const glossario = titulo.nextElementSibling;
  expect(glossario).not.toBeNull();
  expect(Array.from(glossario!.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual(
    conceitos.map((conceito) => conceito.term),
  );

  const primeiroFluxo = screen.getAllByRole("list", { name: /^Fluxo: / })[0]!;
  expect(titulo.compareDocumentPosition(primeiroFluxo)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** O ⓘ da coluna existe e só mostra o texto depois do clique. */
async function verificaDicaDaColuna(id: HelpHintId) {
  const dica = helpHints[id];
  const gatilho = screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` });

  expect(screen.queryByText(dica.text)).toBeNull();
  await userEvent.setup().click(gatilho);
  expect(screen.getByText(dica.text)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Recebimentos", () => {
  async function abrir() {
    vi.mocked(listReceipts).mockResolvedValue({
      receipts: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as never);

    renderRota("/compras/recebimentos", <ReceiptsPage />);
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
  }

  it("diz que o recebimento é histórico — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      "compras.recebimentos",
      /não tem edição nem exclusão/,
    );
  });

  it("separa o caminho da OC do caminho do material do cliente", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    // Duas entradas muito diferentes na mesma tela: a pergunta "qual dos dois
    // é o meu caso?" vem antes de qualquer etapa, e por isso cada caminho tem
    // nome e condição.
    expect(
      screen.getByRole("heading", { name: "Fluxo A · Recebimento de OC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Fluxo B · Material do cliente, sem OC" }),
    ).toBeInTheDocument();

    verificaFluxoNumerado("compras.recebimentos", "Fluxo A · Recebimento de OC");
    verificaFluxoNumerado("compras.recebimentos", "Fluxo B · Material do cliente, sem OC");
  });

  it("apresenta o vocabulário da tela antes do primeiro caminho", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("compras.recebimentos");
  });

  it("diz que recebimento parcial é normal e que a ordem segue aberta", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/Recebimento parcial é o normal, não um problema/),
    ).toBeInTheDocument();
    expect(screen.getByText(/a ordem continua aberta pelo saldo/)).toBeInTheDocument();
  });
});

describe("Lotes", () => {
  async function abrir() {
    vi.mocked(listLots).mockResolvedValue({
      lots: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as never);

    renderRota("/estoque/lotes", <LotsPage />);
    await waitFor(() => expect(listLots).toHaveBeenCalled());
  }

  it("explica as duas identidades do lote — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      "estoque.lotes",
      /O código interno nunca substitui a identificação do fornecedor/,
    );
  });

  it("desenha os três caminhos numerados: recebido, produzido e Qualidade", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    for (const nome of [
      "Fluxo A · Lote recebido",
      "Fluxo B · Lote produzido",
      "Fluxo C · Decisão da Qualidade",
    ]) {
      expect(screen.getByRole("heading", { name: nome })).toBeInTheDocument();
      verificaFluxoNumerado("estoque.lotes", nome);
    }
  });

  it("diz que lote aguardando a Qualidade não é usado antes do laudo", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/Não entra em FEFO, reserva, separação nem consumo/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/aprovar o laudo não libera o lote: são duas decisões separadas/),
    ).toBeInTheDocument();
  });

  it("as colunas que confundem têm o seu ⓘ", async () => {
    await abrir();

    for (const id of [
      "estoque.loteInterno",
      "estoque.loteFornecedor",
      "estoque.proprietario",
      "estoque.situacaoLote",
      "estoque.recebido",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }

    await verificaDicaDaColuna("estoque.loteFornecedor");
  });
});

describe("Posição de Estoque", () => {
  async function abrir() {
    vi.mocked(listInventory).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as never);

    renderRota("/estoque", <InventoryOverviewPage />);
    await waitFor(() => expect(listInventory).toHaveBeenCalled());
  }

  it("diz que o saldo é somado, não digitado — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      "estoque.posicao",
      /O estoque nunca fica negativo em silêncio/,
    );
  });

  it("mostra o fluxo numerado que vai da movimentação ao Em Compra", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    // Fluxo único: o kit dá a ele o nome padrão.
    verificaFluxoNumerado("estoque.posicao", "Fluxo da tela");
    verificaGlossarioAntesDoFluxo("estoque.posicao");
  });

  it("cada coluna de quantidade tem o seu ⓘ, e ele explica a diferença", async () => {
    await abrir();

    for (const id of [
      "estoque.fisico",
      "estoque.reservado",
      "estoque.disponivel",
      "estoque.emCompra",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }

    // "Disponível" lido como "tem em estoque" é a origem de metade dos
    // chamados — é a dica que mais precisa estar no cabeçalho.
    await verificaDicaDaColuna("estoque.disponivel");
  });
});

describe("Materiais de Clientes", () => {
  async function abrir() {
    vi.mocked(listCustomerMaterials).mockResolvedValue({
      rows: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as never);

    renderRota("/estoque/materiais-de-clientes", <CustomerMaterialsPage />);
    await waitFor(() => expect(listCustomerMaterials).toHaveBeenCalled());
  }

  it("diz que o material é de terceiro — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      "estoque.materiaisCliente",
      /Não existe transferência de propriedade/,
    );
  });

  it("mostra o fluxo numerado e o vocabulário da segregação", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaFluxoNumerado("estoque.materiaisCliente", "Fluxo da tela");
    verificaGlossarioAntesDoFluxo("estoque.materiaisCliente");

    const glossario = screen.getByRole("heading", { name: "Nesta tela" }).nextElementSibling!;
    expect(
      within(glossario as HTMLElement).getByText("Proprietário × fornecedor"),
    ).toBeInTheDocument();
  });

  it("diz que o material entra sem OC e que a falta não vira compra da Veridi", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/sem ordem de compra e sem fornecedor. Nota fiscal não é obrigatória/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Não vira sugestão de compra nem ordem de compra da Veridi/),
    ).toBeInTheDocument();
  });
});
