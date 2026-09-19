/**
 * Versão oficial do Veridi Nutrition (VERIDI-SYSTEM-VERSIONING-01).
 *
 * É a ÚNICA fonte da versão: a API a devolve em `GET /meta` e o cabeçalho da
 * web a mostra ao lado de "Nutrition". Nenhum outro arquivo escreve o número —
 * `apps/web/src/app/versao-fonte-unica.test.ts` recusa a segunda cópia.
 *
 * SemVer, `MAJOR.MINOR.PATCH` (política em `docs/RELEASES.md`):
 * - PATCH (1.0.1): correção compatível;
 * - MINOR (1.1.0): funcionalidade nova compatível;
 * - MAJOR (2.0.0): mudança incompatível ou evolução estrutural relevante.
 *
 * O `version` dos `package.json` do monorepo NÃO é a versão do produto: são
 * pacotes privados do workspace, nunca publicados.
 */
export const VERIDI_VERSION = "1.0.0";

/**
 * Dia em que a versão foi publicada em PROD. Muda junto com o número, no
 * mesmo commit — a data de uma versão é a da publicação dela, não a do build.
 */
export const VERIDI_VERSION_DATE = "2026-09-19";

/** Contrato de `GET /meta`: o que o sistema no ar diz de si mesmo. */
export interface SystemMetaDTO {
  /** `VERIDI_VERSION` do build que responde. */
  version: string;
  /**
   * Ambiente em que a API roda: o nome do ambiente do Railway quando publicada
   * lá (`production`); fora dele, o `NODE_ENV` (`development`, `test`).
   */
  environment: string;
  /** Commit publicado (SHA completo), quando o provedor informa; `null` fora dele. */
  commitHash: string | null;
}
