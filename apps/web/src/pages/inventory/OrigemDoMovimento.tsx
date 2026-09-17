import type { InventoryMovementDTO } from "@veridi/shared";
import { INVENTORY_MOVEMENT_SOURCE_LABELS } from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";

/**
 * O documento que causou o movimento, com link quando existe: recebimento,
 * expedição, OP, amostra — e, desde a Fatia 2B do Inventário Físico, o `INV-`
 * do ajuste de inventário ou de Contagem rápida. Sem documento, o rótulo da
 * origem. Somente leitura: o movimento nunca é editável a partir daqui.
 */
export function OrigemDoMovimento({ movimento }: { movimento: InventoryMovementDTO }) {
  if (movimento.receiptId) return <EntityLink kind="receipt" id={movimento.receiptId} code={movimento.receiptCode} />;
  if (movimento.shipmentId) return <EntityLink kind="shipment" id={movimento.shipmentId} code={movimento.shipmentCode} />;
  if (movimento.productionOrderId) {
    return <EntityLink kind="productionOrder" id={movimento.productionOrderId} code={movimento.productionOrderCode} />;
  }
  if (movimento.projectSampleId) {
    return <EntityLink kind="sample" id={movimento.projectSampleId} code={movimento.projectSampleCode} />;
  }
  if (movimento.stockCountId) {
    return <EntityLink kind="stockCount" id={movimento.stockCountId} code={movimento.stockCountCode} />;
  }
  // Consumo interno (CI-): o código, sem link — o registro vive na lista de
  // Uso e consumo, e não tem tela própria nesta fatia.
  if (movimento.internalConsumptionCode) return <>{movimento.internalConsumptionCode}</>;
  return <>{INVENTORY_MOVEMENT_SOURCE_LABELS[movimento.sourceType]}</>;
}
