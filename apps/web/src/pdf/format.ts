import { FUSO_COMERCIAL, formatCnpj } from "@veridi/shared";

/**
 * Formatação dos documentos PDF.
 *
 * Um lugar só para o que o papel escreve: dinheiro, preço unitário,
 * quantidade, percentual, data, carimbo e CNPJ. Tudo delega aos helpers da
 * tela — o PDF não tem regra de formatação própria e nunca faz conta.
 */
export { formatBRL, formatUnitPriceBRL } from "../lib/currency";
export { formatQuantity, formatQuantityWithUnit } from "../lib/quantity";
export { formatPercent } from "../lib/percent";
export { formatDate } from "../lib/dates";
export { formatCnpj };

/** Valor ausente vira "—": dado desconhecido nunca vira zero nem espaço vazio. */
export function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? "—" : value;
}

const CARIMBO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_COMERCIAL,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Carimbo de documento: "11/09/2026 09:30", no fuso da operação.
 *
 * Sem segundos — segundo é ruído técnico no papel. É o mesmo instante que
 * `formatDateTime` mostra na tela, na resolução de um documento.
 */
export function formatPdfDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const instante = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instante.getTime())) return "—";
  const partes = Object.fromEntries(
    CARIMBO.formatToParts(instante).map((parte) => [parte.type, parte.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/** Marcas diacríticas combinantes (U+0300–U+036F), soltas pelo NFKD. */
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Nome do arquivo baixado: "ORC-000001-V1.pdf", "OP-001-26.pdf".
 *
 * Sai do código real do documento. Barra, ponto médio e espaço viram hífen e
 * acento sai: o nome precisa sobreviver a qualquer sistema de arquivos e a
 * anexo de e-mail. Nunca "document.pdf".
 */
export function pdfFileName(...partes: (string | number | null | undefined)[]): string {
  const base = partes
    .filter((parte) => parte !== null && parte !== undefined && String(parte).trim() !== "")
    .map((parte) => String(parte).trim())
    .join("-")
    .normalize("NFKD")
    .replace(DIACRITICOS, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${base || "documento-veridi"}.pdf`;
}

/** Caracteres de 0x80–0x9F do WinAnsi que ficam fora do Latin-1. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Equivalentes visuais para o que a tela usa e a fonte do PDF não desenha. */
const EQUIVALENTES: Record<string, string> = {
  "−": "–", // sinal de menos → traço médio (desconto, diferença)
  "≈": "~", // "≈ 0": quantidade abaixo da menor casa exibida
  "→": "›", // seta → vira ›
  "←": "‹", // seta ← vira ‹
  "☐": "[ ]", // caixa de conferência
  "☑": "[x]",
  "✓": "•", // visto vira marcador
  " ": " ", // espaço estreito inseparável vira inseparável
  " ": " ",
  " ": " ",
  "\t": " ",
  "\r": "",
  "​": "",
  "﻿": "",
};

/**
 * Texto que a fonte do PDF consegue desenhar.
 *
 * Helvetica padrão cobre o WinAnsi — o português inteiro, "·", "—", "×",
 * "ª". O resto trocaria de glifo em silêncio ou sumiria do papel: vira o
 * equivalente visual acima, perde o acento (NFKD) ou, em último caso, "?" —
 * nunca some sem deixar marca.
 */
export function pdfSafe(texto: string): string {
  let saida = "";
  for (const caractere of texto) {
    const equivalente = EQUIVALENTES[caractere];
    if (equivalente !== undefined) {
      saida += equivalente;
      continue;
    }
    const codigo = caractere.codePointAt(0) ?? 0;
    if (codigo <= 0xff || WIN_ANSI_EXTRA.has(codigo)) {
      saida += caractere;
      continue;
    }
    const semAcento = caractere.normalize("NFKD").replace(DIACRITICOS, "");
    saida +=
      semAcento !== "" && [...semAcento].every((c) => (c.codePointAt(0) ?? 0) <= 0xff) ? semAcento : "?";
  }
  return saida;
}
