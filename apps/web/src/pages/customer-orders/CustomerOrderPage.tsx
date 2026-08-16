import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CustomerDTO, CustomerOrderDTO, CustomerOrderStatus, FulfillmentPlanDTO, ProductDTO } from "@veridi/shared";
import { CUSTOMER_ORDER_STATUS_LABELS } from "@veridi/shared";
import {
  applyFulfillmentPlan,
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  getCustomerOrder,
  getFulfillmentPlan,
  updateCustomerOrder,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";

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
      return "badge badge--warn";
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
    listCustomers({ active: true, pageSize: 100 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
    listProducts({ active: true, pageSize: 100 })
      .then((result) => setActiveProducts(result.products))
      .catch(() => setActiveProducts([]));
  }, []);

  const status: CustomerOrderStatus = customerOrder?.status ?? "DRAFT";
  const isDraft = isNew || status === "DRAFT";
  const isCancellable = !isNew && (status === "DRAFT" || status === "CONFIRMED");
  const isConfirmable = !isNew && status === "DRAFT" && lines.length > 0;
  const showPlan = !isNew && status === "CONFIRMED";
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
        city: null,
        state: null,
        notes: null,
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
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/pedidos")}>
          ← Voltar
        </button>
      </div>

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
                <select id="co-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Selecione…</option>
                  {customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.code} — {customer.tradeName ?? customer.legalName}
                      {!customer.active ? " (inativo)" : ""}
                    </option>
                  ))}
                </select>
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
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Un.</th>
                  {isDraft && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      {isDraft ? (
                        <select
                          value={line.productId}
                          onChange={(event) => handleLineProductChange(line.key, event.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {optionsForRow(line).map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.code} — {product.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <span className="code">{line.productCode}</span> {line.productName}
                        </>
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={line.orderedQuantity}
                          onChange={(event) => handleLineQuantityChange(line.key, event.target.value)}
                        />
                      ) : (
                        line.orderedQuantity
                      )}
                    </td>
                    <td>{line.unitCode || "—"}</td>
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
                    <td colSpan={isDraft ? 4 : 3} className="table__empty">
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
                        <th>Disponível</th>
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
                              <span className="code">{line.productCode}</span> {line.productName}
                            </td>
                            <td>
                              {line.orderedQuantity} {line.unitCode}
                            </td>
                            <td>{line.finishedGoodsAvailable}</td>
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
                          <th>Necessário</th>
                          <th>On Hand</th>
                          <th>Reservado</th>
                          <th>Disponível</th>
                          <th>Em Compra</th>
                          <th>Falta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.materialImpact.map((row) => (
                          <tr key={row.itemId}>
                            <td>
                              <span className="code">{row.itemCode}</span> {row.itemName}
                            </td>
                            <td>
                              {row.requiredQuantity} {row.unitCode}
                            </td>
                            <td>{row.onHand}</td>
                            <td>{row.reserved}</td>
                            <td>{row.available}</td>
                            <td>{row.onOrder}</td>
                            <td>
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

        {hasFulfillmentResult && (
          <>
            {customerOrder?.reservation && (
              <FormSection title="Reservas de Produto Acabado">
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Lote</th>
                        <th>Quantidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.reservation.lines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            <span className="code">{line.productCode}</span> {line.productName}
                          </td>
                          <td>
                            {line.lotCode ?? "— (sem controle de lote)"}
                            {line.businessLotNumber ? ` — ${line.businessLotNumber}` : ""}
                          </td>
                          <td>
                            {line.quantity} {line.unitCode}
                          </td>
                        </tr>
                      ))}
                      {customerOrder.reservation.lines.length === 0 && (
                        <tr>
                          <td colSpan={3} className="table__empty">
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
              <FormSection title="OPs Geradas" subtitle="Ordens de Produção DRAFT — o usuário revisa e planeja normalmente.">
                <div className="table-container">
                  <table className="table table--clickable-rows">
                    <thead>
                      <tr>
                        <th>OP</th>
                        <th>Produto</th>
                        <th>Quantidade</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.generatedProductionOrders.map((op) => (
                        <tr key={op.id} tabIndex={0} onClick={() => navigate(`/producao/ordens/${op.id}`)}>
                          <td className="is-code">{op.code}</td>
                          <td>
                            <span className="code">{op.productCode}</span> {op.productName}
                          </td>
                          <td>
                            {op.plannedQuantity} {op.outputUnitCode}
                          </td>
                          <td>
                            <span className="badge badge--neutral">{op.status}</span>
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
