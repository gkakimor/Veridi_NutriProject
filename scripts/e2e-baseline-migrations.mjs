import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Estado das migrations de uma base E2E — a guarda contra template velha
 * (E2E-BASELINE-REDESIGN-WAVE-01-02).
 *
 * `pnpm e2e:baseline:rebuild` grava em `baseline.json` o estado das migrations
 * que aplicou; `pnpm e2e:run` recalcula o do repositório e recusa clonar quando
 * os dois diferem. O rebuild nunca é automático: reconstruir a base é decisão
 * de quem roda — ele derruba `veridi_e2e_baseline`.
 *
 * A assinatura cobre NOME e CONTEÚDO de cada `migration.sql`: migration editada
 * também deixa a base velha. Fim de linha não conta — o checkout do Windows
 * escreve CRLF, o repositório guarda LF, e o mesmo SQL é o mesmo SQL.
 */

export const COMANDO_DE_REBUILD = "pnpm e2e:baseline:rebuild";

/** Pastas de migration (com `migration.sql`), em ordem de nome — a ordem do Prisma. */
export function nomesDasMigrations(pasta) {
  return readdirSync(pasta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && existsSync(path.join(pasta, entrada.name, "migration.sql")))
    .map((entrada) => entrada.name)
    .sort();
}

/** `{ total, ultima, assinatura }` das migrations de uma pasta. */
export function estadoDasMigrations(pasta) {
  const nomes = nomesDasMigrations(pasta);
  const linhas = nomes.map((nome) => {
    const sql = readFileSync(path.join(pasta, nome, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
    return `${nome}:${createHash("sha256").update(sql).digest("hex")}`;
  });
  return {
    total: nomes.length,
    ultima: nomes.at(-1) ?? null,
    assinatura: createHash("sha256").update(linhas.join("\n")).digest("hex"),
  };
}

/** Lança quando `baseline.json` não prova que a base está nas migrations do repositório. */
export function conferirBaselineAtual(baseline, atual, { banco }) {
  if (!baseline) {
    throw new Error(`RECUSADO: ${banco} sem baseline.json — a base não se prova. Rode: ${COMANDO_DE_REBUILD}`);
  }
  if (baseline.banco !== banco) {
    throw new Error(`RECUSADO: baseline.json descreve ${baseline.banco}, não ${banco}. Rode: ${COMANDO_DE_REBUILD}`);
  }
  const registro = baseline.migrations;
  if (!registro?.assinatura) {
    throw new Error(
      `RECUSADO: baseline.json de ${banco} não registra as migrations — base anterior à guarda. Rode: ${COMANDO_DE_REBUILD}`,
    );
  }
  if (registro.assinatura !== atual.assinatura) {
    throw new Error(
      `RECUSADO: template velha — ${banco} foi montada com ${registro.total} migrations (última ${registro.ultima}), ` +
        `o repositório tem ${atual.total} (última ${atual.ultima})` +
        `${registro.total === atual.total ? ", com conteúdo diferente" : ""}. ` +
        `O runner não reconstrói sozinho. Rode: ${COMANDO_DE_REBUILD}`,
    );
  }
  return registro;
}

/**
 * O banco (clone) carrega exatamente as migrations do repositório — prova de
 * que a template clonada é a que o `baseline.json` descreve.
 */
export function conferirMigrationsDoBanco(nomesDoBanco, nomesDoRepositorio, { banco }) {
  const doBanco = new Set(nomesDoBanco);
  const doRepositorio = new Set(nomesDoRepositorio);
  const faltam = nomesDoRepositorio.filter((nome) => !doBanco.has(nome));
  const sobram = nomesDoBanco.filter((nome) => !doRepositorio.has(nome));
  if (faltam.length > 0 || sobram.length > 0) {
    throw new Error(
      `RECUSADO: ${banco} não está nas migrations do repositório — faltam ${faltam.length}` +
        `${faltam[0] ? ` (${faltam[0]}…)` : ""}, sobram ${sobram.length}${sobram[0] ? ` (${sobram[0]}…)` : ""}. ` +
        `Rode: ${COMANDO_DE_REBUILD}`,
    );
  }
}
