import { useCallback, useEffect, useState , useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RecipeSheetDTO, RecipeSheetPartDTO } from "@veridi/shared";
import {
  PRODUCTION_PART_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
  ownerLabel,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { completePart, getRecipeSheet, registerWeighing } from "../../lib/recipe-api";
import { EntityLink } from "../../components/EntityLink";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function partBadgeClass(status: RecipeSheetPartDTO["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "badge badge--active";
    case "IN_PROGRESS":
      return "badge badge--warn";
    default:
      return "badge badge--neutral";
  }
}

/**
 * Folha de Receita (R.COQ.003) — execução da produção por parte.
 *
 * Cada pesagem confirmada é o consumo real daquele material: o backend
 * reutiliza o mesmo serviço de ProductionConsumption, e o operador vem
 * sempre da sessão (a tela nunca escolhe quem executou).
 */
export function RecipeSheetPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [sheet, setSheet] = useState<RecipeSheetDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  /**
   * A recusa vem do backend com texto de negócio ("restam 0"), mas o alerta
   * fica no topo da folha: com a página rolada na parte que está sendo
   * pesada, a ação parecia não ter efeito. Traz o alerta para a vista.
   */
  function reportError(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      alertRef.current?.focus();
    });
  }
  const [activePart, setActivePart] = useState(1);

  const [requirementId, setRequirementId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [actualQuantity, setActualQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getRecipeSheet(id)
      .then(setSheet)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a Folha de Receita"),
      )
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleRegisterWeighing() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await registerWeighing(id, activePart, {
        requirementId,
        lotCode: lotCode.trim(),
        actualQuantity: actualQuantity.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setSheet(updated);
      setLotCode("");
      setActualQuantity("");
      setNotes("");
    } catch (err) {
      reportError(err, "Falha ao registrar pesagem");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompletePart() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      setSheet(await completePart(id, activePart));
    } catch (err) {
      reportError(err, "Falha ao concluir a parte");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !sheet) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Folha de Receita</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Folha de Receita indisponível</h1>
          {error && <p className="form-alert">{error}</p>}
        </div>
      </div>
    );
  }

  const part = sheet.parts.find((row) => row.partNumber === activePart) ?? sheet.parts[0];

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">
            Produção / Ordens de Produção / {sheet.officialNumber ?? sheet.productionOrderCode}
          </div>
          <div className="doc-title">
            <h1>Folha de Receita</h1>
            <span className="badge badge--neutral">R.COQ.003</span>
          </div>
        </div>
        <div className="doc-header__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => window.open(`/producao/ordens/${sheet.productionOrderId}/receita/imprimir`, "_blank")}
          >
            Imprimir Folha de Receita
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/producao/ordens/${sheet.productionOrderId}`)}
          >
            ← Voltar para a OP
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && (
          <p className="form-alert" ref={alertRef} tabIndex={-1} role="alert">
            {error}
          </p>
        )}

        <FormSection title="Ordem de Produção">
          <dl className="definition-list">
            <dt>OP oficial</dt>
            <dd>{sheet.officialNumber ?? "—"}</dd>
            <dt>OP interna</dt>
            <dd>
              <EntityLink
                kind="productionOrder"
                id={sheet.productionOrderId}
                code={sheet.productionOrderCode}
              />
            </dd>
            <dt>Produto</dt>
            <dd>
              <EntityLink kind="product" id={sheet.productId} code={sheet.productCode} name={sheet.productName} />
            </dd>
            <dt>Cliente</dt>
            <dd>{sheet.customerName ?? "—"}</dd>
            <dt>Formulação</dt>
            <dd>{sheet.formulationVersionLabel ?? "—"}</dd>
            <dt>Quantidade planejada</dt>
            <dd>
              {sheet.plannedQuantity} {sheet.outputUnitCode}
            </dd>
            <dt>Produção fracionada</dt>
            <dd>
              {sheet.numberOfParts > 1 ? `${sheet.numberOfParts} partes` : "Parte única"}
            </dd>
          </dl>
        </FormSection>

        {sheet.parts.length > 1 && (
          <div className="toolbar">
            {sheet.parts.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.partNumber === activePart ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"}
                onClick={() => setActivePart(row.partNumber)}
              >
                Parte {row.partNumber}/{sheet.numberOfParts}
              </button>
            ))}
          </div>
        )}

        {part && (
          <FormSection
            title={`Parte ${part.partNumber} de ${sheet.numberOfParts}`}
            subtitle="Diferença entre planejado e pesado é registrada, nunca escondida. Não existe tolerância automática."
          >
            <p>
              <span className={partBadgeClass(part.status)}>
                {PRODUCTION_PART_STATUS_LABELS[part.status]}
              </span>
              {part.startedByName && (
                <span className="field__hint">
                  {" "}
                  Iniciada por {part.startedByName} em {formatDateTime(part.startedAt)}
                </span>
              )}
              {part.completedByName && (
                <span className="field__hint">
                  {" "}
                  · Concluída por {part.completedByName} em {formatDateTime(part.completedAt)}
                </span>
              )}
            </p>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Fornecimento</th>
                    <th>Planejado</th>
                    <th>Pesado</th>
                    <th>Diferença</th>
                    <th>Lotes reservados</th>
                  </tr>
                </thead>
                <tbody>
                  {part.requirements.map((requirement) => (
                    <tr key={requirement.requirementId}>
                      <td>
                        <EntityLink kind="item" id={requirement.itemId} code={requirement.itemCode} name={requirement.itemName} />
                        {requirement.sourceName && (
                          <div className="field__hint">Fonte: {requirement.sourceName}</div>
                        )}
                      </td>
                      <td>
                        {SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}
                        {requirement.expectedOwnerCustomerName && (
                          <div className="field__hint">{requirement.expectedOwnerCustomerName}</div>
                        )}
                      </td>
                      <td>
                        {requirement.plannedQuantity} {requirement.unitCode}
                      </td>
                      <td>{requirement.weighedQuantity}</td>
                      <td>
                        <span
                          className={
                            Number(requirement.differenceQuantity) === 0
                              ? "badge badge--active"
                              : "badge badge--warn"
                          }
                        >
                          {requirement.differenceQuantity}
                        </span>
                      </td>
                      <td>
                        {requirement.reservedLots.map((lot) => lot.lotCode).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {part.status !== "COMPLETED" && (
              <>
                <h4>Registrar pesagem</h4>
                <div className="field field--narrow">
                  <label htmlFor="weighing-requirement">Material</label>
                  <select
                    id="weighing-requirement"
                    value={requirementId}
                    onChange={(event) => setRequirementId(event.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {part.requirements.map((requirement) => (
                      <option key={requirement.requirementId} value={requirement.requirementId}>
                        {requirement.itemCode} — {requirement.itemName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field field--narrow">
                  <label htmlFor="weighing-lot">Lote (escaneie ou digite)</label>
                  <input
                    id="weighing-lot"
                    type="text"
                    placeholder="LT-20260816-000123"
                    value={lotCode}
                    onChange={(event) => setLotCode(event.target.value)}
                  />
                </div>

                <div className="field field--narrow">
                  <label htmlFor="weighing-quantity">Quantidade pesada</label>
                  <input
                    id="weighing-quantity"
                    type="text"
                    inputMode="decimal"
                    value={actualQuantity}
                    onChange={(event) => setActualQuantity(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="weighing-notes">Observação</label>
                  <input
                    id="weighing-notes"
                    type="text"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={saving || !requirementId || !lotCode.trim() || !actualQuantity.trim()}
                    onClick={() => void handleRegisterWeighing()}
                  >
                    {saving ? "Registrando…" : "Confirmar pesagem"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={saving}
                    onClick={() => void handleCompletePart()}
                  >
                    Concluir parte {part.partNumber}
                  </button>
                </div>
              </>
            )}

            <h4>Pesagens registradas</h4>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Lote</th>
                    <th>Proprietário</th>
                    <th>Planejado</th>
                    <th>Pesado</th>
                    <th>Executado por</th>
                    <th>Data/hora</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {part.weighings.map((weighing) => (
                    <tr key={weighing.id}>
                      <td>
                        <EntityLink kind="item" id={weighing.itemId} code={weighing.itemCode} name={weighing.itemName} />
                      </td>
                      <td className="is-code">{weighing.lotCode ?? "—"}</td>
                      <td>{ownerLabel(weighing.ownerType, null)}</td>
                      <td>{weighing.plannedQuantity}</td>
                      <td>
                        {weighing.actualQuantity} {weighing.uomCode}
                      </td>
                      <td>{weighing.executedByName}</td>
                      <td>{formatDateTime(weighing.executedAt)}</td>
                      <td>{weighing.notes ?? "—"}</td>
                    </tr>
                  ))}

                  {part.weighings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="table__empty">
                        Nenhuma pesagem registrada nesta parte.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {sheet.packagingRequirements.length > 0 && (
          <FormSection
            title="Materiais de embalagem"
            subtitle="Embalagem não é pesada por fração: continua no Picking/Consumo da OP, com o total."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Fornecimento</th>
                    <th>Total da OP</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.packagingRequirements.map((row) => (
                    <tr key={row.requirementId}>
                      <td>
                        <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                      </td>
                      <td>{SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility]}</td>
                      <td>
                        {row.totalQuantity} {row.unitCode}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}
      </div>
    </>
  );
}
