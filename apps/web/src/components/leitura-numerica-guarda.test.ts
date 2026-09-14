import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estrutural das LEITURAS numéricas pt-BR — PTBR-NUMERIC-DISPLAY-AUDIT-01.
 *
 * O par de `campo-numerico-guarda.test.ts`: aquela cuida da entrada, esta do
 * que a tela e o PDF só mostram. Não tenta ler semântica — decidir se um
 * `{x.y}` é número exige o tipo, e lint de tipo não cabe numa guarda de texto.
 * Pega só o que é cru sem discussão, sobre o código web de PRODUÇÃO:
 *
 * 1. dinheiro montado à mão (`R$ ${valor}` ou `R$ {valor}` no JSX) — dinheiro
 *    é `formatBRL`, `formatUnitPriceBRL`, `formatUnitCost` ou `formatMoneyPtBr`;
 * 2. percentual colado num valor cru (`${valor}%`, `{valor}%`) — é
 *    `formatPercent` ou `formatPercentPtBr`;
 * 3. campo numérico de domínio interpolado direto (`{linha.unitPrice}`,
 *    `${recurso.powerKw}`) — a lista de nomes é fechada: os que já apareceram
 *    crus e cujo tipo é decimal em string. `value={...}` de campo não conta;
 * 4. contagem de lista (`{total} {total === 1 ? …}`) sem milhar;
 * 5. soma de quantidade por `Number` exibida direto — soma é `Decimal`.
 *
 * `${linha.id}:${linha.quantidade}` é chave de memo, não leitura, e fica fora.
 *
 * Exceção nova entra na allowlist com o motivo escrito.
 */

const RAIZ = join(process.cwd(), "src");

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function relativo(arquivo: string): string {
  return relative(RAIZ, arquivo).split(sep).join("/");
}

function arquivosDeProducao(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === "testing" || entrada.name === "test-support" ? [] : arquivosDeProducao(caminho);
    }
    const ehTeste = /\.test\.tsx?$/.test(entrada.name) || entrada.name.startsWith("setup");
    return !ehTeste && /\.tsx?$/.test(entrada.name) ? [caminho] : [];
  });
}

/** Campos decimais de domínio que já foram vistos crus na tela. */
const CAMPOS_DECIMAIS =
  "powerKw|rateValue|rateValueSnapshot|unitPrice|unitCost|referenceUnitPrice|lotFreeQuantity|" +
  "finishedGoodsAvailable|reservedRemaining|stillToReserve|currentAvailable|quotedQuantity|" +
  "orderTotal|minimumBatchQuantity|variance|computedUnits|purityPercentApplied|overagePercent|" +
  "commissionPercent|contributionMarginPercent|markupPercent|yieldPercent|" +
  "\\w*Quantity|onOrder|onHand|shortage";

const PROIBIDOS: { nome: string; padrao: RegExp }[] = [
  { nome: "dinheiro montado à mão", padrao: /R\$ \$?\{/g },
  { nome: "percentual sobre valor cru", padrao: /\$?\{[\w.?]+\}%/g },
  {
    nome: "campo decimal interpolado cru",
    padrao: new RegExp(
      `(?<![=(,] ?|\\}:\\$?)\\$?\\{\\w+(?:\\??\\.\\w+)*\\??\\.(?:${CAMPOS_DECIMAIS})(?:\\s*\\?\\?\\s*"[^"]*")?\\s*\\}`,
      "g",
    ),
  },
  {
    nome: "campo decimal cru depois de busca (`find(...)?.campo`)",
    padrao: new RegExp(`\\)\\??\\.(?:${CAMPOS_DECIMAIS})(?:\\s*\\?\\?\\s*"[^"]*")?\\s*\\}`, "g"),
  },
  { nome: "soma de quantidade em float exibida", padrao: /\+ Number\([\w.?]+(?:Quantity|Amount|Total)\), 0\)\}/g },
  { nome: "contagem de lista sem milhar", padrao: /\{(?:[\w.]+\.)?total\} \{/g },
];

/** Onde o padrão é a própria formatação — com o motivo. */
const PERMITIDOS: Record<string, string> = {
  "lib/numeric-ptbr.ts": "A foundation: `${corpo}%` recebe o corpo já formatado.",
  "lib/percent.ts": "O formatador de percentual: `${corpo}%` sobre o corpo já formatado.",
  "components/NumericField.tsx": "O campo fora do foco: `${corpo}%` sobre o corpo já formatado pela foundation.",
};

describe("leituras numéricas pt-BR", () => {
  it("nenhuma tela ou PDF mostra dinheiro, percentual, decimal de domínio ou contagem crus", () => {
    const achados = arquivosDeProducao(RAIZ)
      .filter((arquivo) => !(relativo(arquivo) in PERMITIDOS))
      .flatMap((arquivo) => {
        const fonte = semComentarios(readFileSync(arquivo, "utf8"));
        return PROIBIDOS.flatMap(({ nome, padrao }) =>
          [...fonte.matchAll(padrao)].map((achado) => `${relativo(arquivo)} — ${nome}: ${achado[0]}`),
        );
      });
    expect(achados).toEqual([]);
  });

  it("a allowlist não guarda arquivo que deixou de existir", () => {
    const existentes = new Set(arquivosDeProducao(RAIZ).map(relativo));
    expect(Object.keys(PERMITIDOS).filter((arquivo) => !existentes.has(arquivo))).toEqual([]);
  });
});
