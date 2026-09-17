import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ItemLabelFileResponse, ItemLabelFileVersionDTO } from "@veridi/shared";
import { ITEM_LABEL_FILE_MAX_SIZE_BYTES } from "@veridi/shared";

/**
 * Arquivo do rótulo — LABEL-ATTACHMENTS-01, a seção do cadastro do Item Rótulo.
 *
 * A tela mostra a versão vigente e o histórico sem confundir as três
 * situações; oferece enviar, restaurar e anular só a quem a API aceitaria;
 * e nunca fala em "substituir": cada envio é uma versão nova.
 */

vi.mock("../lib/item-label-files-api", () => ({
  getItemLabelFile: vi.fn(),
  uploadItemLabelFileVersion: vi.fn(),
  voidItemLabelFileVersion: vi.fn(),
  restoreItemLabelFileVersion: vi.fn(),
  itemLabelFileDownloadUrl: (itemId: string, versionId: string) =>
    `http://api.teste/items/${itemId}/label-file/versions/${versionId}/download`,
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import {
  getItemLabelFile,
  restoreItemLabelFileVersion,
  uploadItemLabelFileVersion,
  voidItemLabelFileVersion,
} from "../lib/item-label-files-api";
import { ItemLabelFileSection } from "./ItemLabelFileSection";

function versao(overrides: Partial<ItemLabelFileVersionDTO> = {}): ItemLabelFileVersionDTO {
  return {
    id: "v-1",
    itemId: "item-1",
    versionNumber: 1,
    status: "CURRENT",
    originalFileName: "Rótulo Vitamina C.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_572_864,
    note: null,
    restoredFromVersionNumber: null,
    createdAt: "2026-09-10T13:30:00.000Z",
    createdByName: "Ana Qualidade",
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    ...overrides,
  };
}

function estado(versions: ItemLabelFileVersionDTO[], overrides: Partial<ItemLabelFileResponse> = {}): ItemLabelFileResponse {
  const itemActive = overrides.itemActive ?? true;
  const labelItem = overrides.labelItem ?? true;
  return {
    itemId: "item-1",
    labelItem,
    itemActive,
    acceptsNewVersion: labelItem && itemActive,
    current: versions.find((v) => v.status === "CURRENT") ?? null,
    versions,
    ...overrides,
  };
}

const V1 = versao({ id: "v-1", versionNumber: 1, status: "HISTORICAL", originalFileName: "arte-v1.pdf" });
const V2 = versao({
  id: "v-2",
  versionNumber: 2,
  status: "VOIDED",
  originalFileName: "arte-v2.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  voidedAt: "2026-09-12T15:00:00.000Z",
  voidedByName: "Bruno Qualidade",
  voidReason: "Tabela nutricional errada",
});
const V3 = versao({
  id: "v-3",
  versionNumber: 3,
  status: "CURRENT",
  originalFileName: "arte-v1.pdf",
  note: "Volta a arte aprovada",
  restoredFromVersionNumber: 1,
  createdByName: "Carla Compras",
});

function arquivo(nome: string, tipo: string, tamanho = 1024): File {
  const file = new File(["%PDF-1.4"], nome, { type: tipo });
  Object.defineProperty(file, "size", { value: tamanho });
  return file;
}

beforeEach(() => {
  sessao.role = "ADMIN";
  vi.mocked(getItemLabelFile).mockReset();
  vi.mocked(uploadItemLabelFileVersion).mockReset();
  vi.mocked(voidItemLabelFileVersion).mockReset();
  vi.mocked(restoreItemLabelFileVersion).mockReset();
});

describe("ItemLabelFileSection — o que a tela mostra", () => {
  it("sem nenhuma versão: 'Sem arquivo vigente' e o convite a adicionar a primeira", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([]));
    render(<ItemLabelFileSection itemId="item-1" />);

    expect(await screen.findByText("Sem arquivo vigente")).toBeInTheDocument();
    expect(screen.getByText("Nenhum arquivo enviado para este rótulo.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma versão enviada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar nova versão" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visualizar/baixar" })).not.toBeInTheDocument();
    // Nunca linguagem de sobrescrita.
    expect(screen.queryByText(/substituir/i)).not.toBeInTheDocument();
  });

  it("versão atual: número, arquivo, tipo, tamanho, data, autor, nota e 'Visualizar/baixar' pela API", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([V3, V2, V1]));
    render(<ItemLabelFileSection itemId="item-1" />);

    const bloco = await screen.findByLabelText("Versão atual do arquivo do rótulo");
    expect(within(bloco).getByText("V3")).toBeInTheDocument();
    expect(within(bloco).getByText(/restaurada da V1/)).toBeInTheDocument();
    expect(within(bloco).getByText("arte-v1.pdf")).toBeInTheDocument();
    expect(within(bloco).getByText("PDF")).toBeInTheDocument();
    expect(within(bloco).getByText("1,5 MB")).toBeInTheDocument();
    expect(within(bloco).getByText("Carla Compras")).toBeInTheDocument();
    expect(within(bloco).getByText("Volta a arte aprovada")).toBeInTheDocument();
    expect(within(bloco).getByText(/10\/09\/2026/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Visualizar/baixar" });
    expect(link).toHaveAttribute("href", "http://api.teste/items/item-1/label-file/versions/v-3/download");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("histórico: Vigente, Anulada com autor e motivo, Histórica — da mais nova para a mais antiga", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([V3, V2, V1]));
    render(<ItemLabelFileSection itemId="item-1" />);

    const tabela = await screen.findByRole("table", { name: "Histórico do arquivo do rótulo" });
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas.map((linha) => within(linha).getAllByRole("cell")[0]?.textContent)).toEqual([
      "V3restaurada da V1",
      "V2",
      "V1",
    ]);
    expect(within(linhas[0]!).getByText("Vigente")).toBeInTheDocument();
    expect(within(linhas[0]!).getByText("por Carla Compras")).toBeInTheDocument();
    expect(within(linhas[0]!).getByText("Volta a arte aprovada")).toBeInTheDocument();
    expect(within(linhas[1]!).getByText("Anulada")).toBeInTheDocument();
    expect(within(linhas[1]!).getByText(/por Bruno Qualidade em .*: Tabela nutricional errada/)).toBeInTheDocument();
    expect(within(linhas[1]!).getByText("PNG · 2 KB")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("Histórica")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("PDF · 1,5 MB")).toBeInTheDocument();
    // Todas continuam baixáveis, inclusive a anulada.
    expect(within(linhas[1]!).getByRole("link", { name: "Visualizar ou baixar a V2" })).toHaveAttribute(
      "href",
      "http://api.teste/items/item-1/label-file/versions/v-2/download",
    );
  });

  it("todas anuladas: sem arquivo vigente, com o histórico inteiro visível", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(
      estado([versao({ id: "v-1", status: "VOIDED", voidedByName: "Ana", voidReason: "Errada", voidedAt: "2026-09-12T10:00:00.000Z" })]),
    );
    render(<ItemLabelFileSection itemId="item-1" />);

    expect(await screen.findByText("Sem arquivo vigente")).toBeInTheDocument();
    expect(screen.getByText("Todas as versões foram anuladas. O histórico continua abaixo.")).toBeInTheDocument();
    expect(screen.getByText("Anulada")).toBeInTheDocument();
  });

  it("o servidor diz que o Item não é Rótulo: a seção não aparece", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([], { labelItem: false }));
    const { container } = render(<ItemLabelFileSection itemId="item-1" />);
    await waitFor(() => expect(getItemLabelFile).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("falha ao carregar aparece como alerta", async () => {
    vi.mocked(getItemLabelFile).mockRejectedValue(new Error("Sem conexão com o servidor."));
    render(<ItemLabelFileSection itemId="item-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
  });
});

describe("ItemLabelFileSection — adicionar nova versão", () => {
  it("escolhe o arquivo e a observação, envia, e a nova versão aparece vigente", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([versao({ id: "v-1" })]));
    const depois = estado([
      versao({ id: "v-2", versionNumber: 2, originalFileName: "nova-arte.png", mimeType: "image/png" }),
      versao({ id: "v-1", status: "HISTORICAL" }),
    ]);
    vi.mocked(uploadItemLabelFileVersion).mockResolvedValue(depois);
    render(<ItemLabelFileSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Adicionar nova versão" }));
    const formulario = screen.getByRole("form", { name: "Nova versão do arquivo do rótulo" });
    expect(within(formulario).getByText(/será a V2/)).toBeInTheDocument();

    const escolhido = arquivo("nova-arte.png", "image/png");
    fireEvent.change(screen.getByLabelText(/Arquivo \(será a V2\)/), { target: { files: [escolhido] } });
    fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "Arte com o novo lote" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar nova versão" }));

    await waitFor(() => expect(uploadItemLabelFileVersion).toHaveBeenCalledWith("item-1", escolhido, "Arte com o novo lote"));
    expect(await screen.findByRole("status")).toHaveTextContent("V2 enviada e vigente.");
    expect(screen.queryByRole("form", { name: "Nova versão do arquivo do rótulo" })).not.toBeInTheDocument();
    const bloco = screen.getByLabelText("Versão atual do arquivo do rótulo");
    expect(within(bloco).getByText("nova-arte.png")).toBeInTheDocument();
  });

  it("recusa da API (assinatura, tamanho, tipo) aparece no formulário, que continua aberto", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([]));
    vi.mocked(uploadItemLabelFileVersion).mockRejectedValue(
      new Error("O conteúdo do arquivo não é um PDF válido. Exporte o arquivo de novo e envie outra vez."),
    );
    render(<ItemLabelFileSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Adicionar nova versão" }));
    fireEvent.change(screen.getByLabelText(/Arquivo \(será a V1\)/), { target: { files: [arquivo("arte.pdf", "application/pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar nova versão" }));

    expect(await screen.findByText(/não é um PDF válido/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Nova versão do arquivo do rótulo" })).toBeInTheDocument();
  });

  it.each([
    ["sem arquivo", null, "Escolha o arquivo do rótulo."],
    ["tipo fora da lista", arquivo("arte.gif", "image/gif"), "Tipo de arquivo não aceito. Envie PDF, PNG ou JPEG."],
    ["acima de 25 MB", arquivo("grande.pdf", "application/pdf", ITEM_LABEL_FILE_MAX_SIZE_BYTES + 1), "Arquivo acima do limite de 25 MB."],
    ["vazio", arquivo("vazio.pdf", "application/pdf", 0), "O arquivo escolhido está vazio."],
  ])("%s: a tela recusa antes de mandar", async (_caso, escolhido, mensagem) => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([]));
    render(<ItemLabelFileSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Adicionar nova versão" }));
    if (escolhido) {
      fireEvent.change(screen.getByLabelText(/Arquivo \(será a V1\)/), { target: { files: [escolhido] } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Enviar nova versão" }));

    expect(await screen.findByText(mensagem)).toBeInTheDocument();
    expect(uploadItemLabelFileVersion).not.toHaveBeenCalled();
  });

  it("Item inativo: sem adicionar nem restaurar, com o aviso; o histórico e o download continuam", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([versao({ id: "v-2", versionNumber: 2 }), V1], { itemActive: false }));
    render(<ItemLabelFileSection itemId="item-1" />);

    expect(await screen.findByText(/Item inativo: o histórico continua disponível/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar nova versão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restaurar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visualizar/baixar" })).toBeInTheDocument();
    // Anular é decisão sobre arquivo que já existe: continua para quem anula.
    expect(screen.getByRole("button", { name: "Anular a V2" })).toBeInTheDocument();
  });
});

describe("ItemLabelFileSection — anular e restaurar", () => {
  it("anular pede motivo, confirma e mostra a versão anulada no histórico", async () => {
    const atual = versao({ id: "v-2", versionNumber: 2 });
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([atual, V1]));
    vi.mocked(voidItemLabelFileVersion).mockResolvedValue(
      estado([
        { ...atual, status: "VOIDED", voidedByName: "Sessão de teste", voidReason: "Cor errada", voidedAt: "2026-09-16T12:00:00.000Z" },
        { ...V1, status: "CURRENT" },
      ]),
    );
    render(<ItemLabelFileSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Anular a V2" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(/O arquivo não é apagado/)).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole("button", { name: "Anular versão" });
    expect(confirmar).toBeDisabled();

    fireEvent.change(within(dialogo).getByLabelText("Motivo da anulação"), { target: { value: "   " } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText("Motivo da anulação"), { target: { value: "  Cor errada " } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(voidItemLabelFileVersion).toHaveBeenCalledWith("item-1", "v-2", "Cor errada"));
    expect(await screen.findByRole("status")).toHaveTextContent("V2 anulada. O arquivo continua no histórico.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(/por Sessão de teste em .*: Cor errada/)).toBeInTheDocument();
  });

  it("restaurar confirma a versão nova e diz que a anulada continua anulada", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([versao({ id: "v-3", versionNumber: 3 }), V2, V1]));
    vi.mocked(restoreItemLabelFileVersion).mockResolvedValue(
      estado([
        versao({ id: "v-4", versionNumber: 4, restoredFromVersionNumber: 2, originalFileName: "arte-v2.png", mimeType: "image/png" }),
        versao({ id: "v-3", versionNumber: 3, status: "HISTORICAL" }),
        V2,
        V1,
      ]),
    );
    render(<ItemLabelFileSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a V2 como nova versão" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByRole("heading")).toHaveTextContent("Restaurar a V2 como V4?");
    expect(within(dialogo).getByText(/A V2 continua anulada \(motivo: Tabela nutricional errada\)/)).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText("Observação da nova versão"), { target: { value: "Cliente pediu de volta" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Restaurar como V4" }));

    await waitFor(() =>
      expect(restoreItemLabelFileVersion).toHaveBeenCalledWith("item-1", "v-2", "Cliente pediu de volta"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("V4 criada a partir da V2.");
    const bloco = screen.getByLabelText("Versão atual do arquivo do rótulo");
    expect(within(bloco).getByText("V4")).toBeInTheDocument();
  });

  it("a vigente não oferece restaurar; recusa da API na ação aparece como alerta", async () => {
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([versao({ id: "v-2", versionNumber: 2 }), V1]));
    vi.mocked(restoreItemLabelFileVersion).mockRejectedValue(
      new Error("O arquivo da V1 não foi encontrado no armazenamento. Avise o administrador do sistema."),
    );
    render(<ItemLabelFileSection itemId="item-1" />);

    expect(await screen.findByRole("button", { name: "Restaurar a V1 como nova versão" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurar a V2 como nova versão" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restaurar a V1 como nova versão" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Restaurar como V3" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("não foi encontrado no armazenamento");
  });
});

describe("ItemLabelFileSection — por perfil", () => {
  it.each([
    ["ADMIN", { enviar: true, restaurar: true, anular: true }],
    ["QUALITY", { enviar: true, restaurar: true, anular: true }],
    ["PURCHASING", { enviar: true, restaurar: true, anular: false }],
    ["COMMERCIAL", { enviar: true, restaurar: true, anular: false }],
    ["PRODUCTION", { enviar: false, restaurar: false, anular: false }],
    ["VIEWER", { enviar: false, restaurar: false, anular: false }],
  ])("%s: oferece só o que a API aceita, e baixa sempre", async (role, pode) => {
    sessao.role = role;
    vi.mocked(getItemLabelFile).mockResolvedValue(estado([versao({ id: "v-2", versionNumber: 2 }), V1]));
    render(<ItemLabelFileSection itemId="item-1" />);

    await screen.findByLabelText("Versão atual do arquivo do rótulo");
    expect(Boolean(screen.queryByRole("button", { name: "Adicionar nova versão" }))).toBe(pode.enviar);
    expect(Boolean(screen.queryByRole("button", { name: "Restaurar a V1 como nova versão" }))).toBe(pode.restaurar);
    expect(Boolean(screen.queryByRole("button", { name: "Anular a V2" }))).toBe(pode.anular);
    expect(screen.getByRole("link", { name: "Visualizar/baixar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visualizar ou baixar a V1" })).toBeInTheDocument();
    expect(Boolean(screen.queryByText(/Para enviar nova versão, solicite a Compras, Qualidade, Comercial ou Administrador/))).toBe(
      !pode.enviar,
    );
  });
});
