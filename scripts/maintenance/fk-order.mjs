import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");

/**
 * Chaves estrangeiras REAIS do banco e a ordem de remoção que elas impõem.
 * SOMENTE LEITURA — não escreve, não apaga, não altera nada.
 *
 *   railway run --service Postgres node scripts/maintenance/fk-order.mjs
 *   railway run --service Postgres node scripts/maintenance/fk-order.mjs --json
 *
 * Local, contra a base de desenvolvimento:
 *   pnpm exec dotenv -e .env -- node scripts/maintenance/fk-order.mjs
 *
 * POR QUE existe: o `schema.prisma` NÃO descreve as ações de delete que estão
 * no banco. Várias relações aparecem como opcionais lá — o que sugeriria
 * `ON DELETE SET NULL` —, mas a migration criou `ON DELETE RESTRICT`. A
 * primeira limpeza de produção morreu exatamente assim, em
 * `lots_productionOrderId_fkey`. Quem deriva ordem de remoção lendo o schema
 * tropeça de novo; quem lê `pg_constraint` acerta. Este script lê
 * `pg_constraint` e mostra as duas leituras lado a lado, para a armadilha
 * ficar visível antes de custar uma transação abortada.
 *
 * Sai com código 1 se houver ciclo de FK: nesse caso a ordem impressa está
 * incompleta e não serve para automatizar em cima.
 */

const JSON_PURO = process.argv.includes("--json");

/*
 * De fora do Railway a `DATABASE_URL` aponta para o host interno, que só
 * resolve dentro da rede deles; a pública é a que funciona daqui. Nenhuma das
 * duas passa pela linha de comando nem é impressa em lugar nenhum.
 */
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** O schema conferido é o ARQUIVO, não o client gerado — client pode estar velho. */
const CAMINHO_SCHEMA = new URL("../../apps/api/prisma/schema.prisma", import.meta.url);

/** `confdeltype`/`confupdtype` são um único caractere. Tradução literal. */
const ACAO = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

/** Nome da ação no Prisma -> mesma letra que o Postgres usa. */
const LETRA_DO_PRISMA = { NoAction: "a", Restrict: "r", Cascade: "c", SetNull: "n", SetDefault: "d" };

/**
 * Só estas ações impõem ordem de remoção.
 *
 * RESTRICT e NO ACTION travam o DELETE do pai de verdade. CASCADE não trava,
 * mas se o pai sair primeiro o banco leva as filhas junto e qualquer contagem
 * de "linhas removidas" vira mentira — por isso entra na ordem também.
 * SET NULL e SET DEFAULT apenas zeram a coluna: não ordenam nada.
 */
const ORDENAM = new Set(["r", "a", "c"]);

/** Erro de conexão pode carregar host/URL na mensagem. Nada disso é impresso. */
const semCredencial = (texto) => String(texto).replace(/postgres(ql)?:\/\/\S*/gi, "<conexão omitida>");

/**
 * Lê as relações declaradas no `schema.prisma`.
 *
 * Interessa só o lado que vira FK no banco — o que tem `fields:`. O lado
 * inverso (`Pedido[]`) não gera coluna nem constraint.
 */
function lerSchema(caminho) {
  const modelos = new Map();
  let atual = null;

  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const abre = linha.match(/^model\s+(\w+)\s*\{/);
    if (abre) {
      atual = { nome: abre[1], tabela: abre[1], relacoes: [] };
      modelos.set(atual.nome, atual);
      continue;
    }
    if (!atual) continue;
    if (/^\}/.test(linha)) {
      atual = null;
      continue;
    }

    // Sem `@@map` o nome da tabela é o do próprio model.
    const mapeado = linha.match(/@@map\("([^"]+)"\)/);
    if (mapeado) {
      atual.tabela = mapeado[1];
      continue;
    }

    const campo = linha.match(/^\s*(\w+)\s+(\w+)(\?)?\s+@relation\(([^)]*)\)/);
    if (!campo) continue;
    const [, nomeCampo, modeloPai, opcional, argumentos] = campo;
    const colunas = argumentos.match(/fields:\s*\[([^\]]*)\]/);
    if (!colunas) continue;

    atual.relacoes.push({
      campo: nomeCampo,
      modeloPai,
      opcional: Boolean(opcional),
      colunas: colunas[1].split(",").map((c) => c.trim()).filter(Boolean),
      onDelete: argumentos.match(/onDelete:\s*(\w+)/)?.[1] ?? null,
      onUpdate: argumentos.match(/onUpdate:\s*(\w+)/)?.[1] ?? null,
    });
  }

  return modelos;
}

/**
 * O que o schema SUGERE para `ON DELETE`, seguindo o padrão do Prisma:
 * relação opcional sem `onDelete:` explícito vira `SetNull`; obrigatória vira
 * `Restrict`. É essa sugestão — não o banco — que engana quem lê o schema.
 */
function acaoSugeridaPeloSchema(relacao) {
  if (relacao.onDelete) {
    return { letra: LETRA_DO_PRISMA[relacao.onDelete] ?? "?", nome: relacao.onDelete, explicita: true };
  }
  const nome = relacao.opcional ? "SetNull" : "Restrict";
  return { letra: LETRA_DO_PRISMA[nome], nome, explicita: false };
}

/**
 * Kahn sobre `filha -> pai`: sai primeiro quem ninguém referencia.
 * Desempate alfabético para a ordem ser idêntica em duas execuções — ordem de
 * limpeza que muda sozinha não dá para conferir em revisão.
 */
function ordenar(tabelas, arestas) {
  const libera = new Map([...tabelas].map((t) => [t, new Set()]));
  const pendentes = new Map([...tabelas].map((t) => [t, 0]));

  for (const { filha, pai } of arestas) {
    if (libera.get(filha).has(pai)) continue;
    libera.get(filha).add(pai);
    pendentes.set(pai, pendentes.get(pai) + 1);
  }

  const ordem = [];
  const prontos = [...tabelas].filter((t) => pendentes.get(t) === 0).sort();
  while (prontos.length) {
    const tabela = prontos.shift();
    ordem.push(tabela);
    for (const pai of [...libera.get(tabela)].sort()) {
      pendentes.set(pai, pendentes.get(pai) - 1);
      if (pendentes.get(pai) === 0) {
        prontos.push(pai);
        prontos.sort();
      }
    }
  }

  const ordenadas = new Set(ordem);
  return { ordem, presas: [...tabelas].filter((t) => !ordenadas.has(t)), libera };
}

/**
 * Componentes fortemente conexos (Tarjan) entre as tabelas que sobraram.
 *
 * Sem isso o relatório diria só "tem ciclo" e listaria dezenas de tabelas
 * presas — inclusive as que estão presas ATRÁS do ciclo, sem culpa nenhuma.
 * O componente aponta quais tabelas realmente se referenciam em anel.
 */
function acharCiclos(nos, libera) {
  const indice = new Map();
  const menor = new Map();
  const pilha = [];
  const naPilha = new Set();
  const componentes = [];
  let contador = 0;

  const visitar = (v) => {
    indice.set(v, contador);
    menor.set(v, contador);
    contador += 1;
    pilha.push(v);
    naPilha.add(v);

    for (const w of libera.get(v) ?? []) {
      if (!nos.has(w)) continue;
      if (!indice.has(w)) {
        visitar(w);
        menor.set(v, Math.min(menor.get(v), menor.get(w)));
      } else if (naPilha.has(w)) {
        menor.set(v, Math.min(menor.get(v), indice.get(w)));
      }
    }

    if (menor.get(v) !== indice.get(v)) return;
    const componente = [];
    let w;
    do {
      w = pilha.pop();
      naPilha.delete(w);
      componente.push(w);
    } while (w !== v);
    if (componente.length > 1) componentes.push(componente.sort());
  };

  for (const v of [...nos].sort()) if (!indice.has(v)) visitar(v);
  return componentes;
}

async function main() {
  const fksBrutas = await prisma.$queryRaw`
    SELECT
      c.conname     AS constraint_name,
      filha.relname AS tabela_filha,
      pai.relname   AS tabela_pai,
      c.confdeltype AS on_delete,
      c.confupdtype AS on_update,
      (SELECT array_agg(a.attname ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS colunas_filha,
      (SELECT array_agg(a.attname ORDER BY k.ord)
         FROM unnest(c.confkey) WITH ORDINALITY AS k(num, ord)
         JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num) AS colunas_pai
    FROM pg_constraint c
    JOIN pg_class filha ON filha.oid = c.conrelid
    JOIN pg_class pai   ON pai.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = filha.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
    ORDER BY filha.relname, c.conname
  `;

  const tabelasBrutas = await prisma.$queryRaw`
    SELECT cl.relname AS tabela
    FROM pg_class cl
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE cl.relkind = 'r' AND n.nspname = 'public'
    ORDER BY cl.relname
  `;

  const fks = fksBrutas.map((f) => ({
    constraint: f.constraint_name,
    tabelaFilha: f.tabela_filha,
    colunas: f.colunas_filha ?? [],
    tabelaPai: f.tabela_pai,
    colunasPai: f.colunas_pai ?? [],
    onDeleteCodigo: f.on_delete,
    onDelete: ACAO[f.on_delete] ?? `DESCONHECIDA (${f.on_delete})`,
    onUpdateCodigo: f.on_update,
    onUpdate: ACAO[f.on_update] ?? `DESCONHECIDA (${f.on_update})`,
    autoReferencia: f.tabela_filha === f.tabela_pai,
  }));

  const tabelas = new Set(tabelasBrutas.map((t) => t.tabela));

  /*
   * Auto-referência fica fora do grafo: um `DELETE FROM t` limpa a tabela
   * inteira de uma vez e não existe "antes" entre linhas da mesma tabela. Mas
   * continua reportada — remoção linha a linha nela precisa de ordem própria.
   */
  const arestas = fks
    .filter((f) => ORDENAM.has(f.onDeleteCodigo) && !f.autoReferencia)
    .filter((f) => tabelas.has(f.tabelaFilha) && tabelas.has(f.tabelaPai))
    .map((f) => ({ filha: f.tabelaFilha, pai: f.tabelaPai }));

  const { ordem, presas, libera } = ordenar(tabelas, arestas);
  const ciclos = presas.length ? acharCiclos(new Set(presas), libera) : [];

  // ---- O que o schema diz x o que o banco faz ----
  const modelos = lerSchema(CAMINHO_SCHEMA);
  const tabelaDoModelo = new Map([...modelos.values()].map((m) => [m.nome, m.tabela]));

  // Chave de junção: tabela filha + colunas da FK. É o que identifica a mesma
  // constraint dos dois lados sem depender do nome gerado pela migration.
  const declaradas = new Map();
  for (const modelo of modelos.values()) {
    for (const relacao of modelo.relacoes) {
      declaradas.set(`${modelo.tabela}|${relacao.colunas.join(",")}`, {
        modelo,
        relacao,
        tabelaPai: tabelaDoModelo.get(relacao.modeloPai) ?? relacao.modeloPai,
      });
    }
  }

  const divergencias = [];
  const semDeclaracao = [];
  const casadas = new Set();

  for (const fk of fks) {
    const chave = `${fk.tabelaFilha}|${fk.colunas.join(",")}`;
    const declarada = declaradas.get(chave);
    if (!declarada) {
      semDeclaracao.push(fk);
      continue;
    }
    casadas.add(chave);

    const sugerida = acaoSugeridaPeloSchema(declarada.relacao);
    if (sugerida.letra === fk.onDeleteCodigo) continue;

    divergencias.push({
      tabelaFilha: fk.tabelaFilha,
      coluna: fk.colunas.join(","),
      tabelaPai: fk.tabelaPai,
      constraint: fk.constraint,
      modelo: declarada.modelo.nome,
      campo: declarada.relacao.campo,
      tipoNoPrisma: `${declarada.relacao.modeloPai}${declarada.relacao.opcional ? "?" : ""}`,
      opcionalNoPrisma: declarada.relacao.opcional,
      onDeleteExplicito: declarada.relacao.onDelete,
      sugeridoPeloSchema: ACAO[sugerida.letra] ?? sugerida.nome,
      realNoBanco: fk.onDelete,
      /*
       * A armadilha original: o schema diz "opcional, sem onDelete", quem lê
       * conclui SET NULL, e o banco na verdade TRAVA o delete do pai. É essa
       * combinação que derrubou a limpeza, não divergência qualquer.
       */
      armadilha:
        declarada.relacao.opcional && !sugerida.explicita && (fk.onDeleteCodigo === "r" || fk.onDeleteCodigo === "a"),
    });
  }

  const semFkNoBanco = [...declaradas.entries()]
    .filter(([chave]) => !casadas.has(chave))
    .map(([chave, d]) => ({ chave, modelo: d.modelo.nome, campo: d.relacao.campo }));

  /*
   * `onUpdate` não aparece em nenhuma relação do schema (o padrão do Prisma é
   * Cascade). Vira contagem, não lista: se o banco confirmar Cascade em tudo,
   * uma linha basta; se divergir, a linha avisa sem afogar o ON DELETE.
   */
  const onUpdateForaDoCascade = fks.filter((f) => f.onUpdateCodigo !== "c");
  const armadilhas = divergencias.filter((d) => d.armadilha);

  if (ciclos.length) process.exitCode = 1;

  if (JSON_PURO) {
    console.log(
      JSON.stringify(
        {
          geradoEm: new Date().toISOString(),
          resumo: {
            fks: fks.length,
            tabelas: tabelas.size,
            ordenadas: ordem.length,
            autoReferencias: fks.filter((f) => f.autoReferencia).length,
            divergencias: divergencias.length,
            armadilhas: armadilhas.length,
            ciclos: ciclos.length,
            onUpdateForaDoCascade: onUpdateForaDoCascade.length,
          },
          ordemRemocao: ordem,
          ciclos,
          tabelasPresas: presas,
          fks,
          divergencias,
          semDeclaracaoNoSchema: semDeclaracao.map((f) => ({
            constraint: f.constraint,
            tabelaFilha: f.tabelaFilha,
            colunas: f.colunas,
            tabelaPai: f.tabelaPai,
          })),
          semFkNoBanco,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`=== CHAVES ESTRANGEIRAS REAIS (pg_constraint) — ${fks.length} ===`);
  console.log("Lido do banco, não do schema. Esta é a fonte da verdade.");
  console.log("Agrupadas pela tabela filha. A coluna do pai só aparece quando");
  console.log("não é `id`.\n");

  // Larguras globais (não por grupo) para as colunas alinharem o relatório
  // inteiro; teto para um nome comprido não empurrar 190 colunas em todas.
  const teto = (valores, maximo) => Math.min(Math.max(...valores, 0), maximo);
  const largColuna = teto(fks.map((f) => f.colunas.join(",").length), 32);
  const largPai = teto(
    fks.map((f) => (f.colunasPai.join(",") === "id" ? f.tabelaPai.length : f.tabelaPai.length + 1 + f.colunasPai.join(",").length)),
    30,
  );

  let filhaAnterior = null;
  for (const fk of fks) {
    if (fk.tabelaFilha !== filhaAnterior) {
      console.log(`  ${fk.tabelaFilha}`);
      filhaAnterior = fk.tabelaFilha;
    }
    const colunasPai = fk.colunasPai.join(",");
    const alvo = colunasPai === "id" ? fk.tabelaPai : `${fk.tabelaPai}.${colunasPai}`;
    console.log(
      [
        `    ${fk.colunas.join(",").padEnd(largColuna)}`,
        `-> ${alvo.padEnd(largPai)}`,
        `DELETE ${fk.onDelete.padEnd(11)}`,
        `UPDATE ${fk.onUpdate}`,
        fk.autoReferencia ? "  (auto-referência)" : "",
      ]
        .join(" ")
        .trimEnd(),
    );
  }

  console.log(`\n=== ORDEM DE REMOÇÃO — ${ordem.length} de ${tabelas.size} tabelas ===`);
  console.log("Filhas antes das pais. Ordenam RESTRICT, NO ACTION e CASCADE;");
  console.log("SET NULL e SET DEFAULT não impõem ordem. Cobre TODA tabela do");
  console.log("schema public, inclusive `_prisma_migrations`, que nunca se limpa.\n");
  for (const [i, tabela] of ordem.entries()) {
    console.log(`  ${String(i + 1).padStart(2, "0")}. ${tabela}`);
  }

  if (ciclos.length) {
    console.log(`\n=== CICLO DE FK — ${ciclos.length} componente(s) ===`);
    console.log("A ordem acima está INCOMPLETA. Não dá para remover só ordenando:");
    console.log("é preciso quebrar o anel antes (SET NULL na coluna, ou constraint");
    console.log("diferida dentro da transação).\n");
    for (const componente of ciclos) console.log(`  ${componente.join(" -> ")} -> ${componente[0]}`);
    const atrasDoAnel = presas.filter((t) => !ciclos.some((c) => c.includes(t)));
    if (atrasDoAnel.length) console.log(`\n  Presas atrás do ciclo, sem culpa própria: ${atrasDoAnel.join(", ")}`);
  }

  const autoReferencias = fks.filter((f) => f.autoReferencia);
  if (autoReferencias.length) {
    console.log(`\n=== AUTO-REFERÊNCIAS — ${autoReferencias.length} ===`);
    console.log("Fora do grafo: um DELETE da tabela inteira resolve. Importam só");
    console.log("para quem remove linha a linha.\n");
    for (const fk of autoReferencias) {
      console.log(`  ${fk.tabelaFilha}.${fk.colunas.join(",")}  DELETE ${fk.onDelete}`);
    }
  }

  console.log(`\n=== SCHEMA x BANCO — ${divergencias.length} divergência(s), ${armadilhas.length} armadilha(s) ===`);
  console.log("Armadilha = relação opcional no Prisma e sem `onDelete:` explícito");
  console.log("(quem lê o schema conclui SET NULL) que no banco TRAVA o delete.\n");
  if (divergencias.length === 0) console.log("  Nenhuma. O schema descreve o banco.");
  const porGravidade = [...divergencias].sort(
    (a, b) => Number(b.armadilha) - Number(a.armadilha) || a.tabelaFilha.localeCompare(b.tabelaFilha),
  );
  for (const d of porGravidade) {
    console.log(`  ${d.armadilha ? "ARMADILHA" : "diferente"}  ${d.tabelaFilha}.${d.coluna} -> ${d.tabelaPai}`);
    console.log(
      `             schema: ${d.modelo}.${d.campo} ${d.tipoNoPrisma}` +
        `${d.onDeleteExplicito ? ` onDelete: ${d.onDeleteExplicito}` : " (sem onDelete)"}` +
        ` => sugere ${d.sugeridoPeloSchema}`,
    );
    console.log(`             banco:  ${d.realNoBanco}`);
  }

  if (semDeclaracao.length) {
    console.log(`\n=== FK NO BANCO SEM RELAÇÃO NO SCHEMA — ${semDeclaracao.length} ===`);
    for (const f of semDeclaracao) console.log(`  ${f.tabelaFilha}.${f.colunas.join(",")} (${f.constraint})`);
  }
  if (semFkNoBanco.length) {
    console.log(`\n=== RELAÇÃO NO SCHEMA SEM FK NO BANCO — ${semFkNoBanco.length} ===`);
    for (const r of semFkNoBanco) console.log(`  ${r.modelo}.${r.campo} (${r.chave})`);
  }

  console.log("\n=== RESUMO ===");
  console.log(`  chaves estrangeiras       ${fks.length}`);
  console.log(`  tabelas no schema public  ${tabelas.size}`);
  console.log(`  ordenadas                 ${ordem.length}`);
  console.log(`  ciclos                    ${ciclos.length}`);
  console.log(`  divergências ON DELETE    ${divergencias.length} (${armadilhas.length} armadilha(s))`);
  console.log(`  ON UPDATE fora de CASCADE ${onUpdateForaDoCascade.length}`);
}

main()
  .catch((erro) => {
    console.error("FALHOU:", semCredencial(erro.message));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
