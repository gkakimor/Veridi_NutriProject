import { formatQuantity } from "../../lib/quantity";
import { useCallback } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { CustomerFinishedGoodsRowDTO } from "@veridi/shared";
import { listConsultationFinishedGoods } from "../../lib/customer-consultation-api";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Estoque do Cliente — duas coisas diferentes sob o mesmo assunto.
 *
 * "Produtos acabados" é estoque da VERIDI produzido para aquele Cliente;
 * "Materiais do cliente" é material de propriedade DELE guardado aqui. Junta
 * as duas numa lista só e ninguém mais sabe de quem é o que — que é
 * exatamente a informação que importa quando se fala de material de
 * terceiro.
 *
 * Matéria-prima da Veridi não aparece em nenhuma das duas: ela é da Veridi,
 * e listá-la aqui afirmaria que pertence ao Cliente.
 */
export function StockTab() {
  const contexto = useConsultationContext();
  const { customerId } = contexto;

  const subtabs = [
    { label: "Produtos acabados", segment: "acabados" },
    { label: "Materiais do cliente", segment: "materiais" },
  ];

  return (
    <>
      {/* Mesma linguagem visual das abas do shell — é navegação de rota. */}
      <nav className="consult-tabs" aria-label="Seções do estoque">
        {subtabs.map((sub) => (
          <NavLink
            key={sub.segment}
            to={consultationPath(customerId, "estoque", sub.segment)}
            className={({ isActive }) =>
              isActive ? "consult-tabs__link is-active" : "consult-tabs__link"
            }
          >
            {sub.label}
          </NavLink>
        ))}
      </nav>

      <div className="consult-body">
        {/*
          O Outlet mais próximo é este, não o do shell: sem repassar o
          contexto, a subaba receberia `undefined` e quebraria ao pedir o
          cliente.
        */}
        <Outlet context={contexto} />
      </div>
    </>
  );
}

/** Produto acabado pronto — o que existe, o que está reservado, o que sobra. */
export function FinishedGoodsTab() {
  const { customerId } = useConsultationContext();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listConsultationFinishedGoods(customerId, { page, pageSize });
      return { rows: result.rows, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<CustomerFinishedGoodsRowDTO>(load, customerId);

  return (
    <>
      <ConsultationTrail
        steps={[
          { label: "Estoque", to: consultationPath(customerId, "estoque", "acabados") },
          { label: "Produtos acabados" },
        ]}
      />

      {list.error && <p className="form-alert" role="alert">{list.error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="col-flex">Produto</th>
              <th className="col-tight">Item</th>
              <th className="col-tight">Físico</th>
              <th className="col-tight">Reservado</th>
              <th className="col-tight">Disponível</th>
              <th className="col-tight">Lotes</th>
              <th className="col-tight">Qualidade</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr key={row.itemId}>
                <td className="col-flex">
                  <span className="is-code">{row.productCode}</span> {row.productName}
                </td>
                <td className="is-code col-tight">{row.itemCode}</td>
                <td className="col-tight">
                  {formatQuantity(row.onHand)} {row.unitCode}
                </td>
                <td className="col-tight">
                  {formatQuantity(row.reserved)} {row.unitCode}
                </td>
                <td className="col-tight">
                  {formatQuantity(row.available)} {row.unitCode}
                </td>
                <td className="col-tight">{row.lotCount}</td>
                <td className="col-tight">
                  {row.awaitingQualityLots > 0 ? (
                    <span className="badge badge--warn">
                      {row.awaitingQualityLots} aguardando liberação
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum produto acabado deste cliente em estoque.
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
