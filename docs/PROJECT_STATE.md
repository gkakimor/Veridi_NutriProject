# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `0305704`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodada 1** (#12, #9, #3,
#5; #4 com residual aceito), **Rodada 2** (#8A, #8B, #8C, merge `dfb2673`),
**Rodada 3** (#8D, #8H, merge `b89f9a4`), **Rodada 4** (#15, #16, merge
`33ee1cd`) e a **auditoria de precisão numérica PREC-01** (merge `0305704`,
só documentação), todas aprovadas pelo PO.
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

**Fundação numérica A — #20 + PREC-MIG-A**, em revisão do PO na branch
`feat/numeric-precision-foundation-a`. Primeira implementação sobre a auditoria
PREC-01.

**#20 — motor decimal canônico em 40 dígitos.** A auditoria contou um
construtor; a implementação achou dois. O Prisma empacota a própria cópia do
`decimal.js`: `Prisma.Decimal !== Decimal`, configuração independente, e é o do
Prisma que roda quase todo o cálculo de domínio da API. Configurar só
`@veridi/shared` teria deixado a API inteira em 20 dígitos sem nenhum teste
perceber. `packages/shared/src/decimal-config.ts` é a configuração única;
`apps/api/src/lib/decimal.ts` a aplica ao construtor do Prisma. Só `precision`
muda — `rounding` segue `ROUND_HALF_UP`, o mesmo que o PostgreSQL usa ao gravar.

**PREC-MIG-A — 43 colunas em `DECIMAL(24,12)`:** 39 QUANTITY, 1 FACTOR
(`UnitOfMeasure.toBaseFactor` — quantidade com doze casas não adianta se a
conversão perder precisão antes dela) e 3 TECHNICAL_RESULT que já estavam em
`18,6` e têm o mesmo alvo. Migration
`20260925093001_numeric_precision_quantities_24_12`, só `ALTER COLUMN ... TYPE`.
O diff gerado pelo Prisma trazia junto 86 blocos do drift #14; foram removidos
na revisão linha a linha e o drift segue intocado. **Sem backfill:** 371 valores
existentes conferidos antes e depois, zero divergência matemática — só a
representação ganhou zeros à direita.

O defeito de #19 está fechado: `0,000000048` persiste como `0,000000048000` em
vez de `0,000000`, provado contra o banco real. E a entrada passou a **recusar**
acima de 12 casas em vez de deixar o PostgreSQL arredondar em silêncio — o
operador digitava um número e o banco gravava outro.

Três colunas `18,6` ficaram fora de propósito: os dois campos `legacy*` de
`FormulationComponent` e `QuoteLine.industrialCostPerUnitSnapshot`, que viaja
com os demais snapshots de precificação no PREC-MIG-B.
`scripts/numeric-precision-matrix.test.ts` guarda a matriz de §58 contra
reincidência.

**#20 RESOLVIDO. PREC-MIG-A RESOLVIDO.** #19 e PREC-MIG-D seguem **ABERTOS /
PARCIAIS** — os três resultados técnicos entregues aqui não reaparecem numa
migration futura; o residual do D são os que ainda estão em `14,4` e `14,6`.

## Antes dela

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

**PREC-MIG-B, C e D** — custo e `ReceiptLine.actualUnitCost` em
`DECIMAL(20,8)`, pureza e overage em `DECIMAL(9,6)`, demais resultados técnicos.
A fundação já está no lugar: o motor em 40 dígitos e a matriz de §58 protegida
por teste de schema.

**Gate paralelo:** validação com a Veridi para as regras que dependem do
processo real do cliente (#7, #11) — não bloqueia os itens internos já decididos
pelo PO. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL. **#20 resolvido; #19 aberto** com o
primeiro grupo (PREC-MIG-A) entregue e o defeito de microdosagem fechado.
**Rodadas 1 a 4 e PREC-01 publicadas** (#12, #9, #3, #5, #4 com residual aceito;
#8A–#8C; #8D, #8H; #15, #16; auditoria). **Seguinte:** PREC-MIG-B/C/D, depois
PREC-SER-01/02, PREC-FMT-01, **#18** (desbloqueado) e PREC-MIG-E. **Roadmap:**
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
