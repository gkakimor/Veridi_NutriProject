import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LotDTO } from "@veridi/shared";
import { LOT_STATUS_LABELS } from "@veridi/shared";
import { lookupLot } from "../../lib/lots-api";
import { FormSection } from "../../components/FormSection";
import { LotScanner } from "../../components/LotScanner";
import { EntityLink } from "../../components/EntityLink";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { formatDate } from "../../lib/dates";


function statusBadgeClass(status: LotDTO["status"], isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    case "BLOCKED":
    case "EXPIRED":
      return "badge badge--err";
  }
}

/**
 * Fluxo scan-first: câmera OU digitação, depois um card compacto de
 * resultado — não tenta reproduzir a tabela desktop inteira em mobile.
 */
export function LotScanPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LotDTO | null>(null);

  async function handleDetect(rawValue: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const lot = await lookupLot(rawValue);
      if (lot) {
        setResult(lot);
      } else {
        setError(`Lote "${rawValue}" não encontrado.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar lote");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          {/* Era um subtitulo com cara de trilha: "Estoque / Lotes / Escanear"
              em texto puro, imitando navegacao sem navegar — e nesta tela, que
              e a pensada para o operador de chao de fabrica com a mao ocupada,
              tentar voltar por ali e o gesto natural. */}
          <PageBreadcrumbs items={[{ label: "Lotes", href: "/estoque/lotes" }, { label: "Escanear" }]} />
          <h1 className="page__title">Escanear lote</h1>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
          ← Voltar
        </button>
      </div>

      {!result && (
        <FormSection title="Ler QR ou digitar lote">
          <LotScanner onDetect={handleDetect} />
          {loading && <p className="field__hint">Consultando…</p>}
          {error && <p className="form-alert" role="alert">{error}</p>}
        </FormSection>
      )}

      {result && (
        <FormSection title="Lote encontrado">
          <div className="lot-scan-result">
            <div className="lot-scan-result__head">
              <span className="code">{result.code}</span>
              <span className={statusBadgeClass(result.status, result.isExpired)}>
                {result.isExpired ? "Vencido" : LOT_STATUS_LABELS[result.status]}
              </span>
            </div>
            <p className="lot-scan-result__item">
              <EntityLink kind="item" id={result.itemId} code={result.itemCode} name={result.itemName} />
            </p>
            <dl className="definition-list">
              <dt>Validade</dt>
              <dd>{formatDate(result.expiryDate)}</dd>
              <dt>Localização</dt>
              <dd>{result.location ?? "—"}</dd>
            </dl>
            <div className="table__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setResult(null)}
              >
                Escanear outro
              </button>
              <Link
                className="btn btn--primary btn--sm"
                to={`/estoque/lotes/${result.id}`}
              >
                Ver detalhes
              </Link>
            </div>
          </div>
        </FormSection>
      )}
    </>
  );
}
