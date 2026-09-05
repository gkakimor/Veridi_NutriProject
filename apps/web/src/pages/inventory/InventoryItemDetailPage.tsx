import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AllocationSuggestionDTO, InventoryItemDetailDTO, ItemCostReferencesResponse } from "@veridi/shared";
import {
  COST_SOURCE_AUTO_SELECTION_TEXT,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
} from "@veridi/shared";
import { getAllocationSuggestion, getInventoryItem } from "../../lib/inventory-api";
import { getItemCostReferences } from "../../lib/items-api";
import { formatUnitPriceBRL } from "../../lib/currency";
import { exigirDecimal } from "../../lib/decimal-field";
import { FormSection } from "../../components/FormSection";
import { AdjustStockDialog } from "../../components/AdjustStockDialog";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
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
  const [costReference, setCostReference] = useState<ItemCostReferencesResponse | null>(null);

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

  // A MESMA seleção canônica do cálculo de custo: o que aparece aqui é o
  // que o CMV usaria hoje para este item, com a referência manual ao lado.
  useEffect(() => {
    if (!itemId) return;
    getItemCostReferences(itemId)
      .then((result) => setCostReference(result ?? null))
      .catch(() => setCostReference(null));
  }, [itemId]);

  async function handleCalculateSuggestion(event: FormEvent) {
    event.preventDefault();
    if (!itemId || !requiredQuantity.trim()) return;

    setSuggestionLoading(true);
    setSuggestionError(null);
    setSuggestion(null);
    try {
      const result = await getAllocationSuggestion(
        itemId,
        exigirDecimal(requiredQuantity, "Quantidade necessária"),
      );
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
          <PageBreadcrumbs items={[{ label: "Posição de Estoque", href: "/estoque" }, { label: "Detalhe" }]} />
          <div className="doc-title">
            <h1>
              <EntityLink kind="item" id={detail.itemId} code={detail.itemCode} name={detail.itemName} />
            </h1>
            <span className="badge badge--neutral">{ITEM_TYPE_LABELS[detail.itemType]}</span>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque")}>
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {/* As duas ações desta página — ajustar e calcular a sugestão — são
            as que mais se tentava fazer na planilha. Nenhuma delas edita
            saldo, e é isso que precisa ficar claro antes do clique. */}
        <ContextHelp topic={helpTopics["estoque.item"]} />

        {costReference && (
          <FormSection
            title="Custo de referência"
            subtitle="A fonte que o cálculo de custo e o CMV usariam hoje para este item. Preço de OC nunca entra."
          >
            <dl className="definition-list">
              <dt>Custo utilizado</dt>
              <dd>
                {costReference.automatic.unitCost !== null
                  ? `${formatUnitPriceBRL(costReference.automatic.unitCost)} / ${costReference.automatic.unitCode}`
                  : "Não informado"}
              </dd>
              <dt>Fonte</dt>
              <dd>
                <span
                  className={
                    costReference.automatic.source === "NO_COST"
                      ? "badge badge--warn"
                      : "badge badge--neutral"
                  }
                >
                  {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[costReference.automatic.source]}
                </span>
                {costReference.automatic.details && (
                  <span className="field__hint"> {costReference.automatic.details}</span>
                )}
              </dd>
              <dt>Referência manual</dt>
              <dd>
                {costReference.current ? (
                  <>
                    {formatUnitPriceBRL(costReference.current.unitCost)} / {costReference.current.uomCode}
                    <span className="field__hint">
                      {" "}
                      — válida desde {formatDate(costReference.current.effectiveFrom)}
                    </span>
                  </>
                ) : (
                  "Não informado"
                )}
              </dd>
              <dt>Data de referência</dt>
              <dd>{formatDate(costReference.automatic.referenceDate)}</dd>
            </dl>
            <p className="field__hint">{COST_SOURCE_AUTO_SELECTION_TEXT}</p>
            <div className="line-actions">
              {/* A referência se define no cadastro do item, que é onde ela
                  tem histórico — não aqui, no estoque. */}
              <Link
                className="btn btn--ghost btn--sm"
                to={`/cadastros/itens?ids=${detail.itemId}&open=${detail.itemId}`}
              >
                {costReference.current ? "Alterar referência manual" : "Definir referência manual"}
              </Link>
            </div>
          </FormSection>
        )}

        <FormSection title="Disponibilidade">
          <dl className="definition-list">
            <dt>Físico</dt>
            <dd>
              {formatQuantity(detail.onHand)} {detail.unitCode}
              <span className="field__hint"> — existe no depósito agora, somando os lotes.</span>
            </dd>
            <dt>Reservado</dt>
            <dd>
              {formatQuantity(detail.reserved)} {detail.unitCode}
              <span className="field__hint">
                {" "}
                — parte do físico já comprometida com produção ou pedido.
              </span>
            </dd>
            <dt>Disponível</dt>
            <dd>
              {formatQuantity(detail.available)} {detail.unitCode}
              <span className="field__hint">
                {" "}
                — físico menos reservado, só lote liberado e não vencido.
              </span>
            </dd>
            <dt>Em Compra</dt>
            <dd>
              {formatQuantity(detail.onOrder)} {detail.unitCode}
              <span className="field__hint"> — saldo de ordens de compra que ainda não chegou.</span>
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
              <Link
                className="btn btn--ghost btn--sm"
                to={`/estoque/movimentacoes?itemId=${detail.itemId}`}
              >
                Ver movimentações
              </Link>
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
                    <th>
                      Status
                      <DicaDaColuna id="estoque.situacaoLote" />
                    </th>
                    <th className="is-numeric">Físico</th>
                    <th className="is-numeric">Reservado</th>
                    <th className="is-numeric">Disponível</th>
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
                      <td className="is-numeric">
                        {formatQuantity(lot.onHand)} {detail.unitCode}
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(lot.reserved)} {detail.unitCode}
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(lot.available)} {detail.unitCode}
                      </td>
                      <td>
                        <Link
                          className="btn btn--ghost btn--sm"
                          to={`/estoque/lotes/${lot.lotId}`}
                        >
                          Ver lote
                        </Link>
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

          {suggestionError && <p className="form-alert" role="alert">{suggestionError}</p>}

          {suggestion && (
            <div className="line-actions">
              <dl className="definition-list">
                <dt>Estratégia</dt>
                <dd>{suggestion.strategy}</dd>
                <dt>Necessário</dt>
                <dd>
                  {formatQuantity(suggestion.requiredQuantity)} {detail.unitCode}
                </dd>
                <dt>Disponível</dt>
                <dd>
                  {formatQuantity(suggestion.availableQuantity)} {detail.unitCode}
                </dd>
                <dt>Falta</dt>
                <dd>
                  {Number(suggestion.shortageQuantity) > 0 ? (
                    <span className="badge badge--err">
                      Falta: {formatQuantity(suggestion.shortageQuantity)} {detail.unitCode}
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
                        <th className="is-numeric">Disponível</th>
                        <th>Sugerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.allocations.map((allocation, index) => (
                        <tr key={allocation.lotId}>
                          <td>{index + 1}</td>
                          <td>
                            <Link
                              className="btn btn--ghost btn--sm"
                              to={`/estoque/lotes/${allocation.lotId}`}
                            >
                              <span className="code">{allocation.lotCode}</span>
                            </Link>
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
                          <td className="is-numeric">
                            {formatQuantity(allocation.availableQuantity)} {detail.unitCode}
                          </td>
                          <td>
                            {formatQuantity(allocation.suggestedQuantity)} {detail.unitCode}
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
