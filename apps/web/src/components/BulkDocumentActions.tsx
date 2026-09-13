import { useEffect, useRef, useState } from "react";
import type { BulkSelectionDescriptor } from "@veridi/shared";
import { apiErrorMessage } from "../lib/api-errors";

/**
 * Ações DOCUMENTAIS da seleção em massa — BULK-DOCUMENTS-01.
 *
 * "Baixar PDF" e "Exportar CSV" leem a seleção; nenhuma muda registro, e por
 * isso são secundárias — não competem com as ações que gravam na página. Vale
 * o descritor do momento do clique (o servidor resolve o conjunto), cada ação
 * roda uma vez por clique e a seleção continua de pé depois do download.
 */

type Acao = "pdf" | "csv";

const SUCESSO: Record<Acao, string> = { pdf: "PDF gerado.", csv: "CSV exportado." };
const FALHA: Record<Acao, string> = {
  pdf: "Não foi possível gerar o PDF.",
  csv: "Não foi possível exportar o CSV.",
};

export function BulkDocumentActions<F>({
  descriptor,
  onDownloadPdf,
  onExportCsv,
}: {
  /** `null` sem seleção — a barra nem aparece, mas a ação não confia nisso. */
  descriptor: BulkSelectionDescriptor<F> | null;
  onDownloadPdf: (descriptor: BulkSelectionDescriptor<F>) => Promise<void>;
  onExportCsv: (descriptor: BulkSelectionDescriptor<F>) => Promise<void>;
}) {
  const [emCurso, setEmCurso] = useState<Record<Acao, boolean>>({ pdf: false, csv: false });
  // O estado só chega no próximo render; o segundo clique do duplo chega antes.
  const trava = useRef<Record<Acao, boolean>>({ pdf: false, csv: false });
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Seleção nova, recado velho não fica.
  const chave = JSON.stringify(descriptor);
  useEffect(() => {
    setFeito(null);
    setErro(null);
  }, [chave]);

  async function executar(acao: Acao) {
    if (!descriptor || trava.current[acao]) return;
    trava.current[acao] = true;
    setEmCurso((atual) => ({ ...atual, [acao]: true }));
    setFeito(null);
    setErro(null);
    try {
      if (acao === "pdf") await onDownloadPdf(descriptor);
      else await onExportCsv(descriptor);
      setFeito(SUCESSO[acao]);
    } catch (err) {
      setErro(apiErrorMessage(err, FALHA[acao]));
    } finally {
      trava.current[acao] = false;
      setEmCurso((atual) => ({ ...atual, [acao]: false }));
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={emCurso.pdf}
        onClick={() => void executar("pdf")}
      >
        {emCurso.pdf ? "Gerando PDF…" : "Baixar PDF"}
      </button>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={emCurso.csv}
        onClick={() => void executar("csv")}
      >
        {emCurso.csv ? "Gerando CSV…" : "Exportar CSV"}
      </button>
      {feito && (
        <span className="bulk-bar__feedback" role="status">
          {feito}
        </span>
      )}
      {erro && (
        <span className="bulk-bar__feedback bulk-bar__feedback--error" role="alert">
          {erro}
        </span>
      )}
    </>
  );
}
