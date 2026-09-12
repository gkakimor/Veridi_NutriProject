import type { CustomerDTO, CustomerOrderDTO, ItemDTO, ProductDTO, SupplierDTO } from "@veridi/shared";
import type { EntityFilterSource } from "../components/filters/EntityFilterSelect";
import type { EntityOption } from "../components/SearchableEntitySelect";
import { getCustomerOrder, listCustomerOrders } from "./customer-orders-api";
import { listCustomers } from "./customers-api";
import { listItems } from "./items-api";
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

/** Fornecedores — filtro de Recebimentos e de Ordens de Compra. */
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

function opcaoDeItem(item: ItemDTO): EntityOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    // A unidade distingue itens de nome parecido controlados de formas
    // diferentes, e é o que a pessoa confere antes de escolher.
    hint: item.unitCode,
  };
}

/** Itens de estoque — filtro de Lotes. Catálogo grande: busca no servidor. */
export const itemFilterSource: EntityFilterSource = {
  inicial: async () => (await listItems({ active: true, pageSize: PAGINA })).items.map(opcaoDeItem),
  buscar: async (termo) => (await listItems({ search: termo, pageSize: PAGINA })).items.map(opcaoDeItem),
  /*
   * `ids` é filtro de identidade do servidor, não busca textual: um item que
   * veio pela URL é encontrado esteja ele na primeira página ou na milésima,
   * e continua sendo encontrado se estiver inativo — um lote antigo aponta
   * para um item que pode já ter saído do catálogo ativo.
   */
  porId: async (id) => {
    const encontrados = (await listItems({ ids: [id], pageSize: 1 })).items;
    const item = encontrados[0];
    return item ? opcaoDeItem(item) : null;
  },
};

function opcaoDeCliente(cliente: CustomerDTO): EntityOption {
  return {
    id: cliente.id,
    code: cliente.code,
    // O mesmo formato dos outros seletores de Cliente: razão social na
    // linha, nome fantasia ao lado, e o CNPJ só para a busca encontrar.
    name: cliente.legalName,
    ...(cliente.tradeName ? { hint: cliente.tradeName } : {}),
    searchTerms: [cliente.tradeName ?? "", cliente.cnpj ?? ""].filter(Boolean).join(" "),
  };
}

/**
 * Clientes — filtro de Pedidos.
 *
 * Substitui `listCustomers({ pageSize: 1000 })` num `<select>`: do cliente
 * 1001 em diante o filtro deixava de oferecer quem existia. `porId` resolve
 * o `?customerId=` que chega do cadastro do Cliente, inclusive de cliente
 * inativo — pedido antigo continua sendo dele.
 */
export const clienteFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listCustomers({ active: true, pageSize: PAGINA })).customers.map(opcaoDeCliente),
  buscar: async (termo) =>
    (await listCustomers({ search: termo, pageSize: PAGINA })).customers.map(opcaoDeCliente),
  porId: async (id) => {
    const encontrados = (await listCustomers({ ids: [id], pageSize: 1 })).customers;
    const cliente = encontrados[0];
    return cliente ? opcaoDeCliente(cliente) : null;
  },
};

function opcaoDePedido(pedido: CustomerOrderDTO): EntityOption {
  return {
    id: pedido.id,
    code: pedido.code,
    // O código diz qual pedido; o cliente diz de quem — é o que se confere.
    name: pedido.customerName ?? "",
  };
}

/**
 * Pedidos do Cliente — filtro de Expedições.
 *
 * A primeira página é a dos pedidos mais recentes; o resto é busca no
 * servidor, por código ou cliente. `porId` pergunta pelo próprio pedido:
 * um `?customerOrderId=` de pedido antigo não está na primeira página.
 */
export const pedidoFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listCustomerOrders({ pageSize: PAGINA })).customerOrders.map(opcaoDePedido),
  buscar: async (termo) =>
    (await listCustomerOrders({ search: termo, pageSize: PAGINA })).customerOrders.map(
      opcaoDePedido,
    ),
  porId: async (id) => {
    try {
      return opcaoDePedido(await getCustomerOrder(id));
    } catch {
      // Pedido que não existe mais: o filtro vale, só o rótulo fica ausente.
      return null;
    }
  },
};
