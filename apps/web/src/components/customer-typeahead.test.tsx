import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchableEntitySelect } from "./SearchableEntitySelect";

/**
 * Busca de cliente no Projeto.
 *
 * A auditoria VAL-LEG-01 reproduziu o problema com um cliente real: a
 * razão social é "35.301.394 THIAGO LUZ DE SOUZA", o nome fantasia é "THE
 * KING". Quem ia cadastrar o projeto digitava "THE KING", não achava nada,
 * e a única opção na tela era "+ Cadastrar novo cliente" — o caminho mais
 * curto para uma base com o mesmo cliente duas vezes.
 */

const CLIENTES = [
  {
    id: "cli-4",
    code: "CLI-000004",
    name: "35.301.394 THIAGO LUZ DE SOUZA",
    hint: "THE KING",
    searchTerms: "THE KING 35.301.394/0001-00",
  },
  { id: "cli-1", code: "CLI-000001", name: "Vida Saudável Ltda", searchTerms: "" },
];

function abrirComBusca(termo: string) {
  render(
    <SearchableEntitySelect
      id="project-customer"
      value=""
      onChange={() => {}}
      options={CLIENTES}
      canCreate
      createLabel="Cadastrar novo cliente"
      onCreateNew={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: termo } });
  return input;
}

describe("Busca de cliente", () => {
  it("acha por razão social", () => {
    abrirComBusca("THIAGO");
    expect(screen.getByRole("option", { name: /THIAGO LUZ DE SOUZA/ })).toBeTruthy();
  });

  it("acha por nome fantasia", () => {
    abrirComBusca("THE KING");
    expect(screen.getByRole("option", { name: /THIAGO LUZ DE SOUZA/ })).toBeTruthy();
  });

  it("acha por CNPJ com pontuação", () => {
    abrirComBusca("35.301");
    expect(screen.getByRole("option", { name: /THIAGO LUZ DE SOUZA/ })).toBeTruthy();
  });

  it("acha por CNPJ sem pontuação", () => {
    // Ninguém digita a máscara ao conferir uma nota fiscal.
    abrirComBusca("35301394");
    expect(screen.getByRole("option", { name: /THIAGO LUZ DE SOUZA/ })).toBeTruthy();
  });

  it("sem correspondência, continua oferecendo o cadastro", () => {
    abrirComBusca("Fornecedor Que Não Existe");
    expect(screen.queryByRole("option", { name: /THIAGO/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Cadastrar novo cliente/ })).toBeTruthy();
  });

  /*
   * A ação de cadastrar encabeça a lista mesmo havendo correspondência: no
   * fim dela, com dez resultados, ficava abaixo da dobra do popover e quem
   * não achava o cliente concluía que não dava para criar.
   *
   * A proteção contra duplicata mudou de lugar em vez de sumir — é o teste
   * seguinte que a guarda: o item ATIVO continua sendo o primeiro resultado,
   * então Enter escolhe e nunca cria.
   */
  it("o cadastro encabeça a lista, mesmo com resultado", () => {
    abrirComBusca("THE KING");
    const opcoes = screen.getAllByRole("option").map((node) => node.textContent ?? "");
    expect(opcoes[0]).toContain("Cadastrar novo cliente");
    expect(opcoes[1]).toContain("THIAGO LUZ DE SOUZA");
  });

  it("o item ativo é o primeiro resultado — Enter escolhe, não cria", () => {
    abrirComBusca("THE KING");
    const ativo = document.querySelector(".entity-select__option.is-active");
    expect(ativo?.textContent).toContain("THIAGO LUZ DE SOUZA");
    expect(ativo?.className).not.toContain("entity-select__create");
  });

  it("busca por código continua funcionando", () => {
    abrirComBusca("CLI-000001");
    expect(screen.getByRole("option", { name: /Vida Saudável/ })).toBeTruthy();
  });
});
