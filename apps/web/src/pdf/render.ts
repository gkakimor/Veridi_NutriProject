import type { ReactElement } from "react";

/**
 * Geração do arquivo PDF.
 *
 * O arquivo nasce no navegador, sobre os dados que a tela já buscou na API
 * autenticada: não existe URL de PDF no servidor e, portanto, nenhum
 * documento comercial alcançável sem sessão. Sem Chromium no servidor, sem
 * fila, sem processo para sobrar.
 *
 * O renderer entra sob demanda — ninguém carrega o motor de PDF só por abrir
 * o ERP.
 */
let renderer: Promise<typeof import("@react-pdf/renderer")> | null = null;

function carregarRenderer() {
  renderer ??= import("@react-pdf/renderer").then((modulo) => {
    /*
     * A hifenização padrão do renderer segue regra inglesa: partiria
     * "Magné-sio" e códigos como "LT-2026…" no meio. Documento da casa quebra
     * linha só entre palavras.
     */
    modulo.Font.registerHyphenationCallback((palavra) => [palavra]);
    return modulo;
  });
  return renderer;
}

/** Documento (`PdfDocument`) → arquivo PDF. */
export async function renderPdfBlob(documento: ReactElement): Promise<Blob> {
  const { pdf } = await carregarRenderer();
  return pdf(documento as Parameters<typeof pdf>[0]).toBlob();
}

/** Salva o arquivo com o nome do documento — sem diálogo de impressão. */
export function downloadPdf(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A URL precisa viver até o download começar.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
