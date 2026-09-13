import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";

/**
 * O Calendário de Produção emprestado a um arquivo de teste — e devolvido
 * como estava.
 *
 * O calendário é UM, global, e os testes da API rodam no banco da `.env`: no
 * DEV, é o calendário de quem usa o sistema. Provar "ainda não configurado"
 * exige tirá-lo do banco; provar a agenda exige regravar a semana. Antes daqui,
 * a limpeza apagava o calendário e as exceções do ano de teste existissem
 * antes ou não, e depois da faixa serial o DEV ficava sem jornada — toda
 * programação recusava (TEST-ISOLATION-CALENDAR-01).
 *
 * `guardarCalendarioDeProducao` lê, ANTES de qualquer escrita e numa consulta
 * só, a linha do calendário, os dias da semana e as exceções do ano reservado
 * do arquivo — linhas inteiras, coluna a coluna, pelo próprio Postgres.
 * `devolverCalendarioDeProducao` tira o que ficou, regrava exatamente essas
 * linhas numa transação e relê para conferir: calendário que não existia
 * continua não existindo; o que existia volta com os mesmos ids, horários,
 * autores e datas. O que o teste criou no ano reservado sai; exceção de outro
 * ano nunca é tocada.
 *
 * É isolamento no TEMPO: enquanto o arquivo roda, o calendário é dele — por
 * isso os arquivos que o usam ficam na faixa serial. A devolução roda no
 * `afterAll`, que o Vitest executa com teste falhando e com `beforeAll`
 * falhando; processo morto no meio (kill) não chega lá.
 */
export interface CalendarioGuardado {
  readonly ano: number;
  readonly linhas: LinhasDoCalendario;
}

interface LinhasDoCalendario {
  readonly calendarios: readonly unknown[];
  readonly dias: readonly unknown[];
  readonly excecoes: readonly unknown[];
}

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** A data da exceção é o marcador do dia civil (meia-noite, sem fuso). */
const noAno = (ano: number) =>
  Prisma.sql`"date" >= ${`${ano}-01-01`}::timestamp AND "date" < ${`${ano + 1}-01-01`}::timestamp`;

async function lerLinhas(prisma: PrismaOrTx, ano: number): Promise<LinhasDoCalendario> {
  const [linha] = await prisma.$queryRaw<
    Array<{ calendarios: unknown[] | null; dias: unknown[] | null; excecoes: unknown[] | null }>
  >`
    SELECT
      (SELECT json_agg(c ORDER BY c."id") FROM "production_calendars" c) AS "calendarios",
      (SELECT json_agg(w ORDER BY w."id") FROM "production_calendar_weekdays" w) AS "dias",
      (SELECT json_agg(e ORDER BY e."id") FROM "production_calendar_exceptions" e
        WHERE ${noAno(ano)}) AS "excecoes"`;
  return {
    calendarios: linha?.calendarios ?? [],
    dias: linha?.dias ?? [],
    excecoes: linha?.excecoes ?? [],
  };
}

/** A linha volta com o tipo da própria tabela: toda coluna, inclusive as que vierem depois. */
const regravar = (
  tabela: "production_calendars" | "production_calendar_weekdays" | "production_calendar_exceptions",
  linhas: readonly unknown[],
) =>
  Prisma.sql`INSERT INTO ${Prisma.raw(`"${tabela}"`)}
    SELECT * FROM json_populate_recordset(NULL::${Prisma.raw(`"${tabela}"`)}, ${JSON.stringify(linhas)}::json)`;

export async function guardarCalendarioDeProducao(ano: number): Promise<CalendarioGuardado> {
  return { ano, linhas: await lerLinhas(getPrisma(), ano) };
}

export async function devolverCalendarioDeProducao({ ano, linhas }: CalendarioGuardado): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "production_calendar_exceptions" WHERE ${noAno(ano)}`;
    // Os dias da semana saem junto (ON DELETE CASCADE).
    await tx.$executeRaw`DELETE FROM "production_calendars"`;
    if (linhas.calendarios.length > 0) await tx.$executeRaw(regravar("production_calendars", linhas.calendarios));
    if (linhas.dias.length > 0) await tx.$executeRaw(regravar("production_calendar_weekdays", linhas.dias));
    if (linhas.excecoes.length > 0) await tx.$executeRaw(regravar("production_calendar_exceptions", linhas.excecoes));
  });

  const devolvidas = await lerLinhas(prisma, ano);
  if (JSON.stringify(devolvidas) !== JSON.stringify(linhas)) {
    throw new Error(
      "O Calendário de Produção voltou diferente do que o teste encontrou — confira o banco da .env antes de programar.",
    );
  }
}
