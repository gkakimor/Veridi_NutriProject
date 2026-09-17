import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ALVOS,
  CASCADES_EM_CICLO_DOCUMENTADAS,
  CONTADORES,
  PRESERVAR,
  TABELAS_SEM_MODEL,
  calcularOrdem,
  cascatasDocumentadasAusentes,
  conferirClassificacao,
  conferirTabelas,
  propDoModel,
  removerNaOrdem,
} from "./prod-cleanup-models.mjs";
import { SEQUENCES_DE_NEGOCIO, SEQUENCES_PRESERVADAS, conferirSequences } from "./prod-cleanup-sequences.mjs";
import { SQL_CONFERIR_SOMENTE_LEITURA, urlSomenteLeitura } from "./prod-cleanup-somente-leitura.mjs";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient, Prisma } = require("@prisma/client");

/**
 * Limpeza dos DADOS DE NEGÓCIO do banco de produção.
 *
 *   dry-run:  railway run -s Postgres -- node scripts/maintenance/prod-cleanup.mjs \
 *               [--reset-sequences] [--plano=<arquivo>]
 *   aplicar:  railway run -s Postgres -- node scripts/maintenance/prod-cleanup.mjs --apply \
 *               --confirmar-projeto=<RAILWAY_PROJECT_ID> --backup=<backup.json> \
 *               [--reset-sequences] [--plano=<arquivo>]
 *
 * O `--` entre o serviço e o `node` é obrigatório nesta versão do CLI: sem ele
 * a resposta é "Failed to fetch: error decoding response body".
 *
 * Regras não negociáveis:
 *  - Preserva as contas de login (User), as sessões (UserSession), as
 *    preferências de tela (UserPreference), o catálogo de unidades de medida
 *    (UnitOfMeasure, dado de referência) e o calendário produtivo
 *    (ProductionCalendar e as jornadas e exceções dele, configuração do
 *    ambiente).
 *  - Sequence só é reiniciada com `--reset-sequences`. Sem a flag a numeração
 *    continua de onde parou: sequence avançada não é sujeira. Reiniciar é
 *    decisão do PO para uma rodada ("zerar keys", FAST-DEVELOPMENT-RESET-02),
 *    e só é segura porque as tabelas que usam aqueles códigos ficam vazias na
 *    MESMA transação.
 *  - `user_code_seq` nunca é reiniciada: os usuários ficam, e o próximo USR-
 *    colidiria com um existente.
 *  - Sem `--apply`, a sessão é SOMENTE LEITURA (`default_transaction_read_only`,
 *    conferido antes de qualquer leitura): o banco recusa toda escrita do
 *    dry-run, inclusive `ALTER SEQUENCE`.
 *  - Aborta, até em dry-run, antes de contar qualquer tabela, se a
 *    classificação não cobre o banco: model sem lista, em duas listas,
 *    repetido ou sem model; tabela do `public` sem model ou model sem tabela;
 *    relação ou sequence fora do `public`; sequence sem lista, nas duas,
 *    repetida ou fantasma (classificada e ausente do banco — renomeada ou
 *    apagada); coluna serial/identity/`nextval`; sequence presa a coluna;
 *    trigger ou rule de usuário. Tabela órfã é decisão de gente, não do
 *    script. As listas moram em `prod-cleanup-models.mjs` e
 *    `prod-cleanup-sequences.mjs`, e a suíte de scripts reprova o model do
 *    schema e a sequence de migration que ficarem fora delas.
 *  - Aborta se uma tabela preservada apontar para uma tabela a esvaziar: o
 *    DELETE travaria no meio, ou levaria a linha preservada junto.
 *  - A ordem de remoção vem das FKs reais. CASCADE que fecha ciclo com
 *    RESTRICT/NO ACTION não ordena: o pai sai antes e leva o filho, e a
 *    remoção conta o que o CASCADE levou. Só vale para o CASCADE listado em
 *    `CASCADES_EM_CICLO_DOCUMENTADAS`: CASCADE em ciclo fora da lista, item da
 *    lista ausente do banco e ciclo só de RESTRICT/NO ACTION abortam.
 *  - Limpa o BANCO, não o object storage. A linha de `ItemLabelFileVersion` e
 *    a de `Attachment` saem; o objeto no R2 (ou no disco local) e o arquivo no
 *    volume ficam. Apagar objeto de storage é outra responsabilidade.
 *  - `--apply` exige ambiente `production` e `--confirmar-projeto` igual ao
 *    RAILWAY_PROJECT_ID que o CLI injeta: o banco é provado pelo Railway, não
 *    pelo nome de uma variável local.
 *  - `--apply` exige `--backup=<arquivo>` de `prod-backup-json.mjs` com a
 *    MESMA contagem de cada tabela a esvaziar. Linha nascida depois do backup
 *    seria apagada sem cópia — backup desatualizado recusa a limpeza.
 */

const APLICAR = process.argv.includes("--apply");
const RESETAR_SEQUENCES = process.argv.includes("--reset-sequences");
const valorDe = (flag) => process.argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
const ARQUIVO_PLANO = valorDe("--plano");
const PROJETO_CONFIRMADO = valorDe("--confirmar-projeto");
const ARQUIVO_BACKUP = valorDe("--backup");

const urlDoAmbiente = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!urlDoAmbiente) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const url = APLICAR ? urlDoAmbiente : urlSomenteLeitura(urlDoAmbiente);
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** O que esta execução esvazia e o que ela mantém. */
const ESVAZIAR = RESETAR_SEQUENCES ? [...ALVOS, ...CONTADORES] : ALVOS;
const MANTER = RESETAR_SEQUENCES ? PRESERVAR : [...PRESERVAR, ...CONTADORES];

/** Nome do model -> nome real da tabela (@@map). */
const tabelaDoModel = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name]),
);
const modelDaTabela = new Map([...tabelaDoModel].map(([m, t]) => [t, m]));

/** Host sem credencial e sem porta: o bastante para reconhecer, pouco para conectar. */
function mascararDestino(bruta) {
  try {
    const u = new URL(bruta);
    const [primeiro, ...resto] = u.hostname.split(".");
    const oculto = `${primeiro.slice(0, 1)}${"*".repeat(Math.max(primeiro.length - 1, 3))}`;
    return `${[oculto, ...resto].join(".")}:*****/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "<URL ilegível>";
  }
}

/** Erro de driver pode carregar a URL com senha. Nada disso é impresso. */
const semCredencial = (texto) => String(texto).replace(/postgres(ql)?:\/\/\S*/gi, "<conexão omitida>");

/** Todas as FKs do schema public, lidas do `pg_constraint`. */
function lerFks() {
  return prisma.$queryRawUnsafe(`
    SELECT src.relname AS src, tgt.relname AS tgt, c.conname AS nome, c.confdeltype AS acao
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `);
}

/** Pastas de migration do repositório — o que o client local sabe descrever. */
const migrationsLocais = () =>
  readdirSync(new URL("../../apps/api/prisma/migrations/", import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();

/** Quem é este banco, pelo que o Railway injeta e pelo que o próprio banco diz. */
async function identificar() {
  const [info] = await prisma.$queryRawUnsafe(
    `SELECT current_database() AS banco, current_setting('server_version') AS versao`,
  );
  const linhas = await prisma.$queryRawUnsafe(`
    SELECT migration_name AS nome,
           (finished_at IS NOT NULL AND rolled_back_at IS NULL) AS aplicada
    FROM "_prisma_migrations"
  `);
  const aplicadas = new Set(linhas.filter((l) => l.aplicada).map((l) => l.nome));
  const locais = migrationsLocais();
  /*
   * Faltar migration no banco quer dizer que o client deste repositório
   * descreve tabela que lá não existe (ou existe diferente): contar e apagar
   * com ele seria adivinhação. Sobrar no banco é histórico — linha de uma
   * pasta renomeada, por exemplo — e só é reportado.
   */
  const migrations = {
    total: linhas.length,
    aplicadas: linhas.filter((l) => l.aplicada).length,
    nomesAplicados: aplicadas.size,
    locais: locais.length,
    faltamNoBanco: locais.filter((n) => !aplicadas.has(n)),
    soNoBanco: [...new Set(linhas.map((l) => l.nome))].filter((n) => !locais.includes(n)).sort(),
    ultima: [...aplicadas].sort().at(-1) ?? null,
  };
  return {
    projeto: process.env.RAILWAY_PROJECT_NAME ?? null,
    projetoId: process.env.RAILWAY_PROJECT_ID ?? null,
    ambiente: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    servico: process.env.RAILWAY_SERVICE_NAME ?? null,
    destino: mascararDestino(url),
    banco: info.banco,
    versao: info.versao,
    migrations,
  };
}

/** Identidade dos usuários — nunca hash de senha. */
const lerUsuarios = () =>
  prisma.user.findMany({
    select: { id: true, code: true, email: true, role: true, active: true },
    orderBy: { code: "asc" },
  });

/**
 * Sequences de TODOS os schemas — a de fora do `public` aborta.
 * `ultimo` nulo = a sequence ainda não entregou valor: o próximo é o início.
 */
const lerSequences = () =>
  prisma.$queryRawUnsafe(
    `SELECT schemaname AS schema, sequencename AS nome, last_value::text AS ultimo
     FROM pg_sequences ORDER BY schemaname, sequencename`,
  );

/** Colunas que se numeram sozinhas (serial/identity/`nextval`). Nenhuma é esperada. */
const lerColunasNumeradas = () =>
  prisma.$queryRawUnsafe(`
    SELECT table_name AS tabela, column_name AS coluna
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (is_identity = 'YES' OR column_default LIKE '%nextval(%')
    ORDER BY table_name, column_name
  `);

/** Sequence presa a coluna: serial e `OWNED BY` (dependência `a`), identity (`i`). */
const lerSequencesComDono = () =>
  prisma.$queryRawUnsafe(`
    SELECT s.relname AS nome, t.relname AS tabela
    FROM pg_depend d
    JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
    ORDER BY s.relname
  `);

/** Tabelas comuns e particionadas do `public`. */
const lerTabelas = () =>
  prisma.$queryRawUnsafe(`
    SELECT c.relname AS nome
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);

/** Tabela, view ou tabela externa em schema de usuário que não é o `public`. */
const lerForaDoPublic = () =>
  prisma.$queryRawUnsafe(`
    SELECT n.nspname AS schema, c.relname AS nome
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
    ORDER BY n.nspname, c.relname
  `);

/** Trigger criado por gente (as FKs viram trigger interno, que não conta). */
const lerGatilhos = () =>
  prisma.$queryRawUnsafe(`
    SELECT c.relname AS tabela, t.tgname AS nome
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
    ORDER BY c.relname, t.tgname
  `);

/** Rule de usuário (`_RETURN` é a de toda view). */
const lerRegras = () =>
  prisma.$queryRawUnsafe(`
    SELECT c.relname AS tabela, r.rulename AS nome
    FROM pg_rewrite r
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rulename <> '_RETURN' AND n.nspname = 'public'
    ORDER BY c.relname, r.rulename
  `);

/** Lança com todos os defeitos de uma conferência, ou não faz nada. */
function abortarSeDefeito(titulo, conferencia) {
  const defeitos = Object.entries(conferencia).filter(([, lista]) => lista.length);
  if (defeitos.length) {
    throw new Error(
      `${titulo}: ${defeitos.map(([defeito, lista]) => `${defeito}: ${lista.join(", ")}`).join(" · ")}`,
    );
  }
}

const NOME_ACAO = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

async function main() {
  console.log(APLICAR ? "=== MODO: APLICAR (DESTRUTIVO) ===" : "=== MODO: DRY RUN ===");
  console.log(
    RESETAR_SEQUENCES
      ? "Sequences: REINICIAR as de negócio (--reset-sequences)"
      : "Sequences: preservadas (sem --reset-sequences)",
  );

  if (!APLICAR) {
    const [sessao] = await prisma.$queryRawUnsafe(SQL_CONFERIR_SOMENTE_LEITURA);
    if (sessao?.somenteLeitura !== "on") {
      throw new Error("Dry-run recusado: a sessão não ficou somente leitura (default_transaction_read_only).");
    }
    console.log("Sessão: SOMENTE LEITURA (default_transaction_read_only=on) — o banco recusa qualquer escrita.");
  }

  abortarSeDefeito(
    "Classificação de models com defeito (não apago às cegas)",
    conferirClassificacao(Prisma.dmmf.datamodel.models.map((m) => m.name)),
  );
  console.log(
    `Cobertura: todos os ${Prisma.dmmf.datamodel.models.length} models classificados ` +
      `(${ALVOS.length} alvos, ${PRESERVAR.length} preservados, ${CONTADORES.length} contador).`,
  );

  // ---- Identificação ----
  const id = await identificar();
  if (APLICAR) {
    if (id.ambiente !== "production") {
      throw new Error(`--apply recusado: ambiente Railway "${id.ambiente}" não é production.`);
    }
    if (!PROJETO_CONFIRMADO || PROJETO_CONFIRMADO !== id.projetoId) {
      throw new Error("--apply recusado: --confirmar-projeto ausente ou diferente do RAILWAY_PROJECT_ID injetado.");
    }
    if (id.migrations.faltamNoBanco.length) {
      throw new Error(
        `--apply recusado: o banco não tem migrations do repositório (${id.migrations.faltamNoBanco.join(", ")}).`,
      );
    }
  }

  // ---- Sequences ----
  const sequences = await lerSequences();
  const colunasNumeradas = await lerColunasNumeradas();
  const sequencesComDono = await lerSequencesComDono();
  abortarSeDefeito(
    "Sequences com classificação insegura (não reinicio às cegas)",
    conferirSequences({
      sequences,
      colunasNumeradas: colunasNumeradas.map((c) => `${c.tabela}.${c.coluna}`),
      sequencesComDono: sequencesComDono.map((s) => `${s.nome} (${s.tabela})`),
    }),
  );
  // Sem fantasma: toda sequence de negócio existe no banco.
  const aReiniciar = RESETAR_SEQUENCES ? SEQUENCES_DE_NEGOCIO : [];

  // ---- Tabelas: nada no banco fora da classificação ----
  const tabelas = await lerTabelas();
  const foraDoPublic = await lerForaDoPublic();
  const gatilhos = await lerGatilhos();
  const regras = await lerRegras();
  abortarSeDefeito(
    "Banco com o que a classificação não cobre (não apago às cegas)",
    conferirTabelas({
      tabelas: tabelas.map((t) => t.nome),
      tabelaDoModel,
      foraDoPublic: foraDoPublic.map((r) => `${r.schema}.${r.nome}`),
      gatilhos: gatilhos.map((g) => `${g.tabela}.${g.nome}`),
      regras: regras.map((r) => `${r.tabela}.${r.nome}`),
    }),
  );

  // ---- FKs ----
  const fks = await lerFks();
  const alvoTabelas = new Set(ESVAZIAR.map((m) => tabelaDoModel.get(m)));
  const manterTabelas = new Set(MANTER.map((m) => tabelaDoModel.get(m)));
  const perigosas = fks.filter((f) => manterTabelas.has(f.src) && alvoTabelas.has(f.tgt));
  if (perigosas.length) {
    throw new Error(
      `Tabela preservada aponta para tabela a esvaziar: ${perigosas
        .map((f) => `${f.src}.${f.nome} -> ${f.tgt}`)
        .join(", ")}`,
    );
  }
  const { ordem, cascatasEmCiclo } = calcularOrdem(fks, alvoTabelas);
  const documentadasAusentes = cascatasDocumentadasAusentes(cascatasEmCiclo);
  if (documentadasAusentes.length) {
    throw new Error(
      `CASCADE documentado que o banco não tem em ciclo (documentação velha ou banco diferente): ${documentadasAusentes
        .map((d) => `${d.filha}.${d.nome} -> ${d.pai}`)
        .join(", ")}`,
    );
  }
  const ORDEM_REMOCAO = ordem.map((t) => modelDaTabela.get(t));
  /** Model pai -> models filhos que o CASCADE em ciclo leva junto com ele. */
  const levaJunto = new Map();
  for (const fk of cascatasEmCiclo) {
    const pai = modelDaTabela.get(fk.tgt);
    levaJunto.set(pai, new Set([...(levaJunto.get(pai) ?? []), modelDaTabela.get(fk.src)]));
  }
  const levadoPor = (filho) =>
    [...levaJunto]
      .filter(([, filhos]) => filhos.has(filho))
      .map(([pai]) => pai)
      .join(", ");
  const internas = fks.filter((f) => alvoTabelas.has(f.src) && alvoTabelas.has(f.tgt));
  const porAcao = {};
  for (const f of internas) porAcao[NOME_ACAO[f.acao] ?? f.acao] = (porAcao[NOME_ACAO[f.acao] ?? f.acao] ?? 0) + 1;
  const paraPreservadas = fks.filter((f) => alvoTabelas.has(f.src) && manterTabelas.has(f.tgt));
  const anulaEntreAlvos = internas.filter((f) => f.acao === "n" || f.acao === "d");

  // ---- Contagens ----
  const plano = [];
  let totalPrevisto = 0;
  for (const model of ORDEM_REMOCAO) {
    const n = await prisma[propDoModel(model)].count();
    plano.push({ model, linhas: n });
    totalPrevisto += n;
  }
  const preservado = [];
  for (const model of MANTER) {
    preservado.push({ model, linhas: await prisma[propDoModel(model)].count() });
  }
  const usuariosAntes = await lerUsuarios();

  // ---- Backup cobre o que vai sair? ----
  let resumoBackup = "não conferido (dry-run sem --backup)";
  if (APLICAR || ARQUIVO_BACKUP) {
    if (!ARQUIVO_BACKUP) throw new Error("--apply recusado: informe --backup=<arquivo de prod-backup-json.mjs>.");
    const backup = JSON.parse(readFileSync(ARQUIVO_BACKUP, "utf8"));
    if (backup.mecanismo !== "prisma-logical-json" || !backup.contagens || backup.falhas?.length) {
      throw new Error("--backup não é um backup íntegro de prod-backup-json.mjs.");
    }
    const desatualizadas = plano.filter((p) => backup.contagens[p.model] !== p.linhas);
    if (desatualizadas.length) {
      throw new Error(
        `backup desatualizado — contagem mudou desde ${backup.geradoEm}: ${desatualizadas
          .map((p) => `${p.model} backup ${backup.contagens[p.model]} · agora ${p.linhas}`)
          .join(", ")}`,
      );
    }
    resumoBackup = `${ARQUIVO_BACKUP} (${backup.geradoEm}) cobre as ${plano.length} tabelas, contagem idêntica`;
  }
  const anexos = await prisma.attachment.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } });
  const rotulos = await prisma.itemLabelFileVersion.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } });

  // ---- Plano ----
  const L = [];
  L.push("PLANO DE LIMPEZA — banco de produção Veridi");
  L.push(`gerado em: ${new Date().toISOString()}`);
  L.push(`modo: ${APLICAR ? "APLICAR" : "dry-run"} · sequences: ${RESETAR_SEQUENCES ? "reiniciar" : "preservar"}`);
  L.push(`sessão: ${APLICAR ? "leitura e escrita (--apply)" : "SOMENTE LEITURA (default_transaction_read_only=on, conferida)"}`);
  L.push("");
  L.push("CONFERÊNCIAS (fail closed: qualquer defeito aborta antes de contar):");
  L.push(
    `  models            ${Prisma.dmmf.datamodel.models.length} no schema = ${ALVOS.length} alvos + ` +
      `${PRESERVAR.length} preservados + ${CONTADORES.length} contador; nenhum sem lista, em duas ou sem model`,
  );
  L.push(
    `  tabelas           ${tabelas.length} no public = ${tabelaDoModel.size} de model + ${
      tabelas.length - tabelaDoModel.size
    } do Prisma (${TABELAS_SEM_MODEL.join(", ")}); fora do public 0; triggers 0; rules 0`,
  );
  L.push(
    `  sequences         ${sequences.length} no banco = ${SEQUENCES_PRESERVADAS.length} preservada + ` +
      `${SEQUENCES_DE_NEGOCIO.length} de negócio; sem lista 0, nas duas 0, fantasma 0; serial/identity/nextval 0; com dono 0`,
  );
  L.push(
    `  CASCADE em ciclo  ${cascatasEmCiclo.length} no banco, ${CASCADES_EM_CICLO_DOCUMENTADAS.length} documentado(s); ` +
      "nenhum fora da lista, nenhum da lista ausente",
  );
  L.push("");
  L.push("IDENTIFICAÇÃO:");
  L.push(`  railway projeto   ${id.projeto} (${id.projetoId})`);
  L.push(`  railway ambiente  ${id.ambiente}`);
  L.push(`  railway serviço   ${id.servico}`);
  L.push(`  destino           ${id.destino}`);
  L.push(`  banco lógico      ${id.banco} · PostgreSQL ${id.versao}`);
  L.push(
    `  migrations        banco ${id.migrations.total} linha(s), ${id.migrations.aplicadas} aplicada(s), ` +
      `${id.migrations.nomesAplicados} nome(s) distinto(s) · repositório ${id.migrations.locais} · última ${id.migrations.ultima}`,
  );
  L.push(
    `                    faltam no banco: ${id.migrations.faltamNoBanco.join(", ") || "nenhuma"} · ` +
      `só no banco: ${id.migrations.soNoBanco.join(", ") || "nenhuma"}`,
  );
  L.push("");
  L.push(`USERS (${usuariosAntes.length}) — preservados, sem hash:`);
  for (const u of usuariosAntes) {
    L.push(`  ${u.code}  ${u.id}  ${u.email}  ${u.role}${u.active ? "" : "  (inativo)"}`);
  }
  L.push("");
  L.push("PRESERVAR:");
  for (const p of preservado) L.push(`  ${p.model.padEnd(38)} ${p.linhas}`);
  L.push("");
  L.push(`REMOVER (${ORDEM_REMOCAO.length} tabelas, na ordem das FKs reais):`);
  for (const [i, p] of plano.entries()) {
    const pais = levadoPor(p.model);
    L.push(
      `  ${String(i + 1).padStart(2, "0")}. ${p.model.padEnd(38)} ${p.linhas}${pais ? `  (sai pelo CASCADE de ${pais})` : ""}`,
    );
  }
  L.push("");
  L.push(`TOTAL A REMOVER: ${totalPrevisto} linhas`);
  L.push(`BACKUP: ${resumoBackup}`);
  L.push("");
  L.push("OBJECT STORAGE — fora desta ferramenta (ela limpa o BANCO, não apaga objeto):");
  L.push(
    `  ItemLabelFileVersion  ${rotulos._count._all} versão(ões), ${rotulos._sum.sizeBytes ?? 0} bytes — ` +
      "a linha sai do banco; o objeto no R2 (ou no disco local) NÃO é apagado",
  );
  L.push(
    `  Attachment            ${anexos._count._all} registro(s), ${anexos._sum.sizeBytes ?? 0} bytes — ` +
      "a linha sai do banco; o arquivo no volume da app NÃO é apagado",
  );
  L.push(
    "  Depois do --apply esses objetos ficam sem linha que os referencie. Limpar o storage é outra responsabilidade, com rodada própria.",
  );
  L.push("");
  L.push(`SEQUENCES (${sequences.length}):`);
  for (const s of sequences) {
    const acao = SEQUENCES_PRESERVADAS.includes(s.nome)
      ? "preservar (usuários)"
      : aReiniciar.includes(s.nome)
        ? "REINICIAR"
        : "preservar";
    L.push(`  ${s.nome.padEnd(40)} último ${String(s.ultimo ?? "—").padStart(8)}  ${acao}`);
  }
  L.push(
    `CONTADORES: ${CONTADORES.join(", ")} — ${RESETAR_SEQUENCES ? "esvaziado (numeração da OP recomeça)" : "preservado"}`,
  );
  L.push(
    `COLUNAS AUTO-NUMERADAS (serial/identity): ${
      colunasNumeradas.length ? colunasNumeradas.map((c) => `${c.tabela}.${c.coluna}`).join(", ") : "nenhuma"
    }`,
  );
  L.push("");
  L.push("FKs:");
  L.push(
    `  entre tabelas a esvaziar: ${internas.length} (${Object.entries(porAcao)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}) — ordem calculada, ${
      cascatasEmCiclo.length ? `${cascatasEmCiclo.length} CASCADE em ciclo` : "sem ciclo"
    }`,
  );
  for (const fk of cascatasEmCiclo) {
    const documentada = CASCADES_EM_CICLO_DOCUMENTADAS.find((d) => d.nome === fk.nome);
    L.push(
      `  CASCADE em ciclo, documentado, não ordena: ${fk.src}.${fk.nome} -> ${fk.tgt} — ` +
        `${modelDaTabela.get(fk.tgt)} sai antes e leva ${modelDaTabela.get(fk.src)} junto; a remoção conta o que o CASCADE levou`,
    );
    L.push(`    motivo: ${documentada.motivo}`);
  }
  L.push("  demais CASCADE entre tabelas a esvaziar: filha sai antes da pai — o CASCADE não acha linha e não apaga nada");
  L.push(
    `  SET NULL entre tabelas a esvaziar: ${anulaEntreAlvos.length} — se a pai sai antes, o banco anula a coluna ` +
      "de uma linha que sai depois, na mesma transação",
  );
  L.push(`  de tabela a esvaziar para preservada: ${paraPreservadas.length} (não travam: a preservada é a pai)`);
  L.push("  de tabela preservada para tabela a esvaziar: 0");
  L.push("");
  L.push(`NÃO TOCA: ${TABELAS_SEM_MODEL.join(", ")}, ${[...manterTabelas].join(", ")}.`);

  const texto = L.join("\n");
  console.log("\n" + texto);

  if (ARQUIVO_PLANO) {
    mkdirSync(dirname(ARQUIVO_PLANO), { recursive: true });
    writeFileSync(ARQUIVO_PLANO, texto + "\n", "utf8");
    console.log(`\nPlano salvo em: ${ARQUIVO_PLANO}`);
  }

  if (!APLICAR) {
    console.log("\nDry run. Nada foi apagado. Use --apply para executar.");
    return;
  }

  // ---- Execução ----
  console.log("\n=== EXECUTANDO (uma transação) ===");
  const removidos = await prisma.$transaction(
    async (tx) => {
      const resultado = await removerNaOrdem(tx, ORDEM_REMOCAO, levaJunto, (r) =>
        console.log(
          `  ${r.model.padEnd(38)} ${r.removidos}${r.peloCascade ? `  (${r.peloCascade} pelo CASCADE de ${levadoPor(r.model)})` : ""}`,
        ),
      );
      // ALTER SEQUENCE é transacional desde o PostgreSQL 10: se qualquer
      // DELETE acima falhar, a numeração volta junto. O nome vem da lista
      // explícita e conferida contra `pg_sequences` — nada de fora chega aqui.
      for (const nome of aReiniciar) {
        await tx.$executeRawUnsafe(`ALTER SEQUENCE "public"."${nome}" RESTART`);
        console.log(`  sequence ${nome.padEnd(38)} reiniciada`);
      }
      return resultado;
    },
    { timeout: 180000, maxWait: 60000 },
  );

  const total = removidos.reduce((a, r) => a + r.removidos, 0);
  console.log(`\nTOTAL REMOVIDO: ${total} linhas`);

  // ---- Conferência pós-limpeza ----
  console.log("\n=== CONFERÊNCIA ===");
  const problemas = [];
  for (const model of ORDEM_REMOCAO) {
    const n = await prisma[propDoModel(model)].count();
    if (n !== 0) problemas.push(`${model}: ainda tem ${n} linhas`);
  }
  console.log(
    problemas.length === 0 ? "  Todas as tabelas esvaziadas estão zeradas." : `  ${problemas.join("\n  ")}`,
  );

  for (const p of preservado) {
    const n = await prisma[propDoModel(p.model)].count();
    console.log(`  preservado ${p.model.padEnd(34)} antes ${p.linhas} · depois ${n}`);
    // Sessão nasce a cada login: variar não é defeito da limpeza.
    if (p.model !== "UserSession" && n !== p.linhas) problemas.push(`${p.model}: ${p.linhas} -> ${n}`);
  }

  const usuariosDepois = await lerUsuarios();
  const mesmosUsuarios =
    usuariosDepois.length === usuariosAntes.length &&
    usuariosAntes.every(
      (u, i) =>
        usuariosDepois[i].id === u.id &&
        usuariosDepois[i].code === u.code &&
        usuariosDepois[i].email === u.email,
    );
  console.log(`  Users preservados: ${mesmosUsuarios ? "YES" : "NO"} (${usuariosAntes.length} -> ${usuariosDepois.length})`);
  if (!mesmosUsuarios) problemas.push("Users: identidade mudou");

  const sequencesDepois = await lerSequences();
  for (const s of sequencesDepois) {
    const antes = sequences.find((x) => x.nome === s.nome);
    const reiniciada = aReiniciar.includes(s.nome);
    console.log(
      `  sequence ${s.nome.padEnd(40)} ${String(antes?.ultimo ?? "—").padStart(8)} -> ${String(s.ultimo ?? "—").padStart(8)}${reiniciada ? "  (próximo = início)" : ""}`,
    );
    if (reiniciada && s.ultimo !== null) problemas.push(`${s.nome} não reiniciou`);
    if (!reiniciada && s.ultimo !== antes?.ultimo) problemas.push(`${s.nome} mudou sem ter sido reiniciada`);
  }

  const idDepois = await identificar();
  if (idDepois.migrations.total !== id.migrations.total) {
    problemas.push(`_prisma_migrations: ${id.migrations.total} -> ${idDepois.migrations.total}`);
  }
  console.log(`  _prisma_migrations: ${idDepois.migrations.total} (intocada)`);

  console.log(problemas.length ? `\nCONFERÊNCIA: ${problemas.length} problema(s)` : "\nCONFERÊNCIA: OK");
  if (problemas.length) {
    for (const p of problemas) console.log(`  ! ${p}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("FALHOU:", semCredencial(e.message));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
