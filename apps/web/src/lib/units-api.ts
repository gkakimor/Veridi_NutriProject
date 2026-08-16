import type { UnitOfMeasureDTO } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function listUnits(): Promise<UnitOfMeasureDTO[]> {
  const response = await apiFetch(`${API_URL}/units`);
  return (await parseJsonOrThrow(response)) as UnitOfMeasureDTO[];
}
