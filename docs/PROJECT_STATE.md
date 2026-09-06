# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `34a5424`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9, #3,
#5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria PREC-01**
(só documentação), as **Fundações numéricas A, B, C e P**, o **PREC-P-TECH** e
o **#18**, todos aprovados pelo PO. **Produção:** Railway, deploy automático
da `main`; health 200, banco up, 55 migrations sem pendência, smoke autenticado
passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — de cadastros
e compras a produção rastreada, expedição, faturamento, custos, cockpit,
relatórios, projetos, orçamentos e precificação. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability

**Reconciliação monetária da Ordem de Compra — #18**, aprovada pelo PO e
publicada em 2026-09-06, merge `34a5424`. **Zero migration, zero mudança de
schema.** O rodapé da OC somava as linhas em
precisão cheia e arredondava no fim, enquanto a página imprimia cada linha já
fechada em dois centavos: `10 × 4,05318764`, `1 × 0,125` e `5 × 0,025` imprimem
`40,53 + 0,13 + 0,13`, a coluna soma `40,79` e o rodapé dizia **`40,78`**. Quem
confere o papel estava certo.

**A regra agora é a da página** — [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §61:
`lineTotal = round(quantidade × preço, 2)` e `orderTotal = Σ lineTotal`, com
`ROUND_HALF_UP` declarado na chamada, como §60 exige. **O operando não é
tocado:** o preço de `DECIMAL(20,8)` e a quantidade de `DECIMAL(24,12)` entram
inteiros na multiplicação, e o único fechamento é o da linha.

**Uma conta só, e duas duplicatas eliminadas.** `calcularTotaisOrdemCompra`
passou a servir também o relatório de Compras e a OC vinculada dentro do Pedido,
que somavam por conta própria — o mesmo documento valia dois números conforme a
tela. A prévia já delegava.

**Nada de custo mudou.** O total documental existe para ser lido e conferido:
`ReceiptLine.actualUnitCost`, o seletor canônico, média ponderada, CMV e
precificação seguem intocados, e o teste prova que uma OC precificada sem
recebimento deixa o item em `NO_COST`. **#15 intocado** — a OC tem função
própria; o que ela alcançou foi a mesma FORMA de fechamento, não a função dos
documentos comerciais. **Sem histórico para reconciliar:** a OC não persiste
dinheiro nenhum, o valor é derivado na leitura, e a regra nova vale para toda OC
sem backfill possível nem necessário. O PO ratificou a consequência: uma OC
antiga pode passar a exibir `R$ 40,79` onde exibia `R$ 40,78` — a conta que
deriva mudou, o dado histórico não (§61).

## Antes dela

**PREC-P-TECH** (`b358fd8`, publicado em 2026-09-06). Os quatro preços técnicos
da precificação de `Decimal(14,6)` para `DECIMAL(20,8)` — `manualUnitPrice`,
`suggestedPriceSnapshot`, `selectedPriceSnapshot` e
`QuoteLine.pricingSelectedUnitPriceSnapshot` —, migration
`20260925093005_numeric_precision_pricing_technical_20_8`, sem backfill. A
decisão durável é a **fronteira** ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §60):
preço técnico (8 casas) e preço comercial (4 casas) são dois números, e a
passagem entre eles é fechamento explícito — `fecharPrecoUnitarioComercial` e
`fecharPrecoTecnicoPersistido`, com `ROUND_HALF_UP` declarado na chamada.
`QuoteLine.unitPrice` fica em `14,4` por decisão do PO, e preço acima do scale
passou a ser recusado dos dois lados. Comissão e contribuição por unidade seguem
em `14,6` — PREC-MIG-D.

**P — PREC-MIG-P / PREC-P-01** (`e94971f`). `PurchaseOrderLine.unitPrice` em
`DECIMAL(20,8)`, sem backfill: `4.05318764::decimal(14,4)` devolvia `4.0532`, e
um insumo cotado por grama tinha o preço trocado por outro em silêncio. Junto, o
preço servido no Recebimento, onde "Usar preço da OC" copia o valor para
`ReceiptLine.actualUnitCost`.

**C — PREC-MIG-C** (`e7656ab`). Pureza e overage em `DECIMAL(9,6)`, sete colunas:
`99.9995` deixou de virar `100.000`. Na aprovação o PO **registrou a recusa acima
do scale como regra de produto** (§58); precisão e faixa de negócio são
independentes. **B — PREC-MIG-B** (`b5f6089`). Custo unitário em `DECIMAL(20,8)`:
`ReceiptLine.actualUnitCost` — origem de TODO custo real —,
`ItemCostReference.unitCost` e `SupplierItemOffer.unitPrice`, lido como custo.

**A — #20 + PREC-MIG-A** (`5f855cd`). Motor decimal em 40 dígitos, numa
configuração única (`packages/shared/src/decimal-config.ts`): existem DOIS
construtores nesta base, e o Prisma roda no dele. 43 colunas para
`DECIMAL(24,12)` sem backfill; `0,000000048` persiste em vez de virar `0,000000`.
`scripts/numeric-precision-matrix.test.ts` guarda a matriz de §58.

**Auditoria PREC-01** (`0305704`, só documentação) e **Rodadas 1 a 4** — #15 e #16
(`33ee1cd`), #8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`), referência manual de custo
e revisão do "Como funciona" em 62 telas. Regras §53 a §60; detalhe em
[`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística; infraestrutura em `scripts/e2e/lib/`, plano em
[`E2E_STRATEGY.md`](E2E_STRATEGY.md). **Reconstrução do banco do zero:** as 54
migrations aplicam num banco vazio só com o repositório —
`scripts/migration-order.test.ts` em `pnpm test` e
`pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**PREC-MIG-D residual** — os resultados técnicos ainda em `Decimal(14,4)` e
`(14,6)`, incluindo a comissão e a contribuição por unidade que o PREC-P-TECH
deixou para trás de propósito. Depois: PREC-SER-01, PREC-FMT-01 e PREC-MIG-E.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#20 e #18
resolvidos; #19 aberto** com PREC-MIG-A, B, C e P entregues. **Seguinte:**
PREC-MIG-D residual, PREC-SER-01, PREC-FMT-01 e PREC-MIG-E. **Roadmap:**
PREC-UI-01 a 08. **Quando autorizada:** #8E, #8F, #8G. **Aguardando a Veridi:**
#7 e #11. **Manutenção:** #10 e #14. **Abertos:** #17 (suíte da API não
determinística sob paralelismo, não observado nesta rodada) e #21.
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
