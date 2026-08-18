import { useCallback, useEffect, useState } from "react";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { useNavigate, useParams } from "react-router-dom";
import type {
  EnergyCalculationMode,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  IndustrialResourceDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import {
  DIRECT_INDUSTRIAL_COST_DEFINITION,
  INDUSTRIAL_COST_BASES,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORIES,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
  ENERGY_CALCULATION_MODES,
  ENERGY_CALCULATION_MODE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
} from "@veridi/shared";
import type { IndustrialCostBasis, IndustrialCostCategory } from "@veridi/shared";
import { CostCalculationSection } from "./CostCalculationSection";
import { FormSection } from "../../components/FormSection";
import { RowActions } from "../../components/RowActions";
import { useAuth } from "../../app/AuthProvider";
import {
  activateIndustrialCostVersion,
  createIndustrialCostLine,
  createIndustrialCostVersion,
  createResourceUsage,
  deleteIndustrialCostLine,
  deleteResourceUsage,
  getProductIndustrialCosts,
  updateEnergyMode,
  updateIndustrialCostVersion,
} from "../../lib/industrial-costs-api";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import { EntityLink } from "../../components/EntityLink";

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "INACTIVE") return "badge badge--neutral";
  return "badge badge--warn";
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Enquanto rascunho, a tarifa exibida é a vigente HOJE — referência que ainda
 * pode mudar. Depois de ativa, o que vale é o valor congelado na ativação.
 */
function describeRate(usage: IndustrialCostResourceUsageDTO, status: string): string {
  if (status === "DRAFT") {
    return usage.currentRate
      ? `R$ ${usage.currentRate.rateValue} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.currentRate.rateUom]} (referência atual)`
      : "Tarifa não informada";
  }
  if (!usage.rateValueSnapshot || !usage.rateUomSnapshot) return "Tarifa não informada";
  return `R$ ${usage.rateValueSnapshot} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.rateUomSnapshot]}`;
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

  const [resources, setResources] = useState<IndustrialResourceDTO[]>([]);
  const [usageResourceId, setUsageResourceId] = useState("");
  const [usageQuantity, setUsageQuantity] = useState("");

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

  useEffect(() => {
    // Só recursos ativos entram numa estrutura nova; os inativos que já
    // estão em versões antigas continuam listados pela própria versão.
    listIndustrialResources({ active: true, pageSize: 1000 })
      .then((result) => setResources(result.resources))
      .catch(() => setResources([]));
  }, []);

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

  // Energia direta só existe no modo correspondente; fora dele o recurso de
  // energia nem é oferecido, para não induzir dupla contagem.
  const usedResourceIds = new Set(version?.resourceUsages.map((usage) => usage.resourceId) ?? []);
  const selectableResources = resources.filter(
    (resource) =>
      !usedResourceIds.has(resource.id) &&
      (resource.type !== "ENERGY" || version?.energyCalculationMode === "DIRECT"),
  );
  const selectedResource = resources.find((resource) => resource.id === usageResourceId) ?? null;

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Cadastros / Produtos / Custos industriais</div>
          <div className="doc-title">
            <h1>
              <EntityLink kind="product" id={productId} code={data.productCode} /> ·{" "}
              {data.productName}
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
          <ProjectOriginLink productId={productId} />
          {/* Produto sem lote mínimo cadastrado não tem base sugerida; sem
              este campo o botão só devolvia "Informe a base de produção" e o
              usuário não tinha onde informá-la. Continua valendo a regra de
              nunca assumir 1000. */}
          {canEdit && data.versions.length === 0 && (
            <div className="field">
              <label htmlFor="new-reference-output">
                Base de produção ({data.referenceOutputUomCode})
              </label>
              <input
                id="new-reference-output"
                type="text"
                inputMode="decimal"
                placeholder={data.suggestedReferenceOutputQuantity ?? "ex.: 1000"}
                value={referenceQuantity}
                onChange={(event) => setReferenceQuantity(event.target.value)}
              />
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={
                saving ||
                (data.versions.length === 0 &&
                  !referenceQuantity.trim() &&
                  !data.suggestedReferenceOutputQuantity)
              }
              onClick={() =>
                void run(() =>
                  createIndustrialCostVersion(
                    productId,
                    referenceQuantity.trim()
                      ? { referenceOutputQuantity: referenceQuantity.trim() }
                      : {},
                  ),
                )
              }
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
      <ProductRelatedLinks productId={productId} current="costs" />
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
                      <th className="is-numeric">Quantidade</th>
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
                          <EntityLink kind="item" id={material.itemId} code={material.itemCode} name={material.itemName} />
                        </td>
                        <td className="is-numeric">{material.quantity}</td>
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
                      <th className="is-numeric">Valor</th>
                      {editable && <th aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {version.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
                        <td>{line.description}</td>
                        <td>{INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}</td>
                        <td className="is-numeric">
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
              subtitle="Quanto de mão de obra, equipamento e energia esta base de produção consome. Nenhum valor é multiplicado aqui — o custo consolidado é etapa seguinte."
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Recurso</th>
                      <th>Tipo</th>
                      <th>Consumo</th>
                      <th>Base</th>
                      <th>
                        {version.status === "DRAFT" ? "Tarifa de referência" : "Tarifa congelada"}
                      </th>
                      <th>Energia derivada</th>
                      {editable && <th aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {version.resourceUsages.map((usage) => (
                      <tr key={usage.id}>
                        <td>
                          {/* Nome congelado explica o documento antigo mesmo se o
                              cadastro for renomeado depois. */}
                          <EntityLink
                            kind="industrialResource"
                            id={usage.resourceId}
                            code={usage.resourceCode}
                            name={usage.resourceNameSnapshot ?? usage.resourceName}
                          />
                          {!usage.resourceActive && (
                            <span className="badge badge--warn"> Recurso inativo</span>
                          )}
                        </td>
                        <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[usage.resourceType]}</td>
                        <td>
                          {usage.usageQuantity} {INDUSTRIAL_RATE_UOM_LABELS[usage.usageUom]}
                        </td>
                        <td>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</td>
                        <td>{describeRate(usage, version.status)}</td>
                        <td>
                          {/* Sem potência conhecida a energia fica em aberto, nunca zero. */}
                          {usage.derivedEnergyKwh ? `${usage.derivedEnergyKwh} kWh` : "—"}
                        </td>
                        {editable && (
                          <td onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              actions={[
                                {
                                  label: "Remover recurso",
                                  destructive: true,
                                  onSelect: () => void run(() => deleteResourceUsage(usage.id)),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                    {version.resourceUsages.length === 0 && (
                      <tr>
                        <td colSpan={editable ? 7 : 6} className="table__empty">
                          Nenhum recurso declarado nesta estrutura.
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
                      <label htmlFor="usage-resource">Recurso</label>
                      <SearchableEntitySelect
                        id="usage-resource"
                        value={usageResourceId}
                        onChange={(selectedId) => setUsageResourceId(selectedId)}
                        placeholder="Digite código ou nome do recurso…"
                        options={selectableResources.map((resource) => ({
                          id: resource.id,
                          code: resource.code,
                          name: resource.name,
                          hint: INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.type],
                        }))}
                      />
                      <span className="field__hint">
                        {version.energyCalculationMode === "DIRECT"
                          ? "Energia entra como consumo informado diretamente."
                          : "Recursos de energia só aparecem no modo de consumo informado diretamente."}
                      </span>
                    </div>

                    <div className="field">
                      <label htmlFor="usage-quantity">
                        Consumo por lote de referência
                        {selectedResource
                          ? ` (${INDUSTRIAL_RATE_UOM_LABELS[selectedResource.defaultUsageUom]})`
                          : ""}
                      </label>
                      <input
                        id="usage-quantity"
                        type="text"
                        inputMode="decimal"
                        value={usageQuantity}
                        onChange={(event) => setUsageQuantity(event.target.value)}
                      />
                      <span className="field__hint">
                        Recurso que não é usado simplesmente não entra na estrutura.
                      </span>
                    </div>
                  </div>

                  <div className="line-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={saving || !usageResourceId || !usageQuantity.trim()}
                      onClick={() =>
                        void run(async () => {
                          await createResourceUsage(version.id, {
                            resourceId: usageResourceId,
                            usageQuantity: usageQuantity.trim(),
                          });
                          setUsageResourceId("");
                          setUsageQuantity("");
                        })
                      }
                    >
                      Adicionar recurso
                    </button>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              title="Energia"
              subtitle="Consumo informado diretamente e consumo derivado dos equipamentos são exclusivos: somar os dois contaria a mesma energia duas vezes."
            >
              <dl className="definition-list">
                <dt>Modo de cálculo</dt>
                <dd>{ENERGY_CALCULATION_MODE_LABELS[version.energyCalculationMode]}</dd>
                <dt>Consumo derivado dos equipamentos</dt>
                <dd>
                  {version.energyCalculationMode !== "FROM_EQUIPMENT"
                    ? "—"
                    : version.derivedEnergyKwh
                      ? `${version.derivedEnergyKwh} kWh por lote de referência`
                      : "Em aberto — há equipamento sem potência informada"}
                </dd>
              </dl>

              {version.energyCalculationMode === "NONE" && (
                <p className="field__hint">
                  Energia ainda não estruturada. Isso não significa consumo zero.
                </p>
              )}

              {editable && (
                <div className="field-grid-2">
                  <div className="field">
                    <label htmlFor="energy-mode">Como a energia é apurada</label>
                    <select
                      id="energy-mode"
                      value={version.energyCalculationMode}
                      disabled={saving}
                      onChange={(event) =>
                        void run(() =>
                          updateEnergyMode(version.id, {
                            energyCalculationMode: event.target.value as EnergyCalculationMode,
                          }),
                        )
                      }
                    >
                      {ENERGY_CALCULATION_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {ENERGY_CALCULATION_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                    <span className="field__hint">
                      Derivada usa horas de equipamento × potência declarada no recurso.
                    </span>
                  </div>

                  {version.energyCalculationMode === "FROM_EQUIPMENT" && (
                    <div className="field">
                      <label htmlFor="energy-resource">Tarifa que valoriza o kWh derivado</label>
                      <select
                        id="energy-resource"
                        value={version.energyResourceId ?? ""}
                        disabled={saving}
                        onChange={(event) =>
                          void run(() =>
                            updateEnergyMode(version.id, {
                              energyCalculationMode: version.energyCalculationMode,
                              energyResourceId: event.target.value || null,
                            }),
                          )
                        }
                      >
                        <option value="">Selecione…</option>
                        {resources
                          .filter((resource) => resource.type === "ENERGY")
                          .map((resource) => (
                            <option key={resource.id} value={resource.id}>
                              {resource.code} — {resource.name}
                            </option>
                          ))}
                      </select>
                      <span className="field__hint">
                        Sem escolha explícita o kWh derivado não vira dinheiro: o sistema não elege
                        um recurso de energia sozinho.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </FormSection>
          </>
        )}

        {version && (
          <CostCalculationSection
            productId={productId}
            versionId={version.id}
            canSave={canEdit}
          />
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
