# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `e7656ab`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9,
#3, #5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria de
precisão numérica PREC-01** (só documentação) e as **Fundações numéricas A**
(#20 + PREC-MIG-A), **B** (PREC-MIG-B) e **C** (PREC-MIG-C), as três com
migration. Todas aprovadas pelo PO.
**Produção:** Railway, deploy automático da `main`; health 200, banco up, smoke
autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas,
produção com rastreabilidade, pedido, expedição, faturamento, custos, cockpit
e relatórios, projetos e orçamentos versionados, precificação e margem. Três
casos profundos do legado rodaram ponta a ponta contra a interface publicada
(VAL-LEG-01 a 03, PASS):
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).

## Última capability

**Fundação numérica C — PREC-MIG-C**, aprovada pelo PO e publicada em
2026-09-06, merge `e7656ab`. Pureza e overage em `DECIMAL(9,6)`.

Sete colunas, a família PERCENTAGE inteira do inventário:
`Item.defaultPurityPercent`, `FormulationComponent.purityPercentApplied` e
`.overagePercent`, os dois mesmos campos congelados em
`ProductionOrderRequirement`, e os dois de `FormulationTemplateComponent`.
Migration `20260925093003_numeric_precision_purity_overage_9_6`, só
`ALTER COLUMN ... SET DATA TYPE`, **sem backfill**: 247 valores existentes
conferidos antes e depois, zero divergência matemática — `98.500` virou
`98.500000` e mais nada.

O achado reproduzido contra o PostgreSQL antes de migrar:
`99.9995::decimal(6,3)` devolvia `100.000`, e `0.000001` devolvia `0.000`.
Um laudo de ensaio dizia 99,9995% e o banco gravava "100% puro" — outra
afirmação, sem ninguém ser avisado. Agora persiste `99.999500`, continua
distinto de `100.000000`, e a entrada **recusa** acima de seis casas em Item,
Formulação e template, em vez de deixar o PostgreSQL arredondar a sétima em
silêncio.

**Precisão e faixa continuam separadas.** O schema suporta 999,999999 e isso
não é autorização de negócio: pureza segue `0 < x <= 100`, overage segue
`>= 0`. A fórmula canônica não mudou — `físico = teórico ÷ (pureza/100) ×
(1 + overage/100)` —, `PHYSICAL_DIRECT` segue sem aplicar ajuste e `PER_DOSE`
sem `dosesPerPackage` segue fail-closed. O que mudou é a precisão dos
operandos.

Na aprovação o PO **registrou a recusa acima de seis casas como regra de
produto** ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58): pureza/overage mais
longos que o scale respondem HTTP 400 em vez de serem arredondados em silêncio
pelo banco — a mudança visível é intencional.

**PREC-MIG-C RESOLVIDO. #19 e PREC-MIG-D seguem ABERTOS / PARCIAIS. PREC-MIG-P
é o próximo, HIGH, com PREC-P-01 já decidido.**

## Antes dela

**Fundação numérica B — PREC-MIG-B** (merge `b5f6089`). Custo unitário em
`DECIMAL(20,8)`: `ReceiptLine.actualUnitCost` — a origem de TODO custo real —,
`ItemCostReference.unitCost` e `SupplierItemOffer.unitPrice`, que o seletor
canônico lê como custo. `PurchaseOrderLine.unitPrice` ficou de fora de
propósito: a **categoria** é UNIT_PRICE, e o PREC-MIG-B do PO é UNIT_COST. O PO
confirmou a exclusão e abriu o **PREC-MIG-P**, com
`PurchaseOrderLine.unitPrice → DECIMAL(20,8)` já aprovado — preço de compra é
grandeza técnica, e o total documental da linha segue regra própria.

**Fundação numérica A — #20 + PREC-MIG-A** (merge `5f855cd`). Motor decimal em
40 dígitos, numa configuração única (`packages/shared/src/decimal-config.ts`):
existem DOIS construtores nesta base, e o Prisma roda no dele. 43 colunas para
`DECIMAL(24,12)` sem backfill; `0,000000048` persiste em vez de virar
`0,000000`. `scripts/numeric-precision-matrix.test.ts` guarda a matriz de §58.

**Auditoria PREC-01** (merge `0305704`, só documentação) e **Rodadas 1 a 4** —
#15 e #16 (merge `33ee1cd`), #8D e #8H (merge `b89f9a4`), #8A–#8C (merge
`dfb2673`), referência manual de custo e revisão do "Como funciona" em 62 telas.
Regras em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §53 a §59; evidência de precisão
em [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md); detalhe em
[`BACKLOG.md`](BACKLOG.md), seção G. **#18 desbloqueado.**

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística. Infraestrutura genérica preservada em `scripts/e2e/lib/`,
plano em [`E2E_STRATEGY.md`](E2E_STRATEGY.md); ferramental de segurança e
importadores oficiais permanecem.

**Reconstrução do banco do zero** (2026-09-04): as 52 migrations aplicam num
banco vazio só com o repositório — `scripts/migration-order.test.ts` em
`pnpm test` e `pnpm validate:migrations:fresh`; regra em
[`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**PREC-MIG-P** — UNIT_PRICE de alta precisão (HIGH, junto de PREC-SER-02),
contendo **PREC-P-01** (`PurchaseOrderLine.unitPrice → DECIMAL(20,8)`, decidido
e pendente). Depois: o PREC-MIG-D residual, PREC-SER-01, PREC-FMT-01, #18 e
PREC-MIG-E.

**Gate paralelo:** validação com a Veridi para as regras que dependem do
processo real do cliente (#7, #11) — não bloqueia os itens internos já decididos
pelo PO. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL. **#20 resolvido; #19 aberto** com
PREC-MIG-A, B e C entregues — microdosagem, custo unitário e pureza/overage
fechados. **Seguinte:** **PREC-MIG-P** (HIGH), D residual, PREC-SER-01,
PREC-FMT-01, **#18** (desbloqueado) e PREC-MIG-E. **Roadmap:** PREC-UI-01 a 08.
**Quando autorizada:** #8E, #8F, #8G. **Aguardando a Veridi:** #7 e #11.
**Manutenção:** #10 e #14. **Abertos:** #17 (suíte da API não determinística sob
paralelismo, não observado nesta rodada) e #21. **Observação:** #1, #2.

## Blockers

Nenhum.

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
| Escopo e plano do MVP | [MVP_PLAN.md](MVP_PLAN.md) |
| Valor futuro mapeado | [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Política de migração do legado | [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Stack e ambiente | [TECH_BASELINE.md](TECH_BASELINE.md) |
| Implantação | [DEPLOY.md](DEPLOY.md) |
| Roteiro da validação com o cliente | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) |
| Perguntas regulatórias abertas | [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| O que cada rodada de validação descobriu | [archive/E2E_VALIDATION_HISTORY.md](archive/E2E_VALIDATION_HISTORY.md) |
| Histórico de deliveries | [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) |
| Histórico de findings | [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

## Manutenção deste arquivo

Manter curto — alvo de 120 linhas. Reescrever e condensar após mudanças
relevantes. Não transformar em log cronológico: o log vive nos arquivos de
histórico.
