/**
 * Tipo do arquivo pela ASSINATURA — os primeiros bytes do conteúdo.
 *
 * Nome e `Content-Type` vêm do navegador e são só declaração: um executável
 * renomeado para `.pdf` chega com os dois "certos". A assinatura é o que o
 * arquivo é. Aqui só entram os três formatos que o Veridi aceita; o resto é
 * `null`, e quem chama recusa.
 *
 * Não é antivírus nem validação estrutural completa: um PDF com cabeçalho
 * certo e corpo corrompido passa. O que se barra é o arquivo que não é do
 * tipo que diz ser.
 */

export type SignedFileType = "application/pdf" | "image/png" | "image/jpeg";

const ASSINATURAS: { tipo: SignedFileType; bytes: readonly number[] }[] = [
  // "%PDF-" no início do arquivo.
  { tipo: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // \x89PNG\r\n\x1a\n — os oito bytes fixos do PNG.
  { tipo: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // SOI + início de marcador: todo JPEG começa com FF D8 FF.
  { tipo: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

export function detectFileTypeBySignature(content: Uint8Array): SignedFileType | null {
  for (const { tipo, bytes } of ASSINATURAS) {
    if (content.length >= bytes.length && bytes.every((byte, indice) => content[indice] === byte)) {
      return tipo;
    }
  }
  return null;
}
