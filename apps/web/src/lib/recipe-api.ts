import type { RecipeSheetDTO, RegisterWeighingInput } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function getRecipeSheet(productionOrderId: string): Promise<RecipeSheetDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${productionOrderId}/recipe`);
  return (await parseJsonOrThrow(response)) as RecipeSheetDTO;
}

/** Pesagem confirmada = consumo real. O operador vem da sessão, nunca do corpo. */
export async function registerWeighing(
  productionOrderId: string,
  partNumber: number,
  input: RegisterWeighingInput,
): Promise<RecipeSheetDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/parts/${partNumber}/weighings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await parseJsonOrThrow(response)) as RecipeSheetDTO;
}

export async function completePart(
  productionOrderId: string,
  partNumber: number,
): Promise<RecipeSheetDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/parts/${partNumber}/complete`,
    { method: "POST" },
  );
  return (await parseJsonOrThrow(response)) as RecipeSheetDTO;
}
