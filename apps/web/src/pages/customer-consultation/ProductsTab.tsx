import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";
import { PRESENTATION_TYPE_LABELS } from "@veridi/shared";
import { listProducts } from "../../lib/products-api";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Produtos DESTE Cliente.
 *
 * Reusa `GET /products?customerId=` — o mesmo endpoint e o mesmo filtro da
 * tela operacional. O recorte é feito no servidor, então esta lista não tem
 * como mostrar produto de outro cliente.
 *
 * O item de produto acabado aparece porque é a pergunta seguinte de quem
 * olha um produto: "o que dele existe no estoque?".
 */
export function ProductsTab() {
  const { customerId } = useConsultationContext();
  const navigate = useNavigate();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listProducts({ customerId, page, pageSize });
      return { rows: result.products, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<ProductDTO>(load, customerId);

  function open(product: ProductDTO) {
    navigate(consultationPath(customerId, "produtos", product.id));
  }

  return (
    <>
      <ConsultationTrail steps={[{ label: "Produtos" }]} />

      {list.error && <p className="form-alert">{list.error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Apresentação</th>
              <th>Item de produto acabado</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((product) => (
              <tr
                key={product.id}
                tabIndex={0}
                onClick={() => open(product)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(product);
                }}
              >
                <td className="is-code">{product.code}</td>
                <td>{product.name}</td>
                <td>
                  {product.presentationType
                    ? PRESENTATION_TYPE_LABELS[product.presentationType]
                    : "—"}
                </td>
                <td className="is-code">{product.finishedProductItem?.code ?? "—"}</td>
                <td>
                  <span
                    className={
                      product.lifecycle === "APPROVED"
                        ? "badge badge--active"
                        : "badge badge--neutral"
                    }
                  >
                    {product.lifecycle === "APPROVED" ? "Operacional" : "Em desenvolvimento"}
                  </span>
                </td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="table__empty">
                  Nenhum produto encontrado para este cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="produto" pluralNoun="produtos" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
