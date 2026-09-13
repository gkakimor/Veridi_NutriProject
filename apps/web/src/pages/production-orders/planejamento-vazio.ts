import type { ProductionOrderPlanningDTO } from "@veridi/shared";

/**
 * Planejamento previsto AUSENTE — o estado de uma OP sem perfil de produção
 * aplicado (produto sem padrão, ou ordem anterior à migration).
 *
 * Mora aqui, e não dentro de cada teste, porque é o valor neutro de fixtures
 * que não tratam de planejamento: elas não deviam ter de repetir sete campos
 * para falar de reconciliação ou de apontamento.
 */
export const PLANEJAMENTO_VAZIO: ProductionOrderPlanningDTO = {
  snapshot: null,
  plan: null,
  appliedAt: null,
  appliedBy: null,
  quantityInReferenceUom: null,
  conversionUnits: [],
  planBlockedReason: null,
  applicationSource: null,
  applicationReason: null,
  productDefaultProfile: null,
  productDefaultCompatible: false,
  availableProfile: null,
  canApply: false,
  canChoose: false,
  canUpdate: false,
  requiresLegacyRepair: false,
  // Neutro: sem pendência, para as ações da OP ficarem como o teste espera.
  // Teste de roteiro monta o próprio planejamento.
  routePending: false,
};
