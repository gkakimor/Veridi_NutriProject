import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { SupplierItemDetailDTO, SupplierItemQualificationEventDTO } from "@veridi/shared";
import { MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE } from "@veridi/shared";

/**
 * Bloquear a relação Item × Fornecedor pede o motivo — SUPPLIER-QUALITY-REJECTION-REASON-01.
 *
 * No detalhe da relação, "Bloquear" abre "Bloquear fornecedor para este item" com o
 * motivo obrigatório; nada vai para a API antes do motivo. Homologar e voltar para
 * pendente seguem diretos. O histórico mostra de → para, quem, quando e o motivo, e o
 * bloqueio antigo sem motivo diz "Motivo não registrado". O mesmo detalhe serve a tela
 * geral e o cadastro do Item; o Administrador que cria a relação já bloqueada também
 * informa o motivo.
 */

const sessao = vi.hoisted(() => ({ role: "QUALITY" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  createSupplierItem: vi.fn(),
  getSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ]),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: vi.fn(async () => ({ suppliers: [], page: 1, pageSize: 20, total: 0 })),
}));

import {
  changeSupplierItemQualification,
  createSupplierItem,
  getSupplierItem,
  listSupplierItems,
} from "../../lib/supplier-items-api";
import { ApiValidationError } from "../../lib/api-errors";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { SupplierItemFormModal } from "./SupplierItemFormModal";
import { SupplierItemsPage } from "./SupplierItemsPage";

const TITULO = "Bloquear fornecedor para este item";
const NAO_DECIDEM = ["PURCHASING", "PRODUCTION", "COMMERCIAL", "VIEWER"];

function evento(overrides: Partial<SupplierItemQualificationEventDTO>): SupplierItemQualificationEventDTO {
  return {
    id: "ev-1",
    fromStatus: null,
    toStatus: "PENDING",
    note: null,
    changedAt: "2026-09-01T15:00:00.000Z",
    changedByName: "Compras",
    ...overrides,
  };
}

function relacao(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    itemUnitCode: "kg",
    itemExternalCode: null,
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierActive: true,
    supplierItemCode: null,
    commercialNotes: null,
    qualificationStatus: "APPROVED",
    preferred: false,
    active: true,
    offers: [],
    offerCount: 0,
    qualificationHistory: [],
    currentOffer: null,
    latestLegacyOffer: null,
    costSourceAmbiguous: false,
    costSourceToday: {
      source: "NO_COST",
      unitCost: null,
      unitCode: "kg",
      details: null,
      referenceDate: "2026-09-16T12:00:00.000Z",
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Compras",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: "Compras",
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessao.role = "QUALITY";
});

async function abrirDetalhe(dto: SupplierItemDetailDTO) {
  vi.mocked(getSupplierItem).mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route
          path="/compras/item-fornecedor"
          element={<SupplierItemDetailModal supplierItemId="si-1" onClose={() => {}} />}
        />
      </Route>,
    ),
    { initialEntries: ["/compras/item-fornecedor"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText(/Vitamina C · Fornecedor Teste/);
}

const botao = (nome: string) => screen.queryByRole("button", { name: nome });
const observacao = () => document.getElementById("qualification-note") as HTMLInputElement;

async function abrirBloqueio() {
  fireEvent.click(botao("Bloquear")!);
  const dialogo = await screen.findByRole("alertdialog", { name: TITULO });
  return {
    dialogo,
    motivo: within(dialogo).getByLabelText(/^Motivo/) as HTMLTextAreaElement,
    confirmar: within(dialogo).getByRole("button", { name: "Bloquear" }),
  };
}

/** As linhas do histórico de homologação: [De, Para, Quem, Motivo / observação]. */
function linhasDoHistorico(): string[][] {
  const tabela = screen.getByRole("columnheader", { name: "Motivo / observação" }).closest("table")!;
  return within(tabela)
    .getAllByRole("row")
    .slice(1)
    .map((linha) =>
      within(linha)
        .getAllByRole("cell")
        .slice(1)
        .map((celula) => celula.textContent ?? ""),
    );
}

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — Bloquear no detalhe da relação", () => {
  it("abre o diálogo com o motivo obrigatório; nada vai para a API antes dele", async () => {
    await abrirDetalhe(relacao());

    const { dialogo, motivo, confirmar } = await abrirBloqueio();

    expect(within(dialogo).getByText("Este motivo ficará registrado no histórico de homologação.")).toBeInTheDocument();
    expect(motivo).toHaveAccessibleDescription("Este motivo ficará registrado no histórico de homologação.");
    expect(confirmar).toBeDisabled();

    // Espaços e texto curto demais não são motivo.
    for (const texto of ["   ", "ok", " ok "]) {
      fireEvent.change(motivo, { target: { value: texto } });
      expect(confirmar, JSON.stringify(texto)).toBeDisabled();
    }
    fireEvent.change(motivo, { target: { value: "CoA" } });
    expect(confirmar).toBeEnabled();
    expect(changeSupplierItemQualification).not.toHaveBeenCalled();
  });

  it("envia o motivo aparado, fecha o diálogo e o histórico devolvido mostra o motivo", async () => {
    vi.mocked(changeSupplierItemQualification).mockResolvedValue(
      relacao({
        qualificationStatus: "BLOCKED",
        qualificationHistory: [
          evento({ id: "ev-1", toStatus: "PENDING" }),
          evento({ id: "ev-2", fromStatus: "PENDING", toStatus: "APPROVED", changedByName: "Qualidade" }),
          evento({
            id: "ev-3",
            fromStatus: "APPROVED",
            toStatus: "BLOCKED",
            note: "Laudo reprovado",
            changedByName: "Sessão de teste",
          }),
        ],
      }),
    );
    await abrirDetalhe(relacao({ preferred: true }));

    const { dialogo, motivo, confirmar } = await abrirBloqueio();
    // Com o preferencial, a consequência é dita antes de confirmar.
    expect(within(dialogo).getByText(/deixa de ser o fornecedor preferencial do item/)).toBeInTheDocument();
    fireEvent.change(motivo, { target: { value: "  Laudo reprovado  " } });
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-1", {
        status: "BLOCKED",
        note: "Laudo reprovado",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(linhasDoHistorico().at(-1)).toEqual(["Homologado", "Bloqueado", "Sessão de teste", "Laudo reprovado"]),
    );
    // A nota foi gravada com a decisão: não fica pendente na tela.
    expect(observacao().value).toBe("");
    expect(botao("Bloquear")).toBeDisabled();
  });

  it("Cancelar não grava; o texto digitado continua na observação, e reabrir traz o mesmo texto", async () => {
    await abrirDetalhe(relacao());

    // O que já estava na "Observação da decisão" chega ao motivo.
    fireEvent.change(observacao(), { target: { value: "Especificação" } });
    const primeira = await abrirBloqueio();
    expect(primeira.motivo.value).toBe("Especificação");
    fireEvent.change(primeira.motivo, { target: { value: "Especificação divergente" } });
    fireEvent.click(within(primeira.dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(changeSupplierItemQualification).not.toHaveBeenCalled();
    expect(observacao().value).toBe("Especificação divergente");

    const segunda = await abrirBloqueio();
    expect(segunda.motivo.value).toBe("Especificação divergente");
    expect(segunda.confirmar).toBeEnabled();
  });

  it("recusa do servidor aparece com a frase, e o motivo digitado não se perde", async () => {
    vi.mocked(changeSupplierItemQualification).mockRejectedValue(
      new ApiValidationError([{ path: "note", message: MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE }]),
    );
    await abrirDetalhe(relacao());

    const { motivo, confirmar } = await abrirBloqueio();
    fireEvent.change(motivo, { target: { value: "Laudo reprovado" } });
    fireEvent.click(confirmar);

    expect(await screen.findByRole("alert")).toHaveTextContent(MOTIVO_DO_BLOQUEIO_OBRIGATORIO_MESSAGE);
    expect(observacao().value).toBe("Laudo reprovado");
  });

  it("Homologar segue direto, sem diálogo e sem motivo", async () => {
    vi.mocked(changeSupplierItemQualification).mockResolvedValue(relacao({ qualificationStatus: "APPROVED" }));
    await abrirDetalhe(relacao({ qualificationStatus: "PENDING" }));

    fireEvent.click(botao("Homologar")!);

    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-1", { status: "APPROVED" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Voltar para pendente segue direto — Compras também —, sem motivo", async () => {
    sessao.role = "PURCHASING";
    vi.mocked(changeSupplierItemQualification).mockResolvedValue(relacao({ qualificationStatus: "PENDING" }));
    await abrirDetalhe(relacao({ qualificationStatus: "BLOCKED" }));

    fireEvent.click(botao("Voltar para pendente")!);

    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-1", { status: "PENDING" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each(NAO_DECIDEM)("%s: não vê Bloquear, e o histórico com o motivo continua à vista", async (role) => {
    sessao.role = role;
    await abrirDetalhe(
      relacao({
        qualificationStatus: "BLOCKED",
        qualificationHistory: [
          evento({ id: "ev-1", fromStatus: "APPROVED", toStatus: "BLOCKED", note: "Laudo reprovado", changedByName: "Qualidade" }),
        ],
      }),
    );

    expect(botao("Bloquear"), role).toBeNull();
    expect(screen.queryByRole("alertdialog"), role).toBeNull();
    expect(linhasDoHistorico(), role).toEqual([["Homologado", "Bloqueado", "Qualidade", "Laudo reprovado"]]);
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — histórico de homologação", () => {
  it("de → para, quem e o motivo por evento; bloqueio antigo sem motivo diz 'Motivo não registrado'", async () => {
    await abrirDetalhe(
      relacao({
        qualificationStatus: "BLOCKED",
        qualificationHistory: [
          evento({ id: "ev-1", toStatus: "PENDING", note: "Relacao importada da planilha", changedByName: "Importação" }),
          evento({ id: "ev-2", fromStatus: "PENDING", toStatus: "APPROVED", note: null, changedByName: "Qualidade" }),
          evento({ id: "ev-3", fromStatus: "APPROVED", toStatus: "BLOCKED", note: null, changedByName: "Qualidade" }),
          evento({ id: "ev-4", fromStatus: "BLOCKED", toStatus: "PENDING", note: null, changedByName: "Compras" }),
          evento({
            id: "ev-5",
            fromStatus: "PENDING",
            toStatus: "BLOCKED",
            note: "Especificação divergente",
            changedByName: "Administrador",
          }),
        ],
      }),
    );

    expect(linhasDoHistorico()).toEqual([
      ["—", "Pendente", "Importação", "Relacao importada da planilha"],
      ["Pendente", "Homologado", "Qualidade", "—"],
      ["Homologado", "Bloqueado", "Qualidade", "Motivo não registrado"],
      ["Bloqueado", "Pendente", "Compras", "—"],
      ["Pendente", "Bloqueado", "Administrador", "Especificação divergente"],
    ]);
    // A data de cada evento continua na primeira coluna.
    const tabela = screen.getByRole("columnheader", { name: "Quando" }).closest("table")!;
    for (const linha of within(tabela).getAllByRole("row").slice(1)) {
      expect(within(linha).getAllByRole("cell")[0]!.textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    }
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — nova relação já bloqueada (Administrador)", () => {
  function escolher(placeholder: RegExp, termo: string) {
    const campo = screen.getByPlaceholderText(placeholder);
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: termo } });
    const lista = screen.getAllByRole("listbox").at(-1)!;
    const resultado = within(lista)
      .getAllByRole("option")
      .find((opcao) => !opcao.classList.contains("entity-select__create"));
    fireEvent.mouseDown(resultado!);
  }

  it("Bloqueado troca a observação por 'Motivo do bloqueio', obrigatório; Homologado segue sem motivo", async () => {
    sessao.role = "ADMIN";
    vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-1" } as never);
    render(
      <MemoryRouter>
        <SupplierItemFormModal
          items={[{ id: "item-1", code: "MP-000003", name: "Cafeína", type: "RAW_MATERIAL", unitCode: "kg" }] as never}
          suppliers={[{ id: "for-1", code: "FOR-000003", legalName: "SWEETMIX" }] as never}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </MemoryRouter>,
    );
    escolher(/Digite código ou nome do item/, "MP-000003");
    escolher(/Digite código ou nome do fornecedor/, "SWEETMIX");
    const criar = screen.getByRole("button", { name: /Criar relação/ });
    const situacao = screen.getByLabelText(/^Situação$/);

    // Homologado: a observação continua opcional.
    fireEvent.change(situacao, { target: { value: "APPROVED" } });
    expect(screen.getByLabelText(/Observação da decisão/)).toBeInTheDocument();
    expect(criar).toBeEnabled();

    fireEvent.change(situacao, { target: { value: "BLOCKED" } });
    expect(screen.queryByLabelText(/Observação da decisão/)).toBeNull();
    const motivo = screen.getByLabelText(/Motivo do bloqueio/);
    expect(screen.getByText("Este motivo ficará registrado no histórico de homologação.")).toBeInTheDocument();
    expect(criar).toBeDisabled();
    fireEvent.change(motivo, { target: { value: " no " } });
    expect(criar).toBeDisabled();
    fireEvent.change(motivo, { target: { value: "  Fornecedor não homologado  " } });
    expect(criar).toBeEnabled();

    fireEvent.click(criar);
    await waitFor(() => expect(createSupplierItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSupplierItem).mock.calls[0]![0]).toMatchObject({
      itemId: "item-1",
      supplierId: "for-1",
      qualificationStatus: "BLOCKED",
      qualificationNote: "Fornecedor não homologado",
    });
  });
});

describe("SUPPLIER-QUALITY-REJECTION-REASON-01 — a tela geral usa o mesmo detalhe", () => {
  it("Compras › Item × Fornecedor: abrir a linha e bloquear pede o motivo no mesmo diálogo", async () => {
    const linha = relacao();
    vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [linha], page: 1, pageSize: 20, total: 1 });
    vi.mocked(getSupplierItem).mockResolvedValue(linha);
    vi.mocked(changeSupplierItemQualification).mockResolvedValue(relacao({ qualificationStatus: "BLOCKED" }));
    render(
      <MemoryRouter initialEntries={["/compras/item-fornecedor"]}>
        <Routes>
          <Route path="/compras/item-fornecedor" element={<SupplierItemsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("cell", { name: "Fornecedor Teste" }));
    await screen.findByText(/Vitamina C · Fornecedor Teste/);
    const { motivo, confirmar } = await abrirBloqueio();
    expect(confirmar).toBeDisabled();
    fireEvent.change(motivo, { target: { value: "Documentação insuficiente" } });
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-1", {
        status: "BLOCKED",
        note: "Documentação insuficiente",
      }),
    );
  });
});
