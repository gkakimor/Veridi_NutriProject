import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  PricingPolicyDTO,
  PricingPolicyTierInput,
  PricingPolicyVersionDTO,
  TemplateDiffDTO,
} from "@veridi/shared";
import { TEMPLATE_VERSION_STATUS_LABELS } from "@veridi/shared";
import {
  activatePricingPolicyVersion,
  comparePricingPolicyVersions,
  createPolicyVersionFrom,
  getPricingPolicy,
  setPricingPolicyArchived,
  updatePricingPolicy,
  updatePricingPolicyVersion,
} from "../../lib/cost-pricing-templates-api";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { formatPercent } from "../../lib/percent";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { useAuth } from "../../app/AuthProvider";

/**
 * Detalhe de uma política de precificação.
 *
 * Só regra aparece aqui: faixa, margem alvo, comissão. Nenhum preço — o preço
 * de cada faixa depende do custo do produto e nasce quando a política é
 * aplicada. Mostrar um valor aqui daria a impressão de que a política tem
 * preço próprio, e a primeira aplicação num produto mais caro desmentiria.
 */

interface LinhaFaixa extends PricingPolicyTierInput {
  chave: string;
}

export function PricingPolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "COMMERCIAL";

  const [policy, setPolicy] = useState<PricingPolicyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [linhas, setLinhas] = useState<LinhaFaixa[]>([]);
  const [diff, setDiff] = useState<TemplateDiffDTO | null>(null);

  const load = useCallback(() => {
    if (!policyId) return;
    getPricingPolicy(policyId)
      .then((result) => {
        setPolicy(result);
        setNome(result.name);
        setDescricao(result.description ?? "");
        const rascunho = result.draftVersion;
        if (rascunho) {
          setLinhas(
            rascunho.tiers.map((tier, index) => ({
              chave: `${tier.id}-${index}`,
              quantity: tier.quantity,
              uomCode: tier.uomCode,
              targetContributionMarginPercent: tier.targetContributionMarginPercent ?? "",
              commissionPercent: tier.commissionPercent,
            })),
          );
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a política"),
      );
  }, [policyId]);

  useEffect(() => load(), [load]);

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

  if (!policy) {
    return (
      <div className="doc-body">
        {error ? <p className="form-alert" role="alert">{error}</p> : <p>Carregando…</p>}
      </div>
    );
  }

  const rascunho = policy.draftVersion;
  const ativa = policy.activeVersion;
  const editavel = canEdit && rascunho !== null;

  const faixasDaVersao = (version: PricingPolicyVersionDTO) => (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th className="is-numeric">Quantidade</th>
            <th>Unidade</th>
            <th className="is-numeric">Margem alvo</th>
            <th className="is-numeric">Comissão</th>
          </tr>
        </thead>
        <tbody>
          {version.tiers.map((tier) => (
            <tr key={tier.id}>
              <td className="is-numeric">{formatQuantity(tier.quantity)}</td>
              <td>{tier.uomCode}</td>
              <td className="is-numeric">
                {formatPercent(tier.targetContributionMarginPercent)}
              </td>
              <td className="is-numeric">{formatPercent(tier.commissionPercent)}</td>
            </tr>
          ))}
          {version.tiers.length === 0 && (
            <tr>
              <td colSpan={4} className="table__empty">
                Sem faixas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="doc-page">
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Políticas de Precificação", href: "/gestao/politicas-precificacao" }, { label: "Detalhe" }]} />
          <h1 className="doc-title">
            <code>{policy.code}</code> {policy.name}
            {policy.archived && <span className="badge badge--neutral">Arquivada</span>}
          </h1>
        </div>
        <div className="doc-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/gestao/politicas-precificacao")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* A tela mostra faixa, margem e comissão, e nenhum preço. Sem dizer
            por que, a ausência parece falta de cadastro — quando é a regra:
            o preço nasce do custo do produto, não da política. */}
        <ContextHelp topic={helpTopics["politicaPreco.comoFunciona"]} />

        <FormSection
          title="Identificação"
          subtitle="Uma política é reutilizável entre produtos e clientes — o nome não carrega o de nenhum deles."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="tpp-nome">Nome</label>
              <input
                id="tpp-nome"
                type="text"
                disabled={!canEdit}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tpp-descricao">Descrição</label>
              <input
                id="tpp-descricao"
                type="text"
                disabled={!canEdit}
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
              />
            </div>
          </div>
          {canEdit && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving}
                onClick={() =>
                  void run(() =>
                    updatePricingPolicy(policy.id, { name: nome, description: descricao || null }),
                  )
                }
              >
                Salvar identificação
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={saving}
                onClick={() => void run(() => setPricingPolicyArchived(policy.id, !policy.archived))}
              >
                {policy.archived ? "Desarquivar" : "Arquivar"}
              </button>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle="Versão ativa é histórica: para alterar, crie uma nova versão. A política define margem e comissão; o preço de cada faixa é calculado sobre o custo do produto no momento da aplicação."
          >
            {faixasDaVersao(ativa)}
            {ativa.usageCount > 0 && (
              <p className="field__hint">
                {ativa.usageCount === 1
                  ? "1 precificação nasceu desta versão."
                  : `${ativa.usageCount} precificações nasceram desta versão.`}{" "}
                Nenhuma delas muda quando esta política muda.
              </p>
            )}
            {canEdit && !rascunho && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => void run(() => createPolicyVersionFrom(ativa.id))}
                >
                  Criar nova versão
                </button>
              </div>
            )}
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Cada faixa é uma quantidade com sua margem alvo e comissão."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th className="is-numeric">Quantidade</th>
                    <th className="is-numeric">Margem alvo (%)</th>
                    <th className="is-numeric">Comissão (%)</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, index) => (
                    <tr key={linha.chave}>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Quantidade da faixa"
                          disabled={!editavel}
                          value={linha.quantity}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, quantity: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Margem alvo"
                          disabled={!editavel}
                          value={linha.targetContributionMarginPercent}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index
                                  ? { ...l, targetContributionMarginPercent: event.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Comissão"
                          disabled={!editavel}
                          value={linha.commissionPercent ?? ""}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, commissionPercent: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        {editavel && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label="Remover faixa"
                            onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== index))}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {linhas.length === 0 && (
                    <tr>
                      <td colSpan={4} className="table__empty">
                        Nenhuma faixa ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="field__hint">
              A política não guarda preço. Preço informado à mão é decisão de uma negociação sobre
              um custo específico — não vira regra reutilizável.
            </p>

            {editavel && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() =>
                    setLinhas((atual) => [
                      ...atual,
                      {
                        chave: `nova-${atual.length}-${Date.now()}`,
                        quantity: "",
                        targetContributionMarginPercent: "",
                        commissionPercent: "5",
                      },
                    ])
                  }
                >
                  + Adicionar faixa
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(() =>
                      updatePricingPolicyVersion(rascunho.id, {
                        tiers: linhas
                          .filter(
                            (linha) => linha.quantity && linha.targetContributionMarginPercent,
                          )
                          .map(({ chave: _chave, ...resto }) => {
                            // Comissão em branco continua em branco — só o
                            // que foi digitado precisa ser legível.
                            const comissao = exigirDecimalOpcional(
                              resto.commissionPercent ?? "",
                              "Comissão (%)",
                            );
                            return {
                              ...resto,
                              quantity: exigirDecimal(resto.quantity, "Quantidade"),
                              targetContributionMarginPercent: exigirDecimal(
                                resto.targetContributionMarginPercent,
                                "Margem alvo (%)",
                              ),
                              ...(comissao === null ? {} : { commissionPercent: comissao }),
                            };
                          }),
                      }),
                    )
                  }
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving || rascunho.tiers.length === 0}
                  onClick={() => void run(() => activatePricingPolicyVersion(rascunho.id))}
                >
                  Ativar versão
                </button>
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title="Histórico de versões"
          subtitle="Versões anteriores continuam existindo: precificações criadas a partir delas apontam para elas."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Origem</th>
                  <th className="is-numeric">Faixas</th>
                  <th className="is-numeric">Usada por</th>
                  <th>Criada em</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {[...policy.versions].reverse().map((version) => (
                  <tr key={version.id}>
                    <td>{version.versionLabel}</td>
                    <td>
                      <span
                        className={
                          version.status === "ACTIVE"
                            ? "badge badge--active"
                            : version.status === "DRAFT"
                              ? "badge badge--warn"
                              : "badge badge--neutral"
                        }
                      >
                        {TEMPLATE_VERSION_STATUS_LABELS[version.status]}
                      </span>
                    </td>
                    <td>
                      {version.sourceVersionNumber
                        ? `Criada a partir da V${version.sourceVersionNumber}`
                        : "—"}
                    </td>
                    <td className="is-numeric">{version.tiers.length}</td>
                    <td className="is-numeric">{version.usageCount}</td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>
                      {version.sourceVersionId && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            void comparePricingPolicyVersions(version.sourceVersionId!, version.id)
                              .then(setDiff)
                              .catch((err: unknown) =>
                                setError(err instanceof Error ? err.message : "Falha ao comparar"),
                              )
                          }
                        >
                          Comparar versões
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diff && (
            <div className="template-diff-wrapper">
              <TemplateDiffTable diff={diff} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiff(null)}>
                Fechar comparação
              </button>
            </div>
          )}
        </FormSection>
      </div>
    </div>
  );
}
