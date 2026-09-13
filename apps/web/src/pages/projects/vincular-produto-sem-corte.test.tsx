import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductDTO, ProjectProductDTO } from "@veridi/shared";
import type { ListProductsParams } from "../../lib/products-api";

/**
 * Vincular produto existente ao projeto — sem corte (SELECTOR-CUTOFF-WAVE-01).
 *
 * O seletor pedia `listProducts({ customerId, pageSize: 1000 })`: do produto
 * 1001 do cliente em diante ele existia, o backend aceitaria o vínculo, e o
 * campo não o achava. Agora: primeira página de 20, busca no servidor sempre
 * com o cliente do projeto, o que já está no projeto continua fora da lista,
 * e o escolhido que sai do catálogo volta pelo id. A regra do vínculo (mesmo
 * cliente) continua no backend; aqui só se prova que a tela pergunta certo.
 */

vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../lib/projects-api", () => ({ createProjectProduct: vi.fn(), linkProjectProduct: vi.fn() }));

import { listProducts } from "../../lib/products-api";
import { linkProjectProduct } from "../../lib/projects-api";
import { ProjectProductsSection } from "./ProjectProductsSection";

const PAGINA = 20;
const RUIDO = 1000;
const CLIENTE_A = "cli-a";
const CLIENTE_B = "cli-b";

function produto(numero: number, extra: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: `prod-${numero}`,
    code: `PROD-${String(numero).padStart(6, "0")}`,
    name: `Produto de Volume ${String(numero).padStart(4, "0")}`,
    customerId: CLIENTE_A,
    customer: null,
    lifecycle: "DEVELOPMENT",
    active: true,
    ...extra,
  } as unknown as ProductDTO;
}

const ALVO = produto(RUIDO + 1, { name: "Pré-Treino Zeta Alvo", lifecycle: "APPROVED" });
const DE_OUTRO_CLIENTE = produto(RUIDO + 2, { name: "Pré-Treino Zeta de Outro Cliente", customerId: CLIENTE_B });
const JA_VINCULADO = produto(RUIDO + 3, { name: "Pré-Treino Zeta Já no Projeto" });
const UNIVERSO = [
  ...Array.from({ length: RUIDO }, (_, indice) => produto(indice + 1)),
  ALVO,
  DE_OUTRO_CLIENTE,
  JA_VINCULADO,
];

function servidor(params: ListProductsParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.customerId || registro.customerId === params.customerId)
    .filter((registro) => !params.productId || registro.id === params.productId)
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo))
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { products: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

function vinculo(product: ProductDTO): ProjectProductDTO {
  return {
    id: `pp-${product.id}`,
    projectId: "prj-1",
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    productLifecycle: product.lifecycle,
    productActive: true,
    sequence: 1,
    status: "ACTIVE",
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
  } as unknown as ProjectProductDTO;
}

const onChanged = vi.fn();

function secao(products: ProjectProductDTO[] = [vinculo(JA_VINCULADO)]) {
  return (
    <MemoryRouter>
      <ProjectProductsSection
        projectId="prj-1"
        customerId={CLIENTE_A}
        products={products}
        editable
        projectStatus="SAMPLE"
        onChanged={onChanged}
      />
    </MemoryRouter>
  );
}

const campo = () => screen.getByRole("combobox", { name: "Produto existente" }) as HTMLInputElement;
const rotuloDoAlvo = `${ALVO.code} · ${ALVO.name}`;
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });

async function abrirVinculo() {
  fireEvent.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
  fireEvent.click(screen.getByRole("button", { name: "Vincular produto existente" }));
  await waitFor(() => expect(listProducts).toHaveBeenCalledWith({ customerId: CLIENTE_A, pageSize: PAGINA }));
}

async function buscar(termo: string) {
  fireEvent.focus(campo());
  fireEvent.change(campo(), { target: { value: termo } });
  await waitFor(() =>
    expect(listProducts).toHaveBeenCalledWith({ customerId: CLIENTE_A, search: termo, pageSize: PAGINA }),
  );
}

/** Toda pergunta de produto: página do seletor e SEMPRE o cliente do projeto. */
function perguntasDentroDoCliente() {
  const chamadas = vi.mocked(listProducts).mock.calls;
  expect(chamadas.length).toBeGreaterThan(0);
  for (const [params] of chamadas) {
    expect(params?.pageSize ?? 20).toBeLessThanOrEqual(PAGINA);
    expect(params?.customerId).toBe(CLIENTE_A);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProducts).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(linkProjectProduct).mockResolvedValue({} as never);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 1000 do cliente não alcançavam o produto #1001", () => {
    const antigos = servidor({ customerId: CLIENTE_A, pageSize: 1000 }).products;
    expect(antigos).toHaveLength(RUIDO);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
  });
});

describe("Vincular produto existente — busca no servidor", () => {
  it("abre com a primeira página do cliente — 20 — e o resto se alcança buscando", async () => {
    render(secao());
    await abrirVinculo();

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA));
    expect(within(lista).queryByRole("option", opcaoDe(ALVO.code))).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    expect(listProducts).toHaveBeenCalledTimes(1);
    perguntasDentroDoCliente();
  });

  it("produto #1001 achado pelo código, escolhido e vinculado", async () => {
    render(secao());
    await abrirVinculo();
    await buscar(ALVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    await waitFor(() => expect(campo()).toHaveValue(rotuloDoAlvo));

    fireEvent.click(screen.getByRole("button", { name: "Vincular produto" }));
    await waitFor(() => expect(linkProjectProduct).toHaveBeenCalledWith("prj-1", ALVO.id));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    perguntasDentroDoCliente();
  });

  it("depois de vincular, o projeto recarregado mostra o produto #1001 na tabela", async () => {
    const { rerender } = render(secao());
    await abrirVinculo();
    await buscar(ALVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    fireEvent.click(screen.getByRole("button", { name: "Vincular produto" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    // `onChanged` recarrega o projeto; o vínculo volta do servidor com nome.
    rerender(secao([vinculo(JA_VINCULADO), vinculo(ALVO)]));
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByRole("link", { name: new RegExp(ALVO.name) })).toBeInTheDocument();
  });

  it("filtros do vínculo preservados: produto de outro cliente e o que já está no projeto ficam fora", async () => {
    render(secao());
    await abrirVinculo();
    await buscar("Zeta");
    expect(await screen.findByRole("option", opcaoDe(ALVO.code))).toBeInTheDocument();
    expect(screen.queryByRole("option", opcaoDe(DE_OUTRO_CLIENTE.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(JA_VINCULADO.code))).toBeNull();
    perguntasDentroDoCliente();
  });
});

describe("Vincular produto existente — escolhido fora do catálogo, pelo id", () => {
  it("sair e voltar a Vincular recarrega a página; o #1001 escolhido volta pelo id, a cada vez", async () => {
    render(secao());
    await abrirVinculo();
    await buscar(ALVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    await waitFor(() => expect(campo()).toHaveValue(rotuloDoAlvo));

    const perguntasPeloId = () =>
      vi.mocked(listProducts).mock.calls.filter(([params]) => params?.productId === ALVO.id);

    for (const vez of [1, 2]) {
      fireEvent.click(screen.getByRole("button", { name: "Criar novo produto" }));
      fireEvent.click(screen.getByRole("button", { name: "Vincular produto existente" }));
      await waitFor(() => expect(perguntasPeloId()).toHaveLength(vez));
      await waitFor(() => expect(campo()).toHaveValue(rotuloDoAlvo));
    }
    expect(perguntasPeloId()[0]![0]).toEqual({ customerId: CLIENTE_A, productId: ALVO.id, pageSize: 1 });
    expect((screen.getByRole("button", { name: "Vincular produto" }) as HTMLButtonElement).disabled).toBe(false);
    perguntasDentroDoCliente();
  });
});

describe("guarda estrutural", () => {
  it("a seção não carrega catálogo com teto", () => {
    const fonte = readFileSync(join(process.cwd(), "src", "pages", "projects", "ProjectProductsSection.tsx"), "utf8");
    expect(fonte).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(fonte).toMatch(/onSearch=\{buscarProdutos\}/);
  });
});
