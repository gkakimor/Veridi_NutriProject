import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";

/**
 * Quem faz o quê no cadastro do Produto, na tela — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Comercial e Administrador: "+ Novo produto", "Editar", "Inativar/Reativar".
 * Produção, Qualidade, Compras e Consulta abrem o MESMO modal em consulta. As
 * seções com permissão própria continuam no modal para todos — Roteiro padrão
 * (que decide por si), resumo de custos e Documentos, onde anexar é de
 * Comercial, Qualidade e Administrador e arquivar é de Qualidade e
 * Administrador. CMV e Custos industriais seguem no menu da linha.
 */

vi.mock("../../lib/products-api", async (original) => ({
  ...(await original<object>()),
  listProducts: vi.fn(),
  setProductActive: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../../lib/customers-api", async (original) => ({
  ...(await original<object>()),
  listCustomers: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("./ProductDefaultRouteSection", () => ({
  ProductDefaultRouteSection: () => <p>Roteiro padrão (seção própria)</p>,
}));
vi.mock("./ProductIndustrialCostSummary", () => ({
  ProductIndustrialCostSummary: () => <p>Custos industriais (seção própria)</p>,
}));
vi.mock("../../components/AttachmentsSection", () => ({
  AttachmentsSection: ({ canUpload, canArchive }: { canUpload?: boolean; canArchive?: boolean }) => (
    <p>{`Documentos: anexar=${String(canUpload)} arquivar=${String(canArchive)}`}</p>
  ),
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createProduct, listProducts, updateProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { ProductsPage } from "./ProductsPage";
import { ProductCreatePage } from "./ProductCreatePage";

const EDITAM = ["COMMERCIAL", "ADMIN"];
const SO_CONSULTAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"];

function produto(extra: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "prod-1",
    code: "PROD-000001",
    name: "Coenzima Q10 60 cápsulas",
    customerId: "cli-1",
    lifecycle: "APPROVED",
    originProjectId: null,
    originProjectCode: null,
    customer: { id: "cli-1", code: "CLI-000001", legalName: "Vida Saudável Ltda", tradeName: "Vida" },
    finishedProductItemId: "item-1",
    finishedProductItem: {
      id: "item-1",
      code: "PA-000001",
      name: "Coenzima Q10 60 cápsulas",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      requiresCoa: true,
    },
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 2,
    doseAmount: "500",
    doseUomCode: "mg",
    dosesPerPackage: 30,
    unitsPerShippingBox: 24,
    targetAgeGroup: "ADULT",
    shelfLifeMonths: 24,
    businessLotCode: null,
    minimumBatchQuantity: "1000",
    activeFormulationVersionId: null,
    activeFormulationVersionLabel: null,
    externalCode: "Q10-60",
    notes: "Linha adulto",
    active: true,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...extra,
  } as ProductDTO;
}

function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname}</span>;
}

function abrir(entrada = "/cadastros/produtos") {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/produtos" element={<ProductsPage />} />
        <Route path="/cadastros/produtos/novo" element={<ProductCreatePage />} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
}

function camposEditaveis(elemento: HTMLElement) {
  return elemento.querySelectorAll("input, select, textarea, [contenteditable='true']");
}

function valorDe(elemento: HTMLElement, rotulo: string): string {
  const termo = within(elemento).getAllByText(rotulo, { selector: "dt" }).at(0);
  if (!termo) throw new Error(`Sem rótulo ${rotulo}`);
  return termo.nextElementSibling?.textContent ?? "";
}

async function abrirProduto(botao: "Editar" | "Ver") {
  abrir();
  await screen.findByText("PROD-000001");
  const linha = screen.getByText("PROD-000001").closest("tr") as HTMLElement;
  fireEvent.click(within(linha).getByRole("button", { name: botao }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listProducts).mockReset();
  vi.mocked(updateProduct).mockReset();
  vi.mocked(createProduct).mockReset();
  vi.mocked(listProducts).mockResolvedValue({
    products: [produto(), produto({ id: "prod-2", code: "PROD-000002", name: "Ômega 3", active: false })],
    page: 1,
    pageSize: 20,
    total: 2,
  });
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 50, total: 0 } as never);
  vi.mocked(listUnits).mockResolvedValue([
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ]);
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Comercial e Administrador mantêm o Produto", () => {
  it.each(EDITAM)("%s: + Novo produto, Editar e Inativar/Reativar, com CMV e Custos no menu", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("PROD-000001");

    expect(screen.getByRole("link", { name: "+ Novo produto" })).toHaveAttribute(
      "href",
      "/cadastros/produtos/novo",
    );
    expect(screen.getAllByRole("button", { name: "Editar" }), role).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000001"));
    for (const acao of ["CMV", "Custos industriais", "Inativar"]) {
      expect(screen.getByRole("menuitem", { name: acao }), `${role} ${acao}`).toBeInTheDocument();
    }
    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000001"));
    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000002"));
    expect(screen.getByRole("menuitem", { name: "Reativar" })).toBeInTheDocument();
  });

  it.each(EDITAM)("%s: edita o Produto; Documentos com as permissões do perfil", async (role) => {
    sessao.role = role;
    vi.mocked(updateProduct).mockResolvedValue(produto());
    const modal = await abrirProduto("Editar");

    expect(modal).toHaveTextContent("Cadastros / Produtos Acabados / Editar");
    expect(modal).toHaveTextContent(
      `Documentos: anexar=true arquivar=${role === "ADMIN" ? "true" : "false"}`,
    );
    fireEvent.change(within(modal).getByLabelText("Notas internas"), { target: { value: "Nova nota" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(updateProduct).toHaveBeenCalledWith("prod-1", expect.objectContaining({ notes: "Nova nota" })),
    );
  });

  it("COMMERCIAL: Novo produto oferece Exige CoA para o PA que nasce junto", async () => {
    sessao.role = "COMMERCIAL";
    abrir("/cadastros/produtos/novo");
    const laudo = (await waitFor(() => {
      const elemento = document.getElementById("product-requires-coa");
      if (!elemento) throw new Error("sem Exige CoA");
      return elemento;
    })) as HTMLInputElement;
    expect(laudo.disabled).toBe(false);
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — os demais perfis consultam o Produto", () => {
  it.each(SO_CONSULTAM)("%s: sem + Novo e sem Inativar/Reativar; CMV e Custos continuam", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("PROD-000001");

    expect(screen.queryByRole("link", { name: /Novo produto/ }), role).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" }), role).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ver" }), role).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000001"));
    expect(screen.getByRole("menuitem", { name: "CMV" }), role).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Custos industriais" }), role).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Inativar" }), role).toBeNull();
    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000001"));
    fireEvent.click(screen.getByLabelText("Mais ações de PROD-000002"));
    expect(screen.queryByRole("menuitem", { name: "Reativar" }), role).toBeNull();
  });

  it.each(SO_CONSULTAM)(
    "%s: o Produto abre em consulta, sem campo e sem Salvar; as seções próprias continuam",
    async (role) => {
      sessao.role = role;
      const modal = await abrirProduto("Ver");

      expect(modal, role).toHaveTextContent("Cadastros / Produtos Acabados / Consulta");
      expect(modal, role).toHaveTextContent(
        "Consulta. Só os perfis Comercial e Administrador alteram o cadastro do produto.",
      );
      expect(camposEditaveis(modal), role).toHaveLength(0);
      expect(within(modal).queryByRole("button", { name: /Salvar/ }), role).toBeNull();

      expect(valorDe(modal, "Cliente"), role).toBe("CLI-000001 Vida Saudável Ltda");
      expect(valorDe(modal, "Referência externa"), role).toBe("Q10-60");
      expect(valorDe(modal, "Forma farmacêutica"), role).toBe("Cápsula");
      expect(valorDe(modal, "Apresentação"), role).toBe("Pote");
      expect(valorDe(modal, "Cápsulas por dose"), role).toBe("2");
      expect(valorDe(modal, "Dose"), role).toBe("500");
      expect(valorDe(modal, "Lote mínimo"), role).toBe("1.000");
      expect(valorDe(modal, "Vida útil (meses)"), role).toBe("24");
      expect(valorDe(modal, "Controles de estoque"), role).toContain("exige CoA / laudo");
      expect(valorDe(modal, "Notas internas"), role).toBe("Linha adulto");

      expect(within(modal).getByText("Roteiro padrão (seção própria)"), role).toBeInTheDocument();
      expect(within(modal).getByText("Custos industriais (seção própria)"), role).toBeInTheDocument();
      expect(modal, role).toHaveTextContent(
        role === "QUALITY"
          ? "Documentos: anexar=true arquivar=true"
          : "Documentos: anexar=false arquivar=false",
      );
      expect(within(modal).getByRole("link", { name: /Formulação/ }), role).toBeInTheDocument();

      fireEvent.click(within(modal).getAllByRole("button", { name: /Fechar/ }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole("dialog"), role).toBeNull());
      expect(updateProduct, role).not.toHaveBeenCalled();
    },
  );

  it.each(SO_CONSULTAM)("%s: o endereço de Novo produto diz a quem pedir e volta", async (role) => {
    sessao.role = role;
    abrir("/cadastros/produtos/novo");

    expect(await screen.findByRole("alert"), role).toHaveTextContent(
      "Seu perfil não permite cadastrar produtos. Solicite ao Comercial ou Administrador o cadastro do produto.",
    );
    expect(document.querySelectorAll("input, select, textarea"), role).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "← Voltar para Produtos Acabados" }));
    await screen.findByText("PROD-000001");
    expect(screen.getByTestId("url").textContent, role).toBe("/cadastros/produtos");
    expect(createProduct, role).not.toHaveBeenCalled();
  });

  it("VIEWER: lista vazia diz a quem pedir o cadastro", async () => {
    sessao.role = "VIEWER";
    vi.mocked(listProducts).mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 });
    abrir();
    expect(
      await screen.findByText(
        "Nenhum produto cadastrado. Solicite ao Comercial ou Administrador o cadastro do produto.",
      ),
    ).toBeInTheDocument();
  });
});
