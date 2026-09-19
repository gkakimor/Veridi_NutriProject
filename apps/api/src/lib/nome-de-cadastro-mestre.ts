import type { Prisma } from "@prisma/client";
import type { FastifyReply } from "fastify";
import type { CadastroMestre } from "@veridi/shared";
import { mensagemDeNomeDuplicado } from "@veridi/shared";
import { getPrisma } from "../db/prisma.js";

/**
 * Guarda de nome duplicado nos cadastros mestre
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * Decisão do PO: "ABC", "Abc" e "abc" são o MESMO nome. A API é a autoridade
 * — a tela pode antecipar a recusa, mas quem decide é aqui.
 *
 * A comparação é `upper(btrim(<coluna>))` dos dois lados: `trim` + sem caixa,
 * **acento preservado**. É a mesma expressão que a ferramenta de saneamento
 * usa para agrupar e que o índice único de MASTER-DATA-NAME-UNIQUENESS-01 vai
 * usar no banco.
 *
 * **Isto não é a constraint.** Entre o SELECT e o INSERT existe uma janela em
 * que duas requisições simultâneas passam as duas — o banco ainda não tem
 * índice que as recuse, porque criá-lo por cima de duplicata existente
 * falharia, e o saneamento vem antes (decisão do PO nesta rodada: nenhuma
 * migration de índice aqui). Fechar a janela é o trabalho de
 * MASTER-DATA-NAME-UNIQUENESS-01; até lá o guarda pega o caso real — a pessoa
 * recadastrando o que já existe — e não pega a corrida.
 *
 * **O guarda impede duplicidade NOVA; não prende a que já existe**
 * (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01). O cadastro que nasceu
 * duplicado antes do guarda — 21 grupos de Itens em PROD no preflight de
 * 2026-09-18 — continua editável enquanto o nome efetivo não muda; ver
 * `exigirNomeDeCadastroLivre`.
 */

export class DuplicateMasterDataNameError extends Error {
  cadastro: CadastroMestre;
  nome: string;
  codigoExistente: string | null;

  constructor(cadastro: CadastroMestre, nome: string, codigoExistente: string | null) {
    super(mensagemDeNomeDuplicado(cadastro, codigoExistente));
    this.name = "DuplicateMasterDataNameError";
    this.cadastro = cadastro;
    this.nome = nome;
    this.codigoExistente = codigoExistente;
  }
}

interface ColunasDoCadastro {
  tabela: string;
  colunaId: string;
  colunaNome: string;
  colunaCodigo: string;
}

/**
 * Tabela e colunas de cada cadastro. Literais fixos — nada aqui vem de
 * requisição, e é por isso que o identificador pode entrar no SQL. O valor do
 * nome e o id excluído são sempre parâmetros.
 */
const COLUNAS: Record<CadastroMestre, ColunasDoCadastro> = {
  ITEM: { tabela: "items", colunaId: "id", colunaNome: "name", colunaCodigo: "code" },
  CUSTOMER: { tabela: "customers", colunaId: "id", colunaNome: "legalName", colunaCodigo: "code" },
  SUPPLIER: { tabela: "suppliers", colunaId: "id", colunaNome: "legalName", colunaCodigo: "code" },
  PRODUCT: { tabela: "products", colunaId: "id", colunaNome: "name", colunaCodigo: "code" },
  INDUSTRIAL_RESOURCE: {
    tabela: "industrial_resources",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
  },
  FORMULATION_TEMPLATE: {
    tabela: "formulation_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
  },
  INDUSTRIAL_COST_TEMPLATE: {
    tabela: "industrial_cost_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
  },
  PRICING_POLICY_TEMPLATE: {
    tabela: "pricing_policy_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
  },
  PRODUCTION_PROFILE: {
    tabela: "production_profiles",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
  },
};

const ident = (nome: string): string => `"${nome.replace(/"/g, '""')}"`;

type Executor = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

/** O código do cadastro que já usa este nome, ou `null`. */
export async function cadastroComOMesmoNome(
  cadastro: CadastroMestre,
  nome: string,
  excluirId?: string | undefined,
  db: Executor = getPrisma(),
): Promise<string | null> {
  const colunas = COLUNAS[cadastro];
  const filtroDoId = excluirId ? ` AND ${ident(colunas.colunaId)}::text <> $2` : "";
  const linhas = await db.$queryRawUnsafe<{ codigo: string }[]>(
    `SELECT ${ident(colunas.colunaCodigo)} AS codigo
       FROM ${ident(colunas.tabela)}
      WHERE upper(btrim(${ident(colunas.colunaNome)})) = upper(btrim($1))${filtroDoId}
      ORDER BY 1
      LIMIT 1`,
    nome,
    ...(excluirId ? [excluirId] : []),
  );
  return linhas[0]?.codigo ?? null;
}

/**
 * O registro já tem este nome efetivo? `upper(btrim(<gravado>))` contra
 * `upper(btrim(<pedido>))` — a MESMA expressão da busca, avaliada pelo banco,
 * para que "igual ao próprio nome" e "igual ao nome de outro" nunca discordem
 * em caractere nenhum. Registro que não existe responde `false`.
 */
export async function mantemONomeGravado(
  cadastro: CadastroMestre,
  id: string,
  nome: string,
  db: Executor = getPrisma(),
): Promise<boolean> {
  const colunas = COLUNAS[cadastro];
  const linhas = await db.$queryRawUnsafe<{ mesmo: boolean | null }[]>(
    `SELECT upper(btrim(${ident(colunas.colunaNome)})) = upper(btrim($1)) AS mesmo
       FROM ${ident(colunas.tabela)}
      WHERE ${ident(colunas.colunaId)}::text = $2`,
    nome,
    id,
  );
  return linhas[0]?.mesmo === true;
}

/**
 * Recusa o nome que já existe em OUTRO cadastro.
 *
 * Sem `idEmEdicao` é criação, e a busca roda sempre.
 *
 * Com `idEmEdicao` (o próprio registro, na edição), o nome pedido é primeiro
 * comparado com o gravado. Mesmo nome efetivo — caixa ou espaço nas pontas
 * diferentes — não é renome, e a busca de conflito NÃO roda: o formulário
 * manda o nome de volta a cada Salvar, e o cadastro que já nasceu duplicado
 * de outro não pode ficar sem edição até o saneamento
 * (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01). Nome efetivo diferente —
 * acento diferente conta — é renome: procura, sem contar o próprio registro.
 */
export async function exigirNomeDeCadastroLivre(
  cadastro: CadastroMestre,
  nome: string,
  idEmEdicao?: string | undefined,
  db: Executor = getPrisma(),
): Promise<void> {
  if (idEmEdicao && (await mantemONomeGravado(cadastro, idEmEdicao, nome, db))) return;
  const existente = await cadastroComOMesmoNome(cadastro, nome, idEmEdicao, db);
  if (existente !== null) throw new DuplicateMasterDataNameError(cadastro, nome, existente);
}

/**
 * A resposta única da recusa: 409 com a frase pronta e o código do cadastro
 * que já usa o nome. Uma só, para que as nove telas não inventem nove textos.
 */
export function responderNomeDuplicado(
  reply: FastifyReply,
  error: DuplicateMasterDataNameError,
): FastifyReply {
  return reply.status(409).send({
    error: "duplicate_name",
    message: error.message,
    existingCode: error.codigoExistente,
  });
}
