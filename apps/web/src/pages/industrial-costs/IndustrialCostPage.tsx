import { useCallback, useEffect, useRef, useState } from "react";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { useNavigate, useParams } from "react-router-dom";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
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
  FORMULATION_COMPONENT_BASIS_LABELS,
} from "@veridi/shared";
import type { IndustrialCostBasis, IndustrialCostCategory } from "@veridi/shared";
import { CostCalculationSection } from "./CostCalculationSection";
import { CostTemplateOrigin } from "../cost-templates/CostTemplateOrigin";
import { UseCostTemplateDialog } from "../cost-templates/UseCostTemplateDialog";
import { applyCostTemplateToProduct } from "../../lib/cost-pricing-templates-api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { IndustrialCostPendencies } from "../../components/IndustrialCostPendencies";
import { RowActions } from "../../components/RowActions";
import { useAuth } from "../../app/AuthProvider";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
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
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";

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
/** "1 pendência" / "3 pendências" — plural sem parênteses de formulário. */
function pendencyBadgeLabel(pendencies: { severity: string }[]): string {
  const total = pendencies.filter((pendency) => pendency.severity === "BLOCKING").length;
  return total === 1 ? "1 pendência" : `${total} pendências`;
}

export function IndustrialCostPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<ProductIndustrialCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [activateConfirm, setActivateConfirm] = useState(false);
  const [newVersionConfirm, setNewVersionConfirm] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(false);

  /*
   * Qual versão está sendo lida.
   *
   * A tela abria sempre o rascunho e não oferecia caminho de volta para a
   * versão ATIVA — depois de criar uma V2, a estrutura que vale na produção
   * sumia da vista, sem link e sem histórico clicável, e quem só queria
   * conferir o custo oficial lia números de um rascunho sem perceber.
   *
   * O padrão passou a ser a versão ATIVA: é ela que vale na produção e é ela
   * que a maioria vem consultar. Editar é intenção declarada — quem vai
   * mexer no rascunho troca de aba, e criar um rascunho novo já leva para
   * ele automaticamente.
   */
  const [lendoAtiva, setLendoAtiva] = useState(true);
  const [referenceQuantity, setReferenceQuantity] = useState("");
  const [category, setCategory] = useState<IndustrialCostCategory>("SECONDARY_PACKAGING");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<IndustrialCostBasis>("FIXED_PER_BATCH");
  const [rateValue, setRateValue] = useState("");

  const [resources, setResources] = useState<IndustrialResourceDTO[]>([]);
  const [usageResourceId, setUsageResourceId] = useState("");
  /** Cadastro de recurso aberto a partir do campo de busca. */
  const [usageQuantity, setUsageQuantity] = useState("");

  /*
   * Sair para cadastrar um recurso desmonta esta tela. O rascunho que
   * importa é o da LINHA em edição — categoria, descrição, base, valor e
   * uso. `data` e `resources` ficam de fora: vêm do servidor e recarregam
   * sozinhos, e serializá-los faria o retorno restaurar uma versão da
   * estrutura que pode ter mudado enquanto a pessoa estava fora.
   */
  /*
   * `resources` e `version` só existem mais abaixo, depois da leitura do
   * servidor; o retorno da criação contextual precisa deles. Refs
   * atualizadas a cada render resolvem sem reordenar a tela — `onCreated` só
   * roda em resposta a navegação, nunca durante o render.
   */
  const resourcesRef = useRef<IndustrialResourceDTO[]>([]);
  const versionRef = useRef<IndustrialCostVersionDTO | null>(null);

  const { goCreate } = useContextualCreateOrigin<Record<string, unknown>>({
    collectDraft: () => ({
      /*
       * A ABA vai junto, e não é detalhe de apresentação.
       *
       * Produto com rascunho E versão ativa abre na aba "Ativa". Quem troca
       * para "Rascunho", preenche a linha e sai para cadastrar o recurso
       * voltava na aba "Ativa" — onde os campos nem são renderizados, porque
       * versão ativa não se edita. O rascunho estava intacto por baixo, mas
       * a pessoa via o trabalho sumido, que dá no mesmo.
       */
      lendoAtiva,
      referenceQuantity,
      category,
      description,
      basis,
      rateValue,
      usageResourceId,
      usageQuantity,
    }),
    restoreDraft: (rascunho) => {
      const texto = (chave: string) =>
        typeof rascunho[chave] === "string" ? (rascunho[chave] as string) : "";
      // Rascunho antigo, gravado antes de a aba viajar junto: `undefined`
      // cai no padrão da tela em vez de virar `false` por coincidência.
      if (typeof rascunho["lendoAtiva"] === "boolean") setLendoAtiva(rascunho["lendoAtiva"]);
      setReferenceQuantity(texto("referenceQuantity"));
      setCategory(texto("category") as IndustrialCostCategory);
      setDescription(texto("description"));
      setBasis(texto("basis") as IndustrialCostBasis);
      setRateValue(texto("rateValue"));
      setUsageResourceId(texto("usageResourceId"));
      setUsageQuantity(texto("usageQuantity"));
    },
    onCreated: (resultado) => {
      /*
       * Energia fora do modo "consumo informado diretamente" não é
       * escolhível aqui — é a regra que evita contar energia duas vezes.
       * Selecionar assim mesmo deixaria o campo em branco com um id
       * escolhido por baixo; melhor dizer o que aconteceu.
       */
      const criado = resourcesRef.current.find((row) => row.id === resultado.entityId);
      if (criado?.type === "ENERGY" && versionRef.current?.energyCalculationMode !== "DIRECT") {
        setError(
          `${criado.code} foi criado, mas recursos de energia só entram nesta estrutura no modo de consumo informado diretamente.`,
        );
        return;
      }
      setUsageResourceId(resultado.entityId);
    },
  });

  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";
  /*
   * Recurso industrial é a exceção do cadastro no contexto: o gate existe
   * dos dois lados. A API exige ADMIN (`requireRole(request, "ADMIN")`), e
   * o botão da listagem checa o mesmo. Oferecer aqui a quem só pode editar
   * custo daria um CTA que termina em 403.
   */
  const canCreateResource = user?.role === "ADMIN";

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

  /*
   * O funil único da tela. A ação pode recusar antes de chamar a API — é o
   * que um valor decimal ilegível faz —, e a recusa chega aqui como
   * qualquer outra falha, sem que a requisição saia.
   */
  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <p className="form-alert" role="alert">{error}</p>;
  if (!data || !productId) return <p>Carregando…</p>;

  // A versão em edição é o rascunho; sem rascunho, mostra-se a vigente.
  const version: IndustrialCostVersionDTO | null =
    lendoAtiva && data.current ? data.current : (data.draft ?? data.current);
  const podeAlternar = Boolean(data.draft && data.current);

  resourcesRef.current = resources;
  versionRef.current = version;

  // Primeira estrutura do produto precisa de base de produção: nunca se
  // assume 1000. Sem base informada nem sugerida, o botão fica bloqueado —
  // e agora diz por quê.
  /*
   * Estrutura de custos parte da formulação ATIVA do produto. Sem ela o
   * backend recusa com a razão certa — mas só depois de a pessoa preencher
   * a base e clicar; e a recusa cita uma tela que não é esta.
   */
  const missingActiveFormulation = data.activeFormulationVersionId === null;

  const missingProductionBase =
    data.versions.length === 0 &&
    !referenceQuantity.trim() &&
    !data.suggestedReferenceOutputQuantity;
  const editable = canEdit && version?.status === "DRAFT";

  /* A receita ativa do produto já passou da que esta estrutura congelou. */
  const formulacaoDefasada =
    version != null &&
    data.activeFormulationVersionNumber != null &&
    data.activeFormulationVersionNumber !== version.formulationVersionNumber;

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
          <PageBreadcrumbs items={[{ label: "Produtos", href: "/cadastros/produtos" }, { label: "Custos industriais" }]} />
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
                {/* O rótulo sozinho não dizia quanto falta nem onde olhar; o
                    número já separa "quase pronta" de "mal começada". */}
                <span className={version.complete ? "badge badge--active" : "badge badge--warn"}>
                  {version.complete ? "Completa" : pendencyBadgeLabel(version.pendencies)}
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
                Base de produção ({data.referenceOutputUomCode}){" "}
                <span aria-hidden="true">*</span>
                <span className="sr-only">(obrigatório)</span>
              </label>
              <input
                id="new-reference-output"
                type="text"
                inputMode="decimal"
                required
                aria-describedby="new-reference-output-hint"
                placeholder={data.suggestedReferenceOutputQuantity ?? "ex.: 1000"}
                value={referenceQuantity}
                onChange={(event) => setReferenceQuantity(event.target.value)}
              />
              <p id="new-reference-output-hint" className="field__hint">
                Usada por “Criar estrutura de custos”. Ao usar um template, a base vem do próprio
                template e este campo é ignorado.
              </p>
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              // Sem estrutura, criar a estrutura É a tela: o cabeçalho tinha
              // quatro botões de mesmo peso e nenhuma ação principal.
              className={
                data.versions.length === 0 ? "btn btn--accent" : "btn btn--secondary"
              }
              // Botão cinza sem explicação virava beco sem saída: o motivo
              // acompanha o controle, para leitor de tela e para quem vê.
              {...(missingProductionBase
                ? {
                    "aria-describedby": "create-cost-version-reason",
                    title: "Informe a base de produção para criar a estrutura.",
                  }
                : {})}
              disabled={saving || missingProductionBase || missingActiveFormulation}
              onClick={() => {
                // Criar versão grava documento com código, autor e data. Sem
                // confirmação, quem só queria olhar saía com uma V2 no banco.
                if (data.versions.length === 0) {
                  void run(() => {
                    const base = exigirDecimalOpcional(referenceQuantity, "Base de produção");
                    return createIndustrialCostVersion(
                      productId,
                      base ? { referenceOutputQuantity: base } : {},
                    );
                  });
                  return;
                }
                setNewVersionConfirm(true);
              }}
            >
              {data.versions.length === 0 ? "Criar estrutura de custos" : "Nova versão"}
            </button>
          )}
          {/* Partir de um template é alternativa a montar do zero, não ação
              principal: quem já tem estrutura raramente troca a base inteira. */}
          {canEdit && !missingActiveFormulation && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={saving}
              onClick={() => setUsarTemplate(true)}
            >
              Usar template
            </button>
          )}
          {canEdit && missingProductionBase && !missingActiveFormulation && (
            <p id="create-cost-version-reason" className="field__hint">
              Informe a base de produção para criar a estrutura.
            </p>
          )}

          {canEdit && missingActiveFormulation && (
            <p className="form-alert" role="status">
              Este produto ainda não tem formulação ativa, e a estrutura de custos parte dela.{" "}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/producao/formulacoes/${data.productId}`)}
              >
                Abrir formulação
              </button>
            </p>
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

        {/* Duas versões coexistindo: a que vale na produção e a que está sendo
            escrita. Sem este seletor, criar um rascunho escondia a ativa. */}
        {podeAlternar && (
          <div className="toolbar__scope">
            <button
              type="button"
              className={!lendoAtiva ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setLendoAtiva(false)}
            >
              Rascunho {data.draft?.label}
            </button>
            <button
              type="button"
              className={lendoAtiva ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setLendoAtiva(true)}
            >
              Ativa {data.current?.label}
            </button>
          </div>
        )}
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Materiais, recursos, energia e premissas são preenchidos aqui e só
            viram número na tela de CMV. Mesmo painel das duas telas: é um
            processo só, lido de pontos diferentes. */}
        <ContextHelp topic={helpTopics["cmv.comoFunciona"]} />

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

              <IndustrialCostPendencies
                pendencies={version.pendencies}
                productId={data.productId}
                onStructurePage
              />

              <CostTemplateOrigin
                version={version}
                productId={productId}
                canEdit={canEdit}
                onChanged={load}
              />

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
                            referenceOutputQuantity: exigirDecimal(
                              referenceQuantity,
                              "Base de produção",
                            ),
                          }),
                        )
                      }
                    >
                      Salvar base
                    </button>
                    {/* Rascunho SEGUE a receita ativa por padrão. Só fica para
                        trás quando o usuário escolheu outra versão de
                        propósito — e aí o caminho de volta precisa existir,
                        senão a fixação vira armadilha. */}
                    {version.formulationPinned && data.activeFormulationVersionId && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={saving}
                        title="Volta a acompanhar a formulação ativa do produto. As premissas e recursos informados aqui não são apagados."
                        onClick={() =>
                          void run(() =>
                            updateIndustrialCostVersion(version.id, {
                              formulationVersionId: data.activeFormulationVersionId!,
                            }),
                          )
                        }
                      >
                        Voltar a seguir a formulação ativa V
                        {data.activeFormulationVersionNumber}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--accent btn--sm"
                      disabled={saving}
                      onClick={() => {
                        if (!version.complete) {
                          setActivateConfirm(true);
                          return;
                        }
                        void run(() =>
                          activateIndustrialCostVersion(version.id, { confirmIncomplete: false }),
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
                        {/* A base do componente é enum no banco; na tela é
                            frase em português, como no editor de formulação. */}
                        <td>
                          {FORMULATION_COMPONENT_BASIS_LABELS[
                            material.basis as keyof typeof FORMULATION_COMPONENT_BASIS_LABELS
                          ] ?? material.basis}
                        </td>
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
              id="secao-premissas"
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
                          // Vazio segue sendo "não informado" — nunca zero.
                          const valor = exigirDecimalOpcional(rateValue, "Valor");
                          await createIndustrialCostLine(version.id, {
                            category,
                            description: description.trim(),
                            calculationBasis: basis,
                            ...(valor ? { rateValue: valor } : {}),
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
              id="secao-recursos"
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
                        canCreate={canCreateResource}
                        createLabel="Novo recurso"
                        onCreateNew={() =>
                          goCreate({
                            route: "/gestao/recursos-industriais/novo",
                            fieldKey: "usageResourceId",
                            entityType: "industrialResource",
                          })
                        }
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
                            usageQuantity: exigirDecimal(
                              usageQuantity,
                              "Consumo por lote de referência",
                            ),
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
              id="secao-energia"
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

        <ConfirmDialog
          open={newVersionConfirm}
          title="Criar uma nova versão da estrutura de custos?"
          confirmLabel="Criar versão"
          cancelLabel="Voltar"
          confirmTone="accent"
          message={
            <>
              <p>
                A nova versão nasce como <strong>rascunho</strong>, com código e autoria próprios,
                e passa a ser o que esta tela abre por padrão.
              </p>
              <p>
                A estrutura ativa continua valendo na produção e segue acessível pelo seletor de
                versões.
              </p>
              {formulacaoDefasada && (
                <p>
                  A nova versão nasce sobre a formulação ativa{" "}
                  <strong>V{data.activeFormulationVersionNumber}</strong> — esta usa a{" "}
                  <strong>V{version.formulationVersionNumber}</strong>.
                </p>
              )}
            </>
          }
          onCancel={() => setNewVersionConfirm(false)}
          onConfirm={() => {
            setNewVersionConfirm(false);
            setLendoAtiva(false);
            void run(() =>
              createIndustrialCostVersion(
                productId,
                referenceQuantity.trim()
                  ? { referenceOutputQuantity: referenceQuantity.trim() }
                  : {},
              ),
            );
          }}
        />

      {usarTemplate && (
        <UseCostTemplateDialog
          saving={saving}
          onCancel={() => setUsarTemplate(false)}
          onApply={(costTemplateVersionId) => {
            setUsarTemplate(false);
            setLendoAtiva(false);
            void run(() => applyCostTemplateToProduct(productId, costTemplateVersionId));
          }}
        />
      )}

      {version && (
        <ConfirmDialog
          open={activateConfirm}
          title="Ativar estrutura com pendências?"
          /* O rótulo repete a consequência. "Ativar" sozinho, num diálogo que
             a pessoa pode ter aberto sem ler, não distingue esta ativação da
             ativação normal — e as duas produzem custos muito diferentes. */
          confirmLabel="Ativar mesmo com pendências"
          confirmTone="accent"
          message={
            <>
              <p>
                Esta estrutura possui premissas de custo ainda não informadas. Ativar assim torna
                ela a base de custo vigente do produto, com as pendências que existem hoje.
              </p>
              <ul className="confirm-dialog__list">
                <li>
                  Estrutura: <span className="code">{version.label}</span>
                </li>
                <li>
                  Produto: <span className="code">{data.productCode}</span> {data.productName}
                </li>
              </ul>
              {/* Confirmar "com pendências" sem ver quais é decidir no escuro. */}
              <ul className="confirm-dialog__list">
                {version.pendencies
                  .filter((pendency) => pendency.severity === "BLOCKING")
                  .map((pendency, index) => (
                    <li key={`${pendency.code}-${index}`}>{pendency.description}</li>
                  ))}
              </ul>
            </>
          }
          onCancel={() => setActivateConfirm(false)}
          onConfirm={() => {
            setActivateConfirm(false);
            void run(() =>
              activateIndustrialCostVersion(version.id, { confirmIncomplete: true }),
            );
          }}
        />
      )}

    </>
  );
}
