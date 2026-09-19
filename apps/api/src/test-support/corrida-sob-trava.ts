import type { Prisma } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";

/**
 * Corrida determinística entre transições de documento
 * (DOCUMENT-TRANSITION-CONCURRENCY-01).
 *
 * Uma transição só perde para outra quando as duas se intercalam de verdade, e
 * teste sequencial nunca intercala. A receita é a do repositório
 * (`veridi-teste-corrida-sob-trava`): uma transação do próprio teste segura uma
 * trava que a primeira operação toma DEPOIS da raiz, a primeira para ali com a
 * raiz já travada, a segunda chega, e só então o teste solta.
 *
 * Quem parou em quem é lido do próprio banco, por `pg_blocking_pids` — não pelo
 * texto da consulta: a corrente "teste → operação 1 → operação 2" fica provada
 * pid a pid, e um arquivo vizinho esperando trava no mesmo banco não conta.
 * Nenhuma espera por tempo decide a ordem.
 */

export interface TransacaoDoTeste {
  /** Cliente da transação aberta — para tomar travas, inclusive depois de abrir. */
  tx: Prisma.TransactionClient;
  /** Conexão (backend) que segura as travas desta transação. */
  pid: number;
  /** Confirma a transação (ela só trava, não grava) e espera o fim. */
  soltar: () => Promise<void>;
}

/** Abre uma transação que fica aberta até `soltar()`. */
export async function abrirTransacaoDoTeste(): Promise<TransacaoDoTeste> {
  let liberar!: () => void;
  const segurando = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  let avisarAberta!: (aberta: { tx: Prisma.TransactionClient; pid: number }) => void;
  const aberta = new Promise<{ tx: Prisma.TransactionClient; pid: number }>((resolve) => {
    avisarAberta = resolve;
  });

  const fim = getPrisma().$transaction(
    async (tx) => {
      const [linha] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      avisarAberta({ tx, pid: linha!.pid });
      await segurando;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const { tx, pid } = await Promise.race([
    aberta,
    fim.then(() => {
      throw new Error("a transação do teste terminou antes de abrir");
    }),
  ]);
  let solta = false;
  return {
    tx,
    pid,
    soltar: async () => {
      if (solta) return;
      solta = true;
      liberar();
      await fim;
    },
  };
}

/** Conexões paradas numa trava que `pid` segura (ou em que está à frente na fila). */
export async function paradasEm(pid: number): Promise<number[]> {
  const linhas = await getPrisma().$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database()
      AND ${pid}::int = ANY(pg_blocking_pids(pid))
    ORDER BY pid`;
  return linhas.map((linha) => linha.pid);
}

/**
 * Espera `condicao()` valer — consulta a cada 25 ms, até 4 s. O prazo fica
 * abaixo dos 5 s da transação interativa do serviço: se a condição não vier,
 * o teste cai com o motivo, antes de a transação expirar e virar outro erro.
 */
export async function esperarAte(descricao: string, condicao: () => Promise<boolean>): Promise<void> {
  const limite = Date.now() + 4_000;
  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`tempo esgotado esperando: ${descricao}`);
}

/** Espera uma conexão parar numa trava de `pid`, e devolve o pid dela. */
export async function esperarParadaEm(pid: number, descricao: string): Promise<number> {
  let parada: number | undefined;
  await esperarAte(descricao, async () => {
    [parada] = await paradasEm(pid);
    return parada !== undefined;
  });
  return parada!;
}

/** Marca quando uma promessa termina (resolvida ou rejeitada), sem consumi-la. */
export function acompanhar<T>(promessa: Promise<T>): { terminou: () => boolean } {
  let terminou = false;
  promessa.then(
    () => {
      terminou = true;
    },
    () => {
      terminou = true;
    },
  );
  return { terminou: () => terminou };
}
