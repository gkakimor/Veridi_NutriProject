import { describe, expect, it } from "vitest";
import { detectFileTypeBySignature } from "./file-signature.js";

/** Assinatura dos três formatos aceitos — o conteúdo diz o que o arquivo é. */

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("detectFileTypeBySignature", () => {
  it.each([
    ["PDF", PDF, "application/pdf"],
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
  ])("%s é reconhecido pelos primeiros bytes", (_nome, conteudo, tipo) => {
    expect(detectFileTypeBySignature(conteudo)).toBe(tipo);
  });

  it.each([
    ["GIF", Buffer.from("GIF89a....", "latin1")],
    ["texto", Buffer.from("isto não é um pdf", "utf8")],
    ["HTML disfarçado", Buffer.from("<html><script>alert(1)</script>", "utf8")],
    ["PDF com lixo antes do cabeçalho", Buffer.from(" %PDF-1.7", "latin1")],
    ["PNG truncado", PNG.subarray(0, 7)],
    ["JPEG truncado", JPEG.subarray(0, 2)],
    ["vazio", Buffer.alloc(0)],
  ])("%s não é nenhum dos três", (_nome, conteudo) => {
    expect(detectFileTypeBySignature(conteudo)).toBeNull();
  });
});
