import { createRequire } from "node:module";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");

/**
 * Revoga as sessões VIGENTES de produção.
 *
 *   railway run --service Postgres node scripts/maintenance/prod-sessions-revoke.mjs
 *   railway run --service Postgres node scripts/maintenance/prod-sessions-revoke.mjs --confirmar
 *
 * Sem `--confirmar` o script só mostra o que faria. Derrubar sessão é ato
 * de segurança e ato de segurança silencioso é ato de segurança que ninguém
 * revisou — a listagem vem antes, sempre.
 *
 * Não apaga linha nenhuma. `revokedAt` marca a sessão como derrubada e a
 * linha continua no banco: quando foi criada, de quem era e quando caiu é
 * histórico de acesso, e histórico de acesso apagado não serve para
 * investigar nada. Sessão expirada também fica — ela já não abre porta.
 *
 * Roda com a credencial injetada pelo Railway CLI; nada é copiado nem
 * impresso.
 */

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const confirmar = process.argv.includes("--confirmar");

async function main() {
  const agora = new Date();
  const VIGENTE = { expiresAt: { gte: agora }, revokedAt: null };

  const alvos = await prisma.userSession.findMany({
    where: VIGENTE,
    select: { id: true, createdAt: true, expiresAt: true, user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (alvos.length === 0) {
    console.log("Nenhuma sessão vigente — nada a revogar.");
    return;
  }

  console.log(`Sessões vigentes: ${alvos.length}`);
  for (const sessao of alvos) {
    console.log(
      `  ${sessao.user?.email ?? "<usuário removido>"}  criada ${sessao.createdAt.toISOString()}  vence ${sessao.expiresAt.toISOString()}`,
    );
  }

  if (!confirmar) {
    console.log("\nSimulação. Para revogar de fato, repita com --confirmar.");
    return;
  }

  // Filtra por `id` e não por `expiresAt >= agora`: entre a leitura e a
  // escrita alguém pode ter feito login, e derrubar uma sessão que este
  // relatório não listou seria revogar às cegas.
  const { count } = await prisma.userSession.updateMany({
    where: { id: { in: alvos.map((sessao) => sessao.id) }, revokedAt: null },
    data: { revokedAt: agora },
  });
  console.log(`\nRevogadas: ${count}. Todos precisarão entrar de novo.`);
}

main()
  .catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
