import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { IndustrialResourceDetailDTO } from "@veridi/shared";
import {
  INDUSTRIAL_RATE_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { useAuth } from "../../app/AuthProvider";
import {
  createIndustrialResourceRate,
  getIndustrialResource,
  updateIndustrialResource,
} from "../../lib/industrial-resources-api";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

/**
 * Detalhe do recurso industrial com o histórico completo de tarifas.
 *
 * A tela nunca oferece "editar tarifa": o histórico é o que explica por que
 * uma estrutura antiga custou o que custou.
 */
export function IndustrialResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [resource, setResource] = useState<IndustrialResourceDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [rateValue, setRateValue] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [powerKw, setPowerKw] = useState("");

  const canEdit = user?.role === "ADMIN";

  const load = useCallback(() => {
    if (!id) return;
    getIndustrialResource(id)
      .then((result) => {
        setResource(result);
        setPowerKw(result.powerKw ?? "");
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o recurso"),
      );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar a ação");
    } finally {
      setSaving(false);
    }
  }

  if (error && !resource) return <p className="form-alert">{error}</p>;
  if (!resource) return <p>Carregando…</p>;

  const rateUomLabel = INDUSTRIAL_RATE_UOM_LABELS[resource.defaultUsageUom];

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Gestão / Recursos industriais</div>
          <div className="doc-title">
            <h1>{resource.name}</h1>
            <span className="code">{resource.code}</span>
            <span className="badge badge--neutral">
              {INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.type]}
            </span>
            <span className={resource.active ? "badge badge--active" : "badge badge--inactive"}>
              {resource.active ? "Ativo" : "Inativo"}
            </span>
          </div>
        </div>
        <div className="table__actions">
          {canEdit && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving}
              onClick={() =>
                void run(() => updateIndustrialResource(resource.id, { active: !resource.active }))
              }
            >
              {resource.active ? "Inativar recurso" : "Reativar recurso"}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/gestao/recursos-industriais")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Dados do recurso"
          subtitle="Recurso é categoria econômica; o uso por produto fica na estrutura de custos."
        >
          <dl className="definition-list">
            <dt>Descrição</dt>
            <dd>{resource.description ?? "—"}</dd>
            <dt>Unidade de consumo</dt>
            <dd>{rateUomLabel}</dd>
            <dt>Potência</dt>
            <dd>{resource.powerKw ? `${resource.powerKw} kW` : "Não informada"}</dd>
            <dt>Tarifa vigente</dt>
            <dd>
              {resource.currentRate
                ? `R$ ${resource.currentRate.rateValue} / ${INDUSTRIAL_RATE_UOM_LABELS[resource.currentRate.rateUom]} (desde ${formatDate(resource.currentRate.effectiveAt)})`
                : "Não informada"}
            </dd>
            <dt>Cadastrado por</dt>
            <dd>{resource.createdByName ?? "—"}</dd>
          </dl>

          {!resource.active && (
            <p className="field__hint">
              Recurso inativo não entra em estrutura de custos nova. As estruturas ativas que já o
              usam continuam válidas com os valores congelados.
            </p>
          )}

          {canEdit && resource.type === "EQUIPMENT" && (
            <>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="resource-power">Potência (kW)</label>
                  <input
                    id="resource-power"
                    type="text"
                    inputMode="decimal"
                    value={powerKw}
                    onChange={(event) => setPowerKw(event.target.value)}
                    placeholder="Deixe vazio se não souber"
                  />
                  <span className="field__hint">
                    Alterar a potência não muda estruturas já ativadas — elas guardam a potência do
                    momento da ativação.
                  </span>
                </div>
              </div>
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(() =>
                      updateIndustrialResource(resource.id, {
                        powerKw: powerKw.trim() ? powerKw.trim() : null,
                      }),
                    )
                  }
                >
                  Salvar potência
                </button>
              </div>
            </>
          )}
        </FormSection>

        <FormSection
          title="Histórico de tarifas"
          subtitle="Tarifa é imutável. Reajuste entra como registro novo e o anterior permanece."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="is-numeric">Valor</th>
                  <th>Unidade</th>
                  <th>Vigente desde</th>
                  <th>Válida até</th>
                  <th>Origem</th>
                  <th>Situação</th>
                  <th>Registrada por</th>
                </tr>
              </thead>
              <tbody>
                {resource.rates.map((rate) => (
                  <tr key={rate.id}>
                    <td className="is-numeric">
                      {rate.currencyCode} {rate.rateValue}
                    </td>
                    <td>{INDUSTRIAL_RATE_UOM_LABELS[rate.rateUom]}</td>
                    <td>{formatDate(rate.effectiveAt)}</td>
                    <td>{formatDate(rate.validUntil)}</td>
                    <td>{INDUSTRIAL_RATE_SOURCE_LABELS[rate.source]}</td>
                    <td>
                      {rate.isCurrent ? (
                        <span className="badge badge--active">Vigente</span>
                      ) : (
                        <span className="badge badge--neutral">Histórica</span>
                      )}
                    </td>
                    <td>{rate.createdByName ?? "—"}</td>
                  </tr>
                ))}
                {resource.rates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table__empty">
                      Nenhuma tarifa registrada. O custo deste recurso fica em aberto até que uma
                      seja informada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="rate-value">Valor (R$ / {rateUomLabel})</label>
                  <input
                    id="rate-value"
                    type="text"
                    inputMode="decimal"
                    value={rateValue}
                    onChange={(event) => setRateValue(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rate-effective">Vigente a partir de</label>
                  <input
                    id="rate-effective"
                    type="date"
                    value={effectiveAt}
                    onChange={(event) => setEffectiveAt(event.target.value)}
                  />
                  <span className="field__hint">Vazio: vigente a partir de agora.</span>
                </div>
              </div>
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving || !rateValue.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createIndustrialResourceRate(resource.id, {
                        rateValue: rateValue.trim(),
                        ...(effectiveAt ? { effectiveAt } : {}),
                      });
                      setRateValue("");
                      setEffectiveAt("");
                    })
                  }
                >
                  Registrar tarifa
                </button>
              </div>
            </>
          )}
        </FormSection>
      </div>
    </>
  );
}
