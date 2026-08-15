import type { UnitOfMeasureDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";

/** Sem tela administrativa no MVP: apenas leitura para popular seleções de item. */
export async function listUnitsOfMeasure(): Promise<UnitOfMeasureDTO[]> {
  const units = await getPrisma().unitOfMeasure.findMany({
    orderBy: [{ dimension: "asc" }, { toBaseFactor: "asc" }],
  });

  return units.map((unit) => ({
    code: unit.code,
    label: unit.label,
    dimension: unit.dimension,
  }));
}
