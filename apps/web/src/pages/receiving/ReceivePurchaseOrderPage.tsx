import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";
import { getPurchaseOrder, listPurchaseOrders } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { createReceipt } from "../../lib/receiving-api";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { parseDecimalInput } from "../../lib/decimal-input";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { formatUnitPriceBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { formatQuantity } from "../../lib/quantity";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface LineDraft {
  purchaseOrderLineId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  orderedQuantity: string;
  receivedQuantity: string;
  openQuantity: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  receiveNow: string;
  supplierLot: string;
  expiryDate: string;
  location: string;
  /** Preço previsto da OC — só referência visual, nunca custo real. */
  purchaseUnitPrice: string | null;
  /** Custo efetivo de aquisição — sempre opcional. */
  actualUnitCost: string;
}

/**
 * Fluxo de recebimento — pagina propria (nao FullWorkspaceModal), acessivel
 * de Compras → Recebimentos → "Receber OC" (sem OC pre-selecionada) ou do
 * detalhe da OC via "Receber materiais" (`?purchaseOrderId=`).
 */
export function ReceivePurchaseOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedId = searchParams.get("purchaseOrderId");

  const [pickerOptions, setPickerOptions] = useState<PurchaseOrderDTO[]>([]);
  const [pickerLoading, setPickerLoading] = useState(!preselectedId);

  const [po, setPo] = useState<PurchaseOrderDTO | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loadingPo, setLoadingPo] = useState(!!preselectedId);

  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentReference, setDocumentReference] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadPurchaseOrder = useCallback(async (id: string) => {
    setLoadingPo(true);
    setError(null);
    try {
      const fetched = await getPurchaseOrder(id);
      setPo(fetched);

      const openLines = fetched.lines.filter((line) => Number(line.openQuantity) > 0);
      const items = await Promise.all(openLines.map((line) => getItem(line.itemId)));

      setLines(
        openLines.map((line, index) => ({
          purchaseOrderLineId: line.id,
          itemCode: line.itemCode,
          itemName: line.itemName,
          unitCode: line.unitCode,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          openQuantity: line.openQuantity,
          controlsLot: items[index]?.controlsLot ?? true,
          controlsExpiry: items[index]?.controlsExpiry ?? true,
          receiveNow: "",
          supplierLot: "",
          expiryDate: "",
          location: "",
          purchaseUnitPrice: line.unitPrice,
          // NUNCA pré-preenchido com o preço da OC — custo real exige
          // decisão explícita do usuário.
          actualUnitCost: "",
        })),
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao carregar ordem de compra"));
    } finally {
      setLoadingPo(false);
    }
  }, []);

  useEffect(() => {
    if (preselectedId) {
      void loadPurchaseOrder(preselectedId);
      return;
    }

    setPickerLoading(true);
    Promise.all([
      listPurchaseOrders({ status: "ORDERED", pageSize: 100 }),
      listPurchaseOrders({ status: "PARTIALLY_RECEIVED", pageSize: 100 }),
    ])
      .then(([ordered, partial]) => setPickerOptions([...ordered.purchaseOrders, ...partial.purchaseOrders]))
      .catch(() => setPickerOptions([]))
      .finally(() => setPickerLoading(false));
  }, [preselectedId, loadPurchaseOrder]);

  function handleLineChange(id: string, field: keyof LineDraft, value: string) {
    setLines((prev) =>
      prev.map((line) => (line.purchaseOrderLineId === id ? { ...line, [field]: value } : line)),
    );
  }

  /*
   * A linha entra na remessa quando tem algo digitado — inclusive ilegível.
   *
   * Era `Number(line.receiveNow) > 0`, e `2,5` virava `NaN`: a linha sumia
   * da contagem, o rodapé continuava pedindo "informe a quantidade recebida"
   * e o botão ficava desabilitado. A pessoa não tinha como descobrir que o
   * problema era a vírgula. Ilegível agora conta, e o clique explica.
   */
  const linesToSubmit = lines.filter((line) => {
    const digitado = line.receiveNow.trim();
    if (digitado === "") return false;
    const valor = parseDecimalInput(digitado);
    return valor === null || Number(valor) > 0;
  });

  async function handleConfirmReceipt() {
    if (!po) return;
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      // Montado dentro do funil: uma quantidade ou um custo ilegível
      // interrompe aqui, nomeando o item, e o recebimento não é criado.
      const payload = {
        receivedAt: new Date(receivedAt).toISOString(),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(documentReference.trim() ? { documentReference: documentReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: linesToSubmit.map((line) => {
          const custo = exigirDecimalOpcional(
            line.actualUnitCost,
            `Custo efetivo de aquisição de ${line.itemCode}`,
          );
          return {
            purchaseOrderLineId: line.purchaseOrderLineId,
            receivedQuantity: exigirDecimal(line.receiveNow, `Receber agora de ${line.itemCode}`),
            ...(line.supplierLot.trim() ? { supplierLot: line.supplierLot.trim() } : {}),
            ...(line.expiryDate ? { expiryDate: new Date(line.expiryDate).toISOString() } : {}),
            ...(line.location.trim() ? { location: line.location.trim() } : {}),
            ...(custo ? { actualUnitCost: custo } : {}),
          };
        }),
      };

      const receipt = await createReceipt(po.id, payload);
      navigate(`/compras/recebimentos/${receipt.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(apiErrorMessage(err, "Falha ao confirmar recebimento"));
      }
    } finally {
      setSaving(false);
    }
  }

  if (!preselectedId && !po) {
    return (
      <>
        <div className="doc-header">
          <div>
            <PageBreadcrumbs
              items={[
                { label: "Recebimentos", href: "/compras/recebimentos" },
                { label: "Receber OC" },
              ]}
            />
            <div className="doc-title">
              <h1>Receber OC</h1>
            </div>
          </div>
        </div>

        <div className="doc-body">
          <ContextHelp topic={helpTopics["compras.recebimentos"]} />

          <FormSection
            title="Selecionar ordem de compra"
            subtitle="Somente OCs confirmadas com quantidade em aberto podem receber materiais."
          >
            {pickerLoading ? (
              <p className="muted">Carregando…</p>
            ) : pickerOptions.length === 0 ? (
              <p className="muted">Nenhuma OC confirmada com saldo em aberto no momento.</p>
            ) : (
              <div className="field">
                <label htmlFor="receiving-po-picker">Ordem de compra</label>
                <select
                  id="receiving-po-picker"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) void loadPurchaseOrder(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {pickerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.code} — {option.supplierName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </FormSection>
        </div>
      </>
    );
  }

  if (loadingPo || !po) {
    return (
      <div className="doc-header">
        <div>
          <h1 className="page__title">Receber OC</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs
            items={[
              { label: "Recebimentos", href: "/compras/recebimentos" },
              { label: "Receber OC" },
            ]}
          />
          <div className="doc-title">
            <h1>{po.code}</h1>
            <span className="field-readonly-value">{po.supplierName}</span>
          </div>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Confirmar aqui é irreversível: cria lote e entrada de estoque, e
            não existe edição depois. Vale dizer isso antes, não no erro. */}
        <ContextHelp topic={helpTopics["compras.recebimentos"]} />

        <FormSection title="Dados do recebimento">
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="receipt-date">
                Data do recebimento <span className="req">*</span>
              </label>
              <input
                id="receipt-date"
                type="date"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="receipt-invoice">Nota fiscal</label>
              <input
                id="receipt-invoice"
                type="text"
                placeholder="Ex.: NF 12345"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </div>
            <div className="field field--full">
              <label htmlFor="receipt-document">Referência de documento</label>
              <input
                id="receipt-document"
                type="text"
                value={documentReference}
                onChange={(event) => setDocumentReference(event.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {lines.length === 0 ? (
          <FormSection title="Itens">
            <p className="muted">Esta OC não possui mais quantidade em aberto para receber.</p>
          </FormSection>
        ) : (
          lines.map((line) => (
            <FormSection
              key={line.purchaseOrderLineId}
              title={`${line.itemCode} — ${line.itemName}`}
              subtitle={`Pedido: ${formatQuantity(line.orderedQuantity)} ${line.unitCode}  ·  Recebido: ${formatQuantity(line.receivedQuantity)} ${line.unitCode}  ·  Aberto: ${formatQuantity(line.openQuantity)} ${line.unitCode}`}
            >
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor={`receive-now-${line.purchaseOrderLineId}`}>
                    Receber agora ({line.unitCode})
                  </label>
                  <input
                    id={`receive-now-${line.purchaseOrderLineId}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.receiveNow}
                    onChange={(event) =>
                      handleLineChange(line.purchaseOrderLineId, "receiveNow", event.target.value)
                    }
                    /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                    {...(fieldErrors[`lines.${lines.indexOf(line)}.receivedQuantity`]
                      ? {
                          "aria-invalid": true as const,
                          "aria-describedby": `receive-now-${line.purchaseOrderLineId}-error`,
                        }
                      : {})}
                  />
                  {fieldErrors[`lines.${lines.indexOf(line)}.receivedQuantity`] && (
                    <p
                      className="field__error"
                      id={`receive-now-${line.purchaseOrderLineId}-error`}
                    >
                      {fieldErrors[`lines.${lines.indexOf(line)}.receivedQuantity`]}
                    </p>
                  )}
                </div>

                {line.controlsLot && (
                  <div className="field">
                    <label htmlFor={`supplier-lot-${line.purchaseOrderLineId}`}>
                      Lote do fornecedor <span className="req">*</span>
                      <DicaDoCampo id="estoque.loteFornecedor" />
                    </label>
                    <input
                      id={`supplier-lot-${line.purchaseOrderLineId}`}
                      type="text"
                      placeholder="Ex.: ABC-98765"
                      value={line.supplierLot}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "supplierLot", event.target.value)
                      }
                    />
                  </div>
                )}

                {line.controlsExpiry && (
                  <div className="field">
                    <label htmlFor={`expiry-${line.purchaseOrderLineId}`}>
                      Validade <span className="req">*</span>
                    </label>
                    <input
                      id={`expiry-${line.purchaseOrderLineId}`}
                      type="date"
                      value={line.expiryDate}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "expiryDate", event.target.value)
                      }
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor={`cost-${line.purchaseOrderLineId}`}>
                    Custo efetivo de aquisição ({line.unitCode})
                    <DicaDoCampo id="compras.custoEfetivo" />
                  </label>
                  <input
                    id={`cost-${line.purchaseOrderLineId}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="Opcional"
                    value={line.actualUnitCost}
                    onChange={(event) =>
                      handleLineChange(line.purchaseOrderLineId, "actualUnitCost", event.target.value)
                    }
                  />
                  <p className="field__hint">
                    {line.purchaseUnitPrice
                      ? `Preço previsto da OC: ${formatUnitPriceBRL(line.purchaseUnitPrice)} / ${line.unitCode}. `
                      : ""}
                    Opcional — o recebimento não depende do custo. Informe apenas o custo realmente
                    praticado; o preço da OC nunca é assumido como custo real.
                  </p>
                  {line.purchaseUnitPrice && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        handleLineChange(
                          line.purchaseOrderLineId,
                          "actualUnitCost",
                          line.purchaseUnitPrice!,
                        )
                      }
                    >
                      Usar preço da OC
                    </button>
                  )}
                </div>

                {line.controlsLot && (
                  <div className="field">
                    <label htmlFor={`location-${line.purchaseOrderLineId}`}>Localização</label>
                    <input
                      id={`location-${line.purchaseOrderLineId}`}
                      type="text"
                      placeholder="Ex.: MP / Estante B / Posição 03"
                      value={line.location}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "location", event.target.value)
                      }
                    />
                  </div>
                )}
              </div>
            </FormSection>
          ))
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="receipt-notes">Notas internas</label>
            <textarea id="receipt-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        <span className="modal-fullscreen__foot-meta">
          {linesToSubmit.length === 0
            ? "Informe a quantidade recebida em ao menos uma linha."
            : `${linesToSubmit.length} ${linesToSubmit.length === 1 ? "linha será recebida" : "linhas serão recebidas"}.`}
        </span>
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/compras/recebimentos")}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={saving || linesToSubmit.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {saving ? "Confirmando…" : "Confirmar recebimento"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar recebimento?"
        message="O recebimento será registrado no histórico e lotes internos serão criados para os itens que controlam lote. A operação não poderá ser simplesmente apagada depois."
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmReceipt}
      />
    </>
  );
}
