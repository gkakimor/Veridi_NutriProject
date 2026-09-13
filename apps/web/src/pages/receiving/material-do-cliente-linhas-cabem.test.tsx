import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO } from "@veridi/shared";
import type { ListItemsParams } from "../../lib/items-api";

/**
 * Linhas do Receber material do cliente em 1440 (MOBILE-UX-CLEANUP-WAVE-01).
 *
 * CUSTOMER-MATERIAL-ITEM-CUTOFF-01 deixou registrado: em 1440 a tabela de
 * linhas ainda rolava 28px dentro do contêiner. Medido de novo no Chromium, com
 * a sidebar aberta (contêiner de 1088px): 28px vazia, 45px com a unidade do
 * item e 324px com o aviso de item sem controle de lote, que não quebrava
 * linha. O que saía da vista era o ✕ de remover a linha. Os campos de texto
 * tinham a largura nativa do navegador, ~180px cada.
 *
 * Depois: 0px nas três situações em 1440 e em 1280, ✕ à vista. O documento não
 * rolava de lado antes nem depois. Em 390px a tabela continua rolando dentro do
 * `.table-container` — seis campos lado a lado não cabem, e a regra não finge
 * que cabem.
 *
 * jsdom não faz layout: aqui fica a estrutura em que a regra se apoia (a
 * classe da tabela, campos filhos diretos da célula, aviso dentro da coluna do
 * item) e a própria regra. A medida em pixel é do smoke.
 */

vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/receiving-api", () => ({ createCustomerSuppliedReceipt: vi.fn() }));

import { listCustomers } from "../../lib/customers-api";
import { listItems } from "../../lib/items-api";
import { ReceiveCustomerMaterialPage } from "./ReceiveCustomerMaterialPage";

const ROTA = "/compras/recebimentos/material-do-cliente";

function item(id: string, code: string, name: string, controlsLot = true): ItemDTO {
  return {
    id,
    code,
    name,
    type: "PACKAGING",
    unitCode: "un",
    controlsLot,
    controlsExpiry: true,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
  } as unknown as ItemDTO;
}

const LONGO = item("me-78", "ME-000078", "ROT BLISS OMEGA EPA 500 DHA 200 60CAPS BLISS BOPP FOSCO OUTLABEL");
const SEM_LOTE = item("mp-99", "MP-000099", "SAL MARINHO REFINADO SEM CONTROLE DE LOTE", false);

function servidor(params: ListItemsParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = [LONGO, SEM_LOTE]
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo));
  return { items: linhas, page: 1, pageSize: params.pageSize ?? 20, total: linhas.length };
}

function abrir() {
  return render(
    <MemoryRouter initialEntries={[ROTA]}>
      <Routes>
        <Route path={ROTA} element={<ReceiveCustomerMaterialPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tabelaDeLinhas = () => screen.getByRole("combobox", { name: "Item recebido" }).closest("table") as HTMLTableElement;

async function escolherItem(registro: ItemDTO) {
  await waitFor(() => expect(listItems).toHaveBeenCalled());
  const campo = screen.getByRole("combobox", { name: "Item recebido" });
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: registro.code } });
  await waitFor(() => expect(listItems).toHaveBeenCalledWith(expect.objectContaining({ search: registro.code })));
  fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(`^${registro.code}`) }));
  await waitFor(() => expect(campo).toHaveValue(`${registro.code} · ${registro.name}`));
}

const folha = () => readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");

function regra(css: string, seletor: string): string {
  const inicio = css.indexOf(`\n${seletor} {`);
  expect(inicio, `regra "${seletor}"`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], total: 0 } as never);
  vi.mocked(listItems).mockImplementation(async (params) => servidor(params) as never);
});

describe("Receber material do cliente — a tabela de linhas", () => {
  it("é a tabela das linhas, com a classe da regra, dentro do próprio `.table-container`", async () => {
    abrir();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    const tabela = tabelaDeLinhas();
    expect(tabela).toHaveClass("table", "table--customer-material-lines");
    expect(tabela.closest(".table-container")).not.toBeNull();
    expect(within(tabela).getByRole("button", { name: "Remover linha" }).closest("td")).toBe(
      tabela.querySelector("tbody tr td:last-child"),
    );
  });

  it("campos de texto são filhos diretos da célula — o que a regra alcança — e a data fica com a largura dela", async () => {
    abrir();
    await escolherItem(LONGO);
    const linha = tabelaDeLinhas().querySelector("tbody tr") as HTMLTableRowElement;

    const quantidade = within(linha).getByLabelText(`Quantidade recebida de ${LONGO.code}`);
    expect(quantidade.parentElement).toHaveClass("is-numeric");
    expect(quantidade.parentElement?.tagName).toBe("TD");
    // A unidade continua ao lado do número, na mesma célula.
    expect(within(quantidade.parentElement as HTMLElement).getByText(LONGO.unitCode)).toBeInTheDocument();

    for (const rotulo of ["Lote do fabricante", "Localização"]) {
      const campo = within(linha).getByLabelText(rotulo);
      expect(campo).toHaveAttribute("type", "text");
      expect(campo.parentElement?.tagName).toBe("TD");
    }
    expect(within(linha).getByLabelText("Validade")).toHaveAttribute("type", "date");

    // O seletor do item não é filho direto: a regra dos campos não o alcança.
    expect(screen.getByRole("combobox", { name: "Item recebido" }).parentElement?.tagName).not.toBe("TD");
    for (const elemento of tabelaDeLinhas().querySelectorAll<HTMLElement>("[style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
  });

  it("aviso de item sem controle de lote fica na coluna do item, como prosa", async () => {
    abrir();
    await escolherItem(SEM_LOTE);
    const aviso = await within(tabelaDeLinhas()).findByText(/Item não controla lote/);
    expect(aviso).toHaveClass("field__error");
    expect(aviso.closest("td")).toBe(
      screen.getByRole("combobox", { name: "Item recebido" }).closest("td"),
    );
  });
});

describe("a regra das linhas", () => {
  it("quantidade com largura própria, menor que a nativa; lote e localização acompanham a coluna com mínimo legível", () => {
    const css = folha();
    const quantidade = regra(css, ".table--customer-material-lines td.is-numeric > input");
    const texto = regra(css, '.table--customer-material-lines td > input[type="text"]');

    const larguraDaQuantidade = Number(quantidade.match(/\n\s*width: (\d+(?:\.\d+)?)rem;/)?.[1]);
    // A nativa media ~180px (≈11rem): a quantidade é número curto.
    expect(larguraDaQuantidade).toBeGreaterThanOrEqual(6);
    expect(larguraDaQuantidade).toBeLessThanOrEqual(9);

    expect(texto).toMatch(/\n\s*width: 100%;/);
    const minimo = Number(texto.match(/\n\s*min-width: (\d+(?:\.\d+)?)rem;/)?.[1]);
    expect(minimo).toBeGreaterThanOrEqual(5);

    // A quantidade vem DEPOIS: mesma especificidade, e o número não pode herdar 100%.
    expect(css.indexOf("\n.table--customer-material-lines td.is-numeric > input {")).toBeGreaterThan(
      css.indexOf('\n.table--customer-material-lines td > input[type="text"] {'),
    );
  });

  it("cabeçalho e aviso quebram linha em vez de alargar a tabela", () => {
    const css = folha();
    expect(regra(css, ".table--customer-material-lines th")).toMatch(/\n\s*white-space: normal;/);
    expect(regra(css, ".table--customer-material-lines td .field__error")).toMatch(/\n\s*white-space: normal;/);
  });

  it("em 390px a tabela continua rolando por dentro: a regra não mexe no contêiner nem na página", () => {
    const css = folha();
    expect(regra(css, ".table-container")).toMatch(/\n\s*overflow-x: auto;/);
    const inicio = css.indexOf("\n.table--customer-material-lines th {");
    const bloco = css.slice(inicio, css.indexOf("\n.context-chip {", inicio));
    expect(bloco).not.toMatch(/overflow|table-layout|@media/);
  });
});
