import { Decimal } from "./decimal-config.js";
import type { DecimalInstance } from "./decimal-config.js";
import type { TemplateVersionStatus } from "./cost-pricing-templates.js";
import type { IndustrialResourceType } from "./industrial-resources.js";

/**
 * PLANEJAMENTO — Perfil de Produção (PLANNING-PRODUCTION-PROFILE-01,
 * `PRODUCT_RULES.md` §89).
 *
 * Responde COMO um produto é normalmente produzido: etapas em ordem, tempo de
 * preparação e de execução, e quantos recursos trabalham AO MESMO TEMPO em
 * cada etapa. Não é Formulação (o que entra), nem Estrutura de Custos (quanto
 * custa), nem Ordem de Produção (o que foi mandado fazer).
 *
 * Capacidade, não custo: `resourceQuantity` diz quantos recursos a etapa ocupa
 * simultaneamente — 2 operadores por 2 horas é etapa de 2 horas e 4
 * horas-recurso de demanda. É outra pergunta que o `resourceCount` da
 * Estrutura de Custos (§87) responde, e uma não se lê pela outra.
 */

export const PRODUCTION_PROFILE_CODE_PREFIX = "PPR";

/** Como o tempo de execução acompanha a quantidade produzida. */
export type ProductionStepScalingMode = "PROPORTIONAL" | "BY_BATCH";

export const PRODUCTION_STEP_SCALING_MODES: readonly ProductionStepScalingMode[] = [
  "PROPORTIONAL",
  "BY_BATCH",
];

export const PRODUCTION_STEP_SCALING_MODE_LABELS: Record<ProductionStepScalingMode, string> = {
  PROPORTIONAL: "Proporcional",
  BY_BATCH: "Por lote",
};

/**
 * Mão de obra e equipamento ocupam capacidade. Energia não: ela continua no
 * domínio de custo (Estrutura de Custos), e não entra em etapa nenhuma.
 */
export const CAPACITY_RESOURCE_TYPES: readonly IndustrialResourceType[] = ["LABOR", "EQUIPMENT"];

export function isCapacityResourceType(type: IndustrialResourceType): boolean {
  return CAPACITY_RESOURCE_TYPES.includes(type);
}

/** Limites da etapa — os mesmos na tela e no servidor. */
export const PRODUCTION_STEP_LIMITS = {
  maxSteps: 50,
  maxResourcesPerStep: 20,
  /** Um ano em minutos: acima disso é erro de digitação, não etapa. */
  maxMinutes: 525_600,
  maxResourceQuantity: 999,
} as const;

// ─────────────────────────────────────────────────────────────── contratos

export interface ProductionProfileStepResourceDTO {
  id: string;
  industrialResourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  resourceActive: boolean;
  /** Recursos simultâneos na etapa — capacidade, nunca custo. Inteiro ≥ 1. */
  resourceQuantity: number;
  notes: string | null;
  sortOrder: number;
}

export interface ProductionProfileStepDTO {
  id: string;
  /** 1, 2, 3… — a ordem de execução. Cada etapa começa depois da anterior. */
  sequence: number;
  name: string;
  description: string | null;
  /** Preparação, em minutos. Não escala com a quantidade. */
  setupDurationMinutes: number;
  /** Execução da quantidade-base (em `BY_BATCH`, de cada lote dela), em minutos. */
  runDurationMinutes: number;
  scalingMode: ProductionStepScalingMode;
  resources: ProductionProfileStepResourceDTO[];
}

export interface ProductionProfileVersionDTO {
  id: string;
  productionProfileId: string;
  profileCode: string;
  profileName: string;
  versionNumber: number;
  versionLabel: string;
  status: TemplateVersionStatus;
  /** Quantidade-base a que os tempos de execução se referem. */
  referenceQuantity: string;
  referenceUomCode: string;
  notes: string | null;
  steps: ProductionProfileStepDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  archivedAt: string | null;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
}

/** Produto que tem uma versão deste perfil como padrão. */
export interface ProductionProfileDefaultProductDTO {
  productId: string;
  productCode: string;
  productName: string;
  versionId: string;
  versionNumber: number;
  versionStatus: TemplateVersionStatus;
}

export interface ProductionProfileDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  activeVersion: ProductionProfileVersionDTO | null;
  draftVersion: ProductionProfileVersionDTO | null;
  versions: ProductionProfileVersionDTO[];
  defaultProducts: ProductionProfileDefaultProductDTO[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface ProductionProfileSummaryDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  referenceQuantity: string | null;
  referenceUomCode: string | null;
  stepNames: string[];
  hasDraft: boolean;
  defaultProductCount: number;
  updatedAt: string;
}

export interface ProductionProfileListResponse {
  profiles: ProductionProfileSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProductionProfileInput {
  name: string;
  description?: string | null;
  referenceQuantity?: string;
  referenceUomCode?: string;
}

export interface UpdateProductionProfileIdentityInput {
  name?: string;
  description?: string | null;
}

export interface ProductionProfileStepResourceInput {
  industrialResourceId: string;
  resourceQuantity: number;
  notes?: string | null;
}

export interface ProductionProfileStepInput {
  name: string;
  description?: string | null;
  setupDurationMinutes: number;
  runDurationMinutes: number;
  scalingMode: ProductionStepScalingMode;
  resources: ProductionProfileStepResourceInput[];
}

/** Rascunho inteiro: as etapas chegam na ordem de execução e substituem as anteriores. */
export interface UpdateProductionProfileVersionInput {
  referenceQuantity?: string;
  referenceUomCode?: string;
  notes?: string | null;
  steps?: ProductionProfileStepInput[];
}

export interface SetProductProductionProfileInput {
  /** `null` tira o padrão: produto sem perfil continua válido. */
  productionProfileVersionId: string | null;
}

/**
 * O padrão do produto acompanha o perfil: ativar uma versão nova move, na
 * mesma transação, os produtos que apontavam para a versão anterior DESTE
 * perfil (§89). Produto de outro perfil, ou sem perfil, não é tocado.
 */

export interface ProductProductionProfileDTO {
  productId: string;
  productCode: string;
  productName: string;
  /** Unidade do item de produto acabado; `null` quando o produto não tem item. */
  productUomCode: string | null;
  version: {
    id: string;
    productionProfileId: string;
    profileCode: string;
    profileName: string;
    versionNumber: number;
    status: TemplateVersionStatus;
    referenceQuantity: string;
    referenceUomCode: string;
  } | null;
}

// ─────────────────────────────────────────────────────────────── cálculo

/** Entrada inválida para o cálculo — a tela mostra travessão, nunca zero. */
export class ProductionPlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionPlanInputError";
  }
}

export interface ProductionPlanStepInput {
  sequence: number;
  name: string;
  setupDurationMinutes: number | string;
  runDurationMinutes: number | string;
  scalingMode: ProductionStepScalingMode;
  resources: readonly {
    industrialResourceId: string;
    resourceName: string;
    resourceType?: IndustrialResourceType | null;
    resourceQuantity: number;
  }[];
}

export interface ProductionPlanStepResource {
  industrialResourceId: string;
  resourceName: string;
  resourceQuantity: number;
  /** Quantidade de recursos × duração da etapa, em minutos-recurso. */
  demandMinutes: string;
}

export interface ProductionPlanStep {
  sequence: number;
  name: string;
  scalingMode: ProductionStepScalingMode;
  /** Só em `BY_BATCH`: ceil(quantidade ÷ base). `null` no proporcional. */
  batches: number | null;
  setupMinutes: string;
  runMinutes: string;
  /** Preparação + execução. */
  durationMinutes: string;
  resources: ProductionPlanStepResource[];
}

export interface ProductionPlanResource {
  industrialResourceId: string;
  resourceName: string;
  resourceType: IndustrialResourceType | null;
  /** Soma, entre as etapas, da demanda deste recurso, em minutos-recurso. */
  demandMinutes: string;
}

export interface ProductionPlan {
  quantity: string;
  referenceQuantity: string;
  steps: ProductionPlanStep[];
  /** Soma das durações — nesta fase toda etapa é sequencial. */
  totalDurationMinutes: string;
  resources: ProductionPlanResource[];
}

function lerDecimal(valor: string | number, rotulo: string): DecimalInstance {
  try {
    const numero = new Decimal(typeof valor === "number" ? valor : valor.trim());
    if (numero.isFinite()) return numero;
  } catch {
    // cai na recusa abaixo
  }
  throw new ProductionPlanInputError(`${rotulo}: valor inválido.`);
}

function positivo(valor: string | number, rotulo: string): DecimalInstance {
  const numero = lerDecimal(valor, rotulo);
  if (numero.lte(0)) throw new ProductionPlanInputError(`${rotulo}: informe um valor maior que zero.`);
  return numero;
}

function naoNegativo(valor: string | number, rotulo: string): DecimalInstance {
  const numero = lerDecimal(valor, rotulo);
  if (numero.lt(0)) throw new ProductionPlanInputError(`${rotulo}: o valor não pode ser negativo.`);
  return numero;
}

/**
 * A conta canônica do Perfil de Produção para uma quantidade — o MESMO motor
 * na prévia da tela e no servidor (e, depois, na cópia para a OP).
 *
 * - **Proporcional:** execução × quantidade ÷ base. 2 h por 1.000 un, para
 *   3.000 un, são 6 h.
 * - **Por lote:** execução × ceil(quantidade ÷ base). 1.500 un em lotes de
 *   1.000 são 2 lotes, e 2 h por lote são 4 h — nunca regra de três.
 * - **Preparação não escala:** 30 min são 30 min para 1 lote ou para 3.
 * - **Duração da etapa** = preparação + execução. A quantidade de recursos não
 *   alonga a etapa: 2 operadores por 3 h são 3 h de etapa.
 * - **Demanda do recurso** = quantidade de recursos × duração da etapa — o
 *   recurso fica ocupado também na preparação. 2 operadores × 3 h = 6
 *   horas-recurso.
 * - **Total sequencial** = soma das durações: nesta fase nenhuma etapa corre
 *   em paralelo com outra.
 *
 * Nada de calendário, turno ou data: são minutos corridos de trabalho.
 * Decimal do começo ao fim; minutos saem como decimal-string canônica.
 */
export function planProductionProfile(
  profile: { referenceQuantity: string | number; steps: readonly ProductionPlanStepInput[] },
  quantity: string | number,
): ProductionPlan {
  const base = positivo(profile.referenceQuantity, "Quantidade de referência");
  const alvo = positivo(quantity, "Quantidade");

  const porRecurso = new Map<
    string,
    { resourceName: string; resourceType: IndustrialResourceType | null; demanda: DecimalInstance }
  >();
  let total = new Decimal(0);

  const steps = [...profile.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((etapa): ProductionPlanStep => {
      const rotulo = `Etapa ${etapa.sequence}`;
      const preparacao = naoNegativo(etapa.setupDurationMinutes, `${rotulo} — preparação`);
      const execucaoBase = naoNegativo(etapa.runDurationMinutes, `${rotulo} — execução`);

      let lotes: number | null = null;
      let execucao: DecimalInstance;
      if (etapa.scalingMode === "BY_BATCH") {
        const quantosLotes = alvo.dividedBy(base).ceil();
        lotes = quantosLotes.toNumber();
        execucao = execucaoBase.times(quantosLotes);
      } else {
        execucao = execucaoBase.times(alvo).dividedBy(base);
      }
      const duracao = preparacao.plus(execucao);
      total = total.plus(duracao);

      const resources = etapa.resources.map((recurso) => {
        if (!Number.isInteger(recurso.resourceQuantity) || recurso.resourceQuantity < 1) {
          throw new ProductionPlanInputError(
            `${rotulo} — ${recurso.resourceName}: a quantidade de recursos é um inteiro maior ou igual a 1.`,
          );
        }
        const demanda = duracao.times(recurso.resourceQuantity);
        const acumulado = porRecurso.get(recurso.industrialResourceId);
        if (acumulado) {
          acumulado.demanda = acumulado.demanda.plus(demanda);
        } else {
          porRecurso.set(recurso.industrialResourceId, {
            resourceName: recurso.resourceName,
            resourceType: recurso.resourceType ?? null,
            demanda,
          });
        }
        return {
          industrialResourceId: recurso.industrialResourceId,
          resourceName: recurso.resourceName,
          resourceQuantity: recurso.resourceQuantity,
          demandMinutes: demanda.toFixed(),
        };
      });

      return {
        sequence: etapa.sequence,
        name: etapa.name,
        scalingMode: etapa.scalingMode,
        batches: lotes,
        setupMinutes: preparacao.toFixed(),
        runMinutes: execucao.toFixed(),
        durationMinutes: duracao.toFixed(),
        resources,
      };
    });

  return {
    quantity: alvo.toFixed(),
    referenceQuantity: base.toFixed(),
    steps,
    totalDurationMinutes: total.toFixed(),
    resources: [...porRecurso.entries()].map(([industrialResourceId, acumulado]) => ({
      industrialResourceId,
      resourceName: acumulado.resourceName,
      resourceType: acumulado.resourceType,
      demandMinutes: acumulado.demanda.toFixed(),
    })),
  };
}

// ─────────────────────────────────────────── contrato da cópia para a OP

/**
 * O que uma Ordem de Produção vai receber do Perfil — PLANNING-OP-SNAPSHOT-01.
 *
 * CÓPIA integral e autossuficiente: nome, tempos, modo de escala e recursos
 * viajam por valor. Os ids de origem são proveniência, nunca canal — mudar o
 * Perfil depois não muda a OP que já recebeu a cópia (§89).
 */
export interface ProductionProfileSnapshot {
  sourceProfileId: string;
  sourceProfileCode: string;
  sourceProfileName: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  referenceQuantity: string;
  referenceUomCode: string;
  steps: {
    sequence: number;
    name: string;
    description: string | null;
    setupDurationMinutes: number;
    runDurationMinutes: number;
    scalingMode: ProductionStepScalingMode;
    resources: {
      industrialResourceId: string;
      resourceCode: string;
      resourceName: string;
      resourceType: IndustrialResourceType;
      resourceQuantity: number;
    }[];
  }[];
}

/**
 * A projeção do roteiro CONGELADO para uma quantidade — adapter mínimo em
 * torno de `planProductionProfile`, e a única ponte entre a cópia e o motor.
 *
 * Existe para que servidor e tela leiam a MESMA cópia da mesma forma: mudar a
 * quantidade da OP refaz esta conta, nunca a cópia. Nome e tipo do recurso
 * saem do snapshot, não do cadastro — renomear ou desativar um recurso depois
 * não muda o que a OP mostra.
 */
export function planProductionProfileSnapshot(
  snapshot: ProductionProfileSnapshot,
  quantity: string | number,
): ProductionPlan {
  return planProductionProfile(
    {
      referenceQuantity: snapshot.referenceQuantity,
      steps: snapshot.steps.map((etapa) => ({
        sequence: etapa.sequence,
        name: etapa.name,
        setupDurationMinutes: etapa.setupDurationMinutes,
        runDurationMinutes: etapa.runDurationMinutes,
        scalingMode: etapa.scalingMode,
        resources: etapa.resources.map((recurso) => ({
          industrialResourceId: recurso.industrialResourceId,
          resourceName: recurso.resourceName,
          resourceType: recurso.resourceType,
          resourceQuantity: recurso.resourceQuantity,
        })),
      })),
    },
    quantity,
  );
}

/** Rascunho ainda muda: copiar um seria congelar um roteiro que ninguém aprovou. */
export class ProductionProfileDraftNotCopyableError extends Error {
  constructor(versionLabel: string) {
    super(`${versionLabel} está em rascunho e não pode ser copiada — ative a versão antes.`);
    this.name = "ProductionProfileDraftNotCopyableError";
  }
}

export function productionProfileSnapshot(
  version: ProductionProfileVersionDTO,
): ProductionProfileSnapshot {
  if (version.status === "DRAFT") {
    throw new ProductionProfileDraftNotCopyableError(`${version.profileCode} ${version.versionLabel}`);
  }
  return {
    sourceProfileId: version.productionProfileId,
    sourceProfileCode: version.profileCode,
    sourceProfileName: version.profileName,
    sourceVersionId: version.id,
    sourceVersionNumber: version.versionNumber,
    referenceQuantity: version.referenceQuantity,
    referenceUomCode: version.referenceUomCode,
    steps: [...version.steps]
      .sort((a, b) => a.sequence - b.sequence)
      .map((etapa) => ({
        sequence: etapa.sequence,
        name: etapa.name,
        description: etapa.description,
        setupDurationMinutes: etapa.setupDurationMinutes,
        runDurationMinutes: etapa.runDurationMinutes,
        scalingMode: etapa.scalingMode,
        resources: etapa.resources.map((recurso) => ({
          industrialResourceId: recurso.industrialResourceId,
          resourceCode: recurso.resourceCode,
          resourceName: recurso.resourceName,
          resourceType: recurso.resourceType,
          resourceQuantity: recurso.resourceQuantity,
        })),
      })),
  };
}
