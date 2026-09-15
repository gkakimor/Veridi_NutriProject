import { criarRun } from "../fixtures/run.mjs";

/**
 * Compatibilidade das suítes que ainda não passaram para `fixtures/run.mjs`.
 *
 * `obterRun` não relê nem grava mais `handoff/e2e-run.json`
 * (E2E-BASELINE-REDESIGN-WAVE-01-02): toda chamada é uma execução nova, em
 * memória, e `novo` é aceito e ignorado. Não existe "retomar a última" — quem
 * precisa retomar massa (o golden path) recebe o runId por `--run`.
 */
export function obterRun({ dono = "e2e" } = {}) {
  const { runId, criadoEm } = criarRun();
  return { runId, dono, criadoEm };
}
