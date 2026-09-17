import type { Readable } from "node:stream";
import type { StorageProviderName } from "../../config/storage-config.js";

/**
 * Armazenamento de objetos — a abstração única (LABEL-ATTACHMENTS-01).
 *
 * O domínio fala com `StorageAdapter`; quem grava em disco (`LOCAL_FS`) ou no
 * bucket (`R2`) é detalhe do provedor. A interface é pequena de propósito e
 * genérica: o anexo de hoje (`Attachment`, em `file-storage.ts`) pode passar
 * por ela no dia em que migrar (ATTACHMENTS-R2-MIGRATION-01).
 *
 * Três regras valem para todo provedor:
 * 1. objeto gravado é imutável — `putObject` numa chave ocupada é recusado,
 *    nunca sobrescreve;
 * 2. a chave é gerada pelo servidor e passa por `assertSafeStorageKey` — nome
 *    enviado pelo usuário nunca vira chave nem caminho;
 * 3. `deleteObject` existe só para compensação técnica de envio que não chegou
 *    ao banco. Regra de negócio nunca apaga objeto.
 */

export interface PutObjectInput {
  key: string;
  content: Buffer;
  contentType: string;
  /** SHA-256 do conteúdo, em hexadecimal. O R2 confere na chegada. */
  sha256Hex: string;
}

export interface StoredObject {
  body: Readable;
  /** Tamanho informado pelo provedor; `null` quando ele não informa. */
  contentLength: number | null;
}

export interface StoredObjectHead {
  contentLength: number | null;
}

export interface StorageAdapter {
  readonly provider: StorageProviderName;
  /** Grava bytes novos. Chave ocupada: `StorageObjectAlreadyExistsError`. */
  putObject(input: PutObjectInput): Promise<void>;
  /** Abre o objeto para leitura em streaming. Ausente: `StorageObjectNotFoundError`. */
  getObject(key: string): Promise<StoredObject>;
  /** Metadados do objeto, ou `null` quando ele não existe. */
  headObject(key: string): Promise<StoredObjectHead | null>;
  /** SÓ compensação técnica de envio falho. Ausente não é erro. */
  deleteObject(key: string): Promise<void>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super("Arquivo não encontrado no armazenamento.");
    this.name = "StorageObjectNotFoundError";
  }
}

export class StorageObjectAlreadyExistsError extends Error {
  constructor(readonly key: string) {
    super("Já existe um arquivo gravado com esta chave — nada foi sobrescrito.");
    this.name = "StorageObjectAlreadyExistsError";
  }
}

/**
 * Provedor fora do ar, sem permissão ou não configurado.
 *
 * A mensagem é a que a tela pode mostrar. `detail` vai para o log e diz só a
 * operação, o nome do erro e o status HTTP — nunca endereço, bucket nem
 * credencial.
 */
export class StorageUnavailableError extends Error {
  constructor(
    readonly provider: StorageProviderName,
    readonly detail: string,
  ) {
    super("O armazenamento de arquivos não respondeu. Tente de novo em instantes.");
    this.name = "StorageUnavailableError";
  }
}

export class InvalidStorageKeyError extends Error {
  constructor() {
    super("Chave de armazenamento inválida.");
    this.name = "InvalidStorageKeyError";
  }
}

/**
 * Segmento de chave: letras ASCII, dígitos, `_`, `-` e `.`, começando por
 * letra, dígito ou `_` e sem terminar em ponto (o Windows apaga o ponto final e
 * duas chaves viram o mesmo arquivo). Sem `..`, sem barra invertida, sem
 * espaço, sem acento.
 */
const SEGMENTO = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const TAMANHO_MAXIMO_DA_CHAVE = 512;

/** Recusa chave que não seja caminho relativo simples, em qualquer provedor. */
export function assertSafeStorageKey(key: string): void {
  if (key.length === 0 || key.length > TAMANHO_MAXIMO_DA_CHAVE) throw new InvalidStorageKeyError();
  for (const segmento of key.split("/")) {
    if (!SEGMENTO.test(segmento) || segmento.endsWith(".")) throw new InvalidStorageKeyError();
  }
}

export function codigoDeErroDoSistema(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
