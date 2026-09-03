import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { formatBrPhone, formatCnpj } from "@veridi/shared";
import { listCustomers } from "../../lib/customers-api";
import { consultationPath } from "./ConsultationShell";

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
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listCustomers({ page, pageSize: PAGE_SIZE, ...(search ? { search } : {}) })
      .then((result) => {
        setCustomers(result.customers);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar clientes");
      })
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function open(customer: CustomerDTO) {
    navigate(consultationPath(customer.id, "resumo"));
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Consulta de Cliente</h1>
          <p className="page__subtitle">
            Acompanhe projetos, pedidos, materiais e faturamentos de um cliente
            sem precisar saber em qual módulo procurar.
          </p>
        </div>
      </div>

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

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
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

            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum cliente encontrado para esta busca.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "cliente" : "clientes"}
        </div>
      </div>

      <div className="pagination">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  );
}
