import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { formatBrPhone, formatCnpj } from "@veridi/shared";
import { listCustomers } from "../../lib/customers-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { consultationPath } from "./ConsultationShell";
import { ListStatusRow } from "../../components/ListStatusRow";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

/**
 * Porta de entrada da Consulta do Cliente: escolher de quem se está falando.
 *
 * A busca é a MESMA do cadastro — `GET /customers?search=` já procura por
 * código, razão social, nome fantasia e CNPJ, nas duas formas em circulação
 * (numérica e a alfanumérica da IN RFB nº 2.229/2024). Um segundo motor de
 * busca aqui só criaria uma segunda resposta para a mesma pergunta.
 */

const PAGE_SIZE = 20;

export function ConsultationSearchPage() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Busca nova é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = search ? { search } : {};
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listCustomers,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar clientes" },
  );
  const customers: CustomerDTO[] = consulta.data?.customers ?? [];
  const total = consulta.data?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function open(customer: CustomerDTO) {
    navigate(consultationPath(customer.id, "resumo"));
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Visão do Cliente</h1>
          <p className="page__subtitle">
            Acompanhe projetos, pedidos, materiais e faturamentos de um cliente
            sem precisar saber em qual módulo procurar.
          </p>
        </div>
      </div>

      {/* A mesma ajuda da consulta: escolher o cliente é o primeiro passo dela. */}
      <ContextHelp topic={helpTopics["consultaCliente.comoFunciona"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="consultation-search">
            Buscar clientes
          </label>
          <input
            id="consultation-search"
            type="search"
            placeholder="Buscar por código, razão social, fantasia ou CNPJ…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Razão Social / Nome</th>
              <th>Nome Fantasia</th>
              <th>CNPJ</th>
              <th>Cidade/UF</th>
              <th>Telefone</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr
                key={customer.id}
                tabIndex={0}
                onClick={() => open(customer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(customer);
                }}
              >
                <td className="is-code">{customer.code}</td>
                <td>{customer.legalName}</td>
                <td>{customer.tradeName ?? "—"}</td>
                <td>{customer.cnpj ? formatCnpj(customer.cnpj) : "—"}</td>
                <td>
                  {customer.city && customer.state
                    ? `${customer.city}/${customer.state}`
                    : (customer.city ?? customer.state ?? "—")}
                </td>
                <td>{formatBrPhone(customer.phone) ?? "—"}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={consultationPath(customer.id, "resumo")}
                  >
                    Consultar
                  </Link>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={7} query={consulta} rowCount={customers.length}>
              Nenhum cliente encontrado para esta busca.
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {total} {total === 1 ? "cliente" : "clientes"}
          </div>
        )}
      </div>

      {consulta.data && (
        <div className="pagination">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="table__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </>
  );
}
