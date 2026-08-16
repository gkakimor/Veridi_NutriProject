import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CostReferenceDTO, LotDTO, LotTraceabilityDTO, ProductionOrderMaterialCostDTO } from "@veridi/shared";
import { COST_QUALITY_LABELS, COST_SOURCE_LABELS, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import { blockLot, getLot, getLotTraceability, releaseLot } from "../../lib/lots-api";
import { getItemCostReference, getProductionOrderMaterialCost } from "../../lib/costs-api";
import { getReceipt } from "../../lib/receiving-api";
import { formatBRL } from "../../lib/currency";
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

  const [traceability, setTraceability] = useState<LotTraceabilityDTO | null>(null);
  /** Custo real deste lote recebido (via ReceiptLine) — `null` se desconhecido. */
  const [lotActualCost, setLotActualCost] = useState<string | null>(null);
  /** Referência estimada do Item — usada só quando o lote não tem custo real. */
  const [itemCostReference, setItemCostReference] = useState<CostReferenceDTO | null>(null);
  /** Custo material da OP que produziu este lote (origin=PRODUCTION). */
  const [productionCost, setProductionCost] = useState<ProductionOrderMaterialCostDTO | null>(null);

  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  function load(lotId: string) {
    setLoading(true);
    setNotFound(false);
    setTraceability(null);
    getLot(lotId)
      .then(setLot)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    getLotTraceability(lotId)
      .then(setTraceability)
      .catch(() => setTraceability(null));
  }

  useEffect(() => {
    if (id) load(id);
  }, [id]);

  // Custo do lote: recebido usa o custo efetivo da própria aquisição
  // (REAL); produzido usa o custo material da OP. Sem custo real, mostra
  // a referência estimada do Item — sempre rotulada como estimativa.
  useEffect(() => {
    setLotActualCost(null);
    setItemCostReference(null);
    setProductionCost(null);
    if (!lot) return;

    if (lot.origin === "PRODUCTION") {
      if (lot.productionOrderId) {
        getProductionOrderMaterialCost(lot.productionOrderId)
          .then(setProductionCost)
          .catch(() => setProductionCost(null));
      }
      return;
    }

    if (lot.receiptId) {
      getReceipt(lot.receiptId)
        .then((receipt) => {
          const line = receipt.lines.find((receiptLine) => receiptLine.lotId === lot.id);
          setLotActualCost(line?.actualUnitCost ?? null);
          if (!line?.actualUnitCost) {
            getItemCostReference(lot.itemId)
              .then(setItemCostReference)
              .catch(() => setItemCostReference(null));
          }
        })
        .catch(() => setLotActualCost(null));
    } else {
      getItemCostReference(lot.itemId)
        .then(setItemCostReference)
        .catch(() => setItemCostReference(null));
    }
  }, [lot]);

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
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/estoque/lotes/${lot.id}/rastreabilidade/imprimir`)}
          >
            Imprimir rastreabilidade
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {lot.origin === "PRODUCTION" ? (
          <FormSection title="Identificação">
            <dl className="definition-list">
              <dt>Origem</dt>
              <dd>Produção</dd>
              <dt>Item</dt>
              <dd>
                <span className="code">{lot.itemCode}</span> {lot.itemName}
              </dd>
              <dt>Produzido por</dt>
              <dd>
                {lot.productionOrderId ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => navigate(`/producao/ordens/${lot.productionOrderId}`)}
                  >
                    {lot.productionOrderCode}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Lote Veridi</dt>
              <dd>{lot.businessLotNumber ?? "—"}</dd>
            </dl>
          </FormSection>
        ) : (
          <FormSection title="Identificação">
            <dl className="definition-list">
              <dt>Item</dt>
              <dd>
                <span className="code">{lot.itemCode}</span> {lot.itemName}
              </dd>
              <dt>Proprietário</dt>
              <dd>
                {ownerLabel(lot.ownerType, lot.ownerCustomerName)}
                {lot.ownerType === "CUSTOMER" && lot.ownerCustomerCode ? (
                  <span className="field__hint"> {lot.ownerCustomerCode}</span>
                ) : null}
              </dd>
              <dt>Fornecedor</dt>
              <dd>
                {lot.supplierId ? `${lot.supplierCode} — ${lot.supplierName}` : "—"}
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
        )}

        <FormSection
          title="Quantidade e validade"
          subtitle={
            lot.origin === "PRODUCTION"
              ? "Quantidade produzida acumulada (soma dos apontamentos) — não é saldo atual. Saldo atual vem do histórico de movimentações (abaixo)."
              : "Quantidade originalmente recebida — não é saldo atual. Saldo atual vem do histórico de movimentações (abaixo)."
          }
        >
          <dl className="definition-list">
            <dt>{lot.origin === "PRODUCTION" ? "Quantidade produzida" : "Quantidade recebida"}</dt>
            <dd>
              {lot.origin === "PRODUCTION" ? lot.producedQuantity : lot.initialReceivedQuantity}{" "}
              {lot.unitCode}
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

        {lot.origin === "PRODUCTION" ? (
          <FormSection
            title="Custo material da produção"
            subtitle="Derivado do que a Ordem de Produção realmente consumiu — nunca de custo de aquisição de fornecedor."
          >
            {productionCost ? (
              <>
                <dl className="definition-list">
                  <dt>Custo material / unidade</dt>
                  <dd>
                    {productionCost.materialUnitCost
                      ? `${formatBRL(productionCost.materialUnitCost)} / ${productionCost.outputUnitCode}`
                      : "Indisponível"}
                  </dd>
                  <dt>Qualidade</dt>
                  <dd>
                    <span
                      className={
                        productionCost.quality === "REAL"
                          ? "badge badge--active"
                          : productionCost.quality === "ESTIMATED"
                            ? "badge badge--neutral"
                            : "badge badge--warn"
                      }
                    >
                      {COST_QUALITY_LABELS[productionCost.quality]}
                    </span>
                  </dd>
                </dl>
                {productionCost.quality === "PARTIAL" && (
                  <p className="field__hint">
                    Custo parcial: existem materiais consumidos sem referência de custo.
                  </p>
                )}
                <p className="field__hint">
                  Todos os lotes produzidos por esta OP compartilham a mesma referência de custo material
                  unitário — não há rateio por lote.
                </p>
              </>
            ) : (
              <p className="field__hint">Custo material indisponível para a Ordem de Produção de origem.</p>
            )}
          </FormSection>
        ) : (
          <FormSection title="Custo de aquisição">
            {lotActualCost !== null ? (
              <dl className="definition-list">
                <dt>Custo de aquisição</dt>
                <dd>
                  {formatBRL(lotActualCost)} / {lot.unitCode}
                </dd>
                <dt>Origem</dt>
                <dd>
                  <span className="badge badge--active">{COST_SOURCE_LABELS.REAL}</span>
                </dd>
              </dl>
            ) : itemCostReference ? (
              <>
                <dl className="definition-list">
                  <dt>Referência estimada</dt>
                  <dd>
                    {itemCostReference.unitCost
                      ? `${formatBRL(itemCostReference.unitCost)} / ${lot.unitCode}`
                      : "Sem custo"}
                  </dd>
                  <dt>Origem</dt>
                  <dd>
                    <span
                      className={
                        itemCostReference.source === "NO_COST" ? "badge badge--warn" : "badge badge--neutral"
                      }
                    >
                      {COST_SOURCE_LABELS[itemCostReference.source]}
                    </span>
                  </dd>
                </dl>
                <p className="field__hint">
                  Referência estimada do item — este lote não possui custo efetivo de aquisição informado.
                </p>
              </>
            ) : (
              <p className="field__hint">Sem custo.</p>
            )}
          </FormSection>
        )}

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

        {traceability && traceability.kind === "FINISHED_GOOD" && (
          <FormSection
            title="Rastreabilidade"
            subtitle="Genealogia real — consumo e produção efetivos, nunca reserva/sugestão FEFO."
          >
            <dl className="definition-list">
              <dt>Produzido por</dt>
              <dd>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/producao/ordens/${traceability.productionOrderId}`)}
                >
                  {traceability.productionOrderCode}
                </button>
              </dd>
              <dt>Produto</dt>
              <dd>
                <span className="code">{traceability.productCode}</span> {traceability.productName}
              </dd>
              <dt>Quantidade produzida neste lote</dt>
              <dd>
                {traceability.producedQuantity} {traceability.unitCode}
              </dd>
            </dl>

            <div className="table-container table-container--spaced">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th>Lote fornecedor</th>
                    <th>Quantidade consumida</th>
                    <th>Fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {traceability.consumedMaterials.map((material) => (
                    <tr key={`${material.itemId}-${material.lotId ?? "sem-lote"}`}>
                      <td>
                        <span className="code">{material.itemCode}</span> {material.itemName}
                      </td>
                      <td>{material.lotCode ?? "—"}</td>
                      <td>{material.supplierLot ?? "—"}</td>
                      <td>
                        {material.quantity} {material.unitCode}
                      </td>
                      <td>{material.supplierName ?? "—"}</td>
                    </tr>
                  ))}
                  {traceability.consumedMaterials.length === 0 && (
                    <tr>
                      <td colSpan={5} className="table__empty">
                        Nenhum material consumido registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {traceability && traceability.kind === "RAW_MATERIAL" && (
          <FormSection
            title="Rastreabilidade — Utilizado em"
            subtitle="Genealogia real — consumo e produção efetivos, nunca reserva/sugestão FEFO."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ordem de Produção</th>
                    <th>Produto</th>
                    <th>Quantidade consumida</th>
                    <th>Lote(s) de produto acabado gerados</th>
                  </tr>
                </thead>
                <tbody>
                  {traceability.usedIn.map((usage) => (
                    <tr key={usage.productionOrderId}>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/producao/ordens/${usage.productionOrderId}`)}
                        >
                          {usage.productionOrderCode}
                        </button>
                      </td>
                      <td>
                        <span className="code">{usage.productCode}</span> {usage.productName}
                      </td>
                      <td>
                        {usage.consumedQuantity} {usage.unitCode}
                      </td>
                      <td>
                        {usage.finishedLots.length === 0
                          ? "—"
                          : usage.finishedLots
                              .map((finished) => finished.businessLotNumber ?? finished.lotCode)
                              .join(", ")}
                      </td>
                    </tr>
                  ))}
                  {traceability.usedIn.length === 0 && (
                    <tr>
                      <td colSpan={4} className="table__empty">
                        Este lote nunca foi consumido em nenhuma Ordem de Produção.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

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
