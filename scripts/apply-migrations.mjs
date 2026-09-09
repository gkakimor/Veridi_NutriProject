import { execFileSync } from "node:child_process";
import { exigirBancoLocal } from "./local-db-guard.mjs";
import { API, PRISMA_BIN } from "./prisma-bin.mjs";

/**
 * APLICAR as migrations que ja existem no banco LOCAL — e so isso.
 *
 *   pnpm db:migrate
 *
 * Ate o MIG-ORDER-01 este comando era `prisma migrate dev`, que APLICA e
 * tambem CRIA: bastava `--name` (ou uma alteracao pendente em
 * `schema.prisma`) para ele gerar uma pasta carimbada com o relogio real —
 * que ordena ANTES da ponta da cadeia e quebra a reconstrucao de um banco
 * vazio. A porta ficou aberta mesmo depois de `pnpm migration:create` existir,
 * porque a barreira era documental.
 *
 * Aqui ela e tecnica. `prisma migrate deploy` NAO tem a opcao `--name` e nao
 * possui caminho de criacao: aplica o que esta pendente, em ordem de nome, e
 * para. Nao abre prompt, nao usa shadow database, nao reseta, nao roda seed e
 * nao reescreve o historico de migrations.
 *
 * A separacao final e:
 *
 *   CRIAR    pnpm migration:create <nome>
 *   APLICAR  pnpm db:migrate
 *   PROVAR   pnpm validate:migrations:fresh
 *
 * LOCAL SOMENTE. A `DATABASE_URL` passa pelo mesmo `local-db-guard.mjs` do
 * `validate:migrations:fresh` — nunca Railway, nunca producao. Producao
 * continua sendo `pnpm deploy:prod`, um comando separado e consciente.
 */

/** Argumento nenhum e aceito: este comando nao tem o que parametrizar. */
function recusarArgumentos(args) {
  if (args.length === 0) return;

  const criacao = args.find((a) => a === "--name" || a === "-n" || a.startsWith("--name="));
  if (criacao) {
    throw new Error(
      `RECUSADO: "${criacao}" e argumento de CRIACAO de migration, e este comando so APLICA.\n` +
        `Para criar:  pnpm migration:create <nome_em_snake_case>\n` +
        `Nenhuma migration foi criada e nada foi aplicado.`,
    );
  }
  throw new Error(
    `RECUSADO: argumento inesperado (${args.join(" ")}). \`pnpm db:migrate\` nao recebe opcoes.\n` +
      `Para criar migration:  pnpm migration:create <nome_em_snake_case>\n` +
      `Nada foi aplicado.`,
  );
}

function prisma(args, databaseUrl) {
  return execFileSync(process.execPath, [PRISMA_BIN, ...args], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    // Sem TTY: o Prisma falha em vez de abrir prompt.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  recusarArgumentos(process.argv.slice(2));

  const { url, alvo } = exigirBancoLocal();
  console.log(`banco local: ${alvo}`);

  console.log("— prisma migrate deploy (aplica o pendente; nunca cria)");
  let saida;
  try {
    saida = prisma(["migrate", "deploy"], url);
  } catch (erro) {
    const detalhe = [erro.stdout, erro.stderr].filter(Boolean).join("\n").trim();
    console.error(`\nFALHOU ao aplicar.\n${detalhe || erro.message}`);
    process.exitCode = 1;
    return;
  }
  for (const linha of saida.split("\n")) {
    if (/migrations found|No pending migrations|migrations have been successfully|^\s*└─ \d{14}_/.test(linha)) {
      console.log(`  ${linha.trim()}`);
    }
  }

  /*
   * O banco agora tem TODAS as migrations. Se ele ainda nao for o
   * `schema.prisma`, a diferenca so pode ser edicao de modelo sem migration
   * correspondente — exatamente o caso que o `migrate dev` antigo resolvia
   * criando uma pasta por conta propria. Aqui ele e AVISADO, nunca criado.
   *
   * Mesmo `migrate diff` do `validate:migrations:fresh`: banco vivo x modelo.
   * Nao usa shadow database.
   */
  let pendenteNoModelo = [];
  try {
    const diff = prisma(
      [
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.prisma",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--script",
      ],
      url,
    );
    pendenteNoModelo = diff
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
  } catch {
    // O aviso e cortesia; falhar o diff nunca reprova uma aplicacao que deu
    // certo. O portao de verdade continua sendo validate:migrations:fresh.
    pendenteNoModelo = [];
  }

  if (pendenteNoModelo.length > 0) {
    console.log("");
    console.log(`AVISO: o schema.prisma tem ${pendenteNoModelo.length} mudanca(s) sem migration.`);
    console.log("Este comando NAO cria migration — ele so aplica o que ja existe.");
    console.log("  pnpm migration:create <nome_em_snake_case>   escreve a migration");
    console.log("  pnpm db:migrate                              aplica depois");
    return;
  }

  /*
   * `migrate dev` regenerava o client ao final; `migrate deploy` nao. Rodar
   * aqui mantem o fluxo igual ao de antes. Falha nao reprova a aplicacao: no
   * Windows o `prisma generate` bate EPERM na DLL quando a API de
   * desenvolvimento esta no ar, e a migration ja foi aplicada de qualquer
   * forma.
   */
  try {
    prisma(["generate"], url);
    console.log("  prisma client regenerado");
  } catch {
    console.log("  AVISO: nao regenerou o Prisma Client (rode `pnpm db:generate`).");
  }

  console.log("\nok  banco local em dia com as migrations do repositorio.");
}

try {
  main();
} catch (erro) {
  // Guarda de banco e argumento recusado chegam aqui ANTES de qualquer
  // efeito: a mensagem basta, a pilha do Node so atrapalha.
  console.error(erro.message);
  process.exitCode = 1;
}
