import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { downloadPdf, renderPdfBlob } from "./render";
import "./pdf.css";

/** O documento montado e o nome do arquivo que ele gera. */
export type PdfBuild = { document: ReactElement; fileName: string };

type Pronto = { url: string; blob: Blob; fileName: string; backTo: string };

/**
 * Tela do documento PDF.
 *
 * Rota fora do AppShell, no lugar das antigas páginas de impressão: carrega
 * o dado pela API autenticada, gera o PDF e mostra o PRÓPRIO arquivo. As duas
 * ações dizem o que fazem — "Baixar PDF" salva o arquivo com o nome do
 * documento; "Imprimir" manda o mesmo arquivo para a impressora, e o papel sai
 * idêntico ao PDF: sem cabeçalho, rodapé, data ou URL do navegador.
 *
 * `build` importa o módulo do documento sob demanda — o motor de PDF só entra
 * no navegador de quem gera um documento.
 */
export function PdfScreen<T>({
  load,
  build,
  backTo,
}: {
  load: () => Promise<T>;
  build: (data: T) => Promise<PdfBuild>;
  /** Função quando o destino só é conhecido depois de carregar o documento. */
  backTo: string | ((data: T) => string);
}) {
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const [pronto, setPronto] = useState<Pronto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let url: string | null = null;
    (async () => {
      const data = await load();
      const { document: documento, fileName } = await build(data);
      const blob = await renderPdfBlob(documento);
      if (cancelado) return;
      url = URL.createObjectURL(blob);
      setPronto({
        url,
        blob,
        fileName,
        backTo: typeof backTo === "function" ? backTo(data) : backTo,
      });
    })().catch((err: unknown) => {
      if (!cancelado) setErro(err instanceof Error ? err.message : "Falha ao gerar o documento");
    });
    return () => {
      cancelado = true;
      if (url) URL.revokeObjectURL(url);
    };
    // A carga depende só do id da rota, resolvido pelo `load` do chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function voltar() {
    if (pronto) navigate(pronto.backTo);
    else if (typeof backTo === "string") navigate(backTo);
    else navigate(-1);
  }

  function imprimir() {
    const janela = frame.current?.contentWindow;
    if (!pronto || !janela) return;
    try {
      janela.focus();
      janela.print();
    } catch {
      // Leitor de PDF que não aceita comando da página: abre o arquivo solto.
      window.open(pronto.url, "_blank", "noopener");
    }
  }

  return (
    <div className="pdf-screen">
      <div className="pdf-screen__bar">
        <button type="button" className="btn btn--ghost" onClick={voltar}>
          ← Voltar
        </button>
        <span className="pdf-screen__name">{pronto?.fileName ?? ""}</span>
        <div className="pdf-screen__actions">
          <button type="button" className="btn btn--secondary" onClick={imprimir} disabled={!pronto}>
            Imprimir
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => pronto && downloadPdf(pronto.blob, pronto.fileName)}
            disabled={!pronto}
          >
            Baixar PDF
          </button>
        </div>
      </div>

      {erro ? (
        <p className="form-alert pdf-screen__status" role="alert">
          Não foi possível gerar o documento: {erro}
        </p>
      ) : pronto ? (
        <iframe
          ref={frame}
          className="pdf-screen__frame"
          // Sem a barra do leitor: baixar e imprimir ficam nos botões acima,
          // com o nome certo do arquivo.
          src={`${pronto.url}#toolbar=0&navpanes=0`}
          title={`Documento ${pronto.fileName}`}
        />
      ) : (
        <p className="pdf-screen__status" role="status">
          Gerando PDF…
        </p>
      )}
    </div>
  );
}
