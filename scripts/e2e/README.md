# E2E — estado e regras

As suítes E2E exploratórias e adversariais históricas foram **aposentadas em
2026-09-04**. Cobertura de regressão relevante foi preservada em testes de
domínio, API e web. Novas suítes E2E canônicas serão construídas depois das
capabilities atuais.

O mapa de qual regra está protegida onde está em
[`docs/TEST_COVERAGE_MAP.md`](../../docs/TEST_COVERAGE_MAP.md). O plano das
suítes futuras está em [`docs/E2E_STRATEGY.md`](../../docs/E2E_STRATEGY.md).

## Por que foram aposentadas

Eram roteiros de aceitação de uma entrega específica: provavam que a capability
`NN` funcionava no dia em que nasceu. Uma vez que a regra virou teste de
domínio, o roteiro deixa de proteger e passa a custar — leitura, execução,
manutenção e, pior, a chance de alguém rodar um script que depende de massa que
não existe mais e ler o resultado como defeito do produto.

Três defeitos de laboratório que isso já causou, e que as regras abaixo
existem para impedir:

- suíte com nome fixo reencontrava massa da execução anterior e contava 14 lotes
  onde afirmava 6;
- verificação citava `FAT-000152` numa base cujo maior faturamento era
  `FAT-000020`, e reportava isso como regressão;
- veredito ficava em arquivo de estado, então reexecutar repetia o resultado
  gravado em vez de reavaliar.

## Regras para as suítes novas

1. **Cada suíte cria a própria massa**, carimbada com o `runId` de
   `lib/run-id.mjs`. Nunca "pegue o primeiro cliente", nunca `PROD-000123`.
2. **Mutação de negócio pela interface.** API e banco entram só como
   verificação, nunca para fabricar o estado que o teste deveria criar clicando.
3. **Happy path e caminhos negativos na MESMA suíte.** Separar "o feliz agora, o
   adversarial daqui a meses" foi o que produziu as suítes que esta pasta
   aposentou.
4. **Console sujo é reprovação.** `console.error` e `pageerror` contam.
5. **Sem estado entre execuções.** Nada de veredito gravado: rodar de novo
   reavalia.
6. **Poucas, completas e determinísticas.** Quatro suítes vivas valem mais que
   quarenta roteiros mortos.

## `lib/`

| Arquivo | O que dá |
|---|---|
| `browser.mjs` | navegador autenticado por cookie da API, cliente HTTP, coletor de erros de console |
| `run-id.mjs` | token de execução para carimbar a massa desta rodada |

Os helpers não carregam contexto de negócio — nenhum produto, cliente, lote,
pedido, preço ou finding específico. Se um helper precisar disso, ele pertence à
suíte, não à `lib/`.
