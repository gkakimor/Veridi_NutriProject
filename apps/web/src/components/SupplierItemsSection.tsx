import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SupplierItemDTO } from "@veridi/shared";
import { SUPPLIER_ITEM_QUALIFICATION_LABELS } from "@veridi/shared";
import { FormSection } from "./FormSection";
import { listSupplierItems } from "../lib/supplier-items-api";

/**
 * Bloco read-only reutilizado pelo cadastro de Item ("quem fornece isto")
 * e pelo de Fornecedor ("o que ele fornece").
 *
 * Só leitura: cadastrar relação, homologar e registrar preço acontecem em
 * Compras → Item × Fornecedor, com os papéis certos. Preço mostrado é a
 * oferta VIGENTE; referência histórica sem vigência aparece marcada como
 * tal, nunca como preço atual.
 */
export function SupplierItemsSection({
  scope,
  id,
}: {
  scope: "item" | "supplier";
  id: string;
}) {
  const [rows, setRows] = useState<SupplierItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSupplierItems({ ...(scope === "item" ? { itemId: id } : { supplierId: id }), pageSize: 100 })
      .then((result) => setRows(result.supplierItems))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar as relações"),
      );
  }, [scope, id]);

  const isItemScope = scope === "item";

  return (
    <FormSection
      title={isItemScope ? "Fornecedores" : "Itens fornecidos"}
      subtitle="Homologação é por item. Preço é referência comercial do fornecedor — o custo real vem do recebimento."
    >
      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>{isItemScope ? "Fornecedor" : "Item"}</th>
              <th>Código no fornecedor</th>
              <th>Homologação</th>
              <th>Preferencial</th>
              <th>Preço</th>
              <th>Pedido mínimo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const offer = row.currentOffer ?? row.latestLegacyOffer;
              return (
                <tr key={row.id}>
                  <td>
                    {isItemScope ? (
                      row.supplierName
                    ) : (
                      <>
                        <span className="code">{row.itemCode}</span> {row.itemName}
                      </>
                    )}
                  </td>
                  <td className="is-code">{row.supplierItemCode ?? "—"}</td>
                  <td>{SUPPLIER_ITEM_QUALIFICATION_LABELS[row.qualificationStatus]}</td>
                  <td>{row.preferred ? "Sim" : "—"}</td>
                  <td>
                    {offer ? (
                      <>
                        {offer.unitPrice} {offer.currencyCode}/{offer.priceUomCode}
                        {!row.currentOffer && (
                          <span className="field__hint"> (referência histórica)</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {offer?.minimumOrderQuantity
                      ? `${offer.minimumOrderQuantity} ${offer.minimumOrderUomCode ?? ""}`
                      : "—"}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="table__empty">
                  {isItemScope
                    ? "Nenhum fornecedor cadastrado para este item."
                    : "Nenhum item cadastrado para este fornecedor."}{" "}
                  <Link to="/compras/item-fornecedor">Vincular em Compras → Item × Fornecedor</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}
