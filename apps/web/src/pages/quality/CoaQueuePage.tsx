import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { RejectCoaDialog } from "../../components/RejectCoaDialog";
import { useNavigate, Link } from "react-router-dom";
import type { CoaStatus, QualityQueueRowDTO } from "@veridi/shared";
import { COA_STATUSES, COA_STATUS_LABELS, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import { approveCoa, listQualityQueue, rejectCoa } from "../../lib/attachments-api";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ lotId: string; lotCode: string } | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [coaStatus, setCoaStatus] = useState<CoaStatus | "pending">("pending");
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, coaStatus, onlyWithBalance]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listQualityQueue>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (coaStatus === "pending") params.onlyPending = true;
    else params.coaStatus = coaStatus;
    if (onlyWithBalance) params.onlyWithBalance = true;

    listQualityQueue(params)
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a fila da Qualidade"),
      )
      .finally(() => setLoading(false));
  }, [page, search, coaStatus, onlyWithBalance]);

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
          value={coaStatus}
          onChange={(event) => setCoaStatus(event.target.value as CoaStatus | "pending")}
        >
          <option value="pending">Pendências</option>
          {COA_STATUSES.map((status) => (
            <option key={status} value={status}>
              {COA_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyWithBalance}
            onChange={(event) => setOnlyWithBalance(event.target.checked)}
          />
          Somente com saldo
        </label>
      </div>

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
          onClick={() => setPage((current) => Math.max(1, current - 1))}
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
          onClick={() => setPage((current) => current + 1)}
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
