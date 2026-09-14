import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estrutural da foundation numérica pt-BR —
 * PTBR-NUMERIC-INPUT-FOUNDATION-01.
 *
 * Duas coisas, sem quebrar tela nenhuma que existe hoje:
 *
 * 1. a foundation continua sem float e sem locale da máquina — o motivo de ela
 *    existir;
 * 2. `type="number"` não ganha lugar NOVO. As telas que ainda o usam estão
 *    listadas e saem no PTBR-NUMERIC-INPUT-ROLLOUT-01; quando a última sair,
 *    a lista fica vazia e a guarda vira proibição. Uma tela da lista que
 *    deixar de usar `type="number"` não quebra nada — só tela nova quebra.
 */

const RAIZ = join(process.cwd(), "src");

/** Comentários fora: explicar por que não usar `type="number"` não é usá-lo. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function componentes(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return componentes(caminho);
    return entrada.name.endsWith(".tsx") && !entrada.name.endsWith(".test.tsx") ? [caminho] : [];
  });
}

/** Telas com `type="number"` quando a foundation nasceu — alvo do rollout. */
const AINDA_NO_ROLLOUT = [
  "pages/industrial-resources/IndustrialResourceDetailPage.tsx",
  "pages/industrial-resources/industrial-resource-form.tsx",
  "pages/production-orders/ProductionOrderPage.tsx",
];

describe("campo numérico — guarda estrutural", () => {
  it("a foundation não passa valor por float nem pelo locale da máquina", () => {
    for (const arquivo of ["src/lib/numeric-ptbr.ts", "src/components/NumericField.tsx"]) {
      const corpo = semComentarios(readFileSync(join(process.cwd(), arquivo), "utf8"));
      expect(corpo, `${arquivo} usa type="number"`).not.toMatch(/type=\{?["']number["']/);
      expect(corpo, `${arquivo} usa valueAsNumber`).not.toContain("valueAsNumber");
      expect(corpo, `${arquivo} usa toLocaleString`).not.toContain("toLocaleString");
      expect(corpo, `${arquivo} usa Intl`).not.toContain("Intl.");
      expect(corpo, `${arquivo} usa parseFloat`).not.toContain("parseFloat");
      expect(corpo, `${arquivo} usa Math.round`).not.toContain("Math.round");
      expect(corpo, `${arquivo} usa toFixed`).not.toContain("toFixed(");
      // `\b`: `parsePtBrNumber(` é nome de função, não conversão.
      expect(corpo, `${arquivo} converte para Number`).not.toMatch(/\bNumber\(/);
    }
  });

  it('type="number" não entra em tela nova — campo numérico usa IntegerField, DecimalField, MoneyField ou PercentField', () => {
    const TYPE_NUMBER = /type=\{?["']number["']/;
    // A varredura não é vazia e o padrão pega as duas grafias do JSX.
    const arquivos = componentes(RAIZ);
    expect(arquivos.length).toBeGreaterThan(100);
    expect(TYPE_NUMBER.test('<input type="number" />') && TYPE_NUMBER.test("<input type={'number'} />")).toBe(true);

    const comTypeNumber = arquivos
      .filter((arquivo) => TYPE_NUMBER.test(semComentarios(readFileSync(arquivo, "utf8"))))
      .map((arquivo) => relative(RAIZ, arquivo).split(sep).join("/"));

    expect(comTypeNumber.filter((arquivo) => !AINDA_NO_ROLLOUT.includes(arquivo))).toEqual([]);
  });
});
