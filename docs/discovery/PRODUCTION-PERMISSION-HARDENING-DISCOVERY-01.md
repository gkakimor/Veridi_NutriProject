# PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01

Discovery somente leitura das permissões de Produção do ERP Veridi.

- Data: 2026-09-15
- Tipo: discovery (sem código, testes, banco, migration ou PROD)
- Prepara: PRODUCTION-PERMISSION-HARDENING-01
- Implementação: **NÃO IMPLEMENTADO**

## Status

**EM_ANALISE**

Duas decisões do PO bloqueiam a implementação:

- **P1** — quem executa a Ordem de Produção (picking, consumo, consumo extra, pesagem, parte, apontamento,
  variância, conclusão);
- **P6** — se os operadores da Veridi entram com conta PRODUCTION própria.

As demais perguntas (P2–P5, P7, P8) têm resposta recomendada e não bloqueiam o núcleo. O discovery fechou com
`READY_TO_IMPLEMENT = YES`, condicionado a P1 e P6.

## Objetivo

Definir a política correta de permissões da Produção. O ponto de partida era um achado conhecido: parte dos
endpoints de Produção exige ADMIN ou PRODUCTION, e parte exige apenas usuário autenticado. O discovery separa o que
é **bug real** do que é **regra ainda não definida pelo PO**, e entrega:

- inventário de papéis, guards, endpoints, leituras, UI, auditoria e testes;
- matriz atual e matriz recomendada;
- causa e correção do `SYSTEM_ACTOR` no cancelamento da OP;
- impacto de compatibilidade de um endurecimento;
- plano de testes de API/web e plano de E2E adversarial;
- perguntas objetivas para o PO, com opções.

Origem do achado: `docs/archive/PROJECT_STATE_HISTORY.md` (antes `docs/PROJECT_STATE.md`), seção "A OP sem roteiro existe, mas não segue
(PRODUCTION-ROUTE-ASSIGNMENT-01)" — "picking, receita e apontamentos seguem sem `requireRole`; cancelar a OP ainda
grava `SYSTEM_ACTOR`". O PO usava o ID PRODUCTION-PERMISSION-HARDENING-01 sem registro no repositório.

## Base auditada

- Código lido: `main` = `origin/main` = **`9c60845`** (merge: E2E-BASELINE-REDESIGN-WAVE-01-02), checkout
  principal limpo. A rodada correu em paralelo com a WAVE 3 das E2E.
- As citações `arquivo:linha` deste documento valem para `9c60845`. Conferir antes de implementar.
- Documento persistido sobre `origin/main` = `6256ca9` (merge: E2E-BASELINE-REDESIGN-WAVE-03). Entre `9c60845` e
  `6256ca9` nenhum arquivo de código auditado mudou; mudaram documentos (`BACKLOG`, `E2E_STRATEGY`,
  `PROJECT_STATE`, `TEST_COVERAGE_MAP`), `scripts/e2e-run.mjs` e suítes/fixtures comerciais em `scripts/e2e`.
  Em `9c60845` o achado de origem estava em `docs/PROJECT_STATE.md:1988-1989`, a seção "E2E 04 — Adversarial" em
  `docs/E2E_STRATEGY.md:65-69`, a decisão G em `:135` e "permissões detalhadas por papel" em
  `docs/BACKLOG.md:1248`; em `6256ca9`, nas linhas `1993-1994`, `65`, `138` e `1249`, respectivamente.
- ID sem registro no git: `git log --all -S "PRODUCTION-PERMISSION-HARDENING"` vazio em `9c60845`; `git grep`
  vazio em `6256ca9`.
- Não consultado: banco local, PROD (inclusive os papéis dos usuários reais) e execução de testes.

## Escopo analisado

- Papéis, helpers de autorização, seeds e usuários de demonstração e de teste.
- Todas as mutações de Produção: OP (criar, editar, aplicar roteiro, planejar, liberar, cancelar), OP gerada pelo
  Pedido, reserva de produto acabado do Pedido, programação, roteiros, calendário, picking, substituição de lote,
  consumo, consumo extra, apontamento (output), conclusão, variância, pesagem, partes, lotes e ações de Qualidade
  relacionadas. Estoque e amostras entram como fronteira e precedente.
- Leituras (GET) de Produção.
- UI: menu, botões, ações, estados desabilitados e rotas.
- Auditoria (autor, motivo, histórico) de cada mutação crítica e a origem do `SYSTEM_ACTOR` no cancelamento.
- Testes existentes de autorização e de autoria; gaps.
- Compatibilidade de um endurecimento: usuários, UI, E2E, APIs internas, scripts, golden path, integrações.
- Plano de testes de API/web e de E2E adversarial.

Adjacentes, registrados sem auditoria completa: Formulações, Pedido, Ordem de Compra e recebimento.

## Estado atual

### Termos usados

- **OP**: Ordem de Produção. **PA**: produto acabado.
- **Porta direta da OP**: rotas `/production-orders` de criar, editar, aplicar roteiro, planejar, liberar e
  cancelar — distinta da OP que nasce do Pedido (Plano de Atendimento e saldo).
- **Execução da OP**: picking, substituição de lote, consumo, consumo extra, pesagem, confirmação de pesagem,
  conclusão de parte, apontamento, justificativa de variância e conclusão da OP.
- **`SYSTEM_ACTOR`**: constante `"Ambiente local"`, herdada da época sem usuários, gravada como autor quando o
  service não recebe o ator.

### Papéis

- `enum UserRole` (`apps/api/prisma/schema.prisma:106`): `ADMIN`, `PRODUCTION`, `QUALITY`, `PURCHASING`,
  `COMMERCIAL`, `VIEWER`. Padrão `VIEWER` (`schema.prisma:380`). Cada usuário tem um papel só; não existe
  permissão por usuário.
- Espelho em `packages/shared/src/users.ts:11-35` (`USER_ROLES`; rótulos Administrador, Produção, Qualidade,
  Compras, Comercial, Consulta).
- Usuários de seed, demonstração e teste:
  - `apps/api/prisma/seed-infra.ts:64-75` cria ou reativa o ADMIN local (`admin@veridi.local`);
  - `scripts/bootstrap-admin.ts` (`pnpm user:bootstrap-admin`) cria ADMIN e recusa um segundo ADMIN ativo com
    `NODE_ENV=production` (`:38-43`);
  - `scripts/seed-demo-users.ts` (`pnpm users:demo`) cria um usuário por papel em `@veridi.demo`, com trava em
    produção (`:28-34`, `:51`);
  - `pnpm db:seed` não cria usuário;
  - testes: `buildTestApp(role)` (`apps/api/src/test-support/authenticated-app.ts`) abre sessão real por papel;
  - E2E: o runner cria um ADMIN próprio (`scripts/e2e-run.mjs:489-500`); nenhuma suíte usa outro papel.
- Papéis dos usuários reais de PROD: **não lidos**.

### Autenticação e autorização

- `authenticationHook` global (`apps/api/src/app.ts:90`; `apps/api/src/lib/current-user.ts:55-83`): toda rota
  operacional exige sessão; sem sessão, 401 `not_authenticated`. Exceções: `/health`, `/auth/*` e arquivos
  estáticos do build.
- `requireCurrentUser(request)` (`current-user.ts:86`): devolve o usuário da sessão. Serve para obter o ator — o
  hook já barrou quem não tem sessão.
- `requireRole(request, ...roles)` (`current-user.ts:93`): lança `ForbiddenError` se o papel não estiver na lista.
  Não há hierarquia: ADMIN só passa quando está listado.
- A conversão de `ForbiddenError` em 403 é feita arquivo por arquivo, no `mapDomainError` de cada módulo de rotas.
  Existe em `production-orders`, `production-schedules`, `production-calendar`, `production-profiles`, `lots`,
  `quality`, `inventory` e `industrial-resources`. **Não existe** em `picking.routes.ts`, `production.routes.ts` e
  `recipe.routes.ts`.
- Listas de papéis repetidas por módulo: `OPERATION_ROLES` (`production-orders.routes.ts:59`),
  `READ_ROLES`/`WRITE_ROLES` (`production-schedules.routes.ts:40-41`, `production-calendar.routes.ts:42-43`,
  `production-profiles.routes.ts:50-51`), `STOCK_WRITE_ROLES` (`inventory.routes.ts:89`). No shared só existem
  `CONTROLLED_DOCUMENT_WRITE_ROLES` e `PRICING_PROVENANCE_ROLES`.
- Nenhum `requireRole` literal nem constante de papéis omite ADMIN: na prática ADMIN é superusuário por estar em
  todas as listas.
- Web:
  - `useAuth` / `useOptionalAuth` (`apps/web/src/app/AuthProvider.tsx:61,74`); cada página compara o papel na mão;
  - `apps/web/src/app/navigation.ts` aceita `roles` por item, usado só por Precificação (`:377`) e Usuários
    (`:393`);
  - atalhos do Painel filtrados por papel (`apps/web/src/pages/DashboardPage.tsx:258-276`);
  - 403 vira "Seu perfil não permite esta ação." (`apps/web/src/lib/api-errors.ts:161,180`);
  - nenhuma rota do `App.tsx` é protegida por papel (única exceção: `IndustrialResourceCreatePage.tsx:48`).

### Inventário das mutações

Caminhos de módulo relativos a `apps/api/src/modules/`.

**OP pela porta direta** — `production-orders/production-orders.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-orders` | `createProductionOrder` | `requireRole` antes do corpo (`:203`) | ADMIN, PRODUCTION | `createdBy` |
| `PATCH /production-orders/:id` | `updateProductionOrder` | idem (`:222`) | ADMIN, PRODUCTION | sem `updatedBy` (só `updatedAt`) |
| `POST /production-orders/:id/production-profile` | `applyProductionProfileToOrder` | idem (`:247`) | ADMIN, PRODUCTION | `planning.appliedBy` + `applicationReason` |
| `POST /production-orders/:id/plan` | `planProductionOrder` | idem (`:266`) | ADMIN, PRODUCTION | `plannedBy` |
| `POST /production-orders/:id/release` | `releaseProductionOrder` | idem (`:280`) | ADMIN, PRODUCTION | `releasedBy`; reserva `createdBy` |
| `POST /production-orders/:id/cancel` | `cancelProductionOrder(id, reason)` | idem (`:293`), mas o ator é descartado | ADMIN, PRODUCTION | `cancelledBy` e `reservation.releasedBy` = `"Ambiente local"`; `cancelReason` gravado |

**OP gerada pelo Pedido** — `customer-orders/fulfillment-plan.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /customer-orders/:id/apply-fulfillment-plan` | `applyFulfillmentPlan` | `requireCurrentUser` | qualquer sessão | OP `createdBy`; reserva de PA `createdBy` = `"Ambiente local"` (`fulfillment-plan.service.ts:405`) |
| `POST /customer-orders/:id/remainder-production-order` | `createRemainderProductionOrder` | `requireCurrentUser` | qualquer sessão | `createdBy` |

**Reserva de PA do Pedido** — `shipments/shipments.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /customer-orders/:id/reserve-available` (`:261`) | `reserveAvailable` | só o hook | qualquer sessão | `createdBy` = `"Ambiente local"` (`reservation-status.service.ts:192`) |
| `POST /customer-orders/:id/reallocate-reservation-line` (`:279`) | `reallocateReservationLine` | só o hook | qualquer sessão | `releasedBy` = `"Ambiente local"` (`reservation-status.service.ts:303`) |

**Programação** — `production-schedules/production-schedules.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-orders/:id/schedule/preview` | `previewProductionOrderSchedule` (não grava) | `WRITE_ROLES` (`:122`) | ADMIN, PRODUCTION | — |
| `PUT /production-orders/:id/schedule` | `scheduleProductionOrder` | `WRITE_ROLES` (`:136`) | ADMIN, PRODUCTION | `scheduledBy`/`scheduledAt` |
| `DELETE /production-orders/:id/schedule` | `unscheduleProductionOrder(id)` | `WRITE_ROLES` (`:150`) | ADMIN, PRODUCTION | exclusão física, sem autor |

**Roteiro de Produção** — `production-profiles/production-profiles.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-profiles` | `createProductionProfile` | `WRITE_ROLES` | ADMIN, PRODUCTION | `createdBy` |
| `PATCH /production-profiles/:id` | `updateProductionProfileIdentity` (sem ator) | `WRITE_ROLES` | ADMIN, PRODUCTION | sem autor |
| `PATCH /production-profile-versions/:id` (só rascunho) | `updateProductionProfileVersion` (sem ator) | `WRITE_ROLES` | ADMIN, PRODUCTION | sem autor |
| `POST /production-profile-versions/:id/activate` | `activateProductionProfileVersion` | `WRITE_ROLES` | ADMIN, PRODUCTION | `activatedBy`/`archivedBy` |
| `POST /production-profile-versions/:id/new-version` | `createProductionProfileVersionFrom` | `WRITE_ROLES` | ADMIN, PRODUCTION | `createdBy` |
| `PUT /products/:productId/production-profile` | `setProductProductionProfile` (sem ator) | `WRITE_ROLES` | ADMIN, PRODUCTION | sem autor |

**Calendário de Produção** — `production-calendar/production-calendar.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `PUT /production-calendar/weekdays/:weekday` | `updateProductionCalendarWeekday` | `WRITE_ROLES` | ADMIN, PRODUCTION | `updatedBy` |
| `POST /production-calendar/exceptions` | `createProductionCalendarException` | `WRITE_ROLES` | ADMIN, PRODUCTION | `createdBy`/`updatedBy` |
| `PATCH /production-calendar/exceptions/:id` | `updateProductionCalendarException` | `WRITE_ROLES` | ADMIN, PRODUCTION | `updatedBy` |
| `DELETE /production-calendar/exceptions/:id` | `deleteProductionCalendarException(id)` | `WRITE_ROLES` | ADMIN, PRODUCTION | exclusão física, sem autor |

**Picking e consumo** — `production-orders/picking.routes.ts` (valida o corpo ANTES de obter o ator)

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-orders/:id/picking/:reservationLineId/confirm` | `confirmPicking` | `requireCurrentUser` (`:164`) | qualquer sessão | `pickedBy` |
| `POST /production-orders/:id/picking/:reservationLineId/substitute` | `substituteReservationLine` | idem (`:188`) | qualquer sessão | linha original: `releasedBy` + `releaseReason` fixo "Substituição de lote no Picking"; linha nova: `pickedBy` + `replacesLineId` |
| `POST /production-orders/:id/picking/:reservationLineId/extra` | `addExtraReservation` | idem (`:212`) | qualquer sessão | `extraRequestedBy`/`extraRequestedAt` + `extraReason`; `pickedBy` |
| `POST /production-orders/:id/consumptions` | `recordConsumption` | idem (`:234`) | qualquer sessão | `consumedBy`; `InventoryMovement.createdBy`; `startedBy` da OP no primeiro consumo |

**Apontamento, conclusão e variância** — `production-orders/production.routes.ts` (valida o corpo antes do ator)

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-orders/:id/outputs` | `registerProductionOutput` | `requireCurrentUser` (`:120`) | qualquer sessão | `producedBy`; `Lot.createdBy`; movimento `createdBy` |
| `POST /production-orders/:id/complete` | `completeProductionOrder` | idem (`:137`) | qualquer sessão | `completedBy` + `completionReason`; reserva `releasedBy`; congela o custo industrial |
| `POST /production-orders/:id/requirements/:requirementId/variance` | `acceptMaterialVariance` | idem (`:162`) | qualquer sessão | `varianceAcceptedBy`/`varianceAcceptedAt` + `varianceReason` |

**Folha de Receita** — `production-orders/recipe.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /production-orders/:id/parts/:partNumber/weighings` | `registerWeighing` | `requireCurrentUser` (`:101`) | qualquer sessão | `executedByUserId` + nome; consumo `consumedBy`; `pickedBy`; parte `startedByUserId` + nome |
| `POST /production-orders/:id/weighings/:weighingId/confirm` | `confirmWeighing` | idem (`:114`) | qualquer sessão | `consumedBy` (idempotente) |
| `POST /production-orders/:id/parts/:partNumber/complete` | `completePart` | idem (`:126`) | qualquer sessão | `completedByUserId` + nome |

**Lote e Qualidade relacionada**

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /lots/:id/release` | `releaseLot` | `requireRole` (`lots/lots.routes.ts:111`) | QUALITY, ADMIN | `releasedBy` |
| `POST /lots/:id/block` | `blockLot` | `requireRole`, corpo validado antes (`:141`) | QUALITY, ADMIN | `blockedBy`/`blockedAt` + `blockReason` |
| `POST /lots/:id/unblock` | `unblockLot` | `requireRole`, corpo validado antes (`:78`) | QUALITY, ADMIN | desbloqueio anexado como texto em `blockReason`; zera `releasedBy`/`releasedAt` |
| `POST /lots/:id/coa/approve` e `POST /lots/:id/coa/reject` | `approveCoa` / `rejectCoa` | `requireRole` (`quality/quality.routes.ts:84,103`) | QUALITY, ADMIN | `coaReviewedByUserId` + nome; rejeitar bloqueia o lote com `blockedBy` |
| upload de anexo no contexto `lots` | — | `requireRole` (`attachments/attachments.routes.ts:85,117`) | PURCHASING, QUALITY, ADMIN | — |
| `POST /attachments/:id/archive` | — | `requireRole` (`attachments.routes.ts:166`) | QUALITY, ADMIN | — |

**Estoque (fronteira)** — `inventory/inventory.routes.ts`

| Rota | Service | Guard | Papéis | Autor gravado |
|---|---|---|---|---|
| `POST /inventory-adjustments` | `createInventoryAdjustment` | `requireRole` antes do corpo (`:165`) | ADMIN, PRODUCTION, QUALITY | `createdBy` |
| `POST /stock-counts` | `createStockCount` | `requireRole` antes do corpo (`:184`) | ADMIN, PRODUCTION, QUALITY | `createdBy` |

**Amostras (precedente de consumo fora da OP)** — `samples/samples.routes.ts`

| Rota | Guard | Papéis |
|---|---|---|
| `POST /project-samples/:id/consumptions` | `requireRole` (`:156`) | PRODUCTION, ADMIN |
| `POST /project-samples/:id/produce` | `requireRole` (`:174`) | PRODUCTION, ADMIN |

### Matriz atual das mutações

| Ação | ADMIN | PRODUCTION | QUALITY | PURCHASING | COMMERCIAL | VIEWER |
|---|---|---|---|---|---|---|
| OP direta: criar / editar / aplicar roteiro | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| OP: planejar / liberar / cancelar | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Programar / desprogramar / prévia | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Roteiros / padrão do produto / calendário | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| OP pelo Pedido (plano, saldo) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Reservar / realocar PA do Pedido | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Picking: confirmar / substituir lote | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Consumo / consumo extra | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Pesagem / confirmar pesagem / concluir parte | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Apontamento / variância / concluir OP | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Lote: liberar / bloquear / desbloquear | ALLOW | DENY | ALLOW | DENY | DENY | DENY |
| CoA: aprovar / rejeitar | ALLOW | DENY | ALLOW | DENY | DENY | DENY |
| Estoque: ajuste / contagem | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY |
| Amostra: consumir / produzir | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Leitura (todas as GET de Produção) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |

### Leitura (GET)

- Toda GET de Produção responde a qualquer sessão autenticada: `/production-orders`, `/production-orders/:id`
  (inclui reserva, consumos, apontamentos e lotes elegíveis), `/production-orders/:id/recipe`,
  `/production-orders/:id/schedule`, `/production-board`, `/production-profiles*`, `/production-calendar*`,
  `/finished-goods`, `/lots*`, `/lots/:id/traceability`, `/inventory*`, `/quality/coa-queue`,
  `/customer-orders/:id/fulfillment-plan` e `/customer-orders/:id/reservation-status`.
  `POST /production-orders/bulk/documents` e `POST /production-orders/bulk/export.csv` também são leitura.
- Roteiros, calendário e programação usam `READ_ROLES` com os seis papéis — equivale a qualquer sessão.
- O service da OP não expõe `costSnapshot` no DTO.
- Recomendação do discovery: não endurecer a leitura e não mexer no menu.

### UI

- **Com gate coerente com a API:**
  - "Nova OP" (`apps/web/src/pages/production-orders/ProductionOrdersPage.tsx:188,272`);
  - na OP: Salvar rascunho, Salvar observações, Planejar, Liberar, Cancelar, roteiro e programar
    (`ProductionOrderPage.tsx:296-297`, `:516-519`, `:2261-2284`; `ProductionPlanningSection.tsx:86,240,336`);
  - Quadro (`apps/web/src/pages/planning/ProductionBoardPage.tsx:81`), Calendário
    (`ProductionCalendarPage.tsx:170`), Roteiros (`ProductionProfilesPage.tsx:31`,
    `ProductionProfileDetailPage.tsx:570`), roteiro padrão no Produto
    (`apps/web/src/pages/products/ProductDefaultRouteSection.tsx:53`);
  - liberar, bloquear e desbloquear lote e CoA, com o motivo no lugar da ação
    (`apps/web/src/pages/lots/LotDetailPage.tsx:65`, `:634-689`);
  - atalhos do Painel.
- **Mostra ação que a API deveria negar** (detalhe em I2): 8 ações de execução na OP e 2 na Folha de Receita.
- **Mostra ação que a API já nega** (detalhe em I8): "Ajustar estoque" e Inventário Físico.
- Menu de Produção, Planejamento, Estoque e Qualidade visível a todos os papéis — coerente com a leitura aberta.
- Abrir uma tela pela URL é permitido; o que some é a ação. O padrão atual é o correto para leitura aberta.
- `canOperate` trata sessão ausente (fora do `AuthProvider`, só em teste) como permitido. Recomendação do
  discovery: manter.
- A fila `/producao/picking` (`PickingConsumptionPage.tsx`) só lista e abre a OP; não tem ação própria.

### Cobertura de testes existente

**API**

- `production-orders/production-orders-permissoes.test.ts`: COMMERCIAL, VIEWER, QUALITY e PURCHASING recebem 403
  em criar, editar, aplicar roteiro, planejar, liberar, cancelar e criar com corpo vazio, e a OP fica intacta.
  PRODUCTION cria, edita, aplica roteiro, planeja e cancela. `appliedBy` conferido com igualdade exata (`:164`).
- `customer-orders/fulfillment-plan.test.ts:527-600`: Comercial aplica o Plano sem roteiro; 403 ao planejar
  (`:596-597`).
- `production-profiles/production-profiles.test.ts:329-337` e `:699-705`: VIEWER recebe 403 ao criar roteiro e ao
  trocar o padrão do produto; lê com 200.
- `production-calendar/production-calendar.test.ts:792-811`: VIEWER lê; 403 ao salvar dia e cadastrar exceção.
- `lots/lots.test.ts:326-341`: COMMERCIAL, PURCHASING, PRODUCTION e VIEWER recebem 403 ao liberar e bloquear lote;
  `:450-457`: COMMERCIAL recebe 403 ao desbloquear.
- `quality/quality-documents.test.ts:361-379`: PURCHASING recebe 403 na decisão de CoA.
- `inventory/adjustment-audit.test.ts:106-149`: VIEWER recebe 403 em ajuste e contagem; PRODUCTION ajusta (201);
  autor diferente de "Ambiente local" (`:100`).
- `samples/samples.test.ts:713-750`: papéis nas ações de amostra.
- `auth/auth.test.ts:128-134`: rota operacional sem sessão responde 401; `:217-250`: só ADMIN administra
  usuários.
- Autoria com igualdade exata: `gmp-execution.test.ts:530`, `planning-snapshot.test.ts:256,519`,
  `production-orders-permissoes.test.ts:164`.
- Autoria fraca (`not.toBeNull()` / `toBeTruthy()`, passa mesmo com "Ambiente local"): `picking.test.ts:213`,
  `consumption.test.ts:243`, `production-output.test.ts:763`, `production-orders.test.ts:438`,
  `production-orders-release.test.ts:229`, `extra-consumption.test.ts:337`, `material-reconciliation.test.ts:302`,
  `lots.test.ts:360`.
- Papéis usados pelas suítes de execução: `picking`, `consumption`, `extra-consumption`, `production-output`,
  `material-reconciliation` e `production-orders-release` rodam só com ADMIN (padrão do `buildTestApp`);
  `gmp-execution` usa PRODUCTION (13 casos) e ADMIN (2).

**Web**

- `apps/web/src/pages/production-orders/planejamento-previsto.test.tsx:669-695`: COMMERCIAL não vê Aplicar roteiro
  padrão atual, Escolher outro roteiro, Planejar OP, Salvar rascunho nem Cancelar OP.
- `apps/web/src/pages/products/produto-roteiro-padrao.test.tsx:55`: PRODUCTION.
- Menu com VIEWER: `apps/web/src/app/planning-navigation.test.tsx:186`, `sidebar-navigation.test.tsx:346,404`.

**E2E**

- Nenhuma suíte com papel diferente de ADMIN (decisão G).

## Findings

### I1 — Execução da OP aberta a qualquer sessão [BUG para VIEWER; regra não escrita para os demais]

São 10 mutações que só exigem sessão: 4 de picking (confirmar, substituir, consumo extra, consumo), 3 da Folha de
Receita (pesagem, confirmar pesagem, concluir parte) e 3 de apontamento, variância e conclusão. Um VIEWER
("Consulta") consegue baixar estoque, ampliar reserva sobre saldo livre, criar lote de PA (que nasce AVAILABLE
quando o item não exige liberação nem CoA) e concluir OP, o que congela o custo.

Contradiz três portas vizinhas:

- planejar, liberar e cancelar a MESMA OP exige ADMIN/PRODUCTION;
- o gate de estoque trata VIEWER como leitura por definição (`inventory.routes.ts:81-85`) e nega ajuste e
  contagem;
- consumir e produzir amostra exige PRODUCTION/ADMIN (`samples.routes.ts:156,174`).

Para VIEWER é bug. Para COMMERCIAL, QUALITY e PURCHASING é regra implícita nunca escrita
(`production-orders.routes.ts:55-57`: o Pedido gera a necessidade; como fabricar é da Produção). Decisão: P1.

### I2 — UI oferece as ações de execução a qualquer papel [UI]

- `apps/web/src/pages/production-orders/ProductionOrderPage.tsx`:
  - "Escanear / Informar lote" e "Confirmar separação" (`:1629-1649`);
  - diálogo de uso do lote diferente, que substitui a reserva (`:2456-2464`);
  - "Confirmar consumo" (`:1756`);
  - "Adicionar consumo extra" (`:1769`);
  - "Registrar produção" (`:1974`);
  - "Justificar diferença" (`:1380-1381`);
  - "Concluir OP" (`:2353`).
- `apps/web/src/pages/production-orders/RecipeSheetPage.tsx`: "Confirmar pesagem" (`:496`) e "Concluir parte"
  (`:506`). A página nem chama `useAuth`.

Essas ações dependem só do status da OP. A mesma tela já esconde Salvar, Planejar, Liberar e Cancelar com
`canOperate` (`:296-297`, `:516-519`). Hoje a API aceita, então não aparece 403; depois de endurecer a API sem
mexer na UI, os botões passariam a devolver 403.

### I3 — Cancelar OP grava `SYSTEM_ACTOR` [BUG]

- **Quem inicia:** ADMIN ou PRODUCTION, em `POST /production-orders/:id/cancel`. A rota chama `requireRole`
  (`production-orders.routes.ts:293`), descarta o usuário devolvido e chama
  `cancelProductionOrder(id, parsed.data.reason)` (`:300`).
- **O que fica gravado:** `cancelProductionOrder` (`production-orders.service.ts:1503`) grava
  `cancelledBy = SYSTEM_ACTOR` (`:1539`) e, se a OP estava RELEASED, `materialReservation.releasedBy =
  SYSTEM_ACTOR` (`:1528`). `SYSTEM_ACTOR = "Ambiente local"` (`:100`).
- **Por quê:** a assinatura é anterior aos usuários — o comentário da constante (`picking.service.ts:39`) ainda diz
  que não havia autenticação nem usuários. PRODUCTION-ROUTE-ASSIGNMENT-01 acrescentou o gate e não trocou a
  assinatura.
- **Perde autoria:** sim. A tela mostra `cancelledBy` (DTO, `production-orders.service.ts:730`) como "Ambiente
  local"; a reserva liberada também. O motivo (`cancelReason`, `releaseReason`) é preservado.
- **Correção proposta:** a rota passa `{ id, name }` do ator; o service passa a exigir o ator; `cancelledBy` e
  `reservation.releasedBy` recebem `actor.name`. Sem migration (as colunas `String?` já existem). Sem backfill:
  não existe fonte para a autoria antiga.
- **Teste proposto:** PRODUCTION cancela uma OP liberada e confere `cancelledBy` e `reservation.releasedBy` com
  igualdade exata ao nome do usuário de teste; voltar `SYSTEM_ACTOR` precisa quebrar o teste.

### I4 — OP gerada pelo Pedido e reserva de PA abertas a qualquer sessão [REGRA NÃO DEFINIDA]

O PO decidiu, em PRODUCTION-ROUTE-ASSIGNMENT-01, que a OP que nasce do Pedido segue "aberta ao Comercial". O
código abre a qualquer sessão: VIEWER, PURCHASING e QUALITY aplicam o Plano de Atendimento, criam OP e reservam
PA. `reserve-available` e `reallocate-reservation-line` nem obtêm o ator e gravam "Ambiente local". Decisão: P3.

### I5 — 400 antes de 403 [PADRÃO]

`picking.routes.ts`, `production.routes.ts`, `recipe.routes.ts` e `lots.routes.ts` (block e unblock) validam o
corpo antes de conferir o papel: papel errado com corpo inválido recebe 400. O padrão da OP é 403 antes da
validação (`production-orders.routes.ts:197-200`; teste `production-orders-permissoes.test.ts:132-133`).

### I6 — `ForbiddenError` não tratado nas rotas de execução [ARMADILHA DE IMPLEMENTAÇÃO]

`picking.routes.ts`, `production.routes.ts` e `recipe.routes.ts` não convertem `ForbiddenError` em 403 no
`mapDomainError`. Um `requireRole` acrescentado sem esse tratamento responde **500**.

### I7 — Ator opcional com fallback silencioso [ARMADILHA DE IMPLEMENTAÇÃO]

Os services de execução aceitam `actor?` e caem em `SYSTEM_ACTOR` se ele faltar (`picking.service.ts:68,122,245,363,384`;
`production.service.ts:46,228,285`). As rotas passam o ator hoje, mas um chamador novo sem ator gravaria "Ambiente
local" sem aviso. `recipe.service.ts` já exige `actor: User`.

### I8 — UI de estoque oferece ação que a API já nega [UI ESTOQUE]

"Ajustar estoque" (`apps/web/src/pages/inventory/InventoryItemDetailPage.tsx:245`) e o Inventário Físico
(`StockCountPage.tsx`) não têm gate de papel. A API nega PURCHASING, COMMERCIAL e VIEWER, então o botão devolve 403
hoje. Decisão: P5.

### I9 — Lacunas de auditoria [AUDITORIA]

- Sem autor: `DELETE` da programação (exclusão física), `PUT` do padrão do produto, `PATCH` de identidade e de
  rascunho do roteiro, `DELETE` de exceção do calendário (exclusão física).
- `ProductionOrder` não tem `updatedBy`.
- Variância: `acceptMaterialVariance` monta a entrada com `varianceReason: null` (`production.service.ts:250-254`) e
  `unreconciledQuantity` ignora a justificativa; justificar de novo sobrescreve motivo, autor e data da
  justificativa anterior, sem histórico.
- Lote: desbloquear zera `releasedBy`/`releasedAt` (`lots.service.ts:351-353`) e registra o desbloqueio só como
  texto anexado a `blockReason`; um novo bloqueio sobrescreve `blockedBy`/`blockedAt`.

### I10 — Gate de programação sem teste de 403 [TESTE]

`production-schedules.test.ts` só usa ADMIN; preview, PUT e DELETE não têm caso de papel negado.

### I11 — Formulações e outros pontos com `SYSTEM_ACTOR` [ADJACENTE, fora de Produção]

- `formulations/formulations.routes.ts` não usa `requireRole` nem `requireCurrentUser`; criar, ativar e inativar
  versão grava `SYSTEM_ACTOR` (`formulations.service.ts:397,507,751,757`). A OP congela essa versão.
- O mesmo `SYSTEM_ACTOR` aparece ao confirmar e cancelar Pedido (`customer-orders.service.ts:880,991`) e na OC
  (`purchase-orders.service.ts:467,489`).
- Registrar ID próprio. Decisão: P8.

## Regras / contratos existentes

**Regras documentadas**

- `docs/PRODUCT_RULES.md`, bloco do roteiro na OP (PRODUCTION-ROUTE-ASSIGNMENT-01): quem opera a OP pela porta
  direta é Produção e Administração — criar, editar, aplicar ou trocar roteiro, planejar, liberar e cancelar, com
  403 para os demais antes da validação do corpo. A OP que nasce do Pedido segue a rota do Plano de Atendimento e
  do saldo, aberta ao Comercial.
- `docs/PRODUCT_RULES.md` §89: o roteiro padrão do Produto é definido, trocado e removido por Produção e
  Administração.
- `docs/PRODUCT_RULES.md`, "Durable rules — quality decisions on a lot": liberar, bloquear e desbloquear lote são
  decisões QUALITY/ADMIN; a tela não oferece a ação aos demais papéis e mostra o motivo.
- `docs/BACKLOG.md` §C.7 (decisões aguardando negócio com a Veridi): "permissões detalhadas por papel".
- `docs/E2E_STRATEGY.md`: seção "E2E 04 — Adversarial" (só caminhos proibidos de alto valor que não cabem em teste
  menor; COMMERCIAL e PRODUCTION entram aqui) e decisão G do PO (o runner usa ADMIN próprio da execução).
- Regras das suítes E2E (`scripts/e2e/README.md` e `docs/E2E_STRATEGY.md`): massa própria carimbada com `runId`,
  pré-condição por API, negativos na mesma suíte, console e rede limpos (recusa provocada declarada com
  `esperarErroHttp`), sem estado entre execuções.
- `CLAUDE.md`: ambiguidade que afeta permissões é pergunta ao PO, não escolha de implementação.

**Contratos em código (sem decisão formal registrada)**

- Autoria: quem executou vem sempre da sessão, nunca de campo enviado pelo frontend
  (`apps/api/src/lib/current-user.ts:7-13`).
- `requireRole` é gate simples de perfil, sem matriz por botão (`current-user.ts:92`).
- Roteiros, calendário e programação: escrita ADMIN/PRODUCTION; os demais leem (comentários das três rotas).
- Estoque: ajuste e contagem ADMIN/PRODUCTION/QUALITY; o próprio comentário declara o conjunto como o menor gate
  defensável e a matriz fina como pauta de produto (`inventory.routes.ts:74-89`).
- CoA: aprovar e rejeitar é QUALITY/ADMIN; Compras anexa documento, mas não decide (`quality.routes.ts:51-56`).
- Amostras: consumir e produzir é PRODUCTION/ADMIN.
- Menu: `roles` por item espelha o gate de leitura da API; a entrada some só onde a tela devolveria 403
  (`navigation.ts:26-33`).

## Gaps

- **G1** Execução (10 mutações): nenhum teste de papel — nem 403, nem prova de que nada foi gravado.
- **G2** Programação (preview, PUT, DELETE): nenhum 403.
- **G3** Sem sessão: só o caso genérico do hook (`auth.test.ts:128`); basta um caso por arquivo de rota novo.
- **G4** ADMIN: coberto de forma implícita, porque o `buildTestApp` usa ADMIN por padrão.
- **G5** PRODUCTION: picking, consumo, apontamento, variância, conclusão e liberação nunca rodaram como PRODUCTION
  (só a Folha de Receita usa PRODUCTION).
- **G6** COMMERCIAL, QUALITY, PURCHASING e VIEWER: nenhum caso na execução.
- **G7** Autoria: 8 conferências fracas; o cancelamento não tem nenhuma.
- **G8** Web: nenhum teste de papel nas ações de execução da OP nem na Folha de Receita.
- **G9** A ordem 403 antes do 400 não é provada nas rotas de execução.

## Riscos

**Severidade dos findings**

- **ALTA** — I1: execução da OP aberta a toda sessão (estoque, lote de PA, custo congelado, trilha GMP).
- **MÉDIA** — I3 (cancelamento sem autoria), I4 (OP pelo Pedido e reserva de PA abertas a toda sessão), I11
  (Formulações, adjacente).
- **MÉDIA-BAIXA** — I2 e I8 (UI oferecendo ação negada ou a negar).
- **BAIXA** — I5 (400 antes de 403), I9 (autoria faltante ou sobrescrita), I10 e G7 (testes fracos).
- **Armadilhas de implementação** (sem severidade de produto) — I6 (`ForbiddenError` não tratado vira 500) e I7
  (ator opcional).

**Impacto de compatibilidade de um endurecimento (Opção A)**

- **Usuários existentes:** quem hoje executa OP sem ser ADMIN ou PRODUCTION passa a receber 403. PROD tem usuários
  reais desde a carga inicial (2026-09-14); a distribuição de papéis não foi lida — confirmar antes de publicar
  (P6).
- **UI:** 10 botões somem para quem não opera (8 na OP, 2 na Folha de Receita). Menu igual; mensagem de 403 já
  existe.
- **E2E atual:** tudo roda como ADMIN (runner, `scripts/e2e/fixtures/api.mjs`, golden path) — sem quebra.
- **Testes de API:** as suítes de execução usam ADMIN (padrão) ou PRODUCTION (`gmp-execution`) — sem quebra
  esperada. O COMMERCIAL de `samples.test.ts` usa `/project-samples`, rota que não muda.
- **Testes web:** as páginas da OP rodam sem sessão (fallback permitido) ou como ADMIN; os testes com VIEWER são de
  lista — sem quebra.
- **APIs internas:** o consumo chamado pela Folha de Receita (`recordConsumptionInTx`) fica coberto pelo gate da
  rota; `createDraftProductionOrderInTx`, usado pelo Pedido, não muda.
- **Scripts:** nenhum script fora de `scripts/e2e` chama rota de Produção por HTTP; importador e APPLY usam Prisma —
  sem impacto.
- **Clientes integrados:** não existem (só sessão por cookie, sem token de API).
- **Golden path:** roda como ADMIN — sem impacto.
- **Deploy:** PROD só muda quando `release/prod` for movida.
- **Histórico:** cancelamentos antigos continuam com "Ambiente local".

## Cenários relevantes

1. VIEWER confirma picking e consumo de uma OP liberada: o estoque baixa e a OP passa a IN_PRODUCTION — aceito hoje.
2. VIEWER pede consumo extra: a reserva cresce sobre estoque livre — aceito hoje.
3. VIEWER registra apontamento de item que não exige liberação: nasce lote de PA disponível — aceito hoje.
4. VIEWER conclui a OP: a reserva é liberada e o custo industrial fica congelado — aceito hoje.
5. COMMERCIAL, QUALITY ou PURCHASING fazem o mesmo — aceito hoje; regra nunca escrita (P1).
6. PRODUCTION cancela uma OP liberada: OP e reserva ficam com autor "Ambiente local".
7. VIEWER aplica o Plano de Atendimento do Pedido, cria OP e reserva PA; a reserva fica sem ator (P3).
8. Implementação ingênua: `requireRole` nas rotas de execução sem tratar `ForbiddenError` responde 500; papel errado
   com corpo inválido recebe 400 em vez de 403.
9. Deploy do endurecimento com operadores usando conta de outro papel: 403 no chão de fábrica no dia do deploy (P6).
10. Justificar de novo a variância de um material sobrescreve a justificativa anterior; desbloquear lote apaga quem
    o havia liberado.
11. COMMERCIAL vê hoje os botões de execução e consegue executar; depois de endurecer só a API, veria 403. Em
    "Ajustar estoque" isso já acontece hoje.

## Alternativas consideradas

- **Opção A — Produção opera; ADMIN superusuário por lista explícita; demais leem.** ADMIN e PRODUCTION executam
  tudo o que é operacional; QUALITY, PURCHASING, COMMERCIAL e VIEWER só leem a Produção. **Recomendada.**
- **Opção B — A + QUALITY justifica variância** (e, se o PO quiser, conclui a OP).
  - A favor: o desvio de material fica assinado pela Qualidade.
  - Contra: duas áreas donas da mesma decisão.
- **Opção C — negar só VIEWER.**
  - A favor: nenhum operador fica travado no deploy.
  - Contra: Comercial e Compras continuam baixando estoque e concluindo OP.
- **Opção D — papel novo para o chão de fábrica.**
  - Exige migration, tela de usuários e E2E. **Não recomendada agora.**

## Recomendação

Adotar a **Opção A** no núcleo, com a matriz abaixo.

| Ação | ADMIN | PRODUCTION | QUALITY | PURCHASING | COMMERCIAL | VIEWER |
|---|---|---|---|---|---|---|
| **PRODUÇÃO** | | | | | | |
| Ler OP, fila, quadro, roteiro, Folha de Receita | ALLOW | ALLOW | READ ONLY | READ ONLY | READ ONLY | READ ONLY |
| OP direta: criar / editar / aplicar roteiro | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| OP: planejar / liberar / cancelar | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Programar / desprogramar / prévia | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Roteiros / padrão do produto / calendário | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Picking: confirmar / substituir lote | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Consumo real | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Consumo extra | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Pesagem / confirmar pesagem | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Concluir parte | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Apontamento | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| Justificar variância | ALLOW | ALLOW | DENY (P2) | DENY | DENY | DENY |
| Concluir OP | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| **COMERCIAL × PRODUÇÃO (fora do núcleo; P3)** | | | | | | |
| OP pelo Pedido (plano, saldo) | ALLOW | P3 | P3 | P3 | ALLOW | DENY |
| Reservar / realocar PA do Pedido | ALLOW | P3 | P3 | P3 | ALLOW | DENY |
| **ESTOQUE (API sem mudança)** | | | | | | |
| Ler posição, movimentos, lotes | ALLOW | ALLOW | ALLOW | READ ONLY | READ ONLY | READ ONLY |
| Ajuste / contagem | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY |
| **QUALIDADE (sem mudança)** | | | | | | |
| Lote: liberar / bloquear / desbloquear | ALLOW | DENY | ALLOW | DENY | DENY | DENY |
| CoA: aprovar / rejeitar | ALLOW | DENY | ALLOW | DENY | DENY | DENY |
| Anexar laudo em lote | ALLOW | DENY | ALLOW | ALLOW | DENY | DENY |

- Compras (OC e recebimento): N/A nesta capability. O recebimento hoje aceita qualquer sessão — registrar.
- Comercial (Pedido criar, confirmar, cancelar): N/A nesta capability. Hoje aberto; confirmar e cancelar gravam
  `SYSTEM_ACTOR`.

**Como implementar a recomendação**

- `requireRole(ADMIN, PRODUCTION)` antes da validação do corpo nas 10 rotas de execução.
- Tratar `ForbiddenError` como 403 nos três arquivos de rota (`picking`, `production`, `recipe`).
- Uma lista única, `PRODUCTION_OPERATION_ROLES`, no shared (mesmo padrão de `CONTROLLED_DOCUMENT_WRITE_ROLES`),
  usada por API e web.
- ADMIN continua listado explicitamente, sem atalho escondido no helper — nenhuma exceção a ADMIN foi encontrada.
- Cancelamento com autoria (correção de I3), sem backfill.
- UI: `canOperate` nas 8 ações de execução da OP e nas 2 da Folha de Receita; fila e leitura intactas.
- Não endurecer leitura e não mexer no menu.

**Respostas recomendadas às perguntas não bloqueantes:** P2 a, P3 c, P4 a, P5 a, P7 a, P8 a.

## Decisões já tomadas

**Confirmadas (PO ou regra documentada)**

1. PRODUCTION-ROUTE-ASSIGNMENT-01 (PO): a porta direta da OP (criar, editar, aplicar roteiro, planejar, liberar,
   cancelar) é de Produção e Administração, com 403 antes da validação do corpo. A OP que nasce do Pedido segue
   aberta ao Comercial.
2. O roteiro padrão do Produto é definido, trocado e removido por Produção e Administração (`PRODUCT_RULES.md` §89).
3. Liberar, bloquear e desbloquear lote são decisões QUALITY/ADMIN, e a tela mostra o motivo no lugar da ação.
4. E2E (decisão G do PO, 2026-09-14): o runner usa ADMIN próprio; COMMERCIAL e PRODUCTION ficam para a suíte
   adversarial (E2E 04).
5. A matriz detalhada de permissões por papel ainda não foi decidida: segue em `BACKLOG.md` §C.7 como decisão
   aguardando negócio com a Veridi.

**Contratos em código, sem decisão formal do PO**

- Roteiros, calendário e programação: escrita ADMIN/PRODUCTION, leitura para todos.
- Estoque: ajuste e contagem ADMIN/PRODUCTION/QUALITY, declarado no código como gate mínimo.
- CoA: QUALITY/ADMIN. Amostras: PRODUCTION/ADMIN.

**Recomendações deste discovery (NÃO decididas)**

- Opção A para a execução da OP.
- Respostas P2 a, P3 c, P4 a, P5 a, P7 a, P8 a.
- Não endurecer leitura nem menu; lista única no shared; ADMIN sempre explícito.
- Corrigir a autoria do cancelamento sem backfill.
- E2E adversarial de Produção como onda separada.

## Decisões PO pendentes

- **P1 — BLOQUEANTE.** Quem executa (picking, consumo, consumo extra, pesagem, parte, apontamento, variância,
  conclusão)?
  - A) só ADMIN + PRODUCTION; demais só leitura **[recomendado]**
  - B) A + QUALITY na variância (e opcionalmente na conclusão)
  - C) todos, menos VIEWER
- **P2** — Quem justifica variância de material?
  - a) ADMIN + PRODUCTION **[recomendado]**
  - b) ADMIN + PRODUCTION + QUALITY
  - c) só QUALITY + ADMIN
- **P3** — OP gerada pelo Pedido e reserva de PA (`apply-fulfillment-plan`, `remainder-production-order`,
  `reserve-available`, `reallocate-reservation-line`), hoje abertas a qualquer sessão:
  - a) fechar para ADMIN + COMMERCIAL nesta capability
  - b) ADMIN + COMMERCIAL + PRODUCTION
  - c) capability comercial própria, registrada no BACKLOG **[recomendado]**
- **P4** — Cancelamentos antigos gravados como "Ambiente local":
  - a) deixar como estão **[recomendado]**
  - b) exibir "autor não registrado" na tela
  - Preencher o passado não é possível: não há fonte da autoria antiga.
- **P5** — "Ajustar estoque" e Inventário Físico mostram botão que já devolve 403:
  - a) esconder nesta capability, sem regra nova **[recomendado]**
  - b) capability separada
- **P6 — BLOQUEANTE.** Os operadores da Veridi entram com conta PRODUCTION própria?
  - a) sim — a Opção A é segura
  - b) não (conta de outro papel ou compartilhada) — trocar os papéis antes do deploy, ou usar a Opção C por um
    tempo
- **P7** — Autoria da execução:
  - a) nome em texto, como hoje **[recomendado; sem migration]**
  - b) userId + nome, como na Folha de Receita (migration aditiva)
- **P8** — Formulações sem gate e com `SYSTEM_ACTOR`:
  - a) abrir ID próprio agora **[recomendado]**
  - b) deixar para depois

## Plano recomendado de implementação

### Pré-condições

- Respostas a P1 e P6.
- Antes de publicar: conferir os papéis dos usuários reais de PROD (não lidos neste discovery).
- As linhas citadas valem para `9c60845`; conferir no código atual.

### Núcleo — PRODUCTION-PERMISSION-HARDENING-01

Com a Opção A (ou a matriz escolhida em P1):

- API: `requireRole(ADMIN, PRODUCTION)` antes da validação do corpo nas 10 rotas de execução
  (`picking.routes.ts`: confirm, substitute, extra, consumptions; `production.routes.ts`: outputs, complete,
  variance; `recipe.routes.ts`: weighings, weighing confirm, part complete).
- API: tratar `ForbiddenError` como 403 no `mapDomainError` desses três arquivos.
- Shared: lista única `PRODUCTION_OPERATION_ROLES`, usada pela API e pela web.
- Cancelamento: a rota passa o ator; `cancelProductionOrder` exige o ator; `cancelledBy` e `reservation.releasedBy`
  recebem o nome do usuário.
- Web: `canOperate` nas 8 ações de execução de `ProductionOrderPage.tsx` e nas 2 de `RecipeSheetPage.tsx`.
- Testes: plano abaixo.
- Docs: `PRODUCT_RULES.md`, `PROJECT_STATE.md`, `TEST_COVERAGE_MAP.md` e `BACKLOG.md` (registrar o ID).

### Opcionais, conforme as respostas

- Ator obrigatório em `picking.service.ts` e `production.service.ts` (I7).
- `lots.routes.ts`: 403 antes do corpo em block e unblock (I5).
- UI de estoque: esconder "Ajustar estoque" e Inventário Físico para quem a API nega (P5 a).

### Migration

**NO.** As colunas `*By` já existem e o enum fica intacto. Vira YES só com a Opção D (papel novo) ou P7 b (userId
na execução).

### Plano de testes (API e integração carregam a matriz extensa)

- Novo `apps/api/src/modules/production-orders/execucao-permissoes.test.ts`: cada uma das 10 mutações contra
  COMMERCIAL, QUALITY, PURCHASING e VIEWER responde 403 `forbidden`, também com corpo vazio, e uma releitura prova
  que nada foi gravado (consumos, movimentos, lotes, apontamentos, `pickedAt`, status, `varianceReason`). Mensagem
  própria em cada `expect`, porque o `it.each` agrupa falhas iguais num diff só.
- Cadeia completa como PRODUCTION: liberar, picking, consumo, consumo extra, pesagem, parte, apontamento,
  variância e conclusão, com autoria exata em cada campo (`pickedBy`, `consumedBy`, movimento `createdBy`,
  `startedBy`, `extraRequestedBy`, `executedByNameSnapshot`, `completedByNameSnapshot`, `producedBy`,
  `Lot.createdBy`, `varianceAcceptedBy`, `completedBy`, `reservation.releasedBy`).
- ADMIN: um caso por grupo.
- Sem sessão: um 401 por arquivo de rota.
- Cancelamento: autoria exata na OP e na reserva.
- Programação: VIEWER e COMMERCIAL recebem 403 em preview, PUT e DELETE, e a programação fica intacta.
- Mutações a provar: remover o `requireRole` de uma rota quebra o caso correspondente; remover o tratamento de
  `ForbiddenError` quebra com 500; voltar `SYSTEM_ACTOR` quebra o teste de autoria.
- Web (Vitest/RTL): `ProductionOrderPage` em RELEASED e IN_PRODUCTION com COMMERCIAL e VIEWER não mostra nenhuma
  das 8 ações; com PRODUCTION mostra. `RecipeSheetPage` idem.

### Onda separada — E2E adversarial de Produção (dentro da E2E 04 e da decisão G)

Os cenários pressupõem o núcleo implementado (gate na API e na UI).

- Suíte sugerida: `scripts/e2e/producao-por-perfil.mjs`, rodando no `pnpm e2e:run` (clone novo por execução; os
  usuários criados somem com o clone).
- Pré-requisito: `abrirNavegador` aceitar credenciais (`scripts/e2e/lib/browser.mjs:49` chama `autenticar()` sem
  parâmetros; `scripts/e2e/fixtures/api.mjs:119-122` já aceita `{ email, password }`).
- Massa por API com o ADMIN da execução: usuários COMMERCIAL e PRODUCTION carimbados com `runId` (`POST /users`),
  produto, formulação, roteiro (`scripts/e2e/fixtures/producao.mjs`), matéria-prima com lote disponível e OP
  liberada.
- **Cenário 1 — ação invisível:** COMMERCIAL abre a OP liberada pela URL, lê os dados e não vê Planejar, Liberar,
  Cancelar nem as ações de execução; a Folha de Receita não mostra "Confirmar pesagem" nem "Concluir parte".
- **Cenário 2 — 403 real e não gravação:** com a sessão do COMMERCIAL, um POST de consumo (um endpoint
  representativo, não todos) recebe 403 declarado com `esperarErroHttp`; GET de conferência prova OP, consumos e
  saldo intactos.
- **Cenário 3 — troca de usuário:** fecha o contexto COMMERCIAL e abre PRODUCTION; a mesma OP mostra as ações;
  picking, consumo, apontamento e conclusão pela tela.
- **Cenário 4 — autoria:** a tela mostra "Conferido · <nome do usuário PRODUCTION>" e a conclusão com o nome do
  usuário; o cancelamento de outra OP pela tela mostra o autor, não "Ambiente local".
- Console limpo e nenhum 4xx/5xx não declarado.
- Fora do navegador: cruzar cada endpoint com cada papel fica nos testes de API.

## Arquivos / áreas provavelmente afetados

**API**

- `apps/api/src/modules/production-orders/picking.routes.ts`
- `apps/api/src/modules/production-orders/production.routes.ts`
- `apps/api/src/modules/production-orders/recipe.routes.ts`
- `apps/api/src/modules/production-orders/production-orders.routes.ts` (cancelamento com ator; lista compartilhada)
- `apps/api/src/modules/production-orders/production-orders.service.ts` (`cancelProductionOrder` com ator)
- Opcional: `apps/api/src/modules/production-orders/picking.service.ts` e `production.service.ts` (ator
  obrigatório)
- Opcional: `apps/api/src/modules/lots/lots.routes.ts` (403 antes do corpo em block e unblock)

**Shared**

- Lista `PRODUCTION_OPERATION_ROLES` em `packages/shared/src`

**Web**

- `apps/web/src/pages/production-orders/ProductionOrderPage.tsx`
- `apps/web/src/pages/production-orders/RecipeSheetPage.tsx`
- Opcional (P5): `apps/web/src/pages/inventory/InventoryItemDetailPage.tsx` e `StockCountPage.tsx`

**Testes**

- Novo `apps/api/src/modules/production-orders/execucao-permissoes.test.ts`
- `apps/api/src/modules/production-schedules/production-schedules.test.ts` (403)
- Novos testes web de papel na OP e na Folha de Receita

**Docs**

- `docs/PRODUCT_RULES.md`, `docs/PROJECT_STATE.md`, `docs/TEST_COVERAGE_MAP.md`, `docs/BACKLOG.md` (registrar o ID)

**E2E (onda separada)**

- `scripts/e2e/lib/browser.mjs` (credenciais por parâmetro)
- Nova suíte em `scripts/e2e` e usuário por papel via `POST /users`

## Fora do escopo

- Endurecer leitura e esconder menu de Produção, Planejamento, Estoque e Qualidade (recomendação: não fazer).
- OP gerada pelo Pedido e reserva de PA do Pedido — depende de P3 (recomendação: capability comercial própria).
- Pedido (criar, confirmar, cancelar), Ordem de Compra e recebimento — N/A nesta capability; registrados como
  abertos a qualquer sessão, com `SYSTEM_ACTOR` em pontos de Pedido e OC.
- Formulações sem gate e com `SYSTEM_ACTOR` — depende de P8 (recomendação: ID próprio).
- Papel novo para o chão de fábrica (Opção D).
- Preencher a autoria antiga ("Ambiente local") — sem fonte.
- userId + nome na execução (P7 b; exigiria migration).
- Lacunas de auditoria de I9 (remoção de programação, padrão do produto, rascunho de roteiro, exceção do
  calendário, `updatedBy` da OP, sobrescrita da variância, `releasedBy` apagado no desbloqueio) — registradas, não
  fazem parte do núcleo recomendado.
- Consulta a PROD e execução de testes neste discovery.

## Critérios de pronto

Derivados do plano de testes, da recomendação e da lista de arquivos deste discovery (o relatório original não
trazia uma lista formal de critérios).

**Núcleo (PRODUCTION-PERMISSION-HARDENING-01)**

- As 10 mutações de execução respondem 403 `forbidden` aos papéis fora da matriz escolhida em P1, antes da
  validação do corpo, e não gravam nada.
- Nenhuma rota de execução responde 500 por `ForbiddenError`.
- PRODUCTION executa a cadeia completa com autoria exata; ADMIN é aceito em cada grupo; sem sessão, 401.
- Cancelar OP grava o nome do usuário em `cancelledBy` e em `reservation.releasedBy`.
- Programação: 403 provado em preview, PUT e DELETE.
- UI: as 8 ações da OP e as 2 da Folha de Receita ficam ocultas fora da matriz e visíveis para PRODUCTION; leitura
  e menu intactos.
- Mutações provadas: remover `requireRole`, remover o tratamento de `ForbiddenError` ou voltar `SYSTEM_ACTOR`
  quebra teste.
- Sem migration.
- `PRODUCT_RULES.md`, `PROJECT_STATE.md`, `TEST_COVERAGE_MAP.md` e `BACKLOG.md` atualizados.
- Papéis dos usuários reais conferidos antes de publicar (P6).

**Onda E2E adversarial**

- Os 4 cenários na suíte, com massa por API carimbada com `runId`, 403 declarado, console limpo e execução pelo
  `pnpm e2e:run`.

## Próxima capability recomendada

1. **PRODUCTION-PERMISSION-HARDENING-01** — o núcleo, depois das respostas a P1 e P6.
2. **E2E adversarial de Produção por perfil** (E2E 04) — onda separada; os cenários pressupõem o núcleo.
3. Sem ID definido, a registrar se o PO confirmar: capability comercial para OP gerada pelo Pedido e reserva de PA
   (P3 c) e capability de Formulações (P8 a).

## Relatório original consolidado

Detalhes por tema do relatório final do discovery que não couberam nas seções acima.

### Picking

- Confirmar, substituir e consumo extra: basta sessão, qualquer papel; o corpo é validado antes; `ForbiddenError`
  não tratado.
- Autor gravado só como nome (`pickedBy`, `releasedBy`, `extraRequestedBy`), sem userId.
- A substituição preserva a genealogia (`replacesLineId`), mas o motivo é fixo: o operador não explica a troca de
  lote.
- UI: ações na OP sem `canOperate`. A fila `/producao/picking` só lista e abre a OP.
- Testes: `picking.test.ts` roda tudo como ADMIN; `pickedBy` só com `not.toBeNull()` (`:213`); nenhum caso de papel.
- Classificação: bug para VIEWER; demais papéis dependem de P1 (recomendação DENY).

### Consumo

- O consumo direto e o consumo pela pesagem (`recordConsumptionInTx`, `picking.service.ts:380`) geram
  `ProductionConsumption` e `InventoryMovement` `PRODUCTION_CONSUMPTION` e passam a OP para IN_PRODUCTION
  (`startedBy`). Qualquer papel.
- O consumo extra amplia a reserva sobre estoque livre, com motivo obrigatório e autor. Qualquer papel.
- Precedentes em sentido contrário: ajuste e contagem de estoque ADMIN/PRODUCTION/QUALITY; consumo de amostra
  PRODUCTION/ADMIN.
- Testes: `consumption.test.ts` e `extra-consumption.test.ts` só como ADMIN; `startedBy` (`:243`) e
  `extraRequestedBy` (`:337`) só com `not.toBeNull()` / `toBeTruthy()`.

### Output (apontamento)

- Cria `Lot` com origem PRODUCTION (`createdBy`), `ProductionOutput.producedBy` e movimento
  `FINISHED_GOOD_PRODUCTION`. O lote nasce AVAILABLE quando o item não exige liberação nem CoA. Qualquer papel.
- UI "Registrar produção" sem gate. Testes: `production-output.test.ts` só como ADMIN; nenhum caso de papel.

### Conclusão

- Leva a OP de IN_PRODUCTION para COMPLETED. Exige apontamento e material reconciliado, libera a reserva
  remanescente (`releasedBy` do ator, `releaseReason` `PRODUCTION_COMPLETED`), grava `completedBy` e
  `completionReason` quando produziu menos, e congela o custo industrial. Não tem volta. Qualquer papel.
- UI "Concluir OP" sem gate. Testes: `completedBy` só com `not.toBeNull()` (`production-output.test.ts:763`);
  nenhum caso de papel.

### Variância

- Grava `varianceReason` e `varianceAcceptedBy`/`varianceAcceptedAt` no requisito. É aceita em RELEASED e
  IN_PRODUCTION (a UI só oferece em IN_PRODUCTION). Destrava a conclusão com material não gasto — decisão de
  responsável. Qualquer papel. Justificar de novo sobrescreve (I9).
- Teste: `material-reconciliation.test.ts:302` com `toBeTruthy()`; nenhum caso de papel. Quem pode justificar: P2.

### Pesagem

- `RecipeWeighing` guarda `executedByUserId` + nome — a melhor trilha da execução. Consome na mesma transação,
  confere a linha de picking se estiver pendente e inicia a parte. A confirmação é idempotente.
- Qualquer papel; `RecipeSheetPage` sem gate.
- Testes: `gmp-execution.test.ts` usa PRODUCTION e confere a autoria exata (`:530`); nenhum caso de papel negado.

### Partes

- As partes nascem no RELEASE (ADMIN/PRODUCTION). Concluir parte grava `completedByUserId` + nome e exige pesagem
  de toda matéria-prima planejada para a parte. Qualquer papel.
- Testes: `gmp-execution.test.ts`; nenhum caso de papel negado.

### Planejar

- ADMIN/PRODUCTION, 403 antes do corpo, grava `plannedBy`. API, UI (`isPlannable` com `canOperate`) e testes
  coerentes: `production-orders-permissoes.test.ts` (4 papéis com 403, PRODUCTION 200),
  `fulfillment-plan.test.ts:596-597` (COMMERCIAL 403) e `planejamento-previsto.test.tsx:669-695`. Nada a corrigir.

### Liberar

- OP: ADMIN/PRODUCTION; grava `releasedBy`, cria a reserva (`createdBy`), a numeração oficial e as partes. O 403 dos
  4 outros papéis tem teste; PRODUCTION liberando com sucesso não tem.
- Lote (Qualidade): QUALITY/ADMIN; testado em `lots.test.ts:326-341` e `:450-457`; a UI mostra o motivo no lugar do
  botão (`LotDetailPage.tsx:634-689`). Coerente.

### Cancelar

- O gate ADMIN/PRODUCTION está correto e testado; o botão respeita `canOperate` (`isCancellable`). A autoria se
  perde (I3). Nenhum teste confere quem cancelou.

### Roteiro e programação

- Escrita só ADMIN/PRODUCTION; leitura com `READ_ROLES` dos 6 papéis (= qualquer sessão).
- UI coerente: `ProductionProfilesPage.tsx:31`, `ProductionProfileDetailPage.tsx:570`,
  `ProductionCalendarPage.tsx:170`, `ProductionBoardPage.tsx:81`, `ProductDefaultRouteSection.tsx:53`,
  `ProductionPlanningSection.tsx:86`.
- Testes: roteiro (`production-profiles.test.ts:329-337`, `:699-705`) e calendário
  (`production-calendar.test.ts:792-811`) com VIEWER; programação sem nenhum teste de 403.
- Auditoria: remoção de programação e troca do padrão do produto sem autor.

### Auditoria por mutação crítica (autor / motivo / histórico)

| Mutação | Autor | Motivo | Histórico |
|---|---|---|---|
| Cancelamento da OP | PERDIDO ("Ambiente local"); reserva `releasedBy` PERDIDO | OK (`cancelReason`; `releaseReason` = motivo) | só o estado final, sem tabela de eventos |
| Substituição de lote | OK, nome (`releasedBy`, `pickedBy`) | FIXO ("Substituição de lote no Picking") | OK (linha nova + `replacesLineId`) |
| Consumo extra | OK (`extraRequestedBy`) | OK, obrigatório (`extraReason`) | OK (linha nova; original intocada) |
| Variância | OK (`varianceAcceptedBy`) | OK (`varianceReason`) | SOBRESCRITO a cada nova justificativa |
| Liberação de lote | OK (`releasedBy`) | — | desbloqueio apaga `releasedBy`/`releasedAt`; novo bloqueio sobrescreve `blockedBy`/`blockedAt` |
| Conclusão da OP | OK (`completedBy`; reserva `releasedBy`) | OK quando produziu menos (`completionReason`) | — |
| Apontamento | OK (`producedBy`, `Lot.createdBy`, movimento `createdBy`) | — | — |
| Pesagem e partes | OK (userId + nome) | — | — |
| Picking e consumo | OK, nome (movimento `createdBy` = `consumedBy`) | — | — |
| Planejar, liberar, aplicar roteiro | OK (`plannedBy`, `releasedBy`, `appliedBy`) | `applicationReason` no roteiro | — |
| Programação | gravar OK (`scheduledBy`); remover sem autor | — | remoção é exclusão física |

- `ProductionOrder` não tem `updatedBy`.
- Quase todo autor é texto (`String?`); userId existe só na Folha de Receita, nas partes, na revisão de CoA e nos
  documentos controlados.

### READY_TO_IMPLEMENT (conclusão original)

YES, depois das respostas a P1 e P6. Escopo do núcleo: gate ADMIN + PRODUCTION nas 10 mutações (403 antes do corpo),
autoria no cancelamento, UI da OP e da Folha de Receita e os testes do plano. Sem migration. As demais perguntas têm
resposta recomendada e não bloqueiam.

### Estado da rodada

- Somente leitura: nenhum arquivo do repositório alterado, nenhum teste, banco, migration, commit, push ou acesso a
  PROD durante o discovery.
- Worktrees de outras sessões presentes na máquina não foram tocados.

## Implementação

**NÃO IMPLEMENTADO.**

## Histórico de decisões

- 2026-09-19 — decisões do PO em [AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md)
  (registradas por PRODUCT-BACKLOG-CONSOLIDATION-01). **P3 respondida:** Plano de Atendimento, OP do saldo, reservar e
  realocar PA com ADMIN + COMMERCIAL (decisão 6). **P4 respondida:** os cancelamentos antigos com "Ambiente local" ficam
  como estão, sem backfill (decisão 8). **P8 absorvida** por AUTHZ-VIEWER-READONLY-01 e AUTHORSHIP-SESSION-ACTOR-01. O
  VIEWER de I1 sai para AUTHZ-VIEWER-READONLY-01 (VIEWER é somente leitura operacional) e a autoria de I3 e I7 para
  AUTHORSHIP-SESSION-ACTOR-01 (usuário da sessão; ator obrigatório no service dos módulos tocados). Seguem abertas P1 e
  P6 — o perfil final de quem executa a OP, com a Veridi —, P2, P5 e P7; até o perfil final, vale o provisório "todos
  menos VIEWER" (decisão 10). O status segue `EM_ANALISE`.
