import { randomUUID } from "node:crypto";
import { getPrisma } from "../db/prisma.js";

/**
 * Roteiro de teste para ordens cujo assunto NÃO é roteiro.
 *
 * Desde PRODUCTION-ROUTE-ASSIGNMENT-01 a ordem sem roteiro não planeja nem
 * libera. Testes de reserva, consumo, custo, relatório e rastreabilidade
 * precisam de uma OP que chegue lá, e o roteiro não é o que eles provam. Esta
 * função grava a cópia mínima — uma etapa, sem recurso, na unidade da própria
 * ordem — direto na linha que a aplicação real grava, sem criar roteiro nenhum
 * no banco. A cópia sai junto com a OP (cascade): a limpeza de cada arquivo já
 * a leva.
 *
 * Teste de ROTEIRO não usa isto: aplica pelo endpoint, que é o que ele prova.
 */
export async function aplicarRoteiroDeTeste(productionOrderId: string): Promise<void> {
  const prisma = getPrisma();
  const ordem = await prisma.productionOrder.findUniqueOrThrow({
    where: { id: productionOrderId },
    select: { outputUnitCode: true },
  });

  await prisma.productionOrderPlanningSnapshot.upsert({
    where: { productionOrderId },
    update: {},
    create: {
      productionOrderId,
      sourceProfileId: randomUUID(),
      sourceProfileCode: "PPR-TESTE",
      sourceProfileName: "Roteiro de teste",
      sourceVersionId: randomUUID(),
      sourceVersionNumber: 1,
      referenceQuantity: "1",
      referenceUomCode: ordem.outputUnitCode,
      steps: [
        {
          sequence: 1,
          name: "Produção",
          description: null,
          setupDurationMinutes: 0,
          runDurationMinutes: 1,
          scalingMode: "PROPORTIONAL",
          resources: [],
        },
      ],
      appliedBy: "Teste",
      applicationSource: "MANUAL_ORDER",
    },
  });
}
