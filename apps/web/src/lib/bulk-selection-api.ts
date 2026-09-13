import type { BulkSelectionDescriptor } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";
import { fileNameFromDisposition } from "./download-file";

/**
 * O descritor da seleção em massa vai ao servidor por POST (BULK-DOCUMENTS-01):
 * filtro e exceções não cabem numa URL, e quem resolve o conjunto é o
 * servidor. A tela nunca junta os ids de "todos os filtrados".
 */

function enviar<F>(path: string, selection: BulkSelectionDescriptor<F>): Promise<Response> {
  return apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  });
}

export async function postSelection<F, T>(path: string, selection: BulkSelectionDescriptor<F>): Promise<T> {
  return (await parseJsonOrThrow(await enviar(path, selection))) as T;
}

/** Arquivo pronto do servidor: o corpo e o nome que ele mandou. Recusa vira o erro da API. */
export async function postSelectionForFile<F>(
  path: string,
  selection: BulkSelectionDescriptor<F>,
  fallbackFileName: string,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await enviar(path, selection);
  if (!response.ok) await parseJsonOrThrow(response);
  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackFileName),
  };
}
