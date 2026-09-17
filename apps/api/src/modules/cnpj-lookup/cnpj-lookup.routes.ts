import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  CNPJ_LOOKUP_UNAVAILABLE_ERROR,
  CNPJ_LOOKUP_UNAVAILABLE_MESSAGE,
  CNPJ_NOT_FOUND_ERROR,
  CNPJ_NOT_FOUND_MESSAGE,
  CUSTOMER_EDIT_ROLES,
} from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import { CnpjLookupUnavailableError, CnpjNotFoundError } from "./cnpj-lookup.errors.js";
import { cnpjLookupParamsSchema, cnpjLookupQuerySchema } from "./cnpj-lookup.schemas.js";
import { lookupCnpj } from "./cnpj-lookup.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /cnpj-lookup/:cnpj?provider=OPEN_CNPJ` — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * Endpoint próprio, autenticado, e SOMENTE LEITURA: consultar não cria, não
 * altera e não grava nada no domínio Veridi.
 *
 * Quem consulta é quem edita o cadastro do Cliente (`CUSTOMER_EDIT_ROLES`,
 * §98) — a consulta existe para preencher aquele formulário, e oferecê-la a
 * quem não pode gravar seria dar um caminho para a API externa sem nenhum uso
 * no sistema. A política do Cliente continua sendo a autoridade: se ela mudar,
 * esta rota muda junto, porque lê a MESMA lista.
 *
 * A chamada externa acontece aqui, no servidor, nunca no navegador. O CNPJ é
 * validado antes de sair da máquina, o provedor precisa estar no registro
 * conhecido, e nem stack nem payload cru do provedor chegam à tela: a Web
 * recebe dois erros tratados e nada mais.
 */
export const cnpjLookupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cnpj-lookup/:cnpj", async (request, reply) => {
    const actor = exigirPerfil(request, reply, CUSTOMER_EDIT_ROLES);
    if (!actor) return reply;

    const params = cnpjLookupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(params.error) });
    }

    const query = cnpjLookupQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(query.error) });
    }

    try {
      const result = await lookupCnpj(params.data.cnpj, query.data.provider);
      return reply.send(result);
    } catch (error) {
      if (error instanceof CnpjNotFoundError) {
        return reply
          .status(404)
          .send({ error: CNPJ_NOT_FOUND_ERROR, message: CNPJ_NOT_FOUND_MESSAGE });
      }
      if (error instanceof CnpjLookupUnavailableError) {
        /*
         * O motivo técnico fica no log da API — timeout, 5xx do provedor,
         * limite de uso, JSON ilegível. Para quem cadastra a conduta é uma só,
         * e a resposta diz exatamente essa conduta: siga preenchendo à mão.
         *
         * 503, e não 500: a API está de pé; quem não respondeu foi a fonte.
         */
        request.log.warn({ reason: error.reason }, "consulta de CNPJ indisponível");
        return reply.status(503).send({
          error: CNPJ_LOOKUP_UNAVAILABLE_ERROR,
          message: CNPJ_LOOKUP_UNAVAILABLE_MESSAGE,
        });
      }
      throw error;
    }
  });
};
