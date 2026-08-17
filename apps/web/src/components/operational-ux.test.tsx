import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AttentionItemDTO } from "@veridi/shared";
import { ATTENTION_LIST_PATH } from "@veridi/shared";
import { FlowContext } from "./FlowContext";
import { RowActions } from "./RowActions";
import { SearchableEntitySelect } from "./SearchableEntitySelect";
import { clearStoredFilters, usePersistentFilter } from "../lib/stored-filters";

/**
 * UX operacional: o que estes testes protegem é comportamento, não pixels.
 * Ação destrutiva não pode voltar a ser botão fixo de tabela, filtro não
 * pode sumir ao navegar, e etapa inexistente não pode aparecer como
 * documento.
 */

afterEach(() => {
  sessionStorage.clear();
});

describe("Ações de linha", () => {
  it("mantém a ação principal visível e a destrutiva no menu", () => {
    const inactivate = vi.fn();
    render(
      <RowActions actions={[{ label: "Inativar", destructive: true, onSelect: inactivate }]}>
        <button type="button">Editar</button>
      </RowActions>,
    );

    // Trabalho do dia a dia continua a um clique.
    expect(screen.getByText("Editar")).toBeTruthy();
    // Inativar não fica exposto como botão vermelho permanente.
    expect(screen.queryByText("Inativar")).toBeNull();

    fireEvent.click(screen.getByLabelText("Mais ações"));
    fireEvent.click(screen.getByText("Inativar"));
    expect(inactivate).toHaveBeenCalledTimes(1);
  });

  it("abre com Enter, fecha com Escape e devolve o foco ao gatilho", () => {
    // O menu vive dentro de uma linha de tabela que também trata Enter; a
    // correção não pode engolir o Escape junto.
    const rowEnter = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <table>
        <tbody>
          <tr onKeyDown={(event) => event.key === "Enter" && rowEnter()}>
            <td>
              <RowActions actions={[{ label: "Inativar", onSelect: vi.fn() }]} />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    const toggle = screen.getByLabelText("Mais ações");
    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);
    expect(screen.getByRole("menu")).toBeTruthy();
    // Enter no menu não pode acionar a linha da tabela.
    expect(rowEnter).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("não renderiza o menu quando não há ação secundária", () => {
    render(
      <RowActions actions={[{ label: "Inativar", onSelect: vi.fn(), disabled: true }]}>
        <button type="button">Abrir</button>
      </RowActions>,
    );
    expect(screen.queryByLabelText("Mais ações")).toBeNull();
  });
});

describe("Seleção de entidade com busca", () => {
  it("filtra por código ou nome, ignora acento e escolhe pelo teclado", async () => {
    const options = [
      { id: "1", code: "MP-000245", name: "Vitamina C" },
      { id: "2", code: "MP-000801", name: "Óxido de magnésio" },
      { id: "3", code: "ME-000110", name: "Pote 200 g" },
    ];
    const onChange = vi.fn();
    render(
      <SearchableEntitySelect id="item" options={options} value="" onChange={onChange} />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // Sem acento: quem digita rápido não acentua.
    fireEvent.change(input, { target: { value: "oxido" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    // Por código também.
    fireEvent.change(input, { target: { value: "ME-000110" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("fecha com Escape sem alterar a seleção", () => {
    const onChange = vi.fn();
    render(
      <SearchableEntitySelect
        id="item"
        options={[{ id: "1", code: "MP-000245", name: "Vitamina C" }]}
        value="1"
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Fluxo do documento", () => {
  it("mostra só os documentos existentes e liga os anteriores", () => {
    render(
      <MemoryRouter>
        <FlowContext
          steps={[
            { kind: "Pedido", code: "PED-000045", path: "/comercial/pedidos/1" },
            { kind: "Expedição", code: "EXP-000009", current: true },
          ]}
        />
      </MemoryRouter>,
    );

    const link = screen.getByText("PED-000045").closest("a");
    expect(link?.getAttribute("href")).toBe("/comercial/pedidos/1");
    // O documento aberto não vira link para ele mesmo.
    expect(screen.getByText("EXP-000009").closest("a")).toBeNull();
    // Faturamento inexistente NÃO aparece como etapa pendente.
    expect(screen.queryByText("Faturamento")).toBeNull();
  });

  it("não renderiza nada quando não há cadeia", () => {
    const { container } = render(
      <MemoryRouter>
        <FlowContext steps={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".flow-context")).toBeNull();
  });
});

describe("Filtros persistentes", () => {
  it("lembra o filtro na sessão e volta ao padrão ao limpar", () => {
    const { result, unmount } = renderHook(() =>
      usePersistentFilter("user-1", "lots", "status", "all"),
    );

    act(() => result.current[1]("BLOCKED"));
    expect(sessionStorage.getItem("veridi:filters:user-1:lots:status")).toBe('"BLOCKED"');
    unmount();

    // Voltar para a tela recupera o recorte.
    const again = renderHook(() => usePersistentFilter("user-1", "lots", "status", "all"));
    expect(again.result.current[0]).toBe("BLOCKED");

    clearStoredFilters("user-1", "lots");
    expect(sessionStorage.getItem("veridi:filters:user-1:lots:status")).toBeNull();
  });

  it("isola o filtro por usuário", () => {
    const first = renderHook(() => usePersistentFilter("user-1", "projects", "search", ""));
    act(() => first.result.current[1]("detox"));

    const second = renderHook(() => usePersistentFilter("user-2", "projects", "search", ""));
    expect(second.result.current[0]).toBe("");
  });
});

describe("Atenções do dashboard", () => {
  it("tem destino de lista para cada tipo de atenção", () => {
    const types: AttentionItemDTO["type"][] = [
      "LOT_EXPIRED",
      "LOT_BLOCKED",
      "LOT_AWAITING_QUALITY",
      "LOT_NEAR_EXPIRY",
      "PRODUCTION_ORDER_SHORTAGE",
      "PURCHASE_ORDER_LATE",
      "ORDER_AWAITING_PRODUCTION",
      "ORDER_AWAITING_SHIPMENT",
      "SHIPMENT_AWAITING_BILLING",
      "PRODUCTION_ORDER_INCOMPLETE_COST",
    ];

    for (const type of types) {
      // "Ver todos" precisa levar a algum lugar útil — grupo sem destino
      // seria um beco sem saída no cockpit.
      expect(ATTENTION_LIST_PATH[type].startsWith("/")).toBe(true);
    }
  });
});
