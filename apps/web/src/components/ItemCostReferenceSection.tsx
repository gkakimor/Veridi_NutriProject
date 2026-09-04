import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ItemCostReferencesResponse, UnitOfMeasureDTO } from "@veridi/shared";
import {
  COST_SOURCE_AUTO_SELECTION_TEXT,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
} from "@veridi/shared";
import { useAuth } from "../app/AuthProvider";
import { createItemCostReference, getItemCostReferences } from "../lib/items-api";
import { listUnits } from "../lib/units-api";
import { formatBRL, formatUnitPriceBRL } from "../lib/currency";
import { formatDate, formatDateTime } from "../lib/dates";
import { mensagemDecimalInvalido, parseDecimalInput } from "../lib/decimal-input";
import { FormSection } from "./FormSection";

/** Hoje como dia de calendário, para o campo de data. */
function hojeISO(): string {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Custo de referência do Item — a referência MANUAL, com histórico.
 *
 * Três estados que nunca se confundem na tela: referência existente
 * ("R$ X / unidade"), sem referência ("Não informado") e — para material do
 * cliente, que não passa por aqui — "Não aplicável". Ausência nunca vira
 * R$ 0,00.
 *
 * Ao lado, a fonte que a seleção automática escolhe HOJE: é o que diz se a
 * referência está sendo usada ou se uma compra real (ou oferta) vence. A
 * ordem vem do texto único de `@veridi/shared`, não é redigitada aqui.
 *
 * Alterar cria uma vigência nova — a anterior fica no histórico. Cálculos já
 * salvos não mudam: eles congelaram o valor que usaram.
 */
export function ItemCostReferenceSection({ itemId }: { itemId: string }) {
  const { user } = useAuth();
  const podeDefinir = user?.role === "COMMERCIAL" || user?.role === "ADMIN";

  const [data, setData] = useState<ItemCostReferencesResponse | null>(null);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [unitCost, setUnitCost] = useState("");
  const [uomCode, setUomCode] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(hojeISO());
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    getItemCostReferences(itemId)
      .then((result) => {
        setData(result);
        setUomCode((atual) => atual || result.itemUnitCode);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o custo de referência"),
      );
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  // Só unidades da mesma dimensão do item convertem — as outras nem aparecem.
  const unidadeDoItem = units.find((unit) => unit.code === data?.itemUnitCode);
  const unidadesCompativeis = unidadeDoItem
    ? units.filter((unit) => unit.dimension === unidadeDoItem.dimension)
    : units;

  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const normalizado = unitCost.trim() === "" ? null : parseDecimalInput(unitCost);
    if (normalizado === null) {
      setFieldError(mensagemDecimalInvalido("Custo de referência"));
      return;
    }
    setFieldError(null);
    setSaving(true);
    setError(null);
    try {
      const result = await createItemCostReference(itemId, {
        unitCost: normalizado,
        uomCode: uomCode || data.itemUnitCode,
        effectiveFrom: new Date(`${effectiveFrom}T12:00:00`).toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setData(result);
      setEditando(false);
      setUnitCost("");
      setNote("");
      setEffectiveFrom(hojeISO());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar a referência");
    } finally {
      setSaving(false);
    }
  }

  const current = data?.current ?? null;
  const automatic = data?.automatic ?? null;
  const usandoManual = automatic?.source === "MANUAL_REFERENCE";

  return (
    <FormSection
      title="Custo de referência"
      subtitle="Usado como estimativa quando não houver compra real ou oferta válida com prioridade maior."
      id="custo-de-referencia"
    >
      {error && <p className="form-alert" role="alert">{error}</p>}

      {data && (
        <>
          <dl className="definition-list">
            <dt>Referência manual</dt>
            <dd>
              {current ? (
                <>
                  <b>{formatUnitPriceBRL(current.unitCost)}</b> / {current.uomCode}
                </>
              ) : (
                <span className="badge badge--neutral">Não informado</span>
              )}
            </dd>
            {current && (
              <>
                <dt>Válido desde</dt>
                <dd>{formatDate(current.effectiveFrom)}</dd>
                <dt>Origem</dt>
                <dd>
                  Referência manual
                  {current.createdByName ? ` — definida por ${current.createdByName}` : ""}
                  {` em ${formatDateTime(current.createdAt)}`}
                </dd>
                {current.note && (
                  <>
                    <dt>Observação</dt>
                    <dd>{current.note}</dd>
                  </>
                )}
              </>
            )}
            <dt>Fonte selecionada hoje</dt>
            <dd>
              {automatic && (
                <>
                  <span className={automatic.source === "NO_COST" ? "badge badge--warn" : "badge badge--neutral"}>
                    {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[automatic.source]}
                  </span>
                  {automatic.unitCost !== null && (
                    <>
                      {" "}
                      {formatUnitPriceBRL(automatic.unitCost)} / {automatic.unitCode}
                    </>
                  )}
                  {automatic.details && <span className="field__hint"> {automatic.details}</span>}
                </>
              )}
            </dd>
          </dl>

          {/* A diferença entre referência e compra real precisa ser dita
              aqui, onde a pessoa acabou de digitar um número: a referência
              só entra quando nada de prioridade maior existe. */}
          {current && automatic && !usandoManual && automatic.source !== "NO_COST" && (
            <p className="field__hint">
              A referência manual existe, mas hoje não é usada: há {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[automatic.source].toLowerCase()} com prioridade maior.
            </p>
          )}
          <p className="field__hint">{COST_SOURCE_AUTO_SELECTION_TEXT}</p>
          <p className="field__hint">
            A referência não é compra, recebimento nem valor pago. Alterar cria uma nova vigência;
            cálculos já salvos não mudam.
          </p>

          <div className="line-actions">
            <div className="table__actions">
              {podeDefinir && !editando && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setEditando(true)}
                >
                  {current ? "Alterar referência" : "Definir referência"}
                </button>
              )}
              {data.history.length > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-expanded={mostrarHistorico}
                  onClick={() => setMostrarHistorico((atual) => !atual)}
                >
                  {mostrarHistorico ? "Ocultar histórico" : `Histórico (${data.history.length})`}
                </button>
              )}
            </div>
          </div>

          {editando && (
            <form className="field-grid-2" onSubmit={salvar} aria-label="Nova referência de custo">
              <div className="field field--narrow">
                <label htmlFor="cost-reference-value">
                  Custo de referência <span className="req">*</span>
                </label>
                <input
                  id="cost-reference-value"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 1200,00"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  {...(fieldError ? { "aria-invalid": true as const } : {})}
                />
                {fieldError && <p className="field__error">{fieldError}</p>}
              </div>
              <div className="field field--narrow">
                <label htmlFor="cost-reference-uom">Por unidade</label>
                <select
                  id="cost-reference-uom"
                  value={uomCode}
                  onChange={(event) => setUomCode(event.target.value)}
                >
                  {unidadesCompativeis.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code} — {unit.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field--narrow">
                <label htmlFor="cost-reference-effective-from">Válido desde</label>
                <input
                  id="cost-reference-effective-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="cost-reference-note">Observação</label>
                <input
                  id="cost-reference-note"
                  type="text"
                  placeholder="Ex.: cotação verbal, tabela do fornecedor"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <div className="field field--full">
                <div className="table__actions">
                  <button type="submit" className="btn btn--accent btn--sm" disabled={saving}>
                    {saving ? "Salvando…" : "Salvar referência"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={saving}
                    onClick={() => {
                      setEditando(false);
                      setFieldError(null);
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </form>
          )}

          {mostrarHistorico && (
            <div className="table-container table-container--spaced">
              <table className="table">
                <thead>
                  <tr>
                    <th>Válido desde</th>
                    <th className="is-numeric">Valor</th>
                    <th>Unidade</th>
                    <th>Definida por</th>
                    <th>Em</th>
                    <th>Observação</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.effectiveFrom)}</td>
                      <td className="is-numeric">{formatBRL(row.unitCost)}</td>
                      <td>{row.uomCode}</td>
                      <td>{row.createdByName ?? "—"}</td>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{row.note ?? "—"}</td>
                      <td>
                        {row.current ? (
                          <span className="badge badge--active">Vigente</span>
                        ) : (
                          <span className="badge badge--inactive">Histórica</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </FormSection>
  );
}
