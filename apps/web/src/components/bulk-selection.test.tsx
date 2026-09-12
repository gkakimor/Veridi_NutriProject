import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { BulkSelection } from "./BulkSelection";
import {
  BulkSelectionBar,
  BulkSelectionCell,
  BulkSelectionHeaderCell,
  useBulkSelection,
} from "./BulkSelection";

/**
 * Seleção em massa — a foundation (BULK-SELECTION-FOUNDATION-01).
 *
 * O que estes testes seguram é a diferença entre as duas perguntas: o
 * cabeçalho marca ESTA PÁGINA; "todos os resultados filtrados" é outro gesto,
 * explícito, que guarda o filtro e as exceções em vez de ids. E o que a
 * seleção sobrevive (troca de página) contra o que a apaga (troca de filtro).
 */

type Filtros = { status?: string[]; search?: string; customerId?: string | undefined; page?: number };
type Linha = { id: string; code: string };

const EM_ABERTO = { status: ["DRAFT", "CONFIRMED"] };

function pagina(numero: number, tamanho = 20): Linha[] {
  return Array.from({ length: tamanho }, (_, indice) => {
    const n = (numero - 1) * tamanho + indice + 1;
    return { id: `id-${n}`, code: `PED-${String(n).padStart(6, "0")}` };
  });
}

function Tela({
  linhas,
  total,
  filtros,
  carregando = false,
  abrir = () => {},
  espiao,
}: {
  linhas: Linha[];
  total: number;
  filtros: Filtros;
  carregando?: boolean;
  abrir?: (id: string) => void;
  espiao?: { atual: BulkSelection<Filtros> | null };
}) {
  const selecao = useBulkSelection({
    pageIds: linhas.map((linha) => linha.id),
    total,
    filters: filtros,
    loading: carregando,
  });
  if (espiao) espiao.atual = selecao;
  return (
    <>
      <BulkSelectionBar selection={selecao} />
      <table className="table table--clickable-rows">
        <thead>
          <tr>
            <BulkSelectionHeaderCell selection={selecao} />
            <th>Pedido</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={linha.id}
              tabIndex={0}
              onClick={() => abrir(linha.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") abrir(linha.id);
              }}
            >
              <BulkSelectionCell selection={selecao} id={linha.id} label={`Selecionar pedido ${linha.code}`} />
              <td>{linha.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const cabecalho = () =>
  screen.getByLabelText("Selecionar todos os registros desta página") as HTMLInputElement;
const caixa = (codigo: string) => screen.getByLabelText(`Selecionar pedido ${codigo}`) as HTMLInputElement;
const barra = () => screen.queryByRole("group", { name: "Seleção em massa" });
const contagem = () => barra()?.querySelector(".bulk-bar__count")?.textContent ?? null;
const alcance = () => barra()?.querySelector(".bulk-bar__scope")?.textContent ?? null;
const todosOs = (total: number) =>
  screen.queryByRole("button", { name: `Selecionar todos os ${total} resultados filtrados` });

function espiar() {
  return { atual: null } as { atual: BulkSelection<Filtros> | null };
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("linha e página — modo ids", () => {
  it("1. marca uma linha: 1 selecionado, e o descritor leva o id", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    expect(barra()).toBeNull();

    fireEvent.click(caixa("PED-000002"));
    expect(caixa("PED-000002").checked).toBe(true);
    expect(contagem()).toBe("1 selecionado");
    expect(espiao.atual?.descriptor).toEqual({ mode: "ids", ids: ["id-2"] });
  });

  it("2. desmarcar devolve a tela sem barra e sem descritor", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000002"));
    fireEvent.click(caixa("PED-000002"));

    expect(caixa("PED-000002").checked).toBe(false);
    expect(barra()).toBeNull();
    expect(espiao.atual?.descriptor).toBeNull();
  });

  it("3 e 6. o cabeçalho marca a PÁGINA: com 327 no filtro e 20 à vista, são 20", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());

    expect(contagem()).toBe("20 selecionados");
    for (const linha of pagina(1)) expect(caixa(linha.code).checked).toBe(true);
    expect(espiao.atual?.mode).toBe("ids");
    expect(espiao.atual?.descriptor).toEqual({ mode: "ids", ids: pagina(1).map((linha) => linha.id) });
  });

  it("4 e 5. cabeçalho: nada → unchecked; parte → indeterminate; tudo → checked", () => {
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    expect(cabecalho().checked).toBe(false);
    expect(cabecalho().indeterminate).toBe(false);

    fireEvent.click(caixa("PED-000001"));
    expect(cabecalho().checked).toBe(false);
    expect(cabecalho().indeterminate).toBe(true);

    fireEvent.click(cabecalho());
    expect(cabecalho().checked).toBe(true);
    expect(cabecalho().indeterminate).toBe(false);
  });

  it("desmarcar o cabeçalho com a página inteira tira só esta página", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(caixa("PED-000001"));
    rerender(<Tela linhas={pagina(2)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(cabecalho());
    expect(contagem()).toBe("21 selecionados");

    fireEvent.click(cabecalho());
    expect(contagem()).toBe("1 selecionado");
  });
});

describe("todos os resultados filtrados — modo filtered", () => {
  it("7. o CTA só existe com a página inteira marcada, e fala o total do filtro", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(caixa("PED-000001"));
    expect(todosOs(327)).toBeNull();

    fireEvent.click(cabecalho());
    expect(todosOs(327)).not.toBeNull();

    // Página que já é o filtro inteiro não tem "todos" a oferecer.
    rerender(<Tela linhas={pagina(1, 12)} total={12} filtros={{ search: "PED" }} />);
    fireEvent.click(cabecalho());
    expect(contagem()).toBe("12 selecionados");
    expect(screen.queryByRole("button", { name: /Selecionar todos os \d+ resultados filtrados/ })).toBeNull();
  });

  it("8. clicar entra em todos os filtrados: 327, a frase, e o descritor sem ids", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);

    expect(contagem()).toBe("327 selecionados");
    expect(alcance()).toBe("Todos os 327 resultados filtrados estão selecionados.");
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeInTheDocument();
    expect(todosOs(327)).toBeNull();
    expect(cabecalho().checked).toBe(true);
    expect(espiao.atual?.descriptor).toEqual({ mode: "filtered", filters: EM_ABERTO, excludedIds: [] });
  });

  it("9. desmarcar uma linha vira exceção: 326, o modo continua, cabeçalho parcial", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000003"));

    expect(contagem()).toBe("326 selecionados");
    expect(alcance()).toBe("Todos os 327 resultados filtrados estão selecionados, exceto 1 desmarcado.");
    expect(espiao.atual?.mode).toBe("filtered");
    expect(espiao.atual?.descriptor).toEqual({ mode: "filtered", filters: EM_ABERTO, excludedIds: ["id-3"] });
    expect(caixa("PED-000003").checked).toBe(false);
    expect(cabecalho().indeterminate).toBe(true);
  });

  it("10. remarcar o excluído tira da exceção: 327 de novo", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000003"));
    fireEvent.click(caixa("PED-000003"));

    expect(contagem()).toBe("327 selecionados");
    expect(espiao.atual?.descriptor).toEqual({ mode: "filtered", filters: EM_ABERTO, excludedIds: [] });
  });

  it("11. contagem = total − exceções, somando exceções de páginas diferentes", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000001"));
    fireEvent.click(caixa("PED-000020"));

    rerender(<Tela linhas={pagina(2)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(caixa("PED-000021"));
    expect(contagem()).toBe("324 selecionados");
  });

  it("no modo filtered, o cabeçalho desmarca a página como exceção — sem sair do modo", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);

    fireEvent.click(cabecalho());
    expect(contagem()).toBe("307 selecionados");
    expect(espiao.atual?.mode).toBe("filtered");

    fireEvent.click(cabecalho());
    expect(contagem()).toBe("327 selecionados");
  });

  it("desmarcar um a um todos os resultados não é 'todos, exceto todos': é nada", () => {
    const espiao = espiar();
    const { rerender } = render(<Tela linhas={pagina(1, 2)} total={3} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(3) as HTMLElement);
    fireEvent.click(caixa("PED-000001"));
    fireEvent.click(caixa("PED-000002"));
    rerender(<Tela linhas={[{ id: "id-3", code: "PED-000003" }]} total={3} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000003"));

    expect(barra()).toBeNull();
    expect(espiao.atual?.mode).toBe("ids");
    expect(espiao.atual?.descriptor).toBeNull();
  });
});

describe("paginação e filtro", () => {
  it("12 e 14. trocar de página preserva; voltar à página 1 restaura as caixas", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(caixa("PED-000002"));
    fireEvent.click(caixa("PED-000005"));

    rerender(<Tela linhas={pagina(2)} total={327} filtros={EM_ABERTO} />);
    expect(contagem()).toBe("2 selecionados");
    expect(cabecalho().checked).toBe(false);
    fireEvent.click(caixa("PED-000030"));
    expect(contagem()).toBe("3 selecionados");

    rerender(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    expect(caixa("PED-000002").checked).toBe(true);
    expect(caixa("PED-000005").checked).toBe(true);
    expect(caixa("PED-000001").checked).toBe(false);
  });

  it("no modo filtered, a página nova já chega marcada", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);

    rerender(<Tela linhas={pagina(3)} total={327} filtros={EM_ABERTO} />);
    expect(caixa("PED-000041").checked).toBe(true);
    expect(cabecalho().checked).toBe(true);
    expect(contagem()).toBe("327 selecionados");
  });

  it("13. filtro que muda de verdade limpa — e voltar ao anterior não ressuscita", () => {
    const espiao = espiar();
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);

    rerender(<Tela linhas={pagina(1)} total={327} filtros={{ ...EM_ABERTO, search: "PED-1" }} espiao={espiao} />);
    expect(barra()).toBeNull();
    expect(espiao.atual?.descriptor).toBeNull();
    expect(caixa("PED-000001").checked).toBe(false);

    rerender(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    expect(barra()).toBeNull();
    expect(espiao.atual?.descriptor).toBeNull();
  });

  it("14. objeto novo com o mesmo conteúdo, `page` e campo vazio NÃO limpam", () => {
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={{ status: ["DRAFT", "CONFIRMED"] }} />);
    fireEvent.click(caixa("PED-000001"));

    rerender(
      <Tela
        linhas={pagina(2)}
        total={327}
        filtros={{ search: "", customerId: undefined, page: 2, status: ["DRAFT", "CONFIRMED"] }}
      />,
    );
    expect(contagem()).toBe("1 selecionado");
  });

  it("15. Limpar seleção zera nos dois modos", () => {
    const espiao = espiar();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000001"));
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(barra()).toBeNull();

    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000004"));
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));

    expect(barra()).toBeNull();
    expect(espiao.atual?.mode).toBe("ids");
    expect(espiao.atual?.descriptor).toBeNull();
    expect(caixa("PED-000001").checked).toBe(false);
    expect(cabecalho().checked).toBe(false);
  });
});

describe("identidade e estado transitório", () => {
  it("16. a seleção segue o id: linha que muda de posição e código repetido não confundem", () => {
    const linhas = [
      { id: "uuid-a", code: "PED-000001" },
      { id: "uuid-b", code: "PED-000002" },
      { id: "uuid-c", code: "PED-000003" },
    ];
    const espiao = espiar();
    const { rerender } = render(<Tela linhas={linhas} total={3} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000002"));

    // Recarga que devolve a mesma página em outra ordem.
    rerender(<Tela linhas={[...linhas].reverse()} total={3} filtros={EM_ABERTO} espiao={espiao} />);
    expect(caixa("PED-000002").checked).toBe(true);
    expect(caixa("PED-000001").checked).toBe(false);
    expect(espiao.atual?.descriptor).toEqual({ mode: "ids", ids: ["uuid-b"] });

    // Outro registro assumindo a posição e o código exibido do marcado.
    rerender(
      <Tela
        linhas={[{ id: "uuid-z", code: "PED-000002" }, linhas[0] as Linha]}
        total={3}
        filtros={EM_ABERTO}
        espiao={espiao}
      />,
    );
    expect(caixa("PED-000002").checked).toBe(false);
    expect(espiao.atual?.descriptor).toEqual({ mode: "ids", ids: ["uuid-b"] });
  });

  it("17. nada vai para URL, sessão ou localStorage — e remontar começa vazio", () => {
    const antes = window.location.href;
    const primeira = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000003"));

    expect(window.location.href).toBe(antes);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    primeira.unmount();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    expect(barra()).toBeNull();
    expect(cabecalho().checked).toBe(false);
  });

  it("consulta em andamento: caixas desabilitadas e gesto ignorado", () => {
    const espiao = espiar();
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000001"));

    rerender(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} carregando espiao={espiao} />);
    expect(cabecalho().disabled).toBe(true);
    expect(caixa("PED-000002").disabled).toBe(true);
    espiao.atual?.toggle("id-2");
    espiao.atual?.togglePage();
    rerender(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} carregando espiao={espiao} />);
    expect(contagem()).toBe("1 selecionado");
    // A saída continua valendo.
    expect(screen.getByRole("button", { name: "Limpar seleção" })).not.toBeDisabled();
  });

  it("prune tira o que o servidor disse ter saído do universo — nos dois modos", () => {
    const espiao = espiar();
    const { rerender } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} espiao={espiao} />);
    fireEvent.click(caixa("PED-000001"));
    fireEvent.click(caixa("PED-000002"));
    act(() => espiao.atual?.prune(["id-2"]));
    expect(espiao.atual?.descriptor).toEqual({ mode: "ids", ids: ["id-1"] });

    fireEvent.click(cabecalho());
    fireEvent.click(todosOs(327) as HTMLElement);
    fireEvent.click(caixa("PED-000007"));
    act(() => espiao.atual?.prune(["id-7"]));
    // O servidor já não conta o registro: a exceção dele sairia duas vezes.
    rerender(<Tela linhas={pagina(1)} total={326} filtros={EM_ABERTO} espiao={espiao} />);
    expect(espiao.atual?.descriptor).toEqual({ mode: "filtered", filters: EM_ABERTO, excludedIds: [] });
    expect(contagem()).toBe("326 selecionados");
  });
});

describe("tabela e acessibilidade", () => {
  it("clique e Enter na caixa não abrem o registro; a linha continua abrindo", () => {
    const abrir = vi.fn();
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} abrir={abrir} />);

    fireEvent.click(caixa("PED-000001"));
    fireEvent.keyDown(caixa("PED-000001"), { key: "Enter" });
    // A célula inteira é alvo: clicar fora da caixa, no rótulo, também marca.
    fireEvent.click(caixa("PED-000002").closest("label") as HTMLElement);
    expect(abrir).not.toHaveBeenCalled();
    expect(caixa("PED-000002").checked).toBe(true);

    fireEvent.click(screen.getByText("PED-000001"));
    expect(abrir).toHaveBeenCalledWith("id-1");
  });

  it("nomes claros e contador anunciado a quem usa leitor de tela", () => {
    const { container } = render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    const anuncio = () => container.querySelector('[aria-live="polite"]')?.textContent;
    expect(anuncio()).toBe("");

    fireEvent.click(cabecalho());
    expect(anuncio()).toBe("20 selecionados.");
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos os 327 resultados filtrados" }));
    expect(anuncio()).toBe("327 selecionados. Todos os 327 resultados filtrados estão selecionados.");

    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(anuncio()).toBe("Nenhum registro selecionado.");
    expect(screen.getAllByRole("checkbox", { name: /^Selecionar pedido PED-\d{6}$/ })).toHaveLength(20);
  });

  it("sem ação injetada, a barra diz para que serve; com ação, a ação ocupa o lugar", () => {
    function ComAcao() {
      const selecao = useBulkSelection({ pageIds: ["x"], total: 1, filters: {} });
      return (
        <>
          <BulkSelectionBar selection={selecao}>
            <button type="button">Ação do consumidor</button>
          </BulkSelectionBar>
          <button type="button" onClick={() => selecao.toggle("x")}>
            marcar
          </button>
        </>
      );
    }
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(caixa("PED-000001"));
    expect(screen.getByText("Use a seleção para ações em lote.")).toBeInTheDocument();

    const { container } = render(<ComAcao />);
    fireEvent.click(screen.getByRole("button", { name: "marcar" }));
    expect(container.querySelector(".bulk-bar")?.textContent).toContain("Ação do consumidor");
    expect(container.querySelector(".bulk-bar__hint")).toBeNull();
  });
});

describe("18. 390px", () => {
  const css = () =>
    readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");
  function regra(seletor: string): string {
    const folha = css();
    const inicio = folha.indexOf(`\n${seletor} {`);
    if (inicio < 0) throw new Error(`regra ausente: ${seletor}`);
    return folha.slice(inicio, folha.indexOf("}", inicio));
  }

  it("barra e grupos quebram linha; em tela estreita cada grupo ocupa a linha", () => {
    expect(regra(".bulk-bar")).toContain("flex-wrap: wrap");
    expect(regra(".bulk-bar__group")).toContain("flex-wrap: wrap");

    const folha = css();
    const estreita = folha.slice(folha.indexOf("@media (max-width: 480px) {\n  .bulk-bar__group {"));
    const bloco = estreita.slice(0, estreita.indexOf("\n}\n"));
    expect(bloco).toContain("width: 100%");
    // Caber encolhendo letra ou escondendo a contagem é o que não se faz.
    expect(bloco).not.toContain("font-size");
    expect(bloco).not.toContain("display: none");
  });

  it("o CTA longo quebra em vez de vazar, e a caixa tem alvo de toque", () => {
    const todos = regra(".bulk-bar__all");
    expect(todos).toContain("height: auto");
    expect(todos).toContain("max-width: 100%");
    expect(todos).not.toContain("nowrap");

    const alvo = regra(".bulk-select");
    expect(alvo).toContain("min-width: 40px");
    expect(alvo).toContain("min-height: 40px");
  });

  it("em todos os modos a barra tem contagem e Limpar seleção", () => {
    render(<Tela linhas={pagina(1)} total={327} filtros={EM_ABERTO} />);
    fireEvent.click(cabecalho());
    expect(barra()?.querySelector(".bulk-bar__count")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeInTheDocument();

    fireEvent.click(todosOs(327) as HTMLElement);
    expect(barra()?.querySelector(".bulk-bar__count")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeInTheDocument();
  });
});
