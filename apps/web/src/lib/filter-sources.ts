import type {
  CustomerDTO,
  CustomerOrderDTO,
  ItemDTO,
  ProductDTO,
  ProductionOrderDTO,
  ProjectDTO,
  PurchaseOrderDTO,
  SupplierDTO,
} from "@veridi/shared";
import { PURCHASE_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { EntityFilterSource } from "../components/filters/EntityFilterSelect";
import type { EntityOption } from "../components/SearchableEntitySelect";
import { getCustomerOrder, listCustomerOrders } from "./customer-orders-api";
import { listCustomers } from "./customers-api";
import { listItems } from "./items-api";
import type { ListItemsParams } from "./items-api";
import { listProducts } from "./products-api";
import { getProductionOrder, listProductionOrders } from "./production-orders-api";
import { getProject, listProjects } from "./projects-api";
import { getPurchaseOrder, listPurchaseOrders } from "./purchase-orders-api";
import { getInternalConsumptionReportFilterOptions } from "./reports-api";
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

/** Fornecedores — filtro de Recebimentos, de Ordens de Compra e dos relatórios de Compras. */
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

/**
 * Fornecedores ATIVOS — filtro de Item × Fornecedor.
 *
 * Substitui `listSuppliers({ active: true, pageSize: 1000 })` num `<select>`:
 * do fornecedor ativo 1001 em diante a barra não o oferecia. Primeira página
 * e busca continuam só entre ativos — o universo desta barra sempre foi esse,
 * e trocar o componente não o amplia. `porId` só dá nome ao fornecedor que já
 * está aplicado (link do cadastro, filtro lembrado), ativo ou não: sem ele o
 * campo diria "Todos os fornecedores" com a lista filtrada.
 */
export const fornecedorAtivoFilterSource: EntityFilterSource = {
  inicial: fornecedorFilterSource.inicial,
  buscar: async (termo) =>
    (await listSuppliers({ active: true, search: termo, pageSize: PAGINA })).suppliers.map(
      opcaoDeFornecedor,
    ),
  porId: fornecedorFilterSource.porId,
};

/**
 * Fornecedores ATIVOS da tela Item × Fornecedor, com a primeira página dividida
 * entre a barra e o formulário de nova relação (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * Os dois abrem com a MESMA página — 20 ativos — e cada um a pedia por conta
 * própria: duas consultas idênticas a cada montagem da listagem, com o
 * formulário aberto ou não. Agora ela sai uma vez: `primeiraPagina` entrega os
 * fornecedores ao formulário e `source` entrega as opções à barra. Busca e nome
 * pelo id continuam os de `fornecedorAtivoFilterSource`, sempre no servidor.
 *
 * É fábrica, e não literal: criar dentro de `useMemo`, uma por montagem — nada
 * fica guardado de uma tela para a próxima. Pedido que falhou não fica guardado:
 * quem perguntar depois pergunta de novo, em vez de herdar o erro.
 */
export function fornecedoresAtivosDaTela(): {
  primeiraPagina: () => Promise<SupplierDTO[]>;
  source: EntityFilterSource;
} {
  let pedido: Promise<SupplierDTO[]> | null = null;
  const primeiraPagina = () => {
    pedido ??= listSuppliers({ active: true, pageSize: PAGINA })
      .then((resultado) => resultado.suppliers)
      .catch((erro: unknown) => {
        pedido = null;
        throw erro;
      });
    return pedido;
  };
  return {
    primeiraPagina,
    source: {
      ...fornecedorAtivoFilterSource,
      inicial: async () => (await primeiraPagina()).map(opcaoDeFornecedor),
    },
  };
}

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

/**
 * Itens de uso e consumo — filtro do R-21. O tipo vai ao servidor, como na
 * tela de Uso e consumo, e inativo entra: o relatório é histórico, e o item
 * descontinuado continua tendo consumo no período.
 */
export const itemDeUsoEConsumoFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listItems({ type: "INTERNAL_CONSUMABLE", pageSize: PAGINA })).items.map(opcaoDeItemDeUsoEConsumo),
  buscar: async (termo) =>
    (await listItems({ type: "INTERNAL_CONSUMABLE", search: termo, pageSize: PAGINA })).items.map(
      opcaoDeItemDeUsoEConsumo,
    ),
  porId: itemFilterSource.porId,
};

function opcaoDeItemDeUsoEConsumo(item: ItemDTO): EntityOption {
  const opcao = opcaoDeItem(item);
  return item.active ? opcao : { ...opcao, hint: `${item.unitCode} · Item inativo` };
}

/**
 * Quem registrou consumo interno — o "Usuário" do R-21. Não é o cadastro de
 * usuários (esse só o ADMIN lê): são as opções do próprio relatório, só de
 * quem já registrou. É também o que dá nome ao filtro no PDF.
 */
export const usuarioDoConsumoInternoFilterSource: EntityFilterSource = {
  inicial: async () => (await getInternalConsumptionReportFilterOptions()).users.map(opcaoDeUsuario),
  buscar: async (termo) => {
    const procurado = termo.trim().toLocaleLowerCase("pt-BR");
    return (await getInternalConsumptionReportFilterOptions()).users
      .filter((usuario) => usuario.name.toLocaleLowerCase("pt-BR").includes(procurado))
      .map(opcaoDeUsuario);
  },
  porId: async (id) => {
    const usuario = (await getInternalConsumptionReportFilterOptions()).users.find((candidato) => candidato.id === id);
    return usuario ? opcaoDeUsuario(usuario) : null;
  },
};

/** Usuário não tem código de negócio: a opção é o nome. */
function opcaoDeUsuario(usuario: { id: string; name: string }): EntityOption {
  return { id: usuario.id, code: "", name: usuario.name };
}

/**
 * Itens que podem entrar como material do cliente — seletor das linhas do
 * Receber material do cliente.
 *
 * Substitui duas listas de 1000 (matéria-prima e embalagem) somadas num
 * `<select>`: do item 1001 de cada tipo em diante o material existia, o
 * servidor aceitaria o recebimento, e a tela não o oferecia. Quais tipos
 * entram é o servidor quem diz (`customerSupplied`), com a mesma regra que ele
 * aplica ao gravar; inativo continua fora, como sempre esteve nesta tela.
 *
 * Não depende do cliente escolhido: Item não tem dono. Dono é o lote, que o
 * servidor cria com o cliente do recebimento.
 *
 * É fábrica, e não literal, porque a linha precisa do que a opção não carrega
 * — unidade e controle de lote: `lembrar` recebe os itens que o servidor
 * devolveu. Criar dentro de `useMemo`: a primeira página sai uma vez só para
 * todas as linhas da tela.
 */
export function itemMaterialDoClienteSource(
  lembrar: (itens: ItemDTO[]) => void,
): EntityFilterSource {
  async function pedir(filtros: Pick<ListItemsParams, "search" | "ids" | "pageSize">) {
    const { items } = await listItems({
      customerSupplied: true,
      active: true,
      pageSize: PAGINA,
      ...filtros,
    });
    lembrar(items);
    return items.map(opcaoDeItem);
  }

  let primeiraPagina: Promise<EntityOption[]> | null = null;
  return {
    inicial: () => {
      primeiraPagina ??= pedir({}).catch((erro: unknown) => {
        // Falhou: a próxima linha pergunta de novo, em vez de herdar o erro.
        primeiraPagina = null;
        throw erro;
      });
      return primeiraPagina;
    },
    buscar: (termo) => pedir({ search: termo }),
    /*
     * Pelo id, com os MESMOS filtros: o item de uma linha restaurada é achado
     * esteja ele na primeira página ou na milésima — e o que deixou de poder
     * entrar (inativado no meio do caminho) não volta como se ainda pudesse.
     */
    porId: async (id) => (await pedir({ ids: [id], pageSize: 1 }))[0] ?? null,
  };
}

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
 * Clientes — filtro de Pedidos, Produtos, Faturamento e dos relatórios
 * Comerciais e de Faturamento.
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

/**
 * Clientes ATIVOS — filtro de Projetos, Amostras e Materiais de Clientes.
 *
 * Substitui `listCustomers({ active: true, pageSize: 1000 })` (em Amostras,
 * 100) num `<select>`: do cliente ativo 1001 em diante a barra não o
 * oferecia. Primeira página e busca continuam só entre ativos — o universo
 * dessas barras sempre foi esse, e trocar o componente não o amplia. `porId`
 * só dá nome ao cliente que já está aplicado (link do cadastro, filtro
 * lembrado), ativo ou não: sem ele o campo diria "Todos os clientes" com a
 * lista filtrada.
 */
export const clienteAtivoFilterSource: EntityFilterSource = {
  inicial: clienteFilterSource.inicial,
  buscar: async (termo) =>
    (await listCustomers({ active: true, search: termo, pageSize: PAGINA })).customers.map(
      opcaoDeCliente,
    ),
  porId: clienteFilterSource.porId,
};

function opcaoDeProjeto(projeto: ProjectDTO): EntityOption {
  return {
    id: projeto.id,
    code: projeto.code,
    name: projeto.name,
    // O mesmo nome de projeto se repete entre clientes: o cliente distingue.
    hint: projeto.customerName,
    searchTerms: projeto.customerName,
  };
}

/**
 * Projetos — filtro da lista geral de Orçamentos (QUOTES-HUB-01).
 *
 * A primeira página é a dos projetos mais recentes; o resto é busca no
 * servidor, por código, nome ou cliente, em qualquer situação — orçamento de
 * projeto cancelado continua sendo consultável. `porId` pergunta pelo próprio
 * projeto: um `?projectId=` antigo não está na primeira página.
 */
export const projetoFilterSource: EntityFilterSource = {
  inicial: async () => (await listProjects({ pageSize: PAGINA })).projects.map(opcaoDeProjeto),
  buscar: async (termo) =>
    (await listProjects({ search: termo, pageSize: PAGINA })).projects.map(opcaoDeProjeto),
  porId: async (id) => {
    try {
      return opcaoDeProjeto(await getProject(id));
    } catch {
      // Projeto que não existe mais: o filtro vale, só o rótulo fica ausente.
      return null;
    }
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
 * Pedidos do Cliente — filtro de Expedições e seletor do R-14.
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

function opcaoDeOrdemDeProducao(ordem: ProductionOrderDTO): EntityOption {
  return {
    id: ordem.id,
    code: ordem.code,
    // O código diz qual OP; o produto diz o quê — é o que se confere.
    name: ordem.productName,
  };
}

/**
 * Ordens de Produção — seletor da Rastreabilidade por OP (R-06).
 *
 * Substitui `listProductionOrders({ pageSize: 100 })` num `<select>`: da OP
 * 101 em diante a genealogia deixava de ser consultável pela tela, sem aviso.
 * A primeira página é a das OPs mais recentes; o resto é busca no servidor,
 * por código da OP ou produto, em qualquer status — rastrear é olhar para
 * trás, e OP concluída é justamente a que mais se consulta.
 */
export const ordemDeProducaoFilterSource: EntityFilterSource = {
  inicial: async () =>
    (await listProductionOrders({ pageSize: PAGINA })).productionOrders.map(opcaoDeOrdemDeProducao),
  buscar: async (termo) =>
    (await listProductionOrders({ search: termo, pageSize: PAGINA })).productionOrders.map(
      opcaoDeOrdemDeProducao,
    ),
  porId: async (id) => {
    try {
      return opcaoDeOrdemDeProducao(await getProductionOrder(id));
    } catch {
      // OP que não existe mais: a consulta vale, só o rótulo fica ausente.
      return null;
    }
  },
};

function opcaoDeOrdemDeCompra(ordem: PurchaseOrderDTO): EntityOption {
  return {
    id: ordem.id,
    code: ordem.code,
    // O código diz qual OC; o fornecedor diz de quem — é o que se confere na doca.
    name: ordem.supplierName,
    // Quem chega com o resto de uma entrega procura a recebida parcialmente.
    hint: PURCHASE_ORDER_STATUS_LABELS[ordem.status],
  };
}

/**
 * Ordens de Compra que podem receber material — seletor do Receber OC.
 *
 * Substitui duas listas de 100 (`ORDERED` e `PARTIALLY_RECEIVED`) somadas num
 * `<select>`: da OC 101 de cada status em diante a ordem estava aberta e não
 * era recebível pela tela, sem aviso. Quais status recebem é o servidor quem
 * diz (`receivable`), com a mesma regra que ele aplica ao gravar o
 * recebimento — a tela não repete a lista. A busca vai ao servidor, por
 * código da OC ou fornecedor.
 */
export const ordemDeCompraParaReceberSource: EntityFilterSource = {
  inicial: async () =>
    (await listPurchaseOrders({ receivable: true, pageSize: PAGINA })).purchaseOrders.map(
      opcaoDeOrdemDeCompra,
    ),
  buscar: async (termo) =>
    (await listPurchaseOrders({ receivable: true, search: termo, pageSize: PAGINA })).purchaseOrders.map(
      opcaoDeOrdemDeCompra,
    ),
  porId: async (id) => {
    try {
      return opcaoDeOrdemDeCompra(await getPurchaseOrder(id));
    } catch {
      // OC que não existe mais: só o rótulo fica ausente.
      return null;
    }
  },
};
