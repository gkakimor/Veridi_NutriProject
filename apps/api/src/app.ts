import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { authenticationHook } from "./lib/current-user.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { attachmentsRoutes } from "./modules/attachments/attachments.routes.js";
import { qualityRoutes } from "./modules/quality/quality.routes.js";
import { projectsRoutes } from "./modules/projects/projects.routes.js";
import { samplesRoutes } from "./modules/samples/samples.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { controlledDocumentsRoutes } from "./modules/controlled-documents/controlled-documents.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { itemsRoutes } from "./modules/items/items.routes.js";
import { unitsRoutes } from "./modules/units/units.routes.js";
import { suppliersRoutes } from "./modules/suppliers/suppliers.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { productsRoutes } from "./modules/products/products.routes.js";
import { purchaseOrdersRoutes } from "./modules/purchase-orders/purchase-orders.routes.js";
import { receivingRoutes } from "./modules/receiving/receiving.routes.js";
import { lotsRoutes } from "./modules/lots/lots.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { formulationsRoutes } from "./modules/formulations/formulations.routes.js";
import { productionOrdersRoutes } from "./modules/production-orders/production-orders.routes.js";
import { pickingRoutes } from "./modules/production-orders/picking.routes.js";
import { recipeRoutes } from "./modules/production-orders/recipe.routes.js";
import { productionRoutes } from "./modules/production-orders/production.routes.js";
import { customerOrdersRoutes } from "./modules/customer-orders/customer-orders.routes.js";
import { fulfillmentPlanRoutes } from "./modules/customer-orders/fulfillment-plan.routes.js";
import { purchaseSuggestionRoutes } from "./modules/customer-orders/purchase-suggestion.routes.js";
import { shipmentsRoutes } from "./modules/shipments/shipments.routes.js";
import { billingsRoutes } from "./modules/billings/billings.routes.js";
import { costsRoutes } from "./modules/costs/costs.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { finishedGoodsRoutes } from "./modules/finished-goods/finished-goods.routes.js";
import { reportsRoutes } from "./modules/reports/reports.routes.js";
import { exportsRoutes } from "./modules/exports/exports.routes.js";

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
    // Sessao vive em cookie HttpOnly: o browser so envia com credenciais.
    credentials: true,
  });

  // Upload de documentos (laudo/CoA, NF, arte) — limite de 10 MB por
  // arquivo, validado de novo no service.
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  // Autenticacao global: toda rota operacional exige sessao valida. Health e
  // as proprias rotas de login/logout/me sao as unicas excecoes.
  app.addHook("preHandler", authenticationHook);

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(usersRoutes);
  app.register(controlledDocumentsRoutes);
  app.register(attachmentsRoutes);
  app.register(qualityRoutes);
  app.register(projectsRoutes);
  app.register(samplesRoutes);
  app.register(itemsRoutes);
  app.register(unitsRoutes);
  app.register(suppliersRoutes);
  app.register(customersRoutes);
  app.register(productsRoutes);
  app.register(purchaseOrdersRoutes);
  app.register(receivingRoutes);
  app.register(lotsRoutes);
  app.register(inventoryRoutes);
  app.register(formulationsRoutes);
  app.register(productionOrdersRoutes);
  app.register(pickingRoutes);
  app.register(recipeRoutes);
  app.register(productionRoutes);
  app.register(customerOrdersRoutes);
  app.register(fulfillmentPlanRoutes);
  app.register(purchaseSuggestionRoutes);
  app.register(shipmentsRoutes);
  app.register(billingsRoutes);
  app.register(costsRoutes);
  app.register(dashboardRoutes);
  app.register(finishedGoodsRoutes);
  app.register(reportsRoutes);
  app.register(exportsRoutes);

  return app;
}

export type App = ReturnType<typeof buildApp>;
