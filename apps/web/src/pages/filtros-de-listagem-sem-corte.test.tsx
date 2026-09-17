import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { CustomerDTO, SupplierDTO } from "@veridi/shared";
import type { ListCustomersParams } from "../lib/customers-api";
import type { ListSuppliersParams } from "../lib/suppliers-api";

/**
 * Filtros de listagem sem corte silencioso (SELECTOR-CUTOFF-WAVE-01).
 *
 * Seis barras montavam o filtro de Cliente ou Fornecedor com um catálogo de
 * teto fixo — `listCustomers({ active: true, pageSize: 1000 })` em Projetos e
 * Materiais de Clientes, `pageSize: 100` em Amostras, `listCustomers({
 * pageSize: 1000 })` em Produtos e Faturamento, `listSuppliers({ active: true,
 * pageSize: 1000 })` em Item × Fornecedor. Do registro 1001 em diante a
 * entidade existia e a barra não a oferecia.
 *
 * Todas passaram ao `EntityFilterSelect`: primeira página de 20, busca no
 * servidor e nome resolvido pelo id. O servidor aqui é de mentira, mas
 * honesto: guarda 1002 registros e filtra, ordena e pagina o universo inteiro
 * a cada pedido. O universo de cada barra é o de antes — só ativos onde o
 * `<select>` só tinha ativos, todos onde tinha todos.
 */

vi.mock("../app/AuthProvider", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }) }));
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/projects-api", () => ({ listProjects: vi.fn(), getProjectVocabulary: vi.fn() }));
vi.mock("../lib/samples-api", () => ({ listSamples: vi.fn() }));
vi.mock("../lib/customer-materials-api", () => ({ listCustomerMaterials: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn(), setProductActive: vi.fn() }));
vi.mock("../lib/billings-api", () => ({
  listBillings: vi.fn(),
  listAwaitingBilling: vi.fn(),
  createBilling: vi.fn(),
}));
vi.mock("../lib/supplier-items-api", () => ({ listSupplierItems: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));

import { listCustomers } from "../lib/customers-api";
import { listSuppliers } from "../lib/suppliers-api";
import { getProjectVocabulary, listProjects } from "../lib/projects-api";
import { listSamples } from "../lib/samples-api";
import { listCustomerMaterials } from "../lib/customer-materials-api";
import { listProducts } from "../lib/products-api";
import { listAwaitingBilling, listBillings } from "../lib/billings-api";
import { listSupplierItems } from "../lib/supplier-items-api";
import { listItems } from "../lib/items-api";
import { filterStorageKey } from "../lib/stored-filters";
import { ProjectsPage } from "./projects/ProjectsPage";
import { SamplesPage } from "./samples/SamplesPage";
import { CustomerMaterialsPage } from "./inventory/CustomerMaterialsPage";
import { ProductsPage } from "./products/ProductsPage";
import { BillingsPage } from "./billings/BillingsPage";
import { SupplierItemsPage } from "./supplier-items/SupplierItemsPage";

const PAGINA_DO_FILTRO = 20;
/** Registros com código menor que o do alvo — o antigo teto. */
const RUIDO = 1000;

const seis = (numero: number) => String(numero).padStart(6, "0");

function cliente(numero: number, extra: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: `cli-${numero}`,
    code: `CLI-${seis(numero)}`,
    legalName: `Cliente de Volume ${String(numero).padStart(4, "0")} Ltda`,
    tradeName: null,
    cnpj: null,
    active: true,
    ...extra,
  } as unknown as CustomerDTO;
}

function fornecedor(numero: number, extra: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: `for-${numero}`,
    code: `FOR-${seis(numero)}`,
    legalName: `Fornecedor de Volume ${String(numero).padStart(4, "0")} Ltda`,
    tradeName: null,
    cnpj: null,
    active: true,
    ...extra,
  } as unknown as SupplierDTO;
}

const CLIENTE_ALVO = cliente(RUIDO + 1, { legalName: "Zeta Nutricao Alvo Ltda", tradeName: "Zeta Alvo" });
const CLIENTE_INATIVO = cliente(RUIDO + 2, { legalName: "Zeta Nutricao Inativa Ltda", active: false });
const CLIENTES = [...Array.from({ length: RUIDO }, (_, indice) => cliente(indice + 1)), CLIENTE_ALVO, CLIENTE_INATIVO];

const FORNECEDOR_ALVO = fornecedor(RUIDO + 1, { legalName: "Zeta Insumos Alvo Ltda", tradeName: "Zeta Insumos" });
const FORNECEDOR_INATIVO = fornecedor(RUIDO + 2, { legalName: "Zeta Insumos Inativa Ltda", active: false });
const FORNECEDORES = [
  ...Array.from({ length: RUIDO }, (_, indice) => fornecedor(indice + 1)),
  FORNECEDOR_ALVO,
  FORNECEDOR_INATIVO,
];

type Cadastro = { id: string; code: string; legalName: string; tradeName: string | null; cnpj: string | null; active: boolean };

/** Filtra, ordena e pagina o universo inteiro — como `customers.service` e `suppliers.service`. */
function responder<T extends Cadastro>(universo: T[], params: ListCustomersParams | ListSuppliersParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = universo
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter(
      (registro) =>
        !termo ||
        [registro.code, registro.legalName, registro.tradeName ?? "", registro.cnpj ?? ""].some((campo) =>
          campo.toLowerCase().includes(termo),
        ),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { linhas: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

const servidorDeClientes = (params?: ListCustomersParams) => {
  const { linhas, ...meta } = responder(CLIENTES as unknown as Cadastro[], params);
  return { customers: linhas, ...meta };
};
const servidorDeFornecedores = (params?: ListSuppliersParams) => {
  const { linhas, ...meta } = responder(FORNECEDORES as unknown as Cadastro[], params);
  return { suppliers: linhas, ...meta };
};

/** Onde a tela está — a URL é o estado de quem guarda filtro nela. */
let enderecoAtual = "";
function Sonda() {
  const location = useLocation();
  enderecoAtual = `${location.pathname}${location.search}`;
  return null;
}

function montar(tela: ReactElement, url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      {tela}
      <Sonda />
    </MemoryRouter>,
  );
}

const ultima = (mock: unknown) => {
  const chamadas = vi.mocked(mock as (...args: never[]) => unknown).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as Record<string, unknown> | undefined;
};

interface Caso {
  tela: string;
  arquivo: string;
  rotulo: "Filtrar por cliente" | "Filtrar por fornecedor";
  api: typeof listCustomers | typeof listSuppliers;
  alvo: { id: string; code: string; rotulo: string };
  inativo: { id: string; code: string; rotulo: string };
  /** O universo do `<select>` de antes — e continua sendo o da busca. */
  somenteAtivos: boolean;
  /** A consulta de antes, reproduzida no servidor de mentira. */
  consultaAntiga: ListCustomersParams & ListSuppliersParams;
  chave: "customerId" | "supplierId";
  abrir: (url?: string) => ReturnType<typeof render>;
  /** Última consulta da listagem — onde o filtro escolhido é usado. */
  consultaDaLista: () => Record<string, unknown> | undefined;
  /** Endereço que devolve o filtro; `null` quando a tela não o guarda (estado local, como antes). */
  enderecoComFiltro: ((id: string) => string) | null;
}

const ROTULO_CLIENTE_ALVO = `${CLIENTE_ALVO.code} · ${CLIENTE_ALVO.legalName}`;
const ROTULO_CLIENTE_INATIVO = `${CLIENTE_INATIVO.code} · ${CLIENTE_INATIVO.legalName}`;
const ROTULO_FORNECEDOR_ALVO = `${FORNECEDOR_ALVO.code} · ${FORNECEDOR_ALVO.tradeName}`;
const ROTULO_FORNECEDOR_INATIVO = `${FORNECEDOR_INATIVO.code} · ${FORNECEDOR_INATIVO.legalName}`;

const clienteAlvo = { id: CLIENTE_ALVO.id, code: CLIENTE_ALVO.code, rotulo: ROTULO_CLIENTE_ALVO };
const clienteInativo = { id: CLIENTE_INATIVO.id, code: CLIENTE_INATIVO.code, rotulo: ROTULO_CLIENTE_INATIVO };

const CASOS: Caso[] = [
  {
    tela: "Projetos",
    arquivo: "projects/ProjectsPage.tsx",
    rotulo: "Filtrar por cliente",
    api: listCustomers,
    alvo: clienteAlvo,
    inativo: clienteInativo,
    somenteAtivos: true,
    consultaAntiga: { active: true, pageSize: 1000 },
    chave: "customerId",
    abrir: (url = "/comercial/projetos") => montar(<ProjectsPage />, url),
    consultaDaLista: () => ultima(listProjects),
    enderecoComFiltro: (id) => `/comercial/projetos?customerId=${id}`,
  },
  {
    tela: "Amostras",
    arquivo: "samples/SamplesPage.tsx",
    rotulo: "Filtrar por cliente",
    api: listCustomers,
    alvo: clienteAlvo,
    inativo: clienteInativo,
    somenteAtivos: true,
    consultaAntiga: { active: true, pageSize: 100 },
    chave: "customerId",
    abrir: (url = "/comercial/amostras") => montar(<SamplesPage />, url),
    consultaDaLista: () => ultima(listSamples),
    enderecoComFiltro: null,
  },
  {
    tela: "Materiais de Clientes",
    arquivo: "inventory/CustomerMaterialsPage.tsx",
    rotulo: "Filtrar por cliente",
    api: listCustomers,
    alvo: clienteAlvo,
    inativo: clienteInativo,
    somenteAtivos: true,
    consultaAntiga: { active: true, pageSize: 1000 },
    chave: "customerId",
    abrir: (url = "/estoque/materiais-de-clientes") => montar(<CustomerMaterialsPage />, url),
    consultaDaLista: () => ultima(listCustomerMaterials),
    enderecoComFiltro: (id) => `/estoque/materiais-de-clientes?customerId=${id}`,
  },
  {
    tela: "Produtos",
    arquivo: "products/ProductsPage.tsx",
    rotulo: "Filtrar por cliente",
    api: listCustomers,
    alvo: clienteAlvo,
    inativo: clienteInativo,
    somenteAtivos: false,
    consultaAntiga: { pageSize: 1000 },
    chave: "customerId",
    abrir: (url = "/cadastros/produtos") => montar(<ProductsPage />, url),
    consultaDaLista: () => ultima(listProducts),
    enderecoComFiltro: null,
  },
  {
    tela: "Faturamento",
    arquivo: "billings/BillingsPage.tsx",
    rotulo: "Filtrar por cliente",
    api: listCustomers,
    alvo: clienteAlvo,
    inativo: clienteInativo,
    somenteAtivos: false,
    consultaAntiga: { pageSize: 1000 },
    chave: "customerId",
    abrir: (url = "/comercial/faturamento") => montar(<BillingsPage />, url),
    consultaDaLista: () => ultima(listBillings),
    enderecoComFiltro: (id) => `/comercial/faturamento?customerId=${id}`,
  },
  {
    tela: "Item × Fornecedor",
    arquivo: "supplier-items/SupplierItemsPage.tsx",
    rotulo: "Filtrar por fornecedor",
    api: listSuppliers,
    alvo: { id: FORNECEDOR_ALVO.id, code: FORNECEDOR_ALVO.code, rotulo: ROTULO_FORNECEDOR_ALVO },
    inativo: { id: FORNECEDOR_INATIVO.id, code: FORNECEDOR_INATIVO.code, rotulo: ROTULO_FORNECEDOR_INATIVO },
    somenteAtivos: true,
    consultaAntiga: { active: true, pageSize: 1000 },
    chave: "supplierId",
    abrir: (url = "/compras/item-fornecedor") => montar(<SupplierItemsPage />, url),
    consultaDaLista: () => ultima(listSupplierItems),
    enderecoComFiltro: (id) => `/compras/item-fornecedor?supplierId=${id}`,
  },
];

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockImplementation(async (params) => servidorDeClientes(params) as never);
  vi.mocked(listSuppliers).mockImplementation(async (params) => servidorDeFornecedores(params) as never);
  vi.mocked(listProjects).mockResolvedValue({ projects: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(getProjectVocabulary).mockResolvedValue({ concepts: [], channels: [] } as never);
  vi.mocked(listSamples).mockResolvedValue({ samples: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listCustomerMaterials).mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listBillings).mockResolvedValue({ billings: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listAwaitingBilling).mockResolvedValue({ rows: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listItems).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 } as never);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it.each(CASOS)("$tela: a consulta antiga não alcançava o alvo #1001", (caso) => {
    const antiga =
      caso.api === listCustomers ? servidorDeClientes(caso.consultaAntiga).customers : servidorDeFornecedores(caso.consultaAntiga).suppliers;
    expect(antiga.some((registro) => registro.id === caso.alvo.id)).toBe(false);
    expect(
      caso.api === listCustomers
        ? servidorDeClientes({ active: true }).total
        : servidorDeFornecedores({ active: true }).total,
    ).toBe(RUIDO + 1);
  });
});

describe.each(CASOS)("$tela — filtro com busca no servidor", (caso) => {
  const campo = () => screen.getByRole("combobox", { name: caso.rotulo });
  const chamadas = () => vi.mocked(caso.api).mock.calls.map(([params]) => params ?? {});

  /** Nenhuma consulta de catálogo passa da página do filtro. */
  function nenhumaConsultaAlemDaPagina() {
    expect(chamadas().length).toBeGreaterThan(0);
    for (const params of chamadas()) expect(params.pageSize ?? 20).toBeLessThanOrEqual(PAGINA_DO_FILTRO);
  }

  async function buscar(termo: string) {
    await waitFor(() => expect(caso.api).toHaveBeenCalled());
    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: termo } });
    await waitFor(() =>
      expect(caso.api).toHaveBeenCalledWith({
        ...(caso.somenteAtivos ? { active: true } : {}),
        search: termo,
        pageSize: PAGINA_DO_FILTRO,
      }),
    );
  }

  it("abre com a primeira página — 20 ativos — e diz que o resto se alcança buscando", async () => {
    caso.abrir();
    await waitFor(() => expect(caso.api).toHaveBeenCalledWith({ active: true, pageSize: PAGINA_DO_FILTRO }));

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA_DO_FILTRO));
    expect(within(lista).queryByRole("option", { name: new RegExp(caso.alvo.code) })).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    nenhumaConsultaAlemDaPagina();
  });

  it("o alvo #1001 é achado pelo código no servidor, escolhido e usado na consulta da listagem", async () => {
    caso.abrir();
    await buscar(caso.alvo.code);
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(caso.alvo.code) }));

    await waitFor(() => expect(campo()).toHaveValue(caso.alvo.rotulo));
    await waitFor(() => expect(caso.consultaDaLista()?.[caso.chave]).toBe(caso.alvo.id));
    nenhumaConsultaAlemDaPagina();
  });

  it(
    caso.somenteAtivos
      ? "o universo continua só de ativos: a busca não oferece o inativo"
      : "o universo continua o de todos: a busca oferece o inativo, como a lista de 1000",
    async () => {
      caso.abrir();
      await buscar("Zeta");
      expect(await screen.findByRole("option", { name: new RegExp(caso.alvo.code) })).toBeInTheDocument();
      if (caso.somenteAtivos) {
        expect(screen.queryByRole("option", { name: new RegExp(caso.inativo.code) })).toBeNull();
      } else {
        expect(screen.getByRole("option", { name: new RegExp(caso.inativo.code) })).toBeInTheDocument();
      }
      for (const params of chamadas().filter((consulta) => consulta.search)) {
        expect(params.active).toBe(caso.somenteAtivos ? true : undefined);
      }
      nenhumaConsultaAlemDaPagina();
    },
  );

  if (caso.enderecoComFiltro) {
    const endereco = caso.enderecoComFiltro;

    it("recarregar com o filtro aplicado resolve o nome #1001 pelo id, sem busca", async () => {
      caso.abrir(endereco(caso.alvo.id));
      await waitFor(() => expect(campo()).toHaveValue(caso.alvo.rotulo));
      expect(caso.api).toHaveBeenCalledWith({ ids: [caso.alvo.id], pageSize: 1 });
      expect(chamadas().some((params) => params.search)).toBe(false);
      expect(caso.consultaDaLista()?.[caso.chave]).toBe(caso.alvo.id);
      nenhumaConsultaAlemDaPagina();
    });

    it("o id aplicado de um inativo ganha nome — o filtro vale, e o campo não finge 'todos'", async () => {
      caso.abrir(endereco(caso.inativo.id));
      await waitFor(() => expect(campo()).toHaveValue(caso.inativo.rotulo));
      expect(caso.consultaDaLista()?.[caso.chave]).toBe(caso.inativo.id);
    });
  }

  it("em 390px: combobox na regra de barra estreita, sem `<select>` de catálogo", async () => {
    const { container } = caso.abrir();
    await waitFor(() => expect(caso.api).toHaveBeenCalled());
    expect(campo().closest(".toolbar__entity")).not.toBeNull();
    expect(container.querySelector(`select#${campo().id}`)).toBeNull();
  });
});

describe("filtro lembrado", () => {
  it("Projetos: o cliente #1001 escolhido volta da sessão com nome, pelo id", async () => {
    const primeira = CASOS[0]!.abrir();
    const campo = () => screen.getByRole("combobox", { name: "Filtrar por cliente" });
    await waitFor(() => expect(listCustomers).toHaveBeenCalled());
    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: CLIENTE_ALVO.code } });
    await waitFor(() =>
      expect(listCustomers).toHaveBeenCalledWith({ active: true, search: CLIENTE_ALVO.code, pageSize: 20 }),
    );
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(CLIENTE_ALVO.code) }));
    await waitFor(() =>
      expect(sessionStorage.getItem(filterStorageKey("u-1", "projects", "customer"))).toBe(
        JSON.stringify(CLIENTE_ALVO.id),
      ),
    );
    primeira.unmount();

    vi.mocked(listCustomers).mockClear();
    vi.mocked(listProjects).mockClear();
    CASOS[0]!.abrir();
    await waitFor(() => expect(campo()).toHaveValue(ROTULO_CLIENTE_ALVO));
    expect(listCustomers).toHaveBeenCalledWith({ ids: [CLIENTE_ALVO.id], pageSize: 1 });
    expect(ultima(listProjects)?.customerId).toBe(CLIENTE_ALVO.id);
  });

  it("Faturamento: escolher o cliente #1001 grava na URL, e o chip o nomeia", async () => {
    const { container } = CASOS[4]!.abrir();
    const campo = () => screen.getByRole("combobox", { name: "Filtrar por cliente" });
    await waitFor(() => expect(listCustomers).toHaveBeenCalled());
    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: CLIENTE_ALVO.code } });
    await waitFor(() =>
      expect(listCustomers).toHaveBeenCalledWith({ search: CLIENTE_ALVO.code, pageSize: 20 }),
    );
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(CLIENTE_ALVO.code) }));

    await waitFor(() => expect(enderecoAtual).toContain(`customerId=${CLIENTE_ALVO.id}`));
    const chips = await waitFor(() => {
      const alvo = container.querySelector(".filter-chips") as HTMLElement | null;
      expect(alvo).not.toBeNull();
      return alvo as HTMLElement;
    });
    expect(within(chips).getByText(new RegExp(ROTULO_CLIENTE_ALVO))).toBeInTheDocument();
  });

  it("Item × Fornecedor: o fornecedor #1001 escolhido fica na sessão", async () => {
    CASOS[5]!.abrir();
    const campo = () => screen.getByRole("combobox", { name: "Filtrar por fornecedor" });
    await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: FORNECEDOR_ALVO.code } });
    await waitFor(() =>
      expect(listSuppliers).toHaveBeenCalledWith({ active: true, search: FORNECEDOR_ALVO.code, pageSize: 20 }),
    );
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(FORNECEDOR_ALVO.code) }));
    await waitFor(() =>
      expect(sessionStorage.getItem(filterStorageKey("u-1", "supplier-items", "supplier"))).toBe(
        JSON.stringify(FORNECEDOR_ALVO.id),
      ),
    );
  });
});

describe("guarda estrutural", () => {
  it.each(CASOS)("$tela: a tela não carrega catálogo de cliente/fornecedor com teto", (caso) => {
    const tela = readFileSync(join(process.cwd(), "src", "pages", ...caso.arquivo.split("/")), "utf8");
    expect(tela).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(tela).not.toMatch(/\blistCustomers\(/);
    expect(tela).toMatch(/<EntityFilterSelect/);
  });
});
