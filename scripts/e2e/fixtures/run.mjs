import { randomBytes } from "node:crypto";

/**
 * Identidade de EXECUÇÃO de uma suíte E2E — em memória, nunca em arquivo.
 *
 * Suíte que cria massa com nome fixo e depois a reencontra por esse nome mente
 * numa base que já tem a massa da execução anterior: conta lote novo junto com
 * lote retido, reencontra um Produto que já vem com Formulação ativa. A saída é
 * identidade, não limpeza: cada execução carimba um token nos campos de NEGÓCIO
 * que ela mesma preenche (nome de cliente, de item, de produto). Códigos
 * oficiais — CLI-, PROD-, PED-, ORC-… — nascem da sequência do domínio e são
 * LIDOS das respostas, nunca inventados.
 *
 * Até E2E-BASELINE-REDESIGN-WAVE-01-02 o token morava em `handoff/e2e-run.json`:
 * quem não pedia execução nova relia o da última suíte, e o token (`MMDD` + 3
 * caracteres) colidia. Agora cada processo sorteia o seu e o esquece ao sair.
 *
 *   import { carimbar, criarRun } from "./fixtures/run.mjs";
 *   const run = criarRun();                 // { runId: "K3F9QZ", carimbo: "E2EK3F9QZ" }
 *   const nome = carimbar(run, "Cliente");  // "Cliente E2EK3F9QZ"
 */

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const TAMANHO_DO_RUN_ID = 6;

/** Seis caracteres base36 sorteados por `crypto`: 36⁶ ≈ 2,2 bilhões de tokens. */
export function novoRunId(tamanho = TAMANHO_DO_RUN_ID) {
  let token = "";
  while (token.length < tamanho) {
    for (const byte of randomBytes(tamanho)) {
      // 252 = 7 × 36: descartar o que sobra mantém cada símbolo equiprovável.
      if (byte < 252 && token.length < tamanho) token += BASE36[byte % 36];
    }
  }
  return token;
}

/**
 * A execução desta suíte. `prefixo` é o carimbo de negócio: `E2E` nas suítes,
 * `GP` no golden path.
 */
export function criarRun({ prefixo = "E2E" } = {}) {
  if (!/^[A-Z][A-Z0-9]{1,3}$/.test(prefixo)) throw new Error(`prefixo de execução inválido: "${prefixo}"`);
  const runId = novoRunId();
  return Object.freeze({ runId, carimbo: `${prefixo}${runId}`, criadoEm: new Date().toISOString() });
}

/** `Cliente E2EK3F9QZ`: o rótulo de negócio com o carimbo desta execução. */
export function carimbar(run, rotulo) {
  if (!run?.carimbo) throw new Error("carimbar exige a execução de criarRun()");
  return `${rotulo} ${run.carimbo}`;
}
