import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { EntityLink } from "../../components/EntityLink";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import type { PriceMode, PricingRebasePreviewDTO, PricingVersionDTO } from "@veridi/shared";
import {
  COMMISSION_BASE_DESCRIPTION,
  CONTRIBUTION_DEFINITION,
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  PRICE_MODES,
  PRICING_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import { CostQualityBadge, formatUnitCost } from "../../components/CostBreakdown";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FormSection } from "../../components/FormSection";
import { RowActions } from "../../components/RowActions";
import { useAuth } from "../../app/AuthProvider";
import { formatBRL } from "../../lib/currency";
import {
  activatePricingVersion,
  createPricingTier,
  deletePricingTier,
  getPricingRebasePreview,
  rebasePricingVersion,
  getPricingVersion,
} from "../../lib/pricing-api";
import { formatDate } from "../../lib/dates";
import { formatPercent } from "../../lib/percent";
import { PricingPolicyOrigin } from "../cost-templates/PricingPolicyOrigin";

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "INACTIVE") return "badge badge--neutral";
  return "badge badge--warn";
}

/**
 * Simulador de preço, margem e faixas de quantidade.
 *
 * Cada faixa é um cenário de quantidade com custo próprio: custo fixo por
 * lote, caixa inteira e recurso por lote não diluem linearmente, então o
 * custo unitário muda entre faixas. Nada é calculado no navegador — a tela
 * envia os inputs e desenha o que o backend responde.
 */
/** Data no diff sai como data; o resto sai como veio. */
function formatarMudanca(label: string, valor: string): string {
  return label.toLowerCase().includes("data") ? formatDate(valor) : valor;
}

export function PricingPage() {
  const { pricingId } = useParams<{ pricingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [pricing, setPricing] = useState<PricingVersionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activateConfirm, setActivateConfirm] = useState(false);
  const [rebase, setRebase] = useState<PricingRebasePreviewDTO | null>(null);
  const [verRebase, setVerRebase] = useState(false);

  const [quantity, setQuantity] = useState("");
  const [priceMode, setPriceMode] = useState<PriceMode>("TARGET_MARGIN");
  const [targetMargin, setTargetMargin] = useState("30");
  const [commission, setCommission] = useState("5");
  const [manualPrice, setManualPrice] = useState("");

  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";

  const load = useCallback(() => {
    if (!pricingId) return;
    getPricingVersion(pricingId)
      .then(setPricing)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a precificação"),
      );
    // Leitura à parte: saber se existe custo mais novo não pode impedir a
    // tela de abrir, e quem não pode ver economia interna nem recebe.
    getPricingRebasePreview(pricingId)
      .then(setRebase)
      .catch(() => setRebase(null));
  }, [pricingId]);

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

  if (error && !pricing) return <p className="form-alert">{error}</p>;
  if (!pricing) return <p>Carregando…</p>;

  const editable = canEdit && pricing.status === "DRAFT";
  const incompleteCost = pricing.tiers.some(
    (tier) => tier.costQuality === "PARTIAL" || tier.costQuality === "NO_COST",
  );

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Gestão / Precificação</div>
          <div className="doc-title">
            <h1>
              <EntityLink kind="product" id={pricing.productId} code={pricing.productCode} /> ·{" "}
              {pricing.productName}
            </h1>
            <span className="code">{pricing.label}</span>
            <span className={statusBadgeClass(pricing.status)}>
              {PRICING_VERSION_STATUS_LABELS[pricing.status]}
            </span>
            <CostQualityBadge quality={pricing.costQuality} />
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/print/precificacao/${pricing.id}`)}
          >
            Imprimir / Salvar PDF
          </button>
          <ProjectOriginLink productId={pricing.productId} />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/produtos/${pricing.productId}/custos`)}
          >
            ← Custos do produto
          </button>
        </div>
      </div>

      <div className="doc-body">
      <ProductRelatedLinks productId={pricing.productId} current="pricing" />
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Base de custo"
          subtitle={
            pricing.status === "DRAFT"
              ? "Todas as faixas desta versão compartilham a mesma base econômica. Enquanto for rascunho, a base pode ser trocada por um cálculo mais recente."
              : "Todas as faixas desta versão compartilham a mesma base econômica. Custo novo exige um novo cálculo e uma nova versão."
          }
        >
          <dl className="definition-list">
            <dt>Cliente</dt>
            <dd>{pricing.customerName ?? "—"}</dd>
            <dt>Cálculo de custo</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/calculos-custo/${pricing.industrialCostCalculationId}`)}
              >
                {pricing.calculationCode}
              </button>
            </dd>
            <dt>Estrutura de custos</dt>
            <dd>{pricing.industrialCostVersionLabel}</dd>
            <dt>Formulação</dt>
            <dd>V{pricing.formulationVersionNumber}</dd>
            <dt>Data de referência do custo</dt>
            <dd>{formatDate(pricing.costReferenceDate)}</dd>
            <dt>Qualidade do custo</dt>
            <dd>{INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality]}</dd>
            <dt>Base de produção da estrutura</dt>
            <dd>
              {pricing.referenceOutputQuantity} {pricing.referenceOutputUomCode}
            </dd>
            <dt>Lote mínimo do produto</dt>
            <dd>{pricing.minimumBatchQuantity ?? "—"}</dd>
          </dl>

          <PricingPolicyOrigin version={pricing} canEdit={canEdit} onChanged={load} />

          {/* Refazer sobre o custo vigente era instrução para outras duas
              telas, sem dizer o que a troca faria com os números. A decisão
              precisa do diff antes: uma base nova pode mexer só na data ou
              pode dobrar o custo por unidade. */}
          {rebase && rebase.targetCalculationId && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setVerRebase(true)}
              >
                {rebase.mode === "IN_PLACE"
                  ? `Trocar a base pelo custo atual (${rebase.targetCalculationCode})`
                  : `Ver o que muda com o custo atual (${rebase.targetCalculationCode})`}
              </button>
            </div>
          )}

          {/* Preço fechado sobre custo incompleto continua sendo preço válido —
              foi acordado assim. O que não pode é a tela deixar isso implícito
              e depois o CMV do mesmo produto aparecer "Completo" ao lado, sem
              ninguém entender a diferença. */}
          {(pricing.costQuality === "PARTIAL" || pricing.costQuality === "NO_COST") && (
            <p className="form-alert" role="status">
              {/* Rascunho não foi acordado com ninguém: falar em "preço fechado"
                  e mandar criar outra versão descrevia o estado errado e
                  escondia a saída, que é trocar a base aqui mesmo. */}
              {pricing.status === "DRAFT" ? (
                <>
                  A base deste rascunho está{" "}
                  {INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality].toLowerCase()} — por isso
                  margem e markup aparecem como "—" nas faixas. Resolva as pendências em{" "}
                  <Link to={`/produtos/${pricing.productId}/custos`}>Custos industriais</Link> e
                  salve um cálculo novo; ele aparece aqui como troca de base.
                </>
              ) : (
                <>
                  Esta precificação foi fechada sobre{" "}
                  {INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality].toLowerCase()} — por isso
                  margem e markup aparecem como "—" nas faixas. Um cálculo de custo mais completo
                  do mesmo produto não muda esta versão: preço acordado não se reescreve. Para
                  precificar sobre a base atual, crie uma nova versão — o botão acima mostra o que
                  muda antes de decidir, ou abra{" "}
                  <Link to={`/produtos/${pricing.productId}/custos`}>
                    Custos industriais → Cálculos salvos
                  </Link>
                  .
                </>
              )}
            </p>
          )}

          {pricing.hasCustomerSuppliedMaterials && (
            <p className="field__hint">
              Contém material fornecido pelo cliente, que não entra no custo Veridi.
            </p>
          )}
          {pricing.warnings.map((warning, index) => (
            <p key={`${index}-${warning.code}`} className="field__hint">
              {warning.message}
            </p>
          ))}
        </FormSection>

        <FormSection
          title="Faixas de quantidade"
          subtitle={`${CONTRIBUTION_DEFINITION} ${COMMISSION_BASE_DESCRIPTION}`}
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="is-numeric">Quantidade</th>
                  <th>Lotes</th>
                  <th className="is-numeric">Custo total</th>
                  <th className="is-numeric">Custo/un</th>
                  <th>Qualidade</th>
                  <th>Modo</th>
                  <th className="is-numeric">Margem alvo</th>
                  <th className="is-numeric">Comissão</th>
                  <th className="is-numeric">Preço sugerido</th>
                  <th className="is-numeric">Preço escolhido</th>
                  <th className="is-numeric">Margem resultante</th>
                  <th>Markup</th>
                  <th>Contribuição/un</th>
                  <th>Receita</th>
                  <th>Contribuição total</th>
                  {editable && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {pricing.tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td className="is-numeric">
                      {tier.quantity} {tier.uomCode}
                    </td>
                    <td>{tier.batchCount}</td>
                    <td className="is-numeric">
                      {tier.industrialCostTotal === null
                        ? `${formatBRL(tier.knownSubtotal)} (subtotal conhecido)`
                        : formatBRL(tier.industrialCostTotal)}
                    </td>
                    <td className="is-numeric">{formatUnitCost(tier.industrialCostPerUnit)}</td>
                    <td>{INDUSTRIAL_COST_QUALITY_LABELS[tier.costQuality]}</td>
                    <td>{PRICE_MODE_LABELS[tier.priceMode]}</td>
                    <td className="is-numeric">{formatPercent(tier.targetContributionMarginPercent)}</td>
                    <td className="is-numeric">{formatPercent(tier.commissionPercent)}</td>
                    <td className="is-numeric">{formatUnitCost(tier.suggestedUnitPrice)}</td>
                    <td className="is-numeric">{formatUnitCost(tier.selectedUnitPrice)}</td>
                    <td className="is-numeric">{formatPercent(tier.contributionMarginPercent)}</td>
                    <td>{formatPercent(tier.markupPercent)}</td>
                    <td>{formatUnitCost(tier.contributionPerUnit)}</td>
                    <td>{tier.grossRevenue === null ? "—" : formatBRL(tier.grossRevenue)}</td>
                    <td>
                      {tier.contributionTotal === null ? "—" : formatBRL(tier.contributionTotal)}
                    </td>
                    {editable && (
                      <td onClick={(event) => event.stopPropagation()}>
                        <RowActions
                          actions={[
                            {
                              label: "Remover faixa",
                              destructive: true,
                              onSelect: () => void run(() => deletePricingTier(tier.id)),
                            },
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                ))}
                {pricing.tiers.length === 0 && (
                  <tr>
                    <td colSpan={editable ? 16 : 15} className="table__empty">
                      Nenhuma faixa de quantidade cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pricing.tiers.some((tier) => tier.warnings.length > 0) && (
            <ul className="candidate-list">
              {pricing.tiers.flatMap((tier) =>
                // O código do aviso repete dentro da mesma faixa (um
                // MATERIAL_COST_UNKNOWN por material sem custo), então a
                // posição entra na chave — sem ela o React descarta avisos.
                tier.warnings.map((warning, index) => (
                  <li key={`${tier.id}-${index}-${warning.code}`} className="field__hint">
                    {tier.quantity} {tier.uomCode}: {warning.message}
                  </li>
                )),
              )}
            </ul>
          )}

          {editable && (
            <>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="tier-quantity">Quantidade</label>
                  <input
                    id="tier-quantity"
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="Ex.: 1000"
                  />
                  <span className="field__hint">
                    Cada faixa é um cenário de quantidade — o custo unitário muda entre elas.
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="tier-mode">Modo de preço</label>
                  <select
                    id="tier-mode"
                    value={priceMode}
                    onChange={(event) => setPriceMode(event.target.value as PriceMode)}
                  >
                    {PRICE_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {PRICE_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                </div>

                {priceMode === "TARGET_MARGIN" ? (
                  <div className="field">
                    <label htmlFor="tier-margin">Margem de contribuição desejada (%)</label>
                    <input
                      id="tier-margin"
                      type="text"
                      inputMode="decimal"
                      value={targetMargin}
                      onChange={(event) => setTargetMargin(event.target.value)}
                    />
                    <span className="field__hint">
                      Margem somada à comissão precisa ficar abaixo de 100%.
                    </span>
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="tier-price">Preço unitário</label>
                    <input
                      id="tier-price"
                      type="text"
                      inputMode="decimal"
                      value={manualPrice}
                      onChange={(event) => setManualPrice(event.target.value)}
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="tier-commission">Comissão (%)</label>
                  <input
                    id="tier-commission"
                    type="text"
                    inputMode="decimal"
                    value={commission}
                    onChange={(event) => setCommission(event.target.value)}
                  />
                  <span className="field__hint">{COMMISSION_BASE_DESCRIPTION}</span>
                </div>
              </div>

              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={
                    saving ||
                    !quantity.trim() ||
                    (priceMode === "MANUAL_PRICE" && !manualPrice.trim())
                  }
                  onClick={() =>
                    void run(async () => {
                      await createPricingTier(pricing.id, {
                        quantity: quantity.trim(),
                        priceMode,
                        commissionPercent: commission.trim() || "0",
                        ...(priceMode === "TARGET_MARGIN"
                          ? { targetContributionMarginPercent: targetMargin.trim() }
                          : { manualUnitPrice: manualPrice.trim() }),
                      });
                      setQuantity("");
                      setManualPrice("");
                    })
                  }
                >
                  Adicionar faixa
                </button>

                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving || pricing.tiers.length === 0}
                  onClick={() => {
                    if (incompleteCost) {
                      setActivateConfirm(true);
                      return;
                    }
                    void run(() =>
                      activatePricingVersion(pricing.id, {
                        confirmIncompleteCost: false,
                        confirmOutdatedStructure: true,
                      }),
                    );
                  }}
                >
                  Ativar precificação
                </button>
              </div>
            </>
          )}
        </FormSection>

        <FormSection title="Observações">
          <p className="field__hint">
            {pricing.notes ?? "Sem observações."}
          </p>
          <p className="field__hint">
            Documento interno de precificação: não é orçamento ao cliente e não é documento fiscal.
          </p>
        </FormSection>
      </div>

      {/* O diff antes da decisão, e o que a decisão faz de fato: rascunho
          troca a base nele mesmo; versão ativa gera rascunho novo. Prometer
          "nasce uma versão nova" para um rascunho era a promessa errada — e
          quem confirmava recebia de volta a mesma tela, sem entender por quê. */}
      <ConfirmDialog
        open={verRebase && rebase !== null}
        title={
          rebase?.mode === "IN_PLACE"
            ? "Trocar a base de custo deste rascunho?"
            : "Refazer a precificação sobre o custo atual?"
        }
        confirmLabel={rebase?.mode === "IN_PLACE" ? "Trocar a base" : "Criar nova versão"}
        cancelLabel="Voltar"
        confirmTone="accent"
        message={
          <>
            {rebase?.mode === "IN_PLACE" ? (
              <p>
                <strong>{pricing.code} continua sendo a mesma versão</strong> — só a base
                econômica muda. As faixas, margens e comissões ficam como estão; nenhum preço
                foi acordado ainda.
              </p>
            ) : (
              <p>
                Nasce uma versão nova em rascunho, com as faixas copiadas desta.{" "}
                <strong>{pricing.code} continua como está</strong> — preço acordado não se
                reescreve.
              </p>
            )}
            {rebase && rebase.changes.length > 0 && (
              <>
                <p>
                  <strong>O que muda na base:</strong>
                </p>
                <ul className="confirm-dialog__list">
                  {rebase.changes.map((change) => (
                    <li key={change.label}>
                      {change.label}: {formatarMudanca(change.label, change.from)} →{" "}
                      {formatarMudanca(change.label, change.to)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {rebase && rebase.tiers.length > 0 && (
              <>
                <p>
                  <strong>Custo por unidade em cada faixa:</strong>
                </p>
                <ul className="confirm-dialog__list">
                  {rebase.tiers.map((tier) => (
                    <li key={tier.quantity}>
                      {tier.quantity} {tier.uomCode}:{" "}
                      {tier.costPerUnitFrom ? formatUnitCost(tier.costPerUnitFrom) : "—"} →{" "}
                      {tier.costPerUnitTo ? formatUnitCost(tier.costPerUnitTo) : "—"}
                      {tier.unitPrice ? ` (preço acordado ${formatBRL(tier.unitPrice)})` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* Trocar de uma base parcial para outra parcial não destrava
                preço sugerido. Sem dizer isso, a troca parece o conserto que
                ela não é, e o "—" continua na tela sem explicação. */}
            {rebase &&
              (rebase.targetQuality === "PARTIAL" || rebase.targetQuality === "NO_COST") && (
                <p>
                  <strong>Atenção:</strong> o cálculo {rebase.targetCalculationCode} também está{" "}
                  {rebase.targetQuality === "NO_COST" ? "sem custo" : "parcial"}. A troca atualiza
                  a base, mas o preço sugerido continua indisponível enquanto houver custo não
                  informado — resolva as pendências em Custos industriais e salve um cálculo novo.
                </p>
              )}
          </>
        }
        onCancel={() => setVerRebase(false)}
        onConfirm={() => {
          setVerRebase(false);
          if (!rebase?.targetCalculationId) return;
          void run(async () => {
            const versao = await rebasePricingVersion(pricing.id, rebase.targetCalculationId!);
            if (versao.id !== pricing.id) navigate(`/gestao/precificacao/${versao.id}`);
          });
        }}
      />

      <ConfirmDialog
        open={activateConfirm}
        title="Ativar precificação com custo incompleto?"
        confirmLabel="Ativar precificação"
        confirmTone="accent"
        message={
          <>
            <p>
              O custo industrial está incompleto em pelo menos uma faixa. Ativar torna esta a
              precificação vigente do produto e ela passa a ser oferecida no orçamento.
            </p>
            <ul className="confirm-dialog__list">
              <li>
                Precificação: <span className="code">{pricing.label}</span>
              </li>
              <li>
                Produto: <span className="code">{pricing.productCode}</span> {pricing.productName}
              </li>
              <li>
                Faixas: {pricing.tiers.length}{" "}
                {pricing.tiers.length === 1 ? "faixa" : "faixas"} — sem custo completo:{" "}
                {
                  pricing.tiers.filter(
                    (tier) => tier.costQuality === "PARTIAL" || tier.costQuality === "NO_COST",
                  ).length
                }
              </li>
            </ul>
            {pricing.warnings.map((warning, index) => (
              <p key={`${index}-${warning.code}`} className="field__hint">
                {warning.message}
              </p>
            ))}
          </>
        }
        onCancel={() => setActivateConfirm(false)}
        onConfirm={() => {
          setActivateConfirm(false);
          void run(() =>
            activatePricingVersion(pricing.id, {
              confirmIncompleteCost: true,
              confirmOutdatedStructure: true,
            }),
          );
        }}
      />
    </>
  );
}
