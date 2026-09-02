import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { ReceiptDTO } from "@veridi/shared";
import { RECEIPT_SOURCE_TYPE_LABELS } from "@veridi/shared";
import { listReceipts } from "../../lib/receiving-api";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

const PAGE_SIZE = 20;

/** Compras → Recebimentos. Receipt e historico/somente-leitura apos confirmado. */
export function ReceiptsPage() {
  const navigate = useNavigate();

  const [receipts, setReceipts] = useState<ReceiptDTO[]>([]);
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

    const params: Parameters<typeof listReceipts>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;

    listReceipts(params)
      .then((result) => {
        setReceipts(result.receipts);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar recebimentos");
      })
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Recebimentos</h1>
          <p className="page__subtitle">
            Materiais recebidos de Ordens de Compra ou enviados pelo próprio cliente.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/compras/recebimentos/novo")}
        >
          Receber OC
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => navigate("/compras/recebimentos/material-do-cliente")}
        >
          Receber material do cliente
        </button>
        <ExportCsvButton path="/receipts/export.csv" filters={{ search }} />
</div>

      {/* Duas entradas muito diferentes moram na mesma lista — compra da
          Veridi e remessa do cliente. Dizer isso antes da tabela evita a
          pergunta "por que este recebimento não tem fornecedor?". */}
      <ContextHelp topic={helpTopics["compras.recebimentos"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="receipts-search">
            Buscar recebimentos
          </label>
          <input
            id="receipts-search"
            type="search"
            placeholder="Buscar por código ou OC…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Origem</th>
              <th>OC</th>
              <th>Fornecedor / Cliente</th>
              <th>Data</th>
              <th className="is-numeric">Itens</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr
                key={receipt.id}
                tabIndex={0}
                onClick={() => navigate(`/compras/recebimentos/${receipt.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/compras/recebimentos/${receipt.id}`);
                }}
              >
                <td className="is-code">{receipt.code}</td>
                <td>{RECEIPT_SOURCE_TYPE_LABELS[receipt.sourceType]}</td>
                <td className="is-code">{receipt.purchaseOrderCode ?? "—"}</td>
                <td>
                  {receipt.sourceType === "CUSTOMER_SUPPLIED"
                    ? `Cliente — ${receipt.customerName ?? ""}`
                    : (receipt.supplierName ?? "—")}
                </td>
                <td>{formatDate(receipt.receivedAt)}</td>
                <td className="is-numeric">{receipt.lines.length}</td>
                <td>
                  <span className="badge badge--active">Confirmado</span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/compras/recebimentos/${receipt.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && receipts.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhum recebimento encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "recebimento" : "recebimentos"}
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
