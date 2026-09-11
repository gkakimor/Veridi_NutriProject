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
  availableProfile: null,
  canApply: false,
  canUpdate: false,
};
