import type { UserRole } from "@veridi/shared";
import type { NavIconName } from "./nav-icons";

/**
 * Navegação do ERP Veridi.
 *
 * A ordem segue o FLUXO DE TRABALHO da fábrica (comercial → produção →
 * compras → estoque → qualidade), não a ordem em que os módulos foram
 * implementados. Cadastros, gestão, modelos e administração ficam no fim: são
 * consulta e configuração, não operação diária.
 *
 * O `id` de item e de grupo é o que a preferência do usuário grava (favoritos,
 * grupos abertos). Ele NUNCA acompanha o rótulo: renomear "Consulta de
 * Cliente" para "Visão do Cliente" não pode apagar o favorito de ninguém. Id
 * que deixou de existir numa versão futura é simplesmente ignorado na
 * leitura. Mover item de seção não muda URL — os deep links continuam.
 */

export interface NavItem {
  /** Estável, kebab-case. Nunca reaproveitar o id de uma tela removida. */
  id: string;
  label: string;
  path: string;
  /** `false` enquanto o módulo for apenas placeholder de navegação. */
  implemented: boolean;
  /**
   * Perfis que enxergam a entrada. Ausente = todo usuário autenticado.
   *
   * Não é regra nova: espelha o gate que a API JÁ aplica na leitura da tela.
   * A entrada some só onde a tela devolveria 403 — e some igual no menu, na
   * busca e nos favoritos.
   */
  roles?: readonly UserRole[];
  /** Outros nomes pelos quais a pessoa procura a tela na busca de telas. */
  aliases?: readonly string[];
}

export interface NavGroup {
  id: string;
  title: string;
  icon: NavIconName;
  items: NavItem[];
}

/** Primeiro nível, sem grupo: sempre à vista, no topo. */
export const dashboardItem: NavItem = { id: "dashboard", label: "Painel", path: "/", implemented: true };

export const navGroups: NavGroup[] = [
  {
    id: "commercial",
    title: "Comercial",
    icon: "commercial",
    items: [
      /*
       * Visão do Cliente abre o Comercial: acompanhar um cliente através dos
       * módulos é o ponto de partida de quem atende. Continua sendo consulta —
       * a operação segue sendo feita nos módulos.
       */
      {
        id: "customer-view",
        label: "Visão do Cliente",
        path: "/consultas/clientes",
        implemented: true,
        aliases: ["consulta de cliente", "consulta do cliente"],
      },
      {
        id: "projects",
        label: "Projetos",
        path: "/comercial/projetos",
        implemented: true,
        aliases: ["orçamento", "cotação"],
      },
      { id: "samples", label: "Amostras", path: "/comercial/amostras", implemented: true },
      {
        id: "customer-orders",
        label: "Pedidos",
        path: "/comercial/pedidos",
        implemented: true,
        aliases: ["pedido de venda", "venda"],
      },
      {
        id: "shipments",
        label: "Expedições",
        path: "/comercial/expedicoes",
        implemented: true,
        aliases: ["expedição", "entrega", "envio"],
      },
      {
        id: "billing",
        label: "Faturamento",
        path: "/comercial/faturamento",
        implemented: true,
        aliases: ["fatura", "nota fiscal"],
      },
    ],
  },
  {
    id: "production",
    title: "Produção",
    icon: "production",
    items: [
      {
        id: "production-orders",
        label: "Ordens de Produção",
        path: "/producao/ordens",
        implemented: true,
        aliases: ["op", "ordem de produção"],
      },
      {
        id: "picking",
        label: "Picking / Consumo",
        path: "/producao/picking",
        implemented: true,
        aliases: ["separação", "consumo"],
      },
      {
        id: "formulations",
        label: "Formulações",
        path: "/producao/formulacoes",
        implemented: true,
        aliases: ["formulação", "fórmula", "receita"],
      },
    ],
  },
  /*
   * Planejamento vem depois de Produção porque é o roteiro DELA: como cada
   * produto costuma ser produzido. Não é a Formulação (o que entra) nem a
   * Estrutura de Custos (quanto custa), e por isso não mora em Modelos.
   */
  {
    id: "planning",
    title: "Planejamento",
    icon: "planning",
    items: [
      {
        id: "production-profiles",
        label: "Perfis de Produção",
        path: "/planejamento/perfis-producao",
        implemented: true,
        aliases: ["perfil de produção", "roteiro", "etapas de produção", "planejamento"],
      },
    ],
  },
  {
    id: "purchasing",
    title: "Compras",
    icon: "purchasing",
    items: [
      {
        id: "purchase-orders",
        label: "Ordens de Compra",
        path: "/compras/ordens",
        implemented: true,
        aliases: ["oc", "ordem de compra", "pedido de compra"],
      },
      {
        id: "receipts",
        label: "Recebimentos",
        path: "/compras/recebimentos",
        implemented: true,
        aliases: ["recebimento", "entrada de material"],
      },
      {
        id: "supplier-items",
        label: "Item × Fornecedor",
        path: "/compras/item-fornecedor",
        implemented: true,
        aliases: ["item fornecedor", "oferta de fornecedor"],
      },
    ],
  },
  {
    id: "inventory",
    title: "Estoque",
    icon: "inventory",
    items: [
      {
        id: "stock-position",
        label: "Posição de Estoque",
        path: "/estoque",
        implemented: true,
        aliases: ["saldo"],
      },
      { id: "lots", label: "Lotes", path: "/estoque/lotes", implemented: true, aliases: ["lote"] },
      /*
       * Não é cadastro: é a lista dos lotes que saíram de Ordem de Produção
       * (`origin = PRODUCTION`), com saldo do ledger. Mesma natureza de
       * "Materiais de Clientes" — uma leitura filtrada de lotes —, por isso
       * mora em Estoque. O cadastro mestre é Cadastros › Produtos Acabados.
       * A URL antiga continua a mesma.
       */
      {
        id: "finished-goods",
        label: "Lotes de Produto Acabado",
        path: "/producao/produto-acabado",
        implemented: true,
        aliases: ["produto acabado", "lotes produzidos"],
      },
      {
        id: "stock-movements",
        label: "Movimentações",
        path: "/estoque/movimentacoes",
        implemented: true,
        aliases: ["movimentação", "histórico de estoque"],
      },
      {
        id: "customer-materials",
        label: "Materiais de Clientes",
        path: "/estoque/materiais-de-clientes",
        implemented: true,
        aliases: ["material do cliente"],
      },
      {
        id: "stock-count",
        label: "Inventário Físico",
        path: "/estoque/inventario",
        implemented: true,
        aliases: ["contagem", "inventário"],
      },
    ],
  },
  {
    id: "quality",
    title: "Qualidade",
    icon: "quality",
    /*
     * "Liberação de lotes" é a mesma lista de Lotes, já filtrada — a tela lê
     * `?status=` da URL. Sem ela, quem abria Qualidade concluía que liberar
     * lote morava em outro lugar.
     *
     * "Documentos controlados" é o registro de revisão dos documentos GMP
     * impressos (R.PRO.002, R.COQ.003: elaborado por, aprovado por,
     * revisão ativa) — controle documental do sistema da qualidade. Mudou de
     * seção sem mudar a URL; registrar e ativar revisão é da Qualidade e do
     * ADMIN (QUALITY-DOC-WRITE-01).
     */
    items: [
      {
        id: "quality-documents",
        label: "Documentos / CoA",
        path: "/qualidade/documentos",
        implemented: true,
        aliases: ["laudo", "coa", "certificado de análise"],
      },
      {
        id: "lot-release",
        label: "Liberação de lotes",
        path: "/estoque/lotes?status=AWAITING_RELEASE",
        implemented: true,
        aliases: ["liberar lote", "quarentena", "aguardando liberação"],
      },
      {
        id: "controlled-documents",
        label: "Documentos controlados",
        path: "/administracao/documentos",
        implemented: true,
        aliases: ["revisão de documento", "R.PRO.002", "R.COQ.003"],
      },
    ],
  },
  {
    id: "master-data",
    title: "Cadastros",
    icon: "master-data",
    items: [
      { id: "customers", label: "Clientes", path: "/cadastros/clientes", implemented: true },
      { id: "suppliers", label: "Fornecedores", path: "/cadastros/fornecedores", implemented: true },
      {
        id: "stock-items",
        label: "Itens de estoque",
        path: "/cadastros/itens",
        implemented: true,
        aliases: ["matéria-prima", "embalagem", "insumo"],
      },
      {
        id: "products",
        label: "Produtos Acabados",
        path: "/cadastros/produtos",
        implemented: true,
        aliases: ["produto", "cadastro de produto"],
      },
    ],
  },
  {
    id: "management",
    title: "Gestão",
    icon: "management",
    items: [
      { id: "reports", label: "Relatórios", path: "/relatorios", implemented: true, aliases: ["relatório"] },
      /* `GET /pricing-versions` só responde a Comercial, Compras e ADMIN. */
      {
        id: "pricing",
        label: "Precificação",
        path: "/gestao/precificacao",
        implemented: true,
        roles: ["COMMERCIAL", "PURCHASING", "ADMIN"],
        aliases: ["preço", "tabela de preço"],
      },
    ],
  },
  {
    id: "models-parameters",
    title: "Modelos e Parâmetros",
    icon: "models",
    items: [
      {
        id: "formulation-templates",
        label: "Modelos de Formulação",
        path: "/producao/templates-formulacao",
        implemented: true,
        aliases: ["template de formulação"],
      },
      {
        id: "industrial-resources",
        label: "Recursos Industriais",
        path: "/gestao/recursos-industriais",
        implemented: true,
        aliases: ["máquina", "equipamento", "mão de obra"],
      },
      {
        id: "cost-templates",
        label: "Modelos de Estrutura de Custo",
        path: "/gestao/templates-estrutura",
        implemented: true,
        aliases: ["template de estrutura", "estrutura de custo"],
      },
      {
        id: "pricing-policies",
        label: "Políticas de Precificação",
        path: "/gestao/politicas-precificacao",
        implemented: true,
        aliases: ["política de preço", "margem", "markup"],
      },
    ],
  },
  {
    id: "administration",
    title: "Administração",
    icon: "administration",
    items: [
      /* `GET /users` é só ADMIN. */
      {
        id: "users",
        label: "Usuários",
        path: "/administracao/usuarios",
        implemented: true,
        roles: ["ADMIN"],
        aliases: ["usuário", "senha", "perfil de acesso"],
      },
    ],
  },
];

/** Todos os itens de navegação em lista plana — Painel incluído. */
export const navItems: NavItem[] = [dashboardItem, ...navGroups.flatMap((group) => group.items)];

export function canSeeNavItem(item: NavItem, role: UserRole | null): boolean {
  if (!item.roles) return true;
  return role !== null && item.roles.includes(role);
}

/** Grupos com os itens que o perfil enxerga. Grupo que fica vazio não aparece. */
export function visibleNavGroups(role: UserRole | null): NavGroup[] {
  return navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSeeNavItem(item, role)) }))
    .filter((group) => group.items.length > 0);
}

function basePath(path: string): string {
  return path.split("?")[0] ?? path;
}

function queryOf(path: string): string | null {
  const query = path.split("?")[1];
  return query ? `?${query}` : null;
}

/**
 * Casar por prefixo é o certo quando a subrota NÃO tem item próprio
 * ("/compras/ordens/:id" sob "Ordens de Compra"), mas acende dois itens ao
 * mesmo tempo quando um é prefixo do outro ("/estoque" e "/estoque/lotes").
 * Nesse segundo caso o item mais curto exige match exato.
 */
function needsExactMatch(path: string): boolean {
  if (path === "/") return true;
  const base = basePath(path);
  return navItems.some((other) => other.path !== path && basePath(other.path).startsWith(`${base}/`));
}

/**
 * Item ativo para a URL atual.
 *
 * Dois itens podem apontar para a MESMA tela com filtros diferentes — "Lotes"
 * e "Liberação de lotes" (`/estoque/lotes?status=AWAITING_RELEASE`). Item COM
 * query só acende quando a query da URL bate; item SEM query cede a vez
 * quando outro item do mesmo endereço casa a query — senão o menu indicaria
 * dois lugares para uma navegação só.
 */
export function isNavItemActive(item: NavItem, pathname: string, search: string): boolean {
  const base = basePath(item.path);
  const casa = needsExactMatch(item.path)
    ? pathname === base
    : pathname === base || pathname.startsWith(`${base}/`);
  if (!casa) return false;

  const query = queryOf(item.path);
  if (query) return query === search;
  return !navItems.some(
    (other) => other.path !== item.path && basePath(other.path) === pathname && queryOf(other.path) === search,
  );
}

/** Item e grupo da tela atual, entre os que o perfil enxerga. */
export function findActiveNavItem(
  groups: NavGroup[],
  pathname: string,
  search: string,
): { item: NavItem; group: NavGroup } | null {
  for (const group of groups) {
    const item = group.items.find((candidate) => isNavItemActive(candidate, pathname, search));
    if (item) return { item, group };
  }
  return null;
}

export interface NavSearchResult {
  item: NavItem;
  /** "Comercial › Visão do Cliente" — onde a tela mora no menu. */
  breadcrumb: string;
}

/** Faixa Unicode dos acentos soltos que o NFD separa da letra. */
const PRIMEIRO_ACENTO = 0x0300;
const ULTIMO_ACENTO = 0x036f;

/** Sem acento e sem maiúscula: "Visão" e "visao" são a mesma busca. */
function normalize(text: string): string {
  return Array.from(text.normalize("NFD"))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code < PRIMEIRO_ACENTO || code > ULTIMO_ACENTO;
    })
    .join("")
    .toLowerCase();
}

/**
 * Busca de TELAS — nunca de registros (cliente, pedido, OP, item).
 *
 * Procura no rótulo, no nome da seção e nos apelidos, sem acento e sem
 * diferença de maiúscula; todo termo digitado precisa aparecer. Rótulo que
 * começa pelo que foi digitado vem primeiro: "cliente" traz Clientes antes de
 * Materiais de Clientes. Recebe só os grupos que o perfil enxerga — tela sem
 * acesso não aparece na busca.
 */
export function searchNavigation(query: string, groups: NavGroup[]): NavSearchResult[] {
  const termos = normalize(query).split(/\s+/).filter(Boolean);
  const primeiro = termos[0];
  if (!primeiro) return [];
  const frase = termos.join(" ");

  const candidatos = [
    { item: dashboardItem, section: null as string | null },
    ...groups.flatMap((group) => group.items.map((item) => ({ item, section: group.title as string | null }))),
  ];

  return candidatos
    .flatMap((candidato, ordem) => {
      const rotulo = normalize(candidato.item.label);
      const texto = [rotulo, normalize(candidato.section ?? ""), ...(candidato.item.aliases ?? []).map(normalize)].join(" ");
      if (!termos.every((termo) => texto.includes(termo))) return [];

      const palavras = rotulo.split(/[^a-z0-9]+/).filter(Boolean);
      const peso = rotulo.startsWith(frase)
        ? 0
        : palavras.some((palavra) => palavra.startsWith(primeiro))
          ? 1
          : rotulo.includes(primeiro)
            ? 2
            : 3;
      return [{ ...candidato, ordem, peso }];
    })
    .sort((a, b) => a.peso - b.peso || a.ordem - b.ordem)
    .map(({ item, section }) => ({ item, breadcrumb: section ? `${section} › ${item.label}` : item.label }));
}
