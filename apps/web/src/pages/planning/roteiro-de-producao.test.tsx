import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  IndustrialResourceDTO,
  ProductionProfileDTO,
  ProductionProfileStepDTO,
  ProductionProfileStepResourceDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";
import { planProductionProfile } from "@veridi/shared";

/**
 * PRODUCTION-ROUTE-UX-01 — "Perfil de Produção" passa a se chamar ROTEIRO DE
 * PRODUÇÃO na interface.
 *
 * O que está protegido aqui é a LEITURA da tela: a palavra que o usuário lê, a
 * ordem em que os conceitos aparecem, o que a tela diz quando ainda não há
 * etapa ou recurso, e a resposta a "salvou?". O nome técnico continua
 * `ProductionProfile` — rota, API e schema inclusive —, e o cálculo continua
 * coberto pelas suítes de sempre.
 */

const listProductionProfiles = vi.fn();
const getProductionProfile = vi.fn();
const createProductionProfile = vi.fn();
const updateProductionProfile = vi.fn();
const updateProductionProfileVersion = vi.fn();
const activateProductionProfileVersion = vi.fn();
const createProductionProfileVersionFrom = vi.fn();
const setProductProductionProfile = vi.fn();

vi.mock("../../lib/production-profiles-api", () => ({
  listProductionProfiles: (...a: unknown[]) => listProductionProfiles(...a),
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  createProductionProfile: (...a: unknown[]) => createProductionProfile(...a),
  updateProductionProfile: (...a: unknown[]) => updateProductionProfile(...a),
  updateProductionProfileVersion: (...a: unknown[]) => updateProductionProfileVersion(...a),
  activateProductionProfileVersion: (...a: unknown[]) => activateProductionProfileVersion(...a),
  createProductionProfileVersionFrom: (...a: unknown[]) => createProductionProfileVersionFrom(...a),
  setProductProductionProfile: (...a: unknown[]) => setProductProductionProfile(...a),
}));

const listIndustrialResources = vi.fn();
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: (...a: unknown[]) => listIndustrialResources(...a),
}));

vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    ]),
}));

vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => navigate, useParams: () => ({ profileId: "ppr-1" }) };
});

import { ProductionProfilesPage } from "./ProductionProfilesPage";
import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";
import { helpTopics } from "../../help/help-content";

function recursoDoCatalogo(
  id: string,
  name: string,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
): IndustrialResourceDTO {
  return {
    id,
    code: `RIN-${id}`,
    name,
    type,
    description: null,
    defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
    powerKw: null,
    capacityQuantity: null,
    notes: null,
    active: true,
    currentRate: null,
    rateCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: null,
  };
}

function recursoDaEtapa(
  id: string,
  name: string,
  type: "LABOR" | "EQUIPMENT",
  quantidade: number,
): ProductionProfileStepResourceDTO {
  return {
    id: `sr-${id}`,
    industrialResourceId: id,
    resourceCode: `RIN-${id}`,
    resourceName: name,
    resourceType: type,
    resourceActive: true,
    resourceQuantity: quantidade,
    notes: null,
    sortOrder: 0,
  };
}

function passo(sobre: Partial<ProductionProfileStepDTO> = {}): ProductionProfileStepDTO {
  return {
    id: "st-1",
    sequence: 1,
    name: "Mistura",
    description: null,
    setupDurationMinutes: 0,
    runDurationMinutes: 120,
    scalingMode: "PROPORTIONAL",
    resources: [],
    ...sobre,
  };
}

function versao(sobre: Partial<ProductionProfileVersionDTO> = {}): ProductionProfileVersionDTO {
  return {
    id: "ppv-1",
    productionProfileId: "ppr-1",
    profileCode: "PPR-000001",
    profileName: "Cápsulas — linha padrão",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    referenceQuantity: "1000",
    referenceUomCode: "un",
    notes: null,
    steps: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    ...sobre,
  };
}

function perfil(sobre: Partial<ProductionProfileDTO> = {}): ProductionProfileDTO {
  const rascunho = sobre.draftVersion === undefined ? versao() : sobre.draftVersion;
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: rascunho ? [rascunho] : [],
    defaultProducts: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-11T12:00:00.000Z",
    ...sobre,
  };
}

/** Uma etapa completa, com mão de obra e equipamento. */
const etapaCompleta = () =>
  passo({
    name: "Encapsulamento",
    setupDurationMinutes: 30,
    runDurationMinutes: 60,
    resources: [
      recursoDaEtapa("op", "Mão de obra — Produção", "LABOR", 2),
      recursoDaEtapa("enc", "Encapsuladora", "EQUIPMENT", 1),
    ],
  });

async function abrirDetalhe(dto: ProductionProfileDTO) {
  getProductionProfile.mockResolvedValue(dto);
  const utils = render(
    <MemoryRouter>
      <ProductionProfileDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: /PPR-000001/ });
  return utils;
}

const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const simulacao = () => screen.getAllByRole("region", { name: "Simulação do roteiro" })[0]!;

const css = () => readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  listProductionProfiles.mockResolvedValue({ profiles: [], page: 1, pageSize: 20, total: 0 });
  listIndustrialResources.mockResolvedValue({
    resources: [
      recursoDoCatalogo("op", "Mão de obra — Produção", "LABOR"),
      recursoDoCatalogo("enc", "Encapsuladora", "EQUIPMENT"),
      recursoDoCatalogo("en", "Energia elétrica", "ENERGY"),
    ],
    page: 1,
    pageSize: 100,
    total: 3,
  });
  updateProductionProfileVersion.mockResolvedValue(versao());
  updateProductionProfile.mockResolvedValue({});
  activateProductionProfileVersion.mockResolvedValue({});
});

describe("A palavra que o usuário lê é ROTEIRO", () => {
  it("a lista se chama Roteiros de Produção e explica para que serve", async () => {
    render(
      <MemoryRouter>
        <ProductionProfilesPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Roteiros de Produção" }),
    ).toBeInTheDocument();
    // A diferença para a Formulação é o que a tela precisava dizer.
    expect(screen.getByText(/A Formulação diz o que entra no produto/)).toBeInTheDocument();
    expect(botao("Novo roteiro")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Quantidade de referência" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Perfil de Produção");
  });

  it("o detalhe volta para Roteiros de Produção, e a rota técnica não muda", async () => {
    await abrirDetalhe(perfil());

    const volta = screen.getByRole("link", { name: "Roteiros de Produção" });
    expect(volta).toHaveAttribute("href", "/planejamento/perfis-producao");
  });

  it("a ajuda explica o roteiro e o separa da Formulação", () => {
    const topico = helpTopics["planejamento.perfisProducao"];
    expect(topico.title).toContain("Roteiro de Produção");
    const glossario = (topico.concepts ?? []).map((c) => `${c.term} ${c.text}`).join("\n");
    expect(glossario).toContain("Quantidade de referência");
    expect(glossario).toContain("A Formulação é a receita");
    expect(glossario).toContain("Quantidade necessária");
    // O que vem depois desta capacidade é dito, não prometido como pronto.
    expect((topico.notes ?? []).join("\n")).toContain("Planejamento");
  });
});

describe("Quantidade de referência e etapas", () => {
  it("a quantidade de referência tem rótulo, exemplo e unidade própria", async () => {
    await abrirDetalhe(perfil());

    expect(screen.getByLabelText("Quantidade de referência")).toHaveValue("1000");
    // Sem separador de milhar: é a regra da tela para quantidade, porque o
    // valor exibido é copiado de volta para o campo (ver `lib/quantity.ts`).
    expect(screen.getByText(/se encapsular 1000 un leva 60 min, informe 1000/)).toBeInTheDocument();
    expect(screen.getByLabelText("Unidade de referência")).toHaveValue("un");
    expect(
      screen.getByText("Use a mesma unidade do produto que utilizará este roteiro."),
    ).toBeInTheDocument();
  });

  it("sem etapa, a tela diz o que falta e dá um exemplo", async () => {
    await abrirDetalhe(perfil());

    expect(screen.getByRole("heading", { name: "Etapas do processo" })).toBeInTheDocument();
    expect(
      screen.getByText("As etapas acontecem na ordem abaixo. Cada etapa começa depois que a anterior termina."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nenhuma etapa cadastrada.")).toBeInTheDocument();
    expect(screen.getByText(/Pesagem, Mistura, Encapsulamento ou Embalagem/)).toBeInTheDocument();

    // O botão do estado vazio é o ÚNICO enquanto não há etapa.
    expect(screen.getAllByRole("button", { name: "+ Adicionar etapa" })).toHaveLength(1);
    fireEvent.click(botao("+ Adicionar etapa"));
    expect(screen.queryByText("Nenhuma etapa cadastrada.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "+ Adicionar etapa" })).toHaveLength(1);
  });

  it("proporcional e por lote se explicam em português, com a quantidade da tela", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    expect(
      screen.getByText(/O tempo de execução cresce proporcionalmente à quantidade, a partir de 1.?000 un./),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Modo de escala"), { target: { value: "BY_BATCH" } });
    expect(
      screen.getByText(/O tempo de execução cresce a cada lote de 1.?000 un — lote começado conta inteiro./),
    ).toBeInTheDocument();
  });

  it("preparação é tempo fixo, execução acompanha a quantidade de referência", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    expect(screen.getByText("Tempo fixo da etapa. Não aumenta com a quantidade.")).toBeInTheDocument();
    expect(screen.getByLabelText("Execução da base (min)")).toBeInTheDocument();
    expect(screen.getByText(/^Tempo para 1.?000 un.$/)).toBeInTheDocument();
  });
});

describe("Recursos da etapa", () => {
  it("a seção diz o que é recurso e de onde ele vem", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [etapaCompleta()] }) }));

    expect(screen.getByText("Recursos necessários para a etapa")).toBeInTheDocument();
    expect(
      screen.getByText(/precisam estar disponíveis ao mesmo tempo durante esta etapa/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recursos industriais" })).toHaveAttribute(
      "href",
      "/gestao/recursos-industriais",
    );
  });

  it("mão de obra e equipamento são escolhíveis; energia não aparece", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [etapaCompleta()] }) }));

    const selects = screen.getAllByLabelText("Recurso");
    const opcoes = Array.from(selects[0]!.querySelectorAll("option")).map((o) => o.textContent ?? "");
    expect(opcoes.some((texto) => texto.includes("Mão de obra — Produção"))).toBe(true);
    expect(opcoes.some((texto) => texto.includes("Encapsuladora"))).toBe(true);
    expect(opcoes.some((texto) => texto.includes("Energia elétrica"))).toBe(false);
    expect(screen.getByText(/Energia não é selecionada aqui/)).toBeInTheDocument();
  });

  it("a quantidade é o que trabalha ao mesmo tempo, e o texto diz isso com número", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [etapaCompleta()] }) }));

    expect(screen.getAllByLabelText("Quantidade necessária")[0]).toHaveValue("2");
    expect(
      screen.getByText(/2 operadores durante uma etapa de 2 h ocupam 4 horas-recurso/),
    ).toBeInTheDocument();
  });

  it("sem recurso cadastrado, a tela oferece o cadastro e guarda o rascunho", async () => {
    listIndustrialResources.mockResolvedValue({ resources: [], page: 1, pageSize: 100, total: 0 });
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    await screen.findByText("Nenhum recurso de produção cadastrado.");
    expect(screen.getByText(/Cadastre mão de obra ou equipamento/)).toBeInTheDocument();
    // Sem catálogo, não se oferece "+ Adicionar recurso" para escolher o nada.
    expect(screen.queryByRole("button", { name: "+ Adicionar recurso" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    fireEvent.click(botao("Cadastrar recurso"));

    const destino = navigate.mock.calls.at(-1)?.[0] as string;
    expect(destino).toContain("/gestao/recursos-industriais/novo");
    // O retorno é o padrão do ERP, não uma navegação improvisada.
    expect(destino).toContain("origem=");
    const guardado = Object.keys(sessionStorage).some((chave) =>
      (sessionStorage.getItem(chave) ?? "").includes('"base":"500"'),
    );
    expect(guardado).toBe(true);
  });
});

describe("Resumo e simulação", () => {
  it("o resumo sai do MESMO motor da simulação", async () => {
    const steps = [etapaCompleta()];
    await abrirDetalhe(perfil({ draftVersion: versao({ steps }) }));

    const plano = planProductionProfile(
      {
        referenceQuantity: "1000",
        steps: steps.map((step) => ({
          sequence: step.sequence,
          name: step.name,
          setupDurationMinutes: step.setupDurationMinutes,
          runDurationMinutes: step.runDurationMinutes,
          scalingMode: step.scalingMode,
          resources: step.resources.map((recurso) => ({
            industrialResourceId: recurso.industrialResourceId,
            resourceName: recurso.resourceName,
            resourceType: recurso.resourceType,
            resourceQuantity: recurso.resourceQuantity,
          })),
        })),
      },
      "1000",
    );

    const resumo = screen.getAllByRole("group", { name: "Resumo do roteiro" })[0]!;
    expect(within(resumo).getByText("Etapas").nextElementSibling).toHaveTextContent(
      String(plano.steps.length),
    );
    // 30 min de preparação + 60 de execução = 1 h 30, o que o motor devolve.
    expect(within(resumo).getByText(/^Tempo para 1.?000 un$/).nextElementSibling).toHaveTextContent(
      "1 h 30 min",
    );
    expect(plano.totalDurationMinutes).toBe("90");
    expect(within(resumo).getByText("Tipos de mão de obra").nextElementSibling).toHaveTextContent("1");
    expect(within(resumo).getByText("Tipos de equipamento").nextElementSibling).toHaveTextContent("1");
  });

  it("a simulação vem DEPOIS das etapas e não grava nada", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [etapaCompleta()] }) }));

    const etapas = screen.getByRole("heading", { name: "Etapas do processo" });
    const bloco = screen.getByRole("heading", { name: /Simulação do roteiro/ });
    // DOCUMENT_POSITION_FOLLOWING: a simulação vem depois na ordem do documento.
    expect(etapas.compareDocumentPosition(bloco) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(simulacao()).getByText(/A simulação não grava nada/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantidade para simular (un)"), {
      target: { value: "3000" },
    });
    expect(within(simulacao()).getByText(/Tempo sequencial total/)).toBeInTheDocument();
    expect(updateProductionProfileVersion).not.toHaveBeenCalled();
    expect(activateProductionProfileVersion).not.toHaveBeenCalled();
  });

  it("sem etapa, a simulação diz o que falta em vez de mostrar área vazia", async () => {
    await abrirDetalhe(perfil());

    expect(within(simulacao()).getByText("Adicione etapas para simular o roteiro.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Resumo do roteiro" })).toBeNull();
  });
});

describe("Ações e feedback", () => {
  it("as ações do rascunho ficam em grupos, com hierarquia", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    const barra = botao("Salvar rascunho").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    expect(barra.querySelectorAll(".form-actions__group")).toHaveLength(2);
    expect(botao("+ Adicionar etapa").className).toContain("btn--ghost");
    expect(botao("Salvar rascunho").className).toContain("btn--secondary");
    expect(botao("Ativar versão").className).toContain("btn--accent");
    // A barra antiga, sem gap nenhum, não sobrou na tela.
    expect(document.querySelectorAll(".doc-body .line-actions")).toHaveLength(0);
  });

  it("gravar diz Salvando…, recusa o segundo clique e confirma", async () => {
    let liberar: () => void = () => {};
    updateProductionProfileVersion.mockImplementation(
      () => new Promise<void>((resolve) => (liberar = () => resolve())),
    );
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    expect(botao("Salvar rascunho")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    getProductionProfile.mockResolvedValue(
      perfil({ draftVersion: versao({ referenceQuantity: "500", steps: [passo()] }) }),
    );
    fireEvent.click(botao("Salvar rascunho"));

    const emCurso = await screen.findByRole("button", { name: "Salvando…" });
    expect(emCurso).toBeDisabled();
    fireEvent.click(emCurso);
    expect(updateProductionProfileVersion).toHaveBeenCalledTimes(1);

    liberar();
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(screen.getAllByText("Rascunho salvo.")).toHaveLength(1);
    expect(screen.getByText("Rascunho salvo.")).toHaveAttribute("role", "status");
  });

  it("erro fica visível e não é lido como sucesso", async () => {
    updateProductionProfileVersion.mockRejectedValue(new Error("Etapa 1: informe o nome."));
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Etapa 1: informe o nome.");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });

  it("gravar o rascunho não absolve o nome trocado", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Cápsulas — linha 2" } });
    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(2);

    getProductionProfile.mockResolvedValue(
      perfil({ draftVersion: versao({ referenceQuantity: "500", steps: [passo()] }) }),
    );
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    // A leitura que veio com o salvamento não reescreve o que foi digitado.
    expect(screen.getByLabelText("Nome")).toHaveValue("Cápsulas — linha 2");
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(1);
    expect(botao("Salvar identificação")).toBeEnabled();
  });

  it("ativar continua exigindo o rascunho salvo, e confirma com outra frase", async () => {
    const ativa = versao({ id: "ppv-1", status: "ACTIVE", steps: [passo()] });
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    expect(botao("Ativar versão")).toBeDisabled();
    expect(screen.getByText("Salve o rascunho antes de ativar a versão.")).toBeInTheDocument();

    getProductionProfile.mockResolvedValue(
      perfil({ draftVersion: versao({ referenceQuantity: "500", steps: [passo()] }) }),
    );
    fireEvent.click(botao("Salvar rascunho"));
    await screen.findByText("Rascunho salvo.");

    getProductionProfile.mockResolvedValue(
      perfil({ activeVersion: ativa, draftVersion: null, versions: [ativa] }),
    );
    fireEvent.click(botao("Ativar versão"));

    await waitFor(() => expect(activateProductionProfileVersion).toHaveBeenCalledWith("ppv-1"));
    expect(await screen.findByText("Versão ativada.")).toBeInTheDocument();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});

describe("Tela estreita", () => {
  it("resumo vira dois pares e a ação do estado vazio ocupa a linha", () => {
    const folha = css();
    const estreita = folha.slice(folha.indexOf("@media (max-width: 720px)"));
    expect(estreita).toContain(".profile-summary");
    expect(estreita).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(estreita).toContain(".profile-empty .btn");
    expect(estreita).toContain("width: 100%");
    // Cartão de etapa e linha de recurso continuam empilhando.
    expect(estreita).toContain(".profile-step__resource");
  });
});
