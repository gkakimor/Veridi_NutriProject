import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  FormulationTemplateDTO,
  FormulationTemplateSummaryDTO,
  FormulationTemplateVersionDTO,
  FormulationVersionDTO,
} from "@veridi/shared";

/**
 * Biblioteca de templates — o que a tela precisa deixar claro.
 *
 * Duas coisas se repetem nos testes porque são a promessa da capacidade:
 * usar um template COPIA, e nada se atualiza sozinho. Se a tela sugerir o
 * contrário em algum lugar, alguém vai contar com uma sincronização que não
 * existe.
 */

const listFormulationTemplates = vi.fn();
const getFormulationTemplate = vi.fn();
const createFormulationTemplate = vi.fn();
const activateFormulationTemplateVersion = vi.fn();
const createTemplateVersionFrom = vi.fn();
const updateFormulationTemplateVersion = vi.fn();
const updateFormulationTemplate = vi.fn();
const setFormulationTemplateArchived = vi.fn();
const compareTemplateVersions = vi.fn();
const applyTemplateToProduct = vi.fn();
const getTemplateUpdateAvailable = vi.fn();
const compareFormulationWithTemplate = vi.fn();
const createTemplateFromFormulation = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: (...a: unknown[]) => listFormulationTemplates(...a),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: (...a: unknown[]) => createFormulationTemplate(...a),
  activateFormulationTemplateVersion: (...a: unknown[]) => activateFormulationTemplateVersion(...a),
  createTemplateVersionFrom: (...a: unknown[]) => createTemplateVersionFrom(...a),
  updateFormulationTemplateVersion: (...a: unknown[]) => updateFormulationTemplateVersion(...a),
  updateFormulationTemplate: (...a: unknown[]) => updateFormulationTemplate(...a),
  setFormulationTemplateArchived: (...a: unknown[]) => setFormulationTemplateArchived(...a),
  compareTemplateVersions: (...a: unknown[]) => compareTemplateVersions(...a),
  applyTemplateToProduct: (...a: unknown[]) => applyTemplateToProduct(...a),
  getTemplateUpdateAvailable: (...a: unknown[]) => getTemplateUpdateAvailable(...a),
  compareFormulationWithTemplate: (...a: unknown[]) => compareFormulationWithTemplate(...a),
  createTemplateFromFormulation: (...a: unknown[]) => createTemplateFromFormulation(...a),
}));

vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => navigate, useParams: () => ({ templateId: "ft-1" }) };
});

import { FormulationTemplatesPage } from "./FormulationTemplatesPage";
import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";
import { UseTemplateDialog } from "./UseTemplateDialog";
import { FormulationTemplateOrigin } from "./FormulationTemplateOrigin";
import { TemplateDiff } from "./TemplateDiff";

function resumo(overrides: Partial<FormulationTemplateSummaryDTO> = {}): FormulationTemplateSummaryDTO {
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    activeVersionId: "ftv-3",
    activeVersionNumber: 3,
    basisQuantity: "1",
    outputUnitCode: "un",
    calculationMode: "FIXED_BASIS",
    componentCount: 2,
    componentItemCodes: ["MP-000001", "MP-000004"],
    hasDraft: false,
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function versao(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return {
    id: "ftv-3",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000008",
    templateName: "Biotina — Cápsulas Base",
    versionNumber: 3,
    versionLabel: "V3",
    status: "ACTIVE",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "un",
    notes: null,
    components: [
      {
        id: "c1",
        itemId: "i1",
        itemCode: "MP-000001",
        itemName: "Biotina",
        itemType: "RAW_MATERIAL",
        itemActive: true,
        quantity: "0.5",
        unitCode: "g",
        basis: "FIXED_BASIS",
        supplyResponsibility: "VERIDI",
        purityPercentApplied: null,
        overagePercent: null,
        notes: null,
        position: 0,
      },
    ],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-08-20T00:00:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: "ftv-2",
    sourceVersionNumber: 2,
    usageCount: 2,
    ...overrides,
  };
}

function template(overrides: Partial<FormulationTemplateDTO> = {}): FormulationTemplateDTO {
  const ativa = versao();
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: "Matriz base",
    archived: false,
    archivedAt: null,
    activeVersion: ativa,
    draftVersion: null,
    versions: [ativa],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function formulacao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-a",
    productCode: "PROD-000001",
    productName: "Produto A",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    components: [],
    originTemplateVersionId: "ftv-3",
    originTemplateCode: "FT-000008",
    originTemplateVersionNumber: 3,
    originTemplateName: "Biotina — Cápsulas Base",
    ...overrides,
  } as unknown as FormulationVersionDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  listFormulationTemplates.mockResolvedValue({
    templates: [resumo()],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  getFormulationTemplate.mockResolvedValue(template());
  getTemplateUpdateAvailable.mockResolvedValue(null);
});

describe("Biblioteca de templates", () => {
  it("lista as matrizes com versão ativa, base e componentes", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplatesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("FT-000008")).toBeInTheDocument());
    expect(screen.getByText("Biotina — Cápsulas Base")).toBeInTheDocument();
    expect(screen.getByText("V3")).toBeInTheDocument();
    // A tela precisa dizer que não há vínculo vivo.
    expect(
      screen.getByText(/alterar o template depois não muda nenhuma formulação já criada/i),
    ).toBeInTheDocument();
  });

  it("busca por código, nome ou componente", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplatesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listFormulationTemplates).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Buscar templates"), {
      target: { value: "MP-000001" },
    });
    await waitFor(() =>
      expect(listFormulationTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ search: "MP-000001" }),
      ),
    );
  });

  it("cria um template e abre o detalhe", async () => {
    createFormulationTemplate.mockResolvedValue(template({ id: "ft-novo" }));
    render(
      <MemoryRouter>
        <FormulationTemplatesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("FT-000008")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Novo template" }));
    fireEvent.change(screen.getByLabelText("Nome do template"), {
      target: { value: "DEMO — Biotina Base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(createFormulationTemplate).toHaveBeenCalledWith({ name: "DEMO — Biotina Base" }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/producao/templates-formulacao/ft-novo"),
    );
  });
});

describe("Detalhe do template", () => {
  it("mostra a versão ativa como leitura e oferece criar nova versão", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateDetailPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("FT-000008")).toBeInTheDocument());
    expect(screen.getByText(/Versão ativa — V3/)).toBeInTheDocument();
    // Versão ativa é histórica: a tela diz isso em vez de deixar editar.
    expect(screen.getByText(/para alterar, crie uma nova versão/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Criar nova versão" }),
    ).toBeInTheDocument();
  });

  it("diz quantas formulações nasceram da versão, e que elas não mudam", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateDetailPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/2 formulações de produto nasceram desta versão/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Nenhuma delas muda quando este template muda/)).toBeInTheDocument();
  });

  it("edita e ativa o rascunho", async () => {
    const rascunho = versao({ id: "ftv-4", versionNumber: 4, versionLabel: "V4", status: "DRAFT" });
    getFormulationTemplate.mockResolvedValue(
      template({ draftVersion: rascunho, versions: [versao(), rascunho] }),
    );
    updateFormulationTemplateVersion.mockResolvedValue(rascunho);
    activateFormulationTemplateVersion.mockResolvedValue({ ...rascunho, status: "ACTIVE" });

    render(
      <MemoryRouter>
        <FormulationTemplateDetailPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Rascunho — V4/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Ativar versão" }));
    await waitFor(() => expect(activateFormulationTemplateVersion).toHaveBeenCalledWith("ftv-4"));
  });

  it("mostra o histórico com origem e uso de cada versão", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateDetailPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Histórico de versões")).toBeInTheDocument());
    expect(screen.getByText("Criada a partir da V2")).toBeInTheDocument();
    expect(
      screen.getByText(/Versões anteriores continuam existindo/),
    ).toBeInTheDocument();
  });

  it("compara duas versões do template", async () => {
    compareTemplateVersions.mockResolvedValue({
      fromLabel: "FT-000008 · V2",
      toLabel: "FT-000008 · V3",
      entries: [
        {
          kind: "COMPONENT_CHANGED",
          label: "Biotina (MP-000001)",
          field: "Quantidade",
          from: "0.3",
          to: "0.5",
        },
      ],
    });

    render(
      <MemoryRouter>
        <FormulationTemplateDetailPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Histórico de versões")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Comparar versões" }));
    await waitFor(() =>
      expect(screen.getByText(/Comparando FT-000008 · V2 → FT-000008 · V3/)).toBeInTheDocument(),
    );
    // A composição da versão ativa também mostra 0.5; olha só o diff.
    const comparacao = screen.getByText(/Comparando/).closest(".template-diff")!;
    expect(within(comparacao as HTMLElement).getByText("0.3")).toBeInTheDocument();
    expect(within(comparacao as HTMLElement).getByText("Quantidade")).toBeInTheDocument();
  });
});

describe("Escolher template a partir do produto", () => {
  it("lista, revisa a composição e aplica", async () => {
    const aplicar = vi.fn();
    render(
      <MemoryRouter>
        <UseTemplateDialog onCancel={vi.fn()} onApply={aplicar} saving={false} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("FT-000008")).toBeInTheDocument());

    // Preview antes de copiar: aplicar traz a matriz inteira para o produto.
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await waitFor(() => expect(screen.getByText("MP-000001 — Biotina")).toBeInTheDocument());
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText(/O fornecimento padrão é uma sugestão do template/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usar este template" }));
    expect(aplicar).toHaveBeenCalledWith("ftv-3");
  });

  it("não oferece template sem versão ativa", async () => {
    listFormulationTemplates.mockResolvedValue({
      templates: [resumo({ activeVersionId: null, activeVersionNumber: null, hasDraft: true })],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(
      <MemoryRouter>
        <UseTemplateDialog onCancel={vi.fn()} onApply={vi.fn()} saving={false} />
      </MemoryRouter>,
    );

    // Rascunho é trabalho em curso: ninguém revisou aquela matriz ainda.
    await waitFor(() =>
      expect(screen.getByText(/não tem nenhum template ativo/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Revisar" })).not.toBeInTheDocument();
  });
});

describe("Origem da formulação", () => {
  it("mostra de onde a formulação veio", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit onChanged={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Criada a partir de/)).toBeInTheDocument());
    expect(screen.getByText(/FT-000008 · V3/)).toBeInTheDocument();
    expect(screen.getByText(/Biotina — Cápsulas Base/)).toBeInTheDocument();
  });

  it("formulação sem template não inventa origem", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateOrigin
          version={formulacao({
            originTemplateVersionId: null,
            originTemplateCode: null,
            originTemplateVersionNumber: null,
            originTemplateName: null,
          })}
          canEdit
          onChanged={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar como template" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Criada a partir de/)).not.toBeInTheDocument();
  });

  it("avisa que existe versão mais recente sem oferecer sobrescrever", async () => {
    getTemplateUpdateAvailable.mockResolvedValue({
      templateId: "ft-1",
      templateCode: "FT-000008",
      templateName: "Biotina — Cápsulas Base",
      originVersionId: "ftv-3",
      originVersionNumber: 3,
      latestVersionId: "ftv-4",
      latestVersionNumber: 4,
    });

    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit onChanged={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Existe uma versão mais recente do template/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Comparar com a V4/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Criar nova versão a partir da V4/ }),
    ).toBeInTheDocument();

    /*
     * NUNCA "atualizar para a V4": atualizar no lugar reescreveria uma receita
     * que já pode ter servido de base para custo, preço e produção.
     */
    expect(screen.queryByRole("button", { name: /^Atualizar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nada é sobrescrito/)).toBeInTheDocument();
  });

  it("cria nova versão a partir da versão nova do template", async () => {
    getTemplateUpdateAvailable.mockResolvedValue({
      templateId: "ft-1",
      templateCode: "FT-000008",
      templateName: "Biotina",
      originVersionId: "ftv-3",
      originVersionNumber: 3,
      latestVersionId: "ftv-4",
      latestVersionNumber: 4,
    });
    applyTemplateToProduct.mockResolvedValue(formulacao({ id: "fv-2", versionNumber: 2 }));

    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit onChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Criar nova versão a partir da V4/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Criar nova versão a partir da V4/ }));
    await waitFor(() =>
      expect(applyTemplateToProduct).toHaveBeenCalledWith("prod-a", "ftv-4"),
    );
  });

  it("compara a formulação com a versão nova", async () => {
    getTemplateUpdateAvailable.mockResolvedValue({
      templateId: "ft-1",
      templateCode: "FT-000008",
      templateName: "Biotina",
      originVersionId: "ftv-3",
      originVersionNumber: 3,
      latestVersionId: "ftv-4",
      latestVersionNumber: 4,
    });
    compareFormulationWithTemplate.mockResolvedValue({
      fromLabel: "Formulação V1",
      toLabel: "FT-000008 · V4",
      entries: [
        { kind: "COMPONENT_ADDED", label: "Zinco (MP-000009)", field: null, from: null, to: "0.1 g" },
      ],
    });

    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit onChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Comparar com a V4/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Comparar com a V4/ }));
    await waitFor(() =>
      expect(screen.getByText(/Formulação V1 → FT-000008 · V4/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Componente adicionado")).toBeInTheDocument();
    expect(screen.getByText("Zinco (MP-000009)")).toBeInTheDocument();
  });

  it("salva a formulação como template, deixando claro que é cópia", async () => {
    createTemplateFromFormulation.mockResolvedValue(template({ id: "ft-novo" }));

    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit onChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar como template" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Salvar como template" }));
    expect(
      screen.getByText(/É uma cópia: esta formulação continua exatamente como está/),
    ).toBeInTheDocument();
    expect(screen.getByText(/o template nasce em rascunho/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome do template"), {
      target: { value: "DEMO — Biotina Base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar template" }));

    await waitFor(() =>
      expect(createTemplateFromFormulation).toHaveBeenCalledWith("fv-1", {
        name: "DEMO — Biotina Base",
      }),
    );
  });

  it("quem não edita fórmula não vê ações de escrita", async () => {
    render(
      <MemoryRouter>
        <FormulationTemplateOrigin version={formulacao()} canEdit={false} onChanged={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Criada a partir de/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Salvar como template" })).not.toBeInTheDocument();
  });
});

describe("Comparação", () => {
  it("diz claramente quando nada muda", () => {
    render(
      <TemplateDiff
        diff={{ fromLabel: "FT-000008 · V3", toLabel: "FT-000008 · V4", entries: [] }}
      />,
    );
    expect(screen.getByText("Nada muda entre as duas versões.")).toBeInTheDocument();
  });

  it("mostra base, componentes adicionados, removidos e alterados", () => {
    render(
      <TemplateDiff
        diff={{
          fromLabel: "A",
          toLabel: "B",
          entries: [
            { kind: "BASIS", label: "Base da formulação", field: null, from: "1", to: "2" },
            { kind: "COMPONENT_ADDED", label: "Zinco", field: null, from: null, to: "0.1 g" },
            { kind: "COMPONENT_REMOVED", label: "Ferro", field: null, from: "0.2 g", to: null },
            {
              kind: "COMPONENT_CHANGED",
              label: "Biotina",
              field: "Fornecimento",
              from: "Veridi",
              to: "Cliente",
            },
          ],
        }}
      />,
    );

    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Base")).toBeInTheDocument();
    expect(within(tabela).getByText("Componente adicionado")).toBeInTheDocument();
    expect(within(tabela).getByText("Componente removido")).toBeInTheDocument();
    expect(within(tabela).getByText("Componente alterado")).toBeInTheDocument();
    expect(within(tabela).getByText("Cliente")).toBeInTheDocument();
  });
});
