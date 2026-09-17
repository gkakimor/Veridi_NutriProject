import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput, HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import type { R2Config } from "../../config/storage-config.js";
import type {
  PutObjectInput,
  StorageAdapter,
  StoredObject,
  StoredObjectHead,
} from "./storage-adapter.js";
import {
  StorageObjectAlreadyExistsError,
  StorageObjectNotFoundError,
  StorageUnavailableError,
  assertSafeStorageKey,
} from "./storage-adapter.js";

/**
 * O pedaço do cliente S3 que o adaptador usa. O `S3Client` real cumpre; o
 * teste passa um falso — nenhum teste automatizado fala com o bucket.
 */
export interface EnviaComandoS3 {
  send(
    command: PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand,
  ): Promise<unknown>;
}

interface ErroDoSdk {
  name?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

function statusHttp(error: unknown): number | undefined {
  const status = (error as ErroDoSdk | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

function nomeDoErro(error: unknown): string {
  const nome = (error as ErroDoSdk | null)?.name;
  return typeof nome === "string" ? nome : "erro";
}

/**
 * Detalhe para log: operação, nome do erro e status. A mensagem do SDK fica de
 * fora de propósito — erro de rede traz o host da conta, e endereço não sai
 * daqui.
 */
function indisponivel(operacao: string, error: unknown): StorageUnavailableError {
  return new StorageUnavailableError(
    "R2",
    `${operacao} ${nomeDoErro(error)} ${statusHttp(error) ?? "sem-status"}`,
  );
}

function naoEncontrado(error: unknown): boolean {
  const nome = nomeDoErro(error);
  return nome === "NoSuchKey" || nome === "NotFound" || statusHttp(error) === 404;
}

/**
 * `R2` — Cloudflare R2 pela API compatível com S3.
 *
 * O bucket é privado: o navegador nunca fala com ele, nem recebe endereço,
 * chave de acesso ou URL assinada. Leitura e escrita passam pela API
 * autenticada do Veridi, que usa a credencial do servidor.
 *
 * Gravação:
 * - `IfNoneMatch: "*"` — chave ocupada volta 412 e nada é sobrescrito;
 * - `ChecksumSHA256` — o R2 confere o conteúdo na chegada contra o mesmo hash
 *   que o banco registra; corpo alterado no caminho é recusado.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly provider = "R2" as const;

  constructor(
    private readonly client: EnviaComandoS3,
    private readonly bucket: string,
  ) {}

  async putObject({ key, content, contentType, sha256Hex }: PutObjectInput): Promise<void> {
    assertSafeStorageKey(key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: content,
          ContentType: contentType,
          ContentLength: content.byteLength,
          ChecksumSHA256: Buffer.from(sha256Hex, "hex").toString("base64"),
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (statusHttp(error) === 412 || nomeDoErro(error) === "PreconditionFailed") {
        throw new StorageObjectAlreadyExistsError(key);
      }
      throw indisponivel("putObject", error);
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    assertSafeStorageKey(key);
    let resposta: GetObjectCommandOutput;
    try {
      resposta = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as GetObjectCommandOutput;
    } catch (error) {
      if (naoEncontrado(error)) throw new StorageObjectNotFoundError(key);
      throw indisponivel("getObject", error);
    }
    // No Node o corpo é um `Readable`; sem corpo não há o que entregar.
    const body = resposta.Body as Readable | undefined;
    if (!body) throw new StorageUnavailableError("R2", "getObject sem-corpo");
    return { body, contentLength: resposta.ContentLength ?? null };
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    assertSafeStorageKey(key);
    try {
      const resposta = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as HeadObjectCommandOutput;
      return { contentLength: resposta.ContentLength ?? null };
    } catch (error) {
      if (naoEncontrado(error)) return null;
      throw indisponivel("headObject", error);
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeStorageKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (naoEncontrado(error)) return;
      throw indisponivel("deleteObject", error);
    }
  }
}

/** Cliente S3 apontado para o R2, com a credencial do servidor. */
export function criarAdaptadorR2(config: R2Config): R2StorageAdapter {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Endereço da conta com o bucket no caminho — a forma base do R2. Sem
    // subdomínio por bucket, nem DNS nem certificado dependem do nome dele.
    forcePathStyle: true,
    maxAttempts: 3,
    // Sem prazo, uma conexão presa seguraria a requisição do usuário para sempre.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
  });
  return new R2StorageAdapter(client, config.bucket);
}
