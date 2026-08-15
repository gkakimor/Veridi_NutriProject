import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ReceiptDTO } from "@veridi/shared";
import { getReceipt } from "../../lib/receiving-api";
import { FormSection } from "../../components/FormSection";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Detalhe de Receipt — sempre historico/somente-leitura. */
export function ReceiptDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => navigate("/compras/recebimentos")}
        >
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        <FormSection title="Dados do recebimento">
          <dl className="definition-list">
            <dt>Ordem de compra</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/compras/ordens/${receipt.purchaseOrderId}`)}
              >
                {receipt.purchaseOrderCode}
              </button>
            </dd>
            <dt>Fornecedor</dt>
            <dd>
              {receipt.supplierCode} — {receipt.supplierName}
            </dd>
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
                  <th>Quantidade</th>
                  <th>Un.</th>
                  <th>Lote fornecedor</th>
                  <th>Validade</th>
                  <th>Localização</th>
                  <th>Lote interno</th>
                </tr>
              </thead>
              <tbody>
                {receipt.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <span className="code">{line.itemCode}</span> {line.itemName}
                    </td>
                    <td>{line.receivedQuantity}</td>
                    <td>{line.unitCode}</td>
                    <td>{line.supplierLot ?? "—"}</td>
                    <td>{formatDate(line.expiryDate)}</td>
                    <td>{line.location ?? "—"}</td>
                    <td>
                      {line.lotId ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/estoque/lotes/${line.lotId}`)}
                        >
                          <span className="code">{line.lotCode}</span>
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      </div>
    </>
  );
}
