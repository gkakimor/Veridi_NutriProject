# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

Este arquivo responde quatro perguntas: onde estamos, o que está aberto, qual é
a próxima prioridade e como estão DEV e produção. **Não é changelog** — o log
cronológico vive no Git e em [`archive/`](archive/).

## Onde estamos

**`main` @ `0134674`.** MVP operacional validado internamente, blocos A a G
fechados: cadastros, compras, recebimento, qualidade, produção rastreada,
expedição, faturamento, custo industrial, cockpit, relatórios, projetos,
orçamentos e precificação.

**Auditoria de produto de 2026-09-07 — dez cenários ponta a ponta pela
interface, contra a base recarregada com os dados reais da Veridi.** Os dez
passaram. Trinta e nove conferências numéricas independentes bateram sem uma
diferença, e a precisão foi demonstrada preservada ponta a ponta (o preço
sugerido saiu R$ 16,44 do custo cheio `10,68903`, não R$ 16,45 do custo
arredondado). Achados em [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md): **1
HIGH, 8 MEDIUM, 4 LOW, 7 UX, 2 observações, zero CRITICAL.** Nada foi corrigido
— a rodada era auditoria, e o PO decide o que vira backlog.

**A fundação de precisão numérica está completa e fechada.** A cadeia inteira —
schema, persistência, serialização, formatação e comparação — respeita a matriz
de tipos de [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58, com quatro fronteiras de
fechamento nomeadas (§60, §62, §63), a assimetria entre elas declarada (§64) e o
motor decimal em 40 dígitos numa configuração canônica (§59). O único HIGH da
auditoria é de EXIBIÇÃO, não de cálculo: a quantidade reservada é mostrada
arredondada para cima e a validação compara com o valor cheio, então o operador
não consegue digitar o número que a própria tela mostra.

**`schema.prisma` e as migrations estão em sincronia** desde o #14: um banco
reconstruído do zero, DEV e produção são a mesma estrutura, campo a campo.

## O que está aberto

[`BACKLOG.md`](BACKLOG.md) — **zero CRITICAL, zero blocker**. O que sobra:

- **achados da auditoria de 2026-09-07**, ainda não triados pelo PO:
  [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md);
- **melhorias aprovadas, aguardando autorização do PO:** #8E, #8F, #8G;
- **aguardando validação com a Veridi:** #7 e #11;
- **manutenção:** #10;
- **watchlist** (observado, sem ação conhecida): W1 a W6.

Escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

## Próxima prioridade

**Triagem dos achados da auditoria pelo PO** — o que vira backlog e em que
ordem. O F-08-1 (HIGH) trava o consumo de produção para toda formulação com
correção de pureza ou overage.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11). Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## DEV

Banco local `veridi_dev`. Reconstruído pelo caminho oficial em 2026-09-07 —
`drop/create` + as 56 migrations + seed de infraestrutura — e recarregado com os
dados mestres reais do corpus da Veridi, as referências de preço de mercado e o
pacote sintético de exemplos. Sem massa operacional de rodada anterior.

Caminho canônico, nesta ordem:

1. `pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar`
2. `pnpm veridi:import:validate` → `:plan` → `:apply -- --apply` → `:verify`
3. `pnpm veridi:market-reference -- --apply`
4. `pnpm veridi:examples -- --apply`

Nunca `db push`, nunca edição manual de `_prisma_migrations`. Runbook do
importador em [`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md).

## Produção

Railway, deploy automático da `main`. Carrega **dados mestres reais e
estruturas de referência marcadas como sintéticas** — nenhuma operação
fictícia: zero pedido, OP, recebimento, lote, movimento de estoque ou
faturamento criado por carga. Implantação em [`DEPLOY.md`](DEPLOY.md).

**Regra durável aprendida em 2026-09-07, e que custou uma recarga:**
`Item.code` (`MP-000372`) sai de uma **sequence do Postgres, uma por banco** —
o mesmo código nomeia itens DIFERENTES em DEV e em produção. Qualquer carga que
identifique registro por código interno grava no registro errado. A chave
estável entre ambientes é `externalCode`, o código da planilha original, que o
importador copia e nunca regenera. `scripts/veridi-market-reference/load.ts`
resolve por `externalCode` e recusa a linha que não o tiver.

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, próximo gate | este arquivo |
| Achados da auditoria de produto | [E2E_AUDIT_CURRENT.md](E2E_AUDIT_CURRENT.md) |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Precisão numérica: inventário e plano | [NUMERIC_PRECISION_AUDIT.md](NUMERIC_PRECISION_AUDIT.md) |
| Onde cada regra é protegida | [TEST_COVERAGE_MAP.md](TEST_COVERAGE_MAP.md) |
| Estratégia de E2E | [E2E_STRATEGY.md](E2E_STRATEGY.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo do MVP · valor futuro | [MVP_PLAN.md](MVP_PLAN.md) · [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Stack e ambiente · implantação · migração do legado | [TECH_BASELINE.md](TECH_BASELINE.md) · [DEPLOY.md](DEPLOY.md) · [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Validação com o cliente · perguntas regulatórias | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) · [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| Histórico — validações, deliveries e findings | [archive/E2E_VALIDATION_HISTORY.md](archive/E2E_VALIDATION_HISTORY.md) · [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) · [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

## Manutenção deste arquivo

Alvo de 110 linhas. Reescrever e condensar; nunca acumular diário.
