import { Fragment, useCallback, useEffect, useState } from "react";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ItemDTO,
  ProductDTO,
  ProductionOrderDTO,
  ProductionOrderStatus,
  ProductionOutputDestination,
} from "@veridi/shared";
import type {
  MaterialReservationLineDTO,
  ProductionOrderCostDTO,
  ProductionOrderMaterialCostDTO,
} from "@veridi/shared";
import {
  COST_QUALITY_LABELS,
  COST_SOURCE_LABELS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  REALIZED_COST_STATUS_LABELS,
  PRODUCTION_ORDER_ORIGIN_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import { getProductionOrderMaterialCost } from "../../lib/costs-api";
import { formatBRL } from "../../lib/currency";
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
import { ExtraConsumptionDialog } from "../../components/ExtraConsumptionDialog";
import { listProducts } from "../../lib/products-api";
import { listFormulationVersionsByProduct } from "../../lib/formulations-api";
import { getItem } from "../../lib/items-api";
import { ApiValidationError, LotMismatchApiError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { formatUnitCost } from "../../components/CostBreakdown";
import { getProductionOrderCost } from "../../lib/cost-calculation-api";
import { FlowContext } from "../../components/FlowContext";
import type { FlowStep } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { LotScanner } from "../../components/LotScanner";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";

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
 * Cadeia da OP: de qual pedido ela nasceu e o que ela produziu. Só entram
 * documentos existentes — OP sem pedido de origem (produção para estoque)
 * simplesmente começa na própria OP.
 */
function productionOrderFlowSteps(order: ProductionOrderDTO): FlowStep[] {
  const steps: FlowStep[] = [];

  if (order.customerOrderId && order.customerOrderCode) {
    steps.push({
      kind: "Pedido",
      code: order.customerOrderCode,
      path: `/comercial/pedidos/${order.customerOrderId}`,
    });
  }
  steps.push({ kind: "OP", code: order.code, detail: order.productCode, current: true });

  // Lotes de produto acabado gerados — navegação, não rastreabilidade: a
  // genealogia completa continua na tela do lote.
  const lots = new Map<string, string>();
  for (const output of order.outputs) {
    if (output.lotId && output.lotCode) lots.set(output.lotId, output.lotCode);
  }
  for (const [lotId, lotCode] of lots) {
    steps.push({ kind: "Lote", code: lotCode, path: `/estoque/lotes/${lotId}` });
  }

  return steps;
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
  const [numberOfParts, setNumberOfParts] = useState("1");
  const [labelInstructions, setLabelInstructions] = useState("");
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
  const [extraLineId, setExtraLineId] = useState<string | null>(null);

  const [finishedItem, setFinishedItem] = useState<ItemDTO | null>(null);
  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputDestination, setOutputDestination] = useState<ProductionOutputDestination>("NEW_LOT");
  const [outputLotId, setOutputLotId] = useState("");
  const [outputBusinessLotNumber, setOutputBusinessLotNumber] = useState("");
  const [outputExpiryDate, setOutputExpiryDate] = useState("");
  const [outputLocation, setOutputLocation] = useState("");
  const [outputNotes, setOutputNotes] = useState("");
  const [registeringOutput, setRegisteringOutput] = useState(false);

  const [materialCost, setMaterialCost] = useState<ProductionOrderMaterialCostDTO | null>(null);
  const [industrialCost, setIndustrialCost] = useState<ProductionOrderCostDTO | null>(null);

  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completionReason, setCompletionReason] = useState("");
  const [completing, setCompleting] = useState(false);

  const syncFormFromServer = useCallback((order: ProductionOrderDTO) => {
    setProductId(order.productId);
    setFormulationVersionId(order.formulationVersionId ?? "");
    setPlannedQuantity(order.plannedQuantity);
    setNumberOfParts(String(order.numberOfParts));
    setLabelInstructions(order.labelInstructions ?? "");
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
    // Produto técnico de projeto não é opção operacional.
    listProducts({ active: true, lifecycle: "APPROVED", pageSize: 1000 })
      .then((result) => setActiveProducts(result.products))
      .catch(() => setActiveProducts([]));
  }, []);

  // Custo industrial: materiais realizados + custos padrão aplicados. Depois
  // de concluída a OP, o backend devolve o snapshot congelado — a tela nunca
  // recalcula nem faz aritmética econômica.
  useEffect(() => {
    if (!id || !productionOrder) {
      setIndustrialCost(null);
      return;
    }
    getProductionOrderCost(id)
      .then(setIndustrialCost)
      .catch(() => setIndustrialCost(null));
  }, [id, productionOrder]);

  // Custo material só faz sentido quando já existe consumo real — sempre
  // recalculado ao vivo (informar custo depois melhora o resultado).
  useEffect(() => {
    if (!id || !productionOrder || productionOrder.consumptions.length === 0) {
      setMaterialCost(null);
      return;
    }
    getProductionOrderMaterialCost(id)
      .then(setMaterialCost)
      .catch(() => setMaterialCost(null));
  }, [id, productionOrder]);

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
  // Ordem encerrada não pede material: o que a tela recalcula é o estoque de
  // hoje, e apresentar isso como pendência gera compra indevida.
  const ordemEncerrada = status === "COMPLETED" || status === "CANCELLED";
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

  /* Consumir acima do reservado sempre foi recusado pelo servidor; o botão
     só ficava habilitado até o 400 chegar. Aqui a tela antecipa o limite —
     sem tirar a autoridade do domínio. */
  function excedeReserva(line: MaterialReservationLineDTO): boolean {
    const pedido = (consumeQuantities[line.id] ?? "").trim();
    if (pedido === "") return false;
    const valor = Number(pedido.replace(",", "."));
    if (!Number.isFinite(valor)) return false;
    return valor > Number(line.remainingQuantity);
  }

  /* Quanto ainda cabe apontar nesta ordem. O servidor sempre recusou o
     excesso (`output_exceeds_planned`); o que faltava era a tela dizer o
     limite antes do envio. */
  const restanteParaProduzir = productionOrder
    ? Math.max(Number(productionOrder.plannedQuantity) - Number(productionOrder.producedQuantity), 0)
    : 0;
  const producaoAcimaDoPlanejado = (() => {
    const digitado = outputQuantity.trim();
    if (digitado === "") return false;
    const valor = Number(digitado.replace(",", "."));
    return Number.isFinite(valor) && valor > restanteParaProduzir;
  })();

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
      numberOfParts: Number(numberOfParts) || 1,
      labelInstructions: labelInstructions.trim(),
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
        <div className="table__actions">
          {productionOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/producao/ordens/${productionOrder.id}/imprimir`)}
            >
              Imprimir
            </button>
          )}
          {productionOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/print/producao-picking/${productionOrder.id}`)}
            >
              Folha de separação (FO-04)
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/producao/ordens")}>
            ← Voltar
          </button>
        </div>
      </div>

      {productionOrder && <FlowContext steps={productionOrderFlowSteps(productionOrder)} />}

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {productionOrder && productionOrder.status !== "DRAFT" && productionOrder.status !== "PLANNED" && (
          <FormSection
            title="Execução"
            subtitle={
              productionOrder.numberOfParts > 1
                ? `Produção fracionada em ${productionOrder.numberOfParts} partes — a pesagem real é registrada na Folha de Receita.`
                : "A pesagem real por parte pode ser registrada na Folha de Receita (R.COQ.003)."
            }
          >
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(`/producao/ordens/${productionOrder.id}/receita`)}
              >
                Folha de Receita
              </button>
            </div>
          </FormSection>
        )}

        {productionOrder && (
          <FormSection
            title="Dados para impressão do lote"
            subtitle="Sugestões — o operador confirma ou informa outro valor no apontamento de produção."
          >
            <dl className="definition-list">
              <dt>Lote comercial sugerido</dt>
              <dd>{productionOrder.suggestedBusinessLotNumber ?? "—"}</dd>
              <dt>Vida útil do produto</dt>
              <dd>
                {productionOrder.shelfLifeMonths
                  ? `${productionOrder.shelfLifeMonths} meses`
                  : "—"}
              </dd>
            </dl>
            <div className="field">
              <label htmlFor="op-label-instructions">Observações de rótulo</label>
              {isDraft ? (
                <textarea
                  id="op-label-instructions"
                  rows={2}
                  value={labelInstructions}
                  onChange={(event) => setLabelInstructions(event.target.value)}
                />
              ) : (
                <p className="field-readonly-value">
                  {productionOrder.labelInstructions ?? "—"}
                </p>
              )}
            </div>
          </FormSection>
        )}

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

        {productionOrder && (productionOrder.origin !== "MANUAL" || productionOrder.customerId) && (
          <FormSection
            title="Origem"
            subtitle="Para quem esta ordem produz — o pedido e o cliente abrem direto daqui."
          >
            <dl className="definition-list">
              <dt>Origem</dt>
              <dd>{PRODUCTION_ORDER_ORIGIN_LABELS[productionOrder.origin]}</dd>
              {productionOrder.customerOrderId && (
                <>
                  <dt>Pedido do cliente</dt>
                  <dd>
                    <EntityLink
                      kind="customerOrder"
                      id={productionOrder.customerOrderId}
                      code={productionOrder.customerOrderCode}
                    />
                  </dd>
                </>
              )}
              {productionOrder.customerId && (
                <>
                  <dt>Cliente</dt>
                  <dd>
                    <EntityLink
                      kind="customer"
                      id={productionOrder.customerId}
                      code={productionOrder.customerCode}
                      name={productionOrder.customerName}
                    />
                  </dd>
                </>
              )}
            </dl>
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
                <SearchableEntitySelect
                  id="op-product"
                  value={productId}
                  onChange={(selectedId) => handleProductChange(selectedId)}
                  placeholder="Digite código ou nome do produto…"
                  options={activeProducts.map((product) => ({
                    id: product.id,
                    code: product.code,
                    name: product.name,
                  }))}
                />
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

            <div className="field">
              <label htmlFor="op-parts">Dividir produção em</label>
              {isDraft ? (
                <input
                  id="op-parts"
                  type="number"
                  min={1}
                  max={99}
                  value={numberOfParts}
                  onChange={(event) => setNumberOfParts(event.target.value)}
                />
              ) : (
                <p className="field-readonly-value">{productionOrder?.numberOfParts ?? 1}</p>
              )}
              <p className="field__hint">
                partes. Congela na liberação — a Folha de Receita e a execução dependem disso.
              </p>
            </div>

            <div className="field">
              <label>Número oficial</label>
              <p className="field-readonly-value">
                {productionOrder?.officialNumber ?? "gerado na liberação da OP"}
              </p>
            </div>
          </div>
        </FormSection>

        {productionOrder && (
          <FormSection
            title="Necessidade de Materiais"
            subtitle="Disponibilidade calculada em tempo real a partir do estoque atual — não é uma reserva."
          >
            {/*
              Ordem encerrada com material da formulação que nunca foi
              baixado. O lote de produto acabado já existe e pode ir para
              expedição: a composição real não é a declarada, e isso não
              aparecia em tela nenhuma — só na Folha de Receita impressa,
              que ninguém precisa abrir para expedir.
            */}
            {(() => {
              const encerrada = productionOrder.status === "COMPLETED";
              const naoConsumidos = productionOrder.requirements.filter(
                (requirement) =>
                  Number(requirement.consumedQuantity) === 0 &&
                  Number(requirement.requiredQuantity) > 0,
              );
              if (!encerrada || naoConsumidos.length === 0) return null;
              return (
                <p className="form-alert" role="status">
                  Esta ordem foi concluída sem consumo registrado de{" "}
                  {naoConsumidos.length}{" "}
                  {naoConsumidos.length === 1 ? "material" : "materiais"} da formulação:{" "}
                  {naoConsumidos.map((requirement) => requirement.itemCode).join(", ")}. O lote
                  produzido não tem, no sistema, a composição que a formulação declara — confira
                  antes de liberar para expedição.
                </p>
              );
            })()}

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Fornecimento</th>
                    <th className="is-numeric">Necessário</th>
                    <th className="is-numeric">Físico</th>
                    <th className="is-numeric">Reservado</th>
                    <th className="is-numeric">Disponível</th>
                    <th className="is-numeric">Em Compra</th>
                    <th className="is-numeric">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {productionOrder.requirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td>
                        <EntityLink kind="item" id={requirement.itemId} code={requirement.itemCode} name={requirement.itemName} />
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
                        {SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}
                        {requirement.supplyResponsibility === "CUSTOMER" && (
                          <>
                            <br />
                            <span className="field__hint">
                              {requirement.eligibleOwnerCustomerName ?? "Cliente não definido"}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="is-numeric">
                        {requirement.requiredQuantity} {requirement.stockUnitCode}
                      </td>
                      <td className="is-numeric">{requirement.onHand}</td>
                      <td className="is-numeric">{requirement.reserved}</td>
                      <td className="is-numeric">{requirement.available}</td>
                      <td className="is-numeric">{requirement.onOrder}</td>
                      <td className="is-numeric">
                        {/* OP encerrada: a falta é recálculo contra o estoque
                            de HOJE, não pendência da ordem. Mostrar como
                            alerta acionável já mandou gente abrir compra de
                            material que a ordem consumiu semanas atrás. */}
                        <span
                          className={
                            ordemEncerrada
                              ? "badge badge--neutral"
                              : requirement.availabilityStatus === "AVAILABLE"
                                ? "badge badge--active"
                                : "badge badge--warn"
                          }
                        >
                          {requirement.shortage}
                        </span>
                        {ordemEncerrada && Number(requirement.shortage) > 0 && (
                          <>
                            <br />
                            <span className="field__hint">
                              Referência histórica — a ordem já foi encerrada.
                            </span>
                          </>
                        )}
                        {/*
                          Falta com material já no galpão.

                          `onHand` conta o físico inteiro; `available` só conta
                          lote liberado. Quando a diferença explica a falta, a
                          causa não é compra — é uma decisão de Qualidade
                          pendente, e a tela dizia só "falta 35" enquanto o
                          material estava na prateleira.
                        */}
                        {!ordemEncerrada &&
                          Number(requirement.shortage) > 0 &&
                          Number(requirement.onHand) -
                            Number(requirement.reserved) -
                            Number(requirement.available) >
                            0 && (
                            <>
                              <br />
                              <span className="field__hint">
                                Há{" "}
                                {(
                                  Number(requirement.onHand) -
                                  Number(requirement.reserved) -
                                  Number(requirement.available)
                                ).toLocaleString("pt-BR")}{" "}
                                {requirement.stockUnitCode} em estoque físico ainda não liberado
                                pela Qualidade.{" "}
                                <Link to={`/estoque/${requirement.itemId}`}>Ver lotes do item</Link>
                              </span>
                            </>
                          )}
                        {!ordemEncerrada &&
                          requirement.supplyResponsibility === "CUSTOMER" &&
                          Number(requirement.shortage) > 0 && (
                            <>
                              <br />
                              {/* Material do cliente não se compra: o CTA de
                                  compra aqui seria conselho errado. */}
                              <span className="field__hint">Aguardando material do cliente</span>
                            </>
                          )}
                        {!ordemEncerrada &&
                          requirement.supplyResponsibility !== "CUSTOMER" &&
                          Number(requirement.shortage) > 0 && (
                            <>
                              <br />
                              {/* A tela mostra o que falta; sem este caminho o
                                  usuário tinha que reconstruir de memória onde
                                  fica a sugestão de compra. Só navega — quem
                                  decide comprar continua sendo a pessoa. */}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() =>
                                  navigate(
                                    productionOrder.customerOrderId
                                      ? `/comercial/pedidos/${productionOrder.customerOrderId}`
                                      : // Leva o item e o que falta: o atalho tem
                                        // que chegar com o contexto que a tela
                                        // acabou de calcular.
                                        `/compras/ordens/nova?itemId=${requirement.itemId}&quantidade=${requirement.shortage}`,
                                  )
                                }
                              >
                                {productionOrder.customerOrderId
                                  ? "Ver sugestão de compra"
                                  : "Ir para compras"}
                              </button>
                            </>
                          )}
                      </td>
                    </tr>
                  ))}

                  {productionOrder.requirements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="table__empty">
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
                : // Reserva também é liberada ao concluir a OP; dizer "cancelada"
                  // numa OP concluída é informação errada no histórico.
                  `Reserva liberada (${
                    productionOrder.status === "CANCELLED" ? "OP cancelada" : "OP concluída"
                  }) — mantida como histórico, não conta mais em Reservado.`
            }
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th className="is-numeric">Quantidade reservada</th>
                    <th>Localização</th>
                  </tr>
                </thead>
                <tbody>
                  {productionOrder.reservation.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <EntityLink kind="item" id={line.itemId} code={line.itemCode} name={line.itemName} />
                        {/* A ampliação já era gravada com motivo, autor e
                            data; faltava alguém conseguir vê-la. Só aparece
                            na linha que é de fato extra. */}
                        {line.extraReason && (
                          <div className="line-audit">
                            <span className="badge badge--info">Consumo extra</span>
                            <div className="field__hint">
                              +{line.quantity} {line.unitCode} · {line.extraReason}
                            </div>
                            <div className="field__hint">
                              {line.extraRequestedBy ?? "—"}
                              {line.extraRequestedAt ? ` · ${formatDateTime(line.extraRequestedAt)}` : ""}
                            </div>
                          </div>
                        )}
                      </td>
                      <td>{line.lotCode ?? "—"}</td>
                      <td>
                        {formatDate(line.expiryDate)}
                      </td>
                      <td className="is-numeric">
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
                    <th className="is-numeric">Reservado</th>
                    <th>Status</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {activeReservationLines.map((line) => (
                    <Fragment key={line.id}>
                      <tr>
                        <td>
                          <EntityLink kind="item" id={line.itemId} code={line.itemCode} name={line.itemName} />
                          {line.replacesLineId && (
                            <>
                              <br />
                              <span className="field__hint">Lote substituído no Picking</span>
                            </>
                          )}
                          {line.extraReason && (
                            <>
                              <br />
                              <span className="badge badge--info">Consumo extra</span>
                            </>
                          )}
                        </td>
                        <td>{line.lotId ? line.lotCode : "— (sem controle de lote)"}</td>
                        <td>
                          {formatDate(line.expiryDate)}
                        </td>
                        <td>{line.location ?? "—"}</td>
                        <td className="is-numeric">
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
                          {/* Conferência é registro de rastreabilidade: quem
                              conferiu e quando aparecem junto do status. */}
                          {line.pickingStatus === "CONFIRMED" && line.pickedBy && (
                            <div className="field__hint">
                              {line.pickedBy}
                              {line.pickedAt
                                ? ` · ${new Date(line.pickedAt).toLocaleString("pt-BR")}`
                                : ""}
                            </div>
                          )}
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
                    <th className="is-numeric">Reservado</th>
                    <th className="is-numeric">Consumido</th>
                    <th>Restante</th>
                    <th>Consumir agora</th>
                    <th aria-hidden="true" />
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {activeReservationLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <EntityLink kind="item" id={line.itemId} code={line.itemCode} name={line.itemName} />
                        {/* A ampliação já era gravada com motivo, autor e data;
                            faltava alguém conseguir vê-la. Só aparece na linha
                            que é de fato extra. */}
                        {line.extraReason && (
                          <div className="line-audit">
                            <span className="badge badge--info">Consumo extra</span>
                            <div className="field__hint">
                              +{line.quantity} {line.unitCode} · {line.extraReason}
                            </div>
                            <div className="field__hint">
                              {line.extraRequestedBy ?? "—"}
                              {line.extraRequestedAt ? ` · ${formatDateTime(line.extraRequestedAt)}` : ""}
                            </div>
                          </div>
                        )}
                      </td>
                      <td>{line.lotCode ?? "—"}</td>
                      <td className="is-numeric">
                        {line.quantity} {line.unitCode}
                      </td>
                      <td className="is-numeric">{line.consumedQuantity}</td>
                      <td>{line.remainingQuantity}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          className={excedeReserva(line) ? "is-invalid" : undefined}
                          disabled={line.pickingStatus !== "CONFIRMED" || Number(line.remainingQuantity) <= 0}
                          value={consumeQuantities[line.id] ?? ""}
                          onChange={(event) =>
                            setConsumeQuantities((prev) => ({ ...prev, [line.id]: event.target.value }))
                          }
                        />
                        {/* O servidor continua sendo a autoridade — isto só
                            diz o limite antes do envio, em vez de deixar o
                            operador descobrir pelo erro. */}
                        {excedeReserva(line) && (
                          <p className="field__hint field__hint--error">
                            Máximo disponível nesta reserva: {line.remainingQuantity} {line.unitCode}. Para
                            consumir acima disso, use “Adicionar consumo extra”.
                          </p>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--accent btn--sm"
                          disabled={
                            line.pickingStatus !== "CONFIRMED" ||
                            Number(line.remainingQuantity) <= 0 ||
                            !(consumeQuantities[line.id] ?? "").trim() ||
                            excedeReserva(line) ||
                            consumingLineId === line.id
                          }
                          onClick={() => handleConsumeNow(line.id)}
                        >
                          {consumingLineId === line.id ? "Confirmando…" : "Confirmar consumo"}
                        </button>
                      </td>
                      <td>
                        {/* Precisou de mais material do que o reservado? O
                            limite do consumo continua de pé; o que muda é
                            existir um caminho legítimo para ampliá-lo. */}
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={line.pickingStatus !== "CONFIRMED"}
                          onClick={() => setExtraLineId(line.id)}
                        >
                          Adicionar consumo extra
                        </button>
                      </td>
                    </tr>
                  ))}

                  {activeReservationLines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="table__empty">
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
                      <th className="is-numeric">Quantidade</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionOrder.consumptions.map((consumption) => (
                      <tr key={consumption.id}>
                        <td>{formatDateTime(consumption.consumedAt)}</td>
                        <td>
                          <EntityLink kind="item" id={consumption.itemId} code={consumption.itemCode} name={consumption.itemName} />
                        </td>
                        <td>{consumption.lotCode ?? "—"}</td>
                        <td className="is-numeric">
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
                      aria-invalid={producaoAcimaDoPlanejado || undefined}
                      className={producaoAcimaDoPlanejado ? "is-invalid" : undefined}
                      value={outputQuantity}
                      onChange={(event) => setOutputQuantity(event.target.value)}
                    />
                    {/* A regra sempre existiu no servidor; a tela deixava
                        o botão aceso e o operador descobria no envio. */}
                    {producaoAcimaDoPlanejado && (
                      <p className="field__error">
                        Máximo {restanteParaProduzir} {productionOrder.outputUnitCode} — produzido
                        nunca ultrapassa o planejado desta ordem.
                      </p>
                    )}
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
                      producaoAcimaDoPlanejado ||
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
                      <th className="is-numeric">Quantidade</th>
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
                        <td className="is-numeric">
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

        {industrialCost && (
          <FormSection
            title="Custo industrial"
            subtitle={
              industrialCost.hybrid
                ? "Híbrido: materiais realizados + custos industriais padrão aplicados. Horas de operador, de máquina e energia não são medidas — vêm da estrutura de custos."
                : "Materiais realizados. Os custos industriais adicionais dependem de uma estrutura de custos vinculada."
            }
          >
            <div className="doc-title">
              <span
                className={
                  industrialCost.quality === "COMPLETE_REAL_REFERENCE"
                    ? "badge badge--active"
                    : industrialCost.quality === "COMPLETE_WITH_ESTIMATES"
                      ? "badge badge--neutral"
                      : "badge badge--warn"
                }
              >
                {INDUSTRIAL_COST_QUALITY_LABELS[industrialCost.quality]}
              </span>
              <span
                className={
                  industrialCost.status === "FINAL" ? "badge badge--active" : "badge badge--warn"
                }
              >
                {REALIZED_COST_STATUS_LABELS[industrialCost.status]}
              </span>
              {industrialCost.hybrid && (
                <span className="badge badge--neutral">
                  Híbrido: materiais reais + recursos padrão
                </span>
              )}
            </div>

            <dl className="definition-list">
              <dt>Estrutura de custos</dt>
              <dd>{industrialCost.industrialCostVersionLabel ?? "—"}</dd>
              <dt>Formulação</dt>
              <dd>
                {industrialCost.formulationVersionNumber
                  ? `V${industrialCost.formulationVersionNumber}`
                  : "—"}
              </dd>
              <dt>Produzido</dt>
              <dd>
                {industrialCost.producedQuantity} {industrialCost.outputUnitCode}
              </dd>
              <dt>Materiais realizados</dt>
              <dd>{formatBRL(industrialCost.actualMaterialCostKnown)}</dd>
              <dt>Custos padrão aplicados</dt>
              <dd>{formatBRL(industrialCost.standardAppliedCostKnown)}</dd>
              {industrialCost.totalIndustrialCost === null ? (
                <>
                  <dt>Subtotal conhecido</dt>
                  <dd>
                    {formatBRL(industrialCost.knownSubtotal)}
                    <span className="field__hint"> Existem custos não informados.</span>
                  </dd>
                </>
              ) : (
                <>
                  <dt>Custo industrial da produção</dt>
                  <dd>{formatBRL(industrialCost.totalIndustrialCost)}</dd>
                </>
              )}
              <dt>Custo por unidade produzida</dt>
              <dd>{formatUnitCost(industrialCost.costPerProducedUnit)}</dd>
            </dl>

            {industrialCost.warnings.length > 0 && (
              <ul className="candidate-list">
                {industrialCost.warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`} className="field__hint">
                    {warning.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => navigate(`/print/custo-producao/${industrialCost.productionOrderId}`)}
              >
                Imprimir custo / Salvar PDF
              </button>
            </div>
          </FormSection>
        )}

        {materialCost && (
          <FormSection
            title={
              materialCost.hasCustomerSuppliedMaterials
                ? "Custo de materiais Veridi"
                : "Custo de materiais"
            }
            subtitle={
              status === "COMPLETED"
                ? "Custo material encerrado desta OP, a partir do que foi realmente consumido."
                : "Custo material atual — a OP ainda está em produção, o valor pode mudar."
            }
          >
            {materialCost.hasCustomerSuppliedMaterials && (
              <p className="field__hint">
                Contém materiais fornecidos pelo cliente ({materialCost.customerSuppliedConsumptionCount}
                {materialCost.customerSuppliedConsumptionCount === 1 ? " componente" : " componentes"}).
                Esses materiais não têm custo de aquisição da Veridi e ficam fora deste total.
              </p>
            )}

            <dl className="definition-list">
              <dt>Materiais consumidos</dt>
              <dd>
                {materialCost.totalMaterialCost
                  ? formatBRL(materialCost.totalMaterialCost)
                  : "Indisponível"}
              </dd>
              <dt>Produzido</dt>
              <dd>
                {materialCost.producedQuantity} {materialCost.outputUnitCode}
              </dd>
              <dt>Custo material / unidade</dt>
              <dd>
                {materialCost.materialUnitCost ? formatBRL(materialCost.materialUnitCost) : "Indisponível"}
              </dd>
              <dt>Qualidade</dt>
              <dd>
                <span
                  className={
                    materialCost.quality === "REAL"
                      ? "badge badge--active"
                      : materialCost.quality === "ESTIMATED"
                        ? "badge badge--neutral"
                        : "badge badge--warn"
                  }
                >
                  {COST_QUALITY_LABELS[materialCost.quality]}
                </span>
              </dd>
            </dl>

            {materialCost.quality === "PARTIAL" && (
              <p className="field__hint">
                Custo parcial: existem materiais consumidos sem referência de custo (
                {materialCost.missingCostItems.join(", ")}). O subtotal conhecido (
                {formatBRL(materialCost.knownMaterialCostSubtotal)}) não representa o custo total.{" "}
                {/* O custo do material vem do preço de fornecedor do item —
                    apontar o caminho evita que a pessoa aceite o parcial por
                    não saber onde ele se resolve. */}
                <Link to="/compras/item-fornecedor">
                  Definir preço de fornecedor para esses itens
                </Link>
                .
              </p>
            )}

            <div className="table-container table-container--spaced">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th className="is-numeric">Consumido</th>
                    <th className="is-numeric">Custo unitário</th>
                    <th>Origem</th>
                    <th className="is-numeric">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {materialCost.consumptions.map((consumption) => (
                    <tr key={consumption.consumptionId}>
                      <td>
                        <EntityLink kind="item" id={consumption.itemId} code={consumption.itemCode} name={consumption.itemName} />
                      </td>
                      <td>{consumption.lotCode ?? "—"}</td>
                      <td className="is-numeric">
                        {consumption.quantity} {consumption.unitCode}
                      </td>
                      <td className="is-numeric">{formatBRL(consumption.unitCost)}</td>
                      <td>
                        <span
                          className={
                            consumption.costSource === "REAL"
                              ? "badge badge--active"
                              : consumption.costSource === "NO_COST"
                                ? "badge badge--warn"
                                : "badge badge--neutral"
                          }
                        >
                          {COST_SOURCE_LABELS[consumption.costSource]}
                        </span>
                      </td>
                      <td className="is-numeric">{formatBRL(consumption.materialCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {extraLineId && productionOrder && (
        <ExtraConsumptionDialog
          productionOrderId={productionOrder.id}
          line={activeReservationLines.find((line) => line.id === extraLineId)!}
          onClose={() => setExtraLineId(null)}
          onAdded={(atualizada) => {
            setExtraLineId(null);
            setProductionOrder(atualizada);
          }}
        />
      )}

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
          <ModalDialog labelledBy="mismatch-title" onClose={() => setMismatchDialog(null)}>
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
          </ModalDialog>
        </>
      )}

      {completeDialogOpen && productionOrder && (
        <>
          <ModalDialog labelledBy="complete-op-title" onClose={() => setCompleteDialogOpen(false)}>
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
          </ModalDialog>
        </>
      )}

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-op-title" onClose={() => setCancelDialogOpen(false)}>
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
          </ModalDialog>
        </>
      )}
    </>
  );
}
