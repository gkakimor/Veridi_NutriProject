import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { EntityLink } from "./EntityLink";
import { RecordContextChip } from "./RecordContext";

/**
 * F-11-1 — sair de um documento por um `EntityLink` de cadastro deixa o
 * caminho de volta. O link leva `voltar` com a rota de onde saiu, e o aviso de
 * lista reduzida oferece "← Voltar para …". Menu não leva: sem contexto, sem volta.
 */

function Onde() {
  const location = useLocation();
  return <output data-testid="rota">{`${location.pathname}${location.search}`}</output>;
}

function montar(inicio: string) {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <Onde />
      <NavLink to="/cadastros/clientes">Clientes (menu)</NavLink>
      <Routes>
        <Route
          path="/comercial/projetos/:id"
          element={
            <>
              <h1>Projeto PROJ-000001</h1>
              <EntityLink kind="customer" id="cli-1" code="CLI-000001" name="Vida Saudável" />
              <EntityLink kind="productionOrder" id="op-1" code="OP-000001" />
            </>
          }
        />
        <Route
          path="/cadastros/clientes"
          element={<RecordContextChip noun="o cliente" code="CLI-000001" onClear={() => {}} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const rota = () => screen.getByTestId("rota").textContent;

describe("EntityLink — ida ao cadastro e volta", () => {
  it("do Projeto ao Cliente e de volta ao mesmo endereço, busca incluída", () => {
    montar("/comercial/projetos/prj-1?quoteVersionId=v2");

    const link = screen.getByRole("link", { name: /CLI-000001/ });
    expect(link.getAttribute("href")).toBe(
      "/cadastros/clientes?ids=cli-1&open=cli-1&voltar=%2Fcomercial%2Fprojetos%2Fprj-1%3FquoteVersionId%3Dv2",
    );

    fireEvent.click(link);
    expect(rota()).toMatch(/^\/cadastros\/clientes\?ids=cli-1&open=cli-1&voltar=/);
    expect(screen.getByText(/Mostrando apenas o cliente/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "← Voltar para Projeto" }));
    expect(rota()).toBe("/comercial/projetos/prj-1?quoteVersionId=v2");
    expect(screen.getByRole("heading", { name: "Projeto PROJ-000001" })).toBeInTheDocument();
  });

  it("documento com página própria não leva `voltar`", () => {
    montar("/comercial/projetos/prj-1");
    expect(screen.getByRole("link", { name: "OP-000001" }).getAttribute("href")).toBe("/producao/ordens/op-1");
  });

  it("menu e link direto: o cadastro sem volta", () => {
    montar("/comercial/projetos/prj-1");
    fireEvent.click(screen.getByRole("link", { name: "Clientes (menu)" }));
    expect(rota()).toBe("/cadastros/clientes");
    expect(screen.queryByRole("link", { name: /Voltar para/ })).toBeNull();
  });

  it("`voltar` forjado para fora do sistema não vira link", () => {
    for (const forjado of ["%2F%2Fevil.example", "https%3A%2F%2Fevil.example", "javascript%3Aalert(1)"]) {
      const { unmount } = montar(`/cadastros/clientes?ids=cli-1&voltar=${forjado}`);
      expect(screen.getByText(/Mostrando apenas o cliente/)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Voltar para/ })).toBeNull();
      unmount();
    }
  });
});
