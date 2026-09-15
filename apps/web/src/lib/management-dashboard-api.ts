import type { ManagementDashboardDTO, ManagementPeriodPreset } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ManagementDashboardParams {
  period: ManagementPeriodPreset;
  /** `YYYY-MM-DD`, só no Personalizado. */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Read model do Painel Gerencial. Os atalhos vão pelo nome e o servidor os
 * resolve no dia comercial; só o Personalizado leva as duas datas, em dias.
 */
export async function getManagementDashboard(params: ManagementDashboardParams): Promise<ManagementDashboardDTO> {
  const query = new URLSearchParams({ period: params.period });
  if (params.period === "custom") {
    if (params.dateFrom) query.set("dateFrom", params.dateFrom);
    if (params.dateTo) query.set("dateTo", params.dateTo);
  }
  const response = await apiFetch(`${API_URL}/management-dashboard?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ManagementDashboardDTO;
}
