import { Prisma } from "@prisma/client";

/**
 * A transação perdeu uma corrida com outra operação e foi desfeita inteira —
 * nada foi gravado, e tentar de novo resolve. É recusa 409, nunca 500
 * (DOCUMENT-TRANSITION-CONCURRENCY-01).
 *
 * O Prisma 6.19 entrega esse acontecimento em formas diferentes:
 * - P2034 (conflito de escrita) e P2028 (a transação interativa expirou
 *   esperando a trava de outra operação);
 * - `PrismaClientUnknownRequestError`, sem código próprio, com o `40P01` do
 *   PostgreSQL só no texto, quando o banco escolhe a transação como vítima de
 *   um deadlock numa consulta de modelo (conferido no teste de deadlock do
 *   cancelamento de OP).
 */
export function ehConflitoDeConcorrencia(erro: unknown): boolean {
  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    return erro.code === "P2034" || erro.code === "P2028";
  }
  if (erro instanceof Prisma.PrismaClientUnknownRequestError) {
    return erro.message.includes('code: "40P01"');
  }
  return false;
}
