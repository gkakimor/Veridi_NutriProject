import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RejectCoaDialog } from "../../components/RejectCoaDialog";
import { useNavigate, Link } from "react-router-dom";
import type { CoaStatus, QualityQueueRowDTO } from "@veridi/shared";
import { COA_STATUSES, COA_STATUS_LABELS, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import type { QualityQueueParams } from "../../lib/attachments-api";
import { approveCoa, listQualityQueue, rejectCoa } from "../../lib/attachments-api";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { useListFilters } from "../../lib/list-filters";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

const PAGE_SIZE = 20;

/**
 * O recorte documental: as pendências, um `CoaStatus` exato, ou tudo.
 *
 * `PENDENCIAS` é o default da tela e vale por três status (`PENDING`,
 * `RECEIVED`, `REJECTED`) — é "o que exige ação da Qualidade", e o servidor
 * responde por `onlyPending`. `TODOS` não existia: o `<select>` obrigava um
 * recorte e não havia como ver a fila inteira, então um lote já aprovado só
 * aparecia se alguém adivinhasse escolher "Aprovado".
 *
 * O valor `pendencias` é escrito assim, e não `pending`, porque ele entra na
 * URL ao lado de `PENDING` — um `CoaStatus` de verdade, que quer dizer
 * "pendente de documento" e é UM dos três. Dois valores diferindo só por
 * caixa, com significados diferentes, é confusão garantida no dia em que
 * alguém lê o endereço.
 */
const PENDENCIAS = "pendencias";
const TODOS = "todos";

const FILTROS_PADRAO = {
  search: "",
  /* Default preservado: a Qualidade abre no que exige ação dela. */
  coa: PENDENCIAS,
  comSaldo: "nao",
  /* Contexto por link: item, fornecedor, cliente-proprietário. */
  itemId: "",
  supplierId: "",
  ownerCustomerId: "",
};

function coaBadgeClass(status: CoaStatus): string {
  switch (status) {
    case "APPROVED":
      return "badge badge--active";
    case "REJECTED":
      return "badge badge--err";
    case "PENDING":
    case "RECEIVED":
      return "badge badge--warn";
    default:
      return "badge badge--neutral";
  }
}


/**
 * Qualidade → Documentos / CoA.
 *
 * Read model sobre `Lot` + ledger — não existe entidade de fila. Aprovar o
 * laudo nunca libera o lote: a liberação continua sendo ação explícita na
 * tela do lote.
 */
export function CoaQueuePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReview = user?.role === "QUALITY" || user?.role === "ADMIN";

  const [rows, setRows] = useState<QualityQueueRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ lotId: string; lotCode: string } | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: "coa-queue",
    userId: user?.id ?? null,
  });
  const { search, coa, itemId, supplierId, ownerCustomerId } = values;
  const comSaldo = values.comSaldo === "sim";

  /* UM conjunto de filtros — a fila e qualquer export leem o mesmo. */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<QualityQueueParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (itemId) filtros.itemId = itemId;
    if (supplierId) filtros.supplierId = supplierId;
    if (ownerCustomerId) filtros.ownerCustomerId = ownerCustomerId;
    /*
     * Três caminhos, e só um chega à API por vez: `PENDENCIAS` vira
     * `onlyPending`, um `CoaStatus` vira `coaStatus`, e `TODOS` não manda
     * nada — é a ausência dos dois que faz o servidor devolver a fila
     * inteira.
     */
    if (coa === PENDENCIAS) filtros.onlyPending = true;
    else if (coa !== TODOS) filtros.coaStatus = coa as CoaStatus;
    if (comSaldo) filtros.onlyWithBalance = true;
    return filtros;
  }, [search, itemId, supplierId, ownerCustomerId, coa, comSaldo]);

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(handle);
  }, [searchInput, search, set]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    listQualityQueue({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a fila da Qualidade"),
      )
      .finally(() => setLoading(false));
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleApprove(lotId: string) {
    setError(null);
    try {
      await approveCoa(lotId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aprovar o CoA");
    }
  }

  async function handleReject(lotId: string, reason: string) {
    setRejecting(null);
    setError(null);
    try {
      await rejectCoa(lotId, reason);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao rejeitar o CoA");
    }
  }

  const chips: FilterChip[] = [];
  if (search) {
    chips.push({ label: "Busca", value: search, onRemove: () => set({ search: "" }) });
  }
  if (coa !== FILTROS_PADRAO.coa) {
    chips.push({
      label: "CoA",
      value: coa === TODOS ? "Todos" : COA_STATUS_LABELS[coa as CoaStatus],
      onRemove: () => set({ coa: FILTROS_PADRAO.coa }),
    });
  }
  if (comSaldo) {
    chips.push({
      label: "Saldo",
      value: "somente com saldo",
      onRemove: () => set({ comSaldo: "nao" }),
    });
  }
  if (itemId) {
    chips.push({
      label: "Item",
      value: rows.find((row) => row.itemId === itemId)?.itemName ?? "selecionado",
      onRemove: () => set({ itemId: "" }),
    });
  }
  if (supplierId) {
    chips.push({
      label: "Fornecedor",
      value: rows.find((row) => row.supplierName)?.supplierName ?? "selecionado",
      onRemove: () => set({ supplierId: "" }),
    });
  }
  if (ownerCustomerId) {
    chips.push({
      label: "Cliente",
      value: rows.find((row) => row.ownerCustomerName)?.ownerCustomerName ?? "selecionado",
      onRemove: () => set({ ownerCustomerId: "" }),
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Documentos / CoA</h1>
          <p className="page__subtitle">
            Situação documental dos lotes. Aprovar o laudo não libera o lote — a liberação da
            Qualidade continua sendo uma ação explícita no lote.
          </p>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate("/print/qualidade-pendencias")}
          >
            Folha de pendências (FO-03)
          </button>
        </div>
      </div>

      {/* Aprovar o laudo e liberar o lote são a mesma coisa na cabeça de quem
          chega — e são duas decisões, em duas telas. O subtítulo já diz;
          o painel explica por quê, e o que rejeitar faz com o lote. */}
      <ContextHelp topic={helpTopics["qualidadeDocumentos.comoFunciona"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="coa-search">
            Buscar lote ou item
          </label>
          <input
            id="coa-search"
            type="search"
            placeholder="Buscar por lote, lote do fornecedor ou item…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="coa-status-filter">
          Filtrar por situação documental
        </label>
        <select
          id="coa-status-filter"
          value={coa}
          onChange={(event) => set({ coa: event.target.value })}
        >
          <option value={PENDENCIAS}>Pendências</option>
          {/* Sem esta opção a tela obrigava um recorte documental, e a fila
              inteira era inalcançável. */}
          <option value={TODOS}>Todos</option>
          {COA_STATUSES.map((status) => (
            <option key={status} value={status}>
              {COA_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={comSaldo}
            onChange={(event) => set({ comSaldo: event.target.checked ? "sim" : "nao" })}
          />
          Somente com saldo
        </label>
      </div>

      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions">
          <thead>
            <tr>
              <th className="col-tight">Lote</th>
              <th className="col-flex">Item</th>
              <th className="col-flex">
                Fornecedor / Proprietário
                <DicaDaColuna id="qualidade.proprietario" />
              </th>
              <th className="col-tight is-numeric">Recebido em</th>
              <th className="col-tight">Validade</th>
              {/* Variável por causa do motivo da rejeição, que é texto livre:
                  em `nowrap` uma justificativa comprida arrastaria a fila
                  inteira para fora da tela. */}
              <th className="col-flex">
                CoA
                <DicaDaColuna id="qualidade.coa" />
              </th>
              <th className="col-tight">
                Qualidade
                <DicaDaColuna id="qualidade.situacaoLote" />
              </th>
              <th className="col-tight is-numeric">
                Físico
                <DicaDaColuna id="qualidade.fisico" />
              </th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.lotId}>
                <td className="col-tight is-code">{row.lotCode}</td>
                <td className="col-flex">
                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                  {row.sourceName && <div className="field__hint">Fonte: {row.sourceName}</div>}
                </td>
                <td className="col-flex">
                  {row.ownerType === "CUSTOMER"
                    ? ownerLabel(row.ownerType, row.ownerCustomerName)
                    : (row.supplierName ?? "—")}
                </td>
                <td className="col-tight is-numeric">{formatDate(row.receivedAt)}</td>
                <td className="col-tight">{formatDate(row.expiryDate)}</td>
                <td className="col-flex">
                  <span className={coaBadgeClass(row.coaStatus)}>
                    {COA_STATUS_LABELS[row.coaStatus]}
                  </span>
                  {row.coaReviewNote && <div className="field__hint">{row.coaReviewNote}</div>}
                </td>
                <td className="col-tight">
                  <span className="badge badge--neutral">
                    {row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.lotStatus]}
                  </span>
                </td>
                <td className="col-tight is-numeric">
                  {formatQuantity(row.onHand)} {row.unitCode}
                </td>
                <td>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/estoque/lotes/${row.lotId}`}
                    >
                      Abrir lote
                    </Link>
                    {canReview && row.requiresCoa && row.coaStatus === "RECEIVED" && (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void handleApprove(row.lotId)}
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setRejecting({ lotId: row.lotId, lotCode: row.lotCode })}
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  {/*
                    Esta fila é sobre LAUDO, não sobre liberação. Um lote
                    aguardando liberação cujo item não exige CoA nunca
                    aparece aqui — e o atalho do Dashboard chama esta tela de
                    "Fila da Qualidade", então o vazio parecia dizer que não
                    havia trabalho.
                  */}
                  Nenhum lote nesta situação documental. Esta fila mostra o andamento do{" "}
                  <strong>laudo (CoA)</strong>; a liberação de lote para uso é decidida em{" "}
                  <Link to="/estoque/lotes">Estoque › Lotes</Link>, inclusive para itens que não
                  exigem CoA.
                  {isActive && (
                    <>
                      {" "}
                      <ClearFilters onClear={clear} />
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page <= 1}
          onClick={() => setPage(Math.max(1, page - 1))}
        >
          Anterior
        </button>
        <span className="pagination__info">
          Página {page} de {totalPages} — {total} lote(s)
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Próxima
        </button>
      </div>

      {rejecting && (
        <RejectCoaDialog
          lotCode={rejecting.lotCode}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => void handleReject(rejecting.lotId, reason)}
        />
      )}
    </>
  );
}
