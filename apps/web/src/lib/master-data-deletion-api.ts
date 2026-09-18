import type {
  MasterDataDeletionCheckDTO,
  MasterDataDeletionReferenceDTO,
  MasterDataDeletionResultDTO,
  MasterDataEntityType,
} from "@veridi/shared";
import { MASTER_DATA_DELETION_PATHS, MASTER_DATA_IN_USE_ERROR } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Exclusão física de cadastro mestre — MASTER-DATA-HARD-DELETE-01.
 *
 * A tela não conhece tabela nem chave estrangeira: pergunta à prévia se pode
 * excluir e mostra o porquê que ela devolve. A API é a autoridade — só o
 * Administrador consulta e exclui, e ela reconta tudo sob trava na exclusão.
 */

/**
 * O cadastro passou a ter uso entre a prévia e a confirmação (409
 * `master_data_in_use`): carrega as referências para a tela trocar a
 * confirmação pela explicação, sem nova consulta.
 */
export class CadastroEmUsoError extends Error {
  readonly references: MasterDataDeletionReferenceDTO[];

  constructor(message: string, references: MasterDataDeletionReferenceDTO[]) {
    super(message);
    this.name = "CadastroEmUsoError";
    this.references = references;
  }
}

const rota = (tipo: MasterDataEntityType, id: string) =>
  `${API_URL}${MASTER_DATA_DELETION_PATHS[tipo]}/${encodeURIComponent(id)}`;

export async function consultarExclusaoDefinitiva(
  tipo: MasterDataEntityType,
  id: string,
): Promise<MasterDataDeletionCheckDTO> {
  const response = await apiFetch(`${rota(tipo, id)}/deletion-check`);
  return (await parseJsonOrThrow(response)) as MasterDataDeletionCheckDTO;
}

export async function excluirDefinitivamente(
  tipo: MasterDataEntityType,
  id: string,
  reason: string,
): Promise<MasterDataDeletionResultDTO> {
  const response = await apiFetch(rota(tipo, id), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (response.status === 409) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: string; message?: string; references?: MasterDataDeletionReferenceDTO[] } | null;
    if (body?.error === MASTER_DATA_IN_USE_ERROR) {
      throw new CadastroEmUsoError(body.message ?? "Cadastro em uso.", body.references ?? []);
    }
  }
  return (await parseJsonOrThrow(response)) as MasterDataDeletionResultDTO;
}
