import type { MasterDataDeletionAlternative, MasterDataEntityType } from "@veridi/shared";

/**
 * O catálogo EXPLÍCITO de cada agregado excluível — MASTER-DATA-HARD-DELETE-01,
 * D2 e D6 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.
 *
 * Por agregado: a raiz, as tabelas que nascem e morrem com ela (a V1 técnica e
 * os filhos dela) e a lista de tudo que, de FORA, aponta para a raiz ou para
 * uma interna — chave estrangeira de qualquer ação, id sem chave, código e nome
 * copiados. Cada entrada diz, em linguagem de negócio, onde está o uso e por
 * que ele impede a exclusão: a tela mostra isso sem conhecer tabela nenhuma.
 *
 * O catálogo é conferido contra o `pg_constraint` a CADA execução
 * (`master-data-deletion.service.ts`): chave estrangeira que chega ao agregado
 * sem estar aqui bloqueia a exclusão (falha fechada), e entrada daqui que o
 * banco não tem mais também. Colunas sem chave que surgirem depois são pegas
 * pelas redes de sufixo e pela varredura de JSON, que contam em vez de
 * confiar no nome.
 *
 * Literais fixos: nada aqui vem de requisição, e é por isso que tabela e
 * coluna podem entrar no SQL. Valores são sempre parâmetros.
 */

/** Letra de `pg_constraint.confdeltype`: RESTRICT, NO ACTION, CASCADE, SET NULL. */
export type AcaoDaChave = "r" | "a" | "c" | "n";

export const ACAO_POR_EXTENSO: Record<AcaoDaChave, string> = {
  r: "RESTRICT",
  a: "NO ACTION",
  c: "CASCADE",
  n: "SET NULL",
};

/** Tabela que é parte do agregado: nasce com ele e sai com ele, por CASCADE. */
export interface TabelaInterna {
  tabela: string;
  /** Coluna que aponta para o pai dentro do agregado. */
  coluna: string;
  /** A raiz ou outra interna, sempre declarada antes. */
  pai: string;
  /** Como aparece em "sai junto". */
  rotulo: string;
}

/** Chave estrangeira entre linhas do PRÓPRIO agregado que não é o vínculo com o pai. */
export interface ChaveInterna {
  tabela: string;
  coluna: string;
  alvo: string;
  acao: AcaoDaChave;
}

interface ReferenciaBase {
  tabela: string;
  coluna: string;
  /** Onde está o uso, como a tela diz. */
  fonte: string;
  /** Por que impede a exclusão. */
  motivo: string;
}

/** Referência de FORA do agregado para ele. */
export type ReferenciaDeclarada =
  | (ReferenciaBase & { tipo: "fk"; alvo: string; acao: AcaoDaChave })
  | (ReferenciaBase & { tipo: "id"; alvo: string })
  | (ReferenciaBase & { tipo: "codigo" })
  | (ReferenciaBase & { tipo: "nome" });

/**
 * Redes de segurança: coluna sem chave estrangeira cujo NOME termina num
 * destes sufixos (sem caixa) é contada mesmo sem estar na lista — é assim que
 * uma cópia nova de id, código ou nome, criada depois deste catálogo, bloqueia
 * em vez de passar.
 */
export interface Sufixos {
  /** Id da raiz. */
  id: readonly string[];
  /** Id de uma linha interna (as versões). */
  idInterno: readonly string[];
  codigo: readonly string[];
  nome: readonly string[];
}

export interface AgregadoExcluivel {
  tipo: MasterDataEntityType;
  rotulo: string;
  tabela: string;
  /** Colunas de nome da raiz — o nome do rastro é a primeira. */
  colunasDeNome: readonly string[];
  internas: readonly TabelaInterna[];
  chavesInternas: readonly ChaveInterna[];
  referencias: readonly ReferenciaDeclarada[];
  sufixos: Sufixos;
  /** A saída normal quando a exclusão é recusada. */
  saida: MasterDataDeletionAlternative;
}

/* ------------------------------------------------------------------ *
 * Fornecedor — o banco já é todo RESTRICT; o catálogo diz onde.
 * ------------------------------------------------------------------ */

const FORNECEDOR: AgregadoExcluivel = {
  tipo: "SUPPLIER",
  rotulo: "Fornecedor",
  tabela: "suppliers",
  colunasDeNome: ["legalName", "tradeName"],
  internas: [],
  chavesInternas: [],
  referencias: [
    {
      tipo: "fk",
      tabela: "supplier_items",
      coluna: "supplierId",
      alvo: "suppliers",
      acao: "r",
      fonte: "Relações Item × Fornecedor",
      motivo: "O fornecedor já foi relacionado a item — a relação guarda homologação e ofertas.",
    },
    {
      tipo: "fk",
      tabela: "purchase_orders",
      coluna: "supplierId",
      alvo: "suppliers",
      acao: "r",
      fonte: "Ordens de compra",
      motivo: "O fornecedor já foi usado em ordem de compra.",
    },
    {
      tipo: "fk",
      tabela: "receipts",
      coluna: "supplierId",
      alvo: "suppliers",
      acao: "r",
      fonte: "Recebimentos",
      motivo: "Já houve recebimento deste fornecedor.",
    },
    {
      tipo: "fk",
      tabela: "lots",
      coluna: "supplierId",
      alvo: "suppliers",
      acao: "r",
      fonte: "Lotes",
      motivo: "Há lote com a origem neste fornecedor — rastreabilidade.",
    },
    {
      tipo: "codigo",
      tabela: "purchase_orders",
      coluna: "supplierCode",
      fonte: "Ordens de compra (cópia do fornecedor)",
      motivo: "Ordem de compra guarda o código deste fornecedor.",
    },
    {
      tipo: "nome",
      tabela: "purchase_orders",
      coluna: "supplierName",
      fonte: "Ordens de compra (cópia do fornecedor)",
      motivo: "Ordem de compra guarda o nome deste fornecedor.",
    },
  ],
  sufixos: { id: ["supplierid"], idInterno: [], codigo: ["suppliercode"], nome: ["suppliername"] },
  saida: "INACTIVATE",
};

/* ------------------------------------------------------------------ *
 * Cliente — qualquer uso bloqueia, inclusive SET NULL, CASCADE do histórico
 * de situação e as cópias de código e nome nos documentos.
 * ------------------------------------------------------------------ */

const PARA_CLIENTE = (fonte: string, motivo: string, tabela: string, coluna: string) => ({
  fonte,
  motivo,
  tabela,
  coluna,
});

const CLIENTE: AgregadoExcluivel = {
  tipo: "CUSTOMER",
  rotulo: "Cliente",
  tabela: "customers",
  colunasDeNome: ["legalName", "tradeName"],
  // O evento dos dados do CNPJ gravado NA criação é filho técnico — só ele, e só
  // com prova de nascimento (`filhos-tecnicos.ts`). Qualquer outro evento bloqueia.
  internas: [
    {
      tabela: "customer_cnpj_registration_history",
      coluna: "customerId",
      pai: "customers",
      rotulo: "Registro dos dados do CNPJ feito na criação",
    },
  ],
  chavesInternas: [],
  referencias: [
    {
      tipo: "fk",
      acao: "r",
      alvo: "customers",
      ...PARA_CLIENTE("Projetos", "O cliente já tem projeto.", "projects", "customerId"),
    },
    {
      tipo: "fk",
      acao: "r",
      alvo: "customers",
      ...PARA_CLIENTE("Pedidos de venda", "O cliente já tem pedido de venda.", "customer_orders", "customerId"),
    },
    {
      tipo: "fk",
      acao: "r",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Recebimentos de material do cliente",
        "Já houve recebimento de material deste cliente.",
        "receipts",
        "customerId",
      ),
    },
    {
      tipo: "fk",
      acao: "r",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Lotes de propriedade do cliente",
        "Há lote de propriedade deste cliente — rastreabilidade.",
        "lots",
        "ownerCustomerId",
      ),
    },
    {
      tipo: "fk",
      acao: "n",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Produtos private label",
        "Há produto deste cliente; excluir desligaria o produto sem aviso.",
        "products",
        "customerId",
      ),
    },
    {
      tipo: "fk",
      acao: "n",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Ordens de produção",
        "Há ordem de produção para este cliente; excluir a desligaria sem aviso.",
        "production_orders",
        "customerId",
      ),
    },
    {
      tipo: "fk",
      acao: "c",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Histórico de situação",
        "O cliente já foi bloqueado, desbloqueado, inativado ou reativado — o histórico é permanente.",
        "customer_status_history",
        "customerId",
      ),
    },
    {
      tipo: "id",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Inventário físico",
        "Contagem de estoque registrou lote deste cliente.",
        "stock_count_positions",
        "ownerCustomerId",
      ),
    },
    ...(
      [
        ["quote_versions", "customerCode", "Orçamentos"],
        ["customer_orders", "customerCode", "Pedidos de venda"],
        ["production_orders", "customerCode", "Ordens de produção"],
        ["billings", "customerCode", "Faturamentos"],
        ["stock_count_positions", "ownerCustomerCode", "Inventário físico"],
        ["industrial_cost_versions", "customerCodeSnapshot", "Estruturas de custo"],
        ["project_samples", "customerCodeSnapshot", "Amostras"],
      ] as const
    ).map(([tabela, coluna, fonte]) => ({
      tipo: "codigo" as const,
      ...PARA_CLIENTE(`${fonte} (cópia do cliente)`, "Documento guarda o código deste cliente.", tabela, coluna),
    })),
    ...(
      [
        ["quote_versions", "customerName", "Orçamentos"],
        ["quote_versions", "customerTradeName", "Orçamentos"],
        ["customer_orders", "customerName", "Pedidos de venda"],
        ["customer_orders", "customerTradeName", "Pedidos de venda"],
        ["production_orders", "customerName", "Ordens de produção"],
        ["production_orders", "customerTradeName", "Ordens de produção"],
        ["billings", "customerName", "Faturamentos"],
        ["billings", "customerTradeName", "Faturamentos"],
        ["stock_count_positions", "ownerCustomerName", "Inventário físico"],
        ["industrial_cost_versions", "customerNameSnapshot", "Estruturas de custo"],
        ["industrial_cost_calculations", "customerNameSnapshot", "Cálculos de custo industrial"],
        ["project_samples", "customerNameSnapshot", "Amostras"],
      ] as const
    ).map(([tabela, coluna, fonte]) => ({
      tipo: "nome" as const,
      ...PARA_CLIENTE(`${fonte} (cópia do cliente)`, "Documento guarda o nome deste cliente.", tabela, coluna),
    })),
  ],
  sufixos: {
    id: ["customerid"],
    idInterno: [],
    codigo: ["customercode", "customercodesnapshot"],
    nome: ["customername", "customernamesnapshot", "customertradename"],
  },
  saida: "INACTIVATE",
};

/* ------------------------------------------------------------------ *
 * Modelos e Perfil — nascem com a V1 em rascunho. A V1 e os filhos dela são
 * internos; a proveniência de quem nasceu deles é referência.
 * ------------------------------------------------------------------ */

const MODELO_DE_FORMULACAO: AgregadoExcluivel = {
  tipo: "FORMULATION_TEMPLATE",
  rotulo: "Modelo de formulação",
  tabela: "formulation_templates",
  colunasDeNome: ["name"],
  internas: [
    {
      tabela: "formulation_template_versions",
      coluna: "formulationTemplateId",
      pai: "formulation_templates",
      rotulo: "Versão V1 em rascunho, sem conteúdo",
    },
    {
      tabela: "formulation_template_components",
      coluna: "formulationTemplateVersionId",
      pai: "formulation_template_versions",
      rotulo: "Componentes da versão",
    },
  ],
  chavesInternas: [
    { tabela: "formulation_template_versions", coluna: "sourceVersionId", alvo: "formulation_template_versions", acao: "n" },
  ],
  referencias: [
    {
      tipo: "fk",
      tabela: "formulation_versions",
      coluna: "originTemplateVersionId",
      alvo: "formulation_template_versions",
      acao: "n",
      fonte: "Formulações criadas a partir do modelo",
      motivo: "O modelo já foi aplicado — a formulação guarda a origem.",
    },
    {
      tipo: "codigo",
      tabela: "formulation_versions",
      coluna: "originTemplateCode",
      fonte: "Formulações (origem no modelo)",
      motivo: "Formulação guarda o código deste modelo como origem.",
    },
  ],
  sufixos: {
    id: ["formulationtemplateid"],
    idInterno: ["versionid"],
    codigo: ["formulationtemplatecode", "origintemplatecode"],
    nome: [],
  },
  saida: "ARCHIVE",
};

const MODELO_DE_CUSTO: AgregadoExcluivel = {
  tipo: "INDUSTRIAL_COST_TEMPLATE",
  rotulo: "Modelo de custo industrial",
  tabela: "industrial_cost_templates",
  colunasDeNome: ["name"],
  internas: [
    {
      tabela: "industrial_cost_template_versions",
      coluna: "industrialCostTemplateId",
      pai: "industrial_cost_templates",
      rotulo: "Versão V1 em rascunho, sem conteúdo",
    },
    {
      tabela: "industrial_cost_template_resource_usages",
      coluna: "industrialCostTemplateVersionId",
      pai: "industrial_cost_template_versions",
      rotulo: "Recursos da versão",
    },
    {
      tabela: "industrial_cost_template_additional_costs",
      coluna: "industrialCostTemplateVersionId",
      pai: "industrial_cost_template_versions",
      rotulo: "Custos adicionais da versão",
    },
  ],
  chavesInternas: [
    {
      tabela: "industrial_cost_template_versions",
      coluna: "sourceVersionId",
      alvo: "industrial_cost_template_versions",
      acao: "n",
    },
  ],
  referencias: [
    {
      tipo: "fk",
      tabela: "industrial_cost_versions",
      coluna: "originCostTemplateVersionId",
      alvo: "industrial_cost_template_versions",
      acao: "n",
      fonte: "Estruturas de custo criadas a partir do modelo",
      motivo: "O modelo já foi aplicado — a estrutura de custo guarda a origem.",
    },
    {
      tipo: "codigo",
      tabela: "industrial_cost_versions",
      coluna: "originCostTemplateCode",
      fonte: "Estruturas de custo (origem no modelo)",
      motivo: "Estrutura de custo guarda o código deste modelo como origem.",
    },
  ],
  sufixos: {
    id: ["industrialcosttemplateid", "costtemplateid"],
    idInterno: ["versionid"],
    codigo: ["industrialcosttemplatecode", "costtemplatecode"],
    nome: [],
  },
  saida: "ARCHIVE",
};

const MODELO_DE_POLITICA: AgregadoExcluivel = {
  tipo: "PRICING_POLICY_TEMPLATE",
  rotulo: "Modelo de política de preço",
  tabela: "pricing_policy_templates",
  colunasDeNome: ["name"],
  internas: [
    {
      tabela: "pricing_policy_template_versions",
      coluna: "pricingPolicyTemplateId",
      pai: "pricing_policy_templates",
      rotulo: "Versão V1 em rascunho, sem conteúdo",
    },
    {
      tabela: "pricing_policy_template_tiers",
      coluna: "pricingPolicyTemplateVersionId",
      pai: "pricing_policy_template_versions",
      rotulo: "Faixas da versão",
    },
  ],
  chavesInternas: [
    {
      tabela: "pricing_policy_template_versions",
      coluna: "sourceVersionId",
      alvo: "pricing_policy_template_versions",
      acao: "n",
    },
  ],
  referencias: [
    {
      tipo: "fk",
      tabela: "pricing_versions",
      coluna: "originPricingPolicyVersionId",
      alvo: "pricing_policy_template_versions",
      acao: "n",
      fonte: "Precificações criadas a partir da política",
      motivo: "A política já foi aplicada — a precificação guarda a origem.",
    },
    {
      tipo: "codigo",
      tabela: "pricing_versions",
      coluna: "originPricingPolicyCode",
      fonte: "Precificações (origem na política)",
      motivo: "Precificação guarda o código desta política como origem.",
    },
  ],
  sufixos: {
    id: ["pricingpolicytemplateid", "pricingpolicyid"],
    idInterno: ["versionid"],
    codigo: ["pricingpolicytemplatecode", "pricingpolicycode"],
    nome: [],
  },
  saida: "ARCHIVE",
};

const PERFIL_DE_PRODUCAO: AgregadoExcluivel = {
  tipo: "PRODUCTION_PROFILE",
  rotulo: "Roteiro de produção",
  tabela: "production_profiles",
  colunasDeNome: ["name"],
  internas: [
    {
      tabela: "production_profile_versions",
      coluna: "productionProfileId",
      pai: "production_profiles",
      rotulo: "Versão V1 em rascunho, sem etapas",
    },
    {
      tabela: "production_profile_steps",
      coluna: "productionProfileVersionId",
      pai: "production_profile_versions",
      rotulo: "Etapas da versão",
    },
    {
      tabela: "production_profile_step_resources",
      coluna: "productionProfileStepId",
      pai: "production_profile_steps",
      rotulo: "Recursos das etapas",
    },
  ],
  chavesInternas: [
    { tabela: "production_profile_versions", coluna: "sourceVersionId", alvo: "production_profile_versions", acao: "n" },
  ],
  referencias: [
    {
      tipo: "fk",
      tabela: "products",
      coluna: "defaultProductionProfileVersionId",
      alvo: "production_profile_versions",
      acao: "r",
      fonte: "Produtos com este roteiro como padrão",
      motivo: "O roteiro é (ou foi escolhido como) o padrão de produto.",
    },
    {
      tipo: "id",
      tabela: "production_order_planning_snapshots",
      coluna: "sourceProfileId",
      alvo: "production_profiles",
      fonte: "Roteiros copiados para ordens de produção",
      motivo: "O roteiro já foi copiado para ordem de produção.",
    },
    {
      tipo: "id",
      tabela: "production_order_planning_snapshots",
      coluna: "sourceVersionId",
      alvo: "production_profile_versions",
      fonte: "Roteiros copiados para ordens de produção",
      motivo: "Uma versão do roteiro já foi copiada para ordem de produção.",
    },
    {
      tipo: "codigo",
      tabela: "production_order_planning_snapshots",
      coluna: "sourceProfileCode",
      fonte: "Roteiros copiados para ordens de produção",
      motivo: "Ordem de produção guarda o código deste roteiro como origem.",
    },
  ],
  sufixos: {
    id: ["productionprofileid", "sourceprofileid"],
    idInterno: ["versionid"],
    codigo: ["productionprofilecode", "sourceprofilecode"],
    nome: [],
  },
  saida: "ARCHIVE",
};

export const AGREGADOS: Record<MasterDataEntityType, AgregadoExcluivel> = {
  SUPPLIER: FORNECEDOR,
  CUSTOMER: CLIENTE,
  FORMULATION_TEMPLATE: MODELO_DE_FORMULACAO,
  INDUSTRIAL_COST_TEMPLATE: MODELO_DE_CUSTO,
  PRICING_POLICY_TEMPLATE: MODELO_DE_POLITICA,
  PRODUCTION_PROFILE: PERFIL_DE_PRODUCAO,
};

/** Tabelas do agregado, a raiz primeiro. */
export function tabelasDoAgregado(agregado: AgregadoExcluivel): string[] {
  return [agregado.tabela, ...agregado.internas.map((interna) => interna.tabela)];
}
