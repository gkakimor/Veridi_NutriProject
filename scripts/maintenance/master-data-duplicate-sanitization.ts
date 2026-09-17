import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { descreverDestino, exigirBancoLocal } from "../local-db-guard.mjs";
import { DECISOES_DE_DUPLICATAS } from "../veridi-import/item-duplicate-decisions.js";
import {
  CADASTROS_MESTRE_NO_BANCO,
  cadastroPorChave,
  compararCampos,
  escolherCanonico,
} from "./master-data-catalog.js";
import type {
  CadastroMestreNoBanco,
  CampoPerdido,
  ConflitoDeCampo,
  MotivoDoCanonico,
  RegistroDoGrupo,
} from "./master-data-catalog.js";
import { planilhaDoSaneamento } from "./master-data-duplicate-report.js";
import type { VarianteDeNome } from "./master-data-duplicate-report.js";
import { gerarXlsx } from "./xlsx-writer.js";

/**
 * Saneamento de nome duplicado nos cadastros mestre — PLAN → APPLY → VERIFY
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts plan \
 *     [--cadastro=ITEM,CUSTOMER] [--plano=<plano.json>] [--excel=<planilha.xlsx>]
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts apply \
 *     --plano=<plano.json> --backup=<backup.json> --confirmar-banco=<banco> [--grupo=ITEM/…]
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts verify \
 *     --plano=<plano.json>
 *
 * Rodar pelo Bash: no PowerShell 5.1 o `--` e as flags se perdem a caminho do tsx.
 *
 * A regra de duplicidade é a do PO: `trim` + sem caixa, acento preservado
 * (`@veridi/shared`, `master-data-names.ts`). A autoridade da comparação é o
 * banco — `upper(btrim(<coluna>))`, a mesma expressão do guarda da API.
 *
 *  - **PLAN** lê numa transação READ ONLY. Por grupo: quem fica, por qual
 *    critério, que referências existem hoje, o que se move, o que se remove e
 *    o efeito esperado por tabela. Grupo com conflito material, referência que
 *    a ferramenta não sabe mover ou colisão de índice único vira `BLOQUEADO`
 *    com o motivo escrito — nunca escolha silenciosa.
 *  - **APPLY** roda **uma transação por grupo**: trava consultiva, `SELECT …
 *    FOR UPDATE` dos dois lados e das linhas que apontam para eles, releitura
 *    com a MESMA impressão digital do plano aprovado, contagem de linhas em
 *    cada escrita e `pg_stat_xact_user_tables` conferindo que a transação não
 *    tocou em nada além do previsto. Um grupo que diverge desfaz só a si
 *    mesmo; os demais grupos seguros continuam.
 *  - **VERIFY** prova o resultado: absorvido fora do banco, canônico no lugar,
 *    nenhum resíduo do id do absorvido, as referências penduradas no canônico
 *    e nenhuma duplicidade restante naquele grupo.
 *
 * APPLY só roda contra banco local (`local-db-guard`). Produção é outra
 * rodada, com conferência READ ONLY e aprovação do PO antes.
 *
 * Item já tem ferramenta própria para os grupos que dependem de decisão de
 * produto (`item-duplicate-sanitization.ts`, ondas A/B/C). Grupo de Item cujo
 * código está no arquivo de decisão daquela ferramenta é recusado aqui, para
 * que as duas nunca disputem o mesmo registro.
 */

type Banco = Prisma.TransactionClient;
type Registro = Record<string, unknown>;

const FERRAMENTA = "master-data-duplicate-sanitization";
const FORMATO = 1;
const TRAVA = "veridi:master-data-duplicate-sanitization";

const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");
const ident = (nome: string): string => `"${nome.replace(/"/g, '""')}"`;

const emOrdem = <T>(porChave: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(porChave).sort(([a], [b]) => a.localeCompare(b)));

/* ------------------------------------------------------------------ *
 * Tipos do plano
 * ------------------------------------------------------------------ */

export interface ColunaDeReferencia {
  tabela: string;
  coluna: string;
  tipo: "fk" | "id" | "codigo" | "json";
  /** Só para `fk`: `a` = NO ACTION, `r` = RESTRICT, `c` = CASCADE, `n` = SET NULL. */
  aoApagar?: string;
}

export interface ReferenciaContada extends ColunaDeReferencia {
  linhas: number;
}

export interface EfeitoNaTabela {
  ins: number;
  upd: number;
  del: number;
}

export interface LadoDoPlano {
  id: string;
  codigo: string;
  nome: string;
  criadoEm: string | null;
  referencias: ReferenciaContada[];
  dados: Registro;
}

export interface Movimento {
  tabela: string;
  coluna: string;
  linhas: number;
}

export interface GrupoPlanejado {
  /** `ITEM/ARABINOGALACTANA` — estável entre execuções. */
  grupo: string;
  cadastro: string;
  rotulo: string;
  chaveDoNome: string;
  situacao: "PRONTO" | "BLOQUEADO";
  motivos: string[];
  criterio: MotivoDoCanonico;
  explicacao: string;
  canonico: LadoDoPlano;
  absorvidos: LadoDoPlano[];
  conflitos: ConflitoDeCampo[];
  camposPerdidos: CampoPerdido[];
  movimentos: Movimento[];
  impressao: string;
}

export interface Plano {
  ferramenta: string;
  formato: number;
  geradoEm: string;
  banco: string;
  cadastros: string[];
  grupos: GrupoPlanejado[];
  /** Nomes que a regra do PO NÃO funde (acento, espaço interno). Só relatório. */
  variantes: VarianteDeNome[];
  efeitoEsperado: Record<string, EfeitoNaTabela>;
  /** Nenhum grupo bloqueado: o plano inteiro pode ser aplicado. */
  pronto: boolean;
  impressao: string;
}

/* ------------------------------------------------------------------ *
 * Leitura do catálogo do PostgreSQL
 * ------------------------------------------------------------------ */

async function contar(db: Banco, sql: string, ...valores: unknown[]): Promise<number> {
  const [linha] = await db.$queryRawUnsafe<{ n: number }[]>(sql, ...valores);
  return linha?.n ?? 0;
}

async function bancoAtual(db: Banco): Promise<string> {
  const [linha] = await db.$queryRawUnsafe<{ banco: string }[]>(`SELECT current_database() AS banco`);
  if (!linha) throw new Error("não foi possível ler o banco atual.");
  return linha.banco;
}

/**
 * Toda coluna do banco que pode apontar para este cadastro.
 *
 * Não confia na lista de relações do Prisma: lê as FKs reais do catálogo do
 * PostgreSQL (com a ação de exclusão, porque `CASCADE` e `SET NULL` são
 * referências que um `DELETE` "bem-sucedido" esconde), mais as colunas de id
 * sem FK declarada, as que guardam o CÓDIGO e todas as colunas JSON.
 */
export async function lerCatalogo(
  db: Banco,
  cadastro: CadastroMestreNoBanco,
): Promise<ColunaDeReferencia[]> {
  const fks = await db.$queryRawUnsafe<
    { tabela: string; coluna: string; alvo: string; aoApagar: string }[]
  >(`
    SELECT src.relname AS tabela, a.attname AS coluna, tgt.relname AS alvo, c.confdeltype AS "aoApagar"
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND n.nspname = 'public'
    ORDER BY 1, 2`);
  const colunas = await db.$queryRawUnsafe<{ tabela: string; coluna: string; tipo: string }[]>(`
    SELECT c.table_name AS tabela, c.column_name AS coluna, c.data_type AS tipo
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
    ORDER BY 1, 2`);

  const comFk = new Set(fks.map((fk) => `${fk.tabela}.${fk.coluna}`));
  const catalogo: ColunaDeReferencia[] = fks
    .filter((fk) => fk.alvo === cadastro.tabela)
    .map((fk) => ({ tabela: fk.tabela, coluna: fk.coluna, tipo: "fk", aoApagar: fk.aoApagar }));

  const casa = (coluna: string, sufixos: readonly string[]): boolean =>
    sufixos.some((sufixo) => coluna.toLowerCase().endsWith(sufixo));

  for (const { tabela, coluna, tipo } of colunas) {
    if (tabela === cadastro.tabela) continue;
    const textual = ["text", "character varying", "uuid"].includes(tipo);
    if (tipo === "json" || tipo === "jsonb") catalogo.push({ tabela, coluna, tipo: "json" });
    else if (textual && casa(coluna, cadastro.sufixosDeId) && !comFk.has(`${tabela}.${coluna}`)) {
      catalogo.push({ tabela, coluna, tipo: "id" });
    } else if (textual && casa(coluna, cadastro.sufixosDeCodigo)) {
      catalogo.push({ tabela, coluna, tipo: "codigo" });
    }
  }
  return catalogo;
}

async function contarReferencias(
  db: Banco,
  catalogo: readonly ColunaDeReferencia[],
  registro: { id: string; codigo: string },
): Promise<ReferenciaContada[]> {
  const achadas: ReferenciaContada[] = [];
  for (const coluna of catalogo) {
    const campo = `${ident(coluna.coluna)}::text`;
    const linhas =
      coluna.tipo === "json"
        ? await contar(
            db,
            `SELECT count(*)::int AS n FROM ${ident(coluna.tabela)} WHERE strpos(${campo}, $1) > 0 OR strpos(${campo}, $2) > 0`,
            registro.id,
            registro.codigo,
          )
        : await contar(
            db,
            `SELECT count(*)::int AS n FROM ${ident(coluna.tabela)} WHERE ${campo} = $1`,
            coluna.tipo === "codigo" ? registro.codigo : registro.id,
          );
    if (linhas > 0) achadas.push({ ...coluna, linhas });
  }
  return achadas;
}

/** Índices únicos que envolvem uma coluna que vai ser movida. */
interface IndiceUnico {
  nome: string;
  tabela: string;
  colunas: string[];
  /** Índice parcial ou por expressão: colisão não se calcula, então bloqueia. */
  naoCalculavel: boolean;
}

async function lerIndicesUnicos(db: Banco, tabelas: readonly string[]): Promise<IndiceUnico[]> {
  if (tabelas.length === 0) return [];
  return db.$queryRawUnsafe<IndiceUnico[]>(
    `SELECT i.relname AS nome,
            t.relname AS tabela,
            ARRAY(
              SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
              LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
              ORDER BY k.ord
            )::text[] AS colunas,
            (ix.indpred IS NOT NULL OR ix.indexprs IS NOT NULL) AS "naoCalculavel"
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE ix.indisunique AND n.nspname = 'public' AND t.relname = ANY($1::text[])
     ORDER BY 1`,
    tabelas,
  );
}

/**
 * Mover a coluna do absorvido para o canônico criaria linha repetida?
 *
 * Índice parcial ou por expressão não se calcula por SQL genérico — bloqueia,
 * em vez de tentar e descobrir no `UPDATE`.
 */
async function colisoesDoMovimento(
  db: Banco,
  indices: readonly IndiceUnico[],
  tabela: string,
  coluna: string,
  idAbsorvido: string,
  idCanonico: string,
): Promise<string[]> {
  const problemas: string[] = [];
  for (const indice of indices) {
    if (indice.tabela !== tabela) continue;
    if (!indice.colunas.includes(coluna)) continue;
    if (indice.naoCalculavel) {
      problemas.push(
        `${tabela}.${coluna}: índice único ${indice.nome} é parcial ou por expressão — a colisão não é calculável aqui`,
      );
      continue;
    }
    const outras = indice.colunas.filter((c) => c !== coluna && c.length > 0);
    const iguais = outras
      .map((c) => `b.${ident(c)} IS NOT DISTINCT FROM a.${ident(c)}`)
      .join(" AND ");
    const repetidas = await contar(
      db,
      `SELECT count(*)::int AS n FROM ${ident(tabela)} a
       WHERE a.${ident(coluna)}::text = $1
         AND EXISTS (
           SELECT 1 FROM ${ident(tabela)} b
           WHERE b.${ident(coluna)}::text = $2${iguais ? ` AND ${iguais}` : ""}
         )`,
      idAbsorvido,
      idCanonico,
    );
    if (repetidas > 0) {
      problemas.push(
        `${tabela}.${coluna}: mover ${repetidas} linha(s) repetiria o índice único ${indice.nome} (${indice.colunas.join(", ")})`,
      );
    }
  }
  return problemas;
}

/* ------------------------------------------------------------------ *
 * PLAN
 * ------------------------------------------------------------------ */

/** Códigos de Item que a ferramenta dedicada já decidiu — esta não os toca. */
const CODIGOS_DA_FERRAMENTA_DE_ITEM = new Set(
  DECISOES_DE_DUPLICATAS.flatMap((d) => [d.absorvido.codigo, d.canonico.codigo]),
);

async function lerGrupos(db: Banco, cadastro: CadastroMestreNoBanco): Promise<Registro[][]> {
  const chave = `upper(btrim(${ident(cadastro.colunaNome)}))`;
  const linhas = await db.$queryRawUnsafe<{ chave: string; bruto: string }[]>(
    `SELECT ${chave} AS chave, to_jsonb(x)::text AS bruto
     FROM ${ident(cadastro.tabela)} x
     WHERE ${chave} IN (
       SELECT ${chave} FROM ${ident(cadastro.tabela)}
       GROUP BY 1 HAVING count(*) > 1
     )
     ORDER BY 1, ${ident(cadastro.colunaCodigo)}`,
  );
  const porChave = new Map<string, Registro[]>();
  for (const linha of linhas) {
    const atual = porChave.get(linha.chave) ?? [];
    atual.push(JSON.parse(linha.bruto) as Registro);
    porChave.set(linha.chave, atual);
  }
  return [...porChave.values()];
}

const comoTexto = (registro: Registro, campo: string): string | null => {
  const valor = registro[campo];
  return valor === null || valor === undefined ? null : String(valor);
};

/** As letras acentuadas do português e o que elas viram na dobra. */
const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC";

/**
 * Nomes que **quase** colidem e que a regra do PO deixa passar de propósito:
 * só o acento difere, ou só o espaço interno.
 *
 * Não vira ação: vira linha na aba de revisão. `ACIDO` e `ÁCIDO` podem ser o
 * mesmo material ou não, e isso é pergunta para a Veridi.
 */
export async function lerVariantes(
  db: Banco,
  cadastro: CadastroMestreNoBanco,
): Promise<VarianteDeNome[]> {
  const nome = ident(cadastro.colunaNome);
  const codigo = ident(cadastro.colunaCodigo);
  const semEspaco = `upper(regexp_replace(btrim(${nome}), '\\s+', ' ', 'g'))`;
  const dobrado = `translate(${semEspaco}, '${COM_ACENTO}', '${SEM_ACENTO}')`;
  const linhas = await db.$queryRawUnsafe<{ motivo: string; codigos: string[]; nomes: string[] }[]>(
    `SELECT 'ESPAÇO' AS motivo,
            array_agg(${codigo} ORDER BY ${codigo})::text[] AS codigos,
            array_agg(${nome} ORDER BY ${codigo})::text[] AS nomes
       FROM ${ident(cadastro.tabela)}
      GROUP BY ${semEspaco}
     HAVING count(*) > 1 AND count(DISTINCT upper(btrim(${nome}))) > 1
     UNION ALL
     SELECT 'ACENTO',
            array_agg(${codigo} ORDER BY ${codigo})::text[],
            array_agg(${nome} ORDER BY ${codigo})::text[]
       FROM ${ident(cadastro.tabela)}
      GROUP BY ${dobrado}
     HAVING count(*) > 1 AND count(DISTINCT ${semEspaco}) > 1
     ORDER BY 1, 2`,
  );
  return linhas.map((linha) => ({
    cadastro: cadastro.chave,
    motivo: linha.motivo === "ACENTO" ? "ACENTO" : "ESPAÇO",
    registros: linha.codigos.map((c, i) => ({ codigo: c, nome: linha.nomes[i] ?? "" })),
  }));
}

function impressaoDoGrupo(
  chave: string,
  registros: readonly RegistroDoGrupo[],
  movimentos: readonly Movimento[],
): string {
  return sha256(
    JSON.stringify({
      chave,
      registros: [...registros]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((r) => ({
          id: r.id,
          linha: JSON.stringify(r.dados, Object.keys(r.dados).sort()),
          referencias: r.referencias,
          tabelas: r.tabelasQueReferenciam,
        })),
      movimentos,
    }),
  );
}

/** Um grupo de duplicidade, do jeito que entra no plano. */
async function planejarGrupo(
  db: Banco,
  cadastro: CadastroMestreNoBanco,
  catalogo: readonly ColunaDeReferencia[],
  indices: readonly IndiceUnico[],
  linhas: readonly Registro[],
): Promise<GrupoPlanejado> {
  const motivos: string[] = [];
  const registros: RegistroDoGrupo[] = [];
  // Uma varredura do catálogo por registro, e só uma: são dezenas de colunas
  // candidatas por cadastro, e contar duas vezes dobra o custo do PLAN inteiro.
  const porId = new Map<string, ReferenciaContada[]>();

  for (const dados of linhas) {
    const id = comoTexto(dados, cadastro.colunaId)!;
    const codigo = comoTexto(dados, cadastro.colunaCodigo) ?? id;
    const referencias = await contarReferencias(db, catalogo, { id, codigo });
    porId.set(id, referencias);
    registros.push({
      id,
      codigo,
      nome: comoTexto(dados, cadastro.colunaNome) ?? "",
      dados,
      referencias: referencias.reduce((soma, r) => soma + r.linhas, 0),
      tabelasQueReferenciam: new Set(referencias.map((r) => r.tabela)).size,
      criadoEm: comoTexto(dados, "createdAt"),
    });
  }

  const escolha = escolherCanonico(registros, cadastro);
  const { conflitos, perdidos } = compararCampos(escolha.canonico, escolha.absorvidos, cadastro);
  if (conflitos.length > 0) {
    for (const conflito of conflitos) {
      motivos.push(`conflito material em "${conflito.coluna}": ${conflito.valores.map((v) => `"${v}"`).join(" × ")}`);
    }
  }

  if (cadastro.chave === "ITEM") {
    const daOutraFerramenta = registros
      .map((r) => r.codigo)
      .filter((codigo) => CODIGOS_DA_FERRAMENTA_DE_ITEM.has(codigo));
    if (daOutraFerramenta.length > 0) {
      motivos.push(
        `${daOutraFerramenta.join(", ")} está no arquivo de decisão de ITEM-DUPLICATE-SANITIZATION-01 — use aquela ferramenta`,
      );
    }
  }

  const movimentos: Movimento[] = [];
  for (const absorvido of escolha.absorvidos) {
    for (const referencia of porId.get(absorvido.id) ?? []) {
      if (referencia.tipo === "json") {
        motivos.push(
          `${referencia.tabela}.${referencia.coluna} (JSON) cita ${absorvido.codigo} em ${referencia.linhas} linha(s) — a ferramenta não reescreve JSON`,
        );
        continue;
      }
      if (referencia.tipo === "codigo") {
        motivos.push(
          `${referencia.tabela}.${referencia.coluna} guarda o CÓDIGO ${absorvido.codigo} em ${referencia.linhas} linha(s) — é retrato histórico, não se move`,
        );
        continue;
      }
      motivos.push(
        ...(await colisoesDoMovimento(
          db,
          indices,
          referencia.tabela,
          referencia.coluna,
          absorvido.id,
          escolha.canonico.id,
        )),
      );
      movimentos.push({ tabela: referencia.tabela, coluna: referencia.coluna, linhas: referencia.linhas });
    }
  }

  const chaveDoNome = escolha.canonico.nome.trim().toUpperCase();
  const comReferencias = (registro: RegistroDoGrupo): LadoDoPlano => ({
    id: registro.id,
    codigo: registro.codigo,
    nome: registro.nome,
    criadoEm: registro.criadoEm,
    referencias: porId.get(registro.id) ?? [],
    dados: registro.dados,
  });

  return {
    grupo: `${cadastro.chave}/${chaveDoNome}`,
    cadastro: cadastro.chave,
    rotulo: cadastro.rotulo,
    chaveDoNome,
    situacao: motivos.length === 0 ? "PRONTO" : "BLOQUEADO",
    motivos,
    criterio: escolha.motivo,
    explicacao: escolha.explicacao,
    canonico: comReferencias(escolha.canonico),
    absorvidos: escolha.absorvidos.map(comReferencias),
    conflitos,
    camposPerdidos: perdidos,
    movimentos,
    impressao: impressaoDoGrupo(chaveDoNome, registros, movimentos),
  };
}

/** O efeito por tabela que a transação de um plano deve produzir — e só ele. */
export function efeitoEsperado(grupos: readonly GrupoPlanejado[]): Record<string, EfeitoNaTabela> {
  const efeito: Record<string, EfeitoNaTabela> = {};
  const somar = (tabela: string, delta: Partial<EfeitoNaTabela>): void => {
    const atual = efeito[tabela] ?? { ins: 0, upd: 0, del: 0 };
    efeito[tabela] = {
      ins: atual.ins + (delta.ins ?? 0),
      upd: atual.upd + (delta.upd ?? 0),
      del: atual.del + (delta.del ?? 0),
    };
  };
  for (const grupo of grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    const cadastro = cadastroPorChave(grupo.cadastro);
    for (const movimento of grupo.movimentos) somar(movimento.tabela, { upd: movimento.linhas });
    somar(cadastro.tabela, { del: grupo.absorvidos.length });
  }
  return emOrdem(efeito);
}

export interface OpcoesDoPlano {
  /** As variantes são leitura extra; o APPLY relê o plano e não precisa delas. */
  comVariantes?: boolean | undefined;
}

export async function planejarCom(
  db: Banco,
  chaves: readonly string[],
  opcoes: OpcoesDoPlano = {},
): Promise<Plano> {
  const grupos: GrupoPlanejado[] = [];
  const variantes: VarianteDeNome[] = [];
  for (const chave of chaves) {
    const cadastro = cadastroPorChave(chave);
    const catalogo = await lerCatalogo(db, cadastro);
    const tabelas = [...new Set(catalogo.filter((c) => c.tipo !== "json").map((c) => c.tabela))];
    const indices = await lerIndicesUnicos(db, tabelas);
    for (const linhas of await lerGrupos(db, cadastro)) {
      grupos.push(await planejarGrupo(db, cadastro, catalogo, indices, linhas));
    }
    if (opcoes.comVariantes) variantes.push(...(await lerVariantes(db, cadastro)));
  }
  grupos.sort((a, b) => a.grupo.localeCompare(b.grupo));

  const plano: Plano = {
    ferramenta: FERRAMENTA,
    formato: FORMATO,
    geradoEm: new Date().toISOString(),
    banco: await bancoAtual(db),
    cadastros: [...chaves],
    grupos,
    variantes,
    efeitoEsperado: efeitoEsperado(grupos),
    pronto: grupos.every((g) => g.situacao === "PRONTO"),
    impressao: "",
  };
  plano.impressao = sha256(
    JSON.stringify({
      cadastros: plano.cadastros,
      grupos: grupos.map((g) => [g.grupo, g.situacao, g.impressao, g.canonico.id, g.absorvidos.map((a) => a.id)]),
      efeito: plano.efeitoEsperado,
    }),
  );
  return plano;
}

/** PLAN: somente leitura, sempre. */
export async function planejar(prisma: PrismaClient, chaves: readonly string[]): Promise<Plano> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
      return planejarCom(tx, chaves, { comVariantes: true });
    },
    { maxWait: 10_000, timeout: 600_000 },
  );
}

/* ------------------------------------------------------------------ *
 * APPLY
 * ------------------------------------------------------------------ */

function divergenciasDoGrupo(aprovado: GrupoPlanejado, agora: GrupoPlanejado | undefined): string[] {
  if (!agora) return [`${aprovado.grupo}: o grupo não existe mais no banco`];
  const divergencias: string[] = [];
  if (agora.situacao !== "PRONTO") {
    divergencias.push(`${agora.grupo}: ${agora.situacao} agora (${agora.motivos.join("; ")})`);
  }
  if (aprovado.impressao !== agora.impressao) {
    divergencias.push(`${agora.grupo}: impressão digital diferente — os registros mudaram desde o plano`);
  }
  if (aprovado.canonico.id !== agora.canonico.id) {
    divergencias.push(`${agora.grupo}: o canônico mudou (${aprovado.canonico.codigo} → ${agora.canonico.codigo})`);
  }
  if (JSON.stringify(aprovado.movimentos) !== JSON.stringify(agora.movimentos)) {
    divergencias.push(`${agora.grupo}: as referências a mover mudaram desde o plano`);
  }
  return divergencias;
}

async function contadoresDaConexao(tx: Banco): Promise<Record<string, EfeitoNaTabela>> {
  const linhas = await tx.$queryRawUnsafe<{ tabela: string; ins: number; upd: number; del: number }[]>(`
    SELECT relname AS tabela, n_tup_ins::int AS ins, n_tup_upd::int AS upd, n_tup_del::int AS del
    FROM pg_stat_xact_user_tables
    WHERE schemaname = 'public'`);
  return Object.fromEntries(linhas.map(({ tabela, ins, upd, del }) => [tabela, { ins, upd, del }]));
}

function efeitoEntre(
  antes: Record<string, EfeitoNaTabela>,
  depois: Record<string, EfeitoNaTabela>,
): Record<string, EfeitoNaTabela> {
  const efeito: Record<string, EfeitoNaTabela> = {};
  for (const [tabela, fim] of Object.entries(depois)) {
    const inicio = antes[tabela] ?? { ins: 0, upd: 0, del: 0 };
    const delta = { ins: fim.ins - inicio.ins, upd: fim.upd - inicio.upd, del: fim.del - inicio.del };
    if (delta.ins !== 0 || delta.upd !== 0 || delta.del !== 0) efeito[tabela] = delta;
  }
  return emOrdem(efeito);
}

/** Trava ANTES de ler: quem chegar depois espera esta transação terminar. */
async function travarGrupo(tx: Banco, cadastro: CadastroMestreNoBanco, grupo: GrupoPlanejado): Promise<void> {
  const ids = [grupo.canonico.id, ...grupo.absorvidos.map((a) => a.id)];
  await tx.$queryRawUnsafe(
    `SELECT ${ident(cadastro.colunaId)} FROM ${ident(cadastro.tabela)}
     WHERE ${ident(cadastro.colunaId)}::text = ANY($1::text[])
     ORDER BY 1 FOR UPDATE`,
    ids,
  );
  for (const movimento of grupo.movimentos) {
    await tx.$queryRawUnsafe(
      `SELECT 1 FROM ${ident(movimento.tabela)}
       WHERE ${ident(movimento.coluna)}::text = ANY($1::text[]) FOR UPDATE`,
      ids,
    );
  }
}

async function executarGrupo(
  tx: Banco,
  cadastro: CadastroMestreNoBanco,
  grupo: GrupoPlanejado,
): Promise<void> {
  const exigir = (obtido: number, esperado: number, oque: string): void => {
    if (obtido !== esperado) {
      throw new Error(`ABORTADO: ${oque} mexeu em ${obtido} linha(s), o plano previa ${esperado}.`);
    }
  };

  for (const absorvido of grupo.absorvidos) {
    for (const referencia of absorvido.referencias) {
      if (referencia.tipo === "json" || referencia.tipo === "codigo") {
        throw new Error(`ABORTADO: ${referencia.tabela}.${referencia.coluna} não se move (${referencia.tipo}).`);
      }
      const mexidas = await tx.$executeRawUnsafe(
        `UPDATE ${ident(referencia.tabela)} SET ${ident(referencia.coluna)} = $1
         WHERE ${ident(referencia.coluna)}::text = $2`,
        grupo.canonico.id,
        absorvido.id,
      );
      exigir(mexidas, referencia.linhas, `${referencia.tabela}.${referencia.coluna}`);
    }
  }

  const removidos = await tx.$executeRawUnsafe(
    `DELETE FROM ${ident(cadastro.tabela)} WHERE ${ident(cadastro.colunaId)}::text = ANY($1::text[])`,
    grupo.absorvidos.map((a) => a.id),
  );
  exigir(removidos, grupo.absorvidos.length, `DELETE em ${cadastro.tabela}`);
}

export interface ResultadoDoGrupo {
  grupo: string;
  situacao: "APLICADO" | "BLOQUEADO" | "FALHOU";
  motivo: string | null;
  efeito: Record<string, EfeitoNaTabela>;
  aplicadoEm: string | null;
}

export interface OpcoesDaAplicacao {
  /** Só estes grupos; vazio = todos os `PRONTO` do plano. */
  somente?: readonly string[] | undefined;
  /** Ponto de teste: roda dentro da transação, depois do grupo aplicado. */
  aoConcluirGrupo?: ((grupo: string, tx: Banco) => Promise<void> | void) | undefined;
}

/**
 * APPLY: **uma transação por grupo**.
 *
 * Grupo bloqueado não impede os seguros, e grupo que diverge do plano desfaz
 * só a si mesmo — a atomicidade é do grupo, que é a unidade que o PO aprova.
 */
export async function aplicar(
  prisma: PrismaClient,
  plano: Plano,
  opcoes: OpcoesDaAplicacao = {},
): Promise<ResultadoDoGrupo[]> {
  if (plano.ferramenta !== FERRAMENTA || plano.formato !== FORMATO) {
    throw new Error("ABORTADO: o arquivo não é um plano desta ferramenta.");
  }
  const escolhidos = opcoes.somente && opcoes.somente.length > 0 ? new Set(opcoes.somente) : null;
  const resultados: ResultadoDoGrupo[] = [];

  for (const doPlano of plano.grupos) {
    if (escolhidos && !escolhidos.has(doPlano.grupo)) continue;
    if (doPlano.situacao !== "PRONTO") {
      resultados.push({
        grupo: doPlano.grupo,
        situacao: "BLOQUEADO",
        motivo: doPlano.motivos.join("; "),
        efeito: {},
        aplicadoEm: null,
      });
      continue;
    }

    const cadastro = cadastroPorChave(doPlano.cadastro);
    try {
      const efeito = await prisma.$transaction(
        async (tx) => {
          const [trava] = await tx.$queryRawUnsafe<{ travado: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS travado`,
            TRAVA,
          );
          if (trava?.travado !== true) {
            throw new Error("outra execução do saneamento está em andamento.");
          }
          const noInicio = await contadoresDaConexao(tx);
          await travarGrupo(tx, cadastro, doPlano);

          const agora = await planejarCom(tx, [doPlano.cadastro]);
          const divergencias = divergenciasDoGrupo(
            doPlano,
            agora.grupos.find((g) => g.grupo === doPlano.grupo),
          );
          if (divergencias.length > 0) {
            throw new Error(`o banco não está no estado do plano.\n    - ${divergencias.join("\n    - ")}`);
          }

          await executarGrupo(tx, cadastro, doPlano);
          const efeitoDoGrupo = efeitoEntre(noInicio, await contadoresDaConexao(tx));
          const previsto = efeitoEsperado([doPlano]);
          if (JSON.stringify(efeitoDoGrupo) !== JSON.stringify(previsto)) {
            throw new Error(
              `a transação mexeu fora do plano.\n    previsto ${JSON.stringify(previsto)}\n    obtido   ${JSON.stringify(efeitoDoGrupo)}`,
            );
          }
          const conferencia = await verificarCom(tx, [doPlano]);
          if (conferencia.problemas.length > 0) {
            throw new Error(`a conferência dentro da transação falhou.\n    - ${conferencia.problemas.join("\n    - ")}`);
          }
          await opcoes.aoConcluirGrupo?.(doPlano.grupo, tx);
          return efeitoDoGrupo;
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
      resultados.push({
        grupo: doPlano.grupo,
        situacao: "APLICADO",
        motivo: null,
        efeito,
        aplicadoEm: new Date().toISOString(),
      });
    } catch (erro: unknown) {
      resultados.push({
        grupo: doPlano.grupo,
        situacao: "FALHOU",
        motivo: erro instanceof Error ? erro.message : String(erro),
        efeito: {},
        aplicadoEm: null,
      });
    }
  }
  return resultados;
}

/* ------------------------------------------------------------------ *
 * VERIFY
 * ------------------------------------------------------------------ */

export interface ResultadoDaVerificacao {
  problemas: string[];
  conferidos: string[];
  /** Nomes que continuam repetidos, por cadastro. */
  duplicidades: { cadastro: string; nome: string; codigos: string[] }[];
}

export async function verificarCom(
  db: Banco,
  grupos: readonly GrupoPlanejado[],
): Promise<ResultadoDaVerificacao> {
  const problemas: string[] = [];
  const conferidos: string[] = [];

  for (const grupo of grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    const cadastro = cadastroPorChave(grupo.cadastro);
    const catalogo = await lerCatalogo(db, cadastro);
    const existe = async (id: string): Promise<boolean> =>
      (await contar(
        db,
        `SELECT count(*)::int AS n FROM ${ident(cadastro.tabela)} WHERE ${ident(cadastro.colunaId)}::text = $1`,
        id,
      )) > 0;

    if (!(await existe(grupo.canonico.id))) {
      problemas.push(`${grupo.grupo}: o canônico ${grupo.canonico.codigo} não está no banco`);
    }
    for (const absorvido of grupo.absorvidos) {
      if (await existe(absorvido.id)) {
        problemas.push(`${grupo.grupo}: o absorvido ${absorvido.codigo} continua no banco`);
      }
      const residuo = await contarReferencias(db, catalogo, { id: absorvido.id, codigo: absorvido.codigo });
      for (const referencia of residuo) {
        problemas.push(
          `${grupo.grupo}: ${referencia.linhas} resíduo(s) de ${absorvido.codigo} em ${referencia.tabela}.${referencia.coluna}`,
        );
      }
    }

    for (const movimento of grupo.movimentos) {
      const agora = await contar(
        db,
        `SELECT count(*)::int AS n FROM ${ident(movimento.tabela)} WHERE ${ident(movimento.coluna)}::text = $1`,
        grupo.canonico.id,
      );
      const previsto =
        movimento.linhas +
        (grupo.canonico.referencias.find(
          (r) => r.tabela === movimento.tabela && r.coluna === movimento.coluna,
        )?.linhas ?? 0);
      if (agora < previsto) {
        problemas.push(
          `${grupo.grupo}: ${movimento.tabela}.${movimento.coluna} tem ${agora} linha(s) no canônico, esperava ao menos ${previsto}`,
        );
      }
    }

    const restantes = await db.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT ${ident(cadastro.colunaCodigo)} AS codigo FROM ${ident(cadastro.tabela)}
       WHERE upper(btrim(${ident(cadastro.colunaNome)})) = $1 ORDER BY 1`,
      grupo.chaveDoNome,
    );
    if (restantes.length !== 1) {
      problemas.push(
        `${grupo.grupo}: ${restantes.length} cadastro(s) com o nome "${grupo.chaveDoNome}" (${restantes.map((r) => r.codigo).join(", ") || "nenhum"}), esperava 1`,
      );
    }
    conferidos.push(grupo.grupo);
  }

  const duplicidades: ResultadoDaVerificacao["duplicidades"] = [];
  for (const chave of [...new Set(grupos.map((g) => g.cadastro))]) {
    const cadastro = cadastroPorChave(chave);
    const linhas = await db.$queryRawUnsafe<{ nome: string; codigos: string[] }[]>(
      `SELECT upper(btrim(${ident(cadastro.colunaNome)})) AS nome,
              array_agg(${ident(cadastro.colunaCodigo)} ORDER BY ${ident(cadastro.colunaCodigo)})::text[] AS codigos
       FROM ${ident(cadastro.tabela)}
       GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`,
    );
    duplicidades.push(...linhas.map((linha) => ({ cadastro: chave, ...linha })));
  }
  return { problemas, conferidos, duplicidades };
}

export async function verificar(
  prisma: PrismaClient,
  grupos: readonly GrupoPlanejado[],
): Promise<ResultadoDaVerificacao> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
      return verificarCom(tx, grupos);
    },
    { maxWait: 10_000, timeout: 600_000 },
  );
}

/* ------------------------------------------------------------------ *
 * Saída legível
 * ------------------------------------------------------------------ */

export function descreverEfeito(efeito: Record<string, EfeitoNaTabela>): string {
  const partes = Object.entries(efeito).map(([tabela, { ins, upd, del }]) => {
    const deltas = [ins !== 0 ? `+${ins}` : null, upd !== 0 ? `~${upd}` : null, del !== 0 ? `-${del}` : null];
    return `${tabela} ${deltas.filter(Boolean).join(" ")}`;
  });
  return partes.length > 0 ? partes.join("; ") : "nenhuma tabela";
}

export function descreverPlano(plano: Plano, destino: string): string[] {
  const linhas = [
    `=== PLANO — saneamento de duplicidade de nome (${FERRAMENTA}) ===`,
    `banco: ${destino}`,
    `cadastros: ${plano.cadastros.join(", ")}`,
    `gerado em: ${plano.geradoEm}`,
    `impressão do plano: ${plano.impressao.slice(0, 12)}…`,
    "",
  ];
  if (plano.grupos.length === 0) linhas.push("Nenhum nome repetido nos cadastros do escopo.");

  for (const grupo of plano.grupos) {
    linhas.push(`[${grupo.situacao}] ${grupo.grupo} — ${grupo.rotulo} "${grupo.canonico.nome}"`);
    linhas.push(`  canônico: ${grupo.canonico.codigo} — ${grupo.explicacao}`);
    for (const absorvido of grupo.absorvidos) {
      const referencias = absorvido.referencias
        .map((r) => `${r.tabela}.${r.coluna}=${r.linhas}`)
        .join(", ");
      linhas.push(`  absorvido: ${absorvido.codigo} (referências: ${referencias || "nenhuma"})`);
    }
    if (grupo.movimentos.length > 0) {
      linhas.push(`  move: ${grupo.movimentos.map((m) => `${m.tabela}.${m.coluna}=${m.linhas}`).join(", ")}`);
    }
    if (grupo.camposPerdidos.length > 0) {
      linhas.push(
        `  campos que somem com o absorvido: ${grupo.camposPerdidos.map((c) => `${c.codigo}.${c.coluna}="${c.valor}"`).join(", ")}`,
      );
    }
    for (const motivo of grupo.motivos) linhas.push(`  ABORTAR: ${motivo}`);
    linhas.push("");
  }

  const prontos = plano.grupos.filter((g) => g.situacao === "PRONTO");
  const bloqueados = plano.grupos.filter((g) => g.situacao === "BLOQUEADO");
  linhas.push(
    `resumo: ${plano.grupos.length} grupo(s) — ${prontos.length} PRONTO, ${bloqueados.length} BLOQUEADO (revisão necessária)`,
    `efeito esperado: ${descreverEfeito(plano.efeitoEsperado)}`,
  );
  return linhas;
}

export function descreverVerificacao(resultado: ResultadoDaVerificacao): string[] {
  const linhas = [
    "=== VERIFY ===",
    `grupos conferidos: ${resultado.conferidos.length > 0 ? resultado.conferidos.join(", ") : "nenhum"}`,
  ];
  for (const problema of resultado.problemas) linhas.push(`  PROBLEMA: ${problema}`);
  if (resultado.duplicidades.length > 0) {
    linhas.push(`duplicidades restantes: ${resultado.duplicidades.length}`);
    for (const duplicidade of resultado.duplicidades) {
      linhas.push(`  ${duplicidade.cadastro} "${duplicidade.nome}": ${duplicidade.codigos.join(", ")}`);
    }
  } else {
    linhas.push("duplicidades restantes: nenhuma");
  }
  linhas.push(resultado.problemas.length === 0 ? "VERIFY: OK" : "VERIFY: FALHOU");
  return linhas;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const argumento = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);

const lista = (nome: string): string[] =>
  process.argv
    .filter((a) => a.startsWith(`--${nome}=`))
    .flatMap((a) => a.slice(nome.length + 3).split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

function gravar(arquivo: string, conteudo: string | Buffer): void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
}

/** As tabelas que o plano vai mexer — o que o backup precisa cobrir. */
export function tabelasDoPlano(plano: Plano): string[] {
  const tabelas = new Set<string>();
  for (const grupo of plano.grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    tabelas.add(cadastroPorChave(grupo.cadastro).tabela);
    for (const movimento of grupo.movimentos) tabelas.add(movimento.tabela);
  }
  return [...tabelas].sort();
}

export interface BackupLogico {
  mecanismo?: string;
  falhas?: unknown[];
  contagens?: Record<string, number>;
  dados?: Record<string, { id?: string }[]>;
}

/**
 * O backup cobre o que o APPLY vai mexer?
 *
 * Não basta existir: para cada tabela do plano, o backup precisa ter o model
 * correspondente, com a MESMA contagem de agora — backup de antes de outra
 * gravação não restaura este estado —, e precisa conter linha a linha cada
 * registro que vai ser removido. Backup que não restaura é backup que dá
 * coragem sem dar segurança.
 */
export function conferirBackup(
  backup: unknown,
  plano: Plano,
  modelPorTabela: Record<string, string>,
  contagensAtuais: Record<string, number>,
): string[] {
  const arquivo = backup as BackupLogico | null;
  if (!arquivo || arquivo.mecanismo !== "prisma-logical-json" || !arquivo.contagens || !arquivo.dados) {
    return ["não é um backup de scripts/maintenance/prod-backup-json.mjs"];
  }
  if (arquivo.falhas?.length) return [`o backup registrou ${arquivo.falhas.length} falha(s)`];

  const problemas: string[] = [];
  for (const tabela of tabelasDoPlano(plano)) {
    const model = modelPorTabela[tabela];
    if (!model) {
      problemas.push(`${tabela}: sem model correspondente no client do Prisma`);
      continue;
    }
    if (arquivo.contagens[model] === undefined) {
      problemas.push(`${model} (${tabela}) não está no backup`);
      continue;
    }
    if (arquivo.contagens[model] !== contagensAtuais[model]) {
      problemas.push(
        `${model}: backup ${String(arquivo.contagens[model])} · agora ${String(contagensAtuais[model])}`,
      );
    }
  }
  for (const grupo of plano.grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    const model = modelPorTabela[cadastroPorChave(grupo.cadastro).tabela];
    const linhas = model ? (arquivo.dados[model] ?? []) : [];
    for (const absorvido of grupo.absorvidos) {
      if (!linhas.some((linha) => linha.id === absorvido.id)) {
        problemas.push(`${grupo.grupo}: ${absorvido.codigo} não está no backup`);
      }
    }
  }
  return problemas;
}

async function main(): Promise<void> {
  const comando = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!comando || !["plan", "apply", "verify"].includes(comando)) {
    console.error(
      "uso: master-data-duplicate-sanitization.ts plan|apply|verify [--cadastro=…] [--plano=…] [--backup=…] [--confirmar-banco=…] [--grupo=…] [--excel=…]",
    );
    process.exitCode = 1;
    return;
  }
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL ausente.");
  if (comando === "apply") exigirBancoLocal();
  const destino = descreverDestino(url);
  const arquivoPlano = argumento("plano");
  const arquivoExcel = argumento("excel");

  const escolhidos = lista("cadastro");
  const chaves = escolhidos.length > 0 ? escolhidos : CADASTROS_MESTRE_NO_BANCO.map((c) => c.chave);
  for (const chave of chaves) cadastroPorChave(chave);

  // O client é o da API, como nos vizinhos: `@prisma/client` não resolve a partir de `scripts/`.
  const cliente = createRequire(`${process.cwd()}/apps/api/package.json`)("@prisma/client") as {
    PrismaClient: new () => PrismaClient;
    Prisma: { dmmf: { datamodel: { models: { name: string; dbName: string | null }[] } } };
  };
  // `@@map` do schema: `industrial_resources` vira `IndustrialResource`, que
  // é como o backup lógico nomeia os conjuntos.
  const modelPorTabela: Record<string, string> = Object.fromEntries(
    cliente.Prisma.dmmf.datamodel.models.map((model) => [model.dbName ?? model.name, model.name]),
  );
  const prisma = new cliente.PrismaClient();
  try {
    if (comando === "plan") {
      const plano = await planejar(prisma, chaves);
      console.log(descreverPlano(plano, destino).join("\n"));
      if (arquivoPlano) {
        gravar(arquivoPlano, `${JSON.stringify(plano, null, 2)}\n`);
        console.log(`\nPlano salvo em ${arquivoPlano}`);
      }
      if (arquivoExcel) {
        gravar(arquivoExcel, gerarXlsx(planilhaDoSaneamento(plano, [], plano.variantes)));
        console.log(`Planilha salva em ${arquivoExcel}`);
      }
      console.log("\nSomente leitura: nada foi alterado.");
      process.exitCode = plano.grupos.every((g) => g.situacao === "PRONTO") ? 0 : 2;
      return;
    }

    if (!arquivoPlano) throw new Error(`${comando.toUpperCase()} exige --plano=<plano.json>.`);
    const plano = JSON.parse(fs.readFileSync(arquivoPlano, "utf8")) as Plano;

    if (comando === "verify") {
      const resultado = await verificar(prisma, plano.grupos);
      console.log(descreverVerificacao(resultado).join("\n"));
      process.exitCode = resultado.problemas.length === 0 ? 0 : 1;
      return;
    }

    const arquivoBackup = argumento("backup");
    const confirmacao = argumento("confirmar-banco");
    if (!arquivoBackup || !confirmacao) {
      throw new Error("APPLY exige --plano=<plano.json>, --backup=<backup.json> e --confirmar-banco=<banco>.");
    }
    const banco = await bancoAtual(prisma);
    if (confirmacao !== banco) {
      throw new Error(`--confirmar-banco=${confirmacao} não é o banco conectado (${banco}).`);
    }
    if (plano.banco !== banco) throw new Error(`o plano é do banco ${plano.banco}, não de ${banco}.`);
    if (!fs.existsSync(arquivoBackup)) throw new Error(`backup ${arquivoBackup} não existe. Nada foi alterado.`);
    const backup = JSON.parse(fs.readFileSync(arquivoBackup, "utf8")) as BackupLogico;
    const contagensAtuais: Record<string, number> = {};
    for (const tabela of tabelasDoPlano(plano)) {
      const model = modelPorTabela[tabela];
      if (!model) continue;
      contagensAtuais[model] = await contar(prisma, `SELECT count(*)::int AS n FROM ${ident(tabela)}`);
    }
    const problemasDoBackup = conferirBackup(backup, plano, modelPorTabela, contagensAtuais);
    if (problemasDoBackup.length > 0) {
      throw new Error(`o backup não cobre o plano. Nada foi alterado.\n  - ${problemasDoBackup.join("\n  - ")}`);
    }

    console.log(descreverPlano(plano, destino).join("\n"));
    console.log(`\nBackup ${arquivoBackup}: cobre o plano (contagens iguais às atuais).`);
    console.log(`Tabelas que o plano mexe: ${tabelasDoPlano(plano).join(", ") || "nenhuma"}`);
    console.log("\n=== APLICANDO (uma transação por grupo) ===");
    const resultados = await aplicar(prisma, plano, { somente: lista("grupo") });
    for (const resultado of resultados) {
      const detalhe = resultado.situacao === "APLICADO" ? descreverEfeito(resultado.efeito) : resultado.motivo;
      console.log(`  ${resultado.situacao.padEnd(9)} ${resultado.grupo} — ${detalhe}`);
    }

    const conferencia = await verificar(prisma, plano.grupos.filter((g) => resultados.some((r) => r.grupo === g.grupo && r.situacao === "APLICADO")));
    console.log(`\n${descreverVerificacao(conferencia).join("\n")}`);
    if (arquivoExcel) {
      gravar(arquivoExcel, gerarXlsx(planilhaDoSaneamento(plano, resultados, plano.variantes)));
      console.log(`\nPlanilha salva em ${arquivoExcel}`);
    }
    const falhou = resultados.some((r) => r.situacao === "FALHOU");
    process.exitCode = conferencia.problemas.length === 0 && !falhou ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Importado pelo teste não conecta em nada.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/maintenance/master-data-duplicate-sanitization.ts")) {
  main().catch((erro: unknown) => {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`FALHOU: ${mensagem.replace(/postgres(ql)?:\/\/\S*/gi, "<conexão omitida>")}`);
    process.exitCode = 1;
  });
}
