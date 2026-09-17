import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  EntityConsultationBaseProps,
  EntityConsultationColumn,
  EntityConsultationMultipleSelection,
  EntityConsultationPage,
  EntityConsultationQuery,
} from "./EntityConsultationDialog";
import { EntityConsultationDialog } from "./EntityConsultationDialog";
import { FullWorkspaceModal } from "./FullWorkspaceModal";

/**
 * ASSISTED-ENTITY-MULTISELECT-01 — a consulta assistida com VÁRIAS escolhas.
 *
 * O contrato que qualquer tela que monta lista herda: caixa por registro,
 * marcação que atravessa busca, página e recarga, teto de 10 dito em vez de
 * cortado, uma confirmação que devolve o lote inteiro, cancelar sem efeito, o
 * que o campo recusa à vista e travado, e a seleção única intacta.
 */

interface Registro {
  id: string;
  code: string;
  name: string;
  lote: string;
  bloqueado?: boolean;
}

/** 45 registros em três famílias de nome: cada busca acha 15. */
const UNIVERSO: Registro[] = Array.from({ length: 45 }, (_, indice) => {
  const numero = indice + 1;
  const familia = numero <= 15 ? "Riboflavina" : numero <= 30 ? "Cafeína" : "Taurina";
  return {
    id: `r-${numero}`,
    code: `MP-${String(numero).padStart(6, "0")}`,
    name: `${familia} ${String(numero).padStart(2, "0")}`,
    lote: `Lote técnico ${numero}`,
  };
});

function servidor({ term, page, pageSize }: EntityConsultationQuery): Promise<EntityConsultationPage<Registro>> {
  const termo = term.toLowerCase();
  const achados = UNIVERSO.filter((registro) =>
    `${registro.code} ${registro.name}`.toLowerCase().includes(termo),
  );
  return Promise.resolve({
    records: achados.slice((page - 1) * pageSize, page * pageSize),
    total: achados.length,
  });
}

const COLUNAS: EntityConsultationColumn<Registro>[] = [
  { header: "Código", kind: "code", cell: (registro) => registro.code },
  { header: "Nome", kind: "flex", cell: (registro) => registro.name },
  { header: "Detalhe técnico", kind: "detail", cell: (registro) => registro.lote },
  { header: "Unidade", cell: () => "kg" },
  { header: "Situação", kind: "status", cell: () => "Ativo" },
];

const BASE: EntityConsultationBaseProps<Registro> = {
  title: "Consulta de itens",
  crumb: "Formulação",
  searchLabel: "Buscar itens",
  searchPlaceholder: "Buscar por código ou nome…",
  initialTerm: "",
  scope: ["Tipo: Matéria-prima", "Situação: somente ativos"],
  fetchPage: servidor,
  recordKey: (registro) => registro.id,
  recordLabel: (registro) => `${registro.code} · ${registro.name}`,
  columns: COLUNAS,
  unavailableReason: (registro) => (registro.bloqueado ? "Já adicionado nesta formulação." : null),
  onClose: () => {},
  emptyMessage: "Nenhum item encontrado.",
  countLabel: (total) => `${total} itens`,
  fallbackError: "Falha ao consultar itens",
  footerNote: "Adicionar cria uma linha para cada item marcado.",
};

type Multipla = Omit<EntityConsultationMultipleSelection<Registro>, "selectionMode" | "onSelectMany" | "recordNoun">;

function abrirMultipla(
  props: Partial<EntityConsultationBaseProps<Registro>> & Multipla = {},
) {
  const onSelectMany = vi.fn();
  const onClose = vi.fn();
  render(
    <EntityConsultationDialog<Registro>
      {...BASE}
      onClose={onClose}
      selectionMode="multiple"
      onSelectMany={onSelectMany}
      recordNoun={{ singular: "item", plural: "itens" }}
      {...props}
    />,
  );
  return { onSelectMany, onClose };
}

const caixa = (codigo: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const achaCaixa = (codigo: string) =>
  screen.findByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const codigo = (numero: number) => `MP-${String(numero).padStart(6, "0")}`;
const codigosDe = (chamada: unknown) => (chamada as Registro[]).map((registro) => registro.code);

/**
 * Busca e espera a resposta DELA: a tabela troca quando o registro da busca
 * anterior sai — a página velha continua à vista até a nova chegar.
 */
async function buscar(
  user: ReturnType<typeof userEvent.setup>,
  termo: string,
  presente: number,
  ausente: number,
) {
  const campo = screen.getByRole("searchbox", { name: "Buscar itens" });
  await user.clear(campo);
  if (termo) await user.type(campo, termo);
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo(ausente)} `) })).toBeNull(),
  );
  await achaCaixa(codigo(presente));
}

describe("seleção única — continua igual", () => {
  it("sem caixa de marcar, Selecionar por linha, rodapé Fechar e nenhum contador", async () => {
    const onSelect = vi.fn();
    render(<EntityConsultationDialog<Registro> {...BASE} onSelect={onSelect} />);

    const botao = await screen.findByRole("button", { name: `Selecionar ${codigo(1)} · Riboflavina 01` });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/selecionad/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Adicionar/ })).toBeNull();
    // ✕ do cabeçalho e o Fechar do rodapé.
    expect(screen.getAllByRole("button", { name: "Fechar" })).toHaveLength(2);

    fireEvent.click(botao);
    expect(onSelect).toHaveBeenCalledWith(UNIVERSO[0]);
  });
});

describe("seleção múltipla", () => {
  it("caixa por registro, marca e desmarca, e o contador e o botão acompanham", async () => {
    const user = userEvent.setup();
    abrirMultipla();
    await achaCaixa(codigo(1));

    expect(screen.queryAllByRole("button", { name: /^Selecionar/ })).toHaveLength(0);
    expect(screen.getByText("Nenhum item selecionado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar itens" })).toBeDisabled();

    await user.click(caixa(codigo(1)));
    expect(caixa(codigo(1))).toBeChecked();
    expect(screen.getByText("1 item selecionado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 1 item" })).toBeEnabled();

    await user.click(caixa(codigo(2)));
    expect(screen.getByText("2 itens selecionados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 2 itens" })).toBeEnabled();

    await user.click(caixa(codigo(1)));
    expect(caixa(codigo(1))).not.toBeChecked();
    expect(screen.getByText("1 item selecionado")).toBeInTheDocument();
  });

  it("a marcação atravessa buscas: 3 numa, 2 noutra, 1 numa terceira — Adicionar 6 itens devolve os 6, na ordem", async () => {
    const user = userEvent.setup();
    const { onSelectMany } = abrirMultipla();
    await achaCaixa(codigo(1));

    await buscar(user, "ribo", 1, 16);
    for (const numero of [1, 2, 3]) await user.click(caixa(codigo(numero)));
    await buscar(user, "cafe", 16, 1);
    // A busca nova não mostra os marcados — e não os esquece.
    expect(screen.getByText("3 itens selecionados")).toBeInTheDocument();
    for (const numero of [16, 17]) await user.click(caixa(codigo(numero)));
    await buscar(user, "taur", 31, 16);
    await user.click(caixa(codigo(31)));
    expect(screen.getByText("6 itens selecionados")).toBeInTheDocument();

    // Busca limpa: os da primeira busca voltam à vista, ainda marcados.
    await buscar(user, "", 1, 31);
    expect(caixa(codigo(1))).toBeChecked();
    expect(caixa(codigo(4))).not.toBeChecked();
    expect(caixa(codigo(16))).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Adicionar 6 itens" }));
    expect(onSelectMany).toHaveBeenCalledTimes(1);
    expect(codigosDe(onSelectMany.mock.calls[0]![0])).toEqual(
      [1, 2, 3, 16, 17, 31].map(codigo),
    );
  });

  it("a marcação atravessa páginas e recarga: marcar na 1 e na 2, voltar à 1 continua marcado", async () => {
    const user = userEvent.setup();
    const fetchPage = vi.fn(servidor);
    abrirMultipla({ fetchPage });
    await achaCaixa(codigo(1));

    await user.click(caixa(codigo(1)));
    await user.click(caixa(codigo(20)));

    // A página 2 falha uma vez: tentar de novo recarrega, e a marcação fica.
    fetchPage.mockRejectedValueOnce(new Error("Servidor indisponível"));
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    const alerta = await screen.findByRole("alert");
    await user.click(within(alerta).getByRole("button", { name: "Tentar de novo" }));
    await user.click(await achaCaixa(codigo(21)));
    expect(screen.getByText("3 itens selecionados")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(await achaCaixa(codigo(1))).toBeChecked();
    expect(caixa(codigo(20))).toBeChecked();
    expect(caixa(codigo(2))).not.toBeChecked();
    expect(screen.getByText("3 itens selecionados")).toBeInTheDocument();
    // Paginação continua no servidor: nenhuma pergunta maior que a página.
    expect(fetchPage.mock.calls.every(([consulta]) => consulta.pageSize === 20)).toBe(true);
  });

  it("teto de 10: a 11ª caixa não marca, e o rodapé diz por quê — nada é cortado em silêncio", async () => {
    const user = userEvent.setup();
    const { onSelectMany } = abrirMultipla();
    await achaCaixa(codigo(1));

    for (let numero = 1; numero <= 10; numero += 1) await user.click(caixa(codigo(numero)));
    expect(screen.getByText("10 itens selecionados")).toBeInTheDocument();
    const aviso = "Você pode adicionar até 10 itens por vez.";
    expect(screen.getByText(aviso)).toBeInTheDocument();

    const decima = caixa(codigo(11));
    expect(decima).toBeDisabled();
    expect(decima).toHaveAccessibleDescription(aviso);
    fireEvent.click(decima);
    expect(decima).not.toBeChecked();
    expect(screen.getByText("10 itens selecionados")).toBeInTheDocument();
    // As já marcadas continuam desmarcáveis.
    expect(caixa(codigo(10))).toBeEnabled();

    // Desmarcar abre a vaga: o aviso sai e a 11ª marca.
    await user.click(caixa(codigo(10)));
    expect(screen.queryByText(aviso)).toBeNull();
    await user.click(caixa(codigo(11)));
    expect(screen.getByText("10 itens selecionados")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adicionar 10 itens" }));
    expect(codigosDe(onSelectMany.mock.calls[0]![0])).toHaveLength(10);
  });

  it("maxSelection nunca passa de 10, e um teto menor vale como teto", async () => {
    const user = userEvent.setup();
    abrirMultipla({ maxSelection: 2 });
    await achaCaixa(codigo(1));
    await user.click(caixa(codigo(1)));
    await user.click(caixa(codigo(2)));
    expect(screen.getByText("Você pode adicionar até 2 itens por vez.")).toBeInTheDocument();
    expect(caixa(codigo(3))).toBeDisabled();
  });

  it("maxSelection acima de 10 continua 10", async () => {
    const user = userEvent.setup();
    abrirMultipla({ maxSelection: 25 });
    await achaCaixa(codigo(1));
    for (let numero = 1; numero <= 10; numero += 1) await user.click(caixa(codigo(numero)));
    expect(caixa(codigo(11))).toBeDisabled();
  });

  it("Adicionar devolve o lote UMA vez, mesmo com clique repetido", async () => {
    const user = userEvent.setup();
    const { onSelectMany, onClose } = abrirMultipla();
    await achaCaixa(codigo(1));
    await user.click(caixa(codigo(1)));
    await user.click(caixa(codigo(2)));

    const adicionar = screen.getByRole("button", { name: "Adicionar 2 itens" });
    await user.click(adicionar);
    await user.click(adicionar);
    expect(onSelectMany).toHaveBeenCalledTimes(1);
    expect(codigosDe(onSelectMany.mock.calls[0]![0])).toEqual([codigo(1), codigo(2)]);
    // Fechar é da origem, ao receber o lote — a consulta não fecha por conta.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancelar e Escape fecham sem devolver nada", async () => {
    const user = userEvent.setup();
    const { onSelectMany, onClose } = abrirMultipla();
    await achaCaixa(codigo(1));
    await user.click(caixa(codigo(1)));

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelectMany).not.toHaveBeenCalled();
  });

  it("o que o campo recusa aparece, com a caixa travada e o motivo ligado a ela", async () => {
    const user = userEvent.setup();
    abrirMultipla({
      fetchPage: async () => ({
        records: [UNIVERSO[0]!, { ...UNIVERSO[1]!, bloqueado: true }],
        total: 2,
      }),
    });
    const recusada = await achaCaixa(codigo(2));
    expect(recusada).toBeDisabled();
    expect(recusada).toHaveAccessibleDescription("Já adicionado nesta formulação.");
    expect(screen.getByText("Já adicionado nesta formulação.")).toBeInTheDocument();
    fireEvent.click(recusada);
    expect(recusada).not.toBeChecked();
    expect(screen.getByText("Nenhum item selecionado")).toBeInTheDocument();

    await user.click(caixa(codigo(1)));
    expect(screen.getByText("1 item selecionado")).toBeInTheDocument();
  });

  it("não oferece + Novo: a dica diz onde cadastrar, e sem dica não há nada", async () => {
    abrirMultipla({ createHint: "Para cadastrar um novo item, use o cadastro individual." });
    await achaCaixa(codigo(1));
    expect(screen.getByText("Para cadastrar um novo item, use o cadastro individual.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo/ })).toBeNull();
  });

  it("Escape fecha só a consulta de cima, e o foco volta à ação que a abriu", async () => {
    const user = userEvent.setup();
    const fecharOrigem = vi.fn();
    const onSelectMany = vi.fn();

    function Origem() {
      const [consultando, setConsultando] = useState(false);
      return (
        <FullWorkspaceModal
          open
          onClose={fecharOrigem}
          crumb="Produção"
          crumbActive="Formulação"
          title="Formulação"
          footer={null}
        >
          <p>Receita de origem</p>
          <button type="button" onClick={() => setConsultando(true)}>
            + Adicionar matérias-primas
          </button>
          {consultando && (
            <EntityConsultationDialog<Registro>
              {...BASE}
              onClose={() => setConsultando(false)}
              selectionMode="multiple"
              onSelectMany={onSelectMany}
              recordNoun={{ singular: "item", plural: "itens" }}
            />
          )}
        </FullWorkspaceModal>
      );
    }

    render(<Origem />);
    const acao = screen.getByRole("button", { name: "+ Adicionar matérias-primas" });
    await user.click(acao);
    await achaCaixa(codigo(1));
    expect(screen.getByRole("searchbox", { name: "Buscar itens" })).toHaveFocus();

    // Teclado: Tab chega à caixa, espaço marca.
    caixa(codigo(1)).focus();
    await user.keyboard(" ");
    expect(caixa(codigo(1))).toBeChecked();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    expect(fecharOrigem).not.toHaveBeenCalled();
    expect(onSelectMany).not.toHaveBeenCalled();
    expect(screen.getByText("Receita de origem")).toBeInTheDocument();
    expect(acao).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("as colunas de contexto seguem à vista: a caixa abre a linha e não toma o lugar de nenhuma", async () => {
    abrirMultipla();
    const primeira = (await achaCaixa(codigo(1))).closest("tr")!;
    const celulas = Array.from(primeira.querySelectorAll("td"));

    expect(celulas.map((celula) => celula.getAttribute("data-label"))).toEqual([
      null,
      "Código",
      "Nome",
      "Detalhe técnico",
      "Unidade",
      "Situação",
      null,
    ]);
    expect(celulas[0]).toHaveClass("table__select--bulk");
    expect(celulas[0]!.textContent).toBe("");
    expect(celulas[3]).toHaveClass("col-detail");
    expect(celulas[3]).toHaveTextContent("Lote técnico 1");
    expect(celulas[5]).toHaveClass("col-status");
    // Linha que se marca não tem motivo: a última célula nasce vazia (e some no cartão).
    expect(celulas[6]!.childNodes).toHaveLength(0);
    expect(primeira.closest("table")!.getAttribute("style")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 390px — estrutura e regra (jsdom não faz layout).
 * ------------------------------------------------------------------ */

const folha = () =>
  readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");

describe("consulta múltipla em 390px", () => {
  it("cartão na ordem de decisão — caixa, código e nome, técnica, situação, o resto — sem largura mínima que empurre", () => {
    const css = folha();
    const inicio = css.indexOf("@media (max-width: 640px) {\n  .table--consulta thead {");
    expect(inicio, "bloco de 640px da consulta").toBeGreaterThanOrEqual(0);
    const bloco = css.slice(inicio, css.indexOf("\n}\n", inicio));

    // Técnica em linha própria, com o nome da coluna.
    expect(bloco).toMatch(/\.table--consulta td\.col-detail \{[^}]*flex: 1 1 100%;[^}]*min-width: 0;/);
    expect(bloco).toMatch(/\.table--consulta td\.col-detail::before \{[^}]*content: attr\(data-label\) ": ";/);
    // Situação antes dos demais valores; motivo por último, e vazio não ocupa.
    expect(bloco).toMatch(
      /\.table--consulta td\.col-tight:not\(\.is-code\):not\(\.col-acao\):not\(\.col-status\) \{[^}]*order: 1;/,
    );
    expect(bloco).toMatch(/\.table--consulta td\.col-acao \{[^}]*order: 2;/);
    expect(bloco).toMatch(/\.table--consulta td\.col-acao:empty \{[^}]*display: none;/);
    // Rodapé: contador em linha própria, botões abaixo.
    expect(bloco).toMatch(/\.modal-fullscreen__foot:has\(\.consulta-assistida__selecao\) \{[^}]*flex-wrap: wrap;/);
    expect(bloco).toMatch(/\.consulta-assistida__selecao \{[^}]*flex: 1 1 100%;/);
    // Nada força largura: é assim que não nasce rolagem horizontal.
    expect(bloco).not.toMatch(/min-width: [1-9]/);
    expect(bloco).not.toMatch(/(?<!min-|max-)width: \d+(px|rem)/);
  });
});
