import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import type {
  CustomerCnpjRegistrationHistoryResponse,
  CustomerStatusAction,
  CustomerStatusHistoryResponse,
} from "@veridi/shared";
import { CUSTOMER_EDIT_ROLES, CUSTOMER_STATUS_CHANGE_ROLES } from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import {
  InstallmentsWithoutCountError,
  respostaDaRecusaDeParcelas,
} from "../../lib/payment-condition.js";
import {
  createCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
} from "./customers.service.js";
import { changeCustomerStatus, listCustomerStatusHistory } from "./customer-status.js";
import {
  CnpjRegistrationMismatchError,
  listarHistoricoDosDadosDoCnpj,
  respostaDaRecusaDosDadosDoCnpj,
} from "./customer-cnpj-registration.js";
import {
  CustomerNotFoundError,
  DuplicateCnpjError,
  InvalidCustomerStatusTransitionError,
} from "./customers.errors.js";
import {
  createCustomerSchema,
  customerStatusChangeSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from "./customers.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /customers`, `GET /customers/:id`, `POST /customers`,
 * `PATCH /customers/:id`, `GET /customers/:id/status-history`,
 * `GET /customers/:id/cnpj-registration-history` (§122) e as quatro
 * ações de situação cadastral (§95): `POST /customers/:id/block`,
 * `/unblock`, `/deactivate` e `/activate`, todas com motivo obrigatório.
 *
 * Criar e editar o cadastro são de Comercial e Administrador
 * (`CUSTOMER_EDIT_ROLES`); mudar a situação também
 * (`CUSTOMER_STATUS_CHANGE_ROLES`) — duas listas, porque são duas perguntas.
 *
 * Sem exclusão física: clientes bloqueados e inativos permanecem consultáveis,
 * com o histórico inteiro — a leitura segue aberta a toda sessão.
 */
export const customersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customers", async (request, reply) => {
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listCustomers(parsed.data);
    return reply.send(result);
  });

  app.get("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await getCustomerById(id);
    if (!customer) return reply.status(404).send({ error: "not_found" });
    return reply.send(customer);
  });

  app.post("/customers", async (request, reply) => {
    const actor = exigirPerfil(request, reply, CUSTOMER_EDIT_ROLES);
    if (!actor) return reply;

    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const customer = await createCustomer(parsed.data, actor);
      return reply.status(201).send(customer);
    } catch (error) {
      if (error instanceof DuplicateCnpjError) {
        return reply
          .status(400)
          .send({ error: "duplicate_cnpj", message: error.message });
      }
      // Pagamento padrão parcelado sem parcelas: recusa de validação, no campo.
      if (error instanceof InstallmentsWithoutCountError) {
        return reply.status(400).send(respostaDaRecusaDeParcelas(error));
      }
      // Dados cadastrais de um CNPJ enviados com outro (§119): recusa no campo CNPJ.
      if (error instanceof CnpjRegistrationMismatchError) {
        return reply.status(400).send(respostaDaRecusaDosDadosDoCnpj(error));
      }
      throw error;
    }
  });

  app.patch("/customers/:id", async (request, reply) => {
    // Antes do `id` servir para qualquer leitura: sem permissão, cliente
    // existente e inexistente recebem a mesma resposta.
    const actor = exigirPerfil(request, reply, CUSTOMER_EDIT_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const customer = await updateCustomer(id, parsed.data, actor);
      return reply.send(customer);
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof DuplicateCnpjError) {
        return reply
          .status(400)
          .send({ error: "duplicate_cnpj", message: error.message });
      }
      if (error instanceof InstallmentsWithoutCountError) {
        return reply.status(400).send(respostaDaRecusaDeParcelas(error));
      }
      if (error instanceof CnpjRegistrationMismatchError) {
        return reply.status(400).send(respostaDaRecusaDosDadosDoCnpj(error));
      }
      throw error;
    }
  });

  /**
   * As quatro ações têm o MESMO corpo (motivo) e o mesmo tratamento: só muda
   * qual transição elas pedem. Ação que não parte da situação atual é recusa
   * de negócio — 409 com a frase do domínio —, nunca 500.
   */
  async function mudarSituacao(
    request: FastifyRequest,
    reply: FastifyReply,
    action: CustomerStatusAction,
  ) {
    const actor = exigirPerfil(request, reply, CUSTOMER_STATUS_CHANGE_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    const parsed = customerStatusChangeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      await changeCustomerStatus(id, action, parsed.data.reason, actor);
      return reply.send(await getCustomerById(id));
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidCustomerStatusTransitionError) {
        return reply
          .status(409)
          .send({ error: "invalid_status_transition", message: error.message });
      }
      throw error;
    }
  }

  app.post("/customers/:id/block", async (request, reply) =>
    mudarSituacao(request, reply, "BLOCK"),
  );

  app.post("/customers/:id/unblock", async (request, reply) =>
    mudarSituacao(request, reply, "UNBLOCK"),
  );

  app.post("/customers/:id/deactivate", async (request, reply) =>
    mudarSituacao(request, reply, "DEACTIVATE"),
  );

  app.post("/customers/:id/activate", async (request, reply) =>
    mudarSituacao(request, reply, "ACTIVATE"),
  );

  app.get("/customers/:id/status-history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await getCustomerById(id);
    if (!customer) return reply.status(404).send({ error: "not_found" });
    const response: CustomerStatusHistoryResponse = {
      events: await listCustomerStatusHistory(id),
    };
    return reply.send(response);
  });

  /**
   * Histórico dos dados cadastrais do CNPJ (§122), do mais recente para o mais
   * antigo. Leitura aberta a toda sessão, como o cadastro e o histórico de
   * situação: quem consulta o Cliente vê de onde veio cada dado.
   */
  app.get("/customers/:id/cnpj-registration-history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await getCustomerById(id);
    if (!customer) return reply.status(404).send({ error: "not_found" });
    const response: CustomerCnpjRegistrationHistoryResponse = {
      events: await listarHistoricoDosDadosDoCnpj(id),
    };
    return reply.send(response);
  });
};
