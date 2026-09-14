import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListStatusRow } from "./ListStatusRow";
import { TableEmptyRow } from "./TableEmptyRow";

/**
 * Linha de vazio com ação em 390px (LISTS-EMPTY-ROW-390-01).
 *
 * A célula de vazio tem `colspan` e a largura da tabela inteira (1037px em
 * Clientes, em 390px); célula de tabela ignora `max-width`, e `.table td`
 * vencia o `white-space: normal`. A frase e o botão "Limpar filtros" terminavam
 * em x=437 com a borda em 378. jsdom não faz layout: aqui ficam a estrutura e
 * as regras; a medida (corpo 37–353 dentro de 12–378) é do smoke.
 */

const folha = () =>
  readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");

function regra(css: string, seletor: string): string {
  const inicio = css.indexOf(`\n${seletor} {`);
  expect(inicio, `regra ${seletor}`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("linha de vazio da listagem", () => {
  it("o conteúdo, com a ação, fica no corpo da célula", () => {
    const { container } = render(
      <table className="table">
        <tbody>
          <ListStatusRow colSpan={9} query={{ data: { rows: [] }, loading: false }} rowCount={0}>
            Nenhum cliente encontrado para os filtros atuais.{" "}
            <button type="button">Limpar filtros</button>
          </ListStatusRow>
        </tbody>
      </table>,
    );
    const corpo = container.querySelector("td.table__empty > .table__empty-body");
    expect(corpo).not.toBeNull();
    expect(corpo!.querySelector("button")).not.toBeNull();
    expect(corpo!.textContent).toContain("Nenhum cliente encontrado");
  });

  it("o corpo tem a largura visível do contêiner e fica preso à esquerda; a célula quebra linha", () => {
    const css = folha();
    expect(regra(css, ".table-container:has(td.table__empty)")).toMatch(/container-type: inline-size;/);
    expect(regra(css, ".table td.table__empty")).toMatch(/white-space: normal;/);
    const corpo = regra(css, ".table__empty-body");
    expect(corpo).toMatch(/position: sticky;/);
    expect(corpo).toMatch(/width: calc\(100cqi - 2 \* var\(--sp-6\)\);/);
  });

  it("linha de vazio de seção (TableEmptyRow): frase longa, link e botão no mesmo corpo, alcançáveis por teclado", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <table className="table">
        <tbody>
          <TableEmptyRow colSpan={10}>
            Nenhuma tarifa registrada. O custo deste recurso fica em aberto até que uma seja informada.{" "}
            <a href="/compras/item-fornecedor">Vincular em Compras → Item × Fornecedor</a>{" "}
            <button type="button">Limpar filtros</button>
          </TableEmptyRow>
        </tbody>
      </table>,
    );
    const celula = container.querySelector("td.table__empty") as HTMLTableCellElement;
    expect(celula.colSpan).toBe(10);
    const corpo = celula.querySelector(":scope > .table__empty-body");
    expect(corpo).not.toBeNull();
    expect(celula.children).toHaveLength(1);
    expect(corpo!.textContent).toContain("fica em aberto até que uma seja informada");
    await user.tab();
    expect(document.activeElement).toBe(corpo!.querySelector("a"));
    await user.tab();
    expect(document.activeElement).toBe(corpo!.querySelector("button"));
  });

  it("ListStatusRow usa a mesma linha", () => {
    const { container } = render(
      <table className="table">
        <tbody>
          <ListStatusRow colSpan={3} query={{ data: null, loading: true }} rowCount={0}>
            nunca
          </ListStatusRow>
        </tbody>
      </table>,
    );
    expect(container.querySelector("td.table__empty > .table__empty-body")?.textContent).toBe("Carregando…");
  });

  it("células comuns continuam sem quebra", () => {
    expect(regra(folha(), ".table th,\n.table td")).toMatch(/white-space: nowrap;/);
  });
});
