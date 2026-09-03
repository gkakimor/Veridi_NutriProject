import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Envolve quantidade CRUA em `formatQuantity`.
 *
 * O domínio guarda `Decimal(18,6)` e a tela mostrava o valor como veio: ponto
 * decimal num sistema em português, e até seis casas num número que alguém
 * confere contra uma balança. `0.0061224489795918367347 kg` não é precisão, é
 * ruído com aparência de precisão.
 *
 * A conversão é mecânica de propósito e só toca EXPRESSÃO JSX ISOLADA —
 * `{algo.xQuantity}` sozinho entre chaves. Onde o valor entra em template
 * string, em conta ou em atributo, o script não mexe: ali o número não está
 * sendo exibido, e formatá-lo mudaria o significado.
 *
 *   node scripts/format-quantity-sweep.mjs [--aplicar]
 */

const APLICAR = process.argv.includes("--aplicar");
const RAIZ = "apps/web/src";

/** Campos que são quantidade de domínio. Lista fechada, nunca heurística ampla. */
const CAMPOS = "(?:\\w*[Qq]uantity|onHand|reserved|available|onOrder|shortage)";
const ALVO = new RegExp("\\{\\s*([a-zA-Z_][\\w.?\\[\\]]*\\." + CAMPOS + ")\\s*\\}", "g");

function arquivos(dir) {
  const saida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivos(caminho));
    else if (entrada.name.endsWith(".tsx") && !entrada.name.includes(".test.")) saida.push(caminho);
  }
  return saida;
}

let tocados = 0;
let trocas = 0;

for (const caminho of arquivos(RAIZ)) {
  const original = readFileSync(caminho, "utf8");
  let atual = original.replace(ALVO, (_inteiro, expr) => {
    trocas += 1;
    return "{formatQuantity(" + expr + ")}";
  });
  if (atual === original) continue;

  if (!/from "[^"]*lib\/quantity"/.test(atual)) {
    const relativo = caminho.split(/[\\/]/).slice(RAIZ.split("/").length).length - 1;
    const prefixo = relativo > 0 ? "../".repeat(relativo) : "./";
    const linha = 'import { formatQuantity } from "' + prefixo + 'lib/quantity";\n';
    const imports = [...atual.matchAll(/^import [^\n]*;\n/gm)];
    const ultimo = imports[imports.length - 1];
    atual = ultimo
      ? atual.slice(0, ultimo.index + ultimo[0].length) + linha + atual.slice(ultimo.index + ultimo[0].length)
      : linha + atual;
  }

  tocados += 1;
  if (APLICAR) writeFileSync(caminho, atual);
  else console.log("  " + caminho);
}

console.log(
  APLICAR
    ? "Aplicado: " + trocas + " quantidades em " + tocados + " arquivos."
    : "Simulação: " + trocas + " quantidades em " + tocados + " arquivos. Rode com --aplicar.",
);
