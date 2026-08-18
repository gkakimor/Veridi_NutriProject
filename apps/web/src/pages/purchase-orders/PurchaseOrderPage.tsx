import { useCallback, useEffect, useMemo, useState , useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type { PurchaseOrderDTO, PurchaseOrderStatus, SupplierItemDTO } from "@veridi/shared";
import { PURCHASE_ORDER_STATUS_LABELS, SUPPLIER_ITEM_QUALIFICATION_LABELS } from "@veridi/shared";
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrder,
} from "../../lib/purchase-orders-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { useAuth } from "../../app/AuthProvider";
import { SupplierFormModal } from "../suppliers/SupplierFormModal";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { listItems } from "../../lib/items-api";
import { formatBRL } from "../../lib/currency";
import { ApiValidationError } from "../../lib/api-errors";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";

interface SupplierOption {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  active: boolean;
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  active: boolean;
}

interface LineRow {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  orderedQuantity: string;
  unitPrice: string;
  receivedQuantity: string;
  openQuantity: string;
}

function statusBadgeClass(status: PurchaseOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ORDERED":
    case "RECEIVED":
      return "badge badge--active";
    case "PARTIALLY_RECEIVED":
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

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function lineFromDTO(line: PurchaseOrderDTO["lines"][number]): LineRow {
  return {
    key: nextRowKey(),
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity,
    unitPrice: line.unitPrice ?? "",
    receivedQuantity: line.receivedQuantity,
    openQuantity: line.openQuantity,
  };
}

/**
 * Documento transacional — pagina propria dentro do workspace, nao
 * FullWorkspaceModal. Padrao para futuros documentos (ex.: OP).
 * Atende `/compras/ordens/nova` (sem :id) e `/compras/ordens/:id`.
 */
export function PurchaseOrderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderDTO | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  // Criação no contexto: o fornecedor não existe e sair da OC agora
  // significaria refazer as linhas já digitadas.
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const { user } = useAuth();
  // CTA que termina em 403 é pior que CTA nenhum.
  const canCreateSupplier = user?.role === "PURCHASING" || user?.role === "ADMIN";
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);

  /**
   * Falta de material manda o item e a quantidade que falta pela URL. Sem
   * isso o atalho "Ir para compras" deixava a pessoa reconstruir de memória o
   * que o sistema acabou de calcular. Só pré-preenche a linha — fornecedor,
   * preço e decisão de comprar continuam com quem usa.
   */
  const [searchParams] = useSearchParams();
  const shortageItemId = searchParams.get("itemId") ?? "";
  const shortageQuantity = searchParams.get("quantidade") ?? "";

  const [activeSuppliers, setActiveSuppliers] = useState<SupplierOption[]>([]);
  const [activeItems, setActiveItems] = useState<ItemOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFormFromServer = useCallback((po: PurchaseOrderDTO) => {
    setSupplierId(po.supplierId);
    setOrderDate(toDateInputValue(po.orderDate));
    setExpectedDeliveryDate(toDateInputValue(po.expectedDeliveryDate));
    setNotes(po.notes ?? "");
    setLines(po.lines.map(lineFromDTO));
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    setNotFound(false);
    getPurchaseOrder(id)
      .then((po) => {
        setPurchaseOrder(po);
        syncFormFromServer(po);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, isNew, syncFormFromServer]);

  useEffect(() => {
    listSuppliers({ active: true, pageSize: 1000 })
      .then((result) => setActiveSuppliers(result.suppliers))
      .catch(() => setActiveSuppliers([]));
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: 1000 }),
      listItems({ type: "PACKAGING", active: true, pageSize: 1000 }),
    ])
      .then(([raw, packaging]) =>
        setActiveItems(
          [...raw.items, ...packaging.items].map((item) => ({
            id: item.id,
            code: item.code,
            name: item.name,
            unitCode: item.unitCode,
            active: item.active,
          })),
        ),
      )
      .catch(() => setActiveItems([]));
  }, []);

  const status: PurchaseOrderStatus = purchaseOrder?.status ?? "DRAFT";
  const isDraftEditable = isNew || status === "DRAFT";

  // Relacoes item x fornecedor do fornecedor escolhido — apoio visual na
  // DRAFT. A OC continua livre: homologacao orienta, nunca bloqueia compra
  // (emergencia, amostra, fornecedor novo).
  const [supplierItemsByItem, setSupplierItemsByItem] = useState<Record<string, SupplierItemDTO>>(
    {},
  );

  useEffect(() => {
    if (!supplierId) {
      setSupplierItemsByItem({});
      return;
    }
    listSupplierItems({ supplierId, pageSize: 100 })
      .then((result) =>
        setSupplierItemsByItem(
          Object.fromEntries(result.supplierItems.map((row) => [row.itemId, row])),
        ),
      )
      .catch(() => setSupplierItemsByItem({}));
  }, [supplierId]);
  const isForecastEditable = !purchaseOrder || status !== "CANCELLED";
  const isCancellable = !isNew && (status === "DRAFT" || status === "ORDERED");
  const isConfirmable = !isNew && status === "DRAFT" && lines.length > 0;
  const isReceivable = !isNew && (status === "ORDERED" || status === "PARTIALLY_RECEIVED");

  const supplierOptions: SupplierOption[] = useMemo(() => {
    if (!purchaseOrder || activeSuppliers.some((s) => s.id === purchaseOrder.supplierId)) {
      return activeSuppliers;
    }
    return [
      ...activeSuppliers,
      {
        id: purchaseOrder.supplierId,
        code: purchaseOrder.supplierCode,
        legalName: purchaseOrder.supplierName,
        tradeName: null,
        active: false,
      },
    ];
  }, [activeSuppliers, purchaseOrder]);

  function optionsForRow(row: LineRow): ItemOption[] {
    const usedByOtherRows = new Set(lines.filter((l) => l.key !== row.key).map((l) => l.itemId));
    const base = activeItems.filter((item) => !usedByOtherRows.has(item.id));
    if (row.itemId && !base.some((item) => item.id === row.itemId)) {
      return [
        ...base,
        { id: row.itemId, code: row.itemCode, name: row.itemName, unitCode: row.unitCode, active: false },
      ];
    }
    return base;
  }

  const prefilled = useRef(false);
  useEffect(() => {
    if (!isNew || prefilled.current || !shortageItemId) return;
    const item = activeItems.find((option) => option.id === shortageItemId);
    if (!item) return;
    prefilled.current = true;
    setLines([
      {
        key: nextRowKey(),
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unitCode: item.unitCode,
        orderedQuantity: shortageQuantity,
        unitPrice: "",
        receivedQuantity: "0",
        openQuantity: "0",
      },
    ]);
  }, [isNew, shortageItemId, shortageQuantity, activeItems]);

  function handleAddLine() {
    setLines((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        itemId: "",
        itemCode: "",
        itemName: "",
        unitCode: "",
        orderedQuantity: "",
        unitPrice: "",
        receivedQuantity: "0",
        openQuantity: "0",
      },
    ]);
  }

  function handleRemoveLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function handleLineItemChange(key: string, itemId: string) {
    const item = activeItems.find((option) => option.id === itemId);
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              itemId,
              itemCode: item?.code ?? "",
              itemName: item?.name ?? "",
              unitCode: item?.unitCode ?? "",
            }
          : line,
      ),
    );
  }

  function handleLineFieldChange(key: string, field: "orderedQuantity" | "unitPrice", value: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  const previewTotal = useMemo(() => {
    let total: number | null = null;
    for (const line of lines) {
      const price = Number(line.unitPrice);
      const qty = Number(line.orderedQuantity);
      if (!line.unitPrice.trim() || Number.isNaN(price) || Number.isNaN(qty)) continue;
      total = (total ?? 0) + qty * price;
    }
    return total;
  }, [lines]);

  const displayTotal = purchaseOrder
    ? purchaseOrder.orderTotal
    : previewTotal !== null
      ? previewTotal.toFixed(2)
      : null;

  async function handleSaveDraft() {
    if (!supplierId) {
      setError("Selecione um fornecedor.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const linesPayload = lines
      .filter((line) => line.itemId)
      .map((line) => ({
        itemId: line.itemId,
        orderedQuantity: line.orderedQuantity.trim(),
        ...(line.unitPrice.trim() ? { unitPrice: line.unitPrice.trim() } : {}),
      }));

    const expectedIso = toIsoOrEmpty(expectedDeliveryDate);

    const payload = {
      supplierId,
      orderDate: toIsoOrEmpty(orderDate),
      notes: notes.trim(),
      lines: linesPayload,
      ...(isNew ? (expectedIso ? { expectedDeliveryDate: expectedIso } : {}) : { expectedDeliveryDate: expectedIso }),
    };

    try {
      if (isNew) {
        const created = await createPurchaseOrder(payload);
        navigate(`/compras/ordens/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await updatePurchaseOrder(id, payload);
        setPurchaseOrder(updated);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar ordem de compra");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveForecastOnly() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePurchaseOrder(id, {
        expectedDeliveryDate: toIsoOrEmpty(expectedDeliveryDate),
        notes: notes.trim(),
      });
      setPurchaseOrder(updated);
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
      const updated = await confirmPurchaseOrder(id);
      setPurchaseOrder(updated);
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
      const updated = await cancelPurchaseOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setPurchaseOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar ordem de compra");
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de compra</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isNew && notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de compra não encontrada</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/compras/ordens")}>
            ← Voltar para Ordens de Compra
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Compras / Ordens de Compra / {isNew ? "Nova" : "Editar"}</div>
          <div className="doc-title">
            <h1>{isNew ? "Nova ordem de compra" : purchaseOrder?.code}</h1>
            {purchaseOrder && (
              <span className={statusBadgeClass(status)}>{PURCHASE_ORDER_STATUS_LABELS[status]}</span>
            )}
          </div>
        </div>
        <div className="table__actions">
          {purchaseOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/compras/ordens/${purchaseOrder.id}/imprimir`)}
            >
              Imprimir
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/compras/ordens")}>
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
      {error && <p className="form-alert">{error}</p>}

      {purchaseOrder && purchaseOrder.origin === "CUSTOMER_ORDER" && (
        <FormSection title="Origem">
          <dl className="definition-list">
            <dt>Origem</dt>
            <dd>Pedido do Cliente</dd>
            <dt>Pedido</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/comercial/pedidos/${purchaseOrder.customerOrderId}`)}
              >
                {purchaseOrder.customerOrderCode}
              </button>
            </dd>
          </dl>
        </FormSection>
      )}

      {purchaseOrder?.status === "CANCELLED" && (
        <FormSection title="Cancelamento">
          <div className="status-line">
            <span className="badge badge--err">Cancelado</span>
            <span className="field__hint">
              {formatDateTime(purchaseOrder.cancelledAt)} — {purchaseOrder.cancelledBy ?? "—"}
            </span>
          </div>
          {purchaseOrder.cancelReason && (
            <p className="field__hint">Motivo: {purchaseOrder.cancelReason}</p>
          )}
        </FormSection>
      )}

      <FormSection
        title="Fornecedor e datas"
        subtitle={
          isDraftEditable
            ? "Enquanto rascunho, fornecedor e datas podem ser alterados livremente."
            : "Após confirmada, fornecedor e data do pedido ficam congelados."
        }
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="po-supplier">
              Fornecedor <span className="req">*</span>
            </label>
            {isDraftEditable ? (
              <SearchableEntitySelect
                id="po-supplier"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Digite código ou nome do fornecedor…"
                options={supplierOptions.map((supplier) => ({
                  id: supplier.id,
                  code: supplier.code,
                  name: supplier.tradeName ?? supplier.legalName,
                  ...(supplier.active ? {} : { hint: "inativo" }),
                }))}
                canCreate={canCreateSupplier}
                createLabel="Cadastrar novo fornecedor"
                onCreateNew={() => setSupplierModalOpen(true)}
              />
            ) : (
              <p className="field-readonly-value">
                {purchaseOrder?.supplierCode} — {purchaseOrder?.supplierName}
              </p>
            )}
            {fieldErrors["supplierId"] && <p className="field__error">{fieldErrors["supplierId"]}</p>}
          </div>

          <div className="field">
            <label htmlFor="po-order-date">
              Data do pedido <span className="req">*</span>
            </label>
            {isDraftEditable ? (
              <input
                id="po-order-date"
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
            ) : (
              <p className="field-readonly-value">
                {formatDate(purchaseOrder?.orderDate ?? "")}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="po-expected-date">Previsão de entrega</label>
            <input
              id="po-expected-date"
              type="date"
              value={expectedDeliveryDate}
              disabled={!isForecastEditable}
              onChange={(event) => setExpectedDeliveryDate(event.target.value)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Itens"
        subtitle="Somente matérias-primas e embalagens ativas podem ser adicionadas."
      >
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="is-numeric">Quantidade</th>
                <th>Un.</th>
                <th className="is-numeric">Preço unit.</th>
                <th className="is-numeric">Total</th>
                {isDraftEditable && <th aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineTotal =
                  line.unitPrice.trim() &&
                  !Number.isNaN(Number(line.unitPrice)) &&
                  !Number.isNaN(Number(line.orderedQuantity))
                    ? (Number(line.orderedQuantity) * Number(line.unitPrice)).toFixed(2)
                    : null;

                return (
                  <tr key={line.key}>
                    <td>
                      {isDraftEditable ? (
                        /* Mesmo seletor com busca de Formulação, Amostra e
                           Pedido. Era o único lugar onde escolher item virava
                           rolar uma lista fechada — com o catálogo real da
                           Veridi, procurar "beta-alanina" numa lista de
                           centenas é trabalho, não escolha. */
                        <SearchableEntitySelect
                          id={`po-line-item-${line.key}`}
                          value={line.itemId}
                          onChange={(value) => handleLineItemChange(line.key, value)}
                          placeholder="Digite código ou nome do item…"
                          options={optionsForRow(line).map((item) => ({
                            id: item.id,
                            code: item.code,
                            name: item.name,
                            ...(item.active ? {} : { hint: "inativo" }),
                          }))}
                        />
                      ) : (
                        <EntityLink
                          kind="item"
                          id={line.itemId}
                          code={line.itemCode}
                          name={line.itemName}
                        />
                      )}
                      {(() => {
                        const relation = supplierItemsByItem[line.itemId];
                        if (!line.itemId || !relation) return null;
                        const offer = relation.currentOffer;
                        return (
                          <div className="field__hint">
                            {SUPPLIER_ITEM_QUALIFICATION_LABELS[relation.qualificationStatus]}
                            {relation.preferred ? " · preferencial" : ""}
                            {offer
                              ? ` · referência ${offer.unitPrice} ${offer.currencyCode}/${offer.priceUomCode}`
                              : relation.latestLegacyOffer
                                ? " · só referência histórica de preço"
                                : ""}
                            {offer?.minimumOrderQuantity
                              ? ` · mínimo ${offer.minimumOrderQuantity} ${offer.minimumOrderUomCode ?? ""}`
                              : ""}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="is-numeric">
                      {isDraftEditable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={line.orderedQuantity}
                          onChange={(event) =>
                            handleLineFieldChange(line.key, "orderedQuantity", event.target.value)
                          }
                        />
                      ) : (
                        <>
                          {line.orderedQuantity}
                          {status !== "CANCELLED" && (
                            <>
                              <br />
                              <span className="field__hint">
                                Recebido: {line.receivedQuantity} · Aberto: {line.openQuantity}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td>{line.unitCode || "—"}</td>
                    <td className="is-numeric">
                      {isDraftEditable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Opcional"
                          value={line.unitPrice}
                          onChange={(event) =>
                            handleLineFieldChange(line.key, "unitPrice", event.target.value)
                          }
                        />
                      ) : (
                        formatBRL(line.unitPrice || null)
                      )}
                    </td>
                    <td className="is-numeric">{formatBRL(lineTotal)}</td>
                    {isDraftEditable && (
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
                );
              })}

              {lines.length === 0 && (
                <tr>
                  <td colSpan={isDraftEditable ? 6 : 5} className="table__empty">
                    Nenhum item adicionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-foot">Total: {formatBRL(displayTotal)}</div>
        </div>

        {isDraftEditable && (
          <div className="line-actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddLine}>
              + Adicionar item
            </button>
          </div>
        )}
      </FormSection>

      {purchaseOrder && purchaseOrder.receipts.length > 0 && (
        <FormSection
          title="Recebimentos"
          subtitle="O que de fato chegou contra esta ordem. Cada recebimento abre direto pelo código."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Recebimento</th>
                  <th>Data</th>
                  <th>Nota fiscal</th>
                  <th className="is-numeric">Itens</th>
                  <th className="is-numeric">Quantidade</th>
                  <th className="is-numeric">Lotes gerados</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrder.receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="is-code">
                      <EntityLink kind="receipt" id={receipt.id} code={receipt.code} />
                    </td>
                    <td>{formatDate(receipt.receivedAt)}</td>
                    <td>{receipt.invoiceNumber ?? "—"}</td>
                    <td className="is-numeric">{receipt.lineCount}</td>
                    <td className="is-numeric">{receipt.receivedQuantity}</td>
                    <td className="is-numeric">{receipt.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      )}

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="po-notes">Notas internas</label>
          <textarea
            id="po-notes"
            rows={3}
            disabled={!isForecastEditable}
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
            disabled={saving}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar OC
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraftEditable && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraftEditable && isForecastEditable && !isNew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving}
              onClick={handleSaveForecastOnly}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          )}
          {isConfirmable && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => setConfirmDialogOpen(true)}
            >
              Confirmar OC
            </button>
          )}
          {isReceivable && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => navigate(`/compras/recebimentos/novo?purchaseOrderId=${id}`)}
            >
              Receber materiais
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Confirmar OC?"
        message='Após confirmar, fornecedor, itens, quantidades e preços não poderão ser alterados. Só será possível ajustar a previsão de entrega e as observações.'
        confirmLabel="Confirmar OC"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-po-title" onClose={() => setCancelDialogOpen(false)}>
            <h2 id="cancel-po-title">Cancelar ordem de compra?</h2>
            <p>
              {purchaseOrder?.code} permanecerá no histórico, mas deixará de contribuir para "Em
              Compra". Esta ação não pode ser desfeita.
            </p>
            <div className="field">
              <label htmlFor="po-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="po-cancel-reason"
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
                Cancelar OC
              </button>
            </div>
          </ModalDialog>
        </>
      )}

      {supplierModalOpen && (
        <SupplierFormModal
          mode="create"
          supplier={null}
          onClose={() => setSupplierModalOpen(false)}
          onSaved={(created) => {
            setSupplierModalOpen(false);
            if (!created) return;
            setActiveSuppliers((prev) => [
              { ...created },
              ...prev.filter((row) => row.id !== created.id),
            ]);
            setSupplierId(created.id);
          }}
        />
      )}
    </>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}
