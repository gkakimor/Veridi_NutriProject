import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ShipmentDTO,
  ShipmentLineDTO,
  ShipmentProductGroupDTO,
  ShipmentProductStatus,
  ShipmentStatus,
} from "@veridi/shared";
import {
  SHIPMENT_BILLING_STATUS_LABELS,
  SHIPMENT_PRODUCT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import {
  cancelShipment,
  confirmShipment,
  getShipment,
  updateShipment,
  verifyShipmentLine,
} from "../../lib/shipments-api";
import { createBilling } from "../../lib/billings-api";
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

function productStatusBadgeClass(status: ShipmentProductStatus): string {
  switch (status) {
    case "VERIFIED":
      return "badge badge--active";
    case "PARTIAL":
      return "badge badge--warn";
    case "READY":
      return "badge badge--neutral";
    case "PENDING":
      return "badge badge--inactive";
  }
}

interface ProductGroupProps {
  group: ShipmentProductGroupDTO;
  lines: ShipmentLineDTO[];
  isDraft: boolean;
  quantities: Record<string, string>;
  onQuantityChange: (reservationLineId: string, value: string) => void;
  lotInputs: Record<string, string>;
  onLotInputChange: (reservationLineId: string, value: string) => void;
  onVerify: (line: ShipmentLineDTO) => void;
  verifyingLine: string | null;
}

/**
 * Um produto do Pedido dentro da Expedição. Um Pedido com vários produtos
 * gera vários blocos — inclusive para o produto que ainda não tem reserva,
 * para o operador enxergar o que falta. Nenhum total aqui é armazenado:
 * tudo vem derivado do read model.
 */
function ProductGroup({
  group,
  lines,
  isDraft,
  quantities,
  onQuantityChange,
  lotInputs,
  onLotInputChange,
  onVerify,
  verifyingLine,
}: ProductGroupProps) {
  return (
    <div className="shipment-product">
      <div className="status-line">
        <strong>
          <span className="code">{group.productCode}</span> {group.productName}
        </strong>
        <span className={productStatusBadgeClass(group.status)}>
          {SHIPMENT_PRODUCT_STATUS_LABELS[group.status]}
        </span>
      </div>

      {/* Cada número com a própria unidade — nada é somado entre produtos. */}
      <p className="shipment-product__meta">
        Pedido: {group.orderedQuantity} {group.unitCode} · Já expedido: {group.shippedQuantity} ·
        Falta expedir: {group.outstandingQuantity} · Reservado disponível: {group.reservedRemaining} ·
        Expedindo agora: {group.shippingNow} · Lotes conferidos: {group.lotsVerified}/
        {group.lotsRequired}
      </p>

      {lines.length === 0 ? (
        <p className="field__hint">Ainda sem reserva disponível para esta expedição.</p>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Lote Veridi</th>
                <th>Validade</th>
                <th>Localização</th>
                <th>Reservado disponível</th>
                <th>{isDraft ? "Enviar agora" : "Expedido"}</th>
                <th>Conferência</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="is-code">{line.lotCode ?? "—"}</td>
                  <td>{line.businessLotNumber ?? "—"}</td>
                  <td>{formatDate(line.expiryDate)}</td>
                  <td>{line.location ?? "—"}</td>
                  <td>
                    {line.reservedRemaining} {line.unitCode}
                  </td>
                  <td>
                    {isDraft ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Quantidade do lote ${line.lotCode ?? ""}`}
                        value={quantities[line.customerOrderReservationLineId] ?? ""}
                        onChange={(event) =>
                          onQuantityChange(line.customerOrderReservationLineId, event.target.value)
                        }
                      />
                    ) : (
                      `${line.quantity} ${line.unitCode}`
                    )}
                  </td>
                  <td>
                    {line.verifiedAt ? (
                      <span className="status-line">
                        <span className="badge badge--active">Conferido</span>
                        <span className="field__hint">
                          {formatDateTime(line.verifiedAt)} — {line.verifiedBy ?? "—"}
                        </span>
                      </span>
                    ) : isDraft && line.requiresVerification ? (
                      <div className="lot-scanner__manual-row">
                        <input
                          type="text"
                          aria-label={`Lote conferido da linha ${line.lotCode ?? ""}`}
                          placeholder="Escaneie ou digite o lote"
                          value={lotInputs[line.customerOrderReservationLineId] ?? ""}
                          onChange={(event) =>
                            onLotInputChange(line.customerOrderReservationLineId, event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") onVerify(line);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={verifyingLine === line.customerOrderReservationLineId}
                          onClick={() => onVerify(line)}
                        >
                          {verifyingLine === line.customerOrderReservationLineId
                            ? "Conferindo…"
                            : "Conferir lote"}
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const [preparingBilling, setPreparingBilling] = useState(false);

  /** Código lido/digitado por linha de reserva (a linha é recriada a cada save). */
  const [lotInputs, setLotInputs] = useState<Record<string, string>>({});
  const [verifyingLine, setVerifyingLine] = useState<string | null>(null);

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

  /**
   * Confere o lote de uma linha. A separação é salva antes, porque a
   * conferência valida a quantidade realmente gravada — e como o save
   * recria as linhas, a conferência usa o id devolvido pelo servidor.
   */
  async function handleVerify(line: ShipmentLineDTO) {
    if (!id || !shipment) return;
    const reservationLineId = line.customerOrderReservationLineId;
    const lotCode = (lotInputs[reservationLineId] ?? "").trim();
    if (!lotCode) return;

    setVerifyingLine(reservationLineId);
    setError(null);
    try {
      const saved = await updateShipment(id, {
        notes: notes.trim(),
        lines: shipment.lines.map((current) => ({
          customerOrderReservationLineId: current.customerOrderReservationLineId,
          quantity: (quantities[current.customerOrderReservationLineId] ?? "0").trim() || "0",
        })),
      });
      const target = saved.lines.find(
        (current) => current.customerOrderReservationLineId === reservationLineId,
      );
      if (!target) {
        syncFromServer(saved);
        setError("Esta linha não está mais na separação — informe a quantidade antes de conferir.");
        return;
      }

      const verified = await verifyShipmentLine(id, target.id, { lotCode });
      syncFromServer(verified);
      setLotInputs((prev) => ({ ...prev, [reservationLineId]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conferir o lote");
    } finally {
      setVerifyingLine(null);
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

  async function handlePrepareBilling() {
    if (!shipment) return;
    if (shipment.billingId) {
      navigate(`/comercial/faturamento/${shipment.billingId}`);
      return;
    }
    setPreparingBilling(true);
    setError(null);
    try {
      const billing = await createBilling(shipment.id);
      navigate(`/comercial/faturamento/${billing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar faturamento");
    } finally {
      setPreparingBilling(false);
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

        {isDraft && (
          <FormSection
            title="Conferência"
            subtitle="Cada lote é conferido uma vez — nunca por unidade. Conferir não movimenta estoque."
          >
            <dl className="definition-list">
              <dt>Produtos nesta expedição</dt>
              <dd>{shipment.verification.productCount}</dd>
              <dt>Lotes necessários</dt>
              <dd>{shipment.verification.lotsRequired}</dd>
              <dt>Lotes conferidos</dt>
              <dd>
                {shipment.verification.lotsVerified} / {shipment.verification.lotsRequired}
                {shipment.verification.allLotsVerified && shipment.verification.lotsRequired > 0 && " ✓"}
              </dd>
            </dl>
          </FormSection>
        )}

        <FormSection
          title="Itens para expedição"
          subtitle={
            isDraft
              ? "Separação — nada sai do estoque até a confirmação. Só é possível expedir o que está reservado a este pedido."
              : "Quantidades efetivamente expedidas — histórico imutável."
          }
        >
          {shipment.products.map((group) => (
            <ProductGroup
              key={group.customerOrderLineId}
              group={group}
              lines={shipment.lines.filter(
                (line) => line.customerOrderLineId === group.customerOrderLineId,
              )}
              isDraft={isDraft}
              quantities={quantities}
              onQuantityChange={(reservationLineId, value) =>
                setQuantities((prev) => ({ ...prev, [reservationLineId]: value }))
              }
              lotInputs={lotInputs}
              onLotInputChange={(reservationLineId, value) =>
                setLotInputs((prev) => ({ ...prev, [reservationLineId]: value }))
              }
              onVerify={handleVerify}
              verifyingLine={verifyingLine}
            />
          ))}

          {shipment.products.length === 0 && (
            <p className="field__hint">Nenhum item nesta expedição.</p>
          )}

          <p className="field__hint">
            Total: {isDraft ? totalToShip : shipment.totalQuantity}
          </p>
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
          <FormSection
            title="Faturamento"
            subtitle="Faturamento comercial/operacional — não emite Nota Fiscal e não movimenta estoque."
          >
            <div className="status-line">
              <span
                className={
                  shipment.billingStatus === "ISSUED"
                    ? "badge badge--active"
                    : shipment.billingStatus === "DRAFT"
                      ? "badge badge--warn"
                      : "badge badge--neutral"
                }
              >
                {SHIPMENT_BILLING_STATUS_LABELS[shipment.billingStatus]}
              </span>
              {shipment.billingCode && <span className="field__hint">{shipment.billingCode}</span>}
            </div>

            <div className="line-actions">
              <button
                type="button"
                className={shipment.billingId ? "btn btn--ghost btn--sm" : "btn btn--accent btn--sm"}
                disabled={preparingBilling}
                onClick={handlePrepareBilling}
              >
                {shipment.billingId
                  ? `Abrir ${shipment.billingCode}`
                  : preparingBilling
                    ? "Preparando…"
                    : "Preparar faturamento"}
              </button>
            </div>
          </FormSection>
        )}

        {shipment.status === "CONFIRMED" && (
          <FormSection
            title="Auditoria"
            subtitle="Conferência física e saída — histórico imutável, não é possível reconferir."
          >
            <dl className="definition-list">
              <dt>Confirmada em</dt>
              <dd>
                {formatDateTime(shipment.confirmedAt)} — {shipment.confirmedBy ?? "—"}
              </dd>
            </dl>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Lote</th>
                    <th>Lote Veridi</th>
                    <th>Quantidade</th>
                    <th>Conferido em</th>
                    <th>Conferido por</th>
                  </tr>
                </thead>
                <tbody>
                  {shipment.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="code">{line.productCode}</span> {line.productName}
                      </td>
                      <td className="is-code">{line.lotCode ?? "—"}</td>
                      <td>{line.businessLotNumber ?? "—"}</td>
                      <td>
                        {line.quantity} {line.unitCode}
                      </td>
                      <td>{formatDateTime(line.verifiedAt)}</td>
                      <td>{line.verifiedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                disabled={saving || totalToShip <= 0 || !shipment.verification.allLotsVerified}
                onClick={() => setConfirmDialogOpen(true)}
                title={
                  shipment.verification.allLotsVerified
                    ? undefined
                    : "Existem lotes ainda não conferidos nesta expedição."
                }
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
        message={
          `Produtos: ${shipment.verification.productCount} · Lotes: ${shipment.verification.lotsRequired} · ` +
          `Conferência: ${shipment.verification.lotsVerified}/${shipment.verification.lotsRequired} ✓. ` +
          "A confirmação registrará a saída física do estoque e não poderá ser cancelada depois."
        }
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
