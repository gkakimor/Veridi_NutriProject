import { useCallback, useEffect, useState } from "react";
import type { CustomerDTO } from "@veridi/shared";
import { BR_STATE_CODES, formatCnpj } from "@veridi/shared";
import { listCustomers, setCustomerActive } from "../../lib/customers-api";
import { CustomerFormDrawer } from "./CustomerFormDrawer";

type ActiveFilter = "all" | "active" | "inactive";
type DrawerState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; customer: CustomerDTO };

const PAGE_SIZE = 20;

/** Cadastros → Clientes. Mesmo padrao de tabela densa + drawer de Items. */
export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const [drawerState, setDrawerState] = useState<DrawerState>({ mode: "closed" });

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, stateFilter, activeFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listCustomers>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (stateFilter) params.state = stateFilter;
    if (activeFilter !== "all") params.active = activeFilter === "active";

    listCustomers(params)
      .then((result) => {
        setCustomers(result.customers);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar clientes");
      })
      .finally(() => setLoading(false));
  }, [page, search, stateFilter, activeFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleToggleActive(customer: CustomerDTO) {
    const nextActive = !customer.active;
    const question = nextActive
      ? `Reativar "${customer.legalName}"?`
      : `Inativar "${customer.legalName}"? O cliente continua visível no histórico.`;
    if (!window.confirm(question)) return;

    try {
      await setCustomerActive(customer.id, nextActive);
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Falha ao atualizar status");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Clientes</h1>
          <p className="page__subtitle">
            Base de clientes para associação futura com produtos e ordens de
            produção.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setDrawerState({ mode: "create" })}
        >
          Novo cliente
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="customers-search">
            Buscar clientes
          </label>
          <input
            id="customers-search"
            type="search"
            placeholder="Buscar por código, razão social, fantasia ou CNPJ…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="customers-state-filter">
          Filtrar por UF
        </label>
        <select
          id="customers-state-filter"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="">Todas as UFs</option>
          {BR_STATE_CODES.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="customers-active-filter">
          Filtrar por status
        </label>
        <select
          id="customers-active-filter"
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Razão Social / Nome</th>
              <th>Nome Fantasia</th>
              <th>CNPJ</th>
              <th>Cidade/UF</th>
              <th>Telefone</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td className="is-code">{customer.code}</td>
                <td>{customer.legalName}</td>
                <td>{customer.tradeName ?? "—"}</td>
                <td>{customer.cnpj ? formatCnpj(customer.cnpj) : "—"}</td>
                <td>
                  {customer.city && customer.state
                    ? `${customer.city}/${customer.state}`
                    : customer.city ?? customer.state ?? "—"}
                </td>
                <td>{customer.phone ?? "—"}</td>
                <td>
                  <span
                    className={
                      customer.active ? "badge badge--active" : "badge badge--inactive"
                    }
                  >
                    {customer.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDrawerState({ mode: "edit", customer })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={
                        customer.active
                          ? "btn btn--danger btn--sm"
                          : "btn btn--secondary btn--sm"
                      }
                      onClick={() => handleToggleActive(customer)}
                    >
                      {customer.active ? "Inativar" : "Reativar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>
          {total} {total === 1 ? "cliente" : "clientes"}
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
          <span>
            Página {page} de {totalPages}
          </span>
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

      {drawerState.mode !== "closed" && (
        <CustomerFormDrawer
          key={drawerState.mode === "edit" ? drawerState.customer.id : "create"}
          mode={drawerState.mode}
          customer={drawerState.mode === "edit" ? drawerState.customer : null}
          onClose={() => setDrawerState({ mode: "closed" })}
          onSaved={() => {
            setDrawerState({ mode: "closed" });
            reload();
          }}
        />
      )}
    </>
  );
}
