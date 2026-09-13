import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductProductionProfileDTO } from "@veridi/shared";

/**
 * ROTEIRO PADRÃO DE PRODUÇÃO no cadastro do Produto — PRODUCTION-ROUTE-ASSIGNMENT-01.
 *
 * Mostra o padrão (ou que não há), explica que ordens existentes não mudam,
 * deixa Produção e Administração definir, trocar e remover pela MESMA rota do
 * Roteiro, e responde só depois do servidor. Os outros perfis leem.
 */

const sessao = vi.hoisted(() => ({ atual: null as null | { user: { role: string } } }));

vi.mock("../../app/AuthProvider", () => ({
  useOptionalAuth: () => sessao.atual,
}));
vi.mock("../../lib/production-profiles-api", () => ({
  getProductProductionProfile: vi.fn(),
  listProductionProfiles: vi.fn(),
  setProductProductionProfile: vi.fn(),
}));

import {
  getProductProductionProfile,
  listProductionProfiles,
  setProductProductionProfile,
} from "../../lib/production-profiles-api";
import { ProductDefaultRouteSection } from "./ProductDefaultRouteSection";

const SEM_PADRAO: ProductProductionProfileDTO = {
  productId: "prod-1",
  productCode: "PROD-000001",
  productName: "Whey",
  productUomCode: "kg",
  version: null,
};

const COM_PADRAO: ProductProductionProfileDTO = {
  ...SEM_PADRAO,
  version: {
    id: "ver-4",
    productionProfileId: "ppr-4",
    profileCode: "PPR-000004",
    profileName: "Pó — misturador grande",
    versionNumber: 4,
    status: "ACTIVE",
    referenceQuantity: "100",
    referenceUomCode: "kg",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessao.atual = { user: { role: "PRODUCTION" } };
  vi.mocked(listProductionProfiles).mockResolvedValue({
    profiles: [
      {
        id: "ppr-4",
        code: "PPR-000004",
        name: "Pó — misturador grande",
        description: null,
        activeVersionId: "ver-4",
        activeVersionNumber: 4,
        referenceQuantity: "100",
        referenceUomCode: "kg",
        stepNames: ["Mistura"],
        hasDraft: false,
        defaultProductCount: 0,
        updatedAt: "2026-09-10T12:00:00.000Z",
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  });
});

async function escolherRoteiro() {
  const campo = await screen.findByRole("combobox");
  fireEvent.focus(campo);
  fireEvent.mouseDown(await screen.findByRole("option", { name: /PPR-000004 · V4/ }));
}

describe("Produto — roteiro padrão de produção", () => {
  it("sem padrão: diz isso, explica que ordens existentes não mudam, e define pela busca", async () => {
    vi.mocked(getProductProductionProfile).mockResolvedValue(SEM_PADRAO);
    let concluir!: (valor: ProductProductionProfileDTO) => void;
    vi.mocked(setProductProductionProfile).mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );

    render(<ProductDefaultRouteSection productId="prod-1" />);

    expect(await screen.findByText("Nenhum roteiro padrão definido.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "O roteiro padrão é aplicado automaticamente às novas ordens de produção. Ordens existentes não são alteradas.",
      ),
    ).toBeInTheDocument();
    // A busca pede só roteiros escolhíveis, ao servidor.
    await waitFor(() => expect(listProductionProfiles).toHaveBeenCalledWith({ activeOnly: true, pageSize: 20 }));

    await escolherRoteiro();
    fireEvent.click(screen.getByRole("button", { name: "Definir roteiro padrão" }));

    // A escolha é o roteiro; o que se grava é a versão ativa dele.
    expect(setProductProductionProfile).toHaveBeenCalledWith("prod-1", "ver-4");
    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    concluir(COM_PADRAO);
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro padrão atualizado.");
    const resumo = screen.getByRole("group", { name: "Roteiro padrão do produto" });
    expect(resumo.textContent).toContain("Pó — misturador grande");
    expect(resumo.textContent).toContain("V4");
    expect(resumo.textContent).toContain("100");
    expect(resumo.textContent).toContain("kg");
  });

  it("com padrão: remover responde \"Roteiro padrão removido.\"", async () => {
    vi.mocked(getProductProductionProfile).mockResolvedValue(COM_PADRAO);
    vi.mocked(setProductProductionProfile).mockResolvedValue(SEM_PADRAO);

    render(<ProductDefaultRouteSection productId="prod-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remover roteiro padrão" }));

    await waitFor(() => expect(setProductProductionProfile).toHaveBeenCalledWith("prod-1", null));
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro padrão removido.");
    expect(screen.getByText("Nenhum roteiro padrão definido.")).toBeInTheDocument();
  });

  it("recusa do servidor vira alerta, sem anunciar sucesso", async () => {
    vi.mocked(getProductProductionProfile).mockResolvedValue(SEM_PADRAO);
    vi.mocked(setProductProductionProfile).mockRejectedValue(
      new Error("A quantidade de referência do roteiro está em un e o produto é controlado em kg."),
    );

    render(<ProductDefaultRouteSection productId="prod-1" />);
    await escolherRoteiro();
    fireEvent.click(screen.getByRole("button", { name: "Definir roteiro padrão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("controlado em kg");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Comercial e Leitura veem o roteiro padrão, sem busca e sem botões", async () => {
    for (const role of ["COMMERCIAL", "VIEWER"]) {
      sessao.atual = { user: { role } };
      vi.mocked(getProductProductionProfile).mockResolvedValue(COM_PADRAO);
      const { unmount } = render(<ProductDefaultRouteSection productId="prod-1" />);

      expect(await screen.findByRole("group", { name: "Roteiro padrão do produto" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: /roteiro padrão/ })).toBeNull();
      unmount();
    }
  });
});
