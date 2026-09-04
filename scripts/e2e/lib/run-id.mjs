import fs from "node:fs";
import path from "node:path";

/**
 * Identidade de EXECUÇÃO de uma suíte E2E.
 *
 * Uma suíte que cria massa com nome fixo e depois a reencontra por esse nome
 * mente numa base que já tem a massa da execução anterior: conta lote novo
 * junto com lote retido, reencontra um Produto que já vem com Formulação
 * ativa, lê um preço que a rodada passada ativou de propósito. Os defeitos
 * são do laboratório, não do produto, e custam horas para separar.
 *
 * Exigir base limpa não resolve — é exatamente o que um E2E não pode exigir
 * para ser confiável.
 *
 * A saída é identidade, não limpeza: cada execução carimba um token curto nos
 * campos de NEGÓCIO que ela mesma preenche (nome de fornecedor, de item, de
 * produto, de cliente). Códigos oficiais continuam nascendo da sequência do
 * domínio. Buscar pelo nome carimbado reencontra só o que esta execução criou,
 * e a base pode estar cheia de massa legítima sem interferir.
 *
 *   import { obterRun } from "./lib/run-id.mjs";
 *   const run = obterRun({ novo: true, dono: "comercial" });
 *   const P = `E2E${run.runId}`;            // prefixo dos nomes desta execução
 */

const ARQUIVO = path.resolve("handoff/e2e-run.json");

/** Token curto, legível e ordenável: `MMDD` + 3 caracteres aleatórios. */
function novoToken() {
  const agora = new Date();
  const dia = `${String(agora.getMonth() + 1).padStart(2, "0")}${String(agora.getDate()).padStart(2, "0")}`;
  return `${dia}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function ler() {
  if (!fs.existsSync(ARQUIVO)) return null;
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return null;
  }
}

/**
 * A identidade desta execução.
 *
 * `novo: true` carimba uma execução nova. Sem isso, retoma a última — é como
 * uma suíte encontra a massa que outra criou, quando as duas fazem parte do
 * mesmo roteiro.
 */
export function obterRun({ novo = false, dono = "e2e" } = {}) {
  const existente = ler();
  if (!novo && existente?.runId) return existente;

  const run = { runId: novoToken(), dono, criadoEm: new Date().toISOString() };
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(run, null, 2));
  return run;
}
