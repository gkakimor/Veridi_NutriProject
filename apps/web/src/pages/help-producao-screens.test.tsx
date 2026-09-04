import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { helpHints, helpTopics } from "../help/help-content";
import type { HelpTopic } from "../help/help-content";

/**
 * Ajuda contextual nas telas de Produção — o que se protege aqui é a LIGAÇÃO.
 *
 * O comportamento do painel (abre, desenha o fluxo, devolve o foco) já tem
 * suíte própria no kit. O que pode quebrar em silêncio é outra coisa: a
 * Folha de Receita exibindo a explicação do Produto Acabado, o painel
 * nascendo aberto e empurrando a operação para baixo, ou a regra que motivou
 * a ajuda — "reserva não movimenta estoque físico", "usar um template copia"
 * — sendo reescrita até deixar de dizer o que precisava dizer.
 *
 * As expressões de `regraEsperada` são literais de propósito: reescrever a
 * frase é permitido, mas não sem passar por aqui.
 */

vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

vi.mock("../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
}));
vi.mock("../lib/recipe-api", () => ({
  getRecipeSheet: vi.fn(),
  registerWeighing: vi.fn(),
  completePart: vi.fn(),
}));
vi.mock("../lib/finished-goods-api", () => ({ listFinishedGoods: vi.fn() }));
vi.mock("../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [] }),
}));
vi.mock("../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../lib/formulation-templates-api", () => ({
  listFormulationTemplates: vi.fn(),
  getFormulationTemplate: vi.fn(),
  createFormulationTemplate: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  compareTemplateVersions: vi.fn(),
  applyTemplateToProduct: vi.fn(),
  getTemplateUpdateAvailable: vi.fn(),
  compareFormulationWithTemplate: vi.fn(),
  createTemplateFromFormulation: vi.fn(),
}));

import { listProductionOrders } from "../lib/production-orders-api";
import { getRecipeSheet } from "../lib/recipe-api";
import { listFinishedGoods } from "../lib/finished-goods-api";
import {
  getFormulationTemplate,
  listFormulationTemplates,
} from "../lib/formulation-templates-api";

import { PickingConsumptionPage } from "./production-orders/PickingConsumptionPage";
import { RecipeSheetPage } from "./production-orders/RecipeSheetPage";
import { FinishedGoodsPage } from "./finished-goods/FinishedGoodsPage";
import { FormulationTemplatesPage } from "./formulation-templates/FormulationTemplatesPage";
import { FormulationTemplateDetailPage } from "./formulation-templates/FormulationTemplateDetailPage";

function renderRota(path: string, url: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * O contrato do painel, verificado igual em todas as telas: nasce fechado,
 * abre com o tópico daquela tela e fecha de novo pelo botão do diálogo.
 */
async function verificaPainel(tituloEsperado: string, regraEsperada: RegExp) {
  const user = userEvent.setup();
  const gatilho = screen.getByRole("button", { name: /Como funciona/ });

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: tituloEsperado })).toBeNull();

  await user.click(gatilho);

  expect(gatilho).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: tituloEsperado })).toBeInTheDocument();
  expect(screen.getByText(regraEsperada)).toBeInTheDocument();

  // O gatilho fica atrás do overlay enquanto a ajuda está aberta: quem fecha
  // é o botão do próprio diálogo.
  await user.click(screen.getByRole("button", { name: "Fechar" }));

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: tituloEsperado })).toBeNull();
}

/** As caixas numeradas de um fluxo, na ordem — `1Rótulo`, `2Rótulo`, … */
async function verificaFluxoNumerado(topicoId: keyof typeof helpTopics, nomeDoFluxo: string) {
  await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

  // O rótulo acessível nomeia o FLUXO, não a tela: estas telas têm mais de um
  // caminho, e é o número da caixa que casa com o passo a passo abaixo.
  const fluxo = screen.getByRole("list", { name: `Fluxo: ${nomeDoFluxo}` });
  // `helpTopics` é a união literal de TODOS os tópicos, e nem todos têm
  // `flows` — a anotação traz a leitura de volta para o contrato comum.
  const topico: HelpTopic = helpTopics[topicoId];
  const etapas = topico.flows?.find((fluxoDoTopico) => fluxoDoTopico.name === nomeDoFluxo)?.steps ?? [];

  expect(etapas.length).toBeGreaterThan(0);
  expect(Array.from(fluxo.querySelectorAll("li")).map((item) => item.textContent)).toEqual(
    etapas.map((etapa, i) => `${i + 1}${etapa.label}`),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Picking / Consumo", () => {
  async function abrir() {
    vi.mocked(listProductionOrders).mockResolvedValue({
      productionOrders: [],
      total: 0,
    } as never);

    renderRota("/producao/picking", "/producao/picking", <PickingConsumptionPage />);
    await waitFor(() => expect(listProductionOrders).toHaveBeenCalled());
  }

  it("explica que reserva não move estoque — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["producao.picking"].title,
      /Reserva não movimenta estoque físico; consumo movimenta/,
    );
  });

  it("separa o caminho do material da Veridi do caminho do material do cliente", async () => {
    await abrir();

    await verificaFluxoNumerado("producao.picking", "Fluxo A · Material da Veridi");
    expect(
      screen.getByRole("list", { name: "Fluxo: Fluxo B · Material do cliente" }),
    ).toBeInTheDocument();
  });

  it("as colunas que medem coisas opostas têm o seu ⓘ", async () => {
    await abrir();

    // "Picking" conta conferência e "Consumo" conta baixa de estoque. Lidas
    // lado a lado sem explicação, passam por sinônimos.
    for (const id of [
      "producao.picking.situacao",
      "producao.picking.conferencia",
      "producao.picking.consumo",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }
  });
});

describe("Folha de Receita", () => {
  async function abrir() {
    vi.mocked(getRecipeSheet).mockResolvedValue({
      productionOrderId: "op-1",
      recipeSheetRevision: null,
      productionOrderCode: "OP-000123",
      officialNumber: "023/26",
      productId: "prod-1",
      productCode: "PROD-000003",
      productName: "Whey Protein DEMO",
      customerName: "IGEIA",
      formulationVersionLabel: "V2",
      plannedQuantity: "1000",
      outputUnitCode: "un",
      numberOfParts: 1,
      status: "IN_PRODUCTION",
      packagingRequirements: [],
      parts: [
        {
          id: "part-1",
          partNumber: 1,
          status: "PENDING",
          startedAt: null,
          startedByName: null,
          completedAt: null,
          completedByName: null,
          weighings: [],
          requirements: [
            {
              requirementId: "req-1",
              itemId: "mp-1",
              itemCode: "MP-000006",
              itemName: "Celulose microcristalina 101",
              unitCode: "kg",
              supplyResponsibility: "VERIDI",
              expectedOwnerCustomerName: null,
              sourceName: null,
              plannedQuantity: "6.75",
              weighedQuantity: "0",
              consumedQuantity: "0",
              differenceQuantity: "0",
              reservedLots: [],
              weighings: [],
            },
          ],
        },
      ],
    } as never);

    renderRota(
      "/producao/ordens/:id/receita",
      "/producao/ordens/op-1/receita",
      <RecipeSheetPage />,
    );
    await waitFor(() => expect(screen.getAllByText(/MP-000006/).length).toBeGreaterThan(0));
  }

  it("explica que a pesagem confirmada é o consumo — e começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["producao.folhaReceita"].title,
      /registrar de novo criaria duplicidade de consumo/,
    );
  });

  it("mostra o fluxo da parte única numerado, na ordem em que ele acontece", async () => {
    await abrir();

    await verificaFluxoNumerado("producao.folhaReceita", "Fluxo A · Parte única");
  });

  it("planejado, pesado e diferença têm o seu ⓘ na tabela da parte", async () => {
    await abrir();

    for (const id of [
      "producao.receita.planejado",
      "producao.receita.pesado",
      "producao.receita.diferenca",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }
  });
});

describe("Produto Acabado", () => {
  async function abrir() {
    vi.mocked(listFinishedGoods).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never);

    renderRota("/producao/produto-acabado", "/producao/produto-acabado", <FinishedGoodsPage />);
    await waitFor(() => expect(listFinishedGoods).toHaveBeenCalled());
  }

  it("explica que todo lote vem de um apontamento — e começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["producao.produtoAcabado"].title,
      /Produzido não é saldo/,
    );
  });

  it("separa produção total de produção parcial", async () => {
    await abrir();

    await verificaFluxoNumerado("producao.produtoAcabado", "Fluxo B · Produção parcial");
    expect(
      screen.getByRole("list", { name: "Fluxo: Fluxo A · Produção total" }),
    ).toBeInTheDocument();
  });

  it("as quatro quantidades do lote têm o seu ⓘ", async () => {
    await abrir();

    // Produzido, físico, reservado e disponível quase nunca são iguais. Sem o
    // ⓘ na coluna, "produzido" é lido como saldo.
    for (const id of [
      "producao.pa.produzido",
      "producao.pa.fisico",
      "producao.pa.reservado",
      "producao.pa.disponivel",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }
  });
});

describe("Templates de Formulação", () => {
  async function abrirLista() {
    vi.mocked(listFormulationTemplates).mockResolvedValue({
      templates: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never);

    renderRota(
      "/producao/templates-formulacao",
      "/producao/templates-formulacao",
      <FormulationTemplatesPage />,
    );
    await waitFor(() => expect(listFormulationTemplates).toHaveBeenCalled());
  }

  async function abrirDetalhe() {
    vi.mocked(getFormulationTemplate).mockResolvedValue({
      id: "ft-1",
      code: "FT-000008",
      name: "Biotina — Cápsulas Base",
      description: null,
      archived: false,
      archivedAt: null,
      versions: [],
      draftVersion: null,
      activeVersion: {
        id: "ftv-3",
        versionNumber: 3,
        versionLabel: "V3",
        status: "ACTIVE",
        basisQuantity: "1",
        calculationMode: "FIXED_BASIS",
        dosesPerPackage: null,
        outputUnitCode: "un",
        notes: null,
        usageCount: 2,
        sourceVersionId: null,
        sourceVersionNumber: null,
        createdAt: "2026-08-20T00:00:00.000Z",
        components: [
          {
            id: "c1",
            itemId: "i1",
            itemCode: "MP-000001",
            itemName: "Biotina",
            quantity: "0.5",
            unitCode: "g",
            supplyResponsibility: "VERIDI",
          },
        ],
      },
    } as never);

    renderRota(
      "/producao/templates-formulacao/:templateId",
      "/producao/templates-formulacao/ft-1",
      <FormulationTemplateDetailPage />,
    );
    await waitFor(() => expect(screen.getAllByText(/FT-000008/).length).toBeGreaterThan(0));
  }

  it("a lista explica que usar um template copia — e começa fechada", async () => {
    await abrirLista();

    await verificaPainel(
      helpTopics["producao.templates"].title,
      /Não existe sincronizar, atualizar em massa/,
    );
  });

  it("a lista separa criar do zero de salvar uma formulação existente", async () => {
    await abrirLista();

    await verificaFluxoNumerado("producao.templates", "Fluxo A · Criar uma matriz do zero");
    expect(
      screen.getByRole("list", {
        name: "Fluxo: Fluxo B · Salvar uma formulação existente como template",
      }),
    ).toBeInTheDocument();
  });

  it("o detalhe explica que versão ativa é história — e começa fechado", async () => {
    await abrirDetalhe();

    await verificaPainel(
      helpTopics["producao.templateDetalhe"].title,
      /Não existe “atualizar para a V4”/,
    );
  });

  it("o detalhe mostra o fluxo de alterar uma matriz já ativa, numerado", async () => {
    await abrirDetalhe();

    await verificaFluxoNumerado(
      "producao.templateDetalhe",
      "Fluxo B · Alterar uma matriz já ativa",
    );
  });

  it("“Usada por” e “Fornecimento padrão” têm o seu ⓘ no detalhe", async () => {
    await abrirDetalhe();

    for (const id of ["producao.template.usadaPor", "producao.template.fornecimentoPadrao"] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }
  });
});

describe("Vocabulário da tela", () => {
  /**
   * O glossário "Nesta tela" é a parte que responde "o que é isto?". Um
   * tópico de Produção sem ele volta a explicar só o caminho — que era
   * exatamente o problema apontado na revisão.
   */
  it("todo tópico de Produção apresenta os seus conceitos antes do fluxo", () => {
    for (const id of [
      "producao.picking",
      "producao.folhaReceita",
      "producao.produtoAcabado",
      "producao.templates",
      "producao.templateDetalhe",
    ] as const) {
      const topico: HelpTopic = helpTopics[id];
      const conceitos = topico.concepts ?? [];
      expect(conceitos.length).toBeGreaterThanOrEqual(4);
      expect(conceitos.length).toBeLessThanOrEqual(14);
    }
  });
});
