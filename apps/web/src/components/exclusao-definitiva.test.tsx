import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MasterDataDeletionCheckDTO } from "@veridi/shared";

/**
 * "Excluir definitivamente" — MASTER-DATA-HARD-DELETE-01, lado da tela.
 *
 * O diálogo pergunta à prévia ANTES de oferecer algo destrutivo: liberado, diz
 * o efeito e exige o motivo; bloqueado, mostra cada referência e oferece a
 * saída normal (Inativar ou Arquivar) — nunca o botão de excluir. A tela não
 * conhece tabela nem chave estrangeira: só o que a API respondeu.
 */

vi.mock("../lib/master-data-deletion-api", async (original) => ({
  ...(await original<object>()),
  consultarExclusaoDefinitiva: vi.fn(),
  excluirDefinitivamente: vi.fn(),
}));

import {
  CadastroEmUsoError,
  consultarExclusaoDefinitiva,
  excluirDefinitivamente,
} from "../lib/master-data-deletion-api";
import { ExclusaoDefinitivaDialog, FRASE_DA_EXCLUSAO, podeExcluirDefinitivamente } from "./ExclusaoDefinitivaDialog";

function previa(extra: Partial<MasterDataDeletionCheckDTO> = {}): MasterDataDeletionCheckDTO {
  return {
    entityType: "FORMULATION_TEMPLATE",
    entityId: "ft-1",
    entityCode: "FT-000009",
    entityName: "Modelo errado",
    canDelete: true,
    references: [],
    removedTogether: [{ source: "Versão V1 em rascunho, sem conteúdo", count: 1 }],
    alternative: "ARCHIVE",
    alternativeAvailable: true,
    ...extra,
  };
}

const BLOQUEADO = previa({
  canDelete: false,
  removedTogether: [],
  references: [
    {
      source: "Formulações criadas a partir do modelo",
      count: 3,
      reason: "O modelo já foi aplicado — a formulação guarda a origem.",
    },
    { source: "Versão V1", count: 1, reason: "A V1 tem 2 componente(s) lançado(s)." },
  ],
});

const onAlternativa = vi.fn();
const onCancelar = vi.fn();
const onExcluido = vi.fn();

function abrir(alternativa: (() => void) | undefined = onAlternativa) {
  render(
    <ExclusaoDefinitivaDialog
      tipo="FORMULATION_TEMPLATE"
      id="ft-1"
      rotulo="modelo de formulação"
      onAlternativa={alternativa}
      onCancelar={onCancelar}
      onExcluido={onExcluido}
    />,
  );
  return screen.getByRole("alertdialog");
}

beforeEach(() => {
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
  onAlternativa.mockReset();
  onCancelar.mockReset();
  onExcluido.mockReset();
});

describe("liberado pela prévia", () => {
  it("diz o efeito, o que sai junto, e só confirma com o motivo", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(previa());
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "FORMULATION_TEMPLATE",
      entityId: "ft-1",
      entityCode: "FT-000009",
      entityName: "Modelo errado",
      deletedAt: "2026-09-18T12:00:00.000Z",
    });
    const dialogo = abrir();

    expect(await within(dialogo).findByText(FRASE_DA_EXCLUSAO)).toBeInTheDocument();
    expect(consultarExclusaoDefinitiva).toHaveBeenCalledWith("FORMULATION_TEMPLATE", "ft-1");
    expect(dialogo).toHaveTextContent("FT-000009 — Modelo errado");
    expect(dialogo).toHaveTextContent("Versão V1 em rascunho, sem conteúdo");

    const confirmar = within(dialogo).getByRole("button", { name: "Excluir definitivamente" });
    expect(confirmar).toBeDisabled();
    const motivo = within(dialogo).getByLabelText("Motivo da exclusão *");
    fireEvent.change(motivo, { target: { value: "   " } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(motivo, { target: { value: "  Criado em duplicidade  " } });
    expect(confirmar).toBeEnabled();

    fireEvent.click(confirmar);
    await waitFor(() => expect(onExcluido).toHaveBeenCalledTimes(1));
    expect(excluirDefinitivamente).toHaveBeenCalledWith("FORMULATION_TEMPLATE", "ft-1", "Criado em duplicidade");
    expect(onExcluido.mock.calls[0]![0]).toMatchObject({ historyId: "h-1" });
  });

  it("o cadastro ganhou uso entre a prévia e a confirmação: a recusa vira a explicação", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(previa());
    vi.mocked(excluirDefinitivamente).mockRejectedValue(
      new CadastroEmUsoError("Modelo de formulação em uso.", [
        { source: "Formulações criadas a partir do modelo", count: 1, reason: "O modelo já foi aplicado." },
      ]),
    );
    const dialogo = abrir();
    fireEvent.change(await within(dialogo).findByLabelText("Motivo da exclusão *"), {
      target: { value: "Engano" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    expect(await within(dialogo).findByText("Este cadastro não pode ser excluído")).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("Formulações criadas a partir do modelo");
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    expect(onExcluido).not.toHaveBeenCalled();
  });
});

describe("bloqueado pela prévia", () => {
  it("mostra cada referência que impede e oferece Arquivar — nunca o botão de excluir", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(BLOQUEADO);
    const dialogo = abrir();

    const lista = await within(dialogo).findByRole("list", { name: "O que impede a exclusão" });
    const itens = within(lista).getAllByRole("listitem").map((item) => item.textContent);
    expect(itens).toEqual([
      "Formulações criadas a partir do modelo (3): O modelo já foi aplicado — a formulação guarda a origem.",
      "Versão V1: A V1 tem 2 componente(s) lançado(s).",
    ]);
    expect(dialogo).toHaveTextContent("A saída é Arquivar");
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    expect(within(dialogo).queryByLabelText("Motivo da exclusão *")).toBeNull();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Arquivar" }));
    expect(onAlternativa).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Fechar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });

  it("já arquivado: diz isso, sem botão de saída", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({ ...BLOQUEADO, alternativeAvailable: false });
    const dialogo = abrir();
    expect(await within(dialogo).findByText(/Ele já está arquivado/)).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Arquivar" })).toBeNull();
  });

  it("Cliente bloqueado: a saída é Inativar", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      ...BLOQUEADO,
      entityType: "CUSTOMER",
      alternative: "INACTIVATE",
    });
    const dialogo = abrir();
    expect(await within(dialogo).findByRole("button", { name: "Inativar" })).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("A saída é Inativar");
  });

  it("a prévia falhou: mostra a falha e não oferece nada destrutivo", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockRejectedValue(new Error("Sem permissão para esta ação."));
    const dialogo = abrir();
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Sem permissão para esta ação.");
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });
});

describe("quem vê a ação", () => {
  it("só o Administrador", () => {
    expect(podeExcluirDefinitivamente("ADMIN")).toBe(true);
    for (const role of ["PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER", null, undefined] as const) {
      expect(podeExcluirDefinitivamente(role), String(role)).toBe(false);
    }
  });
});

/**
 * MASTER-DATA-HARD-DELETE-02: a tela que conhece o cadastro explica o que sai
 * junto — o Produto diz que o Item de produto acabado dele sai também.
 */
describe("nota do que sai junto", () => {
  const NOTA = "O item de produto acabado sai junto, para não ficar órfão.";
  const PRODUTO = previa({
    entityType: "PRODUCT",
    entityCode: "PROD-000009",
    entityName: "PRODUTO ERRADO",
    alternative: "INACTIVATE",
    removedTogether: [{ source: "Item de produto acabado PA-000009 — PRODUTO ERRADO", count: 1 }],
  });

  function abrirProduto() {
    render(
      <ExclusaoDefinitivaDialog
        tipo="PRODUCT"
        id="prod-1"
        rotulo="produto"
        notaDoQueSaiJunto={NOTA}
        onAlternativa={onAlternativa}
        onCancelar={onCancelar}
        onExcluido={onExcluido}
      />,
    );
    return screen.getByRole("alertdialog");
  }

  it("liberado com o PA em 'sai junto': lista o PA pelo código e mostra a nota", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(PRODUTO);
    const dialogo = abrirProduto();
    expect(await within(dialogo).findByText("Item de produto acabado PA-000009 — PRODUTO ERRADO")).toBeInTheDocument();
    expect(within(dialogo).getByText(NOTA)).toBeInTheDocument();
  });

  it("nada em 'sai junto' (produto sem PA): sem a nota", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({ ...PRODUTO, removedTogether: [] });
    const dialogo = abrirProduto();
    expect(await within(dialogo).findByText(FRASE_DA_EXCLUSAO)).toBeInTheDocument();
    expect(within(dialogo).queryByText(NOTA)).toBeNull();
  });

  it("bloqueado pelo uso do PA: o motivo aparece com o código dele, e nem a nota nem o excluir", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      ...PRODUTO,
      canDelete: false,
      removedTogether: [],
      references: [
        { source: "Item de produto acabado PA-000009 — Lotes", count: 1, reason: "Há lote deste item — rastreabilidade." },
      ],
    });
    const dialogo = abrirProduto();
    expect(await within(dialogo).findByText("Item de produto acabado PA-000009 — Lotes")).toBeInTheDocument();
    expect(within(dialogo).queryByText(NOTA)).toBeNull();
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    expect(within(dialogo).getByRole("button", { name: "Inativar" })).toBeInTheDocument();
  });
});
