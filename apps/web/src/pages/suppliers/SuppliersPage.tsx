import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import type { SupplierDTO } from "@veridi/shared";
import { formatCnpj } from "@veridi/shared";
import { listSuppliers, setSupplierActive } from "../../lib/suppliers-api";
import { SupplierFormModal } from "./SupplierFormModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RowActions } from "../../components/RowActions";
import {
  RecordContextChip,
  useOpenRecord,
  useRecordContext,
} from "../../components/RecordContext";

type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; supplier: SupplierDTO };

const PAGE_SIZE = 20;

/** Cadastros → Fornecedores. Mesmo padrao de tabela densa + modal de Items. */
export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  // Chegada por link contextual: `ids` reduz a lista, `open` abre o registro.
  const { contextIds, openId, clear: clearContext, contextKey } = useRecordContext(
    "/cadastros/fornecedores",
  );

  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [confirmDeactivate, setConfirmDeactivate] = useState<SupplierDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, activeFilter, contextKey]);

  // Filtro antigo somado ao contexto esconderia o próprio registro citado.
  useEffect(() => {
    if (!contextKey) return;
    setSearchInput("");
    setSearch("");
    setActiveFilter("all");
  }, [contextKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listSuppliers>[0] = { page, pageSize: PAGE_SIZE };
    if (contextIds) params.ids = contextIds;
    if (search) params.search = search;
    if (activeFilter !== "all") params.active = activeFilter === "active";

    listSuppliers(params)
      .then((result) => {
        setSuppliers(result.suppliers);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar fornecedores");
      })
      .finally(() => setLoading(false));
  }, [page, search, activeFilter, contextKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useOpenRecord(openId, suppliers, (supplier) => setModalState({ mode: "edit", supplier }));

  function handleToggleActive(supplier: SupplierDTO) {
    if (supplier.active) {
      setConfirmDeactivate(supplier);
      return;
    }
    void applyActive(supplier, true);
  }

  async function applyActive(supplier: SupplierDTO, active: boolean) {
    try {
      await setSupplierActive(supplier.id, active);
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
          <h1 className="page__title">Fornecedores</h1>
          <p className="page__subtitle">
            Base de fornecedores utilizada em compras, recebimento e
            rastreabilidade.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setModalState({ mode: "create" })}
        >
          + Novo fornecedor
        </button>
        <ExportCsvButton path="/suppliers/export.csv" filters={{ search, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
</div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="suppliers-search">
            Buscar fornecedores
          </label>
          <input
            id="suppliers-search"
            type="search"
            placeholder="Buscar por código, razão social, fantasia ou CNPJ…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="suppliers-active-filter">
          Filtrar por status
        </label>
        <select
          id="suppliers-active-filter"
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
          noun="o fornecedor"
          code={suppliers[0]?.code}
          name={suppliers[0]?.tradeName ?? suppliers[0]?.legalName}
          onClear={clearContext}
        />
      )}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Razão Social / Nome</th>
              <th>Nome Fantasia</th>
              <th>CNPJ</th>
              <th>Telefone</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr
                key={supplier.id}
                tabIndex={0}
                onClick={() => setModalState({ mode: "edit", supplier })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setModalState({ mode: "edit", supplier });
                  }
                }}
              >
                <td className="is-code">{supplier.code}</td>
                <td>{supplier.legalName}</td>
                <td>{supplier.tradeName ?? "—"}</td>
                <td>{supplier.cnpj ? formatCnpj(supplier.cnpj) : "—"}</td>
                <td>{supplier.phone ?? "—"}</td>
                <td>
                  <span
                    className={
                      supplier.active ? "badge badge--active" : "badge badge--inactive"
                    }
                  >
                    {supplier.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <RowActions
                    actions={[
                      {
                        label: supplier.active ? "Inativar" : "Reativar",
                        destructive: supplier.active,
                        onSelect: () => handleToggleActive(supplier),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", supplier })}
                    >
                      Editar
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}

            {!loading && suppliers.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum fornecedor encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "fornecedor" : "fornecedores"}
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
        <SupplierFormModal
          key={modalState.mode === "edit" ? modalState.supplier.id : "create"}
          mode={modalState.mode}
          supplier={modalState.mode === "edit" ? modalState.supplier : null}
          onClose={() => setModalState({ mode: "closed" })}
          onSaved={() => {
            setModalState({ mode: "closed" });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="Inativar fornecedor?"
        message={
          <>
            "{confirmDeactivate?.legalName}" deixará de aparecer para novas
            compras e recebimentos. O registro não será excluído — o
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
