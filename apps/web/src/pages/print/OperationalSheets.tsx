import { useParams, useSearchParams } from "react-router-dom";
import type {
  InventoryPositionRowDTO,
  ProductionOrderDTO,
  QualityQueueRowDTO,
  ShipmentDTO,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { PdfScreen } from "../../pdf/PdfScreen";
import { getInventoryPositionReport } from "../../lib/reports-api";
import { listQualityQueue } from "../../lib/attachments-api";
import { getProductionOrder } from "../../lib/production-orders-api";
import { getShipment } from "../../lib/shipments-api";

/**
 * Folhas operacionais (FO-01…FO-05).
 *
 * Cada página carrega o dado pela API autenticada e gera o PDF da folha no
 * navegador (`PdfScreen`): o arquivo é o papel, sem URL, data ou margem do
 * navegador. Todas seguem as mesmas três regras:
 * 1. rota FORA do AppShell — o papel nunca leva sidebar, filtros ou botão;
 * 2. o documento traz o RESULTADO FILTRADO COMPLETO (`all=true`), nunca só
 *    a página aberta na tela;
 * 3. campos de anotação são de papel: contagem, conferência e assinatura
 *    não viram dado — quem registra é o ERP, depois.
 *
 * O documento vem de `pdf/documents/OperationalSheetsPdf`, importado sob
 * demanda: o motor de PDF só entra no navegador de quem gera uma folha.
 *
 * `FO-xx` é identificação documental, não entidade: não existe tabela de
 * folha operacional em lugar nenhum.
 */

/**
 * Quem gera o papel. Sem sessão (teste, pré-visualização isolada) é `null`,
 * e a folha mostra "—" em vez de inventar um nome.
 */
function useGeradoPor(): string | null {
  return useOptionalAuth()?.user?.name ?? null;
}

/* ─────────────── FO-01 — Contagem física ─────────────── */

/**
 * O operador gera a folha, conta no estoque e depois registra o Inventário
 * Físico no sistema. O papel nunca ajusta saldo.
 *
 * `?cega=1` esconde o saldo do sistema (contagem cega): quem conta não vê o
 * número esperado, que é justamente o ponto de uma contagem confiável.
 */
export function InventoryCountSheetPage() {
  const [params] = useSearchParams();
  const blind = params.get("cega") === "1";
  const search = params.get("search") ?? "";
  const itemType = params.get("itemType") ?? "";
  const geradoPor = useGeradoPor();

  return (
    <PdfScreen<InventoryPositionRowDTO[]>
      load={async () => {
        const report = await getInventoryPositionReport({
          all: true,
          page: 1,
          ...(search ? { search } : {}),
          ...(itemType ? { itemType } : {}),
        });
        return report.rows;
      }}
      build={async (rows) => {
        const { InventoryCountPdf, inventoryCountPdfFileName } = await import(
          "../../pdf/documents/OperationalSheetsPdf"
        );
        const generatedAt = new Date();
        return {
          document: (
            <InventoryCountPdf
              rows={rows}
              blind={blind}
              search={search}
              itemType={itemType}
              generatedAt={generatedAt}
              generatedBy={geradoPor}
            />
          ),
          fileName: inventoryCountPdfFileName({ blind, generatedAt }),
        };
      }}
      backTo="/estoque/inventario"
    />
  );
}

/* ─────────────── FO-02 — Posição de estoque ─────────────── */

/** Levantamento do estoque no momento da geração — não é snapshot legal. */
export function InventoryPositionSheetPage() {
  const [params] = useSearchParams();
  const search = params.get("search") ?? "";
  const geradoPor = useGeradoPor();

  return (
    <PdfScreen<InventoryPositionRowDTO[]>
      load={async () => {
        const report = await getInventoryPositionReport({ all: true, page: 1, ...(search ? { search } : {}) });
        return report.rows;
      }}
      build={async (rows) => {
        const { InventoryPositionPdf, inventoryPositionPdfFileName } = await import(
          "../../pdf/documents/OperationalSheetsPdf"
        );
        const generatedAt = new Date();
        return {
          document: (
            <InventoryPositionPdf rows={rows} search={search} generatedAt={generatedAt} generatedBy={geradoPor} />
          ),
          fileName: inventoryPositionPdfFileName(generatedAt),
        };
      }}
      backTo="/estoque"
    />
  );
}

/* ─────────────── FO-03 — Pendências de qualidade ─────────────── */

/**
 * Lista de pendências para tratar fisicamente. A coluna "Tratado /
 * observação" é papel: aprovar ou rejeitar CoA continua sendo ato da
 * Qualidade dentro do sistema, com usuário e data.
 */
export function QualityPendingSheetPage() {
  const geradoPor = useGeradoPor();

  return (
    <PdfScreen<QualityQueueRowDTO[]>
      load={async () => (await listQualityQueue({ pageSize: 100 })).rows}
      build={async (rows) => {
        const { QualityPendingPdf, qualityPendingPdfFileName } = await import(
          "../../pdf/documents/OperationalSheetsPdf"
        );
        const generatedAt = new Date();
        return {
          document: <QualityPendingPdf rows={rows} generatedAt={generatedAt} generatedBy={geradoPor} />,
          fileName: qualityPendingPdfFileName(generatedAt),
        };
      }}
      backTo="/qualidade/documentos"
    />
  );
}

/* ─────────────── FO-04 — Picking da produção ─────────────── */

/** Separação de material da OP. A conferência digital do picking continua. */
export function ProductionPickingSheetPage() {
  const { id } = useParams<{ id: string }>();
  const geradoPor = useGeradoPor();

  return (
    <PdfScreen<ProductionOrderDTO>
      load={() => getProductionOrder(id!)}
      build={async (order) => {
        const { ProductionPickingPdf, productionPickingPdfFileName } = await import(
          "../../pdf/documents/OperationalSheetsPdf"
        );
        return {
          document: <ProductionPickingPdf order={order} generatedAt={new Date()} generatedBy={geradoPor} />,
          fileName: productionPickingPdfFileName(order),
        };
      }}
      backTo={`/producao/ordens/${id}`}
    />
  );
}

/* ─────────────── FO-05 — Separação da expedição ─────────────── */

/** Separação física da expedição — a conferência de lote no sistema continua obrigatória. */
export function ShipmentPickingSheetPage() {
  const { id } = useParams<{ id: string }>();
  const geradoPor = useGeradoPor();

  return (
    <PdfScreen<ShipmentDTO>
      load={() => getShipment(id!)}
      build={async (shipment) => {
        const { ShipmentPickingPdf, shipmentPickingPdfFileName } = await import(
          "../../pdf/documents/OperationalSheetsPdf"
        );
        return {
          document: <ShipmentPickingPdf shipment={shipment} generatedAt={new Date()} generatedBy={geradoPor} />,
          fileName: shipmentPickingPdfFileName(shipment),
        };
      }}
      backTo={`/comercial/expedicoes/${id}`}
    />
  );
}
