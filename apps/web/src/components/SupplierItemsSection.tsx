import { OPCOES_PRECO_UNITARIO } from "../lib/numeric-scales";
import { formatDecimalPtBr } from "../lib/numeric-ptbr";
import { formatQuantity } from "../lib/quantity";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SupplierItemDTO } from "@veridi/shared";
import { SUPPLIER_ITEM_QUALIFICATION_LABELS } from "@veridi/shared";
import { FormSection } from "./FormSection";
import { listSupplierItems } from "../lib/supplier-items-api";
import { TableEmptyRow } from "./TableEmptyRow";

/**
 * Bloco read-only do cadastro de Fornecedor ("o que ele fornece").
 *
 * Só leitura: cadastrar relação, homologar e registrar preço acontecem em
 * Compras → Item × Fornecedor, com os papéis certos — a visão Fornecedor → Itens
 * administrável é capability separada. Do lado do Item, a seção administrável é
 * `FornecedoresDoItemSection` (ITEM-SUPPLIER-UX-01). Preço mostrado é a oferta
 * VIGENTE; referência histórica sem vigência aparece marcada como tal, nunca
 * como preço atual.
 */
export function SupplierItemsSection({ id }: { scope: "supplier"; id: string }) {
  const [rows, setRows] = useState<SupplierItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSupplierItems({ supplierId: id, pageSize: 100 })
      .then((result) => setRows(result.supplierItems))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar as relações"),
      );
  }, [id]);

  return (
    <FormSection
      title="Itens fornecidos"
      subtitle="Homologação é por item. Preço é referência comercial do fornecedor — o custo real vem do recebimento."
    >
      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Código no fornecedor</th>
              <th>Homologação</th>
              <th>Preferencial</th>
              <th className="is-numeric">Preço</th>
              <th>Pedido mínimo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const offer = row.currentOffer ?? row.latestLegacyOffer;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="code">{row.itemCode}</span> {row.itemName}
                  </td>
                  <td className="is-code">{row.supplierItemCode ?? "—"}</td>
                  <td>{SUPPLIER_ITEM_QUALIFICATION_LABELS[row.qualificationStatus]}</td>
                  <td>{row.preferred ? "Sim" : "—"}</td>
                  <td className="is-numeric">
                    {offer ? (
                      <>
                        {formatDecimalPtBr(offer.unitPrice, { ...OPCOES_PRECO_UNITARIO, minFractionDigits: 2 })} {offer.currencyCode}/{offer.priceUomCode}
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
                      ? `${formatQuantity(offer.minimumOrderQuantity)} ${offer.minimumOrderUomCode ?? ""}`
                      : "—"}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <TableEmptyRow colSpan={6}>
                Nenhum item cadastrado para este fornecedor.{" "}
                <Link to="/compras/item-fornecedor">Vincular em Compras → Item × Fornecedor</Link>
              </TableEmptyRow>
            )}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}
