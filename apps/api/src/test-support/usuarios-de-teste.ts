import type { PrismaClient } from "@prisma/client";

/**
 * Usuários e sessões do `buildTestApp`: criados por arquivo, tirados no fim
 * dele.
 *
 * Cada arquivo de teste cria um usuário e uma sessão por perfil que usa
 * (`createAuthenticatedUser`). Ninguém os tirava — o `veridi_dev` chegou a
 * TEST-SUPPORT-ISOLATION-WAVE-01 com 683 usuários `USR-TEST-*` e 808 sessões.
 *
 * O ciclo agora:
 *
 * - `createAuthenticatedUser` registra aqui o id de todo usuário que cria;
 * - o `afterAll` do setup de arquivo (`ciclo-do-arquivo-de-teste.ts`) tira as
 *   sessões e os usuários registrados. Ele roda DEPOIS dos `afterAll` do
 *   próprio arquivo — o Vitest desempilha hooks de fim na ordem inversa —, então
 *   a limpeza das fixtures do arquivo já passou;
 * - usuário que ainda é referência de fixture que o arquivo deixou (chave
 *   estrangeira RESTRICT) fica, sem sessão: é dado que o teste guardou;
 * - kill antes do `afterAll` deixa o que criou — no banco de TESTE — e a
 *   próxima rodada varre no `globalSetup` (`listarUsuariosDeRodadaInterrompida`).
 *
 * Sessão continua sendo do arquivo: nenhum arquivo usa a sessão de outro, e o
 * logout de um nunca derruba o vizinho.
 */

/** Todo usuário do `buildTestApp` nasce com este prefixo de código. */
export const PREFIXO_DO_USUARIO_DE_TESTE = "USR-TEST-";

const criadosNesteArquivo = new Set<string>();

export function registrarUsuarioDeTeste(id: string): void {
  criadosNesteArquivo.add(id);
}

export interface Descarte {
  readonly removidos: number;
  /** Seguros por fixture que ainda aponta para eles — ficam, sem sessão. */
  readonly mantidos: number;
}

/** Prisma devolve P2003 quando uma chave estrangeira segura a exclusão. */
const seguroPorChaveEstrangeira = (erro: unknown) => (erro as { code?: unknown } | null)?.code === "P2003";

/** Tira as sessões e os usuários; o que uma chave estrangeira segurar fica, sem sessão. */
export async function descartarUsuarios(prisma: PrismaClient, ids: readonly string[]): Promise<Descarte> {
  if (ids.length === 0) return { removidos: 0, mantidos: 0 };
  await prisma.userSession.deleteMany({ where: { userId: { in: [...ids] } } });
  try {
    const { count } = await prisma.user.deleteMany({ where: { id: { in: [...ids] } } });
    return { removidos: count, mantidos: 0 };
  } catch (erro) {
    if (!seguroPorChaveEstrangeira(erro)) throw erro;
  }
  // Um só segurado derruba a exclusão em lote: um por um, o resto sai.
  let removidos = 0;
  let mantidos = 0;
  for (const id of ids) {
    try {
      removidos += (await prisma.user.deleteMany({ where: { id } })).count;
    } catch (erro) {
      if (!seguroPorChaveEstrangeira(erro)) throw erro;
      mantidos += 1;
    }
  }
  return { removidos, mantidos };
}

/** O `afterAll` de cada arquivo: tira o que ESTE arquivo criou, e só isso. */
export async function descartarUsuariosDoArquivo(): Promise<Descarte> {
  const ids = [...criadosNesteArquivo];
  criadosNesteArquivo.clear();
  if (ids.length === 0) return { removidos: 0, mantidos: 0 };
  // Import tardio: arquivo que nunca pediu sessão não carrega o Prisma por causa disto.
  const { getPrisma } = await import("../db/prisma.js");
  return descartarUsuarios(getPrisma(), ids);
}

/**
 * Usuários do `buildTestApp` que sobraram de rodada interrompida — kill antes
 * do `afterAll`. Com outra conexão aberta no banco de teste há rodada viva
 * (os usuários dela estão em uso), e nada é listado.
 */
export async function listarUsuariosDeRodadaInterrompida(prisma: PrismaClient): Promise<string[] | null> {
  const [atividade] = await prisma.$queryRaw<Array<{ outras: number; tabela: string | null }>>`
    SELECT
      (SELECT count(*)::int FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND backend_type = 'client backend') AS "outras",
      to_regclass('public.users')::text AS "tabela"`;
  if (!atividade || atividade.outras > 0) return null;
  if (!atividade.tabela) return [];
  const orfaos = await prisma.user.findMany({
    where: { code: { startsWith: PREFIXO_DO_USUARIO_DE_TESTE } },
    select: { id: true },
  });
  return orfaos.map((usuario) => usuario.id);
}
