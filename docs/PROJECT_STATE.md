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

**Auditoria global de precisão numérica — PREC-01**, aprovada pelo PO e
publicada em 2026-09-05. **Só documentação:** nenhuma migration, nenhuma
mudança de schema, nenhum código de produto tocado.

A auditoria provou o que já funciona: zero `Float` no banco, 106 colunas
`numeric` com precisão explícita, **zero divergência de precisão entre Prisma e
banco** (164/164), nenhuma grandeza atravessando a API como número JSON, motores
de cálculo em `Decimal` de ponta a ponta e round-trip de edição **IDENTICAL** em
dez casos determinísticos — abrir, não editar e salvar preserva o valor.

E provou o que quebra, com dado real: `Decimal(18,6)` **zera** quantidade física
derivada em microdosagem — `MP-000147` a `0,000048 kg` sobre base 1000 grava
`0,000000` ao produzir de 1 a 10 unidades, e a OP passa a afirmar que não precisa
do material (#19, HIGH/URGENTE). E o `decimal.js` roda em 20 dígitos
significativos, teto de JavaScript independente da coluna, que reprovou
`DECIMAL(30,12)` como baseline (#20, HIGH).

Decisões do PO registradas em [`PRODUCT_RULES.md`](PRODUCT_RULES.md): §57
armazenamento ≠ apresentação e o invariante de casa oculta; §58 a matriz de
tipos por categoria; §59 a configuração canônica de `Decimal` em 40 dígitos.
Decomposição PREC-MIG-A a E, PREC-SER, PREC-FMT e PREC-UI na seção E de
[`BACKLOG.md`](BACKLOG.md). Relatório completo em
[`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md).

**#18 desbloqueado:** nenhum total de OC é persistido, o custo real vem de
`ReceiptLine.actualUnitCost` e o custo industrial nunca consome o total
documental — a decisão ficou isolada. Implementa depois da fundação.

## Antes dela

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

**Fundação de precisão numérica: #20 + PREC-MIG-A** — `Decimal` canônico em 40
dígitos significativos e widening de QUANTITY e fatores técnicos para
`DECIMAL(24,12)`, com preservação ponta a ponta e migration segura. #20 vem
antes ou junto de #19: ampliar coluna sem ampliar o motor cria coluna que o
sistema não consegue preencher. **Começa em conversa nova.**

**Gate paralelo:** validação com a Veridi para as regras que dependem do
processo real do cliente (#7, #11) — não bloqueia os itens internos já decididos
pelo PO. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); guia do usuário
final em `Guia_Fluxo_Comercial_Veridi.docx`, não versionado.

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL. **Dois HIGH da auditoria PREC-01, e
são a próxima capability:** #19 (scale zera microdosagem, URGENTE) e #20
(`decimal.js` em 20 dígitos). **Rodadas 1 a 4 e PREC-01 publicadas** (#12, #9,
#3, #5, #4 com residual aceito; #8A–#8C; #8D, #8H; #15, #16; auditoria).
**Depois da fundação:** PREC-MIG-B/C/D, PREC-SER-01/02, PREC-FMT-01, **#18**
(desbloqueado) e PREC-MIG-E. **Roadmap:** PREC-UI-01 a 08. **Quando autorizada:**
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
