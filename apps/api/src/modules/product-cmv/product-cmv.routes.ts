import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser } from "../../lib/current-user.js";
import { canSeePricingProvenance } from "../projects/quotes.service.js";
import {
  InvalidCmvQuantityError,
  InvalidCmvReferenceDateError,
  ProductCmvNotFoundError,
} from "./product-cmv.errors.js";
import { getProductCmv } from "./product-cmv.service.js";

/**
 * CMV do produto — uma rota de leitura, uma convenção.
 *
 *   GET /products/:id/cmv?quantity=1000&referenceDate=2026-08-18
 *
 * `quantity` e `referenceDate` são explícitas: o domínio nunca decide a data
 * por conta própria, porque o mesmo produto simulado hoje e no mês que vem
 * pode custar diferente e a resposta precisa dizer sobre qual dia ela fala.
 *
 * Simular é leitura: esta rota não escreve nada, nem cria cálculo.
 */
export const productCmvRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products/:id/cmv", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { quantity?: string; referenceDate?: string };

    try {
      const user = requireCurrentUser(request);

      const raw = (query.quantity ?? "").trim();
      if (!raw) throw new InvalidCmvQuantityError();
      let quantity: Prisma.Decimal;
      try {
        quantity = new Prisma.Decimal(raw);
      } catch {
        throw new InvalidCmvQuantityError();
      }
      if (!quantity.isFinite() || quantity.lessThanOrEqualTo(0)) throw new InvalidCmvQuantityError();

      const rawDate = (query.referenceDate ?? "").trim();
      if (!rawDate) throw new InvalidCmvReferenceDateError();
      const referenceDate = new Date(`${rawDate}T00:00:00.000Z`);
      if (Number.isNaN(referenceDate.getTime())) throw new InvalidCmvReferenceDateError();

      const result = await getProductCmv({
        productId: id,
        quantity,
        referenceDate,
        // Preço, faixa e margem são economia interna: mesmo gate do orçamento.
        includePricing: canSeePricingProvenance(user.role),
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return reply.status(403).send({ error: "forbidden", message: error.message });
      }
      if (error instanceof ProductCmvNotFoundError) {
        return reply.status(404).send({ error: "not_found", message: error.message });
      }
      if (error instanceof InvalidCmvQuantityError) {
        return reply.status(400).send({ error: "invalid_quantity", message: error.message });
      }
      if (error instanceof InvalidCmvReferenceDateError) {
        return reply.status(400).send({ error: "invalid_reference_date", message: error.message });
      }
      throw error;
    }
  });
};
