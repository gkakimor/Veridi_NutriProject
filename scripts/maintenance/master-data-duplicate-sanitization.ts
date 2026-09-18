import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { descreverDestino, exigirBancoLocal } from "../local-db-guard.mjs";
import { DECISOES_DE_DUPLICATAS } from "../veridi-import/item-duplicate-decisions.js";
import { decisoesDaOnda, gruposDaOnda, impressaoDasDecisoes } from "../veridi-import/item-duplicates.js";
import type { DecisaoDeDuplicata, GrupoDeDecisao } from "../veridi-import/item-duplicates.js";
import { avaliarRelacao, executarRelacao, lerRelacoes } from "./item-duplicate-sanitization.js";
import type { OperacaoDeRelacao } from "./item-duplicate-sanitization.js";
import {
  CADASTROS_MESTRE_NO_BANCO,
  cadastroPorChave,
  compararCampos,
  consolidarTermos,
  escolherCanonico,
  motivoDoFundidoEmTexto,
} from "./master-data-catalog.js";
import type {
  CadastroMestreNoBanco,
  CampoPerdido,
  ConflitoDeCampo,
  MotivoDoCanonico,
  MotivoDoFundido,
  RegistroDoGrupo,
} from "./master-data-catalog.js";
import { planilhaDaOnda, planilhaDoSaneamento } from "./master-data-duplicate-report.js";
import type { VarianteDeNome } from "./master-data-duplicate-report.js";
import { gerarXlsx } from "./xlsx-writer.js";

/**
 * Saneamento de nome duplicado nos cadastros mestre — PLAN → APPLY → VERIFY
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts plan \
 *     [--cadastro=ITEM,CUSTOMER | --onda=2] [--plano=<plano.json>] [--excel=<planilha.xlsx>]
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts apply [--onda=2] \
 *     --plano=<plano.json> --backup=<backup.json> --confirmar-banco=<banco> [--grupo=ITEM/…] \
 *     [--resultado=<resultado.json>] [--excel=<planilha.xlsx>]
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/master-data-duplicate-sanitization.ts verify [--onda=2] \
 *     --plano=<plano.json> [--resultado=<resultado.json> --excel=<planilha.xlsx>]
 *
 * Dois modos. **Automático** (sem `--onda`): a regra do nome acha os grupos.
 * **De decisão** (`--onda`): os grupos vêm do arquivo de decisão de Item
 * (`scripts/veridi-import/item-duplicate-decisions.ts`) — inclusive o par
 * nomeado fora da regra (acento) e a consolidação declarada de campo no
 * canônico —, e a onda só aplica com TODOS os grupos PRONTO
 * (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01).
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
 * Grupo de Item cujo código está no arquivo de decisão não entra no modo
 * automático: quem o executa é a decisão — a Onda A pela ferramenta de Item
 * (`item-duplicate-sanitization.ts`), da Onda 2 em diante por esta, com
 * `--onda`. As duas nunca disputam o mesmo registro.
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

/** Campo do canônico que a decisão consolida — o ANTES e o DEPOIS do PLAN. */
export interface AtualizacaoDoCanonico {
  coluna: string;
  antes: string | null;
  depois: string;
  /**
   * Termo que ficou na grafia do canônico: só pela caixa, ou pela equivalência
   * declarada na decisão do grupo. Plano gravado antes do motivo não o tem.
   */
  fundidos: { termo: string; em: string; motivo?: MotivoDoFundido }[];
}

/** Relação Item × Fornecedor de um absorvido, pela regra da §110. */
export interface RelacaoPlanejada {
  absorvido: string;
  codigo: string;
  operacao: OperacaoDeRelacao;
}

export interface GrupoPlanejado {
  /** `ITEM/ARABINOGALACTANA` — estável entre execuções. */
  grupo: string;
  cadastro: string;
  rotulo: string;
  chaveDoNome: string;
  /** `JA_SANEADO` só no modo de decisão: o grupo da decisão já saiu do banco. */
  situacao: "PRONTO" | "BLOQUEADO" | "JA_SANEADO";
  motivos: string[];
  criterio: MotivoDoCanonico;
  explicacao: string;
  canonico: LadoDoPlano;
  absorvidos: LadoDoPlano[];
  conflitos: ConflitoDeCampo[];
  camposPerdidos: CampoPerdido[];
  movimentos: Movimento[];
  impressao: string;
  /** Onda e grupo do arquivo de decisão. Ausente: grupo achado pela regra automática. */
  decisao?: { onda: string; grupo: string } | undefined;
  /**
   * Nomes (sem caixa) que o grupo ocupa — o dele e, no par nomeado, o do
   * absorvido. O VERIFY cobra que só o do canônico sobre.
   */
  nomesDoGrupo?: string[] | undefined;
  /** canonicalUpdates: o que a decisão escreve no canônico, e nada além. */
  atualizacoes?: AtualizacaoDoCanonico[] | undefined;
  /** Relações Item × Fornecedor dos absorvidos: movidas ou consolidadas. */
  relacoes?: RelacaoPlanejada[] | undefined;
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
  /** Modo de decisão: a onda do arquivo de decisão e a impressão dela. */
  onda?: string | undefined;
  decisoes?: string | undefined;
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
 * `outrosIds` é o grupo inteiro menos o absorvido — o canônico E os outros
 * absorvidos. Dois absorvidos na mesma versão de Formulação viram o canônico
 * duas vezes na mesma versão, mesmo que o canônico não estivesse lá.
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
  outrosIds: readonly string[],
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
           WHERE b.${ident(coluna)}::text = ANY($2::text[])${iguais ? ` AND ${iguais}` : ""}
         )`,
      idAbsorvido,
      [...outrosIds],
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

/**
 * Códigos de Item que o arquivo de decisão já decidiu, com a onda de cada um.
 * A regra automática não os toca: quem executa é a decisão — a Onda A pela
 * ferramenta de Item, da Onda 2 em diante por esta, com `--onda`.
 */
const ONDA_DO_CODIGO_DECIDIDO = new Map(
  DECISOES_DE_DUPLICATAS.flatMap((d) => [
    [d.absorvido.codigo, d.onda] as const,
    [d.canonico.codigo, d.onda] as const,
  ]),
);

const ferramentaDaOnda = (onda: string): string =>
  onda === "A" ? "item-duplicate-sanitization.ts" : "master-data-duplicate-sanitization.ts";

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
  /** Modo de decisão: canonicalUpdates, relações e as linhas cruas delas. */
  extra?: Record<string, unknown>,
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
      ...(extra ? { extra } : {}),
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
    const decididos = registros
      .map((r) => [r.codigo, ONDA_DO_CODIGO_DECIDIDO.get(r.codigo)] as const)
      .filter((par): par is readonly [string, string] => par[1] !== undefined);
    for (const onda of [...new Set(decididos.map(([, o]) => o))]) {
      const codigos = decididos.filter(([, o]) => o === onda).map(([c]) => c);
      motivos.push(
        `${codigos.join(", ")} está no arquivo de decisão (Onda ${onda}) — quem executa é ${ferramentaDaOnda(onda)} --onda=${onda}`,
      );
    }
  }

  const idsDoGrupo = registros.map((r) => r.id);
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
          idsDoGrupo.filter((id) => id !== absorvido.id),
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

/* ------------------------------------------------------------------ *
 * Modo de decisão (Onda 2 em diante)
 * ------------------------------------------------------------------ */

/** Colunas que uma decisão pode escrever no canônico. Qualquer outra aborta. */
const COLUNAS_CONSOLIDAVEIS = new Set(["declaredNutrient"]);

/** A relação Item × Fornecedor tem regra própria (§110) — não é movimento genérico. */
const eDaRelacao = (referencia: ColunaDeReferencia): boolean =>
  referencia.tabela === "supplier_items" && referencia.coluna === "itemId";

/**
 * Um grupo do arquivo de decisão, do jeito que entra no plano.
 *
 * O grupo vem da DECISÃO, pelos códigos — não pelo nome. É assim que o par
 * nomeado (a sílica) entra sem que a regra geral deixe de preservar acento. O
 * resto é a disciplina do modo automático, com três passos a mais:
 *
 *  - o critério de canônico tem de chegar ao canônico que a decisão diz;
 *  - a consolidação tem de dar EXATAMENTE o valor escrito na decisão, e é a
 *    única escrita no canônico (canonicalUpdates);
 *  - a relação Item × Fornecedor segue a regra da §110, com o mesmo código da
 *    ferramenta de Item.
 */
async function planejarGrupoDaDecisao(
  db: Banco,
  cadastro: CadastroMestreNoBanco,
  catalogo: readonly ColunaDeReferencia[],
  indices: readonly IndiceUnico[],
  decisao: GrupoDeDecisao,
): Promise<GrupoPlanejado> {
  const motivos: string[] = [];
  const codigos = [decisao.canonico.codigo, ...decisao.absorvidos.map((a) => a.codigo)];
  const nomesDecididos = [decisao.nome, ...decisao.absorvidos.map((a) => a.nomeDoAbsorvido ?? decisao.nome)];
  const chaveDoNome = decisao.nome.trim().toUpperCase();

  const porId = new Map<string, ReferenciaContada[]>();
  const registros: RegistroDoGrupo[] = [];
  for (const { bruto } of await db.$queryRawUnsafe<{ bruto: string }[]>(
    `SELECT to_jsonb(x)::text AS bruto FROM ${ident(cadastro.tabela)} x
     WHERE ${ident(cadastro.colunaCodigo)} = ANY($1::text[])
     ORDER BY ${ident(cadastro.colunaCodigo)}`,
    codigos,
  )) {
    const dados = JSON.parse(bruto) as Registro;
    const id = comoTexto(dados, cadastro.colunaId)!;
    const codigo = comoTexto(dados, cadastro.colunaCodigo)!;
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

  const lado = (r: RegistroDoGrupo): LadoDoPlano => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    criadoEm: r.criadoEm,
    referencias: porId.get(r.id) ?? [],
    dados: r.dados,
  });
  const ausente = (codigo: string, nome: string): LadoDoPlano => ({
    id: "",
    codigo,
    nome,
    criadoEm: null,
    referencias: [],
    dados: {},
  });
  const canonico = registros.find((r) => r.codigo === decisao.canonico.codigo) ?? null;
  const absorvidos = registros
    .filter((r) => r.codigo !== decisao.canonico.codigo)
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const fechar = (
    situacao: GrupoPlanejado["situacao"],
    partes: Partial<GrupoPlanejado> & { extra?: Record<string, unknown> } = {},
  ): GrupoPlanejado => {
    const { extra, ...resto } = partes;
    const movimentos = resto.movimentos ?? [];
    return {
      grupo: `${cadastro.chave}/${chaveDoNome}`,
      cadastro: cadastro.chave,
      rotulo: cadastro.rotulo,
      chaveDoNome,
      situacao,
      motivos,
      criterio: resto.criterio ?? "menor-codigo",
      explicacao: resto.explicacao ?? "",
      canonico: canonico ? lado(canonico) : ausente(decisao.canonico.codigo, decisao.nome),
      absorvidos: absorvidos.map(lado),
      conflitos: resto.conflitos ?? [],
      camposPerdidos: resto.camposPerdidos ?? [],
      movimentos,
      impressao: impressaoDoGrupo(chaveDoNome, registros, movimentos, {
        decisao: [decisao.onda, decisao.grupo, codigos],
        ...(extra ?? {}),
      }),
      decisao: { onda: decisao.onda, grupo: decisao.grupo },
      nomesDoGrupo: [...new Set(nomesDecididos.map((n) => n.trim().toUpperCase()))],
      atualizacoes: resto.atualizacoes ?? [],
      relacoes: resto.relacoes ?? [],
    };
  };

  if (cadastro.chave !== "ITEM") {
    motivos.push("o modo de decisão é do cadastro de Item: o arquivo de decisão é o de-para de Item");
    return fechar("BLOQUEADO");
  }
  if (!canonico) {
    motivos.push(`canônico ${decisao.canonico.codigo} não existe`);
    return fechar("BLOQUEADO");
  }
  const faltando = decisao.absorvidos.filter((a) => !registros.some((r) => r.codigo === a.codigo));
  if (faltando.length === decisao.absorvidos.length) {
    // Rodar de novo depois do APPLY: o grupo já saiu. Só é "já saneado" se o
    // canônico tem o valor que a decisão consolidou.
    const valor = comoTexto(canonico.dados, "declaredNutrient");
    if (decisao.consolidar && valor !== decisao.consolidar.declaredNutrient) {
      motivos.push(
        `os absorvidos já saíram, e o declaredNutrient do canônico é "${valor ?? ""}", não "${decisao.consolidar.declaredNutrient}"`,
      );
      return fechar("BLOQUEADO");
    }
    return fechar("JA_SANEADO");
  }
  if (faltando.length > 0) {
    motivos.push(`grupo pela metade: ${faltando.map((a) => a.codigo).join(", ")} já não existe(m)`);
    return fechar("BLOQUEADO");
  }

  // A decisão ainda descreve estes registros?
  const conferir = (r: RegistroDoGrupo, planilha: string, nomeEsperado: string, papel: string): void => {
    const gravado = comoTexto(r.dados, "externalCode");
    if (gravado !== planilha) {
      motivos.push(`${papel} ${r.codigo} tem código da planilha "${gravado ?? ""}", e a decisão diz "${planilha}"`);
    }
    if (r.nome.trim().toUpperCase() !== nomeEsperado.trim().toUpperCase()) {
      motivos.push(`${papel} ${r.codigo} se chama "${r.nome}", e a decisão é para "${nomeEsperado}"`);
    }
    if (r.dados["active"] !== true) motivos.push(`${papel} ${r.codigo} está inativo`);
  };
  conferir(canonico, decisao.canonico.codigoPlanilha, decisao.nome, "canônico");
  for (const absorvido of absorvidos) {
    const decidido = decisao.absorvidos.find((a) => a.codigo === absorvido.codigo)!;
    conferir(absorvido, decidido.codigoPlanilha, decidido.nomeDoAbsorvido ?? decisao.nome, "absorvido");
  }

  // Item com o nome do grupo que a decisão não conhece: o grupo cresceu.
  const intrusos = await db.$queryRawUnsafe<{ codigo: string }[]>(
    `SELECT ${ident(cadastro.colunaCodigo)} AS codigo FROM ${ident(cadastro.tabela)}
     WHERE upper(btrim(${ident(cadastro.colunaNome)})) IN (SELECT upper(btrim(n)) FROM unnest($1::text[]) AS n)
       AND ${ident(cadastro.colunaCodigo)} <> ALL($2::text[])
     ORDER BY 1`,
    nomesDecididos,
    codigos,
  );
  for (const { codigo } of intrusos) {
    motivos.push(`${codigo} tem o nome do grupo e não está na decisão: o grupo mudou desde a decisão`);
  }

  // O critério aprovado tem de chegar ao canônico da decisão.
  const escolha = escolherCanonico(registros, cadastro);
  if (escolha.canonico.codigo !== canonico.codigo) {
    motivos.push(
      `o critério escolhe ${escolha.canonico.codigo} ("${escolha.explicacao}"), e a decisão diz ${canonico.codigo}`,
    );
  }

  // Campo a campo: só a coluna que a decisão consolida pode divergir.
  // `equivalentes` é da regra do cálculo, não uma coluna.
  const consolidadas = Object.keys(decisao.consolidar ?? {}).filter((chave) => chave !== "equivalentes");
  for (const coluna of consolidadas) {
    if (!COLUNAS_CONSOLIDAVEIS.has(coluna)) motivos.push(`a decisão consolida "${coluna}", que a ferramenta não sabe consolidar`);
  }
  const { conflitos, perdidos } = compararCampos(canonico, absorvidos, {
    ...cadastro,
    colunasNeutras: [...cadastro.colunasNeutras, ...consolidadas],
  });
  for (const conflito of conflitos) {
    motivos.push(`conflito material em "${conflito.coluna}": ${conflito.valores.map((v) => `"${v}"`).join(" × ")}`);
  }

  // canonicalUpdates: o valor que a regra calcula tem de ser o da decisão.
  const atualizacoes: AtualizacaoDoCanonico[] = [];
  if (decisao.consolidar) {
    const antes = comoTexto(canonico.dados, "declaredNutrient");
    // Só a equivalência que a decisão DESTE grupo declara; sem ela, termo que
    // difere por qualquer coisa além de espaço nas pontas e caixa fica separado.
    const { valor, fundidos } = consolidarTermos(
      [antes, ...absorvidos.map((a) => comoTexto(a.dados, "declaredNutrient"))],
      decisao.consolidar.equivalentes ?? {},
    );
    const esperado = decisao.consolidar.declaredNutrient;
    if (valor !== esperado) {
      motivos.push(`declaredNutrient consolidado dá "${valor ?? ""}", e a decisão espera "${esperado}"`);
    } else if (valor !== antes) {
      atualizacoes.push({ coluna: "declaredNutrient", antes, depois: valor, fundidos });
    }
  }

  // Relação Item × Fornecedor: a regra da §110, com o código da ferramenta de Item.
  const relacoes: RelacaoPlanejada[] = [];
  const brutosDasRelacoes: string[] = [];
  const fornecedoresQueChegam = new Set<string>();
  for (const absorvido of absorvidos) {
    for (const lida of await lerRelacoes(db, absorvido.id, canonico.id)) {
      brutosDasRelacoes.push(
        lida.relacao.bruto,
        ...lida.ofertas.map((o) => o.bruto),
        ...lida.eventos.map((e) => e.bruto),
        ...(lida.canonica ? [lida.canonica.relacao.bruto, ...lida.canonica.eventos.map((e) => e.bruto)] : []),
      );
      const avaliacao = avaliarRelacao(lida);
      motivos.push(...avaliacao.motivos.map((m) => `${absorvido.codigo}: ${m}`));
      if (!avaliacao.operacao) continue;
      if (avaliacao.operacao.tipo === "MOVER_RELACAO") {
        // Dois absorvidos com o mesmo fornecedor, e o canônico sem ele: os dois
        // chegariam ao canônico e repetiriam (fornecedor, item).
        const fornecedor = comoTexto(lida.relacao.dados, "supplierId")!;
        if (fornecedoresQueChegam.has(fornecedor)) {
          motivos.push(`${absorvido.codigo}: ${lida.fornecedor} chegaria ao canônico por dois absorvidos do grupo`);
          continue;
        }
        fornecedoresQueChegam.add(fornecedor);
      }
      relacoes.push({ absorvido: absorvido.id, codigo: absorvido.codigo, operacao: avaliacao.operacao });
    }
  }

  // Demais referências: movimento genérico, com colisão contra o grupo inteiro.
  const idsDoGrupo = registros.map((r) => r.id);
  const movimentos: Movimento[] = [];
  for (const absorvido of absorvidos) {
    for (const referencia of porId.get(absorvido.id) ?? []) {
      if (eDaRelacao(referencia)) continue;
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
          idsDoGrupo.filter((id) => id !== absorvido.id),
        )),
      );
      movimentos.push({ tabela: referencia.tabela, coluna: referencia.coluna, linhas: referencia.linhas });
    }
  }

  return fechar(motivos.length === 0 ? "PRONTO" : "BLOQUEADO", {
    criterio: escolha.motivo,
    explicacao: escolha.explicacao,
    conflitos,
    camposPerdidos: perdidos,
    movimentos,
    atualizacoes,
    relacoes,
    extra: { atualizacoes, relacoes, brutosDasRelacoes },
  });
}

/** O efeito por tabela que a transação de um plano deve produzir — e só ele. */
export function efeitoEsperado(grupos: readonly GrupoPlanejado[]): Record<string, EfeitoNaTabela> {
  const efeito: Record<string, EfeitoNaTabela> = {};
  const somar = (tabela: string, delta: Partial<EfeitoNaTabela>): void => {
    // Delta zero não entra: o retrato do banco também não mostra tabela parada,
    // e as duas formas têm de ser iguais byte a byte.
    if (!delta.ins && !delta.upd && !delta.del) return;
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
    for (const { operacao } of grupo.relacoes ?? []) {
      if (operacao.tipo === "CONSOLIDAR_RELACAO") {
        somar("supplier_item_offers", { upd: operacao.ofertas.length });
        somar("supplier_item_qualification_history", { upd: operacao.eventos.length });
        somar("supplier_items", { del: 1 });
      } else {
        somar("supplier_items", { upd: 1 });
      }
    }
    for (const movimento of grupo.movimentos) somar(movimento.tabela, { upd: movimento.linhas });
    // canonicalUpdates: um UPDATE só no canônico, com todas as colunas previstas.
    if ((grupo.atualizacoes ?? []).length > 0) somar(cadastro.tabela, { upd: 1 });
    somar(cadastro.tabela, { del: grupo.absorvidos.length });
  }
  return emOrdem(efeito);
}

export interface OpcoesDoPlano {
  /** As variantes são leitura extra; o APPLY relê o plano e não precisa delas. */
  comVariantes?: boolean | undefined;
  /**
   * Modo de decisão: os grupos desta onda do arquivo de decisão, e só eles —
   * nenhum grupo achado pela regra automática entra.
   */
  onda?: string | undefined;
  /** Modo de decisão: só estes grupos da onda (o APPLY relê um por vez). */
  grupos?: readonly string[] | undefined;
  /** Ponto de teste: decisões no lugar do arquivo real. */
  decisoes?: readonly DecisaoDeDuplicata[] | undefined;
}

export async function planejarCom(
  db: Banco,
  chaves: readonly string[],
  opcoes: OpcoesDoPlano = {},
): Promise<Plano> {
  const grupos: GrupoPlanejado[] = [];
  const variantes: VarianteDeNome[] = [];
  if (opcoes.onda !== undefined) {
    if (chaves.length !== 1 || chaves[0] !== "ITEM") {
      throw new Error("o modo de decisão é do cadastro de Item: o arquivo de decisão é o de-para de Item.");
    }
    const cadastro = cadastroPorChave("ITEM");
    const catalogo = await lerCatalogo(db, cadastro);
    const tabelas = [...new Set(catalogo.filter((c) => c.tipo !== "json").map((c) => c.tabela))];
    const indices = await lerIndicesUnicos(db, tabelas);
    for (const decisao of gruposDaOnda(opcoes.onda, opcoes.decisoes)) {
      if (opcoes.grupos && !opcoes.grupos.includes(decisao.grupo)) continue;
      grupos.push(await planejarGrupoDaDecisao(db, cadastro, catalogo, indices, decisao));
    }
  } else {
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
  }
  grupos.sort((a, b) => a.grupo.localeCompare(b.grupo));

  const decisoes =
    opcoes.onda !== undefined ? impressaoDasDecisoes(decisoesDaOnda(opcoes.onda, opcoes.decisoes)) : undefined;
  const plano: Plano = {
    ferramenta: FERRAMENTA,
    formato: FORMATO,
    geradoEm: new Date().toISOString(),
    banco: await bancoAtual(db),
    cadastros: [...chaves],
    grupos,
    variantes,
    efeitoEsperado: efeitoEsperado(grupos),
    pronto: grupos.every((g) => g.situacao !== "BLOQUEADO"),
    impressao: "",
    ...(opcoes.onda !== undefined ? { onda: opcoes.onda, decisoes } : {}),
  };
  plano.impressao = sha256(
    JSON.stringify({
      cadastros: plano.cadastros,
      onda: plano.onda ?? null,
      decisoes: plano.decisoes ?? null,
      grupos: grupos.map((g) => [g.grupo, g.situacao, g.impressao, g.canonico.id, g.absorvidos.map((a) => a.id)]),
      efeito: plano.efeitoEsperado,
    }),
  );
  return plano;
}

/** PLAN: somente leitura, sempre. */
export async function planejar(
  prisma: PrismaClient,
  chaves: readonly string[],
  opcoes: { onda?: string | undefined; decisoes?: readonly DecisaoDeDuplicata[] | undefined } = {},
): Promise<Plano> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
      return planejarCom(tx, chaves, {
        comVariantes: opcoes.onda === undefined,
        onda: opcoes.onda,
        decisoes: opcoes.decisoes,
      });
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
  if (JSON.stringify(aprovado.atualizacoes ?? []) !== JSON.stringify(agora.atualizacoes ?? [])) {
    divergencias.push(`${agora.grupo}: o que se escreve no canônico mudou desde o plano`);
  }
  if (JSON.stringify(aprovado.relacoes ?? []) !== JSON.stringify(agora.relacoes ?? [])) {
    divergencias.push(`${agora.grupo}: as relações com fornecedor mudaram desde o plano`);
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
  if (grupo.relacoes !== undefined) {
    // Relações dos dois lados, e o que pende delas: ofertas e homologação.
    const relacoes = `SELECT id FROM supplier_items WHERE "itemId"::text = ANY($1::text[])`;
    await tx.$queryRawUnsafe(`${relacoes} ORDER BY id FOR UPDATE`, ids);
    await tx.$queryRawUnsafe(
      `SELECT id FROM supplier_item_offers WHERE "supplierItemId" IN (${relacoes}) ORDER BY id FOR UPDATE`,
      ids,
    );
    await tx.$queryRawUnsafe(
      `SELECT id FROM supplier_item_qualification_history WHERE "supplierItemId" IN (${relacoes}) ORDER BY id FOR UPDATE`,
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

  // 1. Relação Item × Fornecedor, pela regra da §110 (modo de decisão).
  for (const { absorvido, operacao } of grupo.relacoes ?? []) {
    await executarRelacao(tx, operacao, absorvido, grupo.canonico.id, (obtido, esperado, oque) =>
      exigir(obtido, esperado, oque),
    );
  }

  // 2. As demais referências: só o ponteiro muda, nenhum outro dado da linha.
  for (const absorvido of grupo.absorvidos) {
    for (const referencia of absorvido.referencias) {
      if (grupo.relacoes !== undefined && eDaRelacao(referencia)) continue;
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

  // 3. canonicalUpdates: só as colunas do plano, e só se o canônico ainda tem
  //    o valor de ANTES — compare-and-set, nenhuma escrita implícita.
  const atualizacoes = grupo.atualizacoes ?? [];
  if (atualizacoes.length > 0) {
    const n = atualizacoes.length;
    const novos = atualizacoes.map((a, i) => `${ident(a.coluna)} = $${i + 2}`);
    const antigos = atualizacoes.map((a, i) => `${ident(a.coluna)} IS NOT DISTINCT FROM $${i + 2 + n}`);
    const mexidas = await tx.$executeRawUnsafe(
      `UPDATE ${ident(cadastro.tabela)} SET ${novos.join(", ")}, "updatedAt" = now()
       WHERE ${ident(cadastro.colunaId)}::text = $1 AND ${antigos.join(" AND ")}`,
      grupo.canonico.id,
      ...atualizacoes.map((a) => a.depois),
      ...atualizacoes.map((a) => a.antes),
    );
    exigir(mexidas, 1, `canônico ${grupo.canonico.codigo} (${atualizacoes.map((a) => a.coluna).join(", ")})`);
  }

  // 4. Por último, o absorvido — com nada mais pendurado nele.
  const removidos = await tx.$executeRawUnsafe(
    `DELETE FROM ${ident(cadastro.tabela)} WHERE ${ident(cadastro.colunaId)}::text = ANY($1::text[])`,
    grupo.absorvidos.map((a) => a.id),
  );
  exigir(removidos, grupo.absorvidos.length, `DELETE em ${cadastro.tabela}`);
}

export interface ResultadoDoGrupo {
  grupo: string;
  situacao: "APLICADO" | "BLOQUEADO" | "FALHOU" | "JA_SANEADO";
  motivo: string | null;
  efeito: Record<string, EfeitoNaTabela>;
  aplicadoEm: string | null;
}

export interface OpcoesDaAplicacao {
  /** Só estes grupos; vazio = todos os `PRONTO` do plano. */
  somente?: readonly string[] | undefined;
  /** Ponto de teste: decisões no lugar do arquivo real (modo de decisão). */
  decisoes?: readonly DecisaoDeDuplicata[] | undefined;
  /**
   * Ponto de teste: a chave da trava consultiva. Suítes que rodam em paralelo
   * no mesmo banco usam chaves próprias para não se recusarem entre si; o CLI
   * nunca passa, e toda execução real disputa a mesma trava.
   */
  trava?: string | undefined;
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
  if (
    plano.onda !== undefined &&
    plano.decisoes !== impressaoDasDecisoes(decisoesDaOnda(plano.onda, opcoes.decisoes))
  ) {
    throw new Error(`ABORTADO: o arquivo de decisão da Onda ${plano.onda} mudou desde o plano. Refaça o PLAN.`);
  }
  const escolhidos = opcoes.somente && opcoes.somente.length > 0 ? new Set(opcoes.somente) : null;
  const resultados: ResultadoDoGrupo[] = [];

  for (const doPlano of plano.grupos) {
    if (escolhidos && !escolhidos.has(doPlano.grupo)) continue;
    if (doPlano.situacao === "JA_SANEADO") {
      resultados.push({
        grupo: doPlano.grupo,
        situacao: "JA_SANEADO",
        motivo: "o grupo da decisão já saiu do banco",
        efeito: {},
        aplicadoEm: null,
      });
      continue;
    }
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
            opcoes.trava ?? TRAVA,
          );
          if (trava?.travado !== true) {
            throw new Error("outra execução do saneamento está em andamento.");
          }
          const noInicio = await contadoresDaConexao(tx);
          await travarGrupo(tx, cadastro, doPlano);

          const agora = await planejarCom(
            tx,
            [doPlano.cadastro],
            plano.onda !== undefined && doPlano.decisao
              ? { onda: plano.onda, grupos: [doPlano.decisao.grupo], decisoes: opcoes.decisoes }
              : {},
          );
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

    // Par nomeado: o nome do absorvido não pode sobrar em cadastro nenhum.
    for (const nome of (grupo.nomesDoGrupo ?? []).filter((n) => n !== grupo.chaveDoNome)) {
      const sobra = await db.$queryRawUnsafe<{ codigo: string }[]>(
        `SELECT ${ident(cadastro.colunaCodigo)} AS codigo FROM ${ident(cadastro.tabela)}
         WHERE upper(btrim(${ident(cadastro.colunaNome)})) = upper(btrim($1)) ORDER BY 1`,
        nome,
      );
      if (sobra.length > 0) {
        problemas.push(`${grupo.grupo}: o nome "${nome}" continua em ${sobra.map((r) => r.codigo).join(", ")}`);
      }
    }

    // canonicalUpdates: o canônico tem o valor do plano.
    for (const atualizacao of grupo.atualizacoes ?? []) {
      const [linha] = await db.$queryRawUnsafe<{ valor: string | null }[]>(
        `SELECT ${ident(atualizacao.coluna)}::text AS valor FROM ${ident(cadastro.tabela)}
         WHERE ${ident(cadastro.colunaId)}::text = $1`,
        grupo.canonico.id,
      );
      if (linha?.valor !== atualizacao.depois) {
        problemas.push(
          `${grupo.grupo}: ${atualizacao.coluna} do canônico é "${linha?.valor ?? ""}", esperava "${atualizacao.depois}"`,
        );
      }
    }

    // Relações: a do absorvido saiu ou mudou de dono, e o que pendia dela está no canônico.
    for (const { operacao, codigo } of grupo.relacoes ?? []) {
      if (operacao.tipo === "MOVER_RELACAO") {
        const movida = await contar(
          db,
          `SELECT count(*)::int AS n FROM supplier_items WHERE id = $1 AND "itemId"::text = $2`,
          operacao.relacao,
          grupo.canonico.id,
        );
        if (movida !== 1) problemas.push(`${grupo.grupo}: a relação de ${codigo} com ${operacao.fornecedor} não está no canônico`);
        continue;
      }
      const velha = await contar(db, `SELECT count(*)::int AS n FROM supplier_items WHERE id = $1`, operacao.relacaoAbsorvida);
      if (velha !== 0) problemas.push(`${grupo.grupo}: a relação de ${codigo} com ${operacao.fornecedor} continua no banco`);
      const ofertas = await contar(
        db,
        `SELECT count(*)::int AS n FROM supplier_item_offers WHERE id = ANY($1::text[]) AND "supplierItemId" = $2`,
        operacao.ofertas.map((o) => o.id),
        operacao.relacaoCanonica,
      );
      if (ofertas !== operacao.ofertas.length) {
        problemas.push(`${grupo.grupo}: ${ofertas}/${operacao.ofertas.length} oferta(s) de ${operacao.fornecedor} na relação do canônico`);
      }
      const eventos = await contar(
        db,
        `SELECT count(*)::int AS n FROM supplier_item_qualification_history WHERE id = ANY($1::text[]) AND "supplierItemId" = $2`,
        operacao.eventos,
        operacao.relacaoCanonica,
      );
      if (eventos !== operacao.eventos.length) {
        problemas.push(`${grupo.grupo}: ${eventos}/${operacao.eventos.length} evento(s) de homologação de ${operacao.fornecedor} na relação do canônico`);
      }
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
    ...(plano.onda !== undefined
      ? [`onda: ${plano.onda} (arquivo de decisão, impressão ${(plano.decisoes ?? "").slice(0, 12)}…)`]
      : []),
    `gerado em: ${plano.geradoEm}`,
    `impressão do plano: ${plano.impressao.slice(0, 12)}…`,
    "",
  ];
  if (plano.grupos.length === 0) linhas.push("Nenhum nome repetido nos cadastros do escopo.");

  for (const grupo of plano.grupos) {
    const daDecisao = grupo.decisao ? ` · decisão ${grupo.decisao.onda}/${grupo.decisao.grupo}` : "";
    linhas.push(`[${grupo.situacao}] ${grupo.grupo} — ${grupo.rotulo} "${grupo.canonico.nome}"${daDecisao}`);
    linhas.push(`  canônico: ${grupo.canonico.codigo} — ${grupo.explicacao}`);
    for (const absorvido of grupo.absorvidos) {
      const referencias = absorvido.referencias
        .map((r) => `${r.tabela}.${r.coluna}=${r.linhas}`)
        .join(", ");
      const nome = absorvido.nome.trim().toUpperCase() !== grupo.chaveDoNome ? ` "${absorvido.nome}"` : "";
      linhas.push(`  absorvido: ${absorvido.codigo}${nome} (referências: ${referencias || "nenhuma"})`);
    }
    for (const atualizacao of grupo.atualizacoes ?? []) {
      linhas.push(`  ${atualizacao.coluna} do canônico: ANTES "${atualizacao.antes ?? ""}" → DEPOIS "${atualizacao.depois}"`);
      for (const { termo, em, motivo } of atualizacao.fundidos) {
        linhas.push(`    "${termo}" é o mesmo termo de "${em}" (${motivoDoFundidoEmTexto(motivo)}): fica "${em}"`);
      }
    }
    for (const { codigo, operacao } of grupo.relacoes ?? []) {
      linhas.push(
        operacao.tipo === "CONSOLIDAR_RELACAO"
          ? `  relação: ${codigo} × ${operacao.fornecedor} — o canônico já tem este fornecedor: ${operacao.ofertas.length} oferta(s) e ${operacao.eventos.length} evento(s) de homologação passam para a relação dele, e a do absorvido sai`
          : `  relação: ${codigo} × ${operacao.fornecedor} — passa inteira para o canônico (${operacao.ofertas} oferta(s), ${operacao.eventos} evento(s))`,
      );
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
  const saneados = plano.grupos.filter((g) => g.situacao === "JA_SANEADO");
  linhas.push(
    `resumo: ${plano.grupos.length} grupo(s) — ${prontos.length} PRONTO, ${bloqueados.length} BLOQUEADO (revisão necessária)` +
      (saneados.length > 0 ? `, ${saneados.length} JÁ SANEADO` : ""),
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

/**
 * A onda aplica inteira ou não aplica: um grupo que não está PRONTO volta ao
 * PO antes de qualquer escrita (decisão do PO na Onda 2).
 */
export function exigirOndaInteira(plano: Plano): void {
  const fora = plano.grupos.filter((g) => g.situacao !== "PRONTO");
  if (plano.grupos.length === 0 || fora.length > 0) {
    throw new Error(
      `a Onda ${plano.onda ?? "?"} só aplica com todos os grupos PRONTO (${plano.grupos.length - fora.length}/${plano.grupos.length}). ` +
        `Fora: ${fora.map((g) => `${g.decisao?.grupo ?? g.grupo} (${g.situacao})`).join(", ") || "nenhum grupo no plano"}. Nada foi alterado.`,
    );
  }
}

/** As tabelas que o plano vai mexer — o que o backup precisa cobrir. */
export function tabelasDoPlano(plano: Plano): string[] {
  const tabelas = new Set<string>();
  for (const grupo of plano.grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    tabelas.add(cadastroPorChave(grupo.cadastro).tabela);
    for (const movimento of grupo.movimentos) tabelas.add(movimento.tabela);
    for (const { operacao } of grupo.relacoes ?? []) {
      tabelas.add("supplier_items");
      if (operacao.tipo === "CONSOLIDAR_RELACAO") {
        tabelas.add("supplier_item_offers");
        tabelas.add("supplier_item_qualification_history");
      }
    }
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
  const exigirLinha = (tabela: string, id: string, oque: string): void => {
    const model = modelPorTabela[tabela];
    const linhas = model ? (arquivo.dados![model] ?? []) : [];
    if (!linhas.some((linha) => linha.id === id)) problemas.push(`${oque} não está no backup`);
  };
  for (const grupo of plano.grupos) {
    if (grupo.situacao !== "PRONTO") continue;
    const tabela = cadastroPorChave(grupo.cadastro).tabela;
    for (const absorvido of grupo.absorvidos) exigirLinha(tabela, absorvido.id, `${grupo.grupo}: ${absorvido.codigo}`);
    // O canônico muda de valor: o de ANTES precisa estar guardado.
    if ((grupo.atualizacoes ?? []).length > 0) {
      exigirLinha(tabela, grupo.canonico.id, `${grupo.grupo}: o canônico ${grupo.canonico.codigo}`);
    }
    for (const { codigo, operacao } of grupo.relacoes ?? []) {
      if (operacao.tipo === "MOVER_RELACAO") {
        exigirLinha("supplier_items", operacao.relacao, `${grupo.grupo}: a relação de ${codigo} com ${operacao.fornecedor}`);
        continue;
      }
      exigirLinha("supplier_items", operacao.relacaoAbsorvida, `${grupo.grupo}: a relação de ${codigo} com ${operacao.fornecedor}`);
      for (const oferta of operacao.ofertas) {
        exigirLinha("supplier_item_offers", oferta.id, `${grupo.grupo}: oferta de ${codigo} com ${operacao.fornecedor}`);
      }
      for (const evento of operacao.eventos) {
        exigirLinha(
          "supplier_item_qualification_history",
          evento,
          `${grupo.grupo}: evento de homologação de ${codigo} com ${operacao.fornecedor}`,
        );
      }
    }
  }
  return problemas;
}

async function main(): Promise<void> {
  const comando = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!comando || !["plan", "apply", "verify"].includes(comando)) {
    console.error(
      "uso: master-data-duplicate-sanitization.ts plan|apply|verify [--cadastro=… | --onda=…] [--plano=…] [--backup=…] [--confirmar-banco=…] [--grupo=…] [--resultado=…] [--excel=…]",
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
  /** O que o APPLY aplicou, grupo a grupo: o APPLY grava, o VERIFY lê para a planilha. */
  const arquivoResultado = argumento("resultado");
  // Modo de decisão: os grupos da onda do arquivo de decisão (Item), e só eles.
  const onda = argumento("onda");

  const escolhidos = lista("cadastro");
  const todos = CADASTROS_MESTRE_NO_BANCO.map((c) => c.chave);
  if (onda !== undefined && escolhidos.length > 0) throw new Error("--onda e --cadastro não andam juntos: a onda é de Item.");
  const chaves = onda !== undefined ? ["ITEM"] : escolhidos.length > 0 ? escolhidos : todos;
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

  /**
   * Recontagem global depois da onda: a regra automática em todos os
   * cadastros, somente leitura. É ela que diz o que continua repetido — e é a
   * aba de revisão da planilha.
   */
  const recontar = async (): Promise<Plano> => {
    const recontagem = await planejar(prisma, todos);
    const restantes = recontagem.grupos;
    console.log(`\n=== RECONTAGEM GLOBAL (regra automática, somente leitura) ===`);
    console.log(`duplicidades restantes: ${restantes.length} grupo(s)`);
    for (const grupo of restantes) {
      console.log(`  [${grupo.situacao}] ${grupo.grupo}: ${[grupo.canonico, ...grupo.absorvidos].map((l) => l.codigo).join(", ")}`);
    }
    if (recontagem.variantes.length > 0) {
      console.log(`variantes fora da regra (acento/espaço): ${recontagem.variantes.length}`);
    }
    return recontagem;
  };

  const planilha = (plano: Plano, resultados: readonly ResultadoDoGrupo[], recontagem: Plano | null) =>
    plano.onda !== undefined
      ? planilhaDaOnda(plano, resultados, recontagem)
      : planilhaDoSaneamento(plano, resultados, plano.variantes);

  try {
    if (comando === "plan") {
      const plano = await planejar(prisma, chaves, { onda });
      console.log(descreverPlano(plano, destino).join("\n"));
      if (arquivoPlano) {
        gravar(arquivoPlano, `${JSON.stringify(plano, null, 2)}\n`);
        console.log(`\nPlano salvo em ${arquivoPlano}`);
      }
      if (arquivoExcel) {
        const recontagem = onda !== undefined ? await recontar() : null;
        gravar(arquivoExcel, gerarXlsx(planilha(plano, [], recontagem)));
        console.log(`Planilha salva em ${arquivoExcel}`);
      }
      console.log("\nSomente leitura: nada foi alterado.");
      process.exitCode = plano.grupos.every((g) => g.situacao === "PRONTO") ? 0 : 2;
      return;
    }

    if (!arquivoPlano) throw new Error(`${comando.toUpperCase()} exige --plano=<plano.json>.`);
    const plano = JSON.parse(fs.readFileSync(arquivoPlano, "utf8")) as Plano;
    if ((plano.onda ?? undefined) !== onda) {
      throw new Error(
        `o plano é ${plano.onda !== undefined ? `da Onda ${plano.onda}` : "do modo automático"}, e o comando pediu ${onda !== undefined ? `a Onda ${onda}` : "o modo automático"}.`,
      );
    }

    if (comando === "verify") {
      const resultado = await verificar(prisma, plano.grupos);
      console.log(descreverVerificacao(resultado).join("\n"));
      const recontagem = onda !== undefined ? await recontar() : null;
      if (arquivoExcel) {
        // A planilha sai do que o APPLY gravou: o resultado de cada grupo, com
        // a hora real — nunca de um APPLY imaginado.
        if (!arquivoResultado) throw new Error("VERIFY com --excel exige --resultado=<resultado.json> do APPLY.");
        const aplicados = JSON.parse(fs.readFileSync(arquivoResultado, "utf8")) as ResultadoDoGrupo[];
        gravar(arquivoExcel, gerarXlsx(planilha(plano, aplicados, recontagem)));
        console.log(`\nPlanilha salva em ${arquivoExcel}`);
      }
      process.exitCode = resultado.problemas.length === 0 ? 0 : 1;
      return;
    }

    if (onda !== undefined) exigirOndaInteira(plano);

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

    if (arquivoResultado) {
      gravar(arquivoResultado, `${JSON.stringify(resultados, null, 2)}\n`);
      console.log(`\nResultado salvo em ${arquivoResultado}`);
    }
    const conferencia = await verificar(prisma, plano.grupos.filter((g) => resultados.some((r) => r.grupo === g.grupo && r.situacao === "APLICADO")));
    console.log(`\n${descreverVerificacao(conferencia).join("\n")}`);
    const recontagem = onda !== undefined ? await recontar() : null;
    if (arquivoExcel) {
      gravar(arquivoExcel, gerarXlsx(planilha(plano, resultados, recontagem)));
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
