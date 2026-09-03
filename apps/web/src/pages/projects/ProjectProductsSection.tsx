import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProductDTO, ProjectProductDTO, ProjectStatus } from "@veridi/shared";
import { PROJECT_PRODUCT_STATUS_LABELS } from "@veridi/shared";
import { createProjectProduct, linkProjectProduct } from "../../lib/projects-api";
import { listProducts } from "../../lib/products-api";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";

/**
 * Produtos do projeto.
 *
 * Uma negociação real cobre mais de um produto: a mesma linha em três sabores
 * nasce de um briefing só. A tela fala de "produtos do projeto" — quem usa não
 * precisa saber que existe uma entidade de vínculo por trás.
 *
 * Duas formas de entrar, e nenhuma terceira: criar o produto aqui (nasce em
 * desenvolvimento, com item de produto acabado e fórmula V1) ou vincular um
 * que já existe.
 */

function statusBadgeClass(status: ProjectProductDTO["status"]): string {
  if (status === "APPROVED") return "badge badge--active";
  if (status === "OUT_OF_SCOPE") return "badge badge--neutral";
  return "badge badge--warn";
}

const LIFECYCLE_LABELS: Record<string, string> = {
  DEVELOPMENT: "Em desenvolvimento",
  APPROVED: "Aprovado",
};

export function ProjectProductsSection({
  projectId,
  customerId,
  products,
  editable,
  projectStatus,
  onChanged,
}: {
  projectId: string;
  customerId: string;
  products: ProjectProductDTO[];
  /** Projeto aprovado ou cancelado é histórico: não recebe produto novo. */
  editable: boolean;
  /** Só para explicar por que a ação sumiu — nunca para liberar a ação. */
  projectStatus?: ProjectStatus;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"closed" | "create" | "link">("closed");
  const [name, setName] = useState("");
  const [catalog, setCatalog] = useState<ProductDTO[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "link") return;
    // Só produtos do mesmo cliente: vincular produto de outro cliente
    // misturaria propriedade, e o backend recusa.
    listProducts({ customerId, pageSize: 1000 })
      .then((result) => setCatalog(result.products))
      .catch(() => setCatalog([]));
  }, [mode, customerId]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      setMode("closed");
      setName("");
      setSelectedProductId("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao adicionar produto");
    } finally {
      setSaving(false);
    }
  }

  const alreadyLinked = new Set(products.map((link) => link.productId));

  return (
    <FormSection
      title="Produtos do projeto"
      subtitle="Um projeto pode desenvolver vários produtos — cada um com fórmula, custo e preço próprios."
    >
      {error && mode === "closed" && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      {products.length === 0 ? (
        <p className="field__hint">
          Nenhum produto ainda. O produto nasce aqui, em desenvolvimento, e só vira operacional
          quando o projeto for aprovado com ele na proposta aceita.
        </p>
      ) : (
        <div className="table-container">
          <table className="table table--sticky-actions">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Situação técnica</th>
                <th>Situação no projeto</th>
                <th>Última amostra</th>
                {/* A coluna tem nome: são os quatro destinos do produto, na
                    ordem em que a cadeia é percorrida. */}
                <th className="is-actions-head">Cadeia técnica</th>
              </tr>
            </thead>
            <tbody>
              {products.map((link) => (
                <tr key={link.id}>
                  <td>
                    <EntityLink
                      kind="product"
                      id={link.productId}
                      code={link.productCode}
                      name={link.productName}
                    />
                  </td>
                  <td>{LIFECYCLE_LABELS[link.productLifecycle] ?? link.productLifecycle}</td>
                  <td>
                    <span className={statusBadgeClass(link.status)}>
                      {PROJECT_PRODUCT_STATUS_LABELS[link.status]}
                    </span>
                    {link.status === "OUT_OF_SCOPE" && (
                      <div className="field__hint">
                        Não fez parte da proposta aceita. A história técnica continua registrada.
                      </div>
                    )}
                  </td>
                  <td>{link.latestSampleLabel ?? "—"}</td>
                  {/* A cadeia técnica inteira do produto, na ordem em que se
                      percorre: fórmula, custo de produzir, estrutura de custos,
                      preço. Duas delas moravam num menu "⋯" por falta de
                      largura — com a coluna de ação fixa e o corpo do documento
                      mais largo, esconder metade do caminho passou a ser
                      escolha ruim, não restrição. */}
                  <td className="table__actions table__actions--centered">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/producao/formulacoes/${link.productId}`}
                    >
                      Formulação
                    </Link>
                    {/* Custos ANTES do CMV: o CMV lê a estrutura de custo
                        ativa, então não existe CMV sem ela existir primeiro.
                        A ordem estava invertida e contradizia o próprio
                        cabeçalho desta coluna, que promete "a ordem em que a
                        cadeia é percorrida". Mesmos rótulos e mesma sequência
                        de `ProductRelatedLinks`, usado nas cinco telas irmãs. */}
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/produtos/${link.productId}/custos`}
                    >
                      Custos industriais
                    </Link>
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/produtos/${link.productId}/cmv?projectId=${projectId}`}
                    >
                      CMV
                    </Link>
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/gestao/precificacao?productId=${link.productId}`}
                    >
                      Precificação
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && mode === "closed" && (
        <div className="line-actions">
          <button type="button" className="btn btn--secondary" onClick={() => setMode("create")}>
            + Adicionar produto
          </button>
        </div>
      )}

      {/* Ação ausente sem explicação vira "o sistema não fez nada". */}
      {!editable && (projectStatus === "APPROVED" || projectStatus === "CANCELLED") && (
        <p className="field__hint">
          {projectStatus === "APPROVED"
            ? "Projeto aprovado é histórico: o escopo de produtos ficou definido na proposta aceita. Um produto novo pede um projeto novo."
            : "Projeto cancelado é histórico e não recebe produto novo."}
        </p>
      )}

      {editable && mode !== "closed" && (
        <div className="inline-form">
          <div className="toolbar__scope">
            <button
              type="button"
              className={mode === "create" ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setMode("create")}
            >
              Criar novo produto
            </button>
            <button
              type="button"
              className={mode === "link" ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setMode("link")}
            >
              Vincular produto existente
            </button>
          </div>

          {/* Perto do botão que falhou: no topo da seção, atrás da tabela de
              produtos, a recusa passava despercebida e o clique parecia mudo. */}
          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}

          {mode === "create" ? (
            <>
              <div className="field">
                <label htmlFor="new-product-name">Nome do produto</label>
                <input
                  id="new-product-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Pré-Treino Frutas Vermelhas"
                />
                <p className="field__hint">
                  Nome próprio, não o do projeto: três sabores com o mesmo nome ficam
                  indistinguíveis na produção.
                </p>
              </div>
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={saving || name.trim() === ""}
                  onClick={() =>
                    void run(() => createProjectProduct(projectId, { name: name.trim() }))
                  }
                >
                  Criar produto
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setMode("closed")}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="link-product">Produto existente</label>
              <SearchableEntitySelect
                id="link-product"
                value={selectedProductId}
                onChange={setSelectedProductId}
                placeholder="Busque por código ou nome"
                options={catalog
                  .filter((product) => !alreadyLinked.has(product.id))
                  .map((product) => ({
                    id: product.id,
                    code: product.code,
                    name: product.name,
                    hint: LIFECYCLE_LABELS[product.lifecycle] ?? product.lifecycle,
                  }))}
              />
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={saving || selectedProductId === ""}
                  onClick={() => void run(() => linkProjectProduct(projectId, selectedProductId))}
                >
                  Vincular produto
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setMode("closed")}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </FormSection>
  );
}
