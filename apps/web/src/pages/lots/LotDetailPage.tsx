import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { LotDTO } from "@veridi/shared";
import { LOT_STATUS_LABELS } from "@veridi/shared";
import { blockLot, getLot, releaseLot } from "../../lib/lots-api";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { QrCode } from "../../components/QrCode";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function statusBadgeClass(status: LotDTO["status"], isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    case "BLOCKED":
    case "EXPIRED":
      return "badge badge--err";
  }
}

/** Detalhe do lote — liberacao/bloqueio explicitos. Sem saldo/QR ainda. */
export function LotDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [lot, setLot] = useState<LotDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  function load(lotId: string) {
    setLoading(true);
    setNotFound(false);
    getLot(lotId)
      .then(setLot)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (id) load(id);
  }, [id]);

  async function handleRelease() {
    if (!id) return;
    setReleaseDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await releaseLot(id);
      setLot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao liberar lote");
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await blockLot(id, { reason: blockReason.trim() });
      setBlockDialogOpen(false);
      setBlockReason("");
      setLot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao bloquear lote");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Lote</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !lot) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Lote não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
            ← Voltar para Lotes
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Estoque / Lotes / Detalhe</div>
          <div className="doc-title">
            <h1>{lot.code}</h1>
            <span className={statusBadgeClass(lot.status, lot.isExpired)}>
              {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
            </span>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Identificação">
          <dl className="definition-list">
            <dt>Item</dt>
            <dd>
              <span className="code">{lot.itemCode}</span> {lot.itemName}
            </dd>
            <dt>Fornecedor</dt>
            <dd>
              {lot.supplierCode} — {lot.supplierName}
            </dd>
            <dt>Lote do fornecedor</dt>
            <dd>{lot.supplierLot ?? "—"}</dd>
            <dt>Origem — Recebimento</dt>
            <dd>
              {lot.receiptId ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/compras/recebimentos/${lot.receiptId}`)}
                >
                  {lot.receiptCode}
                </button>
              ) : (
                "—"
              )}
            </dd>
            <dt>Origem — Ordem de Compra</dt>
            <dd>
              {lot.purchaseOrderId ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/compras/ordens/${lot.purchaseOrderId}`)}
                >
                  {lot.purchaseOrderCode}
                </button>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </FormSection>

        <FormSection
          title="Quantidade e validade"
          subtitle="Quantidade originalmente recebida — não é saldo atual. Saldo atual vem do histórico de movimentações (abaixo)."
        >
          <dl className="definition-list">
            <dt>Quantidade recebida</dt>
            <dd>
              {lot.initialReceivedQuantity} {lot.unitCode}
            </dd>
            <dt>Validade</dt>
            <dd>{formatDate(lot.expiryDate)}</dd>
            <dt>Localização</dt>
            <dd>{lot.location ?? "—"}</dd>
          </dl>
        </FormSection>

        <FormSection title="Saldo" subtitle="Derivado do histórico de movimentações — nunca uma coluna própria do lote.">
          <dl className="definition-list">
            <dt>On Hand</dt>
            <dd>
              {lot.onHand} {lot.unitCode}
            </dd>
            <dt>Reservado</dt>
            <dd>
              {lot.reserved} {lot.unitCode}
            </dd>
            <dt>Disponível</dt>
            <dd>
              {lot.available} {lot.unitCode}
            </dd>
          </dl>
        </FormSection>

        <FormSection title="Qualidade">
          <div className="status-line">
            <span className={statusBadgeClass(lot.status, lot.isExpired)}>
              {LOT_STATUS_LABELS[lot.status]}
            </span>
            {lot.status === "AWAITING_RELEASE" && (
              <span className="field__hint">Aguardando liberação da Qualidade para uso.</span>
            )}
            {lot.status === "BLOCKED" && (
              <span className="field__hint">
                Bloqueado {formatDateTime(lot.blockedAt)} por {lot.blockedBy ?? "—"}
                {lot.blockReason ? ` — ${lot.blockReason}` : ""}
              </span>
            )}
            {lot.status === "AVAILABLE" && lot.releasedAt && (
              <span className="field__hint">
                Liberado {formatDateTime(lot.releasedAt)} por {lot.releasedBy ?? "—"}
              </span>
            )}
          </div>

          <div className="line-actions">
            {lot.status === "AWAITING_RELEASE" && (
              <div className="table__actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => setReleaseDialogOpen(true)}
                >
                  Liberar
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={saving}
                  onClick={() => setBlockDialogOpen(true)}
                >
                  Bloquear
                </button>
              </div>
            )}
            {lot.status === "AVAILABLE" && (
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={saving}
                onClick={() => setBlockDialogOpen(true)}
              >
                Bloquear
              </button>
            )}
          </div>
        </FormSection>

        <FormSection title="QR Code" subtitle="Identifica só o lote interno — nunca dados mutáveis.">
          <div className="lot-detail-qr">
            <QrCode value={lot.qrPayload} size={112} label={`Código QR do lote ${lot.code}`} />
            <div className="lot-detail-qr__meta">
              <span className="field-readonly-value">{lot.qrPayload}</span>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => navigate(`/estoque/lotes/${lot.id}/etiqueta`)}
              >
                Imprimir etiqueta
              </button>
            </div>
          </div>
        </FormSection>

        <FormSection title="Auditoria">
          <dl className="definition-list">
            <dt>Criado em</dt>
            <dd>
              {formatDateTime(lot.createdAt)} — {lot.createdBy ?? "—"}
            </dd>
          </dl>
        </FormSection>
      </div>

      <ConfirmDialog
        open={releaseDialogOpen}
        title="Liberar lote?"
        message={`"${lot.code}" ficará disponível para uso a partir de agora.`}
        confirmLabel="Liberar"
        confirmTone="accent"
        onCancel={() => setReleaseDialogOpen(false)}
        onConfirm={handleRelease}
      />

      {blockDialogOpen && (
        <>
          <div className="confirm-overlay" />
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="block-lot-title"
          >
            <h2 id="block-lot-title">Bloquear lote?</h2>
            <p>
              "{lot.code}" deixará de estar disponível para uso até uma nova decisão da Qualidade.
            </p>
            <div className="field">
              <label htmlFor="block-lot-reason">
                Motivo do bloqueio <span className="req">*</span>
              </label>
              <textarea
                id="block-lot-reason"
                rows={3}
                value={blockReason}
                onChange={(event) => setBlockReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setBlockDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={blockReason.trim().length < 3 || saving}
                onClick={handleBlock}
              >
                Bloquear lote
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
