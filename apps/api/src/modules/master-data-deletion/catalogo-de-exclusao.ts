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

/**
 * Cadastro que a RAIZ aponta e que sai com ela — o Item de produto acabado
 * (PA) do Produto (MASTER-DATA-HARD-DELETE-02). Não é tabela interna: é outro
 * cadastro mestre, julgado pelo catálogo DELE, inteiro — cada uso dele bloqueia
 * a raiz. Só a chave da raiz para ele (`coluna`) não conta como uso: é o
 * vínculo 1:1 que o faz filho técnico da raiz.
 */
export interface Vinculado {
  /** Coluna da RAIZ que aponta para ele (`products.finishedProductItemId`). */
  coluna: string;
  /** O cadastro do vinculado, com o catálogo que o julga. */
  tipo: MasterDataEntityType;
  /** A tabela dele — conferida contra `AGREGADOS[tipo].tabela` no teste de contrato. */
  tabela: string;
  /** Ação da chave `raiz.coluna → tabela` no banco. */
  acao: AcaoDaChave;
  /** Como aparece em "sai junto" e na frente de cada uso dele que bloqueia. */
  rotulo: string;
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
  /** Cadastros que a raiz aponta e que saem com ela (o PA do Produto). */
  vinculados?: readonly Vinculado[];
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
  /*
   * Decisão do PO (2026-09-18): o registro dos dados do CNPJ nascido na MESMA
   * criação do Cliente é filho técnico; registro posterior é uso real. A prova
   * é ESTRUTURAL — a marca `createdWithCustomerId`, que só a criação grava
   * (CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01). Por isso o histórico é tabela
   * do agregado: `julgarHistoricoDoCnpj` só deixa sair o registro marcado com
   * o próprio Cliente; sem marca, com a de outro Cliente ou marcado em dobro,
   * bloqueia. Hora, "primeiro evento" e `xmin` nunca provam nada.
   */
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
      // A marca da criação em registro que está em OUTRO Cliente (o MERGE do
      // saneamento move `customerId`, nunca a marca). Os registros deste
      // Cliente não contam aqui: são do agregado, e quem os julga é
      // `julgarHistoricoDoCnpj`.
      tipo: "id",
      alvo: "customers",
      ...PARA_CLIENTE(
        "Histórico dos dados cadastrais do CNPJ de outro cliente",
        "Registro dos dados do CNPJ de outro cliente guarda este como o cliente em cuja criação nasceu — é histórico.",
        "customer_cnpj_registration_history",
        "createdWithCustomerId",
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

/* ------------------------------------------------------------------ *
 * Fatia 2 (MASTER-DATA-HARD-DELETE-02): Item, Produto + PA e Recurso.
 * ------------------------------------------------------------------ */

/** Chave estrangeira que chega à raiz: tabela, coluna, ação no banco, fonte e motivo. */
type ChaveQueChega = readonly [tabela: string, coluna: string, acao: AcaoDaChave, fonte: string, motivo: string];

/** Documento que copia o código e o nome da raiz, sem chave: tabela, coluna do código, coluna do nome, fonte. */
type CopiaDeIdentidade = readonly [tabela: string, codigo: string | null, nome: string | null, fonte: string];

function referenciasPorChave(alvo: string, chaves: readonly ChaveQueChega[]): ReferenciaDeclarada[] {
  return chaves.map(([tabela, coluna, acao, fonte, motivo]) => ({ tipo: "fk", tabela, coluna, alvo, acao, fonte, motivo }));
}

/** "cópia do item", "cópia do produto": a mesma frase para o código e para o nome. */
function referenciasPorCopia(deQuem: string, copias: readonly CopiaDeIdentidade[]): ReferenciaDeclarada[] {
  const referencias: ReferenciaDeclarada[] = [];
  for (const [tabela, codigo, , fonte] of copias) {
    if (codigo) {
      referencias.push({
        tipo: "codigo",
        tabela,
        coluna: codigo,
        fonte: `${fonte} (cópia do ${deQuem})`,
        motivo: `Documento guarda o código deste ${deQuem}.`,
      });
    }
  }
  for (const [tabela, , nome, fonte] of copias) {
    if (nome) {
      referencias.push({
        tipo: "nome",
        tabela,
        coluna: nome,
        fonte: `${fonte} (cópia do ${deQuem})`,
        motivo: `Documento guarda o nome deste ${deQuem}.`,
      });
    }
  }
  return referencias;
}

/*
 * Item — matéria-prima, embalagem, produto acabado e uso e consumo: um
 * namespace só. O banco tem CASCADE no ledger, na referência de custo e na
 * contagem, e SET NULL no Produto e no achado da contagem — tudo isso é uso e
 * bloqueia. O Item de produto acabado nunca sai sozinho: `julgarRaiz` o recusa
 * aqui, e ele só sai como vinculado do Produto.
 */
const ITEM: AgregadoExcluivel = {
  tipo: "ITEM",
  rotulo: "Item",
  tabela: "items",
  colunasDeNome: ["name"],
  internas: [],
  chavesInternas: [],
  referencias: [
    ...referenciasPorChave("items", [
      ["inventory_movements", "itemId", "c", "Movimentos de estoque", "O item já teve movimento de estoque — o histórico do estoque é permanente."],
      ["lots", "itemId", "r", "Lotes", "Há lote deste item — rastreabilidade."],
      ["supplier_items", "itemId", "r", "Relações Item × Fornecedor", "O item já foi relacionado a fornecedor — a relação guarda homologação e ofertas."],
      ["item_cost_references", "itemId", "c", "Referências de custo", "O item tem referência de custo registrada — é histórico de custo."],
      ["item_label_file_versions", "itemId", "r", "Arquivo do rótulo", "O item tem arquivo de rótulo registrado."],
      ["purchase_order_lines", "itemId", "r", "Ordens de compra", "O item já foi comprado em ordem de compra."],
      ["receipt_lines", "itemId", "r", "Recebimentos", "O item já foi recebido."],
      ["formulation_components", "itemId", "r", "Formulações", "O item é componente de formulação."],
      ["formulation_versions", "outputItemId", "r", "Formulações (item produzido)", "Formulação produz este item."],
      ["formulation_template_components", "itemId", "r", "Modelos de formulação", "O item é componente de modelo de formulação."],
      ["production_orders", "finishedItemId", "r", "Ordens de produção (item produzido)", "Ordem de produção produz este item."],
      ["production_order_requirements", "itemId", "r", "Ordens de produção (necessidades)", "Ordem de produção precisa deste item."],
      ["material_reservation_lines", "itemId", "r", "Reservas de material de ordem de produção", "Há reserva deste item para ordem de produção."],
      ["production_consumptions", "itemId", "r", "Consumos de produção", "O item já foi consumido em ordem de produção."],
      ["internal_consumptions", "itemId", "r", "Consumo interno", "Já houve consumo interno deste item — o estorno não apaga o consumo."],
      ["sample_consumptions", "itemId", "r", "Amostras", "O item já foi consumido em amostra."],
      ["customer_order_reservation_lines", "itemId", "r", "Reservas de pedido de venda", "Há reserva de estoque deste item para pedido de venda."],
      ["shipment_lines", "itemId", "r", "Expedições", "O item já foi expedido."],
      ["billing_lines", "itemId", "r", "Faturamentos", "O item já foi faturado."],
      ["stock_count_positions", "itemId", "c", "Inventário físico", "Contagem de estoque registrou posição deste item."],
      ["stock_count_findings", "itemId", "n", "Inventário físico (achados)", "Contagem de estoque registrou achado deste item."],
      [
        "products",
        "finishedProductItemId",
        "n",
        "Produto dono deste item",
        "Este é o item de produto acabado (PA) de um produto: ele sai só junto com o produto, pela exclusão do produto.",
      ],
    ]),
    {
      tipo: "id",
      tabela: "customer_order_lines",
      coluna: "finishedItemId",
      alvo: "items",
      fonte: "Pedidos de venda",
      motivo: "Pedido de venda guarda este item como o produto acabado da linha.",
    },
    ...referenciasPorCopia("item", [
      ["purchase_order_lines", "itemCode", "itemName", "Ordens de compra"],
      ["receipt_lines", "itemCode", "itemName", "Recebimentos"],
      ["formulation_versions", "outputItemCode", "outputItemName", "Formulações"],
      ["production_orders", "finishedItemCode", "finishedItemName", "Ordens de produção"],
      ["production_order_requirements", "itemCode", "itemName", "Necessidades de ordens de produção"],
      ["customer_order_lines", "finishedItemCode", "finishedItemName", "Pedidos de venda"],
      ["shipment_lines", "finishedItemCode", "finishedItemName", "Expedições"],
      ["billing_lines", "itemCode", "itemName", "Faturamentos"],
      ["stock_count_positions", "itemCode", "itemName", "Inventário físico"],
    ]),
  ],
  sufixos: { id: ["itemid"], idInterno: [], codigo: ["itemcode"], nome: ["itemname"] },
  saida: "INACTIVATE",
};

/*
 * Produto — sai com o Item de produto acabado (PA) ligado a ele 1:1
 * (`finishedProductItemId`, único). O PA é julgado pelo catálogo do Item,
 * inteiro: qualquer uso dele bloqueia o Produto, e ele nunca fica para trás.
 */
const PRODUTO: AgregadoExcluivel = {
  tipo: "PRODUCT",
  rotulo: "Produto",
  tabela: "products",
  colunasDeNome: ["name"],
  internas: [],
  chavesInternas: [],
  referencias: [
    ...referenciasPorChave("products", [
      ["project_products", "productId", "r", "Projetos (produtos do projeto)", "O produto participa de projeto."],
      ["projects", "productId", "n", "Projetos", "Projeto aponta para este produto; excluir o desligaria sem aviso."],
      ["quote_lines", "productId", "r", "Orçamentos", "O produto já foi orçado."],
      ["formulation_versions", "productId", "r", "Formulações", "O produto tem formulação — mesmo em rascunho, é engenharia do produto."],
      ["industrial_cost_versions", "productId", "c", "Estruturas de custo", "O produto tem estrutura de custo."],
      ["industrial_cost_calculations", "productId", "c", "Cálculos de custo industrial", "O produto tem cálculo de custo industrial."],
      ["pricing_versions", "productId", "c", "Precificações", "O produto tem precificação."],
      ["production_orders", "productId", "r", "Ordens de produção", "O produto já tem ordem de produção."],
      ["customer_order_lines", "productId", "r", "Pedidos de venda", "O produto já está em pedido de venda."],
      ["customer_order_reservation_lines", "productId", "r", "Reservas de pedido de venda", "Há reserva de estoque para pedido deste produto."],
      ["shipment_lines", "productId", "r", "Expedições", "O produto já foi expedido."],
      ["billing_lines", "productId", "r", "Faturamentos", "O produto já foi faturado."],
      ["attachments", "productId", "r", "Anexos do produto", "O produto tem documento anexado."],
    ]),
    ...referenciasPorCopia("produto", [
      ["quote_lines", "productCodeSnapshot", "productNameSnapshot", "Orçamentos"],
      ["industrial_cost_versions", "productCodeSnapshot", "productNameSnapshot", "Estruturas de custo"],
      ["industrial_cost_calculations", "productCodeSnapshot", "productNameSnapshot", "Cálculos de custo industrial"],
      ["production_orders", "productCode", "productName", "Ordens de produção"],
      ["customer_order_lines", "productCode", "productName", "Pedidos de venda"],
      ["shipment_lines", "productCode", "productName", "Expedições"],
      ["billing_lines", "productCode", "productName", "Faturamentos"],
    ]),
  ],
  sufixos: {
    id: ["productid"],
    idInterno: [],
    codigo: ["productcode", "productcodesnapshot"],
    nome: ["productname", "productnamesnapshot"],
  },
  saida: "INACTIVATE",
  vinculados: [
    { coluna: "finishedProductItemId", tipo: "ITEM", tabela: "items", acao: "n", rotulo: "Item de produto acabado" },
  ],
};

/*
 * Recurso industrial — tarifa é histórico (D2): explica o custo das estruturas.
 * Roteiro, estrutura e modelo de custo, energia e a cópia do roteiro na OP
 * (JSON, sem chave por decisão da §89) são uso.
 */
const RECURSO_INDUSTRIAL: AgregadoExcluivel = {
  tipo: "INDUSTRIAL_RESOURCE",
  rotulo: "Recurso industrial",
  tabela: "industrial_resources",
  colunasDeNome: ["name"],
  internas: [],
  chavesInternas: [],
  referencias: [
    ...referenciasPorChave("industrial_resources", [
      ["industrial_resource_rates", "industrialResourceId", "c", "Tarifas", "O recurso tem tarifa registrada — tarifa é histórico e explica o custo das estruturas."],
      ["production_profile_step_resources", "industrialResourceId", "r", "Roteiros de produção (etapas)", "O recurso está em etapa de roteiro de produção, em alguma versão."],
      ["industrial_cost_resource_usages", "industrialResourceId", "r", "Estruturas de custo (recursos)", "O recurso é usado em estrutura de custo."],
      ["industrial_cost_versions", "energyResourceId", "n", "Estruturas de custo (energia)", "Estrutura de custo usa este recurso como energia."],
      ["industrial_cost_template_resource_usages", "industrialResourceId", "r", "Modelos de custo industrial (recursos)", "O recurso é usado em modelo de custo industrial."],
      ["industrial_cost_template_versions", "energyResourceId", "n", "Modelos de custo industrial (energia)", "Modelo de custo industrial usa este recurso como energia."],
    ]),
    ...referenciasPorCopia("recurso", [["industrial_cost_resource_usages", null, "resourceNameSnapshot", "Estruturas de custo"]]),
  ],
  sufixos: { id: ["resourceid"], idInterno: [], codigo: ["resourcecode"], nome: ["resourcename", "resourcenamesnapshot"] },
  saida: "INACTIVATE",
};

export const AGREGADOS: Record<MasterDataEntityType, AgregadoExcluivel> = {
  SUPPLIER: FORNECEDOR,
  CUSTOMER: CLIENTE,
  FORMULATION_TEMPLATE: MODELO_DE_FORMULACAO,
  INDUSTRIAL_COST_TEMPLATE: MODELO_DE_CUSTO,
  PRICING_POLICY_TEMPLATE: MODELO_DE_POLITICA,
  PRODUCTION_PROFILE: PERFIL_DE_PRODUCAO,
  ITEM,
  PRODUCT: PRODUTO,
  INDUSTRIAL_RESOURCE: RECURSO_INDUSTRIAL,
};

/** Tabelas do agregado, a raiz primeiro. */
export function tabelasDoAgregado(agregado: AgregadoExcluivel): string[] {
  return [agregado.tabela, ...agregado.internas.map((interna) => interna.tabela)];
}
