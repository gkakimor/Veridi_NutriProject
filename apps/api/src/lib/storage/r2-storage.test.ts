import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { R2StorageAdapter, criarAdaptadorR2 } from "./r2-storage.js";
import type { EnviaComandoS3 } from "./r2-storage.js";
import {
  InvalidStorageKeyError,
  StorageObjectAlreadyExistsError,
  StorageObjectNotFoundError,
  StorageUnavailableError,
} from "./storage-adapter.js";

/**
 * `R2` — LABEL-ATTACHMENTS-01, com cliente S3 FALSO: nenhum teste automatizado
 * fala com o bucket. O que se prova aqui é o comando montado e a tradução de
 * cada resposta; o bucket real é o smoke manual (`pnpm storage:r2:smoke`).
 */

type Comando = PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand;

const BUCKET = "veridi-homologacao";

function clienteFalso(responder: (comando: Comando) => unknown): EnviaComandoS3 & { enviados: Comando[] } {
  const enviados: Comando[] = [];
  return {
    enviados,
    async send(comando) {
      enviados.push(comando);
      const resposta = responder(comando);
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
}

/** Erro no formato do SDK: nome e `$metadata.httpStatusCode`. */
function erroDoSdk(nome: string, status: number, mensagem = "mensagem do provedor"): Error {
  return Object.assign(new Error(mensagem), { name: nome, $metadata: { httpStatusCode: status } });
}

function sha256(conteudo: Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

describe("R2StorageAdapter", () => {
  it("gravar manda bucket, chave, tipo, tamanho, SHA-256 em base64 e If-None-Match: *", async () => {
    const cliente = clienteFalso(() => ({}));
    const storage = new R2StorageAdapter(cliente, BUCKET);
    const conteudo = Buffer.from("%PDF-1.7 arte", "utf8");

    await storage.putObject({
      key: "items/i-1/labels/u-1.pdf",
      content: conteudo,
      contentType: "application/pdf",
      sha256Hex: sha256(conteudo),
    });

    expect(cliente.enviados).toHaveLength(1);
    const comando = cliente.enviados[0];
    expect(comando).toBeInstanceOf(PutObjectCommand);
    expect(comando?.input).toEqual({
      Bucket: BUCKET,
      Key: "items/i-1/labels/u-1.pdf",
      Body: conteudo,
      ContentType: "application/pdf",
      ContentLength: conteudo.byteLength,
      ChecksumSHA256: createHash("sha256").update(conteudo).digest("base64"),
      IfNoneMatch: "*",
    });
  });

  it("412 na gravação é chave ocupada — nada foi sobrescrito", async () => {
    const storage = new R2StorageAdapter(clienteFalso(() => erroDoSdk("PreconditionFailed", 412)), BUCKET);
    const conteudo = Buffer.from("x");
    await expect(
      storage.putObject({ key: "items/i/labels/u.pdf", content: conteudo, contentType: "application/pdf", sha256Hex: sha256(conteudo) }),
    ).rejects.toBeInstanceOf(StorageObjectAlreadyExistsError);
  });

  it("falha do provedor vira indisponível — sem mensagem do SDK, bucket nem credencial no detalhe", async () => {
    const vazamento = `AccessDenied para ${BUCKET} em https://conta.r2.cloudflarestorage.com com chave AKIA-SEGREDO`;
    const storage = new R2StorageAdapter(clienteFalso(() => erroDoSdk("AccessDenied", 403, vazamento)), BUCKET);
    const conteudo = Buffer.from("x");

    const erro = await storage
      .putObject({ key: "items/i/labels/u.pdf", content: conteudo, contentType: "application/pdf", sha256Hex: sha256(conteudo) })
      .catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(StorageUnavailableError);
    const indisponivel = erro as StorageUnavailableError;
    expect(indisponivel.provider).toBe("R2");
    expect(indisponivel.detail).toBe("putObject AccessDenied 403");
    for (const texto of [indisponivel.message, indisponivel.detail]) {
      expect(texto).not.toContain(BUCKET);
      expect(texto).not.toContain("r2.cloudflarestorage.com");
      expect(texto).not.toContain("AKIA-SEGREDO");
    }
  });

  it("erro de rede sem status também vira indisponível, sem o host", async () => {
    const rede = Object.assign(new Error("getaddrinfo ENOTFOUND veridi-homologacao.conta.r2.cloudflarestorage.com"), {
      name: "Error",
      code: "ENOTFOUND",
    });
    const storage = new R2StorageAdapter(clienteFalso(() => rede), BUCKET);
    const erro = (await storage.headObject("items/i/labels/u.pdf").catch((falha: unknown) => falha)) as StorageUnavailableError;
    expect(erro).toBeInstanceOf(StorageUnavailableError);
    expect(erro.detail).toBe("headObject Error sem-status");
  });

  it("ler devolve o corpo em streaming e o tamanho informado", async () => {
    const conteudo = Buffer.from("conteúdo do rótulo", "utf8");
    const cliente = clienteFalso(() => ({ Body: Readable.from([conteudo]), ContentLength: conteudo.byteLength }));
    const storage = new R2StorageAdapter(cliente, BUCKET);

    const objeto = await storage.getObject("items/i/labels/u.png");

    expect(cliente.enviados[0]).toBeInstanceOf(GetObjectCommand);
    expect(cliente.enviados[0]?.input).toEqual({ Bucket: BUCKET, Key: "items/i/labels/u.png" });
    expect(objeto.contentLength).toBe(conteudo.byteLength);
    const pedacos: Buffer[] = [];
    for await (const pedaco of objeto.body) pedacos.push(Buffer.from(pedaco as Buffer));
    expect(Buffer.concat(pedacos)).toEqual(conteudo);
  });

  it.each([
    ["NoSuchKey", 404],
    ["NotFound", 404],
    ["QualquerNome", 404],
  ])("ler objeto ausente (%s %d) é não encontrado", async (nome, status) => {
    const storage = new R2StorageAdapter(clienteFalso(() => erroDoSdk(nome, status)), BUCKET);
    await expect(storage.getObject("items/i/labels/u.pdf")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it("resposta sem corpo não finge arquivo vazio", async () => {
    const storage = new R2StorageAdapter(clienteFalso(() => ({ ContentLength: 10 })), BUCKET);
    await expect(storage.getObject("items/i/labels/u.pdf")).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("cabeçalho: tamanho quando existe, null quando não", async () => {
    const existe = new R2StorageAdapter(clienteFalso(() => ({ ContentLength: 42 })), BUCKET);
    expect(await existe.headObject("items/i/labels/u.pdf")).toEqual({ contentLength: 42 });

    const ausente = new R2StorageAdapter(clienteFalso(() => erroDoSdk("NotFound", 404)), BUCKET);
    expect(await ausente.headObject("items/i/labels/u.pdf")).toBeNull();
  });

  it("apagar manda DeleteObject; ausente não é erro", async () => {
    const cliente = clienteFalso(() => ({}));
    await new R2StorageAdapter(cliente, BUCKET).deleteObject("_smoke/x.txt");
    expect(cliente.enviados[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(cliente.enviados[0]?.input).toEqual({ Bucket: BUCKET, Key: "_smoke/x.txt" });

    const ausente = new R2StorageAdapter(clienteFalso(() => erroDoSdk("NoSuchKey", 404)), BUCKET);
    await expect(ausente.deleteObject("_smoke/x.txt")).resolves.toBeUndefined();
  });

  it.each(["../fora.pdf", "/abs.pdf", "items\\x.pdf", "items//x.pdf", "items/rótulo.pdf", ""])(
    "chave insegura %j não chega ao provedor",
    async (key) => {
      const cliente = clienteFalso(() => ({}));
      const storage = new R2StorageAdapter(cliente, BUCKET);
      const conteudo = Buffer.from("x");
      await expect(
        storage.putObject({ key, content: conteudo, contentType: "application/pdf", sha256Hex: sha256(conteudo) }),
      ).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.getObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.headObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.deleteObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      expect(cliente.enviados).toHaveLength(0);
    },
  );

  it("o adaptador real monta o cliente com região e endereço da configuração, sem conectar", async () => {
    const adaptador = criarAdaptadorR2({
      endpoint: "https://conta-exemplo.r2.cloudflarestorage.com",
      bucket: BUCKET,
      region: "auto",
      accessKeyId: "chave-falsa",
      secretAccessKey: "segredo-falso",
    });
    expect(adaptador.provider).toBe("R2");
    const cliente = (adaptador as unknown as { client: { config: { region: () => Promise<string> } } }).client;
    expect(await cliente.config.region()).toBe("auto");
  });
});
