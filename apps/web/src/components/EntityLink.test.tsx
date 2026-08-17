import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EntityLink, entityHref } from "./EntityLink";
import { ProductRelatedLinks } from "./ProductRelatedLinks";

/**
 * O que estes testes protegem não é o texto do link — é a regra: destino por
 * identidade, e nenhum link quando a identidade não existe.
 */

function renderLink(props: Parameters<typeof EntityLink>[0]) {
  return render(
    <MemoryRouter>
      <EntityLink {...props} />
    </MemoryRouter>,
  );
}

describe("EntityLink", () => {
  it("leva ao registro pelo id, nunca a uma busca pelo código", () => {
    renderLink({ kind: "product", id: "prod-1", code: "PROD-000012", name: "Magnésio" });

    const link = screen.getByRole("link", { name: /PROD-000012/ });
    const href = link.getAttribute("href") ?? "";

    expect(href).toContain("productId=prod-1");
    // Busca textual traria homônimo ou nada — o link não pode depender disso.
    expect(href).not.toContain("search=");
    expect(href).not.toContain("PROD-000012");
  });

  it("sem id não vira link — texto continua texto", () => {
    // Referência legada guardou só o código. Chutar destino levaria ao
    // registro errado com cara de certo.
    renderLink({ kind: "product", id: null, code: "PROD-000012", name: "Magnésio" });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/PROD-000012/)).toBeTruthy();
  });

  it("mostra o código e o nome juntos, sem expor o id", () => {
    const { container } = renderLink({
      kind: "item",
      id: "5f2f1f2e-0000-4000-8000-000000000000",
      code: "MP-000001",
      name: "Vitamina C",
    });

    expect(screen.getByRole("link").textContent).toBe("MP-000001 Vitamina C");
    expect(container.textContent).not.toContain("5f2f1f2e");
  });

  it("cadastro simples abre o registro, não a lista inteira", () => {
    // Item, cliente e fornecedor moram numa lista com modal: o link precisa
    // reduzir a lista (`ids`) e abrir o modal (`open`).
    for (const [kind, path] of [
      ["item", "/cadastros/itens"],
      ["customer", "/cadastros/clientes"],
      ["supplier", "/cadastros/fornecedores"],
    ] as const) {
      const href = entityHref(kind, "abc");
      expect(href.startsWith(path)).toBe(true);
      expect(href).toContain("ids=abc");
      expect(href).toContain("open=abc");
    }
  });

  it("documento transacional vai direto para a própria página", () => {
    expect(entityHref("productionOrder", "op-1")).toBe("/producao/ordens/op-1");
    expect(entityHref("customerOrder", "ped-1")).toBe("/comercial/pedidos/ped-1");
    expect(entityHref("lot", "lot-1")).toBe("/estoque/lotes/lot-1");
    expect(entityHref("project", "prj-1")).toBe("/comercial/projetos/prj-1");
  });

  it("tela do produto oferece volta ao produto e às irmãs, menos a atual", () => {
    // Custos, formulação e precificação são telas DO produto em rotas
    // próprias: sem esta barra, quem entra numa delas só volta pelo botão do
    // navegador.
    render(
      <MemoryRouter>
        <ProductRelatedLinks productId="prod-1" current="costs" />
      </MemoryRouter>,
    );

    const rotulos = screen.getAllByRole("link").map((link) => link.textContent);
    expect(rotulos).toContain("Produto");
    expect(rotulos).toContain("Formulação");
    expect(rotulos).toContain("Precificação");
    // Link para a tela em que a pessoa já está é ruído.
    expect(rotulos).not.toContain("Custos industriais");
  });

  it("sem produto não inventa barra de navegação", () => {
    const { container } = render(
      <MemoryRouter>
        <ProductRelatedLinks productId={null} current="costs" />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });

  it("sem código e sem nome mostra o traço de desconhecido", () => {
    renderLink({ kind: "item", id: "item-1", code: null });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
