import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import type { SupplierDTO } from "@veridi/shared";
import { formatBrPhone } from "@veridi/shared";
import { formatCnpj } from "@veridi/shared";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import type { ListSuppliersParams } from "../../lib/suppliers-api";
import { listSuppliers, setSupplierActive } from "../../lib/suppliers-api";
import { SupplierFormModal } from "./SupplierFormModal";
import { podeMudarSituacaoDoFornecedor, usePodeEditarFornecedor } from "./supplier-permissions";
import { useOptionalAuth } from "../../app/AuthProvider";
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
  | { mode: "edit"; supplier: SupplierDTO };

const PAGE_SIZE = 20;

/** Cadastros → Fornecedores. Mesmo padrao de tabela densa + modal de Items. */
export function SuppliersPage() {
  /*
   * MASTER-DATA-EDIT-PERMISSIONS-01: criar, editar, inativar e reativar são de
   * Compras e Administrador. Os demais perfis abrem o Fornecedor em consulta —
   * pela linha, pelo "Ver" ou por link de outra tela — e não recebem
   * "+ Novo fornecedor".
   */
  const podeEditar = usePodeEditarFornecedor();
  const sessao = useOptionalAuth();
  const podeMudarSituacao = sessao === null || podeMudarSituacaoDoFornecedor(sessao.user?.role);
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

  // Filtro antigo somado ao contexto esconderia o próprio registro citado.
  useEffect(() => {
    if (!contextKey) return;
    setSearchInput("");
    setSearch("");
    setActiveFilter("all");
  }, [contextKey]);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListSuppliersParams, "page" | "pageSize"> = {};
    if (contextKey) filtros.ids = contextKey.split(",").filter(Boolean);
    if (search) filtros.search = search;
    if (activeFilter !== "all") filtros.active = activeFilter === "active";
    return filtros;
  }, [contextKey, search, activeFilter]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listSuppliers,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar fornecedores" },
  );
  const suppliers: SupplierDTO[] = consulta.data?.suppliers ?? [];
  const total = consulta.data?.total ?? 0;
  const reload = consulta.reload;

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
      // Recusa por situação que já mudou (409): a linha volta a mostrar a verdade.
      reload();
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
        {/* Leva à tela oficial, não ao modal: o cadastro passou a ter URL
            própria, e é ela que sobrevive a um F5 e vale como link. O modal
            continua servindo à EDIÇÃO, aberta a partir da linha. */}
        {podeEditar && (
          <Link className="btn btn--primary" to="/cadastros/fornecedores/novo">
            + Novo fornecedor
          </Link>
        )}
        <ExportCsvButton path="/suppliers/export.csv" filters={{ search, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
</div>

      {/* A pergunta que traz alguém aqui costuma ser "onde cadastro o preço
          deste fornecedor?" — e a resposta é outra tela. Melhor dizer isso
          no topo do que deixar procurar um campo que não existe. */}
      <ContextHelp topic={helpTopics["fornecedor.comoFunciona"]} />

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

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      {contextIds && (
        <RecordContextChip
          noun="o fornecedor"
          code={suppliers[0]?.code}
          name={suppliers[0]?.tradeName ?? suppliers[0]?.legalName}
          onClear={clearContext}
        />
      )}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">
                Razão Social / Nome
                <DicaDaColuna id="fornecedor.razaoSocial" />
              </th>
              <th className="col-flex">Nome Fantasia</th>
              <th className="col-tight">
                CNPJ
                <DicaDaColuna id="fornecedor.cnpj" />
              </th>
              <th className="col-tight">Telefone</th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="fornecedor.situacao" />
              </th>
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
                <td className="is-code col-tight">{supplier.code}</td>
                <td className="col-flex">{supplier.legalName}</td>
                <td className="col-flex">{supplier.tradeName ?? "—"}</td>
                <td className="col-tight">
                  {supplier.cnpj ? formatCnpj(supplier.cnpj) : "—"}
                </td>
                <td className="col-tight">{formatBrPhone(supplier.phone) ?? "—"}</td>
                <td className="col-tight">
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
                    label={`Mais ações de ${supplier.code}`}
                    actions={
                      podeMudarSituacao
                        ? [
                            {
                              label: supplier.active ? "Inativar" : "Reativar",
                              destructive: supplier.active,
                              onSelect: () => handleToggleActive(supplier),
                            },
                          ]
                        : []
                    }
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", supplier })}
                    >
                      {podeEditar ? "Editar" : "Ver"}
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={7} query={consulta} rowCount={suppliers.length}>
              Nenhum fornecedor encontrado.
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "fornecedor" : "fornecedores"}
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

      {modalState.mode !== "closed" && (
        <SupplierFormModal
          key={modalState.mode === "edit" ? modalState.supplier.id : "create"}
          mode={modalState.mode}
          supplier={modalState.mode === "edit" ? modalState.supplier : null}
          readOnly={!podeEditar}
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
