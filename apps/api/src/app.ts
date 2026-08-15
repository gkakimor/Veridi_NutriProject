import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { itemsRoutes } from "./modules/items/items.routes.js";
import { unitsRoutes } from "./modules/units/units.routes.js";
import { suppliersRoutes } from "./modules/suppliers/suppliers.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";

/**
 * Monta a instancia Fastify.
 *
 * Novos modulos de dominio (itens, fornecedores, compras, estoque, producao)
 * entram aqui como plugins, um por handoff.
 */
export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  // Em desenvolvimento o frontend (Vite) roda em outra porta.
  // Em producao a politica deve ser restringida a origem real do Veridi.
  app.register(cors, {
    origin: env.NODE_ENV === "production" ? env.WEB_ORIGIN : true,
  });

  app.register(healthRoutes);
  app.register(itemsRoutes);
  app.register(unitsRoutes);
  app.register(suppliersRoutes);
  app.register(customersRoutes);

  return app;
}

export type App = ReturnType<typeof buildApp>;
