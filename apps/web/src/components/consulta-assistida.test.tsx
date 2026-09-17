import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntityOption } from "./SearchableEntitySelect";
import { SearchableEntitySelect } from "./SearchableEntitySelect";
import type {
  EntityConsultationColumn,
  EntityConsultationPage,
  EntityConsultationQuery,
} from "./EntityConsultationDialog";
import { EntityConsultationDialog } from "./EntityConsultationDialog";
import { FullWorkspaceModal } from "./FullWorkspaceModal";

/**
 * ASSISTED-ENTITY-SELECTOR-FOUNDATION-01 — a fundação da consulta assistida.
 *
 * Duas peças: a ação "Consultar" no seletor, que só existe quando o campo a
 * pede, e o diálogo que consulta o servidor página a página e devolve o
 * escolhido. O piloto (Item na bancada) prova o recorte e a volta à linha; aqui
 * fica o contrato que qualquer seletor futuro herda.
 */

const OPCOES: EntityOption[] = [
  { id: "mp-1", code: "MP-000001", name: "Riboflavina" },
  { id: "mp-2", code: "MP-000002", name: "Cafeína anidra" },
];

function lista(): HTMLElement | null {
  const listas = document.querySelectorAll("ul[role='listbox']");
  return (listas[listas.length - 1] as HTMLElement | undefined) ?? null;
}

function opcoesDaLista(): HTMLElement[] {
  const aberta = lista();
  expect(aberta, "lista do seletor não está aberta").not.toBeNull();
  return within(aberta!).getAllByRole("option");
}

describe("seletor — a ação Consultar é opt-in", () => {
  it("sem onConsult, a lista é a de sempre: nada de Consultar", () => {
    render(
      <SearchableEntitySelect id="campo" value="" onChange={() => {}} options={OPCOES} />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(opcoesDaLista().map((opcao) => opcao.textContent)).toEqual([
      "MP-000001Riboflavina",
      "MP-000002Cafeína anidra",
    ]);
  });

  it("com onConsult, Consultar encabeça a lista, antes do cadastro e dos resultados", () => {
    render(
      <SearchableEntitySelect
        id="campo"
        value=""
        onChange={() => {}}
        options={OPCOES}
        canCreate
        createLabel="Novo item de estoque"
        onCreateNew={() => {}}
        consultLabel="Consultar itens"
        onConsult={() => {}}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    const textos = opcoesDaLista().map((opcao) => opcao.textContent);
    expect(textos[0]).toBe("Consultar itens");
    expect(textos[1]).toBe("+ Novo item de estoque");
    expect(textos.slice(2)).toEqual(["MP-000001Riboflavina", "MP-000002Cafeína anidra"]);
  });

  it("o autocomplete continua: digitar filtra e Enter escolhe o primeiro RESULTADO", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onConsult = vi.fn();
    render(
      <SearchableEntitySelect
        id="campo"
        value=""
        onChange={onChange}
        options={OPCOES}
        consultLabel="Consultar itens"
        onConsult={onConsult}
      />,
    );
    await user.type(screen.getByRole("combobox"), "cafe");
    expect(opcoesDaLista().map((opcao) => opcao.textContent)).toEqual([
      "Consultar itens",
      "MP-000002Cafeína anidra",
    ]);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("mp-2");
    expect(onConsult).not.toHaveBeenCalled();
  });

  it("clicar em Consultar entrega o termo digitado, fecha a lista e limpa o campo", async () => {
    const user = userEvent.setup();
    const onConsult = vi.fn();
    render(
      <SearchableEntitySelect
        id="campo"
        value=""
        onChange={() => {}}
        options={OPCOES}
        consultLabel="Consultar itens"
        onConsult={onConsult}
      />,
    );
    const campo = screen.getByRole("combobox");
    await user.type(campo, "ribof");
    await user.click(within(lista()!).getByRole("option", { name: "Consultar itens" }));

    expect(onConsult).toHaveBeenCalledWith("ribof");
    expect(lista()).toBeNull();
    expect(campo).toHaveValue("");
  });

  it("sem resultado, Enter abre a consulta — não o cadastro de um duplicado", async () => {
    const user = userEvent.setup();
    const onConsult = vi.fn();
    const onCreateNew = vi.fn();
    render(
      <SearchableEntitySelect
        id="campo"
        value=""
        onChange={() => {}}
        options={OPCOES}
        canCreate
        createLabel="Novo item de estoque"
        onCreateNew={onCreateNew}
        consultLabel="Consultar itens"
        onConsult={onConsult}
      />,
    );
    await user.type(screen.getByRole("combobox"), "taurina");
    await user.keyboard("{Enter}");
    expect(onConsult).toHaveBeenCalledWith("taurina");
    expect(onCreateNew).not.toHaveBeenCalled();
  });

  it("o cadastro continua alcançável pela seta, logo depois de Consultar", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();
    render(
      <SearchableEntitySelect
        id="campo"
        value=""
        onChange={() => {}}
        options={OPCOES}
        canCreate
        createLabel="Novo item de estoque"
        onCreateNew={onCreateNew}
        consultLabel="Consultar itens"
        onConsult={() => {}}
      />,
    );
    await user.type(screen.getByRole("combobox"), "taurina");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onCreateNew).toHaveBeenCalledWith("taurina");
  });

  it("o foco que a consulta devolve ao fechar não reabre a lista; o gesto seguinte reabre", async () => {
    const user = userEvent.setup();

    function Hospedeiro() {
      const [consultando, setConsultando] = useState(false);
      const [valor, setValor] = useState("");
      return (
        <>
          <SearchableEntitySelect
            id="campo"
            value={valor}
            onChange={setValor}
            options={OPCOES}
            consultLabel="Consultar itens"
            onConsult={() => setConsultando(true)}
          />
          {consultando && (
            <FullWorkspaceModal
              open
              onClose={() => setConsultando(false)}
              crumb="Formulação"
              crumbActive="Consulta de itens"
              title="Consulta de itens"
              footer={null}
            >
              <button type="button" onClick={() => setConsultando(false)}>
                Desistir
              </button>
            </FullWorkspaceModal>
          )}
        </>
      );
    }

    render(<Hospedeiro />);
    const campo = screen.getByRole("combobox");
    await user.click(campo);
    await user.click(within(lista()!).getByRole("option", { name: "Consultar itens" }));
    await user.click(await screen.findByRole("button", { name: "Desistir" }));

    // O modal devolve o foco ao campo — e a lista não volta por cima da tela.
    await waitFor(() => expect(campo).toHaveFocus());
    expect(lista()).toBeNull();

    // Sair e voltar ao campo é gesto da pessoa: aí a lista abre.
    act(() => campo.blur());
    act(() => campo.focus());
    expect(lista()).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * O diálogo da consulta.
 * ------------------------------------------------------------------ */

interface Registro {
  id: string;
  code: string;
  name: string;
  bloqueado?: boolean;
}

const COLUNAS: EntityConsultationColumn<Registro>[] = [
  { header: "Código", kind: "code", cell: (registro) => registro.code },
  { header: "Nome", kind: "flex", cell: (registro) => registro.name },
  { header: "Unidade", cell: () => "kg" },
];

function registros(de: number, ate: number): Registro[] {
  return Array.from({ length: ate - de + 1 }, (_, indice) => {
    const numero = String(de + indice).padStart(6, "0");
    return { id: `r-${numero}`, code: `MP-${numero}`, name: `Matéria ${numero}` };
  });
}

function abrirDialogo(
  fetchPage: (consulta: EntityConsultationQuery) => Promise<EntityConsultationPage<Registro>>,
  props: Partial<Parameters<typeof EntityConsultationDialog<Registro>>[0]> = {},
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <EntityConsultationDialog<Registro>
      title="Consulta de itens"
      crumb="Formulação"
      searchLabel="Buscar itens"
      searchPlaceholder="Buscar por código ou nome…"
      initialTerm=""
      scope={["Tipo: Matéria-prima", "Situação: somente ativos"]}
      fetchPage={fetchPage}
      recordKey={(registro) => registro.id}
      recordLabel={(registro) => `${registro.code} · ${registro.name}`}
      columns={COLUNAS}
      unavailableReason={(registro) => (registro.bloqueado ? "Já está em outra linha." : null)}
      onSelect={onSelect}
      onClose={onClose}
      emptyMessage="Nenhum item encontrado."
      countLabel={(total) => `${total} itens`}
      fallbackError="Falha ao consultar itens"
      footerNote="Selecionar põe o item na linha."
      {...props}
    />,
  );
  return { onSelect, onClose };
}

describe("diálogo da consulta assistida", () => {
  it("abre já procurando pelo termo trazido, com o foco no campo e o recorte à vista", async () => {
    const fetchPage = vi.fn(async () => ({ records: registros(1, 2), total: 2 }));
    abrirDialogo(fetchPage, { initialTerm: "ribof" });

    const busca = screen.getByRole("searchbox", { name: "Buscar itens" });
    expect(busca).toHaveValue("ribof");
    expect(busca).toHaveFocus();
    // A primeira consulta sai com o termo, sem esperar a pausa da digitação.
    expect(fetchPage).toHaveBeenCalledWith({ term: "ribof", page: 1, pageSize: 20 });
    expect(screen.getByText("Tipo: Matéria-prima")).toBeInTheDocument();
    expect(screen.getByText("Situação: somente ativos")).toBeInTheDocument();
    expect(await screen.findByText("MP-000001")).toBeInTheDocument();
  });

  it("digitar consulta o servidor de novo, na página 1", async () => {
    const user = userEvent.setup();
    const fetchPage = vi.fn(async () => ({ records: registros(1, 2), total: 2 }));
    abrirDialogo(fetchPage);
    await screen.findByText("MP-000001");

    await user.type(screen.getByRole("searchbox"), "cafe");
    await waitFor(() =>
      expect(fetchPage).toHaveBeenLastCalledWith({ term: "cafe", page: 1, pageSize: 20 }),
    );
  });

  it("pagina no servidor e preserva termo e tamanho da página", async () => {
    const user = userEvent.setup();
    const fetchPage = vi.fn(async ({ page }: EntityConsultationQuery) => ({
      records: page === 1 ? registros(1, 20) : registros(21, 40),
      total: 45,
    }));
    abrirDialogo(fetchPage, { initialTerm: "matéria" });

    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByText("45 itens")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Próxima" }));

    await waitFor(() =>
      expect(fetchPage).toHaveBeenLastCalledWith({ term: "matéria", page: 2, pageSize: 20 }),
    );
    expect(await screen.findByText("MP-000021")).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });

  it("vazio diz que não achou — não uma tabela muda", async () => {
    abrirDialogo(async () => ({ records: [], total: 0 }));
    expect(await screen.findByText("Nenhum item encontrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Selecionar/ })).toBeNull();
  });

  it("falha diz o que houve e tenta de novo", async () => {
    const user = userEvent.setup();
    const fetchPage = vi
      .fn<(consulta: EntityConsultationQuery) => Promise<EntityConsultationPage<Registro>>>()
      .mockRejectedValueOnce(new Error("Servidor indisponível"))
      .mockResolvedValue({ records: registros(1, 1), total: 1 });
    abrirDialogo(fetchPage);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Servidor indisponível");
    // Falha não é vazio: a frase de "não encontrado" seria resposta que o
    // servidor não deu.
    expect(screen.queryByText("Nenhum item encontrado.")).toBeNull();

    await user.click(within(alerta).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("MP-000001")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Selecionar devolve o registro; a linha que o campo recusa aparece desabilitada, com o motivo", async () => {
    const user = userEvent.setup();
    const [livre, bloqueado] = registros(1, 2);
    const { onSelect } = abrirDialogo(async () => ({
      records: [livre!, { ...bloqueado!, bloqueado: true }],
      total: 2,
    }));

    const recusado = await screen.findByRole("button", {
      name: "Selecionar MP-000002 · Matéria 000002",
    });
    expect(recusado).toBeDisabled();
    expect(screen.getByText("Já está em outra linha.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Selecionar MP-000001 · Matéria 000001" }));
    expect(onSelect).toHaveBeenCalledWith(livre);
  });

  it("criar só aparece quando o perfil cria, e leva o termo digitado", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    abrirDialogo(async () => ({ records: [], total: 0 }), {
      initialTerm: "taurina",
      create: { label: "Novo item de estoque", onCreate },
    });
    await user.click(screen.getByRole("button", { name: "+ Novo item de estoque" }));
    expect(onCreate).toHaveBeenCalledWith("taurina");
  });

  it("sem create, não há botão de cadastro", async () => {
    abrirDialogo(async () => ({ records: [], total: 0 }));
    await screen.findByText("Nenhum item encontrado.");
    expect(screen.queryByRole("button", { name: /Novo/ })).toBeNull();
  });

  it("Escape fecha só a consulta, mesmo aberta por cima de outro modal", async () => {
    const user = userEvent.setup();
    const fecharOrigem = vi.fn();

    function OrigemModal() {
      const [consultando, setConsultando] = useState(false);
      return (
        <FullWorkspaceModal
          open
          onClose={fecharOrigem}
          crumb="Compras"
          crumbActive="Nova relação"
          title="Nova relação"
          footer={null}
        >
          <p>Formulário de origem</p>
          <button type="button" onClick={() => setConsultando(true)}>
            Consultar itens
          </button>
          {consultando && (
            <EntityConsultationDialog<Registro>
              title="Consulta de itens"
              crumb="Nova relação"
              searchLabel="Buscar itens"
              searchPlaceholder="Buscar…"
              initialTerm=""
              scope={[]}
              fetchPage={async () => ({ records: registros(1, 1), total: 1 })}
              recordKey={(registro) => registro.id}
              recordLabel={(registro) => registro.code}
              columns={COLUNAS}
              onSelect={() => setConsultando(false)}
              onClose={() => setConsultando(false)}
              emptyMessage="Nenhum item encontrado."
              countLabel={(total) => `${total} itens`}
              fallbackError="Falha"
              footerNote="Selecionar põe o item na relação."
            />
          )}
        </FullWorkspaceModal>
      );
    }

    render(<OrigemModal />);
    // A origem já está aberta quando a consulta abre por cima — a ordem real.
    await user.click(screen.getByRole("button", { name: "Consultar itens" }));
    await screen.findByRole("button", { name: "Selecionar MP-000001" });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    expect(fecharOrigem).not.toHaveBeenCalled();
    expect(screen.getByText("Formulário de origem")).toBeInTheDocument();
    // A origem ainda é modal: a rolagem do fundo continua presa.
    expect(document.body.style.overflow).toBe("hidden");
  });
});

/* ------------------------------------------------------------------ *
 * 390px — estrutura e regra (jsdom não faz layout).
 * ------------------------------------------------------------------ */

const folha = () =>
  readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");

describe("consulta assistida em 390px", () => {
  it("cada registro vira cartão: sem cabeçalho à vista, Selecionar na largura toda com alvo de dedo", () => {
    const css = folha();
    const inicio = css.indexOf("@media (max-width: 640px) {\n  .table--consulta thead {");
    expect(inicio, "bloco de 640px da consulta").toBeGreaterThanOrEqual(0);
    const bloco = css.slice(inicio, css.indexOf("\n}\n", inicio));

    expect(bloco).toMatch(/\.table--consulta thead \{[^}]*clip-path: inset\(50%\);/);
    expect(bloco).toMatch(/\.table--consulta,\n\s*\.table--consulta tbody \{[^}]*display: block;[^}]*width: 100%;/);
    expect(bloco).toMatch(/\.table--consulta tr \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
    // Nome quebra linha e não impõe largura mínima que empurre o cartão.
    expect(bloco).toMatch(/\.table--consulta td\.col-flex \{[^}]*min-width: 0;/);
    // Tipo, unidade e situação levam o nome da coluna, já que o cabeçalho sai.
    expect(bloco).toMatch(/content: attr\(data-label\) ": ";/);
    expect(bloco).toMatch(/\.table--consulta td\.col-acao \{[^}]*flex: 1 1 100%;/);
    expect(bloco).toMatch(/\.table--consulta td\.col-acao \.btn \{[^}]*width: 100%;[^}]*min-height: 44px;/);
  });

  it("a linha leva o rótulo de cada coluna e o botão de Selecionar, sem largura fixa", async () => {
    abrirDialogo(async () => ({ records: registros(1, 1), total: 1 }));
    const codigo = await screen.findByText("MP-000001");
    const linha = codigo.closest("tr")!;
    const celulas = Array.from(linha.querySelectorAll("td"));
    expect(celulas.map((celula) => celula.getAttribute("data-label"))).toEqual([
      "Código",
      "Nome",
      "Unidade",
      null,
    ]);
    expect(within(linha).getByRole("button", { name: /^Selecionar/ })).toBeInTheDocument();
    const tabela = linha.closest("table")!;
    expect(tabela).toHaveClass("table--consulta");
    expect(tabela.getAttribute("style")).toBeNull();
  });
});
