import { formatDecimalPtBr } from "./numeric-ptbr";

/** Tamanho de arquivo para a tela: B, KB inteiros ou MB com uma casa ("1,5 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${formatDecimalPtBr((bytes / (1024 * 1024)).toFixed(1), { scale: 1, minFractionDigits: 1 })} MB`;
}
