import { execFileSync } from "node:child_process";
import { readdirSync, renameSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exigirBancoLocal } from "./local-db-guard.mjs";
import {
  PADRAO_PASTA,
  maiorPrefixo,
  partesDaPasta,
  resolverRenomeacao,
  sanitizarNome,
} from "./migration-prefix.mjs";

/**
 * O CAMINHO OFICIAL para criar migration neste repositorio.
 *
 *   pnpm migration:create <nome_em_snake_case>
 *
 * Nunca chamar `prisma migrate dev --name ...` direto: o relogio real esta
 * ATRAS da ponta da cadeia (setembro de 2026 num dia anterior ao maior
 * prefixo), entao o carimbo do Prisma ordena ANTES de migrations das quais a
 * nova depende, e a reconstrucao de um banco vazio quebra. O porque completo
 * esta em `scripts/migration-prefix.mjs` e em `docs/TECH_BASELINE.md`.
 *
 * O que este script faz, nesta ordem:
 *
 *   1. valida o nome ANTES de tocar em qualquer coisa;
 *   2. exige banco LOCAL (`local-db-guard.mjs`) — nunca Railway, nunca PROD;
 *   3. chama `prisma migrate dev --create-only`, que ESCREVE a migration mas
 *      NAO a aplica;
 *   4. renumera a pasta gerada para o menor prefixo valido depois da ponta,
 *      quando o carimbo do Prisma nao for monotonico;
 *   5. confere que a migration ficou mesmo na ponta lexicografica.
 *
 * O que ele NAO faz, de proposito: nao aplica, nao roda `migrate deploy`, nao
 * faz deploy, nao apaga banco e nao renomeia nenhuma migration historica.
 * Aplicar continua sendo `pnpm db:migrate`, um comando separado e consciente.
 */

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = path.join(RAIZ, "apps", "api");
const MIGRATIONS = path.join(API, "prisma", "migrations");

/*
 * O CLI do Prisma chamado direto pelo Node, e nao por `pnpm exec` num shell.
 * `pnpm` no Windows e um `.cmd`, o que obrigaria `shell: true` — e com shell
 * os argumentos sao concatenados em vez de escapados (DEP0190). Resolvendo o
 * `build/index.js` do proprio workspace da API nao existe shell no caminho, e
 * o binario e o MESMO que `pnpm exec prisma` usaria.
 */
const requireFromApi = createRequire(path.join(API, "package.json"));
const PRISMA_BIN = path.join(
  path.dirname(requireFromApi.resolve("prisma/package.json")),
  "build",
  "index.js",
);

const USO = "uso: pnpm migration:create <nome_em_snake_case>";

/** Pastas de migration presentes agora (so diretorios, so a convencao). */
function pastasAtuais() {
  return readdirSync(MIGRATIONS).filter(
    (nome) => PADRAO_PASTA.test(nome) && statSync(path.join(MIGRATIONS, nome)).isDirectory(),
  );
}

function main() {
  const bruto = process.argv[2];
  if (!bruto || bruto.startsWith("-")) {
    console.error(USO);
    process.exitCode = 1;
    return;
  }

  // Nome invalido reprova ANTES do Prisma: o objetivo e nunca deixar pasta
  // pela metade no historico.
  const nome = sanitizarNome(bruto);
  if (nome !== bruto) console.log(`nome normalizado: ${bruto} -> ${nome}`);

  const { alvo } = exigirBancoLocal();
  console.log(`banco local: ${alvo}`);

  const antes = pastasAtuais();
  const ponta = maiorPrefixo(antes);
  console.log(`ponta atual: ${ponta ?? "(repositorio sem migration)"}`);

  console.log("— prisma migrate dev --create-only (escreve, NAO aplica)");
  let saida;
  try {
    saida = execFileSync(
      process.execPath,
      [PRISMA_BIN, "migrate", "dev", "--create-only", "--skip-seed", "--name", nome],
      {
        cwd: API,
        encoding: "utf8",
        // Sem TTY: o Prisma falha em vez de abrir prompt, e o script nunca
        // trava esperando resposta que ninguem vai dar.
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (erro) {
    const detalhe = [erro.stdout, erro.stderr].filter(Boolean).join("\n").trim();
    console.error(`\nFALHOU: o Prisma nao criou a migration.\n${detalhe || erro.message}`);
    console.error("\nNada foi renomeado. Resolva o motivo acima e rode de novo.");
    process.exitCode = 1;
    return;
  }

  const novas = pastasAtuais().filter((pasta) => !antes.includes(pasta));

  if (novas.length === 0) {
    // Caminho legitimo: `schema.prisma` igual ao banco. Nao e erro.
    console.log("\nnenhuma migration criada — o schema.prisma nao tem mudanca pendente.");
    console.log(saida.trim().split("\n").slice(-3).join("\n"));
    return;
  }
  if (novas.length > 1) {
    console.error(
      `\nFALHOU: o Prisma criou mais de uma pasta (${novas.join(", ")}).\n` +
        "Nada foi renomeado — resolva a mao antes de continuar.",
    );
    process.exitCode = 1;
    return;
  }

  const gerada = novas[0];
  const decisao = resolverRenomeacao(gerada, antes);

  if (decisao.acao === "manter") {
    console.log(`\ncarimbo do Prisma ja e monotonico: ${gerada}`);
  } else {
    // Rename atomico no mesmo sistema de arquivos: ou a pasta tem o nome
    // novo, ou tem o antigo. Nunca um estado intermediario.
    renameSync(path.join(MIGRATIONS, decisao.de), path.join(MIGRATIONS, decisao.para));
    console.log(`\nrenumerada: ${decisao.de}`);
    console.log(`        ->  ${decisao.para}`);
    console.log(`   (o carimbo real ordenava antes de ${decisao.ponta})`);
  }

  // Conferencia final: a migration nova E a ponta da cadeia.
  const depois = pastasAtuais();
  const pontaFinal = maiorPrefixo(depois);
  const esperado = partesDaPasta(decisao.para).prefixo;
  if (pontaFinal !== esperado) {
    console.error(
      `\nFALHOU: a migration nova nao ficou na ponta (ponta=${pontaFinal}, nova=${esperado}).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nok  ${decisao.para} e a ponta da cadeia.`);
  console.log("");
  console.log("A migration foi ESCRITA mas NAO aplicada. Revise o SQL e depois:");
  console.log("  pnpm db:migrate                  aplica no banco local");
  console.log("  pnpm test                        inclui a checagem estatica de ordem");
  console.log("  pnpm validate:migrations:fresh   prova a cadeia em banco vazio");
}

try {
  main();
} catch (erro) {
  // Guarda de banco e nome invalido chegam aqui ANTES de qualquer efeito
  // colateral: a mensagem basta, a pilha do Node so atrapalha.
  console.error(erro.message);
  process.exitCode = 1;
}
