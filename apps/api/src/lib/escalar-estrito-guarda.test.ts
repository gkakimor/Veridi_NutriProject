import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de API-STRICT-SCALAR-CONTRACT-WAVE-01.
 *
 * - inteiro não volta a ler `z.coerce.number().int()` — `Number()` aceita
 *   `"1e1"`, `"0x10"`, `"+1"` e `true`; a leitura é `inteiroDecimalSchema`;
 * - booleano não volta a ler `z.coerce.boolean()` — `Boolean("false")` é
 *   `true`; a leitura de query é `booleanoDeConsultaSchema`.
 *
 * Comentário não conta: vários fontes citam o nome antigo para explicar por
 * que ele saiu.
 */

const RAIZ = join(import.meta.dirname, "..");

/**
 * Único uso legítimo: porta lida da variável de ambiente no boot. Não é
 * entrada HTTP e não é gravada.
 */
const PERMITIDOS = new Map([["config/env.ts", 2]]);

const COERCAO_BOOLEANA = /\bz\s*\.\s*coerce\s*\.\s*boolean\s*\(/g;
/** `z.coerce.number()` e a cadeia de chamadas que vem colada nele, em uma ou várias linhas. */
const COERCAO_NUMERICA = /\bz\s*\.\s*coerce\s*\.\s*number\s*\(\s*\)((?:\s*\.\s*\w+\s*\((?:[^()]|\([^()]*\))*\))*)/g;

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

function inteirosPorCoercao(fonte: string): number {
  return [...semComentarios(fonte).matchAll(COERCAO_NUMERICA)].filter((achado) =>
    /\.\s*int\s*\(/.test(achado[1] ?? ""),
  ).length;
}

function booleanosPorCoercao(fonte: string): number {
  return semComentarios(fonte).match(COERCAO_BOOLEANA)?.length ?? 0;
}

function fontesDeProducao(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return fontesDeProducao(caminho);
    return entrada.name.endsWith(".ts") && !entrada.name.includes(".test.") ? [caminho] : [];
  });
}

describe("a guarda pega a coerção e só ela", () => {
  it("inteiro por coerção, em uma linha ou em cadeia quebrada", () => {
    expect(inteirosPorCoercao("const a = z.coerce.number().int();")).toBe(1);
    expect(inteirosPorCoercao('x: z.coerce.number().min(1, "a, b").int("Inteiro").max(9),')).toBe(1);
    expect(inteirosPorCoercao('const a = z.coerce\n  .number()\n  .int("Informe")\n  .min(0);')).toBe(1);
  });

  it("não pega o que não é inteiro por coerção", () => {
    expect(inteirosPorCoercao('const a = inteiroDecimalSchema("x").pipe(z.number().int().min(1));')).toBe(0);
    expect(inteirosPorCoercao("const a = z.number().int();")).toBe(0);
    expect(inteirosPorCoercao("const a = z.coerce.number().min(0);\nconst b = z.number().int();")).toBe(0);
    expect(inteirosPorCoercao("/** Substituto de `z.coerce.number().int()` */\nconst a = 1;")).toBe(0);
    expect(inteirosPorCoercao("// antes: z.coerce.number().int()\nconst a = 1;")).toBe(0);
  });

  it("booleano por coerção", () => {
    expect(booleanosPorCoercao("onlyWithStock: z.coerce.boolean().optional(),")).toBe(1);
    expect(booleanosPorCoercao("a: z.coerce\n  .boolean(),")).toBe(1);
    expect(booleanosPorCoercao("onlyWithStock: booleanoDeConsultaSchema().optional(),")).toBe(0);
    expect(booleanosPorCoercao("active: z.boolean().optional(),")).toBe(0);
    expect(booleanosPorCoercao("/** `z.coerce.boolean()` não serve aqui */")).toBe(0);
  });
});

describe("fontes de produção da API", () => {
  const fontes = fontesDeProducao(RAIZ).map((arquivo) => ({
    nome: relative(RAIZ, arquivo).replace(/\\/g, "/"),
    texto: readFileSync(arquivo, "utf8"),
  }));

  it("nenhum inteiro lê z.coerce.number().int() fora da lista de permitidos", () => {
    const achados = fontes
      .map(({ nome, texto }) => ({ nome, total: inteirosPorCoercao(texto) }))
      .filter(({ nome, total }) => total > 0 && total !== PERMITIDOS.get(nome));
    expect(achados).toEqual([]);
  });

  it("a lista de permitidos não envelhece", () => {
    for (const [nome, total] of PERMITIDOS) {
      const fonte = fontes.find((arquivo) => arquivo.nome === nome);
      expect(fonte, nome).toBeDefined();
      expect(inteirosPorCoercao(fonte!.texto), nome).toBe(total);
    }
  });

  it("nenhum booleano lê z.coerce.boolean()", () => {
    const achados = fontes.filter(({ texto }) => booleanosPorCoercao(texto) > 0).map(({ nome }) => nome);
    expect(achados).toEqual([]);
  });
});
