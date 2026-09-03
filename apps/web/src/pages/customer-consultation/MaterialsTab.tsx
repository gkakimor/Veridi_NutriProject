import { useCallback } from "react";
import type { CustomerMaterialRowDTO } from "@veridi/shared";
import { COA_STATUS_LABELS, LOT_STATUS_LABELS } from "@veridi/shared";
import { listCustomerMaterials } from "../../lib/customer-materials-api";
import { formatDate } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Material DO cliente que está fisicamente dentro da Veridi.
 *
 * Reusa `GET /inventory/customer-materials?customerId=`, que é o read model
 * de propriedade já existente: ele parte de `Lot.ownerType = CUSTOMER` e
 * recorta por `ownerCustomerId`. É o MESMO escopo de dono usado pelo resto do
 * sistema — nada de um filtro paralelo simplificado, que é justamente como
 * lote de um cliente acabaria aparecendo na consulta de outro.
 *
 * Não há detalhe consultivo aqui: a linha já é o lote, e a rastreabilidade
 * completa continua sendo assunto de Estoque › Lotes.
 */
export function MaterialsTab() {
  const { customerId } = useConsultationContext();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listCustomerMaterials({ customerId, page, pageSize });
      return { rows: result.rows, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<CustomerMaterialRowDTO>(load, customerId);

  return (
    <>
      <ConsultationTrail
        steps={[
          { label: "Estoque", to: consultationPath(customerId, "estoque", "acabados") },
          { label: "Materiais do cliente" },
        ]}
      />

      {list.error && <p className="form-alert" role="alert">{list.error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="col-flex">Item</th>
              <th className="col-tight">Lote</th>
              <th className="col-tight">Físico</th>
              <th className="col-tight">Reservado</th>
              <th className="col-tight">Disponível</th>
              <th className="col-tight">Validade</th>
              <th className="col-tight">Situação</th>
              <th className="col-tight">Laudo</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr key={row.lotId}>
                <td className="col-flex">
                  <span className="is-code">{row.itemCode}</span> {row.itemName}
                </td>
                <td className="is-code col-tight">{row.lotCode}</td>
                <td className="col-tight">
                  {row.onHand} {row.unitCode}
                </td>
                <td className="col-tight">
                  {row.reserved} {row.unitCode}
                </td>
                <td className="col-tight">
                  {row.available} {row.unitCode}
                </td>
                <td className="col-tight">
                  {formatDate(row.expiryDate)}
                  {row.isExpired && <span className="badge badge--err">Vencido</span>}
                </td>
                <td className="col-tight">{LOT_STATUS_LABELS[row.status]}</td>
                <td className="col-tight">{COA_STATUS_LABELS[row.coaStatus]}</td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhum material deste cliente em estoque.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="lote" pluralNoun="lotes" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
