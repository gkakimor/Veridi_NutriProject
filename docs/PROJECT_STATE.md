# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `33ee1cd`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodada 1** (#12, #9, #3,
#5; #4 com residual aceito), **Rodada 2** (#8A, #8B, #8C, merge `dfb2673`),
**Rodada 3** (#8D, #8H, merge `b89f9a4`) e **Rodada 4** (#15, #16, merge
`33ee1cd`), todas aprovadas pelo PO.
**Produção:** Railway, deploy automático da `main`; health 200, banco up, smoke
autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas,
produção com rastreabilidade, pedido, expedição, faturamento, custos, cockpit
e relatórios, projetos e orçamentos versionados, precificação e margem. Três
casos profundos do legado rodaram ponta a ponta contra a interface publicada
(VAL-LEG-01 a 03, PASS):
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).

## Última capability publicada

**Integridade comercial Orçamento → Pedido e ausência de precificação como
estado** — BACKLOG #15 e #16, aprovada pelo PO e publicada em 2026-09-05,
merge `33ee1cd`. Sem migration; deploy Railway com a release conferida no
bundle publicado e smoke autenticado passando.

O subtotal comercial canônico é `Σ round(quantidade × preço, 2)` — a soma dos
totais de linha já arredondados, que fecha com o documento que o cliente
confere. `quote-to-order.service.ts` somava em precisão cheia e arredondava no
fim: com preço de quatro casas o Pedido congelava um centavo que a proposta
nunca mostrou (R$ 172,84 × R$ 172,83). Agora o Pedido passa por
`calcularTotaisOrcamento`, a mesma função que montou a proposta aceita, e o
resumo do Faturamento dentro do Pedido, por `calcularTotaisFaturamento`.
Nenhum documento histórico recalculado, nenhum backfill.

`GET /quote-lines/:id/pricing-options` responde 200 com `{ "pricing": null }`
quando não há precificação vigente — estado esperado do negócio; 404 voltou a
significar só linha inexistente, e 403 e erro interno seguem distintos. Regras
duráveis em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §55 e §56.

## Antes dela

**Prévias monetárias coerentes no Faturamento e no Orçamento** — BACKLOG #8D e
#8H, publicada em 2026-09-05, merge `b89f9a4`, sem migration; deploy Railway
conferido e smoke autenticado passando. Nenhuma das duas telas mostra mais um
total do estado salvo anterior enquanto seus operandos estão em edição, e as
contas viraram uma só em `@veridi/shared`, usada também pela API. Detalhe em
[`BACKLOG.md`](BACKLOG.md) §F; regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54.

Rodada 2 — prévias na OC, Expedição e Precificação (2026-09-05, merge
`dfb2673`); referência manual de custo (`PRODUCT_RULES.md` §53) e revisão do
"Como funciona" em 62 telas (2026-09-04).

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

## Próximo gate

**Validação com a Veridi** para as regras que dependem do processo real do
cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO, que
entram quando o PO autorizar a próxima capability. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL e HIGH. **Rodadas 1 a 4
publicadas** (#12, #9, #3, #5, #4 com residual aceito; #8A, #8B, #8C; #8D,
#8H; #15, #16). **Seguinte, quando autorizada:** #8E, #8F e #8G. **Aguardando
a Veridi:** #7 e #11. **Manutenção:** #10 e #14. **Abertos:** #17 (suíte da API
não determinística sob paralelismo, não observado nesta rodada) e **#18**
(Ordem de Compra ainda arredonda com semântica distinta da comercial — MEDIUM,
capability própria, com auditoria antes de qualquer mudança matemática).
**Observação:** #1, #2.

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
