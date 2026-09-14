import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estrutural das listagens (LISTS-LOADING-STALE-DATA-02).
 *
 * As duas ondas levaram 28 listas paginadas, as abas da Visão do Cliente e o
 * Quadro de Produção para `useListQuery` (`lib/list-query.ts`). O padrão antigo
 * deixava duas marcas que se leem no fonte sem ambiguidade, e que nenhuma tela
 * migrada tem:
 *
 *   - o total da consulta guardado em `useState` (`setTotal`) — a lista que
 *     troca linhas e total quando QUALQUER resposta chega, e mostra o recorte
 *     anterior enquanto o novo carrega;
 *   - a página voltando à 1 por efeito (`useEffect(() => setPage(1), …)`) — o
 *     filtro trocado fora da primeira página consulta duas vezes.
 *
 * Tela nova com uma delas cai aqui, com arquivo e linha: a consulta de lista é
 * `useListQuery`, a página de filtro em estado é `useFilteredPage`.
 */

const SRC = join(process.cwd(), "src");

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return fontes(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/**
 * Comentário não é código: a explicação do padrão antigo pode citá-lo (e cita,
 * em `list-query.ts`). As quebras de linha ficam, para a linha do achado valer.
 */
function semComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/gm, (_trecho, antes: string) => antes);
}

const PADROES = [
  { nome: "o total da consulta em useState", regex: /\bsetTotal\b/g },
  { nome: "a página de volta à 1 por efeito", regex: /useEffect\(\s*\(\)\s*=>\s*\{?\s*setPage\(\s*1\s*\)/g },
] as const;

function achados(regex: RegExp): string[] {
  const onde: string[] = [];
  for (const arquivo of fontes(SRC)) {
    const texto = semComentarios(readFileSync(arquivo, "utf8"));
    for (const achado of texto.matchAll(regex)) {
      const linha = texto.slice(0, achado.index).split("\n").length;
      onde.push(`${relative(SRC, arquivo).split(sep).join("/")}:${linha}`);
    }
  }
  return onde;
}

describe("listagens sem a consulta solta de antes", () => {
  it.each(PADROES)("nenhuma tela com $nome", ({ regex }) => {
    expect(achados(regex)).toEqual([]);
  });

  it("a guarda enxerga as duas marcas no código de antes — e não lê comentário", () => {
    const antes = [
      "const [total, setTotal] = useState(0);",
      "useEffect(() => {",
      "  setPage(1);",
      "}, [search, typeFilter]);",
      "useEffect(() => setPage(1), [search, showArchived]);",
    ].join("\n");
    expect(semComentarios(antes).match(PADROES[0].regex)).toHaveLength(1);
    expect(semComentarios(antes).match(PADROES[1].regex)).toHaveLength(2);

    const comentado = [
      "/* Voltar para a página 1 por efeito — `useEffect(() => setPage(1), [filtros])` */",
      "// const [total, setTotal] = useState(0);",
      'const endereco = "http://127.0.0.1:3333";',
    ].join("\n");
    expect(semComentarios(comentado).match(PADROES[0].regex)).toBeNull();
    expect(semComentarios(comentado).match(PADROES[1].regex)).toBeNull();
    expect(semComentarios(comentado)).toContain('"http://127.0.0.1:3333"');
  });
});
