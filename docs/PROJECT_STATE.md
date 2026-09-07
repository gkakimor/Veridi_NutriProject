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

## Última capability

**PREC-SER-01 — a serialização técnica fechada**, aprovado pelo PO e publicado
em 2026-09-06, merge `140769c`, deploy Railway verde — o `preDeploy` respondeu
"No pending migrations to apply" e o smoke autenticado passou. O último `.toFixed(6)` técnico da
API era `unitMoney`, em quatro pontos de custo unitário de MATERIAL: o custo
resolvido pelo seletor canônico, a fonte automática de um override, a
referência manual e o custo do lote consumido no CMV. As três fontes são
`DECIMAL(20,8)` desde o PREC-MIG-B, e o valor ainda passa por média ponderada
ou conversão de unidade. **Não era só apresentação:** esse DTO é o `result`
gravado no snapshot do CALC, então o corte ficava congelado no documento
histórico. A função saiu e os quatro pontos passaram a `custoUnitario` — oito
casas, o helper que já servia todo o resto da família. Zero mudança de fórmula,
schema ou persistência; zero migration. A varredura global fechou a matriz por
categoria e não encontrou mais nenhum caminho reduzindo precisão de forma
incompatível.

## Antes dela

**PREC-MIG-E** (`56b563c`, publicado em 2026-09-06). A matriz de §58 aplicada ao
schema inteiro. As 16 colunas de alvo órfão foram classificadas pelo PAPEL do
valor, e a decisão do PO separou o que parecia igual:

- **PREC-E-01, uma migration, uma coluna.**
  `QuoteLine.industrialCostPerUnitSnapshot` de `Decimal(18,6)` para
  `DECIMAL(24,12)`, sem backfill. É TECHNICAL_RESULT derivado — `total ÷
  quantidade da faixa` —, cópia de `PricingTier.costPerUnitSnapshot`, que já era
  `24,12`. Medido antes de migrar: `(1000,00 ÷ 300)` vale `3,333333333333` e a
  coluna guardava `3,333333`;
- **PREC-E-02, zero migration.** Os seis totais de `PricingTier` **mantêm**
  `DECIMAL(14,4)` — nenhum consumidor recebe mais de duas casas, e ampliar
  guardaria precisão que a própria saída corta. Faltava **fronteira**:
  `fecharTotalTecnicoPersistido`, quatro casas, `ROUND_HALF_UP` declarado. A
  categoria **TECHNICAL_TOTAL** virou regra durável (§63), com o princípio que a
  sustenta — a escala acompanha o papel do valor e o alcance real do dado, não a
  escala da coluna vizinha. São **quatro fronteiras nomeadas**: 12 casas para
  resultado técnico (§62), 8 para preço técnico (§60 A), 4 para total técnico
  (§63) e 4 para o fechamento comercial (§60 B);
- **F-2 e F-3 viraram §64** — fronteiras diferentes não se reproduzem entre si, e
  isso é regra, não defeito. Com o limite: a assimetria vive DENTRO da fronteira,
  e divergência **visível** entre duas telas para a mesma grandeza comercial
  continua proibida;
- **nove colunas intocadas, e não por dúvida** — `IndustrialCostCalculation` e
  `ProductionOrderCostSnapshot` já recebem o valor fechado em duas casas pelo
  motor. Quatro delas não são lidas de volta: `CURRENTLY_REDUNDANT`, **não**
  candidatas a remoção.

Junto, **higiene DEV autorizada pelo PO**: banco local reconstruído pelo caminho
oficial (`local-db-reset.mjs`), backup verificado antes do drop, e o
`_prisma_migrations` voltou a bater com o repositório — a linha órfã
`20260926090000_...` desapareceu **sem edição manual do ledger**.

**PREC-MIG-D** (`8a40b52`). As três colunas `14,6` de resultado técnico da
precificação em `DECIMAL(24,12)` — comissão e contribuição por unidade na faixa,
e a contribuição congelada na linha do Orçamento —, sem backfill. Regra durável:
a **terceira fronteira** (§62), doze casas com `ROUND_HALF_UP` declarado.
Resultado técnico não é preço, mesmo sendo dinheiro por unidade.

**#18** (`34a5424`). O rodapé da Ordem de Compra virou a soma das linhas
impressas — `40,53 + 0,13 + 0,13` fecha `40,79`, não `40,78` (§61) —, com
`ROUND_HALF_UP` declarado, operando intocado e uma conta só para todas as
superfícies. Zero migration; a OC não persiste dinheiro, então mudou a conta que
deriva, não o dado.

**PREC-P-TECH e as fundações P, C, B e A** (`b358fd8`, `e94971f`, `e7656ab`,
`b5f6089`, `5f855cd`). Os quatro preços técnicos da precificação em
`DECIMAL(20,8)`, com a **fronteira** de §60 como regra durável: preço técnico
(8 casas) e preço comercial (4) são dois números, e a passagem é fechamento
explícito — `QuoteLine.unitPrice` fica em `14,4` por decisão do PO, e preço
acima do scale é recusado dos dois lados. Antes: o preço da OC em `20,8`
(`4.05318764::decimal(14,4)` devolvia `4.0532`), servido também no Recebimento;
pureza e overage em `DECIMAL(9,6)`, de onde saiu a **recusa acima do scale como
regra de produto** (§58); custo unitário em `DECIMAL(20,8)`, com
`ReceiptLine.actualUnitCost` como origem de TODO custo real; e a base — motor
decimal em 40 dígitos numa configuração única, com 43 colunas em
`DECIMAL(24,12)`. Antes disso, **auditoria PREC-01** (`0305704`) e **Rodadas 1 a
4** — #15 e #16 (`33ee1cd`), #8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`). Regras
§53 a §64; detalhe em [`BACKLOG.md`](BACKLOG.md), seção G.

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

**PREC-FMT-01** — `formatUnitCost` e `formatBRL` usam `Number` para apresentação.
A auditoria do PREC-SER-01 confirmou que **nenhum** caminho da tela recalcula
negócio a partir disso: `CalcHint` refaz a conta só para conferir a explicação
contra o valor que o servidor mandou. É o último item aberto de #19.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#20 e #18
resolvidos; #19 ABERTO / PARCIAL** — migrations (A, B, C, P, D, E) e
serialização (PREC-SER-01) completas. Fechar o item depende só do PREC-FMT-01,
e é decisão do PO. **Seguinte:** PREC-FMT-01. **Roadmap:** PREC-UI-01 a
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
