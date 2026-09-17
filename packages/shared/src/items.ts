/** Contratos do módulo de Itens, consumidos por `apps/api` e `apps/web`. */

import type { CreateItemCostReferenceInput } from "./item-cost-reference.js";
import type { UserRole } from "./users.js";

export type ItemType =
  | "RAW_MATERIAL"
  | "PACKAGING"
  | "FINISHED_PRODUCT"
  | "INTERNAL_CONSUMABLE";

export const ITEM_TYPES: readonly ItemType[] = [
  "RAW_MATERIAL",
  "PACKAGING",
  "FINISHED_PRODUCT",
  "INTERNAL_CONSUMABLE",
];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: "Matéria-prima",
  PACKAGING: "Material de embalagem",
  FINISHED_PRODUCT: "Produto acabado",
  INTERNAL_CONSUMABLE: "Uso e consumo",
};

/** Prefixo do código interno exibido ao usuário (ex.: MP-000001). */
export const ITEM_TYPE_PREFIXES: Record<ItemType, string> = {
  RAW_MATERIAL: "MP",
  PACKAGING: "ME",
  FINISHED_PRODUCT: "PA",
  INTERNAL_CONSUMABLE: "UC",
};

/**
 * O que pode ser COMPONENTE de receita — Formulação de produto e Modelo de
 * Formulação (INTERNAL-CONSUMABLE-ITEM-TYPE-01).
 *
 * Lista de PERMISSÃO, nunca de exclusão. Enquanto a regra era "tudo menos
 * produto acabado", cada tipo novo entrava sozinho na receita e vazava dali
 * para a OP e para o CMV industrial — o custo de um material que nunca fez
 * parte da fórmula. Um tipo novo agora começa de fora e só entra quando
 * alguém o escrever aqui.
 */
export const ITEM_TYPES_DE_COMPONENTE: readonly ItemType[] = ["RAW_MATERIAL", "PACKAGING"];

/** O Item pode ser componente de uma receita? */
export function podeSerComponente(type: ItemType): boolean {
  return ITEM_TYPES_DE_COMPONENTE.some((aceito) => aceito === type);
}

/**
 * O que se COMPRA: linha de Pedido de Compra e relação Item × Fornecedor.
 *
 * Produto acabado é produzido, não comprado. Uso e consumo entra: luva,
 * detergente e filme são comprados de fornecedor como qualquer insumo, com
 * preço, homologação e recebimento — só não entram em receita nenhuma.
 */
export const ITEM_TYPES_COMPRAVEIS: readonly ItemType[] = [
  "RAW_MATERIAL",
  "PACKAGING",
  "INTERNAL_CONSUMABLE",
];

/** O Item pode ser comprado (OC e Item × Fornecedor)? */
export function podeSerComprado(type: ItemType): boolean {
  return ITEM_TYPES_COMPRAVEIS.some((aceito) => aceito === type);
}

/**
 * O que a SUGESTÃO DE COMPRA da produção pode pedir — o recorte do Pedido do
 * cliente, mais estreito que `ITEM_TYPES_COMPRAVEIS` de propósito.
 *
 * A falta vem da necessidade da receita, e uso e consumo não está em receita
 * nenhuma: a sugestão nunca teria como calcular a quantidade dele. Comprar uso
 * e consumo continua possível pela OC avulsa, que é onde essa decisão mora.
 */
export const ITEM_TYPES_DA_SUGESTAO_DE_COMPRA: readonly ItemType[] = [
  "RAW_MATERIAL",
  "PACKAGING",
];

/**
 * O que a AMOSTRA de projeto pode consumir do estoque.
 *
 * Amostra é material real saindo para o cliente — os mesmos três tipos que já
 * podiam sair antes de uso e consumo existir. Luva e detergente saem do
 * estoque por ajuste ou perda, não por consumo de amostra: contá-los na
 * amostra jogaria consumo interno da fábrica na conta do projeto do cliente.
 */
export const ITEM_TYPES_DA_AMOSTRA: readonly ItemType[] = [
  "RAW_MATERIAL",
  "PACKAGING",
  "FINISHED_PRODUCT",
];

/** O Item pode ser consumido por uma Amostra de projeto? */
export function podeEntrarEmAmostra(type: ItemType): boolean {
  return ITEM_TYPES_DA_AMOSTRA.some((aceito) => aceito === type);
}

/**
 * O que sai do estoque por CONSUMO INTERNO — a movimentação de Uso e consumo
 * (INTERNAL-CONSUMPTION-01, Fatia 2).
 *
 * Lista de PERMISSÃO com um tipo só, pelo mesmo motivo das outras: tipo novo
 * começa de fora. Matéria-prima e embalagem saem por produção, produto acabado
 * sai por expedição — cada uma dessas saídas tem contexto próprio (OP, Pedido)
 * que o consumo interno não tem. Deixá-las entrar aqui criaria uma segunda
 * porta para baixar material de receita sem OP nenhuma.
 *
 * Ampliar é decisão do PO, não consequência de um tipo novo aparecer.
 */
export const ITEM_TYPES_DO_CONSUMO_INTERNO: readonly ItemType[] = ["INTERNAL_CONSUMABLE"];

/** O Item pode sair do estoque por consumo interno? */
export function podeSairPorConsumoInterno(type: ItemType): boolean {
  return ITEM_TYPES_DO_CONSUMO_INTERNO.some((aceito) => aceito === type);
}

/**
 * Os quatro controles de rastreabilidade e qualidade de um Item.
 *
 * Um tipo só para o default canônico e para a comparação "mudou?" do gate de
 * permissão: os dois precisam falar exatamente das mesmas quatro chaves.
 */
export interface ItemQualityControls {
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  requiresCoa: boolean;
}

/** As chaves de `ItemQualityControls`, na ordem em que a tela as mostra. */
export const ITEM_QUALITY_CONTROL_FIELDS = [
  "controlsLot",
  "controlsExpiry",
  "requiresQualityRelease",
  "requiresCoa",
] as const satisfies readonly (keyof ItemQualityControls)[];

export type ItemQualityControlField = (typeof ITEM_QUALITY_CONTROL_FIELDS)[number];

/** Os mesmos rótulos do formulário do Item — a recusa da API fala a língua da tela. */
export const ITEM_QUALITY_CONTROL_LABELS: Record<ItemQualityControlField, string> = {
  controlsLot: "Controla lote",
  controlsExpiry: "Controla validade",
  requiresQualityRelease: "Requer liberação da Qualidade",
  requiresCoa: "Exige CoA / Laudo",
};

/**
 * Controles canônicos por tipo — ver docs/PRODUCT_RULES.md#4 e §100.
 *
 * O item nasce com eles quando o cadastro não informa outra coisa. Qualidade e
 * Administrador podem escolher outros valores (`ITEM_QUALITY_CONTROL_ROLES`);
 * para os demais perfis que criam item eles são o único valor aceito — a API
 * recusa o desvio, em qualquer direção (MASTER-DATA-EDIT-PERMISSIONS-01).
 *
 * `requiresCoa` é `false` em todo tipo: exigir laudo é decisão explícita da
 * Qualidade, nunca inferida de `requiresQualityRelease`.
 */
export const ITEM_TYPE_DEFAULTS: Record<ItemType, ItemQualityControls> = {
  RAW_MATERIAL: {
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
  },
  PACKAGING: {
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
  },
  FINISHED_PRODUCT: {
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
  },
  /*
   * Uso e consumo nasce SEM controle nenhum (INTERNAL-CONSUMABLE-ITEM-TYPE-01):
   * luva, detergente e filme não têm lote rastreado, validade acompanhada nem
   * liberação da Qualidade — nada deles chega ao produto do cliente. Continua
   * sendo default, não regra: a Qualidade pode marcar o que for preciso num
   * consumível específico.
   */
  INTERNAL_CONSUMABLE: {
    controlsLot: false,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
  },
};

/**
 * Quem CRIA e EDITA o Item — MASTER-DATA-EDIT-PERMISSIONS-01, decisão do PO.
 *
 * Vale para a identidade (tipo, nome, unidade), a classificação industrial
 * (fonte, nutriente declarado, família, pureza padrão, subtipo de embalagem) e
 * os códigos. Comercial e Consulta leem o Item e não gravam nele — o Comercial
 * continua dono da referência de custo, por outra lista
 * (`ITEM_COST_REFERENCE_ROLES`).
 *
 * Três partes do cadastro têm dono mais estreito, cada uma com a sua lista: os
 * quatro controles (`ITEM_QUALITY_CONTROL_ROLES`), a marca "Consumido na
 * produção" (`ITEM_PRODUCTION_CONSUMPTION_ROLES`) e a situação
 * (`ITEM_DEACTIVATE_ROLES`, `ITEM_REACTIVATE_ROLES`). A API recusa com 403; a
 * tela usa as MESMAS listas só para não oferecer o que seria recusado.
 */
export const ITEM_EDIT_ROLES: readonly UserRole[] = ["PURCHASING", "QUALITY", "PRODUCTION", "ADMIN"];

/**
 * Quem ALTERA os quatro controles de rastreabilidade e qualidade do Item.
 *
 * O gate é pela MUDANÇA de valor, nunca pela presença da chave: a tela manda
 * os quatro em todo salvamento, e quem edita o resto do cadastro salva com os
 * valores gravados sem esbarrar em recusa nenhuma.
 */
export const ITEM_QUALITY_CONTROL_ROLES: readonly UserRole[] = ["QUALITY", "ADMIN"];

/**
 * Quem marca e desmarca "Consumido na produção" (§52) — autoridade
 * operacional da Produção. Mesmo gate por mudança dos controles: salvar sem
 * mexer na marca passa para qualquer perfil que edita o Item.
 */
export const ITEM_PRODUCTION_CONSUMPTION_ROLES: readonly UserRole[] = ["PRODUCTION", "ADMIN"];

/** Quem INATIVA o Item. Sem motivo nem histórico nesta fase (MASTER-DATA-STATUS-HISTORY-01). */
export const ITEM_DEACTIVATE_ROLES: readonly UserRole[] = ["PURCHASING", "QUALITY", "ADMIN"];

/**
 * Quem REATIVA o Item — mais estreito que inativar: devolver um item ao uso
 * operacional é decisão da Qualidade enquanto não houver motivo e histórico.
 */
export const ITEM_REACTIVATE_ROLES: readonly UserRole[] = ["QUALITY", "ADMIN"];

/**
 * Família industrial do Item (capacidade 33). Lista fixa nesta fase — não
 * existe cadastro configurável de famílias.
 */
export type ItemFamily =
  | "VITAMIN"
  | "MINERAL"
  | "AMINO_ACID"
  | "EXCIPIENT"
  | "BOTANICAL"
  | "OTHER_RAW_MATERIAL"
  | "PACKAGING"
  | "OTHER";

export const ITEM_FAMILIES: readonly ItemFamily[] = [
  "VITAMIN",
  "MINERAL",
  "AMINO_ACID",
  "EXCIPIENT",
  "BOTANICAL",
  "OTHER_RAW_MATERIAL",
  "PACKAGING",
  "OTHER",
];

export const ITEM_FAMILY_LABELS: Record<ItemFamily, string> = {
  VITAMIN: "Vitamina",
  MINERAL: "Mineral",
  AMINO_ACID: "Aminoácido",
  EXCIPIENT: "Excipiente",
  BOTANICAL: "Botânico",
  OTHER_RAW_MATERIAL: "Outra matéria-prima",
  PACKAGING: "Embalagem",
  OTHER: "Outro",
};

/** Subtipo de embalagem — só se aplica a `type = PACKAGING`. */
export type PackagingSubtype =
  | "POT"
  | "CAP"
  | "SCOOP"
  | "SEAL"
  | "LABEL"
  | "BOX"
  | "POUCH"
  | "CARTON"
  | "BOTTLE"
  | "OTHER";

export const PACKAGING_SUBTYPES: readonly PackagingSubtype[] = [
  "POT",
  "CAP",
  "SCOOP",
  "SEAL",
  "LABEL",
  "BOX",
  "POUCH",
  "CARTON",
  "BOTTLE",
  "OTHER",
];

export const PACKAGING_SUBTYPE_LABELS: Record<PackagingSubtype, string> = {
  POT: "Pote",
  CAP: "Tampa",
  SCOOP: "Dosador",
  SEAL: "Selo",
  LABEL: "Rótulo",
  BOX: "Caixa",
  POUCH: "Sachê/Pouch",
  CARTON: "Cartucho",
  BOTTLE: "Frasco",
  OTHER: "Outro",
};

export type UomDimension = "MASS" | "COUNT" | "VOLUME";

export interface UnitOfMeasureDTO {
  code: string;
  label: string;
  dimension: UomDimension;
  /**
   * Fator para a base da dimensão, como decimal-string.
   *
   * A tela precisa dele para converter unidade sem pedir ao servidor — a
   * Formulação mostra o físico por unidade de estoque enquanto a pessoa digita
   * em mg. Sem o fator, a prévia teria de escolher entre uma ida ao servidor a
   * cada tecla ou uma tabela de conversão duplicada no front.
   */
  toBaseFactor: string;
}

export interface ItemDTO {
  id: string;
  code: string;
  type: ItemType;
  name: string;
  unitCode: string;
  unit: UnitOfMeasureDTO;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  /** Exige laudo/CoA aprovado no lote. Conceito independente da liberação manual. */
  requiresCoa: boolean;
  /** Fonte / forma química realmente utilizada (ex.: "Cloridrato de tiamina"). */
  sourceName: string | null;
  /** Denominação nutricional declarada (ex.: "Vitamina B1"). */
  declaredNutrient: string | null;
  family: ItemFamily | null;
  /**
   * Pureza padrão em % (0 < x <= 100). `null` significa DESCONHECIDA — nunca
   * deve ser interpretada como 100%. É apenas o default de novas
   * formulações; a pureza aplicada será congelada no componente (cap. 34).
   */
  defaultPurityPercent: string | null;
  /** Preenchido apenas quando `type = PACKAGING`. */
  packagingSubtype: PackagingSubtype | null;
  /**
   * Este material é consumido NO PROCESSO, proporcional à quantidade BRUTA
   * produzida — e não por unidade vendável.
   *
   * É a marca que separa a CÁPSULA VAZIA, que entra na encapsuladora junto com
   * cada unidade bruta, do pote, da tampa e do rótulo, que acompanham a unidade
   * VENDIDA. Os dois são `PACKAGING`, e nenhum subtipo os distinguia.
   *
   * Quem lê é só o motor de necessidade, e só quando a perda prevista da versão
   * é aplicada (estimativa de custo). Matéria-prima já acompanha a produção pela
   * BASE declarada na receita: nela a marca é redundante, nunca contraditória.
   */
  consumedInProduction: boolean;
  externalBarcode: string | null;
  /**
   * Código do sistema legado (planilhas). Reconciliação da importação, nunca
   * identidade operacional — quem identifica o item é `code`. `null` quando o
   * item nasceu aqui e não veio de planilha nenhuma.
   */
  externalCode: string | null;
  active: boolean;
  /**
   * `true` quando o item já tem referência em PurchaseOrderLine, ReceiptLine,
   * Lot ou InventoryMovement — nesse caso `type`/`unitCode`/`controlsLot`/
   * `controlsExpiry` ficam bloqueados para nunca corromper o significado de
   * histórico já registrado.
   */
  operationallyUsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemListResponse {
  items: ItemDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateItemInput {
  type: ItemType;
  name: string;
  unitCode: string;
  controlsLot?: boolean;
  controlsExpiry?: boolean;
  requiresQualityRelease?: boolean;
  requiresCoa?: boolean;
  /** Ver `ItemDTO.consumedInProduction`. Ausente = `false`. */
  consumedInProduction?: boolean;
  externalBarcode?: string;
  /**
   * Custo de referência inicial — opcional. Sem ele o item continua
   * válido; o custo vem da compra real quando ela acontecer.
   */
  initialCostReference?: CreateItemCostReferenceInput;
}

export interface UpdateItemInput {
  type?: ItemType;
  name?: string;
  unitCode?: string;
  controlsLot?: boolean;
  controlsExpiry?: boolean;
  requiresQualityRelease?: boolean;
  requiresCoa?: boolean;
  /** Ver `ItemDTO.consumedInProduction`. Ausente deixa como está. */
  consumedInProduction?: boolean;
  externalBarcode?: string;
}
