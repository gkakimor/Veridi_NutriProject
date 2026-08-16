import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ShipmentDTO, ShipmentStatus } from "@veridi/shared";
import { SHIPMENT_STATUS_LABELS } from "@veridi/shared";
import { cancelShipment, confirmShipment, getShipment, updateShipment } from "../../lib/shipments-api";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";

function statusBadgeClass(status: ShipmentStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

/**
 * Documento transacional — página própria no workspace, não
 * FullWorkspaceModal. Estruturada como bloco read-only quando CONFIRMED,
 * para que a versão de impressão futura seja um recorte direto desta tela.
 */
export function ShipmentPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFromServer = useCallback((next: ShipmentDTO) => {
    setShipment(next);
    setNotes(next.notes ?? "");
    const nextQuantities: Record<string, string> = {};
    for (const line of next.lines) {
      nextQuantities[line.customerOrderReservationLineId] = line.quantity;
    }
    setQuantities(nextQuantities);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    getShipment(id)
      .then(syncFromServer)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, syncFromServer]);

  const isDraft = shipment?.status === "DRAFT";

  async function handleSave() {
    if (!id || !shipment) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateShipment(id, {
        notes: notes.trim(),
        lines: shipment.lines.map((line) => ({
          customerOrderReservationLineId: line.customerOrderReservationLineId,
          quantity: (quantities[line.customerOrderReservationLineId] ?? "0").trim() || "0",
        })),
      });
      syncFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar expedição");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!id) return;
    setConfirmDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      // Confirma o que está na tela antes de efetivar a saída física.
      if (shipment) {
        await updateShipment(id, {
          notes: notes.trim(),
          lines: shipment.lines.map((line) => ({
            customerOrderReservationLineId: line.customerOrderReservationLineId,
            quantity: (quantities[line.customerOrderReservationLineId] ?? "0").trim() || "0",
          })),
        });
      }
      const confirmed = await confirmShipment(id);
      syncFromServer(confirmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar expedição");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const cancelled = await cancelShipment(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      syncFromServer(cancelled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar expedição");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Expedição</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !shipment) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Expedição não encontrada</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/expedicoes")}>
            ← Voltar para Expedições
          </button>
        </div>
      </div>
    );
  }

  const totalToShip = shipment.lines.reduce(
    (sum, line) => sum + Number(quantities[line.customerOrderReservationLineId] ?? "0"),
    0,
  );

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Comercial / Expedições / Detalhe</div>
          <div className="doc-title">
            <h1>{shipment.code}</h1>
            <span className={statusBadgeClass(shipment.status)}>
              {SHIPMENT_STATUS_LABELS[shipment.status]}
            </span>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/expedicoes")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {shipment.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelada</span>
              <span className="field__hint">
                {formatDateTime(shipment.cancelledAt)} — {shipment.cancelledBy ?? "—"}
              </span>
            </div>
            {shipment.cancelReason && <p className="field__hint">Motivo: {shipment.cancelReason}</p>}
          </FormSection>
        )}

        <FormSection title="Pedido">
          <dl className="definition-list">
            <dt>Pedido</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/comercial/pedidos/${shipment.customerOrderId}`)}
              >
                {shipment.customerOrderCode}
              </button>
            </dd>
            <dt>Cliente</dt>
            <dd>{shipment.customerName ?? "—"}</dd>
            <dt>Data da expedição</dt>
            <dd>{formatDate(shipment.shipmentDate)}</dd>
          </dl>
        </FormSection>

        <FormSection
          title="Itens para expedição"
          subtitle={
            isDraft
              ? "Separação — nada sai do estoque até a confirmação. Só é possível expedir o que está reservado a este pedido."
              : "Quantidades efetivamente expedidas — histórico imutável."
          }
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th>Lote Veridi</th>
                  <th>Validade</th>
                  <th>Localização</th>
                  <th>Reservado disponível</th>
                  <th>{isDraft ? "Enviar agora" : "Expedido"}</th>
                </tr>
              </thead>
              <tbody>
                {shipment.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <span className="code">{line.productCode}</span> {line.productName}
                    </td>
                    <td>{line.lotCode ?? "—"}</td>
                    <td>{line.businessLotNumber ?? "—"}</td>
                    <td>{formatDate(line.expiryDate)}</td>
                    <td>{line.location ?? "—"}</td>
                    <td>{line.reservedRemaining}</td>
                    <td>
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={quantities[line.customerOrderReservationLineId] ?? ""}
                          onChange={(event) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [line.customerOrderReservationLineId]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        `${line.quantity} ${line.unitCode}`
                      )}
                    </td>
                  </tr>
                ))}

                {shipment.lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table__empty">
                      Nenhum item nesta expedição.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="table-foot">
              Total: {isDraft ? totalToShip : shipment.totalQuantity}
            </div>
          </div>
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="shipment-notes">Notas internas</label>
            <textarea
              id="shipment-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>

        {shipment.status === "CONFIRMED" && (
          <FormSection title="Auditoria">
            <dl className="definition-list">
              <dt>Confirmada em</dt>
              <dd>
                {formatDateTime(shipment.confirmedAt)} — {shipment.confirmedBy ?? "—"}
              </dd>
            </dl>
          </FormSection>
        )}
      </div>

      <div className="doc-actions">
        {isDraft && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={saving}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar expedição
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSave}>
                {saving ? "Salvando…" : "Salvar separação"}
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving || totalToShip <= 0}
                onClick={() => setConfirmDialogOpen(true)}
              >
                Confirmar expedição
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title={`Confirmar expedição ${shipment.code}?`}
        message="Os produtos serão registrados como saída física do estoque. Esta operação não poderá ser cancelada diretamente depois da confirmação."
        confirmLabel="Confirmar expedição"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      {cancelDialogOpen && (
        <>
          <div className="confirm-overlay" />
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-shipment-title">
            <h2 id="cancel-shipment-title">Cancelar expedição?</h2>
            <p>
              {shipment.code} permanecerá no histórico. Nada sai do estoque — a reserva do pedido
              continua intacta e uma nova expedição pode ser preparada depois.
            </p>
            <div className="field">
              <label htmlFor="shipment-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="shipment-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setCancelDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancel}
              >
                Cancelar expedição
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
