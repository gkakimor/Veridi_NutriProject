import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Troca `formatBRL` por `formatUnitPriceBRL` onde o valor é PREÇO UNITÁRIO.
 *
 * O documento de faturamento exibia `R$ 4,05` ao lado de um total calculado
 * sobre `4,0531`. Quem conferisse o papel chegava a R$ 498,15 num documento
 * que dizia R$ 498,53, e os 38 centavos não tinham origem visível.
 *
 * A troca é ancorada no NOME da expressão: só casa quando o texto entre
 * parênteses contém `nitPrice` — `unitPrice`, `agreedUnitPrice`,
 * `selectedUnitPrice`, `purchaseUnitPrice`, `orderedUnitPrice`,
 * `suggestedUnitPrice`. `lineTotal`, `totalAmount` e `orderTotal` nunca casam,
 * que é exatamente o ponto: total continua sendo moeda de 2 casas.
 *
 *   node scripts/unit-price-sweep.mjs [--aplicar]
 */

const APLICAR = process.argv.includes("--aplicar");
const RAIZ = "apps/web/src";

/** `formatBRL(<algo com nitPrice dentro>)`, sem atravessar parêntese aninhado. */
const ALVO = /formatBRL\(([^()]*nitPrice[^()]*(?:\([^()]*\)[^()]*)*)\)/g;

function arquivos(dir) {
  const saida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes(".test.")) saida.push(caminho);
  }
  return saida;
}

let tocados = 0;
let trocas = 0;

for (const caminho of arquivos(RAIZ)) {
  const original = readFileSync(caminho, "utf8");
  let atual = original.replace(ALVO, (_inteiro, expr) => {
    trocas += 1;
    return `formatUnitPriceBRL(${expr})`;
  });
  if (atual === original) continue;

  // Import: aproveita a linha que já traz `formatBRL` do mesmo módulo quando
  // ela existe, em vez de abrir um segundo import do mesmo caminho.
  if (!/\bformatUnitPriceBRL\b[^\n]*from/.test(atual)) {
    const existente = atual.match(/import \{([^}]*\bformatBRL\b[^}]*)\} from ("[^"]*currency");/);
    if (existente) {
      atual = atual.replace(
        existente[0],
        `import {${existente[1].replace(/\s*$/, "")}, formatUnitPriceBRL } from ${existente[2]};`,
      );
    } else {
      const profundidade = caminho.split(/[\\/]/).length - RAIZ.split("/").length - 1;
      const prefixo = profundidade > 0 ? "../".repeat(profundidade) : "./";
      const linha = `import { formatUnitPriceBRL } from "${prefixo}lib/currency";\n`;
      const imports = [...atual.matchAll(/^import [^\n]*;\n/gm)];
      const ultimo = imports[imports.length - 1];
      atual = ultimo
        ? atual.slice(0, ultimo.index + ultimo[0].length) + linha + atual.slice(ultimo.index + ultimo[0].length)
        : linha + atual;
    }
  }

  tocados += 1;
  if (APLICAR) writeFileSync(caminho, atual);
  else console.log(`  ${caminho}`);
}

console.log(
  APLICAR
    ? `Aplicado: ${trocas} preços unitários em ${tocados} arquivos.`
    : `Simulação: ${trocas} preços unitários em ${tocados} arquivos. Rode com --aplicar.`,
);
