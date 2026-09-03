import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Dá voz às mensagens de erro.
 *
 * `.form-alert` é o padrão de erro do sistema, usado 125 vezes em 101
 * arquivos. Só 14 tinham `role`: as outras eram visíveis e MUDAS para leitor
 * de tela — o erro aparecia na tela e não era anunciado. Numa rodada que trata
 * falha silenciosa como HIGH, uma mensagem que não chega a quem não vê é
 * exatamente isso.
 *
 * A troca é mecânica de propósito, e só onde o conteúdo é COMPROVADAMENTE um
 * erro: uma variável cujo nome é `error`, `erro`, `formError` ou equivalente.
 * Onde o `.form-alert` carrega texto informativo — "esta ordem foi concluída
 * sem consumo de…" — quem decide entre `alert` e `status` é quem escreveu, e
 * este script não adivinha: `alert` interrompe a leitura, e usar isso para
 * informação ensina a ignorar o próximo alerta, que pode ser de verdade.
 *
 * Idempotente: linha que já tem `role` não é tocada.
 *
 *   node scripts/form-alert-role.mjs [--aplicar]
 */

const APLICAR = process.argv.includes("--aplicar");
const RAIZ = "apps/web/src";

/**
 * Nomes de variável que só carregam erro. Conservador de propósito: um nome
 * ambíguo fora da lista fica para revisão humana em vez de virar `alert`.
 */
const NOMES_DE_ERRO = String.raw`(?:\w+\.)?(?:error|erro|formError|saveError|loadError|fieldError|apiError)`;

const PADROES = [
  // {error && <p className="form-alert">{error}</p>}
  new RegExp(
    String.raw`(\{\s*${NOMES_DE_ERRO}\s*(?:&&|\?)\s*)<p className="form-alert">(\{\s*${NOMES_DE_ERRO}\s*\})</p>`,
    "g",
  ),
  // <p className="form-alert">{error}</p>  (sem guarda na mesma linha)
  new RegExp(String.raw`<p className="form-alert">(\{\s*${NOMES_DE_ERRO}\s*\})</p>`, "g"),
];

function arquivos(diretorio) {
  const encontrados = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...arquivos(caminho));
    else if (entrada.name.endsWith(".tsx") && !entrada.name.includes(".test.")) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

let tocados = 0;
let trocas = 0;

for (const caminho of arquivos(RAIZ)) {
  const original = readFileSync(caminho, "utf8");
  let atual = original;

  atual = atual.replace(PADROES[0], (inteiro, guarda, conteudo) => {
    trocas += 1;
    return `${guarda}<p className="form-alert" role="alert">${conteudo}</p>`;
  });
  atual = atual.replace(PADROES[1], (inteiro, conteudo) => {
    trocas += 1;
    return `<p className="form-alert" role="alert">${conteudo}</p>`;
  });

  if (atual !== original) {
    tocados += 1;
    if (APLICAR) writeFileSync(caminho, atual);
    else console.log(`  ${caminho}`);
  }
}

console.log(
  APLICAR
    ? `Aplicado: ${trocas} mensagens em ${tocados} arquivos ganharam role="alert".`
    : `Simulação: ${trocas} mensagens em ${tocados} arquivos. Rode com --aplicar.`,
);
