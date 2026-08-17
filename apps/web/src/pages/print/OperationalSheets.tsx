import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type {
  InventoryPositionRowDTO,
  ProductionOrderDTO,
  QualityQueueRowDTO,
  ShipmentDTO,
} from "@veridi/shared";
import {
  COA_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  ownerLabel,
} from "@veridi/shared";
import { PrintTable, formatPrintDate, printOrDash } from "../../print/PrintLayout";
import { PrintCheckCell, PrintSheet, PrintSignatureArea, PrintWriteCell } from "../../print/PrintSheet";
import { getInventoryPositionReport } from "../../lib/reports-api";
import { listQualityQueue } from "../../lib/attachments-api";
import { getProductionOrder } from "../../lib/production-orders-api";
import { getShipment } from "../../lib/shipments-api";

/**
 * Folhas operacionais (FO-01…FO-05).
 *
 * Todas seguem as mesmas três regras:
 * 1. rota FORA do AppShell — o papel nunca leva sidebar, filtros ou botão;
 * 2. o documento traz o RESULTADO FILTRADO COMPLETO (`all=true`), nunca só
 *    a página aberta na tela;
 * 3. campos de anotação são de papel: contagem, conferência e assinatura
 *    não viram dado — quem registra é o ERP, depois.
 *
 * `FO-xx` é identificação documental, não entidade: não existe tabela de
 * folha operacional em lugar nenhum.
 */

function useSheetData<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o documento"),
      );
    // A carga depende só dos parâmetros da rota, resolvidos pelo chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, error };
}

function SheetError({ message }: { message: string }) {
  return (
    <div className="print-screen">
      <article className="print-doc">
        <p className="form-alert">Não foi possível carregar o documento: {message}</p>
      </article>
    </div>
  );
}

/* ─────────────── FO-01 — Contagem física ─────────────── */

/**
 * O operador imprime, conta no estoque e depois registra o Inventário
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

  const { data, error } = useSheetData(() =>
    getInventoryPositionReport({
      all: true,
      page: 1,
      ...(search ? { search } : {}),
      ...(itemType ? { itemType } : {}),
    }),
  );

  if (error) return <SheetError message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  const rows = (data as { rows: InventoryPositionRowDTO[] }).rows;

  return (
    <PrintSheet
      sheetCode="FO-01"
      title="Folha de contagem física de estoque"
      {...(blind ? { subtitle: "Contagem cega — saldo do sistema omitido" } : {})}
      backTo="/estoque/inventario"
      filters={[
        ...(search ? [{ label: "Busca", value: search }] : []),
        ...(itemType ? [{ label: "Tipo de item", value: itemType }] : []),
        { label: "Linhas", value: String(rows.length) },
        { label: "Modo", value: blind ? "Contagem cega" : "Com saldo do sistema" },
      ]}
    >
      <PrintTable
        columns={[
          "Código",
          "Item",
          "Lote",
          /* Contar material de cliente junto com o da Veridi, sem dizer de
             quem é, é a forma mais fácil de tratar estoque alheio como
             próprio. FO-02 e FO-03 já mostram o proprietário. */
          "Proprietário",
          "Validade",
          "Localização",
          "Un.",
          ...(blind ? [] : ["Saldo sistema"]),
          "Contagem física",
          "Diferença",
          "Observação",
        ]}
        isEmpty={rows.length === 0}
        emptyMessage="Nenhum item no filtro aplicado."
      >
        {rows.map((row) => (
          <tr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
            <td>{row.itemCode}</td>
            <td>{row.itemName}</td>
            <td>{printOrDash(row.lotCode)}</td>
            <td>{ownerLabel(row.ownerType, row.ownerCustomerName)}</td>
            <td>{formatPrintDate(row.expiryDate)}</td>
            <td>{printOrDash(row.location)}</td>
            <td>{row.unitCode}</td>
            {!blind && <td className="is-number">{row.onHand}</td>}
            <PrintWriteCell />
            <PrintWriteCell />
            <PrintWriteCell width="120px" />
          </tr>
        ))}
      </PrintTable>

      <PrintSignatureArea fields={["Contagem realizada por", "Conferido por", "Data"]} />
    </PrintSheet>
  );
}

/* ─────────────── FO-02 — Posição de estoque ─────────────── */

/** Levantamento do estoque no momento da geração — não é snapshot legal. */
export function InventoryPositionSheetPage() {
  const [params] = useSearchParams();
  const search = params.get("search") ?? "";

  const { data, error } = useSheetData(() =>
    getInventoryPositionReport({ all: true, page: 1, ...(search ? { search } : {}) }),
  );

  if (error) return <SheetError message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  const rows = (data as { rows: InventoryPositionRowDTO[] }).rows;

  return (
    <PrintSheet
      sheetCode="FO-02"
      title="Posição / levantamento de estoque"
      backTo="/estoque"
      landscape
      filters={[
        ...(search ? [{ label: "Busca", value: search }] : []),
        { label: "Linhas", value: String(rows.length) },
      ]}
    >
      <PrintTable
        columns={[
          "Código",
          "Item",
          "Lote",
          "Fornecedor / proprietário",
          "Validade",
          "Localização",
          "Físico",
          "Reservado",
          "Disponível",
          "Un.",
        ]}
        isEmpty={rows.length === 0}
        emptyMessage="Nenhum item no filtro aplicado."
      >
        {rows.map((row) => (
          <tr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
            <td>{row.itemCode}</td>
            <td>{row.itemName}</td>
            <td>{printOrDash(row.lotCode)}</td>
            <td>
              {row.ownerType === "CUSTOMER"
                ? ownerLabel(row.ownerType, row.ownerCustomerName)
                : printOrDash(row.supplierName)}
            </td>
            <td>{formatPrintDate(row.expiryDate)}</td>
            <td>{printOrDash(row.location)}</td>
            <td className="is-number">{row.onHand}</td>
            <td className="is-number">{row.reserved}</td>
            <td className="is-number">{row.available}</td>
            <td>{row.unitCode}</td>
          </tr>
        ))}
      </PrintTable>
    </PrintSheet>
  );
}

/* ─────────────── FO-03 — Pendências de qualidade ─────────────── */

/**
 * Lista de pendências para tratar fisicamente. A coluna "Tratado /
 * observação" é papel: aprovar ou rejeitar CoA continua sendo ato da
 * Qualidade dentro do sistema, com usuário e data.
 */
export function QualityPendingSheetPage() {
  const { data, error } = useSheetData(() => listQualityQueue({ pageSize: 100 }));

  if (error) return <SheetError message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  const rows = (data as { rows: QualityQueueRowDTO[]; total: number }).rows;

  return (
    <PrintSheet
      sheetCode="FO-03"
      title="Pendências de qualidade / CoA"
      backTo="/qualidade/documentos"
      landscape
      filters={[{ label: "Lotes pendentes", value: String(rows.length) }]}
    >
      <PrintTable
        columns={[
          "Lote",
          "Item",
          "Fornecedor / proprietário",
          "CoA",
          "Qualidade",
          "Validade",
          "Recebido em",
          "Pendência",
          "Tratado / observação",
        ]}
        isEmpty={rows.length === 0}
        emptyMessage="Nenhuma pendência de qualidade."
      >
        {rows.map((row) => (
          <tr key={row.lotId}>
            <td>{row.lotCode}</td>
            <td>
              {row.itemCode} — {row.itemName}
            </td>
            <td>
              {row.ownerType === "CUSTOMER"
                ? ownerLabel(row.ownerType, row.ownerCustomerName)
                : printOrDash(row.supplierName)}
            </td>
            <td>{row.requiresCoa ? COA_STATUS_LABELS[row.coaStatus] : "Não exigido"}</td>
            <td>{LOT_STATUS_LABELS[row.lotStatus]}</td>
            <td>{formatPrintDate(row.expiryDate)}</td>
            <td>{formatPrintDate(row.receivedAt)}</td>
            <td>
              {row.requiresCoa && row.coaStatus === "PENDING"
                ? "Laudo não recebido"
                : row.requiresCoa && row.coaStatus === "RECEIVED"
                  ? "Laudo aguardando análise"
                  : "Aguardando liberação"}
            </td>
            <PrintWriteCell width="140px" />
          </tr>
        ))}
      </PrintTable>

      <PrintSignatureArea fields={["Qualidade — responsável", "Data"]} />
    </PrintSheet>
  );
}

/* ─────────────── FO-04 — Picking da produção ─────────────── */

/** Separação de material da OP. A conferência digital do picking continua. */
export function ProductionPickingSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSheetData<ProductionOrderDTO>(() => getProductionOrder(id!));

  if (error) return <SheetError message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  const reservationLines = data.requirements.flatMap((requirement) =>
    requirement.reservationLines.map((line) => ({ requirement, line })),
  );

  return (
    <PrintSheet
      sheetCode="FO-04"
      title="Folha de separação / picking da produção"
      backTo={`/producao/ordens/${data.id}`}
      landscape
      meta={[
        { label: "OP", value: data.officialNumber ?? data.code },
        { label: "OP interna", value: data.code },
        { label: "Produto", value: `${data.productCode} — ${data.productName}` },
        { label: "Cliente", value: data.customerName ?? "—" },
        { label: "Quantidade planejada", value: `${data.plannedQuantity} ${data.outputUnitCode}` },
        { label: "Situação", value: PRODUCTION_ORDER_STATUS_LABELS[data.status] },
      ]}
    >
      <PrintTable
        columns={[
          "Item",
          "Responsabilidade",
          "Necessário",
          "Lote esperado",
          "Validade",
          "Localização",
          "Qtd. separar",
          "Conferido",
          "Observação",
        ]}
        isEmpty={reservationLines.length === 0}
        emptyMessage="Nenhuma reserva gerada — libere a OP para separar material."
      >
        {reservationLines.map(({ requirement, line }) => (
          <tr key={line.id}>
            <td>
              {requirement.itemCode} — {requirement.itemName}
            </td>
            <td>
              {requirement.supplyResponsibility === "CUSTOMER"
                ? "Material do cliente"
                : "Veridi"}
            </td>
            <td className="is-number">
              {requirement.requiredQuantity} {requirement.stockUnitCode}
            </td>
            <td>{printOrDash(line.lotCode)}</td>
            <td>{formatPrintDate(line.expiryDate)}</td>
            <td>{printOrDash(line.location)}</td>
            <td className="is-number">
              {line.quantity} {requirement.stockUnitCode}
            </td>
            <PrintCheckCell />
            <PrintWriteCell width="120px" />
          </tr>
        ))}
      </PrintTable>

      <PrintSignatureArea fields={["Separado por", "Conferido por", "Data"]} />
    </PrintSheet>
  );
}

/* ─────────────── FO-05 — Separação da expedição ─────────────── */

/** Separação física da expedição — a conferência de lote no sistema continua obrigatória. */
export function ShipmentPickingSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSheetData<ShipmentDTO>(() => getShipment(id!));

  if (error) return <SheetError message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  return (
    <PrintSheet
      sheetCode="FO-05"
      title="Folha de separação / expedição"
      backTo={`/comercial/expedicoes/${data.id}`}
      meta={[
        { label: "Expedição", value: data.code },
        { label: "Pedido", value: data.customerOrderCode },
        { label: "Cliente", value: data.customerName },
        { label: "Situação", value: SHIPMENT_STATUS_LABELS[data.status] },
        { label: "Emitida em", value: formatPrintDate(data.createdAt) },
      ]}
    >
      <PrintTable
        columns={[
          "Produto",
          "Quantidade",
          "Lote",
          "Validade",
          "Localização",
          "Qtd. separar",
          "Conferido",
          "Observação",
        ]}
        isEmpty={data.lines.length === 0}
        emptyMessage="Nenhuma linha nesta expedição."
      >
        {data.lines.map((line) => (
          <tr key={line.id}>
            <td>
              {line.productCode} — {line.productName}
            </td>
            <td className="is-number">
              {line.quantity} {line.unitCode}
            </td>
            <td>{line.lotCode}</td>
            <td>{formatPrintDate(line.expiryDate)}</td>
            <td>{printOrDash(line.location)}</td>
            <PrintWriteCell />
            <PrintCheckCell />
            <PrintWriteCell width="120px" />
          </tr>
        ))}
      </PrintTable>

      <PrintSignatureArea fields={["Separado por", "Conferido por", "Data"]} />
    </PrintSheet>
  );
}
