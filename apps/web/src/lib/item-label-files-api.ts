import type { ItemLabelFileResponse } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Arquivo do Item Rótulo — LABEL-ATTACHMENTS-01.
 *
 * O navegador fala só com a API do Veridi: nunca recebe endereço do bucket,
 * chave de acesso ou URL assinada. O download é um endpoint autenticado pela
 * sessão, como o dos anexos.
 */

function base(itemId: string): string {
  return `${API_URL}/items/${encodeURIComponent(itemId)}/label-file`;
}

export async function getItemLabelFile(itemId: string): Promise<ItemLabelFileResponse> {
  const response = await apiFetch(base(itemId));
  return (await parseJsonOrThrow(response)) as ItemLabelFileResponse;
}

/** Nova versão. A observação vai antes do arquivo — o formulário é lido em ordem. */
export async function uploadItemLabelFileVersion(
  itemId: string,
  file: File,
  note?: string,
): Promise<ItemLabelFileResponse> {
  const form = new FormData();
  const observacao = note?.trim();
  if (observacao) form.append("note", observacao);
  form.append("file", file);

  const response = await apiFetch(`${base(itemId)}/versions`, { method: "POST", body: form });
  return (await parseJsonOrThrow(response)) as ItemLabelFileResponse;
}

export async function voidItemLabelFileVersion(
  itemId: string,
  versionId: string,
  reason: string,
): Promise<ItemLabelFileResponse> {
  const response = await apiFetch(`${base(itemId)}/versions/${encodeURIComponent(versionId)}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return (await parseJsonOrThrow(response)) as ItemLabelFileResponse;
}

export async function restoreItemLabelFileVersion(
  itemId: string,
  versionId: string,
  note?: string,
): Promise<ItemLabelFileResponse> {
  const observacao = note?.trim();
  const response = await apiFetch(`${base(itemId)}/versions/${encodeURIComponent(versionId)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(observacao ? { note: observacao } : {}),
  });
  return (await parseJsonOrThrow(response)) as ItemLabelFileResponse;
}

export function itemLabelFileDownloadUrl(itemId: string, versionId: string): string {
  return `${base(itemId)}/versions/${encodeURIComponent(versionId)}/download`;
}
