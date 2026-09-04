# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main`:** `0673b13` · **Produção:** Railway, health 200, banco up, smoke
autenticado passando. Produção não tem dado de negócio — a base foi limpa.

MVP operacional **validado internamente**. Blocos A a G fechados: cadastros,
compras, recebimento e lotes, estoque e FEFO, formulações versionadas, produção
com consumo real e rastreabilidade, pedido do cliente com plano de atendimento,
expedição, faturamento, custos, cockpit e relatórios, formulação industrial,
material do cliente, GMP, qualidade documental, projetos e orçamentos
versionados, recursos e custo industrial, precificação e margem.

Três casos profundos derivados do legado rodaram ponta a ponta contra a
interface publicada — VAL-LEG-01, 02 e 03, todos PASS. Detalhe do que cada
rodada descobriu: [`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).

## Última capability entregue

**Quantidade física canônica do componente** (`0673b13`, deployada e smokeada).

Cada componente declara o que a quantidade informada **significa**: já é a
física, ou é teórica e o sistema calcula aplicando somente os ajustes marcados.
Registrar pureza deixou de aplicar a correção sozinho — o dado real tem
componentes cuja quantidade já vem corrigida de fora, e neles preencher a pureza
aplicava a divisão uma segunda vez, em silêncio.

A matemática vive em `packages/shared/src/formulation-quantity.ts` e a API
delega, então a tela mostra o físico **enquanto se digita** chamando a mesma
função — não há segundo motor. `CalcHint` mostra a conta com os números da linha
e refaz essa conta para conferir a própria explicação.

Migration preservadora: backfill pelo comportamento canônico, não pela presença
do campo, com zero drift provado nos 1.725 componentes. Regra em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §52.

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

## Próximo gate

**Validação com a Veridi.** Nenhum desenvolvimento novo até a conversa acontecer
e o feedback ser classificado. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado por política.

## Backlog aberto

Zero CRITICAL e HIGH. Um MEDIUM (`aria-invalid` por campo na Formulação), três
LOW, três decisões de PO e quatro melhorias adiadas de propósito — a maior
delas é levar o cálculo ao vivo às demais telas. Ver [`BACKLOG.md`](BACKLOG.md).

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
