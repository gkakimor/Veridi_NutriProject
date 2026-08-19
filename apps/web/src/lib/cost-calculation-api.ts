import type {
  IndustrialCostCalculationDTO,
  IndustrialCostCalculationSnapshotDTO,
  IndustrialCostCalculationSummaryDTO,
  ProductionOrderCostDTO,
  SaveIndustrialCostCalculationInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Cálculo de custo industrial.
 *
 * O frontend não faz nenhuma conta econômica: pede o cálculo ao backend,
 * exibe o resultado e, ao salvar, o backend RECALCULA — o que está na tela
 * nunca é aceito como verdade.
 */
export async function calculateIndustrialCost(
  versionId: string,
  referenceDate?: string,
): Promise<IndustrialCostCalculationDTO> {
  const query = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
  const response = await apiFetch(`${API_URL}/industrial-costs/${versionId}/calculate${query}`);
  return (await parseJsonOrThrow(response)) as IndustrialCostCalculationDTO;
}

export async function saveIndustrialCostCalculation(
  versionId: string,
  input: SaveIndustrialCostCalculationInput = {},
): Promise<IndustrialCostCalculationSnapshotDTO> {
  const response = await apiFetch(`${API_URL}/industrial-costs/${versionId}/calculations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as IndustrialCostCalculationSnapshotDTO;
}

export async function getIndustrialCostCalculation(
  id: string,
): Promise<IndustrialCostCalculationSnapshotDTO> {
  const response = await apiFetch(`${API_URL}/industrial-cost-calculations/${id}`);
  return (await parseJsonOrThrow(response)) as IndustrialCostCalculationSnapshotDTO;
}

export async function listProductCostCalculations(
  productId: string,
): Promise<IndustrialCostCalculationSummaryDTO[]> {
  const response = await apiFetch(`${API_URL}/products/${productId}/cost-calculations`);
  const body = (await parseJsonOrThrow(response)) as {
    calculations: IndustrialCostCalculationSummaryDTO[];
  };
  return body.calculations;
}

export async function getProductionOrderCost(
  productionOrderId: string,
): Promise<ProductionOrderCostDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${productionOrderId}/cost`);
  return (await parseJsonOrThrow(response)) as ProductionOrderCostDTO;
}

/**
 * Descarta um cálculo salvo. Recusado (409) se alguma precificação o cita —
 * apagar a base de um preço deixaria o preço sem origem verificável.
 */
export async function discardIndustrialCostCalculation(id: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/industrial-cost-calculations/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) await parseJsonOrThrow(response);
}
