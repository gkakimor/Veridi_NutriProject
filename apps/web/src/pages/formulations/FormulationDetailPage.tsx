import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { FormulationVersionDTO, ProductDTO } from "@veridi/shared";
import { FORMULATION_VERSION_STATUS_LABELS } from "@veridi/shared";
import { getProduct } from "../../lib/products-api";
import {
  createFirstFormulationVersion,
  createNewFormulationVersion,
  listFormulationVersionsByProduct,
} from "../../lib/formulations-api";
import { FormSection } from "../../components/FormSection";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function statusBadgeClass(status: FormulationVersionDTO["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "badge badge--active";
    case "DRAFT":
      return "badge badge--warn";
    case "INACTIVE":
      return "badge badge--neutral";
  }
}

/** Produção → Formulações → detalhe do Product: histórico de versões + ações de versionamento. */
export function FormulationDetailPage() {
  const navigate = useNavigate();
  const { productId } = useParams<{ productId: string }>();

  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [versions, setVersions] = useState<FormulationVersionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!productId) return;
    setLoading(true);
    setNotFound(false);
    Promise.all([getProduct(productId), listFormulationVersionsByProduct(productId)])
      .then(([productResult, versionsResult]) => {
        setProduct(productResult);
        setVersions(versionsResult.versions);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateFirst() {
    if (!productId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createFirstFormulationVersion(productId);
      navigate(`/producao/formulacoes/${productId}/versoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar formulação");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNewVersion() {
    if (!activeVersion) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createNewFormulationVersion(activeVersion.id);
      navigate(`/producao/formulacoes/${productId}/versoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar nova versão");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Formulação</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Produto não encontrado</h1>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/producao/formulacoes")}
          >
            ← Voltar para Formulações
          </button>
        </div>
      </div>
    );
  }

  const activeVersion = versions.find((version) => version.status === "ACTIVE") ?? null;

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Produção / Formulações / Detalhe</div>
          <div className="doc-title">
            <h1>
              <span className="code">{product.code}</span> {product.name}
            </h1>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => navigate("/producao/formulacoes")}
        >
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Item acabado">
          {product.finishedProductItem ? (
            <p className="field-readonly-value">
              <span className="code">{product.finishedProductItem.code}</span>{" "}
              {product.finishedProductItem.name}
            </p>
          ) : (
            <p className="field__hint">
              Este produto ainda não tem um item de produto acabado vinculado — vincule em
              Cadastros / Produtos antes de criar uma formulação.
            </p>
          )}
        </FormSection>

        <FormSection title="Formulação ativa">
          <div className="status-line">
            {activeVersion ? (
              <>
                <span className={statusBadgeClass(activeVersion.status)}>
                  {activeVersion.versionLabel}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    navigate(`/producao/formulacoes/${productId}/versoes/${activeVersion.id}`)
                  }
                >
                  Ver versão ativa
                </button>
              </>
            ) : (
              <span className="field__hint">Nenhuma versão ativa.</span>
            )}
          </div>

          <div className="line-actions">
            {versions.length === 0 ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={saving || !product.finishedProductItem}
                onClick={handleCreateFirst}
              >
                Criar formulação
              </button>
            ) : activeVersion ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={saving}
                onClick={handleCreateNewVersion}
              >
                Criar nova versão
              </button>
            ) : (
              <span className="field__hint">
                Existe uma versão em rascunho sem ativação — abra-a no histórico abaixo.
              </span>
            )}
          </div>
        </FormSection>

        <FormSection title="Histórico de versões">
          <div className="table-container">
            <table className="table table--clickable-rows">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Status</th>
                  <th>Base</th>
                  <th>Criada em</th>
                  <th>Ativada em</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr
                    key={version.id}
                    tabIndex={0}
                    onClick={() =>
                      navigate(`/producao/formulacoes/${productId}/versoes/${version.id}`)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        navigate(`/producao/formulacoes/${productId}/versoes/${version.id}`);
                      }
                    }}
                  >
                    <td className="is-code">{version.versionLabel}</td>
                    <td>
                      <span className={statusBadgeClass(version.status)}>
                        {FORMULATION_VERSION_STATUS_LABELS[version.status]}
                      </span>
                    </td>
                    <td>
                      {version.basisQuantity} {version.outputUnitCode}
                    </td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>{formatDateTime(version.activatedAt)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          navigate(`/producao/formulacoes/${productId}/versoes/${version.id}`)
                        }
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}

                {versions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      Nenhuma versão de formulação ainda.
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
