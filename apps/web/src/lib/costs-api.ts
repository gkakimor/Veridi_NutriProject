import type {
  CostReferenceDTO,
  FormulationCostEstimateDTO,
  ProductionOrderMaterialCostDTO,
  ReceiptDTO,
  SetAcquisitionCostInput,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Define/atualiza/limpa o custo efetivo de aquisição de uma linha de
 * recebimento. É custeio, nunca recebimento físico: não altera
 * quantidade/lote/estoque.
 */
export async function setAcquisitionCost(
  receiptLineId: string,
  input: SetAcquisitionCostInput,
): Promise<ReceiptDTO> {
  const response = await fetch(`${API_URL}/receipt-lines/${receiptLineId}/acquisition-cost`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ReceiptDTO;
}

export async function getItemCostReference(
  itemId: string,
  referenceDate?: string,
): Promise<CostReferenceDTO> {
  const query = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
  const response = await fetch(`${API_URL}/items/${itemId}/cost-reference${query}`);
  return (await parseJsonOrThrow(response)) as CostReferenceDTO;
}

export async function getFormulationCostEstimate(
  formulationVersionId: string,
): Promise<FormulationCostEstimateDTO> {
  const response = await fetch(`${API_URL}/formulation-versions/${formulationVersionId}/cost-estimate`);
  return (await parseJsonOrThrow(response)) as FormulationCostEstimateDTO;
}

export async function getProductionOrderMaterialCost(
  productionOrderId: string,
): Promise<ProductionOrderMaterialCostDTO> {
  const response = await fetch(`${API_URL}/production-orders/${productionOrderId}/material-cost`);
  return (await parseJsonOrThrow(response)) as ProductionOrderMaterialCostDTO;
}
