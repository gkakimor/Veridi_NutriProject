import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  PricingVersionDTO,
  TemplateDiffDTO,
  TemplateUpdateAvailableDTO,
} from "@veridi/shared";
import {
  applyPricingPolicyToProduct,
  comparePricingPolicyVersions,
  createPolicyFromPricingVersion,
  getPricingPolicyUpdate,
} from "../../lib/cost-pricing-templates-api";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";

/**
 * De qual política esta precificação nasceu, e o que mudou na política desde
 * então.
 *
 * A política não empurra preço para trás: uma precificação ativa já pode ter
 * virado orçamento e pedido. Quando a política muda, o caminho é criar uma
 * precificação nova sobre o mesmo cálculo de custo — esta continua como está.
 */

interface Props {
  version: PricingVersionDTO;
  canEdit: boolean;
  onChanged: () => void;
}

export function PricingPolicyOrigin({ version, canEdit, onChanged }: Props) {
  const navigate = useNavigate();
  const [novidade, setNovidade] = useState<TemplateUpdateAvailableDTO | null>(null);
  const [diff, setDiff] = useState<TemplateDiffDTO | null>(null);
  const [salvandoPolitica, setSalvandoPolitica] = useState(false);
  const [nomePolitica, setNomePolitica] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [criada, setCriada] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!version.originPricingPolicyVersionId) {
      setNovidade(null);
      return;
    }
    getPricingPolicyUpdate(version.id)
      .then(setNovidade)
      .catch(() => setNovidade(null));
  }, [version.id, version.originPricingPolicyVersionId]);

  useEffect(() => carregar(), [carregar]);

  async function criarPrecificacaoDaPoliticaNova() {
    if (!novidade) return;
    setOcupado(true);
    setErro(null);
    try {
      // Mesma base de custo: o que muda é a regra comercial, não o custo.
      const nova = await applyPricingPolicyToProduct(
        version.productId,
        novidade.latestVersionId,
        version.industrialCostCalculationId,
      );
      navigate(`/gestao/precificacao/${nova.id}`);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar a precificação");
    } finally {
      setOcupado(false);
    }
  }

  async function salvarComoPolitica() {
    if (!nomePolitica.trim()) return;
    setOcupado(true);
    setErro(null);
    try {
      const policy = await createPolicyFromPricingVersion(version.id, {
        name: nomePolitica.trim(),
      });
      setCriada(policy.id);
      setSalvandoPolitica(false);
      setNomePolitica("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar como política");
    } finally {
      setOcupado(false);
    }
  }

  const temManual = version.tiers.some((tier) => tier.priceMode === "MANUAL_PRICE");

  return (
    <div className="template-origin">
      {erro && <p className="form-alert" role="alert">{erro}</p>}

      {criada && (
        <p className="field__hint" role="status">
          Política criada em rascunho.{" "}
          <Link to={`/gestao/politicas-precificacao/${criada}`}>Abrir a política</Link> para revisar
          e ativar.
        </p>
      )}

      {version.originPricingPolicyCode && (
        <p className="template-origin__line">
          Criada a partir de{" "}
          {novidade ? (
            <Link to={`/gestao/politicas-precificacao/${novidade.templateId}`}>
              {version.originPricingPolicyCode} · V{version.originPricingPolicyVersionNumber}
            </Link>
          ) : (
            <strong>
              {version.originPricingPolicyCode} · V{version.originPricingPolicyVersionNumber}
            </strong>
          )}
          {version.originPricingPolicyName ? ` — ${version.originPricingPolicyName}` : ""}
        </p>
      )}

      {novidade && (
        <div className="template-origin__update">
          <p>
            Existe uma versão mais recente da política de origem —{" "}
            <strong>V{novidade.latestVersionNumber}</strong>. Esta precificação continua na V
            {novidade.originVersionNumber} e não muda sozinha.
          </p>
          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={ocupado || !version.originPricingPolicyVersionId}
              onClick={() =>
                void comparePricingPolicyVersions(
                  version.originPricingPolicyVersionId!,
                  novidade.latestVersionId,
                )
                  .then(setDiff)
                  .catch((err: unknown) =>
                    setErro(err instanceof Error ? err.message : "Falha ao comparar"),
                  )
              }
            >
              Comparar com a V{novidade.latestVersionNumber}
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={ocupado}
                onClick={() => void criarPrecificacaoDaPoliticaNova()}
              >
                Criar precificação a partir da V{novidade.latestVersionNumber}
              </button>
            )}
          </div>
          <p className="field__hint">
            A nova precificação nasce em rascunho sobre o mesmo cálculo de custo (
            {version.calculationCode}). Esta continua como está.
          </p>
        </div>
      )}

      {diff && (
        <div className="template-diff-wrapper">
          <TemplateDiffTable diff={diff} />
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiff(null)}>
            Fechar comparação
          </button>
        </div>
      )}

      {canEdit && (
        <div className="template-origin__save">
          {salvandoPolitica ? (
            <div className="inline-form">
              <label htmlFor="nova-tpp-nome">Nome da política</label>
              <input
                id="nova-tpp-nome"
                type="text"
                autoFocus
                placeholder="Ex.: Política padrão 500 / 1.000 / 3.000"
                value={nomePolitica}
                onChange={(event) => setNomePolitica(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void salvarComoPolitica();
                  if (event.key === "Escape") setSalvandoPolitica(false);
                }}
              />
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={ocupado || !nomePolitica.trim()}
                onClick={() => void salvarComoPolitica()}
              >
                Criar política
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSalvandoPolitica(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSalvandoPolitica(true)}
            >
              Salvar como política
            </button>
          )}
          {salvandoPolitica && (
            <p className="field__hint">
              A política leva quantidade, margem alvo e comissão — nunca preço.
              {temManual
                ? " As faixas com preço informado à mão ficam de fora: preço digitado é decisão de uma negociação, não regra reutilizável."
                : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
