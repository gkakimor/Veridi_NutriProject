import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFsStorageAdapter } from "./local-fs-storage.js";
import {
  InvalidStorageKeyError,
  StorageObjectAlreadyExistsError,
  StorageObjectNotFoundError,
} from "./storage-adapter.js";

/**
 * `LOCAL_FS` — LABEL-ATTACHMENTS-01. Diretório temporário próprio: nada aqui
 * toca `VERIDI_UPLOAD_DIR`.
 */

let raiz: string;
let storage: LocalFsStorageAdapter;

beforeAll(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "veridi-local-fs-"));
  storage = new LocalFsStorageAdapter(raiz);
});

afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

async function lerTudo(corpo: Readable): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of corpo) pedacos.push(Buffer.from(pedaco as Buffer));
  return Buffer.concat(pedacos);
}

function sha256(conteudo: Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

describe("LocalFsStorageAdapter", () => {
  it("grava, lê em streaming e informa o tamanho — dentro do namespace da chave", async () => {
    const conteudo = Buffer.from("%PDF-1.4 conteúdo de teste", "utf8");
    const key = "items/item-1/labels/0f8b7c1e-arquivo.pdf";

    await storage.putObject({ key, content: conteudo, contentType: "application/pdf", sha256Hex: sha256(conteudo) });

    expect(await readFile(path.join(raiz, "items", "item-1", "labels", "0f8b7c1e-arquivo.pdf"))).toEqual(conteudo);
    expect(await storage.headObject(key)).toEqual({ contentLength: conteudo.byteLength });

    const objeto = await storage.getObject(key);
    expect(objeto.contentLength).toBe(conteudo.byteLength);
    expect(await lerTudo(objeto.body)).toEqual(conteudo);
  });

  it("chave ocupada é recusada e os bytes gravados antes continuam os mesmos", async () => {
    const original = Buffer.from("versão original", "utf8");
    const key = "items/item-2/labels/fixa.png";
    await storage.putObject({ key, content: original, contentType: "image/png", sha256Hex: sha256(original) });

    const outro = Buffer.from("tentativa de sobrescrever", "utf8");
    await expect(
      storage.putObject({ key, content: outro, contentType: "image/png", sha256Hex: sha256(outro) }),
    ).rejects.toBeInstanceOf(StorageObjectAlreadyExistsError);

    expect(await readFile(path.join(raiz, "items", "item-2", "labels", "fixa.png"))).toEqual(original);
  });

  it("objeto ausente: leitura recusa, cabeçalho é null e apagar não é erro", async () => {
    const key = "items/nao-existe/labels/nada.pdf";
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    expect(await storage.headObject(key)).toBeNull();
    await expect(storage.deleteObject(key)).resolves.toBeUndefined();
  });

  it("pasta no lugar do arquivo não é objeto", async () => {
    await mkdir(path.join(raiz, "items", "pasta"), { recursive: true });
    await expect(storage.getObject("items/pasta")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    expect(await storage.headObject("items/pasta")).toBeNull();
  });

  it("apagar remove só o objeto pedido (compensação técnica)", async () => {
    const a = Buffer.from("a", "utf8");
    await storage.putObject({ key: "items/item-3/labels/a.pdf", content: a, contentType: "application/pdf", sha256Hex: sha256(a) });
    await storage.putObject({ key: "items/item-3/labels/b.pdf", content: a, contentType: "application/pdf", sha256Hex: sha256(a) });

    await storage.deleteObject("items/item-3/labels/a.pdf");

    expect(await storage.headObject("items/item-3/labels/a.pdf")).toBeNull();
    expect(await storage.headObject("items/item-3/labels/b.pdf")).toEqual({ contentLength: 1 });
  });

  it.each([
    ["subir de pasta", "../fora.pdf"],
    ["subir no meio", "items/../../fora.pdf"],
    ["absoluta", "/etc/passwd"],
    ["unidade do Windows", "C:/Windows/win.ini"],
    ["barra invertida", "items\\x.pdf"],
    ["segmento vazio", "items//x.pdf"],
    ["arquivo oculto", "items/.env"],
    ["ponto no fim", "items/x."],
    ["espaço", "items/meu arquivo.pdf"],
    ["acento", "items/rótulo.pdf"],
    ["vazia", ""],
    ["longa demais", `items/${"a".repeat(600)}`],
  ])("chave insegura (%s) é recusada antes de tocar o disco", async (_caso, key) => {
    const conteudo = Buffer.from("x", "utf8");
    await expect(
      storage.putObject({ key, content: conteudo, contentType: "application/pdf", sha256Hex: sha256(conteudo) }),
    ).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.headObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.deleteObject(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
  });

  it("nada escapou da raiz depois das chaves inseguras", async () => {
    await expect(stat(path.join(raiz, "..", "fora.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aceita o prefixo de smoke `_smoke/`", async () => {
    const conteudo = Buffer.from("smoke", "utf8");
    await storage.putObject({ key: "_smoke/teste.txt", content: conteudo, contentType: "text/plain", sha256Hex: sha256(conteudo) });
    expect(await storage.headObject("_smoke/teste.txt")).toEqual({ contentLength: 5 });
  });

  it("arquivo com conteúdo de outra origem no caminho é lido como está (o tamanho vem do disco)", async () => {
    await mkdir(path.join(raiz, "items", "item-4", "labels"), { recursive: true });
    await writeFile(path.join(raiz, "items", "item-4", "labels", "manual.pdf"), "12345");
    expect(await storage.headObject("items/item-4/labels/manual.pdf")).toEqual({ contentLength: 5 });
  });
});
