import { Fragment, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ItemDTO,
  ProductDTO,
  ProductionOrderDTO,
  ProductionOrderStatus,
  ProductionOutputDestination,
} from "@veridi/shared";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import {
  cancelProductionOrder,
  completeProductionOrder,
  confirmPicking,
  createProductionOrder,
  getProductionOrder,
  planProductionOrder,
  recordConsumption,
  registerProductionOutput,
  releaseProductionOrder,
  substituteReservationLine,
  updateProductionOrder,
} from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { listFormulationVersionsByProduct } from "../../lib/formulations-api";
import { getItem } from "../../lib/items-api";
import { ApiValidationError, LotMismatchApiError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { LotScanner } from "../../components/LotScanner";

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
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);

  const [scannerLineId, setScannerLineId] = useState<string | null>(null);
  const [pickingBusyLineId, setPickingBusyLineId] = useState<string | null>(null);
  const [mismatchDialog, setMismatchDialog] = useState<{
    lineId: string;
    expectedLotCode: string;
    scannedLotCode: string;
  } | null>(null);
  const [substituting, setSubstituting] = useState(false);
  const [consumeQuantities, setConsumeQuantities] = useState<Record<string, string>>({});
  const [consumingLineId, setConsumingLineId] = useState<string | null>(null);

  const [finishedItem, setFinishedItem] = useState<ItemDTO | null>(null);
  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputDestination, setOutputDestination] = useState<ProductionOutputDestination>("NEW_LOT");
  const [outputLotId, setOutputLotId] = useState("");
  const [outputBusinessLotNumber, setOutputBusinessLotNumber] = useState("");
  const [outputExpiryDate, setOutputExpiryDate] = useState("");
  const [outputLocation, setOutputLocation] = useState("");
  const [outputNotes, setOutputNotes] = useState("");
  const [registeringOutput, setRegisteringOutput] = useState(false);

  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completionReason, setCompletionReason] = useState("");
  const [completing, setCompleting] = useState(false);

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

  // So precisa dos flags do Finished Item (controlsLot/controlsExpiry) a
  // partir de IN_PRODUCTION, para orientar o formulario de Registrar produção.
  useEffect(() => {
    const finishedItemId = productionOrder?.finishedItemId;
    const orderStatus = productionOrder?.status;
    if (!finishedItemId || (orderStatus !== "IN_PRODUCTION" && orderStatus !== "COMPLETED")) {
      setFinishedItem(null);
      return;
    }
    getItem(finishedItemId)
      .then(setFinishedItem)
      .catch(() => setFinishedItem(null));
  }, [productionOrder?.finishedItemId, productionOrder?.status]);

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
  const isCancellable = !isNew && (status === "DRAFT" || status === "PLANNED" || status === "RELEASED");
  const isPlannable = !isNew && status === "DRAFT";
  const isReleasable = !isNew && status === "PLANNED";
  const hasShortage = (productionOrder?.shortageItemCount ?? 0) > 0;

  const selectedProduct = activeProducts.find((product) => product.id === productId) ?? null;
  const hasNoActiveFormulation =
    isDraft && productId.length > 0 && !formulationOptions.some((version) => version.status === "ACTIVE");

  const isReleasedOrInProduction = status === "RELEASED" || status === "IN_PRODUCTION";
  // Linhas ativas (nao substituidas) de todos os Requirements — base do
  // Picking e do Consumo Real. Linhas substituidas (releasedAt != null)
  // ficam so no historico dentro de "Materiais Reservados".
  const activeReservationLines = (productionOrder?.requirements ?? []).flatMap((requirement) =>
    requirement.reservationLines.filter((line) => line.releasedAt === null),
  );

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

  async function handleRelease() {
    if (!id) return;
    setReleaseDialogOpen(false);
    setReleasing(true);
    setError(null);
    try {
      const updated = await releaseProductionOrder(id);
      setProductionOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao liberar ordem de produção");
    } finally {
      setReleasing(false);
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

  async function handleConfirmNoLotPicking(lineId: string) {
    if (!id) return;
    setPickingBusyLineId(lineId);
    setError(null);
    try {
      const updated = await confirmPicking(id, lineId);
      setProductionOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar separação");
    } finally {
      setPickingBusyLineId(null);
    }
  }

  async function handleLotScanned(lineId: string, rawValue: string) {
    if (!id) return;
    setScannerLineId(null);
    setPickingBusyLineId(lineId);
    setError(null);
    try {
      const updated = await confirmPicking(id, lineId, rawValue);
      setProductionOrder(updated);
    } catch (err) {
      if (err instanceof LotMismatchApiError) {
        setMismatchDialog({
          lineId,
          expectedLotCode: err.expectedLotCode,
          scannedLotCode: err.scannedLotCode,
        });
      } else {
        setError(err instanceof Error ? err.message : "Falha ao confirmar picking");
      }
    } finally {
      setPickingBusyLineId(null);
    }
  }

  async function handleUseDifferentLot() {
    if (!id || !mismatchDialog) return;
    setSubstituting(true);
    setError(null);
    try {
      const updated = await substituteReservationLine(
        id,
        mismatchDialog.lineId,
        mismatchDialog.scannedLotCode,
      );
      setProductionOrder(updated);
      setMismatchDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao substituir lote");
    } finally {
      setSubstituting(false);
    }
  }

  async function handleConsumeNow(lineId: string) {
    if (!id) return;
    const quantity = (consumeQuantities[lineId] ?? "").trim();
    if (!quantity) return;

    setConsumingLineId(lineId);
    setError(null);
    try {
      const updated = await recordConsumption(id, [{ reservationLineId: lineId, quantity }]);
      setProductionOrder(updated);
      setConsumeQuantities((prev) => ({ ...prev, [lineId]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar consumo");
    } finally {
      setConsumingLineId(null);
    }
  }

  async function handleRegisterOutput() {
    if (!id) return;
    const quantity = outputQuantity.trim();
    if (!quantity) return;

    setRegisteringOutput(true);
    setError(null);
    setFieldErrors({});
    try {
      const updated = await registerProductionOutput(id, {
        quantity,
        destination: outputDestination,
        ...(outputDestination === "EXISTING_LOT" ? { lotId: outputLotId } : {}),
        ...(outputDestination === "NEW_LOT" ? { businessLotNumber: outputBusinessLotNumber.trim() } : {}),
        ...(outputDestination === "NEW_LOT" && outputExpiryDate ? { expiryDate: outputExpiryDate } : {}),
        ...(outputDestination === "NEW_LOT" && outputLocation.trim() ? { location: outputLocation.trim() } : {}),
        ...(outputNotes.trim() ? { notes: outputNotes.trim() } : {}),
      });
      setProductionOrder(updated);
      setOutputQuantity("");
      setOutputBusinessLotNumber("");
      setOutputExpiryDate("");
      setOutputLocation("");
      setOutputNotes("");
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao registrar produção");
      }
    } finally {
      setRegisteringOutput(false);
    }
  }

  async function handleCompleteOrder() {
    if (!id) return;
    setCompleting(true);
    setError(null);
    try {
      const updated = await completeProductionOrder(id, {
        ...(completionReason.trim() ? { completionReason: completionReason.trim() } : {}),
      });
      setProductionOrder(updated);
      setCompleteDialogOpen(false);
      setCompletionReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao concluir ordem de produção");
    } finally {
      setCompleting(false);
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

        {productionOrder?.reservation && (
          <FormSection
            title="Materiais Reservados"
            subtitle={
              productionOrder.reservation.status === "ACTIVE"
                ? "Alocação oficial desta OP — base do futuro Picking. O estoque físico ainda não foi baixado."
                : "Reserva liberada (OP cancelada) — mantida como histórico, não conta mais em Reservado."
            }
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th>Quantidade reservada</th>
                    <th>Localização</th>
                  </tr>
                </thead>
                <tbody>
                  {productionOrder.reservation.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="code">{line.itemCode}</span> {line.itemName}
                      </td>
                      <td>{line.lotCode ?? "—"}</td>
                      <td>
                        {line.expiryDate ? new Date(line.expiryDate).toLocaleDateString("pt-BR") : "—"}
                      </td>
                      <td>
                        {line.quantity} {line.unitCode}
                      </td>
                      <td>{line.location ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {productionOrder && isReleasedOrInProduction && (
          <FormSection
            title="Picking"
            subtitle="Conferência física do material/lote separado — nunca altera estoque."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote esperado</th>
                    <th>Validade</th>
                    <th>Localização</th>
                    <th>Reservado</th>
                    <th>Status</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {activeReservationLines.map((line) => (
                    <Fragment key={line.id}>
                      <tr>
                        <td>
                          <span className="code">{line.itemCode}</span> {line.itemName}
                          {line.replacesLineId && (
                            <>
                              <br />
                              <span className="field__hint">Lote substituído no Picking</span>
                            </>
                          )}
                        </td>
                        <td>{line.lotId ? line.lotCode : "— (sem controle de lote)"}</td>
                        <td>
                          {line.expiryDate ? new Date(line.expiryDate).toLocaleDateString("pt-BR") : "—"}
                        </td>
                        <td>{line.location ?? "—"}</td>
                        <td>
                          {line.quantity} {line.unitCode}
                        </td>
                        <td>
                          <span
                            className={
                              line.pickingStatus === "CONFIRMED" ? "badge badge--active" : "badge badge--neutral"
                            }
                          >
                            {line.pickingStatus === "CONFIRMED" ? "Conferido" : "Pendente"}
                          </span>
                        </td>
                        <td>
                          {line.pickingStatus !== "CONFIRMED" &&
                            (line.lotId ? (
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                disabled={pickingBusyLineId === line.id}
                                onClick={() =>
                                  setScannerLineId(scannerLineId === line.id ? null : line.id)
                                }
                              >
                                {scannerLineId === line.id ? "Fechar" : "Escanear / Informar lote"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                disabled={pickingBusyLineId === line.id}
                                onClick={() => handleConfirmNoLotPicking(line.id)}
                              >
                                {pickingBusyLineId === line.id ? "Confirmando…" : "Confirmar separação"}
                              </button>
                            ))}
                        </td>
                      </tr>
                      {scannerLineId === line.id && (
                        <tr>
                          <td colSpan={7}>
                            <LotScanner onDetect={(rawValue) => handleLotScanned(line.id, rawValue)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}

                  {activeReservationLines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table__empty">
                        Nenhuma linha de reserva para conferir.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {productionOrder && isReleasedOrInProduction && (
          <FormSection
            title="Consumo Real"
            subtitle="Registra quanto efetivamente entrou na produção — baixa o estoque físico e reduz a reserva remanescente."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th>Reservado</th>
                    <th>Consumido</th>
                    <th>Restante</th>
                    <th>Consumir agora</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {activeReservationLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="code">{line.itemCode}</span> {line.itemName}
                      </td>
                      <td>{line.lotCode ?? "—"}</td>
                      <td>
                        {line.quantity} {line.unitCode}
                      </td>
                      <td>{line.consumedQuantity}</td>
                      <td>{line.remainingQuantity}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          disabled={line.pickingStatus !== "CONFIRMED" || Number(line.remainingQuantity) <= 0}
                          value={consumeQuantities[line.id] ?? ""}
                          onChange={(event) =>
                            setConsumeQuantities((prev) => ({ ...prev, [line.id]: event.target.value }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--accent btn--sm"
                          disabled={
                            line.pickingStatus !== "CONFIRMED" ||
                            Number(line.remainingQuantity) <= 0 ||
                            !(consumeQuantities[line.id] ?? "").trim() ||
                            consumingLineId === line.id
                          }
                          onClick={() => handleConsumeNow(line.id)}
                        >
                          {consumingLineId === line.id ? "Confirmando…" : "Confirmar consumo"}
                        </button>
                      </td>
                    </tr>
                  ))}

                  {activeReservationLines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table__empty">
                        Nenhuma linha de reserva para consumir.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {productionOrder.consumptions.length > 0 && (
              <div className="table-container table-container--spaced">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Item</th>
                      <th>Lote</th>
                      <th>Quantidade</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionOrder.consumptions.map((consumption) => (
                      <tr key={consumption.id}>
                        <td>{formatDateTime(consumption.consumedAt)}</td>
                        <td>
                          <span className="code">{consumption.itemCode}</span> {consumption.itemName}
                        </td>
                        <td>{consumption.lotCode ?? "—"}</td>
                        <td>
                          {consumption.quantity} {consumption.unitCode}
                        </td>
                        <td>{consumption.consumedBy ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        )}

        {productionOrder && (status === "IN_PRODUCTION" || status === "COMPLETED") && (
          <FormSection
            title="Produção"
            subtitle="Produzido é sempre a soma dos apontamentos reais — produção parcial permitida, nunca ultrapassa o planejado."
          >
            <dl className="definition-list">
              <dt>Planejado</dt>
              <dd>
                {productionOrder.plannedQuantity} {productionOrder.outputUnitCode}
              </dd>
              <dt>Produzido</dt>
              <dd>
                {productionOrder.producedQuantity} {productionOrder.outputUnitCode}
              </dd>
              <dt>{status === "COMPLETED" ? "Variação" : "Restante"}</dt>
              <dd>
                {productionOrder.remainingQuantity} {productionOrder.outputUnitCode}
              </dd>
            </dl>

            {status === "IN_PRODUCTION" && finishedItem && !finishedItem.controlsLot && (
              <p className="form-alert">
                Item de produto acabado não controla lote — não é possível registrar produção.
              </p>
            )}

            {status === "IN_PRODUCTION" && finishedItem?.controlsLot && (
              <>
                <div className="field-grid-2">
                  <div className="field">
                    <label htmlFor="output-quantity">
                      Quantidade produzida <span className="req">*</span>
                    </label>
                    <input
                      id="output-quantity"
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={outputQuantity}
                      onChange={(event) => setOutputQuantity(event.target.value)}
                    />
                    {fieldErrors["quantity"] && <p className="field__error">{fieldErrors["quantity"]}</p>}
                  </div>

                  <div className="field">
                    <label htmlFor="output-destination">Destino</label>
                    <select
                      id="output-destination"
                      value={outputDestination}
                      onChange={(event) =>
                        setOutputDestination(event.target.value as ProductionOutputDestination)
                      }
                    >
                      <option value="NEW_LOT">Novo lote</option>
                      <option
                        value="EXISTING_LOT"
                        disabled={productionOrder.eligibleFinishedLots.length === 0}
                      >
                        Lote existente desta OP
                      </option>
                    </select>
                  </div>

                  {outputDestination === "NEW_LOT" ? (
                    <>
                      <div className="field">
                        <label htmlFor="output-business-lot">
                          Lote Veridi <span className="req">*</span>
                        </label>
                        <input
                          id="output-business-lot"
                          type="text"
                          value={outputBusinessLotNumber}
                          onChange={(event) => setOutputBusinessLotNumber(event.target.value)}
                        />
                        {fieldErrors["businessLotNumber"] && (
                          <p className="field__error">{fieldErrors["businessLotNumber"]}</p>
                        )}
                      </div>
                      {finishedItem.controlsExpiry && (
                        <div className="field">
                          <label htmlFor="output-expiry">
                            Validade <span className="req">*</span>
                          </label>
                          <input
                            id="output-expiry"
                            type="date"
                            value={outputExpiryDate}
                            onChange={(event) => setOutputExpiryDate(event.target.value)}
                          />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor="output-location">Localização</label>
                        <input
                          id="output-location"
                          type="text"
                          value={outputLocation}
                          onChange={(event) => setOutputLocation(event.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="field">
                      <label htmlFor="output-lot">
                        Lote existente <span className="req">*</span>
                      </label>
                      <select
                        id="output-lot"
                        value={outputLotId}
                        onChange={(event) => setOutputLotId(event.target.value)}
                      >
                        <option value="">Selecione…</option>
                        {productionOrder.eligibleFinishedLots.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.code}
                            {lot.businessLotNumber ? ` — ${lot.businessLotNumber}` : ""} (produzido:{" "}
                            {lot.producedQuantity})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="field field--full">
                    <label htmlFor="output-notes">Observações</label>
                    <textarea
                      id="output-notes"
                      rows={2}
                      value={outputNotes}
                      onChange={(event) => setOutputNotes(event.target.value)}
                    />
                  </div>
                </div>

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={
                      registeringOutput ||
                      !outputQuantity.trim() ||
                      (outputDestination === "EXISTING_LOT" && !outputLotId) ||
                      (outputDestination === "NEW_LOT" && !outputBusinessLotNumber.trim())
                    }
                    onClick={handleRegisterOutput}
                  >
                    {registeringOutput ? "Registrando…" : "Registrar produção"}
                  </button>
                </div>
              </>
            )}

            {productionOrder.outputs.length > 0 && (
              <div className="table-container table-container--spaced">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Quantidade</th>
                      <th>Lote interno</th>
                      <th>Lote Veridi</th>
                      <th>Usuário</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionOrder.outputs.map((output) => (
                      <tr key={output.id}>
                        <td>{formatDateTime(output.producedAt)}</td>
                        <td>
                          {output.quantity} {productionOrder.outputUnitCode}
                        </td>
                        <td>{output.lotCode ?? "—"}</td>
                        <td>{output.businessLotNumber ?? "—"}</td>
                        <td>{output.producedBy ?? "—"}</td>
                        <td>{output.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        )}

        {productionOrder?.status === "COMPLETED" && (
          <FormSection title="Conclusão">
            <div className="status-line">
              <span className="badge badge--active">Concluída</span>
              <span className="field__hint">
                {formatDateTime(productionOrder.completedAt)} — {productionOrder.completedBy ?? "—"}
              </span>
            </div>
            {productionOrder.completionReason && (
              <p className="field__hint">Motivo da variação: {productionOrder.completionReason}</p>
            )}
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
            disabled={saving || planning || releasing}
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
              disabled={saving || planning || releasing}
              onClick={handleSaveDraft}
            >
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraft && status !== "CANCELLED" && !isNew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || planning || releasing}
              onClick={handleSaveNotesOnly}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          )}
          {isPlannable && (
            <button type="button" className="btn btn--accent" disabled={saving || planning || releasing} onClick={handlePlan}>
              {planning ? "Planejando…" : "Planejar OP"}
            </button>
          )}
          {isReleasable && (
            <div className="line-actions">
              {hasShortage && <p className="field__hint">Não é possível liberar: falta material.</p>}
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving || planning || releasing || hasShortage}
                onClick={() => setReleaseDialogOpen(true)}
              >
                {releasing ? "Liberando…" : "Liberar OP"}
              </button>
            </div>
          )}
          {status === "IN_PRODUCTION" && (
            <div className="line-actions">
              {(productionOrder?.outputs.length ?? 0) === 0 && (
                <p className="field__hint">Registre ao menos um apontamento de produção para concluir.</p>
              )}
              <button
                type="button"
                className="btn btn--accent"
                disabled={completing || (productionOrder?.outputs.length ?? 0) === 0}
                onClick={() => setCompleteDialogOpen(true)}
              >
                Concluir OP
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={releaseDialogOpen}
        title={`Liberar ${productionOrder?.code} para produção?`}
        message="Os materiais disponíveis serão reservados para esta OP usando a ordem FEFO/FIFO. O estoque físico ainda não será baixado."
        confirmLabel="Liberar OP"
        confirmTone="accent"
        onCancel={() => setReleaseDialogOpen(false)}
        onConfirm={handleRelease}
      />

      {mismatchDialog && (
        <>
          <div className="confirm-overlay" />
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mismatch-title"
          >
            <h2 id="mismatch-title">Lote informado é diferente do esperado</h2>
            <dl className="definition-list">
              <dt>Lote reservado</dt>
              <dd>
                <span className="code">{mismatchDialog.expectedLotCode}</span>
              </dd>
              <dt>Lote informado</dt>
              <dd>
                <span className="code">{mismatchDialog.scannedLotCode}</span>
              </dd>
            </dl>
            <p className="field__hint">
              Usar o lote diferente substitui a reserva original — o histórico é preservado.
            </p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setMismatchDialog(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={substituting}
                onClick={handleUseDifferentLot}
              >
                {substituting ? "Substituindo…" : "Usar lote diferente"}
              </button>
            </div>
          </div>
        </>
      )}

      {completeDialogOpen && productionOrder && (
        <>
          <div className="confirm-overlay" />
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="complete-op-title"
          >
            <h2 id="complete-op-title">Concluir ordem de produção?</h2>
            <p>
              Produzido: {productionOrder.producedQuantity} de {productionOrder.plannedQuantity}{" "}
              {productionOrder.outputUnitCode}. Qualquer reserva de material ainda não consumida será
              liberada. Após concluída, a OP fica somente histórico.
            </p>
            {Number(productionOrder.remainingQuantity) > 0 && (
              <div className="field">
                <label htmlFor="op-completion-reason">
                  Motivo da variação <span className="req">*</span>
                </label>
                <textarea
                  id="op-completion-reason"
                  rows={3}
                  value={completionReason}
                  onChange={(event) => setCompletionReason(event.target.value)}
                />
              </div>
            )}
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setCompleteDialogOpen(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={
                  completing ||
                  (Number(productionOrder.remainingQuantity) > 0 && completionReason.trim().length < 3)
                }
                onClick={handleCompleteOrder}
              >
                {completing ? "Concluindo…" : "Concluir OP"}
              </button>
            </div>
          </div>
        </>
      )}

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
              {status === "RELEASED" && " Os materiais reservados serão liberados automaticamente."}
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
