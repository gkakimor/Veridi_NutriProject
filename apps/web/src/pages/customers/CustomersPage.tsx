import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import type { CustomerDTO } from "@veridi/shared";
import { BR_STATE_CODES, formatBrPhone, formatCnpj } from "@veridi/shared";
import { listCustomers, setCustomerActive } from "../../lib/customers-api";
import { CustomerFormModal } from "./CustomerFormModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RowActions } from "../../components/RowActions";
import {
  RecordContextChip,
  useOpenRecord,
  useRecordContext,
} from "../../components/RecordContext";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; customer: CustomerDTO };

const PAGE_SIZE = 20;

/** Cadastros → Clientes. Mesmo padrao de tabela densa + modal de Items. */
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

  // Chegada por link contextual: `ids` reduz a lista, `open` abre o registro.
  const { contextIds, openId, clear: clearContext, contextKey } = useRecordContext(
    "/cadastros/clientes",
  );

  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [confirmDeactivate, setConfirmDeactivate] = useState<CustomerDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, stateFilter, activeFilter, contextKey]);

  // Filtro antigo somado ao contexto esconderia o próprio registro citado.
  useEffect(() => {
    if (!contextKey) return;
    setSearchInput("");
    setSearch("");
    setStateFilter("");
    setActiveFilter("all");
  }, [contextKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listCustomers>[0] = { page, pageSize: PAGE_SIZE };
    if (contextIds) params.ids = contextIds;
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
  }, [page, search, stateFilter, activeFilter, contextKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useOpenRecord(openId, customers, (customer) => setModalState({ mode: "edit", customer }));

  function handleToggleActive(customer: CustomerDTO) {
    if (customer.active) {
      setConfirmDeactivate(customer);
      return;
    }
    void applyActive(customer, true);
  }

  async function applyActive(customer: CustomerDTO, active: boolean) {
    try {
      await setCustomerActive(customer.id, active);
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
        {/* Leva à tela oficial, não ao modal: o cadastro passou a ter URL
            própria, e é ela que sobrevive a um F5 e vale como link. O modal
            continua servindo à EDIÇÃO, aberta a partir da linha. */}
        <Link className="btn btn--primary" to="/cadastros/clientes/novo">
          + Novo cliente
        </Link>
        <ExportCsvButton path="/customers/export.csv" filters={{ search, state: stateFilter, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
</div>

      {/* O cadastro parece só uma agenda até alguém descobrir que ele decide
          propriedade de material, identidade em documento impresso e o que
          um cliente inativo passa a recusar. */}
      <ContextHelp topic={helpTopics["cliente.comoFunciona"]} />

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

      {contextIds && (
        <RecordContextChip
          noun="o cliente"
          code={customers[0]?.code}
          name={customers[0]?.tradeName ?? customers[0]?.legalName}
          onClear={clearContext}
        />
      )}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">
                Razão Social / Nome
                <DicaDaColuna id="cliente.razaoSocial" />
              </th>
              <th className="col-flex">Nome Fantasia</th>
              <th className="col-tight">
                CNPJ
                <DicaDaColuna id="cliente.cnpj" />
              </th>
              <th className="col-flex">Cidade/UF</th>
              <th className="col-tight">Telefone</th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="cliente.situacao" />
              </th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr
                key={customer.id}
                tabIndex={0}
                onClick={() => setModalState({ mode: "edit", customer })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setModalState({ mode: "edit", customer });
                  }
                }}
              >
                <td className="is-code col-tight">{customer.code}</td>
                <td className="col-flex">{customer.legalName}</td>
                <td className="col-flex">{customer.tradeName ?? "—"}</td>
                <td className="col-tight">
                  {customer.cnpj ? formatCnpj(customer.cnpj) : "—"}
                </td>
                <td className="col-flex">
                  {customer.city && customer.state
                    ? `${customer.city}/${customer.state}`
                    : customer.city ?? customer.state ?? "—"}
                </td>
                <td className="col-tight">{formatBrPhone(customer.phone) ?? "—"}</td>
                <td className="col-tight">
                  <span
                    className={
                      customer.active ? "badge badge--active" : "badge badge--inactive"
                    }
                  >
                    {customer.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <RowActions
                    actions={[
                      {
                        label: customer.active ? "Inativar" : "Reativar",
                        destructive: customer.active,
                        onSelect: () => handleToggleActive(customer),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", customer })}
                    >
                      Editar
                    </button>
                  </RowActions>
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

      {modalState.mode !== "closed" && (
        <CustomerFormModal
          key={modalState.mode === "edit" ? modalState.customer.id : "create"}
          mode={modalState.mode}
          customer={modalState.mode === "edit" ? modalState.customer : null}
          onClose={() => setModalState({ mode: "closed" })}
          onSaved={() => {
            setModalState({ mode: "closed" });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="Inativar cliente?"
        message={
          <>
            "{confirmDeactivate?.legalName}" deixará de aparecer para novos
            produtos e ordens de produção. O registro não será excluído — o
            histórico será preservado e ele pode ser reativado a qualquer
            momento.
          </>
        }
        confirmLabel="Inativar"
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          const target = confirmDeactivate;
          setConfirmDeactivate(null);
          if (target) void applyActive(target, false);
        }}
      />
    </>
  );
}
