import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { descreverDestino, exigirBancoLocal } from "../local-db-guard.mjs";
import { DECISOES_DE_DUPLICATAS } from "../veridi-import/item-duplicate-decisions.js";
import {
  decisaoDeGrupo,
  decisoesDaOnda,
  impressaoDasDecisoes,
  nomeNormalizado,
} from "../veridi-import/item-duplicates.js";
import type { DecisaoDeDuplicata } from "../veridi-import/item-duplicates.js";

/**
 * Saneamento de Item duplicado — PLAN → APPLY → VERIFY (ITEM-DUPLICATE-SANITIZATION-01).
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/item-duplicate-sanitization.ts plan --onda=A [--plano=<plano.json>]
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/item-duplicate-sanitization.ts apply --onda=A \
 *     --plano=<plano.json> --backup=<backup.json> --confirmar-banco=<banco>
 *   pnpm exec dotenv -e .env -- tsx scripts/maintenance/item-duplicate-sanitization.ts verify --onda=A [--plano=<plano.json>]
 *
 * Rodar pelo Bash: no PowerShell 5.1 o `--` e as flags se perdem a caminho do tsx.
 *
 * Quem absorve quem é decisão do arquivo `scripts/veridi-import/item-duplicate-decisions.ts`, o
 * mesmo que o importador lê. Esta ferramenta só executa a decisão, e só com o banco no estado previsto:
 *
 *  - PLAN lê numa transação READ ONLY e diz, por grupo, o que muda e a impressão digital dos
 *    registros envolvidos. Caso fora do previsto vira ABORTAR com o motivo: referência ao absorvido
 *    fora das relações com fornecedor e dos rascunhos (FKs reais do catálogo, colunas de id ou código
 *    de Item sem FK e JSON), Formulação ACTIVE/INACTIVE, relação preferencial, status divergente,
 *    histórico além da importação, nome ou código da planilha diferentes da decisão.
 *  - APPLY roda numa transação só: trava consultiva, SELECT FOR UPDATE de Itens, relações, ofertas,
 *    eventos, componentes e versões, e só depois relê o estado, que precisa ter a MESMA impressão do
 *    plano aprovado. Cada escrita confere quantas linhas mexeu, e `pg_stat_xact_user_tables` confere
 *    que a transação não tocou em nada além do plano. Qualquer divergência desfaz tudo.
 *  - VERIFY confere o resultado: absorvido fora do banco, canônico no lugar, nenhum resíduo do id do
 *    absorvido, o que o plano moveu pendurado no canônico e um Item só com o nome do grupo.
 *
 * APPLY só roda contra banco local (`local-db-guard`). Produção é outra rodada, com conferência READ
 * ONLY e aprovação do PO antes.
 */

type Banco = Prisma.TransactionClient;
type Registro = Record<string, unknown>;

/** Quem a carga inicial registrou como autor — o que não é isso é histórico de gente. */
export const ATOR_DA_IMPORTACAO = "Importação Veridi";

/**
 * As decisões da onda que ESTA ferramenta executa. Grupo de mais de dois, par
 * nomeado e consolidação no canônico são da Onda 2 em diante e têm dono:
 * `master-data-duplicate-sanitization.ts --onda=<onda>`. Aqui eles avaliariam
 * par a par — e um par sozinho de um grupo de quatro não é o grupo.
 */
function decisoesDestaFerramenta(
  onda: string,
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): readonly DecisaoDeDuplicata[] {
  const daOnda = decisoesDaOnda(onda, decisoes);
  if (daOnda.some((decisao) => decisaoDeGrupo(decisao, decisoes))) {
    throw new Error(
      `a Onda ${onda} tem grupo de mais de dois, par nomeado ou consolidação no canônico: rode ` +
        `master-data-duplicate-sanitization.ts --onda=${onda}.`,
    );
  }
  return daOnda;
}

/** Chave da trava consultiva: duas aplicações nunca correm juntas. */
const TRAVA = "veridi:item-duplicate-sanitization";

/** Referências que a ferramenta trata. Qualquer outra ao absorvido precisa estar zerada. */
const TRATADAS = new Set(["supplier_items.itemId", "formulation_components.itemId"]);

export interface Lida {
  /** `to_jsonb(linha)::text`: a forma estável que entra na impressão digital. */
  bruto: string;
  dados: Registro;
}

export interface ColunaDeReferencia {
  tabela: string;
  coluna: string;
  /** `fk`: FK real para `items`; `id`/`codigo`: id ou código de Item sem FK; `json`: json/jsonb. */
  tipo: "fk" | "id" | "codigo" | "json";
}

interface Referencia extends ColunaDeReferencia {
  linhas: number;
}

export interface RelacaoLida {
  relacao: Lida;
  fornecedor: string;
  ofertas: Lida[];
  eventos: Lida[];
  /** Relação do canônico com o MESMO fornecedor, quando existe. */
  canonica: { relacao: Lida; eventos: Lida[] } | null;
}

interface ComponenteLido {
  componente: Lida;
  versao: Lida;
  documento: string;
  versaoTemCanonico: boolean;
}

export interface EstadoDoGrupo {
  decisao: DecisaoDeDuplicata;
  absorvido: Lida | null;
  canonico: Lida | null;
  /** Outros Itens com o código da planilha do absorvido: duplicata recriada. */
  recriados: string[];
  /** Outros Itens MP/ME com o nome do grupo, além do absorvido e do canônico. */
  mesmoNome: string[];
  referencias: Referencia[];
  relacoes: RelacaoLida[];
  componentes: ComponenteLido[];
}

/** As duas operações sobre a relação Item × Fornecedor — as mesmas nas duas ferramentas. */
export type OperacaoDeRelacao = Extract<Operacao, { tipo: "CONSOLIDAR_RELACAO" | "MOVER_RELACAO" }>;

export type Operacao =
  | {
      tipo: "CONSOLIDAR_RELACAO";
      fornecedor: string;
      relacaoAbsorvida: string;
      relacaoCanonica: string;
      ofertas: { id: string; sourceKey: string | null }[];
      eventos: string[];
    }
  | { tipo: "MOVER_RELACAO"; fornecedor: string; relacao: string; ofertas: number; eventos: number }
  | { tipo: "MOVER_COMPONENTE_RASCUNHO"; componente: string; versao: string; documento: string }
  | { tipo: "REMOVER_ITEM"; item: string; codigo: string };

export interface LadoAvaliado {
  codigo: string;
  codigoPlanilha: string;
  id: string | null;
  nome: string | null;
}

export interface AvaliacaoDoGrupo {
  onda: string;
  grupo: string;
  nome: string;
  absorvido: LadoAvaliado;
  canonico: LadoAvaliado;
  situacao: "PRONTO" | "JA_SANEADO" | "ABORTAR";
  motivos: string[];
  operacoes: Operacao[];
  impressao: string;
}

export interface EfeitoNaTabela {
  ins: number;
  upd: number;
  del: number;
}

export interface Plano {
  formato: 1;
  ferramenta: "item-duplicate-sanitization";
  geradoEm: string;
  banco: string;
  onda: string;
  /** Impressão do arquivo de decisão da onda. */
  decisoes: string;
  grupos: AvaliacaoDoGrupo[];
  /** Linhas por tabela que a transação do APPLY pode mexer — e nenhuma outra. */
  efeitoEsperado: Record<string, EfeitoNaTabela>;
  pronto: boolean;
  impressao: string;
}

const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");

/** Tabelas em ordem de código, a mesma dos dois lados da comparação do efeito. */
const emOrdem = <T>(porTabela: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(porTabela).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

/** Identificador vindo do catálogo do banco, entre aspas. */
const ident = (nome: string): string => `"${nome.replace(/"/g, '""')}"`;

const texto = (registro: Registro, campo: string): string | null => {
  const valor = registro[campo];
  return valor === null || valor === undefined ? null : String(valor);
};

async function lerLinhas(db: Banco, sql: string, ...valores: unknown[]): Promise<Lida[]> {
  const linhas = await db.$queryRawUnsafe<{ bruto: string }[]>(sql, ...valores);
  return linhas.map(({ bruto }) => ({ bruto, dados: JSON.parse(bruto) as Registro }));
}

async function bancoAtual(db: Banco): Promise<string> {
  const [linha] = await db.$queryRawUnsafe<{ banco: string }[]>(`SELECT current_database() AS banco`);
  if (!linha) throw new Error("current_database() sem resposta");
  return linha.banco;
}

async function contar(db: Banco, sql: string, ...valores: unknown[]): Promise<number> {
  const [linha] = await db.$queryRawUnsafe<{ n: number }[]>(sql, ...valores);
  return linha?.n ?? 0;
}

/**
 * Toda coluna que pode guardar um Item, lida do catálogo REAL: FK para `items` (o `schema.prisma`
 * não diz a ação que a migration criou), coluna de id ou de código de Item sem FK e JSON. Migration
 * nova que referencie Item entra aqui sozinha — e, com linha para o absorvido, faz o plano abortar.
 */
export async function lerCatalogo(db: Banco): Promise<ColunaDeReferencia[]> {
  const fks = await db.$queryRawUnsafe<{ tabela: string; coluna: string; alvo: string }[]>(`
    SELECT src.relname AS tabela, a.attname AS coluna, tgt.relname AS alvo
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
    .filter((fk) => fk.alvo === "items")
    .map((fk) => ({ tabela: fk.tabela, coluna: fk.coluna, tipo: "fk" }));
  for (const { tabela, coluna, tipo } of colunas) {
    const textual = ["text", "character varying", "uuid"].includes(tipo);
    if (tipo === "json" || tipo === "jsonb") catalogo.push({ tabela, coluna, tipo: "json" });
    else if (textual && /itemid$/i.test(coluna) && !comFk.has(`${tabela}.${coluna}`)) {
      catalogo.push({ tabela, coluna, tipo: "id" });
    } else if (textual && /itemcode$/i.test(coluna)) catalogo.push({ tabela, coluna, tipo: "codigo" });
  }
  return catalogo;
}

async function contarReferencias(
  db: Banco,
  catalogo: readonly ColunaDeReferencia[],
  item: { id: string; codigo: string },
  incluirTratadas = false,
): Promise<Referencia[]> {
  const achadas: Referencia[] = [];
  for (const coluna of catalogo) {
    if (!incluirTratadas && coluna.tipo === "fk" && TRATADAS.has(`${coluna.tabela}.${coluna.coluna}`)) continue;
    const campo = `${ident(coluna.coluna)}::text`;
    const linhas =
      coluna.tipo === "json"
        ? await contar(
            db,
            `SELECT count(*)::int AS n FROM ${ident(coluna.tabela)} WHERE strpos(${campo}, $1) > 0 OR strpos(${campo}, $2) > 0`,
            item.id,
            item.codigo,
          )
        : await contar(
            db,
            `SELECT count(*)::int AS n FROM ${ident(coluna.tabela)} WHERE ${campo} = $1`,
            coluna.tipo === "codigo" ? item.codigo : item.id,
          );
    if (linhas > 0) achadas.push({ ...coluna, linhas });
  }
  return achadas;
}

/** Códigos de Item MP/ME por nome sem caixa. */
async function lerNomes(db: Banco): Promise<Map<string, string[]>> {
  const itens = await db.$queryRawUnsafe<{ code: string; name: string }[]>(
    `SELECT code, name FROM items WHERE type IN ('RAW_MATERIAL', 'PACKAGING') ORDER BY code`,
  );
  const porNome = new Map<string, string[]>();
  for (const item of itens) {
    const chave = nomeNormalizado(item.name);
    porNome.set(chave, [...(porNome.get(chave) ?? []), item.code]);
  }
  return porNome;
}

async function lerEstado(
  db: Banco,
  decisao: DecisaoDeDuplicata,
  catalogo: readonly ColunaDeReferencia[],
  nomes: Map<string, string[]>,
): Promise<EstadoDoGrupo> {
  const item = `SELECT to_jsonb(i)::text AS bruto FROM items i WHERE i.code = $1`;
  const [absorvido = null] = await lerLinhas(db, item, decisao.absorvido.codigo);
  const [canonico = null] = await lerLinhas(db, item, decisao.canonico.codigo);
  const recriados = (
    await db.$queryRawUnsafe<{ code: string }[]>(
      `SELECT code FROM items WHERE "externalCode" = $1 AND code <> $2 ORDER BY code`,
      decisao.absorvido.codigoPlanilha,
      decisao.absorvido.codigo,
    )
  ).map((linha) => linha.code);
  const mesmoNome = (nomes.get(nomeNormalizado(decisao.nome)) ?? []).filter(
    (codigo) => codigo !== decisao.absorvido.codigo && codigo !== decisao.canonico.codigo,
  );
  const estado: EstadoDoGrupo = {
    decisao,
    absorvido,
    canonico,
    recriados,
    mesmoNome,
    referencias: [],
    relacoes: [],
    componentes: [],
  };
  if (!absorvido) return estado;

  const idAbsorvido = texto(absorvido.dados, "id")!;
  const idCanonico = canonico ? texto(canonico.dados, "id") : null;
  estado.referencias = await contarReferencias(db, catalogo, { id: idAbsorvido, codigo: decisao.absorvido.codigo });

  estado.relacoes = await lerRelacoes(db, idAbsorvido, idCanonico);

  const componentes = await db.$queryRawUnsafe<
    { componente: string; versao: string; documento: string; tem: boolean }[]
  >(
    `SELECT to_jsonb(fc)::text AS componente, to_jsonb(fv)::text AS versao,
            coalesce(p.code, fv."productId") || ' V' || fv."versionNumber" AS documento,
            EXISTS (
              SELECT 1 FROM formulation_components x
              WHERE x."formulationVersionId" = fc."formulationVersionId" AND x."itemId" = $2
            ) AS tem
     FROM formulation_components fc
     JOIN formulation_versions fv ON fv.id = fc."formulationVersionId"
     LEFT JOIN products p ON p.id = fv."productId"
     WHERE fc."itemId" = $1
     ORDER BY fc.id`,
    idAbsorvido,
    idCanonico ?? "",
  );
  estado.componentes = componentes.map((linha) => ({
    componente: { bruto: linha.componente, dados: JSON.parse(linha.componente) as Registro },
    versao: { bruto: linha.versao, dados: JSON.parse(linha.versao) as Registro },
    documento: linha.documento,
    versaoTemCanonico: linha.tem,
  }));
  return estado;
}

/**
 * As relações Item × Fornecedor do absorvido, com ofertas, eventos de
 * homologação e — quando o canônico tem o MESMO fornecedor — a relação dele.
 * Uma leitura só para as duas ferramentas: a regra é uma, a leitura também.
 */
export async function lerRelacoes(
  db: Banco,
  idAbsorvido: string,
  idCanonico: string | null,
): Promise<RelacaoLida[]> {
  const eventosDa = (relacao: string) =>
    lerLinhas(
      db,
      `SELECT to_jsonb(h)::text AS bruto FROM supplier_item_qualification_history h WHERE h."supplierItemId" = $1 ORDER BY h.id`,
      relacao,
    );
  const relacoes: RelacaoLida[] = [];
  for (const relacao of await lerLinhas(
    db,
    `SELECT to_jsonb(si)::text AS bruto FROM supplier_items si WHERE si."itemId" = $1 ORDER BY si.id`,
    idAbsorvido,
  )) {
    const idRelacao = texto(relacao.dados, "id")!;
    const idFornecedor = texto(relacao.dados, "supplierId")!;
    const [fornecedor] = await db.$queryRawUnsafe<{ code: string; legalName: string }[]>(
      `SELECT code, "legalName" FROM suppliers WHERE id = $1`,
      idFornecedor,
    );
    const [doCanonico] = idCanonico
      ? await lerLinhas(
          db,
          `SELECT to_jsonb(si)::text AS bruto FROM supplier_items si WHERE si."itemId" = $1 AND si."supplierId" = $2`,
          idCanonico,
          idFornecedor,
        )
      : [];
    relacoes.push({
      relacao,
      fornecedor: `${fornecedor?.legalName ?? "?"} (${fornecedor?.code ?? idFornecedor})`,
      ofertas: await lerLinhas(
        db,
        `SELECT to_jsonb(o)::text AS bruto FROM supplier_item_offers o WHERE o."supplierItemId" = $1 ORDER BY o.id`,
        idRelacao,
      ),
      eventos: await eventosDa(idRelacao),
      canonica: doCanonico
        ? { relacao: doCanonico, eventos: await eventosDa(texto(doCanonico.dados, "id")!) }
        : null,
    });
  }
  return relacoes;
}

const relacaoDaImportacao = (relacao: Registro): boolean =>
  relacao["createdByUserId"] == null &&
  relacao["updatedByUserId"] == null &&
  relacao["createdByNameSnapshot"] === ATOR_DA_IMPORTACAO &&
  relacao["updatedByNameSnapshot"] === ATOR_DA_IMPORTACAO;

const eventoDaImportacao = (evento: Registro): boolean =>
  evento["changedByUserId"] == null && evento["changedByNameSnapshot"] === ATOR_DA_IMPORTACAO;

/** Oferta legada sem vigência: observação histórica, nunca preço de alguém. */
const ofertaDaImportacao = (oferta: Registro): boolean =>
  oferta["source"] === "LEGACY_IMPORT" &&
  oferta["createdByUserId"] == null &&
  oferta["createdByNameSnapshot"] === ATOR_DA_IMPORTACAO &&
  oferta["effectiveAt"] == null &&
  oferta["validUntil"] == null;

function impressaoDoEstado(estado: EstadoDoGrupo): string {
  const { decisao } = estado;
  return sha256(
    JSON.stringify({
      decisao: [decisao.onda, decisao.grupo, nomeNormalizado(decisao.nome), decisao.absorvido, decisao.canonico],
      absorvido: estado.absorvido?.bruto ?? null,
      canonico: estado.canonico?.bruto ?? null,
      recriados: estado.recriados,
      mesmoNome: estado.mesmoNome,
      referencias: estado.referencias.map((r) => `${r.tipo}:${r.tabela}.${r.coluna}=${r.linhas}`),
      relacoes: estado.relacoes.map((r) => ({
        relacao: r.relacao.bruto,
        ofertas: r.ofertas.map((o) => o.bruto),
        eventos: r.eventos.map((e) => e.bruto),
        canonica: r.canonica && {
          relacao: r.canonica.relacao.bruto,
          eventos: r.canonica.eventos.map((e) => e.bruto),
        },
      })),
      componentes: estado.componentes.map((c) => ({
        componente: c.componente.bruto,
        versao: c.versao.bruto,
        versaoTemCanonico: c.versaoTemCanonico,
      })),
    }),
  );
}

/** O que fazer com um grupo — ou por que não fazer nada. Sem banco. */
export function avaliar(estado: EstadoDoGrupo): AvaliacaoDoGrupo {
  const { decisao } = estado;
  const motivos: string[] = [];
  const operacoes: Operacao[] = [];
  const a = estado.absorvido?.dados ?? null;
  const c = estado.canonico?.dados ?? null;
  const lado = (lido: Registro | null, decidido: DecisaoDeDuplicata["absorvido"]): LadoAvaliado => ({
    ...decidido,
    id: lido ? texto(lido, "id") : null,
    nome: lido ? texto(lido, "name") : null,
  });
  const fechar = (situacao: AvaliacaoDoGrupo["situacao"]): AvaliacaoDoGrupo => ({
    onda: decisao.onda,
    grupo: decisao.grupo,
    nome: decisao.nome,
    absorvido: lado(a, decisao.absorvido),
    canonico: lado(c, decisao.canonico),
    situacao,
    motivos,
    operacoes: situacao === "PRONTO" ? operacoes : [],
    impressao: impressaoDoEstado(estado),
  });
  const conferirLado = (registro: Registro, decidido: DecisaoDeDuplicata["absorvido"], papel: string) => {
    if (texto(registro, "externalCode") !== decidido.codigoPlanilha) {
      motivos.push(
        `${papel} ${decidido.codigo} tem código da planilha "${texto(registro, "externalCode") ?? ""}", e a decisão diz "${decidido.codigoPlanilha}"`,
      );
    }
    if (nomeNormalizado(texto(registro, "name") ?? "") !== nomeNormalizado(decisao.nome)) {
      motivos.push(`${papel} ${decidido.codigo} se chama "${texto(registro, "name")}", e a decisão é para "${decisao.nome}"`);
    }
    if (registro["active"] !== true) motivos.push(`${papel} ${decidido.codigo} está inativo`);
  };

  if (c) conferirLado(c, decisao.canonico, "canônico");
  else motivos.push(`canônico ${decisao.canonico.codigo} não existe`);
  for (const codigo of estado.recriados) {
    motivos.push(`${codigo} tem o código da planilha do absorvido (${decisao.absorvido.codigoPlanilha}): duplicata recriada`);
  }
  for (const codigo of estado.mesmoNome) {
    motivos.push(`${codigo} também se chama "${decisao.nome}": o grupo deixou de ser um par`);
  }
  if (!a) return fechar(motivos.length === 0 ? "JA_SANEADO" : "ABORTAR");

  conferirLado(a, decisao.absorvido, "absorvido");
  if (c && a["type"] !== c["type"]) motivos.push(`tipos diferentes: ${String(a["type"])} × ${String(c["type"])}`);
  if (c && a["unitCode"] !== c["unitCode"]) {
    motivos.push(`unidades diferentes: ${String(a["unitCode"])} × ${String(c["unitCode"])}`);
  }
  for (const r of estado.referencias) {
    motivos.push(
      `referência não prevista ao absorvido: ${r.tabela}.${r.coluna} (${r.linhas} linha(s)${r.tipo === "fk" ? "" : `, ${r.tipo}`})`,
    );
  }

  for (const relacao of estado.relacoes) {
    const avaliacao = avaliarRelacao(relacao);
    motivos.push(...avaliacao.motivos);
    if (avaliacao.operacao) operacoes.push(avaliacao.operacao);
  }

  for (const { componente, versao, documento, versaoTemCanonico } of estado.componentes) {
    const status = String(versao.dados["status"]);
    if (status !== "DRAFT") {
      motivos.push(`Formulação ${documento} (${status}) usa o absorvido: versão ${status} não é reescrita`);
    } else if (versaoTemCanonico) {
      motivos.push(`rascunho ${documento} já tem ${decisao.canonico.codigo}: somar as linhas é decisão de formulação`);
    } else {
      operacoes.push({
        tipo: "MOVER_COMPONENTE_RASCUNHO",
        componente: texto(componente.dados, "id")!,
        versao: texto(versao.dados, "id")!,
        documento,
      });
    }
  }

  operacoes.push({ tipo: "REMOVER_ITEM", item: texto(a, "id")!, codigo: decisao.absorvido.codigo });
  return fechar(motivos.length === 0 ? "PRONTO" : "ABORTAR");
}

/**
 * A regra da relação Item × Fornecedor do absorvido (§110), uma só para as duas
 * ferramentas: preferencial, histórico além da importação e divergência com a
 * relação do canônico abortam; sem relação do canônico com o mesmo fornecedor,
 * a relação passa inteira; com ela, ofertas e eventos passam para ela e a do
 * absorvido sai.
 */
export function avaliarRelacao({ relacao, fornecedor, ofertas, eventos, canonica }: RelacaoLida): {
  motivos: string[];
  operacao: OperacaoDeRelacao | null;
} {
  const motivos: string[] = [];
  const r = relacao.dados;
  if (r["preferred"] === true) {
    motivos.push(
      canonica?.relacao.dados["preferred"] === true
        ? `${fornecedor}: preferencial dos dois lados`
        : `${fornecedor}: relação preferencial no absorvido`,
    );
  }
  if (!relacaoDaImportacao(r)) motivos.push(`${fornecedor}: relação do absorvido alterada depois da importação`);
  if (eventos.some((e) => !eventoDaImportacao(e.dados))) {
    motivos.push(`${fornecedor}: histórico de homologação do absorvido além da importação`);
  }
  if (ofertas.some((o) => !ofertaDaImportacao(o.dados))) motivos.push(`${fornecedor}: oferta do absorvido além da importação`);

  if (!canonica) {
    return {
      motivos,
      operacao:
        motivos.length === 0
          ? { tipo: "MOVER_RELACAO", fornecedor, relacao: texto(r, "id")!, ofertas: ofertas.length, eventos: eventos.length }
          : null,
    };
  }
  const k = canonica.relacao.dados;
  if (r["qualificationStatus"] !== k["qualificationStatus"]) {
    motivos.push(`${fornecedor}: status divergente (${String(r["qualificationStatus"])} × ${String(k["qualificationStatus"])})`);
  }
  if (r["active"] !== k["active"]) motivos.push(`${fornecedor}: situação da relação divergente`);
  for (const campo of ["supplierItemCode", "commercialNotes"]) {
    if (r[campo] != null && r[campo] !== k[campo]) motivos.push(`${fornecedor}: ${campo} divergente`);
  }
  if (!relacaoDaImportacao(k) || canonica.eventos.some((e) => !eventoDaImportacao(e.dados))) {
    motivos.push(`${fornecedor}: relação do canônico com histórico além da importação`);
  }
  return {
    motivos,
    operacao:
      motivos.length === 0
        ? {
            tipo: "CONSOLIDAR_RELACAO",
            fornecedor,
            relacaoAbsorvida: texto(r, "id")!,
            relacaoCanonica: texto(k, "id")!,
            ofertas: ofertas.map((o) => ({ id: texto(o.dados, "id")!, sourceKey: texto(o.dados, "sourceKey") })),
            eventos: eventos.map((e) => texto(e.dados, "id")!),
          }
        : null,
  };
}

/** Linhas por tabela que as operações mexem, em ordem de tabela. */
export function efeitoEsperado(grupos: readonly AvaliacaoDoGrupo[]): Record<string, EfeitoNaTabela> {
  const efeito: Record<string, EfeitoNaTabela> = {};
  const somar = (tabela: string, campo: keyof EfeitoNaTabela, n: number) => {
    if (n === 0) return;
    efeito[tabela] ??= { ins: 0, upd: 0, del: 0 };
    efeito[tabela][campo] += n;
  };
  for (const grupo of grupos) {
    for (const op of grupo.operacoes) {
      if (op.tipo === "CONSOLIDAR_RELACAO") {
        somar("supplier_item_offers", "upd", op.ofertas.length);
        somar("supplier_item_qualification_history", "upd", op.eventos.length);
        somar("supplier_items", "del", 1);
      } else if (op.tipo === "MOVER_RELACAO") somar("supplier_items", "upd", 1);
      else if (op.tipo === "MOVER_COMPONENTE_RASCUNHO") somar("formulation_components", "upd", 1);
      else somar("items", "del", 1);
    }
  }
  return emOrdem(efeito);
}

export async function planejarCom(
  db: Banco,
  onda: string,
  decisoes?: readonly DecisaoDeDuplicata[],
): Promise<Plano> {
  const daOnda = decisoesDestaFerramenta(onda, decisoes);
  const banco = await bancoAtual(db);
  const catalogo = await lerCatalogo(db);
  const nomes = await lerNomes(db);
  const grupos: AvaliacaoDoGrupo[] = [];
  for (const decisao of daOnda) grupos.push(avaliar(await lerEstado(db, decisao, catalogo, nomes)));
  const impressaoDecisoes = impressaoDasDecisoes(daOnda);
  return {
    formato: 1,
    ferramenta: "item-duplicate-sanitization",
    geradoEm: new Date().toISOString(),
    banco,
    onda,
    decisoes: impressaoDecisoes,
    grupos,
    efeitoEsperado: efeitoEsperado(grupos),
    pronto: grupos.every((grupo) => grupo.situacao !== "ABORTAR"),
    impressao: sha256(
      JSON.stringify([banco, onda, impressaoDecisoes, grupos.map((g) => [g.grupo, g.situacao, g.impressao, g.operacoes])]),
    ),
  };
}

/** PLAN: somente leitura, num retrato só. */
export function planejar(
  prisma: PrismaClient,
  onda: string,
  decisoes?: readonly DecisaoDeDuplicata[],
): Promise<Plano> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      return planejarCom(tx, onda, decisoes);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

function divergenciasDoPlano(aprovado: Plano, agora: Plano): string[] {
  const divergencias: string[] = [];
  if (aprovado.banco !== agora.banco) divergencias.push(`plano gerado em ${aprovado.banco}, banco atual ${agora.banco}`);
  if (aprovado.decisoes !== agora.decisoes) divergencias.push("o arquivo de decisão mudou desde o plano");
  if (aprovado.grupos.length !== agora.grupos.length) divergencias.push("quantidade de grupos diferente do plano");
  for (const grupo of agora.grupos) {
    const doPlano = aprovado.grupos.find((g) => g.grupo === grupo.grupo);
    if (!doPlano) {
      divergencias.push(`${grupo.grupo}: fora do plano`);
      continue;
    }
    if (doPlano.situacao !== grupo.situacao) {
      divergencias.push(`${grupo.grupo}: ${doPlano.situacao} no plano, ${grupo.situacao} agora (${grupo.motivos.join("; ")})`);
    }
    if (doPlano.impressao !== grupo.impressao) divergencias.push(`${grupo.grupo}: impressão digital diferente — registros mudaram desde o plano`);
    if (JSON.stringify(doPlano.operacoes) !== JSON.stringify(grupo.operacoes)) {
      divergencias.push(`${grupo.grupo}: operações diferentes do plano`);
    }
  }
  if (divergencias.length === 0 && aprovado.impressao !== agora.impressao) divergencias.push("impressão do plano diferente");
  return divergencias;
}

/** Trava ANTES de ler: quem chegar depois espera esta transação terminar. */
async function travar(tx: Banco, decisoes: readonly DecisaoDeDuplicata[]): Promise<void> {
  const codigos = decisoes.flatMap((d) => [d.absorvido.codigo, d.canonico.codigo]);
  const itens = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM items WHERE code = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    codigos,
  );
  const idsItens = itens.map((item) => item.id);
  const relacoes = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM supplier_items WHERE "itemId" = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    idsItens,
  );
  const idsRelacoes = relacoes.map((relacao) => relacao.id);
  await tx.$queryRawUnsafe(
    `SELECT id FROM supplier_item_offers WHERE "supplierItemId" = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    idsRelacoes,
  );
  await tx.$queryRawUnsafe(
    `SELECT id FROM supplier_item_qualification_history WHERE "supplierItemId" = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    idsRelacoes,
  );
  await tx.$queryRawUnsafe(
    `SELECT id FROM formulation_versions
     WHERE id IN (SELECT "formulationVersionId" FROM formulation_components WHERE "itemId" = ANY($1::text[]))
     ORDER BY id FOR UPDATE`,
    idsItens,
  );
  await tx.$queryRawUnsafe(
    `SELECT id FROM formulation_components WHERE "itemId" = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    idsItens,
  );
}

/**
 * Escreve uma operação de relação. Cada escrita confere quantas linhas mexeu:
 * número diferente do plano derruba a transação inteira.
 */
export async function executarRelacao(
  tx: Banco,
  op: OperacaoDeRelacao,
  absorvido: string,
  canonico: string,
  exigir: (obtido: number, esperado: number, oque: string) => void,
): Promise<void> {
  if (op.tipo === "MOVER_RELACAO") {
    exigir(
      await tx.$executeRawUnsafe(`UPDATE supplier_items SET "itemId" = $1 WHERE id = $2 AND "itemId" = $3`, canonico, op.relacao, absorvido),
      1,
      `relação com ${op.fornecedor}`,
    );
    return;
  }
  exigir(
    await tx.$executeRawUnsafe(
      `UPDATE supplier_item_offers SET "supplierItemId" = $1 WHERE "supplierItemId" = $2`,
      op.relacaoCanonica,
      op.relacaoAbsorvida,
    ),
    op.ofertas.length,
    `ofertas de ${op.fornecedor}`,
  );
  exigir(
    await tx.$executeRawUnsafe(
      `UPDATE supplier_item_qualification_history SET "supplierItemId" = $1 WHERE "supplierItemId" = $2`,
      op.relacaoCanonica,
      op.relacaoAbsorvida,
    ),
    op.eventos.length,
    `eventos de ${op.fornecedor}`,
  );
  exigir(
    await tx.$executeRawUnsafe(`DELETE FROM supplier_items WHERE id = $1 AND "itemId" = $2`, op.relacaoAbsorvida, absorvido),
    1,
    `relação do absorvido com ${op.fornecedor}`,
  );
}

async function executar(tx: Banco, grupo: AvaliacaoDoGrupo, op: Operacao): Promise<void> {
  const absorvido = grupo.absorvido.id!;
  const canonico = grupo.canonico.id!;
  const exigir = (obtido: number, esperado: number, oque: string) => {
    if (obtido !== esperado) {
      throw new Error(`ABORTADO: ${grupo.grupo} — ${oque}: ${obtido} linha(s), o plano previa ${esperado}. Nada foi gravado.`);
    }
  };
  switch (op.tipo) {
    case "CONSOLIDAR_RELACAO":
    case "MOVER_RELACAO":
      await executarRelacao(tx, op, absorvido, canonico, exigir);
      return;
    case "MOVER_COMPONENTE_RASCUNHO":
      exigir(
        await tx.$executeRawUnsafe(
          `UPDATE formulation_components SET "itemId" = $1 WHERE id = $2 AND "itemId" = $3`,
          canonico,
          op.componente,
          absorvido,
        ),
        1,
        `linha do rascunho ${op.documento}`,
      );
      return;
    case "REMOVER_ITEM":
      exigir(await tx.$executeRawUnsafe(`DELETE FROM items WHERE id = $1 AND code = $2`, op.item, op.codigo), 1, `Item ${op.codigo}`);
      return;
  }
}

/**
 * Contadores de escrita da conexão, por tabela — CASCADE e SET NULL inclusos.
 *
 * `pg_stat_xact_user_tables` NÃO é só desta transação: soma o que transações anteriores da mesma
 * conexão fizeram e o servidor ainda não descarregou (a descarga só acontece com a conexão ociosa,
 * fora de transação). Por isso o efeito é a diferença entre o retrato do início e o do fim — dentro
 * da transação nada é descarregado, e a diferença é exatamente o que ela escreveu.
 */
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

export interface OpcoesDaAplicacao {
  decisoes?: readonly DecisaoDeDuplicata[] | undefined;
  /** Ponto de teste: roda dentro da transação, depois de cada grupo aplicado. */
  aoConcluirGrupo?: (grupo: string, tx: Banco) => Promise<void> | void;
}

export interface ResultadoDaAplicacao {
  grupos: string[];
  efeito: Record<string, EfeitoNaTabela>;
}

/** APPLY: tudo ou nada, e só sobre o estado que o plano aprovado descreve. */
export async function aplicar(
  prisma: PrismaClient,
  plano: Plano,
  opcoes: OpcoesDaAplicacao = {},
): Promise<ResultadoDaAplicacao> {
  if (plano.ferramenta !== "item-duplicate-sanitization" || plano.formato !== 1) {
    throw new Error("ABORTADO: o arquivo não é um plano desta ferramenta.");
  }
  if (!plano.pronto) throw new Error("ABORTADO: o plano tem grupo em ABORTAR. Nada foi gravado.");

  return prisma.$transaction(
    async (tx) => {
      const [trava] = await tx.$queryRawUnsafe<{ travado: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS travado`,
        TRAVA,
      );
      if (trava?.travado !== true) throw new Error("ABORTADO: outra execução do saneamento está em andamento.");
      const contadoresNoInicio = await contadoresDaConexao(tx);
      await travar(tx, decisoesDestaFerramenta(plano.onda, opcoes.decisoes));

      const agora = await planejarCom(tx, plano.onda, opcoes.decisoes);
      const divergencias = divergenciasDoPlano(plano, agora);
      if (divergencias.length > 0) {
        throw new Error(
          `ABORTADO: o banco não está no estado do plano aprovado. Nada foi gravado.\n  - ${divergencias.join("\n  - ")}`,
        );
      }

      const aplicados: string[] = [];
      for (const grupo of agora.grupos) {
        if (grupo.situacao !== "PRONTO") continue;
        for (const op of grupo.operacoes) await executar(tx, grupo, op);
        aplicados.push(grupo.grupo);
        await opcoes.aoConcluirGrupo?.(grupo.grupo, tx);
      }

      const efeito = efeitoEntre(contadoresNoInicio, await contadoresDaConexao(tx));
      if (JSON.stringify(efeito) !== JSON.stringify(plano.efeitoEsperado)) {
        throw new Error(
          "ABORTADO: a transação mexeu fora do plano e foi desfeita.\n" +
            `  previsto ${JSON.stringify(plano.efeitoEsperado)}\n  obtido   ${JSON.stringify(efeito)}`,
        );
      }
      const conferencia = await verificarCom(tx, plano.onda, { decisoes: opcoes.decisoes, plano });
      if (conferencia.problemas.length > 0) {
        throw new Error(
          `ABORTADO: a conferência dentro da transação falhou, nada foi gravado.\n  - ${conferencia.problemas.join("\n  - ")}`,
        );
      }
      return { grupos: aplicados, efeito };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

export interface ResultadoDaVerificacao {
  problemas: string[];
  /** Itens MP/ME que ainda dividem o nome sem caixa, em qualquer grupo. */
  duplicidades: { nome: string; codigos: string[] }[];
}

export async function verificarCom(
  db: Banco,
  onda: string,
  opcoes: { decisoes?: readonly DecisaoDeDuplicata[] | undefined; plano?: Plano | undefined } = {},
): Promise<ResultadoDaVerificacao> {
  const daOnda = decisoesDestaFerramenta(onda, opcoes.decisoes);
  const catalogo = await lerCatalogo(db);
  const nomes = await lerNomes(db);
  const problemas: string[] = [];

  for (const decisao of daOnda) {
    const { grupo } = decisao;
    if ((await contar(db, `SELECT count(*)::int AS n FROM items WHERE code = $1`, decisao.absorvido.codigo)) > 0) {
      problemas.push(`${grupo}: ${decisao.absorvido.codigo} ainda existe`);
    }
    const recriados = await db.$queryRawUnsafe<{ code: string }[]>(
      `SELECT code FROM items WHERE "externalCode" = $1 ORDER BY code`,
      decisao.absorvido.codigoPlanilha,
    );
    for (const { code } of recriados.filter((r) => r.code !== decisao.absorvido.codigo)) {
      problemas.push(`${grupo}: ${code} tem o código da planilha do absorvido (${decisao.absorvido.codigoPlanilha})`);
    }
    const [canonico] = await db.$queryRawUnsafe<{ id: string; externalCode: string | null }[]>(
      `SELECT id, "externalCode" FROM items WHERE code = $1`,
      decisao.canonico.codigo,
    );
    if (!canonico) problemas.push(`${grupo}: canônico ${decisao.canonico.codigo} não existe`);
    else if (canonico.externalCode !== decisao.canonico.codigoPlanilha) {
      problemas.push(`${grupo}: canônico ${decisao.canonico.codigo} com código da planilha "${canonico.externalCode ?? ""}"`);
    }
    const comONome = nomes.get(nomeNormalizado(decisao.nome)) ?? [];
    if (comONome.length !== 1 || comONome[0] !== decisao.canonico.codigo) {
      problemas.push(`${grupo}: "${decisao.nome}" está em ${comONome.join(", ") || "nenhum Item"}; esperado só ${decisao.canonico.codigo}`);
    }

    const doPlano = opcoes.plano?.grupos.find((g) => g.grupo === grupo && g.situacao === "PRONTO");
    if (!doPlano || !canonico) continue;
    for (const residuo of await contarReferencias(
      db,
      catalogo,
      { id: doPlano.absorvido.id!, codigo: decisao.absorvido.codigo },
      true,
    )) {
      problemas.push(`${grupo}: resíduo do absorvido em ${residuo.tabela}.${residuo.coluna} (${residuo.linhas})`);
    }
    for (const op of doPlano.operacoes) {
      if (op.tipo === "CONSOLIDAR_RELACAO") {
        const ofertas = await contar(
          db,
          `SELECT count(*)::int AS n FROM supplier_item_offers WHERE id = ANY($1::text[]) AND "supplierItemId" = $2`,
          op.ofertas.map((o) => o.id),
          op.relacaoCanonica,
        );
        const eventos = await contar(
          db,
          `SELECT count(*)::int AS n FROM supplier_item_qualification_history WHERE id = ANY($1::text[]) AND "supplierItemId" = $2`,
          op.eventos,
          op.relacaoCanonica,
        );
        const absorvida = await contar(db, `SELECT count(*)::int AS n FROM supplier_items WHERE id = $1`, op.relacaoAbsorvida);
        const canonica = await contar(
          db,
          `SELECT count(*)::int AS n FROM supplier_items WHERE id = $1 AND "itemId" = $2`,
          op.relacaoCanonica,
          canonico.id,
        );
        if (ofertas !== op.ofertas.length) problemas.push(`${grupo}: ${op.fornecedor} com ${ofertas} de ${op.ofertas.length} oferta(s) no canônico`);
        if (eventos !== op.eventos.length) problemas.push(`${grupo}: ${op.fornecedor} com ${eventos} de ${op.eventos.length} evento(s) no canônico`);
        if (absorvida !== 0) problemas.push(`${grupo}: a relação do absorvido com ${op.fornecedor} ainda existe`);
        if (canonica !== 1) problemas.push(`${grupo}: a relação do canônico com ${op.fornecedor} não está mais no canônico`);
      } else if (op.tipo === "MOVER_RELACAO") {
        const n = await contar(db, `SELECT count(*)::int AS n FROM supplier_items WHERE id = $1 AND "itemId" = $2`, op.relacao, canonico.id);
        if (n !== 1) problemas.push(`${grupo}: relação com ${op.fornecedor} não está no canônico`);
      } else if (op.tipo === "MOVER_COMPONENTE_RASCUNHO") {
        const n = await contar(
          db,
          `SELECT count(*)::int AS n FROM formulation_components WHERE id = $1 AND "itemId" = $2`,
          op.componente,
          canonico.id,
        );
        if (n !== 1) problemas.push(`${grupo}: linha do rascunho ${op.documento} não está no canônico`);
      }
    }
  }

  const duplicidades = [...nomes]
    .filter(([, codigos]) => codigos.length > 1)
    .map(([nome, codigos]) => ({ nome, codigos }))
    .sort((x, y) => x.codigos[0]!.localeCompare(y.codigos[0]!));
  return { problemas, duplicidades };
}

/** VERIFY: somente leitura, num retrato só. */
export function verificar(
  prisma: PrismaClient,
  onda: string,
  opcoes: { decisoes?: readonly DecisaoDeDuplicata[] | undefined; plano?: Plano | undefined } = {},
): Promise<ResultadoDaVerificacao> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      return verificarCom(tx, onda, opcoes);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

/** Models que o APPLY escreve: o backup precisa ter a mesma contagem de agora. */
export const MODELS_DO_BACKUP = [
  "Item",
  "SupplierItem",
  "SupplierItemOffer",
  "SupplierItemQualificationHistory",
  "FormulationComponent",
] as const;

/**
 * O backup (`prod-backup-json.mjs`) cobre o que o plano mexe? Contagem igual à atual e cada registro
 * removido ou movido presente pelo id. Vazio = cobre.
 */
export function conferirBackup(backup: unknown, plano: Plano, contagensAtuais: Record<string, number>): string[] {
  const arquivo = backup as {
    mecanismo?: string;
    falhas?: unknown[];
    contagens?: Record<string, number>;
    dados?: Record<string, { id?: string }[]>;
  } | null;
  if (!arquivo || arquivo.mecanismo !== "prisma-logical-json" || !arquivo.contagens || !arquivo.dados) {
    return ["não é um backup de scripts/maintenance/prod-backup-json.mjs"];
  }
  if (arquivo.falhas?.length) return [`o backup registrou ${arquivo.falhas.length} falha(s)`];
  const problemas: string[] = [];
  for (const model of MODELS_DO_BACKUP) {
    if (arquivo.contagens[model] !== contagensAtuais[model]) {
      problemas.push(`${model}: backup ${String(arquivo.contagens[model])} · agora ${String(contagensAtuais[model])}`);
    }
  }
  const exigir = (model: string, id: string, oque: string) => {
    if (!(arquivo.dados![model] ?? []).some((linha) => linha.id === id)) problemas.push(`${oque} (${model} ${id}) fora do backup`);
  };
  for (const grupo of plano.grupos) {
    for (const op of grupo.operacoes) {
      if (op.tipo === "REMOVER_ITEM") exigir("Item", op.item, `${grupo.grupo} ${op.codigo}`);
      else if (op.tipo === "MOVER_RELACAO") exigir("SupplierItem", op.relacao, `${grupo.grupo} relação ${op.fornecedor}`);
      else if (op.tipo === "MOVER_COMPONENTE_RASCUNHO") {
        exigir("FormulationComponent", op.componente, `${grupo.grupo} linha de ${op.documento}`);
      } else {
        exigir("SupplierItem", op.relacaoAbsorvida, `${grupo.grupo} relação ${op.fornecedor}`);
        for (const oferta of op.ofertas) exigir("SupplierItemOffer", oferta.id, `${grupo.grupo} oferta`);
        for (const evento of op.eventos) exigir("SupplierItemQualificationHistory", evento, `${grupo.grupo} evento`);
      }
    }
  }
  return problemas;
}

function descreverOperacao(op: Operacao): string {
  switch (op.tipo) {
    case "CONSOLIDAR_RELACAO":
      return (
        `consolidar relação ${op.fornecedor}: ${op.ofertas.length} oferta(s) ` +
        `(sourceKey ${op.ofertas.map((o) => o.sourceKey ?? "—").join(", ")}) e ${op.eventos.length} evento(s) ` +
        "passam para a relação do canônico; a relação do absorvido sai"
      );
    case "MOVER_RELACAO":
      return `mover relação ${op.fornecedor} para o canônico (${op.ofertas} oferta(s) e ${op.eventos} evento(s) vão junto)`;
    case "MOVER_COMPONENTE_RASCUNHO":
      return `mover linha do rascunho ${op.documento} para o canônico`;
    case "REMOVER_ITEM":
      return `remover Item ${op.codigo}`;
  }
}

export function descreverEfeito(efeito: Record<string, EfeitoNaTabela>): string {
  const partes = Object.entries(efeito).map(
    ([tabela, e]) =>
      `${tabela} ${[e.ins && `+${e.ins} inserida(s)`, e.upd && `${e.upd} alterada(s)`, e.del && `−${e.del} removida(s)`]
        .filter(Boolean)
        .join(", ")}`,
  );
  return partes.length > 0 ? partes.join(" · ") : "nenhuma linha";
}

export function descreverPlano(plano: Plano, destino: string): string[] {
  const linhas = [
    `PLANO — saneamento de duplicatas de Item · onda ${plano.onda}`,
    `gerado em ${plano.geradoEm} · banco ${plano.banco} (${destino})`,
    `decisões ${plano.decisoes.slice(0, 16)}… · impressão do plano ${plano.impressao.slice(0, 16)}…`,
    "",
  ];
  for (const g of plano.grupos) {
    linhas.push(
      `${g.grupo.padEnd(4)} ${g.situacao.padEnd(10)} ${g.absorvido.codigo} "${g.absorvido.nome ?? "—"}" (planilha ${g.absorvido.codigoPlanilha})` +
        ` → ${g.canonico.codigo} "${g.canonico.nome ?? "—"}" (planilha ${g.canonico.codigoPlanilha})`,
    );
    for (const op of g.operacoes) linhas.push(`       ${descreverOperacao(op)}`);
    for (const motivo of g.motivos) linhas.push(`       ! ${motivo}`);
    linhas.push(`       impressão ${g.impressao}`);
  }
  linhas.push("", `EFEITO ESPERADO: ${descreverEfeito(plano.efeitoEsperado)}`);
  linhas.push(`PRONTO PARA APLICAR: ${plano.pronto ? "SIM" : "NÃO"}`);
  return linhas;
}

function descreverVerificacao(resultado: ResultadoDaVerificacao, onda: string): string[] {
  const linhas = [`VERIFY — onda ${onda}: ${resultado.problemas.length === 0 ? "OK" : `${resultado.problemas.length} problema(s)`}`];
  for (const problema of resultado.problemas) linhas.push(`  ! ${problema}`);
  const itens = resultado.duplicidades.reduce((soma, d) => soma + d.codigos.length, 0);
  linhas.push(`DUPLICIDADES RESTANTES (MP/ME, nome sem caixa): ${resultado.duplicidades.length} grupo(s), ${itens} Item(ns)`);
  for (const d of resultado.duplicidades) linhas.push(`  ${d.codigos.join(" · ")}  ${d.nome}`);
  return linhas;
}

const argumento = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);

async function main(): Promise<void> {
  const comando = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const onda = argumento("onda");
  if (!comando || !["plan", "apply", "verify"].includes(comando) || !onda) {
    console.error("uso: item-duplicate-sanitization.ts plan|apply|verify --onda=<onda> [--plano=…] [--backup=…] [--confirmar-banco=…]");
    process.exitCode = 1;
    return;
  }
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL ausente.");
  // APPLY só em banco local: produção é outra rodada, com conferência e aprovação antes.
  if (comando === "apply") exigirBancoLocal();
  const destino = descreverDestino(url);
  const arquivoPlano = argumento("plano");

  // O client é o da API, como nos vizinhos: `@prisma/client` não resolve a partir de `scripts/`.
  const { PrismaClient: Cliente } = createRequire(`${process.cwd()}/apps/api/package.json`)("@prisma/client") as {
    PrismaClient: new () => PrismaClient;
  };
  const prisma = new Cliente();
  try {
    if (comando === "plan") {
      const plano = await planejar(prisma, onda);
      console.log(descreverPlano(plano, destino).join("\n"));
      if (arquivoPlano) {
        fs.mkdirSync(path.dirname(arquivoPlano), { recursive: true });
        fs.writeFileSync(arquivoPlano, `${JSON.stringify(plano, null, 2)}\n`, "utf8");
        console.log(`\nPlano salvo em ${arquivoPlano}`);
      }
      console.log("\nSomente leitura: nada foi alterado.");
      process.exitCode = plano.pronto ? 0 : 2;
      return;
    }

    if (comando === "verify") {
      const plano = arquivoPlano ? (JSON.parse(fs.readFileSync(arquivoPlano, "utf8")) as Plano) : undefined;
      const resultado = await verificar(prisma, onda, { plano });
      console.log(descreverVerificacao(resultado, onda).join("\n"));
      process.exitCode = resultado.problemas.length === 0 ? 0 : 1;
      return;
    }

    const arquivoBackup = argumento("backup");
    const confirmacao = argumento("confirmar-banco");
    if (!arquivoPlano || !arquivoBackup || !confirmacao) {
      throw new Error("APPLY exige --plano=<plano.json>, --backup=<backup.json> e --confirmar-banco=<banco>.");
    }
    const plano = JSON.parse(fs.readFileSync(arquivoPlano, "utf8")) as Plano;
    if (plano.onda !== onda) throw new Error(`o plano é da onda ${plano.onda}, não da ${onda}.`);
    const banco = await bancoAtual(prisma);
    if (confirmacao !== banco) throw new Error(`--confirmar-banco=${confirmacao} não é o banco conectado (${banco}).`);
    const contagens: Record<string, number> = {
      Item: await prisma.item.count(),
      SupplierItem: await prisma.supplierItem.count(),
      SupplierItemOffer: await prisma.supplierItemOffer.count(),
      SupplierItemQualificationHistory: await prisma.supplierItemQualificationHistory.count(),
      FormulationComponent: await prisma.formulationComponent.count(),
    };
    const problemasDoBackup = conferirBackup(JSON.parse(fs.readFileSync(arquivoBackup, "utf8")), plano, contagens);
    if (problemasDoBackup.length > 0) {
      throw new Error(`o backup não cobre o plano. Nada foi alterado.\n  - ${problemasDoBackup.join("\n  - ")}`);
    }
    console.log(descreverPlano(plano, destino).join("\n"));
    console.log(`\nBackup ${arquivoBackup}: cobre o plano (contagens iguais às atuais).`);
    console.log("\n=== APLICANDO (uma transação) ===");
    const resultado = await aplicar(prisma, plano);
    console.log(`grupos aplicados: ${resultado.grupos.join(", ") || "nenhum"}`);
    console.log(`efeito da transação: ${descreverEfeito(resultado.efeito)}`);
    const conferencia = await verificar(prisma, onda, { plano });
    console.log(`\n${descreverVerificacao(conferencia, onda).join("\n")}`);
    process.exitCode = conferencia.problemas.length === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Importado pelo teste não conecta em nada.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/maintenance/item-duplicate-sanitization.ts")) {
  main().catch((erro: unknown) => {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`FALHOU: ${mensagem.replace(/postgres(ql)?:\/\/\S*/gi, "<conexão omitida>")}`);
    process.exitCode = 1;
  });
}
