import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type {
  PutObjectInput,
  StorageAdapter,
  StoredObject,
  StoredObjectHead,
} from "./storage-adapter.js";
import {
  InvalidStorageKeyError,
  StorageObjectAlreadyExistsError,
  StorageObjectNotFoundError,
  StorageUnavailableError,
  assertSafeStorageKey,
  codigoDeErroDoSistema,
} from "./storage-adapter.js";

/** Erros de sistema de arquivos que significam "não existe" — e não "falhou". */
const AUSENTE = new Set(["ENOENT", "ENOTDIR"]);

/**
 * `LOCAL_FS` — objetos como arquivos sob um diretório base.
 *
 * Desenvolvimento e testes gravam aqui, e hoje o volume do Railway também
 * (`VERIDI_UPLOAD_DIR=/data/uploads`). A chave vira caminho relativo ao base,
 * segmento por segmento, e o resultado precisa continuar dentro dele.
 *
 * Gravar abre com `wx`: se a chave já existe, o sistema operacional recusa e
 * nada é sobrescrito. O conteúdo vai ao disco com `fsync` antes de o banco
 * registrar a versão — um desligamento logo depois do commit não deixa
 * registro apontando para arquivo pela metade.
 */
export class LocalFsStorageAdapter implements StorageAdapter {
  readonly provider = "LOCAL_FS" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private caminho(key: string): string {
    assertSafeStorageKey(key);
    const destino = path.resolve(this.root, ...key.split("/"));
    if (!destino.startsWith(this.root + path.sep)) throw new InvalidStorageKeyError();
    return destino;
  }

  async putObject({ key, content }: PutObjectInput): Promise<void> {
    const destino = this.caminho(key);
    try {
      await fs.mkdir(path.dirname(destino), { recursive: true });
    } catch (error) {
      throw new StorageUnavailableError("LOCAL_FS", `putObject mkdir ${codigoDeErroDoSistema(error) ?? "erro"}`);
    }

    let arquivo: FileHandle;
    try {
      arquivo = await fs.open(destino, "wx");
    } catch (error) {
      if (codigoDeErroDoSistema(error) === "EEXIST") throw new StorageObjectAlreadyExistsError(key);
      throw new StorageUnavailableError("LOCAL_FS", `putObject open ${codigoDeErroDoSistema(error) ?? "erro"}`);
    }

    try {
      await arquivo.writeFile(content);
      await arquivo.sync();
    } catch (error) {
      await arquivo.close().catch(() => undefined);
      // O arquivo foi criado AGORA, com `wx`: é só nosso, e pela metade não serve a ninguém.
      await fs.rm(destino, { force: true }).catch(() => undefined);
      throw new StorageUnavailableError("LOCAL_FS", `putObject write ${codigoDeErroDoSistema(error) ?? "erro"}`);
    }
    await arquivo.close();
  }

  async getObject(key: string): Promise<StoredObject> {
    const destino = this.caminho(key);
    const tamanho = await this.tamanho(destino, "getObject");
    if (tamanho === null) throw new StorageObjectNotFoundError(key);
    return { body: createReadStream(destino), contentLength: tamanho };
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    const tamanho = await this.tamanho(this.caminho(key), "headObject");
    return tamanho === null ? null : { contentLength: tamanho };
  }

  async deleteObject(key: string): Promise<void> {
    const destino = this.caminho(key);
    try {
      await fs.rm(destino, { force: true });
    } catch (error) {
      throw new StorageUnavailableError("LOCAL_FS", `deleteObject ${codigoDeErroDoSistema(error) ?? "erro"}`);
    }
  }

  /** Tamanho do arquivo regular no caminho, ou `null` quando não há arquivo ali. */
  private async tamanho(destino: string, operacao: string): Promise<number | null> {
    try {
      const info = await fs.stat(destino);
      return info.isFile() ? info.size : null;
    } catch (error) {
      if (AUSENTE.has(codigoDeErroDoSistema(error) ?? "")) return null;
      throw new StorageUnavailableError("LOCAL_FS", `${operacao} stat ${codigoDeErroDoSistema(error) ?? "erro"}`);
    }
  }
}
