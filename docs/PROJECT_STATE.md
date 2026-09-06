# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `e94971f`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9,
#3, #5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria de
precisão numérica PREC-01** (só documentação) e as **Fundações numéricas A, B, C
e P**, as quatro com migration e aprovadas pelo PO.
**Produção:** Railway, deploy automático da `main`; health 200, banco up, smoke
autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas, produção
rastreada, pedido, expedição, faturamento, custos, cockpit e relatórios,
projetos, orçamentos, precificação e margem. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability

**Fundação numérica P — PREC-MIG-P / PREC-P-01**, aprovada pelo PO e publicada
em 2026-09-06, merge `e94971f`. **UMA coluna:**
`PurchaseOrderLine.unitPrice`, de `Decimal(14,4)` para `DECIMAL(20,8)`.
Migration `20260925093004_numeric_precision_unit_price_20_8`, só `ALTER COLUMN
... SET DATA TYPE`, **sem backfill**. Medido contra o PostgreSQL antes de
migrar: `4.05318764::decimal(14,4)` devolvia `4.0532` — um insumo cotado por
grama tinha o preço trocado por outro, em silêncio. Agora persiste inteiro;
acima de oito casas a API **recusa**, na criação e na edição da OC.

**A serialização foi junto, na fatia que a família exigia — PREC-SER-02
PARCIAL.** O DTO da OC servia `toFixed(4)`, e a tela devolve ao servidor o que
recebe: abrir e salvar sem editar bastava para gravar o valor cortado. O mesmo
preço servido como referência no Recebimento também subiu para oito casas, e ali
**não era só apresentação** — o atalho "Usar preço da OC" copia esse valor para
`ReceiptLine.actualUnitCost`, que é `DECIMAL(20,8)`.

**Precisão do operando não é precisão do total.** `10 × 4,05318764 =
40,53187640` continua fechando o documento em `R$ 40,53`, pela regra ATUAL da OC
(soma cheia, arredonda no fim). A regra comercial **#15** não foi tocada e **#18
permanece desbloqueado e não iniciado** — o cenário de três linhas em que os dois
fechamentos divergem em um centavo está congelado em teste exigindo o
comportamento de hoje.

**PREC-MIG-P fica PARCIAL, de propósito.** O inventário classificou as dez
colunas de preço do schema por uso real
([`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §10.1) e só uma
tinha decisão segura. Contratual fica por §58. Os quatro preços técnicos da
precificação viraram **PREC-P-02 a PREC-P-05**: a cadeia
`PricingTier.selectedPriceSnapshot → QuoteLine.pricingSelectedUnitPriceSnapshot
→ QuoteLine.unitPrice` congela dentro de documento comercial e move-se inteira
ou não se move — ampliar só a ponta trocaria um silêncio por outro.

## Antes dela

**C — PREC-MIG-C** (`e7656ab`). Pureza e overage em `DECIMAL(9,6)`, sete colunas,
a família PERCENTAGE inteira: `99.9995` deixou de virar `100.000`. Na aprovação
o PO **registrou a recusa acima do scale como regra de produto**
([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58) — valor mais longo que a coluna
responde HTTP 400 em vez de ser arredondado pelo banco. Faixa de negócio
inalterada: precisão e faixa são regras independentes.

**B — PREC-MIG-B** (`b5f6089`). Custo unitário em `DECIMAL(20,8)`:
`ReceiptLine.actualUnitCost` — a origem de TODO custo real —,
`ItemCostReference.unitCost` e `SupplierItemOffer.unitPrice`, que o seletor
canônico lê como custo. `PurchaseOrderLine.unitPrice` ficou fora de propósito: a
**categoria** é UNIT_PRICE, e o PREC-MIG-B do PO é UNIT_COST.

**A — #20 + PREC-MIG-A** (`5f855cd`). Motor decimal em 40 dígitos, numa
configuração única (`packages/shared/src/decimal-config.ts`): existem DOIS
construtores nesta base, e o Prisma roda no dele. 43 colunas para
`DECIMAL(24,12)` sem backfill; `0,000000048` persiste em vez de virar
`0,000000`. `scripts/numeric-precision-matrix.test.ts` guarda a matriz de §58.

**Auditoria PREC-01** (`0305704`, só documentação) e **Rodadas 1 a 4** — #15 e
#16 (`33ee1cd`), #8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`), referência manual de
custo e revisão do "Como funciona" em 62 telas. Regras em §53 a §59; detalhe em
[`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística. Infraestrutura genérica em `scripts/e2e/lib/`, plano em
[`E2E_STRATEGY.md`](E2E_STRATEGY.md). **Reconstrução do banco do zero:** as 53
migrations aplicam num banco vazio só com o repositório —
`scripts/migration-order.test.ts` em `pnpm test` e
`pnpm validate:migrations:fresh`; regra em
[`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**Decisão do PO sobre PREC-P-02 a PREC-P-05** — o UNIT_PRICE técnico da
precificação. Depois: o PREC-MIG-D residual, PREC-SER-01, PREC-FMT-01, #18 e
PREC-MIG-E.

**Gate paralelo:** validação com a Veridi para as regras que dependem do
processo real do cliente (#7, #11) — não bloqueia os itens internos já decididos
pelo PO. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#20 resolvido; #19
aberto** com PREC-MIG-A, B e C entregues e P parcial. **Seguinte:** PREC-P-02 a
05 (decisão), D residual, PREC-SER-01, PREC-FMT-01, **#18** (desbloqueado) e
PREC-MIG-E. **Roadmap:** PREC-UI-01 a 08. **Quando autorizada:** #8E, #8F, #8G.
**Aguardando a Veridi:** #7 e #11. **Manutenção:** #10 e #14. **Abertos:** #17
(suíte da API não determinística sob paralelismo, não observado nesta rodada) e
#21. **Observação:** #1, #2.

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

Manter curto — alvo de 120 linhas. Reescrever e condensar após mudanças
relevantes; o log cronológico vive nos arquivos de histórico.
