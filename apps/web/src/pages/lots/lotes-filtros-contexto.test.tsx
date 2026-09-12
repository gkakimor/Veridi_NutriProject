import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { ItemListResponse, LotDTO, LotListResponse } from "@veridi/shared";

/**
 * Lotes — contexto e filtros (FILTER-OPERATIONS-WAVE-02).
 *
 * Esta tela é também "Liberação de lotes": o menu da Qualidade aponta para
 * `/estoque/lotes?status=AWAITING_RELEASE` (`app/navigation.ts`). Duas portas,
 * uma lista — e daí a gravidade do contexto residual.
 *
 * Quatro defeitos, todos confirmados no código antes de mexer:
 *
 * 1. **Merge por campo.** `usePersistentFilter` aplicava o override da URL
 *    campo a campo: `?status=AWAITING_RELEASE` vencia no status e deixava
 *    `search` e `owner` caírem na LEMBRANÇA DA SESSÃO. Quem tinha filtrado
 *    algo antes clicava em "Liberação de lotes" e recebia o cruzamento.
 * 2. **`itemId` fora do recarregamento.** As dependências do `reload` eram
 *    `[page, search, statusFilter, ownerFilter]`: trocar `?itemId=` sem
 *    desmontar a página deixava na tela os lotes do item anterior.
 * 3. **CSV sem `itemId`.** O botão levava busca, status e proprietário; a
 *    tela mostrava os lotes de um item e o arquivo trazia a base inteira.
 * 4. **Dois "Limpar filtros".** O da barra zerava a sessão e deixava o
 *    `?itemId=` de pé; o do aviso de contexto trocava de endereço e deixava
 *    a sessão intacta. Mesmo texto, efeitos diferentes.
 */

vi.mock("../../lib/lots-api", () => ({ listLots: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listLots } from "../../lib/lots-api";
import { listItems } from "../../lib/items-api";
import { clearStoredFilters, filterStorageKey } from "../../lib/stored-filters";
import { LotsPage } from "./LotsPage";

const ITENS = {
  items: [
    { id: "item-1", code: "MP-000001", name: "Vitamina C", unitCode: "kg", active: true },
    { id: "item-2", code: "MP-000002", name: "Colágeno", unitCode: "kg", active: true },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
} as unknown as ItemListResponse;

function lote(id: string, code: string, itemId: string, itemCode: string): LotDTO {
  return {
    id,
    code,
    itemId,
    itemCode,
    itemName: itemCode === "MP-000001" ? "Vitamina C" : "Colágeno",
    status: "AVAILABLE",
    isExpired: false,
    ownerType: "VERIDI",
    ownerCustomerName: null,
    supplierLot: null,
    supplierId: null,
    supplierCode: null,
    supplierName: null,
    businessLotNumber: null,
    initialReceivedQuantity: "10",
    unitCode: "kg",
    expiryDate: null,
    location: null,
    origin: "RECEIPT",
  } as unknown as LotDTO;
}

const LOTES_ITEM_1 = [lote("lot-1", "LT-20260101-000001", "item-1", "MP-000001")];
const LOTES_ITEM_2 = [lote("lot-2", "LT-20260101-000002", "item-2", "MP-000002")];

function resposta(lots: LotDTO[], total = lots.length): LotListResponse {
  return { lots, page: 1, pageSize: 20, total } as unknown as LotListResponse;
}

/** `listLots` tem default no parâmetro; o filtro sempre chega preenchido. */
type Consulta = NonNullable<Parameters<typeof listLots>[0]>;

const chamadas = () => vi.mocked(listLots).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/estoque/lotes") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <LotsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listLots).toHaveBeenCalled());
  return resultado;
}

/** Troca a URL SEM desmontar a tela — é o caso do finding 2. */
function Harness({ para }: { para: string }) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(para)}>
        trocar de item
      </button>
      <LotsPage />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "lots");
  vi.mocked(listLots).mockReset();
  vi.mocked(listLots).mockResolvedValue(resposta([]));
  vi.mocked(listItems).mockResolvedValue(ITENS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("contexto vindo por link", () => {
  it("`?itemId=` filtra a consulta", async () => {
    vi.mocked(listLots).mockResolvedValue(resposta(LOTES_ITEM_1));
    await abrir("/estoque/lotes?itemId=item-1");
    expect(ultimaConsulta()).toMatchObject({ itemId: "item-1" });
  });

  it("o chip nomeia o item — inclusive quando a lista volta VAZIA", async () => {
    vi.mocked(listLots).mockResolvedValue(resposta([]));
    const { container } = await abrir("/estoque/lotes?itemId=item-1");

    await waitFor(() => expect(listItems).toHaveBeenCalled());
    const chips = await waitFor(() => {
      const alvo = container.querySelector(".filter-chips") as HTMLElement | null;
      expect(alvo).not.toBeNull();
      return alvo as HTMLElement;
    });
    // Sem nenhuma linha na tabela, o nome do item só pode vir do filtro.
    await waitFor(() =>
      expect(within(chips).getByText(/MP-000001 · Vitamina C/)).toBeInTheDocument(),
    );
  });

  it("remover o chip do item devolve a lista sem contexto", async () => {
    await abrir("/estoque/lotes?itemId=item-1");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Item" }));
    await waitFor(() => expect(ultimaConsulta().itemId).toBeUndefined());
  });

  it("trocar de `itemId` sem desmontar RECARREGA — não fica o item anterior", async () => {
    vi.mocked(listLots).mockImplementation(async (params) =>
      resposta(params?.itemId === "item-2" ? LOTES_ITEM_2 : LOTES_ITEM_1),
    );

    render(
      <MemoryRouter initialEntries={["/estoque/lotes?itemId=item-1"]}>
        <Harness para="/estoque/lotes?itemId=item-2" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("LT-20260101-000001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "trocar de item" }));

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ itemId: "item-2" }));
    expect(await screen.findByText("LT-20260101-000002")).toBeInTheDocument();
    // O resultado do item anterior não pode ficar na tela.
    expect(screen.queryByText("LT-20260101-000001")).toBeNull();
  });
});

describe("URL não herda a sessão de quem a abriu", () => {
  async function deixarResiduoNaSessao() {
    const primeira = await abrir("/estoque/lotes");
    fireEvent.change(screen.getByLabelText("Buscar lotes"), { target: { value: "RESIDUO" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO" }));
    fireEvent.change(screen.getByLabelText("Filtrar por proprietário"), {
      target: { value: "CUSTOMER" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ ownerType: "CUSTOMER" }));
    primeira.unmount();
    // A sessão guardou de verdade — é o que torna o teste seguinte honesto.
    expect(sessionStorage.getItem(filterStorageKey("u-1", "lots", "search"))).toBe('"RESIDUO"');
  }

  it("`Liberação de lotes` abre SÓ no status do link, sem a busca da sessão", async () => {
    await deixarResiduoNaSessao();

    vi.mocked(listLots).mockClear();
    await abrir("/estoque/lotes?status=AWAITING_RELEASE");

    const consulta = ultimaConsulta();
    expect(consulta).toMatchObject({ status: "AWAITING_RELEASE" });
    expect(consulta.search).toBeUndefined();
    expect(consulta.ownerType).toBeUndefined();
    expect(consulta.itemId).toBeUndefined();
  });

  it("`?itemId=` também não se cruza com o resíduo", async () => {
    await deixarResiduoNaSessao();

    vi.mocked(listLots).mockClear();
    await abrir("/estoque/lotes?itemId=item-1");

    const consulta = ultimaConsulta();
    expect(consulta).toMatchObject({ itemId: "item-1" });
    expect(consulta.search).toBeUndefined();
    expect(consulta.ownerType).toBeUndefined();
  });

  it("sem NADA na URL, a sessão continua valendo — é o que ela existe para fazer", async () => {
    await deixarResiduoNaSessao();

    vi.mocked(listLots).mockClear();
    await abrir("/estoque/lotes");

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO", ownerType: "CUSTOMER" }),
    );
  });
});

describe("filtros da tela", () => {
  it("busca, status, proprietário e item, todos na URL", async () => {
    await abrir("/estoque/lotes?search=LT-1&status=BLOCKED&ownerType=CUSTOMER&itemId=item-1");
    expect(ultimaConsulta()).toMatchObject({
      search: "LT-1",
      status: "BLOCKED",
      ownerType: "CUSTOMER",
      itemId: "item-1",
    });
    expect(screen.getByLabelText("Buscar lotes")).toHaveValue("LT-1");
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("BLOCKED");
    expect(screen.getByLabelText("Filtrar por proprietário")).toHaveValue("CUSTOMER");
  });

  it("status desconhecido na URL cai no default em vez de gerar consulta inválida", async () => {
    await abrir("/estoque/lotes?status=NAO_EXISTE");
    expect(ultimaConsulta().status).toBeUndefined();
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("all");
  });

  it("o item tem busca no SERVIDOR — nenhum catálogo carregado inteiro", async () => {
    await abrir("/estoque/lotes");
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    for (const [params] of vi.mocked(listItems).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("um id de item vindo da URL é resolvido por identidade, não por busca textual", async () => {
    await abrir("/estoque/lotes?itemId=item-2");
    await waitFor(() =>
      expect(vi.mocked(listItems).mock.calls.some(([params]) => params?.ids?.[0] === "item-2")).toBe(
        true,
      ),
    );
  });
});

describe("chips, limpar e paginação", () => {
  it("conta os filtros ativos, contando o item", async () => {
    await abrir("/estoque/lotes?search=LT-1&status=BLOCKED&itemId=item-1");
    expect(screen.getByText("Filtros (3)")).toBeInTheDocument();
  });

  it("um `Limpar filtros` só, e ele limpa TUDO — inclusive o item do link", async () => {
    await abrir("/estoque/lotes?search=LT-1&status=BLOCKED&ownerType=CUSTOMER&itemId=item-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);

    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toBeUndefined();
      expect(consulta.ownerType).toBeUndefined();
      expect(consulta.itemId).toBeUndefined();
    });
  });

  it("`Limpar filtros` também esquece a sessão", async () => {
    const primeira = await abrir("/estoque/lotes?search=LT-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => expect(ultimaConsulta().search).toBeUndefined());
    primeira.unmount();

    vi.mocked(listLots).mockClear();
    await abrir("/estoque/lotes");
    expect(ultimaConsulta().search).toBeUndefined();
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listLots).mockResolvedValue(resposta([], 300));
    await abrir("/estoque/lotes?page=4");
    expect(ultimaConsulta().page).toBe(4);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), {
      target: { value: "BLOCKED" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });

  it("a paginação é explícita e o total é do servidor", async () => {
    vi.mocked(listLots).mockResolvedValue(resposta([], 300));
    await abrir("/estoque/lotes");

    expect(await screen.findByText("300 lotes")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 15")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
  });
});

describe("CSV — mesma consulta da tela", () => {
  it("o `itemId` do link chega ao CSV — era o filtro que ele perdia", async () => {
    await abrir("/estoque/lotes?itemId=item-1");
    expect(linkDoCsv().searchParams.get("itemId")).toBe("item-1");
  });

  it("e os demais filtros, sem paginação", async () => {
    await abrir("/estoque/lotes?search=LT-1&status=BLOCKED&ownerType=CUSTOMER&itemId=item-1");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("status")).toBe(consulta.status ?? null);
    expect(params.get("ownerType")).toBe(consulta.ownerType ?? null);
    expect(params.get("itemId")).toBe(consulta.itemId ?? null);
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("`Liberação de lotes` exporta o mesmo recorte que mostra", async () => {
    await abrir("/estoque/lotes?status=AWAITING_RELEASE");
    const params = linkDoCsv().searchParams;
    expect(params.get("status")).toBe("AWAITING_RELEASE");
    expect(params.get("search")).toBeNull();
    expect(params.get("itemId")).toBeNull();
  });
});
