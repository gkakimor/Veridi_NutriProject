import type { ProductDTO, SupplierDTO } from "@veridi/shared";
import type { EntityFilterSource } from "../components/filters/EntityFilterSelect";
import type { EntityOption } from "../components/SearchableEntitySelect";
import { listProducts } from "./products-api";
import { listSuppliers } from "./suppliers-api";

/**
 * As fontes de opção dos filtros por entidade.
 *
 * Ficam aqui, e não em cada tela, porque duas listagens diferentes filtrando
 * pelo mesmo Produto precisam oferecer o MESMO conjunto — e porque o teto de
 * página é decisão de uma linha que não deve aparecer em quatro arquivos.
 *
 * `PAGINA` é a primeira página, não o catálogo: quem procura fora dela usa
 * `buscar`, que pergunta ao servidor. É a diferença entre um filtro honesto e
 * um `pageSize: 1000` que finge ser completo.
 */

const PAGINA = 20;

function opcaoDeProduto(produto: ProductDTO): EntityOption {
  const cliente = produto.customer;
  return {
    id: produto.id,
    code: produto.code,
    name: produto.name,
    // Produto de private label só se distingue pelo cliente.
    ...(cliente ? { hint: cliente.tradeName ?? cliente.legalName } : {}),
  };
}

/** Produtos ativos — Produto Acabado e Picking/Consumo filtram pelo mesmo. */
export const produtoFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listProducts({ active: true, pageSize: PAGINA })).products.map(opcaoDeProduto),
  buscar: async (termo) =>
    (await listProducts({ search: termo, pageSize: PAGINA })).products.map(opcaoDeProduto),
  /*
   * `productId` é filtro do servidor, não busca por texto: um id que veio da
   * URL é encontrado esteja ele na primeira página ou na milésima. A busca
   * por texto não serve aqui — ninguém digita um UUID.
   */
  porId: async (id) => {
    const encontrados = (await listProducts({ productId: id, pageSize: 1 })).products;
    const produto = encontrados[0];
    return produto ? opcaoDeProduto(produto) : null;
  },
};

function opcaoDeFornecedor(fornecedor: SupplierDTO): EntityOption {
  return {
    id: fornecedor.id,
    code: fornecedor.code,
    name: fornecedor.tradeName ?? fornecedor.legalName,
    // Quem procura digita o nome fantasia OU a razão social.
    searchTerms: fornecedor.legalName,
  };
}

/** Fornecedores — filtro de Recebimentos. */
export const fornecedorFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listSuppliers({ active: true, pageSize: PAGINA })).suppliers.map(opcaoDeFornecedor),
  buscar: async (termo) =>
    (await listSuppliers({ search: termo, pageSize: PAGINA })).suppliers.map(opcaoDeFornecedor),
  porId: async (id) => {
    const encontrados = (await listSuppliers({ ids: [id], pageSize: 1 })).suppliers;
    const fornecedor = encontrados[0];
    return fornecedor ? opcaoDeFornecedor(fornecedor) : null;
  },
};
