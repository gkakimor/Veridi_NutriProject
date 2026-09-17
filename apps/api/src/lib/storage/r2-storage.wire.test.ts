import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarAdaptadorR2 } from "./r2-storage.js";
import type { R2StorageAdapter } from "./r2-storage.js";
import {
  StorageObjectAlreadyExistsError,
  StorageObjectNotFoundError,
  StorageUnavailableError,
} from "./storage-adapter.js";

/**
 * O adaptador R2 REAL — o mesmo `criarAdaptadorR2` da API, com o `S3Client` de
 * verdade — contra um emulador S3 mínimo em 127.0.0.1. Nenhum byte sai da
 * máquina: o bucket real fica para o smoke manual (`pnpm storage:r2:smoke`).
 *
 * Prova o que o cliente falso não prova: o que vai de fato no fio (caminho com
 * o bucket, `If-None-Match`, `x-amz-checksum-sha256`, assinatura) e como o SDK
 * traduz 412, 404 com e sem corpo e 400 de hash que não confere.
 */

const BUCKET = "veridi-homologacao";
const CHAVE_DE_ACESSO = "chave-falsa-de-teste";
const SEGREDO = "segredo-falso-que-nao-pode-trafegar";

interface Pedido {
  metodo: string;
  caminho: string;
  cabecalhos: http.IncomingHttpHeaders;
  corpo: Buffer;
}

const objetos = new Map<string, { corpo: Buffer; tipo: string }>();
const pedidos: Pedido[] = [];
let servidor: http.Server;
let storage: R2StorageAdapter;

function erroXml(codigo: string, mensagem: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${codigo}</Code><Message>${mensagem}</Message></Error>`;
}

beforeAll(async () => {
  servidor = http.createServer(async (req, res) => {
    const pedacos: Buffer[] = [];
    for await (const pedaco of req) pedacos.push(pedaco as Buffer);
    const corpo = Buffer.concat(pedacos);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    pedidos.push({ metodo: req.method ?? "", caminho: url.pathname, cabecalhos: req.headers, corpo });

    const [, bucket, ...resto] = url.pathname.split("/");
    const chave = decodeURIComponent(resto.join("/"));
    if (bucket !== BUCKET) {
      res.writeHead(404, { "content-type": "application/xml" }).end(erroXml("NoSuchBucket", "bucket"));
      return;
    }
    const existente = objetos.get(chave);

    if (req.method === "PUT") {
      if (req.headers["if-none-match"] === "*" && existente) {
        res.writeHead(412, { "content-type": "application/xml" }).end(erroXml("PreconditionFailed", "existe"));
        return;
      }
      const declarado = req.headers["x-amz-checksum-sha256"];
      if (declarado && declarado !== createHash("sha256").update(corpo).digest("base64")) {
        res.writeHead(400, { "content-type": "application/xml" }).end(erroXml("BadDigest", "hash"));
        return;
      }
      objetos.set(chave, { corpo, tipo: String(req.headers["content-type"] ?? "") });
      res.writeHead(200, { etag: '"etag-de-teste"' }).end();
      return;
    }
    if (req.method === "HEAD") {
      if (!existente) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-length": existente.corpo.byteLength, "content-type": existente.tipo }).end();
      return;
    }
    if (req.method === "GET") {
      if (!existente) {
        res.writeHead(404, { "content-type": "application/xml" }).end(erroXml("NoSuchKey", "nao existe"));
        return;
      }
      res
        .writeHead(200, { "content-length": existente.corpo.byteLength, "content-type": existente.tipo })
        .end(existente.corpo);
      return;
    }
    if (req.method === "DELETE") {
      objetos.delete(chave);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;

  storage = criarAdaptadorR2({
    endpoint: `http://127.0.0.1:${port}`,
    bucket: BUCKET,
    region: "auto",
    accessKeyId: CHAVE_DE_ACESSO,
    secretAccessKey: SEGREDO,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  pedidos.length = 0;
});

function sha256Hex(conteudo: Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

describe("R2 no fio (emulador S3 local)", () => {
  it("gravação: bucket no caminho, If-None-Match: *, SHA-256 no cabeçalho, corpo inteiro e assinatura SigV4", async () => {
    const conteudo = Buffer.from("%PDF-1.7 arte do rótulo", "utf8");
    await storage.putObject({
      key: "items/item-1/labels/0b8f.pdf",
      content: conteudo,
      contentType: "application/pdf",
      sha256Hex: sha256Hex(conteudo),
    });

    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    expect(pedido?.metodo).toBe("PUT");
    expect(pedido?.caminho).toBe(`/${BUCKET}/items/item-1/labels/0b8f.pdf`);
    expect(pedido?.cabecalhos["if-none-match"]).toBe("*");
    expect(pedido?.cabecalhos["x-amz-checksum-sha256"]).toBe(createHash("sha256").update(conteudo).digest("base64"));
    expect(pedido?.cabecalhos["x-amz-checksum-crc32"]).toBeUndefined();
    expect(pedido?.cabecalhos["content-type"]).toBe("application/pdf");
    expect(pedido?.cabecalhos["content-length"]).toBe(String(conteudo.byteLength));
    expect(pedido?.cabecalhos["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=chave-falsa-de-teste\//);
    expect(pedido?.corpo).toEqual(conteudo);
    // O segredo assina; não trafega.
    expect(JSON.stringify(pedidos)).not.toContain(SEGREDO);
  });

  it("mesma chave de novo: 412 vira StorageObjectAlreadyExistsError e o primeiro conteúdo fica", async () => {
    const primeiro = Buffer.from("primeiro", "utf8");
    const key = "items/item-2/labels/fixa.png";
    await storage.putObject({ key, content: primeiro, contentType: "image/png", sha256Hex: sha256Hex(primeiro) });

    const segundo = Buffer.from("segundo", "utf8");
    await expect(
      storage.putObject({ key, content: segundo, contentType: "image/png", sha256Hex: sha256Hex(segundo) }),
    ).rejects.toBeInstanceOf(StorageObjectAlreadyExistsError);
    expect(objetos.get(key)?.corpo).toEqual(primeiro);
  });

  it("hash que não confere: o provedor recusa (400 BadDigest) e nada é gravado", async () => {
    const conteudo = Buffer.from("conteúdo", "utf8");
    const key = "items/item-3/labels/corrompido.pdf";
    const erro = await storage
      .putObject({ key, content: conteudo, contentType: "application/pdf", sha256Hex: sha256Hex(Buffer.from("outro")) })
      .catch((falha: unknown) => falha);
    expect(erro).toBeInstanceOf(StorageUnavailableError);
    expect((erro as StorageUnavailableError).detail).toBe("putObject BadDigest 400");
    expect(objetos.has(key)).toBe(false);
  });

  it("cabeçalho, leitura em streaming e ausência (HEAD 404 sem corpo, GET 404 NoSuchKey)", async () => {
    const conteudo = Buffer.from("bytes do rótulo", "utf8");
    const key = "items/item-4/labels/ler.jpg";
    await storage.putObject({ key, content: conteudo, contentType: "image/jpeg", sha256Hex: sha256Hex(conteudo) });

    expect(await storage.headObject(key)).toEqual({ contentLength: conteudo.byteLength });
    const objeto = await storage.getObject(key);
    expect(objeto.contentLength).toBe(conteudo.byteLength);
    const pedacos: Buffer[] = [];
    for await (const pedaco of objeto.body) pedacos.push(Buffer.from(pedaco as Buffer));
    expect(Buffer.concat(pedacos)).toEqual(conteudo);

    expect(await storage.headObject("items/item-4/labels/nao-existe.jpg")).toBeNull();
    await expect(storage.getObject("items/item-4/labels/nao-existe.jpg")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it("apagar (compensação e limpeza do smoke) tira o objeto", async () => {
    const conteudo = Buffer.from("smoke", "utf8");
    const key = "_smoke/2026-09-16T00-00-00-000Z-teste.txt";
    await storage.putObject({ key, content: conteudo, contentType: "text/plain", sha256Hex: sha256Hex(conteudo) });
    await storage.deleteObject(key);
    expect(pedidos.some((pedido) => pedido.metodo === "DELETE" && pedido.caminho === `/${BUCKET}/${key}`)).toBe(true);
    expect(await storage.headObject(key)).toBeNull();
  });
});
