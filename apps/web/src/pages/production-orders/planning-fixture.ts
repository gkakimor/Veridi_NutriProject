import type { ProductionOrderPlanningDTO } from "@veridi/shared";

/**
 * OP sem Perfil de Produção aplicado — o estado neutro do Planejamento.
 *
 * Não é um buraco no contrato: produto sem perfil padrão, e OP anterior à
 * capability, são situações legítimas, e `snapshot` nulo não bloqueia criar
 * nem liberar. A tela desenha a seção vazia.
 *
 * Existe porque as fixtures de OP montavam o DTO com
 * `as unknown as ProductionOrderDTO` e o campo simplesmente não ia junto — o
 * compilador calava e a tela quebrava ao desestruturar `order.planning`. O
 * caminho certo é a fixture dizer qual planejamento a OP tem; a alternativa
 * (afrouxar o contrato para o teste passar) esconderia o mesmo defeito no
 * código de produção.
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
