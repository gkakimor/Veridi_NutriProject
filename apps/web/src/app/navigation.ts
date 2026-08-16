/**
 * Navegacao base do ERP Veridi.
 * Fonte autoritativa: docs/UI_BRAND.md secao 4.
 *
 * Suporta os Blocos A-C sem redesenho estrutural posterior.
 * Modulos ainda nao implementados aparecem como placeholder.
 * Nao adicionar modulos futuros aqui sem aprovacao explicita.
 */

export interface NavItem {
  label: string;
  path: string;
  /** `false` enquanto o modulo for apenas placeholder de navegacao. */
  implemented: boolean;
}

export interface NavGroup {
  /** `null` para itens de primeiro nivel, sem cabecalho de grupo. */
  title: string | null;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    title: null,
    items: [{ label: "Dashboard", path: "/", implemented: true }],
  },
  {
    title: "Cadastros",
    items: [
      { label: "Clientes", path: "/cadastros/clientes", implemented: true },
      {
        label: "Fornecedores",
        path: "/cadastros/fornecedores",
        implemented: true,
      },
      { label: "Itens", path: "/cadastros/itens", implemented: true },
      { label: "Produtos", path: "/cadastros/produtos", implemented: true },
    ],
  },
  {
    title: "Compras",
    items: [
      {
        label: "Ordens de Compra",
        path: "/compras/ordens",
        implemented: true,
      },
      {
        label: "Recebimentos",
        path: "/compras/recebimentos",
        implemented: true,
      },
    ],
  },
  {
    title: "Comercial",
    items: [
      { label: "Projetos", path: "/comercial/projetos", implemented: true },
      { label: "Pedidos", path: "/comercial/pedidos", implemented: true },
      { label: "Expedições", path: "/comercial/expedicoes", implemented: true },
      { label: "Faturamento", path: "/comercial/faturamento", implemented: true },
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
  {
    title: "Estoque",
    items: [
      { label: "Visão Geral", path: "/estoque", implemented: true },
      { label: "Lotes", path: "/estoque/lotes", implemented: true },
      {
        label: "Movimentações",
        path: "/estoque/movimentacoes",
        implemented: true,
      },
      {
        label: "Materiais de Clientes",
        path: "/estoque/materiais-de-clientes",
        implemented: true,
      },
      {
        label: "Inventário Físico",
        path: "/estoque/inventario",
        implemented: true,
      },
    ],
  },
  {
    title: "Qualidade",
    items: [
      { label: "Documentos / CoA", path: "/qualidade/documentos", implemented: true },
    ],
  },
  {
    title: "Produção",
    items: [
      {
        label: "Formulações",
        path: "/producao/formulacoes",
        implemented: true,
      },
      {
        label: "Ordens de Produção",
        path: "/producao/ordens",
        implemented: true,
      },
      {
        label: "Picking / Consumo",
        path: "/producao/picking",
        implemented: true,
      },
      {
        label: "Produto Acabado",
        path: "/producao/produto-acabado",
        implemented: true,
      },
    ],
  },
  {
    title: null,
    items: [{ label: "Relatórios", path: "/relatorios", implemented: true }],
  },
];

/** Todos os itens de navegacao em lista plana. */
export const navItems: NavItem[] = navigation.flatMap((group) => group.items);
