import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { VERIDI_VERSION } from "@veridi/shared";

/**
 * A versão tem UMA fonte (VERIDI-SYSTEM-VERSIONING-01): `VERIDI_VERSION`, em
 * `packages/shared/src/version.ts`. API e web importam a constante; nenhum
 * código escreve o número de novo.
 *
 * Segunda cópia é a versão que fica para trás no próximo PATCH: o cabeçalho
 * dizendo uma coisa e `GET /meta` outra. Esta guarda varre o código de produção
 * dos três pacotes — testes ficam de fora, eles conferem o número de propósito.
 */

const RAIZ = join(process.cwd(), "..", "..");
const FONTE_UNICA = "packages/shared/src/version.ts";
const PASTAS = ["apps/web/src", "apps/api/src", "packages/shared/src"];
const AVULSOS = ["apps/web/index.html"];

function arquivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}

/** Arquivos em que o número da versão aparece escrito, com ou sem o "v". */
function copiasDaVersao(arquivos: { caminho: string; texto: string }[], versao: string): string[] {
  const numero = versao.replace(/\./g, "\\.");
  const copia = new RegExp(`(?<![\\w.])v?${numero}(?![\\w.])`);
  return arquivos.filter(({ texto }) => copia.test(texto)).map(({ caminho }) => caminho);
}

describe("versão — fonte única", () => {
  const codigo = [...PASTAS.flatMap((pasta) => arquivosDe(join(RAIZ, pasta))), ...AVULSOS.map((a) => join(RAIZ, a))]
    .map((caminho) => relative(RAIZ, caminho).split(sep).join("/"))
    .filter((rel) => /\.(tsx?|css|html)$/.test(rel) && !/\.test\.tsx?$/.test(rel))
    .map((caminho) => ({ caminho, texto: readFileSync(join(RAIZ, caminho), "utf8") }));

  it("só o version.ts do shared escreve o número", () => {
    expect(codigo.map((arquivo) => arquivo.caminho)).toContain(FONTE_UNICA);
    expect(copiasDaVersao(codigo, VERIDI_VERSION)).toEqual([FONTE_UNICA]);
  });

  it("a guarda reconhece a cópia, com e sem o v, e não confunde número parecido", () => {
    const versao = "4.2.7";
    const achar = (texto: string) => copiasDaVersao([{ caminho: "x.tsx", texto }], versao).length === 1;

    expect(achar('const VERSAO = "4.2.7";')).toBe(true);
    expect(achar("<span>v4.2.7</span>")).toBe(true);
    expect(achar("`Veridi v4.2.7`")).toBe(true);
    expect(achar("14.2.7")).toBe(false);
    expect(achar("4.2.78")).toBe(false);
    expect(achar("4.2.7.1")).toBe(false);
    expect(achar("`v${VERIDI_VERSION}`")).toBe(false);
  });
});
