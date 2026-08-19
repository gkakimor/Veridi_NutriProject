import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  IndustrialCostVersionDTO,
  TemplateDiffDTO,
  TemplateUpdateAvailableDTO,
} from "@veridi/shared";
import {
  applyCostTemplateToProduct,
  compareCostVersionWithTemplate,
  createCostTemplateFromVersion,
  getCostTemplateUpdate,
} from "../../lib/cost-pricing-templates-api";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";

/**
 * De onde esta estrutura de custos veio, e o que mudou no template desde
 * então.
 *
 * A origem explica, não comanda. Não existe "atualizar esta estrutura": a
 * versão vigente já pode ter servido de base para cálculo, CMV e preço, e
 * reescrevê-la apagaria a explicação desses números. O caminho é uma versão
 * nova, que nasce em rascunho.
 */

interface Props {
  version: IndustrialCostVersionDTO;
  productId: string;
  canEdit: boolean;
  onChanged: () => void;
}

export function CostTemplateOrigin({ version, productId, canEdit, onChanged }: Props) {
  const [novidade, setNovidade] = useState<TemplateUpdateAvailableDTO | null>(null);
  const [diff, setDiff] = useState<TemplateDiffDTO | null>(null);
  const [salvandoTemplate, setSalvandoTemplate] = useState(false);
  const [nomeTemplate, setNomeTemplate] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [criado, setCriado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!version.originCostTemplateVersionId) {
      setNovidade(null);
      return;
    }
    getCostTemplateUpdate(version.id)
      .then(setNovidade)
      .catch(() => setNovidade(null));
  }, [version.id, version.originCostTemplateVersionId]);

  useEffect(() => carregar(), [carregar]);

  async function criarVersaoDoTemplateNovo() {
    if (!novidade) return;
    setOcupado(true);
    setErro(null);
    try {
      await applyCostTemplateToProduct(productId, novidade.latestVersionId);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar a versão");
    } finally {
      setOcupado(false);
    }
  }

  async function salvarComoTemplate() {
    if (!nomeTemplate.trim()) return;
    setOcupado(true);
    setErro(null);
    try {
      const template = await createCostTemplateFromVersion(version.id, {
        name: nomeTemplate.trim(),
      });
      setCriado(template.id);
      setSalvandoTemplate(false);
      setNomeTemplate("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar como template");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="template-origin">
      {erro && <p className="form-alert">{erro}</p>}

      {criado && (
        <p className="field__hint" role="status">
          Template criado em rascunho.{" "}
          <Link to={`/gestao/templates-estrutura/${criado}`}>Abrir o template</Link> para revisar e
          ativar.
        </p>
      )}

      {version.originCostTemplateCode && (
        <p className="template-origin__line">
          Criada a partir de{" "}
          {novidade ? (
            <Link to={`/gestao/templates-estrutura/${novidade.templateId}`}>
              {version.originCostTemplateCode} · V{version.originCostTemplateVersionNumber}
            </Link>
          ) : (
            <strong>
              {version.originCostTemplateCode} · V{version.originCostTemplateVersionNumber}
            </strong>
          )}
          {version.originCostTemplateName ? ` — ${version.originCostTemplateName}` : ""}
        </p>
      )}

      {novidade && (
        <div className="template-origin__update">
          <p>
            Existe uma versão mais recente do template de origem —{" "}
            <strong>V{novidade.latestVersionNumber}</strong>. Esta estrutura continua na V
            {novidade.originVersionNumber} e não muda sozinha.
          </p>
          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={ocupado}
              onClick={() =>
                void compareCostVersionWithTemplate(version.id)
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
                onClick={() => void criarVersaoDoTemplateNovo()}
              >
                Criar nova versão a partir da V{novidade.latestVersionNumber}
              </button>
            )}
          </div>
          <p className="field__hint">
            Nada é sobrescrito: a nova versão nasce em rascunho e a estrutura vigente continua
            valendo até você ativar a nova.
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
          {salvandoTemplate ? (
            <div className="inline-form">
              <label htmlFor="novo-tec-nome">Nome do template</label>
              <input
                id="novo-tec-nome"
                type="text"
                autoFocus
                placeholder="Ex.: Estrutura padrão para cápsulas"
                value={nomeTemplate}
                onChange={(event) => setNomeTemplate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void salvarComoTemplate();
                  if (event.key === "Escape") setSalvandoTemplate(false);
                }}
              />
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={ocupado || !nomeTemplate.trim()}
                onClick={() => void salvarComoTemplate()}
              >
                Criar template
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSalvandoTemplate(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSalvandoTemplate(true)}
            >
              Salvar como template
            </button>
          )}
          {salvandoTemplate && (
            <p className="field__hint">
              O template leva a configuração — recursos, uso, energia e premissas —, nunca as
              tarifas. Esta estrutura continua exatamente como está.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
