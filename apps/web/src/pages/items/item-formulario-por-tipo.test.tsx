import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  ItemDTO,
  ItemLabelFileResponse,
  ItemLabelFileVersionDTO,
  PackagingSubtype,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { ITEM_LABEL_FILE_ACCEPT, ITEM_TYPE_DEFAULTS } from "@veridi/shared";

/**
 * ITEM-FORM-BY-TYPE-01 — o cadastro do Item mostra só o que é do Tipo.
 *
 * Matéria-prima tem a classificação industrial; embalagem tem subtipo e a marca
 * de consumo; embalagem com subtipo Rótulo aceita o arquivo da arte já na
 * criação. Quem decide é `Item.type` (e o subtipo), nunca a Família nem o nome.
 *
 * O arquivo escolhido na criação fica na tela até o Item existir: criar,
 * receber o id e só então enviar pela rota oficial do arquivo do rótulo. Se o
 * envio cair depois de criar, o Item NÃO é criado de novo — a tela diz que o
 * item foi criado e abre a seção oficial do arquivo para tentar outra vez.
 */

vi.mock("../../lib/items-api", () => ({ createItem: vi.fn(), updateItem: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../lib/item-label-files-api", () => ({
  getItemLabelFile: vi.fn(),
  uploadItemLabelFileVersion: vi.fn(),
  voidItemLabelFileVersion: vi.fn(),
  restoreItemLabelFileVersion: vi.fn(),
  itemLabelFileDownloadUrl: (itemId: string, versionId: string) =>
    `http://api.teste/items/${itemId}/label-file/versions/${versionId}/download`,
}));
vi.mock("../supplier-items/FornecedoresDoItem", () => ({ FornecedoresDoItemSection: () => null }));
vi.mock("../../components/ItemCostReferenceSection", () => ({
  ItemCostReferenceSection: () => null,
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createItem, updateItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { getItemLabelFile, uploadItemLabelFileVersion } from "../../lib/item-label-files-api";
import { readContextualCreate, startContextualCreate } from "../../lib/contextual-create";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ItemCreatePage } from "./ItemCreatePage";
import { ItemFormModal } from "./ItemFormModal";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

const ID_CRIADO = "item-rotulo-novo";

function rotuloCriado(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: ID_CRIADO,
    code: "ME-000900",
    type: "PACKAGING",
    name: "Rótulo frontal Vitamina C",
    unitCode: "un",
    unit: UNIDADES[1]!,
    ...ITEM_TYPE_DEFAULTS.PACKAGING,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: "LABEL",
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}

const V1: ItemLabelFileVersionDTO = {
  id: "v-1",
  itemId: ID_CRIADO,
  versionNumber: 1,
  status: "CURRENT",
  originalFileName: "rotulo-frontal.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  note: null,
  restoredFromVersionNumber: null,
  createdAt: "2026-09-17T10:05:00.000Z",
  createdByName: "Sessão de teste",
  voidedAt: null,
  voidedByName: null,
  voidReason: null,
};

function estadoDoArquivo(itemId: string, versions: ItemLabelFileVersionDTO[] = []): ItemLabelFileResponse {
  return {
    itemId,
    labelItem: true,
    itemActive: true,
    acceptsNewVersion: true,
    current: versions.find((versao) => versao.status === "CURRENT") ?? null,
    versions,
  };
}

function arquivo(nome: string, tipo: string, tamanho = 2048): File {
  const file = new File(["%PDF-1.4"], nome, { type: tipo });
  Object.defineProperty(file, "size", { value: tamanho });
  return file;
}

function adiado<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

const seletor = (id: string) => document.getElementById(id) as HTMLSelectElement;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const secao = (titulo: string) => screen.queryByRole("heading", { name: titulo });
const campoDoArquivo = () => campo("item-label-file");
const rodapeDaPagina = () => document.querySelector(".doc-actions") as HTMLElement;

/** `a` vem antes de `b` na tela. */
function antes(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderPagina(entrada = "/cadastros/itens/novo") {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
        <Route path="/cadastros/itens" element={<p>lista de itens</p>} />
        <Route path="/producao/formulacoes" element={<p>tela de origem</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function unidadesCarregadas() {
  await waitFor(() => expect(seletor("item-unit").options.length).toBeGreaterThan(1));
}

async function escolherTipo(tipo: string) {
  await unidadesCarregadas();
  fireEvent.change(seletor("item-type"), { target: { value: tipo } });
}

function escolherSubtipo(subtipo: string) {
  fireEvent.change(seletor("item-packaging-subtype"), { target: { value: subtipo } });
}

/** Embalagem Rótulo com o mínimo que a API exige. */
async function prepararRotulo() {
  await escolherTipo("PACKAGING");
  fireEvent.change(seletor("item-unit"), { target: { value: "un" } });
  fireEvent.change(campo("item-name")!, { target: { value: "Rótulo frontal Vitamina C" } });
  escolherSubtipo("LABEL");
}

function escolherArquivo(file: File) {
  fireEvent.change(campoDoArquivo()!, { target: { files: [file] } });
}

const criar = () => fireEvent.click(screen.getByRole("button", { name: "Criar item" }));
const payloadCriado = () => vi.mocked(createItem).mock.calls[0]![0];

beforeEach(() => {
  window.sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(createItem).mockReset();
  vi.mocked(updateItem).mockReset();
  vi.mocked(listUnits).mockReset();
  vi.mocked(getItemLabelFile).mockReset();
  vi.mocked(uploadItemLabelFileVersion).mockReset();
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
  vi.mocked(createItem).mockResolvedValue(rotuloCriado());
  vi.mocked(updateItem).mockImplementation(async (id) => rotuloCriado({ id }));
  vi.mocked(getItemLabelFile).mockImplementation(async (itemId) => estadoDoArquivo(itemId));
  vi.mocked(uploadItemLabelFileVersion).mockResolvedValue(estadoDoArquivo(ID_CRIADO, [V1]));
});

describe("ITEM-FORM-BY-TYPE-01 — Matéria-prima", () => {
  it("mostra Fonte, Família, Nutriente declarado e Pureza; não mostra Subtipo nem Arquivo do rótulo", async () => {
    renderPagina();
    await escolherTipo("RAW_MATERIAL");

    expect(secao("Classificação industrial")).toBeInTheDocument();
    expect(screen.getByLabelText("Fonte")).toBeInTheDocument();
    expect(screen.getByLabelText("Família")).toBeInTheDocument();
    expect(screen.getByLabelText("Nutriente declarado")).toBeInTheDocument();
    expect(screen.getByLabelText("Pureza padrão (%)")).toBeInTheDocument();
    // Pureza em branco continua DESCONHECIDA, nunca 100%.
    expect(screen.getByText("Em branco significa pureza desconhecida — nunca 100%.")).toBeInTheDocument();

    expect(secao("Dados da embalagem")).toBeNull();
    expect(campo("item-packaging-subtype")).toBeNull();
    expect(campo("item-consumed-in-production")).toBeNull();
    expect(secao("Arquivo do rótulo")).toBeNull();
    expect(campoDoArquivo()).toBeNull();
  });

  it("sem tipo escolhido não há seção de tipo nenhum", async () => {
    renderPagina();
    await unidadesCarregadas();

    expect(secao("Classificação industrial")).toBeNull();
    expect(secao("Dados da embalagem")).toBeNull();
    expect(secao("Arquivo do rótulo")).toBeNull();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — Material de embalagem que não é Rótulo", () => {
  const OUTROS: (PackagingSubtype | "")[] = [
    "",
    "POT",
    "CAP",
    "SCOOP",
    "SEAL",
    "BOX",
    "POUCH",
    "CARTON",
    "BOTTLE",
    "OTHER",
  ];

  it.each(OUTROS)("subtipo '%s': dados da embalagem, sem classificação industrial nem arquivo", async (subtipo) => {
    renderPagina();
    await escolherTipo("PACKAGING");
    escolherSubtipo(subtipo);

    expect(secao("Classificação industrial"), subtipo).toBeNull();
    expect(campo("item-source-name"), subtipo).toBeNull();
    expect(campo("item-declared-nutrient"), subtipo).toBeNull();
    expect(campo("item-purity"), subtipo).toBeNull();
    expect(campo("item-family"), subtipo).toBeNull();
    expect(screen.queryByLabelText("Família"), subtipo).toBeNull();

    expect(secao("Dados da embalagem"), subtipo).toBeInTheDocument();
    expect(seletor("item-packaging-subtype").value, subtipo).toBe(subtipo);
    expect(campo("item-consumed-in-production"), subtipo).not.toBeNull();

    expect(secao("Arquivo do rótulo"), subtipo).toBeNull();
    expect(campoDoArquivo(), subtipo).toBeNull();
  });

  it("nem pelo nome: Pote chamado 'Rótulo' não ganha arquivo", async () => {
    renderPagina();
    await escolherTipo("PACKAGING");
    fireEvent.change(campo("item-name")!, { target: { value: "Rótulo do pote 500 g" } });
    escolherSubtipo("POT");

    expect(secao("Arquivo do rótulo")).toBeNull();
    expect(campoDoArquivo()).toBeNull();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — Rótulo na criação", () => {
  it("o arquivo do rótulo aparece logo depois dos dados da embalagem, com os formatos e o limite vigentes", async () => {
    renderPagina();
    await prepararRotulo();

    const dados = secao("Dados da embalagem")!;
    const arquivoDoRotulo = secao("Arquivo do rótulo")!;
    const controles = secao("Controles de rastreabilidade")!;
    expect(arquivoDoRotulo).toBeInTheDocument();
    expect(antes(dados, arquivoDoRotulo)).toBe(true);
    expect(antes(arquivoDoRotulo, controles)).toBe(true);

    expect(screen.getByText("Anexe a arte ou documento correspondente a este rótulo.")).toBeInTheDocument();
    const input = screen.getByLabelText("Arquivo (será a V1)") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(ITEM_LABEL_FILE_ACCEPT);
    expect(input).not.toBeRequired();
    expect(screen.getByText(/PDF, PNG ou JPEG · até 25 MB\. Opcional/)).toBeInTheDocument();
  });

  it.each([
    ["rotulo.pdf", "application/pdf"],
    ["rotulo.png", "image/png"],
    ["rotulo.jpg", "image/jpeg"],
    ["rotulo.jpeg", "image/jpeg"],
  ])("aceita %s e só guarda na tela — nada sobe antes de criar", async (nome, tipo) => {
    renderPagina();
    await prepararRotulo();

    escolherArquivo(arquivo(nome, tipo));

    const escolhido = screen.getByLabelText("Arquivo do rótulo escolhido");
    expect(escolhido).toHaveTextContent(nome);
    expect(screen.getByText("Vai como V1, logo depois de criar o item.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("arquivo recusado na tela não deixa criar; remover volta ao campo e cria sem arquivo", async () => {
    renderPagina();
    await prepararRotulo();

    escolherArquivo(arquivo("rotulo.docx", "application/msword"));
    expect(screen.getByText("Tipo de arquivo não aceito. Envie PDF, PNG ou JPEG.")).toBeInTheDocument();

    criar();
    expect(await screen.findByText("Corrija os campos destacados.")).toBeInTheDocument();
    expect(createItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover arquivo" }));
    expect(campoDoArquivo()).not.toBeNull();

    criar();
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it("arquivo acima do limite também é recusado antes de criar", async () => {
    renderPagina();
    await prepararRotulo();

    escolherArquivo(arquivo("rotulo.pdf", "application/pdf", 26 * 1024 * 1024));
    expect(screen.getByText("Arquivo acima do limite de 25 MB.")).toBeInTheDocument();

    criar();
    expect(await screen.findByText("Corrija os campos destacados.")).toBeInTheDocument();
    expect(createItem).not.toHaveBeenCalled();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — criar Rótulo e enviar o arquivo", () => {
  it("1. cria Rótulo sem arquivo: o arquivo é opcional e nada é enviado", async () => {
    renderPagina();
    await prepararRotulo();

    criar();

    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(payloadCriado()).toMatchObject({
      type: "PACKAGING",
      unitCode: "un",
      packagingSubtype: "LABEL",
    });
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it("2. Rótulo com arquivo: cria, recebe o id, só então envia — e só depois navega", async () => {
    const criacao = adiado<ItemDTO>();
    const envio = adiado<ItemLabelFileResponse>();
    vi.mocked(createItem).mockReturnValue(criacao.promessa);
    vi.mocked(uploadItemLabelFileVersion).mockReturnValue(envio.promessa);
    renderPagina();
    await prepararRotulo();
    const escolhido = arquivo("rotulo-frontal.pdf", "application/pdf");
    escolherArquivo(escolhido);

    criar();
    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    // Sem id ainda: nada sobe.
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();

    await act(async () => {
      criacao.resolver(rotuloCriado());
    });
    await waitFor(() => expect(uploadItemLabelFileVersion).toHaveBeenCalledWith(ID_CRIADO, escolhido));
    expect(vi.mocked(createItem).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(uploadItemLabelFileVersion).mock.invocationCallOrder[0]!,
    );
    // Envio em curso: a navegação normal ainda não aconteceu.
    expect(screen.queryByText("lista de itens")).toBeNull();

    await act(async () => {
      envio.resolver(estadoDoArquivo(ID_CRIADO, [V1]));
    });
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(uploadItemLabelFileVersion).toHaveBeenCalledTimes(1);
  });

  it("3. envio cai depois de criar: não recria, não diz 'falha ao criar' e diz que o item foi criado", async () => {
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValueOnce(new Error("O arquivo não é um PDF válido."));
    renderPagina();
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));

    criar();

    expect(
      await screen.findByText(
        "Item criado, mas o arquivo do rótulo não pôde ser enviado. O arquivo não é um PDF válido.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/falha ao (criar|salvar) item/i)).toBeNull();
    expect(screen.queryByText("lista de itens")).toBeNull();

    // A tela deixou de ser criação: sem formulário, sem "Criar item", sem Cancelar.
    expect(document.getElementById("item-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /Criar item|Criando/ })).toBeNull();
    expect(within(rodapeDaPagina()).queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(within(rodapeDaPagina()).getByRole("button", { name: "Concluir" })).toBeInTheDocument();

    const criado = screen.getByRole("heading", { name: "Item criado" }).closest("section")!;
    expect(criado).toHaveTextContent("ME-000900");
    expect(criado).toHaveTextContent("Rótulo frontal Vitamina C");

    await waitFor(() => expect(getItemLabelFile).toHaveBeenCalledWith(ID_CRIADO));
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(uploadItemLabelFileVersion).toHaveBeenCalledTimes(1);
  });

  it("4. reenvio pela seção oficial do Item criado, e Concluir segue a navegação normal", async () => {
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValueOnce(new Error("Falha de rede."));
    renderPagina();
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));
    criar();
    await screen.findByText(/Item criado, mas o arquivo do rótulo não pôde ser enviado\./);

    // A seção do Item criado abre com o envio já aberto — é a V1 dele.
    const denovo = arquivo("rotulo-frontal.pdf", "application/pdf");
    fireEvent.change(await screen.findByLabelText(/Arquivo \(será a V1\)/), { target: { files: [denovo] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar nova versão" }));

    await waitFor(() => expect(uploadItemLabelFileVersion).toHaveBeenCalledTimes(2));
    expect(uploadItemLabelFileVersion).toHaveBeenLastCalledWith(ID_CRIADO, denovo, "");
    expect(await screen.findByText("V1 enviada e vigente.")).toBeInTheDocument();
    expect(screen.queryByText(/não pôde ser enviado/)).toBeNull();

    fireEvent.click(within(rodapeDaPagina()).getByRole("button", { name: "Concluir" }));
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(createItem).toHaveBeenCalledTimes(1);
  });

  it("5. criação contextual com arquivo: cria, envia e devolve o Item à origem", async () => {
    const token = startContextualCreate({
      originRoute: "/producao/formulacoes",
      fieldKey: "componente-3",
      entityType: "item",
      draft: { basisQuantity: "1" },
    })!;
    renderPagina(`/cadastros/itens/novo?origem=${token}`);
    await prepararRotulo();
    const escolhido = arquivo("rotulo-frontal.png", "image/png");
    escolherArquivo(escolhido);

    criar();

    expect(await screen.findByText("tela de origem")).toBeInTheDocument();
    expect(uploadItemLabelFileVersion).toHaveBeenCalledWith(ID_CRIADO, escolhido);
    expect(readContextualCreate(token)?.result).toMatchObject({
      entityType: "item",
      entityId: ID_CRIADO,
      label: "Rótulo frontal Vitamina C",
    });
  });

  it("criação contextual com falha no envio: sem 'Voltar' nem Cancelar que perderiam o item; Concluir devolve o Item à origem", async () => {
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValueOnce(new Error("Falha de rede."));
    const token = startContextualCreate({
      originRoute: "/producao/formulacoes",
      fieldKey: "componente-3",
      entityType: "item",
      draft: { basisQuantity: "1" },
    })!;
    renderPagina(`/cadastros/itens/novo?origem=${token}`);
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));
    criar();
    await screen.findByText(/Item criado, mas o arquivo do rótulo não pôde ser enviado\./);

    expect(screen.queryByRole("button", { name: /← Voltar para/ })).toBeNull();
    expect(within(rodapeDaPagina()).queryByRole("button", { name: "Cancelar" })).toBeNull();
    fireEvent.click(within(rodapeDaPagina()).getByRole("button", { name: "Concluir" }));

    expect(await screen.findByText("tela de origem")).toBeInTheDocument();
    expect(readContextualCreate(token)?.result).toMatchObject({ entityType: "item", entityId: ID_CRIADO });
    expect(createItem).toHaveBeenCalledTimes(1);
  });

  it("no modal de criação a falha também não recria: Concluir devolve o Item criado a quem abriu", async () => {
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValueOnce(new Error("Falha de rede."));
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <ItemFormModal mode="create" item={null} units={UNIDADES} onClose={() => {}} onSaved={onSaved} />
      </MemoryRouter>,
    );
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));
    criar();
    await screen.findByText(/Item criado, mas o arquivo do rótulo não pôde ser enviado\./);

    expect(screen.queryByRole("button", { name: "Criar item" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(onSaved).toHaveBeenCalledWith(rotuloCriado());
    expect(createItem).toHaveBeenCalledTimes(1);
  });
});

describe("ITEM-FORM-BY-TYPE-01 — trocar tipo e subtipo na criação", () => {
  it("matéria-prima preenchida → embalagem: a classificação some da tela E do envio", async () => {
    renderPagina();
    await escolherTipo("RAW_MATERIAL");
    fireEvent.change(campo("item-source-name")!, { target: { value: "Cloridrato de tiamina" } });
    fireEvent.change(campo("item-declared-nutrient")!, { target: { value: "Vitamina B1" } });
    fireEvent.change(seletor("item-family"), { target: { value: "VITAMIN" } });
    fireEvent.change(campo("item-purity")!, { target: { value: "98,5" } });

    fireEvent.change(seletor("item-type"), { target: { value: "PACKAGING" } });
    fireEvent.change(seletor("item-unit"), { target: { value: "un" } });
    fireEvent.change(campo("item-name")!, { target: { value: "Pote 500 g" } });
    escolherSubtipo("POT");
    criar();

    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    const enviado = payloadCriado();
    expect(enviado).toMatchObject({ type: "PACKAGING", packagingSubtype: "POT" });
    for (const chave of ["sourceName", "declaredNutrient", "family", "defaultPurityPercent"]) {
      expect(enviado, chave).not.toHaveProperty(chave);
    }
  });

  it("voltar para matéria-prima não traz de volta o que foi digitado antes da troca", async () => {
    renderPagina();
    await escolherTipo("RAW_MATERIAL");
    fireEvent.change(campo("item-source-name")!, { target: { value: "Cloridrato de tiamina" } });
    fireEvent.change(campo("item-purity")!, { target: { value: "98,5" } });

    fireEvent.change(seletor("item-type"), { target: { value: "PACKAGING" } });
    fireEvent.change(seletor("item-type"), { target: { value: "RAW_MATERIAL" } });

    expect(campo("item-source-name")!.value).toBe("");
    expect(campo("item-purity")!.value).toBe("");
  });

  it("embalagem Rótulo marcada, com arquivo → matéria-prima: subtipo, marca e arquivo saem, e nada sobe", async () => {
    renderPagina();
    await prepararRotulo();
    fireEvent.click(campo("item-consumed-in-production")!);
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));

    fireEvent.change(seletor("item-type"), { target: { value: "RAW_MATERIAL" } });
    expect(secao("Arquivo do rótulo")).toBeNull();
    criar();

    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    const enviado = payloadCriado();
    expect(enviado).toMatchObject({ type: "RAW_MATERIAL" });
    expect(enviado).not.toHaveProperty("packagingSubtype");
    expect(enviado).not.toHaveProperty("consumedInProduction");
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it("de volta à embalagem, subtipo, marca e arquivo começam vazios", async () => {
    renderPagina();
    await prepararRotulo();
    fireEvent.click(campo("item-consumed-in-production")!);
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));

    fireEvent.change(seletor("item-type"), { target: { value: "RAW_MATERIAL" } });
    fireEvent.change(seletor("item-type"), { target: { value: "PACKAGING" } });

    expect(seletor("item-packaging-subtype").value).toBe("");
    expect(campo("item-consumed-in-production")!.checked).toBe(false);
    escolherSubtipo("LABEL");
    expect(campoDoArquivo()).not.toBeNull();
    expect(screen.queryByLabelText("Arquivo do rótulo escolhido")).toBeNull();
  });

  it("Rótulo com arquivo → Pote: o arquivo sai, a tela avisa, e o Pote é criado sem envio nenhum", async () => {
    renderPagina();
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));

    escolherSubtipo("POT");

    expect(secao("Arquivo do rótulo")).toBeNull();
    expect(
      screen.getByText("O arquivo do rótulo escolhido foi descartado: o subtipo deixou de ser Rótulo."),
    ).toBeInTheDocument();

    criar();
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(payloadCriado()).toMatchObject({ type: "PACKAGING", packagingSubtype: "POT" });
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it("Rótulo com arquivo → Pote → Rótulo: o arquivo não volta escondido", async () => {
    renderPagina();
    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));

    escolherSubtipo("POT");
    escolherSubtipo("LABEL");

    expect(campoDoArquivo()).not.toBeNull();
    expect(screen.queryByLabelText("Arquivo do rótulo escolhido")).toBeNull();
    expect(screen.queryByText(/foi descartado/)).toBeNull();

    criar();
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — permissões do arquivo na criação", () => {
  it("PRODUCTION cria o Rótulo, mas não envia arquivo: a tela diz a quem pedir, sem campo", async () => {
    sessao.role = "PRODUCTION";
    renderPagina();
    await prepararRotulo();

    expect(secao("Arquivo do rótulo")).toBeInTheDocument();
    expect(campoDoArquivo()).toBeNull();
    expect(
      screen.getByText(
        "Para anexar o arquivo, solicite a Compras, Qualidade, Comercial ou Administrador depois de criar o item.",
      ),
    ).toBeInTheDocument();

    criar();
    expect(await screen.findByText("lista de itens")).toBeInTheDocument();
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it.each(["PURCHASING", "QUALITY", "ADMIN"])("%s cria o Rótulo e escolhe o arquivo", async (role) => {
    sessao.role = role;
    renderPagina();
    await prepararRotulo();

    expect(campoDoArquivo(), role).not.toBeNull();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — edição e consulta", () => {
  /** Rótulo antigo com classificação de matéria-prima gravada por engano. */
  const LEGADO = rotuloCriado({
    id: "item-legado",
    code: "ME-000321",
    name: "Etiqueta frontal 60x40",
    sourceName: "Papel couché",
    declaredNutrient: "Nenhum",
    family: "PACKAGING",
    defaultPurityPercent: "100",
  });

  function abrirModal(item: ItemDTO, readOnly = false) {
    render(
      <MemoryRouter>
        <ItemFormModal
          mode="edit"
          item={item}
          units={UNIDADES}
          onClose={() => {}}
          onSaved={() => {}}
          readOnly={readOnly}
        />
      </MemoryRouter>,
    );
  }

  it("Rótulo gravado: dados da embalagem e a seção do arquivo com histórico; nada de campo de criação", async () => {
    abrirModal(LEGADO);

    expect(secao("Dados da embalagem")).toBeInTheDocument();
    expect(secao("Classificação industrial")).toBeNull();
    expect(campo("item-source-name")).toBeNull();
    expect(campo("item-purity")).toBeNull();
    expect(campoDoArquivo()).toBeNull();

    expect(await screen.findByRole("table", { name: "Histórico do arquivo do rótulo" })).toBeInTheDocument();
    await waitFor(() => expect(getItemLabelFile).toHaveBeenCalledWith("item-legado"));
    expect(screen.getByRole("button", { name: "Adicionar nova versão" })).toBeInTheDocument();
  });

  it("salvar a embalagem não apaga a classificação antiga que a tela não mostra", async () => {
    abrirModal(LEGADO);

    fireEvent.change(campo("item-name")!, { target: { value: "Etiqueta frontal 60x40 mm" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
    const [id, enviado] = vi.mocked(updateItem).mock.calls[0]!;
    expect(id).toBe("item-legado");
    expect(enviado).toMatchObject({
      name: "Etiqueta frontal 60x40 mm",
      packagingSubtype: "LABEL",
      consumedInProduction: false,
    });
    for (const chave of ["sourceName", "declaredNutrient", "family", "defaultPurityPercent"]) {
      expect(enviado, chave).not.toHaveProperty(chave);
    }
  });

  it("matéria-prima na edição continua mandando a classificação — inclusive vazia, para limpar", async () => {
    abrirModal(
      rotuloCriado({
        id: "item-mp",
        code: "MP-000010",
        type: "RAW_MATERIAL",
        name: "Cloridrato de tiamina",
        packagingSubtype: null,
        sourceName: "Cloridrato de tiamina",
      }),
    );

    expect(secao("Classificação industrial")).toBeInTheDocument();
    expect(secao("Dados da embalagem")).toBeNull();
    fireEvent.change(campo("item-source-name")!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateItem).mock.calls[0]![1]).toMatchObject({
      sourceName: "",
      declaredNutrient: "",
      family: "",
      defaultPurityPercent: "",
      packagingSubtype: "",
    });
  });

  it("consulta do Rótulo: dados da embalagem, sem classificação industrial, com o histórico do arquivo", async () => {
    sessao.role = "VIEWER";
    abrirModal(LEGADO, true);

    const dados = secao("Dados da embalagem")!.closest("section")!;
    expect(dados).toHaveTextContent("Subtipo de embalagem");
    expect(dados).toHaveTextContent("Rótulo");
    expect(dados).toHaveTextContent("Consumido na produção");
    expect(secao("Classificação industrial")).toBeNull();
    expect(screen.queryByText("Papel couché")).toBeNull();

    expect(await screen.findByRole("table", { name: "Histórico do arquivo do rótulo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar nova versão" })).toBeNull();
  });

  it("consulta da matéria-prima continua com a classificação industrial", () => {
    sessao.role = "VIEWER";
    abrirModal(
      rotuloCriado({
        id: "item-mp",
        code: "MP-000010",
        type: "RAW_MATERIAL",
        name: "Cloridrato de tiamina",
        packagingSubtype: null,
        declaredNutrient: "Vitamina B1",
      }),
      true,
    );

    expect(secao("Classificação industrial")).toBeInTheDocument();
    expect(screen.getByText("Vitamina B1")).toBeInTheDocument();
    expect(secao("Dados da embalagem")).toBeNull();
    expect(secao("Arquivo do rótulo")).toBeNull();
  });
});

describe("ITEM-FORM-BY-TYPE-01 — guarda de alterações depois de criar", () => {
  function Raiz() {
    return (
      <UnsavedChangesProvider>
        <nav>
          <Link to="/painel">Painel</Link>
        </nav>
        <Outlet />
      </UnsavedChangesProvider>
    );
  }

  it("Item criado sem o arquivo: sair não pergunta — o cadastro já é registro", async () => {
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValueOnce(new Error("Falha de rede."));
    const user = userEvent.setup();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Raiz />}>
          <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
          <Route path="/painel" element={<h1>Painel</h1>} />
        </Route>,
      ),
      { initialEntries: ["/cadastros/itens/novo"] },
    );
    render(<RouterProvider router={router} />);

    await prepararRotulo();
    escolherArquivo(arquivo("rotulo-frontal.pdf", "application/pdf"));
    criar();
    await screen.findByText(/Item criado, mas o arquivo do rótulo não pôde ser enviado\./);

    await user.click(screen.getByRole("link", { name: "Painel" }));

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();
  });
});
