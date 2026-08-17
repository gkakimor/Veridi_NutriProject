import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  IndustrialCostVersionDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import {
  DIRECT_INDUSTRIAL_COST_DEFINITION,
  INDUSTRIAL_COST_BASES,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORIES,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import type { IndustrialCostBasis, IndustrialCostCategory } from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { RowActions } from "../../components/RowActions";
import { useAuth } from "../../app/AuthProvider";
import {
  activateIndustrialCostVersion,
  createIndustrialCostLine,
  createIndustrialCostVersion,
  deleteIndustrialCostLine,
  getProductIndustrialCosts,
  updateIndustrialCostVersion,
} from "../../lib/industrial-costs-api";

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "INACTIVE") return "badge badge--neutral";
  return "badge badge--warn";
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Estrutura de custos industriais de um produto.
 *
 * É documento versionado, por isso página própria (não modal). Aqui se
 * declara o ESCOPO do custo — receita usada, base de produção e premissas
 * adicionais. O custo consolidado (CMV) é calculado em outra etapa: nada
 * nesta tela soma um total.
 */
export function IndustrialCostPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<ProductIndustrialCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [referenceQuantity, setReferenceQuantity] = useState("");
  const [category, setCategory] = useState<IndustrialCostCategory>("SECONDARY_PACKAGING");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<IndustrialCostBasis>("FIXED_PER_BATCH");
  const [rateValue, setRateValue] = useState("");

  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";

  const load = useCallback(() => {
    if (!productId) return;
    getProductIndustrialCosts(productId)
      .then((result) => {
        setData(result);
        setReferenceQuantity(
          result.draft?.referenceOutputQuantity ??
            result.current?.referenceOutputQuantity ??
            result.suggestedReferenceOutputQuantity ??
            "",
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a estrutura de custos"),
      );
  }, [productId]);

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

  if (error && !data) return <p className="form-alert">{error}</p>;
  if (!data || !productId) return <p>Carregando…</p>;

  // A versão em edição é o rascunho; sem rascunho, mostra-se a vigente.
  const version: IndustrialCostVersionDTO | null = data.draft ?? data.current;
  const editable = canEdit && version?.status === "DRAFT";

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Cadastros / Produtos / Custos industriais</div>
          <div className="doc-title">
            <h1>
              {data.productCode} · {data.productName}
            </h1>
            {version && (
              <>
                <span className="code">{version.label}</span>
                <span className={statusBadgeClass(version.status)}>
                  {INDUSTRIAL_COST_VERSION_STATUS_LABELS[version.status]}
                </span>
                <span className={version.complete ? "badge badge--active" : "badge badge--warn"}>
                  {version.complete ? "Completa" : "Com pendências"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="table__actions">
          {canEdit && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving}
              onClick={() => void run(() => createIndustrialCostVersion(productId))}
            >
              {data.versions.length === 0 ? "Criar estrutura de custos" : "Nova versão"}
            </button>
          )}
          {version && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/print/estrutura-custos/${version.id}`)}
            >
              Imprimir / Salvar PDF
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/cadastros/produtos")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        {!version && (
          <FormSection title="Estrutura de custos">
            <p className="field__hint">
              Este produto ainda não tem estrutura de custos. A estrutura declara qual receita, qual
              base de produção e quais custos adicionais existem — o custo consolidado é calculado
              depois.
            </p>
          </FormSection>
        )}

        {version && (
          <>
            <FormSection
              title="Resumo"
              subtitle="Premissas da estrutura. Nenhum total é calculado aqui — isso é etapa do custo industrial consolidado."
            >
              <dl className="definition-list">
                <dt>Cliente</dt>
                <dd>{version.customerName ?? "—"}</dd>
                <dt>Formulação utilizada</dt>
                <dd>
                  V{version.formulationVersionNumber} ({version.formulationStatus === "ACTIVE"
                    ? "ativa"
                    : version.formulationStatus === "DRAFT"
                      ? "rascunho"
                      : "histórica"}
                  )
                </dd>
                <dt>Formulação ativa do produto</dt>
                <dd>
                  {version.activeFormulationVersionNumber
                    ? `V${version.activeFormulationVersionNumber}`
                    : "—"}
                </dd>
                <dt>Base de referência</dt>
                <dd>
                  {version.referenceOutputQuantity} {version.referenceOutputUomCode}
                </dd>
                <dt>Unidades por caixa</dt>
                <dd>{version.unitsPerShippingBox ?? "—"}</dd>
                <dt>Criada</dt>
                <dd>
                  {formatDateTime(version.createdAt)} — {version.createdByName ?? "—"}
                </dd>
                <dt>Ativada</dt>
                <dd>
                  {formatDateTime(version.activatedAt)}
                  {version.activatedByName ? ` — ${version.activatedByName}` : ""}
                </dd>
              </dl>

              {version.pendencies.length > 0 && (
                <ul className="candidate-list">
                  {version.pendencies.map((pendency) => (
                    <li key={pendency.description} className="field__hint">
                      {pendency.description}
                    </li>
                  ))}
                </ul>
              )}

              {editable && (
                <>
                  <div className="field-grid-2">
                    <div className="field">
                      <label htmlFor="reference-output">
                        Base de produção ({version.referenceOutputUomCode})
                      </label>
                      <input
                        id="reference-output"
                        type="text"
                        inputMode="decimal"
                        value={referenceQuantity}
                        onChange={(event) => setReferenceQuantity(event.target.value)}
                      />
                      <span className="field__hint">
                        Quantidade de produto acabado usada para estruturar o custo.
                      </span>
                    </div>
                  </div>
                  <div className="line-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={saving || !referenceQuantity.trim()}
                      onClick={() =>
                        void run(() =>
                          updateIndustrialCostVersion(version.id, {
                            referenceOutputQuantity: referenceQuantity.trim(),
                          }),
                        )
                      }
                    >
                      Salvar base
                    </button>
                    <button
                      type="button"
                      className="btn btn--accent btn--sm"
                      disabled={saving}
                      onClick={() => {
                        if (
                          !version.complete &&
                          !window.confirm(
                            "Esta estrutura possui premissas de custo ainda não informadas. Ativar assim?",
                          )
                        ) {
                          return;
                        }
                        void run(() =>
                          activateIndustrialCostVersion(version.id, {
                            confirmIncomplete: !version.complete,
                          }),
                        );
                      }}
                    >
                      Ativar estrutura
                    </button>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              title="Matérias-primas e embalagens da formulação"
              subtitle="Vêm da formulação vinculada e não são redigitadas aqui. O custo de cada material é calculado na etapa de custo industrial."
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantidade</th>
                      <th>Un.</th>
                      <th>Base</th>
                      <th>Pureza</th>
                      <th>Overage</th>
                      <th>Fornecimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {version.materials.map((material) => (
                      <tr key={material.itemId}>
                        <td>
                          <span className="code">{material.itemCode}</span> {material.itemName}
                        </td>
                        <td>{material.quantity}</td>
                        <td>{material.unitCode}</td>
                        <td>{material.basis}</td>
                        <td>{material.purityPercentApplied ?? "—"}</td>
                        <td>{material.overagePercent ?? "—"}</td>
                        <td>
                          {material.customerSupplied ? (
                            // Pertence à estrutura física, não ao custo Veridi.
                            <span className="badge badge--warn">Fornecido pelo cliente</span>
                          ) : (
                            "Veridi"
                          )}
                        </td>
                      </tr>
                    ))}
                    {version.materials.length === 0 && (
                      <tr>
                        <td colSpan={7} className="table__empty">
                          A formulação vinculada não tem componentes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </FormSection>

            <FormSection
              title="Premissas de custo adicionais"
              subtitle={`Custos que não estão na formulação. Percentual usa o custo industrial direto: ${DIRECT_INDUSTRIAL_COST_DEFINITION}`}
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Descrição</th>
                      <th>Base de cálculo</th>
                      <th>Valor</th>
                      {editable && <th aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {version.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
                        <td>{line.description}</td>
                        <td>{INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}</td>
                        <td>
                          {/* Não informado nunca vira zero. */}
                          {line.rateValue === null
                            ? "—"
                            : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                              ? `${line.rateValue}%`
                              : `R$ ${line.rateValue}`}
                        </td>
                        {editable && (
                          <td onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              actions={[
                                {
                                  label: "Remover premissa",
                                  destructive: true,
                                  onSelect: () =>
                                    void run(() => deleteIndustrialCostLine(line.id)),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                    {version.lines.length === 0 && (
                      <tr>
                        <td colSpan={editable ? 5 : 4} className="table__empty">
                          Nenhuma premissa adicional registrada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {editable && (
                <>
                  <div className="field-grid-2">
                    <div className="field">
                      <label htmlFor="cost-category">Categoria</label>
                      <select
                        id="cost-category"
                        value={category}
                        onChange={(event) =>
                          setCategory(event.target.value as IndustrialCostCategory)
                        }
                      >
                        {INDUSTRIAL_COST_CATEGORIES.map((option) => (
                          <option key={option} value={option}>
                            {INDUSTRIAL_COST_CATEGORY_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <span className="field__hint">
                        Mão de obra, equipamentos e energia entram com os recursos industriais.
                      </span>
                    </div>

                    <div className="field">
                      <label htmlFor="cost-description">Descrição</label>
                      <input
                        id="cost-description"
                        type="text"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Ex.: caixa de expedição"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="cost-basis">Base de cálculo</label>
                      <select
                        id="cost-basis"
                        value={basis}
                        onChange={(event) => setBasis(event.target.value as IndustrialCostBasis)}
                      >
                        {INDUSTRIAL_COST_BASES.map((option) => (
                          <option key={option} value={option}>
                            {INDUSTRIAL_COST_BASIS_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="cost-rate">Valor</label>
                      <input
                        id="cost-rate"
                        type="text"
                        inputMode="decimal"
                        value={rateValue}
                        onChange={(event) => setRateValue(event.target.value)}
                        placeholder="Deixe vazio se ainda não souber"
                      />
                      <span className="field__hint">
                        Percentual é informado como número (10 = 10%). Vazio significa não
                        informado — nunca zero.
                      </span>
                    </div>
                  </div>

                  <div className="line-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={saving || !description.trim()}
                      onClick={() =>
                        void run(async () => {
                          await createIndustrialCostLine(version.id, {
                            category,
                            description: description.trim(),
                            calculationBasis: basis,
                            ...(rateValue.trim() ? { rateValue: rateValue.trim() } : {}),
                          });
                          setDescription("");
                          setRateValue("");
                        })
                      }
                    >
                      Adicionar premissa
                    </button>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              title="Recursos industriais"
              subtitle="Mão de obra, equipamentos e energia ganham modelagem própria na próxima etapa."
            >
              <p className="field__hint">
                Nada é cadastrado aqui de propósito: lançar esses custos como premissa manual agora
                significaria duplicá-los quando os recursos existirem.
              </p>
            </FormSection>
          </>
        )}

        <FormSection title="Versões">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Formulação</th>
                  <th>Base</th>
                  <th>Completude</th>
                  <th>Ativada em</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((row) => (
                  <tr key={row.id}>
                    <td className="is-code">{row.label}</td>
                    <td>
                      <span className={statusBadgeClass(row.status)}>
                        {INDUSTRIAL_COST_VERSION_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>V{row.formulationVersionNumber}</td>
                    <td>
                      {row.referenceOutputQuantity} {row.referenceOutputUomCode}
                    </td>
                    <td>{row.complete ? "Completa" : "Com pendências"}</td>
                    <td>{formatDateTime(row.activatedAt)}</td>
                  </tr>
                ))}
                {data.versions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      Nenhuma versão criada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </FormSection>
      </div>
    </>
  );
}
