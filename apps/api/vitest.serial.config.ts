import { defineConfig, loadEnv } from "vite";

/**
 * Faixa serial da suíte da API.
 *
 * Existe por um motivo só: alguns testes medem um AGREGADO DO BANCO INTEIRO.
 * O painel operacional é exatamente isso — "quantos itens distintos estão em
 * compra", "quantas ordens estão abertas" — e a única forma honesta de
 * verificar um número global é comparar dois retratos em volta da própria
 * fixture.
 *
 * Isso não sobrevive a concorrência num banco compartilhado. A suíte roda em
 * três workers contra um Postgres só, e quando outro arquivo limpava as
 * fixtures dele entre os dois retratos, o delta media a limpeza do vizinho
 * em vez da mudança do teste. Falhava sem nada estar errado, e num arquivo
 * diferente a cada execução.
 *
 * A alternativa seria enfraquecer a asserção (trocar igualdade por "pelo
 * menos") ou reescrever no teste a mesma consulta que o read model faz — a
 * primeira deixaria de provar a regra, a segunda faria o teste concordar
 * consigo mesmo em vez de com o sistema. Nenhuma expectativa foi alterada:
 * o que mudou é QUANDO o arquivo roda.
 *
 * O segundo arquivo entrou pelo mesmo critério, com outra forma de estado
 * global: `gmp-execution.test.ts` cria revisões de documento controlado e as
 * ATIVA. "Revisão ativa" é uma só por tipo, para o banco inteiro, e o RELEASE
 * de qualquer Ordem de Produção — em qualquer arquivo — congela o id da
 * revisão vigente dentro da própria transação. Quando a limpeza do GMP apagava
 * essas revisões entre a leitura e a escrita de um vizinho, o release estourava
 * `P2003 production_orders_productionOrderRevisionId_fkey` num arquivo
 * diferente a cada execução — `costs`, `picking`, `consumption`. Nenhuma
 * expectativa mudou aqui também: o arquivo só deixou de ter vizinho.
 *
 * Só entra aqui arquivo que dependa de estado global de forma inevitável.
 * Todo o resto continua em paralelo, no `vitest.config.ts`.
 */
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, "../../", ""),
    include: [
      "src/modules/dashboard/dashboard.test.ts",
      "src/modules/production-orders/gmp-execution.test.ts",
    ],
    // Um worker, um arquivo por vez: nenhum vizinho escrevendo no banco
    // enquanto um agregado global é medido.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
}));
