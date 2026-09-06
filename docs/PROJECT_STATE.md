# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `b5f6089`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodada 1** (#12, #9, #3,
#5; #4 com residual aceito), **Rodada 2** (#8A, #8B, #8C, merge `dfb2673`),
**Rodada 3** (#8D, #8H, merge `b89f9a4`), **Rodada 4** (#15, #16, merge
`33ee1cd`), a **auditoria de precisão numérica PREC-01** (merge `0305704`, só
documentação), a **Fundação numérica A** (#20 + PREC-MIG-A, merge `5f855cd`) e a
**Fundação numérica B** (PREC-MIG-B, merge `b5f6089`), ambas com migration,
todas aprovadas pelo PO.
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

**Fundação numérica B — PREC-MIG-B**, aprovada pelo PO e publicada em
2026-09-05, merge `b5f6089`. Custo unitário em `DECIMAL(20,8)`.

Três colunas, a família UNIT_COST inteira do inventário:
`ReceiptLine.actualUnitCost` (a origem de TODO custo real — média ponderada
30d/90d, último custo real, custo do lote consumido),
`ItemCostReference.unitCost` e `SupplierItemOffer.unitPrice`, que o seletor
canônico lê como custo. Migration
`20260925093002_numeric_precision_unit_cost_20_8`, só `ALTER COLUMN ... TYPE`,
**sem backfill**: valores existentes conferidos antes e depois em banco
descartável, zero divergência matemática.

`4,05318764` agora atravessa banco, DTO, seletor e média ponderada sem virar
`4,0532` em ponto nenhum — e a entrada **recusa** acima de 8 casas em vez de
deixar o PostgreSQL arredondar em silêncio. A média ponderada carrega a dízima
inteira no motor de 40 dígitos; o corte só acontece na saída.

**`PurchaseOrderLine.unitPrice` ficou de fora, de propósito.** A linha do
inventário diz "Sim — B", mas a **categoria** é UNIT_PRICE, e o PREC-MIG-B do PO
é UNIT_COST. Onde os dois discordam vale a categoria. O PO confirmou a exclusão
e abriu o **PREC-MIG-P** para a família UNIT_PRICE, com
`PurchaseOrderLine.unitPrice → DECIMAL(20,8)` já aprovado: um preço de compra
pode legitimamente ter mais de quatro casas, e o total documental da linha segue
regra própria — os dois conceitos são independentes.

**PREC-MIG-B RESOLVIDO. #19 e PREC-MIG-D seguem ABERTOS / PARCIAIS.
PREC-MIG-P aberto, HIGH.**

## Antes dela

**Fundação numérica A — #20 + PREC-MIG-A** (merge `5f855cd`). O motor decimal
canônico subiu para 40 dígitos: a auditoria contou um construtor, a
implementação achou dois — o Prisma empacota a própria cópia do `decimal.js`, e
é a dele que roda quase todo o cálculo da API, então configurar só
`@veridi/shared` teria deixado a API em 20 dígitos sem nenhum teste perceber.
`packages/shared/src/decimal-config.ts` é a configuração única; só `precision`
muda, `rounding` segue `ROUND_HALF_UP`.

43 colunas foram para `DECIMAL(24,12)` — 39 QUANTITY, 1 FACTOR
(`UnitOfMeasure.toBaseFactor`) e 3 TECHNICAL_RESULT —, sem backfill: 371 valores
conferidos antes e depois, zero divergência. `0,000000048` persiste em vez de
virar `0,000000`, e a entrada recusa acima de 12 casas.
`scripts/numeric-precision-matrix.test.ts` guarda a matriz de §58 contra
reincidência.

**Auditoria de precisão numérica — PREC-01** (merge `0305704`, só documentação).
Provou o que já funcionava — zero `Float`, zero divergência Prisma × banco
(164/164), nenhuma grandeza como número JSON, motores em `Decimal`, round-trip
de edição IDENTICAL — e o que quebrava: `Decimal(18,6)` zerando microdosagem
(#19) e o motor em 20 dígitos (#20). Decisões do PO em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57, §58 e §59; decomposição na seção E
de [`BACKLOG.md`](BACKLOG.md); evidência em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md). **#18 desbloqueado**
— nenhum total de OC é persistido e o custo industrial nunca consome o total
documental, então a decisão ficou isolada.

**Rodada 4** — integridade comercial Orçamento → Pedido (#15) e ausência de
precificação como estado (#16), merge `33ee1cd`. O subtotal comercial canônico é
`Σ round(quantidade × preço, 2)`: o Pedido gerado de uma proposta aceita passa
pela mesma função que montou a proposta, em vez de somar em precisão cheia e
arredondar no fim (R$ 172,84, não R$ 172,83). `pricing-options` responde 200 com
`{ "pricing": null }` para ausência esperada. Regras em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §55 e §56.

**Rodada 3** — prévias monetárias coerentes no Faturamento e no Orçamento (#8D e
#8H, merge `b89f9a4`): nenhuma das duas telas mostra o total do estado salvo
anterior enquanto seus operandos estão em edição, e as contas viraram uma só em
`@veridi/shared`, usada também pela API (`PRODUCT_RULES.md` §54). **Rodada 2** —
prévias na OC, Expedição e Precificação (merge `dfb2673`). Antes: referência
manual de custo (`PRODUCT_RULES.md` §53) e revisão do "Como funciona" em 62
telas (2026-09-04). Detalhe em [`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística. Infraestrutura genérica preservada em `scripts/e2e/lib/`,
plano em [`E2E_STRATEGY.md`](E2E_STRATEGY.md); ferramental de segurança e
importadores oficiais permanecem.

**Reconstrução do banco do zero** (2026-09-04): as 49 migrations aplicam num
banco vazio só com o repositório — `scripts/migration-order.test.ts` em
`pnpm test` e `pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**PREC-MIG-C** — pureza e overage em `DECIMAL(9,6)`, para que `99,9995%` não
seja persistido como `100,000`. Depois: **PREC-MIG-P** (UNIT_PRICE de alta
precisão, HIGH, junto de PREC-SER-02) e o PREC-MIG-D residual.

**Gate paralelo:** validação com a Veridi para as regras que dependem do
processo real do cliente (#7, #11) — não bloqueia os itens internos já decididos
pelo PO. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL. **#20 resolvido; #19 aberto** com
PREC-MIG-A e PREC-MIG-B entregues — microdosagem e custo unitário fechados.
**Rodadas 1 a 4 e PREC-01 publicadas** (#12, #9, #3, #5, #4 com residual aceito;
#8A–#8C; #8D, #8H; #15, #16; auditoria). **Seguinte:** PREC-MIG-C, depois **PREC-MIG-P** (HIGH),
D residual, PREC-SER-01, PREC-FMT-01, **#18** (desbloqueado) e PREC-MIG-E.
**Roadmap:**
PREC-UI-01 a 08. **Quando autorizada:**
#8E, #8F, #8G. **Aguardando a Veridi:** #7 e #11. **Manutenção:** #10 e #14.
**Abertos:** #17 (suíte da API não determinística sob paralelismo, não observado
na auditoria) e #21. **Observação:** #1, #2.

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
