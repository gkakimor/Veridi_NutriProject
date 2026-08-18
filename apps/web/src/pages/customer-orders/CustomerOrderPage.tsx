import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type {
  CustomerDTO,
  CustomerOrderDTO,
  CustomerOrderStatus,
  FulfillmentPlanDTO,
  ProductDTO,
  PurchaseSuggestionDTO,
  ReservationStatusDTO,
  ShipmentStatus,
  SupplierDTO,
} from "@veridi/shared";
import {
  BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import {
  applyFulfillmentPlan,
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  generatePurchaseDrafts,
  getCustomerOrder,
  getFulfillmentPlan,
  getPurchaseSuggestion,
  updateCustomerOrder,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import {
  createShipmentDraft,
  getReservationStatus,
  reallocateReservationLine,
  reserveAvailable,
} from "../../lib/shipments-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { FlowContext } from "../../components/FlowContext";
import type { FlowStep } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";

interface LineRow {
  key: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  orderedQuantity: string;
}

function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "IN_FULFILLMENT":
    case "PARTIALLY_SHIPPED":
      return "badge badge--warn";
    case "SHIPPED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function toIsoOrEmpty(dateInputValue: string): string {
  if (!dateInputValue) return "";
  return new Date(dateInputValue).toISOString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function lineFromDTO(line: CustomerOrderDTO["lines"][number]): LineRow {
  return {
    key: nextRowKey(),
    productId: line.productId,
    productCode: line.productCode,
    productName: line.productName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity,
  };
}

function situationLabel(situation: string): string {
  switch (situation) {
    case "ESTOQUE_SUFICIENTE":
      return "Estoque suficiente";
    case "REQUER_PRODUCAO":
      return "Requer produção";
    case "SEM_FORMULACAO_ATIVA":
      return "Sem formulação ativa";
    default:
      return situation;
  }
}

/**
 * Cadeia operacional do pedido. Só aparecem documentos que existem: sem
 * expedição, o pedido não mostra "expedição pendente" como se fosse um
 * documento — a pendência é assunto do status, não do fluxo.
 */
function orderFlowSteps(order: CustomerOrderDTO): FlowStep[] {
  const steps: FlowStep[] = [
    { kind: "Pedido", code: order.code, detail: order.customerName, current: true },
  ];

  for (const productionOrder of order.generatedProductionOrders) {
    steps.push({
      kind: "OP",
      code: productionOrder.code,
      path: `/producao/ordens/${productionOrder.id}`,
    });
  }
  for (const shipment of order.shipments) {
    steps.push({
      kind: "Expedição",
      code: shipment.code,
      path: `/comercial/expedicoes/${shipment.id}`,
    });
  }
  for (const billing of order.billings) {
    steps.push({
      kind: "Faturamento",
      code: billing.code,
      path: `/comercial/faturamento/${billing.id}`,
    });
  }

  return steps;
}

/**
 * Documento transacional — página própria dentro do workspace, não
 * FullWorkspaceModal. Atende `/comercial/pedidos/novo` (sem :id) e
 * `/comercial/pedidos/:id`.
 */
export function CustomerOrderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [customerOrder, setCustomerOrder] = useState<CustomerOrderDTO | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);

  const [activeCustomers, setActiveCustomers] = useState<CustomerDTO[]>([]);
  const [activeProducts, setActiveProducts] = useState<ProductDTO[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [plan, setPlan] = useState<FulfillmentPlanDTO | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planAdjustments, setPlanAdjustments] = useState<Record<string, { reserve: string; produce: string }>>({});
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const [suggestion, setSuggestion] = useState<PurchaseSuggestionDTO | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierDTO[]>([]);
  const [draftInputs, setDraftInputs] = useState<Record<string, { quantity: string; supplierId: string }>>({});
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [reservationStatus, setReservationStatus] = useState<ReservationStatusDTO | null>(null);
  const [reserveInputs, setReserveInputs] = useState<Record<string, string>>({});
  const [reserving, setReserving] = useState(false);
  const [reallocatingLineId, setReallocatingLineId] = useState<string | null>(null);
  const [preparingShipment, setPreparingShipment] = useState(false);

  const syncFormFromServer = useCallback((order: CustomerOrderDTO) => {
    setCustomerId(order.customerId);
    setRequestedDeliveryDate(toDateInputValue(order.requestedDeliveryDate));
    setNotes(order.notes ?? "");
    setLines(order.lines.map(lineFromDTO));
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    setNotFound(false);
    getCustomerOrder(id)
      .then((order) => {
        setCustomerOrder(order);
        syncFormFromServer(order);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, isNew, syncFormFromServer]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
    // Produto técnico de projeto não é opção operacional.
    listProducts({ active: true, lifecycle: "APPROVED", pageSize: 1000 })
      .then((result) => setActiveProducts(result.products))
      .catch(() => setActiveProducts([]));
  }, []);

  const status: CustomerOrderStatus = customerOrder?.status ?? "DRAFT";
  const isDraft = isNew || status === "DRAFT";
  const isCancellable = !isNew && (status === "DRAFT" || status === "CONFIRMED");
  const isConfirmable = !isNew && status === "DRAFT" && lines.length > 0;
  const showPlan = !isNew && status === "CONFIRMED";
  const showPurchaseSuggestion = !isNew && status === "IN_FULFILLMENT";
  /** Reserva complementar/expedição continuam disponíveis até o pedido ser totalmente expedido. */
  const isOperational = !isNew && (status === "IN_FULFILLMENT" || status === "PARTIALLY_SHIPPED");
  const hasFulfillmentResult =
    !!customerOrder && (customerOrder.reservation !== null || customerOrder.generatedProductionOrders.length > 0);

  useEffect(() => {
    if (!showPlan || !id) {
      setPlan(null);
      return;
    }
    setPlanLoading(true);
    getFulfillmentPlan(id)
      .then((result) => {
        setPlan(result);
        const initial: Record<string, { reserve: string; produce: string }> = {};
        for (const line of result.lines) {
          initial[line.customerOrderLineId] = {
            reserve: line.suggestedReserveQuantity,
            produce: line.suggestedProductionQuantity,
          };
        }
        setPlanAdjustments(initial);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Falha ao carregar plano de atendimento"))
      .finally(() => setPlanLoading(false));
  }, [showPlan, id]);

  const reloadSuggestion = useCallback(() => {
    if (!id) return;
    setSuggestionLoading(true);
    getPurchaseSuggestion(id)
      .then((result) => {
        setSuggestion(result);
        setDraftInputs((prev) => {
          const next: Record<string, { quantity: string; supplierId: string }> = {};
          for (const row of result.rows) {
            // Pre-seleciona SO o fornecedor recomendado (preferencial ou
            // unico homologado). Com varios homologados e nenhum
            // preferencial nada e escolhido: a decisao e do usuario.
            const recommended = row.supplierCandidates.find(
              (candidate) => candidate.supplierItemId === row.recommendedSupplierItemId,
            );
            next[row.itemId] = prev[row.itemId] ?? {
              quantity: recommended?.recommendedPurchaseQuantity ?? row.newSuggestedPurchase,
              supplierId: recommended?.supplierId ?? "",
            };
          }
          return next;
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Falha ao carregar sugestão de compra"))
      .finally(() => setSuggestionLoading(false));
  }, [id]);

  useEffect(() => {
    if (!showPurchaseSuggestion || !id) {
      setSuggestion(null);
      return;
    }
    reloadSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPurchaseSuggestion, id]);

  useEffect(() => {
    if (!showPurchaseSuggestion) return;
    listSuppliers({ active: true, pageSize: 1000 })
      .then((result) => setActiveSuppliers(result.suppliers))
      .catch(() => setActiveSuppliers([]));
  }, [showPurchaseSuggestion]);

  const reloadReservationStatus = useCallback(() => {
    if (!id) return;
    getReservationStatus(id)
      .then((result) => {
        setReservationStatus(result);
        setReserveInputs((prev) => {
          const next: Record<string, string> = {};
          for (const line of result.lines) {
            next[line.customerOrderLineId] =
              prev[line.customerOrderLineId] ?? line.suggestedAdditionalReserve;
          }
          return next;
        });
      })
      .catch(() => setReservationStatus(null));
  }, [id]);

  useEffect(() => {
    if (!isOperational || !id) {
      setReservationStatus(null);
      return;
    }
    reloadReservationStatus();
  }, [isOperational, id, reloadReservationStatus]);

  const customerOptions: CustomerDTO[] = useMemo(() => {
    if (!customerOrder || activeCustomers.some((c) => c.id === customerOrder.customerId)) {
      return activeCustomers;
    }
    return [
      ...activeCustomers,
      {
        id: customerOrder.customerId,
        code: customerOrder.customerCode ?? "",
        legalName: customerOrder.customerName ?? "",
        tradeName: customerOrder.customerTradeName,
        cnpj: customerOrder.customerCnpj,
        email: null,
        phone: null,
        // Opção sintética para o select: o Pedido confirmado já tem o
        // snapshot próprio, o endereço não é lido daqui.
        street: null,
        number: null,
        complement: null,
        district: null,
        zipCode: null,
        city: customerOrder.customerAddress.city,
        state: customerOrder.customerAddress.state,
        notes: null,
        businessLotSuffix: null,
        active: false,
        createdAt: "",
        updatedAt: "",
      },
    ];
  }, [activeCustomers, customerOrder]);

  function optionsForRow(row: LineRow): ProductDTO[] {
    const usedByOtherRows = new Set(lines.filter((l) => l.key !== row.key).map((l) => l.productId));
    const base = activeProducts.filter((product) => !usedByOtherRows.has(product.id) && product.finishedProductItem);
    if (row.productId && !base.some((product) => product.id === row.productId)) {
      const known = activeProducts.find((product) => product.id === row.productId);
      if (known) return [...base, known];
    }
    return base;
  }

  function handleAddLine() {
    setLines((prev) => [
      ...prev,
      { key: nextRowKey(), productId: "", productCode: "", productName: "", unitCode: "", orderedQuantity: "" },
    ]);
  }

  function handleRemoveLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function handleLineProductChange(key: string, productId: string) {
    const product = activeProducts.find((option) => option.id === productId);
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              productId,
              productCode: product?.code ?? "",
              productName: product?.name ?? "",
              // A unidade e sempre derivada do Finished Product Item no backend —
              // so fica conhecida apos salvar (ProductDTO nao expoe unitCode aqui).
              unitCode: "",
            }
          : line,
      ),
    );
  }

  function handleLineQuantityChange(key: string, value: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, orderedQuantity: value } : line)));
  }

  async function handleSaveDraft() {
    if (!customerId) {
      setError("Selecione um cliente.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const linesPayload = lines
      .filter((line) => line.productId)
      .map((line) => ({ productId: line.productId, orderedQuantity: line.orderedQuantity.trim() }));

    const requestedIso = toIsoOrEmpty(requestedDeliveryDate);

    const payload = {
      customerId,
      notes: notes.trim(),
      lines: linesPayload,
      ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
    };

    try {
      if (isNew) {
        const created = await createCustomerOrder(payload);
        navigate(`/comercial/pedidos/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await updateCustomerOrder(id, payload);
        setCustomerOrder(updated);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar pedido");
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
      const requestedIso = toIsoOrEmpty(requestedDeliveryDate);
      const updated = await updateCustomerOrder(id, {
        notes: notes.trim(),
        ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
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
      const updated = await confirmCustomerOrder(id);
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar pedido");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelConfirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await cancelCustomerOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar pedido");
    } finally {
      setSaving(false);
    }
  }

  function handleAdjustReserve(lineId: string, ordered: string, reserve: string) {
    const orderedNum = Number(ordered);
    const reserveNum = Number(reserve);
    const produce = Number.isNaN(reserveNum) ? "" : Math.max(orderedNum - reserveNum, 0).toString();
    setPlanAdjustments((prev) => ({ ...prev, [lineId]: { reserve, produce } }));
  }

  function handleAdjustProduce(lineId: string, ordered: string, produce: string) {
    const orderedNum = Number(ordered);
    const produceNum = Number(produce);
    const reserve = Number.isNaN(produceNum) ? "" : Math.max(orderedNum - produceNum, 0).toString();
    setPlanAdjustments((prev) => ({ ...prev, [lineId]: { reserve, produce } }));
  }

  const planCoversEverything = useMemo(() => {
    if (!plan) return false;
    return plan.lines.every((line) => {
      const adjustment = planAdjustments[line.customerOrderLineId];
      if (!adjustment) return false;
      const sum = Number(adjustment.reserve || "0") + Number(adjustment.produce || "0");
      return Math.abs(sum - Number(line.orderedQuantity)) < 1e-6;
    });
  }, [plan, planAdjustments]);

  async function handleApplyPlan() {
    if (!id || !plan) return;
    setApplyDialogOpen(false);
    setApplying(true);
    setError(null);
    try {
      const updated = await applyFulfillmentPlan(id, {
        lines: plan.lines.map((line) => {
          const adjustment = planAdjustments[line.customerOrderLineId]!;
          return {
            customerOrderLineId: line.customerOrderLineId,
            reserveQuantity: adjustment.reserve || "0",
            produceQuantity: adjustment.produce || "0",
          };
        }),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aplicar plano de atendimento");
    } finally {
      setApplying(false);
    }
  }

  const draftLinesToGenerate = useMemo(() => {
    return Object.entries(draftInputs)
      .filter(([, value]) => Number(value.quantity || "0") > 0)
      .map(([itemId, value]) => ({ itemId, quantity: value.quantity, supplierId: value.supplierId }));
  }, [draftInputs]);

  const draftLinesMissingSupplier = draftLinesToGenerate.some((line) => !line.supplierId);
  const noAdditionalPurchaseSuggested =
    !!suggestion && suggestion.rows.every((row) => Number(row.newSuggestedPurchase) === 0);

  function handleDraftQuantityChange(itemId: string, quantity: string) {
    setDraftInputs((prev) => ({ ...prev, [itemId]: { quantity, supplierId: prev[itemId]?.supplierId ?? "" } }));
  }

  function handleDraftSupplierChange(itemId: string, supplierId: string) {
    // Trocar de fornecedor troca as condicoes comerciais: a quantidade
    // recomendada acompanha o MOQ daquele fornecedor (quando comparavel).
    const candidate = suggestion?.rows
      .find((row) => row.itemId === itemId)
      ?.supplierCandidates.find((option) => option.supplierId === supplierId);

    setDraftInputs((prev) => ({
      ...prev,
      [itemId]: {
        quantity: candidate?.recommendedPurchaseQuantity ?? prev[itemId]?.quantity ?? "0",
        supplierId,
      },
    }));
  }

  async function handleGenerateDrafts() {
    if (!id) return;
    setGenerateDialogOpen(false);
    setGenerating(true);
    setError(null);
    try {
      const updated = await generatePurchaseDrafts(id, { lines: draftLinesToGenerate });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      reloadSuggestion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar Ordens de Compra");
    } finally {
      setGenerating(false);
    }
  }

  async function handleReserveAvailable() {
    if (!id || !reservationStatus) return;
    const lines = reservationStatus.lines
      .map((line) => ({
        customerOrderLineId: line.customerOrderLineId,
        quantity: (reserveInputs[line.customerOrderLineId] ?? "0").trim() || "0",
      }))
      .filter((line) => Number(line.quantity) > 0);
    if (lines.length === 0) return;

    setReserving(true);
    setError(null);
    try {
      const updated = await reserveAvailable(id, { lines });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setReserveInputs({});
      reloadReservationStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reservar produto acabado");
    } finally {
      setReserving(false);
    }
  }

  async function handleReallocate(reservationLineId: string) {
    if (!id) return;
    setReallocatingLineId(reservationLineId);
    setError(null);
    try {
      const updated = await reallocateReservationLine(id, {
        customerOrderReservationLineId: reservationLineId,
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      reloadReservationStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao realocar reserva");
    } finally {
      setReallocatingLineId(null);
    }
  }

  async function handlePrepareShipment() {
    if (!id) return;
    setPreparingShipment(true);
    setError(null);
    try {
      const shipment = await createShipmentDraft(id);
      navigate(`/comercial/expedicoes/${shipment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar expedição");
    } finally {
      setPreparingShipment(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedido do Cliente</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isNew && notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedido não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/pedidos")}>
            ← Voltar para Pedidos
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Comercial / Pedidos / {isNew ? "Novo" : "Editar"}</div>
          <div className="doc-title">
            <h1>{isNew ? "Novo pedido" : customerOrder?.code}</h1>
            {customerOrder && (
              <span className={statusBadgeClass(status)}>{CUSTOMER_ORDER_STATUS_LABELS[status]}</span>
            )}
          </div>
        </div>
        <div className="table__actions">
          {customerOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/comercial/pedidos/${customerOrder.id}/imprimir`)}
            >
              Imprimir
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/pedidos")}>
            ← Voltar
          </button>
        </div>
      </div>

      {customerOrder && <FlowContext steps={orderFlowSteps(customerOrder)} />}

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {customerOrder?.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelado</span>
              <span className="field__hint">
                {formatDateTime(customerOrder.cancelledAt)} — {customerOrder.cancelledBy ?? "—"}
              </span>
            </div>
            {customerOrder.cancelReason && <p className="field__hint">Motivo: {customerOrder.cancelReason}</p>}
          </FormSection>
        )}

        <FormSection
          title="Cliente e datas"
          subtitle={
            isDraft
              ? "Enquanto rascunho, cliente e datas podem ser alterados livremente."
              : "Após confirmado, cliente e produtos ficam congelados."
          }
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="co-customer">
                Cliente <span className="req">*</span>
              </label>
              {isDraft ? (
                <SearchableEntitySelect
                  id="co-customer"
                  value={customerId}
                  onChange={(selectedId) => setCustomerId(selectedId)}
                  placeholder="Digite código ou nome do cliente…"
                  options={customerOptions.map((customer) => ({
                    id: customer.id,
                    code: customer.code,
                    name: customer.tradeName ?? customer.legalName,
                    ...(customer.active ? {} : { hint: "inativo" }),
                  }))}
                />
              ) : (
                <p className="field-readonly-value">
                  {customerOrder?.customerCode} — {customerOrder?.customerName}
                </p>
              )}
              {fieldErrors["customerId"] && <p className="field__error">{fieldErrors["customerId"]}</p>}
            </div>

            <div className="field">
              <label htmlFor="co-delivery-date">Entrega prevista</label>
              <input
                id="co-delivery-date"
                type="date"
                value={requestedDeliveryDate}
                onChange={(event) => setRequestedDeliveryDate(event.target.value)}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Produtos" subtitle="Um Product por pedido — a unidade vem do item de produto acabado.">
          <div className="table-container">
            {/* Produto é a coluna de decisão: fica com o espaço, e a busca
                dentro dela precisa de largura para nomes longos. */}
            <table className="table table--order-lines">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="col-quantity is-numeric">Quantidade</th>
                  <th className="col-unit">Un.</th>
                  {!isDraft && <th>Expedido</th>}
                  {!isDraft && <th>Falta expedir</th>}
                  {isDraft && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      {isDraft ? (
                        <SearchableEntitySelect
                          id={`pedido-produto-${line.key}`}
                          value={line.productId}
                          onChange={(productId) => handleLineProductChange(line.key, productId)}
                          placeholder="Digite código ou nome do produto…"
                          options={optionsForRow(line).map((product) => ({
                            id: product.id,
                            code: product.code,
                            name: product.name,
                          }))}
                        />
                      ) : (
                        <>
                          <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                        </>
                      )}
                    </td>
                    <td className="is-numeric">
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Quantidade"
                          value={line.orderedQuantity}
                          onChange={(event) => handleLineQuantityChange(line.key, event.target.value)}
                        />
                      ) : (
                        line.orderedQuantity
                      )}
                    </td>
                    <td>{line.unitCode || "—"}</td>
                    {!isDraft && (
                      <td>
                        {customerOrder?.lines.find((l) => l.productId === line.productId)?.shippedQuantity ?? "—"}
                      </td>
                    )}
                    {!isDraft && (
                      <td>
                        {customerOrder?.lines.find((l) => l.productId === line.productId)?.outstandingQuantity ??
                          "—"}
                      </td>
                    )}
                    {isDraft && (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label="Remover linha"
                          onClick={() => handleRemoveLine(line.key)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {lines.length === 0 && (
                  <tr>
                    <td colSpan={isDraft ? 4 : 5} className="table__empty">
                      Nenhum produto adicionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <div className="line-actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddLine}>
                + Adicionar produto
              </button>
            </div>
          )}
        </FormSection>

        {showPlan && (
          <FormSection
            title="Plano de Atendimento"
            subtitle="Análise/projeção — usa estoque disponível agora. Ao aplicar, tudo é recalculado de novo."
          >
            {planLoading && <p className="field__hint">Calculando…</p>}
            {plan && (
              <>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Pedido</th>
                        <th className="is-numeric">Disponível</th>
                        <th>Reservar</th>
                        <th>Produzir</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.lines.map((line) => {
                        const adjustment = planAdjustments[line.customerOrderLineId] ?? { reserve: "0", produce: "0" };
                        return (
                          <tr key={line.customerOrderLineId}>
                            <td>
                              <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                            </td>
                            <td>
                              {line.orderedQuantity} {line.unitCode}
                            </td>
                            <td className="is-numeric">{line.finishedGoodsAvailable}</td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={adjustment.reserve}
                                onChange={(event) =>
                                  handleAdjustReserve(line.customerOrderLineId, line.orderedQuantity, event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={adjustment.produce}
                                onChange={(event) =>
                                  handleAdjustProduce(line.customerOrderLineId, line.orderedQuantity, event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <span
                                className={
                                  line.situation === "SEM_FORMULACAO_ATIVA" ? "badge badge--warn" : "badge badge--neutral"
                                }
                              >
                                {situationLabel(line.situation)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!planCoversEverything && (
                  <p className="field__hint">Reservar + Produzir precisa somar exatamente a quantidade pedida em cada linha.</p>
                )}

                {plan.materialImpact.length > 0 && (
                  <div className="table-container table-container--spaced">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th className="is-numeric">Necessário</th>
                          <th className="is-numeric">Físico</th>
                          <th className="is-numeric">Reservado</th>
                          <th className="is-numeric">Disponível</th>
                          <th className="is-numeric">Em Compra</th>
                          <th className="is-numeric">Falta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.materialImpact.map((row) => (
                          <tr key={row.itemId}>
                            <td>
                              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                            </td>
                            <td className="is-numeric">
                              {row.requiredQuantity} {row.unitCode}
                            </td>
                            <td className="is-numeric">{row.onHand}</td>
                            <td className="is-numeric">{row.reserved}</td>
                            <td className="is-numeric">{row.available}</td>
                            <td className="is-numeric">{row.onOrder}</td>
                            <td className="is-numeric">
                              <span className={Number(row.shortage) > 0 ? "badge badge--warn" : "badge badge--active"}>
                                {row.shortage}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={!planCoversEverything || applying}
                    onClick={() => setApplyDialogOpen(true)}
                  >
                    {applying ? "Aplicando…" : "Aplicar Plano de Atendimento"}
                  </button>
                </div>
              </>
            )}
          </FormSection>
        )}

        {showPurchaseSuggestion && (
          <FormSection
            title="Sugestão de Compra"
            subtitle="Análise dinâmica a partir das OPs deste Pedido — falta física e compra sugerida são conceitos diferentes."
          >
            {suggestionLoading && <p className="field__hint">Calculando…</p>}
            {suggestion && suggestion.pendingProductionOrders.length > 0 && (
              <div className="status-line">
                {suggestion.pendingProductionOrders.map((op) => (
                  <p key={op.id} className="field__hint">
                    Pendência de planejamento: {op.code} ({op.productCode} — {op.productName}) ainda não possui
                    requisitos de materiais.
                  </p>
                ))}
              </div>
            )}
            {suggestion && suggestion.rows.length > 0 && (
              <>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th className="is-numeric">Necessário restante</th>
                        <th>Reservado p/ este Pedido</th>
                        <th className="is-numeric">Disponível</th>
                        <th className="is-numeric">Em Compra</th>
                        <th>Falta física</th>
                        <th>Já em rascunho</th>
                        <th>Comprar sugerido</th>
                        <th>Comprar agora</th>
                        <th>Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.rows.map((row) => {
                        const input = draftInputs[row.itemId] ?? { quantity: "0", supplierId: "" };
                        return (
                          <tr key={row.itemId}>
                            <td>
                              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                              {/* Quem pode fornecer fica junto do material: e a
                                  informacao que sustenta a decisao de compra. */}
                              {row.supplierCandidates.length === 0 ? (
                                <div className="field__hint">
                                  Nenhum fornecedor homologado cadastrado para este item.
                                </div>
                              ) : (
                                <ul className="candidate-list">
                                  {row.supplierCandidates.map((candidate) => (
                                    <li key={candidate.supplierItemId}>
                                      {candidate.supplierName}
                                      {candidate.preferred && (
                                        <span className="badge badge--active"> Preferencial</span>
                                      )}
                                      {candidate.referenceUnitPrice ? (
                                        <span className="field__hint">
                                          {" "}
                                          {candidate.referenceUnitPrice}{" "}
                                          {candidate.referenceCurrencyCode}/
                                          {candidate.referencePriceUomCode}
                                        </span>
                                      ) : candidate.hasLegacyPriceReference ? (
                                        <span className="field__hint"> referência histórica</span>
                                      ) : (
                                        <span className="field__hint"> sem preço vigente</span>
                                      )}
                                      {candidate.minimumOrderQuantity && (
                                        <span className="field__hint">
                                          {" "}
                                          · mínimo {candidate.minimumOrderQuantity}{" "}
                                          {candidate.minimumOrderUomCode}
                                          {candidate.moqRaisedQuantity && " (eleva a quantidade)"}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {row.supplierCandidates.length > 1 &&
                                row.recommendedSupplierItemId === null && (
                                  <div className="field__hint">
                                    Vários homologados e nenhum preferencial — escolha o fornecedor.
                                  </div>
                                )}
                            </td>
                            <td className="is-numeric">
                              {row.remainingRequired} {row.unitCode}
                            </td>
                            <td>{row.ownReserved}</td>
                            <td className="is-numeric">{row.available}</td>
                            <td className="is-numeric">{row.onOrder}</td>
                            <td>{row.operationalShortage}</td>
                            <td>{row.draftPurchaseQuantity}</td>
                            <td>{row.newSuggestedPurchase}</td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={input.quantity}
                                onChange={(event) => handleDraftQuantityChange(row.itemId, event.target.value)}
                              />
                            </td>
                            <td>
                              <select
                                value={input.supplierId}
                                onChange={(event) => handleDraftSupplierChange(row.itemId, event.target.value)}
                              >
                                <option value="">Selecionar…</option>
                                {row.supplierCandidates.length > 0 && (
                                  <optgroup label="Homologados">
                                    {row.supplierCandidates.map((candidate) => (
                                      <option
                                        key={candidate.supplierItemId}
                                        value={candidate.supplierId}
                                      >
                                        {candidate.supplierCode} — {candidate.supplierName}
                                        {candidate.preferred ? " (preferencial)" : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {/* Compra emergencial/amostra continua possivel: a
                                    homologacao orienta, nao bloqueia o modulo de compras. */}
                                <optgroup label="Demais fornecedores ativos">
                                  {activeSuppliers
                                    .filter(
                                      (supplier) =>
                                        !row.supplierCandidates.some(
                                          (candidate) => candidate.supplierId === supplier.id,
                                        ),
                                    )
                                    .map((supplier) => (
                                      <option key={supplier.id} value={supplier.id}>
                                        {supplier.code} — {supplier.tradeName ?? supplier.legalName}
                                      </option>
                                    ))}
                                </optgroup>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {draftLinesMissingSupplier && (
                  <p className="field__hint">Selecione o fornecedor para cada material com quantidade a comprar.</p>
                )}

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={draftLinesToGenerate.length === 0 || draftLinesMissingSupplier || generating}
                    onClick={() => setGenerateDialogOpen(true)}
                  >
                    {generating ? "Gerando…" : "Gerar OCs em rascunho"}
                  </button>
                </div>
              </>
            )}
            {suggestion && suggestion.rows.length === 0 && suggestion.pendingProductionOrders.length === 0 && (
              <p className="field__hint">Nenhuma compra adicional sugerida neste momento.</p>
            )}
            {suggestion && noAdditionalPurchaseSuggested && suggestion.rows.length > 0 && (
              <p className="field__hint">Nenhuma compra adicional sugerida neste momento.</p>
            )}

            {suggestion && suggestion.customerSuppliedRows.length > 0 && (
              <>
                <h4>Materiais aguardando cliente</h4>
                <p className="field__hint">
                  Estes materiais são fornecidos pelo cliente e por isso não geram Ordem de Compra —
                  a falta é resolvida com o envio do próprio cliente.
                </p>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Cliente</th>
                        <th className="is-numeric">Necessário</th>
                        <th>Disponível do cliente</th>
                        <th className="is-numeric">Falta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.customerSuppliedRows.map((row) => (
                        <tr key={row.itemId}>
                          <td>
                            <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                          </td>
                          <td>{row.customerName ?? "—"}</td>
                          <td className="is-numeric">
                            {row.remainingRequired} {row.unitCode}
                          </td>
                          <td>{row.available}</td>
                          <td className="is-numeric">
                            <span
                              className={
                                Number(row.shortage) > 0 ? "badge badge--warn" : "badge badge--active"
                              }
                            >
                              {row.shortage}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </FormSection>
        )}

        {isOperational && reservationStatus && (
          <FormSection
            title="Reserva de Produto Acabado"
            subtitle="Produto produzido depois do Plano precisa ser explicitamente reservado antes de poder ser expedido."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Pedido</th>
                    <th>Expedido</th>
                    <th>Reservado restante</th>
                    <th>Falta reservar</th>
                    <th>Disponível agora</th>
                    <th>Reservar</th>
                  </tr>
                </thead>
                <tbody>
                  {reservationStatus.lines.map((line) => (
                    <tr key={line.customerOrderLineId}>
                      <td>
                        <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                      </td>
                      <td>
                        {line.orderedQuantity} {line.unitCode}
                      </td>
                      <td>{line.shippedQuantity}</td>
                      <td>{line.reservedRemaining}</td>
                      <td>{line.stillToReserve}</td>
                      <td>{line.currentAvailable}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={Number(line.stillToReserve) <= 0}
                          value={reserveInputs[line.customerOrderLineId] ?? ""}
                          onChange={(event) =>
                            setReserveInputs((prev) => ({
                              ...prev,
                              [line.customerOrderLineId]: event.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={
                  reserving ||
                  reservationStatus.lines.every(
                    (line) => Number(reserveInputs[line.customerOrderLineId] ?? "0") <= 0,
                  )
                }
                onClick={handleReserveAvailable}
              >
                {reserving ? "Reservando…" : "Reservar disponível"}
              </button>
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={preparingShipment}
                onClick={handlePrepareShipment}
              >
                {preparingShipment ? "Preparando…" : "Preparar Expedição"}
              </button>
            </div>
          </FormSection>
        )}

        {customerOrder && customerOrder.shipments.length > 0 && (
          <FormSection title="Expedições" subtitle="Somente uma expedição confirmada altera o estoque.">
            <div className="table-container">
              <table className="table table--clickable-rows">
                <thead>
                  <tr>
                    <th>Expedição</th>
                    <th>Data</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Status</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {customerOrder.shipments.map((shipment) => (
                    <tr
                      key={shipment.id}
                      tabIndex={0}
                      onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                    >
                      <td className="is-code">{shipment.code}</td>
                      <td>
                        {shipment.shipmentDate
                          ? new Date(shipment.shipmentDate).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="is-numeric">{shipment.totalQuantity}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus] ?? shipment.status}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {customerOrder && customerOrder.billingStatus !== "NOT_READY" && (
          <FormSection
            title="Faturamento"
            subtitle="Faturamento comercial do que foi realmente expedido — não emite Nota Fiscal."
          >
            <dl className="definition-list">
              <dt>Pedido</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.orderedQuantity), 0)}
              </dd>
              <dt>Expedido</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.shippedQuantity), 0)}
              </dd>
              <dt>Faturado</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.billedQuantity), 0)}
              </dd>
              <dt>A faturar (expedido)</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.unbilledShippedQuantity), 0)}
              </dd>
              <dt>Situação</dt>
              <dd>
                <span
                  className={
                    customerOrder.billingStatus === "BILLED" ? "badge badge--active" : "badge badge--warn"
                  }
                >
                  {CUSTOMER_ORDER_BILLING_STATUS_LABELS[customerOrder.billingStatus]}
                </span>
              </dd>
            </dl>

            {customerOrder.billings.length > 0 && (
              <div className="table-container table-container--spaced">
                <table className="table table--clickable-rows">
                  <thead>
                    <tr>
                      <th>Faturamento</th>
                      <th>Expedição</th>
                      <th className="is-numeric">Quantidade</th>
                      <th className="is-numeric">Valor</th>
                      <th>Status</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {customerOrder.billings.map((billing) => (
                      <tr
                        key={billing.id}
                        tabIndex={0}
                        onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                      >
                        <td className="is-code">{billing.code}</td>
                        <td className="is-code">{billing.shipmentCode}</td>
                        <td className="is-numeric">{billing.totalQuantity}</td>
                        <td className="is-numeric">{billing.totalAmount ? formatBRL(billing.totalAmount) : "Não informado"}</td>
                        <td>
                          <span className="badge badge--neutral">
                            {BILLING_STATUS_LABELS[
                              billing.status as keyof typeof BILLING_STATUS_LABELS
                            ] ?? billing.status}
                          </span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        )}

        {customerOrder && customerOrder.linkedPurchaseOrders.length > 0 && (
          <FormSection title="Ordens de Compra Vinculadas">
            <div className="table-container">
              <table className="table table--clickable-rows">
                <thead>
                  <tr>
                    <th>OC</th>
                    <th>Fornecedor</th>
                    <th className="is-numeric">Itens</th>
                    <th>Status</th>
                    <th className="is-numeric">Valor</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {customerOrder.linkedPurchaseOrders.map((po) => (
                    <tr key={po.id} tabIndex={0} onClick={() => navigate(`/compras/ordens/${po.id}`)}>
                      <td className="is-code">{po.code}</td>
                      <td>{po.supplierName}</td>
                      <td className="is-numeric">{po.lineCount}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {PURCHASE_ORDER_STATUS_LABELS[po.status as keyof typeof PURCHASE_ORDER_STATUS_LABELS] ?? po.status}
                        </span>
                      </td>
                      <td className="is-numeric">{po.orderTotal ?? "—"}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/compras/ordens/${po.id}`)}
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {hasFulfillmentResult && (
          <>
            {customerOrder?.reservation && (
              <FormSection
                title="Reservas de Produto Acabado"
                subtitle="Lote inelegível (vencido/bloqueado) pode ser realocado — o já expedido continua no lote original."
              >
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Lote</th>
                        <th className="is-numeric">Reservado</th>
                        <th>Expedido</th>
                        <th>Restante</th>
                        <th>Situação</th>
                        <th aria-hidden="true" />
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.reservation.lines.map((line) => {
                        const isReleased = line.releasedAt !== null;
                        const canReallocate =
                          isOperational && !isReleased && Number(line.reservedRemaining) > 0;
                        return (
                          <tr key={line.id}>
                            <td>
                              <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                            </td>
                            <td>
                              {/* O lote que atendeu o pedido é a resposta de
                                  "de qual lote saiu?" — tem que ser clicável. */}
                              {line.lotCode && line.lotId ? (
                                <Link className="code" to={`/estoque/lotes/${line.lotId}`}>
                                  {line.lotCode}
                                </Link>
                              ) : (
                                (line.lotCode ?? "— (sem controle de lote)")
                              )}
                              {line.businessLotNumber ? ` — ${line.businessLotNumber}` : ""}
                              {line.replacesLineId && (
                                <>
                                  <br />
                                  <span className="field__hint">Realocado de outra linha</span>
                                </>
                              )}
                            </td>
                            <td className="is-numeric">
                              {line.quantity} {line.unitCode}
                            </td>
                            <td>{line.shippedQuantity}</td>
                            <td>{line.reservedRemaining}</td>
                            <td>
                              {isReleased ? (
                                <span className="badge badge--neutral">Realocada</span>
                              ) : (
                                <span className="badge badge--active">Ativa</span>
                              )}
                            </td>
                            <td>
                              {canReallocate && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={reallocatingLineId === line.id}
                                  onClick={() => handleReallocate(line.id)}
                                >
                                  {reallocatingLineId === line.id ? "Realocando…" : "Realocar"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {customerOrder.reservation.lines.length === 0 && (
                        <tr>
                          <td colSpan={7} className="table__empty">
                            Nenhuma reserva de produto acabado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </FormSection>
            )}

            {customerOrder && customerOrder.generatedProductionOrders.length > 0 && (
              <FormSection
                title="Ordens de produção"
                subtitle="O que a fábrica produz para atender este pedido. Cada ordem abre direto pelo código."
              >
                <div className="table-container">
                  <table className="table table--clickable-rows">
                    <thead>
                      <tr>
                        <th>OP</th>
                        <th>Produto</th>
                        <th className="is-numeric">Planejado</th>
                        <th className="is-numeric">Produzido</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.generatedProductionOrders.map((op) => (
                        <tr key={op.id} tabIndex={0} onClick={() => navigate(`/producao/ordens/${op.id}`)}>
                          <td className="is-code">
                            <EntityLink kind="productionOrder" id={op.id} code={op.code} />
                          </td>
                          <td>
                            <EntityLink kind="product" id={op.productId} code={op.productCode} name={op.productName} />
                          </td>
                          <td className="is-numeric">
                            {op.plannedQuantity} {op.outputUnitCode}
                          </td>
                          <td className="is-numeric">
                            {op.producedQuantity} {op.outputUnitCode}
                          </td>
                          <td>
                            <span className="badge badge--neutral">
                              {PRODUCTION_ORDER_STATUS_LABELS[op.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FormSection>
            )}
          </>
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="co-notes">Notas internas</label>
            <textarea id="co-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        {isCancellable && (
          <button type="button" className="btn btn--danger" disabled={saving} onClick={() => setCancelDialogOpen(true)}>
            Cancelar pedido
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraft && status !== "CANCELLED" && !isNew && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveNotesOnly}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          )}
          {isConfirmable && (
            <button type="button" className="btn btn--accent" disabled={saving} onClick={() => setConfirmDialogOpen(true)}>
              Confirmar pedido
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title={`Confirmar ${customerOrder?.code}?`}
        message="Produtos e quantidades do pedido serão congelados para planejamento operacional."
        confirmLabel="Confirmar pedido"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      <ConfirmDialog
        open={applyDialogOpen}
        title="Aplicar Plano de Atendimento?"
        message="Produto acabado existente será reservado; OPs serão criadas em rascunho para o déficit. Nenhuma OP será liberada automaticamente e nenhuma compra será criada automaticamente."
        confirmLabel="Aplicar Plano"
        confirmTone="accent"
        onCancel={() => setApplyDialogOpen(false)}
        onConfirm={handleApplyPlan}
      />

      <ConfirmDialog
        open={generateDialogOpen}
        title="Gerar Ordens de Compra em rascunho?"
        message="Serão criadas OCs DRAFT agrupadas por fornecedor; nenhuma OC será enviada/confirmada automaticamente; preços permanecerão em branco; as OCs poderão ser revisadas no módulo de Compras."
        confirmLabel="Gerar OCs em rascunho"
        confirmTone="accent"
        onCancel={() => setGenerateDialogOpen(false)}
        onConfirm={handleGenerateDrafts}
      />

      {cancelDialogOpen && (
        <>
          <div className="confirm-overlay" />
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-co-title">
            <h2 id="cancel-co-title">Cancelar pedido?</h2>
            <p>{customerOrder?.code} permanecerá no histórico. Esta ação não pode ser desfeita.</p>
            <div className="field">
              <label htmlFor="co-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="co-cancel-reason"
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
                onClick={handleCancelConfirm}
              >
                Cancelar pedido
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
