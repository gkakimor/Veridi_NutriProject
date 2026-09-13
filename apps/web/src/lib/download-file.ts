/**
 * Salva um arquivo que já está na mão como `Blob` — o PDF gerado aqui ou o
 * CSV que o servidor devolveu num POST. Sem diálogo de impressão, com o nome
 * certo, e a URL temporária revogada depois.
 */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A URL precisa viver até o download começar.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** O nome que o servidor mandou em `Content-Disposition`; sem ele, o de reserva. */
export function fileNameFromDisposition(disposition: string | null, fallback: string): string {
  const achado = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return achado?.[1]?.trim() || fallback;
}
