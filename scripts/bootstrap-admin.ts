import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../apps/api/src/lib/password.js";

/**
 * `pnpm user:bootstrap-admin` — cria o primeiro usuário ADMIN.
 *
 * Sem isso o banco fica sem ninguém capaz de entrar. Credenciais vêm de
 * variáveis de ambiente ou argumentos; NENHUMA senha padrão existe no
 * repositório, e a senha nunca é impressa.
 *
 *   VERIDI_ADMIN_NAME="..." VERIDI_ADMIN_EMAIL="..." VERIDI_ADMIN_PASSWORD="..." \
 *     pnpm user:bootstrap-admin
 */

const prisma = new PrismaClient();

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const name = readArg("--name") ?? process.env["VERIDI_ADMIN_NAME"];
  const email = (readArg("--email") ?? process.env["VERIDI_ADMIN_EMAIL"])?.trim().toLowerCase();
  const password = readArg("--password") ?? process.env["VERIDI_ADMIN_PASSWORD"];

  if (!name || !email || !password) {
    console.error(
      "Informe nome, e-mail e senha (VERIDI_ADMIN_NAME / VERIDI_ADMIN_EMAIL / VERIDI_ADMIN_PASSWORD).",
    );
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("A senha deve ter ao menos 10 caracteres.");
    process.exit(1);
  }

  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (existingAdmin && process.env["NODE_ENV"] === "production") {
    // Em produção o bootstrap é uma porta de entrada: só pode ser usada
    // quando ainda não existe administrador.
    console.error(
      `Já existe um ADMIN ativo (${existingAdmin.code}). Crie novos usuários pela tela de Usuários.`,
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { name, role: "ADMIN", active: true, passwordHash: await hashPassword(password) },
    });
    console.log(`ADMIN atualizado: ${existing.code} (${email}).`);
    return;
  }

  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    "SELECT nextval('user_code_seq') AS nextval",
  );
  const code = `USR-${(rows[0]?.nextval ?? 1n).toString().padStart(6, "0")}`;

  const user = await prisma.user.create({
    data: { code, name, email, passwordHash: await hashPassword(password), role: "ADMIN" },
  });
  console.log(`ADMIN criado: ${user.code} (${email}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
