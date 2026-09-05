# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `2fa924f`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodada 1** (#12, #9, #3,
#5; #4 com residual aceito) e **Rodada 2** (#8A, #8B, #8C, merge `dfb2673`),
todas aprovadas pelo PO. **Produção:** Railway, deploy automático da `main`;
health 200, banco up, smoke autenticado passando, sem dado de negócio.
**Rodada 3** (#8D, #8H) entregue na branch `feat/billing-quote-live-preview`,
aguardando revisão do PO — não mergeada, não deployada.

MVP operacional **validado internamente**. Blocos A a G fechados: cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas, produção
com consumo real e rastreabilidade, pedido do cliente com plano de atendimento,
expedição, faturamento, custos, cockpit e relatórios, formulação industrial,
material do cliente, GMP, qualidade documental, projetos e orçamentos
versionados, recursos e custo industrial, precificação e margem. Três casos
profundos derivados do legado rodaram ponta a ponta contra a interface
publicada — VAL-LEG-01, 02 e 03, todos PASS; detalhe em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).

## Última capability entregue (em revisão do PO)

**Prévias monetárias coerentes no Faturamento e no Orçamento** — BACKLOG #8D e
#8H, 2026-09-05, branch `feat/billing-quote-live-preview`. Sem migration.

Nenhuma das duas telas mostra mais um total derivado do estado salvo anterior
enquanto seus operandos estão em edição. No **Faturamento**, alterar o preço de
uma linha mostra o total da linha e o total do documento resultantes antes de
confirmar, ao lado dos gravados, e o rodapé em rascunho é "Valor total
(prévia)". No **Orçamento**, quantidade e preço viraram campos controlados: o
total da linha e o "Total da proposta (prévia)" acompanham a digitação, com
"Total salvo" nomeado ao lado enquanto há edição pendente.

As duas contas passaram a ser uma só, em `@veridi/shared` e usadas pela API:
`calcularTotaisFaturamento` (linha em 2 casas, documento = soma das linhas
impressas) e `calcularTotaisOrcamento` + `buildPaymentSchedule` — este último
migrou de `apps/api` para o shared. Nenhum segundo motor, nenhuma requisição
por tecla. Histórico intacto: preço acordado, motivo/autor/hora do override,
faturamento emitido, versão enviada ou aceita e o Pedido dela originado.

Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54, agora com as duas
telas e com o critério de prévia local × endpoint de prévia.

## Última capability publicada

**Rodada 2 do backlog — prévias na OC, Expedição e Precificação** (2026-09-05,
merge `dfb2673`). Detalhe em [`BACKLOG.md`](BACKLOG.md) §F; regra em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54.

Antes dela: referência manual de custo com seletor canônico de fonte
(`lib/cost-source-selection.ts`, `PRODUCT_RULES.md` §53) e revisão global do
"Como funciona" — 62 telas, com teste de inventário exigindo ajuda em toda tela
da casca (2026-09-04).

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística. Infraestrutura E2E genérica preservada em `scripts/e2e/lib/`;
plano das suítes futuras em [`E2E_STRATEGY.md`](E2E_STRATEGY.md). Ferramental
de segurança e os importadores oficiais permanecem.

**Reconstrução do banco do zero** (2026-09-04): as 49 migrations aplicam num
banco vazio só com o repositório — `scripts/migration-order.test.ts` em
`pnpm test` e `pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próximo gate

**Revisão do PO da Rodada 3** (branch `feat/billing-quote-live-preview`) e, em
paralelo, a **validação com a Veridi** para as regras que dependem do processo
real do cliente (#7, #11) — esta não bloqueia os itens internos já decididos
pelo PO. Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md);
guia do usuário final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL e HIGH. **Rodadas 1 e 2 publicadas**
(#12, #9, #3, #5, #4 com residual aceito; #8A, #8B, #8C). **Rodada 3 entregue,
em revisão:** #8D e #8H. **Seguinte, quando autorizada:** #8E, #8F e #8G.
**Aguardando a Veridi:** #7 e #11. **Manutenção:** #10 e #14 (Schema Integrity
Audit). **Novos, da Rodada 3:** #15 (o Pedido congela o subtotal por outra ordem
de arredondamento — decisão do PO) e #16 (`pricing-options` responde 404 para
ausência de faixa). **Observação:** #1, #2.

## Blockers

Nenhum.

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, release, próximo gate | este arquivo |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
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
