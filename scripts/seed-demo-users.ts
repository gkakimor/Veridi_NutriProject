import { PrismaClient, type UserRole } from "@prisma/client";
import { hashPassword } from "../apps/api/src/lib/password.js";

/**
 * `pnpm users:demo` — cria um usuário por perfil, todos com a MESMA senha.
 *
 * Existe para avaliação: entrar como Produção, como Qualidade, como Compras
 * sem inventar seis senhas. Não substitui `user:bootstrap-admin`, que é o
 * caminho de um administrador real.
 *
 * A senha vem de `VERIDI_DEMO_PASSWORD` e NUNCA é impressa nem versionada —
 * conta conhecida com senha conhecida no repositório seria porta aberta.
 * Em produção exige `VERIDI_ALLOW_DEMO_USERS=true`, para que ninguém
 * popule contas de teste sem querer num ambiente que atende gente.
 *
 *   $env:VERIDI_DEMO_PASSWORD = "..."
 *   $env:VERIDI_ALLOW_DEMO_USERS = "true"
 *   pnpm users:demo
 *
 * Os e-mails usam o domínio `@veridi.demo`, que não existe de propósito:
 * são fáceis de listar e apagar quando a avaliação terminar.
 */

const prisma = new PrismaClient();

const DEMO_DOMAIN = "veridi.demo";

const DEMO_USERS: { local: string; name: string; role: UserRole }[] = [
  { local: "admin", name: "Admin (demo)", role: "ADMIN" },
  { local: "producao", name: "Produção (demo)", role: "PRODUCTION" },
  { local: "qualidade", name: "Qualidade (demo)", role: "QUALITY" },
  { local: "compras", name: "Compras (demo)", role: "PURCHASING" },
  { local: "comercial", name: "Comercial (demo)", role: "COMMERCIAL" },
  { local: "consulta", name: "Consulta (demo)", role: "VIEWER" },
];

async function main(): Promise<void> {
  const password = process.env["VERIDI_DEMO_PASSWORD"];

  if (!password) {
    console.error(
      "Defina VERIDI_DEMO_PASSWORD — não existe senha padrão neste repositório.",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("A senha deve ter ao menos 8 caracteres.");
    process.exit(1);
  }
  if (
    process.env["NODE_ENV"] === "production" &&
    process.env["VERIDI_ALLOW_DEMO_USERS"] !== "true"
  ) {
    console.error(
      "Ambiente de produção: exige VERIDI_ALLOW_DEMO_USERS=true para criar contas de avaliação.",
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const created: string[] = [];

  for (const demo of DEMO_USERS) {
    const email = `${demo.local}@${DEMO_DOMAIN}`;
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: demo.name, role: demo.role, active: true, passwordHash },
      });
      created.push(`${existing.code}  ${email.padEnd(24)} ${demo.role}  (atualizado)`);
      continue;
    }

    const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
      "SELECT nextval('user_code_seq') AS nextval",
    );
    const code = `USR-${(rows[0]?.nextval ?? 1n).toString().padStart(6, "0")}`;

    const user = await prisma.user.create({
      data: { code, name: demo.name, email, passwordHash, role: demo.role },
    });
    created.push(`${user.code}  ${email.padEnd(24)} ${demo.role}`);
  }

  console.log(`\n${created.length} usuários de avaliação prontos (senha única, não exibida):\n`);
  for (const line of created) console.log(`  ${line}`);
  console.log(
    "\nSão contas temporárias. Antes de uso real: criar usuários nominais em" +
      "\nAdministração → Usuários e desativar estas.\n",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
