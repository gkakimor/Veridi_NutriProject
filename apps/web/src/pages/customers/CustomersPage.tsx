import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import type {
  CustomerCommercialStatus,
  CustomerDTO,
  CustomerStatus,
  CustomerStatusAction,
} from "@veridi/shared";
import {
  BR_STATE_CODES,
  CUSTOMER_COMMERCIAL_STATUS_LABELS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_ACTIONS_BY_STATUS,
  CUSTOMER_STATUS_ACTION_LABELS,
  CUSTOMER_STATUS_CHANGE_ROLES,
  CUSTOMER_STATUS_FILTER_LABELS,
  CUSTOMER_STATUS_LABELS,
  DEFAULT_CUSTOMER_STATUS_FILTER,
  formatBrPhone,
  formatCnpj,
} from "@veridi/shared";
import { useAuth } from "../../app/AuthProvider";
import { commercialStatusBadgeClass } from "./commercial-status-badge";
import { customerStatusBadgeClass } from "./customer-status-badge";
import type { ListCustomersParams } from "../../lib/customers-api";
import { changeCustomerStatus, listCustomers } from "../../lib/customers-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { CustomerFormModal } from "./CustomerFormModal";
import { CustomerStatusDialog } from "./CustomerStatusDialog";
import { PEDIR_CADASTRO_DE_CLIENTE, podeEditarCliente } from "./customer-permissions";
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

/**
 * Situação CADASTRAL (§95) — pode vender para este cliente? A lista abre em
 * "Ativos": bloqueados e inativos ficam arquivados fora da abertura, a um
 * filtro de distância, como a Veridi pediu.
 */
type StatusFilter = "ALL" | CustomerStatus;

/**
 * Situação COMERCIAL derivada (§86) — outra pergunta, outro filtro. "Clientes
 * ativos" continua sendo o padrão dela, decisão registrada no BACKLOG; os
 * seletores de Cliente das outras telas não filtram nada disso.
 */
type CommercialFilter = "ALL" | CustomerCommercialStatus;
const COMMERCIAL_FILTER_DEFAULT: CommercialFilter = "ACTIVE";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; customer: CustomerDTO };

/** A ação de situação em curso, com o cliente sobre o qual ela vai acontecer. */
interface AcaoDeSituacao {
  action: CustomerStatusAction;
  customer: CustomerDTO;
}

const PAGE_SIZE = 20;

/** Cadastros → Clientes. Mesmo padrao de tabela densa + modal de Items. */
export function CustomersPage() {
  const { user } = useAuth();
  /*
   * Bloquear, desbloquear, inativar e reativar são de Comercial e
   * Administrador — a MESMA lista que a API aplica. Os demais perfis leem a
   * situação e o motivo na coluna, e o histórico na Visão do Cliente; só não
   * recebem a ação que seria recusada.
   */
  const podeMudarSituacao = user !== null && CUSTOMER_STATUS_CHANGE_ROLES.includes(user.role);
  /*
   * Criar e editar o cadastro também são de Comercial e Administrador, por
   * outra lista (`CUSTOMER_EDIT_ROLES`). Os demais perfis abrem o Cliente em
   * consulta — pela linha, pelo "Ver" ou por link de outra tela — e não
   * recebem "+ Novo cliente".
   */
  const podeEditar = podeEditarCliente(user?.role);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_CUSTOMER_STATUS_FILTER);
  const [commercialFilter, setCommercialFilter] =
    useState<CommercialFilter>(COMMERCIAL_FILTER_DEFAULT);

  /*
   * "Nada para estes filtros" e "nada cadastrado" sao frases diferentes, e a
   * lista dizia so a segunda. Quem filtrou por UF e nao achou concluia que o
   * cliente nao existia — sem nenhum caminho de volta na tela.
   */
  const hasFilters = searchInput !== "" || search !== "" || stateFilter !== "";

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStateFilter("");
    setStatusFilter("ALL");
    setCommercialFilter("ALL");
  }

  // Chegada por link contextual: `ids` reduz a lista, `open` abre o registro.
  const { contextIds, openId, clear: clearContext, contextKey } = useRecordContext(
    "/cadastros/clientes",
  );

  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [acao, setAcao] = useState<AcaoDeSituacao | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [salvandoAcao, setSalvandoAcao] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Filtro antigo somado ao contexto esconderia o próprio registro citado.
  useEffect(() => {
    if (!contextKey) return;
    setSearchInput("");
    setSearch("");
    setStateFilter("");
    setStatusFilter("ALL");
    setCommercialFilter("ALL");
  }, [contextKey]);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListCustomersParams, "page" | "pageSize"> = {};
    if (contextKey) filtros.ids = contextKey.split(",").filter(Boolean);
    if (search) filtros.search = search;
    if (stateFilter) filtros.state = stateFilter;
    // O contexto mostra o registro citado, seja qual for a situação dele.
    if (statusFilter !== "ALL" && !contextKey) filtros.status = [statusFilter];
    if (commercialFilter !== "ALL" && !contextKey) filtros.commercialStatus = commercialFilter;
    return filtros;
  }, [contextKey, search, stateFilter, statusFilter, commercialFilter]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listCustomers,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar clientes" },
  );
  const customers: CustomerDTO[] = consulta.data?.customers ?? [];
  const total = consulta.data?.total ?? 0;
  const reload = consulta.reload;

  useOpenRecord(openId, customers, (customer) => setModalState({ mode: "edit", customer }));

  function abrirAcao(action: CustomerStatusAction, customer: CustomerDTO) {
    setErroDaAcao(null);
    setAcao({ action, customer });
  }

  /*
   * O diálogo continua aberto quando o servidor recusa — com o motivo já
   * digitado —, porque a recusa costuma ser sobre a própria ação ("já está
   * bloqueado") e fechar tudo obrigaria a redigitar para ler o porquê.
   */
  async function confirmarAcao(reason: string) {
    if (!acao) return;
    setSalvandoAcao(true);
    setErroDaAcao(null);
    try {
      await changeCustomerStatus(acao.customer.id, acao.action, reason);
      setAcao(null);
      reload();
    } catch (err) {
      setErroDaAcao(err instanceof Error ? err.message : "Falha ao mudar a situação do cliente");
    } finally {
      setSalvandoAcao(false);
    }
  }

  /** O que o vazio está respondendo — as duas situações filtradas, por extenso. */
  const situacoesFiltradas = [
    statusFilter !== "ALL"
      ? `a situação cadastral “${CUSTOMER_STATUS_FILTER_LABELS[statusFilter]}”`
      : null,
    commercialFilter !== "ALL"
      ? `a situação comercial “${CUSTOMER_COMMERCIAL_STATUS_LABELS[commercialFilter]}”`
      : null,
  ].filter((parte): parte is string => parte !== null);

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
        {podeEditar && (
          <Link className="btn btn--primary" to="/cadastros/clientes/novo">
            + Novo cliente
          </Link>
        )}
        <ExportCsvButton
          path="/customers/export.csv"
          filters={{
            search,
            state: stateFilter,
            status: statusFilter === "ALL" ? undefined : statusFilter,
            commercialStatus: commercialFilter === "ALL" ? undefined : commercialFilter,
          }}
        />
</div>

      {/* O cadastro parece só uma agenda até alguém descobrir que ele decide
          propriedade de material, identidade em documento impresso e o que
          um cliente bloqueado ou inativo passa a recusar. */}
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

        {/* Situação cadastral (§95): o filtro principal, aberto em "Ativos". */}
        <label className="sr-only" htmlFor="customers-status-filter">
          Filtrar por situação cadastral
        </label>
        <select
          id="customers-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          {CUSTOMER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CUSTOMER_STATUS_FILTER_LABELS[status]}
            </option>
          ))}
          <option value="ALL">Todos</option>
        </select>

        {/* Situação comercial (§86) e situação cadastral são perguntas
            diferentes, e cada filtro diz qual está respondendo. */}
        <label className="sr-only" htmlFor="customers-commercial-filter">
          Filtrar por situação comercial
        </label>
        <select
          id="customers-commercial-filter"
          value={commercialFilter}
          onChange={(event) => setCommercialFilter(event.target.value as CommercialFilter)}
        >
          <option value="ACTIVE">Clientes ativos</option>
          <option value="PROSPECT">Prospects</option>
          <option value="INACTIVE">Inativos</option>
          <option value="ALL">Todos</option>
        </select>
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      {contextIds && (
        <RecordContextChip
          noun="o cliente"
          code={customers[0]?.code}
          name={customers[0]?.tradeName ?? customers[0]?.legalName}
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
                <DicaDaColuna id="cliente.razaoSocial" />
              </th>
              <th className="col-flex">Nome Fantasia</th>
              <th className="col-tight">
                CNPJ
                <DicaDaColuna id="cliente.cnpj" />
              </th>
              <th className="col-flex">Cidade/UF</th>
              <th className="col-tight">Telefone</th>
              <th className="col-tight">Situação comercial</th>
              <th className="col-tight">
                Situação cadastral
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
                  {customer.commercial ? (
                    <span
                      className={commercialStatusBadgeClass(customer.commercial.status)}
                      title={customer.commercial.reason}
                    >
                      {CUSTOMER_COMMERCIAL_STATUS_LABELS[customer.commercial.status]}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-tight">
                  {/* O motivo do bloqueio viaja no rótulo: quem passa o olho
                      na lista precisa saber por que aquele cliente parou. */}
                  <span
                    className={customerStatusBadgeClass(customer.status)}
                    {...(customer.block ? { title: `Motivo: ${customer.block.reason}` } : {})}
                  >
                    {CUSTOMER_STATUS_LABELS[customer.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <RowActions
                    label={`Mais ações de ${customer.code}`}
                    actions={
                      podeMudarSituacao
                        ? CUSTOMER_STATUS_ACTIONS_BY_STATUS[customer.status].map((action) => ({
                            label: CUSTOMER_STATUS_ACTION_LABELS[action],
                            destructive: action === "BLOCK" || action === "DEACTIVATE",
                            onSelect: () => abrirAcao(action, customer),
                          }))
                        : []
                    }
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", customer })}
                    >
                      {podeEditar ? "Editar" : "Ver"}
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={9} query={consulta} rowCount={customers.length}>
              {hasFilters ? (
                <>
                  Nenhum cliente encontrado para os filtros atuais.{" "}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={clearFilters}
                  >
                    Limpar filtros
                  </button>
                </>
              ) : situacoesFiltradas.length > 0 ? (
                <>
                  Nenhum cliente com {situacoesFiltradas.join(" e ")}.{" "}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setStatusFilter("ALL");
                      setCommercialFilter("ALL");
                    }}
                  >
                    Ver todos
                  </button>
                </>
              ) : podeEditar ? (
                "Nenhum cliente cadastrado ainda. O cliente é a raiz de projeto, pedido e produto — comece por ele."
              ) : (
                `Nenhum cliente cadastrado ainda. ${PEDIR_CADASTRO_DE_CLIENTE}`
              )}
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "cliente" : "clientes"}
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
        <CustomerFormModal
          key={modalState.mode === "edit" ? modalState.customer.id : "create"}
          mode={modalState.mode}
          customer={modalState.mode === "edit" ? modalState.customer : null}
          readOnly={!podeEditar}
          onClose={() => setModalState({ mode: "closed" })}
          onSaved={() => {
            setModalState({ mode: "closed" });
            reload();
          }}
        />
      )}

      {acao && (
        <CustomerStatusDialog
          key={`${acao.action}-${acao.customer.id}`}
          action={acao.action}
          customer={acao.customer}
          error={erroDaAcao}
          saving={salvandoAcao}
          onCancel={() => {
            setAcao(null);
            setErroDaAcao(null);
          }}
          onConfirm={(reason) => void confirmarAcao(reason)}
        />
      )}
    </>
  );
}
