import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  FormulationTemplateDiffDTO,
  FormulationTemplateUpdateAvailableDTO,
  FormulationVersionDTO,
} from "@veridi/shared";
import {
  applyTemplateToProduct,
  compareFormulationWithTemplate,
  createTemplateFromFormulation,
  getTemplateUpdateAvailable,
} from "../../lib/formulation-templates-api";
import { TemplateDiff } from "./TemplateDiff";

/**
 * De onde esta formulação veio, e o que mudou na matriz desde então.
 *
 * A origem é discreta de propósito: importa para explicar, não para
 * comandar. E o aviso de versão nova NUNCA vira "atualizar" — atualizar no
 * lugar reescreveria uma receita que já pode ter servido de base para custo,
 * preço e produção. O caminho é criar uma versão nova; a atual continua
 * histórica.
 */

interface Props {
  version: FormulationVersionDTO;
  canEdit: boolean;
  onChanged: () => void;
}

export function FormulationTemplateOrigin({ version, canEdit, onChanged }: Props) {
  const navigate = useNavigate();
  const [novidade, setNovidade] = useState<FormulationTemplateUpdateAvailableDTO | null>(null);
  const [diff, setDiff] = useState<FormulationTemplateDiffDTO | null>(null);
  const [salvandoTemplate, setSalvandoTemplate] = useState(false);
  const [nomeTemplate, setNomeTemplate] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    if (!version.originTemplateVersionId) {
      setNovidade(null);
      return;
    }
    getTemplateUpdateAvailable(version.id)
      .then(setNovidade)
      .catch(() => setNovidade(null));
  }, [version.id, version.originTemplateVersionId]);

  useEffect(() => carregar(), [carregar]);

  async function criarVersaoDaMatrizNova() {
    if (!novidade) return;
    setOcupado(true);
    setErro(null);
    try {
      const criada = await applyTemplateToProduct(version.productId, novidade.latestVersionId);
      navigate(`/producao/formulacoes/${version.productId}/versoes/${criada.id}`);
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
      const template = await createTemplateFromFormulation(version.id, {
        name: nomeTemplate.trim(),
      });
      navigate(`/producao/templates-formulacao/${template.id}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar como template");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="template-origin">
      {erro && <p className="form-alert" role="alert">{erro}</p>}

      {version.originTemplateCode && (
        <p className="template-origin__line">
          Criada a partir de{" "}
          {novidade ? (
            <Link to={`/producao/templates-formulacao/${novidade.templateId}`}>
              {version.originTemplateCode} · V{version.originTemplateVersionNumber}
            </Link>
          ) : (
            <strong>
              {version.originTemplateCode} · V{version.originTemplateVersionNumber}
            </strong>
          )}
          {version.originTemplateName ? ` — ${version.originTemplateName}` : ""}
        </p>
      )}

      {novidade && (
        <div className="template-origin__update">
          <p>
            Existe uma versão mais recente do template de origem —{" "}
            <strong>V{novidade.latestVersionNumber}</strong>. Esta formulação continua na
            V{novidade.originVersionNumber} e não muda sozinha.
          </p>
          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={ocupado}
              onClick={() =>
                void compareFormulationWithTemplate(version.id)
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
                onClick={() => void criarVersaoDaMatrizNova()}
              >
                Criar nova versão a partir da V{novidade.latestVersionNumber}
              </button>
            )}
          </div>
          {/* Não existe "atualizar esta versão": o histórico não se reescreve. */}
          <p className="field__hint">
            Nada é sobrescrito: uma nova versão da formulação nasce em rascunho e esta continua
            como está.
          </p>
        </div>
      )}

      {diff && (
        <div className="template-diff-wrapper">
          <TemplateDiff diff={diff} />
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiff(null)}>
            Fechar comparação
          </button>
        </div>
      )}

      {canEdit && (
        <div className="template-origin__save">
          {salvandoTemplate ? (
            <div className="inline-form">
              <label htmlFor="novo-template-nome">Nome do template</label>
              <input
                id="novo-template-nome"
                type="text"
                autoFocus
                placeholder="Ex.: Biotina — Cápsulas Base"
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
              É uma cópia: esta formulação continua exatamente como está, e o template nasce em
              rascunho para você revisar antes de disponibilizá-lo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
