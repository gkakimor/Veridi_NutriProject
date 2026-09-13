import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import type {
  CustomerOrderSelectionDocumentsResponse,
  ProductionOrderSelectionDocument,
  ProductionOrderSelectionDocumentsResponse,
} from "@veridi/shared";
import { hojeComercial } from "@veridi/shared";
import { BULK_PDF_SELECTION_LIMIT, selectionErrorResponse } from "../../lib/bulk-selection.js";
import { buildCsv } from "../../lib/csv.js";
import { findProductionOrderMaterialCost } from "../costs/costs.service.js";
import { customerOrderSelectionSchema } from "../customer-orders/customer-orders.schemas.js";
import { resolveCustomerOrderSelection } from "../customer-orders/customer-orders.service.js";
import { customerOrderCsvColumns, productionOrderCsvColumns } from "../exports/list-exports.js";
import { productionOrderSelectionSchema } from "../production-orders/production-orders.schemas.js";
import { resolveProductionOrderSelection } from "../production-orders/production-orders.service.js";

/**
 * DOCUMENTOS DA SELEÇÃO EM MASSA — BULK-DOCUMENTS-01.
 *
 * `POST /customer-orders/bulk/documents`, `POST /customer-orders/bulk/export.csv`,
 * `POST /production-orders/bulk/documents`, `POST /production-orders/bulk/export.csv`.
 *
 * POST porque o descritor carrega filtro e exceções — centenas de ids não
 * cabem na URL. Só leitura: nada muda de status, nada é gravado. Quem pode
 * abrir o Pedido ou a OP (toda sessão válida) pode gerar o documento deles;
 * a seleção nunca alcança mais do que a listagem alcança.
 *
 * O PDF oficial é gerado no navegador (`apps/web/src/pdf/render.ts`): aqui
 * sai o conjunto já resolvido, conferido e na ordem da listagem, com o dado
 * que o documento individual de cada registro recebe. O CSV sai pronto, com
 * as colunas da exportação da listagem e sem teto de 500.
 */

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function enviarCsv(reply: FastifyReply, csv: string, base: string) {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${base}-${hojeComercial()}.csv"`)
    .send(csv);
}

/** O custo é complementar, como no documento individual; em lotes, sem abrir centenas de consultas juntas. */
async function comCusto(ordens: Awaited<ReturnType<typeof resolveProductionOrderSelection>>) {
  const documentos: ProductionOrderSelectionDocument[] = [];
  const LOTE = 20;
  for (let inicio = 0; inicio < ordens.length; inicio += LOTE) {
    const fatia = ordens.slice(inicio, inicio + LOTE);
    const custos = await Promise.all(fatia.map((ordem) => findProductionOrderMaterialCost(ordem.id)));
    fatia.forEach((ordem, indice) => documentos.push({ order: ordem, cost: custos[indice] ?? null }));
  }
  return documentos;
}

export const bulkDocumentsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/customer-orders/bulk/documents", async (request, reply) => {
    const parsed = customerOrderSelectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    try {
      const documents = await resolveCustomerOrderSelection(parsed.data, BULK_PDF_SELECTION_LIMIT);
      const resposta: CustomerOrderSelectionDocumentsResponse = { total: documents.length, documents };
      return reply.send(resposta);
    } catch (error) {
      const mapped = selectionErrorResponse(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/bulk/export.csv", async (request, reply) => {
    const parsed = customerOrderSelectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    try {
      const pedidos = await resolveCustomerOrderSelection(parsed.data);
      return enviarCsv(reply, buildCsv(customerOrderCsvColumns, pedidos), "pedidos-selecionados");
    } catch (error) {
      const mapped = selectionErrorResponse(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/bulk/documents", async (request, reply) => {
    const parsed = productionOrderSelectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    try {
      const ordens = await resolveProductionOrderSelection(parsed.data, BULK_PDF_SELECTION_LIMIT);
      const resposta: ProductionOrderSelectionDocumentsResponse = {
        total: ordens.length,
        documents: await comCusto(ordens),
      };
      return reply.send(resposta);
    } catch (error) {
      const mapped = selectionErrorResponse(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/bulk/export.csv", async (request, reply) => {
    const parsed = productionOrderSelectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    try {
      const ordens = await resolveProductionOrderSelection(parsed.data);
      return enviarCsv(reply, buildCsv(productionOrderCsvColumns, ordens), "ordens-producao-selecionadas");
    } catch (error) {
      const mapped = selectionErrorResponse(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
