# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `29f1df8`:** baseline v2 + referência manual de custo, revisão do
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

**PREC-CMP-01 — igualdade de quantidade é decimal, nunca de `Number`.** Branch
`fix/decimal-quantity-comparison`. Aplicar uma política de precificação decide
"esta faixa já existe?" antes de criar cada faixa, e a comparação era
`Number(a) === Number(b)`. Quantidade de faixa é `DECIMAL(24,12)` — vinte e
quatro dígitos significativos; um `double` guarda quinze.

**O dano não era visual, era de decisão.** Reproduzido no serviço real antes de
corrigir: com uma faixa de `999999999999,000000000001` já no rascunho, uma
política trazendo `...000000000002` tinha a faixa **pulada em silêncio** pelo
`continue`, e a versão ficava com uma faixa onde a política declarava duas.

A correção é `Decimal.equals` — o mesmo critério que `createPricingTier` já
usava para recusar duplicata; o repositório tem 82 comparações canônicas e esta
era a exceção. Zero migration, zero mudança de API, zero formatação tocada.
Regra durável: [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §66.

**Varredura da mesma classe no backend:** nenhum outro
`UNSAFE_DECIMAL_COMPARISON`. Os `Number` restantes são sobre `Int` (contadores,
número de parte, contagem de lotes), validação de limite contra constante e
ordenação de booleano. Nenhuma ordenação de `Decimal` via `Number`.

**Achado registrado, não corrigido:** a mesma comparação ignora `uomCode` —
`1 kg` e `1000 g` são a mesma faixa física e seriam tratadas como duas.
Converter antes de comparar é decisão de domínio, e virou **PREC-CMP-02**.

## Antes dela

**PREC-FMT-01** (`29f1df8`). A formatação deixou de passar por `Number`:
`9007199254740993,12` aparecia como `...994,00` porque o `double` já tinha
perdido o dígito antes de formatar. `lib/decimal-format.ts` formata sobre os
dígitos, com o contrato visual inalterado (§65). **Com ele o #19 fechou.**

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

**#21** — `print/documents.tsx:353` divide em float para exibir a parte da
receita. É o último ponto do impresso fora da regra de §65.

**PREC-CMP-02** — a comparação de faixa ignora a unidade de medida. Aberto
nesta rodada, aguarda decisão do PO.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#18, #19 e #20
RESOLVIDOS — a fundação numérica está completa**, de PREC-MIG-A a PREC-FMT-01,
com PREC-CMP-01 fechando a comparação. **Seguinte:** #21 e PREC-CMP-02. **Roadmap:** PREC-UI-01 a
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
