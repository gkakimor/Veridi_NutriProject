import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ReceiptDTO } from "@veridi/shared";
import { COA_STATUS_LABELS, RECEIPT_ATTACHMENT_TYPES, RECEIPT_SOURCE_TYPE_LABELS } from "@veridi/shared";
import { getReceipt } from "../../lib/receiving-api";
import { setAcquisitionCost } from "../../lib/costs-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";


/**
 * Detalhe de Receipt — o recebimento físico é sempre histórico/somente
 * leitura. O custo efetivo de aquisição é a única coisa editável aqui, e
 * é custeio, não alteração do documento físico: nunca muda quantidade,
 * lote ou estoque.
 */
export function ReceiptDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState("");
  const [savingCost, setSavingCost] = useState(false);

  async function handleSaveCost(lineId: string) {
    setSavingCost(true);
    setError(null);
    try {
      const updated = await setAcquisitionCost(lineId, { unitCost: costDraft.trim() });
      setReceipt(updated);
      setEditingLineId(null);
      setCostDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar custo de aquisição");
    } finally {
      setSavingCost(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    getReceipt(id)
      .then(setReceipt)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Recebimento</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !receipt) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Recebimento não encontrado</h1>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/compras/recebimentos")}
          >
            ← Voltar para Recebimentos
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Compras / Recebimentos / Detalhe</div>
          <div className="doc-title">
            <h1>{receipt.code}</h1>
            <span className="badge badge--active">Confirmado</span>
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/compras/recebimentos/${receipt.id}/imprimir`)}
          >
            Imprimir
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/compras/recebimentos")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Dados do recebimento">
          <dl className="definition-list">
            <dt>Origem</dt>
            <dd>{RECEIPT_SOURCE_TYPE_LABELS[receipt.sourceType]}</dd>
            {receipt.sourceType === "CUSTOMER_SUPPLIED" ? (
              <>
                <dt>Cliente proprietário</dt>
                <dd>
                  <EntityLink
                  kind="customer"
                  id={receipt.customerId}
                  code={receipt.customerCode}
                  name={receipt.customerName}
                />
                </dd>
              </>
            ) : (
              <>
                <dt>Ordem de compra</dt>
                <dd>
                  <EntityLink
                    kind="purchaseOrder"
                    id={receipt.purchaseOrderId}
                    code={receipt.purchaseOrderCode}
                  />
                </dd>
                <dt>Fornecedor</dt>
                <dd>
                  <EntityLink
                  kind="supplier"
                  id={receipt.supplierId}
                  code={receipt.supplierCode}
                  name={receipt.supplierName}
                />
                </dd>
              </>
            )}
            <dt>Data do recebimento</dt>
            <dd>{formatDate(receipt.receivedAt)}</dd>
            <dt>Nota fiscal</dt>
            <dd>{receipt.invoiceNumber ?? "—"}</dd>
            <dt>Referência de documento</dt>
            <dd>{receipt.documentReference ?? "—"}</dd>
            <dt>Criado em</dt>
            <dd>
              {formatDate(receipt.createdAt)} — {receipt.createdBy ?? "—"}
            </dd>
          </dl>
          {receipt.notes && <p className="field__hint">Observações: {receipt.notes}</p>}
        </FormSection>

        <FormSection title="Itens recebidos">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="is-numeric">Quantidade</th>
                  <th>Un.</th>
                  <th>Lote fornecedor</th>
                  <th>Validade</th>
                  <th>Localização</th>
                  <th>Lote interno</th>
                  <th>CoA</th>
                  <th className="is-numeric">Preço previsto (OC)</th>
                  <th className="is-numeric">Custo efetivo</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {receipt.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <EntityLink kind="item" id={line.itemId} code={line.itemCode} name={line.itemName} />
                    </td>
                    <td className="is-numeric">{line.receivedQuantity}</td>
                    <td>{line.unitCode}</td>
                    <td>{line.supplierLot ?? "—"}</td>
                    <td>{formatDate(line.expiryDate)}</td>
                    <td>{line.location ?? "—"}</td>
                    <td>
                      {line.lotId ? (
                        <div className="table__actions">
                          <EntityLink kind="lot" id={line.lotId} code={line.lotCode} />
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => navigate(`/estoque/lotes/${line.lotId}/etiqueta`)}
                          >
                            Imprimir etiqueta
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {line.coaStatus ? COA_STATUS_LABELS[line.coaStatus] : "—"}
                    </td>
                    <td className="is-numeric">{formatBRL(line.purchaseUnitPrice)}</td>
                    <td className="is-numeric">
                      {editingLineId === line.id ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Vazio = desconhecido"
                          value={costDraft}
                          onChange={(event) => setCostDraft(event.target.value)}
                        />
                      ) : line.actualUnitCost !== null ? (
                        <>
                          {formatBRL(line.actualUnitCost)}
                          <br />
                          <span className="field__hint">Real</span>
                        </>
                      ) : (
                        <span className="field__hint">Sem custo informado</span>
                      )}
                    </td>
                    <td>
                      {editingLineId === line.id ? (
                        <div className="table__actions">
                          <button
                            type="button"
                            className="btn btn--accent btn--sm"
                            disabled={savingCost}
                            onClick={() => handleSaveCost(line.id)}
                          >
                            {savingCost ? "Salvando…" : "Salvar"}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setEditingLineId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => {
                            setEditingLineId(line.id);
                            setCostDraft(line.actualUnitCost ?? "");
                          }}
                        >
                          {line.actualUnitCost !== null ? "Atualizar custo" : "Definir custo"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        {id && (
          <AttachmentsSection
            context="receipts"
            contextId={id}
            title="Documentos do recebimento"
            subtitle="Nota fiscal e outros documentos. O laudo do material fica no lote, não aqui."
            types={RECEIPT_ATTACHMENT_TYPES}
          />
        )}
      </div>
    </>
  );
}
