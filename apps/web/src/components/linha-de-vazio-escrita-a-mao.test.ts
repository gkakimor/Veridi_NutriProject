import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nenhuma tela escreve a célula de vazio à mão (LISTS-EMPTY-ROW-390-RAW-01).
 *
 * `ListStatusRow` ganhou o corpo com a largura visível em
 * LISTS-NAVIGATION-UX-WAVE-01, mas 49 linhas de vazio escritas à mão — seções
 * e telas de detalhe — ficaram sem ele: em 390px o link de
 * `SupplierItemsSection` terminava em x=618 com a borda em 349. Todas passaram
 * por `TableEmptyRow`; esta guarda derruba a próxima `td.table__empty` que
 * nascer fora dele, em vez de esperar o próximo smoke em 390px.
 */

const SRC = join(process.cwd(), "src");
const UNICO = "components/TableEmptyRow.tsx";

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? fontes(caminho) : [caminho];
  });
}

const escreveAMao = (codigo: string) => /table__empty/.test(codigo);

describe("linha de vazio escrita à mão", () => {
  it("só TableEmptyRow escreve a classe da célula de vazio", () => {
    const arquivos = fontes(SRC)
      .map((caminho) => relative(SRC, caminho).split(sep).join("/"))
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel));
    expect(arquivos).toContain(UNICO);
    const fora = arquivos.filter((rel) => rel !== UNICO && escreveAMao(readFileSync(join(SRC, rel), "utf8")));
    expect(fora).toEqual([]);
  });

  it("a guarda reconhece a linha como era escrita", () => {
    expect(escreveAMao('<td colSpan={6} className="table__empty">Nada.</td>')).toBe(true);
    expect(escreveAMao('<td\n  colSpan={16}\n  className="table__empty"\n>')).toBe(true);
    expect(escreveAMao("<TableEmptyRow colSpan={6}>Nada.</TableEmptyRow>")).toBe(false);
  });
});
