# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `b358fd8`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9, #3,
#5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria PREC-01**
(só documentação), as **Fundações numéricas A, B, C e P** e o **PREC-P-TECH**,
todas com migration e aprovadas pelo PO. **Produção:** Railway, deploy automático
da `main`; health 200, banco up, 55 migrations sem pendência, smoke autenticado
passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — de cadastros
e compras a produção rastreada, expedição, faturamento, custos, cockpit,
relatórios, projetos, orçamentos e precificação. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability

**Precificação técnica em alta precisão — PREC-P-TECH**, aprovada pelo PO e
publicada em 2026-09-06, merge `b358fd8`, deploy Railway verde e conferido em
leitura pura. **QUATRO
colunas** de `Decimal(14,6)` para `DECIMAL(20,8)`: `PricingTier.manualUnitPrice`,
`.suggestedPriceSnapshot`, `.selectedPriceSnapshot` e
`QuoteLine.pricingSelectedUnitPriceSnapshot`. Migration
`20260925093005_numeric_precision_pricing_technical_20_8`, só `ALTER COLUMN ...
SET DATA TYPE`, **sem backfill** — 302 linhas históricas do banco local
conferidas antes e depois, zero divergência matemática.

**A cadeia moveu-se inteira.** O motor calcula `P = C ÷ (1 − margem − comissão)`
em 40 dígitos e a coluna de seis casas gravava `4.053188` **sem `.toFixed()` no
código**: quem cortava era o PostgreSQL. Agora a redução para oito casas acontece
no domínio, antes do `update`, e a proveniência congelada no envio do Orçamento
carrega as mesmas oito.

**A decisão durável é a fronteira** — [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §60.
Preço técnico (8 casas) e preço comercial (4 casas) são **dois números**, lado a
lado de propósito: uma linha com `pricingSelectedUnitPriceSnapshot = 4,05318764`
e `unitPrice = 4,0532` está certa. A passagem entre eles é FECHAMENTO, não perda,
e acontece em `fecharPrecoUnitarioComercial` — com nome, teste e
**`ROUND_HALF_UP` declarado na chamada** —, nunca por scale de coluna, formatter
ou `Number`. O fechamento técnico de 8 casas, `fecharPrecoTecnicoPersistido`,
declara o mesmo modo: nenhuma das duas depende do default do `decimal.js`, e um
teste inverte o rounding global para provar. Depois da fronteira, Pedido e
Faturamento recebem cópias exatas e ninguém volta às oito casas.

**`QuoteLine.unitPrice` permanece `14,4` por decisão do PO** (PREC-P-05), e o
outro lado da regra veio junto: as **quatro entradas de preço sem teto de casas**
registradas na auditoria passaram a recusar — oito casas do lado técnico, quatro
do comercial, HTTP 400 em vez de arredondamento silencioso do banco. **#15 e #18
não foram tocados:** o total sai do preço comercial, `500 × 4,0532 = R$
2.026,60`. **PREC-MIG-P e PREC-SER-02 fecham aqui**; `commissionPerUnitSnapshot`,
`contributionPerUnitSnapshot` e `QuoteLine.contributionPerUnitSnapshot` seguem em
`14,6` — mesma origem, outra categoria, decisão do **PREC-MIG-D**.

## Antes dela

**P — PREC-MIG-P / PREC-P-01** (`e94971f`). `PurchaseOrderLine.unitPrice` em
`DECIMAL(20,8)`, sem backfill: `4.05318764::decimal(14,4)` devolvia `4.0532`, e
um insumo cotado por grama tinha o preço trocado por outro em silêncio. Junto, o
preço servido no Recebimento, onde "Usar preço da OC" copia o valor para
`ReceiptLine.actualUnitCost`.

**C — PREC-MIG-C** (`e7656ab`). Pureza e overage em `DECIMAL(9,6)`, sete colunas:
`99.9995` deixou de virar `100.000`. Na aprovação o PO **registrou a recusa acima
do scale como regra de produto** (§58); precisão e faixa de negócio são regras
independentes.

**B — PREC-MIG-B** (`b5f6089`). Custo unitário em `DECIMAL(20,8)`:
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

**#18 — reconciliação monetária da Ordem de Compra.** Decisão do PO em
2026-09-06, na publicação do PREC-P-TECH: com a fundação numérica no lugar, o
total da OC passa a ser a próxima capability, em conversa própria. Depois dela:
**PREC-MIG-D** residual (comissão e contribuição por unidade em `14,6`),
PREC-SER-01, PREC-FMT-01 e PREC-MIG-E.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#20 resolvido; #19
aberto** com PREC-MIG-A, B, C e P entregues. **Seguinte: #18**, depois D
residual, PREC-SER-01, PREC-FMT-01 e PREC-MIG-E. **Roadmap:**
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
