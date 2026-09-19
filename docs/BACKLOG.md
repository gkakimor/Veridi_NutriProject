# Backlog

O que está **aberto**. Nada mais.

Fechado não fica aqui: regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md), estado em
[`PROJECT_STATE.md`](PROJECT_STATE.md), discovery em [`discovery/`](discovery/README.md), onde cada regra é
protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) e o que já saiu deste arquivo em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md). Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) e não entra aqui sem decisão explícita do PO.

**Base:** reconciliado com o estado real em 2026-09-19 sobre `main` `c860e190` (PRODUCT-BACKLOG-CONSOLIDATION-01;
antes, em 2026-09-15, BACKLOG-RECONCILIATION-01); `main` declarada estável em `0d81aae` (MAIN-STABILITY-FAST-GATE-01,
2026-09-15). PROD em `release/prod` = `884a500d`, **v1.0.0** desde 2026-09-19, tags `v1.0.0` e
`prod-2026-09-19-v1.0.0` ([`RELEASES.md`](RELEASES.md)): nada integrado depois foi publicado — o pacote candidato da
v1.1.0 está [abaixo da fila](#veridi-nutrition-v110--candidata). As 2 falhas conhecidas da suíte web completa, que
existiam em `3159180` e `5b7c1a3`, fecharam na `main` em 2026-09-16, fora de PROD (WEB-SUITE-PREEXISTING-FAILURES-01:
3.657 testes, 0 falhas; entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A). Zero CRITICAL,
zero BLOCKER. O MVP foi entregue; o que está aqui é evolução do produto.

---

## Fila viva — a ordem, num lugar só

Reorganizada em 2026-09-19 (PRODUCT-BACKLOG-CONSOLIDATION-01) com a ordem dada pelo PO, sobre `main` `c860e190`. Só o
que está aberto: as linhas fechadas da fila anterior, e o texto das abertas como estava, foram para
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção "Saídos do BACKLOG em 2026-09-19". Um problema tem um
ID só; o detalhe mora no discovery ou na seção indicada, e a fila só ordena.

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 1 | P0 | **AUTHZ-VIEWER-READONLY-01** — VIEWER somente leitura e os perfis decididos por ato | Decidido pelo PO em 2026-09-19 (decisões 1–7 e 10 de [AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md), [resumo abaixo](#permissões-e-autoria--decisões-do-po)) · o relatório do discovery não ficou registrado: o inventário de rotas se refaz na `main` atual | Handoff do PO | — |
| 2 | P1 | **AUTHORSHIP-SESSION-ACTOR-01** — autoria nova pelo usuário da sessão e ator obrigatório no service | Decidido (decisões 8 e 9 do mesmo discovery) · sem backfill de "Ambiente local" · pode ir na mesma rodada do 1, se simples e seguro, como conceito separado | Handoff do PO | — |
| 3 | P0/P1 | **PENDING-PRODUCTION-LOT-ATTRIBUTION-01** — defeito F-1: com Plano misto (estoque + produção), a OP do saldo oferece e aceita produzir em dobro | Por leitura, sem teste (F-1 de [OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01](discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md), [resumo abaixo](#passagem-de-bastão-no-painel--decisões-do-po)) · correção proposta: produção atribuída por lote e uma função única para o DTO e a OP do saldo · sem migration | Reproduzir com teste vermelho e corrigir | — |
| 4 | P1 | **DOCUMENT-TRANSITION-CONCURRENCY-01 (Fatia 2)** — os P1 do discovery | Aberta · Pedido (aplicar plano e reservar × cancelar deixam reserva ACTIVE presa; confirmar × cancelar ressuscita o cancelado), Faturamento (emitir × cancelar, editar × emitir), confirmar e editar OC, Lote liberar × bloquear e os resíduos P1 confirmados — OP liberar × cancelar ficou coberto pela Fatia 1, sem teste dedicado ([discovery](discovery/DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md), seções 8 e 15) | Handoff do PO; o mesmo padrão da Fatia 1 | Fatia 1 (`ea5188e2`) |
| 5 | P1 | **PURCHASE-SUGGESTION-OWNER-SCOPE-01** — a Sugestão de Compra mede o disponível sem escopo de dono | Por leitura, sem teste · lateral de VERIDI-AUDIT-QUICK-FIXES-01 (seção A) | Reproduzir com teste vermelho e corrigir | — |
| 6 | P1 | **CLOSE-WITH-REASON-PO-01** — encerrar o saldo de OC com motivo | Decidido (fatia 1 de [CLOSE-WITH-REASON-DISCOVERY-01](discovery/CLOSE-WITH-REASON-DISCOVERY-01.md), [resumo abaixo](#encerrar-com-motivo--decisões-do-po)) · absorve o G5 do Painel Gerencial · **migration aditiva** | Handoff do PO | — |
| 7 | P1 | **CLOSE-WITH-REASON-OP-01** — encerrar OP sem produção | Decidido (fatia 2) · sem migration · permissão provisória ADMIN + PRODUCTION · leva P3a e P3b: OP concluída, com ou sem produção, não prende o cancelamento do Pedido | Handoff do PO | — |
| 8 | P1 | **CLOSE-WITH-REASON-RESERVATION-01** — liberar reserva de PA | Decidido (fatia 3) · sem migration · base da fatia do Pedido | Handoff do PO | — |
| 9 | P1 | **CLOSE-WITH-REASON-CO-01** — encerrar o saldo de Pedido | Decidido (fatia 4) · **migration aditiva** · inclui a trava das entregas (L7) | Handoff do PO | 8 |
| 10 | P1/P2 | **DASHBOARD-ORDER-NEXT-ACTION-01** — a próxima ação do Pedido no Painel: PA pronto para reservar, Pedido sem Plano, saldo sem produção | Decidido (F1 do discovery de passagem de bastão) · sem migration · suprime o "aguardando produção" redundante | Handoff do PO | 3 |
| 11 | P2 | **DASHBOARD-OP-READY-TO-RELEASE-01** — OP pronta para liberar | Decidido (F2) · sempre INFO, ordenada pela programação | Handoff do PO | — |
| 12 | P2 | **DASHBOARD-DELIVERY-DELAYS-01** — entrega atrasada e OP que termina depois da promessa | Decidido (F3) · comparação por dia civil; `requestedDeliveryDate` é a promessa implícita do Pedido sem entrega ativa | Handoff do PO | — |
| 13 | P2 | **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** — "Situação do lote: Vencido" deixa vazio o escopo do Novo inventário | Aberto (seção A) | Corrigir | — |
| 14 | P2 | **PERIOD-GUARD-R21-MATRIX-01** — guarda `periodo-invertido` vermelha na `main` desde o R-21 | Aberto (seção A) | Corrigir | — |
| 15 | P2 | **LOT-STATUS-FILTER-OVERLAP-01** — lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado" | Pede decisão: situação filtrada efetiva × gravada (seção A) | PO decide; depois corrigir | — |
| 16 | P2 | **DASHBOARD-EXPIRED-LIST-BALANCE-01** — o card de vencidos conta com saldo; o "ver todos" lista todos | Aberto (seção A) | Corrigir | — |
| 17 | P2 | **API-500-RAW-ERROR-01** — erro não traduzido volta 500 com a mensagem crua do Prisma | Aberto (seção A) · o tratador global já não recursa (API-GLOBAL-ERROR-HANDLER-01) | Corrigir | — |
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
(VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, 2026-09-19, só no chat), com a descrição de lá; os outros quatro pontos
do Top 8 estão nas linhas 1–2, 6–9 e 10–12 da fila.

**Fora da ordem de 2026-09-19** — abertos com posição na fila anterior, que esperam decisão ou handoff:

| Item | Estado | Próxima ação | Quem |
|---|---|---|---|
| **FORMULATION-WORKBENCH-01** — Formulação como bancada interativa | **EM HOMOLOGAÇÃO** · publicada em PROD em 2026-09-16 · histórico em [`PROJECT_STATE.md`](PROJECT_STATE.md) | Avaliação visual do PO; o fechamento depende de aprovação explícita | PO |
| **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; a 4A pode começar | PO fecha P2–P8 ([abaixo](#wave-4--decisões-ainda-reais)) | PO |
| **INVENTORY-PHYSICAL-COUNT-01** — Inventário Físico em sessões | Fatias 1, 2A e 2B entregues: o ciclo pela tela está completo | Fatia 3 — FO-01 de sessão e CSV; INVENTORY-CONFIRMATION-AFTER-DECISION-01 espera o PO ([abaixo](#inventário-físico--status)) | PO |
| **PRODUCTION-PERMISSION-HARDENING-01** — perfil final de quem executa a OP | Discovery `EM_ANALISE` · o VIEWER, a autoria, P3, P4 e P8 saíram para as linhas 1 e 2 em 2026-09-19; até o perfil final, vale o provisório "todos menos VIEWER" | Veridi responde P1 e P6 ([abaixo](#permissões-da-produção--status)) | Veridi |
| **E2E-BASELINE-REDESIGN-WAVE-05** — golden path | Discovery `EM_ANALISE`; vem depois da WAVE 4 | PO fecha Q3 e as demais ([abaixo](#golden-path-wave-5--status)) | PO |
| **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando a WAVE 4, as permissões da Produção e a WAVE 5 fecharem | PO |
| **DEMO-DATASET-01** — ambiente DEMO com massa fictícia determinística | **AGUARDANDO DEFINIÇÃO DO PO** · nada criado: sem ambiente, sem `release/demo` | Massa fictícia determinística + reset protegido para um futuro ambiente Railway DEMO, e o fluxo `main` → `release/demo` → aprovação → o MESMO SHA em `release/prod` | PO |

**P3** — LOW e UX realmente abertos, sem posição: tabelas da seção A (a partir de "LOW e UX da triagem"), fora os que
ganharam posição na fila acima; seção D e watchlist (E). A estabilização final é o lugar natural para varrê-los.

**Abertos fora da fila**, cada um esperando decisão própria — nenhum sobe sem o PO:

| Item | Por que não está na fila | Onde |
|---|---|---|
| **CUSTOMER-MASTER-DATA-AUDIT-01** — histórico de antes/depois do cadastro do Cliente (P2) | Futuro, registrado em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01); avaliar antes de construir | G |
| **MASTER-DATA-STRUCTURAL-LOCKS-01** — travas estruturais do cadastro mestre além de `operationallyUsed` | Registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); pergunta de produto antes de construir | G |
| **MASTER-DATA-STATUS-HISTORY-01** — motivo e histórico de Inativar/Reativar de Item, Fornecedor e Produto (P2) | Futuro, registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); exigiria migration | G |
| **SUPPLIER-ITEMS-UX-01** — Fornecedor → Itens fornecidos administrável no cadastro do Fornecedor (Fatia 2) | D4 do PO em 2026-09-16: capability separada, não implementar agora. A Fatia 1 (Item) fechou em ITEM-SUPPLIER-UX-01. Espera o handoff do PO | G |
| **ATTACHMENTS-R2-MIGRATION-01** — anexos genéricos (`Attachment`) no adaptador de storage e no R2 (P2) | Futuro, registrado em 2026-09-16 (LABEL-ATTACHMENTS-01); avaliar se ainda faz sentido | G |
| **LABEL-FILE-SUBTYPE-CHANGE-01** — Item Rótulo com versões pode trocar de subtipo e a seção some (LOW) | Registrado em 2026-09-16 (LABEL-ATTACHMENTS-01), sem posição: é pergunta de cadastro mestre | G |
| **ASSISTED-ENTITY-SELECTOR-ROLLOUT-01** — consulta assistida nos demais seletores (Cliente, Fornecedor, Produto, Lote e outros) | Registrado em 2026-09-17 (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01): expandir só depois de validar o piloto Item com a Veridi. A seleção múltipla já existe (ASSISTED-ENTITY-MULTISELECT-01). Espera o handoff do PO | G |
| **COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01** — linha de recurso sem uso por lote não vai no "Salvar rascunho" do Modelo de Estrutura (LOW) | Registrado em 2026-09-17 (ASSISTED-ENTITY-MULTISELECT-01): anterior à rodada, mais visível com "+ Adicionar recursos". Pergunta de UX antes de mexer | G |
| INACTIVE-MARKERS-REPORTS-01 (opcional) — última fatia do cadastro inativo | Registrada em 2026-09-17 com o discovery. As Fatias 1 a 4 fecharam no mesmo dia (INVENTORY-INACTIVE-ITEM-VISIBILITY-01 §107, PRODUCT-INACTIVE-COMMERCIAL-GATE-01 §108, SUPPLIER-ITEM-INACTIVE-GATE-01 §112 e PRODUCTION-INACTIVE-COMPONENT-GATE-01 §116). Só D9 (R-18 abre em "Todos", com a situação) tem recomendação e espera o handoff do PO | [discovery](discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md) |
| **ITEM-DUPLICATE-SANITIZATION-01** — grupos restantes (2 no DEV: G6 café verde e G11 fosfato de piridoxal) | Ondas 2 (§118) e 3 (§124) resolveram os demais no DEV. G6 e G11 esperam a Veridi: significado de `*`/`**` (V4), teor de clorogênico e as cotações FLORIEN (V1). Registrado em 2026-09-17 com a Onda A | [discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **ITEM-NAME-STANDARDIZATION-01** — nome do Item MP/ME em MAIÚSCULAS e único sem caixa | Parado em 2026-09-17 no passo de duplicidade: o índice único não nasce enquanto houver grupo repetido (2 no DEV depois da Onda 3; PROD não saneado). Retomar depois das ondas, recontando no DEV e em PROD | [discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **OPS-BACKUP-01** — backup agendado de PROD (HIGH) | Snapshot do Railway recusado e PITR desligado; o backup lógico JSON é restaurável e provado. Rotina agendada é decisão de infraestrutura | A |
| COST-VAR-02 — variação de CMV e proteção de margem | Bloqueado: sete decisões do PO e dado real em produção | [`archive/COST-VAR-01…`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) |
| #8E, #8F, #8G · PLAN-DATE-01 · UX-HELP-03 | Melhorias aguardando autorização | B, E |
| #7, #11 | Gate com a Veridi | C |
| SUPPLIER-OFFER-OVERLAP-01 · COM-CONTRACT-01 · SUPPLIER-MODE-01 · ASSET-01 | Discovery sem pergunta decidida | G |
| **FINISHED-GOODS-OWN-LOT-PREFERENCE-01** — preferir o lote produzido para a própria linha do Pedido (opcional) | Pendente em 2026-09-19 e não decidido: muda a política de alocação (hoje FEFO, sem olhar o dono do lote de PA) | [discovery](discovery/OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md) |
| Achados preservados na consolidação de 2026-09-19 — qualidade × lote reservado, custo histórico, perda esperada × operacional, OP com perda total, retorno de cliente e fornecedor, material equivalente, vida útil mínima por cliente, políticas definitivas por área | Sem posição; a maioria depende da Veridi | C |

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
`9c60845` e persistido sobre `6256ca9` sem ser refeito. O documento histórico não muda.

**Resolvido por estado posterior:**

- **P1** (WAVE 3 era só o fluxo do Orçamento ou também o grupo C?) — a WAVE 3 foi entregue em `6256ca9` (2026-09-15)
  como o fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01); o grupo C é da WAVE 4 ([`PROJECT_STATE.md`](PROJECT_STATE.md),
  "Próxima prioridade"). Com isso a 4A, a 4B e a 4F ficam prontas pelo próprio discovery.
- **Espera da 4E pela WAVE 3 na `main`** — satisfeita em `6256ca9`. Antes da 4E, reconferir as fixtures comerciais que
  a WAVE 3 criou (`scripts/e2e/fixtures/comercial.mjs`, `comercial-ui.mjs`), que o discovery não auditou.

**Ainda reais** (cada uma com recomendação no discovery):

- **P2** — Pedido + Confirmar + Plano por API na disponibilidade e em entregas/expedição (a ajuda já é API e o
  cancelamento, tela).
- **P3** — nome da suíte fundida de entregas e expedição, e remoção dos dois arquivos antigos.
- **P4** — um PA de 20 un para os dois cenários, ou um `produzirPa` por cenário.
- **P5** — pureza e overage da massa própria (98 % e 5 %, registrados e não aplicados), sem cenário novo.
- **P6** — ajuda: Orçamento pela página da versão ou pela ficha do Projeto; Formulação pelo detalhe do produto ou
  pela versão; checagem de 390 no Pedido.
- **P7** — OP fora da 1ª página com o roteiro padrão do produto (`PUT`) em vez de aplicar roteiro na OP.
- **P8**, reformulada — a premissa "sem helper da WAVE 3" caiu (`fixtures/comercial.mjs` está na `main`). Resta
  decidir se o desconto digitado no Orçamento faz parte da prova, ou se entra por API e só envio → faturamento fica
  na tela.

Absorve E2E-CORPUS-MASS-01: o que sobrava dele (grupo C e a suíte de `PROD-000214`) são suítes alvo desta wave.

### Inventário Físico — status

**PO BASELINE APROVADA** (INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, seção G; `04d97ad`, merge `9b011aa`).
**Discovery INVENTORY-PHYSICAL-COUNT-DISCOVERY-01: `DECIDIDO`** — D1–D8 e P1–P7 fechadas pelo PO em 2026-09-15
(opção F de concorrência, recontagem opcional, sem tolerância, ADMIN/PRODUCTION/QUALITY contam e aprovam), documento em
[`discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md`](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md).
**Fatia 1 entregue em 2026-09-15** (INVENTORY-PHYSICAL-COUNT-01): domínio, schema e API das sessões, e a Contagem rápida
gravando `INV-` QUICK. **Fatia 2A entregue em 2026-09-16**, sobre o discovery das telas
(INVENTORY-PHYSICAL-COUNT-UI-DISCOVERY-01, addendum do documento, DU-1 a DU-6): as telas contam até Em revisão.

**Fatia 2B entregue em 2026-09-16** (INVENTORY-PHYSICAL-COUNT-01, na `main` e fora de PROD, sem migration): revisão com
recortes e seleção por id, recontagem pedida e contada pela tela de contagem, Ajustar/Não ajustar com motivo e
confirmação de movimentação marcada à mão (com os movimentos da posição), encerramento com a consequência por unidade e
os ajustes vistos conferidos pelo servidor (`stock_count_changed`), recusa por posição com recontar/redecidir/voltar à
revisão, Contagem rápida pela prévia (retenção antes do saldo, `expectedSystemQuantity`, `Decimal`, `INV-` no
resultado), aba Contagens rápidas com o resultado, `INV-` em Movimentações, R-03 e CSV, e filtros de local, situação e
validade no Novo inventário. Decisões do PO da rodada: sem endpoint de pré-checagem do encerramento (tenta e mostra a
recusa); só a última decisão e a última recontagem ficam gravadas; histórico completo delas não agora.

**Ainda aberto do assunto** (nenhum bloqueia o ciclo pela tela):

- **INVENTORY-CONFIRMATION-AFTER-DECISION-01** (P2, pede decisão do PO — toca quantidade): a confirmação de movimentação
  vale para sempre na posição. Movimento lançado DEPOIS da decisão — inclusive um lançamento retroativo — não pede nova
  confirmação, e o encerramento aplica a diferença congelada; recontagem (rodada ≥ 2) também dispensa a confirmação para
  movimentos lançados depois dela. Achado na Fatia 2B, lendo `completeStockCount`; não corrigido (regra de domínio da
  Fatia 1). Proposta: confirmação vale até o instante da decisão, e movimento posterior volta a pedir;
- adicionar posição em revisão pela tela (a API aceita e responde sem saldo a quem conta; a tela só oferece em contagem);
- filtros "última contagem" e "movimentação" do montador (o PO pediu só os que entregam valor agora: local, situação e
  validade entraram); retenção leve;
- histórico completo de decisões e recontagens por posição (hoje só a última) — decisão do PO: não agora;
- conferência visual em navegador da revisão e dos diálogos em 390px (a rodada foi validada por testes de tela; o PO
  vetou Playwright nela).

Depois: Fatia 3 (FO-01 de sessão e CSV controlado). Regularização de material sem lote (P7), inventário cíclico, scanner
dedicado e localizações seguem FUTURO.

### Painel Gerencial — status

**Versão 1 entregue em 2026-09-15** (MANAGEMENT-DASHBOARD-V1-01, Gestão → Painel Gerencial): D1–D5 decididas e
aplicadas, e o faturado sai de `billings/billed-value.ts`, nunca de conta própria. O encerramento de saldo de OC
parcialmente recebida (G5) virou CLOSE-WITH-REASON-PO-01 em 2026-09-19 (fila, linha 6); o "a receber de fornecedores"
em R$ fica viável depois dele, como opcional. Continuam abertos, sem posição e sem promoção: preço acordado em Pedido
digitado direto (G2); lista de Pedidos por data de confirmação (G4 residual), sem a qual o cartão "Pedidos confirmados"
fica sem link. Evolução do discovery (seção 10.3), só com pedido do PO: recebido a custo
efetivo, compras por fornecedor, propostas em aberto, margem contratada, bloco de Compras para PURCHASING, atalho no
Painel Operacional e PDF do painel. Fora do produto: contas a pagar, contas a receber, caixa e margem realizada.

### Permissões da Produção — status

Capability própria, [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md).
**Não está resolvida porque as E2E rodam como ADMIN** (decisão G): isso só tira os perfis das E2E, não fecha a API.

**Desde 2026-09-19 o item ficou só com o perfil final de quem executa a OP.** As decisões de
[AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md) levaram o resto: o VIEWER
de I1 vai para AUTHZ-VIEWER-READONLY-01 (fila, linha 1); a autoria de I3 e I7 para AUTHORSHIP-SESSION-ACTOR-01 (linha
2); P3 respondida (Plano, OP do saldo, reservar e realocar PA com ADMIN + COMMERCIAL); P4 respondida (os "Ambiente
local" antigos ficam, sem backfill); P8 absorvida pelas duas. Até o perfil final, a execução da OP segue o provisório
"todos menos VIEWER".

- **Bloqueiam o perfil final (Veridi):** P1 — quem executa a OP (picking, consumo, pesagem, parte, apontamento,
  variância, conclusão; recomendado: só ADMIN + PRODUCTION); P6 — os operadores da Veridi entram com conta PRODUCTION
  própria.
- **Com recomendação, sem bloquear:** P2 (variância), P5 (botões de estoque que já dão 403), P7 (autoria em texto ×
  `userId`).
- **Armadilha preservada:** I6 — `ForbiddenError` não mapeado em `picking`/`production`/`recipe` (um `requireRole` novo
  responde 500); vale já para AUTHZ-VIEWER-READONLY-01.

### Golden path (WAVE 5) — status

[WAVE-05-GOLDEN-PATH-DISCOVERY-01](discovery/WAVE-05-GOLDEN-PATH-DISCOVERY-01.md). Vem **depois da WAVE 4**.
`private-label-golden-path.mjs` não mudou desde `9c60845`: F-01 (quebra em `pedido`) e F-02 (quebra em
`sugestao-compra`) seguem valendo.

**Resolvido por estado posterior:**

- **Q5** (escopo das WAVE 3 e 4; esperar o merge da 3) — WAVE 3 = fluxo do Orçamento, mergeada em `6256ca9`; WAVE 4 =
  grupo C; o golden path vem depois da 4.
- **B1** (WAVE 3 em paralelo no trecho comercial) — deixou de ser bloqueio de processo. Sobra reconferência técnica do
  trecho comercial e do runner contra a `main`, sem decisão do PO.

**Ainda reais:** **Q3** (bloqueante — opção B do runner: repassa `--run`/`--desde`, exige `--clone`, checkpoint na
pasta do clone); Q1 (cadastros pela tela ou API), Q2 (pedido direto sai), Q4 (clone mantido na reprovação), Q6
(`orcamento`/`pedido` em quatro etapas), Q7 (diálogo de pendências na estrutura mínima), Q8 (asserções R/N), Q9
(roteiro padrão no Produto ou na OP), Q10 (commit diferente na retomada).

Absorve CUSTOMER-LIST-DEFAULT-E2E-01: o que sobrava dele é o golden path procurar Cliente pela lista padrão.

### Estabilização final — status

Depois da WAVE 4, das permissões da Produção e da WAVE 5. Sem ID e sem escopo; nasce quando os três fecharem. Entradas
naturais: os LOW e UX da seção A, a seção D e a watchlist.

---

## A. Defeitos abertos

Triados em 2026-09-07 sobre a auditoria de produto. Evidência, passos e
conferência numérica ficam em [`archive/E2E_AUDIT_2026-09-07.md`](archive/E2E_AUDIT_2026-09-07.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

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

**F-01-1 e F-07-2 foram rebaixados**: os dois números estão certos para o que
representam — `Project.productId` (produto resultante) contra `project_products`
(produtos em desenvolvimento), e "disponível incluindo a reserva desta OP"
(`requirement-availability.ts:44`) contra disponível global. O defeito é o
rótulo, não o dado. **F-07-2 foi fechado no FIX-05** por isso mesmo: só o rótulo
mudou.

**F-06-3 foi elevado de observação a defeito**: o padrão correto já existe em
`products.service.ts:314`, com comentário nomeando exatamente este problema —
`nextSequenceCode(tx, …)` como primeira linha **dentro** da transação.

### LOW e UX — achados das entregas posteriores

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-01-3** | "Consulta completa" só é alcançável de dentro do modal de edição | UX | S |
| **QUOTE-VERSION-SWITCH-DIRTY-01** | Abrir outra versão com condições pendentes descarta o rascunho sem aviso — mantido de propósito em QUOTE-DRAFT-STATE-01. Só existe um rascunho por projeto e as outras versões são somente leitura; avisar, salvar ou descartar é decisão do PO | UX | S |
| **QUOTE-CASH-HIDDEN-DIRTY-01** | Parcela ou intervalo digitado no Parcelado e escondido pela troca para À vista conta como alteração pendente; salvar grava à vista sem parcelas (o servidor limpa), a releitura não muda o gravado e a pendência fica: "Alterações não salvas" e envio preso até "Descartar alterações". Por leitura de código, desde QUOTE-DRAFT-STATE-01 — antes da correção, o mesmo com `NaN`. Decidir se campo escondido conta como pendência | UX | S |
| **PTBR-NUMERIC-DISPLAY-RESIDUAL-01** | Resíduo consciente de PTBR-NUMERIC-DISPLAY-AUDIT-01: inteiros pequenos dentro de frase sem `formatIntegerPtBr` ("Página X de Y", "Preço incompleto (3/5)", produtos e lotes da conferência da Expedição) — só passam de 999 em volume irreal; a guarda estrutural não enxerga variável solta nem ternário (`: row.onOrder`), só a busca manual; e uma quantidade inteira exibida `1.234`, colada num campo decimal, é recusada como ambígua (a mensagem diz como escrever) | UX | S |
| **OP-PARTS-ZERO-COERCION-01** | "Dividir produção em" vazio ou `0` vai à API como 1 em silêncio — `Number(x) \|\| 1` herdado, preservado no rollout como `partesParaEnvio` para não mudar o payload. A API recusaria `0` com "A produção tem ao menos 1 parte"; decidir se zero volta como erro no campo | UX | XS |
| **NUMERIC-FOCUS-API-ZEROS-01** | Preço e custo de 8 casas que a API serializa com `toFixed` (`12.50000000`) aparecem `12,50` fora do foco e `12,50000000` no foco: `toPtBrEditText` preserva os dígitos, como manda a foundation. Tirar os zeros não significativos na carga mantém o payload semanticamente igual e muda a representação enviada ao salvar sem editar — decidir | UX | XS |
| **FORM-UOM-FK-01** | FK física em `FormulationTemplateComponent.unitCode` → `UnitOfMeasure`. A regra já vale sem ela — tela controlada, API fail-closed, ativação reconferida (FORM-UOM-01) —, e a auditoria somente leitura achou DEV 13/13 e PROD 7/7 componentes com unidade do catálogo e compatível: a migration seria trivial. Recomendada como endurecimento físico, **só com autorização do PO** | LOW | XS |
| **FORMULATION-ITEM-SWAP-UOM-01** | Na Formulação real, trocar o Item de um componente sempre põe a unidade de estoque do Item novo, mesmo quando a escolhida serve: `500` em `mg` vira `500` em `kg`, sem conversão nem aviso — e, antes do Item, a lista oferece o catálogo inteiro. O Modelo (FORM-UOM-01) mantém a unidade compatível e espera o Item; alinhar a Formulação é decisão do PO | UX | S |
| **API-500-RAW-ERROR-01** | Erro do Prisma que nenhuma rota traduz volta como 500 com a mensagem crua — a chamada, o trecho do código e o caminho do arquivo no servidor (visto com a chave estrangeira da unidade da base antes de FORM-UOM-01). Pede tradução genérica no handler global, sem vazar detalhe interno. Entre `f3a4c666` e API-GLOBAL-ERROR-HANDLER-01 a recursão do tratador escondia a mensagem por acidente (todo 500 dizia "Maximum call stack size exceeded"); corrigida a recursão, o 500 volta a trazê-la — segue aberto | LOW | S |
| **TZ-DST-MIDNIGHT-GAP-01** | No dia em que o horário de verão começa à meia-noite — o jeito do Brasil até 2019: em 04/11/2018 o relógio foi de 00:00 a 01:00 —, as duas passadas de `meiaNoiteComercial`/`instanteComercial` (`packages/shared/business-timezone.ts`) medem o deslocamento já de verão e voltam uma hora: `limitesDoDiaComercial("2018-11-04").inicio` é `02:00Z`, 23:00 de 03/11, o fim de 03/11 é `01:59:59.999Z`, e `instanteComercial("2018-11-04", 0..59)` cai em 03/11 às 23h. `diaCivil` diz 03/11 para esses instantes: filtro por período e dia comercial discordam nessa hora. O fim do verão (16/02/2019, 25 horas) sai certo. Só histórico hoje; volta se o horário de verão voltar. Anterior à TZ-FORMATTER-REUSE-01, que o manteve idêntico de propósito — corrigir muda o resultado de data | LOW | S |
| **R20-SENT-PRICING-BASIS-SNAPSHOT-01** | O envio do Orçamento congela na linha custo do cálculo, qualidade dele, margem e markup (`buildProvenanceSnapshot`), mas não o custo p/ preço, a qualidade dele nem o Modelo de Precificação. O R-20 da linha enviada diz "Não congelado no envio" em vez de deduzir do vínculo com a faixa (REPORT-ROBUSTNESS-WAVE-01). Fechar pede migration aditiva em `QuoteLine` — decisão de schema do PO. Proposta: `pricingCostPerUnitSnapshot Decimal(24,12)?` e `pricingCostQualitySnapshot IndustrialCostQuality?` copiados da faixa, e o Modelo copiado da versão (as nove colunas nulas de `PricingVersion`, ou `pricingModelSnapshot Json?`), preenchidos no envio; sem backfill — nulo continua "Não congelado no envio" | LOW | M |
| **R20-MANUAL-REFERENCE-MARGIN-01** | A conferir: linha de preço manual ou herdado enviada congela como referência a proveniência da faixa ativa da mesma quantidade (`faixaEquivalenteVigente`), e com ela `contributionMarginSnapshot` da faixa — margem calculada sobre o preço da faixa, não sobre o `unitPrice` da linha. O R-20 mostra essa margem na linha, ao lado do preço manual. Visto na leitura de REPORT-ROBUSTNESS-WAVE-01, sem reproduzir nem mudar | LOW | S |
| **QUOTE-NEW-VERSION-PATHS-01** | Dois caminhos criam versão com efeitos diferentes: "Criar nova versão"/"Novo orçamento" parte da mais recente, herda sozinho o preço do caso seguro de §74 e substitui a enviada; "Duplicar como nova versão" parte da escolhida, pergunta o preço e não substitui nada. O PO decide se os dois convergem (achado de QUOTE-DUPLICATE-01, registrado como P2) | UX | — |
| **QUOTE-DUPLICATE-ORIGIN-01** | A versão duplicada não guarda de qual nasceu: a linha com preço mantido diz no motivo; com "revisar", nada fica. Coluna de origem exigiria migration (achado de QUOTE-DUPLICATE-01) | UX | — |
| **CUSTOMER-FACTS-LOAD-01** | Watch: listagem e exportação de Clientes carregam, para cada Cliente da página, os Projetos com o histórico de status e os Pedidos confirmados. Número de consultas constante; volume de linhas cresce com a história. Medir com volume real (achado de CUSTOMER-COMMERCIAL-STATUS-01) | LOW | — |
| **QUOTE-SUGGESTION-390-01** | Em 390px a frase "Existe uma precificação vigente…" da linha do Orçamento fica cortada dentro da tabela rolável (já cortava o preço; a explicação de F-05-1 alonga a frase). Conferido no código em 2026-09-15: a frase segue em `QuoteWorkspace.tsx` | UX | — |
| **LISTS-CUSTOM-PERIOD-PAGE-RESET-01** | "Personalizado" clicado fora da página 1 (Faturamento, Recebimentos, OC, Produto Acabado) volta para a página 1 do MESMO recorte e consulta uma vez: semear grava `period`/datas na URL, e `useListFilters.set` sempre volta à página 1. Existe desde FILTER-FOUNDATION-01. Decidir se abrir o Personalizado é trocar filtro | UX | — |
| ~~**FORMULATION-PRINT-ADJUSTMENTS-01**~~ | **ABSORVIDO por FORMULATION-TECHNICAL-SHEET-PDF-01 (2026-09-15).** O achado era que nenhum impresso lia a pureza, a reserva (o antigo *overage*) nem o físico por unidade da Formulação. A Ficha Técnica do Produto lê os três direto da VERSÃO — pureza aplicada com nota quando o cadastro divergiu desde então, reserva por linha e "Por embalagem" na unidade de estoque — e diz "não aplicada" quando a versão histórica registrou pureza sem autorizar a correção, que é o que o modo da quantidade significa no papel. Fora da Formulação (Folha de Receita, OP, CMV, Cálculo) o achado do PDF-DOCUMENT-SYSTEM-01 segue como está: aqueles DTOs não trazem os ajustes, e levá-los é decisão de outro item | UX | — |
| ~~**FORMULATION-TEMPLATE-BASIS-EDIT-01**~~ | **ABSORVIDO por FORMULATION-TEMPLATE-WORKBENCH-01 (2026-09-16).** O achado era a falta de seletor de base na linha do Modelo. A base deixou de ser um campo genérico a oferecer: ela é consequência da SEÇÃO — embalagem conta por unidade acabada, composição conta por dose quando a receita é por dose (`baseSugeridaDaSecao`, `packages/shared`) —, e a fatia 1 já a sugere na linha nova pelo tipo real do Item. A linha que já declarou base não é tocada, e `FIXED_BASIS` continua existindo: matriz histórica escrita sobre a base continua sobre a base. O acabamento visual das duas seções é da fatia 2. Superado em 2026-09-17 por FORMULATION-COMPONENT-BASIS-AUTOMATION-01: a base de toda linha de rascunho é derivada e o seletor saiu (§106) | UX | — |
| **UI-NUMERIC-FIELD-STANDARD-01** | Aplicar ao sistema inteiro o padrão de campo numérico homologado na Formulação: caixa compacta, borda única, canto arredondado, número à direita, pt-BR, setas de incremento/decremento respeitando a última casa escrita e limites conforme o domínio. Pedido do PO em 2026-09-16, registrado sem implementar: é varredura de tela por tela, e entra na estabilização final (10) ou numa rodada própria | UX | — |
| **ATTACHMENT-ACTIONS-BY-ROLE-01** | Documentos de Lote, Recebimento, Projeto e Amostra (`AttachmentsSection`) oferecem anexar e "Arquivar" a todo perfil, mas a API só aceita anexar com a lista do contexto (Lote e Recebimento: Compras, Qualidade e ADMIN; Projeto: Comercial, Qualidade e ADMIN; Amostra: também Produção) e arquivar com Qualidade e ADMIN — o clique termina em 403. O Produto já passa `canUpload`/`canArchive` pelas listas de `@veridi/shared` desde MASTER-DATA-EDIT-PERMISSIONS-01; levar o mesmo às outras quatro telas pede as listas dos contextos no shared | UX | S |
| **NAV-TWO-SEARCHES-01** | Convivem "Buscar ou escanear lote" no topo e "Buscar telas…" na coluna; unificar é assunto da busca global de registros. Conferido no código em 2026-09-15: as duas seguem | UX | — |

### Achados laterais de VERIDI-AUDIT-QUICK-FIXES-01 (2026-09-19)

Vistos na rodada que corrigiu D1–D6, fora do escopo dela: registrados, não corrigidos. Desde 2026-09-19 os cinco têm
posição na fila viva (linhas 5 e 13–16).

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **PERIOD-GUARD-R21-MATRIX-01** | A guarda `lib/periodo-invertido.test.ts` ("o par de cada CSV é o da família") está vermelha na `main` desde o R-21 (INTERNAL-CONSUMPTION-REPORT-01, `50ee85a8`): o CSV `/reports/inventory/internal-consumption` tem o par `from`/`to` e não está em `FAMILIAS`. Reproduzido na base `83fa171e` (1 falha, 230 passam). Falta a família do R-21 na matriz — e, com ela, a prova de que o período invertido é recusado nesse CSV | LOW | XS |
| **PURCHASE-SUGGESTION-OWNER-SCOPE-01** | Por leitura, sem teste: a Sugestão de Compra mede o disponível das necessidades da Veridi com `getAvailableByItems` sem escopo de dono (`buildPurchaseSuggestion`, `purchase-suggestion.service.ts`), então estoque de cliente reduz a falta e a compra sugerida de material da Veridi. Mesma classe do D4; o material do cliente já usa o escopo certo | MEDIUM | S |
| **STOCK-COUNT-EXPIRED-STATUS-FILTER-01** | Novo inventário: a "Situação do lote" oferece "Vencido", que vira `status in [EXPIRED]` — nunca gravado —, e o escopo sai vazio. O filtro "Validade: Somente vencidos" funciona. Mesma raiz do D1, deixada de fora porque o escopo é reconferido no encerramento | LOW | S |
| **LOT-STATUS-FILTER-OVERLAP-01** | Os filtros "Liberado", "Aguardando liberação" e "Bloqueado" seguem o status gravado e listam lote vencido com o selo "Vencido"; desde o D1 o lote vencido gravado como Liberado aparece em "Vencido" e em "Liberado". Decidir se a situação filtrada é a efetiva — mexe na fila "Liberação de lotes" | UX | S |
| **DASHBOARD-EXPIRED-LIST-BALANCE-01** | O card LOT_EXPIRED conta lote vencido COM saldo; o "ver todos" abre Lotes com todos os vencidos, zerados inclusive, e a lista não tem filtro de saldo | UX | XS |

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

Golden path private label pela interface, numa base recriada do zero. Dois
bloqueios apareceram e foram corrigidos na própria rodada: o catálogo de
unidades só existia onde alguém tinha rodado seed (instalação nova nascia sem
unidade nenhuma), e RECEIPT-BUSINESS-DAY-01 (todo lote recebido pela interface
levava a véspera no código). O que sobrou não bloqueia o fluxo. A fila viva
ficou congelada durante a rodada: posição destes itens é decisão do PO.

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **OPS-BACKUP-01** | Backup de produção: snapshot manual pela API do Railway recusado (`Not Authorized` — plano ou papel da conta), PITR desligado, nenhuma rotina agendada. O backup desta rodada é o lógico JSON (`prod-backup-json.mjs`), com restauração provada linha a linha por `restore-json-backup-check.mjs`. É o item "Backup do banco" de `DEPLOY.md` §7, que bloqueia operação de verdade. Desde BACKUP-RESTORE-CHECK-01 (2026-09-14) a prova concilia a referência que as migrations gravam (as 6 unidades) em vez de colidir na chave: o backup da carga inicial restaurou 687 linhas idênticas | HIGH | S |
| **TEMPLATE-PURITY-LEGACY-DATA-01** | Desde INPUT-DATE-CONTRACT-WAVE-01 o Modelo recusa pureza 0 ou acima de 100. Modelo gravado antes com esses valores continua lido, mas salvar a versão em rascunho sem corrigir a linha passa a dar 400 com a mensagem da pureza. Não conferido em PROD (sem leitura de produção nesta rodada): contar `formulation_template_components` com pureza `<= 0` ou `> 100` | LOW | XS |
| **COST-MP-EMB-SPLIT-01** | Nem a estimativa da Formulação nem o CMV mostram matéria-prima e embalagem em subtotais separados — o cálculo soma "Materiais e embalagens Veridi" numa linha (`CostBreakdown.tsx`). O total está certo; a separação sai somando pelo código MP-/ME- | UX | S |

### Achado estrutural, sem item próprio

Existem **três implementações independentes** da conta "quantidade por base":
`packages/shared/src/formulation-quantity.ts` (`fatorDaBase`),
`apps/api/src/lib/formulation-math.ts` (`basisFactor`, reimplementado à mão) e o
`convertUomDecimal` cru usado como se fosse a conta. O comentário do próprio
pacote compartilhado diz que isso é o que o domínio proíbe: *"duas contas para o
mesmo número acabam discordando, e a que aparece na tela seria a que ninguém
usa."* G2 (grupos de causa raiz, hoje em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md)) é o primeiro sintoma; consolidar os três motores é candidato a
capability própria, não a correção de finding.

---

## B. Melhorias aprovadas — aguardando autorização do PO

### 8. Cálculo ao vivo nas demais telas

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Já no padrão: Ordem de Compra, Expedição,
Precificação, Faturamento, Formulação, CMV e a prévia de política de preço
(#8A–#8D, #8H). Regra durável de prévia × gravado:
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54.

| Item | Tela | Escopo | Prioridade |
|---|---|---|---|
| **#8E** | Recebimento | Custo efetivo: total e comparação com o custo previsto quando aplicável | LOW |
| **#8F** | Ficha de Pesagem | Mostrar a diferença antes da confirmação | LOW |
| **#8G** | Ordem de Produção | Mudar a quantidade planejada não atualiza a prévia das necessidades até salvar. **Auditar antes**: nenhum cálculo vivo pode mutilar OP já congelada | A AUDITAR |

Também no radar, sem item próprio: Contagem de Estoque e Reservar ↔ Produzir
calculam ao vivo mas ainda sem `CalcHint`; Custo Industrial e impacto de
materiais do Pedido ficam em branco até apertar botão, sem dizer que o valor é
do que está salvo.

### 9. OPS-CALENDAR-01 — ABSORVIDO por PLANNING-CALENDAR-01 (2026-09-12)

Fechado sem virar item próprio: o calendário global existe em Planejamento → Calendário de Produção. O
registro original e o que ficou de fora estão em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md). Segue aberto só o discovery separado: se o mesmo
calendário global vale para prazo de planejamento de COMPRA.

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
- permissões detalhadas por papel — o cadastro mestre já tem decisão do PO (Cliente §98; Item, Fornecedor e
  Produto §100); em 2026-09-19 o PO decidiu Pedido e entregas, OC, rascunho de OC pelo Pedido, Plano, OP do saldo,
  reserva de PA e preço de faturamento, com o provisório "todos menos VIEWER" onde a Veridi não definiu o perfil final
  ([AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](discovery/AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)); a execução da Produção
  tem discovery próprio (PRODUCTION-PERMISSION-HARDENING-01, perfil final com a Veridi);
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção — Cloudflare R2 aprovado pelo PO em 2026-09-16 e **ativo em PROD
  desde 2026-09-17** para o arquivo do Item Rótulo (§103; STORAGE-R2-ACTIVATION-01, [`DEPLOY.md`](DEPLOY.md) §6.1).
  PROD usa o bucket de homologação (`veridi-homologacao`): bucket próprio é decisão do PO. Levar os anexos genéricos é
  ATTACHMENTS-R2-MIGRATION-01 (seção G).

### 11. Material do cliente — lote do fabricante e validade por configuração do Item — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita confirmar com "Lote do
fabricante" e "Validade" em branco; o recebimento de OC exige os dois quando o
item controla lote e validade. Não existe regra canônica para dizer quando
material fornecido pelo cliente exige lote do fabricante, validade ou
rastreabilidade adicional.

**Decisão de PO:** não assumir que todo Item exige validade. A solução futura
considera regra/configuração por tipo ou por Item — hipótese de modelagem:
"exige lote do fabricante" e "exige validade" —, mas defaults e obrigatoriedade
operacional precisam ser validados com a Veridi. Relacionado ao #7.

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

### ~~FORMULATION-LOSS-SCOPE-01~~ — a cápsula vazia entra na perda prevista — FECHADO em 2026-09-15

Decisão do PO (2026-09-15): **entra**. A perda prevista é perda do PROCESSO para
alcançar a quantidade líquida vendável, então recebe o fator quem é consumido
proporcionalmente à quantidade BRUTA que entra no processo — matérias-primas,
ingredientes e a cápsula vazia. A embalagem comercial (pote, tampa, rótulo,
cartucho, caixa de embarque, dosador) continua na quantidade vendável.

A auditoria confirmou o que o registro anterior suspeitava: nenhum atributo do
domínio separava "embalagem consumida na produção" de "embalagem comercial" —
`packagingSubtype` enumera pote, tampa, rótulo, cartucho, caixa e dosador mas
não tem valor para a cápsula, e a base do componente descreve a aritmética da
linha, não a incidência da perda. A menor mudança que diferencia o
comportamento foi uma marca explícita do cadastro, `Item.consumedInProduction`
(booleano, `false` por default, migration aditiva `20260925093030`), lida pela
regra canônica `componenteSegueQuantidadeProduzida` em `@veridi/shared`.

Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §52; onde ela é
protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

**Follow-up de cadastro, não de código:** os itens de cápsula vazia já
cadastrados nascem `false`, que é o comportamento anterior. Marcá-los é gesto de
quem cadastra, no formulário do Item — nenhum backfill por nome ou código foi
feito, e nenhum será: uma regra de custo decidida por `nome.includes("CAPS")` é
invisível para quem confere o custo.

### ~~FORMULATION-TEMPLATE-WORKBENCH-01~~ — a bancada no Modelo de Formulação — FECHADO em 2026-09-16

As decisões D-1 a D-11 do PO e as três fatias estão em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md) (seção A); as regras duráveis, em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §96–§97. O que ficou fora: a Ficha Técnica do Modelo
(FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01, fechada em 2026-09-16; linha 2b da fila, hoje no histórico) e a tabela Forma ×
Apresentação, logo abaixo.

### FORMULATION-PRESENTATION-BY-FORM-01 — a tabela Forma × Apresentação — aguardando a Veridi

Também de 2026-09-15. O domínio não tinha nenhuma regra de compatibilidade entre
`DosageForm` e `PresentationType`, e o dado real só usa `POT` nas duas formas. A
tela passou a oferecer as apresentações coerentes com a forma, com a primeira
versão declarada da tabela em `APRESENTACOES_POR_FORMA` (`packages/shared`):
cápsula oferece tudo; pó oferece tudo menos **Frasco**. A apresentação já
gravada numa versão continua na lista mesmo fora da tabela, e nenhuma migration
destrutiva foi feita. Confirmar ou corrigir a tabela é decisão do PO.

### PRODUCTION-LOT-PURITY-RECONCILIATION-01 — pureza da Formulação × pureza do lote — futuro

Registrado na homologação de FORMULATION-WORKBENCH-01 (2026-09-15), **fora do P0
atual**. A Formulação congela a pureza usada na versão; a Produção escolhe o lote
real, que tem a sua. Quando as duas diferirem, o objetivo futuro é avisar o
operador e exigir uma decisão controlada — nunca recalcular a necessidade em
silêncio, nem deixar passar sem registro.

Também fica para auditar nessa rodada: se a pureza nominal por fornecedor deve
morar no relacionamento Fornecedor ↔ Item, em vez de só no Item. Nada a decidir
nem a implementar agora.

### ~~CUSTOMER-CNPJ-AUTOFILL-01~~ — consulta de CNPJ no cadastro do Cliente — RECONCILIADO em 2026-09-17

**Aprovado pela Veridi e entregue como CUSTOMER-CNPJ-LOOKUP-01** (linha 9r da fila, hoje no histórico; regra em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §111). Este registro fica como histórico da decisão, não como item aberto — e
não deve ser reaberto como capability separada.

O que mudou em relação ao registrado em 2026-09-16: o provedor de estreia é o **OpenCNPJ** (base pública, sem token),
e o **Serpro passa a ser provedor futuro** — a arquitetura nasceu com registro de provedores justamente para que ele
entre como um segundo adaptador, sem reescrever tela, endpoint nem contrato. O nome também mudou de propósito:
"autofill" descrevia atualização automática, e a decisão do PO é o contrário — **assistência ao preenchimento**, com o
usuário escolhendo campo a campo e salvando por conta própria.

As duas frases que este item mandava rever foram revistas: [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §83 passou a dizer
que a consulta existe e que ela **não** define o perfil tributário, e a ajuda do Cliente ganhou o conceito
"Consultar CNPJ". Quem consulta é quem edita o cadastro (§98).

**Continua sem decisão:** ligar o SERPRO — exige credencial, contrato e decisão do PO, e nada disso foi feito.

---

## D. Manutenção técnica

### 10. Compactar `archive/DELIVERY_HISTORY.md` — LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

### 12. `validate-migrations-fresh.mjs` ainda chama o Prisma por shell — LOW

`execFileSync("pnpm", […], { shell: true })` imprime o `DeprecationWarning
DEP0190` do Node a cada execução, num comando rodado antes de todo merge com
migration. Sem impacto funcional e sem risco real (os argumentos são
constantes). `scripts/prisma-bin.mjs`, criado no MIG-ORDER-01b, já resolve o
binário do Prisma sem shell — a correção é trocar a chamada por ele. Ficou
fora daquela capability de propósito, para não aumentar escopo.

### 16. CALENDAR-LEGACY-COLUMNS-CLEANUP-01 — colunas de jornada única — LOW

PLANNING-CALENDAR-WEEKLY-SCHEDULE-01 (2026-09-12) passou a jornada para
`production_calendar_weekdays` e deixou em `production_calendars` as colunas
da jornada única — `startMinuteOfDay`, `endMinuteOfDay`, `breakMinutes`,
`breakStartMinuteOfDay`, `breakEndMinuteOfDay` e `monday`…`sunday` —, com os
CHECKs delas. Nenhum código as lê; ficaram só para a migration não precisar
remover coluna junto com o backfill. Limpeza: migration que remova colunas e
CHECKs, depois de a jornada semanal estar em produção e o backup lógico
conferido. Sem impacto funcional até lá — o risco é alguém ler a coluna velha
achando que ela é a jornada.

### 17. FK-ORDER-DOCUMENTED-CYCLE-01 — `fk-order.mjs` acusa o ciclo que a limpeza atravessa — LOW

O diagnóstico somente leitura `scripts/maintenance/fk-order.mjs` trata o ciclo
da contagem física (`stock_count_positions.validEntryId` NO ACTION ×
`stock_count_entries.positionId` CASCADE, desde a migration
`20260925093026`) como anel sem saída: imprime "CICLO DE FK" e sai com código 1
contra qualquer banco migrado (conferido em 2026-09-17 no banco de teste).
`prod-cleanup.mjs` atravessa esse ciclo pelo CASCADE listado em
`CASCADES_EM_CICLO_DOCUMENTADAS` (PROD-CLEANUP-MODEL-CLASSIFICATION-01), e a
ordem dele é a que vale. Correção: o diagnóstico reusar `calcularOrdem()` de
`prod-cleanup-models.mjs`, em vez de manter um segundo cálculo. Sem impacto na
limpeza — o risco é quem roda o diagnóstico ler o código 1 como bloqueio.

---

## E. Watchlist — observado, sem ação conhecida

Não é backlog operacional. Cada item é verdadeiro hoje e não tem trabalho
definido. Se algum voltar com sintoma novo, aí vira item da seção A.

**W2 saiu (2026-09-08).** Voltou com sintoma novo — 8 falhas em 10 `pnpm test` —,
foi medido, teve causa (a suíte da API e a da web disputando a CPU no runner
oficial) e correção. Está em
[`PROJECT_STATE.md`](PROJECT_STATE.md), "O runner oficial não disputa a máquina
consigo mesmo". **W1 continua sem ocorrência**: `ERR_IPC_CHANNEL_CLOSED` não
apareceu em nenhuma das 40 execuções completas dessa medição.

| # | O quê | Por que não é backlog |
|---|---|---|
| **W1** | `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento dos workers do vitest | Nenhuma asserção falha, sem reprodução recente. **Decisão de PO:** não investigar preventivamente. Se reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore de processos, frequência e stack completa **antes** de mexer no runner |
| **W3** | 24 das 56 linhas de `_prisma_migrations` em produção com checksum diferente do arquivo | Line ending, e só. `.gitattributes` fixa LF no SQL das migrations para novos clones. Nada foi reescrito no ledger |
| **W4** | Linha órfã `20260904093000_template_component_quantity_mode` em produção | Tolerada por decisão de 2026-09-04 ([`TECH_BASELINE.md`](TECH_BASELINE.md)). Reescrever `_prisma_migrations` à mão é pior que a linha |
| **W5** | Dois diretórios de migration com o mesmo timestamp `20260904090000` (`_component_quantity_mode` e `_gmp_production_execution`) | A ordenação é pelo nome completo do diretório, então continua determinística e igual em todo ambiente. Sem impacto observado; renomear diretório aplicado é que quebraria o ledger. Um empate **novo** não nasce mais: `proximoPrefixoLivre` pula prefixo ocupado, e `migration-prefix.test.ts` reprova qualquer duplicata além desta |
| **W7** | Quantidade ainda passa por `Number` em pontos de **exibição** das telas de OP e Pedido: teste de sinal (`> 0`, `<= 0`) em `badge`/`disabled`, a diferença `onHand - reserved - available` renderizada (`ProductionOrderPage.tsx:1157`) e o total somado na tela (`CustomerOrderPage.tsx:2178`). O Pedido também imprimia `reservedRemaining` e `stillToReserve` crus — esses, a diferença renderizada da OP e as somas do Faturamento do Pedido saíram em PTBR-NUMERIC-DISPLAY-AUDIT-01 (`formatQuantity` e `Decimal`); ficam os testes de sinal | Classificado no FIX-01b e deliberadamente **não corrigido**: nenhum alcança payload nem validação. Teste de sinal sobre valor ≥ 10⁻¹² é seguro em `double`; o que é defeito de verdade — soma e diferença exibidas em ponto flutuante, e valor cru na tela — é da mesma família de F-07-1 e pertence ao PREC-UI, não a um remendo pontual |
| **W6** | Decisão de domínio pendente: trocar `RESTRICT` por `SET NULL` em alguma das 27 FKs opcionais | Não acontece mais por omissão no modelo (#14). Cada troca é decisão de domínio própria — bloquear a exclusão, desassociar ou arquivar — e exige a migration que a faça no banco |
| **W8** | Tetos de 100 que SELECTOR-CUTOFF-WAVE-02 revalidou e manteve por não serem corte de escolha: dica de homologação da OC (`PurchaseOrderPage.tsx:380`, relações do fornecedor — acima de 100 a dica some da linha, mas fornecedor e item seguem com busca e a OC não depende dela), relações do cadastro de Item/Fornecedor (`SupplierItemsSection.tsx:29`, tabela só leitura; a lista completa, com filtro, é Compras → Item × Fornecedor), amostras da ficha do Projeto (`ProjectDetailPage.tsx:114`, as 100 mais recentes), usuários (`UsersPage.tsx:41`, listagem, fora da fase — Auth). FO-03 saiu em FO03-PENDING-CUTOFF-01 (2026-09-13): a folha lê todas as páginas de `onlyPending` até o total | Medido no dev: até 59 relações por fornecedor e 9 por item, 1 amostra por projeto; 685 usuários, quase todos resíduo de teste (TEST-USERS-LEGACY-RESIDUE-01, que saiu com a recriação do `veridi_dev` em 2026-09-14). Os de recurso industrial (Modelo de Estrutura de Custo, Roteiro, `porId` do Planejamento) eram seletor e fecharam na wave. Vira item da seção A quando algum passar do teto |
| **W9** | `pages/print/operational-sheets.test.tsx`: os dois primeiros testes do FO-02 caíram por `waitFor` de 1 s em `abrirFolha` (a folha ainda em "Gerando PDF…") numa execução fria de 19 arquivos em paralelo (FO03-PENDING-CUTOFF-01); o arquivo sozinho e duas reexecuções do mesmo gate passaram | FO-02 intocado na rodada e sem falha de conteúdo: é o primeiro `import()` do documento sob CPU disputada. Se voltar no `pnpm test`, o remédio é o prazo do `waitFor` de `abrirFolha`, não o código da folha |
| **W10** | `pages/periodo-invertido-listas.test.tsx`, caso "'Recebimentos': a resposta atrasada não aparece; voltar ao período consulta uma vez": caiu uma vez na suíte web completa de CUSTOMER-EDIT-PERMISSIONS-01 (2026-09-16, 3.657 testes) com `Unable to find an element with the text: Carregando…` — o estado de carregamento é transitório e já tinha passado | Sozinho passou 3 de 3, e nenhum módulo da rodada está no caminho da tela de Recebimentos. Não caiu na suíte completa seguinte (WEB-SUITE-PREEXISTING-FAILURES-01, 2026-09-16: 3.657 testes, 0 falhas). Se voltar, o remédio é o teste esperar o carregamento sem depender de ver o instante dele |
| **W11** | Prazo de 5 s do Vitest estourado sob carga na suíte web completa (MASTER-DATA-EDIT-PERMISSIONS-01, 2026-09-16, 3.796 testes, duas execuções com 5 quedas cada, só `Test timed out in 5000ms`): `lib/dates-formatador.test.ts` nas duas; `components/campo-numerico-guarda.test.ts` e `pages/listas-sem-consulta-solta.test.ts` (guardas que varrem o código-fonte) na primeira; `pages/print/base-calculada-impressos.test.tsx` na segunda, que rodou em paralelo com a suíte web completa de outra sessão | Sem asserção falhando, conjunto diferente a cada execução, nenhum dos arquivos no caminho da rodada, e os quatro passam sozinhos (20/20 em 9,3 s). Se virar rotina, o remédio é prazo próprio nesses arquivos (o formatador percorre todos os fusos; as guardas leem a árvore inteira), não reexecutar até passar |
| **W12** | `modules/inventory/stock-count-telas-2b.test.ts`, caso "conjunto diferente recusa sem gravar nada; o mesmo conjunto encerra e o INV- aparece nos movimentos": caiu uma vez num conjunto focado de 19 arquivos da API em paralelo (INVENTORY-INACTIVE-ITEM-VISIBILITY-01, 2026-09-17) com `expected 'stock_count_close_blocked' to be 'stock_count_changed'` — o encerramento foi recusado por posição antes de conferir os ajustes mostrados | Sozinho passou 5 de 5 e a repetição do mesmo conjunto passou inteira (1.597 testes); a rodada não tocou o Inventário Físico em sessão. A asserção não mostra as `issues` da recusa: se voltar, capturar o corpo antes de mexer. **Causa provável achada em 2026-09-19** (INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01): um teste novo com a mesma forma — recebimento gravado e sessão iniciada logo em seguida — capturou o corpo, `CONCURRENT_MOVEMENT_UNCONFIRMED`: o recebimento criado ANTES do início virou "movimentação durante o inventário". No Windows o `new Date()` do Node (a `referenceAt`) anda 1–3 ms atrás do relógio do sistema — o Postgres ficou à frente em 2.000 de 2.000 leituras —, e o `createdAt` do movimento sai do motor do Prisma. Correção de teste sugerida, não aplicada: gravar os recebimentos de ANTES da sessão com `createdAt` recuado (o `movimentar` do arquivo serve também a movimentos de depois do início, então não é troca de uma linha). O mesmo efeito derrubava o teste do estorno "contagem DEPOIS do registro do CI" (2 em 6 na base), corrigido nessa rodada |

---

### 15. `Decimal.toString()` pode sair em notação exponencial — LOW

Os DTOs serializam quantidade e dinheiro por `toString()`, e o decimal.js
devolve notação exponencial abaixo de `1e-7`: uma quantidade de
`0.000000000001` viaja como `"1e-12"`. A tela e o `parseDecimalInput`
receberiam um texto que não é o formato esperado.

**Não observado em dado real**: a menor escala do domínio é doze casas, e
nenhuma quantidade de operação chega perto do limiar. É defeito de fronteira,
não de uso.

Onde se corrige, quando valer: a serialização, num lugar só — `toFixed` na
escala da categoria (§58), nunca `toString`. Encontrado em COM-04, fora do
escopo dele e do COM-04b.

### 14. PLAN-DATE-01 — planejamento temporal pelas entregas programadas — LOW

COM-04 entregou a promessa; ela ainda não influencia o planejamento. Hoje o
cronograma é informativo: o Plano de Atendimento continua cobrindo o Pedido
inteiro de uma vez, e a Sugestão de Compra não sabe que 1.000 saem em outubro e
1.000 em dezembro.

O que se pode ganhar, quando o PO autorizar:

- **Sugestão de Compra com data** — comprar para a primeira entrega antes de
  comprar para a terceira;
- **Necessidade de produção legível no tempo** — o que precisa estar pronto até
  quando;
- **Sugestão de divisão temporal de OP** — sugestão, nunca divisão automática.

**Restrição durável:** nada disso pode criar um segundo motor de reserva. A
reserva continua sendo do Plano de Atendimento (§75). Sem decisão do PO, não
implementar.

**Dependência temporal:** a parte que passar a CONTAR dias úteis — lead time,
data necessária, necessidade de compra a partir da promessa — precisa de
OPS-CALENDAR-01 (B · #9) antes. As demais partes não ficam bloqueadas por isso.

### 13. Ajuda contextual — o que a Fase 1 deixou aberto — LOW

UX-HELP-02 entregou o modelo V2, os sete conceitos compartilhados e os 12
tópicos P0. **Nenhum destes itens bloqueia nada** — a ajuda funciona por
inteiro nos dois modelos —, e o próximo passo é decisão do PO, não sequência
automática:

- **UX-HELP-03** — painel lateral com abas, botão "?" fixo e rota
  `/ajuda/conceitos/:slug`. O conteúdo V2 migra sem reescrita;
- **39 tópicos ainda no modelo V1** — migram por tela, no ritmo de quem revisa
  a regra daquela tela;
- **Tópicos que servem a várias telas** — Recebimentos (quatro), Lotes (três) e
  a lista de Precificação continuam com um tópico só. O §45 já permite dividir;
- **Rótulos de tela na terminologia aprovada** (PO-5, PO-4) — "Situação",
  "Separação", "Modelo", "Em espera", "Lote comercial". É mudança de interface,
  fora da capability de ajuda; até lá a ajuda cita o rótulo real de hoje.

Divergências ainda vivas entre rótulo e terminologia alvo: "Status" nas listas
de expedição, faturamento, projeto e formulação; "Lote Veridi" onde a
terminologia alvo diz "lote comercial"; "Picking" no caminho
`/producao/picking`.

**Achado de responsivo, fora de escopo e anterior a esta rodada:** a casca do
ERP transborda 67px de rolagem horizontal a 390px de largura (`masthead` e
`workspace` com largura mínima maior que a tela). Não vem da ajuda — o painel
não piora a medida — e pertence ao endurecimento responsivo.

---

## G. Discovery — descobrir antes de construir

Nenhum destes tem escopo definido. O trabalho de cada um é **responder uma
pergunta**; desenhar solução antes da resposta é o que produz módulo que ninguém
usa.

Com posição na fila viva desde 2026-09-19: INTERNAL-CONSUMPTION-COST-CENTER-01 (decidido) e
DASHBOARD-INTERNAL-CONSUMPTION-01, os dois P2. O Inventário Físico foi decidido e segue em fatias (a Fatia 3 espera o
handoff). Os outros esperam a pergunta virar decisão. SUPPLIER-ADDRESS-01, que tinha posição, foi entregue em
2026-09-11 (merge b8d744b).

### SUPPLIER-OFFER-OVERLAP-01 — vigências sobrepostas de oferta E de tarifa industrial

Finding do COST-SOURCE-01 (2026-09-09), registrado sem decisão.

Hoje duas ofertas do MESMO fornecedor podem ter vigências que se sobrepõem:
criar uma oferta nova **não encerra** a anterior. O motor resolve de forma
determinística e testada — `effectiveAt` mais recente, desempate por
`createdAt` — então não há ambiguidade no cálculo.

O problema é de leitura: as duas aparecem como **"Serve de referência"** na tela
da relação, sem dizer qual efetivamente vence. Quem corrige um preço digitado
errado no mesmo mês vê dois números válidos e nenhuma pista de qual está no CMV.

Quatro caminhos, nenhum escolhido: (A) permitir e só explicar qual vence;
(B) ao criar vigência nova, encerrar a anterior automaticamente; (C) permitir e
alertar; (D) permitir sobreposição deliberada como recurso de negócio.

**O escopo desta decisão cresceu em 2026-09-09, e isso é bom.** Quando
INDUSTRIAL-RATE-VALIDITY-01 fechou a borda de dia civil, a auditoria confirmou
que `IndustrialResourceRate` tem EXATAMENTE o mesmo desenho: o banco permite
duas vigências abertas (nenhuma constraint), o service permite (nenhuma
validação), o desempate é determinístico (`effectiveAt` mais recente, depois
`createdAt`) e o histórico da tela marca **as duas** como "Vigente" sem dizer
qual vence. **PROD já tem 1 recurso industrial nesse estado**, além das ofertas.

A decisão é uma só, para os dois lados do custo — oferta de fornecedor e tarifa
de recurso industrial. Responder diferente nos dois seria inventar duas regras
para a mesma pergunta, e o estado atual dos dois está travado em teste para que
a mudança seja deliberada (`rate-validity-api.test.ts`,
`scripts/e2e/vigencia-de-tarifa-industrial.mjs`).

**Contexto que NÃO é tarefa:** as 602 ofertas `LEGACY_IMPORT` do corpus não
têm `effectiveAt` nem `preferred`, e isso é **dado do usuário** — DEV e PROD
não as têm desde o reset de 2026-09-11, e elas voltam, do mesmo jeito, se a
carga do corpus for refeita. Não existe item para "corrigir as 602": informar
vigência sem definir preferencial rebaixaria 90 itens para
`AMBIGUOUS_SUPPLIER_REFERENCE` (auditoria COST-VAR-01, G4). Nenhum backfill,
nem em DEV nem em PROD.

### COM-CONTRACT-01 — registro leve de contrato comercial — P2

Vindo do walkthrough real (2026-09-09). **P2 · discovery: não precede bug nem
quick win**, e não entra na fila viva acima.

Não existe nada de contrato no modelo hoje — a busca por `contract`/`contrato` em
`schema.prisma` e em `packages/shared` não devolve nada. O que existe e NÃO é
isto: `ControlledDocumentRevision` (documento controlado da Qualidade) e
`Attachment` (anexo genérico).

**A decisão já tomada é negativa, e é a mais importante:** contrato **não dirige**
a situação comercial do Cliente. Cliente pode ser ativo sem contrato cadastrado,
e um Prospect pode eventualmente ter documento preliminar se o domínio futuro
permitir. Amarrar os dois faria a situação comercial depender de alguém anexar um
PDF.

Escopo a AUDITAR quando a rodada acontecer — lista de partida, não modelo
aprovado: número/referência, `Customer`, `Project` de origem opcional, data
inicial, validade, encerramento, situação, observação e anexo/documento.

**Preferir derivar a situação do contrato por DATAS** — Vigente, Encerrado,
Vencido — em vez de um status manual redundante, pelo mesmo motivo de
CUSTOMER-COMMERCIAL-STATUS-01 e de §71: "vencida" já é estado derivado na
proposta, e nada varre o banco à meia-noite. Não decidido nesta rodada.

**Não confundir com o que já existe.** As cinco coisas são separadas e a
separação é a regra:

| Conceito | O que é |
|---|---|
| `Customer` | a empresa e o relacionamento |
| `Project` | a oportunidade / o desenvolvimento |
| `QuoteVersion` | a proposta |
| `CustomerOrder` | o compromisso operacional de compra |
| Contrato | a evidência jurídico-comercial do acordo, **quando existir** |

**Não criar módulo grande antecipadamente.** Um contrato com ciclo de aprovação,
alçada e versionamento é outra capability; o que a reunião pediu foi registro.

### SUPPLIER-MODE-01 — "Fornecedor — Virtual / Físico"

Vindo do walkthrough real (2026-09-09). **Não criar enum.**

A expressão apareceu na reunião sem definição, e as leituras possíveis levam a
modelos incompatíveis: classifica o FORNECEDOR (uma distribuidora sem estoque
próprio?), o ESTABELECIMENTO/endereço (loja física × operação online), o CANAL
DE COMPRA (portal × presencial), ou é outra coisa que o termo do dia a dia
esconde? Cada resposta muda onde o campo mora — `Supplier`, o endereço de
SUPPLIER-ADDRESS-01, ou a `SupplierItem`.

Descobrir o que a Veridi decide com essa informação. Um enum criado antes da
resposta ficaria preenchido e inútil.

### ASSET-01 — "Cadastro de Ativos"

Vindo do walkthrough real (2026-09-09). **Não criar módulo.**

Auditar primeiro o que já existe: `IndustrialResource` (com tipo
`LABOR`/`EQUIPMENT`/`ENERGY`, potência em kW e tarifas versionadas),
`IndustrialResourceRate` e o uso planejado por estrutura de custo.

A pergunta é qual dos quatro significados está em jogo: ativo IMOBILIZADO
(patrimônio, depreciação, valor contábil — que o ROADMAP lista como futuro),
MÁQUINA no sentido de equipamento produtivo (já é `IndustrialResource`
`EQUIPMENT`), RECURSO industrial (idem), ou apenas a flag **Ativo/Inativo** de um
cadastro qualquer — que é o falso amigo mais provável em português, e que já
existe em todo cadastro.

Se for imobilizado com depreciação, é capability de custeio e encosta em
CMV-TAX/landed cost. Se for qualquer um dos outros três, provavelmente não há
trabalho.

### INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 — redesenho do Inventário Físico

Registrado em 2026-09-15, só em documento. **Status: PO BASELINE / INTENÇÃO
APROVADA — não é especificação técnica final.** Diferente dos outros itens desta
seção, os objetivos já foram aprovados pelo PO: o discovery responde o que está
aberto e desenha a solução, e pode mudar detalhe, mas não pode perder objetivo
aprovado. O discovery completo (INVENTORY-PHYSICAL-COUNT-DISCOVERY-01) está `DECIDIDO` desde 2026-09-15
([documento](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md)); a implementação é INVENTORY-PHYSICAL-COUNT-01, em
fatias — 1, 2A e 2B entregues em 2026-09-15 e 2026-09-16; a Fatia 3 espera o handoff.

**Ponto de partida.** O Inventário Físico de hoje (`StockCountPage`) conta UMA
posição por vez — item, lote quando o item controla lote, contagem e motivo — e,
havendo diferença, cria o ajuste rastreável sem sair da tela. A FO-01 (folha de
contagem física) já tem modo cego (`?cega=1`, sem a coluna de saldo), mas não há
sessão a que ela se vincule. As regras duráveis de
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §16 continuam valendo; nada aqui as altera.

#### PO BASELINE — objetivos aprovados

**Módulo.** O Inventário Físico deixa de ser somente o formulário 1-a-1 e evolui
para **sessões de inventário em lote**. A função atual fica, como **Contagem
rápida** ou equivalente.

**Entrada.** Lista de inventários: em andamento; concluídos; progresso;
divergências; ações para retomar. Ações principais: **Novo inventário**,
**Contagem rápida** e **Folha de contagem**.

**Novo inventário.** Montador de escopo, com os filtros desejados:

- **Tipo:** matéria-prima; embalagem; produto acabado; todos.
- **Saldo:** somente com saldo; com ou sem saldo.
- **Última contagem:** nunca contado; sem contagem há X dias; período.
- **Movimentação:** movimentado nos últimos X dias; sem movimentação há X dias;
  recebido recentemente; consumido em produção recentemente; expedido
  recentemente; ajustado recentemente.
- **Lote:** ativos; aguardando liberação; bloqueados; vencidos; próximos do
  vencimento; lote específico.
- **Histórico:** com divergência anterior.
- **Propriedade:** Veridi; material de cliente; cliente específico.
- **Seleção:** manual.

Antes de iniciar, mostrar a quantidade de itens e a quantidade de lotes/posições.

**Unidade operacional.** Item sem controle de lote: posição por item. Item com
controle de lote: posição por item + lote. Localização física fica para o
discovery.

**Tela de contagem.** Preferência: grade operacional, com as colunas conceituais
Código, Item, Lote, Unidade, Contagem e Situação. A contagem assistida pode
mostrar saldo e diferença. **A contagem cega não mostra saldo nem diferença
durante a primeira contagem.**

**Busca / autocomplete.** Campo "Item, código ou lote", que encontra por código
do sistema, nome, trecho do nome e código do lote. Ao escolher item com lote,
sugere os lotes daquele item. A UX deve ser compatível com scanner no futuro, e
o Enter deve favorecer a contagem sequencial rápida.

**Adição durante a contagem.** Avaliar "Adicionar item ou lote" para o que o
operador encontra fora do escopo inicial, com registro de auditoria. **Nunca
inventar lote inexistente silenciosamente.**

**Progresso.** Algo como "51 / 91 posições · 56%". Permitir interromper e
retomar.

**Divergências e recontagem.** Fluxo: contar → revelar divergências → recontar →
revisar → confirmar ajustes. A recontagem das posições divergentes é suportada.

**Estoque — regra do PO.** O inventário **nunca sobrescreve saldo
diretamente**. Ao finalizar, gera movimentos/ajustes rastreáveis ligados à
sessão de inventário.

**FO-01.** A folha de contagem é vinculada à sessão. Em inventário cego, **não
imprime o saldo do sistema**. Conteúdo conceitual: identificador; código; item;
lote; unidade; campo para contagem; data/responsável.

**CSV.** Exportar o CSV da sessão. Importar CSV **preenche contagens e nunca
ajusta estoque**. Fluxo: upload → validação → preview → erros/avisos →
confirmação. Protege contra: arquivo de outro inventário; item inexistente; lote
inexistente; item e lote incompatíveis; duplicidade; quantidade inválida; linha
fora do escopo; inventário encerrado. Compatível com o uso brasileiro: UTF-8,
separador `;` e decimal pt-BR. Avaliar também o modelo simples
`codigo_item;lote;contagem` — o discovery decide se entra na primeira versão.

**Histórico / auditoria.** Preservar quem criou, quem contou, quem recontou,
quem aprovou, data/hora, valores, divergências e movimentos gerados.

**Modelagem aberta ao cíclico.** A modelagem deve permitir evoluir para
sugestões automáticas: nunca contado; sem contagem há X dias; movimentação
recente; alto giro; divergência recorrente; próximo do vencimento. As sugestões
em si são FUTURO.

#### DISCOVERY REQUIRED — nada decidido aqui

**HIGH / DISCOVERY REQUIRED — concorrência / cut-off.** Saldo 10 no início; a
produção consome 2; o operador conta 8. O sistema **não pode** interpretar isso
automaticamente como divergência de -2. O discovery precisa comparar: bloqueio
de movimentação; snapshot; reconciliação dos movimentos; saldo no momento da
contagem; outra solução.

Também abertas: tolerância; segundo operador; multiusuário; localização física
futura; lote físico inexistente no ERP; lote do ERP não encontrado fisicamente;
autosave; permissões de contar versus aprovar; política de cancelamento;
imutabilidade após o fechamento. E as duas que a baseline já deixou ao
discovery: se "Adicionar item ou lote" entra, e se o modelo simples de CSV entra
na primeira versão.

#### FUTURO — não promover sem decisão do PO

Inventário cíclico com sugestões automáticas, scanner dedicado, localizações e
regras avançadas não entram no escopo por padrão, nem porque o discovery tocou no
assunto: promover exige decisão explícita do PO. Os três primeiros já estão em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md), seção Armazém / WMS (Contagem
cíclica agendada, Coletores industriais, Endereçamento avançado).

### CUSTOMER-MASTER-DATA-AUDIT-01 — histórico do cadastro do Cliente — P2 · FUTURO

Registrado pelo PO em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01), **sem posição e sem implementação**. O cadastro do
Cliente guarda só quem criou, quem alterou por último e quando (`createdBy*`, `updatedBy*`, `updatedAt`): uma troca de
CNPJ, de razão social ou de perfil tributário não deixa rastro do valor anterior. A situação cadastral já tem histórico
append-only (§95); o cadastro, não. A pergunta a responder: vale um histórico append-only de antes/depois para os
campos estruturais (CNPJ, razão social, perfil tributário e outros), para quais campos, quem lê, e como convive com os
snapshots que os documentos já congelam. Exigiria migration. Quem pode alterar já está decidido (§98).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01 — Onda 2: consolidar os grupos aprovados — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§118; seção própria do `PROJECT_STATE.md`): 8/8 grupos, 11 Itens
removidos, 7 canônicos com `declaredNutrient` consolidado, duas relações com fornecedor consolidadas; PROD e Railway
intocados. Pendente: a mesma onda em PROD, com conferência READ ONLY, PLAN em PROD, backup restaurável e aprovação do PO
antes — o código do ERP sai de sequence por banco, e a decisão confere o código da planilha dos dois lados. **Antes de
PROD, também a V4 com a Veridi** (o que `*`/`**` significam no nutriente): no G5, "Clorogênico" = "Clorogênico**" é
equivalência declarada só para o DEV, na integração de 2026-09-17 — não regra geral de asterisco —, e a resposta pode
mudar a decisão do grupo. O texto abaixo é o registro da aprovação.

Aprovado pelo PO em 2026-09-17, na integração de MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114). São nove
consolidações, em duas naturezas:

| Grupo | Registros | Natureza |
|---|---|---|
| Arabinogalactana | MP-000115 · MP-000322 | mesmo material, nutrientes diferentes |
| Beta-glucana de levedura | MP-000118 · MP-000304 | idem |
| Concentrado de tomate | MP-000165 · MP-000324 · MP-000347 · MP-000349 | idem (quatro linhas) |
| Fosfato de magnésio dibásico | MP-000204 · MP-000285 | idem |
| Fosfato de cálcio monobásico | MP-000269 · MP-000283 | idem |
| Fosfato de cálcio tribásico | MP-000270 · MP-000284 | idem |
| Membrana de casca de ovo | MP-000312 · MP-000317 · MP-000319 | idem (três linhas) |
| Sachê de sílica gel 5 g | ME-000021 · ME-000089 | **par nomeado**: difere por acento, e o PO declarou duplicado verdadeiro |

**O que a ferramenta ainda não fazia** — e passou a fazer nesta capability (§118):

1. **Escrever o campo consolidado no canônico.** A regra do PO para `declaredNutrient` é juntar os valores ÚNICOS na
   forma "A · B · C", sem repetir termo. Hoje o saneamento só move referência e remove — nunca altera o canônico —, e é
   justamente por divergir em `declaredNutrient` que estes sete grupos saem BLOQUEADOS. Precisa de uma consolidação
   declarada por coluna, com o valor final no PLAN antes de gravar.
2. **Aceitar par nomeado fora da regra automática.** A sílica não vira grupo: a regra preserva acento, de propósito. O
   par entra por decisão versionada, como o arquivo da §110 — e **sem** tornar a regra geral accent-insensitive.
3. **Reavaliar as colisões de índice único** nos grupos que têm relação com fornecedor (o `supplier_items` parcial de
   preferencial hoje bloqueia por não ser calculável).

Fora desta onda, por decisão do PO: MP-000149/475, MP-000325/348, MP-000320/468, MP-000014/022 e MP-000393/486
continuam em revisão (podem ser materiais diferentes), e o Modelo "X" (FT-000001 × FT-000002) segue bloqueado até se
saber conteúdo, versões, referências, se algum é descartável e o impacto da colisão de `versionNumber`. **Decididos na
Onda 3** (seção abaixo, §124).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01 — Onda 3: fundir, renomear, excluir o sem uso — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§124; seção própria do `PROJECT_STATE.md`), depois da revisão READ ONLY
MASTER-DATA-DUPLICATE-REVIEW-03: G4 maçã fundido em MP-000475 ("Açúcar de maçã · Carboidrato"); G7 oliva e G13 guaraná
renomeados para nome técnico distinto (MP-000320 "… — Verbascosídeo", MP-000468 "… — Hidroxitirosol", MP-000393
"Extrato de guaraná 22%"; MP-000486 mantém o nome); Modelos "X" FT-000001 e FT-000002 excluídos com a V1 DRAFT de cada
um. Restam 2 grupos em revisão. PROD e Railway intocados.

Pendente:

- **A Veridi responde** (a resposta não se infere): o que `*` e `**` significam no nutriente (G6 e G11, a V4); o teor
  real de ácido clorogênico do MP-000325 e do MP-000348; se as cotações FLORIEN R$160/kg (1 kg) e R$650/kg (100 g) são a
  mesma especificação; e por que o código legado 349 aparece com 8%, 45% e 50% nas fórmulas antigas. Com a resposta, o
  PO decide a ação de G6 e G11 numa onda seguinte.
- **A mesma onda em PROD**, como a Onda 2: conferência READ ONLY, PLAN em PROD (o código do ERP sai de sequence por banco
  e os Modelos "X" são dado do DEV — o que houver em PROD é outro registro), backup restaurável e aprovação do PO.
- ~~**A carga não reproduz renomeação nem consolidação**~~ — **FECHADO em 2026-09-18 por ITEM-IMPORT-WAVE-3-CONSISTENCY-01**
  (na `main`, fora de PROD, sem migration): com o pacote, a carga grava o `declaredNutrient` consolidado nos canônicos das
  Ondas 2 e 3 e o nome técnico do MP-000320, MP-000468 e MP-000393, conferidos contra o pacote, e o VERIFY acusa base
  que não reflete a decisão. O rebuild num banco descartável chegou aos mesmos 798 Itens do DEV saneado, campo a campo,
  com os mesmos 2 grupos repetidos (G6, G11); reexecutar não recria absorvido nem desfaz renomeação.
- O `family` "OTHER_RAW_MATERIAL" que só o MP-000149 tinha saiu com ele (a decisão só consolidou o nutriente; o canônico
  segue sem família).

### MASTER-DATA-NAME-UNIQUENESS-01 — índice único de nome no banco — P1 · DEPOIS DO SANEAMENTO

Registrado em 2026-09-17 por MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114), **sem implementação e de propósito sem
migration naquela rodada** — a janela de Uso e Consumo estava criando a dela, e duas migrations concorrentes se
atropelam.

O guarda da API já recusa nome repetido sem caixa nos nove cadastros, e **não substitui a constraint**: entre o SELECT
e o INSERT há uma janela em que duas requisições simultâneas passam as duas. Fechá-la é criar, no banco, o índice único
funcional `CREATE UNIQUE INDEX … ON <tabela> (upper(btrim(<coluna>)))` — a MESMA expressão do guarda e da ferramenta de
saneamento, para que os três nunca discordem.

O que precisa acontecer **antes**, e é o motivo de esta capability não ter data:

1. **o saneamento tem de fechar.** O índice não nasce por cima de duplicata existente: o `CREATE UNIQUE INDEX` falha e a
   migration não aplica. Depois da Onda 3 (§124), o `veridi_dev` tem 2 grupos, ambos em revisão com a Veridi (G6 café
   verde e G11 fosfato de piridoxal) — cada um é decisão de produto, e a ferramenta recusa escolher sozinha. A carga já
   reproduz fusão, consolidação e renomeação das ondas (ITEM-IMPORT-WAVE-3-CONSISTENCY-01): o rebuild pelo pacote chega
   aos mesmos 2 grupos do DEV, então o índice quebraria o rebuild só por G6 e G11 — o esperado até a Veridi responder;
2. **PROD tem de ser medido**, em conferência READ ONLY: o estado do DEV não prova o de PROD, e os códigos do ERP saem
   de sequence por banco;
3. **o escopo do Item já está decidido**: o PO fixou em 2026-09-17 que os quatro tipos (RAW_MATERIAL, PACKAGING,
   FINISHED_PRODUCT e INTERNAL_CONSUMABLE) dividem **um único** espaço de nomes, então o índice é um só sobre
   `items` — não um por tipo.

Quando as três estiverem resolvidas, a migration é uma só, com um índice por cadastro, e o guarda da API continua —
mensagem amigável é da aplicação, não do banco.

**Edição do cadastro legado** (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01, 2026-09-18, §114): enquanto o índice não
existe, o guarda impede duplicidade NOVA e deixa editar o cadastro que já nasceu duplicado quando o nome efetivo não
muda — PROD tinha 21 grupos / 45 Itens no preflight de 2026-09-18, e cada Salvar deles dava 409. Isso não muda o índice
nem o que vem antes dele: continua bloqueado pelos grupos não resolvidos — G6 e G11 no DEV e, em PROD, o que as ondas
ainda não sanearam lá.

### MASTER-DATA-STRUCTURAL-LOCKS-01 — travas estruturais do cadastro mestre — sem posição

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE11 do PO), **sem implementação**. Hoje a única trava
de campo estrutural é `Item.operationallyUsed` (OC, recebimento, lote ou movimento travam tipo, unidade, lote e
validade). Ficaram de fora, sem trava nenhuma: Item usado em Formulação ou Modelo (mudar tipo ou unidade reescreve o
significado das linhas), item de produto acabado ligado a Produto, e `PATCH /products/:id`, que religa ou desliga o PA
do Produto sem conferir lote, OP ou Pedido. A pergunta: quais vínculos travam quais campos, e se a recusa é por campo
(como `structural_field_locked`) ou por ato. Quem pode editar já está decidido (§100).

### MASTER-DATA-STATUS-HISTORY-01 — motivo e histórico de Inativar/Reativar — P2 · FUTURO

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE5 do PO), **sem posição e sem implementação**. Item,
Fornecedor e Produto inativam e reativam sem motivo e sem histórico: só `active` e `updatedAt` mudam. O Cliente já tem
motivo obrigatório e histórico append-only (§95). A pergunta: motivo obrigatório nos três, histórico com autor e data,
e se a reativação do Item continua mais estreita (Qualidade e Administrador) quando houver motivo registrado. Exigiria
migration. Quem inativa e reativa, e o 409 da transição repetida, já estão decididos (§100).

### SUPPLIER-ITEMS-UX-01 — Fornecedor → Itens administrável no cadastro do Fornecedor — sem posição

Fatia 2 do [ITEM-SUPPLIER-UX-DISCOVERY-01](discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md), adiada pela D4 do PO
(2026-09-16), **sem posição e sem implementação**. Hoje a seção Itens fornecidos do Fornecedor só lista, com o caminho
para Compras › Item × Fornecedor. A Fatia 1 fechou em ITEM-SUPPLIER-UX-01 (§102): `FornecedoresDoItemSection`,
`SupplierItemFormModal` com `itemFixo` e `preferencial.tsx` são o ponto de partida — com o Fornecedor fixo, o seletor
passa a ser o de Item. Sem migration. Para decidir junto: levar à tela geral a confirmação da troca de preferencial que o
cadastro do Item já pede (hoje o "Marcar como preferencial" do detalhe na tela geral troca direto, D2; a E2E
`oferta-de-fornecedor-vira-custo` passa por ele).

### ATTACHMENTS-R2-MIGRATION-01 — anexos genéricos no adaptador de storage — P2 · FUTURO

Registrado em 2026-09-16 por LABEL-ATTACHMENTS-01, **sem posição**. `Attachment` (lote, recebimento, produto, projeto,
amostra) segue em `lib/file-storage.ts`, no volume: 10 MB, extensão × MIME sem assinatura, download lido inteiro em
memória. A pergunta: vale levar esses anexos ao `StorageAdapter` (provedor por linha, streaming, assinatura) e ao R2, e
como mover os arquivos que já estão no volume sem perder nenhum — cópia verificada por hash antes de trocar o provedor
de cada linha. Exigiria migration (provedor por anexo).

### LABEL-FILE-SUBTYPE-CHANGE-01 — Item Rótulo com versões que troca de subtipo — LOW · sem posição

Visto em 2026-09-16 por LABEL-ATTACHMENTS-01. `packagingSubtype` não é campo estrutural: um Item Rótulo com arquivo
pode virar Pote pela edição. As versões ficam no banco e no storage, mas a seção some da tela e não aceita versão nova
(409 `item_not_label`); voltar o subtipo para Rótulo devolve o histórico intacto. Nada se perde, mas o histórico fica
fora de vista. A pergunta, de cadastro mestre (vizinha de MASTER-DATA-STRUCTURAL-LOCKS-01): travar a troca de subtipo
quando houver versão, ou mostrar o histórico em consulta mesmo fora do subtipo.

### ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 — consulta assistida nos demais seletores — sem posição

Registrado em 2026-09-17 por ASSISTED-ENTITY-SELECTOR-FOUNDATION-01, **sem implementação**. A fundação está na `main`:
`SearchableEntitySelect` com `onConsult` opt-in, `EntityConsultationDialog` e o piloto `ItemConsultationDialog` na
bancada (padrão em [`UI_BRAND.md`](UI_BRAND.md)). A pergunta, depois de validar o piloto com a Veridi: quais seletores
ganham a consulta, e em que ordem — Cliente, Fornecedor, Produto, Lote, o Item da Ordem de Compra e do Item × Fornecedor.
Cada um reusa o diálogo com as colunas e o recorte do próprio campo. Pontos já sabidos: (1) campo que aceita mais de um
tipo de Item (linha da OC: matéria-prima e embalagem) precisa de filtro aditivo na API (`types=`) — juntar páginas de
dois tipos no navegador quebra paginação e contagem; (2) seletor que mora dentro de modal (Item × Fornecedor) abre a
consulta como mais uma camada, e o Escape já fecha uma de cada vez (`modal-stacking`); (3) nova escolha é só de
ativo: campo cujo recorte traga inativo mostra a linha desabilitada, com o motivo, nunca selecionável.

Atualizado em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01: a consulta também opera em seleção múltipla (até 10) na
ação de seção, com colunas por entidade (`detail`/`status`) — Formulação, Modelo e recursos do Modelo de Estrutura de
Custo. Candidatos à múltipla no rollout: (4) a etapa do Roteiro de Produção ("+ Adicionar recurso", mão de obra E
equipamento ativos) — mesmo problema do item (1), pede `types=` em `GET /industrial-resources`; (5) a Estrutura de Custos
grava cada uso de recurso pela API com o uso obrigatório, então lote ali é outra conversa (criar vários usos de uma vez).

### COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01 — linha de recurso sem uso por lote no Modelo de Estrutura — LOW, sem posição

Visto em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01, **sem mudança**. No rascunho do Modelo de Estrutura de Custo,
"Salvar rascunho" envia só as linhas com recurso E uso por lote (`CostTemplateDetailPage`, filtro antes de
`resourceUsages`): a linha com recurso e uso em branco não vai, e a tela a mantém com "Alterações não salvas", sem dizer
qual linha falta. Era assim com "+ Adicionar recurso"; com "+ Adicionar recursos" (até 10 linhas de uma vez, uso em
branco para preencher) fica mais fácil cair nisso. A pergunta: recusar o salvar apontando a linha (como a bancada da
Formulação faz com a quantidade), ou avisar quais linhas ficaram de fora.

### DASHBOARD-INTERNAL-CONSUMPTION-01 — o Painel não representa Uso e consumo — P2 · FILA VIVA

**Posição na fila viva desde 2026-09-19** (linha 19, P2); falta a decisão do card, abaixo. Registrado em 2026-09-18 por
INTERNAL-CONSUMPTION-REVERSAL-01, **fora da fatia** por decisão do PO (achado L1 do discovery). O Painel conta movimentos por tipo (`applyMovementCount`) sem caso para `INTERNAL_CONSUMPTION` nem
`INTERNAL_CONSUMPTION_REVERSAL`: os dois não entram em card nenhum nem na atividade por dia, e na lista de
movimentações recentes aparecem com o rótulo do tipo e sem documento de origem. Decidir se o consumo interno ganha
card próprio (líquido dos estornos, como o R-21) ou entra num card existente.

### INTERNAL-CONSUMPTION-COST-CENTER-01 — Centro de Custo do consumo interno — P2 · DECIDIDO

**Decidido pelo PO em 2026-09-19**
([INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01](discovery/INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01.md)); fila
viva, linha 18, abaixo dos P0/P1. Centro de Custo é cadastro próprio, obrigatório em CI novo; criar, editar e inativar só
ADMIN, e todo autenticado consulta; o destino livre sai do CI novo (`purpose` fica como legado de leitura) e
"Observação/finalidade" segue livre; CI antigo sem backfill, mostrado "Sem centro de custo" com o destino antigo; sem
seed; cadastro em Cadastros e Configurações › Centros de custo. Migration aditiva. O texto abaixo é o registro de quando
era pergunta.

Registrado em 2026-09-17 por INTERNAL-CONSUMPTION-01, **explicitamente fora da fatia** por decisão do PO. Hoje o
destino/uso é texto livre e opcional ("Escritório", "Limpeza", "Expedição"). Texto livre agrupa mal: "Escritorio",
"escritório" e "ADM" viram três destinos no relatório. Desde INTERNAL-CONSUMPTION-REPORT-01 (§117) a falta está à
vista: o R-21 filtra e agrupa o destino pelo texto EXATO gravado, e as três grafias saem como três linhas no resumo
por destino. É o momento natural de decidir entre um cadastro de Centro de Custo e uma lista fechada de destinos.
Migrar depois é possível: o texto gravado vira o ponto de partida do mapeamento.

---

## Backlog reservado para go-live

Os itens deliberadamente adiados até a preparação final estão em [`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md).
**Status atual: INATIVO** — fora da Fila viva; só o PO ativa.

---

## F. Roadmap — fora do backlog

Escopo futuro não fica aqui. Vive em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md):

- **Preferências de exibição de precisão** (PREC-UI-01 a 08) — desenho em
  [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §11, invariantes
  duráveis em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57. **Atenção ao
  implementar:** PREC-UI-05 e PREC-UI-06 já são o comportamento atual e
  precisam ser preservados, não reconstruídos;
- **Produto próprio Veridi** — `Product` sem cliente obrigatório, estoque
  próprio de Produto Acabado, venda do mesmo PA a vários clientes.
  `Product.customerId` permanece obrigatório no escopo atual.

**Tributos, frete e demais custos de aquisição permanecem BRAINSTORM**, e o
brainstorm já existe — não se abre item novo para ele. O escopo discutido
(tributo recuperável × não recuperável, percentual × fixo, base de incidência,
vigência, frete e transporte, e em que momento o encargo entra: aquisição,
produção ou venda) está coberto por duas fontes que já estão escritas:

- `ROADMAP_POST_MVP.md`, **Landed cost** — "rateio de frete, impostos e demais
  custos de aquisição" — e a seção "Custeio / CMV — o que ainda falta";
- [`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md)
  §21, que mapeia os **pontos de extensão possíveis** com o efeito de cada um no
  CMV: oferta, linha de OC, `ReceiptLine.actualUnitCost`, `ReceiptLine` com
  colunas separadas, documento fiscal, `ItemCostReference` e linha manual da
  estrutura.

A direção registrada ali é `ReceiptLine` — o campo se chama *custo efetivo de
aquisição* por causa disso —, e a escolha entre "somar dentro de
`actualUnitCost`" e "colunas separadas" é rodada própria. Nada a decidir aqui, e
nada a implementar.

**RAW-MATERIAL-EXTERNAL-ENRICHMENT — enriquecimento externo da Matéria-prima —
DESCARTADO pelo PO em 2026-09-17.** O cadastro de Matéria-prima não é enriquecido
por fonte externa, e nem o Open Food Facts nem a ANVISA são integrados a ele. Não
se abre item de backlog nem discovery para isso. A decisão saiu do POC
ADHOC-RAW-MATERIAL-ENRICHMENT-POC-01: somente leitura, fora do repositório e já
removido, testou as duas fontes gratuitas contra cinco matérias-primas reais do
cadastro. Nenhuma delas traz o que a ficha da matéria-prima precisa — pureza, forma
química, CoA, fornecedor, especificação técnica —, porque esse dado vem do
fornecedor, não de base pública:

- **Open Food Facts** é base de produto de prateleira. A busca de texto livre
  devolveu potes de marca e, mais de uma vez, a substância errada (ácido cítrico
  para ácido ascórbico, L-glutamina para L-triptofano). Só a taxonomia de
  ingredientes e aditivos identificou a substância — nome traduzido, número E,
  Wikidata —, o que é referência, não cadastro. Serve a Produto Acabado e a dado
  de varejo.
- **ANVISA — Dados Abertos** (`DADOS_ABERTOS_ALIMENTO.csv`) registra produto, não
  insumo: dez colunas regulatórias (empresa, produto, processo, categoria,
  registro, vencimento, situação) e nenhum match de alta confiança nas cinco
  matérias-primas. "Creatina Monohidratada" aparece com esse nome exato em vários
  registros ativos, todos *Suplementos alimentares* de marca. Serve a dado
  regulatório de Produto.

O aproveitamento dessas fontes no cadastro de **Produto** ficou registrado como
discovery futuro em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) ("Dados externos
do Produto"), fora da fila viva e sem compromisso.

---

## Próximo gate

A ordem está na fila viva, no topo. Gate paralelo: a validação com a Veridi (#7, #11) vale só para as regras que
dependem do processo real do cliente, e não impede #8E, #8F e #8G quando o PO autorizar. Material pronto:
`Guia_Fluxo_Comercial_Veridi.docx` (não versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
