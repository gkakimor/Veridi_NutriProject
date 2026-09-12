import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useListFilters } from "./list-filters";
import { clearStoredFilters } from "./stored-filters";

/**
 * A fundação de filtros de listagem — FILTER-FOUNDATION-01.
 *
 * O que se prova aqui: a URL é o estado, o default não ocupa a URL, trocar
 * filtro volta para a página 1, um endereço restaura a tela, e a lembrança
 * da sessão nunca contamina uma URL compartilhada.
 */

const PADRAO = { search: "", status: "all", period: "mes-atual" };
const ESCOPO = "sonda";

function Sonda({ escopo }: { escopo?: string }) {
  const { values, page, set, setPage, clear, activeCount, isActive } = useListFilters({
    defaults: PADRAO,
    ...(escopo === undefined ? {} : { persistScope: escopo }),
    userId: "u-1",
  });
  const location = useLocation();
  return (
    <div>
      <output data-testid="url">{location.search}</output>
      <output data-testid="valores">{JSON.stringify(values)}</output>
      <output data-testid="pagina">{page}</output>
      <output data-testid="ativos">{activeCount}</output>
      <output data-testid="tem-filtro">{String(isActive)}</output>
      <button type="button" onClick={() => set({ status: "ISSUED" })}>
        status emitido
      </button>
      <button type="button" onClick={() => set({ search: "abc" })}>
        buscar abc
      </button>
      <button type="button" onClick={() => setPage(3)}>
        pagina 3
      </button>
      <button type="button" onClick={clear}>
        limpar
      </button>
    </div>
  );
}

function montar(url = "/", escopo?: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Sonda {...(escopo === undefined ? {} : { escopo })} />
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId("url").textContent ?? "";
const valores = () => JSON.parse(screen.getByTestId("valores").textContent ?? "{}") as typeof PADRAO;

beforeEach(() => {
  clearStoredFilters("u-1", ESCOPO);
});

describe("URL como estado", () => {
  it("sem nada na URL a tela abre nos defaults, e a URL continua limpa", () => {
    montar();
    expect(valores()).toEqual(PADRAO);
    expect(url()).toBe("");
    expect(screen.getByTestId("pagina")).toHaveTextContent("1");
    expect(screen.getByTestId("ativos")).toHaveTextContent("0");
    expect(screen.getByTestId("tem-filtro")).toHaveTextContent("false");
  });

  it("a URL restaura os filtros e a página", () => {
    montar("/?status=ISSUED&search=NF-1&page=3");
    expect(valores()).toMatchObject({ status: "ISSUED", search: "NF-1", period: "mes-atual" });
    expect(screen.getByTestId("pagina")).toHaveTextContent("3");
    expect(screen.getByTestId("ativos")).toHaveTextContent("2");
  });

  it("o que está no default sai da URL — sem `?status=all&page=1`", () => {
    montar("/?status=ISSUED&page=3");
    fireEvent.click(screen.getByRole("button", { name: "limpar" }));
    expect(url()).toBe("");
    expect(valores()).toEqual(PADRAO);
  });

  it("parâmetro alheio à tela sobrevive à troca de filtro", () => {
    montar("/?voltarPara=%2Fcomercial");
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    expect(url()).toContain("voltarPara=%2Fcomercial");
    expect(url()).toContain("status=ISSUED");
  });

  it("não cria parâmetro duplicado ao reescrever o mesmo filtro", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    fireEvent.click(screen.getByRole("button", { name: "buscar abc" }));
    const params = new URLSearchParams(url());
    expect(params.getAll("status")).toEqual(["ISSUED"]);
    expect(params.getAll("search")).toEqual(["abc"]);
  });
});

describe("paginação", () => {
  it("trocar qualquer filtro volta para a página 1", () => {
    montar("/?page=3");
    expect(screen.getByTestId("pagina")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    expect(screen.getByTestId("pagina")).toHaveTextContent("1");
    expect(url()).not.toContain("page=");
  });

  it("mudar de página preserva os filtros", () => {
    montar("/?status=ISSUED");
    fireEvent.click(screen.getByRole("button", { name: "pagina 3" }));
    expect(screen.getByTestId("pagina")).toHaveTextContent("3");
    expect(valores().status).toBe("ISSUED");
  });

  it("página inválida na URL cai em 1 em vez de quebrar a consulta", () => {
    montar("/?page=abc");
    expect(screen.getByTestId("pagina")).toHaveTextContent("1");
  });
});

describe("lembrança da sessão", () => {
  it("sem `persistScope` a tela não lembra de nada", () => {
    const primeira = montar("/", undefined);
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    primeira.unmount();

    montar("/", undefined);
    expect(valores()).toEqual(PADRAO);
  });

  it("com escopo, voltar para a lista sem URL recupera o filtro anterior", () => {
    const primeira = montar("/", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores().status).toBe("ISSUED");
    expect(url()).toContain("status=ISSUED");
  });

  it("`Limpar filtros` também esquece a sessão", () => {
    const primeira = montar("/", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    fireEvent.click(screen.getByRole("button", { name: "limpar" }));
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores()).toEqual(PADRAO);
    expect(url()).toBe("");
  });

  /*
   * O ponto é o "estado compartilhável": se a lembrança de quem abriu se
   * misturasse a um endereço colado num chamado, duas pessoas veriam listas
   * diferentes na mesma URL — e a URL deixaria de provar o que a tela mostra.
   */
  it("uma URL com filtro vence a sessão inteira, sem mesclar", () => {
    const primeira = montar("/", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    primeira.unmount();

    montar("/?search=NF-1", ESCOPO);
    expect(valores()).toMatchObject({ search: "NF-1", status: "all" });
  });
});

/**
 * FILTER-OPERATIONS-WAVE-02 — a sessão lembra ESCOLHA, não link.
 *
 * O smoke de Lotes mostrou o efeito: clicar em "Liberação de lotes"
 * (`/estoque/lotes?status=AWAITING_RELEASE`) gravava aquele status na sessão,
 * e a partir dali "Lotes" — o mesmo endereço sem query — abria na quarentena.
 * Um link de contexto reescrevia a visão padrão de quem o clicou.
 */
describe("a sessão guarda escolha, não contexto de link", () => {
  it("chegar por uma URL com filtro e não mexer em nada NÃO grava a sessão", () => {
    const primeira = montar("/?status=ISSUED", ESCOPO);
    expect(valores().status).toBe("ISSUED");
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores()).toEqual(PADRAO);
    expect(url()).toBe("");
  });

  it("mas mexer num filtro depois de chegar pelo link grava o conjunto", () => {
    const primeira = montar("/?status=ISSUED", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "buscar abc" }));
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores()).toMatchObject({ status: "ISSUED", search: "abc" });
  });

  it("filtrar, sair e voltar continua preservando o filtro — o caso que a sessão existe para servir", () => {
    const primeira = montar("/", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "status emitido" }));
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores().status).toBe("ISSUED");
  });

  it("`Limpar filtros` apaga a lembrança mesmo tendo chegado por link", () => {
    const primeira = montar("/?status=ISSUED", ESCOPO);
    fireEvent.click(screen.getByRole("button", { name: "limpar" }));
    primeira.unmount();

    montar("/", ESCOPO);
    expect(valores()).toEqual(PADRAO);
  });
});
