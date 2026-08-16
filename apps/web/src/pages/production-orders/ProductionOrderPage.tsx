import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProductDTO, ProductionOrderDTO, ProductionOrderStatus } from "@veridi/shared";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import {
  cancelProductionOrder,
  createProductionOrder,
  getProductionOrder,
  planProductionOrder,
  updateProductionOrder,
} from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { listFormulationVersionsByProduct } from "../../lib/formulations-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";

interface FormulationVersionOption {
  id: string;
  versionLabel: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
}

function statusBadgeClass(status: ProductionOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "PLANNED":
    case "RELEASED":
      return "badge badge--active";
    case "IN_PRODUCTION":
      return "badge badge--warn";
    case "COMPLETED":
      return "badge badge--active";
    case "BLOCKED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

/**
 * Documento transacional — página própria, não FullWorkspaceModal (mesmo
 * padrão de Ordem de Compra). Atende `/producao/ordens/nova` (sem :id) e
 * `/producao/ordens/:id`.
 */
export function ProductionOrderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [productionOrder, setProductionOrder] = useState<ProductionOrderDTO | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [productId, setProductId] = useState("");
  const [formulationVersionId, setFormulationVersionId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const [activeProducts, setActiveProducts] = useState<ProductDTO[]>([]);
  const [formulationOptions, setFormulationOptions] = useState<FormulationVersionOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFormFromServer = useCallback((order: ProductionOrderDTO) => {
    setProductId(order.productId);
    setFormulationVersionId(order.formulationVersionId ?? "");
    setPlannedQuantity(order.plannedQuantity);
    setNotes(order.notes ?? "");
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    setNotFound(false);
    getProductionOrder(id)
      .then((order) => {
        setProductionOrder(order);
        syncFormFromServer(order);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, isNew, syncFormFromServer]);

  useEffect(() => {
    listProducts({ active: true, pageSize: 100 })
      .then((result) => setActiveProducts(result.products))
      .catch(() => setActiveProducts([]));
  }, []);

  // Enquanto DRAFT: recarrega as versões de formulação do produto
  // selecionado sempre que ele muda, priorizando a ACTIVE por padrão —
  // nunca herda a formulação de um produto anterior.
  useEffect(() => {
    if (!productId) {
      setFormulationOptions([]);
      return;
    }
    listFormulationVersionsByProduct(productId)
      .then((result) => {
        setFormulationOptions(
          result.versions.map((version) => ({
            id: version.id,
            versionLabel: version.versionLabel,
            status: version.status,
          })),
        );
      })
      .catch(() => setFormulationOptions([]));
  }, [productId]);

  const status: ProductionOrderStatus = productionOrder?.status ?? "DRAFT";
  const isDraft = isNew || status === "DRAFT";
  const isCancellable = !isNew && (status === "DRAFT" || status === "PLANNED");
  const isPlannable = !isNew && status === "DRAFT";

  const selectedProduct = activeProducts.find((product) => product.id === productId) ?? null;
  const hasNoActiveFormulation =
    isDraft && productId.length > 0 && !formulationOptions.some((version) => version.status === "ACTIVE");

  function handleProductChange(nextProductId: string) {
    setProductId(nextProductId);
    // Recarregar as versoes do novo produto substitui a selecao anterior —
    // regeneracao real de Requirements acontece no backend ao salvar.
    if (!nextProductId) {
      setFormulationVersionId("");
      return;
    }
    listFormulationVersionsByProduct(nextProductId)
      .then((result) => {
        const active = result.versions.find((version) => version.status === "ACTIVE");
        setFormulationVersionId(active?.id ?? "");
      })
      .catch(() => setFormulationVersionId(""));
  }

  async function handleSaveDraft() {
    if (!productId) {
      setError("Selecione um produto.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      productId,
      ...(formulationVersionId ? { formulationVersionId } : {}),
      ...(plannedQuantity.trim() ? { plannedQuantity: plannedQuantity.trim() } : {}),
      notes: notes.trim(),
    };

    try {
      if (isNew) {
        const created = await createProductionOrder(payload);
        navigate(`/producao/ordens/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await updateProductionOrder(id, payload);
        setProductionOrder(updated);
        syncFormFromServer(updated);
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar ordem de produção");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNotesOnly() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProductionOrder(id, { notes: notes.trim() });
      setProductionOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar observações");
    } finally {
      setSaving(false);
    }
  }

  async function handlePlan() {
    if (!id) return;
    setPlanning(true);
    setError(null);
    try {
      const updated = await planProductionOrder(id);
      setProductionOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao planejar ordem de produção");
    } finally {
      setPlanning(false);
    }
  }

  async function handleCancelConfirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await cancelProductionOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setProductionOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar ordem de produção");
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de produção</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isNew && notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de produção não encontrada</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/producao/ordens")}>
            ← Voltar para Ordens de Produção
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Produção / Ordens de Produção / {isNew ? "Nova" : "Editar"}</div>
          <div className="doc-title">
            <h1>{isNew ? "Nova ordem de produção" : productionOrder?.code}</h1>
            {productionOrder && (
              <span className={statusBadgeClass(status)}>{PRODUCTION_ORDER_STATUS_LABELS[status]}</span>
            )}
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/producao/ordens")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {productionOrder?.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelado</span>
              <span className="field__hint">
                {formatDateTime(productionOrder.cancelledAt)} — {productionOrder.cancelledBy ?? "—"}
              </span>
            </div>
            {productionOrder.cancelReason && (
              <p className="field__hint">Motivo: {productionOrder.cancelReason}</p>
            )}
          </FormSection>
        )}

        <FormSection
          title="Produto"
          subtitle={
            isDraft
              ? "Enquanto rascunho, produto, formulação e quantidade podem ser alterados livremente."
              : "Após planejada, produto, formulação e quantidade ficam congelados."
          }
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="op-product">
                Produto <span className="req">*</span>
              </label>
              {isDraft ? (
                <select
                  id="op-product"
                  value={productId}
                  onChange={(event) => handleProductChange(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.code} — {product.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="field-readonly-value">
                  {productionOrder?.productCode} — {productionOrder?.productName}
                </p>
              )}
              {fieldErrors["productId"] && <p className="field__error">{fieldErrors["productId"]}</p>}
              {isDraft && productId && !selectedProduct?.finishedProductItem && (
                <p className="field__hint">Produto sem item de produto acabado válido.</p>
              )}
              {hasNoActiveFormulation && (
                <p className="field__hint">Produto sem formulação ativa.</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="op-formulation">Formulação</label>
              {isDraft ? (
                <select
                  id="op-formulation"
                  value={formulationVersionId}
                  disabled={!productId}
                  onChange={(event) => setFormulationVersionId(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {formulationOptions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.versionLabel}
                      {version.status !== "ACTIVE" ? ` (${version.status === "DRAFT" ? "rascunho" : "inativa"})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="field-readonly-value">{productionOrder?.formulationVersionLabel ?? "—"}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="op-quantity">
                Quantidade planejada <span className="req">*</span>
              </label>
              {isDraft ? (
                <input
                  id="op-quantity"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={plannedQuantity}
                  onChange={(event) => setPlannedQuantity(event.target.value)}
                />
              ) : (
                <p className="field-readonly-value">{productionOrder?.plannedQuantity}</p>
              )}
              {fieldErrors["plannedQuantity"] && (
                <p className="field__error">{fieldErrors["plannedQuantity"]}</p>
              )}
            </div>

            <div className="field">
              <label>Unidade</label>
              <p className="field-readonly-value">
                {productionOrder?.outputUnitCode ?? "definida pelo item de produto acabado"}
              </p>
            </div>
          </div>
        </FormSection>

        {productionOrder && (
          <FormSection
            title="Necessidade de Materiais"
            subtitle="Disponibilidade calculada em tempo real a partir do estoque atual — não é uma reserva."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Necessário</th>
                    <th>On Hand</th>
                    <th>Reservado</th>
                    <th>Disponível</th>
                    <th>Em Compra</th>
                    <th>Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {productionOrder.requirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td>
                        <span className="code">{requirement.itemCode}</span> {requirement.itemName}
                        {requirement.suggestedAllocations.length > 0 && (
                          <>
                            <br />
                            <span className="field__hint">
                              Sugestão FEFO/FIFO:{" "}
                              {requirement.suggestedAllocations
                                .map((allocation) => `${allocation.lotCode}→${allocation.suggestedQuantity}`)
                                .join(", ")}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        {requirement.requiredQuantity} {requirement.stockUnitCode}
                      </td>
                      <td>{requirement.onHand}</td>
                      <td>{requirement.reserved}</td>
                      <td>{requirement.available}</td>
                      <td>{requirement.onOrder}</td>
                      <td>
                        <span
                          className={
                            requirement.availabilityStatus === "AVAILABLE"
                              ? "badge badge--active"
                              : "badge badge--warn"
                          }
                        >
                          {requirement.shortage}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {productionOrder.requirements.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table__empty">
                        Nenhuma necessidade calculada — selecione uma formulação com componentes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="op-notes">Notas internas</label>
            <textarea
              id="op-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        {isCancellable && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={saving || planning}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar OP
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || planning}
              onClick={handleSaveDraft}
            >
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraft && status !== "CANCELLED" && !isNew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || planning}
              onClick={handleSaveNotesOnly}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          )}
          {isPlannable && (
            <button type="button" className="btn btn--accent" disabled={saving || planning} onClick={handlePlan}>
              {planning ? "Planejando…" : "Planejar OP"}
            </button>
          )}
        </div>
      </div>

      {cancelDialogOpen && (
        <>
          <div className="confirm-overlay" />
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-op-title"
          >
            <h2 id="cancel-op-title">Cancelar ordem de produção?</h2>
            <p>
              {productionOrder?.code} permanecerá no histórico. Esta ação não pode ser desfeita.
            </p>
            <div className="field">
              <label htmlFor="op-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="op-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setCancelDialogOpen(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancelConfirm}
              >
                Cancelar OP
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
