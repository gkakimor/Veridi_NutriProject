/**
 * Sessão SOMENTE LEITURA para o dry-run de `prod-cleanup.mjs`.
 *
 * Módulo puro — sem Prisma, sem ambiente, sem efeito ao importar. Sem
 * `--apply`, o script conecta com `options=-c default_transaction_read_only=on`
 * (parâmetro de URL do Prisma desde a 3.8): toda transação da conexão nasce
 * READ ONLY, e o próprio banco recusa INSERT, UPDATE, DELETE, TRUNCATE,
 * `ALTER SEQUENCE` e `nextval()`. Antes de ler qualquer coisa o script confere
 * `transaction_read_only` e aborta se não vier `on`. "Dry-run não escreve"
 * deixa de ser só uma promessa do caminho do código.
 */

export const OPCAO_SOMENTE_LEITURA = "-c default_transaction_read_only=on";

/**
 * A mesma URL com a sessão somente leitura. `options` que já existir continua;
 * a nossa vai por último, e no Postgres o último `-c` do mesmo parâmetro vence.
 */
export function urlSomenteLeitura(url) {
  const u = new URL(url);
  const atual = u.searchParams.get("options");
  u.searchParams.set("options", atual ? `${atual} ${OPCAO_SOMENTE_LEITURA}` : OPCAO_SOMENTE_LEITURA);
  return u.toString();
}

export const SQL_CONFERIR_SOMENTE_LEITURA = `SELECT current_setting('transaction_read_only') AS "somenteLeitura"`;
