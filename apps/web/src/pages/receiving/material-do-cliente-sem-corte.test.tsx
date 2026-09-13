import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, ItemType } from "@veridi/shared";
import type { ListItemsParams } from "../../lib/items-api";

/**
 * Receber material do cliente sem corte silencioso (CUSTOMER-MATERIAL-ITEM-CUTOFF-01).
 *
 * O seletor de item pedia `type=RAW_MATERIAL` e `type=PACKAGING`, ativos, 1000
 * de cada, e somava as duas listas num `<select>`. Do item 1001 de cada tipo
 * em diante o material existia, o servidor aceitaria o recebimento, e a tela
 * não o oferecia — sem aviso nenhum.
 *
 * O seletor passou à foundation dos filtros: primeira página de 20, busca no
 * servidor por código ou nome, resolução pelo id, e quais tipos entram é o
 * servidor quem diz (`customerSupplied`). O servidor aqui é de mentira, mas
 * honesto: guarda 1005 itens e filtra, ordena e pagina o universo inteiro a
 * cada pedido — não devolve 20 prontos. A prova com banco real, dono do lote
 * e Clientes A/B está em
 * `apps/api/src/modules/receiving/material-do-cliente-sem-corte.test.ts`.
 */

vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/receiving-api", () => ({ createCustomerSuppliedReceipt: vi.fn() }));

import { listCustomers } from "../../lib/customers-api";
import { getItem, listItems } from "../../lib/items-api";
import { createCustomerSuppliedReceipt } from "../../lib/receiving-api";
import { PARAM_RETOMAR, startContextualCreate } from "../../lib/contextual-create";
import { ReceiveCustomerMaterialPage } from "./ReceiveCustomerMaterialPage";

const ROTA = "/compras/recebimentos/material-do-cliente";
const PAGINA_DO_SELETOR = 20;
/** Matérias-primas ativas com código menor que o do alvo — o antigo teto. */
const RUIDO = 1000;

const codigoMp = (numero: number) => `MP-${String(numero).padStart(6, "0")}`;

function item(
  id: string,
  code: string,
  name: string,
  extra: Partial<Pick<ItemDTO, "type" | "active" | "controlsLot" | "unitCode">> = {},
): ItemDTO {
  return {
    id,
    code,
    name,
    type: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
    ...extra,
  } as unknown as ItemDTO;
}

const ALVO = item("item-1001", codigoMp(RUIDO + 1), "Beta-Alanina Pura");
const INATIVO = item("item-1002", codigoMp(RUIDO + 2), "Colageno Inativo", { active: false });
const SEM_LOTE = item("item-1003", codigoMp(RUIDO + 3), "Sal Sem Lote", { controlsLot: false });
const EMBALAGEM = item("emb-1", "ME-000001", "Pote 500 mL", { type: "PACKAGING", unitCode: "un" });
const PRODUTO_ACABADO = item("pa-1", "PA-000001", "Gummy Pronto", { type: "FINISHED_PRODUCT", unitCode: "un" });

const UNIVERSO: ItemDTO[] = [
  ...Array.from({ length: RUIDO }, (_, indice) =>
    item(`item-${indice + 1}`, codigoMp(indice + 1), `Excipiente ${String(indice + 1).padStart(4, "0")}`),
  ),
  ALVO,
  INATIVO,
  SEM_LOTE,
  EMBALAGEM,
  PRODUTO_ACABADO,
];

/** O conjunto do servidor real. A tela não o conhece — só pergunta `customerSupplied`. */
const ENTRAM_NO_SERVIDOR: ItemType[] = ["RAW_MATERIAL", "PACKAGING"];

function servidor(params: ListItemsParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.customerSupplied || ENTRAM_NO_SERVIDOR.includes(registro.type))
    .filter((registro) => !params.type || registro.type === params.type)
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter(
      (registro) =>
        !termo || registro.code.toLowerCase().includes(termo) || registro.name.toLowerCase().includes(termo),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return {
    items: linhas.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: linhas.length,
  };
}

const CLIENTE_A = { id: "cli-a", code: "CLI-000001", legalName: "Alfa Suplementos Ltda", tradeName: null, cnpj: null };
const CLIENTE_B = { id: "cli-b", code: "CLI-000002", legalName: "Omega Nutricao Ltda", tradeName: null, cnpj: null };

function abrir(endereco = ROTA) {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <Routes>
        <Route path={ROTA} element={<ReceiveCustomerMaterialPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const seletoresDeItem = () => screen.getAllByRole("combobox", { name: "Item recebido" });
const linhaDe = (campo: HTMLElement) => campo.closest("tr") as HTMLElement;
const confirmar = () => screen.getByRole("button", { name: /Confirmar recebimento/ }) as HTMLButtonElement;

async function escolherCliente(code: string) {
  const campo = document.getElementById("customer-receipt-customer") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(code) }));
}

/** Digita no seletor de item da linha e escolhe a opção que o SERVIDOR devolveu. */
async function buscarEEscolherItem(termo: string, opcao: RegExp, linha = 0) {
  await waitFor(() => expect(listItems).toHaveBeenCalled());
  const campo = seletoresDeItem()[linha]!;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  await waitFor(() => expect(listItems).toHaveBeenCalledWith(expect.objectContaining({ search: termo })));
  fireEvent.mouseDown(await screen.findByRole("option", { name: opcao }));
  return campo;
}

/** Toda consulta de item: página do seletor, só elegível, nenhum tipo escrito pela tela. */
function nenhumaConsultaAlemDaPagina() {
  const chamadas = vi.mocked(listItems).mock.calls;
  expect(chamadas.length).toBeGreaterThan(0);
  for (const [params] of chamadas) {
    expect(params?.pageSize).toBeLessThanOrEqual(PAGINA_DO_SELETOR);
    expect(params?.customerSupplied).toBe(true);
    expect(params?.active).toBe(true);
    expect(params?.type).toBeUndefined();
    // Item não tem dono: a pergunta de item nunca carrega cliente.
    expect(params).not.toHaveProperty("customerId");
  }
  expect(getItem).not.toHaveBeenCalled();
}

/** Rascunho de quem saiu para cadastrar o cliente, com o item escolhido na linha. */
function retomarComItem(itemId: string) {
  const token = startContextualCreate({
    originRoute: ROTA,
    fieldKey: "customerId",
    entityType: "customer",
    draft: {
      customerId: CLIENTE_A.id,
      receivedAt: "2026-09-10",
      documentReference: "REM-2026-0042",
      invoiceNumber: "",
      notes: "",
      lines: [
        { key: "linha-1", itemId, receivedQuantity: "5", supplierLot: "FAB-77", expiryDate: "2027-12-31", location: "" },
      ],
    },
  })!;
  return abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE_A, CLIENTE_B], total: 2 } as never);
  vi.mocked(listItems).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(createCustomerSuppliedReceipt).mockResolvedValue({ id: "rec-1" } as never);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("as duas listas de 1000 não alcançavam o item #1001; o elegível passa de 1000", () => {
    const antigas = new Set(
      [
        ...servidor({ type: "RAW_MATERIAL", active: true, pageSize: 1000 }).items,
        ...servidor({ type: "PACKAGING", active: true, pageSize: 1000 }).items,
      ].map((registro) => registro.code),
    );
    expect(antigas.size).toBe(1001);
    expect(antigas.has(ALVO.code)).toBe(false);
    expect(servidor({ customerSupplied: true, active: true }).total).toBe(RUIDO + 3);
  });
});

describe("Material do cliente — seletor de item com busca no servidor", () => {
  it("abre com a primeira página do servidor — 20, dos dois tipos — e diz que o resto se alcança buscando", async () => {
    abrir();
    await waitFor(() =>
      expect(listItems).toHaveBeenCalledWith({ customerSupplied: true, active: true, pageSize: PAGINA_DO_SELETOR }),
    );

    fireEvent.focus(seletoresDeItem()[0]!);
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA_DO_SELETOR));
    const opcoes = within(lista).getAllByRole("option");
    expect(opcoes[0]).toHaveTextContent(EMBALAGEM.code);
    expect(opcoes[1]).toHaveTextContent(codigoMp(1));
    expect(within(lista).queryByRole("option", { name: new RegExp(ALVO.code) })).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();

    expect(listItems).toHaveBeenCalledTimes(1);
    nenhumaConsultaAlemDaPagina();
  });

  it("várias linhas: a primeira página sai uma vez só", async () => {
    abrir();
    await waitFor(() => expect(listItems).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar material" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar material" }));
    await waitFor(() => expect(seletoresDeItem()).toHaveLength(3));

    fireEvent.focus(seletoresDeItem()[2]!);
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA_DO_SELETOR));
    expect(listItems).toHaveBeenCalledTimes(1);
    nenhumaConsultaAlemDaPagina();
  });

  it("item #1001 — fora das 1000 de antes e da primeira página — achado pelo código, escolhido e recebido", async () => {
    abrir();
    await escolherCliente(CLIENTE_A.code);
    const campo = await buscarEEscolherItem(ALVO.code, new RegExp(ALVO.code));

    expect(listItems).toHaveBeenCalledWith({
      customerSupplied: true,
      active: true,
      search: ALVO.code,
      pageSize: PAGINA_DO_SELETOR,
    });
    await waitFor(() => expect(campo).toHaveValue(`${ALVO.code} · ${ALVO.name}`));

    const linha = linhaDe(campo);
    // A unidade e o controle de lote vêm do item que o servidor devolveu.
    expect(within(linha).getByText("kg")).toBeInTheDocument();
    expect(within(linha).queryByText(/Item não controla lote/)).toBeNull();
    fireEvent.change(within(linha).getByLabelText(`Quantidade recebida de ${ALVO.code}`), {
      target: { value: "12,5" },
    });
    fireEvent.change(within(linha).getByLabelText("Lote do fabricante"), { target: { value: "FAB-2026-09" } });
    fireEvent.change(within(linha).getByLabelText("Validade"), { target: { value: "2027-12-31" } });
    fireEvent.change(within(linha).getByLabelText("Localização"), { target: { value: "DOCA-1" } });

    await waitFor(() => expect(confirmar().disabled).toBe(false));
    fireEvent.click(confirmar());
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(createCustomerSuppliedReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: CLIENTE_A.id,
          lines: [
            {
              itemId: ALVO.id,
              receivedQuantity: "12.5",
              supplierLot: "FAB-2026-09",
              expiryDate: new Date("2027-12-31T12:00:00").toISOString(),
              location: "DOCA-1",
            },
          ],
        }),
      ),
    );
    expect(await screen.findByText("Recebimento gravado")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("a busca por nome acha o item #1001", async () => {
    abrir();
    const campo = await buscarEEscolherItem("Beta-Alanina", new RegExp(ALVO.code));

    expect(listItems).toHaveBeenCalledWith({
      customerSupplied: true,
      active: true,
      search: "Beta-Alanina",
      pageSize: PAGINA_DO_SELETOR,
    });
    await waitFor(() => expect(campo).toHaveValue(`${ALVO.code} · ${ALVO.name}`));
    nenhumaConsultaAlemDaPagina();
  });

  it.each([
    [PRODUTO_ACABADO.code, "produto acabado"],
    [INATIVO.code, "inativo"],
  ])("%s (%s) não aparece nem pela busca exata do código", async (code) => {
    abrir();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    const campo = seletoresDeItem()[0]!;
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: code } });

    expect(await screen.findByText("Nenhum resultado.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: new RegExp(code) })).toBeNull();
    expect(listItems).toHaveBeenCalledWith({
      customerSupplied: true,
      active: true,
      search: code,
      pageSize: PAGINA_DO_SELETOR,
    });
    nenhumaConsultaAlemDaPagina();
  });

  it("item sem controle de lote continua oferecido, com a orientação na linha", async () => {
    abrir();
    const campo = await buscarEEscolherItem(SEM_LOTE.code, new RegExp(SEM_LOTE.code));

    expect(
      await within(linhaDe(campo)).findByText(/Item não controla lote — ative o controle de lote no cadastro/),
    ).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("Cliente A ou B: a busca de item é a mesma, e o recebimento leva o dono escolhido", async () => {
    const buscasDoAlvo = () =>
      vi.mocked(listItems).mock.calls.filter(([params]) => params?.search === "Beta-Alanina");
    abrir();
    await escolherCliente(CLIENTE_A.code);
    await buscarEEscolherItem("Beta-Alanina", new RegExp(ALVO.code));
    expect(buscasDoAlvo()).toHaveLength(1);

    // Troca o dono e busca de novo: a pergunta de item é a mesma, e o item continua achado.
    await escolherCliente(CLIENTE_B.code);
    await waitFor(() =>
      expect(document.getElementById("customer-receipt-customer")).toHaveValue(
        `${CLIENTE_B.code} · ${CLIENTE_B.legalName}`,
      ),
    );
    const campo = seletoresDeItem()[0]!;
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(buscasDoAlvo()).toHaveLength(2));
    expect(buscasDoAlvo()[1]![0]).toEqual(buscasDoAlvo()[0]![0]);
    expect(await screen.findByRole("option", { name: new RegExp(ALVO.code) })).toBeInTheDocument();
    // Já é o item da linha: fechar a lista mantém a escolha.
    fireEvent.keyDown(campo, { key: "Escape" });
    await waitFor(() => expect(campo).toHaveValue(`${ALVO.code} · ${ALVO.name}`));

    fireEvent.change(screen.getByLabelText(`Quantidade recebida de ${ALVO.code}`), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Lote do fabricante"), { target: { value: "FAB-COMUM" } });
    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "2027-12-31" } });
    fireEvent.click(confirmar());
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(createCustomerSuppliedReceipt).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCustomerSuppliedReceipt).mock.calls[0]![0]).toMatchObject({
      customerId: CLIENTE_B.id,
      lines: [expect.objectContaining({ itemId: ALVO.id, supplierLot: "FAB-COMUM" })],
    });
    nenhumaConsultaAlemDaPagina();
  });
});

describe("Material do cliente — item da linha restaurada pelo id", () => {
  it("item #1001, fora da primeira página, resolve pelo id sem busca", async () => {
    retomarComItem(ALVO.id);

    expect(await screen.findByDisplayValue("REM-2026-0042")).toBeInTheDocument();
    await waitFor(() => expect(seletoresDeItem()[0]).toHaveValue(`${ALVO.code} · ${ALVO.name}`));
    expect(listItems).toHaveBeenCalledWith({
      customerSupplied: true,
      active: true,
      ids: [ALVO.id],
      pageSize: 1,
    });
    expect(vi.mocked(listItems).mock.calls.some(([params]) => params?.search)).toBe(false);

    const linha = linhaDe(seletoresDeItem()[0]!);
    expect(within(linha).getByLabelText(`Quantidade recebida de ${ALVO.code}`)).toHaveValue("5");
    expect(within(linha).getByText("kg")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("item que ficou inativo: a escolha é desfeita às claras, e o recebimento não confirma", async () => {
    retomarComItem(INATIVO.id);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Um item do rascunho não pode mais ser recebido como material do cliente",
    );
    expect(listItems).toHaveBeenCalledWith({
      customerSupplied: true,
      active: true,
      ids: [INATIVO.id],
      pageSize: 1,
    });
    await waitFor(() => expect(seletoresDeItem()[0]).toHaveValue(""));
    // A quantidade digitada fica; sem item na linha, não há o que confirmar.
    expect(screen.getByLabelText("Quantidade recebida")).toHaveValue("5");
    expect(confirmar().disabled).toBe(true);
    expect(createCustomerSuppliedReceipt).not.toHaveBeenCalled();
    nenhumaConsultaAlemDaPagina();
  });
});

describe("guarda estrutural", () => {
  it("a tela e a source não carregam catálogo nem repetem quais tipos entram", () => {
    const tela = readFileSync(
      join(process.cwd(), "src", "pages", "receiving", "ReceiveCustomerMaterialPage.tsx"),
      "utf8",
    );
    expect(tela).not.toMatch(/\blistItems\(/);
    expect(tela).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(tela).not.toMatch(/\ball:\s*true/);
    expect(tela).not.toMatch(/"RAW_MATERIAL"|"PACKAGING"/);

    const fontes = readFileSync(join(process.cwd(), "src", "lib", "filter-sources.ts"), "utf8");
    const inicio = fontes.indexOf("export function itemMaterialDoClienteSource");
    const source = fontes.slice(inicio, fontes.indexOf("function opcaoDeCliente", inicio));
    expect(source.match(/listItems\(\{\s*customerSupplied: true,\s*active: true,\s*pageSize: PAGINA,/g)).toHaveLength(1);
    expect(source).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(source).not.toMatch(/"RAW_MATERIAL"|"PACKAGING"|type:/);
  });

  it("em 390px: seletor na regra de tela estreita, sem <select> nem largura em pixel", async () => {
    const { container } = abrir();
    await waitFor(() => expect(container.querySelector("td .toolbar__entity [role='combobox']")).not.toBeNull());
    expect(container.querySelector("td select")).toBeNull();
    for (const elemento of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
    const css = readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.toolbar__search,\s*\.toolbar__entity \{\s*min-width: 100%;/);
  });
});
