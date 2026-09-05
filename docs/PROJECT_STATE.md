# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main`:** baseline v2 (`78463a0`) + referência manual de custo, revisão do
"Como funciona" e reparo da reconstrução do banco — merge `--no-ff` de
`feat/manual-cost-reference-and-help-review` em 2026-09-04, aprovado pelo PO.
**Produção:** Railway, deploy automático da `main`; health 200, banco up,
smoke autenticado passando. Produção não tem dado de negócio — a base foi
limpa. **Em revisão do PO:** `feat/formulation-cost-consistency-ux` (Rodada 1
do backlog: #12, #9, #3, #5 resolvidos; #4 medido), não mergeada.

MVP operacional **validado internamente**. Blocos A a G fechados: cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas, produção
com consumo real e rastreabilidade, pedido do cliente com plano de atendimento,
expedição, faturamento, custos, cockpit e relatórios, formulação industrial,
material do cliente, GMP, qualidade documental, projetos e orçamentos
versionados, recursos e custo industrial, precificação e margem.

Três casos profundos derivados do legado rodaram ponta a ponta contra a
interface publicada — VAL-LEG-01, 02 e 03, todos PASS. Detalhe do que cada
rodada descobriu: [`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).

## Última capability publicada

**Referência manual de custo + substituição por cálculo + revisão global do
"Como funciona"** (2026-09-04).

A fonte de custo de um material passou a ter **uma** implementação canônica —
`lib/cost-source-selection.ts`: compra real 30d → 90d → última compra → oferta
válida → referência manual → desconhecido — reusando a fundação de compras. A
referência manual (`ItemCostReference`, migration aditiva) é estimativa com
histórico por vigência, unidade coerente e Decimal; a tela do item mostra a
referência e a fonte selecionada hoje. No cálculo padrão o usuário pode
**forçar** a referência por material, só naquele cálculo, com motivo; o
documento congela fonte usada, fonte automática, impacto, motivo, autor e hora.
Ofertas válidas ambíguas (sem preferencial, ou com vários) ficam em "seleção
necessária" — nunca caem para a manual sozinhas. Regra em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §53.

A ajuda contextual foi revisada tela a tela: 62 telas inventariadas, 5 tópicos
novos (estrutura de custos, lista de OPs, lista de faturamento, lista de
formulações, escanear lote), 6 telas de criação e a de escanear passaram a
abrir ajuda, Formulação e Pedido reescritos, vocabulário técnico removido. Um
teste de inventário lê as rotas e exige ajuda em toda tela da casca.

**Anterior:** quantidade física canônica do componente (`0673b13`, §52).

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas. Cada regra que elas
protegiam está mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md), numa
camada menor e determinística. Uma exigiu teste novo antes da remoção: a saída
física do lote por `ShipmentLine.lotId`.

Infraestrutura E2E genérica preservada em `scripts/e2e/lib/`. Plano das suítes
futuras: [`E2E_STRATEGY.md`](E2E_STRATEGY.md). Ferramental de segurança
(`local-db-guard`, `local-db-reset`, `smoke-prod`, `maintenance/`) e os
importadores oficiais permanecem.

**Reconstrução do banco do zero** (2026-09-04): as 49 migrations aplicam num
banco vazio só com o repositório — `scripts/migration-order.test.ts` em
`pnpm test` e `pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próximo gate

**Validação com a Veridi** para as regras que dependem do processo real do
cliente (#7, #11). Não bloqueia os itens internos já decididos pelo PO (#12,
#9, #3, #4, #5), que entram quando o PO autorizar a próxima capability. Roteiro
em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do
usuário final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado por política.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL e HIGH. **Rodada 1 entregue** (em
revisão): a estimativa de custo da Formulação usa o seletor canônico de fonte
(mesma fonte e custo unitário do CMV, provado), `CalcHint` de "CMV por
unidade" corrigido (÷ quantidade simulada) e de "Preço sugerido" conferido,
validação inline por componente com foco no primeiro erro, tabela de
componentes de 1681px para 1088px em 1440×900, rótulos dos modos decididos
pelo PO. **Resta:** #4 residual em 1280×800 (117px de rolagem). **Rodada
seguinte, quando autorizada:** #8A–#8C cálculo ao vivo em Ordem de Compra,
Expedição e Precificação. **Aguardando a Veridi:** #7 e #11. **Manutenção:**
#10 e #14 (Schema Integrity Audit). **Observação:** #1, #2.

## Blockers

Nenhum.

---

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
