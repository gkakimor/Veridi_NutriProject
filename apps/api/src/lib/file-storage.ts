import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Armazenamento de arquivos anexados.
 *
 * FAST MVP grava no sistema de arquivos local, fora de qualquer diretório
 * servido publicamente e fora do Git. Todo acesso a disco passa por aqui:
 * quando o storage virar nuvem, troca-se este adapter e nada mais — o
 * domínio nunca chama `fs` direto.
 *
 * Segurança: o nome enviado pelo usuário NUNCA vira caminho. A chave de
 * armazenamento é aleatória (UUID), e a leitura recusa qualquer chave que
 * escape do diretório base (`../`, caminho absoluto).
 */

/** Tipos aceitos nesta fase — cobre laudo, NF escaneada, arte e ficha técnica. */
export const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Extensões coerentes com os MIME aceitos — validação conservadora. */
const ALLOWED_EXTENSIONS: Record<AllowedMimeType, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * A extensão precisa combinar com o MIME declarado. Não é antivírus: é uma
 * checagem simples contra arquivo executável renomeado para `.pdf`.
 */
export function extensionMatchesMimeType(fileName: string, mimeType: AllowedMimeType): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return ALLOWED_EXTENSIONS[mimeType].includes(extension);
}

/** Nome só para exibição/download — sem diretórios, sem caracteres de caminho. */
export function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName.replace(/\\/g, "/"));
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "documento";
}

function uploadDir(): string {
  return path.resolve(env.VERIDI_UPLOAD_DIR);
}

/** Resolve a chave dentro do diretório base, recusando path traversal. */
function resolveStoragePath(storageKey: string): string {
  const base = uploadDir();
  const resolved = path.resolve(base, storageKey);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("Chave de armazenamento inválida");
  }
  return resolved;
}

export interface StoredFile {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

/** Grava o conteúdo e devolve chave + hash. Nunca usa o nome original. */
export async function storeFile(content: Buffer, mimeType: AllowedMimeType): Promise<StoredFile> {
  const extension = ALLOWED_EXTENSIONS[mimeType][0]!;
  const storageKey = `${randomUUID()}${extension}`;
  const target = resolveStoragePath(storageKey);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);

  return {
    storageKey,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storageKey));
}

/**
 * Remoção física — usada SOMENTE como compensação quando a gravação no
 * banco falha depois do arquivo ter sido salvo. Arquivar um anexo nunca
 * apaga o arquivo: evidência histórica não se destrói.
 */
export async function deleteStoredFile(storageKey: string): Promise<void> {
  await fs.rm(resolveStoragePath(storageKey), { force: true });
}
