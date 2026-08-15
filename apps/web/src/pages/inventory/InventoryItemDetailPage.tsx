import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { InventoryItemDetailDTO } from "@veridi/shared";
import { ITEM_TYPE_LABELS, LOT_STATUS_LABELS } from "@veridi/shared";
import { getInventoryItem } from "../../lib/inventory-api";
import { FormSection } from "../../components/FormSection";
import { AdjustStockDialog } from "../../components/AdjustStockDialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function lotStatusBadgeClass(status: string, isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    default:
      return "badge badge--err";
  }
}

/** Estoque → item — resumo On Hand/Reservado/Disponível/Em Compra + saldo por lote. */
export function InventoryItemDetailPage() {
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();

  const [detail, setDetail] = useState<InventoryItemDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const load = useCallback(() => {
    if (!itemId) return;
    setLoading(true);
    setNotFound(false);
    getInventoryItem(itemId)
      .then(setDetail)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Estoque</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Item não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque")}>
            ← Voltar para Estoque
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Estoque / Visão Geral / Detalhe</div>
          <div className="doc-title">
            <h1>
              <span className="code">{detail.itemCode}</span> {detail.itemName}
            </h1>
            <span className="badge badge--neutral">{ITEM_TYPE_LABELS[detail.itemType]}</span>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        <FormSection title="Disponibilidade">
          <dl className="definition-list">
            <dt>On Hand</dt>
            <dd>
              {detail.onHand} {detail.unitCode}
            </dd>
            <dt>Reservado</dt>
            <dd>
              {detail.reserved} {detail.unitCode}
            </dd>
            <dt>Disponível</dt>
            <dd>
              {detail.available} {detail.unitCode}
            </dd>
            <dt>Em Compra</dt>
            <dd>
              {detail.onOrder} {detail.unitCode}
            </dd>
          </dl>

          <div className="line-actions">
            <div className="table__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setAdjustOpen(true)}
              >
                Ajustar estoque
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/estoque/movimentacoes?itemId=${detail.itemId}`)}
              >
                Ver movimentações
              </button>
            </div>
          </div>
        </FormSection>

        {detail.controlsLot && (
          <FormSection
            title="Saldo por lote"
            subtitle="Ordenado por validade para apresentação — não é a regra operacional de FEFO."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th>Localização</th>
                    <th>Status</th>
                    <th>On Hand</th>
                    <th>Disponível</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {detail.lots.map((lot) => (
                    <tr key={lot.lotId}>
                      <td className="is-code">{lot.lotCode}</td>
                      <td>{formatDate(lot.expiryDate)}</td>
                      <td>{lot.location ?? "—"}</td>
                      <td>
                        <span className={lotStatusBadgeClass(lot.status, lot.isExpired)}>
                          {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
                        </span>
                      </td>
                      <td>
                        {lot.onHand} {detail.unitCode}
                      </td>
                      <td>
                        {lot.available} {detail.unitCode}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/estoque/lotes/${lot.lotId}`)}
                        >
                          Ver lote
                        </button>
                      </td>
                    </tr>
                  ))}

                  {detail.lots.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table__empty">
                        Nenhum lote para este item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}
      </div>

      {adjustOpen && (
        <AdjustStockDialog
          itemId={detail.itemId}
          unitCode={detail.unitCode}
          controlsLot={detail.controlsLot}
          lots={detail.lots}
          onClose={() => setAdjustOpen(false)}
          onAdjusted={() => {
            setAdjustOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
