# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `140769c`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9, #3,
#5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria PREC-01**,
as **Fundações numéricas A, B, C, P, D e E** e o **#18**, todos aprovados pelo
PO. **Produção:** Railway, deploy automático da `main`; health 200, banco up, 56
migrations sem pendência, smoke autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — de cadastros e
compras a produção rastreada, expedição, faturamento, custos, cockpit,
relatórios, projetos, orçamentos e precificação. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability — aguardando PO review

**PREC-FMT-01 — a formatação decide as casas, e o float não decide nada.**
Branch `fix/numeric-precision-formatting-final`. Era o último trecho da cadeia:
o dado chegava à tela com toda a precisão e passava por `Number` antes de virar
texto. Um `double` tem 53 bits de mantissa, e `9007199254740993,12` não existe
lá dentro — a tela mostrava `9.007.199.254.740.994,00`. **O erro era na parte
inteira**, não nas casas decimais.

`lib/decimal-format.ts` formata sobre os dígitos: lê o decimal em string
(inclusive em notação científica), arredonda com `ROUND_HALF_UP`, agrupa o
milhar e monta o texto. `formatBRL`, `formatUnitCost`, `formatUnitPriceBRL`,
`formatPercent` e `formatQuantity` passaram a usá-lo, e o impacto de override
deixou de fazer `String(Math.abs(Number(x)))`.

**O contrato visual não mudou** — cada caso foi medido contra o
`Intl.NumberFormat` que estava no lugar, e os **826 testes de tela continuam
passando sem alteração nenhuma**. `R$ 4,0531`, `R$ 4,05`, `5%`, `0,006122`,
`≈ 0` e `—` seguem iguais. O que mudou é que a redução de casas passou a ser
decisão do formatter.

A regra durável é [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §65, com a **matriz
final** das nove categorias — storage, API, display e arredondamento. Varredura
do web: zero `Intl.NumberFormat`, zero `parseFloat`, e todo `toLocaleString`
restante é sobre data. Impressos usam os mesmos formatters, então tela e PDF não
divergem; o CSV é gerado no backend sobre `Prisma.Decimal`.

**`Number` que fica, classificado:** `CalcHint` refaz a conta escrita na tela
para conferir contra o valor que o servidor mandou — alarme, não motor,
`SAFE_PRESENTATION_CHECK`. Nenhum caminho formatado alimenta cálculo, payload ou
persistência.

**Com isso o #19 fecha.** A fundação numérica está completa: schema,
persistência, serialização e apresentação. Quatro fronteiras de fechamento
nomeadas (§60, §62, §63), a assimetria entre elas declarada (§64) e a
apresentação sem float (§65).

## Antes dela

**PREC-SER-01** (`140769c`). O último `.toFixed(6)` técnico da API era o custo
unitário de MATERIAL, servido em seis casas de colunas `DECIMAL(20,8)` — e o DTO
é o `result` gravado no snapshot do CALC, então o corte ficava congelado no
documento histórico. Quatro pontos passaram a `custoUnitario`. Zero migration.

**PREC-MIG-E** (`56b563c`). A matriz de §58 aplicada ao schema inteiro. As 16
colunas de alvo órfão classificadas pelo PAPEL do valor: **PREC-E-01** migrou
uma — `QuoteLine.industrialCostPerUnitSnapshot` para `DECIMAL(24,12)`, porque
`(1000,00 ÷ 300)` vale `3,333333333333` e a coluna guardava `3,333333`;
**PREC-E-02** manteve os seis totais de `PricingTier` em `14,4` e deu a eles a
**fronteira** que faltava (§63, TECHNICAL_TOTAL). F-2 e F-3 viraram §64. Nove
colunas ficaram intocadas porque o motor já as fecha em duas casas antes de
gravar. Junto, higiene DEV autorizada: banco local reconstruído pelo caminho
oficial, com backup antes do drop, e o `_prisma_migrations` voltou a bater com o
repositório sem edição manual.

**PREC-MIG-D** (`8a40b52`). As três colunas `14,6` de resultado técnico da
precificação em `DECIMAL(24,12)`, sem backfill — a **terceira fronteira** (§62),
doze casas com `ROUND_HALF_UP` declarado. Resultado técnico não é preço, mesmo
sendo dinheiro por unidade.

**#18** (`34a5424`). O rodapé da Ordem de Compra virou a soma das linhas
impressas — `40,79`, não `40,78` (§61) —, com o operando intocado e uma conta só
para todas as superfícies. Zero migration.

**PREC-P-TECH e as fundações P, C, B e A** (`b358fd8`, `e94971f`, `e7656ab`,
`b5f6089`, `5f855cd`). Os quatro preços técnicos em `DECIMAL(20,8)`, com a
**fronteira** de §60: preço técnico (8 casas) e preço comercial (4) são dois
números, e a passagem é fechamento explícito. Antes: o preço da OC em `20,8`;
pureza e overage em `DECIMAL(9,6)`, de onde saiu a **recusa acima do scale como
regra de produto** (§58); custo unitário em `DECIMAL(20,8)`, com
`ReceiptLine.actualUnitCost` como origem de TODO custo real; e a base — motor
decimal em 40 dígitos numa configuração única, com 43 colunas em
`DECIMAL(24,12)`. Antes disso, **auditoria PREC-01** (`0305704`) e **Rodadas 1 a
4** — #15 e #16 (`33ee1cd`), #8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`). Regras
§53 a §65; detalhe em [`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística; infraestrutura em `scripts/e2e/lib/`, plano em
[`E2E_STRATEGY.md`](E2E_STRATEGY.md). **Reconstrução do banco do zero:** as 56
migrations aplicam num banco vazio só com o repositório —
`scripts/migration-order.test.ts` em `pnpm test` e
`pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**PREC-CMP-01** — `pricing-policies.service.ts` compara quantidade de faixa por
`Number(a) === Number(b)`. Igualdade e idempotência sobre `DECIMAL(24,12)`, não
formatação: os valores reais de faixa são exatos em `double`, mas uma faixa com
casas decimais poderia colidir. Item novo, aberto nesta rodada.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#18, #19 e #20
RESOLVIDOS — a fundação numérica está completa**, de PREC-MIG-A a
PREC-FMT-01. **Seguinte:** PREC-CMP-01. **Roadmap:** PREC-UI-01 a
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
