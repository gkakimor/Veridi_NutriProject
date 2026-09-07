# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

## Onde estamos

**`main` @ `8f1016e`:** baseline v2 + referência manual de custo, revisão do
"Como funciona", reparo da reconstrução do banco, **Rodadas 1 a 4** (#12, #9, #3,
#5 com residual aceito em #4; #8A–#8C; #8D, #8H; #15, #16), a **auditoria PREC-01**,
as **Fundações numéricas A, B, C, P, D e E** e o **#18**, todos aprovados pelo
PO. **Produção:** Railway, deploy automático da `main`; health 200, banco up, 56
migrations sem pendência, smoke autenticado passando, sem dado de negócio.

MVP operacional **validado internamente**, blocos A a G fechados — de cadastros e
compras a produção rastreada, expedição, faturamento, custos, cockpit,
relatórios, projetos, orçamentos e precificação. Três casos profundos do legado
rodaram ponta a ponta contra a interface publicada (VAL-LEG-01 a 03, PASS).

## Última capability

**#17 — a listagem de Produto Acabado não cai mais por linha de outro
registro**, entregue em 2026-09-07. Sem migration, sem mudança de regra.

A tela monta a listagem em duas leituras separadas no tempo — primeiro os lotes
de produção, depois o custo de cada Ordem de Produção — e tratava uma OP que
deixou de existir entre as duas como 404: a listagem inteira respondia 500 e o
consumidor recebia `rows` indefinido. Era o que aparecia como "suíte não
determinística".

O custo por OP passou a ter dois contratos: o detalhe continua respondendo 404;
as LISTAGENS (Produto Acabado, painel, relatório de produção, que compartilhavam
o defeito) usam `findProductionOrderMaterialCost`, e a linha obsoleta sai sem
custo. A leitura dos lotes virou um retrato único (`RepeatableRead`), o que
também fez `total` e `rows` deixarem de vir de instantes diferentes.

**Reproduzido antes de fechar**, fora do runner: ~30% de falha em 400 leituras
sob três gravadores. Depois, 2.300 leituras sob cinco gravadores sem falha, e a
suíte da API completa dez vezes verde.

## Antes dela

**PREC-CMP-02** (`d7b150f`). A faixa de precificação passou a ser identificada
pela quantidade FÍSICA normalizada na unidade do Item de produto acabado (§68):
`1 kg` e `1000 g` eram duas faixas para a mesma quantidade, `500 g` e `500 kg`
eram uma só. Função canônica em `tier-quantity.ts`, sem migration.

**#21** (`0be565c`). O documento impresso da OP dividia a necessidade pelas
partes em float e escrevia `X × N`, afirmando N partes iguais — a produção
trunca as N-1 primeiras e dá o resto à última. `splitDecimal` subiu para
`@veridi/shared`; a API delega e o impresso reusa (§67).

**PREC-CMP-01** (`8f1016e`). Aplicar uma política decidia "esta faixa já
existe?" com `Number(a) === Number(b)` sobre `DECIMAL(24,12)`. O dano não era
visual, era de decisão: a versão nascia com uma faixa onde a política declarava
duas. `Decimal.equals` (§66).

**PREC-CMP-01** (`8f1016e`). Aplicar uma política de precificação decidia "esta
faixa já existe?" com `Number(a) === Number(b)` sobre `DECIMAL(24,12)`. O dano
não era visual, era de decisão: reproduzido no serviço real, a versão nascia com
uma faixa onde a política declarava duas. `Decimal.equals` — o mesmo critério que
`createPricingTier` já usava. Achado registrado, não corrigido: a comparação
**PREC-FMT-01** (`29f1df8`). A formatação deixou de passar por `Number`:
`9007199254740993,12` aparecia como `...994,00` porque o `double` já tinha
perdido o dígito antes de formatar. `lib/decimal-format.ts` formata sobre os
dígitos, com o contrato visual inalterado (§65). **Com ele o #19 fechou.**

**PREC-SER-01** (`140769c`). O último `.toFixed(6)` técnico da API era o custo
unitário de MATERIAL, servido em seis casas de colunas `DECIMAL(20,8)` — e o DTO
é o `result` gravado no snapshot do CALC, então o corte ficava congelado no
documento histórico. Quatro pontos passaram a `custoUnitario`. Zero migration.

**PREC-MIG-E** (`56b563c`) e **PREC-MIG-D** (`8a40b52`). A matriz de §58
aplicada ao schema inteiro: das 16 colunas de alvo órfão, só
`QuoteLine.industrialCostPerUnitSnapshot` migrou para `DECIMAL(24,12)`; os seis
totais de `PricingTier` ficaram em `14,4` e ganharam a **fronteira** que faltava
(§63). Antes, as três colunas `14,6` de resultado técnico foram para `24,12`, a
**terceira fronteira** (§62) — resultado técnico não é preço, mesmo sendo
dinheiro por unidade. Nenhum backfill. Junto, higiene DEV autorizada: banco
local reconstruído pelo caminho oficial, com backup antes do drop.

**#18** (`34a5424`). O rodapé da Ordem de Compra virou a soma das linhas
impressas — `40,79`, não `40,78` (§61) —, com o operando intocado e uma conta só
para todas as superfícies. Zero migration.

**PREC-P-TECH e as fundações P, C, B e A** (`b358fd8`, `e94971f`, `e7656ab`,
`b5f6089`, `5f855cd`). Os quatro preços técnicos em `DECIMAL(20,8)`, com a
**fronteira** de §60: preço técnico (8 casas) e preço comercial (4) são dois
números, e a passagem é fechamento explícito. Antes: o preço da OC em `20,8`;
pureza e overage em `DECIMAL(9,6)`, de onde saiu a **recusa acima do scale como
regra de produto** (§58); custo unitário em `DECIMAL(20,8)`, com
`ReceiptLine.actualUnitCost` como origem de TODO custo real; e a base — motor
decimal em 40 dígitos numa configuração única, com 43 colunas em
`DECIMAL(24,12)`. Antes disso, **auditoria PREC-01** (`0305704`) e **Rodadas 1 a
4** — #15 e #16 (`33ee1cd`), #8D e #8H (`b89f9a4`), #8A–#8C (`dfb2673`). Regras
§53 a §65; detalhe em [`BACKLOG.md`](BACKLOG.md), seção G.

## Estado operacional do repositório

**Baseline V2** (2026-09-04): as suítes E2E exploratórias e adversariais
históricas foram aposentadas — 51 scripts, ≈35 mil linhas —, com cada regra
mapeada em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) numa camada menor e
determinística; infraestrutura em `scripts/e2e/lib/`, plano em
[`E2E_STRATEGY.md`](E2E_STRATEGY.md). **Reconstrução do banco do zero:** as 56
migrations aplicam num banco vazio só com o repositório —
`scripts/migration-order.test.ts` em `pnpm test` e
`pnpm validate:migrations:fresh`; regra em [`TECH_BASELINE.md`](TECH_BASELINE.md).

## Próxima capability

**Nenhuma capability de precisão numérica em aberto.** A fila volta ao roadmap
de exibição (PREC-UI-01 a 08) e às melhorias já aprovadas, quando o PO
autorizar.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11) — não bloqueia os itens internos já decididos pelo PO.
Roteiro em [`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## Backlog aberto

[`BACKLOG.md`](BACKLOG.md). Zero CRITICAL, zero blocker. **#18, #19, #20
e #21 RESOLVIDOS — a fundação numérica está completa**, de PREC-MIG-A a
PREC-FMT-01, com PREC-CMP-01 e PREC-CMP-02 fechando a comparação e o #21 o
impresso. **Roadmap:** PREC-UI-01 a 08. **Quando autorizada:** #8E, #8F, #8G. **Aguardando a Veridi:** #7 e #11.
**Manutenção:** #10. **#14 RESOLVIDO** — o drift `schema.prisma` × migrations
era do repositório, não dos bancos: DEV, produção e um banco reconstruído do
zero são a mesma estrutura, e o modelo passou a declarar as 27 ações
`onDelete: Restrict`, os 26 nomes de constraint/índice e os 6 índices que as
migrations já tinham criado. Sem migration, sem alteração de banco.
**#17 RESOLVIDO** — a listagem de Produto Acabado
deixou de cair quando uma Ordem de Produção some entre a leitura dos lotes e a
do custo. **Observação:** #1, #2.

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
