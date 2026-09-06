# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `8a40b52`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9, #3,
#5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria PREC-01**,
as **Fundações numéricas A, B, C, P e D** e o **#18**, todos aprovados pelo PO.
**Produção:** Railway, deploy automático da `main`; health 200, banco up, 55
migrations sem pendência, smoke autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — de cadastros e
compras a produção rastreada, expedição, faturamento, custos, cockpit,
relatórios, projetos, orçamentos e precificação. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability

**PREC-MIG-D — resultado técnico da precificação em `DECIMAL(24,12)`**, aprovado
pelo PO e publicado em 2026-09-06, merge `8a40b52`, deploy Railway verde — o
`preDeploy` aplicou
`20260925093006_numeric_precision_technical_results_24_12` em produção. Três
colunas de `Decimal(14,6)`, sem backfill:
`PricingTier.commissionPerUnitSnapshot`, `.contributionPerUnitSnapshot` e
`QuoteLine.contributionPerUnitSnapshot`. Medido contra o PostgreSQL antes de
migrar: `'0.2026593333333333'::decimal(14,6)` devolvia `0.202659` — **seis casas
perdidas**, cortadas pelo banco no `UPDATE` da ativação, sem `.toFixed()` no
código.

**A decisão durável é a TERCEIRA fronteira** ([`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§62): resultado técnico persistido fecha em **doze casas** com `ROUND_HALF_UP`
declarado na chamada, em `fecharResultadoTecnicoPersistido`. Resultado técnico
não é preço, mesmo sendo dinheiro por unidade — a categoria é o PAPEL do valor,
não a unidade; por isso `24,12` e não os `20,8` do preço técnico. Entrada de
usuário acima do scale continua sendo HTTP 400 (§58); resultado CALCULADO com
mais de doze casas é normal e é fechado, nunca recusado.

**A cadeia moveu-se inteira** — a contribuição da faixa é copiada para a linha do
Orçamento no ENVIO da proposta, e alargar só a faixa trocaria um corte silencioso
por outro. Serialização em 12 casas na faixa, prévia, proveniência, relatório de
precificação, política de preço e prévia de rebase; a prévia fecha pela MESMA
fronteira da ativação, com teste exigindo números iguais. **Nada comercial se
moveu:** `QuoteLine.unitPrice` em `14,4`, total e subtotal por §55, #15 e #18
intocados, e a tela continua mostrando `R$ 0,65` — apresentação não é
armazenamento (§57), e nenhum caminho da tela devolve resultado derivado.

## Antes dela

**#18** (`34a5424`). O rodapé da Ordem de Compra virou a soma das linhas
impressas — `40,53 + 0,13 + 0,13` fecha `40,79`, não `40,78` (§61) —, com
`ROUND_HALF_UP` declarado, operando intocado e uma conta só para todas as
superfícies. Zero migration; a OC não persiste dinheiro, então mudou a conta que
deriva, não o dado.

**PREC-P-TECH** (`b358fd8`). Os quatro preços técnicos da precificação em
`DECIMAL(20,8)`, sem backfill. A regra durável é a **fronteira** (§60): preço
técnico (8 casas) e preço comercial (4) são dois números, e a passagem é
fechamento explícito — `fecharPrecoUnitarioComercial` e
`fecharPrecoTecnicoPersistido`, com `ROUND_HALF_UP` declarado.
`QuoteLine.unitPrice` fica em `14,4` por decisão do PO, e preço acima do scale é
recusado dos dois lados.

**P, C, B e A** (`e94971f`, `e7656ab`, `b5f6089`, `5f855cd`). O preço da OC em
`DECIMAL(20,8)` (`4.05318764::decimal(14,4)` devolvia `4.0532`), servido também
no Recebimento, onde "Usar preço da OC" vira custo. Pureza e overage em
`DECIMAL(9,6)` — `99.9995` deixou de virar `100.000`, e daí saiu a **recusa acima
do scale como regra de produto** (§58). Custo unitário em `DECIMAL(20,8)`, com
`ReceiptLine.actualUnitCost` como origem de TODO custo real. E a base: motor
decimal em 40 dígitos numa configuração única — existem DOIS construtores nesta
base e o Prisma roda no dele — com 43 colunas em `DECIMAL(24,12)`. Antes disso,
**auditoria PREC-01** (`0305704`) e **Rodadas 1 a 4** — #15 e #16 (`33ee1cd`),
#8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`). Regras §53 a §62; detalhe em
[`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística; infraestrutura em `scripts/e2e/lib/`, plano em
[`E2E_STRATEGY.md`](E2E_STRATEGY.md). **Reconstrução do banco do zero:** as 55
migrations aplicam num banco vazio só com o repositório —
`scripts/migration-order.test.ts` em `pnpm test` e
`pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**PREC-MIG-E — classificação concluída, migration NÃO criada, aguardando o PO.**
As 16 colunas de alvo órfão foram classificadas pelo PAPEL do valor em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §12.3, na branch
`feat/numeric-precision-technical-results-e`. Os três grupos que pareciam iguais
se separaram: **1 coluna pede migration** —
`QuoteLine.industrialCostPerUnitSnapshot`, `18,6`, que copia doze casas de
`PricingTier.costPerUnitSnapshot` e deixa o banco cortar a sétima (PREC-E-01);
**9 são MANTER sem discussão** — `IndustrialCostCalculation` e
`ProductionOrderCostSnapshot` já recebem o valor fechado em duas casas pelo
motor, e quatro delas nem são lidas de volta; **6 mantêm a escala e precisam de
fronteira** — nos totais de `PricingTier` o banco ainda é a primeira camada de
arredondamento, mas nenhum consumidor recebe mais de duas casas (PREC-E-02).
Depois: PREC-SER-01 (PARCIAL) e PREC-FMT-01.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#20 e #18
resolvidos; #19 ABERTO / PARCIAL** com PREC-MIG-A, B, C, P e D entregues e
publicados. **Seguinte:** PREC-MIG-E (proposta pronta, aguarda o PO),
PREC-SER-01 e PREC-FMT-01. **Roadmap:** PREC-UI-01 a
08. **Quando autorizada:** #8E, #8F, #8G. **Aguardando a Veridi:** #7 e #11.
**Manutenção:** #10 e #14. **Abertos:** #17 (suíte da API não determinística sob
paralelismo — uma falha isolada em `finished-goods.test.ts` nesta rodada, não
reproduzida na re-execução nem no arquivo isolado) e #21.
**Observação:** #1, #2.

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, release, próximo gate | este arquivo |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Precisão numérica: inventário, riscos e plano | [NUMERIC_PRECISION_AUDIT.md](NUMERIC_PRECISION_AUDIT.md) |
| Onde cada regra é protegida | [TEST_COVERAGE_MAP.md](TEST_COVERAGE_MAP.md) |
| Estratégia de E2E | [E2E_STRATEGY.md](E2E_STRATEGY.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo do MVP · valor futuro | [MVP_PLAN.md](MVP_PLAN.md) · [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Stack e ambiente · implantação · migração do legado | [TECH_BASELINE.md](TECH_BASELINE.md) · [DEPLOY.md](DEPLOY.md) · [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Validação com o cliente · perguntas regulatórias | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) · [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| Histórico — validações, deliveries e findings | [archive/E2E_VALIDATION_HISTORY.md](archive/E2E_VALIDATION_HISTORY.md) · [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) · [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

## Manutenção deste arquivo

Alvo de 120 linhas. Reescrever e condensar após mudanças relevantes; o log
cronológico vive nos arquivos de histórico.
