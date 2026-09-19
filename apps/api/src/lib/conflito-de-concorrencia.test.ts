import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ehConflitoDeConcorrencia } from "./conflito-de-concorrencia.js";

/**
 * As formas reais — deadlock numa consulta de modelo e transação que expira na
 * trava — são provadas nos testes de corrida de Expedição, OP e OC. Aqui fica a
 * tabela: o que é "perdeu a corrida" e o que continua sendo erro de verdade.
 */

const clientVersion = Prisma.prismaVersion.client;

function conhecido(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`erro ${code}`, { code, clientVersion });
}

function desconhecido(message: string) {
  return new Prisma.PrismaClientUnknownRequestError(message, { clientVersion });
}

describe("ehConflitoDeConcorrencia", () => {
  it.each([
    ["P2034 (conflito de escrita)", conhecido("P2034")],
    ["P2028 (transação expirou na trava)", conhecido("P2028")],
    [
      "deadlock numa consulta de modelo",
      desconhecido(
        'Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected", severity: "ERROR" }), transient: false })',
      ),
    ],
  ])("%s é conflito de concorrência", (caso, erro) => {
    expect(ehConflitoDeConcorrencia(erro), caso).toBe(true);
  });

  it.each([
    ["P2002 (único violado)", conhecido("P2002")],
    ["P2025 (registro não encontrado)", conhecido("P2025")],
    [
      "outro erro do banco sem código de deadlock",
      desconhecido('QueryError(PostgresError { code: "23503", message: "insert or update violates foreign key" })'),
    ],
    ["erro comum", new Error('code: "40P01"')],
    ["valor que não é erro", "40P01"],
  ])("%s não é conflito de concorrência", (caso, erro) => {
    expect(ehConflitoDeConcorrencia(erro), caso).toBe(false);
  });
});
