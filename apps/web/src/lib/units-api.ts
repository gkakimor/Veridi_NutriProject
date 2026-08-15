import type { UnitOfMeasureDTO } from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function listUnits(): Promise<UnitOfMeasureDTO[]> {
  const response = await fetch(`${API_URL}/units`);
  return (await parseJsonOrThrow(response)) as UnitOfMeasureDTO[];
}
