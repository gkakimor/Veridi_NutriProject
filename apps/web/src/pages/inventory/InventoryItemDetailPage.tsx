import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AllocationSuggestionDTO, CostReferenceDTO, InventoryItemDetailDTO } from "@veridi/shared";
import { COST_SOURCE_LABELS, ITEM_TYPE_LABELS, LOT_STATUS_LABELS } from "@veridi/shared";
import { getAllocationSuggestion, getInventoryItem } from "../../lib/inventory-api";
import { getItemCostReference } from "../../lib/costs-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { AdjustStockDialog } from "../../components/AdjustStockDialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function lotStatusBadgeClass(status: string, isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    default:
      return "badge badge--err";
  }
}

/** Estoque → item — resumo On Hand/Reservado/Disponível/Em Compra + saldo por lote. */
export function InventoryItemDetailPage() {
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();

  const [detail, setDetail] = useState<InventoryItemDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [requiredQuantity, setRequiredQuantity] = useState("");
  const [suggestion, setSuggestion] = useState<AllocationSuggestionDTO | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [costReference, setCostReference] = useState<CostReferenceDTO | null>(null);

  const load = useCallback(() => {
    if (!itemId) return;
    setLoading(true);
    setNotFound(false);
    getInventoryItem(itemId)
      .then(setDetail)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!itemId) return;
    getItemCostReference(itemId)
      .then(setCostReference)
      .catch(() => setCostReference(null));
  }, [itemId]);

  async function handleCalculateSuggestion(event: FormEvent) {
    event.preventDefault();
    if (!itemId || !requiredQuantity.trim()) return;

    setSuggestionLoading(true);
    setSuggestionError(null);
    setSuggestion(null);
    try {
      const result = await getAllocationSuggestion(itemId, requiredQuantity.trim());
      setSuggestion(result);
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : "Falha ao calcular sugestão");
    } finally {
      setSuggestionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Estoque</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Item não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque")}>
            ← Voltar para Estoque
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Estoque / Visão Geral / Detalhe</div>
          <div className="doc-title">
            <h1>
              <span className="code">{detail.itemCode}</span> {detail.itemName}
            </h1>
            <span className="badge badge--neutral">{ITEM_TYPE_LABELS[detail.itemType]}</span>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {costReference && (
          <FormSection
            title="Referência de custo"
            subtitle="Baseada apenas em custos efetivos de aquisição informados — preço de OC nunca entra."
          >
            <dl className="definition-list">
              <dt>Custo unitário</dt>
              <dd>
                {costReference.unitCost
                  ? `${formatBRL(costReference.unitCost)} / ${costReference.unitCode}`
                  : "Sem custo"}
              </dd>
              <dt>Origem</dt>
              <dd>
                <span
                  className={
                    costReference.source === "NO_COST" ? "badge badge--warn" : "badge badge--neutral"
                  }
                >
                  {COST_SOURCE_LABELS[costReference.source]}
                </span>
              </dd>
              <dt>Data de referência</dt>
              <dd>{formatDate(costReference.referenceDate)}</dd>
            </dl>
            {costReference.details && <p className="field__hint">{costReference.details}</p>}
          </FormSection>
        )}

        <FormSection title="Disponibilidade">
          <dl className="definition-list">
            <dt>Físico</dt>
            <dd>
              {detail.onHand} {detail.unitCode}
            </dd>
            <dt>Reservado</dt>
            <dd>
              {detail.reserved} {detail.unitCode}
            </dd>
            <dt>Disponível</dt>
            <dd>
              {detail.available} {detail.unitCode}
            </dd>
            <dt>Em Compra</dt>
            <dd>
              {detail.onOrder} {detail.unitCode}
            </dd>
          </dl>

          <div className="line-actions">
            <div className="table__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setAdjustOpen(true)}
              >
                Ajustar estoque
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/estoque/movimentacoes?itemId=${detail.itemId}`)}
              >
                Ver movimentações
              </button>
            </div>
          </div>
        </FormSection>

        {detail.controlsLot && (
          <FormSection
            title="Saldo por lote"
            subtitle="Ordenado por validade para apresentação — não é a regra operacional de FEFO."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th>Localização</th>
                    <th>Status</th>
                    <th>Físico</th>
                    <th>Reservado</th>
                    <th>Disponível</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {detail.lots.map((lot) => (
                    <tr key={lot.lotId}>
                      <td className="is-code">{lot.lotCode}</td>
                      <td>{formatDate(lot.expiryDate)}</td>
                      <td>{lot.location ?? "—"}</td>
                      <td>
                        <span className={lotStatusBadgeClass(lot.status, lot.isExpired)}>
                          {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
                        </span>
                      </td>
                      <td>
                        {lot.onHand} {detail.unitCode}
                      </td>
                      <td>
                        {lot.reserved} {detail.unitCode}
                      </td>
                      <td>
                        {lot.available} {detail.unitCode}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate(`/estoque/lotes/${lot.lotId}`)}
                        >
                          Ver lote
                        </button>
                      </td>
                    </tr>
                  ))}

                  {detail.lots.length === 0 && (
                    <tr>
                      <td colSpan={8} className="table__empty">
                        Nenhum lote para este item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        <FormSection
          title="Ordem de Consumo / Sugestão FEFO"
          subtitle="Recomendação de cálculo — não reserva, não baixa estoque, não cria movimentação."
        >
          <form className="field-grid-2" onSubmit={handleCalculateSuggestion}>
            <div className="field">
              <label htmlFor="fefo-quantity">
                Quantidade necessária ({detail.unitCode})
              </label>
              <input
                id="fefo-quantity"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={requiredQuantity}
                onChange={(event) => setRequiredQuantity(event.target.value)}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={!requiredQuantity.trim() || suggestionLoading}
              >
                {suggestionLoading ? "Calculando…" : "Calcular sugestão"}
              </button>
            </div>
          </form>

          {suggestionError && <p className="form-alert">{suggestionError}</p>}

          {suggestion && (
            <div className="line-actions">
              <dl className="definition-list">
                <dt>Estratégia</dt>
                <dd>{suggestion.strategy}</dd>
                <dt>Necessário</dt>
                <dd>
                  {suggestion.requiredQuantity} {detail.unitCode}
                </dd>
                <dt>Disponível</dt>
                <dd>
                  {suggestion.availableQuantity} {detail.unitCode}
                </dd>
                <dt>Falta</dt>
                <dd>
                  {Number(suggestion.shortageQuantity) > 0 ? (
                    <span className="badge badge--err">
                      Falta: {suggestion.shortageQuantity} {detail.unitCode}
                    </span>
                  ) : (
                    <span className="badge badge--active">Sem falta</span>
                  )}
                </dd>
              </dl>

              {suggestion.allocations.length > 0 && (
                <div className="table-container table-container--spaced">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Ordem</th>
                        <th>Lote</th>
                        <th>Validade</th>
                        <th>Localização</th>
                        <th>Disponível</th>
                        <th>Sugerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.allocations.map((allocation, index) => (
                        <tr key={allocation.lotId}>
                          <td>{index + 1}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => navigate(`/estoque/lotes/${allocation.lotId}`)}
                            >
                              <span className="code">{allocation.lotCode}</span>
                            </button>
                            {index === 0 && (
                              <div className="field__hint">
                                {suggestion.strategy === "FIFO"
                                  ? "Recomendado — recebido primeiro"
                                  : "Recomendado — vence primeiro"}
                              </div>
                            )}
                          </td>
                          <td>{formatDate(allocation.expiryDate)}</td>
                          <td>{allocation.location ?? "—"}</td>
                          <td>
                            {allocation.availableQuantity} {detail.unitCode}
                          </td>
                          <td>
                            {allocation.suggestedQuantity} {detail.unitCode}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {suggestion.strategy === "NO_LOT" && (
                <p className="field__hint">Item sem controle de lote — não há alocação por lote.</p>
              )}
            </div>
          )}
        </FormSection>
      </div>

      {adjustOpen && (
        <AdjustStockDialog
          itemId={detail.itemId}
          unitCode={detail.unitCode}
          controlsLot={detail.controlsLot}
          lots={detail.lots}
          onClose={() => setAdjustOpen(false)}
          onAdjusted={() => {
            setAdjustOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
