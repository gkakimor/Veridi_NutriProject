import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BillingDTO, BillingStatus } from "@veridi/shared";
import { BILLING_STATUS_LABELS } from "@veridi/shared";
import { cancelBilling, getBilling, issueBilling, updateBilling } from "../../lib/billings-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";

function statusBadgeClass(status: BillingStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ISSUED":
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
 * Documento transacional — página própria no workspace. Faturamento
 * comercial/operacional: nunca emite Nota Fiscal e nunca movimenta
 * estoque. Só `unitPrice`/observações/referência externa são editáveis, e
 * apenas enquanto rascunho.
 */
export function BillingPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [billing, setBilling] = useState<BillingDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [prices, setPrices] = useState<Record<string, string>>({});
  const [externalReference, setExternalReference] = useState("");
  const [notes, setNotes] = useState("");

  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFromServer = useCallback((next: BillingDTO) => {
    setBilling(next);
    setExternalReference(next.externalReference ?? "");
    setNotes(next.notes ?? "");
    const nextPrices: Record<string, string> = {};
    for (const line of next.lines) {
      nextPrices[line.id] = line.unitPrice ?? "";
    }
    setPrices(nextPrices);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    getBilling(id)
      .then(syncFromServer)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, syncFromServer]);

  const isDraft = billing?.status === "DRAFT";

  function buildPayload() {
    return {
      externalReference: externalReference.trim(),
      notes: notes.trim(),
      lines: (billing?.lines ?? []).map((line) => ({
        billingLineId: line.id,
        unitPrice: (prices[line.id] ?? "").trim(),
      })),
    };
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      syncFromServer(await updateBilling(id, buildPayload()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar faturamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleIssue() {
    if (!id) return;
    setIssueDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      // Salva o que está na tela antes de congelar o documento.
      await updateBilling(id, buildPayload());
      syncFromServer(await issueBilling(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao emitir faturamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const cancelled = await cancelBilling(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      syncFromServer(cancelled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar faturamento");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !billing) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/faturamento")}>
            ← Voltar para Faturamento
          </button>
        </div>
      </div>
    );
  }

  // Prévia local do total enquanto edita — só existe com pricing completo,
  // nunca somando apenas parte das linhas.
  const previewComplete = billing.lines.length > 0 && billing.lines.every((line) => (prices[line.id] ?? "").trim() !== "");
  const previewTotal = previewComplete
    ? billing.lines
        .reduce((sum, line) => sum + Number(line.quantity) * Number(prices[line.id] ?? "0"), 0)
        .toFixed(2)
    : null;
  const displayTotal = isDraft ? previewTotal : billing.totalAmount;

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Comercial / Faturamento / Detalhe</div>
          <div className="doc-title">
            <h1>{billing.code}</h1>
            <span className={statusBadgeClass(billing.status)}>{BILLING_STATUS_LABELS[billing.status]}</span>
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/comercial/faturamento/${billing.id}/imprimir`)}
          >
            Imprimir
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/faturamento")}>
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {billing.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelado</span>
              <span className="field__hint">
                {formatDateTime(billing.cancelledAt)} — {billing.cancelledBy ?? "—"}
              </span>
            </div>
            {billing.cancelReason && <p className="field__hint">Motivo: {billing.cancelReason}</p>}
          </FormSection>
        )}

        <FormSection
          title="Origem"
          subtitle="Faturamento comercial/operacional — não emite Nota Fiscal e não movimenta estoque."
        >
          <dl className="definition-list">
            <dt>Pedido</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/comercial/pedidos/${billing.customerOrderId}`)}
              >
                {billing.customerOrderCode}
              </button>
            </dd>
            <dt>Expedição</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/comercial/expedicoes/${billing.shipmentId}`)}
              >
                {billing.shipmentCode}
              </button>
            </dd>
            <dt>Cliente</dt>
            <dd>
              {billing.customerCode} — {billing.customerName}
            </dd>
            <dt>Data de expedição</dt>
            <dd>{formatDate(billing.shipmentDate)}</dd>
          </dl>

          <div className="field">
            <label htmlFor="billing-external-reference">Referência externa</label>
            <input
              id="billing-external-reference"
              type="text"
              placeholder="Ex.: NF 12345"
              disabled={!isDraft}
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
            />
            <p className="field__hint">
              Referência a documento externo/ERP quando existir — o sistema não valida nem emite esse documento.
            </p>
          </div>
        </FormSection>

        <FormSection
          title="Itens faturados"
          subtitle="Quantidades vêm da expedição confirmada — nunca editáveis. Só o preço unitário é informado aqui."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th>Quantidade</th>
                  <th>Unidade</th>
                  <th>Preço unitário</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {billing.lines.map((line) => {
                  const price = (prices[line.id] ?? "").trim();
                  const lineTotal =
                    isDraft && price !== "" && !Number.isNaN(Number(price))
                      ? (Number(line.quantity) * Number(price)).toFixed(2)
                      : line.lineTotal;
                  return (
                    <tr key={line.id}>
                      <td>
                        <span className="code">{line.productCode}</span> {line.productName}
                      </td>
                      <td>
                        {line.lotCode ?? "—"}
                        {line.businessLotNumber ? ` — ${line.businessLotNumber}` : ""}
                      </td>
                      <td>{line.quantity}</td>
                      <td>{line.unitCode}</td>
                      <td>
                        {isDraft ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Opcional"
                            value={prices[line.id] ?? ""}
                            onChange={(event) =>
                              setPrices((prev) => ({ ...prev, [line.id]: event.target.value }))
                            }
                          />
                        ) : (
                          formatBRL(line.unitPrice)
                        )}
                      </td>
                      <td>{formatBRL(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="table-foot">
              Quantidade total: {billing.totalQuantity} · Valor total:{" "}
              {displayTotal ? formatBRL(displayTotal) : "Valores incompletos"}
            </div>
          </div>
          {!displayTotal && (
            <p className="field__hint">
              O valor total só é calculado quando todas as linhas têm preço — o faturamento quantitativo
              continua válido sem preço.
            </p>
          )}
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="billing-notes">Notas internas</label>
            <textarea
              id="billing-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>

        {billing.status === "ISSUED" && (
          <FormSection title="Auditoria">
            <dl className="definition-list">
              <dt>Emitido em</dt>
              <dd>
                {formatDateTime(billing.issuedAt)} — {billing.issuedBy ?? "—"}
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
            Cancelar faturamento
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSave}>
                {saving ? "Salvando…" : "Salvar rascunho"}
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving}
                onClick={() => setIssueDialogOpen(true)}
              >
                Emitir faturamento
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={issueDialogOpen}
        title={`Emitir faturamento ${billing.code}?`}
        message="O documento será marcado como emitido e ficará somente para leitura. Esta ação não emite Nota Fiscal."
        confirmLabel="Emitir faturamento"
        confirmTone="accent"
        onCancel={() => setIssueDialogOpen(false)}
        onConfirm={handleIssue}
      />

      {cancelDialogOpen && (
        <>
          <div className="confirm-overlay" />
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-billing-title">
            <h2 id="cancel-billing-title">Cancelar faturamento?</h2>
            <p>
              {billing.code} permanecerá no histórico. Nada muda no estoque nem na expedição — a expedição
              volta a aparecer como faturável e um novo faturamento pode ser preparado.
            </p>
            <div className="field">
              <label htmlFor="billing-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="billing-cancel-reason"
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
                Cancelar faturamento
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
