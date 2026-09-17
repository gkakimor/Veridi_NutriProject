import { describe, expect, it } from "vitest";
import { ITEM_LABEL_FILE_MAX_SIZE_BYTES } from "@veridi/shared";
import {
  contentDispositionInline,
  nomeOriginalSeguro,
  validarArquivoDoRotulo,
} from "./item-label-file-validation.js";
import {
  EmptyLabelFileError,
  LabelFileSignatureMismatchError,
  LabelFileTooLargeError,
  UnsupportedLabelFileTypeError,
} from "./item-label-files.errors.js";

/**
 * O arquivo do rótulo antes do storage — LABEL-ATTACHMENTS-01. Nome, tipo
 * declarado e assinatura do conteúdo têm de concordar.
 */

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("validarArquivoDoRotulo", () => {
  it.each([
    ["arte.pdf", "application/pdf", PDF, "application/pdf", ".pdf"],
    ["ARTE FINAL.PDF", "application/pdf; charset=binary", PDF, "application/pdf", ".pdf"],
    ["rótulo.png", "image/png", PNG, "image/png", ".png"],
    ["foto.jpg", "image/jpeg", JPEG, "image/jpeg", ".jpg"],
    ["foto.jpeg", "IMAGE/JPEG", JPEG, "image/jpeg", ".jpg"],
  ])("%s (%s) é aceito", (fileName, declaredMimeType, content, tipo, extensao) => {
    const validado = validarArquivoDoRotulo({ fileName, declaredMimeType, content });
    expect(validado.mimeType).toBe(tipo);
    expect(validado.storageExtension).toBe(extensao);
    expect(validado.displayName).toBe(fileName);
  });

  it("arquivo vazio é recusado", () => {
    expect(() =>
      validarArquivoDoRotulo({ fileName: "a.pdf", declaredMimeType: "application/pdf", content: Buffer.alloc(0) }),
    ).toThrow(EmptyLabelFileError);
  });

  it("acima de 25 MB é recusado; exatamente 25 MB passa", () => {
    const limite = Buffer.alloc(ITEM_LABEL_FILE_MAX_SIZE_BYTES, 0x20);
    PDF.copy(limite);
    expect(
      validarArquivoDoRotulo({ fileName: "a.pdf", declaredMimeType: "application/pdf", content: limite }).mimeType,
    ).toBe("application/pdf");

    const acima = Buffer.alloc(ITEM_LABEL_FILE_MAX_SIZE_BYTES + 1, 0x20);
    PDF.copy(acima);
    expect(() =>
      validarArquivoDoRotulo({ fileName: "a.pdf", declaredMimeType: "application/pdf", content: acima }),
    ).toThrow(LabelFileTooLargeError);
  });

  it.each([
    ["extensão fora da lista", "arte.gif", "image/gif", Buffer.from("GIF89a", "latin1")],
    ["sem extensão", "arte", "application/pdf", PDF],
    ["executável com tipo de PDF", "arte.exe", "application/pdf", PDF],
    ["tipo declarado fora da lista", "arte.pdf", "application/octet-stream", PDF],
    ["tipo declarado vazio", "arte.pdf", "", PDF],
    ["nome e tipo discordam", "arte.png", "application/pdf", PDF],
    ["SVG disfarçado", "arte.svg", "image/svg+xml", Buffer.from("<svg/>", "utf8")],
  ])("%s é tipo não aceito", (_caso, fileName, declaredMimeType, content) => {
    expect(() => validarArquivoDoRotulo({ fileName, declaredMimeType, content })).toThrow(
      UnsupportedLabelFileTypeError,
    );
  });

  it.each([
    ["PNG com nome e tipo de PDF", "arte.pdf", "application/pdf", PNG],
    ["texto com nome e tipo de JPEG", "arte.jpg", "image/jpeg", Buffer.from("não sou imagem", "utf8")],
    ["HTML com nome e tipo de PNG", "arte.png", "image/png", Buffer.from("<html></html>", "utf8")],
    ["JPEG com nome e tipo de PNG", "arte.png", "image/png", JPEG],
  ])("%s: assinatura não confere", (_caso, fileName, declaredMimeType, content) => {
    expect(() => validarArquivoDoRotulo({ fileName, declaredMimeType, content })).toThrow(
      LabelFileSignatureMismatchError,
    );
  });

  it("marca invisível de direção sai ANTES de a extensão ser lida", () => {
    // "arte" + U+202E + "fdp.exe": na tela parece "arteexe.pdf", mas é .exe.
    const disfarcado = `arte${String.fromCharCode(0x202e)}fdp.exe`;
    expect(() =>
      validarArquivoDoRotulo({ fileName: disfarcado, declaredMimeType: "application/pdf", content: PDF }),
    ).toThrow(UnsupportedLabelFileTypeError);
  });

  it("nome só com a extensão vira rotulo.<ext>", () => {
    expect(
      validarArquivoDoRotulo({ fileName: ".pdf", declaredMimeType: "application/pdf", content: PDF }).displayName,
    ).toBe("rotulo.pdf");
  });
});

describe("nomeOriginalSeguro", () => {
  it("tira pasta (das duas barras), controle e espaço repetido", () => {
    expect(nomeOriginalSeguro("C:\\Users\\ana\\Desktop\\Arte   final.pdf")).toBe("Arte final.pdf");
    expect(nomeOriginalSeguro("../../etc/rótulo.pdf")).toBe("rótulo.pdf");
    expect(nomeOriginalSeguro("arte\u0000\u0007.pdf")).toBe("arte.pdf");
  });

  it("nome longo é cortado em 180 caracteres preservando a extensão", () => {
    const nome = nomeOriginalSeguro(`${"a".repeat(300)}.pdf`);
    expect(nome).toHaveLength(180);
    expect(nome.endsWith(".pdf")).toBe(true);
  });
});

describe("contentDispositionInline", () => {
  it("nome com acento: ASCII em filename e UTF-8 em filename*", () => {
    expect(contentDispositionInline("Rótulo Vitamina C.pdf")).toBe(
      "inline; filename=\"Rotulo Vitamina C.pdf\"; filename*=UTF-8''R%C3%B3tulo%20Vitamina%20C.pdf",
    );
  });

  it("aspas e barra invertida não quebram o cabeçalho", () => {
    const cabecalho = contentDispositionInline('arte "final"\\v2.pdf');
    expect(cabecalho.startsWith('inline; filename="arte _final__v2.pdf"; ')).toBe(true);
    expect(cabecalho).toContain("filename*=UTF-8''arte%20%22final%22%5Cv2.pdf");
  });

  it("nome sem nenhum caractere ASCII ainda tem filename", () => {
    expect(contentDispositionInline("标签.pdf")).toContain('filename="__.pdf"');
  });
});
