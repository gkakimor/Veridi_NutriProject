import { defineConfig, loadEnv } from "vite";
import { ambienteComBancoDeTeste } from "./src/test-support/banco-de-teste.js";

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
 * `controlled-documents.test.ts` (QUALITY-DOC-WRITE-01) entrou pelo mesmo
 * critério do GMP: provar que a Qualidade ATIVA revisão troca a vigente do
 * banco inteiro enquanto o teste dura.
 *
 * `production-calendar.test.ts` e `production-schedules.test.ts`
 * (PLANNING-CALENDAR-WEEKLY-SCHEDULE-01) entraram pelo mesmo critério: o
 * Calendário de Produção é UM, global, e os dois arquivos o regravam — o
 * primeiro apaga o calendário para provar "ainda não configurado" e a
 * migração da jornada legada; o segundo troca a jornada da semana para provar
 * a agenda. Em paralelo, um apagava o calendário no meio da agenda do outro.
 * Desde TEST-ISOLATION-CALENDAR-01 cada um guarda o calendário que encontrou e
 * o devolve no fim (`src/test-support/calendario-de-producao.ts`) — o que não
 * dispensa a faixa: enquanto o arquivo roda, o calendário é só dele.
 *
 * Desde TEST-SUPPORT-ISOLATION-WAVE-01 esse calendário é o do BANCO DE TESTE,
 * nunca o de quem usa o DEV (`src/test-support/banco-de-teste.ts`): a faixa
 * não depende mais de devolver nada para não estragar dado de ninguém, e um
 * kill antes do `afterAll` só deixa rastro no banco de teste. A devolução
 * continua, como defesa a mais.
 *
 * `dashboard-retrato-unico.test.ts` (DASHBOARD-SNAPSHOT-CONSISTENCY-01) entrou
 * pelo critério do painel: compara o Painel inteiro antes, durante e depois de
 * uma escrita — com vizinho escrevendo, "antes" e "durante" diferem sem nada
 * estar errado.
 *
 * `dashboard-conjuntos-uma-vez.test.ts` (PERFORMANCE-CLEANUP-WAVE-01), pelo
 * mesmo critério: compara o Painel com cada conjunto do banco inteiro calculado
 * à parte logo depois.
 *
 * `management-dashboard.test.ts` (MANAGEMENT-DASHBOARD-V1-01), pelo critério
 * do painel: a carteira (A expedir, A faturar) e os próximos compromissos são
 * do banco inteiro. O teste mede o Painel Gerencial dentro de uma transação
 * desfeita que tira do retrato os Pedidos, Expedições e OCs abertos que não são
 * dele — com vizinho escrevendo ao lado, essa escrita esperaria a trava dele.
 *
 * `users-guarda-do-administrador.test.ts` (USER-LAST-ADMIN-GUARD-01): "o
 * último ADMIN ativo" é do banco inteiro, e todo arquivo que usa
 * `buildTestApp("ADMIN")` cria um administrador ativo. O arquivo tira do
 * conjunto os ADMIN que encontra, monta o dele caso a caso e os devolve no fim
 * — com vizinho ao lado, o "único" nunca seria único.
 *
 * Só entra aqui arquivo que dependa de estado global de forma inevitável.
 * Todo o resto continua em paralelo, no `vitest.config.ts`.
 */
export default defineConfig(({ mode }) => ({
  test: {
    env: ambienteComBancoDeTeste(loadEnv(mode, "../../", "")),
    // Os mesmos da faixa paralela — ver `vitest.config.ts`.
    globalSetup: ["./src/test-support/preparar-banco-de-teste.ts"],
    setupFiles: ["./src/test-support/ciclo-do-arquivo-de-teste.ts"],
    include: [
      "src/modules/dashboard/dashboard.test.ts",
      "src/modules/dashboard/dashboard-retrato-unico.test.ts",
      "src/modules/dashboard/dashboard-conjuntos-uma-vez.test.ts",
      "src/modules/management-dashboard/management-dashboard.test.ts",
      "src/modules/production-orders/gmp-execution.test.ts",
      "src/modules/controlled-documents/controlled-documents.test.ts",
      "src/modules/production-calendar/production-calendar.test.ts",
      "src/modules/production-schedules/production-schedules.test.ts",
      "src/modules/users/users-guarda-do-administrador.test.ts",
    ],
    // Um worker, um arquivo por vez: nenhum vizinho escrevendo no banco
    // enquanto um agregado global é medido.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
}));
