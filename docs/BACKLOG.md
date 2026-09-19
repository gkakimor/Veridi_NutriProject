# Backlog

O que está **aberto**. Nada mais.

**Como ler.** A ordem vive só na [fila viva](#fila-viva--a-ordem-num-lugar-só); um problema tem um ID só, e o detalhe
mora no discovery ou na seção indicada. Fechado não fica aqui: regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md),
estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), discovery em [`discovery/`](discovery/README.md), proteção em
[`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md), e o que saiu daqui em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md) — inclusive o texto integral, com evidência e narrativa, dos
itens que seguem abertos aqui em forma curta ([compactação de 2026-09-19](archive/BACKLOG_HISTORY.md#saídos-do-backlog-em-2026-09-19-documentation-hygiene-compaction-01)). Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) e não entra aqui sem decisão explícita do PO.

**Base:** reconciliado em 2026-09-19 sobre `main` `c860e190` (PRODUCT-BACKLOG-CONSOLIDATION-01) e compactado no mesmo
dia, só documentação (DOCUMENTATION-HYGIENE-COMPACTION-01). PROD em `release/prod` = `884a500d`, **v1.0.0**
([`RELEASES.md`](RELEASES.md)): nada integrado depois foi publicado — o pacote candidato está em
[v1.1.0](#veridi-nutrition-v110--candidata). Zero CRITICAL, zero BLOCKER. O MVP foi entregue; o que está aqui é
evolução do produto.

---

## Fila viva — a ordem, num lugar só

Reorganizada em 2026-09-19 (PRODUCT-BACKLOG-CONSOLIDATION-01) com a ordem dada pelo PO, sobre `main` `c860e190`. Só o
que está aberto; um problema tem um ID só, o detalhe mora no discovery ou na seção indicada, e a fila só ordena. As
linhas fechadas e o texto anterior das abertas estão em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md).

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 1 | P0 | **AUTHZ-VIEWER-READONLY-01** — VIEWER somente leitura e os perfis decididos por ato | Decidido pelo PO em 2026-09-19 (decisões 1–7 e 10 de [AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md), [resumo abaixo](#permissões-e-autoria--decisões-do-po)) · o inventário de rotas se refaz na `main` atual | Handoff do PO | — |
| 2 | P1 | **AUTHORSHIP-SESSION-ACTOR-01** — autoria nova pelo usuário da sessão e ator obrigatório no service | Decidido (decisões 8 e 9 do mesmo discovery) · sem backfill de "Ambiente local" · pode ir na mesma rodada do 1, se simples e seguro, como conceito separado | Handoff do PO | — |
| 3 | P0/P1 | **PENDING-PRODUCTION-LOT-ATTRIBUTION-01** — defeito F-1: com Plano misto (estoque + produção), a OP do saldo oferece e aceita produzir em dobro | Por leitura, sem teste (F-1 de [OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01](discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md), [resumo abaixo](#passagem-de-bastão-no-painel--decisões-do-po)) · sem migration | Reproduzir com teste vermelho e corrigir | — |
| 4 | P1 | **DOCUMENT-TRANSITION-CONCURRENCY-01 (Fatia 2)** — os P1 do discovery | Aberta · Pedido (plano e reserva × cancelar; confirmar × cancelar), Faturamento (emitir × cancelar, editar × emitir), confirmar e editar OC, Lote liberar × bloquear e os resíduos P1 confirmados; OP liberar × cancelar ficou coberto pela Fatia 1, sem teste dedicado ([discovery](discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md), seções 8 e 15) | Handoff do PO; o mesmo padrão da Fatia 1 | Fatia 1 (`ea5188e2`) |
| 5 | P1 | **PURCHASE-SUGGESTION-OWNER-SCOPE-01** — a Sugestão de Compra mede o disponível sem escopo de dono | Por leitura, sem teste (seção A) | Reproduzir com teste vermelho e corrigir | — |
| 6 | P1 | **CLOSE-WITH-REASON-PO-01** — encerrar o saldo de OC com motivo | Decidido (fatia 1 de [CLOSE-WITH-REASON-DISCOVERY-01](discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), [resumo abaixo](#encerrar-com-motivo--decisões-do-po)) · absorve o G5 do Painel Gerencial · **migration aditiva** | Handoff do PO | — |
| 7 | P1 | **CLOSE-WITH-REASON-OP-01** — encerrar OP sem produção | Decidido (fatia 2) · sem migration · permissão provisória ADMIN + PRODUCTION · leva P3a e P3b | Handoff do PO | — |
| 8 | P1 | **CLOSE-WITH-REASON-RESERVATION-01** — liberar reserva de PA | Decidido (fatia 3) · sem migration · base da fatia do Pedido | Handoff do PO | — |
| 9 | P1 | **CLOSE-WITH-REASON-CO-01** — encerrar o saldo de Pedido | Decidido (fatia 4) · **migration aditiva** · inclui a trava das entregas (L7) | Handoff do PO | 8 |
| 10 | P1/P2 | **DASHBOARD-ORDER-NEXT-ACTION-01** — a próxima ação do Pedido no Painel: PA pronto para reservar, Pedido sem Plano, saldo sem produção | Decidido (F1) · sem migration · suprime o "aguardando produção" redundante | Handoff do PO | 3 |
| 11 | P2 | **DASHBOARD-OP-READY-TO-RELEASE-01** — OP pronta para liberar | Decidido (F2) · sempre INFO, ordenada pela programação | Handoff do PO | — |
| 12 | P2 | **DASHBOARD-DELIVERY-DELAYS-01** — entrega atrasada e OP que termina depois da promessa | Decidido (F3) · dia civil; `requestedDeliveryDate` é a promessa implícita do Pedido sem entrega ativa | Handoff do PO | — |
| 13 | P2 | **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** — "Situação do lote: Vencido" deixa vazio o escopo do Novo inventário | Aberto (seção A) | Corrigir | — |
| 14 | P2 | **PERIOD-GUARD-R21-MATRIX-01** — guarda `periodo-invertido` vermelha na `main` desde o R-21 | Aberto (seção A) | Corrigir | — |
| 15 | P2 | **LOT-STATUS-FILTER-OVERLAP-01** — lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado" | Pede decisão: situação filtrada efetiva × gravada (seção A) | PO decide; depois corrigir | — |
| 16 | P2 | **DASHBOARD-EXPIRED-LIST-BALANCE-01** — o card de vencidos conta com saldo; o "ver todos" lista todos | Aberto (seção A) | Corrigir | — |
| 17 | P2 | **API-500-RAW-ERROR-01** — erro não traduzido volta 500 com a mensagem crua do Prisma | Aberto (seção A) | Corrigir | — |
| 18 | P2 | **INTERNAL-CONSUMPTION-COST-CENTER-01** — Centro de Custo do consumo interno | Decidido ([INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01](discovery/INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01.md); seção G) · **migration aditiva** · abaixo dos P0/P1 atuais | Handoff do PO | — |
| 19 | P2 | **DASHBOARD-INTERNAL-CONSUMPTION-01** — o Painel não representa Uso e consumo | Falta decidir o card: próprio, líquido dos estornos como o R-21, ou num existente (seção G) | PO decide o card | — |

**Depois, nesta ordem:**

1. **REVERSALS-02** — estorno rastreável no padrão do `ECI-` (§126) para as outras saídas, que seguem sem estorno ("vale
   só para o consumo interno", [INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01](discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md)).
2. **PURCHASE-NEEDS-CONSOLIDATED** — necessidade de compra consolidada por item, sem MRP.
3. **CONTEXT/CONSULTATION** — Visão do Produto e do Cliente completas, e a cadeia de custo (`costing`) já calculada e
   não exibida.
4. **SHOP-FLOOR-RECORDING** — registro de produção fiel ao papel: data real, pré-preenchimento, número oficial.
5. **MASTER-DATA-NAME-UNIQUENESS-01** — índice único de nome no banco, bloqueado pelo saneamento de PROD (seção G).
6. **Saneamento das duplicatas em PROD** — operação separada, nunca junto de publicação: Ondas A, 2 e 3 (§110, §118,
   §124) com conferência READ ONLY, PLAN, backup restaurável e APPLY aprovado pelo PO (ITEM-DUPLICATE-SANITIZATION-01 e
   as ondas da seção G).

Os itens 1 a 4 correspondem a quatro pontos do Top 8 da revisão funcional ponta a ponta
(VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, 2026-09-19, só no chat); os outros quatro estão nas linhas 1–2, 6–9 e
10–12 da fila.

**Fora da ordem de 2026-09-19** — abertos com posição na fila anterior, que esperam decisão ou handoff:

| Item | Estado | Próxima ação | Quem |
|---|---|---|---|
| **FORMULATION-WORKBENCH-01** — Formulação como bancada interativa | **EM HOMOLOGAÇÃO** · publicada em PROD em 2026-09-16 · histórico em [`archive/PROJECT_STATE_HISTORY.md`](archive/PROJECT_STATE_HISTORY.md) | Avaliação visual do PO; o fechamento depende de aprovação explícita | PO |
| **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; a 4A pode começar | PO fecha P2–P8 ([abaixo](#wave-4--decisões-ainda-reais)) | PO |
| **INVENTORY-PHYSICAL-COUNT-01** — Inventário Físico em sessões | Fatias 1, 2A e 2B entregues: o ciclo pela tela está completo | Fatia 3 — FO-01 de sessão e CSV; INVENTORY-CONFIRMATION-AFTER-DECISION-01 espera o PO ([abaixo](#inventário-físico--status)) | PO |
| **PRODUCTION-PERMISSION-HARDENING-01** — perfil final de quem executa a OP | Discovery `EM_ANALISE`; até o perfil final, vale o provisório "todos menos VIEWER" | Veridi responde P1 e P6 ([abaixo](#permissões-da-produção--status)) | Veridi |
| **E2E-BASELINE-REDESIGN-WAVE-05** — golden path | Discovery `EM_ANALISE`; vem depois da WAVE 4 | PO fecha Q3 e as demais ([abaixo](#golden-path-wave-5--status)) | PO |
| **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando a WAVE 4, as permissões da Produção e a WAVE 5 fecharem | PO |
| **DEMO-DATASET-01** — ambiente DEMO com massa fictícia determinística | **AGUARDANDO DEFINIÇÃO DO PO** · nada criado: sem ambiente, sem `release/demo` | Massa fictícia determinística + reset protegido para um futuro ambiente Railway DEMO, e o fluxo `main` → `release/demo` → aprovação → o MESMO SHA em `release/prod` | PO |

**P3** — LOW e UX realmente abertos, sem posição: tabelas da seção A (a partir de "LOW e UX da triagem"), fora os que
ganharam posição na fila acima; seção D e watchlist (E). A estabilização final é o lugar natural para varrê-los.

**Abertos fora da fila**, cada um esperando decisão própria — nenhum sobe sem o PO: os LOW e UX da seção A, as
melhorias da B (#8E–#8G) e da E (PLAN-DATE-01, UX-HELP-03), o gate com a Veridi e os achados preservados da C, a
manutenção da D e as perguntas da G. Sem seção própria: **INACTIVE-MARKERS-REPORTS-01** (opcional — as Fatias 1 a 4
fecharam, §107, §108, §112, §116; só D9, R-18 abrir em "Todos" com a situação, espera o handoff;
[discovery](discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md)); **ITEM-DUPLICATE-SANITIZATION-01** (G6 e G11
esperam a Veridi) e **ITEM-NAME-STANDARDIZATION-01** (MP/ME em MAIÚSCULAS e único sem caixa — parado até as ondas
fecharem, recontando DEV e PROD; [discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md)); **COST-VAR-02**
(bloqueado: sete decisões do PO e dado real em PROD;
[`archive/COST-VAR-01…`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md)); e **FINISHED-GOODS-OWN-LOT-PREFERENCE-01**
(opcional, não decidido: preferir o lote produzido para a própria linha do Pedido muda a política de alocação, hoje
FEFO; [discovery](discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md)). **OPS-BACKUP-01** (HIGH) está na seção
A: rotina agendada é decisão de infraestrutura.

## VERIDI NUTRITION v1.1.0 — CANDIDATA

Planejamento, não publicação. **PROD continua em `884a500d`, v1.0.0** ([`RELEASES.md`](RELEASES.md)): nada integrado
depois foi publicado, e este planejamento não autoriza deploy — publicar é decisão do PO. `VERIDI_VERSION` segue
`1.0.0`: o número só muda por decisão futura do PO, no commit que entra no SHA publicado.

**Já integrado na `main`**, fora de PROD — de `884a500d` a `c860e190`, nenhuma migration e nenhuma troca de versão:

- MASTER-DATA-HARD-DELETE-02 — exclusão física de Item, Produto + PA e Recurso industrial, Fatia 2 (§128, merge
  `83fa171e`);
- INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01 — consumo interno de data passada não atravessa contagem (§127, merge
  `ef7ca1c9`);
- VERIDI-AUDIT-QUICK-FIXES-01 — D1–D6 da revisão funcional (merge `f7ebb771`);
- DOCUMENT-TRANSITION-CONCURRENCY-01, Fatia 1 — os quatro P0 de concorrência documental (§129, merge `ea5188e2`);
- API-GLOBAL-ERROR-HANDLER-01 — tratador global de erros sem recursão (merge `c860e190`).

**Alvo antes do corte**, se o pacote mantiver tamanho razoável:

- AUTHZ-VIEWER-READONLY-01 — VIEWER somente leitura;
- AUTHORSHIP-SESSION-ACTOR-01 — autoria real;
- PENDING-PRODUCTION-LOT-ATTRIBUTION-01 — F-1, produção em dobro;
- DOCUMENT-TRANSITION-CONCURRENCY-01 Fatia 2, no essencial;
- correções pequenas de dono e status que afetem a verdade operacional — candidatas na fila, a confirmar no corte:
  PURCHASE-SUGGESTION-OWNER-SCOPE-01 (dono) e STOCK-COUNT-EXPIRED-STATUS-FILTER-01 (status).

**Entram se ficarem prontos a tempo** — e não seguram o corte quando o pacote de integridade já estiver sólido: as
quatro fatias de CLOSE-WITH-REASON, as atenções de passagem de bastão (DASHBOARD-ORDER-NEXT-ACTION-01,
DASHBOARD-OP-READY-TO-RELEASE-01, DASHBOARD-DELIVERY-DELAYS-01) e INTERNAL-CONSUMPTION-COST-CENTER-01.
CLOSE-WITH-REASON-PO-01, CLOSE-WITH-REASON-CO-01 e o Centro de Custo trazem migration aditiva: com qualquer um deles, a
publicação deixa de ser só código.

**Fora do pacote:** o saneamento de duplicatas em PROD — operação separada, com PLAN, backup restaurável e aprovação
próprios, nunca planejada junto de uma publicação.

**Para o corte:** PERIOD-GUARD-R21-MATRIX-01 deixa uma guarda vermelha na `main` desde o R-21 (fila, P2).

---

## Decisões ainda reais, por item da fila

### Permissões e autoria — decisões do PO

[AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md), `DECIDIDO` em 2026-09-19.
O relatório do discovery não ficou acessível — o documento guarda as decisões e os fatos já documentados —, então a
implementação refaz o inventário de rotas e autores na `main` atual.

- **AUTHZ-VIEWER-READONLY-01 (P0):** VIEWER é somente leitura operacional; ADMIN aparece explicitamente em toda lista;
  Pedido e entregas com ADMIN + COMMERCIAL; OC com ADMIN + PURCHASING; rascunho de OC pelo Pedido com ADMIN +
  PURCHASING + COMMERCIAL; Plano de Atendimento, OP do saldo, reservar e realocar PA com ADMIN + COMMERCIAL; preço de
  faturamento com ADMIN + COMMERCIAL. Onde a Veridi ainda não definiu o perfil final — Formulação, Recebimento, chão de
  fábrica, Expedição e Faturamento fora o preço —, provisoriamente **todos menos VIEWER**, a estreitar depois.
- **AUTHORSHIP-SESSION-ACTOR-01 (P1):** autoria histórica nova com o usuário real da sessão, sem backfill dos registros
  antigos "Ambiente local"; nos módulos tocados, ator obrigatório no service.
- Armadilhas já sabidas ([PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md)):
  `ForbiddenError` não mapeado em `picking`/`production`/`recipe` responde 500 (I6); ator opcional com fallback
  silencioso (I7); corpo validado antes do perfil (I5); teste de autoria com `not.toBeNull()` passa com "Ambiente
  local". Antes de publicar, conferir os perfis dos usuários reais de PROD.

### Encerrar com motivo — decisões do PO

[CLOSE-WITH-REASON-DISCOVERY-01](discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), `DECIDIDO` em 2026-09-19 (P1–P12),
`READY_TO_IMPLEMENT = YES` para as quatro fatias (linhas 6–9 da fila).

- Um fato append-only por linha — quantidade, motivo, quem, quando —; o contratado fica intacto; nada é fabricado,
  apagado ou reaberto. Sem status novo: RECEIVED e SHIPPED passam a "nada mais a receber/expedir" quando parte foi
  realizada e o resto encerrado, com a marca "saldo encerrado" (P2).
- Encerramento parcial, com o saldo inteiro pré-preenchido (P1). OP COMPLETED — com produção zero (P3a) ou com produção
  física (P3b) — não prende o cancelamento do Pedido: a produção não se desfaz, o PA fica no estoque disponível sob as
  regras normais de qualidade e reserva, e o diálogo diz isso.
- Sem cascata: OP ou OC aberta ligada ao saldo encerrado só gera aviso (P4); material que chega depois pede OC nova
  (P6); reserva maior que o novo saldo é recusada até a liberação (P7); Expedição DRAFT na linha bloqueia (P9); Pedido
  liquidado encerra as entregas pendentes de forma auditável, e Pedido que segue aberto não aceita promessa acima do
  novo saldo (P8).
- OP sem produção: motivo obrigatório e reconciliação explícita (P10); o custo preserva a MP real consumida, sem PA
  inventado (P11); permissão provisória ADMIN + PRODUCTION até a Veridi (P5).
- Saldo encerrado do Pedido não fabrica documento de faturamento (P12).
- Na implementação muda o texto do [`PRODUCT_RULES.md`](PRODUCT_RULES.md): o significado de SHIPPED ("physically
  shipped") e a regra de §22-25 que prende o cancelamento do Pedido com OP gerada. Laterais L1–L8 com destino na
  seção A.

### Passagem de bastão no Painel — decisões do PO

[OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01](discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md), `DECIDIDO`
em 2026-09-19, sem migration.

- **F-1 vem antes** (PENDING-PRODUCTION-LOT-ATTRIBUTION-01): `produzidoEmEspera` desconta do produzido também o que veio
  do estoque; com Plano misto (reserva 60 + OP 40), a OP aponta 40 e o `pendingProductionQuantity` fica 40 — a tela
  oferece "Gerar OP para saldo restante" e a rota aceita: produção em dobro, até alguém reservar os 40. Correção
  proposta: atribuir por lote e uma função única para o DTO e a OP do saldo. Na mesma conta mora o L4 de CLOSE-WITH-REASON (PA de lote bloqueado ou perdido contando como produzido em
  espera).
- OP pronta para liberar: sempre INFO, ordenada pela programação. Prazo: comparar por dia civil, não por instante
  arbitrário. Pedido sem entrega ativa: `requestedDeliveryDate` é a promessa implícita. O Painel pode agrupar por área
  operacional, sem esconder informação por perfil nesta fase. "PA pronto para reservar" ou "saldo sem produção"
  suprimem o "aguardando produção" redundante.
- O Painel orienta e o módulo operacional executa: nunca reservar, liberar OP, gerar OP, faturar ou reprogramar
  automaticamente.
- **Pendente, opcional, não decidido:** FINISHED-GOODS-OWN-LOT-PREFERENCE-01 — preferir o lote produzido para a própria
  linha do Pedido muda a política de alocação.

### WAVE 4 — decisões ainda reais

[E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](discovery/E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md), lido sobre
`9c60845` e persistido sobre `6256ca9`; o documento histórico não muda. **Resolvido por estado posterior:** P1 (a WAVE 3
foi o fluxo do Orçamento; o grupo C é da WAVE 4 — 4A, 4B e 4F prontas pelo discovery) e a espera da 4E (antes dela,
reconferir `scripts/e2e/fixtures/comercial.mjs` e `comercial-ui.mjs`, que o discovery não auditou). **Ainda reais**,
com recomendação no discovery: P2 a P7, e P8 reformulada — o helper da WAVE 3 existe; resta decidir se o desconto
digitado no Orçamento faz parte da prova ou entra por API, com só envio → faturamento na tela. Absorve
E2E-CORPUS-MASS-01.

### Inventário Físico — status

Discovery [INVENTORY-PHYSICAL-COUNT-DISCOVERY-01](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md) **`DECIDIDO`**
(D1–D8, P1–P7 e as telas DU-1 a DU-6) sobre a PO BASELINE aprovada (INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, seção G).
Fatias 1, 2A e 2B entregues (INVENTORY-PHYSICAL-COUNT-01): o ciclo pela tela está completo. Decisões do PO na 2B: sem
pré-checagem do encerramento (tenta e mostra a recusa); só a última decisão e a última recontagem ficam gravadas.
**Ainda aberto** (nada bloqueia o ciclo):

- **INVENTORY-CONFIRMATION-AFTER-DECISION-01** (P2, decisão do PO — toca quantidade): a confirmação de movimentação
  vale para sempre na posição; movimento lançado depois da decisão, inclusive retroativo, e a recontagem (rodada ≥ 2)
  não pedem nova confirmação, e o encerramento aplica a diferença congelada. Proposta: vale até o instante da decisão;
- adicionar posição em revisão pela tela (a API aceita; a tela só oferece em contagem);
- filtros "última contagem" e "movimentação" do montador; retenção leve;
- histórico completo de decisões e recontagens por posição — PO: não agora;
- conferência visual em navegador da revisão e dos diálogos em 390px.

Depois: Fatia 3 (FO-01 de sessão e CSV controlado). Regularização sem lote (P7), cíclico, scanner e localizações:
FUTURO.

### Painel Gerencial — status

V1 entregue em 2026-09-15 (MANAGEMENT-DASHBOARD-V1-01; faturado de `billings/billed-value.ts`). O G5 virou
CLOSE-WITH-REASON-PO-01; depois dele, "a receber de fornecedores" em R$ fica viável, opcional. Sem posição: G2 (preço
acordado em Pedido digitado direto) e G4 residual (Pedidos por data de confirmação; sem ela o cartão "Pedidos
confirmados" fica sem link). Evolução só com pedido do PO: seção 10.3 do
[discovery](discovery/FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md). Fora do produto: contas a pagar e a receber,
caixa, margem realizada.

### Permissões da Produção — status

[PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md). As E2E rodarem
como ADMIN (decisão G) não fecha a API. Desde 2026-09-19 resta só o **perfil final de quem executa a OP** — VIEWER e
autoria foram para as linhas 1 e 2, P3 e P4 respondidas, P8 absorvida —, com o provisório "todos menos VIEWER" até lá.
**Bloqueiam (Veridi):** P1 — quem executa a OP (picking, consumo, pesagem, parte, apontamento, variância, conclusão;
recomendado só ADMIN + PRODUCTION) e P6 — operadores com conta PRODUCTION própria. Com recomendação, sem bloquear: P2,
P5, P7. **Armadilha:** I6 — `ForbiddenError` não mapeado em `picking`/`production`/`recipe` responde 500; vale já para
AUTHZ-VIEWER-READONLY-01.

### Golden path (WAVE 5) — status

[WAVE-05-GOLDEN-PATH-DISCOVERY-01](discovery/WAVE-05-GOLDEN-PATH-DISCOVERY-01.md), **depois da WAVE 4**.
`private-label-golden-path.mjs` igual desde `9c60845`: F-01 (quebra em `pedido`) e F-02 (em `sugestao-compra`)
valem. Q5 e B1 resolvidos por estado posterior (sobra reconferir o trecho comercial e o runner contra a `main`).
**Ainda reais:** Q3, bloqueante (opção B do runner: repassa `--run`/`--desde`, exige `--clone`, checkpoint na pasta do
clone), e Q1, Q2, Q4, Q6–Q10. Absorve CUSTOMER-LIST-DEFAULT-E2E-01.

### Estabilização final — status

Depois da WAVE 4, das permissões da Produção e da WAVE 5. Sem ID e sem escopo; nasce quando os três fecharem. Entradas
naturais: os LOW e UX da seção A, a seção D e a watchlist.

---

## A. Defeitos abertos

Da auditoria de 2026-09-07 em diante ([`archive/E2E_AUDIT_2026-09-07.md`](archive/E2E_AUDIT_2026-09-07.md)), com a
severidade **do PO**. Cada linha diz o defeito e a decisão pendente; evidência e narrativa estão no
[histórico](archive/BACKLOG_HISTORY.md#saídos-do-backlog-em-2026-09-19-documentation-hygiene-compaction-01).

### LOW e UX da triagem de 2026-09-07

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-06-3** | `nextval` chamado fora da transação: recusa consome número de documento em cinco módulos | LOW | S |
| **F-03-2** | Coluna ORIGEM do histórico de versões vazia para versão criada de template | LOW | XS |
| **F-08-3** | Campos "Consumir agora" sem rótulo acessível | LOW | XS |
| **F-01-1** | "Produto" nomeia dois fatos diferentes na Consulta de Cliente | UX | S |
| **VOCAB-01** | Um conceito, três nomes: "Base de produção" (campo), "Base de referência" (leitura) e "Base de produção sugerida" (template) nomeiam a mesma quantidade. Mesma família de F-01-1; sweep só quando houver rodada de nomenclatura | UX | S |
| **F-01-2** | "Criar projeto" desabilitado sem dizer o que falta | UX | XS |
| **F-04-2** | Ativar estrutura e precificação com dado completo não pede confirmação | UX | S |

F-01-1 é defeito de rótulo, não de dado. F-06-3: o padrão certo já existe em `products.service.ts` —
`nextSequenceCode(tx, …)` como primeira linha **dentro** da transação.

### LOW e UX — achados das entregas posteriores

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-01-3** | "Consulta completa" só é alcançável de dentro do modal de edição | UX | S |
| **QUOTE-VERSION-SWITCH-DIRTY-01** | Abrir outra versão com condições pendentes descarta o rascunho sem aviso (de propósito em QUOTE-DRAFT-STATE-01); avisar, salvar ou descartar é decisão do PO | UX | S |
| **QUOTE-CASH-HIDDEN-DIRTY-01** | Parcela escondida pela troca Parcelado → À vista conta como pendência que só sai com "Descartar alterações"; decidir se campo escondido conta | UX | S |
| **PTBR-NUMERIC-DISPLAY-RESIDUAL-01** | Resíduo de PTBR-NUMERIC-DISPLAY-AUDIT-01: inteiros em frase sem `formatIntegerPtBr`; a guarda não vê variável solta nem ternário; `1.234` colado em campo decimal é recusado como ambíguo | UX | S |
| **OP-PARTS-ZERO-COERCION-01** | "Dividir produção em" vazio ou `0` vai à API como 1 em silêncio (`partesParaEnvio`); decidir se zero volta como erro | UX | XS |
| **NUMERIC-FOCUS-API-ZEROS-01** | Preço e custo de 8 casas (`toFixed`) aparecem `12,50000000` no foco; tirar os zeros na carga muda o que se envia ao salvar sem editar — decidir | UX | XS |
| **FORM-UOM-FK-01** | FK física em `FormulationTemplateComponent.unitCode` → `UnitOfMeasure`; a regra já vale sem ela e DEV e PROD estão conformes. **Só com autorização do PO** | LOW | XS |
| **FORMULATION-ITEM-SWAP-UOM-01** | Trocar o Item de um componente da Formulação põe a unidade de estoque do novo mesmo quando a escolhida serve (`500 mg` vira `500 kg`, sem aviso); o Modelo já mantém a compatível — decisão do PO | UX | S |
| **API-500-RAW-ERROR-01** | Erro do Prisma não traduzido volta 500 com a mensagem crua (chamada, trecho, caminho no servidor); pede tradução genérica no tratador global. A recursão fechou em API-GLOBAL-ERROR-HANDLER-01 | LOW | S |
| **TZ-DST-MIDNIGHT-GAP-01** | Com horário de verão começando à meia-noite (Brasil até 2019), `meiaNoiteComercial`/`instanteComercial` voltam uma hora e período e dia comercial discordam nessa hora. Só histórico hoje; corrigir muda resultado de data | LOW | S |
| **R20-SENT-PRICING-BASIS-SNAPSHOT-01** | O envio do Orçamento não congela custo p/ preço, qualidade dele nem o Modelo de Precificação; o R-20 diz "Não congelado no envio". Pede migration aditiva em `QuoteLine` — decisão de schema do PO | LOW | M |
| **R20-MANUAL-REFERENCE-MARGIN-01** | A conferir: linha de preço manual ou herdado congela a margem da faixa ativa (`faixaEquivalenteVigente`), não a do `unitPrice`, e o R-20 a mostra ao lado do preço manual | LOW | S |
| **QUOTE-NEW-VERSION-PATHS-01** | "Criar nova versão" e "Duplicar como nova versão" criam versão com origem, preço e substituição diferentes; o PO decide se convergem (P2) | UX | — |
| **QUOTE-DUPLICATE-ORIGIN-01** | A versão duplicada não guarda de qual nasceu; coluna de origem exigiria migration | UX | — |
| **CUSTOMER-FACTS-LOAD-01** | Watch: a lista de Clientes carrega Projetos com histórico e Pedidos confirmados por Cliente; medir com volume real | LOW | — |
| **QUOTE-SUGGESTION-390-01** | Em 390px, "Existe uma precificação vigente…" fica cortada na tabela do Orçamento (`QuoteWorkspace.tsx`) | UX | — |
| **LISTS-CUSTOM-PERIOD-PAGE-RESET-01** | "Personalizado" fora da página 1 (Faturamento, Recebimentos, OC, Produto Acabado) volta à página 1; decidir se abrir o Personalizado é trocar filtro | UX | — |
| **UI-NUMERIC-FIELD-STANDARD-01** | Levar a todo o sistema o campo numérico homologado na Formulação (caixa compacta, número à direita, pt-BR, setas pela última casa, limites do domínio). Pedido do PO de 2026-09-16, sem implementar: varredura tela a tela | UX | — |
| **ATTACHMENT-ACTIONS-BY-ROLE-01** | Anexos de Lote, Recebimento, Projeto e Amostra oferecem anexar e "Arquivar" a todo perfil; a API restringe e o clique dá 403. Pede as listas dos contextos no `@veridi/shared` | UX | S |
| **NAV-TWO-SEARCHES-01** | "Buscar ou escanear lote" no topo e "Buscar telas…" na coluna; unificar é da busca global | UX | — |

Resíduo de ~~FORMULATION-PRINT-ADJUSTMENTS-01~~ (absorvido em 2026-09-15): Folha de Receita, OP, CMV e Cálculo não
imprimem pureza, reserva nem físico por unidade — levar é decisão de outro item. ~~FORMULATION-TEMPLATE-BASIS-EDIT-01~~
foi superado pela base derivada (§106).

### Achados laterais de VERIDI-AUDIT-QUICK-FIXES-01 (2026-09-19)

Registrados sem corrigir; todos na fila (linhas 5 e 13–16).

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **PERIOD-GUARD-R21-MATRIX-01** | `lib/periodo-invertido.test.ts` vermelha desde o R-21: o CSV `/reports/inventory/internal-consumption` tem `from`/`to` e não está em `FAMILIAS` — falta a família e a prova do período invertido nesse CSV | LOW | XS |
| **PURCHASE-SUGGESTION-OWNER-SCOPE-01** | Por leitura: `buildPurchaseSuggestion` mede o disponível da Veridi com `getAvailableByItems` sem escopo de dono — estoque de cliente reduz a compra sugerida. Mesma classe do D4 | MEDIUM | S |
| **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** | Novo inventário: "Situação do lote: Vencido" vira `status in [EXPIRED]`, nunca gravado — escopo vazio; "Validade: Somente vencidos" funciona | LOW | S |
| **LOT-STATUS-FILTER-OVERLAP-01** | Os filtros de situação seguem o status gravado: lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado". Decidir se vale a situação efetiva | UX | S |
| **DASHBOARD-EXPIRED-LIST-BALANCE-01** | O card LOT_EXPIRED conta vencido COM saldo; o "ver todos" lista todos, zerados inclusive | UX | XS |

### Achados laterais de DOCUMENT-TRANSITION-CONCURRENCY-01 (2026-09-19)

Vistos na rodada que corrigiu os P0 de concorrência, fora do escopo dela: registrados, não corrigidos.

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **CONCURRENCY-DEADLOCK-UNKNOWN-ERROR-01** | No Prisma 6.19 o deadlock (`40P01`) numa consulta de modelo chega como `PrismaClientUnknownRequestError`, sem P2034: os tradutores do Inventário (`traduzirConflito`) e do Consumo Interno e do estorno (`recusarConcorrencia`) só olham P2034/P2028 e deixam esse deadlock virar 500. `lib/conflito-de-concorrencia.ts` reconhece a forma real e pode ser reaproveitado | LOW | XS |

### Achados laterais de CLOSE-WITH-REASON-DISCOVERY-01 (2026-09-19)

Anteriores ao tema, vistos por leitura em `f7ebb771` e fora do escopo do discovery
([documento](discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), seção 14): registrados, não corrigidos. Cinco já têm dono;
três ficam aqui, sem posição e sem severidade atribuída.

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **CLOSE-WITH-REASON L3** | R-04 olha só `releasedAt`, não o status da `MaterialReservation` (`production-reports.service.ts:82-84`) | — | — |
| **CLOSE-WITH-REASON L4** | "Produzido em espera" conta PA de lote bloqueado ou perdido e trava a OP para o saldo (`customer-orders.service.ts:489-492`; `fulfillment-plan.service.ts:544-547`). É a mesma conta do F-1 (PENDING-PRODUCTION-LOT-ATTRIBUTION-01, fila, linha 3) — vale olhar junto; o lote reprovado depois do apontamento espera a Veridi (P13 do discovery) | — | — |
| **CLOSE-WITH-REASON L6** | `acceptMaterialVariance` grava sem trava na OP (`production.service.ts:231`). A classificar com a concorrência — candidato a resíduo da Fatia 2 de DOCUMENT-TRANSITION-CONCURRENCY-01 | — | — |

Com dono: L1 e L2 (DTO da reserva e R-14 contam reserva liberada) em CLOSE-WITH-REASON-RESERVATION-01; L5 (CSV da OP
com "Falta produzir" em OP concluída) em CLOSE-WITH-REASON-OP-01; L7 (criar, cancelar e reprogramar entrega sem trava do
Pedido) em CLOSE-WITH-REASON-CO-01, como pré-requisito; L8 (Pedido com falta produzir e sem OP não gera atenção) em
DASHBOARD-ORDER-NEXT-ACTION-01.

### Achados do FAST-DEVELOPMENT-RESET-02 (2026-09-11)

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **OPS-BACKUP-01** | Backup de PROD: snapshot pela API do Railway recusado, PITR desligado, nenhuma rotina agendada. Em uso: o lógico JSON (`prod-backup-json.mjs`), restauração provada por `restore-json-backup-check.mjs`. É o "Backup do banco" de `DEPLOY.md` §7, que bloqueia operação de verdade | HIGH | S |
| **TEMPLATE-PURITY-LEGACY-DATA-01** | Modelo gravado com pureza 0 ou > 100 antes de INPUT-DATE-CONTRACT-WAVE-01 dá 400 ao salvar sem corrigir. Não conferido em PROD | LOW | XS |
| **COST-MP-EMB-SPLIT-01** | Estimativa da Formulação e CMV não separam matéria-prima e embalagem (`CostBreakdown.tsx`); o total está certo | UX | S |

**Achado estrutural, sem item próprio:** três implementações da conta "quantidade por base" — `fatorDaBase`
(`packages/shared`), `basisFactor` (`apps/api/src/lib/formulation-math.ts`) e o `convertUomDecimal` cru. G2 (no
histórico) é o primeiro sintoma; consolidar os motores é candidato a capability própria.

---

## B. Melhorias aprovadas — aguardando autorização do PO

### 8. Cálculo ao vivo nas demais telas

Padrão da Formulação: o valor derivado aparece enquanto se digita, da **mesma função** da API, com `CalcHint` e
travessão para premissa ausente. Já no padrão: OC, Expedição, Precificação, Faturamento, Formulação, CMV e prévia de
política de preço (#8A–#8D, #8H); regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54.

| Item | Tela | Escopo | Prioridade |
|---|---|---|---|
| **#8E** | Recebimento | Custo efetivo: total e comparação com o custo previsto quando aplicável | LOW |
| **#8F** | Ficha de Pesagem | Mostrar a diferença antes da confirmação | LOW |
| **#8G** | Ordem de Produção | Mudar a quantidade planejada não atualiza a prévia das necessidades até salvar. **Auditar antes**: nenhum cálculo vivo pode mutilar OP já congelada | A AUDITAR |

No radar: Contagem de Estoque e Reservar ↔ Produzir sem `CalcHint`; Custo Industrial e impacto de materiais do Pedido
em branco até apertar botão.

### 9. OPS-CALENDAR-01 — ABSORVIDO por PLANNING-CALENDAR-01 (2026-09-12)

Segue aberto só o discovery de se o calendário global vale para prazo de planejamento de COMPRA.

---

## C. Decisões aguardando negócio — gate com a Veridi

Não implementar por suposição. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); perguntas
regulatórias em [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

### 7. Convenções operacionais ainda não formalizadas

Cada uma tem um padrão em uso; nenhuma impede operação. Com o feedback da
Veridi, quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel — decididas para o cadastro mestre (Cliente §98; Item, Fornecedor e Produto §100) e,
  em 2026-09-19, para os atos de Pedido, OC, Plano, OP do saldo, reserva de PA e preço de faturamento
  ([AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)), com o provisório "todos
  menos VIEWER" onde a Veridi não definiu o perfil final; a execução da Produção é PRODUCTION-PERMISSION-HARDENING-01;
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção — R2 **ativo em PROD desde 2026-09-17** para o arquivo do Item
  Rótulo (§103; [`DEPLOY.md`](DEPLOY.md) §6.1) no bucket de homologação (`veridi-homologacao`); bucket próprio é decisão
  do PO, e os anexos genéricos são ATTACHMENTS-R2-MIGRATION-01 (seção G).

### 11. Material do cliente — lote do fabricante e validade por configuração do Item — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita "Lote do fabricante" e "Validade" em branco; o recebimento de OC
exige os dois quando o item controla. **Decisão de PO:** não assumir que todo Item exige validade; a solução futura é
configuração por tipo ou Item ("exige lote do fabricante", "exige validade"), com defaults validados com a Veridi.
Relacionado ao #7.

### Achados preservados na consolidação de 2026-09-19 — sem posição

Listados pelo PO em PRODUCT-BACKLOG-CONSOLIDATION-01 para continuar no backlog **sem promoção**: nenhum tem escopo nem
posição, e a maioria depende de decisão da Veridi. O achado está com as palavras do PO; a coluna ao lado só aponta onde o
assunto já aparece.

| Achado | Onde já aparece |
|---|---|
| Qualidade bloqueando lote reservado — depende de decisão da Veridi | Hoje lote com reserva de PA não pode ser bloqueado ([CLOSE-WITH-REASON-DISCOVERY-01](discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), seção 4); o lote reprovado depois do apontamento é a P13 de lá |
| Item structural lock | MASTER-DATA-STRUCTURAL-LOCKS-01 (seção G) — um ID só |
| Custo histórico e revisões | — |
| Perda esperada × perda operacional | A perda prevista da Formulação é do processo ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §52); tolerâncias e códigos de perda estão no [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) e no #7 acima |
| OP com perda total | A OP que consome e não produz é CLOSE-WITH-REASON-OP-01 (P10 e P11 do discovery); a perda do PA já apontado segue a Qualidade (P13, Veridi) |
| Retorno de cliente e de fornecedor | — |
| Material equivalente e substituição | "Materiais substitutos" no [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md); a separação da OP já tem a ação de substituir ([PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md), inventário das mutações) |
| Vida útil mínima por cliente | Vizinho do limiar de validade próxima e da validade por classe de Item (#7 acima) |
| Políticas definitivas de Formulação, Recebimento, chão de fábrica, Expedição e Faturamento | Perfil final por área com a Veridi; até lá, o provisório "todos menos VIEWER" ([AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)); chão de fábrica em PRODUCTION-PERMISSION-HARDENING-01 |

### Aguardando a Veridi ou futuro, sem posição

- **FORMULATION-PRESENTATION-BY-FORM-01** — a tabela Forma × Apresentação: primeira versão em
  `APRESENTACOES_POR_FORMA` (`packages/shared`) — cápsula oferece tudo, pó tudo menos **Frasco**; a apresentação já
  gravada segue na lista. Confirmar ou corrigir é decisão do PO.
- **PRODUCTION-LOT-PURITY-RECONCILIATION-01** — futuro, fora do P0: quando a pureza congelada na Formulação e a do lote
  real divergirem, avisar e exigir decisão controlada, nunca recalcular em silêncio; auditar junto se a pureza nominal
  mora na relação Fornecedor ↔ Item.
- **SERPRO** — segundo provedor da consulta de CNPJ: exige credencial, contrato e decisão do PO. Resíduo de
  ~~CUSTOMER-CNPJ-AUTOFILL-01~~, entregue como CUSTOMER-CNPJ-LOOKUP-01 (§111) — não reabrir.

~~FORMULATION-LOSS-SCOPE-01~~ (§52) e ~~FORMULATION-TEMPLATE-WORKBENCH-01~~ (§96–§97) fecharam; o registro está no
histórico.

---

## D. Manutenção técnica

- **#10 — compactar `archive/DELIVERY_HISTORY.md`** (LOW): ≈5.326 linhas de diário; consolidar para ≈200–400 com data,
  capability, commit importante, decisão durável e breaking change. Não misturar com capability de negócio.
- **#12 — `validate-migrations-fresh.mjs` chama o Prisma por shell** (LOW): `DEP0190` a cada execução, sem impacto;
  trocar por `scripts/prisma-bin.mjs`.
- **#16 — CALENDAR-LEGACY-COLUMNS-CLEANUP-01** (LOW): `production_calendars` guarda as colunas e CHECKs da jornada
  única, que nenhum código lê desde a jornada semanal. Migration que as remova depois da jornada semanal em produção e
  do backup conferido; risco até lá: ler a coluna velha como jornada.
- **#17 — FK-ORDER-DOCUMENTED-CYCLE-01** (LOW): `scripts/maintenance/fk-order.mjs` acusa como anel sem saída o ciclo
  da contagem física (migration `20260925093026`) e sai com código 1; `prod-cleanup.mjs` o atravessa por
  `CASCADES_EM_CICLO_DOCUMENTADAS`. Correção: reusar `calcularOrdem()` de `prod-cleanup-models.mjs`.

---

## E. Watchlist — observado, sem ação conhecida

Verdadeiro hoje e sem trabalho definido; sintoma novo vira item da seção A.

| # | O quê | Por que não é backlog |
|---|---|---|
| **W1** | `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento dos workers do vitest | Sem asserção falhando nem ocorrência recente. **Decisão de PO:** não investigar preventivamente; se voltar, capturar Node, worker, ordem de shutdown, árvore de processos, frequência e stack **antes** de mexer |
| **W3** | 24 das 56 linhas de `_prisma_migrations` em PROD com checksum diferente | Line ending; `.gitattributes` fixa LF para clones novos |
| **W4** | Linha órfã `20260904093000_template_component_quantity_mode` em PROD | Tolerada desde 2026-09-04 ([`TECH_BASELINE.md`](TECH_BASELINE.md)) |
| **W5** | Dois diretórios de migration com o timestamp `20260904090000` | Ordem determinística pelo nome; empate novo é barrado (`proximoPrefixoLivre`, `migration-prefix.test.ts`) |
| **W6** | Trocar `RESTRICT` por `SET NULL` em alguma das 27 FKs opcionais | Cada troca é decisão de domínio, com migration |
| **W7** | Quantidade passa por `Number` em testes de sinal de `badge`/`disabled` nas telas de OP e Pedido | Não alcança payload nem validação; soma exibida em float é do PREC-UI |
| **W8** | Tetos de 100 que não cortam escolha (dica de homologação da OC, relações do cadastro, amostras do Projeto, usuários) | Vira item da seção A quando algum passar do teto |
| **W9–W11** | Quedas por tempo sob carga: `operational-sheets` (`waitFor` de `abrirFolha`), `periodo-invertido-listas` ("Carregando…"), prazo de 5 s em guardas que varrem a árvore | Sem asserção falhando; o remédio é prazo próprio, não reexecutar até passar |
| **W12** | `stock-count-telas-2b.test.ts`: `stock_count_close_blocked` em vez de `stock_count_changed` | Causa provável: o relógio do Node no Windows 1–3 ms atrás; correção de teste sugerida (recebimento de antes da sessão com `createdAt` recuado), não aplicada |

- **#15 — `Decimal.toString()` em notação exponencial** (LOW): abaixo de `1e-7` o DTO viaja `"1e-12"`. Não visto em
  dado real; corrigir num lugar só, `toFixed` na escala da categoria (§58).
- **#14 — PLAN-DATE-01** (LOW): a promessa de entrega (COM-04) ainda não influencia o planejamento. Com autorização do
  PO: Sugestão de Compra com data, necessidade de produção no tempo e sugestão — nunca automática — de divisão de OP.
  **Restrição durável:** nenhum segundo motor de reserva (§75). A parte que CONTAR dias úteis precisa do calendário
  (OPS-CALENDAR-01, B · #9) antes.
- **#13 — ajuda contextual, o que a Fase 1 deixou aberto** (LOW), decisão do PO: UX-HELP-03 (painel lateral, "?"
  fixo, `/ajuda/conceitos/:slug`); 39 tópicos no modelo V1; tópicos de várias telas (§45 permite dividir); rótulos na
  terminologia aprovada (PO-5, PO-4) — hoje "Status" nas listas, "Lote Veridi" × "lote comercial", "Picking" em
  `/producao/picking`. Fora de escopo: a casca transborda 67px a 390px (endurecimento responsivo).

---

## G. Discovery — descobrir antes de construir

Nenhum tem escopo definido: cada um **responde uma pergunta** antes de desenhar solução. Na fila:
INTERNAL-CONSUMPTION-COST-CENTER-01 (decidido) e DASHBOARD-INTERNAL-CONSUMPTION-01. Registro integral de cada item
no [histórico](archive/BACKLOG_HISTORY.md#saídos-do-backlog-em-2026-09-19-documentation-hygiene-compaction-01).

| ID | Pergunta | Já decidido / sabido |
|---|---|---|
| **SUPPLIER-OFFER-OVERLAP-01** — vigências sobrepostas | Oferta nova não encerra a anterior, e a tela mostra as duas como "Serve de referência" sem dizer qual vence (motor: `effectiveAt` mais recente, desempate `createdAt`). `IndustrialResourceRate` tem o mesmo desenho — PROD já tem 1 recurso assim. Caminhos: (A) explicar qual vence; (B) encerrar a anterior; (C) alertar; (D) sobreposição deliberada | Uma decisão só para oferta e tarifa; estado travado em teste (`rate-validity-api.test.ts`, `vigencia-de-tarifa-industrial.mjs`). As 602 ofertas `LEGACY_IMPORT` sem vigência são dado do usuário: nenhum backfill |
| **COM-CONTRACT-01** — registro leve de contrato (P2) | Escopo a auditar: referência, Cliente, Projeto de origem opcional, datas, situação, observação e anexo; situação derivada por DATAS (como §71) | Contrato **não dirige** a situação comercial do Cliente. Customer, Project, QuoteVersion, CustomerOrder e Contrato são coisas separadas. Não criar módulo grande |
| **SUPPLIER-MODE-01** — "Fornecedor — Virtual / Físico" | Classifica o fornecedor, o endereço, o canal de compra ou outra coisa? Cada resposta muda onde o campo mora | **Não criar enum** antes da definição |
| **ASSET-01** — "Cadastro de Ativos" | Imobilizado (depreciação — ROADMAP), máquina (`EQUIPMENT`), recurso industrial, ou a flag Ativo/Inativo? | **Não criar módulo**; auditar `IndustrialResource` primeiro |
| **INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01** — redesenho do Inventário Físico | Absorvida pelo discovery `DECIDIDO` (tabela "PO baseline" — nenhum objetivo retirado); Fatia 3 espera o handoff ([status](#inventário-físico--status)) | Texto integral no histórico. Cíclico, scanner, localizações e regras avançadas: FUTURO (ROADMAP, Armazém / WMS) |
| **CUSTOMER-MASTER-DATA-AUDIT-01** — histórico do cadastro do Cliente (P2, futuro) | Troca de CNPJ, razão social ou perfil tributário não deixa rastro: histórico append-only de antes/depois — quais campos, quem lê, e com os snapshots dos documentos? Exigiria migration | Quem altera: §98 |
| **MASTER-DATA-STRUCTURAL-LOCKS-01** | Só `Item.operationallyUsed` trava campo estrutural; sem trava: Item usado em Formulação/Modelo, PA ligado a Produto e `PATCH /products/:id`. Quais vínculos travam quais campos, por campo ou por ato? | Quem edita: §100 |
| **MASTER-DATA-STATUS-HISTORY-01** (P2, futuro) | Motivo obrigatório e histórico com autor e data ao inativar/reativar Item, Fornecedor e Produto (o Cliente já tem, §95)? Exigiria migration | Quem inativa e reativa, e o 409: §100 |
| **SUPPLIER-ITEMS-UX-01** — Fatia 2 de [ITEM-SUPPLIER-UX-DISCOVERY-01](discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) | Tornar administrável a seção Itens fornecidos do Fornecedor; decidir junto a confirmação da troca de preferencial na tela geral | D4: capability separada. Parte da Fatia 1 (§102). Sem migration |
| **ATTACHMENTS-R2-MIGRATION-01** (P2, futuro) | Levar `Attachment` (volume, 10 MB, sem assinatura) ao `StorageAdapter` e ao R2, movendo os arquivos com cópia verificada por hash? Exigiria migration | — |
| **LABEL-FILE-SUBTYPE-CHANGE-01** (LOW) | Rótulo com versões que vira Pote esconde o histórico (409 `item_not_label`): travar a troca de subtipo ou mostrar o histórico fora dele? | Nada se perde |
| **ASSISTED-ENTITY-SELECTOR-ROLLOUT-01** | Quais seletores ganham a consulta assistida, e em que ordem, depois de validar o piloto com a Veridi | Fundação e múltipla na `main` ([`UI_BRAND.md`](UI_BRAND.md)). Campo de vários tipos pede `types=` na API (OC; `GET /industrial-resources` no Roteiro); modal abre mais uma camada; só ativo é escolhível |
| **COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01** (LOW) | "Salvar rascunho" do Modelo de Estrutura deixa de fora a linha sem uso por lote, sem dizer qual: recusar apontando a linha ou avisar? | — |
| **DASHBOARD-INTERNAL-CONSUMPTION-01** — fila, linha 19 | O Painel (`applyMovementCount`) não conta `INTERNAL_CONSUMPTION` nem o estorno: card próprio, líquido como o R-21, ou num existente? | Fora da fatia do estorno por decisão do PO |

### Duplicatas de cadastro mestre — P1, saneadas no DEV, fora de PROD

- **MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01** — executada no `veridi_dev` em 2026-09-17 (§118): 8/8 grupos, 11
  Itens removidos, `declaredNutrient` consolidado em "A · B · C", o par da sílica. **Antes de PROD, a V4 com a
  Veridi** (o que `*`/`**` significam no nutriente; "Clorogênico" = "Clorogênico**" valeu só para o DEV).
- **MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01** — executada no `veridi_dev` em 2026-09-17 (§124): G4 fundido; G7 e
  G13 renomeados; Modelos "X" excluídos. Restam **G6 e G11**, esperando a Veridi (V4; teor de clorogênico do MP-000325
  e do MP-000348; cotações FLORIEN R$160/kg × R$650/kg; o legado 349 com 8%, 45% e 50%); com a resposta, o PO decide. A
  carga reproduz as ondas desde ITEM-IMPORT-WAVE-3-CONSISTENCY-01.
- **Em PROD, cada onda** é operação separada: conferência READ ONLY, PLAN em PROD (o código do ERP sai de sequence por
  banco), backup restaurável e aprovação do PO.
- **MASTER-DATA-NAME-UNIQUENESS-01** — sem data: o guarda da API não fecha a janela SELECT → INSERT, e a constraint é o
  índice único `upper(btrim(<coluna>))`, a mesma expressão do guarda e do saneamento. Antes: o saneamento fecha (no DEV
  restam G6 e G11), PROD é medido em READ ONLY, e o Item tem **um** espaço de nomes para os quatro tipos (PO,
  2026-09-17) — um índice só em `items`. Até lá, o cadastro que nasceu duplicado segue editável quando o nome efetivo
  não muda (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01, §114; PROD tinha 21 grupos / 45 Itens em 2026-09-18).

### INTERNAL-CONSUMPTION-COST-CENTER-01 — Centro de Custo do consumo interno — P2 · DECIDIDO

**Decidido pelo PO em 2026-09-19**
([INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01](discovery/INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01.md)); fila
viva, linha 18, abaixo dos P0/P1. Centro de Custo é cadastro próprio, obrigatório em CI novo; criar, editar e inativar só
ADMIN, e todo autenticado consulta; o destino livre sai do CI novo (`purpose` fica como legado de leitura) e
"Observação/finalidade" segue livre; CI antigo sem backfill, mostrado "Sem centro de custo" com o destino antigo; sem
seed; cadastro em Cadastros e Configurações › Centros de custo. Migration aditiva. O registro de quando
era pergunta está no histórico.

---

## Backlog reservado para go-live

Os itens deliberadamente adiados até a preparação final estão em [`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md).
**Status atual: INATIVO** — fora da Fila viva; só o PO ativa.

---

## F. Roadmap — fora do backlog

Escopo futuro vive em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md): **preferências de exibição de precisão** (PREC-UI-01
a 08; desenho em [`archive/NUMERIC_PRECISION_AUDIT.md`](archive/NUMERIC_PRECISION_AUDIT.md) §11, invariantes em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57 — **atenção:** PREC-UI-05 e -06 já são o comportamento atual e se preservam,
mas F-08-1 provou que a exibição em geral não os segue e FIX-01 corrigiu só o campo com teto) e **Produto próprio
Veridi** (`Product.customerId` segue obrigatório). **Tributos, frete e custos de aquisição seguem BRAINSTORM**, cobertos
pelo ROADMAP (Landed cost; Custeio / CMV) e por
[`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) §21 — direção
registrada: `ReceiptLine`. **RAW-MATERIAL-EXTERNAL-ENRICHMENT foi DESCARTADO pelo PO em 2026-09-17**: a Matéria-prima
não é enriquecida por fonte externa (Open Food Facts, ANVISA), e não se abre item nem discovery; o porquê está no
histórico, e o uso para Produto é discovery futuro no ROADMAP ("Dados externos do Produto").

---

## Próximo gate

A ordem está na fila viva, no topo. Gate paralelo: a validação com a Veridi (#7, #11) vale só para as regras que
dependem do processo real do cliente, e não impede #8E, #8F e #8G quando o PO autorizar. Material pronto:
`Guia_Fluxo_Comercial_Veridi.docx` (não versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
