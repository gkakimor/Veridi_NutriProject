import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PageBreadcrumbs } from "./PageBreadcrumbs";

/**
 * O que estes testes protegem não é o desenho da trilha — é a promessa dela:
 * nível anterior é link de verdade (Voltar, Avançar e "abrir em nova aba"
 * continuam funcionando) e o nível atual não finge ser clicável.
 */

describe("PageBreadcrumbs", () => {
  it("níveis anteriores são links com o href da lista", () => {
    render(
      <MemoryRouter>
        <PageBreadcrumbs
          items={[
            { label: "Ordens de Compra", href: "/compras/ordens" },
            { label: "OC-000011" },
          ]}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Ordens de Compra" });
    // `<a href>` de verdade: é o que faz Ctrl+clique e "abrir em nova aba"
    // funcionarem. Uma div com onClick passaria em getByText e falharia aqui.
    expect(link.getAttribute("href")).toBe("/compras/ordens");
  });

  it("o item atual não é link, mesmo se vier com href", () => {
    render(
      <MemoryRouter>
        <PageBreadcrumbs
          items={[
            { label: "Ordens de Compra", href: "/compras/ordens" },
            { label: "OC-000011", href: "/compras/ordens/oc-1" },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "OC-000011" })).toBeNull();
    expect(screen.getByText("OC-000011").getAttribute("aria-current")).toBe("page");
  });

  it("clicar num nível anterior navega para ele", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/compras/ordens/oc-1"]}>
        <Routes>
          <Route path="/compras/ordens" element={<p>Lista de ordens de compra</p>} />
          <Route
            path="/compras/ordens/:id"
            element={
              <PageBreadcrumbs
                items={[
                  { label: "Ordens de Compra", href: "/compras/ordens" },
                  { label: "OC-000011" },
                ]}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Ordens de Compra" }));

    expect(screen.getByText("Lista de ordens de compra")).toBeTruthy();
  });

  it("`current` explícito manda, e só um nível é o atual", () => {
    // Leitor de tela que encontra dois "página atual" na mesma trilha perde
    // justamente a informação que a trilha existe para dar.
    const { container } = render(
      <MemoryRouter>
        <PageBreadcrumbs
          items={[
            { label: "Ordens de Produção", href: "/producao/ordens" },
            { label: "OP-000004", href: "/producao/ordens/op-4", current: true },
            { label: "Folha de Receita" },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "OP-000004" })).toBeNull();
    expect(container.querySelectorAll("[aria-current='page']")).toHaveLength(1);
    expect(screen.getByText("OP-000004").getAttribute("aria-current")).toBe("page");
  });

  it("o nível intermediário com href continua sendo link", () => {
    render(
      <MemoryRouter>
        <PageBreadcrumbs
          items={[
            { label: "Ordens de Produção", href: "/producao/ordens" },
            { label: "OP-000004", href: "/producao/ordens/op-4" },
            { label: "Folha de Receita" },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "OP-000004" }).getAttribute("href")).toBe(
      "/producao/ordens/op-4",
    );
    expect(screen.getByText("Folha de Receita").getAttribute("aria-current")).toBe("page");
  });

  it("trilha de um nível só não é desenhada", () => {
    // Na lista raiz a trilha diria "Clientes" logo acima do título
    // "Clientes": informação zero, mais uma linha para varrer com o olho.
    const { container } = render(
      <MemoryRouter>
        <PageBreadcrumbs items={[{ label: "Clientes", href: "/cadastros/clientes" }]} />
      </MemoryRouter>,
    );

    expect(container.textContent).toBe("");
  });

  it("usa lista ordenada dentro de um nav rotulado", () => {
    render(
      <MemoryRouter>
        <PageBreadcrumbs
          items={[
            { label: "Recebimentos", href: "/compras/recebimentos" },
            { label: "REC-000003" },
          ]}
        />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "Trilha da página" });
    expect(nav.querySelectorAll("li")).toHaveLength(2);
  });
});
