import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  CmvComponentDTO,
  CmvGroup,
  IndustrialMaterialCostSource,
  PricingTierDTO,
  ProductCmvResponse,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import {
  CMV_GROUP_LABELS,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_QUALITY_HINTS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import { EntityLink } from "../../components/EntityLink";
import { IndustrialCostPendencies } from "../../components/IndustrialCostPendencies";
import { CostWarnings } from "../../components/CostWarnings";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { getProductCmv } from "../../lib/product-cmv-api";
import { getProductIndustrialCosts } from "../../lib/industrial-costs-api";
import {
  discardIndustrialCostCalculation,
  saveIndustrialCostCalculation,
} from "../../lib/cost-calculation-api";
import { getProductPricing } from "../../lib/pricing-api";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { CalcHint } from "../../components/help/CalcHint";
import { exigirDecimal } from "../../lib/decimal-field";
import { formatPercent } from "../../lib/percent";
import { formatDate } from "../../lib/dates";
import "./cmv.css";

/**
 * CMV — quanto custa produzir uma quantidade deste produto.
 *
 * A tela existe para responder uma pergunta de negócio em linguagem de
 * negócio. Quem usa fala em "produto", "quantidade" e "custo"; estrutura de
 * custos e cálculo de referência aparecem como procedência, não como
 * pré-requisito de vocabulário.
 *
 * Nenhum número é calculado aqui. Total, custo unitário, custo por mil,
 * contagem de lotes e composição vêm inteiros da API, que por sua vez usa o
 * mesmo motor das faixas de precificação. Simular é leitura: entrar nesta
 * tela não cria cálculo nem altera preço.
 */

const GROUP_ORDER: CmvGroup[] = [
  "FORMULA_MATERIAL",
  "PACKAGING",
  "CUSTOMER_SUPPLIED",
  "INDUSTRIAL_RESOURCE",
  "OVERHEAD",
];

/** Data de hoje como dia de calendário — a API exige a data explícita. */
function hojeISO(): string {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function qualityBadgeClass(quality: string): string {
  if (quality === "COMPLETE_REAL_REFERENCE") return "badge badge--active";
  if (quality === "COMPLETE_WITH_ESTIMATES") return "badge badge--neutral";
  if (quality === "PARTIAL") return "badge badge--warn";
  return "badge badge--err";
}

/**
 * Origem do valor da linha, em português.
 *
 * Material traz a fonte do custo; recurso e premissa trazem a natureza do
 * que está sendo cobrado. Nenhum dos dois aparece como enum cru.
 */
/**
 * Unidade como se lê, não como se guarda.
 *
 * Material traz a unidade de estoque, que já é humana ("kg", "un"). Recurso
 * industrial traz a unidade da tarifa, que é enum — e "HOUR" no meio de uma
 * tabela de custos é vocabulário de banco de dados, não de fábrica.
 */
function describeUnit(component: CmvComponentDTO): string {
  if (!component.unitCode) return "—";
  const tarifa =
    INDUSTRIAL_RATE_UOM_LABELS[
      component.unitCode as keyof typeof INDUSTRIAL_RATE_UOM_LABELS
    ];
  return tarifa ?? component.unitCode;
}

function describeOrigin(component: CmvComponentDTO): string {
  if (component.customerSupplied) return "Fornecido pelo cliente";
  if (component.costSource) {
    const label =
      INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[component.costSource as IndustrialMaterialCostSource];
    return label ?? component.costSource;
  }
  if (component.group === "INDUSTRIAL_RESOURCE") {
    const resource =
      INDUSTRIAL_RESOURCE_TYPE_LABELS[
        component.code as keyof typeof INDUSTRIAL_RESOURCE_TYPE_LABELS
      ];
    return resource ?? "Energia";
  }
  const basis =
    INDUSTRIAL_COST_BASIS_LABELS[component.code as keyof typeof INDUSTRIAL_COST_BASIS_LABELS];
  return basis ?? "—";
}

export function ProductCmvPage() {
  const navigate = useNavigate();
  const { productId } = useParams<{ productId: string }>();
  const [params] = useSearchParams();

  /*
   * Contexto de origem: quem chegou de um orçamento volta ao orçamento, não
   * a uma busca. Identidade vem por id — nunca por código de negócio, que
   * não é chave de navegação.
   */
  const projectId = params.get("projectId");
  const quoteVersionId = params.get("quoteVersionId");
  const quoteLineId = params.get("quoteLineId");

  const [quantity, setQuantity] = useState(params.get("quantity") ?? "1000");
  const [referenceDate, setReferenceDate] = useState(params.get("referenceDate") ?? hojeISO());
  const [data, setData] = useState<ProductCmvResponse | null>(null);
  const [tier, setTier] = useState<PricingTierDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detalhe, setDetalhe] = useState<"frozen" | "live">("frozen");
  const [salvandoBase, setSalvandoBase] = useState(false);
  /*
   * A estrutura só é buscada para EXPLICAR uma resposta vazia. Nenhum número
   * desta tela vem daqui — o CMV continua saindo inteiro de um endpoint só.
   */
  const [pendencyVersion, setPendencyVersion] = useState<
    ProductIndustrialCostResponse["current"] | null
  >(null);

  useEffect(() => {
    if (!productId) return;
    let ativo = true;
    getProductIndustrialCosts(productId)
      .then((estrutura) => {
        if (!ativo) return;
        const current = estrutura.current;
        setPendencyVersion(
          current && !current.complete ? current : (current ? null : (estrutura.draft ?? null)),
        );
      })
      .catch(() => {
        if (ativo) setPendencyVersion(null);
      });
    return () => {
      ativo = false;
    };
  }, [productId]);

  const simular = useCallback(
    async (quantidade: string, data_: string) => {
      if (!productId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getProductCmv(productId, {
          // A simulação é sempre disparada com o que está no campo: a
          // vírgula é lida aqui, e o que não dá para ler nomeia o campo em
          // vez de virar "Falha ao calcular o CMV".
          quantity: exigirDecimal(quantidade, "Quantidade a simular"),
          referenceDate: data_,
        });
        setData(result);
        /*
         * Economia da faixa (contribuição, comissão, markup) é calculada
         * pela Precificação e lida daqui como está. Refazer a conta no React
         * criaria uma segunda verdade econômica sobre o mesmo preço.
         */
        setTier(null);
        if (result.pricing?.tierId) {
          const pricing = await getProductPricing(productId).catch(() => null);
          const encontrada = pricing?.current?.tiers.find(
            (candidata) => candidata.id === result.pricing?.tierId,
          );
          setTier(encontrada ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao calcular o CMV");
        // Erro de quantidade não muda de produto: apagar a resposta anterior
        // trocava o título por "CMV · —" e dava a impressão de ter saído da
        // tela. O que precisa sumir é o resultado, não a identidade.
        setData((atual) => (atual ? { ...atual, simulation: null } : null));
      } finally {
        setLoading(false);
      }
    },
    [productId],
  );

  // A quantidade que veio no link já é a pergunta: calcular sozinho evita
  // pedir um clique para repetir algo que a pessoa já disse.
  useEffect(() => {
    void simular(params.get("quantity") ?? "1000", params.get("referenceDate") ?? hojeISO());
    // Uma vez por produto: recalcular a cada tecla digitada é o oposto de
    // "informe a quantidade e mande calcular".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simular]);

  if (!productId) return <p className="form-alert" role="alert">Produto não informado.</p>;

  const simulation = data?.simulation ?? null;
  const componentsByGroup = (group: CmvGroup): CmvComponentDTO[] =>
    componentesVisiveis.filter((component) => component.group === group);

  const semTotal = simulation !== null && simulation.totalCost === null;
  const live = data?.live ?? null;
  /*
   * Qual composição a tabela detalha. O RESUMO dos dois nunca some da tela —
   * trocar o número congelado pelo vivo lá em cima reintroduziria o problema
   * de reprodutibilidade em forma visual. Aqui só o detalhe alterna, e o
   * título sempre diz qual está aberto.
   */
  const composicaoViva = detalhe === "live" && live !== null;
  const componentesVisiveis = composicaoViva ? live!.components : (simulation?.components ?? []);
  /* A base econômica ficou para trás da receita ativa. */
  const formulacaoDefasada =
    data?.basisFormulationVersionNumber != null &&
    data.formulationVersionNumber != null &&
    data.basisFormulationVersionNumber !== data.formulationVersionNumber;

  /*
   * A base congelada está atrás do estado atual quando algum aviso dela já
   * não aparece na simulação de hoje — a mesma leitura que decide o texto de
   * "já está resolvido" — ou quando a receita mudou.
   */
  const baseDefasada =
    (simulation?.warnings ?? []).some((warning) => warning.target === "STALE_BASIS") ||
    formulacaoDefasada;

  /** Congela o estado atual como a nova base econômica do produto. */
  async function salvarNovaBase() {
    if (!productId || !data?.industrialCostVersionId) return;
    setSalvandoBase(true);
    setError(null);
    try {
      await saveIndustrialCostCalculation(data.industrialCostVersionId, {
        costReferenceDate: new Date(`${referenceDate}T12:00:00`).toISOString(),
      });
      await simular(quantity.trim(), referenceDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao congelar a base");
    } finally {
      setSalvandoBase(false);
    }
  }

  /** Descarta a base antiga — recusado se alguma precificação a cita. */
  async function descartarBase() {
    if (!data?.calculationId) return;
    setSalvandoBase(true);
    setError(null);
    try {
      await discardIndustrialCostCalculation(data.calculationId);
      await simular(quantity.trim(), referenceDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao descartar o cálculo");
    } finally {
      setSalvandoBase(false);
    }
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Produtos", href: "/cadastros/produtos" }, { label: "CMV" }]} />
          <div className="doc-title">
            <h1>
              CMV ·{" "}
              <EntityLink kind="product" id={productId} code={data?.productCode ?? ""} />{" "}
              {data?.productName}
            </h1>
            {simulation && (
              <span
                className={qualityBadgeClass(simulation.quality)}
                title={INDUSTRIAL_COST_QUALITY_HINTS[simulation.quality]}
              >
                {INDUSTRIAL_COST_QUALITY_LABELS[simulation.quality]}
              </span>
            )}
          </div>
          {data?.customerName && <p className="field__hint">Cliente: {data.customerName}</p>}
        </div>
        <div className="table__actions">
          {/* Só faz sentido imprimir o que existe: sem base congelada o papel
              sairia com um documento vazio dizendo ser um CMV. */}
          {data?.calculationId && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() =>
                navigate(
                  `/print/cmv/${productId}?quantity=${encodeURIComponent(
                    quantity.trim(),
                  )}&referenceDate=${referenceDate}`,
                )
              }
            >
              Imprimir / Salvar PDF
            </button>
          )}
          {/* Voltar ao orçamento tem prioridade: é de lá que a pessoa veio. */}
          {projectId && quoteVersionId ? (
            <Link
              className="btn btn--ghost btn--sm"
              to={`/comercial/projetos/${projectId}?quoteVersionId=${quoteVersionId}${
                quoteLineId ? `&quoteLineId=${quoteLineId}` : ""
              }`}
            >
              ← Voltar ao orçamento
            </Link>
          ) : projectId ? (
            <Link className="btn btn--ghost btn--sm" to={`/comercial/projetos/${projectId}`}>
              ← Voltar ao projeto
            </Link>
          ) : (
            /* Sem contexto no link, resta a origem registrada no produto —
               que pode não existir, e aí não se inventa caminho de volta. */
            <ProjectOriginLink productId={productId} />
          )}
        </div>
      </div>

      {/* Mesma posição das telas irmãs (Custos, Precificação): logo abaixo do
          cabeçalho. No rodapé, quem terminava de ler a composição não via
          que havia caminho para as outras telas do produto. */}
      <ProductRelatedLinks productId={productId} current="cmv" title="Ver do produto" />

      <div className="doc-body">
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}

        {/* O número desta tela é a soma de coisas decididas em outras (receita,
            recursos, tarifas). Sem dizer de onde ele vem, "CMV indisponível"
            parece defeito da tela em vez de custo que ninguém informou. */}
        <ContextHelp topic={helpTopics["cmv.comoFunciona"]} />

        <FormSection
          title="Custo industrial de uma quantidade"
          subtitle="Informe quantas unidades deseja produzir. O custo é recalculado para essa quantidade — não é o custo unitário multiplicado."
        >
          <div className="cmv-sim">
            <div className="field field--narrow">
              <label htmlFor="cmv-quantity">Quantidade a simular</label>
              <input
                id="cmv-quantity"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <p className="field__hint">Unidade: {data?.outputUomCode ?? "un"}</p>
            </div>
            <div className="field field--narrow">
              <label htmlFor="cmv-reference-date">Data de referência</label>
              <input
                id="cmv-reference-date"
                type="date"
                value={referenceDate}
                onChange={(event) => setReferenceDate(event.target.value)}
              />
              <p className="field__hint">
                Define qual cálculo de custo serve de base econômica.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--accent"
              disabled={loading || quantity.trim() === ""}
              onClick={() => void simular(quantity.trim(), referenceDate)}
            >
              {loading ? "Calculando…" : "Calcular CMV"}
            </button>
          </div>

          {data?.unavailableReason && (
            <p className="form-alert" role="status">
              {data.unavailableReason}
            </p>
          )}

          {/* "Não há custo" precisa vir com o que falta para haver — senão a
              tela informa o problema e esconde a saída. */}
          {data?.unavailableReason && pendencyVersion && productId && (
            <IndustrialCostPendencies
              pendencies={pendencyVersion.pendencies}
              productId={productId}
            />
          )}

          {simulation && (
            <>
              <div className="cmv-cards">
                <div className="cmv-card">
                  <div className="cmv-card__label">Quantidade simulada</div>
                  <div className="cmv-card__value">
                    {formatQuantity(simulation.quantity)} {simulation.uomCode}
                  </div>
                  <div className="cmv-card__note">
                    {simulation.batchCount}{" "}
                    {simulation.batchCount === "1" ? "lote de referência" : "lotes de referência"}{" "}
                    {/*
                      O número de lotes é TETO, não proporção: pedir 1,1 lote
                      custa dois lotes inteiros. É o único número desta tela
                      que o operador não consegue deduzir olhando os outros, e
                      é o que explica um custo que "pulou" sem a quantidade ter
                      mudado muito.
                    */}
                    <CalcHint
                      label="Lotes de referência"
                      operandos={[
                        { valor: formatQuantity(simulation.quantity), papel: `quantidade pedida em ${simulation.uomCode}` },
                        { valor: formatQuantity(data?.referenceOutputQuantity ?? "0"), papel: "lote de referência", operador: "÷" },
                      ]}
                      resultado={`${simulation.batchCount} (arredondado para cima)`}
                      nota="Um lote parcial custa um lote inteiro: a fábrica não produz meia batelada. Por isso o custo sobe em degraus, não continuamente."
                    />
                  </div>
                </div>

                <div className="cmv-card cmv-card--strong">
                  <div className="cmv-card__label">CMV total</div>
                  {simulation.totalCost ? (
                    <div className="cmv-card__value">{formatBRL(simulation.totalCost)}</div>
                  ) : (
                    <div className="cmv-card__value cmv-card__value--unavailable">
                      CMV indisponível
                    </div>
                  )}
                  {semTotal && (
                    <div className="cmv-card__note">
                      Subtotal conhecido: {formatBRL(simulation.knownSubtotal)}
                    </div>
                  )}
                </div>

                <div className="cmv-card">
                  <div className="cmv-card__label">CMV por unidade</div>
                  <div className="cmv-card__value">
                    {simulation.costPerUnit ? formatBRL(simulation.costPerUnit) : "—"}
                  </div>
                  {simulation.costPerUnit && simulation.totalCost && (
                    <CalcHint
                      label="CMV por unidade"
                      operandos={[
                        { valor: formatBRL(simulation.totalCost), papel: "CMV total" },
                        { valor: formatQuantity(data?.referenceOutputQuantity ?? simulation.quantity), papel: "unidades do lote de referência", operador: "÷" },
                      ]}
                      resultado={formatBRL(simulation.costPerUnit)}
                      nota="Divide pelo LOTE DE REFERÊNCIA, não pela quantidade simulada — é o custo de produzir uma unidade na batelada padrão."
                    />
                  )}
                </div>

                <div className="cmv-card">
                  <div className="cmv-card__label">CMV por 1.000</div>
                  <div className="cmv-card__value">
                    {simulation.costPer1000 ? formatBRL(simulation.costPer1000) : "—"}
                  </div>
                  {simulation.costPerUnit && simulation.costPer1000 && (
                    <CalcHint
                      label="CMV por 1.000"
                      operandos={[
                        { valor: formatBRL(simulation.costPerUnit), papel: "CMV por unidade" },
                        { valor: "1.000", papel: "unidades" },
                      ]}
                      resultado={formatBRL(simulation.costPer1000)}
                      esperado={Number(simulation.costPerUnit) * 1000}
                    />
                  )}
                </div>

                {/* O cartão diz o veredito; a explicação inteira mora no
                    rótulo do cabeçalho, para não esticar a fileira toda. */}
                <div className="cmv-card" title={INDUSTRIAL_COST_QUALITY_HINTS[simulation.quality]}>
                  <div className="cmv-card__label">Qualidade do custo</div>
                  <div className="cmv-card__value cmv-card__value--text">
                    {INDUSTRIAL_COST_QUALITY_LABELS[simulation.quality]}
                  </div>
                </div>

                {data?.pricing?.unitPrice && (
                  <div className="cmv-card">
                    <div className="cmv-card__label">Preço vigente</div>
                    <div className="cmv-card__value">{formatUnitPriceBRL(data.pricing.unitPrice)}</div>
                    <div className="cmv-card__note">
                      Faixa de {formatQuantity(data.pricing.tierQuantity)} {simulation.uomCode}
                    </div>
                  </div>
                )}
              </div>

              {/* Parcial não vira total: dizer o subtotal como se fosse o custo
                  seria informar um número menor que o real. */}
              {simulation.quality === "PARTIAL" && (
                <p className="field__hint">
                  Existem componentes sem custo conhecido. O subtotal conhecido não representa o
                  CMV total.
                </p>
              )}

              <CostWarnings
                warnings={simulation.warnings}
                title="Observações do cálculo"
                productId={productId}
              />
            </>
          )}
        </FormSection>

        {/* Preço só aparece para quem pode ver economia interna: a API decide,
            a tela apenas desenha o que recebeu. */}
        {data?.pricing && (
          <FormSection
            title="Precificação vigente"
            subtitle="Faixa é negociação registrada para uma quantidade exata — o sistema nunca interpola nem aproxima."
          >
            {data.pricing.tierId ? (
              <>
                <dl className="definition-list cmv-defs">
                  <dt>Faixa</dt>
                  <dd>
                    {formatQuantity(data.pricing.tierQuantity)} {data.outputUomCode}
                  </dd>
                  <dt>Preço</dt>
                  <dd>
                    {formatUnitPriceBRL(data.pricing.unitPrice)} / {data.outputUomCode}
                  </dd>
                  <dt>CMV por unidade</dt>
                  <dd>{simulation?.costPerUnit ? formatBRL(simulation.costPerUnit) : "—"}</dd>
                  {tier && (
                    <>
                      <dt>Margem de contribuição</dt>
                      <dd>
                        {tier.contributionPerUnit ? formatBRL(tier.contributionPerUnit) : "—"}
                        {tier.contributionMarginPercent
                          ? ` · ${formatPercent(tier.contributionMarginPercent)}`
                          : ""}
                      </dd>
                      <dt>Comissão</dt>
                      <dd>
                        {tier.commissionPerUnit ? formatBRL(tier.commissionPerUnit) : "—"}
                        {` · ${formatPercent(tier.commissionPercent)}`}
                      </dd>
                      <dt>Markup</dt>
                      <dd>{formatPercent(tier.markupPercent)}</dd>
                    </>
                  )}
                </dl>
                <p className="field__hint">
                  Margem, comissão e markup vêm calculados da Precificação — esta tela não refaz a
                  conta.
                </p>
                {/* O preço vigente foi fechado sobre o cálculo daquele momento.
                    Se aquela base era incompleta, a margem exibida ao lado de um
                    CMV completo passa confiança que ela não tem. */}
                {tier && tier.costQuality !== simulation?.quality && (
                  <p className="form-alert" role="status">
                    Esta faixa foi definida sobre um custo industrial{" "}
                    {INDUSTRIAL_COST_QUALITY_LABELS[tier.costQuality].toLowerCase()}, diferente da
                    base usada nesta simulação. Para comparar preço e custo na mesma realidade
                    econômica, crie uma precificação a partir do cálculo atual em{" "}
                    {/* O aviso aponta a tela que TEM a ação: precificação nasce
                        de um cálculo salvo, na estrutura de custos. Mandar para
                        a lista de precificação seria prometer um botão que não
                        existe lá. */}
                    <Link to={`/produtos/${productId}/custos`}>
                      Custos industriais → Cálculos salvos
                    </Link>
                    .
                  </p>
                )}
              </>
            ) : (
              <p className="field__hint">
                Não existe uma faixa de precificação ativa para {simulation?.quantity ?? quantity}{" "}
                {data.outputUomCode}.
                {data.pricing.availableQuantities.length > 0 && (
                  <>
                    {" "}
                    Faixas vigentes: {data.pricing.availableQuantities.join(", ")}.
                  </>
                )}
              </p>
            )}
            <div className="line-actions">
              <Link
                className="btn btn--secondary btn--sm"
                to={`/gestao/precificacao?productId=${productId}`}
              >
                Abrir precificação
              </Link>
            </div>
          </FormSection>
        )}

        {/* A base congelada ficou para trás do que já se sabe. Enquanto
            nenhuma precificação a cita, insistir nela é conviver com um
            retrato errado — a saída fica aqui, sem atravessar duas telas. */}
        {baseDefasada && data?.industrialCostVersionId && (
          <div className="line-actions">
            <button
              type="button"
              className="btn btn--accent btn--sm"
              disabled={salvandoBase || loading}
              onClick={() => void salvarNovaBase()}
            >
              {salvandoBase ? "Congelando…" : "Congelar uma base nova com estes dados"}
            </button>
            {data.calculationId && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={salvandoBase || loading}
                title="Só é possível enquanto nenhuma precificação cita este cálculo."
                onClick={() => void descartarBase()}
              >
                Descartar {data.calculationCode}
              </button>
            )}
          </div>
        )}

        {/* Enquanto o produto está sendo definido não há compromisso a
            proteger, e congelar vira atrito: a receita já mudou, o custo do
            material já foi informado, e o CMV mostrava o retrato de outro dia.
            Este bloco responde com o que se sabe agora — e NUNCA substitui o
            congelado acima, que é o que se consegue repetir. */}
        {live && (
          <FormSection
            title="Com os dados de hoje"
            subtitle="Simulação sobre as premissas correntes. Não é base econômica: orçamento e ordem de produção continuam lendo o cálculo congelado."
          >
            <p className="field__hint">
              Estrutura{" "}
              <Link to={`/produtos/${productId}/custos`}>{live.industrialCostVersionLabel}</Link>
              {live.industrialCostVersionStatus === "DRAFT" ? " (rascunho)" : " (ativa)"} ·
              formulação{" "}
              <Link to={`/producao/formulacoes/${productId}`}>V{live.formulationVersionNumber}</Link>{" "}
              · custos de {formatDate(live.costReferenceDate)}
            </p>

            <div className="cmv-cards">
              <div className="cmv-card cmv-card--strong">
                <div className="cmv-card__label">CMV total hoje</div>
                {live.totalCost ? (
                  <div className="cmv-card__value">{formatBRL(live.totalCost)}</div>
                ) : (
                  <div className="cmv-card__value cmv-card__value--unavailable">
                    CMV indisponível
                  </div>
                )}
                <div className="cmv-card__note">
                  Subtotal conhecido: {formatBRL(live.knownSubtotal)}
                </div>
              </div>
              <div className="cmv-card">
                <div className="cmv-card__label">Por unidade</div>
                <div className="cmv-card__value">
                  {live.costPerUnit ? formatBRL(live.costPerUnit) : "—"}
                </div>
              </div>
              <div className="cmv-card" title={INDUSTRIAL_COST_QUALITY_HINTS[live.quality]}>
                <div className="cmv-card__label">Qualidade do custo</div>
                <div className="cmv-card__value cmv-card__value--text">
                  {INDUSTRIAL_COST_QUALITY_LABELS[live.quality]}
                </div>
              </div>
            </div>

            <CostWarnings
              warnings={live.warnings}
              title="Observações da simulação"
              productId={productId}
            />
          </FormSection>
        )}

        {(simulation || live) && (
          <FormSection
            title="Composição do custo"
            subtitle={
              composicaoViva
                ? `Detalhando a SIMULAÇÃO de hoje — ${live!.industrialCostVersionLabel}, formulação V${live!.formulationVersionNumber}.`
                : data?.calculationCode
                  ? `Detalhando a base congelada — ${data.calculationCode}, formulação V${data.basisFormulationVersionNumber ?? "—"}.`
                  : "De onde vem cada real do custo desta quantidade."
            }
          >
            {/* Os dois resumos continuam visíveis acima; aqui alterna só o
                detalhe, e o subtítulo sempre nomeia qual está aberto. */}
            {simulation && live && (
              <div className="line-actions">
                <button
                  type="button"
                  className={
                    detalhe === "frozen" ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"
                  }
                  onClick={() => setDetalhe("frozen")}
                >
                  Base congelada
                </button>
                <button
                  type="button"
                  className={
                    detalhe === "live" ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"
                  }
                  onClick={() => setDetalhe("live")}
                >
                  Dados de hoje
                </button>
              </div>
            )}
            {GROUP_ORDER.map((group) => {
              const rows = componentsByGroup(group);
              if (rows.length === 0) return null;
              return (
                <div className="cmv-group" key={group}>
                  <h4 className="cmv-group__title">{CMV_GROUP_LABELS[group]}</h4>
                  {group === "CUSTOMER_SUPPLIED" && (
                    <p className="field__hint">
                      Não compõe o custo de aquisição Veridi. A quantidade física continua sendo
                      necessária para produzir.
                    </p>
                  )}
                  <div className="table-container">
                    {/* Largura fixa e compartilhada: as quatro tabelas mostram
                        as MESMAS colunas do mesmo cálculo, e deixá-las se
                        dimensionar sozinhas fazia "Custo total" cair num lugar
                        diferente em cada bloco — o olho perde a coluna ao
                        descer a página. */}
                    <table className="table cmv-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="is-numeric">Quantidade</th>
                          <th>Unidade</th>
                          <th>Origem do custo</th>
                          <th className="is-numeric">Custo unitário</th>
                          <th className="is-numeric">Custo total</th>
                          <th>Fornecimento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((component, index) => (
                          <tr key={`${group}-${component.itemId ?? component.code}-${index}`}>
                            <td>
                              {component.itemId ? (
                                <EntityLink
                                  kind="item"
                                  id={component.itemId}
                                  code={component.code}
                                  name={component.name}
                                />
                              ) : (
                                component.name
                              )}
                            </td>
                            <td className="is-numeric">{component.requiredQuantity ?? "—"}</td>
                            <td>{describeUnit(component)}</td>
                            <td>{describeOrigin(component)}</td>
                            <td className="is-numeric">
                              {component.unitCost ? formatBRL(component.unitCost) : "—"}
                            </td>
                            <td className="is-numeric">
                              {component.totalCost ? formatBRL(component.totalCost) : "—"}{" "}
                              {component.totalCost && component.unitCost && component.requiredQuantity && (
                                <CalcHint
                                  label={`Custo de ${component.code}`}
                                  operandos={[
                                    { valor: formatQuantity(component.requiredQuantity), papel: `quantidade em ${component.unitCode ?? "un"}` },
                                    { valor: formatBRL(component.unitCost), papel: "custo unitário" },
                                  ]}
                                  resultado={formatBRL(component.totalCost)}
                                  esperado={Number(component.requiredQuantity) * Number(component.unitCost)}
                                  nota={describeOrigin(component)}
                                />
                              )}
                              {/*
                                Material do cliente entra na estrutura física e
                                NUNCA no custo de aquisição. "Não aplicável" não
                                é zero, e a diferença some se a célula ficar só
                                com um travessão.
                              */}
                              {component.customerSupplied && !component.totalCost && (
                                <CalcHint
                                  label={`Custo de ${component.code}`}
                                  operandos={[
                                    { valor: formatQuantity(component.requiredQuantity ?? "0"), papel: `quantidade em ${component.unitCode ?? "un"}` },
                                  ]}
                                  resultado="não aplicável"
                                  nota="Material fornecido pelo cliente: a Veridi não o comprou, então não há custo de aquisição. Isto não é custo zero nem custo desconhecido — a quantidade entra na necessidade física, na reserva, no consumo e na rastreabilidade."
                                />
                              )}
                            </td>
                            <td>{component.customerSupplied ? "Cliente" : "Veridi"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </FormSection>
        )}

        {/* Procedência do número — e cada documento abre.
            A formulação listada aqui era a ATIVA do produto, não a que o
            cálculo congelou. Com uma receita nova publicada, a tela dizia
            "V2" ao lado de uma composição que descrevia a V1, e um item
            removido continuava na lista sem nenhuma explicação possível. */}
        <FormSection
          title="Base do cálculo"
          subtitle="De quais documentos estes números falam. A base econômica é congelada quando a estrutura é ativada — não é o estado de hoje."
        >
          <dl className="definition-list cmv-defs">
            <dt>Formulação usada</dt>
            <dd>
              {data?.basisFormulationVersionNumber ? (
                <Link to={`/producao/formulacoes/${productId}`}>
                  V{data.basisFormulationVersionNumber}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Estrutura de custos</dt>
            <dd>
              {data?.industrialCostVersionId ? (
                <Link to={`/produtos/${productId}/custos`}>
                  {data.industrialCostVersionLabel}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Base de produção</dt>
            <dd>
              {data?.referenceOutputQuantity
                ? `${formatQuantity(data.referenceOutputQuantity)} ${data.referenceOutputUomCode ?? ""}`
                : "—"}
            </dd>
            <dt>Cálculo de referência</dt>
            <dd>
              {data?.calculationId ? (
                <Link to={`/calculos-custo/${data.calculationId}`}>
                  <span className="code">{data.calculationCode}</span>
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Data do cálculo</dt>
            <dd>{formatDate(data?.calculationReferenceDate)}</dd>
          </dl>

          {formulacaoDefasada && (
            <div className="cmv-warnings" role="status">
              <strong>
                Este CMV descreve a formulação V{data!.basisFormulationVersionNumber}, não a V
                {data!.formulationVersionNumber} que está ativa
              </strong>
              <p>
                A estrutura de custos ativa congelou a receita da qual foi feita — publicar uma
                formulação nova não reescreve uma base econômica em uso. Por isso itens removidos
                na V{data!.formulationVersionNumber} continuam aparecendo na composição acima.
              </p>
              <p>
                Para o CMV passar a falar da V{data!.formulationVersionNumber}, crie uma nova
                versão da estrutura sobre ela e ative:{" "}
                <Link to={`/produtos/${productId}/custos`}>abrir a estrutura de custos</Link>.
              </p>
            </div>
          )}
        </FormSection>
      </div>
    </>
  );
}
