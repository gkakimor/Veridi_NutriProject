import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";
import {
  DOSAGE_FORM_LABELS,
  PRESENTATION_TYPE_LABELS,
} from "@veridi/shared";
import { getConsultationProduct } from "../../lib/customer-consultation-api";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationError, ConsultationLoading, ConsultationNotFound } from "./DetailStates";
import { useScopedDetail } from "./useScopedDetail";

/**
 * Detalhe CONSULTIVO de um Produto, dentro do shell do Cliente.
 *
 * Não reconstrói a tela de Produto: mostra a identidade, o item de estoque
 * e onde o produto está na cadeia técnica — formulação, custo, preço. Quem
 * precisa mexer usa a saída explícita para o módulo.
 */
export function ProductPage() {
  const { customerId } = useConsultationContext();
  const { productId } = useParams<{ productId: string }>();

  const load = useCallback(
    () => getConsultationProduct(customerId, productId ?? ""),
    [customerId, productId],
  );
  const detail = useScopedDetail<ProductDTO>(load, `${customerId}:${productId}`);

  const listTo = consultationPath(customerId, "produtos");

  if (detail.notFound) {
    return <ConsultationNotFound noun="Produto" listLabel="Produtos" listTo={listTo} />;
  }
  if (detail.error) {
    return <ConsultationError message={detail.error} listLabel="Produtos" listTo={listTo} />;
  }
  if (detail.loading || !detail.data) {
    return <ConsultationLoading listLabel="Produtos" listTo={listTo} />;
  }

  const product = detail.data;

  return (
    <>
      <ConsultationTrail steps={[{ label: "Produtos", to: listTo }, { label: product.code }]} />

      <div className="doc-header">
        <div>
          <div className="doc-title">
            <h1>
              {product.code} · {product.name}
            </h1>
            <span
              className={
                product.lifecycle === "APPROVED" ? "badge badge--active" : "badge badge--neutral"
              }
            >
              {product.lifecycle === "APPROVED" ? "Operacional" : "Em desenvolvimento"}
            </span>
            {!product.active && <span className="badge badge--inactive">Inativo</span>}
          </div>
        </div>
        <div className="table__actions">
          <Link
            className="btn btn--secondary"
            to={`/cadastros/produtos?productId=${product.id}`}
          >
            Abrir produto completo ↗
          </Link>
        </div>
      </div>

      <section className="consult-section">
        <h2>Produto</h2>
        <dl className="definition-list">
          <dt>Forma farmacêutica</dt>
          <dd>{product.dosageForm ? DOSAGE_FORM_LABELS[product.dosageForm] : "—"}</dd>
          <dt>Apresentação</dt>
          <dd>
            {product.presentationType
              ? PRESENTATION_TYPE_LABELS[product.presentationType]
              : "—"}
          </dd>
          <dt>Doses por embalagem</dt>
          <dd>{product.dosesPerPackage ?? "—"}</dd>
          <dt>Referência externa</dt>
          <dd>{product.externalCode ?? "—"}</dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Item de produto acabado</h2>
        {product.finishedProductItem ? (
          <dl className="definition-list">
            <dt>Item</dt>
            <dd>
              <span className="is-code">{product.finishedProductItem.code}</span>{" "}
              {product.finishedProductItem.name}
            </dd>
            <dt>Estoque</dt>
            <dd>
              {/* Dentro da Consulta: leva ao estoque do próprio Cliente. */}
              <Link to={consultationPath(customerId, "estoque", "acabados")}>
                Ver no estoque deste cliente
              </Link>
            </dd>
          </dl>
        ) : (
          <p className="page__subtitle">
            Este produto não tem item de produto acabado vinculado.
          </p>
        )}
      </section>
    </>
  );
}
