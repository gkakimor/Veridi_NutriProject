import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type {
  MasterDataDeletionCheckDTO,
  MasterDataDeletionReferenceDTO,
  MasterDataDeletionRemovedDTO,
  MasterDataDeletionResultDTO,
  MasterDataEntityType,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { AcaoDaChave, AgregadoExcluivel } from "./catalogo-de-exclusao.js";
import { ACAO_POR_EXTENSO, AGREGADOS, tabelasDoAgregado } from "./catalogo-de-exclusao.js";
import type { Internos, Linha } from "./filhos-tecnicos.js";
import { julgarFilhosTecnicos } from "./filhos-tecnicos.js";
import {
  MasterDataDeleteAbortedError,
  MasterDataInUseError,
  MasterDataNotFoundError,
} from "./master-data-deletion.errors.js";
import { retratoDaExclusao } from "./retrato-da-exclusao.js";

/**
 * Exclusão física de cadastro mestre — MASTER-DATA-HARD-DELETE-01, D1, D2, D3
 * e D6 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.
 *
 * A prévia (`consultarExclusao`) e a exclusão (`excluirCadastroMestre`) julgam
 * com a MESMA função, `avaliar`:
 *
 *  1. lê a raiz e as linhas internas do agregado (na exclusão, `FOR UPDATE`:
 *     quem grava referência com chave estrangeira pede `FOR KEY SHARE` na linha
 *     apontada e espera, e quem muda o cadastro espera também);
 *  2. confere o catálogo contra o `pg_constraint` — chave que chega sem estar
 *     no catálogo, ou que mudou de ação, bloqueia (falha fechada);
 *  3. julga os filhos técnicos — a V1 como a criação a deixou (o registro do
 *     CNPJ da criação do Cliente espera prova estrutural e, até lá, é
 *     referência como qualquer outro);
 *  4. conta cada referência declarada e as redes: coluna sem chave com sufixo
 *     de id, código ou nome, e toda coluna JSON do schema.
 *
 * A exclusão, numa transação: retrato de `pg_stat_xact_user_tables`, trava,
 * recontagem, 409 se houver qualquer uso, rastro append-only, DELETE da raiz
 * (as internas saem por CASCADE), e conferência do efeito REAL contra o
 * esperado — raiz e internas contadas, uma linha no rastro, nada mais. Efeito
 * fora disso desfaz tudo.
 */

type Banco = Prisma.TransactionClient;

export const TABELA_DO_RASTRO = "master_data_deletion_history";

const ident = (nome: string): string => `"${nome.replace(/"/g, '""')}"`;
const TEXTUAIS = new Set(["text", "character varying", "uuid"]);

/** Tempo da transação: a recontagem varre as colunas JSON do schema inteiro. */
const OPCOES_DA_TRANSACAO = { timeout: 30_000, maxWait: 10_000 } as const;

/** Chave estrangeira real, como o `pg_constraint` a descreve. */
export interface ChaveReal {
  tabela: string;
  coluna: string;
  alvo: string;
  acao: string;
}

/** Coluna real de tabela do schema `public`. */
export interface ColunaReal {
  tabela: string;
  coluna: string;
  tipo: string;
}

/**
 * Coluna JSON com nome de negócio. As que não estão aqui continuam varridas —
 * só aparecem com o nome técnico.
 */
const ROTULOS_DE_JSON: Readonly<Record<string, string>> = {
  "stock_counts.scopeFilters": "Inventário físico (escopo da contagem)",
  "production_order_planning_snapshots.steps": "Roteiros copiados para ordens de produção",
  "production_order_schedules.steps": "Agenda de produção",
  "industrial_cost_calculations.result": "Cálculos de custo industrial",
  "production_order_cost_snapshots.breakdown": "Custo das ordens de produção",
  "quote_lines.pricingWarningsSnapshot": "Orçamentos",
  "pricing_tiers.warningsSnapshot": "Precificações",
  "customer_orders.agreedPaymentSchedule": "Pedidos de venda",
  "customer_cnpj_registration_history.changes": "Histórico dos dados cadastrais do CNPJ",
  "user_preferences.ui": "Preferências de tela",
};

export async function lerChavesReais(db: Banco): Promise<ChaveReal[]> {
  return db.$queryRawUnsafe<ChaveReal[]>(`
    SELECT src.relname AS tabela, a.attname AS coluna, tgt.relname AS alvo, c.confdeltype::text AS acao
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND n.nspname = 'public'
    ORDER BY 1, 2, 3`);
}

export async function lerColunasReais(db: Banco): Promise<ColunaReal[]> {
  return db.$queryRawUnsafe<ColunaReal[]>(`
    SELECT c.table_name AS tabela, c.column_name AS coluna, c.data_type AS tipo
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
    ORDER BY 1, 2`);
}

const chaveDe = (tabela: string, coluna: string, alvo: string): string => `${tabela}.${coluna} → ${alvo}`;
const acaoPorExtenso = (acao: string): string => ACAO_POR_EXTENSO[acao as AcaoDaChave] ?? acao;

/**
 * O catálogo bate com o banco? Toda chave estrangeira que chega à raiz ou a
 * uma interna precisa estar declarada — como vínculo interno ou como
 * referência — com a MESMA ação; e toda entrada declarada precisa existir.
 * Cada divergência vira uma razão de bloqueio: a exclusão não adivinha.
 */
export function conferirCatalogo(
  agregado: AgregadoExcluivel,
  chaves: readonly ChaveReal[],
  colunas: readonly ColunaReal[],
): MasterDataDeletionReferenceDTO[] {
  const tabelas = new Set(tabelasDoAgregado(agregado));
  const esperadas = new Map<string, AcaoDaChave>();
  for (const interna of agregado.internas) esperadas.set(chaveDe(interna.tabela, interna.coluna, interna.pai), "c");
  for (const chave of agregado.chavesInternas) esperadas.set(chaveDe(chave.tabela, chave.coluna, chave.alvo), chave.acao);
  for (const referencia of agregado.referencias) {
    if (referencia.tipo === "fk") {
      esperadas.set(chaveDe(referencia.tabela, referencia.coluna, referencia.alvo), referencia.acao);
    }
  }

  const problemas: MasterDataDeletionReferenceDTO[] = [];
  const vistas = new Set<string>();
  for (const chave of chaves) {
    if (!tabelas.has(chave.alvo)) continue;
    const nome = chaveDe(chave.tabela, chave.coluna, chave.alvo);
    vistas.add(nome);
    const esperada = esperadas.get(nome);
    if (esperada === undefined) {
      problemas.push({
        source: "Referência não catalogada",
        count: 1,
        reason: `${nome} (${acaoPorExtenso(chave.acao)}) aponta para este cadastro e não está no catálogo da exclusão. A exclusão fica bloqueada até o catálogo ser revisto.`,
      });
    } else if (esperada !== chave.acao) {
      problemas.push({
        source: "Catálogo da exclusão desatualizado",
        count: 1,
        reason: `${nome} é ${acaoPorExtenso(chave.acao)} no banco e ${ACAO_POR_EXTENSO[esperada]} no catálogo.`,
      });
    }
  }
  for (const nome of esperadas.keys()) {
    if (!vistas.has(nome)) {
      problemas.push({
        source: "Catálogo da exclusão desatualizado",
        count: 1,
        reason: `${nome} está no catálogo da exclusão e não existe mais no banco.`,
      });
    }
  }
  const existentes = new Set(colunas.map((coluna) => `${coluna.tabela}.${coluna.coluna}`));
  for (const referencia of agregado.referencias) {
    if (referencia.tipo === "fk") continue;
    if (!existentes.has(`${referencia.tabela}.${referencia.coluna}`)) {
      problemas.push({
        source: "Catálogo da exclusão desatualizado",
        count: 1,
        reason: `${referencia.tabela}.${referencia.coluna} está no catálogo da exclusão e não existe mais no banco.`,
      });
    }
  }
  return problemas;
}

async function lerLinhas(db: Banco, sql: string, ...valores: unknown[]): Promise<Linha[]> {
  const linhas = await db.$queryRawUnsafe<{ bruto: string }[]>(sql, ...valores);
  return linhas.map(({ bruto }) => JSON.parse(bruto) as Linha);
}

async function contar(db: Banco, sql: string, ...valores: unknown[]): Promise<number> {
  const [linha] = await db.$queryRawUnsafe<{ n: number }[]>(sql, ...valores);
  return linha?.n ?? 0;
}

interface AgregadoLido {
  raiz: Linha;
  internos: Map<string, Linha[]>;
}

/**
 * A raiz e as internas, pai antes de filho. Com `travar`, cada leitura é
 * `FOR UPDATE`: a raiz primeiro, depois as versões e o que pende delas.
 */
async function lerAgregado(
  db: Banco,
  agregado: AgregadoExcluivel,
  id: string,
  travar: boolean,
): Promise<AgregadoLido | null> {
  const trava = travar ? " FOR UPDATE" : "";
  const [raiz] = await lerLinhas(
    db,
    `SELECT to_jsonb(r)::text AS bruto FROM ${ident(agregado.tabela)} r WHERE r.id = $1${trava}`,
    id,
  );
  if (!raiz) return null;

  const ids = new Map<string, string[]>([[agregado.tabela, [id]]]);
  const internos = new Map<string, Linha[]>();
  for (const interna of agregado.internas) {
    const pais = ids.get(interna.pai) ?? [];
    const linhas =
      pais.length === 0
        ? []
        : await lerLinhas(
            db,
            `SELECT to_jsonb(x)::text AS bruto FROM ${ident(interna.tabela)} x
             WHERE x.${ident(interna.coluna)} = ANY($1::text[]) ORDER BY x.id${trava}`,
            pais,
          );
    internos.set(interna.tabela, linhas);
    ids.set(
      interna.tabela,
      linhas.map((linha) => String(linha["id"])),
    );
  }
  return { raiz, internos };
}

const terminaEm = (coluna: string, sufixos: readonly string[]): boolean =>
  sufixos.some((sufixo) => coluna.toLowerCase().endsWith(sufixo));

function textoDe(linha: Linha, coluna: string): string | null {
  const valor = linha[coluna];
  return typeof valor === "string" && valor.trim().length > 0 ? valor : null;
}

/**
 * Tudo que, de fora, aponta para o agregado: as referências declaradas e as
 * redes de segurança. Cada uma com linhas vira uma razão de bloqueio.
 */
async function contarReferencias(
  db: Banco,
  agregado: AgregadoExcluivel,
  lido: AgregadoLido,
  chaves: readonly ChaveReal[],
  colunas: readonly ColunaReal[],
): Promise<MasterDataDeletionReferenceDTO[]> {
  const id = String(lido.raiz["id"]);
  const codigo = String(lido.raiz["code"]);
  const nomes = agregado.colunasDeNome
    .map((coluna) => textoDe(lido.raiz, coluna))
    .filter((nome): nome is string => nome !== null);
  const idsDe = (tabela: string): string[] =>
    tabela === agregado.tabela ? [id] : (lido.internos.get(tabela) ?? []).map((linha) => String(linha["id"]));
  const idsInternos = [...lido.internos.values()].flat().map((linha) => String(linha["id"]));

  const porId = (tabela: string, coluna: string, alvos: readonly string[]) =>
    contar(db, `SELECT count(*)::int AS n FROM ${ident(tabela)} WHERE ${ident(coluna)}::text = ANY($1::text[])`, alvos);
  const porCodigo = (tabela: string, coluna: string) =>
    contar(db, `SELECT count(*)::int AS n FROM ${ident(tabela)} WHERE ${ident(coluna)}::text = $1`, codigo);
  const porNome = (tabela: string, coluna: string) =>
    contar(
      db,
      `SELECT count(*)::int AS n FROM ${ident(tabela)}
       WHERE upper(btrim(${ident(coluna)}::text)) = ANY(SELECT upper(btrim(nome)) FROM unnest($1::text[]) AS nome)`,
      nomes,
    );
  const emJson = (tabela: string, coluna: string, termos: readonly string[]) =>
    contar(
      db,
      `SELECT count(*)::int AS n FROM ${ident(tabela)}
       WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS termo WHERE strpos(${ident(coluna)}::text, termo) > 0)`,
      termos,
    );

  const existentes = new Set(colunas.map((coluna) => `${coluna.tabela}.${coluna.coluna}`));
  const achadas: MasterDataDeletionReferenceDTO[] = [];

  // 1. O catálogo explícito — com nome de negócio.
  for (const referencia of agregado.referencias) {
    // Coluna que não existe mais já é bloqueio da conferência; contar quebraria.
    if (!existentes.has(`${referencia.tabela}.${referencia.coluna}`)) continue;
    let linhas = 0;
    if (referencia.tipo === "fk" || referencia.tipo === "id") {
      const alvos = idsDe(referencia.alvo);
      if (alvos.length > 0) linhas = await porId(referencia.tabela, referencia.coluna, alvos);
    } else if (referencia.tipo === "codigo") {
      linhas = await porCodigo(referencia.tabela, referencia.coluna);
    } else if (nomes.length > 0) {
      linhas = await porNome(referencia.tabela, referencia.coluna);
    }
    if (linhas > 0) achadas.push({ source: referencia.fonte, count: linhas, reason: referencia.motivo });
  }

  // 2. As redes: o que o catálogo não nomeia ainda é contado.
  const doAgregado = new Set([...tabelasDoAgregado(agregado), TABELA_DO_RASTRO]);
  const declaradas = new Set(agregado.referencias.map((referencia) => `${referencia.tabela}.${referencia.coluna}`));
  const comChave = new Set(chaves.map((chave) => `${chave.tabela}.${chave.coluna}`));
  const termosDoJson = [id, codigo, ...idsInternos];
  for (const coluna of colunas) {
    if (doAgregado.has(coluna.tabela)) continue;
    const nome = `${coluna.tabela}.${coluna.coluna}`;
    if (declaradas.has(nome)) continue;

    let linhas = 0;
    let motivo = "";
    if (coluna.tipo === "json" || coluna.tipo === "jsonb") {
      linhas = await emJson(coluna.tabela, coluna.coluna, termosDoJson);
      motivo = "Dado gravado em JSON cita este cadastro.";
    } else if (TEXTUAIS.has(coluna.tipo) && !comChave.has(nome)) {
      if (terminaEm(coluna.coluna, agregado.sufixos.id)) {
        linhas = await porId(coluna.tabela, coluna.coluna, [id]);
        motivo = "Guarda o id deste cadastro sem chave estrangeira.";
      } else if (idsInternos.length > 0 && terminaEm(coluna.coluna, agregado.sufixos.idInterno)) {
        linhas = await porId(coluna.tabela, coluna.coluna, idsInternos);
        motivo = "Guarda o id de uma versão deste cadastro sem chave estrangeira.";
      } else if (terminaEm(coluna.coluna, agregado.sufixos.codigo)) {
        linhas = await porCodigo(coluna.tabela, coluna.coluna);
        motivo = "Guarda o código deste cadastro.";
      } else if (nomes.length > 0 && terminaEm(coluna.coluna, agregado.sufixos.nome)) {
        linhas = await porNome(coluna.tabela, coluna.coluna);
        motivo = "Guarda o nome deste cadastro.";
      }
    }
    if (linhas > 0) {
      achadas.push({ source: ROTULOS_DE_JSON[nome] ?? `Outros registros (${nome})`, count: linhas, reason: motivo });
    }
  }
  return achadas;
}

/**
 * Uma linha por fonte: o id, o código e o nome copiados no MESMO documento
 * são o mesmo uso — a tela mostra a fonte uma vez, com as razões juntas e a
 * maior contagem.
 */
export function agruparPorFonte(
  referencias: readonly MasterDataDeletionReferenceDTO[],
): MasterDataDeletionReferenceDTO[] {
  const porFonte = new Map<string, MasterDataDeletionReferenceDTO>();
  for (const referencia of referencias) {
    const anterior = porFonte.get(referencia.source);
    if (!anterior) {
      porFonte.set(referencia.source, { ...referencia });
      continue;
    }
    anterior.count = Math.max(anterior.count, referencia.count);
    if (!anterior.reason.includes(referencia.reason)) anterior.reason = `${anterior.reason} ${referencia.reason}`;
  }
  return [...porFonte.values()];
}

interface Avaliacao {
  lido: AgregadoLido;
  codigo: string;
  nome: string;
  referencias: MasterDataDeletionReferenceDTO[];
  removidosJunto: MasterDataDeletionRemovedDTO[];
  alternativaDisponivel: boolean;
}

async function avaliar(db: Banco, agregado: AgregadoExcluivel, id: string, travar: boolean): Promise<Avaliacao> {
  const lido = await lerAgregado(db, agregado, id, travar);
  if (!lido) throw new MasterDataNotFoundError(agregado.rotulo, id);

  // Uma conexão só na transação interativa: em sequência, nunca `Promise.all`.
  const chaves = await lerChavesReais(db);
  const colunas = await lerColunasReais(db);
  const referencias = agruparPorFonte([
    ...(await contarReferencias(db, agregado, lido, chaves, colunas)),
    ...julgarFilhosTecnicos(agregado.tipo, lido.internos),
    ...conferirCatalogo(agregado, chaves, colunas),
  ]);

  const nome = agregado.colunasDeNome.map((coluna) => textoDe(lido.raiz, coluna)).find((valor) => valor !== null);
  return {
    lido,
    codigo: String(lido.raiz["code"]),
    nome: nome ?? "",
    referencias,
    removidosJunto: agregado.internas
      .map((interna) => ({ source: interna.rotulo, count: lido.internos.get(interna.tabela)?.length ?? 0 }))
      .filter((removido) => removido.count > 0),
    alternativaDisponivel:
      agregado.saida === "INACTIVATE" ? lido.raiz["active"] === true : lido.raiz["archivedAt"] === null,
  };
}

function checkDTO(agregado: AgregadoExcluivel, id: string, avaliacao: Avaliacao): MasterDataDeletionCheckDTO {
  const canDelete = avaliacao.referencias.length === 0;
  return {
    entityType: agregado.tipo,
    entityId: id,
    entityCode: avaliacao.codigo,
    entityName: avaliacao.nome,
    canDelete,
    references: avaliacao.referencias,
    removedTogether: canDelete ? avaliacao.removidosJunto : [],
    alternative: agregado.saida,
    alternativeAvailable: avaliacao.alternativaDisponivel,
  };
}

/** Prévia: pode ou não, e por quê. Transação SOMENTE LEITURA, num retrato só. */
export async function consultarExclusao(
  tipo: MasterDataEntityType,
  id: string,
): Promise<MasterDataDeletionCheckDTO> {
  const agregado = AGREGADOS[tipo];
  return getPrisma().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return checkDTO(agregado, id, await avaliar(tx, agregado, id, false));
    },
    { ...OPCOES_DA_TRANSACAO, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export interface EfeitoNaTabela {
  ins: number;
  upd: number;
  del: number;
}

/**
 * Contadores da CONEXÃO: `pg_stat_xact_user_tables` soma também transações
 * anteriores da mesma conexão ainda não descarregadas — por isso a conta é
 * sempre diferença entre dois retratos da mesma transação.
 */
async function contadoresDaConexao(tx: Banco): Promise<Map<string, EfeitoNaTabela>> {
  const linhas = await tx.$queryRawUnsafe<({ tabela: string } & EfeitoNaTabela)[]>(`
    SELECT relname AS tabela, n_tup_ins::int AS ins, n_tup_upd::int AS upd, n_tup_del::int AS del
    FROM pg_stat_xact_user_tables
    WHERE schemaname = 'public'`);
  return new Map(linhas.map(({ tabela, ins, upd, del }) => [tabela, { ins, upd, del }]));
}

/** O que a exclusão pode fazer: a raiz e as internas saem, uma linha entra no rastro. Só isso. */
export function efeitoEsperado(agregado: AgregadoExcluivel, internos: Internos): Map<string, EfeitoNaTabela> {
  const esperado = new Map<string, EfeitoNaTabela>([
    [agregado.tabela, { ins: 0, upd: 0, del: 1 }],
    [TABELA_DO_RASTRO, { ins: 1, upd: 0, del: 0 }],
  ]);
  for (const [tabela, linhas] of internos) {
    if (linhas.length > 0) esperado.set(tabela, { ins: 0, upd: 0, del: linhas.length });
  }
  return esperado;
}

/** Tabelas em que o efeito real difere do esperado, com o efeito real. */
export function efeitoInesperado(
  antes: ReadonlyMap<string, EfeitoNaTabela>,
  depois: ReadonlyMap<string, EfeitoNaTabela>,
  esperado: ReadonlyMap<string, EfeitoNaTabela>,
): Record<string, EfeitoNaTabela> {
  const zero: EfeitoNaTabela = { ins: 0, upd: 0, del: 0 };
  const tabelas = new Set([...depois.keys(), ...esperado.keys()]);
  const inesperado: Record<string, EfeitoNaTabela> = {};
  for (const tabela of [...tabelas].sort()) {
    const inicio = antes.get(tabela) ?? zero;
    const fim = depois.get(tabela) ?? zero;
    const real = { ins: fim.ins - inicio.ins, upd: fim.upd - inicio.upd, del: fim.del - inicio.del };
    const previsto = esperado.get(tabela) ?? zero;
    if (real.ins !== previsto.ins || real.upd !== previsto.upd || real.del !== previsto.del) {
      inesperado[tabela] = real;
    }
  }
  return inesperado;
}

/**
 * A exclusão física, numa transação: trava, reconta, recusa qualquer uso,
 * grava o rastro, apaga a raiz e confere o efeito real. Qualquer divergência
 * desfaz tudo — nada é excluído e nada fica no rastro.
 */
export async function excluirCadastroMestre(
  tipo: MasterDataEntityType,
  id: string,
  reason: string,
  actor: User,
): Promise<MasterDataDeletionResultDTO> {
  const agregado = AGREGADOS[tipo];
  return getPrisma().$transaction(async (tx) => {
    const antes = await contadoresDaConexao(tx);

    const avaliacao = await avaliar(tx, agregado, id, true);
    if (avaliacao.referencias.length > 0) throw new MasterDataInUseError(agregado.rotulo, avaliacao.referencias);

    const rastro = await tx.masterDataDeletionHistory.create({
      data: {
        entityType: tipo,
        entityId: id,
        entityCode: avaliacao.codigo,
        entityName: avaliacao.nome,
        reason,
        snapshot: retratoDaExclusao(tipo, avaliacao.lido.raiz, avaliacao.lido.internos) as unknown as Prisma.InputJsonValue,
        deletedByUserId: actor.id,
        deletedByUserName: actor.name,
      },
    });

    const removidos = await tx.$executeRawUnsafe(`DELETE FROM ${ident(agregado.tabela)} WHERE id = $1`, id);
    if (removidos !== 1) throw new MasterDataDeleteAbortedError({ [agregado.tabela]: { ins: 0, upd: 0, del: removidos } });

    const inesperado = efeitoInesperado(
      antes,
      await contadoresDaConexao(tx),
      efeitoEsperado(agregado, avaliacao.lido.internos),
    );
    if (Object.keys(inesperado).length > 0) throw new MasterDataDeleteAbortedError(inesperado);

    return {
      historyId: rastro.id,
      entityType: tipo,
      entityId: id,
      entityCode: avaliacao.codigo,
      entityName: avaliacao.nome,
      deletedAt: rastro.deletedAt.toISOString(),
    };
  }, OPCOES_DA_TRANSACAO);
}
