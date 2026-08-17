/**
 * Navegação do ERP Veridi.
 *
 * A ordem segue o FLUXO DE TRABALHO da fábrica (comercial → produção →
 * compras → estoque → qualidade), não a ordem em que os módulos foram
 * implementados. Cadastro, gestão e administração ficam no fim: são
 * consulta e configuração, não operação diária.
 */

export interface NavItem {
  label: string;
  path: string;
  /** `false` enquanto o módulo for apenas placeholder de navegação. */
  implemented: boolean;
}

export interface NavGroup {
  /** `null` para itens de primeiro nível, sem cabeçalho de grupo. */
  title: string | null;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    title: null,
    items: [{ label: "Dashboard", path: "/", implemented: true }],
  },
  {
    title: "Comercial",
    items: [
      { label: "Projetos", path: "/comercial/projetos", implemented: true },
      { label: "Amostras", path: "/comercial/amostras", implemented: true },
      { label: "Pedidos", path: "/comercial/pedidos", implemented: true },
      { label: "Expedições", path: "/comercial/expedicoes", implemented: true },
      { label: "Faturamento", path: "/comercial/faturamento", implemented: true },
    ],
  },
  {
    title: "Produção",
    items: [
      { label: "Ordens de Produção", path: "/producao/ordens", implemented: true },
      { label: "Picking / Consumo", path: "/producao/picking", implemented: true },
      { label: "Formulações", path: "/producao/formulacoes", implemented: true },
      { label: "Produto Acabado", path: "/producao/produto-acabado", implemented: true },
    ],
  },
  {
    title: "Compras",
    items: [
      { label: "Ordens de Compra", path: "/compras/ordens", implemented: true },
      { label: "Recebimentos", path: "/compras/recebimentos", implemented: true },
      { label: "Item × Fornecedor", path: "/compras/item-fornecedor", implemented: true },
    ],
  },
  {
    title: "Estoque",
    items: [
      { label: "Posição de Estoque", path: "/estoque", implemented: true },
      { label: "Lotes", path: "/estoque/lotes", implemented: true },
      { label: "Movimentações", path: "/estoque/movimentacoes", implemented: true },
      { label: "Materiais de Clientes", path: "/estoque/materiais-de-clientes", implemented: true },
      { label: "Inventário Físico", path: "/estoque/inventario", implemented: true },
    ],
  },
  {
    title: "Qualidade",
    items: [{ label: "Documentos / CoA", path: "/qualidade/documentos", implemented: true }],
  },
  {
    title: "Cadastros",
    items: [
      { label: "Clientes", path: "/cadastros/clientes", implemented: true },
      { label: "Fornecedores", path: "/cadastros/fornecedores", implemented: true },
      { label: "Itens", path: "/cadastros/itens", implemented: true },
      { label: "Produtos", path: "/cadastros/produtos", implemented: true },
    ],
  },
  {
    title: "Gestão",
    items: [
      { label: "Relatórios", path: "/relatorios", implemented: true },
      {
        label: "Recursos Industriais",
        path: "/gestao/recursos-industriais",
        implemented: true,
      },
      { label: "Precificação", path: "/gestao/precificacao", implemented: true },
    ],
  },
  {
    title: "Administração",
    items: [
      { label: "Usuários", path: "/administracao/usuarios", implemented: true },
      {
        label: "Documentos controlados",
        path: "/administracao/documentos",
        implemented: true,
      },
    ],
  },
];

/** Todos os itens de navegação em lista plana. */
export const navItems: NavItem[] = navigation.flatMap((group) => group.items);
