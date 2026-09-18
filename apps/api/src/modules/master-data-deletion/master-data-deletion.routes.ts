import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  MASTER_DATA_DELETE_ABORTED_ERROR,
  MASTER_DATA_DELETION_PATHS,
  MASTER_DATA_ENTITY_TYPES,
  MASTER_DATA_HARD_DELETE_ROLES,
  MASTER_DATA_IN_USE_ERROR,
} from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import {
  MasterDataDeleteAbortedError,
  MasterDataInUseError,
  MasterDataNotFoundError,
} from "./master-data-deletion.errors.js";
import { deleteMasterDataSchema } from "./master-data-deletion.schemas.js";
import { consultarExclusao, excluirCadastroMestre } from "./master-data-deletion.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Exclusão física de cadastro mestre — MASTER-DATA-HARD-DELETE-01.
 *
 * Para cada cadastro de `MASTER_DATA_DELETION_PATHS`:
 *
 *  - `GET <caminho>/:id/deletion-check` — a prévia: pode ou não, e por quê,
 *    razão por razão. Não grava nada (transação somente leitura);
 *  - `DELETE <caminho>/:id` com `{ reason }` — a exclusão.
 *
 * As duas são só do Administrador (D1), conferido ANTES do corpo e da
 * existência: sem permissão, cadastro existente e inexistente recebem o mesmo
 * 403. Motivo vazio é 400; cadastro em uso é 409 `master_data_in_use` com as
 * referências; o que não existe (inclusive a segunda exclusão) é 404; efeito
 * fora do agregado desfaz tudo e responde 409 `master_data_delete_aborted`.
 *
 * Estas são as ÚNICAS rotas de exclusão física de cadastro mestre — o teste de
 * contrato (`master-data-hard-delete-contrato.test.ts`) recusa qualquer outra.
 */
export const masterDataDeletionRoutes: FastifyPluginAsync = async (app) => {
  for (const tipo of MASTER_DATA_ENTITY_TYPES) {
    const caminho = MASTER_DATA_DELETION_PATHS[tipo];

    app.get(`${caminho}/:id/deletion-check`, async (request, reply) => {
      const actor = exigirPerfil(request, reply, MASTER_DATA_HARD_DELETE_ROLES);
      if (!actor) return reply;

      const { id } = request.params as { id: string };
      try {
        return reply.send(await consultarExclusao(tipo, id));
      } catch (error) {
        if (error instanceof MasterDataNotFoundError) return reply.status(404).send({ error: "not_found" });
        throw error;
      }
    });

    app.delete(`${caminho}/:id`, async (request, reply) => {
      const actor = exigirPerfil(request, reply, MASTER_DATA_HARD_DELETE_ROLES);
      if (!actor) return reply;

      const { id } = request.params as { id: string };
      const parsed = deleteMasterDataSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      try {
        return reply.send(await excluirCadastroMestre(tipo, id, parsed.data.reason, actor));
      } catch (error) {
        if (error instanceof MasterDataNotFoundError) return reply.status(404).send({ error: "not_found" });
        if (error instanceof MasterDataInUseError) {
          return reply
            .status(409)
            .send({ error: MASTER_DATA_IN_USE_ERROR, message: error.message, references: error.references });
        }
        if (error instanceof MasterDataDeleteAbortedError) {
          request.log.error({ inesperado: error.inesperado, tipo, id }, "exclusão física desfeita por efeito inesperado");
          return reply.status(409).send({ error: MASTER_DATA_DELETE_ABORTED_ERROR, message: error.message });
        }
        throw error;
      }
    });
  }
};
