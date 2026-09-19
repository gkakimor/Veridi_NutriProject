import type { FastifyPluginAsync } from "fastify";
import { VERIDI_VERSION } from "@veridi/shared";
import type { SystemMetaDTO } from "@veridi/shared";
import { env } from "../../config/env.js";

/** Nome de ambiente do Railway que a tela pode mostrar como veio. */
const NOME_DE_AMBIENTE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
/** SHA de commit do Git, abreviado ou completo. */
const SHA_DE_COMMIT = /^[0-9a-f]{7,40}$/i;

type FonteDoAmbiente = Pick<
  typeof env,
  "NODE_ENV" | "RAILWAY_ENVIRONMENT_NAME" | "RAILWAY_GIT_COMMIT_SHA"
>;

/**
 * O que o sistema no ar diz de si mesmo (VERIDI-SYSTEM-VERSIONING-01).
 *
 * A versão vem da fonte única do `@veridi/shared`; ambiente e commit, do que o
 * Railway injeta no deploy — os mesmos `commitHash` e ambiente que o registro
 * do deploy mostra. Fora do Railway, ambiente é o `NODE_ENV` e commit é
 * `null`: não se inventa build que não existe.
 *
 * A resposta é montada campo a campo, nunca espalhando o `env`: nada além
 * destes três sai daqui — nenhuma URL de banco, credencial do R2 ou id do
 * projeto. Valor fora do formato esperado vira o padrão, não texto livre.
 */
export function resolveSystemMeta(fonte: FonteDoAmbiente): SystemMetaDTO {
  const ambienteDoRailway = fonte.RAILWAY_ENVIRONMENT_NAME?.trim() ?? "";
  const commit = fonte.RAILWAY_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";

  return {
    version: VERIDI_VERSION,
    environment: NOME_DE_AMBIENTE.test(ambienteDoRailway) ? ambienteDoRailway : fonte.NODE_ENV,
    commitHash: SHA_DE_COMMIT.test(commit) ? commit : null,
  };
}

/**
 * `GET /meta`
 *
 * Exige sessão, como toda rota fora da lista pública: quem lê é o cabeçalho
 * do app logado ("Sobre o sistema"), qualquer perfil.
 */
export const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => resolveSystemMeta(env));
};
