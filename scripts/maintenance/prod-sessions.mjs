import { createRequire } from "node:module";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");

/**
 * Inventário SOMENTE LEITURA das sessões de produção.
 *
 *   railway run --service <serviço> node scripts/maintenance/prod-sessions.mjs
 *
 * Revogar sessão é decisão de segurança, e decisão de segurança tomada sem
 * número é chute: antes de derrubar qualquer uma é preciso saber quantas
 * existem, de quem são, quantas ainda estão dentro da validade e desde
 * quando não são usadas. Este script só conta.
 *
 * A revogação em si mora em `prod-sessions-revoke.mjs`, separada de
 * propósito: um script que lê e escreve acaba sendo rodado no automático.
 *
 * Nada de token, hash ou credencial é impresso — só contagem e data. Um
 * inventário que vaza o material da sessão é pior que a sessão velha.
 */

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const DIA = 24 * 60 * 60 * 1000;

function idade(data) {
  if (!data) return "—";
  const dias = Math.floor((Date.now() - new Date(data).getTime()) / DIA);
  return `${dias}d`;
}

async function main() {
  const agora = new Date();

  /*
   * Uma sessão só vale se ainda não venceu E não foi revogada — o schema
   * tem `revokedAt` separado de `expiresAt`, e contar só a validade
   * inflaria o número de acessos vivos com sessões já derrubadas.
   */
  const VIGENTE = { expiresAt: { gte: agora }, revokedAt: null };

  const total = await prisma.userSession.count();
  const vigentes = await prisma.userSession.count({ where: VIGENTE });
  const expiradas = await prisma.userSession.count({ where: { expiresAt: { lt: agora } } });
  const revogadas = await prisma.userSession.count({ where: { revokedAt: { not: null } } });

  console.log("=== Sessões em produção ===");
  console.log("total     ", total);
  console.log("vigentes  ", vigentes);
  console.log("expiradas ", expiradas);
  console.log("revogadas ", revogadas);

  // Por usuário: quem tem sessão viva é quem a revogação derruba de fato.
  const porUsuario = await prisma.userSession.groupBy({
    by: ["userId"],
    _count: { _all: true },
    _max: { createdAt: true },
  });

  const usuarios = await prisma.user.findMany({
    where: { id: { in: porUsuario.map((linha) => linha.userId) } },
    select: { id: true, email: true, role: true, active: true },
  });
  const porId = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

  console.log("\n=== Por usuário ===");
  for (const linha of porUsuario.sort((a, b) => b._count._all - a._count._all)) {
    const usuario = porId.get(linha.userId);
    const vivas = await prisma.userSession.count({
      where: { userId: linha.userId, ...VIGENTE },
    });
    console.log(
      [
        (usuario?.email ?? `<usuário ${linha.userId} removido>`).padEnd(34),
        `total ${String(linha._count._all).padStart(4)}`,
        `vigentes ${String(vivas).padStart(4)}`,
        `última há ${idade(linha._max.createdAt)}`,
        usuario?.active === false ? "USUÁRIO INATIVO" : "",
      ].join("  "),
    );
  }

  // Sessão viva de usuário inativo é o caso que não pode continuar existindo:
  // desativar a pessoa no cadastro não derrubou o acesso que ela já tinha.
  const inativos = usuarios.filter((usuario) => !usuario.active).map((usuario) => usuario.id);
  if (inativos.length > 0) {
    const vivasDeInativo = await prisma.userSession.count({
      where: { userId: { in: inativos }, ...VIGENTE },
    });
    console.log(`\nATENÇÃO: ${vivasDeInativo} sessão(ões) vigente(s) de usuário inativo.`);
  }

  const maisAntiga = await prisma.userSession.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const maisNova = await prisma.userSession.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  console.log("\nmais antiga  ", idade(maisAntiga?.createdAt));
  console.log("mais recente ", idade(maisNova?.createdAt));
}

main()
  .catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
