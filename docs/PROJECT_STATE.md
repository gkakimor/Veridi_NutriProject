# Veridi Nutrition — Project State

## Version
Baseline v0.4 — post-benchmark.

## Phase
FAST MVP.

---

# Current implemented state

**Delivery 01 — bootstrap do monorepo: concluído.**
**Delivery 02 — Cadastro de Itens (Bloco A): concluído.**
**Delivery 03 — Cadastro de Clientes e Fornecedores (Bloco A): concluído.**
**Delivery 04 — Veridi UI design system v2: concluído.**
**Delivery 05 — Cadastro de Produtos: concluído.**
**Delivery 06 — Ordem de Compra: concluído.**
**Delivery 07 — Recebimento + Lote Interno: concluído.**
**Delivery 08 — QR Code + Etiqueta de Lote + Scan/Consulta: concluído.**
**Delivery 09 — Estoque + Movimentações + Inventário Físico: concluído.**
**Delivery 10 — FEFO (sugestão e alocação de lotes): concluído.**
**Delivery 11 — Formulações + Versionamento (+ hardening de Item): concluído.**
**Delivery 12 — Ordem de Produção + Cálculo de Necessidade de Materiais: concluído.**
**Delivery 13 — Material Reservation + Release da Ordem de Produção: concluído.**
**Delivery 14 — Picking + Consumo Real de Materiais: concluído.**
**Delivery 15 — Produção Parcial + Produto Acabado + Rastreabilidade: concluído.**
**Delivery 16 — Pedido do Cliente + Plano de Atendimento (Bloco D): concluído.**
**Delivery 17 — Sugestão de Compra + Geração de OC DRAFT (Bloco D, capacidade 26): concluído.**
**Delivery 18 — Separação + Expedição (Bloco D, capacidade 27): concluído.**
**Delivery 19 — Faturamento (Bloco D, capacidade 28): concluído — Bloco D funcionalmente encerrado.**
**Delivery 20 — Fundação de Custos (capacidade 29): concluído.**
**Delivery 21 — Dashboard operacional (Bloco E, capacidade 30): concluído
— inclui a correção de consistência da tela Produção → Produto Acabado.**
**Delivery 22 — QR de Produto Acabado + Conferência de lote na Expedição:
concluído (fechamento operacional Produto Acabado → identificação física →
Expedição).**
**Delivery 23 — Relatórios gerenciais e operacionais R-01…R-17 (Bloco E,
capacidade 31): concluído.**
**Delivery 24 — Exportações CSV + Impressão/PDF (Bloco E, capacidade 32):
concluído — Bloco E encerrado.**
**Delivery 25 — Cadastros Industriais v2 (Bloco F, capacidade 33):
concluído.**
**Delivery 26 — Formulação Industrial v2 (Bloco F, capacidade 34):
concluído — dose, pureza e overage; base DEV reconstruível a partir do
corpus real (fora do repositório).**
**Delivery 27 — Material de propriedade do cliente (Bloco F, capacidade
35): concluído — dono do estoque físico, recebimento sem OC, FEFO/reserva
por proprietário.**
**Delivery 28 — GMP: usuários, documentos controlados, OP industrial e
Folha de Receita (Bloco F, capacidade 36): concluído — o sistema passa a
ter identidade real de usuário e execução de produção por parte.**
**Delivery 29 — Qualidade documental / CoA / Anexos (Bloco F, capacidade
37): concluído — laudo por lote com estado próprio, anexos auditáveis e
fila da Qualidade.**
**Delivery 30 — Projetos + Orçamentos versionados (Bloco F, capacidade
38): concluído — o funil private label entra no sistema, com aprovação
convertendo projeto em Produto.**
**Delivery 31 — Amostras / pilotos / testes Tn (Bloco F, capacidade 39):
concluído — amostra com identidade própria, consumo real de material com
tipo de movimento próprio e decisão separada da aprovação comercial.**
**Delivery 32 — Item × Fornecedor / homologação / MOQ / preços (Bloco F,
capacidade 40): concluído — relação Item×Supplier com homologação por item,
fornecedor preferencial e histórico imutável de preços.**
**Delivery 33 — Importador definitivo das planilhas (Bloco F, capacidade
41): concluído — pipeline validate/plan/apply/verify, findings com
severidade, overrides explícitos e abertura de estoque por lote real.**
**Delivery 34 — UX de aderência operacional + impressão profissional (Bloco
F, capacidade 42): concluído — Bloco F encerrado.**
**Delivery 35 — Estrutura de custos industriais (Bloco G, capacidade 43):
concluído — estrutura versionada de premissas, sem cálculo de CMV.**
**Delivery 36 — Recursos industriais / equipamentos / energia / mão de obra
(Bloco G, capacidade 44): concluído — recurso e uso do recurso separados,
tarifa histórica imutável e snapshot econômico congelado na ativação.**

**Mudança oficial de roadmap (16/08/2026).** A comparação entre o sistema e
as planilhas reais mostrou que a Veridi opera como **terceirização/private
label** e que faltavam capacidades no domínio. Ordem nova: **Bloco F
(33-42)** e **Bloco G (43-47)** vêm ANTES da Demo Readiness. Ao concluir o
Bloco G o trabalho PARA: o **Bloco H (regulatório/rotulagem) é um gate** e
só será especificado após nova validação de domínio/regulatória do Product
Owner. Demo Readiness, responsivo/mobile e hardening geral não foram
iniciados. O core 1-32 continua sendo a fundação — as novas capacidades
evoluem o modelo, não o substituem.

Decisão durável: baseline visual v2 (tokens `--v-green-*`/`--v-lime`/
`--ok`/`--warn`/`--err`, `--font-ui`/`--font-code` sem CDN) é o padrão
oficial de identidade. Para telas CRUD simples (list + create/edit) o
padrão é `FullWorkspaceModal` — aplicado em Itens, Fornecedores, Clientes,
Produtos. Para **documentos transacionais** o padrão é **página própria
dentro do workspace** (não modal) — aplicado em Ordem de Compra,
Recebimento, Formulação (editor de versão) e Ordem de Produção (agora com
Picking/Consumo Real embutidos). Rota de impressão (etiqueta de lote) é
um terceiro padrão: página fora do `AppShell`, sem topbar/sidebar. Ver
`docs/UI_BRAND.md`.

Bloco C completo (Formulações + Versionamento + OP + Requirement
Calculation + Reservation + QR Picking + Actual Consumption + Partial
Production/conclusão da OP + Finished Product + Rastreabilidade
bidirecional). Bloco D **completo** (22-28: Pedido do Cliente, Plano de Atendimento,
Reserva de Produto Acabado, OPs Sugeridas, Sugestão de Compra, Expedição,
Faturamento) + **Fundação de Custos (29)**. **Bloco E completo: Dashboard (30),
Relatórios (31) e Exportações CSV/Impressão (32).** Só falta Usuários
(Bloco A) dentro do escopo MVP travado; o próximo passo é a **validação
ponta a ponta / demo**.

## Stack instalada

| Camada | Versão |
| --- | --- |
| Node.js | 22 LTS |
| pnpm | 10.28 |
| PostgreSQL | 16 |
| React | 19 |
| Vite | 6 |
| Fastify | 5 |
| Prisma | 6 |
| TypeScript | 5.9 (strict) |

## Estrutura criada

```text
apps/web        React + Vite + TS strict, shell operacional Veridi (sidebar
                 vira overlay em mobile), Cadastros >
                 Itens/Fornecedores/Clientes/Produtos, Compras > Ordens de
                 Compra/Recebimentos, Estoque > Visão Geral (Reservado real,
                 inclui Produto Acabado automaticamente)/ Lotes (scan/QR/
                 etiqueta, origem RECEIPT/PRODUCTION, rastreabilidade
                 backward/forward)/Movimentações/Inventário Físico,
                 Produção > Formulações (histórico de versões + editor
                 DRAFT) / Ordens de Produção (lista + documento
                 DRAFT/PLANNED/RELEASED/IN_PRODUCTION/COMPLETED/CANCELLED,
                 seções Materiais Reservados/Picking/Consumo Real/Produção
                 [apontamentos parciais + conclusão]/Origem [Pedido do
                 Cliente, quando aplicável]) / Picking / Consumo (lista
                 RELEASED/IN_PRODUCTION) / Produto Acabado (consulta
                 read-only dos lotes produzidos: produzido, On Hand/
                 Reserved/Available, qualidade, validade e custo material
                 unitário + Etiqueta/QR), Comercial > Pedidos (lista +
                 documento DRAFT/CONFIRMED/IN_FULFILLMENT/
                 PARTIALLY_SHIPPED/SHIPPED/CANCELLED, seções Produtos
                 [expedido/falta expedir]/Plano de Atendimento [editável
                 antes de aplicar]/Sugestão de Compra [quantidade+
                 fornecedor editáveis]/Reserva de Produto Acabado
                 [complementar + Preparar Expedição]/Expedições/Ordens de
                 Compra Vinculadas/Reservas de Produto Acabado [com
                 realocação]/Faturamento [progresso + documentos]/OPs
                 Geradas) + Expedições (lista + documento DRAFT/CONFIRMED/
                 CANCELLED, separação agrupada por produto com progresso
                 e conferência de lote por linha, bloco read-only
                 pós-confirmação com auditoria de conferência, seção
                 Faturamento) + Faturamento (lista
                 "Aguardando faturamento" + documentos, documento próprio
                 DRAFT/ISSUED/CANCELLED com preço opcional), Gestão >
                 Relatórios (hub R-01…R-17 agrupado por domínio + uma
                 página por relatório, filtros server-side, paginação e
                 links para os documentos)
apps/api        Fastify + TS strict, Prisma; /health, /items, /units,
                 /suppliers, /customers, /products, /purchase-orders (+
                 /confirm, /cancel), /receipts, /lots (+ /lots/lookup,
                 /lots/:id/traceability), /inventory, /inventory-movements,
                 /inventory-adjustments, /stock-counts,
                 /inventory/:itemId/allocation-suggestion (FEFO/FIFO,
                 ciente de Reserved), /formulations,
                 /products/:id/formulations, /formulation-versions,
                 /production-orders (+ /plan, /release, /cancel,
                 /picking/:lineId/confirm, /picking/:lineId/substitute,
                 /consumptions, /outputs, /complete), /customer-orders (+
                 /confirm, /cancel, /fulfillment-plan,
                 /apply-fulfillment-plan, /purchase-suggestion,
                 /purchase-drafts, /shipments, /reservation-status,
                 /reserve-available, /reallocate-reservation-line),
                 /shipments (+ /lines/:lineId/verify, /confirm, /cancel),
                 /billings (+ /awaiting,
                 /issue, /cancel), /receipt-lines/:id/acquisition-cost,
                 /items/:id/cost-reference,
                 /formulation-versions/:id/cost-estimate,
                 /production-orders/:id/material-cost, /finished-goods,
                 /dashboard (read model único do cockpit),
                 /reports/* (+ `all=true` para o resultado filtrado
                 completo usado na impressão),
                 */export.csv (30 exportações: 15 listagens + 15
                 relatórios tabulares, sempre o resultado filtrado
                 inteiro),
                 /reports/* (17 read models somente leitura: inventory/
                 position|expiry|movements, production/requirements|
                 planned-actual|traceability|consumption, purchasing/
                 orders|receipts|on-order|late, commercial/orders|
                 fulfillment|order-operation, billing/period|awaiting|
                 order-delivered-billed)
packages/shared contratos compartilhados (Health, Item [operationallyUsed],
                 UnitOfMeasure, Supplier, Customer, Product, PurchaseOrder
                 [origin MANUAL/CUSTOMER_ORDER, customerOrderId/Code],
                 Receipt, Lot [origin RECEIPT/PRODUCTION, businessLotNumber,
                 producedQuantity, qrPayload, onHand/reserved/available
                 real], InventoryMovement [PRODUCTION_CONSUMPTION,
                 FINISHED_GOOD_PRODUCTION], AllocationSuggestion,
                 FormulationVersion/Component, ProductionOrder/Requirement
                 [outputs, eligibleFinishedLots, producedQuantity/
                 remainingQuantity, completedAt/By/Reason, origin inclui
                 CUSTOMER_ORDER, customerOrderId/customerOrderLineId],
                 MaterialReservation/Line [Picking/substituição],
                 ProductionConsumption, ProductionOutput, LotTraceabilityDTO
                 [FINISHED_GOOD backward / RAW_MATERIAL forward],
                 CustomerOrder/Line [snapshot no CONFIRM,
                 linkedPurchaseOrders], CustomerOrderReservation/Line
                 [Produto Acabado, FEFO], FulfillmentPlanDTO/
                 MaterialImpactRowDTO, PurchaseSuggestionDTO/
                 PurchaseSuggestionRowDTO [remainingRequired/ownReserved/
                 globalReserved/available/onOrder/operationalShortage/
                 draftPurchaseQuantity/suggestedAdditionalPurchase/
                 newSuggestedPurchase], Shipment/ShipmentLine [DRAFT/
                 CONFIRMED/CANCELLED, reservedRemaining, snapshot],
                 ReservationStatusDTO [stillToReserve/
                 suggestedAdditionalReserve], Billing/BillingLine [DRAFT/
                 ISSUED/CANCELLED, unitPrice opcional, totalAmount +
                 hasCompletePricing], AwaitingBillingRowDTO,
                 CustomerOrderBillingStatus derivado, CostReferenceDTO
                 [CostSource REAL/ESTIMATED_30D/ESTIMATED_90D/
                 LAST_REAL_COST/NO_COST], FormulationCostEstimateDTO,
                 ProductionOrderMaterialCostDTO [CostQuality REAL/
                 ESTIMATED/PARTIAL/NO_COST], CNPJ, UFs)
```

Raiz: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`,
`.env.example`.

## Decisões técnicas do bootstrap

- Gerenciador oficial: **pnpm workspace**. Sem npm workspaces, Yarn, Bun.
- Sem Turborepo/Nx. `pnpm dev` usa `concurrently` para subir web + api.
- Sem framework de UI. CSS próprio com tokens (`apps/web/src/styles/tokens.css`).
- Roteamento por `react-router-dom` — necessário para deep-link de lote/QR,
  que está no escopo do MVP.
- `@fastify/cors` liberado em desenvolvimento; restrito a `WEB_ORIGIN` em produção.
- Prisma Client com inicialização preguiçosa: falha de conexão vira
  `database: "down"` em `/health`, não derruba o processo.
- Tabela técnica `_bootstrap_probe` removida na migration `items_and_uom`
  (primeira migration de domínio real), conforme planejado.

## Ambiente local (Windows)

Setup manual equivalente a `scripts\bootstrap-local.ps1` concluído em
2026-08-15: Git, Node 24, pnpm 10.28, PostgreSQL 16 instalados; role/database
`veridi_dev` criados (instalador silencioso do Postgres não define senha do
superuser — precisou de `trust` temporário em `pg_hba.conf`, revertido para
`scram-sha-256` em seguida); `.env` local criado. Sem pendência de ambiente.

`git init` + origin + push para `https://github.com/gkakimor/Veridi_NutriProject.git`
(branch `main`) feito nesta mesma sessão.

---

# Delivery 02 — Cadastro de Itens

Primeiro slice CRUD real do MVP (Bloco A). Define o padrão visual/técnico
para os próximos cadastros (Usuários, Clientes, Fornecedores, Produtos).

## Modelo de dados

- `Item`: `id` (uuid), `code` (único, imutável), `type`
  (`RAW_MATERIAL`/`PACKAGING`/`FINISHED_PRODUCT`), `name`, `unitCode` (FK),
  `controlsLot`, `controlsExpiry`, `externalBarcode?`, `active`,
  `createdAt`/`updatedAt`. Sem exclusão física.
- `UnitOfMeasure`: `code`, `label`, `dimension` (`MASS`/`COUNT`/`VOLUME`),
  `toBaseFactor`. Sem tela administrativa — seed controlado pelo backend
  (`prisma/seed.ts`): mg/g/kg, un, mL/L.
- Migration `20260815090000_items_and_uom` também remove `_bootstrap_probe`.

## Geração de código interno (MP-000001 / ME-000001 / PA-000001)

Uma **sequence Postgres por tipo** (`item_code_raw_material_seq`,
`item_code_packaging_seq`, `item_code_finished_product_seq`). `nextval` é
atômico — seguro contra concorrência, sem `MAX(code)+1`. Código nunca é
aceito do cliente; gerado sempre no `POST /items`, imutável depois.

## Conversão de unidade (fundação)

`apps/api/src/modules/items/uom.ts` — `convertUom(quantidade, de, para,
unidades)` converte dentro da mesma dimensão via fator para a unidade-base;
rejeita dimensões incompatíveis (ex.: kg → un). Testada, mas ainda não
exposta em nenhuma rota — não há cálculo de formulação no MVP ainda.

## Backend

`GET /items` (search/type/active/page/pageSize), `GET /items/:id`,
`POST /items`, `PATCH /items/:id`, `POST /items/:id/activate`,
`POST /items/:id/deactivate`. Validação com Zod. `GET /units` (somente
leitura, popula o select do formulário). Defaults de `controlsLot`/
`controlsExpiry` por tipo ficam em `@veridi/shared` (`ITEM_TYPE_DEFAULTS`) —
aplicados pelo backend quando o cliente omite, editáveis antes de salvar.

## Frontend

Cadastros → Itens: tabela densa (código/nome/tipo/unidade/lote/validade/
status/ações) + toolbar de busca (debounced) e filtros de tipo/status +
paginação. Drawer contextual à direita para criar/editar (única ação
primária: Salvar); código somente leitura na edição. Inativação via
confirmação nativa (`window.confirm`), sem exclusão. Novo
`apps/web/src/styles/components.css` (botões, tabela, badge, drawer, campo)
— reutilizável pelos próximos cadastros.

## Testes

16 testes em `apps/api` (contra o Postgres de dev real, mesmo padrão do
`health.test.ts`): geração de código por tipo, unicidade (constraint de
banco), validações obrigatórias, unidade inexistente rejeitada, inativar/
reativar sem exclusão, busca por código/nome/barcode, filtros de tipo/status,
mais 5 testes puros de `convertUom` (mg→g, g→kg, mL→L, dimensão incompatível,
unidade desconhecida).

## Validação

`pnpm typecheck`/`build`/`test` — ok. Seed rodado (2 matérias-primas, 2
embalagens). Tela verificada visualmente via Playwright headless (screenshot
+ `console --errors` limpo): listagem, drawer de criação com defaults
corretos, busca filtrando em tempo real.

## Pendente (não bloqueante)

- Confirmação de inativação usa `window.confirm` nativo — trocar por modal
  Veridi se/quando o padrão de confirmação for definido para outras telas.

---

# Delivery 03 — Clientes e Fornecedores

Segundo e terceiro cadastros do Bloco A, reaproveitando o padrão
técnico/visual de Items (drawer contextual + tabela densa).

## Correção em Items

PATCH aceitava `externalBarcode` vazio no schema (o backend já convertia
`""` para `null`), mas o drawer só enviava a chave quando havia valor —
campo limpo na UI nunca chegava ao PATCH. Corrigido em
`ItemFormDrawer.tsx`: no modo edição a chave é sempre enviada (mesmo
vazia); no create, só quando preenchida. Teste adicionado em
`items.test.ts`.

## Modelo de dados

- `Supplier`/`Customer`: `id` (uuid), `code` (único, imutável, sequence
  dedicada), `legalName`, `tradeName?`, `cnpj?` (só dígitos, unicidade via
  índice parcial — não representável em `@@unique` do Prisma, mesmo caso
  das sequences), `email?`, `phone?`, `notes?`, `active`, `createdAt`,
  `updatedAt`. `Customer` soma `city?`/`state?` (UF maiúscula validada
  contra lista fechada). Migration `20260815120000_customers_and_suppliers`.
- Códigos `FOR-000001`/`CLI-000001`: `lib/sequence-code.ts` generaliza a
  lógica de `nextval` atômico já usada em Items — `item-codes.ts` virou um
  wrapper fino sobre ela. Reuso de infraestrutura, sem fundir os domínios
  (não existe `Party`/`BusinessEntity`; Supplier e Customer são módulos
  separados com schema/service/routes próprios).

## Padrão de campo opcional "limpável"

`lib/cnpj-schema.ts` define `optionalNullableText`/`optionalCnpjSchema`:
chave ausente no PATCH → não mexe; string vazia → `null` (limpa); valor →
seta. Serviços usam o mesmo idiom de `input.campo !== undefined ? {...} :
{}` de Items, que distingue `undefined`/`null`/valor sob
`exactOptionalPropertyTypes`. Aplicado desde o início em Suppliers/
Customers para não repetir o bug corrigido em Items.

## CNPJ e UF

`@veridi/shared` ganhou `normalizeCnpj`/`formatCnpj` (só dígitos ↔
`00.000.000/0000-00`) e `BR_STATE_CODES`, usados por API e web. Validação
de CNPJ é só formato básico (14 dígitos) — sem dígito verificador nem
consulta à Receita, conforme escopo. Duplicidade de CNPJ: pré-checagem via
`findFirst` (mensagem amigável) + captura de `P2002` no `create`/`update`
como rede de segurança contra corrida (a garantia real de unicidade é o
índice parcial no Postgres).

## Backend

`GET/POST /suppliers`, `GET/PATCH /suppliers/:id`,
`POST /suppliers/:id/activate|deactivate` — mesmo shape para `/customers`
(com filtro extra `state`). Sem DELETE físico.

## Frontend

Cadastros → Fornecedores / Clientes: mesma tabela densa + drawer
contextual de Items. `components.css` ganhou estilo de `textarea` (campo
Observações), reaproveitado pelos dois formulários. Nenhuma abstração de
formulário genérico criada — duplicação pequena entre os dois drawers foi
aceita conforme orientação do handoff.

## Testes

18 novos testes (`suppliers.test.ts` + `customers.test.ts`): geração de
código, imutabilidade do código, validações obrigatórias, normalização de
CNPJ, rejeição de formato inválido, duplicidade de CNPJ, busca, filtro
ativo/UF, inativar/reativar. Mais 1 teste em `items.test.ts` para o fix do
barcode. Total da API: 35 testes.

## Validação

`pnpm typecheck`/`build`/`test` — ok. Seed rodado (2 fornecedores, 2
clientes). Telas verificadas visualmente via Playwright headless
(screenshot + console sem erros): listagem de Fornecedores e Clientes,
drawer de novo fornecedor preenchido, Items intacto.

## Pendente (não bloqueante)

- Resolvido no Delivery 05: `window.confirm` substituído por `ConfirmDialog`.

---

# Delivery 05 — Cadastro de Produtos

Quinto cadastro do Bloco A — encerra o Bloco A exceto Usuários. Primeiro
módulo a introduzir relações opcionais entre entidades (Product → Customer,
Product → Item).

## Modelagem: Product ≠ Item

`Item` continua sendo a entidade física controlada em estoque (inclusive o
`FINISHED_PRODUCT` correspondente). `Product` é a definição comercial/
industrial — é a ela que Formulações e Ordens de Produção pertencerão no
futuro. Nunca fundidos numa entidade só.

- `Product`: `id`, `code` (único, imutável, sequence `product_code_seq`,
  prefixo `PROD`), `name`, `customerId?` → `Customer`, `finishedProductItemId?`
  → `Item`, `externalCode?`, `notes?`, `active`, `createdAt`/`updatedAt`.
- `finishedProductItemId` é `@unique` mesmo sendo nullable — Postgres aceita
  múltiplos `NULL` num índice unique, então a garantia 1:1 (um Item
  FINISHED_PRODUCT pertence a no máximo um Product) sai de graça, sem
  precisar do truque de índice parcial usado para CNPJ.
- Migration `20260816090000_products`.

## Regras de vínculo (Customer/Item)

Vínculo **novo** (create, ou PATCH mudando para um id diferente) exige que o
Customer esteja ativo e que o Item seja `FINISHED_PRODUCT` ativo e ainda não
associado a outro Product. Vínculo **inalterado** (mesmo id reenviado no
PATCH) não é revalidado — é assim que a associação histórica sobrevive a uma
inativação posterior do Customer/Item, sem forçar o usuário a desvincular
para editar outro campo. `products.service.ts` compara o valor novo com o
atual antes de decidir se valida.

## Frontend

Cadastros → Produtos: mesmo padrão de Itens (tabela densa clicável, modal
fullscreen com `FormSection`/`FullWorkspaceModal`). Selects de Cliente/Item
carregam só ativos (`?active=true&pageSize=100`); se o Product editado já
aponta para um Customer/Item inativado, ele é injetado manualmente nas
opções (marcado "(inativo)") para não sumir do formulário. Sem
autocomplete/lib de select — lista simples, estruturada para trocar por
busca assíncrona depois sem mexer em regra de domínio.

## ConfirmDialog

Componente único (`components/ConfirmDialog.tsx`) substitui `window.confirm`
nas 4 telas (Items, Suppliers, Customers, Products) para a ação Inativar.
Mensagem contextual deixa explícito que não há exclusão física e que o
histórico é preservado. Reativar não pede confirmação (ação reversível e já
óbvia na UI).

## Testes

19 novos testes (`products.test.ts`): geração de código, imutabilidade,
criação com/sem cliente, cliente inexistente/inativo rejeitado na nova
associação, item FINISHED_PRODUCT aceito, RAW_MATERIAL/PACKAGING/item
inexistente/item inativo rejeitados, duplicidade de vínculo 1:1, associação
histórica preservada (cliente e item), busca, filtros, inativar/reativar,
limpar `externalCode`. Total da API: 54 testes.

## Validação

`pnpm typecheck`/`build`/`test` — ok. Seed rodado (2 Items PA + 2 Products,
1 com cliente+item vinculados, 1 sem nenhum). Validado visualmente via
Playwright: listagem, criação com vínculo de cliente, edição mostrando
vínculos existentes, `ConfirmDialog` de inativação, layout tablet (900px).
Fluxo real de inativar/reativar em Items testado ponta a ponta contra a API.

## Pendente (não bloqueante)

- Nenhuma.

---

# Delivery 06 — Ordem de Compra

Primeira feature transacional (Bloco B). Primeiro modelo com máquina de
estados explícita, snapshots históricos e página própria (não modal).

## Máquina de estados

`DRAFT → ORDERED → CANCELLED` e `DRAFT → CANCELLED` são as únicas
transições executáveis nesta entrega, via operações de domínio dedicadas
(`POST .../confirm`, `POST .../cancel`) — nunca um PATCH de status livre.
`PARTIALLY_RECEIVED`/`RECEIVED` já existem no enum para o próximo módulo
(Recebimento), mas são inalcançáveis agora.

Regras de edição por status: DRAFT permite tudo (fornecedor, datas, linhas,
quantidades, preços); ORDERED só previsão de entrega e observações;
CANCELLED é somente leitura. `confirmPurchaseOrder` revalida fornecedor e
cada item de linha (existe/tipo/ativo) no momento da confirmação — não
confia apenas nas validações de saves anteriores do rascunho.

## Modelo de dados

- `PurchaseOrder`: `code` (sequence `purchase_order_code_seq`, prefixo
  `OC`), `supplierId` (obrigatório), snapshot do fornecedor
  (`supplierCode`/`supplierName`/`supplierCnpj`), `orderDate`,
  `expectedDeliveryDate?`, `status`, `notes?`, campos de auditoria
  (`orderedAt`/`orderedBy`, `cancelledAt`/`cancelledBy`/`cancelReason`).
- `PurchaseOrderLine`: `itemId`, snapshot do item (`itemCode`/`itemName`/
  `unitCode`), `orderedQuantity` (`Decimal(18,6)`), `unitPrice?`
  (`Decimal(14,4)`). `@@unique([purchaseOrderId, itemId])` — mesmo item não
  pode repetir na OC, garantido no banco.
- Migration `20260817090000_purchase_orders`.

## Snapshot histórico (sem infraestrutura de versionamento)

Em vez de um sistema genérico de versionamento, o fornecedor e cada item
de linha são copiados (código/nome/unidade/CNPJ) diretamente para colunas
da própria `PurchaseOrder`/`PurchaseOrderLine`. Enquanto DRAFT, todo save
revalida e no caso do fornecedor reescreve o snapshot; ao confirmar, o
documento para de aceitar edição desses campos e o snapshot fica congelado
por construção — nenhuma lógica extra de "freeze" foi necessária.

## Precisão decimal

`orderedQuantity`/`unitPrice` nunca passam por `number` do JS como fonte
de precisão: schema Zod aceita string (ou number, mas normaliza para
string) e valida com regex antes de repassar ao Prisma `Decimal`. Cálculo
de `lineTotal`/`orderTotal` usa `Prisma.Decimal.times()/.plus()` (decimal.js
por baixo, não float), formatado com `.toFixed(2)` (BRL) na saída da API —
nunca persistido como coluna derivada. Sem linha com preço → `orderTotal`
é `null`, não `0`.

## Backend

`GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/:id`,
`POST /purchase-orders/:id/confirm`, `POST /purchase-orders/:id/cancel`.
Criar/editar/confirmar/cancelar são transacionais (`$transaction`). Só
RAW_MATERIAL/PACKAGING ativos entram em linha; FINISHED_PRODUCT rejeitado.
Sem DELETE físico.

## Frontend — página de documento (não FullWorkspaceModal)

Decisão de padrão: **CRUD simples usa `FullWorkspaceModal`; documento
transacional usa página própria dentro do workspace**
(`/compras/ordens/nova`, `/compras/ordens/:id`) — topbar/sidebar visíveis,
sem cobrir o workspace como modal. Reaproveita `FormSection` (mesmas
seções em cards) e `ConfirmDialog`. Este último ganhou a prop
`confirmTone` (`"danger"` padrão para Inativar, `"accent"` para ações de
commit positivas como "Confirmar pedido") — sem isso o botão de confirmar
pedido saía vermelho, semanticamente errado. Cancelamento usa um diálogo
próprio (mesmas classes CSS do `ConfirmDialog`) com campo de motivo
obrigatório, caso não coberto pelo componente genérico.

## Testes

23 novos testes (`purchase-orders.test.ts`): geração de código,
imutabilidade, fornecedor obrigatório/ativo, RAW_MATERIAL/PACKAGING
aceitos, FINISHED_PRODUCT/item inativo/inexistente rejeitados, quantidade
> 0, item duplicado rejeitado, edição em DRAFT, confirmação (com bloqueio
sem linhas), bloqueios de edição em ORDERED (fornecedor/linhas) e
permissões (previsão/observações), cancelamento exige motivo,
CANCELLED não reabre nem edita, snapshot histórico do fornecedor
preservado após alteração do cadastro, cálculo decimal de totais. Total
da API: 77 testes.

## Validação

`pnpm typecheck`/`build`/`test` — ok. Seed rodado (1 OC DRAFT, 1 OC
ORDERED, usando Suppliers/Items existentes). Validado visualmente via
Playwright: listagem com Total formatado em BRL, documento de rascunho
editável, diálogo de confirmação (texto exato do handoff), estado
pós-confirmação (campos travados, só previsão/observações editáveis),
cancelamento com motivo obrigatório e bloco de histórico, layout tablet.
Regressão checada nos Cadastros (Items/Suppliers/Customers/Products).

## Pendente (não bloqueante)

- Nenhuma.

---

# Delivery 07 — Recebimento + Lote Interno

Primeira entrega que fecha um ciclo completo: OC → Recebimento → Lote
interno. Segundo documento transacional (página própria, não modal) —
confirma o padrão como reutilizável.

## Pequena evolução em Item

`requiresQualityRelease` (boolean, editável, default por tipo — true para
RAW_MATERIAL/FINISHED_PRODUCT, false para PACKAGING) — decide se o lote
recebido nasce `AWAITING_RELEASE` ou já `AVAILABLE`. Novo toggle-card em
Cadastros → Itens → Controles de rastreabilidade.

## Modelo de dados

- `Receipt`: `code` (sequence `receipt_code_seq`, prefixo `REC`),
  `purchaseOrderId`, `supplierId`, `receivedAt`, `invoiceNumber?`,
  `documentReference?`, `notes?`, `createdBy`. Criado já confirmado — sem
  DRAFT persistido. Não duplica snapshot do fornecedor: reaproveita o que
  já está congelado em `PurchaseOrder` (`supplierCode`/`supplierName`).
- `ReceiptLine`: `purchaseOrderLineId`, `itemId`, `receivedQuantity`
  (`Decimal(18,6)`), `unitCode`, `supplierLot?`, `expiryDate?`,
  `location?`, `lotId?` (preenchido após criar o `Lot`, mesma transação).
  Item code/nome vêm por join da `PurchaseOrderLine` (já imutável) — sem
  duplicar snapshot de novo.
- `Lot`: `code` (`LT-YYYYMMDD-NNNNNN`), `itemId`, `supplierId`,
  `receiptLineId` (1:1), `supplierLot?`, `expiryDate?`,
  `initialReceivedQuantity`, `status`, `location?`, campos de
  auditoria de liberação/bloqueio. **Não tem `currentQuantity`** —
  `initialReceivedQuantity` é só o que entrou naquele recebimento, nunca
  saldo; saldo fica para o futuro ledger de Inventory Movements.
- Migration `20260818090000_receiving_and_lots`.

## PurchaseOrderLine.received/openQuantity

Continuam **derivados**, nunca uma coluna própria: `toLineDTO` soma os
`ReceiptLine`s de cada linha via `Prisma.Decimal` (`.plus()`) a cada
leitura. `GET /purchase-orders/:id` (e a listagem) já retornam
`receivedQuantity`/`openQuantity` por linha — sem segunda fonte de
verdade mutável.

## Atomicidade e concorrência

`POST /purchase-orders/:id/receipts` roda inteiro em uma `$transaction`:
1. trava a `PurchaseOrder` (`SELECT … FOR UPDATE`) — serializa recebimentos
   concorrentes da mesma OC e reconfirma o status sob lock;
2. cria `Receipt`;
3. por linha: soma `ReceiptLine`s já existentes (dentro da transação, já
   sob lock), calcula `openQuantity`, rejeita se a quantidade pedida
   exceder o aberto;
4. cria `ReceiptLine` e, se `Item.controlsLot`, cria `Lot` e liga
   `receiptLine.lotId`;
5. recalcula status da OC a partir dos `ReceiptLine`s reais
   (`PARTIALLY_RECEIVED` ou `RECEIVED`).

Qualquer erro em qualquer etapa reverte a transação inteira — nada fica
parcialmente persistido. Lock de linha simples (`FOR UPDATE`) escolhido em
vez de isolamento `SERIALIZABLE` — mais simples de raciocinar, resolve o
over-receipt concorrente sem precisar de retry em conflito de
serialização. Testado com duas requisições simultâneas reais (`Promise.all`
contra o mesmo `app.inject`).

## Regras de recebimento

Só recebem `ORDERED`/`PARTIALLY_RECEIVED` (revalidado sob lock). Parcial é
o padrão — cada linha pode receber de 0 até o aberto, em quantos
recebimentos forem necessários. `supplierLot` obrigatório quando
`controlsLot`; `expiryDate` obrigatório quando `controlsExpiry` e nunca
anterior a `receivedAt`. Item sem `controlsLot`: `ReceiptLine` normal, sem
`Lot`.

## Qualidade (Lot)

`status` inicial: `AWAITING_RELEASE` se `item.requiresQualityRelease`,
senão `AVAILABLE`. Só duas transições explícitas —
`POST /lots/:id/release` (`AWAITING_RELEASE → AVAILABLE`) e
`POST /lots/:id/block` (`AWAITING_RELEASE`/`AVAILABLE → BLOCKED`, motivo
obrigatório) — nunca PATCH de status livre. `EXPIRED` é calculado para
exibição (`expiryDate < hoje`), não escrito por nenhum job.

## Frontend

Compras → Recebimentos (lista + `/compras/recebimentos/novo`, que aceita
`?purchaseOrderId=` vindo do botão "Receber materiais" no detalhe da OC,
ou deixa escolher a OC quando aberto direto do menu) + detalhe read-only.
Estoque → Lotes (lista + detalhe com liberar/bloquear). Ambos seguem o
padrão de página própria + `FormSection` + `ConfirmDialog` (bloqueio
reaproveita o diálogo de motivo obrigatório, mesmo padrão do cancelamento
de OC). Detalhe da OC agora mostra "Recebido: X · Aberto: Y" por linha e
ganhou o botão "Receber materiais" quando `ORDERED`/`PARTIALLY_RECEIVED`.

**Bug real encontrado e corrigido nesta entrega:** `NavLink` sem `end`
casa por prefixo — "Visão Geral" (`/estoque`) e "Lotes" (`/estoque/lotes`)
ficavam ativos ao mesmo tempo. `AppShell` agora calcula `end` automaticamente
para qualquer item de navegação cujo path seja prefixo de outro item.

## Testes

23 novos testes (`receiving.test.ts`: 19 + `lots.test.ts`: 3, mais 1 em
`items.test.ts` para `requiresQualityRelease`): recebimento de
ORDERED/PARTIALLY_RECEIVED, rejeição de DRAFT/CANCELLED/RECEIVED, parcial,
múltiplos recebimentos completando a OC, over-receipt rejeitado,
quantidade ≤0 rejeitada, geração/unicidade de código de lote, supplierLot/
expiryDate obrigatórios quando aplicável, validade anterior rejeitada, sem
Lot quando `controlsLot=false`, `AWAITING_RELEASE`/`AVAILABLE` por
`requiresQualityRelease`, release/block (motivo obrigatório), atomicidade
(linha inválida não deixa Receipt/Lot parcial), concorrência real (duas
requisições simultâneas, no máximo uma passa). Total da API: 100 testes.

## Validação

`pnpm typecheck`/`build`/`test` — ok. Seed rodado (OC confirmada com
recebimento parcial: 1 lote `AWAITING_RELEASE` + 1 `AVAILABLE`; a OC de
embalagem da entrega anterior segue `ORDERED` intocada). Fluxo completo
validado via Playwright contra o app real (não só o seed): criar OC →
confirmar → receber parcialmente pela UI → lote criado → OC exibindo
`PARTIALLY_RECEIVED`/Recebido/Aberto corretos → liberar lote → bloquear
lote com motivo. Console limpo em todas as telas. Tablet ok.

## Pendente (não bloqueante)

- Nenhuma.

---

# Delivery 08 — QR Code + Etiqueta de Lote + Scan/Consulta

Primeira feature scan-first (mobile/tablet/desktop). QR é só identificador
do lote interno — nunca dado mutável, nunca autorização.

## Payload do QR e lookup

`qrPayload` (`LOT:<code>`) é derivado no `toLotDTO`, nunca uma coluna nova —
reaproveita `Lot.code` (identidade já existente). `GET /lots/lookup?code=`
(`lots.service.ts#lookupLotByCode`) aceita o código puro ou o payload com
prefixo (`normalizeLotLookupCode` em `@veridi/shared`), resolve **só** por
`findUnique({ where: { code } })` — estruturalmente nunca casa por
`supplierLot`, nunca cria/altera nada. 404 claro se não encontrado. Um
código inventado não tem efeito nenhum além de "não encontrado".

## Geração do QR (sem persistir imagem)

`QrCode` (`components/QrCode.tsx`) gera SVG no cliente via `qrcode`
(`QRCode.toString(value, { type: "svg" })`) a partir do `qrPayload` — nunca
armazenado como imagem no backend, sempre gerado on demand.

## Scanner de câmera

`LotScanner` (`components/LotScanner.tsx`): `getUserMedia` + `<canvas>` +
`jsQR` num loop de `requestAnimationFrame`; permissão de câmera só é pedida
ao clicar "Abrir câmera"; digitação manual sempre visível (fallback nunca
escondido); botão "Cancelar" para a câmera. Isolado para reuso futuro em
Recebimento/Picking/Consumo — sem abstração de "scanner industrial" ainda.

## Etiqueta e impressão

`LotLabel` (conteúdo humano-legível: item, lote fornecedor, lote interno,
validade [+ "VENCIDO" se expirado], quantidade recebida, localização, QR) +
`LotLabelPrintPage` (rota `/estoque/lotes/:id/etiqueta`, **fora** do
`AppShell` — sem topbar/sidebar). Impressão é só via navegador
(`window.print()`) nesta entrega — sem servidor de impressão/ZPL/Zebra.
Dimensão da etiqueta (`--label-w: 100mm; --label-h: 70mm` em
`lot-label-print.css`) é uma **decisão temporária** documentada no próprio
CSS, centralizada para trocar fácil quando a impressora real for definida.
Etiqueta nunca mostra saldo/reservado/preço/OC completa/dado financeiro.

## Consulta (topbar e mobile)

Busca da topbar (`AppShell`) ganhou lookup funcional só de lote nesta
entrega (Item/OC/OP ficam para depois): Enter → `lookupLot` → navega para
o detalhe, ou mostra erro Veridi-branded inline. Nova rota
`/estoque/lotes/escanear` (`LotScanPage`): câmera OU digitação → card
compacto de resultado (código, item, status, validade, localização, "Ver
detalhes") — não reproduz a tabela desktop inteira em mobile.

## Bug real corrigido: sidebar mobile

`shell.css` nunca tinha sido validado em largura de celular real (só
tablet, ≥834px, em entregas anteriores). Em ≤640px a sidebar ocupava
espaço fixo no grid e espremia o workspace a ~150px. Corrigido: sidebar
some do grid a esse breakpoint e vira overlay `position: fixed` (mesmo
padrão de z-index/backdrop do `modal-overlay`), escondida por padrão
(`AppShell` inicializa `navCollapsed` via `matchMedia`), abre com o botão
de hambúrguer já existente, fecha tocando no backdrop ou navegando.
Desktop/tablet inalterados (fix só dentro do media query).

## Frontend — outras integrações

Lotes → botão "Escanear QR" (topo) + ação "QR / Etiqueta" por linha.
Detalhe do lote → nova seção "QR Code" com "Imprimir etiqueta". Detalhe do
Recebimento → cada linha com lote ganha "Imprimir etiqueta" ao lado de "Ver
lote", visível assim que o Receipt é confirmado (nunca imprime sozinho).
Linha sem `Lot` (item sem controle de lote): nenhuma ação de QR/etiqueta.

## Testes

5 novos testes de backend (`lots.test.ts`): resolve por código puro,
resolve por `LOT:<code>`, 404 para código inventado, nunca resolve por
`supplierLot`, `qrPayload` determinístico e distinto por lote. Total da
API: 105 testes. Primeira suíte de frontend do projeto
(`@testing-library/react` + `jsdom`, novo `vite.config.ts#test`):
`LotScanner` (normalização/trim da digitação manual, fallback sem câmera
obrigatória), `LotScanPage` (navegação após scan válido, erro Veridi-
branded quando não encontrado), `LotLabel` (renderiza os dados corretos do
lote, nunca saldo/reservado/OC). 7 testes web.

## Validação

`pnpm typecheck`/`build`/`test` (105 API + 7 web) — ok. Validado
visualmente via Playwright: lista de lotes com "Escanear QR", detalhe com
QR Code, etiqueta (tela e emulação `@media print`), lookup pela topbar
(sucesso e não-encontrado), detalhe do Recebimento com "Imprimir etiqueta"
por lote, fluxo de scan manual (sucesso e não-encontrado), fallback de
câmera sem permissão, tablet (834px) e mobile real (390px, antes e depois
do fix de sidebar). Console limpo (os únicos logs são 404 de rede
esperados nos casos de "não encontrado", não exceções).

## Pendente (não bloqueante)

- Nenhuma pendência real. Item/OC/OP na busca da topbar, câmera em
  dispositivo físico real e impressora/dimensão definitiva de etiqueta
  ficam para quando o próximo handoff pedir.

---

# Delivery 09 — Estoque + Movimentações + Inventário Físico

Fonte de verdade do estoque físico. Fecha o Bloco B exceto FEFO. Entrega
validada só em desktop web (estratégia Desktop Web First — ver decisão
durável abaixo).

## InventoryMovement — o ledger

Nova entidade `InventoryMovement`: `itemId`, `lotId?` (null quando o item
não controla lote), `type` (`RECEIPT_IN`/`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`/
`LOSS` — enum preparado para `PRODUCTION_CONSUMPTION`/`RETURN_TO_STOCK`/
`FINISHED_GOOD_PRODUCTION` futuros, não criados agora), `quantity`
(`Decimal(18,6)`, sempre a magnitude positiva — o sinal na soma vem do
`type`, nunca um valor negativo armazenado), `occurredAt`, `sourceType`
(`RECEIPT`/`MANUAL_ADJUSTMENT`/`STOCK_COUNT`/`MANUAL_LOSS`), `sourceId?`,
`receiptLineId?` (FK única 1:1 com `ReceiptLine`, só para `RECEIPT_IN` —
garante no banco que um recebimento confirmado gera no máximo um
movimento), `reason?`, `createdBy`. Histórico imutável: sem endpoint de
edição, sem DELETE. Migration `20260819090000_inventory_movements` +
`20260819091500_inventory_movements_cascade` (FKs para Item/Lot/ReceiptLine
viram `ON DELETE CASCADE` — só importa para limpeza de fixture de teste;
em produção nenhum dos três é excluído fisicamente).

`Lot.initialReceivedQuantity` **nunca** virou saldo — continua só "o que
entrou naquele recebimento". Saldo (`On Hand`) é sempre a soma algébrica
dos movimentos, calculada em `apps/api/src/lib/inventory-ledger.ts`
(`getOnHand`/`getOnHandByItems`/`getOnHandByLots`, batelados para evitar
N+1 em listagens) — nunca uma coluna própria em `Item` ou `Lot`.

## Recebimento passa a gerar estoque

`receiving.service.ts#createReceipt` ganhou um passo a mais dentro da
**mesma transação** que já cria `Receipt`/`ReceiptLine`/`Lot`: cria um
`InventoryMovement` `RECEIPT_IN` por `ReceiptLine` (quantidade sempre
positiva, `lotId` do lote criado ou `null` quando o item não controla
lote). Como está na mesma transação, a confirmação do recebimento só
conclui se o movimento também for criado — nenhum código extra de
"tudo ou nada" foi necessário.

## Backfill dos dados existentes

`prisma/seed.ts` ganhou `backfillInventoryMovements()`, chamada ao final
de `main()`: busca `ReceiptLine`s sem `InventoryMovement` associado
(`inventoryMovement: { is: null }`) e cria o `RECEIPT_IN` que faltava —
idempotente (roda de novo sem duplicar). Rodado uma vez contra o ambiente
de dev existente (10 `ReceiptLine`s de sessões anteriores ao ledger
existir, incluindo os dois criados por `seedReceiving()`); confirmado
`movements === receiptLines` e zero linhas órfãs depois.

## On Hand / Reserved / Available / On Order

`Reserved` é sempre `"0"` nesta entrega — Reservation pertence ao módulo
de OP; o contrato (`InventoryItemSummaryDTO`/`InventoryItemDetailDTO`/
`LotDTO`) já expõe o campo para não quebrar quando Reservation existir.
`Available`: para item sem controle de lote é igual a `On Hand`; para
item com controle de lote soma só o `On Hand` dos lotes com
`status = AVAILABLE` e não vencidos — um lote `AWAITING_RELEASE` ou
`BLOCKED` continua contando em `On Hand`, mas contribui `0` para
`Available` (material bloqueado não some do estoque). Liberar/bloquear um
lote (`POST /lots/:id/release|block`) nunca cria `InventoryMovement` — só
`Available` muda, `On Hand` fica igual (mesma separação de sempre entre
qualidade e quantidade física).

`On Order` é somado a partir das `PurchaseOrderLine`s de OCs
`ORDERED`/`PARTIALLY_RECEIVED` (`orderedQuantity - recebido real`,
reaproveitando a mesma lógica de `openQuantity` de Ordem de Compra) —
`DRAFT`/`CANCELLED` não contam, `RECEIVED` tem aberto zero. Nunca
persiste uma segunda quantidade.

`Lot`/lookup/scan (`GET /lots`, `/lots/:id`, `/lots/lookup`) ganharam
`onHand`/`reserved`/`available` no mesmo `LotDTO` — `toLotDTO` virou puro
(sem I/O) e um `attachStock()` batelado adiciona o saldo por cima, uma
query para a página inteira em vez de N+1.

## Endpoints

`GET /inventory` (resumo por item; filtros busca/tipo/"somente com
estoque" — paginação feita em memória após calcular saldo, decisão
deliberada de simplicidade sobre otimização prematura), `GET
/inventory/:itemId` (resumo + breakdown por lote, ordenado por validade
para apresentação — não é FEFO), `GET /inventory-movements` (ledger,
somente leitura), `POST /inventory-adjustments` (ajuste manual —
`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`/`LOSS`, motivo obrigatório), `POST
/stock-counts` (inventário físico). Nenhum `POST /inventory-movements`
genérico — operações de domínio explícitas, mesmo padrão de Recebimento/
Lotes.

## Ajuste manual e inventário físico — nunca editam saldo direto

Os dois fluxos só criam `InventoryMovement`. Saída/perda: trava a linha
que representa o escopo do saldo (`SELECT … FOR UPDATE` no `Lot` quando
há lote, no `Item` quando não há — mesmo padrão de lock do Recebimento),
soma os movimentos existentes sob o lock, rejeita se a quantidade exceder
o `On Hand` — nunca permite saldo negativo. Testado com duas saídas
concorrentes reais (`Promise.all`): no máximo uma passa.

Inventário físico: usuário informa a contagem; sistema calcula a
diferença contra o saldo do sistema (sob o mesmo lock); sem diferença,
**nenhum movimento é criado** (contagem confere, nada para auditar);
com diferença, motivo é obrigatório e cria exatamente um `ADJUSTMENT_IN`
(diferença positiva) ou `ADJUSTMENT_OUT` (negativa) com
`sourceType: STOCK_COUNT` — matematicamente nunca pode deixar o saldo
negativo (a magnitude do ajuste é sempre ≤ o saldo do sistema). Sem
entidade `StockCount` própria — decisão deliberada de simplicidade
("Precisamos pelo menos conseguir auditar ajustes que realmente alteram
saldo", não um módulo de cycle count).

## Frontend (Desktop Web First)

Estoque → **Visão Geral** (`/estoque`, tabela Código/Item/Tipo/Un./On
Hand/Reservado/Disponível/Em Compra + busca/tipo/"somente com estoque"),
**detalhe do item** (`/estoque/:itemId`, resumo de disponibilidade +
breakdown por lote quando `controlsLot`, botões "Ajustar estoque" e "Ver
movimentações"), **Movimentações** (`/estoque/movimentacoes`, ledger
read-only com link para Item/Lote/Recebimento; aceita `?itemId=` para
filtrar a partir do detalhe do item), **Inventário Físico**
(`/estoque/inventario`, fluxo completo de contagem). Novo componente
`AdjustStockDialog` (diálogo reutilizável de ajuste). `LotDetailPage`
ganhou a seção "Saldo" (On Hand/Reservado/Disponível), deixando visualmente
clara a diferença entre "Quantidade recebida" (histórico, imutável) e
saldo atual — QR/etiqueta continuam intocados.

**Bug real encontrado e corrigido nesta entrega:** `StockCountPage`
pedia `listItems({ pageSize: 200 })`, mas o schema de `/items` limita
`pageSize` a 100 — a API respondia 400 silenciosamente (erro engolido
pelo `.catch`) e o select de item nunca populava. Corrigido para 100.

## Testes

22 novos testes de API: 3 em `receiving.test.ts` (um `RECEIPT_IN` exato
por `ReceiptLine`, `lotId` null sem controle de lote, falha transacional
não deixa movimento órfão) + 19 em `inventory.test.ts` (entrada/ajuste/
perda alteram `On Hand` corretamente, múltiplos movimentos, nunca saldo
negativo, concorrência real de duas saídas simultâneas, qualidade —
`AWAITING_RELEASE`/liberar/bloquear afetando só `Available`, `On Order`
por status de OC — `ORDERED`/`PARTIALLY_RECEIVED`/`DRAFT`/`CANCELLED`/
`RECEIVED`, inventário físico — diferença positiva/negativa/sem diferença/
motivo obrigatório). Total da API: 127 testes.

## Validação

`pnpm typecheck`/`build`/`test` (127 API + 7 web) — ok. Backfill rodado
contra o ambiente de dev real. Validado visualmente via Playwright **só
desktop** (Desktop Web First): Visão Geral, detalhe de item com lote
bloqueado (`On Hand` 60 / `Available` 0, exemplo real do handoff),
diálogo "Ajustar estoque", Movimentações (geral e filtrada por item),
fluxo completo de Inventário Físico (contagem → diferença → motivo →
confirmação → `ADJUSTMENT_OUT` gerado → `On Hand` do lote refletindo o
ajuste no detalhe do lote), regressão em Itens/Fornecedores/Ordens de
Compra/Recebimentos/Lotes/Dashboard. Console limpo em todas as telas.

## Pendente (não bloqueante)

- Nenhuma pendência real. Responsividade mobile/tablet desta entrega fica
  para a rodada de hardening (Desktop Web First).

---

# Delivery 10 — FEFO (sugestão e alocação de lotes)

Encerra o Bloco B. Serviço reutilizável de domínio que responde "dado um
Item e uma quantidade necessária, quais lotes usar primeiro" — só cálculo,
nunca reserva/baixa estoque/cria movimentação. Validada só em desktop web
(Desktop Web First).

## Algoritmo

`apps/api/src/modules/inventory/allocation.service.ts#getAllocationSuggestion(itemId,
requiredQuantity)`. Três estratégias, mesma interface:
- **FEFO** (`Item.controlsExpiry=true`): ordena lotes elegíveis por
  `expiryDate` ascendente.
- **FIFO** (`Item.controlsLot=true`, `controlsExpiry=false`): ordena por
  data de recebimento mais antiga (do `Receipt` via `ReceiptLine`, com
  fallback para `Lot.createdAt` quando não há `ReceiptLine`).
- **NO_LOT** (`Item.controlsLot=false`): sem escolha de lote — retorna
  disponibilidade direta (`On Hand` do item), `allocations: []`. Nunca
  cria lote artificial.

Desempate sempre determinístico, nunca aleatório entre requisições: mesma
validade → recebimento mais antigo; empate completo → `Lot.code`
(`localeCompare`). Aloca sequencialmente até a quantidade necessária ser
atendida ou os lotes elegíveis se esgotarem; `shortageQuantity =
max(0, required - allocated)` — falta é resultado operacional válido,
nunca erro HTTP (endpoint sempre `200`, mesmo com `shortageQuantity > 0`).

## Reuso de disponibilidade (sem cálculo paralelo)

Elegibilidade de lote e `On Hand` reaproveitam exatamente
`isLotAvailableForUse`/`getOnHand`/`getOnHandByLots` de
`apps/api/src/lib/inventory-ledger.ts` (mesmas funções da Visão Geral do
Estoque e do detalhe do Lote) — zero lógica de disponibilidade duplicada.
Elegível = `On Hand` do lote > 0 **e** `status` efetivo `AVAILABLE`
(considerando expiração calculada, não só o status persistido) — exclui
`AWAITING_RELEASE`/`BLOCKED`/vencido, mesmo que o banco ainda diga
`AVAILABLE`. `On Order` nunca entra na alocação (material em compra não
está fisicamente disponível).

## Endpoint

`GET /inventory/:itemId/allocation-suggestion?quantity=<decimal>` —
somente leitura, `404` se o item não existir, `400` de validação para
quantidade inválida. Resposta: `itemId`/`itemCode`/`itemName`/`unitCode`,
`strategy`, `requiredQuantity`, `availableQuantity` (soma de todos os
lotes elegíveis, não só os usados), `allocatedQuantity`,
`shortageQuantity`, `allocations[]` (`lotId`/`lotCode`/`supplierLot`/
`expiryDate`/`location`/`availableQuantity`/`suggestedQuantity`) — só
lotes com `suggestedQuantity > 0` aparecem. Nenhuma tabela nova, nenhuma
"suggested allocation" persistida.

## Frontend

`InventoryItemDetailPage` ganhou a seção "Ordem de Consumo / Sugestão
FEFO": campo de quantidade necessária + "Calcular sugestão" + resumo
(Estratégia/Necessário/Disponível/Falta — falta com badge de aviso) +
tabela Ordem/Lote/Validade/Localização/Disponível/Sugerido. Primeira linha
mostra texto explícito ("Recomendado — vence primeiro" para FEFO,
"Recomendado — recebido primeiro" para FIFO) — nunca só cor. Cálculo é
sob demanda (não roda ao carregar a página), reforçando visualmente que é
uma consulta, não um estado persistido.

## Testes

17 novos testes (`allocation.test.ts`): validade mais próxima primeiro,
múltiplos lotes com uso parcial do último, quantidade exata, shortage
(200 ok, não erro), ignora saldo zero/`AWAITING_RELEASE`/`BLOCKED`/
vencido, reflete ajuste de estoque (ledger) na sugestão, `On Order` fora
da alocação, precisão decimal, qualidade (`AWAITING_RELEASE` que venceria
primeiro só entra depois de liberado), empate por recebimento e por
código, FIFO por recebimento mais antigo, item sem lote sem allocation
fictício, item inexistente → 404. Total da API: 144 testes.

## Validação

`pnpm typecheck`/`build`/`test` (144 API + 7 web) — ok. Validado
visualmente via Playwright **só desktop**: FEFO com múltiplos lotes
(cenário exato do handoff, 70kg → 30+40), shortage, lote bloqueado +
aguardando liberação ignorados (Vitamina C real do seed), FIFO para item
sem validade (Pote 500g). Regressão em Visão Geral/Lotes/Movimentações/
Inventário Físico/Recebimentos/Ordens de Compra. Console limpo.

## Pendente (não bloqueante)

- Nenhuma pendência real. Override manual de lote (usuário escolher lote
  diferente do sugerido) fica para quando Picking/OP existirem — princípio
  já documentado em `docs/PRODUCT_RULES.md`.

---

# Delivery 11 — Formulações + Versionamento (+ hardening de Item)

Primeiro módulo do Bloco C. Formulação pertence ao `Product`, não ao Item
de saída diretamente. Validada só em desktop web (Desktop Web First).

## Hardening de Item (pré-requisito)

Um Item "operacionalmente utilizado" (referência em `PurchaseOrderLine`,
`ReceiptLine`, `Lot` ou `InventoryMovement` — checagem por existência
direta, batelada nas listagens) trava `type`/`unitCode`/`controlsLot`/
`controlsExpiry` para nunca corromper o significado de números já
registrados (ex.: trocar kg→g de um item com histórico deixaria
quantidades antigas com outro significado). `name`/`externalBarcode`/
`active`/`requiresQualityRelease` continuam sempre editáveis;
`requiresQualityRelease` nunca reescreve `Lot.status` de lotes já
existentes (só afeta lotes futuros). `ItemDTO` ganhou `operationallyUsed`;
`ItemFormModal` desabilita os campos travados com a explicação exata do
handoff. Reenviar o mesmo valor não conta como alteração (não bloqueia).

## Modelagem — FormulationVersion / FormulationComponent

- `FormulationVersion`: `productId`, `versionNumber` (sequencial **por
  Product**, não sequence global), `status`
  (`DRAFT`/`ACTIVE`/`INACTIVE`), `basisQuantity`, snapshot do output
  (`outputItemId`/`outputItemCode`/`outputItemName`/`outputUnitCode` —
  congelado no momento da criação/cópia, nunca depende da associação
  *atual* do Product), `notes?`, auditoria de criação/ativação/inativação.
- `FormulationComponent`: `formulationVersionId`, `itemId`, `quantity`,
  `unitCode` (pode diferir da unidade de estoque do item, mesma
  dimensão), `notes?`, `position`. `@@unique([formulationVersionId,
  itemId])` — mesmo item não repete na versão, garantido no banco.
- Índice único parcial `WHERE status = 'ACTIVE'` em
  `(productId)` — no máximo uma versão ativa por Product, garantido no
  banco (mesma técnica do CNPJ opcional), não só na aplicação. Migration
  `20260820090000_formulations`.

## Versionamento

`versionNumber` gerado dentro de uma transação que trava a linha do
`Product` (`SELECT … FOR UPDATE`) antes de consultar o maior número
existente — mesmo padrão de concorrência-segura já usado em Recebimento,
sem depender de `MAX+1` desprotegido. `POST
/products/:id/formulation-versions` só cria quando o Product ainda não
tem nenhuma versão (V1); `POST /formulation-versions/:id/new-version`
(chamado na versão ACTIVE) cria a próxima DRAFT copiando
`basisQuantity`/output/componentes/notas — nunca reaproveita a
associação atual do Product para o output, sempre copia o snapshot da
versão de origem.

## Imutabilidade e ativação

ACTIVE/INACTIVE nunca aceitam `PATCH` (backend bloqueia, não só a UI —
`VersionNotDraftError`). Única forma de mudar uma formulação: criar nova
versão. `POST /formulation-versions/:id/activate` roda numa única
transação: trava o Product, inativa a ACTIVE anterior do mesmo produto
(se houver, com `inactivatedAt`/`By`) e ativa a versão alvo
(`activatedAt`/`By`) — atômico, nunca duas ACTIVE por corrida (lock +
índice parcial). Gate de ativação (seção 16 do handoff) valida: Product
ativo, `finishedProductItemId` presente e ativo/tipo `FINISHED_PRODUCT`,
`basisQuantity > 0`, ao menos um componente, e cada componente ativo/tipo
válido/quantidade válida/unidade compatível — reúne todas as falhas numa
mensagem só, citando os itens problemáticos.

## Componentes: ativo só importa para linha NOVA

Adicionar um componente novo a uma DRAFT exige item ativo
(`RAW_MATERIAL`/`PACKAGING`, nunca `FINISHED_PRODUCT`). Uma linha já
existente antes da edição atual (herdada de cópia de uma ACTIVE, por
exemplo) continua editável mesmo que o item tenha sido inativado depois
— `updateFormulationVersion` compara o conjunto de `itemId`s antes/depois
do PATCH para decidir quando exigir item ativo.

## UOM sem segundo sistema de conversão

`apps/api/src/modules/items/uom.ts` ganhou `convertUomDecimal`/
`isUomCompatible` — mesma fundação de `convertUom` (delivery 02), agora
em `Prisma.Decimal` para nunca introduzir erro de ponto flutuante no
"equivalente de estoque" exibido (ex.: 500 g de um item em kg → `0.5`
exato). `stockEquivalentQuantity` é só exibição — a fórmula sempre
preserva `quantity`/`unitCode` originais como fonte de verdade.

## Frontend

Produção → **Formulações** (`/producao/formulacoes`, tabela Produto/
Cliente/Item acabado/Versão ativa/Situação/Última atualização — uma linha
por Product, nunca por componente) → **detalhe do Product**
(`/producao/formulacoes/:productId`, item acabado + formulação ativa +
histórico de versões + "Criar formulação"/"Criar nova versão") →
**editor de versão** (`/producao/formulacoes/:productId/versoes/:versionId`,
página própria — mesmo padrão de documento transacional de Ordem de
Compra/Recebimento). DRAFT: tudo editável, tabela de componentes com
select de item (só ativos, filtra já usados na versão), select de unidade
(só dimensão compatível com o item), equivalente de estoque calculado ao
salvar. ACTIVE/INACTIVE: mesma tela em somente-leitura, sem "Salvar",
única ação é "Criar nova versão". Ativação usa `ConfirmDialog` (tone
accent) com o texto exato do handoff.

## Testes

28 novos testes de API: 8 em `items.test.ts` (hardening estrutural — sem
histórico altera livremente, com histórico trava
type/unitCode/controlsLot/controlsExpiry, `name`/`externalBarcode`/
`requiresQualityRelease` continuam livres, reenviar mesmo valor não
bloqueia, `requiresQualityRelease` não muda lote histórico, listagem
também expõe `operationallyUsed`) + 20 em `formulations.test.ts` (cria V1
DRAFT, concorrência na criação de V1, RAW_MATERIAL/PACKAGING aceitos,
FINISHED_PRODUCT/duplicado/quantidade₀/dimensão incompatível rejeitados,
conversão g→kg e mg→kg exatas, DRAFT incompleta, ativação valida
integridade, fluxo DRAFT→ACTIVE→imutável, nova versão copia ACTIVE
mantendo V1 ativa até a ativação de V2, ativar V2 inativa V1 atomicamente
e preserva conteúdo histórico, item inativo histórico continua visível,
componente inativo bloqueia ativação, Finished Product Item inativo
bloqueia ativação, linha herdada com item inativo continua editável).
Total da API: 173 testes.

## Validação

`pnpm typecheck`/`build`/`test` (173 API + 7 web) — ok. Validado
visualmente via Playwright **só desktop**: lista de Formulações (produto
com versão ativa e produto "Sem formulação", como no exemplo do
handoff), detalhe do produto com histórico V1/V2, V1 ACTIVE read-only,
V2 DRAFT editável com adição de componente e conversão g→kg em tempo
real, diálogo de ativação, V1 virando "Inativa" após ativar V2 com
conteúdo preservado, campos estruturais de Item travados na UI com a
mensagem exata do handoff. Regressão em Itens/Produtos/Estoque/Lotes/
Ordens de Compra/Recebimentos. Console limpo.

## Pendente (não bloqueante)

- Nenhuma pendência real.

---

# Delivery 12 — Ordem de Produção + Cálculo de Necessidade de Materiais

Primeiro slice de OP do Bloco C. Transforma Produto + Formulação +
quantidade planejada em necessidade de materiais, comparada ao estoque em
tempo real. Não implementa Reservation/Release/Picking/Consumo — escopo
explicitamente travado no handoff. Validada só em desktop web (Desktop Web
First).

## Modelagem — ProductionOrder / ProductionOrderRequirement

- `ProductionOrder`: `code` (sequence `production_order_code_seq`, prefixo
  `OP`), `productId`, `formulationVersionId?` (nullable — DRAFT pode
  existir sem formulação ativa selecionável), `plannedQuantity`
  (`Decimal(18,6)`), `outputUnitCode` (sempre a unidade do Finished
  Product Item, definida na criação), `status`
  (`DRAFT`/`PLANNED`/`RELEASED`/`IN_PRODUCTION`/`COMPLETED`/`BLOCKED`/
  `CANCELLED` — só as transições DRAFT→PLANNED e DRAFT/PLANNED→CANCELLED
  são executáveis nesta entrega), `origin` (`MANUAL`/`STOCK_PRODUCTION`,
  default `MANUAL`; `CUSTOMER_ORDER` fica para o Bloco D), snapshot
  histórico nullable (`productCode/Name`, `finishedItemId/Code/Name`,
  `formulationVersionNumber`, `customerCode/Name/Cnpj`) populado só no
  planejamento, `notes?`, auditoria de planejamento/cancelamento.
- `ProductionOrderRequirement`: `productionOrderId`, `itemId` + snapshot
  (`itemCode`/`itemName`/`itemType`), `formulaQuantity`/`formulaUnitCode`
  (fórmula original), `requiredQuantity`/`stockUnitCode` (já convertido
  para a unidade de estoque do item — fonte de verdade da necessidade
  técnica), `position`. `@@unique([productionOrderId, itemId])`.
  Migration `20260821090000_production_orders`.

## Necessidade de materiais é sempre calculada ao vivo

`Requirement` persiste só o que a OP **precisa** tecnicamente
(`requiredQuantity`). On Hand/Reserved/Available/On Order/Shortage nunca
são colunas — calculados a cada leitura da OP a partir do mesmo
`inventory-ledger.ts` já usado por Visão Geral do Estoque e FEFO (nenhuma
segunda interpretação de disponibilidade). `Reserved` é sempre `"0"` nesta
entrega — Reservation ainda não existe; quando existir, substituirá esse
fixo pelo mesmo contrato.

`getAvailableByItems` (nova função em `inventory-ledger.ts`) extrai a
lógica de "Available por item" que já existia inline em
`inventory.service.ts#buildItemSummaries` — reaproveitada agora também
pelos Requirements de OP, sem duplicar o cálculo de elegibilidade de lote
em um terceiro lugar.

## Fator de produção e cálculo de requisito

`productionFactor = plannedQuantity / formulationVersion.basisQuantity`
(Decimal, nunca persistido — sempre derivável). Por componente:
`formulaQuantity × factor`, convertido da unidade de fórmula para a
unidade de estoque do item via `convertUomDecimal` (já existente, sem
segundo serviço de conversão). Sem arredondamento operacional automático
nesta fase — uma necessidade matemática de `4.5un` permanece `4.5`, nunca
vira `5` silenciosamente.

## Shortage nunca considera On Order

`shortage = max(requiredQuantity - available, 0)`. `onOrder` é exibido
separado, nunca reduz o `shortage` — material em compra ainda não está
fisicamente disponível. `suggestedAllocations` por Requirement reaproveita
`allocation.service.ts#getAllocationSuggestion` (FEFO/FIFO já existente) —
sugestão pura, nunca persistida, nunca reserva, nunca altera saldo.

## DRAFT × PLANNED

DRAFT: Produto/Formulação/Quantidade/Observações editáveis; qualquer
mudança de Produto/Formulação/Quantidade regenera os Requirements
transacionalmente (delete + recreate, mesmo padrão de "substituir linhas"
já usado em Formulação/Ordem de Compra). Trocar de Produto nunca herda a
formulação do produto anterior — resolve a versão ACTIVE do novo produto
(ou a versão explícita informada, validada contra o novo `productId`).
Produto sem Finished Product Item válido não permite nem criar a OP
(`outputUnitCode` depende dele); Produto sem formulação ACTIVE permite
DRAFT (sem Requirements), mas bloqueia o `PLAN`.

`POST /production-orders/:id/plan`: transação com lock de linha
(`SELECT … FOR UPDATE`), revalida DRAFT, Produto ativo, Finished Product
Item válido/ativo, formulação selecionada e **ainda ACTIVE** (uma DRAFT
apontando para uma versão que virou INACTIVE depois de outra ativação
nunca planeja silenciosamente — erro explícito, mesmo padrão de
"reunir todas as falhas numa mensagem só" de `FormulationActivationError`),
`plannedQuantity > 0`, Requirements não vazios. **Não exige estoque
suficiente** — PLANNED pode existir com shortage; o bloqueio por
insuficiência é uma decisão do próximo módulo (RELEASE). Ao planejar,
congela os campos estruturais e o snapshot histórico; só `notes`
continua editável depois.

## Cancelamento

`POST /production-orders/:id/cancel`: DRAFT ou PLANNED → CANCELLED, motivo
obrigatório, nunca apaga Requirements (histórico preservado). CANCELLED é
somente leitura.

## Backend

`GET/POST /production-orders`, `GET/PATCH /production-orders/:id`,
`POST /production-orders/:id/plan`, `POST /production-orders/:id/cancel`.
Sem PATCH de status livre. `production-orders.service.ts` consulta
`FormulationVersion`/`FormulationComponent` diretamente via Prisma (não
pela camada de DTO de `formulations.service.ts`, que já retorna Decimal
como string) — mesmo padrão de `receiving.service.ts` consultando
`PurchaseOrderLine` direto em vez de passar pela DTO de Ordem de Compra.

## Frontend

Produção → **Ordens de Produção** (`/producao/ordens`, tabela OP/Produto/
Formulação/Quantidade/Unidade/Materiais["Disponível" ou "Falta em N
materiais", dinâmico]/Status/Criada em) → **documento da OP**
(`/producao/ordens/nova`, `/producao/ordens/:id` — mesmo padrão de página
própria de Ordem de Compra/Recebimento/editor de Formulação). DRAFT:
Produto/Formulação(lista todas as versões do produto, ACTIVE
pré-selecionada)/Quantidade editáveis; troca de Produto recarrega as
versões de formulação do novo produto e reseleciona a ACTIVE, nunca herda
a anterior. Tabela "Necessidade de Materiais" (Item/Necessário/On
Hand/Reservado/Disponível/Em Compra/Falta) com sugestão FEFO/FIFO inline
por item, aparece assim que a OP é persistida (Requirements só existem no
servidor). Rodapé: Cancelar OP / Salvar rascunho / Planejar OP.

## Testes

21 novos testes (`production-orders.test.ts`): geração/imutabilidade de
código, concorrência na geração de código, Produto sem Finished Product
Item/inativo não cria OP, formulação precisa pertencer ao Produto, DRAFT
editável, quantidade ≤0 rejeitada no PLAN, Produto sem formulação ativa
não planeja, versão que virou INACTIVE depois de selecionada não planeja
silenciosamente, fluxo DRAFT→PLANNED com congelamento de campos e
Requirements, PLANNED pode existir com shortage, cancelamento exige
motivo/preserva Requirements/CANCELLED somente leitura, fator de produção
e conversões de unidade (g→kg/mg→kg/mL→L/contagem), regeneração de
Requirements ao mudar quantidade/Produto, precisão decimal sem
arredondamento automático (4.5 preservado), Reserved sempre 0, Available
respeitando lote bloqueado/vencido, shortage correto com On Order exibido
separado, sugestão FEFO retornada sem alterar saldo. Total da API: 194
testes.

## Validação

`pnpm typecheck`/`build`/`test` (194 API + 7 web) — ok. Validado
visualmente via Playwright **só desktop**: criação de OP (Produto →
Formulação ACTIVE pré-selecionada → quantidade 5000), Requirements
corretos após salvar rascunho (Vitamina C 500g/1000un × fator 5 = 2.5kg,
Pote 1000un × 5 = 5000un, ambos com sugestão FEFO/FIFO exibida),
planejamento (status Planejada, campos travados, Requirements
preservados), listagem com coluna Materiais ("Disponível"), cancelamento
com motivo obrigatório e bloco de histórico. Regressão em
Formulações/Estoque/FEFO/Ordens de Compra. Console limpo (único erro é o
404 pré-existente de `favicon.ico`, não relacionado a esta entrega).

## Pendente (não bloqueante)

- Nenhuma pendência real dentro do escopo desta entrega. Reservation,
  RELEASE (bloqueio por estoque insuficiente), Picking, Consumo real e
  Produto Acabado ficam para os próximos módulos do Bloco C, por decisão
  explícita do handoff — não avançar para Material Reservation agora.

---

# Delivery 13 — Material Reservation + Release da Ordem de Produção

PLANNED → RELEASED: valida disponibilidade real, aloca FEFO/FIFO e
reserva. `Reserved` deixa de ser `"0"` fixo em todo o sistema (OP,
Estoque, Lotes, FEFO) e passa a ser real. Fecha o ciclo até o ponto
imediatamente anterior ao Picking. Validada só em desktop web (Desktop
Web First).

## Modelagem — MaterialReservation / MaterialReservationLine

- `MaterialReservation`: `productionOrderId` (`@unique` — no máximo uma
  reserva operacional por OP, nascida só pela regra de domínio do
  RELEASE), `status` (`ACTIVE`/`RELEASED`; nunca deletada — histórico),
  auditoria de criação/liberação (`releasedAt/By/Reason`).
- `MaterialReservationLine`: `reservationId`, `productionOrderRequirementId`,
  `itemId`, `lotId?` (null quando o item não controla lote — nunca lote
  fictício), `quantity`. Base do futuro Picking (`OP → Requirement →
  Lote reservado → Quantidade`).
- Migration `20260822090000_material_reservations`: dois enums/tabelas +
  `releasedAt`/`releasedBy` em `ProductionOrder`. FKs para
  Item/Lot/ProductionOrder/Requirement em `RESTRICT` (mesma filosofia de
  "RESTRICT + ordem de limpeza correta em teste" das entregas anteriores);
  só `ReservationLine → Reservation` é `CASCADE`.

## Reserved passa a ser real em todo o sistema

`getReservedByItems`/`getReservedByLots` (novo em `inventory-ledger.ts`)
somam `MaterialReservationLine` de reservas `ACTIVE` — nunca `RELEASED`.
`getAvailableByItems` foi reescrito: `Available = On Hand - Reserved`
(nunca negativo), por lote elegível (`AVAILABLE`, não vencido) somado por
item. `allocation.service.ts#getAllocationSuggestion` passou a receber
`prisma`/`tx` como primeiro parâmetro (permite rodar dentro da transação
do RELEASE) e usa a mesma disponibilidade líquida — FEFO/FIFO nunca
sugere mais do que sobra depois de outras reservas `ACTIVE`. Estoque
(Visão Geral, detalhe por item/lote), Lotes e Requirements de OP
consomem exatamente as mesmas funções — nenhum cálculo paralelo.

## Algoritmo de RELEASE (transação única)

`production-orders.service.ts#releaseProductionOrder`: 1. trava a OP
(`FOR UPDATE`), valida `PLANNED`; 2. carrega Requirements; 3. trava todos
os `Item`s envolvidos, ordem determinística (id ascendente, evita
deadlock); 4. recalcula FEFO/FIFO por Requirement contra o estoque atual
(nunca a sugestão antiga da UI), coletando todas as faltas antes de
decidir; 5. se qualquer Requirement não for 100% atendido por estoque
`Available` real, `ROLLBACK` completo — nenhuma reserva parcial; 6. senão,
cria `MaterialReservation` + `MaterialReservationLine`s (uma por lote
alocado, ou uma por item sem lote) e OP → `RELEASED` com
`releasedAt/releasedBy`. On Order nunca satisfaz a exigência.

## Falso shortage pós-RELEASE — bug real encontrado e corrigido

Ao exibir os Requirements de uma OP já `RELEASED`, a própria reserva da
OP entrava na conta de `Reserved` global e "competia" contra si mesma —
uma OP que acabara de reservar 100% do que precisava aparecia com "Falta"
> 0. Corrigido em `attachRequirementAvailability`: para uma OP com
reserva `ACTIVE` própria, o `Available` exibido em cada linha soma de
volta o que a própria OP já reservou daquele item antes de calcular
shortage — nunca conta a reserva da OP contra ela mesma. Não afeta
Estoque/Lotes/FEFO (que continuam mostrando disponibilidade líquida real
para qualquer outra consulta) nem DRAFT/PLANNED (que ainda não têm
reserva própria).

## Concorrência

Duas OPs disputando o mesmo estoque: cada RELEASE trava (`FOR UPDATE`)
todos os Items de seus próprios Requirements antes de calcular
disponibilidade — a segunda transação bloqueia até a primeira commitar, e
então recalcula com os dados já atualizados. Testado com duas OPs de
80kg contra 100kg disponíveis via `Promise.all`: exatamente uma libera,
`Reserved` nunca passa de 80 (nunca 160).

## Cancelamento de OP RELEASED

`cancelProductionOrder` evoluído: `RELEASED → CANCELLED` (motivo
obrigatório) agora também move a `MaterialReservation` para `RELEASED`
(liberada) na mesma transação — `Reserved` volta a considerar só reservas
`ACTIVE`, então a disponibilidade retorna automaticamente, sem nenhum
`InventoryMovement` (fisicamente nada mudou). Histórico preservado: a
reserva nunca é deletada, só marcada.

## Hardening de ajustes/inventário contra Reserved

`createInventoryAdjustment` (`ADJUSTMENT_OUT`/`LOSS`): o limite deixou de
ser `On Hand` cru e passou a ser `Available` (`On Hand - Reserved` no
escopo do lote ou do item) — nunca mais pode consumir estoque comprometido
por uma reserva `ACTIVE`. `createStockCount`: contagem cujo resultado
ficaria abaixo do `Reserved` atual é rejeitada explicitamente
(`CountBelowReservedError`, mensagem orientando revisar as reservas) —
nunca resolve automaticamente cancelando reservas. `blockLot`: lote com
`Reserved` `ACTIVE` > 0 não pode ser bloqueado nesta fase (reutiliza
`InvalidLotTransitionError` com mensagem específica) — nunca cancela a
OP/reserva automaticamente para permitir o bloqueio.

## Backend

`POST /production-orders/:id/release` (nova operação de domínio
explícita). `POST /production-orders/:id/cancel` evoluído para tratar
`RELEASED`. Sem `POST /reservations` genérico — reserva nasce só pela
regra de RELEASE da OP; leitura vem embutida em `GET
/production-orders/:id` (`reservation` no DTO).

## Frontend

OP `PLANNED`: botão "Liberar OP" (some quando `PLANNED`, some se
`shortageItemCount > 0`, mostrando "Não é possível liberar: falta
material." — backend sempre revalida, frontend nunca é a única barreira).
`ConfirmDialog` (tone accent) com o texto exato do handoff. OP
`RELEASED`: nova seção "Materiais Reservados" (Item/Lote/Validade/
Quantidade reservada/Localização — `—` para item sem lote), subtítulo
muda quando a reserva foi liberada (OP cancelada). Cancelamento agora
também cobre `RELEASED` (mesmo diálogo de motivo obrigatório, aviso extra
de que os materiais serão liberados). Listagem: coluna Materiais mostra
"Reservado" para `RELEASED`/`IN_PRODUCTION`/`COMPLETED`. `InventoryItemDetailPage`
ganhou a coluna "Reservado" na tabela de saldo por lote (só faltava a
coluna — o dado já existia no contrato).

## Testes

16 novos testes de API: 11 em `production-orders-release.test.ts`
(RELEASE com estoque suficiente — status/auditoria/Reservation
ACTIVE/Reserved-Available-OnHand corretos/zero InventoryMovement; DRAFT
não libera; RELEASED não libera de novo; shortage bloqueia sem reserva
parcial; On Order não permite release; multi-componente cobre todos os
Requirements; FEFO determina lotes com múltiplos lotes por Requirement;
FEFO recalculado no RELEASE considerando reserva de outra OP; item sem
lote gera linha com `lotId` null; concorrência real de duas OPs
disputando o mesmo estoque; cancelamento de RELEASED libera reserva sem
InventoryMovement) + 5 em `inventory.test.ts` (ADJUSTMENT_OUT/LOSS
travados pelo Reserved, Stock Count abaixo do Reserved rejeitado, Stock
Count igual ao Reserved funciona, lote com reserva ACTIVE não bloqueia).
Total da API: 210 testes.

## Validação

`pnpm typecheck`/`build`/`test` (210 API + 7 web) — ok. Validado
visualmente via Playwright **só desktop**: OP PLANNED com estoque
suficiente, diálogo de liberação (texto exato do handoff), OP RELEASED
com Necessidade de Materiais mostrando Falta 0 corretamente (após corrigir
o bug do falso shortage) e nova seção Materiais Reservados com os lotes
FEFO reais, Visão Geral do Estoque e detalhe do item refletindo
Reservado/Disponível reais (item e por lote), segunda OP vendo
disponibilidade reduzida e sendo bloqueada por shortage (botão desabilitado
+ mensagem), listagem com "Reservado"/"Falta em N materiais", cancelamento
de OP RELEASED devolvendo disponibilidade. Regressão em
Formulações/OP/Estoque/Lotes/FEFO/Ordens de Compra. Console limpo (único
evento é o 404 pré-existente de `favicon.ico`).

## Pendente (não bloqueante)

- Nenhuma pendência real dentro do escopo. Picking, QR Picking, Consumo
  real, `PRODUCTION_CONSUMPTION`, substituição manual de lote, produção
  parcial e Produto Acabado ficam para os próximos módulos, por decisão
  explícita do handoff — não avançar para Picking/Consumo agora.

---

# Delivery 14 — Picking + Consumo Real de Materiais

Fecha o ciclo físico da OP: confere fisicamente o que foi reservado
(Picking, nunca altera estoque) e registra quanto realmente entrou na
produção (Consumo, sempre altera estoque). Primeiro consumo real leva
RELEASED → IN_PRODUCTION. Validada só em desktop web (Desktop Web First).

## Picking — confirmação sem framework genérico

Em vez de uma entidade `ProductionPicking` separada, os campos de
auditoria (`pickedAt`/`pickedBy`) foram adicionados direto em
`MaterialReservationLine` — o Picking É a confirmação física daquela
linha, não um conceito à parte. Confirma a linha **inteira** de uma vez
(sem partial picking nesta fase); item sem lote confirma só a separação
(sem código para conferir). Nunca cria `InventoryMovement`, nunca
recalcula ou reserva de novo. Revalida a elegibilidade do lote reservado
no momento do Picking (pode ter vencido/sido bloqueado entre o RELEASE e
agora) — se inelegível, bloqueia e orienta substituição, mesmo que o
código escaneado seja exatamente o esperado.

## Substituição de lote — genealogia preservada

Mismatch (lote escaneado ≠ lote reservado) nunca é aceito silenciosamente
— mostra os dois códigos e exige ação explícita ("Usar lote diferente").
`MaterialReservationLine` ganhou `releasedAt/By/Reason` (mesmo padrão já
usado em `MaterialReservation`) e um self-relation `replacesLineId`: a
linha original é marcada como liberada (não deletada), e uma linha nova
aponta de volta para ela — "OP reservou originalmente LT-A, mas usou LT-B
no Picking" é sempre reconstruível. A linha nova já nasce com Picking
confirmado (escolher o lote alternativo já é a confirmação física).
Substituição só é permitida antes de qualquer Picking/consumo naquela
linha, e só quando um único lote alternativo (mesmo Item, `AVAILABLE`,
não vencido, Available líquido suficiente, lote diferente do atual)
cobre a quantidade inteira — nunca fraciona uma linha entre vários lotes
alternativos nesta fase. Transacional com o mesmo lock de Item do
RELEASE — duas substituições não conseguem reservar o mesmo saldo
alternativo simultaneamente.

## Consumo real — nova entidade + `InventoryMovement`

`ProductionConsumption` (histórico, imutável) — cada confirmação gera
exatamente 1 `InventoryMovement` `PRODUCTION_CONSUMPTION` (relação 1:1
real via `InventoryMovement.productionConsumptionId`, mesmo padrão já
usado para `ReceiptLine`). Exige Picking confirmado na linha antes de
consumir. Pode ser parcial e repetido várias vezes, nunca excedendo o que
ainda resta reservado na linha (`quantity - já consumido`) —
overconsumption é rejeitado, nunca silenciosamente limitado. Revalida o
lote de novo no momento do consumo (independente do que valia no
Picking). Primeiro consumo confirmado da OP: `RELEASED → IN_PRODUCTION`,
grava `startedAt`/`startedBy` — sem botão separado "Iniciar produção".

## Reserved/Available depois do consumo — matemática centralizada

`getReservedByItems`/`getReservedByLots` (`inventory-ledger.ts`) deixaram
de somar só `MaterialReservationLine.quantity` e passaram a subtrair o
consumido por linha (`getConsumedByReservationLines`, novo) e excluir
linhas substituídas (`releasedAt` preenchido) — nenhum cálculo específico
de Produção em paralelo. Resultado: consumir estoque já reservado nunca
reduz `Available` de novo (On Hand e Reserved caem juntos, na mesma
quantidade). Exemplo coberto por teste: On Hand 100/Reserved 30/Available
70 → consome 10 → On Hand 90/Reserved 20/Available 70 → consome mais 18 →
On Hand 72/Reserved 2/Available 70. O restante não consumido (ex.: 2 kg)
permanece reservado enquanto a OP estiver `IN_PRODUCTION` — não é
liberado automaticamente (ficará para o futuro fluxo de conclusão da OP).

## Requirement ganha progresso de execução

`ProductionOrderRequirementDTO` ganhou `allocatedQuantity` (o que esta OP
tem ativamente reservado, próprio — nunca de outra OP),
`consumedQuantity`, `remainingReservedQuantity` e `reservationLines`
(linhas, incluindo substituídas, para a UI de Picking/Consumo). O ajuste
"a OP nunca compete contra si mesma no Available" (Delivery 13) evoluiu
para somar de volta o `remainingReservedQuantity` (líquido de consumo),
não mais a reserva bruta original — assim uma OP em produção nunca mostra
falta contra materiais que ela mesma já garantiu e parcialmente já usou.

## Hardening: cancelamento trava em IN_PRODUCTION

`cancelProductionOrder` passou a rejeitar explicitamente `IN_PRODUCTION`
("já houve consumo real de material") — reverter exigiria uma regra de
devolução/estorno que não existe ainda. `RELEASED` sem consumo continua
cancelável normalmente pelo fluxo já existente.

## Backend

`POST /production-orders/:id/picking/:reservationLineId/confirm`,
`POST /production-orders/:id/picking/:reservationLineId/substitute`,
`POST /production-orders/:id/consumptions` (`picking.service.ts`, módulo
novo, dedicado — mantém `production-orders.service.ts` focado no
lifecycle da OP). Sem `POST /reservations`/endpoint genérico de
movimentação — Consumo nunca passa pelo endpoint de Adjustment. Leitura
de Picking/Consumo embutida em `GET /production-orders/:id`
(`reservation.lines[]` enriquecido + `requirements[].reservationLines[]`
+ `consumptions[]` + `startedAt/startedBy`) — sem `GET .../consumptions`
dedicado, decisão de simplicidade ("estrutura equivalente coerente").
Concorrência: RELEASE, substituição e consumo travam `Item`s (e, no
consumo, também as `MaterialReservationLine`s) em ordem determinística
ascendente — mesmo padrão em todo o módulo.

## Frontend

Reaproveita `LotScanner` (câmera + digitação manual) já existente, sem
nova rodada de otimização mobile. `ProductionOrderPage` ganhou as seções
"Picking" (Item/Lote esperado/Validade/Localização/Reservado/Status/Ação
— escanear ou "Confirmar separação" para item sem lote) e "Consumo Real"
(Reservado/Consumido/Restante/input "Consumir agora" + histórico completo
Data/Item/Lote/Quantidade/Usuário — nunca só o total agregado), visíveis
quando `RELEASED`/`IN_PRODUCTION`. Diálogo de mismatch mostra os dois
códigos lado a lado (Esperado/Informado) com "Cancelar"/"Usar lote
diferente". Nova página **Produção → Picking / Consumo**
(`/producao/picking`) lista só OPs `RELEASED`/`IN_PRODUCTION`
("X/Y lotes conferidos", "X/Y materiais consumidos") e abre a mesma
`ProductionOrderPage` — sem duplicar a lógica de renderização da OP.

## Testes

27 novos testes de API: 15 em `picking.test.ts` (confirmação com código
puro/QR `LOT:`/item sem lote, picking duplicado rejeitado, mismatch com
lote de outro item, lote vencido/bloqueado/aguardando rejeitados,
substituição preserva histórico e não muda Reserved/On Hand do item,
Available migra corretamente entre lotes, rejeita lote insuficiente/outro
item/status inválido/substituição pós-consumo, concorrência de duas
substituições no mesmo lote alternativo) + 12 em `consumption.test.ts`
(exige Picking, primeiro consumo muda status e grava
startedAt/startedBy, cria Consumption+Movement exatos, item sem lote,
parcial/múltiplos consumos acumulam, exatamente igual ao reservado, não
excede reservado, lote inelegível entre Picking e consumo rejeitado,
histórico preserva todos os eventos, cancelamento bloqueado em
IN_PRODUCTION, matemática crítica Reserved/Available, concorrência real
de duas requisições disputando o restante da mesma linha). Total da API:
237 testes.

## Validação

`pnpm typecheck`/`build`/`test` (237 API + 7 web) — ok. Validado
visualmente via Playwright **só desktop**: OP RELEASED com seções Picking
(item com lote via digitação manual + item sem lote via "Confirmar
separação") e Consumo Real, primeiro consumo mudando status para "Em
produção", consumos parciais acumulando no histórico com On
Hand/Reserved/Available corretos na Visão Geral do Estoque, mismatch de
lote com diálogo Esperado/Informado, substituição preservando histórico
(linha antiga com nota "Lote substituído no Picking", linha nova já
conferida), listagem Picking/Consumo com contadores corretos. Regressão
em OP/Reservation/Inventory/FEFO/Lotes. Console limpo (únicos eventos são
o 404 pré-existente de `favicon.ico` e o 409 esperado da tentativa de
mismatch, ambos sem relação com exceções reais).

## Pendente (não bloqueante)

- Nenhuma pendência real dentro do escopo. Produção Parcial/conclusão da
  OP e Produto Acabado ficam para os próximos módulos, por decisão
  explícita do handoff — não avançar além de Picking/Consumo agora.

---

# Delivery 15 — Produção Parcial + Produto Acabado + Rastreabilidade

Fecha o ciclo industrial completo: OP `IN_PRODUCTION` → apontamentos de
produção (parciais, múltiplos) → lote de produto acabado → estoque físico
real → conclusão da OP (`IN_PRODUCTION → COMPLETED`) → liberação de
reserva remanescente → rastreabilidade bidirecional MP↔PA. Encerra o
Bloco C. Validada só em desktop web (Desktop Web First — sem
Playwright/browser tool disponível neste ambiente, ver "Pendente").

## Modelagem — ProductionOutput + Lot evoluído

- `ProductionOutput` (novo, histórico/imutável): `productionOrderId`,
  `lotId?`, `quantity` (`Decimal(18,6)`, sempre > 0), `producedAt`,
  `producedBy?`, `notes?`. `producedQuantity` da OP é **sempre**
  `sum(ProductionOutput.quantity)` — nunca uma segunda coluna manual.
- `Lot` evoluído para servir as duas origens (nunca uma segunda tabela
  paralela para produto acabado): novo enum `origin`
  (`RECEIPT`/`PRODUCTION`, default `RECEIPT`), `supplierId` virou
  nullable (sempre `null` para `PRODUCTION`), novo `productionOrderId?`
  → `ProductionOrder` (RESTRICT), novo `businessLotNumber?` (lote
  comercial/Veridi — informado pelo usuário, nunca substitui `Lot.code`,
  histórico, nunca reescrito). `initialReceivedQuantity` continua
  significando só "primeira quantidade" mesmo em lote produzido (nunca
  atualizado depois) — a quantidade produzida acumulada é um campo
  próprio (`producedQuantity`, `null` para `RECEIPT`, `sum` dos Outputs
  para `PRODUCTION`), nunca reaproveitando aquela coluna como saldo.
- `InventoryMovement` ganhou `type`/`sourceType`
  `FINISHED_GOOD_PRODUCTION` (entrada física, `direction: 1`) +
  `productionOutputId?` único (FK 1:1 real, mesmo padrão de
  `receiptLineId`/`productionConsumptionId`) — exatamente 1 movimento por
  Output, `onDelete: Cascade` (só limpeza de fixture).
- `ProductionOrder` ganhou `completedAt/By/completionReason`.
  Migration `20260824090000_production_output_and_finished_lots`.

## Produção parcial — nunca ultrapassa o planejado

Múltiplos `ProductionOutput` por OP são normais; a OP nunca conclui
automaticamente após o primeiro. Cada registro roda numa transação que
trava a OP (`SELECT … FOR UPDATE`) antes de somar os Outputs já
existentes — o mesmo lock resolve concorrência (dois apontamentos
simultâneos nunca somam acima de `plannedQuantity`). Exemplo do handoff
coberto por teste: planejado 1000, output 600 + output 390 = produzido
990, restante 10, sem perda de precisão Decimal.

## Novo lote ou lote existente da mesma OP

Registrar um Output aceita `NEW_LOT` ou `EXISTING_LOT`. Reuso de lote
exige, sob lock do próprio lote (protege contra dois Outputs
concorrentes no mesmo lote): `origin = PRODUCTION`, mesma OP, mesmo
Finished Item, não `BLOCKED`, não vencido, e — quando
`Item.requiresQualityRelease` — não já liberado (`AVAILABLE`): produção
nova nunca se mistura num lote já liberado pela Qualidade, cria lote
novo em vez disso. Sem `requiresQualityRelease`, um lote `AVAILABLE` da
mesma OP pode receber novo Output normalmente. `NEW_LOT` exige
`businessLotNumber`; exige `expiryDate` (nunca anterior a `producedAt`)
só quando `Item.controlsExpiry`; nunca pede validade de novo ao somar em
lote existente. `Item.controlsLot = false` bloqueia todo o fluxo com
mensagem clara — nunca cria pseudo-lote.

## Estoque, Qualidade e código do lote — reuso total da infraestrutura

Lote novo usa `nextLotCode` (mesma sequence `LT-YYYYMMDD-NNNNNN`, mesmo
QR `LOT:<code>`) e nasce `AWAITING_RELEASE`/`AVAILABLE` pela mesma regra
de `Item.requiresQualityRelease` do Recebimento — reaproveita
`POST /lots/:id/release|block` existente, sem segundo módulo de
Qualidade. `On Hand` sobe via `FINISHED_GOOD_PRODUCTION` (mesmo ledger,
`INVENTORY_MOVEMENT_DIRECTION` já cobria a extensão sem tocar
`inventory-ledger.ts`); `Available` só conta quando `AVAILABLE`/não
vencido — mesma regra de sempre. Produto Acabado aparece automaticamente
na Visão Geral do Estoque (tipo `FINISHED_PRODUCT` já suportado
genericamente) — nenhuma tela nova.

## Conclusão da OP — parcial permitida, reserva remanescente liberada

`POST /production-orders/:id/complete`: transação com lock, exige ao
menos 1 `ProductionOutput` (senão rejeita), **não** exige
`producedQuantity == plannedQuantity` (conclusão parcial é o caminho
normal). `variance = plannedQuantity - producedQuantity` (nunca negativo
— Output já é travado no teto do planejado); `variance > 0` exige
`completionReason`. Qualquer `MaterialReservation` ainda `ACTIVE` vira
`RELEASED` (`releaseReason: "PRODUCTION_COMPLETED"`) na mesma transação
— nunca apaga Reservation/Lines, nunca cria `InventoryMovement` (On Hand
não muda, `Available` sobe porque `Reserved` some). Teste crítico do
handoff coberto exatamente: On Hand 100/Reserved 30, consome 28 → antes
da conclusão On Hand 72/Reserved 2/Available 70 → depois da conclusão On
Hand 72/Reserved 0/Available 72, zero movimento novo para os 2 liberados.
Após `COMPLETED`: novo Picking/substituição/Consumo/Output/cancelamento
são todos rejeitados pelos mesmos gates de status já existentes (nenhum
código extra foi necessário — `COMPLETED` simplesmente não está em
nenhuma lista de status aceitos).

## Rastreabilidade bidirecional — só genealogia real

`GET /lots/:id/traceability` (`traceability.service.ts`, módulo novo em
`lots/`) — branch único por `Lot.origin`: `PRODUCTION` retorna
`FINISHED_GOOD` (backward: OP/Produto/quantidade produzida no lote +
materiais REALMENTE consumidos, agrupados por item+lote via
`ProductionConsumption`, com lote fornecedor/fornecedor do material);
qualquer outro lote retorna `RAW_MATERIAL` (forward: para cada OP que
realmente consumiu este lote, quanto foi consumido + quais lotes de
produto acabado foram gerados, via `ProductionOutput` real). **Nunca**
deriva de Requirement/MaterialReservation/sugestão FEFO — só
`ProductionConsumption`/`ProductionOutput` reais. Coberto por teste
crítico: um lote reservado e depois substituído no Picking (nunca
fisicamente consumido) não aparece em `usedIn` do lote original, só no
lote realmente consumido — a mesma genealogia usada para a UI (Lote de
Detalhe) e para a etiqueta (nunca infere do que foi planejado).

## QR / Etiqueta — sem novo sistema

`qrPayload` continua `LOT:<code>` sem mudança de payload. `LotLabel`
passou a ramificar por `lot.origin`: `PRODUCTION` nunca mostra "Lote
fornecedor", mostra "Lote Veridi"/"Data de produção"/"Quantidade
produzida" (acumulada, explicitamente não chamada de "saldo" — saldo
real segue vindo do ledger) em vez de "Quantidade recebida". Mesmo
componente, mesma rota de impressão — só o conteúdo muda.

## Backend

`production.service.ts` (módulo novo, dedicado — mantém
`production-orders.service.ts` focado no lifecycle):
`registerProductionOutput`/`completeProductionOrder`, mesmo padrão
transacional/lock de `picking.service.ts`. `production.errors.ts`/
`production.schemas.ts` seguem o mesmo padrão de erro tipado +
`mapDomainError` já usado em Picking. `getProducedQuantity` exportado de
`production-orders.service.ts` para reuso (mesma filosofia de "nunca
duplicar cálculo crítico" do resto da sessão).

## Frontend

`ProductionOrderPage` ganhou a seção "Produção" (visível em
`IN_PRODUCTION`/`COMPLETED`: resumo Planejado/Produzido/
Restante-ou-Variação + formulário "Registrar produção" com alternância
Novo lote/Lote existente da OP, campos condicionais por
`Item.controlsExpiry`/`requiresQualityRelease` buscados via `getItem` +
histórico completo "Data/Quantidade/Lote interno/Lote Veridi/Usuário/
Observação") e o botão "Concluir OP" (diálogo pedindo motivo só quando
há variação). `LotDetailPage` ganhou Identificação condicional por
origem (Produção mostra OP/Lote Veridi em vez de Fornecedor/Recebimento)
e a seção "Rastreabilidade" (formato depende de `kind` retornado pela
API). `LotLabel` ficou origin-aware (ver acima).

## Testes

24 novos testes de API: 15 em `production-output.test.ts` (rejeita fora
de `IN_PRODUCTION`, quantidade > 0, cria Output + exatamente 1
`FINISHED_GOOD_PRODUCTION`/On Hand sobe, produção parcial soma exata no
mesmo lote, nunca ultrapassa planejado, concorrência real no nível da OP
e no nível do mesmo lote, lote de outra OP rejeitado, lote bloqueado
rejeitado, código/origem/businessLotNumber/sem fornecedor confirmados,
`controlsLot`/`controlsExpiry`/validade-antes-da-produção, `AWAITING_
RELEASE`×`AVAILABLE` por `requiresQualityRelease`, lote já liberado não
recebe novo Output) + 5 de conclusão (sem Output rejeitado, exato sem
motivo, parcial com/sem motivo, matemática crítica de liberação de
reserva, `COMPLETED` bloqueia Output/Consumo/cancelamento) em
`production-output.test.ts`, mais 4 em `traceability.test.ts`
(`lots/`): backward com materiais reais, forward com lote(s) gerados,
CRÍTICO lote só reservado (nunca consumido, via substituição de Picking)
não aparece em `usedIn`, 404 para lote inexistente. Total da API: **261
testes** (237 + 24). Web: 8 testes (7 + 1 novo para `LotLabel` de lote
produzido) — todos passando.

## Validação

`pnpm typecheck`/`build`/`test` (261 API + 8 web) — ok em todo o
monorepo, incluindo o build final (`shared`→`api`→`web`). Regressão
completa da suíte de Produção/Estoque/Lotes confirmada (zero teste
quebrado pelas mudanças de schema/DTO).

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — a
  ferramenta de browser não está disponível neste ambiente. Toda a
  validação foi por typecheck/build/teste de integração real (contra
  Postgres, via `app.inject`) — cobre comportamento de API/regra de
  negócio, mas não confirma renderização/UX real da seção "Produção" e
  da "Rastreabilidade" no navegador. Recomendado validar manualmente
  (ou com Playwright quando disponível) antes de considerar a UI 100%
  fechada.
- Algoritmo automático definitivo de `businessLotNumber` (Lote Veridi)
  fica para decisão futura de Product Ownership — hoje é sempre
  informado manualmente, conforme handoff.

---

# Delivery 16 — Pedido do Cliente + Plano de Atendimento (Bloco D)

Conecta demanda comercial à operação: Pedido do Cliente → Plano de
Atendimento (análise) → reserva de Produto Acabado + OP DRAFT para o
déficit. Fecha o Bloco D core (22-25). Validada só em desktop web — sem
ferramenta de browser disponível nesta sessão, ver "Pendente".

## Modelagem — CustomerOrder/Line + CustomerOrderReservation/Line

- `CustomerOrder`: `code` (sequence `customer_order_code_seq`, prefixo
  `PED`), `customerId`, `orderDate`, `requestedDeliveryDate?`, `status`
  (`DRAFT`/`CONFIRMED`/`IN_FULFILLMENT`/`CANCELLED` — `READY`/
  `PARTIALLY_SHIPPED`/`SHIPPED` ainda não modelados), snapshot histórico
  nullable do cliente (`customerCode/Name/TradeName/Cnpj`, preenchido só
  no CONFIRM), auditoria de confirmação/cancelamento.
- `CustomerOrderLine`: `productId`, `orderedQuantity`, `unitCode` (sempre
  derivado do Finished Product Item — nunca aceito do cliente),
  `position`, snapshot histórico nullable (`productCode/Name`,
  `finishedItemId/Code/Name`). `@@unique([customerOrderId, productId])` —
  mesmo Product não repete no pedido, garantido no banco.
- `CustomerOrderReservation`/`CustomerOrderReservationLine`: contexto
  próprio de reserva de PRODUTO ACABADO — nunca reaproveita
  `MaterialReservation` (matéria-prima/embalagem de OP). Linha aponta
  `itemId`/`lotId?` (null só quando o Finished Item não controla lote,
  mesmo padrão de `MaterialReservationLine`). Nunca cria
  `InventoryMovement`. Histórica: nunca deletada, mesmo `RELEASED`.
- `ProductionOrder` ganhou `customerOrderId?`/`customerOrderLineId?` e o
  enum `ProductionOrderOrigin` ganhou `CUSTOMER_ORDER` (OPs antigas
  seguem `MANUAL` via default, sem migration de dados). Migration
  `20260825090000_customer_orders`.

## Reserved global — um único cálculo, duas fontes

`getReservedByItems`/`getReservedByLots` (`inventory-ledger.ts`) passaram
a somar **dois** compromissos por Item/Lote: `MaterialReservationLine`
ACTIVE (matéria-prima/embalagem, líquido de consumo) **e**
`CustomerOrderReservationLine` ACTIVE (produto acabado, quantidade cheia
— não há consumo parcial de PA reservado nesta fase). Nenhum módulo
recalcula Reserved em paralelo — Requirements de OP, FEFO, Lote,
Inventário e o próprio Plano de Atendimento leem exatamente a mesma
função. `Available = On Hand - Reserved` continua a mesma regra de
sempre.

## Plano de Atendimento — análise, nunca fonte de verdade

`GET /customer-orders/:id/fulfillment-plan` — só para pedidos
`CONFIRMED`, nunca persiste nada. Por linha: `Available` real (ledger) →
`suggestedReserve = min(ordered, available)`,
`suggestedProduce = ordered - suggestedReserve` (estoque primeiro).
`situation` é `ESTOQUE_SUFICIENTE`/`REQUER_PRODUCAO` (há Formulação
ACTIVE)/`SEM_FORMULACAO_ATIVA` (sem — o Plano ainda mostra o número, só
não persiste OP sem produto revisado). Impacto de materiais agrega a
mesma matéria-prima entre Products diferentes do pedido (ex.: 30 kg +
20 kg de Vitamina C = 50 kg) usando o **mesmo** cálculo de requirement de
OP — `computeFormulationRequirements` foi extraído de
`production-orders.service.ts` para `requirement-calc.ts` justamente para
ser reutilizado aqui sem duplicar a matemática de formulação/UOM.

## Aplicar o Plano — transacional, FEFO reaproveitado

`POST /customer-orders/:id/apply-fulfillment-plan`: usuário pode ajustar
Reservar/Produzir por linha (desde que a soma bata exatamente com o
pedido); backend nunca confia no `available` calculado pelo client —
recalcula tudo sob lock. Trava a OP/Items envolvidos em ordem
determinística (mesmo padrão do RELEASE de OP), roda
`getAllocationSuggestion` (o **mesmo** serviço de FEFO/FIFO já usado por
Estoque/OP — nenhum `finishedGoodsAllocationService` duplicado) para
resolver os lotes de cada reserva. Cria no máximo 1
`CustomerOrderReservation` e no máximo 1 `ProductionOrder` DRAFT por
linha com déficit (`origin: CUSTOMER_ORDER`, vinculada a
`customerOrderId`/`customerOrderLineId`, `plannedQuantity` =
quantidade a produzir escolhida). OP nasce DRAFT mesmo sem Formulação
ACTIVE (nunca bloqueia a aplicação por isso) — segue o fluxo normal,
nunca PLAN/RELEASE automático. Pedido vira `IN_FULFILLMENT` só no fim,
se tudo aplicar; qualquer falha reverte a transação inteira (reserva e
OPs geradas juntas, nunca parcial).

## Concorrência

Dois Pedidos disputando o mesmo saldo de Produto Acabado: `Item` travado
em ordem determinística antes de recalcular disponibilidade (idêntico ao
RELEASE de OP) — só um consegue reservar quando o saldo não cobre os
dois, nunca `Reserved > On Hand`. Testado com duas requisições `apply`
simultâneas reais.

## Cancelamento restrito em IN_FULFILLMENT

DRAFT/CONFIRMED cancelam livremente (motivo obrigatório, mesmo padrão de
sempre). `IN_FULFILLMENT` só cancela se não houver
`CustomerOrderReservation` ACTIVE nem `ProductionOrder` gerada — como o
Plano aplicado normalmente sempre gera pelo menos uma das duas, isso
bloqueia o cancelamento simples na prática (esperado: já existem
compromissos operacionais). Nunca cancela/libera nada em cascata
automaticamente — fluxo de cancelamento operacional completo fica para
evolução futura.

## Backend

Módulo novo `customer-orders/` (mesmo padrão de `picking.*` dentro de
`production-orders/`): `customer-orders.{errors,schemas,service,routes}.ts`
(CRUD/confirm/cancel, mesmo esqueleto de `purchase-orders.service.ts`) +
`fulfillment-plan.{errors,schemas,service,routes}.ts` (análise + aplicar).
`production-orders.service.ts` ganhou `createDraftProductionOrderInTx`
(cria OP DRAFT dentro de uma transação já aberta — efeito colateral
atômico de aplicar o Plano) e passou a incluir `customerOrder` no DTO
(`customerOrderId`/`customerOrderCode`/`customerOrderLineId`).

## Frontend

Comercial → **Pedidos** (`/comercial/pedidos`, lista Pedido/Cliente/
Data/Entrega/Produtos/Quantidade/Atendimento/Status) → **documento**
(`/comercial/pedidos/:id`, mesmo padrão de página própria de Ordem de
Compra): seção Produtos (DRAFT editável), seção **Plano de Atendimento**
(só quando `CONFIRMED`, inputs Reservar/Produzir sincronizados — editar
um recalcula o outro para sempre somar o pedido, impacto de materiais
abaixo, "Aplicar Plano" desabilitado até toda linha bater a soma), seções
**Reservas de Produto Acabado** e **OPs Geradas** (após aplicado, links
navegam para a OP). `ProductionOrderPage` ganhou seção "Origem" (Manual/
Pedido do Cliente com link de volta) quando `origin !== "MANUAL"`.

## Testes

19 novos testes de API: 9 em `customer-orders.test.ts` (código PED-
000001, cliente obrigatório/ativo, Product ativo/Finished Item válido/
quantidade > 0, Product duplicado rejeitado, DRAFT editável, confirmação
exige linha e congela snapshot, CONFIRMED trava produtos, snapshot
preservado após inativar cliente/produto, cancelamento com motivo) + 10
em `fulfillment-plan.test.ts` (matemática default 600/1200/0 disponível,
Plano nunca alterando estoque/criando OP, impacto de material agregado
entre Products, ajuste manual aceito/cobertura incompleta/reserva acima
do disponível rejeitados, FEFO em múltiplos lotes com On Hand/Reserved/
Available exatos e zero `InventoryMovement` novo, concorrência real de
dois Pedidos disputando o mesmo saldo, OP gerada com origin/vínculo/
DRAFT corretos, cancelamento bloqueado em IN_FULFILLMENT). Total da API:
**280 testes** (261 + 19). Web: 8 testes (regressão, nenhum novo teste de
componente fica dentro do orçamento desta entrega).

## Validação

`pnpm typecheck`/`build`/`test` (280 API + 8 web) — ok em todo o
monorepo. Regressão completa de Produção/Estoque/Lotes/Reservation
confirmada (zero teste quebrado pela extensão de `getReservedByItems/
Lots` e pela extração de `computeFormulationRequirements`).

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — mesma
  limitação de ambiente já registrada na Delivery 15. Fluxo comercial
  (lista de Pedidos, documento, Plano editável, aplicação, navegação
  Pedido↔OP) validado só via testes de integração reais (API) e
  typecheck/build do frontend — não confirma renderização/UX real no
  navegador.
- Sugestão de Compra (26), Expedição/Picking de Pedido (27) e Faturamento
  (28) não iniciados — próximo passo natural do roadmap, aguardando novo
  handoff.

---

# Delivery 17 — Sugestão de Compra + Geração de OC DRAFT

Fecha o fluxo: déficit de produto acabado → OP DRAFT → necessidade de
matéria-prima/embalagem → disponibilidade atual → Sugestão de Compra →
usuário escolhe fornecedor/quantidade → OC(s) DRAFT agrupadas por
fornecedor. Encerra a capacidade 26 do Bloco D. Validada só em desktop
web — sem ferramenta de browser disponível nesta sessão, ver "Pendente".

## Nenhum segundo módulo de compras

A saída operacional continua sendo `PurchaseOrder` existente, `status =
DRAFT` — nunca uma entidade `SuggestedPurchaseOrder`/`ProcurementOrder`
paralela. `PurchaseOrder` ganhou `origin` (`MANUAL`/`CUSTOMER_ORDER`,
default `MANUAL` — OCs antigas sem migration de dados) e
`customerOrderId?` (permite navegar Pedido↔OC nos dois sentidos).
Migration `20260826090000_purchase_order_origin`.

## Sugestão de Compra — análise, nunca fonte de verdade

`GET /customer-orders/:id/purchase-suggestion` — só para pedidos
`IN_FULFILLMENT`, nunca persiste `shortage`/`suggestedQuantity`/
`available`/`onOrder`. Necessidade vem dos `ProductionOrderRequirement`
REAIS das OPs `CUSTOMER_ORDER` deste Pedido (nunca recalcula fórmula em
paralelo — Requirement já é a necessidade técnica oficial). Só
participam OPs `DRAFT`/`PLANNED`/`RELEASED`/`IN_PRODUCTION`;
`CANCELLED`/`COMPLETED` nunca contribuem (a necessidade já foi
encerrada ou nunca existiu). OP sem Requirement (sem Formulação ACTIVE)
vira "pendência de planejamento" — nunca finge que não há necessidade.

Matemática por Item, agregada entre todas as OPs/Products do Pedido:
- `remainingRequired = max(requiredQuantity - consumido, 0)`, somado;
- `ownReserved` = reserva `ACTIVE` das próprias OPs deste Pedido para
  aquele Requirement, líquida de consumo (mesma fórmula de
  `remainingReservedQuantity` já usada na leitura da OP), somada;
- `operationalShortage = max(remainingRequired - ownReserved -
  globalAvailable, 0)` — `globalAvailable` já é líquido de TODAS as
  reservas (inclusive a própria), somar `ownReserved` de volta é
  exatamente "não tratar a própria reserva como indisponível para si
  mesma" (mesmo princípio já usado nos Requirements de OP desde a
  Delivery 12);
- `suggestedAdditionalPurchase = max(operationalShortage - onOrder, 0)`
  — On Order nunca reduz a falta física, só a recomendação de compra;
- `draftPurchaseQuantity` = soma das `PurchaseOrderLine` de OCs `DRAFT`
  já vinculadas a este Pedido (`customerOrderId`) para aquele Item —
  nunca conta em On Order, mas evita sugestão/criação repetida;
- `newSuggestedPurchase = max(suggestedAdditionalPurchase -
  draftPurchaseQuantity, 0)`.

## Geração de OC DRAFT — agrupada por fornecedor, nunca ORDERED

`POST /customer-orders/:id/purchase-drafts`: usuário escolhe fornecedor
+ quantidade por material (quantidade sugerida é só default, editável,
inclusive acima da sugestão — nunca bloqueado); `quantity = 0` nunca
cria linha; se tudo vier `0`, nenhuma OC é criada, mensagem clara. Nunca
confia em shortage/available enviado pelo client — só usa
`itemId`/`supplierId`/`quantity`, revalidando Item (RAW_MATERIAL/
PACKAGING ativo, mesma regra de `assertLineItemValid`) e Supplier
(ativo, mesma regra de `assertSupplierActive`) sob lock. Agrupa por
Supplier: materiais do mesmo fornecedor entram na mesma OC, nunca uma
OC por item. Toda OC nasce `DRAFT` — nunca chama o endpoint de
confirmação automaticamente; `unitPrice` sempre `null` (usuário preenche
depois no fluxo normal da OC); `orderDate` = agora, `expectedDeliveryDate
= null` (nunca copia `requestedDeliveryDate` do Pedido — conceitos
diferentes). `CustomerOrder` continua `IN_FULFILLMENT` — gerar OC nunca
cria um status novo.

## Concorrência

Lock no `CustomerOrder` (`FOR UPDATE`) serializa duas gerações
simultâneas, mais lock determinístico nos `Supplier`s envolvidos (mesmo
padrão do RELEASE de OP/Aplicar Plano) — nunca corrompe dados sob
corrida. O sistema não impede o usuário de deliberadamente comprar acima
da sugestão nem em duas requisições concorrentes explícitas — só garante
que a escrita em si nunca corrompe.

## Ciclo de vida coerente, sempre lido ao vivo

`draftPurchaseQuantity`/On Order nunca guardam a quantidade original da
sugestão — leem sempre as `PurchaseOrderLine` atuais. Se o usuário editar
a OC DRAFT depois (quantidade, itens), a próxima Sugestão de Compra já
reflete o valor atual. Cancelar a OC vinculada devolve a necessidade
(deixa de contar em Draft e em On Order). Confirmar a OC (`DRAFT →
ORDERED`) move a cobertura de `draftPurchaseQuantity` para `onOrder`
automaticamente — nenhuma integração especial foi necessária, ambos já
liam o estado atual das `PurchaseOrderLine`/`PurchaseOrder.status`.
Recebimento (`On Hand` sobe, `On Order` desce) já é automático pelo
mesmo motivo — nenhum código novo tocou o fluxo de Recebimento.

## Backend

Módulo novo `purchase-suggestion.{errors,schemas,service,routes}.ts`
dentro de `customer-orders/` (mesmo padrão de `fulfillment-plan.*`
sibling). `purchase-orders.service.ts` ganhou `createDraftPurchaseOrderInTx`
(efeito colateral atômico de gerar OCs a partir da Sugestão) e exportou
`assertSupplierActive`/`assertLineItemValid` para reuso — nunca duplicar
a regra "Item RAW_MATERIAL/PACKAGING ativo" / "Supplier ativo" em um
segundo lugar (a geração usa variantes locais operando sob a mesma
transação/lock, já que os validadores exportados sempre leem via
conexão própria).

## Frontend

`CustomerOrderPage` ganhou a seção **Sugestão de Compra** (só quando
`IN_FULFILLMENT` — tabela Material/Necessário restante/Reservado p/ este
Pedido/Disponível/Em Compra/Falta física/Já em rascunho/Comprar
sugerido/Comprar agora [input]/Fornecedor [select], "Gerar OCs em
rascunho" com `ConfirmDialog`) e **Ordens de Compra Vinculadas** (após
gerar, tabela OC/Fornecedor/Itens/Status/Valor, abre a OC existente).
`PurchaseOrderPage` ganhou uma seção discreta "Origem" (Pedido do
Cliente + link de volta) quando `origin !== "MANUAL"` — sem redesenhar a
tela, OC manual continua idêntica.

## Testes

14 novos testes em `purchase-suggestion.test.ts`: agregação do mesmo
Item entre Products, consumo real reduzindo `remainingRequired`/reserva
própria contando como cobertura, OP sem Requirements vira pendência,
`CANCELLED`/`COMPLETED` não contribuem, On Order não reduz falta física
mas reduz compra sugerida, matemática crítica completa (Remaining
100/Own 30/Available 20/On Order 20/Draft 10 → New Suggested 20,
conferida exatamente contra o exemplo do handoff), gate `IN_FULFILLMENT`,
geração de OC DRAFT (origin/vínculo/nunca ORDERED/unitPrice null/
agrupamento por fornecedor/fornecedor inativo e item inválido
rejeitados/quantidade zero não cria linha/tudo zero rejeitado/pedido
errado rejeitado), ciclo Draft→Confirmado (draftPurchaseQuantity desce,
On Order sobe) e cancelamento (devolve a necessidade), concorrência real
de duas gerações simultâneas. Total da API: **294 testes** (280 + 14).
Web: 8 testes (regressão).

## Validação

`pnpm typecheck`/`build`/`test` (294 API + 8 web) — ok em todo o
monorepo. Regressão completa de CustomerOrder/Production/Purchasing/
Inventory confirmada.

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — mesma
  limitação de ambiente já registrada nas Deliveries 15-16. Fluxo de
  Sugestão de Compra (números, seleção de fornecedor, geração agrupada,
  navegação Pedido↔OC) validado só via testes de integração reais (API)
  e typecheck/build do frontend.
- Expedição (27) e Faturamento (28) não iniciados — próximo passo natural
  do roadmap, aguardando novo handoff.

---

# Delivery 18 — Separação + Expedição (Bloco D, capacidade 27)

Fecha o fluxo físico de saída: Pedido IN_FULFILLMENT → produto acabado
reservado → separação → expedição parcial ou total → `SHIPMENT_OUT` →
On Hand e Reserved caem juntos → status do Pedido derivado. Validada só
em desktop web — sem ferramenta de browser nesta sessão, ver "Pendente".

## Modelagem — Shipment/ShipmentLine

- `Shipment`: `code` (sequence `shipment_code_seq`, prefixo `EXP`),
  `customerOrderId`, `status` (`DRAFT`/`CONFIRMED`/`CANCELLED`),
  `shipmentDate?`, `notes?`, auditoria de confirmação/cancelamento.
  **No máximo uma DRAFT por Pedido**, garantido por índice parcial
  (`WHERE status = 'DRAFT'`) — mesma técnica do CNPJ opcional e da versão
  ACTIVE única de formulação; validado por teste que insere direto no
  banco contornando o service.
- `ShipmentLine`: sempre ligada a uma `CustomerOrderReservationLine`
  específica (só se expede o que está reservado AO MESMO Pedido) +
  `customerOrderLineId`/`productId`/`itemId`/`lotId`/`quantity`/
  `unitCode`/`position`, com snapshot histórico preenchido na
  confirmação (product/finishedItem/lot/businessLotNumber) — base do
  futuro Faturamento.
- `InventoryMovement` ganhou `SHIPMENT_OUT`/`sourceType: SHIPMENT` +
  `shipmentLineId?` único (FK 1:1 real, mesmo padrão de
  `receiptLineId`/`productionConsumptionId`/`productionOutputId`).
- `CustomerOrderStatus` ganhou `PARTIALLY_SHIPPED`/`SHIPPED`;
  `CustomerOrderReservationLine` ganhou `releasedAt/By/Reason` +
  `replacesLineId` (1:N — diferente da substituição 1:1 do Picking, aqui
  o remanescente pode ser dividido em vários lotes). Migrations
  `20260827090000_shipments` + `20260827091500_reservation_line_realloc_one_to_many`.

## Reserved/Available — expedir nunca reduz Available duas vezes

`getReservedByItems/Lots` passaram a considerar, para reserva de Pedido,
apenas o **remanescente**: `quantity - expedido em Shipments CONFIRMED`,
excluindo linhas realocadas (`releasedAt`). Mesma filosofia já usada para
`MaterialReservation - ProductionConsumption`. Resultado (teste
obrigatório do handoff, coberto exatamente): On Hand 1000/Reserved 600/
Available 400 → expede 200 → 800/400/400 → expede os 400 → 400/0/400.
Nenhum módulo recalcula isso em paralelo.

## Separação × Expedição confirmada

`POST /customer-orders/:id/shipments` cria a DRAFT já pré-preenchida com
o reservado disponível de cada lote, limitado pelo que ainda falta
expedir de cada linha do Pedido. DRAFT nunca altera On Hand/Reserved/
status do Pedido, e cancelar (motivo obrigatório) não altera nada —
permite preparar outra depois. `PATCH /shipments/:id` ajusta quantidades
(`0 <= qty <= reservedRemaining`).

`POST /shipments/:id/confirm` é a **única** operação que altera estoque:
transação única que trava Shipment → Pedido → Items → Lotes em ordem
determinística, revalida a reserva, revalida a elegibilidade do lote
AGORA (vencido/bloqueado/aguardando Qualidade é rejeitado mesmo que a
reserva seja anterior), confere saldo físico real, cria exatamente 1
`SHIPMENT_OUT` por linha, grava o snapshot e recalcula o status do
Pedido. Rollback completo em qualquer falha. CONFIRMED é imutável — não
edita, não reconfirma, não cancela.

## Status do Pedido é sempre derivado

`PARTIALLY_SHIPPED`/`SHIPPED` saem 100% das ShipmentLines confirmadas —
não existe botão "marcar como enviado" nem PATCH manual de status.
`SHIPPED` = toda linha teve a quantidade pedida integralmente expedida; a
reserva ACTIVE remanescente é liberada na mesma transação
(`ORDER_SHIPPED`), sem gerar `InventoryMovement`. Depois de `SHIPPED`:
nada de nova expedição, nova reserva, edição de linhas ou cancelamento
simples.

## Reserva complementar — resolve a lacuna do produto produzido depois

`GET /customer-orders/:id/reservation-status` calcula por linha:
`ordered`/`shipped`/`reservedRemaining`/`stillToReserve = ordered -
shipped - reservedRemaining`/`currentAvailable`/
`suggestedAdditionalReserve = min(stillToReserve, currentAvailable)`.
`POST .../reserve-available` é **explícito** (nunca automático ao criar
um `ProductionOutput`): trava Pedido + Items, recalcula Available,
aloca por FEFO/FIFO com o MESMO `allocation.service.ts` e acrescenta
linhas à reserva ACTIVE existente — nunca sobrescreve histórico, nunca
cria `InventoryMovement`. Lote produzido em `AWAITING_RELEASE` aparece em
On Hand mas com Available 0 e não é reservável; após a liberação da
Qualidade passa a ser — sem nenhuma integração especial (coberto por
teste ponta a ponta).

## Realocação de reserva

`POST .../reallocate-reservation-line` realoca o remanescente não
expedido de uma linha cujo lote deixou de ser elegível — evita Pedido
permanentemente travado. A linha original nunca é apagada: fica marcada
como liberada e as novas linhas (podem ser várias, FEFO) apontam de volta
via `replacesLineId`. O já expedido continua referenciando a linha e o
lote originais — genealogia preservada, confirmado por teste. Sem
estoque suficiente → rollback completo (a linha original permanece
ativa).

## Hardening — bloqueio de lote

`blockLot` já usava `getReservedByLots`, que agora cobre os **dois**
compromissos (produção e Pedido do Cliente) — a regra passou a valer para
reserva de produto acabado sem código novo; só a mensagem foi
generalizada ("Este lote possui quantidade reservada").

## Backend

Módulo novo `shipments/` (`shipments.{errors,schemas,service,routes}.ts`
+ `reservation-status.service.ts`). `inventory.service.ts` passou a expor
`shipmentId`/`shipmentCode` no movimento, para a tela de Movimentações
existente identificar a Expedição de origem — sem tela paralela.

## Frontend

Comercial → **Expedições** (lista + documento próprio: separação editável
em DRAFT, bloco read-only após confirmar — estruturado para a futura
versão de impressão ser um recorte direto). `CustomerOrderPage` ganhou
**Reserva de Produto Acabado** (status + "Reservar disponível" +
"Preparar Expedição"), **Expedições** (histórico com link) e realocação
na tabela de reservas; a tabela de Produtos passou a mostrar Expedido/
Falta expedir. Movimentações linkam `SHIPMENT_OUT` → Expedição.

## Testes

19 novos testes em `shipments.test.ts`: DRAFT (código EXP-000001, não
altera estoque, uma DRAFT por pedido garantida no banco, teto do
reservado, cancelamento com motivo), confirmação (matemática crítica
completa do handoff, exatamente 1 `SHIPMENT_OUT` por linha identificável
pela Expedição, parcial → `PARTIALLY_SHIPPED` → `SHIPPED`, expedição
única direto para `SHIPPED`, FEFO em múltiplos lotes, lote bloqueado/
vencido/aguardando rejeitado, CONFIRMED imutável, `SHIPPED` bloqueia
tudo, concorrência real de duas confirmações simultâneas), reserva
complementar (AWAITING_RELEASE → liberação Quality, teto do pendente,
concorrência entre dois Pedidos) e realocação (genealogia preservada,
rollback sem estoque), mais o hardening de bloqueio de lote. Total da
API: **313 testes** (294 + 19). Web: 8 testes (regressão).

## Validação

`pnpm typecheck`/`build`/`test` (313 API + 8 web) — ok em todo o
monorepo. Regressão completa de CustomerOrder/Production/Purchasing/
Inventory confirmada (zero teste quebrado pela mudança de
`getReservedByItems/Lots`).

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — mesma
  limitação de ambiente já registrada nas Deliveries 15-17. Fluxo de
  expedição validado só via testes de integração reais (API) e
  typecheck/build do frontend.
- Faturamento (28) não iniciado; **Bloco E — Gestão, Relatórios &
  Exportações** (29-31) oficializado no roadmap nesta entrega, sem
  nenhuma implementação.

---

# Delivery 19 — Faturamento (Bloco D, capacidade 28)

Fecha o Bloco D: Pedido → Reserva → Produção quando necessária → Expedição
CONFIRMED → aguardando faturamento → Faturamento DRAFT → ISSUED. Validada
só em desktop web — sem ferramenta de browser nesta sessão, ver
"Pendente".

## Comercial, nunca fiscal

Entidade `Billing` (UI "Faturamento") — deliberadamente **não** chamada de
`FiscalInvoice`/`NFe`. Nada de NF-e, DANFE, XML, SEFAZ, impostos, contas a
receber ou pagamento. O `ConfirmDialog` de emissão diz explicitamente que
a ação não emite Nota Fiscal.

## Modelagem — Billing/BillingLine

- `Billing`: `code` (sequence `billing_code_seq`, prefixo `FAT`),
  `customerOrderId`, `shipmentId`, `status` (`DRAFT`/`ISSUED`/
  `CANCELLED`), `externalReference?` (referência livre a documento
  externo/ERP, ex.: "NF 12345" — o sistema nunca valida nem emite),
  `notes?`, snapshot histórico (cliente + código do Pedido + código/data
  da Expedição, reaproveitando os snapshots já existentes), auditoria de
  emissão/cancelamento. **No máximo um Billing ativo (DRAFT ou ISSUED)
  por Expedição**, garantido por índice único parcial — mesma técnica já
  usada para a DRAFT única de Expedição; um CANCELLED libera a vaga.
- `BillingLine`: cópia fiel de uma `ShipmentLine` (`quantity` idêntica,
  nunca recalculada do Pedido, nunca editável) + snapshot próprio
  (product/item/lote/businessLotNumber) + `unitPrice?` opcional.
  `lineTotal` nunca é persistido — sempre derivado com Decimal.
  Migration `20260828090000_billings`.

## Fonte da quantidade: só Expedição CONFIRMED

`POST /billings` exige `Shipment.status === CONFIRMED` (DRAFT e CANCELLED
rejeitados), copia todas as linhas sob lock da Expedição e valida a
ausência de Billing ativo. A emissão revalida a Expedição de novo — nunca
confia só na validação feita na criação do rascunho. Enquanto DRAFT só
`unitPrice`/`notes`/`externalReference` são editáveis; a API sequer
endereça quantidade/lote/produto.

## Preço opcional, valor só com pricing completo

Preço **nunca** é gate para emitir: o MVP precisa suportar faturamento
operacional mesmo quando os valores comerciais são controlados fora do
sistema. Preço negativo é rejeitado, zero é aceito (bonificação), e o
campo é limpável (`""` → `null`). `totalAmount` só existe quando **todas**
as linhas têm preço (`hasCompletePricing`) — somar parcialmente e
apresentar como total do documento seria enganoso. Essa semântica é
exatamente o que o Bloco E vai usar: *quantidade faturada* sempre
confiável, *valor faturado* só com pricing completo. Tudo em `Decimal`,
sem float JS; BRL na exibição.

## Progresso Pedido/Expedido/Faturado

`billedQuantity` por linha do Pedido é derivado das `BillingLine` de
Billings **ISSUED** — DRAFT e CANCELLED nunca contam, nunca uma coluna
mutável. `unbilledShippedQuantity = shipped - billed`. O estado de
faturamento do Pedido (`NOT_READY`/`PENDING`/`PARTIALLY_BILLED`/`BILLED`)
é **derivado**, nunca persistido e nunca misturado ao
`CustomerOrder.status`, que continua representando só o fluxo
operacional/logístico. Cada Expedição confirmada deriva
`PENDING`/`DRAFT`/`ISSUED`. Cenário completo coberto por teste: pedido
1000 → expede 400 e fatura → `PARTIALLY_SHIPPED`/`PARTIALLY_BILLED` →
expede 600 → `SHIPPED`/`PARTIALLY_BILLED` (600 expedidos não faturados) →
fatura → `SHIPPED`/`BILLED`.

## Estoque intocado

Billing **nunca** cria `InventoryMovement` e nunca altera On Hand/
Reserved/Available — a saída física já aconteceu no `SHIPMENT_OUT` da
Expedição. Também não altera a Expedição nem o status do Pedido. Coberto
por teste explícito (contagem de movimentos antes/depois de criar e
emitir).

## Aguardando faturamento

`GET /billings/awaiting` — read model simples de Expedições CONFIRMED sem
Billing ISSUED, diferenciando "Pendente" de "Em preparação" (já tem
rascunho). Base direta do futuro relatório R-16 e do Dashboard, sem
nenhuma tabela agregada.

## Backend

Módulo novo `billings/` (`billings.{errors,schemas,service,routes}.ts`).
`customer-orders.service.ts` ganhou `billedByOrderLine`,
`deriveBillingStatus` e os campos de progresso no DTO;
`shipments.service.ts` passou a expor `billingStatus`/`billingId`/
`billingCode` reutilizando `getBillingStatusByShipments` — nunca um
segundo cálculo.

## Frontend

Comercial → **Faturamento** (página operacional: "Aguardando faturamento"
com ação "Preparar faturamento", e abaixo a lista de documentos) +
documento próprio (preço editável por linha, total ou "Valores
incompletos", emitir/cancelar). `ShipmentPage` ganhou a seção Faturamento
(situação + preparar/abrir); `CustomerOrderPage` ganhou a seção
Faturamento (Pedido/Expedido/Faturado/A faturar/Situação + tabela de
documentos); a lista de Pedidos ganhou a coluna Faturamento. Navegação
bidirecional completa: Pedido ↔ Expedição ↔ Faturamento.

## Testes

16 novos testes em `billings.test.ts`: criação (FAT-000001, cópia fiel das
linhas, Expedição DRAFT/CANCELLED rejeitadas, um ativo por Expedição +
índice parcial validado contornando o service, CANCELLED libera a vaga,
concorrência de duas criações simultâneas, quantidade/lote/linhas não
editáveis), preço (opcional, total só com pricing completo, negativo
rejeitado, zero aceito, limpável, Decimal exato), emissão (sem preço,
`issuedAt`/`issuedBy`, imutável, não reemite, não altera Expedição/status
do Pedido/estoque/movimentos, concorrência de duas emissões) e progresso
(DRAFT não conta como faturado, cenário completo 1000 → BILLED, faturar
Pedido `PARTIALLY_SHIPPED`, aguardando faturamento com as três
situações). Total da API: **329 testes** (313 + 16). Web: 8 testes
(regressão).

## Validação

`pnpm typecheck`/`build`/`test` (329 API + 8 web) — ok em todo o
monorepo. Regressão completa de CustomerOrder/Shipment/Inventory/
Production confirmada.

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — mesma
  limitação de ambiente das Deliveries 15-18. Fluxo de faturamento
  validado só via testes de integração reais (API) e typecheck/build do
  frontend.
- **Bloco E — Gestão, Relatórios & Exportações** (29-31) é o próximo
  passo do roadmap; nada iniciado nesta entrega.

---

# Delivery 20 — Fundação de Custos (capacidade 29)

Base de custeio operacional confiável, estabelecida **antes** de qualquer
Dashboard/Relatório tentar mostrar dinheiro. Validada só em desktop web —
sem ferramenta de browser nesta sessão, ver "Pendente".

## Três conceitos distintos, nunca colapsados

1. **Preço da OC** (`PurchaseOrderLine.unitPrice`) — previsto/negociado;
2. **Custo efetivo de aquisição** (`ReceiptLine.actualUnitCost`) — a
   referência real de custo do material recebido;
3. **Valor efetivamente pago** — camada financeira futura, fora do MVP,
   nunca inferido a partir do custo ou da OC.

Princípio registrado: *primeiro saber quanto o material/produto custou;
depois evoluir para saber quando e quanto dinheiro saiu do caixa.*

## Modelagem

`ReceiptLine` ganhou `actualUnitCost?` (Decimal 14,4, por unidade de
estoque) + `costUpdatedAt/By/Note`. Nomeado "de aquisição" de propósito,
para no futuro comportar mercadoria + frete + despesas atribuíveis sem
quebrar o schema. `PurchaseOrderLine.unitPrice` teve a semântica
documentada como preço previsto. **Nenhum backfill** de preço de OC para
custo real — violaria a semântica. Migration
`20260829090000_acquisition_cost`.

## Custo opcional, nunca zero por omissão

O recebimento físico jamais falha por falta de custo: `actualUnitCost` é
sempre opcional na criação e pode ser informado depois via
`PUT /receipt-lines/:id/acquisition-cost` — operação de **custeio**, que
nunca reabre o documento físico (não altera quantidade/item/lote/
fornecedor) e **nunca cria InventoryMovement nem toca On Hand/Reserved/
Available/On Order**. Desconhecido é `null`; `0` é um valor
explicitamente informado (ex.: bonificação) e nunca reinterpretado como
desconhecido; negativo é rejeitado. Custo pode ser corrigido e limpo.

## Serviço central de referência de custo

`apps/api/src/lib/cost-reference.ts` — `getItemCostReference(prisma,
itemId, referenceDate)` com hierarquia sem nenhum atalho silencioso:
`ESTIMATED_30D → ESTIMATED_90D → LAST_REAL_COST → NO_COST`. **O preço da
OC jamais é usado como último recurso**: sem histórico real o resultado é
`NO_COST` com `unitCost = null`.

Médias são **ponderadas por quantidade recebida**
(`Σ(qtd × custo) / Σ(qtd)`), nunca médias simples — 10kg@10 + 90kg@20 dá
19, não 15 (teste obrigatório). Só entram ReceiptLines com custo
realmente informado; preço de OC, estimativas anteriores, Billing e custo
de produto acabado nunca participam. A `referenceDate` é sempre
respeitada: recebimentos posteriores a ela nunca entram no cálculo.

`getConsumedLotCostReference` dá prioridade absoluta ao **lote realmente
consumido** (`REAL`); só quando esse lote não tem custo informado — ou
quando o consumo não tem lote — cai no fallback do Item, sempre com o
`consumedAt` do próprio consumo, nunca "hoje". Consumo sem lote nunca é
classificado como `REAL`.

## Custo da formulação e da OP

`GET /formulation-versions/:id/cost-estimate` reaproveita a MESMA
conversão de UOM dos Requirements (`convertUomDecimal`) e é **sempre uma
estimativa**, mesmo com todos os componentes em referência recente — a
fórmula é um plano, e nada é persistido na versão (histórica/imutável).
Qualidade: `ESTIMATED`/`PARTIAL`/`NO_COST`.

`GET /production-orders/:id/material-cost` usa exclusivamente o
`ProductionConsumption` realmente registrado — nunca Requirement,
Reservation, sugestão FEFO ou formulação planejada. Qualidade agregada:
`REAL` (todos os consumos com custo do lote efetivamente consumido),
`ESTIMATED` (todos calculáveis, ao menos um por fallback), `PARTIAL`
(alguns sem custo) ou `NO_COST`.

**Custo parcial nunca parece completo**: em `PARTIAL` o
`knownMaterialCostSubtotal` é reportado à parte e o `totalMaterialCost`
fica `null`, junto com a lista de itens sem custo.

`materialUnitCost` divide **sempre pela produção real** (soma dos
`ProductionOutput`), nunca pela planejada — é isso que faz o rendimento/
perda aparecer naturalmente (teste: R$ 8.910 / 990 un = R$ 9,00/un, nunca
dividido por 1000). Sem produção ainda, o unitário fica indisponível em
vez de dividir por zero.

## Melhoria retroativa é desejável

Informar o custo depois melhora automaticamente o custo de OPs passadas
(`NO_COST` → `REAL`) — nenhuma estimativa antiga é congelada para impedir
isso. Mas o fallback histórico continua usando a data correta, então
compras posteriores ao consumo nunca entram numa estimativa retroativa.

## Frontend

Recebimento: campo "Custo efetivo de aquisição" opcional por linha, com o
preço previsto da OC exibido como referência e botão explícito "Usar
preço da OC" (nunca automático). Receipt Detail: colunas Preço previsto /
Custo efetivo + ação "Definir/Atualizar custo" sem reabrir o documento.
Lot Detail: lote recebido mostra "Custo de aquisição" (`REAL`) ou a
referência estimada do Item claramente rotulada como estimativa; lote
produzido mostra "Custo material da produção" vindo da OP, com aviso em
`PARTIAL` e a nota de que todos os lotes da OP compartilham o mesmo
unitário (sem rateio fictício). Item Detail: seção "Referência de custo"
(valor, origem, data, detalhe da janela). Formulação: seção read-only
"Custo estimado de materiais". OP: seção "Custo de materiais" (resumo +
detalhe por consumo, com a origem de cada custo).

## Testes

17 novos testes em `costs.test.ts`: recebimento sem custo, preço da OC
nunca virando real, negativo rejeitado / zero válido e distinto de null,
definir custo depois sem tocar quantidade/estoque/movimentos, correção e
limpeza, **média ponderada obrigatória (19, nunca 15)**, hierarquia
30d/90d/último/sem custo, recebimento posterior à data de referência
ignorado, formulação com UOM g→kg e mg→kg + embalagem + `basisQuantity`,
`PARTIAL`/`NO_COST` de formulação, **teste crítico de rastreabilidade de
custo (LT-A R$10 × LT-B R$30, consumiu LT-B → R$ 300, nunca a média)**,
**custo material/unidade com produção real (8910/990 = 9,00)**, fallback
do lote sem custo, `PARTIAL` da OP, **backfill melhorando a OP
automaticamente**, consumo sem output sem divisão por zero, precisão
Decimal. Total da API: **346 testes** (329 + 17). Web: 8 testes
(regressão).

## Validação

`pnpm typecheck`/`build`/`test` (346 API + 8 web) — ok em todo o
monorepo. Regressão completa de Purchasing/Receiving/Production/Inventory
confirmada; nenhum impacto no estoque quantitativo.

## Pendente (real)

- **Sem validação visual via Playwright/browser nesta sessão** — mesma
  limitação das Deliveries 15-19. Custos validados só via testes de
  integração reais (API) e typecheck/build do frontend.
- Seed de demonstração não foi ampliado com cenários de custo (evitando
  inflar o seed); os cenários `REAL`/`ESTIMATED`/`PARTIAL` estão cobertos
  por teste e podem ser reproduzidos manualmente na UI.
- **Bloco E — Gestão, Relatórios & Exportações** (30-32) é o próximo
  passo; nada iniciado nesta entrega.

---

# MVP scope locked

## Block A — Base
1. Users
2. Customers
3. Suppliers
4. Items
5. Products

## Block B — Purchasing & Inventory
6. Purchase Order
7. Receiving
8. Lots
9. QR / Labels
10. Inventory
11. Movements
12. FEFO

## Block C — Production
13. Formulations ✓
14. Versioning ✓
15. OP ✓
16. Requirement Calculation ✓
17. Reservation ✓
18. QR Picking ✓
19. Actual Consumption ✓
20. Partial Production / Completion ✓
21. Finished Product ✓

## Block D — Orders & Fulfillment
22. Customer Order ✓
23. Availability Analysis / Fulfillment Plan ✓
24. Finished-Product Reservation ✓
25. Suggested Production Orders ✓
26. Purchase Suggestion ✓
27. Picking / Shipping ✓
28. Invoicing ✓

## Cost foundation (transversal prerequisite)
29. Material cost foundation ✓

## Block E — Management, Reports & Exports (transversal, registered)
30. Executive/Operational Dashboard
31. Reports
32. CSV / PDF / Print exports

Executado só **depois** de 26/27/28/29 e **antes** da validação ponta a
ponta / demo final. Ver `docs/MVP_PLAN.md` (roadmap oficial),
`docs/PRODUCT_RULES.md` §30 (princípios de Dashboard/Relatórios) e §31
(regras duráveis de custo).

---

# Benchmark-driven capabilities now inside MVP
- partial Purchase Order receiving;
- On Order / Em Compra;
- document attachment/reference per lot;
- internal lot ID + supplier lot;
- simple physical location;
- optional supplier barcode;
- QR label;
- mobile/tablet scan-first flows;
- simple Quality availability status;
- physical inventory/stock count;
- auditable stock adjustment;
- FEFO across multiple lots;
- bidirectional traceability.

---

# Durable business decisions
- Inventory controlled by lot.
- Supplier lot and internal lot are separate.
- Negative stock is not silently allowed.
- On Order is not Available.
- Reservation happens at OP release.
- Reservation does not reduce On Hand.
- Actual consumption reduces On Hand.
- Unused reservation is released.
- Confirmed at implementation (Delivery 13): only `PLANNED → RELEASED`
  reserves; RELEASE requires 100% Available coverage of every Requirement
  (On Order never counts) or the whole transaction rolls back — no
  partial reservation. Reserved/Available are real everywhere (OP,
  Inventory, Lots, FEFO) from this point on, never a second calculation.
  Cancelling a `RELEASED` OP moves its reservation to historical
  `RELEASED` status (never deleted) in the same transaction, restoring
  Available automatically, with zero `InventoryMovement`. Manual
  adjustments/loss/Stock Count can never eat into reserved stock, and a
  lot with an active reservation can't be blocked — see
  `docs/PRODUCT_RULES.md` §14/§17/§19-21 for full detail.
- Confirmed at implementation (Delivery 14): Picking confirms a whole
  `MaterialReservationLine` (no partial picking), never moves stock,
  never re-reserves — only physical conference. A lot mismatch always
  requires an explicit "use different lot" action; substitution preserves
  full genealogy (`replacesLineId`, original line marked `releasedAt`,
  never deleted) and is only allowed before any Picking/consumption on
  that line, one alternate lot covering the whole quantity. Consumption
  requires Picking first, can be partial/repeated but never exceeds what
  a line still has reserved, and always creates exactly one
  `ProductionConsumption` + one `InventoryMovement`
  `PRODUCTION_CONSUMPTION` (real 1:1). The first confirmed consumption of
  an OP is what moves it `RELEASED → IN_PRODUCTION` — no separate "start
  production" action. Reserved/Available math is centralized (never a
  Production-only calculation): consuming already-reserved stock drops On
  Hand and Reserved together, so Available never moves again. Unused
  remainder after consumption stays reserved while `IN_PRODUCTION` — not
  auto-released. `IN_PRODUCTION` cannot be cancelled in this phase — see
  `docs/PRODUCT_RULES.md` §22-23 for full detail.
- Confirmed at implementation (Delivery 15): multiple `ProductionOutput`
  per OP are normal (partial production), produced quantity is always
  `sum(ProductionOutput)`, never a second manual column, and it never
  exceeds `plannedQuantity` (enforced under the same OP row lock used for
  concurrency). Each Output generates exactly one `InventoryMovement`
  `FINISHED_GOOD_PRODUCTION` (real 1:1). Finished-good lots reuse the
  existing `Lot` table (new `origin` enum) — never a parallel table;
  `businessLotNumber` (Lote Veridi) is user-entered, historical, never
  replaces `Lot.code`/`supplierLot`. A new Output can join an existing
  finished lot from the *same* OP only when not blocked/expired and — if
  the item requires Quality release — not already released (new
  production never mixes into an already-released lot). Completing an OP
  (`IN_PRODUCTION → COMPLETED`) never requires
  `producedQuantity == plannedQuantity`; any remaining `ACTIVE` reservation
  is released in the same transaction (never deleted, never an
  `InventoryMovement`) — On Hand stays, Available rises. Bidirectional
  traceability (`GET /lots/:id/traceability`) is built strictly from real
  `ProductionConsumption`/`ProductionOutput` rows — never from
  Requirement/Reservation/FEFO suggestion; a lot only reserved and never
  actually consumed never appears as "used". See
  `docs/PRODUCT_RULES.md` for full detail.
- Confirmed at implementation (Delivery 16): a Customer Order is commercial
  demand only — it is never a source of stock truth by itself. The
  Fulfillment Plan is pure analysis/projection (never persists a reservation
  or OP on `GET`); applying it always revalidates availability under lock at
  that moment, never trusting a client-supplied number. Default proposal is
  stock-first (`reserve = min(ordered, available)`,
  `produce = ordered - reserve`), but the user can rebalance
  reserve/produce per line as long as they sum to exactly the ordered
  quantity. Finished-goods reservation (`CustomerOrderReservationLine`) is
  a separate context from `MaterialReservation` (raw-material/packaging of
  an OP) — both feed the same central `Reserved` calculation in
  `inventory-ledger.ts`, never a parallel calculation per module; finished
  goods reservation never creates an `InventoryMovement`. A deficit always
  generates at most one DRAFT `ProductionOrder` per order line
  (`origin: CUSTOMER_ORDER`, linked back to the order/line) — it never
  auto-PLANs/RELEASEs, and is created even without an ACTIVE formulation
  version (shown as a visible pending item, never silently blocked). FEFO
  allocation for finished goods reuses the exact same
  `allocation.service.ts` used everywhere else — no second allocation
  service. Material impact simulation reuses the exact same formulation/UOM
  math as OP requirement calculation (extracted into
  `requirement-calc.ts`) — the Plan never reserves raw material, it only
  shows the impact. See `docs/PRODUCT_RULES.md` for full detail.
- Confirmed at implementation (Delivery 17): Purchase Suggestion is
  analysis only — physical shortage (`operationalShortage`) and
  suggested-additional-purchase are distinct concepts, never persisted;
  both are always recomputed live from real `ProductionOrderRequirement`s
  of the Customer Order's linked Production Orders (never a parallel
  formula recalculation), net of real consumption. A Production Order's
  own active reservation for that need counts as guaranteed coverage
  (added back on top of the already-reservation-net `Available`), never
  treated as unavailable to itself. `On Order` (`ORDERED`/
  `PARTIALLY_RECEIVED` only, never `DRAFT`) never reduces physical
  shortage — it only reduces the *suggested* additional purchase. DRAFT
  Purchase Order lines already linked to this Customer Order are read
  live (never a frozen snapshot of the original suggestion) specifically
  to avoid suggesting/creating the same purchase repeatedly; cancelling
  that linked PO hands the need back, confirming it moves the same
  quantity from "draft" into "On Order" with no special integration
  needed. The system never chooses a Supplier automatically and never
  confirms a generated Purchase Order automatically — it always creates
  `PurchaseOrder` rows in `DRAFT`, grouped one-PO-per-chosen-Supplier,
  reusing the exact same `PurchaseOrder` entity/lifecycle (never a second
  purchasing module) with `origin: CUSTOMER_ORDER` and a link back to the
  order. See `docs/PRODUCT_RULES.md` for full detail.
- Confirmed at implementation (Delivery 18): reservation, separation and
  confirmed shipment are three distinct concepts — only a CONFIRMED
  Shipment changes stock; a DRAFT never touches On Hand/Reserved/order
  status. A Shipment can only draw from quantity reserved to that same
  Customer Order — finished product produced later must be explicitly
  reserved first, never auto-reserved by a ProductionOutput. Confirming
  creates exactly one `SHIPMENT_OUT` per line (real 1:1) and drops On Hand
  and Reserved together, so shipping already-reserved stock never reduces
  Available twice; a Customer Order reservation contributes only its
  not-yet-shipped remainder, computed centrally in the ledger.
  `shippedQuantity`/`reservedRemaining` are always derived from confirmed
  ShipmentLines. `PARTIALLY_SHIPPED`/`SHIPPED` derive strictly from real
  shipments — no manual "mark as shipped", no status PATCH — and reaching
  `SHIPPED` releases any leftover active reservation in the same
  transaction, without an inventory movement. Lot eligibility and physical
  On Hand are revalidated at confirmation time. An ineligible lot's
  not-yet-shipped remainder can be explicitly reallocated (FEFO, 1:N),
  never deleting the original line — already-shipped quantity keeps
  pointing at the original line/lot. A lot with remaining reserved
  quantity from *either* commitment cannot be blocked. A CONFIRMED
  Shipment is immutable; undoing a physical exit needs a future
  return/re-entry flow. Future Invoicing is based on what was actually
  shipped. See `docs/PRODUCT_RULES.md` §27 for full detail.
- Confirmed at implementation (Delivery 19): Billing is a commercial/
  operational document, never fiscal (no NF-e/DANFE/SEFAZ/taxes/
  receivables) — the entity is `Billing`, never `FiscalInvoice`/`NFe`.
  The billable quantity always comes from a CONFIRMED Shipment's lines,
  never from ordered/reserved/planned/produced quantity and never
  recalculated from the order. Each Shipment is billed in full by one
  Billing in this phase (partial billing inside a shipment, and a Billing
  consolidating several shipments, are explicit future evolutions); an
  order still bills partially through multiple shipments. At most one
  active Billing (DRAFT/ISSUED) per Shipment, enforced by a partial
  unique index — a CANCELLED one frees the slot. Billing lines are never
  free: no add/remove, no quantity/lot/product/unit change; while DRAFT
  only price, notes and external reference are editable, and ISSUED is
  fully immutable. Price is optional and never a gate for issuing (never
  invented, never taken from a Purchase Order); a total amount exists
  only when every line is priced — *billed quantity* is always
  trustworthy, *billed value* only with complete pricing. `billedQuantity`
  is derived from ISSUED billings only (DRAFT/CANCELLED never count), and
  the order's billing state is derived, never persisted and never merged
  into `CustomerOrder.status`. Billing never creates an inventory
  movement and never changes stock, the shipment or the order status —
  the physical exit already happened at `SHIPMENT_OUT`. A shipment of a
  merely `PARTIALLY_SHIPPED` order can be billed normally. See
  `docs/PRODUCT_RULES.md` §28 for full detail.
- Confirmed at implementation (Delivery 20): **PO price ≠ real cost ≠
  payment**. The PO price is never auto-copied into real cost and never
  used as a silent fallback; real cost is born at receiving
  (`ReceiptLine.actualUnitCost`) and is always optional — a physical
  receipt never fails for lack of cost, and the cost can be informed
  later through a costing operation that never reopens the physical
  document and never creates an inventory movement or touches On Hand/
  Reserved/Available/On Order. Unknown cost is `null`, never `0` (a `0`
  is an explicitly informed value); negatives are rejected. Fallback is
  strictly `REAL → ESTIMATED_30D → ESTIMATED_90D → LAST_REAL_COST →
  NO_COST`, with averages **weighted by received quantity** and fed only
  by actually-informed real costs. The reference date is always honoured
  — receipts after it never count, and a consumption always uses its own
  `consumedAt`, never "today". Production material cost comes strictly
  from the real `ProductionConsumption`, and **the lot actually consumed
  wins** over any item average or FEFO expectation; a lot-less
  consumption is never `REAL`. A formulation cost is always an estimate
  and never persisted in the version. Cost quality is always explicit,
  and **a partial cost never looks complete** (subtotal reported apart,
  total unavailable). Material cost per unit always divides by the
  actually produced quantity, never the planned one, so yield/loss shows
  up naturally. Informing a cost later is allowed to retroactively
  improve past production costs. Finished-product cost comes from its
  Production Order, never from a Billing sale price, and no margin is
  computed. See `docs/PRODUCT_RULES.md` §31 for full detail.
- Registered at Delivery 18 (Product Ownership decision, not implemented):
  **Block E — Management, Reports & Exports** (29-31) is a transversal
  layer executed after Invoicing (28) and before the end-to-end demo.
  Dashboards/reports are never a source of truth; KPIs derive from
  operational entities; current state and period metrics stay clearly
  separated; operational cockpit over complex BI. Export rules by surface:
  listing → CSV; report → CSV + print/PDF; transactional document →
  print/PDF; traceability → print/PDF; editing surface → no export. FAST
  MVP uses print-oriented HTML + `window.print()` (no PDF library), and
  CSV always exports the complete filtered result, not just the visible
  page. See `docs/MVP_PLAN.md` and `docs/PRODUCT_RULES.md` §30.
- Formula ACTIVE versions remain historical/immutable.
- OP keeps exact formula version.
- Insufficient Available stock blocks OP release by default.
- Partial production is allowed.
- Finished product is inside MVP.
- Finished product traces back to actual consumed lots.
- Raw-material lot traces forward to produced finished lots.
- Inventory corrections create auditable adjustment/reversal events.
- Purchase Order: only DRAFT→ORDERED, DRAFT→CANCELLED, ORDERED→CANCELLED
  are executable this delivery; no free-form status change via PATCH.
- A DRAFT PO is fully editable; ORDERED locks everything except expected
  delivery date and notes; CANCELLED is read-only.
- Confirming a PO re-validates supplier/items and freezes a snapshot
  (supplier + line item code/name/unit) so later master-data edits never
  change how a confirmed PO reads.
- A PO line's unit always comes from the item's stock unit; only
  RAW_MATERIAL/PACKAGING can be purchased; same item can't repeat in a PO.
- Cancelling a PO requires a reason and records who/when; never deletes it.
- Only ORDERED/PARTIALLY_RECEIVED POs can receive; a PO's received/open
  quantity is always derived from real ReceiptLines, never a stored column.
- Receipt is created already confirmed (no persisted DRAFT) and is
  historical/read-only from then on; never deleted.
- Lot.initialReceivedQuantity is what arrived in that receipt only — never
  a current balance; On Hand comes later from Inventory Movements.
- A lot's Quality gate starts AWAITING_RELEASE or AVAILABLE per the item's
  requiresQualityRelease; only explicit release/block transitions exist,
  block requires a reason.
- Supplier lot and internal lot code are always stored as two distinct
  fields; the supplier's own identification is never overwritten by ours.
- A lot's QR payload (`LOT:<code>`) is an immutable identifier only —
  reuses `Lot.code`, never a new identity/UUID, never encodes
  quantity/status/location/expiry/supplier; the QR image is never stored,
  always generated on demand. QR/scanned input is never trusted beyond
  identity — lookup only, never creates or mutates a lot.
- Label printing is browser-only in this MVP (no print server/ZPL/Zebra);
  the label stays human-readable without a scanner and never shows
  available/reserved balance, price, full PO, or other financial data.
- The lot scanner always offers manual entry alongside camera — camera is
  never mandatory, and camera permission is requested only when scanning
  starts.
- Roadmap expandido com Bloco D — Pedidos & Atendimento (22–28).
  Capacidades 22–25 são candidatos ao MVP ampliado após conclusão das
  dependências de Estoque, Formulações, OP e Produto Acabado. Nenhuma
  implementação iniciada.
- FAST MVP adotou estratégia Desktop Web First. Mobile/tablet e
  refinamentos responsivos ficam para uma rodada de hardening após
  validação do fluxo funcional completo. Suporte já existente permanece,
  mas novas entregas não devem gastar tempo com otimizações específicas
  para dispositivos menores sem solicitação explícita.
- `InventoryMovement` é a única fonte de verdade das quantidades físicas.
  `Lot.initialReceivedQuantity` nunca é saldo. `On Hand` é sempre derivado
  (soma algébrica dos movimentos), nunca uma coluna em `Item`/`Lot`.
- `Available` respeita o status operacional do lote: só lotes `AVAILABLE`
  e não vencidos contam; `AWAITING_RELEASE`/`BLOCKED` continuam em `On
  Hand` mas contribuem 0 para `Available`. Liberar/bloquear um lote nunca
  cria `InventoryMovement` — muda `Available`, nunca `On Hand`.
- `On Order` é sempre derivado das `PurchaseOrderLine`s de OCs
  `ORDERED`/`PARTIALLY_RECEIVED` — nunca uma segunda quantidade persistida.
- Ajuste manual e inventário físico nunca editam saldo diretamente — só
  criam `InventoryMovement` (`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`/`LOSS`),
  sempre com motivo obrigatório quando há diferença/saída. Estoque nunca
  fica negativo — saída/perda é travada e validada contra o saldo atual
  sob lock, mesmo padrão de concorrência do Recebimento.
- FEFO é a estratégia padrão para itens com validade; FIFO (recebimento
  mais antigo) é o fallback para itens que controlam lote sem validade.
  Só lote `AVAILABLE` (efetivo, considerando expiração calculada) com
  saldo > 0 participa da alocação. A sugestão de alocação é sempre
  recomendação/cálculo — nunca reserva, baixa estoque ou cria
  `InventoryMovement`; nada é persistido. `On Order` nunca satisfaz
  necessidade física (não entra na alocação). O usuário poderá no futuro
  substituir o lote sugerido por outro, desde que `AVAILABLE` e com
  saldo — FEFO é default, não uma regra que torna outro lote impossível.
- Um Item "operacionalmente utilizado" (referência em PO line/Receipt
  line/Lot/InventoryMovement) trava `type`/`unitCode`/`controlsLot`/
  `controlsExpiry` para sempre — nunca corromper o significado de
  histórico já registrado. `requiresQualityRelease` continua sempre
  editável e nunca retroage sobre lotes já existentes.
- Formulação pertence ao `Product`, nunca ao Item de saída diretamente;
  a versão preserva um snapshot do output (item/unidade/código/nome) no
  momento da criação/cópia — nunca depende da associação atual do
  Product. Só uma versão `ACTIVE` por Product (garantido também no
  banco). `ACTIVE`/`INACTIVE` são imutáveis por construção — mudar a
  formulação sempre cria uma nova versão, nunca edita uma existente.
  Componentes são só `RAW_MATERIAL`/`PACKAGING`; a unidade do componente
  pode diferir da unidade de estoque do item, desde que mesma dimensão
  (UOM). `basisQuantity` define a base de cálculo da versão.
- Ordem de Produção preserva a formulação exata usada (snapshot do
  `formulationVersionId`/número/output, congelado só no planejamento,
  nunca na criação). `ProductionOrderRequirement.requiredQuantity` é a
  necessidade técnica congelada (fonte de verdade); On
  Hand/Reserved/Available/On Order/Shortage nunca são persistidos —
  sempre calculados ao vivo a partir do `inventory-ledger.ts`, mesmo
  contrato em qualquer tela. Uma OP `PLANNED` pode existir com shortage —
  insuficiência de estoque não bloqueia o planejamento, só bloqueará o
  futuro `RELEASE`. `On Order` nunca reduz o shortage exibido (mostrado
  separado, "Em Compra"). A sugestão FEFO/FIFO em uma OP é só
  recomendação — nunca reserva, nunca persiste, mesmo serviço de
  `allocation.service.ts` já usado fora do contexto de OP.

---

# Delivery 35 — Estrutura de custos industriais (Bloco G, capacidade 43)

## Housekeeping da impressão dos relatórios
Fechada a última divergência da política da 42: os relatórios não imprimem
mais a própria tela. `/print/relatorios/:code` monta o documento fora do
AppShell a partir do MESMO endpoint de exportação (resultado filtrado
completo, colunas rotuladas) — uma implementação genérica, não 17. R-06 e
R-14 são consultas de documento único e ganharam impressão própria. O
`useReport` perdeu o `print` que chamava `window.print()` sobre a tela.

## Estrutura versionada
`IndustrialCostVersion` (`EC-000001 · V2`) por produto, com
`IndustrialCostLine` para as premissas manuais.

- No máximo um rascunho e uma versão ativa por produto — índices parciais no
  banco. "Nova versão" com rascunho aberto devolve o rascunho.
- Só rascunho é editável; ativa/inativa são histórico. Ativar move a
  anterior para inativa na mesma transação.
- A versão aponta para uma **FormulationVersion específica**. Trocar a
  formulação ativa do produto não reescreve estrutura existente: a
  defasagem vira informação na tela ("usa V3, ativa é V4"), com CTA para
  nova versão.
- Rascunho pode apontar para formulação rascunho (engenharia), mas ativar
  exige formulação estável.
- Ativação congela snapshots (produto, cliente, formulação, unidades por
  caixa).

## Estrutura ≠ cálculo
Nada aqui soma total. Matérias-primas e embalagens vêm da formulação,
read-only, com material do cliente marcado — ele pertence à estrutura
física, nunca ao custo de aquisição Veridi.

Categorias manuais desta fase: embalagem secundária/expedição, serviço
terceirizado, overhead e outros. Mão de obra, equipamento e energia são
recusados de propósito (400) — ganham modelagem própria na 44.

Bases de cálculo: fixo por lote, por unidade, por 1.000 unidades, por caixa
de expedição e % do custo industrial direto (10 = 10%, teto técnico de
1000%). A definição da base do percentual está registrada, mas o cálculo é
da 45.

## Desconhecido continua desconhecido
`rateValue` nulo é "não informado", nunca zero. Completude é derivada:
taxa sem valor, caixa de expedição sem unidades por caixa ou formulação
ainda em rascunho geram pendência. Ativar incompleta é permitido **com
confirmação explícita** — o cadastro não trava e nenhum zero é inventado.

## UI e impressão
Página própria em `/produtos/:productId/custos` (documento versionado, não
modal), resumo no cadastro do produto e impressão dedicada em
`/print/estrutura-custos/:id`, com aviso impresso de que aquilo é estrutura
e premissas — não CMV consolidado.

## Corpus CMV
`cmv_produtos` (9), `cmv_componentes` (52) e `cmv_precificacao` (27) entram
no `veridi:import:validate` apenas como estatística: 52 componentes com
código de item (todos candidatos a material de formulação), 3 faixas de
quantidade, 27 linhas com preço/margem/comissão e custo histórico
disponível por unidade e por 1.000 unidades. **Nada é persistido**:
recursos industriais ficam para a 44, cálculo para a 45 e preço/margem para
a 46 — cada bloco com finding declarando o destino.

## Sem efeito colateral
Testado: criar e ativar estrutura não altera custo real de aquisição,
ofertas de fornecedor, movimentos de estoque nem orçamentos.

## Não implementado de propósito
Recurso/equipamento/tarifa de energia/mão de obra, CMV consolidado, custo
padrão, fallback de preço de fornecedor no custo, câmbio, simulador de
preço, margem, comissão, faixas de quantidade e integração com orçamento.

---

# Delivery 34 — UX de aderência operacional (Bloco F, capacidade 42)

## Navegação e cockpit
Sidebar reordenada pelo FLUXO DE TRABALHO (Comercial → Produção → Compras →
Estoque → Qualidade → Cadastros → Gestão → Administração): cadastro, gestão
e administração saem do meio da operação diária.

- **Ações rápidas** no dashboard abrem o início dos fluxos mais usados.
  São links para as telas com todas as validações — nunca atalho que pula
  pré-condição — e respeitam o perfil (o backend continua sendo a
  autoridade).
- **Atenção agrupada por causa**: "OP com falta de material — 1 item" em vez
  de N linhas quase idênticas. Cada grupo expande até 5 exemplos e tem
  "ver todos" apontando para a tela que resolve o problema. Continua
  derivado do read model, sem tabela de atenção e sem query nova (o
  agrupamento acontece sobre a lista já calculada).

## Ação destrutiva sai da tabela
`RowActions` (menu ⋯) recebe inativar/reativar em Itens, Clientes,
Fornecedores e Produtos; "Editar" continua visível. A confirmação
(`ConfirmDialog`) não mudou — o menu reduz exposição, não segurança.

## Contexto de fluxo
`FlowContext` mostra a cadeia de documentos (Pedido › OP › Expedição ›
Faturamento; Projeto › Produto; Amostra › Projeto). É **navegação, não
status**: nada recalcula estado, etapa inexistente não aparece como
documento pendente e a rastreabilidade completa continua na tela do lote.
Todos os dados vêm dos DTOs que a página já carregava — nenhum endpoint
novo.

## Filtros que não somem
`usePersistentFilter` guarda cada filtro em `sessionStorage`, por usuário e
por tela (Lotes, Projetos, Pedidos, Ordens de Produção, Item × Fornecedor).
"Limpar filtros" sempre disponível. Não existe visão salva no banco.

## Relatórios reconhecíveis
Hub com busca client-side e apelidos do dia a dia ("Kardex", "necessidade
p/ produção", "carteira"). O código oficial `R-xx` e os endpoints
continuam intactos.

## Impressão profissional
Decisão de PO incorporada: `window.print()` continua sendo o mecanismo de
saída, mas a ORIGEM é sempre um documento dedicado — a tela operacional
nunca é impressa.

- `PrintSheet` + `PrintSignatureArea` + `PrintWriteCell`/`PrintCheckCell`
  somam-se ao `PrintLayout`/`PrintTable` já existentes; `print.css`
  centraliza `@page` (A4 retrato por padrão, paisagem só onde a largura
  exige), quebras (`break-inside: avoid`, título não órfão), leitura em
  preto e branco e ocultação dos controles.
- Cabeçalho padrão: identidade Veridi, nome/código do documento, filtros
  aplicados, gerado em e **gerado por** (usuário da sessão). Isso é o autor
  da IMPRESSÃO — não substitui os snapshots de quem executou/aprovou.
- Cinco folhas operacionais, em rotas fora do AppShell e sempre em
  pré-visualização: **FO-01** contagem física (com opção de contagem cega),
  **FO-02** posição de estoque (paisagem), **FO-03** pendências de
  qualidade/CoA, **FO-04** separação/picking da produção, **FO-05**
  separação da expedição.
- Folha derivada de lista usa o resultado filtrado COMPLETO (`all=true`).
- Campos de papel (contagem, conferido ☐, observação, assinatura) não
  persistem nada: quem registra é o ERP depois. Assinatura em papel nunca é
  chamada de assinatura eletrônica.

## Terminologia
Rótulos de estoque padronizados em pt-BR (Físico / Reservado / Disponível /
Em Compra) e mensagens de erro comuns traduzidas no cliente, com o código
técnico ainda visível no console. Projeto e amostra importados mostram
"Importado do legado" como informação discreta, nunca alerta.

## Não implementado de propósito
Busca global, command palette, notificações, visões salvas, Kanban,
onboarding, dashboard configurável, mobile/responsivo, PDF no backend,
editor de template e qualquer redesenho do design system.

---

# Delivery 33 — Importador definitivo das planilhas (Bloco F, capacidade 41)

## Pipeline formal
`validate → plan → apply → verify`, mais `opening-stock` como processo
separado. Comandos oficiais: `veridi:import:*` e `veridi:opening-stock:*`;
`veridi:data:validate`/`veridi:data:seed` continuam como alias e executam o
MESMO pipeline (não existe segunda implementação). Runbook completo em
`docs/VERIDI_MIGRATION.md`.

- **Dry-run é o padrão**: só `apply -- --apply` escreve. PLAN e APPLY rodam
  o mesmo código com as escritas desligadas/ligadas — o plano descreve
  exatamente o que o apply faz.
- **Nada é resetado**: sem TRUNCATE, DROP ou deleteMany global. Aditivo e
  idempotente por `externalCode`/`sourceKey`/chave de negócio.
- **Manifesto com SHA-256** de cada CSV no `import-plan.json`. Se a fonte
  mudar depois do PLAN, o APPLY aborta e exige validate+plan de novo.
- **Produção não é proibida para sempre** (a migração real acontece uma
  vez), mas exige três camadas: `VERIDI_ALLOW_PRODUCTION_IMPORT=true`,
  `--apply` e `--confirm-database=<nome>` batendo com o banco real.

## Findings com severidade
`BLOCKING` (linha fora), `REVIEW` (entrou o seguro, revisar),
`INFO` (transformação conhecida), `EXCLUDED_BY_POLICY` (fora por decisão).
Um dado ruim nunca impede os bons: 3 CNPJ inválidos não bloqueiam 77
clientes. Artefatos locais: `findings.csv`, `findings-summary.md`,
`import-report.md`, `import-summary.json`, `verify-summary.json` e os
de-para — todos em `.local-data/veridi/out/`.

## Overrides explícitos
CSV em `.local-data/veridi/overrides/`, sem tela e sem estado escondido:
`item-map-overrides.csv` (60 códigos de item usados em preços que não
existem), `supplier-price-uom-overrides.csv` (86 preços por kg em item
contado por unidade) e `sample-project-overrides.csv` (29 amostras sem
projeto inequívoco). Ações são só `MAP`/`IGNORE` (ou `MAP_UOM`/
`IGNORE_PRICE`): **nenhum override cria master data**, e templates
existentes nunca são sobrescritos.

## Decisões de migração
- **441 MOQ numéricos puros** viram `quantidade × unidade do item`, com
  finding `MOQ_ASSUMED_ITEM_UOM` (INFO): oferta legada não tem vigência,
  logo nunca é preço atual e não controla compra. Os 14 ambíguos (`1mil`,
  `KG`, `-`) entram sem MOQ estruturado.
- **compras_recebimentos.csv (829 linhas)**: não vira Receipt nem ledger —
  há entradas históricas sem as saídas correspondentes, e importá-las
  inflaria o On Hand. Também não se cria "Receipt sem efeito". Continua
  servindo de conferência (estatística de laudo 265/14/550).
- **estoque_saldos.csv**: 106 positivos viram template de abertura, 316
  zerados não geram nada, 103 negativos e 9 ilegíveis nunca migram.
- CMV e IN28: estrutura validada, persistência adiada (Blocos G e H).
- Usuários e revisões de documento controlado não são inventados.

## Abertura de estoque
Movimento próprio `OPENING_BALANCE` (+ `LotOrigin.OPENING_BALANCE`):
entrada física auditável da migração, que não é compra, produção nem
ajuste. O saldo legado é agregado por item e o ERP controla por item **e
lote** — então quem conferiu o estoque físico preenche os lotes no template
e o comando só reconcilia: soma dos lotes = saldo legado, item loteado
exige lote real, dono explícito (`CUSTOMER` exige o cliente), sem
`qualityStatus` o lote nasce `AWAITING_RELEASE`, `coaStatus=APPROVED` é
recusado sem documento. Código do lote é gerado pelo ERP; cada linha tem
chave estável, então reaplicar não duplica estoque.

## Verificação
`verify` consulta o banco (não as contagens do script): produto com item de
produto acabado, uma ACTIVE por produto, formulação sem componentes,
projeto×produto com o mesmo cliente, um preferencial por item, nenhuma
oferta legada vigente, códigos legados preservados e — a invariante mais
importante — **importar cadastro não cria movimento de estoque**.

## Estado após a migração
113 fornecedores · 80 clientes · 795 itens · 214 produtos · 212 formulações
ACTIVE · 248 projetos · 9 orçamentos legados · 3 amostras · 639 relações
item×fornecedor · 602 ofertas. Golden da formulação 26/26/0.

## Não implementado de propósito
ETL genérico/designer de mapeamento, tela de importação, parser XLSX no
backend, fuzzy/AI matching, correção de CNPJ, reconstrução de ledger
histórico, lote fake, saldo negativo de abertura, câmbio, CMV e ANVISA.

---

# Delivery 32 — Item × Fornecedor / homologação / MOQ / preços (Bloco F, capacidade 40)

## A relação é a entidade
Preço, MOQ e código do fornecedor NÃO entram no Item: um item tem vários
fornecedores com condições diferentes. `SupplierItem` é único por
(fornecedor, item) e guarda o que é estável — existe a relação, qual o
código do item no catálogo do fornecedor, homologação, preferencial, ativo.

- **Homologação é por item**, não pelo fornecedor inteiro:
  `PENDING/APPROVED/BLOCKED`. Pendente é ausência de homologação aprovada —
  nunca reprovação; só `BLOCKED` é recusa deliberada.
- Homologar/bloquear é da Qualidade; cadastrar relação, código comercial,
  preços e preferencial é de Compras; voltar para pendente é dos dois.
  `SupplierItemQualificationHistory` é imutável e registra quem e quando.
- **Homologado ≠ preferencial.** No máximo um preferencial por item
  (índice parcial único + CHECK no banco); o anterior é desmarcado na mesma
  transação. Bloquear ou inativar derruba o preferencial junto. Preferencial
  é decisão operacional: **nunca** muda porque outra oferta ficou mais barata.
- `active` é diferente de homologação: o fornecedor pode continuar
  homologado e ter parado de vender aquele item.

## Preço e MOQ vivem em oferta imutável
`SupplierItemOffer` é cotação/referência comercial. Corrigir preço, MOQ,
moeda ou vigência é sempre registrar outra — histórico não se reescreve.

- Preço sempre presente (desconhecido não gera oferta; zero é zero
  explícito), com unidade própria compatível com a unidade do item. MOQ é
  opcional: `null` é "não informado", nunca zero.
- **Oferta vigente** = `effectiveAt` preenchido, já iniciado e não expirado,
  a mais recente. Oferta SEM vigência é observação histórica e nunca vira
  preço atual — a UI mostra "referência legada", jamais "preço atual".
- Moeda é registrada, nunca convertida: sem câmbio nesta fase e sem ranking
  de "mais barato" entre moedas diferentes.
- `sourceKey` (hash do conteúdo da linha legada) dá idempotência ao
  importador — reordenar a planilha não duplica oferta.

## Sugestão de Compra e OC
Candidatos = relações ativas e homologadas de fornecedor ativo. Recomendação
conservadora: o preferencial, ou o único homologado; com vários homologados
e nenhum preferencial **ninguém é escolhido** — e o sistema nunca seleciona o
mais barato sozinho. Bloqueado nunca é candidato.

- MOQ é recomendação: quando as unidades são comparáveis a quantidade
  recomendada vira `max(falta, MOQ)`; quando não são, o MOQ aparece na
  unidade original e nada é ajustado. Nada é bloqueado.
- Sem fornecedor homologado a falta continua visível, e compra manual
  segue possível (emergência, amostra, fornecedor novo) — homologação
  orienta, não é trava global de compra nesta fase.
- A linha da OC DRAFT é pré-preenchida pela oferta vigente **só** em BRL e
  com unidade convertível (R$ 0,10/g vira R$ 100,00/kg, em Decimal). A linha
  é snapshot: oferta nova não muda OC existente.
- Requirement `CUSTOMER` continua sem consultar fornecedor (capacidade 35
  intacta).

## Oferta ≠ custo real
`SupplierItemOffer` é referência comercial. **Não** entra na hierarquia
`REAL → 30D → 90D → LAST_REAL → NO_COST`, não altera `getItemCostReference`
nem custo de formulação/OP: custo real continua vindo do recebimento. O
custo prospectivo é assunto do Bloco G.

## Corpus
`precos_fornecedores.csv` (786 linhas, header `preco_brl_kg`, sem coluna de
moeda e **sem data de cotação**): 346 códigos de item (60 não resolvidos),
100 fornecedores (0 não resolvidos), 721 pares item+fornecedor, 63 com mais
de uma observação, 61 com preços diferentes. Preços válidos 773, inválidos
13, 86 com unidade incompatível (preço por kg em item contado em unidade).
MOQ informado em 706 linhas, interpretado em 692 (441 numéricos puros
assumem a unidade do item), 14 ambíguos (`1mil`, `KG`, `-`) — importados sem
MOQ estruturado e reportados.

Seed importou **639 relações** e **602 ofertas** (`LEGACY_IMPORT`, todas sem
vigência), com de-para em `de-para-item-fornecedor.csv`. `homologado=SIM`
(560 linhas) vira `APPROVED`; ausência vira `PENDING`, nunca `BLOCKED`.
`melhor_preco` (466 linhas) é só estatística de snapshot de CMV: nenhuma
relação importada nasce preferencial.

## Não implementado de propósito
RFQ, portal/scorecard de fornecedor, auditoria documental de fornecedor,
lead time e performance de entrega, câmbio/FX, tier pricing, contratos,
contas a pagar, custo real via oferta, CMV/margem/comissão e R-18.

---

# Delivery 31 — Amostras / pilotos / testes Tn (Bloco F, capacidade 39)

## Amostra não é lote nem Ordem de Produção
`ProjectSample` é entidade própria (`AM-000001`). O projeto entra em
amostra ANTES de existir `Product`, item de produto acabado ou formulação
operacional — criar um Product artificial só para fabricar amostra seria
mentira no cadastro, e tratá-la como `Lot` a colocaria no estoque
expedível.

- `testSequence` (T1..Tn) é sequencial **por projeto**, gerado sob
  `FOR UPDATE` (`@@unique(projectId, testSequence)`): duas criações
  simultâneas nunca recebem o mesmo número. Tn legado nunca é renumerado —
  o contador continua depois do maior existente.
- Status `DRAFT/IN_PROGRESS/PRODUCED/APPROVED/REJECTED/CANCELLED`;
  aprovada/reprovada/cancelada são terminais.
- Criar a primeira amostra num projeto `WAITING`/`STAND_BY` move o projeto
  para `SAMPLE` com evento no `ProjectStatusHistory` — nunca em silêncio.
  Projeto aprovado/cancelado não aceita amostra nova.
- **Amostra aprovada NÃO aprova o projeto**: a aprovação comercial
  continua exigindo orçamento `ACCEPTED` e ação explícita (capacidade 38).
- Concluir congela snapshot de cliente/projeto — renomear o projeto depois
  não reescreve a etiqueta já impressa.
- QR próprio `SAMPLE:AM-000001`; a etiqueta A6 não traz preço nem custo.

## Consumo real de material
`SampleConsumption` 1:1 com um `InventoryMovement` do tipo novo
`SAMPLE_CONSUMPTION` (`sourceType=PROJECT_SAMPLE`). É saída física de
verdade, nunca disfarçada de ajuste, e nunca uma segunda contabilidade.

- Reutiliza as MESMAS regras do resto do sistema: lote existe e pertence
  ao item, `isLotAvailableForUse` (qualidade + validade + CoA),
  proprietário (material do cliente só no projeto daquele cliente),
  quantidade > 0 e disponível = On Hand − Reservado. Amostra nunca come
  estoque reservado para OP/Pedido. Não existe bypass "porque é amostra".
- Item que controla lote exige lote informado.
- O primeiro consumo é o início real da preparação (`DRAFT → IN_PROGRESS`).
- **Reprovar ou cancelar nunca estorna material**: o que foi consumido
  fisicamente continua consumido. A saída da amostra também nunca entra em
  produto acabado.
- Rastreabilidade para frente do lote passa a listar as amostras, R-03
  mostra a origem (`AM-000012 (PROJ-000003 T2)`) e o Dashboard conta o
  consumo de amostra em card e série próprios.

## Perfis
Criar/editar amostra: Comercial, Produção ou ADMIN. Consumo e conclusão
física: Produção ou ADMIN. Aprovar/reprovar: Comercial ou ADMIN.
Qualidade lê e anexa documento. Quem executou vem sempre da sessão.

## Anexos
`Attachment` ganhou o quinto contexto (`projectSampleId`, CHECK de dono
único atualizado) e o tipo `SAMPLE_RESULT`. Amostra aceita resultado de
teste, arte e ficha técnica; **CoA e nota fiscal são recusados** — laudo
pertence ao lote e nota ao recebimento.

## Corpus
`amostras.csv` (32 linhas) tem só número interno, série, texto livre e às
vezes o número do teste: **não há cod_cliente nem cod_produto**. A única
ligação aceita é igualdade EXATA (normalizada) entre a descrição sem o
sufixo `Tn` e o nome de um único projeto — prefixo/semelhança seria
adivinhação. Resultado: 26 linhas com Tn, 3 resolvíveis, 29 viram finding.
O seed importa as 3 como `LEGACY_IMPORT`/`PRODUCED` (sem data, quantidade
nem desfecho — nada é inventado), grava `de-para-amostras.csv` e nunca cria
Project nem consumo histórico fake.

## Não implementado de propósito
Amostra como lote expedível, estoque de amostra, envio/logística de
amostra ao cliente, custo/margem da amostra (Bloco G), assinatura do
cliente, reversão de consumo e criação automática de formulação a partir
da amostra aprovada.

---

# Delivery 30 — Projetos + Orçamentos versionados (Bloco F, capacidade 38)

## Project ≠ Product
`Project` é o funil comercial ANTES do produto existir; `Product` é o
produto aprovado e operacional. Aprovar o projeto é o momento em que um
vira o outro — nunca conversão automática no cadastro.

- Código próprio `PROJ-000001` + `externalCode` da planilha (`0001PL`),
  que pode coincidir com `Product.externalCode`.
- Cliente obrigatório; trocável só enquanto não houver orçamento
  formalizado (`SENT`/`ACCEPTED`/…), porque depois disso mudaria história.
- Pipeline `WAITING/SAMPLE/APPROVED/CANCELLED/STAND_BY` com
  `ProjectStatusHistory` imutável. Aprovado/cancelado são terminais e
  somente leitura. Cancelar exige motivo (`OTHER` exige descrição).
- Conceito e canal são vocabulário ABERTO: texto livre com sugestão dos
  valores já usados (`GET /projects/vocabulary`), nunca enum.
- Brief técnico (forma, apresentação, dose, vida útil…) fica no projeto e
  é copiado para o Product na aprovação.

## Orçamentos versionados
`QuoteVersion` com código global `ORC-000001` + `V1..Vn`
(`@@unique(projectId, versionNumber)`), status
`DRAFT/SENT/ACCEPTED/REJECTED/SUPERSEDED/ARCHIVED`.

- Índice parcial garante **um único rascunho por projeto**; pedir "nova
  versão" com rascunho aberto devolve o próprio rascunho.
- Enviar exige quantidade, unidade e preço, congela o snapshot do cliente
  e do projeto e torna a versão imutável. Renegociar cria versão nova, e a
  anterior apresentada vira `SUPERSEDED`.
- Total é derivado (`quantidade × preço`, Decimal) e nunca persistido.
  Preço `null` é "não precificado" — jamais vira zero.
- Aceitar/recusar só valem sobre versão enviada; no máximo uma aceita
  vigente por projeto. Aceite é registro operacional, não assinatura.

## Aprovação → Product
Transacional: trava o projeto, exige orçamento `ACCEPTED`, cria (ou
preserva) o `Product` com item de produto acabado 1:1, copia o brief e cria
**FormulationVersion V1 DRAFT**. Nunca ACTIVE — o comercial aprova o
negócio, não a receita. Aprovar duas vezes não cria segundo produto.

## Corpus e importação
`projetos.csv` (250 linhas) e `dominios_pipeline.csv` entraram no
`veridi:data:validate`: 248 projetos distintos, 80 clientes (0 não
resolvidos), 9 versões legadas de orçamento.

**Achado importante**: o export NÃO traz status nem motivo de cancelamento
por projeto — só o vocabulário. O seed importa 248 projetos como
`LEGACY_IMPORT`; os 214 que casam com um `Product` existente (mesmo código
legado E mesmo cliente) entram como `APPROVED` — o produto só existe no ERP
porque o projeto foi aprovado —, e os 34 sem produto entram como `WAITING`,
com finding por projeto. Nenhum Product foi criado para "completar" FK, e
código legado batendo com produto de OUTRO cliente vira finding sem
vínculo. As versões históricas (V1..Vn) entram como `ARCHIVED`, sem preço.

## Não implementado de propósito
Kanban, CRM, lead/contato, e-mail/WhatsApp, assinatura eletrônica,
custo/margem/comissão automáticos
(Bloco G), tabela de preço por faixa, conversão de moeda e R-18.

---

# Delivery 29 — Qualidade documental / CoA / Anexos (Bloco F, capacidade 37)

## Dois estados que não se confundem
`Lot.status` é a qualidade OPERACIONAL (o lote pode ser usado?);
`Lot.coaStatus` é a situação DOCUMENTAL (o laudo chegou/foi aprovado?).
Aprovar o CoA **não** libera o lote — a liberação da Qualidade continua
sendo ação explícita.

- `Item.requiresCoa` é configuração atual; o lote congela
  `requiresCoaSnapshot` ao nascer. Mudar o item depois não reclassifica
  lote histórico. Conceito independente de `requiresQualityRelease` — um
  nunca é inferido do outro.
- Lote de item que exige laudo nunca nasce `AVAILABLE`, mesmo sem
  liberação manual configurada.
- Fluxo: recebimento → On Hand → CoA `PENDING`/`RECEIVED` → `APPROVED` →
  liberação da Qualidade → `AVAILABLE`.
- Anexar move `PENDING` para `RECEIVED`; nunca aprova. Aprovar sem
  documento ativo é recusado. Aprovar/rejeitar é de QUALITY/ADMIN —
  Compras anexa, não decide. Revisor vem sempre da sessão.
- Rejeitar exige motivo e bloqueia o lote se ele estiver disponível.
  **Nenhuma ação documental cria InventoryMovement**: On Hand não muda.
- `isLotAvailableForUse` passou a incluir a invariante documental — FEFO,
  reserva, picking e consumo herdam a regra do mesmo lugar.
- Material do cliente (capacidade 35) segue exatamente o mesmo caminho.

## Anexos
`Attachment` com contexto único (lote, recebimento OU produto — CHECK no
banco), tipo (`COA`, `INVOICE`, `LABEL_ART`, `TECHNICAL_SHEET`, `OTHER`),
SHA-256, tamanho, MIME, `storageKey` aleatória e snapshot de quem enviou.

- `lib/file-storage.ts` é o único ponto que toca disco: PDF/PNG/JPEG,
  10 MB, extensão conferida contra o MIME, nome do usuário sanitizado só
  para exibição e `../`/caminho absoluto recusados. Arquivos em
  `.local-data/uploads` (fora do repositório e de qualquer diretório
  público); download só pela API autenticada, com `nosniff`.
- Falha no banco depois do arquivo salvo remove o arquivo órfão.
- Documento nunca é excluído: arquiva-se, guardando quem arquivou.
  Arquivar o último CoA ativo devolve o lote a `PENDING` — mas um CoA já
  `APPROVED` nunca regride sozinho.

## Telas e leitura
Qualidade → **Documentos / CoA** (read model sobre Lot + ledger, filtros
por situação e saldo, aprovar/rejeitar). Bloco de documentos reutilizado em
Lote, Recebimento e Produto. Item ganhou "Exige CoA / Laudo" ao lado de
"Requer liberação da Qualidade". CoA aparece em R-01, R-09, Materiais de
Clientes, CSVs, rastreabilidade (só metadados, nunca o binário) e no
alerta do Dashboard, que agora diz o motivo real da pendência.

## Housekeeping da 36
`GET /auth/me` continua 401 sem sessão (semântica correta), mas o app usa
`GET /auth/session`, que responde 200 com `user: null` — a tela de Login
não gera mais erro de console. Validado com Playwright.

## Corpus
`veridi:data:validate` passou a reportar a estatística documental do
histórico (829 linhas: laudo SIM 265, NÃO 14, vazio 550; 26 linhas de
amostra). Nenhum Item foi classificado automaticamente a partir disso — a
classificação do legado é decisão do Product Owner (capacidade 41).

## Não implementado de propósito
OCR, leitura automática do laudo, assinatura/certificado digital,
validação laboratorial, especificação por parâmetro, resultado de ensaio,
GED, versionamento/aprovação de arte, S3, antivírus, e-mail, Projetos,
Amostras.

---

# Delivery 28 — GMP, usuários e OP industrial (Bloco F, capacidade 36)

## Usuários e autenticação
- `User` (código `USR-000001`, e-mail único normalizado, perfil, ativo) +
  `UserSession`. Senha com **scrypt** (`node:crypto`, salt por usuário);
  o banco guarda só o hash, e a sessão guarda só o hash do token.
- Sessão opaca de 12h em **cookie HttpOnly** (`SameSite=Lax`, `Secure` em
  produção). O token nunca volta no corpo da resposta nem vai para o
  localStorage. Logout revoga; inativar usuário derruba a sessão na hora.
- Hook global de autenticação: toda rota operacional exige sessão. Únicas
  exceções: `/health` e as próprias rotas de `/auth`.
- `requireCurrentUser`/`requireRole` são o caminho único para saber quem
  está agindo. RBAC simples: só ADMIN administra usuários e documentos
  controlados; sem matriz por botão.
- `pnpm user:bootstrap-admin` cria o primeiro ADMIN a partir de
  env/args — nenhuma senha padrão existe no repositório, e em produção o
  comando se recusa a criar um segundo ADMIN.
- Testes: `src/test-support/authenticated-app.ts` (`buildTestApp(role)`)
  anexa um cookie de sessão REAL — autenticação de verdade nos testes, não
  bypass. Foi o que permitiu manter os 433 testes anteriores intactos.

## Documentos controlados
`ControlledDocumentRevision` para `R.PRO.002` (OP) e `R.COQ.003` (Folha de
Receita): código, revisão, data, elaborado/aprovado por (id + snapshot de
nome), ativo. Revisão é imutável; ativar uma nova inativa a anterior sob
lock e preserva o histórico. Não é GED, não há editor de template, e o
sistema **não declara** conformidade GMP/ANVISA em lugar nenhum — o rodapé
do documento é carimbo de geração, não assinatura digital.

## OP industrial
- Numeração **oficial anual** `023/26`, gerada na primeira transição para
  RELEASED (rascunho não gasta numeração), com contador por ano travado
  (`FOR UPDATE`) — nunca `MAX+1`. `OP-000123` continua sendo a identidade
  interna; os dois convivem.
- RELEASE congela: snapshot completo do cliente (com endereço), as
  revisões ativas dos dois documentos e as partes da produção.
- `numberOfParts` (1–99) e `labelInstructions` são editáveis só até o
  RELEASE.
- `lib/part-split.ts` divide em Decimal com a última parte absorvendo o
  resto: a soma das partes é exatamente o total. Só matéria-prima é
  fracionada — embalagem aparece com o total da OP.

## Folha de Receita (R.COQ.003)
- `ProductionOrderPart` (PENDING/IN_PROGRESS/COMPLETED) + `RecipeWeighing`
  (planejado, pesado, lote, operador, data/hora, observação).
- **Pesagem confirmada = consumo real**: o serviço chama o MESMO
  `recordConsumptionInTx` do consumo direto, dentro da transação, e liga a
  pesagem ao `ProductionConsumption` criado. `RecipeWeighing` nunca
  movimenta estoque por conta própria — o ledger continua sendo a única
  fonte quantitativa. Confirmar a mesma pesagem de novo não gera segunda
  baixa (`productionConsumptionId` único).
- Validação do lote reaproveita as regras existentes: Item, Qualidade,
  validade, reserva e **proprietário** (capacidade 35) — lote do cliente B
  nunca entra na OP do cliente A.
- Diferença planejado × pesado é registrada e destacada; concluir a parte
  exige ao menos uma pesagem por matéria-prima planejada, nunca igualdade
  exata. Nenhuma tolerância foi inventada.
- Fluxo antigo intacto: OP de 1 parte segue por Picking/Consumo como antes.

## Impressão e sugestões de lote
`R.PRO.002` ganhou cabeçalho controlado, cliente congelado com endereço,
matérias-primas e embalagens separadas, quantidade por parte e a seção
"Dados para impressão do lote". `R.COQ.003` é documento novo, com uma
seção por parte. Vida útil gera **sugestão** de validade (soma de meses de
calendário, com fim de mês tratado) e a máscara `AAMM + produto + cliente`
gera **sugestão** de lote comercial — as duas nunca sobrescrevem valor
informado, e `Lot.code` continua sendo a identidade única.

## Não implementado de propósito
Assinatura/certificado digital, GED, workflow regulatório, tolerâncias GMP
inventadas, equipamentos/work centers/capacidade de misturador, mão de
obra, CoA, anexos, reset de senha por e-mail, MFA, SSO e RBAC granular.

---

# Delivery 27 — Material de propriedade do cliente (Bloco F, capacidade 35)

A Veridi é terceirizadora: parte do material dentro da fábrica é do
cliente. Esta capacidade separa **dois conceitos que não podem se
confundir**.

## Responsabilidade x propriedade
- `FormulationComponent.supplyResponsibility` (`VERIDI` default |
  `CUSTOMER`): quem DEVE fornecer. É intenção, congelada na versão e
  copiada para `ProductionOrderRequirement` — a OP nunca reconsulta a
  fórmula atual.
- `Lot.ownerType` (`VERIDI` | `CUSTOMER`) + `ownerCustomerId`: de quem é o
  material físico. `CHECK` no banco garante as duas direções (Veridi nunca
  tem cliente; cliente nunca fica sem cliente).
- Dono é independente de Fornecedor: fornecedor é quem vendeu, dono é de
  quem é. Lote de cliente costuma não ter fornecedor, e `supplierLot`
  continua sendo o lote do fabricante.
- Propriedade é imutável depois da criação: não existe transferência nem
  edição silenciosa de dono.

## Cliente da OP
`ProductionOrder.customerId` vem do Pedido (origin `CUSTOMER_ORDER`) ou do
Produto; se os dois existirem e divergirem, é `CustomerMismatchError` —
nunca se escolhe um vencedor silencioso. Congelado no PLAN junto com o
resto do snapshot.

## Elegibilidade por proprietário
`lib/inventory-ledger.ts` ganhou `InventoryOwnerScope` opcional
(`getOnHandByItems`/`getReservedByItems`/`getAvailableByItems`) e
`getAllocationSuggestion` aceita escopo. **Sem escopo nada mudou** — é a
razão de os 418 testes anteriores continuarem passando sem alteração.

- Requirement `VERIDI`: só lote Veridi. Requirement `CUSTOMER`: só lote do
  cliente DA OP.
- Requirement `CUSTOMER` sem cliente definido: escopo `null` = nenhum
  estoque elegível (falta = necessidade inteira), e o RELEASE é bloqueado
  com mensagem própria.
- Substituição no Picking valida o dono: mesmo Item não basta.
- **Visibilidade ≠ elegibilidade**: listas e relatórios continuam mostrando
  o estoque físico inteiro, agora com a coluna Proprietário.

## Recebimento sem Ordem de Compra
`Receipt.sourceType` = `PURCHASE_ORDER` (comportamento intacto) |
`CUSTOMER_SUPPLIED`. Na segunda origem `purchaseOrderId`/`supplierId` ficam
nulos, `customerId` é obrigatório (CHECK no banco) e a `ReceiptLine` carrega
o próprio snapshot do item (linhas antigas continuam lendo o da OC). Nota
fiscal é opcional. Cria Receipt/ReceiptLine/Lot/`RECEIPT_IN` pelo mesmo
caminho de sempre — nunca um segundo ledger. Qualidade não muda: item com
liberação entra `AWAITING_RELEASE`. Item sem controle de lote é recusado.

## Compra e custo
- Falta de material do cliente nunca vira Sugestão de Compra nem OC DRAFT —
  aparece em "Materiais aguardando cliente" (com o disponível daquele
  cliente). Mesmo um payload explícito é recusado.
- Material do cliente não tem custo de aquisição da Veridi: fica fora do
  total e **fora da qualidade** do custo (dois componentes do cliente não
  rebaixam um custo REAL para PARTIAL). `null` nunca vira `0`.
  `hasCustomerSuppliedMaterials` sinaliza na tela ("Custo de materiais
  Veridi" + aviso).

## Telas
Estoque → **Materiais de Clientes** (read model sobre Lot dono CUSTOMER +
ledger, com CSV), coluna/filtro Proprietário em Lotes e R-01, proprietário
no detalhe do lote e discretamente na etiqueta (o QR continua só
`LOT:<código>`), Fornecimento na formulação e na OP, e Compras →
Recebimentos → "Receber material do cliente".

## Não implementado de propósito
Transferência de propriedade, produto acabado de cliente, conta-corrente de
material, cobrança de industrialização, valor econômico do material do
cliente, expected inbound/ASN, CoA e anexos.

---

# Delivery 26 — Formulação Industrial v2 (Bloco F, capacidade 34)

A formulação passa a suportar o jeito industrial de declarar fórmula
(**por dose**), com **pureza** e **overage** explícitos, sem abandonar o
modelo original.

## Modo de cálculo (versão) e base (componente)
- `FormulationVersion.calculationMode`: `FIXED_BASIS` (default, modelo
  original — "estas quantidades produzem esta base") ou `PER_DOSE`.
- `FormulationVersion.dosesPerPackage`: obrigatório em `PER_DOSE`.
- `FormulationComponent.basis`: `FIXED_BASIS` | `PER_DOSE` |
  `PER_FINISHED_UNIT`. A base é **por componente**: uma mesma versão tem
  ativos por dose e embalagem por unidade acabada sem engine de expressão.
- Compatibilidade: tudo que existia continua `FIXED_BASIS` e calcula
  exatamente como antes (417 testes de API passam sem alteração de
  expectativa).

## Pureza e overage — snapshot, nunca cadastro vivo
- `purityPercentApplied` e `overagePercent` são congelados no componente
  (e de novo no `ProductionOrderRequirement`). Mudar
  `Item.defaultPurityPercent` depois **não** altera formulação nem OP.
- `null` de pureza significa **DESCONHECIDA**: nenhuma correção é
  aplicada. Nunca se assume 100%.
- Campos `legacyTotalQuantity`/`legacyTotalUnitCode`/`legacyBatchUnits`
  guardam a referência histórica importada — nunca entram no cálculo.

## Fonte única do cálculo
`apps/api/src/lib/formulation-math.ts`:

```
teórico = quantidade × fator(basis)
   FIXED_BASIS        → produzido ÷ basisQuantity
   PER_DOSE           → dosesPorEmbalagem × produzido
   PER_FINISHED_UNIT  → produzido
físico  = teórico ÷ (pureza/100) × (1 + overage/100)
```

Tudo em `Prisma.Decimal`; quantidades persistem em `Decimal(18,6)` como no
resto do sistema. `requirement-calc.ts` e o preview do editor consomem a
mesma função — não existe segunda implementação da conta.

## Frontend
Editor de versão: modo de cálculo, doses por embalagem (só em `PER_DOSE`),
e por linha `Base`, `Pureza %`, `Overage %`, além da coluna **Físico /
unidade** (já com pureza e overage). Campo vazio grava `null`.

## Corpus real da Veridi (base DEV)
Ferramenta de dados fora da aplicação, em `scripts/veridi-data/`:
`pnpm veridi:data:validate` (**nunca escreve**) e `pnpm veridi:data:seed`
(`--reset` zera só a base local; aborta se `NODE_ENV=production`, host
não-local ou nome de banco com "prod").

- CSVs reais ficam em `.local-data/` (no `.gitignore`) — cliente, CNPJ,
  fornecedor, fórmula e preço reais **nunca** são versionados.
- Código interno continua sendo a identidade operacional; o código da
  planilha vai para `Customer.externalCode`/`Item.externalCode`/
  `Product.externalCode` (índice **não** único — o legado tem duplicidade
  real). O seed usa as **mesmas sequences Postgres** da aplicação, então
  código de seed e código criado pela tela nunca colidem, e ainda escreve
  um de-para legado × interno em `.local-data/veridi/de-para/`.
- A fórmula histórica foi **deduzida e conferida** contra
  `total_kg_com_pureza_overage`: 27 componentes comparáveis, 27 batem com
  tolerância 1e-5 (folga da planilha, que arredonda em 8 casas), 0
  divergentes. A conta nunca foi ajustada para forçar coincidência —
  divergência viraria finding.
- Só se importa `PER_DOSE` quando o próprio corpus sustenta a separação
  dose × pureza × overage; caso contrário entra `FIXED_BASIS` com o
  consumo histórico real e um finding.
- **Não importado de propósito**: saldo de estoque (a planilha tem
  negativos), compras/recebimentos, preços de fornecedor, amostras,
  projetos como entidade, CMV e IN28 — cada um é capacidade futura.
- Testes seguem sintéticos: `pnpm test` não depende de `.local-data`.

---

# Delivery 25 — Cadastros Industriais v2 (Bloco F, capacidade 33)

Primeira capacidade do Bloco F. Enriquece Customer/Item/Product com o que a
operação real de private label já usa. É **cadastro**: nenhuma matemática de
estoque, produção ou custo mudou, e nenhuma regra regulatória foi criada.

- **Cliente — endereço estruturado**: `street`, `number`, `complement`,
  `district`, `zipCode` somados a `city`/`state`. Tudo opcional; clientes
  antigos seguem válidos. `zipCode` é guardado só com dígitos (a máscara
  `00000-000` é da UI) e exige 8 dígitos quando informado. Sem integração de
  CEP — o usuário digita.
- **Snapshot do Pedido**: o CONFIRM passou a congelar também o endereço
  (`customerStreet`…`customerState`). Editar o cadastro do Cliente depois
  não muda documento já confirmado. Pedidos confirmados antes desta
  capacidade ficam com `null` — não se inventa histórico.
- **Item — taxonomia industrial**: `sourceName` (forma química realmente
  usada, ex.: "Cloridrato de tiamina"), `declaredNutrient` (denominação
  nutricional, ex.: "Vitamina B1"), `family` (enum fixo, sem cadastro
  configurável) e `packagingSubtype` (só para PACKAGING — rejeitado nos
  demais tipos pelo backend).
- **Item — pureza padrão**: `defaultPurityPercent` Decimal(6,3), aceito
  apenas em `0 < x <= 100`. **`null` significa DESCONHECIDA e nunca pode
  virar 100%.** É só o default de novas formulações: a capacidade 34
  congelará `purityPercentApplied` no componente, então alterar o Item
  jamais reescreverá formulação/OP histórica.
- **Product — perfil industrial**: `dosageForm`, `presentationType`,
  `capsulesPerDose`, `doseAmount` + `doseUomCode`, `dosesPerPackage`,
  `unitsPerShippingBox`, `targetAgeGroup`, `shelfLifeMonths` e
  `minimumBatchQuantity`. Todos opcionais e todos positivos quando
  informados (validado no backend, não só no formulário).
- **Sem UOM duplicada**: a dose tem unidade própria porque pode ser mg/g/ml
  e diferir da unidade de estoque; `minimumBatchQuantity` usa a unidade do
  Finished Product Item, então não existe `minimumBatchUom`.
- **`targetAgeGroup` é descritivo.** Nenhuma regra de IDR/%VD/ANVISA foi
  implementada — isso é o gate do Bloco H.
- **`shelfLifeMonths` é referência**: não altera lote nem validade agora; a
  capacidade 36 poderá sugerir `validade = produção + shelfLifeMonths`.
- UI: seção `Endereço` no modal de Cliente; `Classificação industrial` no de
  Item (subtipo aparece só para embalagem; dica explícita de que pureza
  vazia significa desconhecida); `Perfil do produto`, `Dose e apresentação`
  e `Industrial` no de Produto. Listagem de Itens ganhou Família e Fonte
  (nutriente como texto secundário); a de Produtos ganhou Forma,
  Apresentação, Vida útil e **Formulação ativa** (versão já marcada ACTIVE,
  sem lógica nova de versionamento).
- CSV de Clientes, Itens e Produtos estendido com os novos campos, sempre
  com rótulo amigável em vez de enum cru e com decimais preservados.
- Migration `20260901090000_industrial_master_data`: tudo nullable, sem
  backfill, sem reset e sem seed (o importador das planilhas é a
  capacidade 41).
- Testes (`industrial-master-data.test.ts`, 14 casos): endereço completo,
  normalização de CEP, atualização parcial, snapshot congelado contra
  edição posterior do cadastro, taxonomia, pureza 98,5 exata, pureza 0 e
  >100 rejeitadas, subtipo fora de embalagem rejeitado, perfil completo do
  produto, valores não positivos rejeitados, unidade de dose inexistente,
  registros antigos ainda válidos e os três CSVs.

---

# Delivery 24 — Exportações CSV + Impressão/PDF (Bloco E, capacidade 32)

Última capacidade estrutural antes da validação ponta a ponta. **Nenhuma
fonte de verdade nova**: não existe `ExportRecord`, `GeneratedReport`,
`PdfDocument` nem CSV em cache; nada é armazenado.

**Política oficial aplicada:** listagem → CSV; relatório → CSV +
Imprimir/PDF; documento transacional → Imprimir/PDF; rastreabilidade →
Imprimir/PDF; formulário de criar/editar → sem exportação.

- **Filtro × paginação virou conceito explícito** (`lib/pagination.ts`,
  `ALL_ROWS`): todo serviço de listagem e de relatório aceita o modo
  "resultado completo" usando os MESMOS filtros. Nada de `pageSize`
  gigante como gambiarra, e o teto de 500 da tela não limita a
  exportação. O R-17 passou a derivar do R-13 por esse caminho.
- **CSV server-side** (`lib/csv.ts`): UTF-8 **com BOM**, separador `;`,
  CRLF, cabeçalhos em português, datas e decimais pt-BR. Decimal sempre
  via `Prisma.Decimal` — nunca float. Célula desconhecida fica VAZIA:
  custo/preço ausente jamais vira `0`, e quando há custo a coluna de
  qualidade/origem viaja junto.
- **Segurança**: helper central neutraliza CSV/Spreadsheet Formula
  Injection (`=`, `+`, `-`, `@`) só na REPRESENTAÇÃO exportada — o valor
  persistido nunca muda. Códigos de negócio, CNPJ, lote e código de barras
  saem como texto; UUID técnico nunca substitui código de negócio. Nome de
  arquivo legível e determinístico (`veridi_<slug>_<data>.csv`).
- **30 endpoints `.../export.csv`** declarados um a um (nunca um endpoint
  genérico que receba tabela/consulta arbitrária): 15 listagens (Clientes,
  Fornecedores, Itens, Produtos, OCs, Recebimentos, Estoque, Lotes,
  Movimentações, Formulações, OPs, Produto Acabado, Pedidos, Expedições,
  Faturamento) e 15 relatórios tabulares (R-01…R-05, R-07…R-13, R-15…R-17).
  R-06 e R-14 são consultas de documento único: a saída deles é a
  impressão. O Dashboard **não** ganhou CSV — é cockpit.
- **Impressão/PDF sem motor de PDF**: HTML + `@media print` +
  `window.print()`. `print/PrintLayout.tsx` e `print/documents.tsx`
  concentram cabeçalho, metadados e tabelas; A4 retrato por padrão;
  topbar, sidebar, botões, inputs e paginação somem no papel. Rotas de
  impressão ficam fora do `AppShell`, mesmo padrão da etiqueta de lote:
  Pedido, OC, Recebimento, OP, Expedição, Faturamento e Rastreabilidade de
  lote.
- **Relatórios imprimem o resultado FILTRADO COMPLETO**, não a página: o
  botão busca o relatório com `all=true` (caminho explícito no schema),
  renderiza tudo e chama `window.print()`. O cabeçalho impresso traz
  Veridi Nutrition, nome do relatório, filtros aplicados, data de geração e
  a contagem de registros. Sem identidade autenticada no MVP, nenhum nome
  de usuário é inventado.
- **Semântica financeira preservada**: valor previsto da OC e total do
  Faturamento só aparecem com precificação completa; custo `PARTIAL`
  imprime "Indisponível — subtotal conhecido X" com a qualidade visível.
  O Faturamento impresso exibe obrigatoriamente
  "Documento comercial/operacional — não é Nota Fiscal"
  (`BILLING_NON_FISCAL_NOTICE`, testado). Documento DRAFT é rotulado
  "Rascunho".
- Documentos históricos imprimem o snapshot que já está congelado no
  próprio documento, nunca o cadastro atual.
- Testes: `exports.test.ts` (BOM/separador/CRLF/escape/acentuação,
  injeção de fórmula, Decimal, arquivo, download HTTP, 30 registros
  filtrados contra página de 10, filtro idêntico, códigos preservados,
  R-01, R-05/R-07 com qualidade de custo, R-15/R-17 com preço incompleto,
  `all=true` trazendo 8 de 8 contra página de 3) e
  `print/documents.test.tsx` (não é Nota Fiscal, snapshot, total ausente
  com preço incompleto, rascunho, custo PARTIAL sem total artificial).
- **Não implementado de propósito**: XLSX, template Excel, PDF no backend,
  Puppeteer/wkhtmltopdf, armazenamento de arquivos, envio por e-mail,
  agendamento, assinatura digital, DANFE/NF-e, importação de CSV.

---

# Delivery 23 — Relatórios R-01…R-17 (Bloco E, capacidade 31)

`Gestão → Relatórios`: 17 consultas somente leitura sobre as entidades que
já são fonte de verdade. **Nenhuma tabela de relatório, nenhum agregado
persistido, nenhum data warehouse, nenhum BI configurável.**

- Cada relatório tem endpoint próprio em `GET /reports/...` e um read model
  em `modules/reports/` separado por domínio (estoque, produção, compras,
  comercial, faturamento). Clareza acima de abstração: não existe framework
  genérico de relatórios.
- **Filtro e paginação são conceitos separados.** O filtro define o
  resultado (`total` é sempre o resultado filtrado inteiro), a página só a
  fatia devolvida — é isso que permitirá a exportação (32) reutilizar os
  MESMOS read models pedindo tudo, sem reconstruir CSV a partir da tela.
  Todos os filtros são server-side.
- **Datas operacionais corretas por domínio**: movimento por `occurredAt`,
  recebimento por `receivedAt`, consumo por `consumedAt`, OP concluída por
  `completedAt` (outros status usam `createdAt`, explicitamente, nunca
  misturado), expedição por `confirmedAt`, faturamento por `issuedAt`,
  pedido por `orderDate`. `updatedAt` nunca é usado como atalho.
- **Timezone**: o frontend resolve os limites e envia ISO, reaproveitando o
  helper extraído do Dashboard (`apps/web/src/lib/period.ts`) — estratégia
  única de datas, sem off-by-one na virada do dia.
- **UOM e Decimal**: cada linha carrega a própria unidade; nada soma
  grandezas incompatíveis (R-12 lista os códigos dos produtos em vez de
  somar quantidades). Nenhum cálculo passa por float.
- **Custos** vêm sempre da Fundação de Custos com a qualidade explícita
  (`REAL/ESTIMATED/PARTIAL/NO_COST`); custo desconhecido aparece como "Sem
  custo" e nunca como zero. Valor previsto de OC e valor de faturamento só
  existem com precificação completa; o total do período do R-15 só existe
  quando TODOS os documentos filtrados estão completos.
- **Cálculo único, nunca paralelo**: a falta de material do R-04 usa o novo
  `lib/requirement-availability.ts`, extraído do próprio documento da OP e
  agora compartilhado pelos dois (a reserva da própria OP volta ao
  disponível, e `On Order` continua sem reduzir a falta). O status de
  faturamento do Pedido usa `deriveOrderBillingStatus`, exportado do módulo
  de Pedidos. R-06 usa só `ProductionConsumption`/`ProductionOutput` —
  reserva/FEFO nunca são genealogia.
- **Performance**: disponibilidade resolvida de uma vez para todos os
  requirements; expedido/faturado/reservado/produzido agregados em lote por
  linha de Pedido (R-13/R-17); custo do R-05 é opcional e resolvido uma vez
  por OP da página. Sem cache/Redis.
- Links operacionais em todos os códigos (OC, REC, LT, OP, PED, EXP, FAT),
  estados vazios específicos por relatório e estrutura semântica
  Título → Filtros → Resumo → Tabela, pensada para a impressão futura.
- **Exportação não foi implementada** (CSV/PDF/`window.print`), por
  instrução — fica para a capacidade 32.
- Testes (`reports.test.ts`, 13 casos): saldo do ledger com e sem lote e
  Qualidade zerando o disponível; janelas de vencimento incluindo lote
  zerado fora; tipos de movimento com origem/motivo/usuário; falta com
  reserva própria e On Order; planejado × produzido com rendimento;
  genealogia real; consumo com custo real e sem custo; OC com preço
  completo × incompleto; recebimento linha a linha; em compra e atrasadas;
  e o caso integrado de Pedido com dois produtos (A 500/500/500 e B
  300/200/100 com 100 expedido não faturado) cobrindo R-12 a R-17.

---

# Delivery 22 — QR de Produto Acabado + Conferência de lote na Expedição

Fechamento operacional entre produzir, identificar fisicamente e expedir.
Nenhuma entidade nova: nem `StockOutboundOrder`, nem `ScanEvent`, nem
unidade logística. A Expedição continua sendo a ordem de saída.

- **Identidade.** Um `Lot` pertence a exatamente um `Item` (garantido pelo
  relacionamento). Lote de componente pode alimentar várias OPs, mas nunca
  vira produto expedível — a Expedição só aceita o **Finished Product Lot
  reservado àquela linha**. Um mesmo lote de produto acabado pode atender
  vários Pedidos: `Lot` não tem cliente/pedido; o contexto comercial vem
  de Shipment → CustomerOrder → Customer → ShipmentLine → ReservationLine
  → Lot.
- **QR.** Continua `LOT:<Lot.code>` — um único padrão, sem cliente,
  pedido, quantidade, saldo, localização, status ou custo. A tela Produto
  Acabado ganhou a ação `Etiqueta / QR`, que reaproveita a rota de
  impressão já existente (`/estoque/lotes/:id/etiqueta`) e o `LotLabel`,
  que já tratava lote produzido (Lote Veridi + quantidade produzida, sem
  lote do fornecedor). Nenhuma lógica de etiqueta foi duplicada.
- **Conferência.** `POST /shipments/:id/lines/:lineId/verify` com o código
  puro ou o payload de QR, reutilizando `normalizeLotLookupCode` — não
  existe segundo padrão de leitura. Entrada manual é suficiente: nada
  depende de câmera. Valida Expedição DRAFT, linha pertencente à
  Expedição, lote existente, lote **exatamente** o da ReservationLine (e
  do Item esperado), reserva do mesmo Pedido, `reservedRemaining > 0`,
  quantidade dentro do reservado e lote operacionalmente utilizável
  (bloqueado/aguardando Qualidade/vencido nunca passam).
- **Auditoria mínima:** `ShipmentLine.verifiedAt`/`verifiedBy`. Conferir
  **não** cria InventoryMovement e não altera On Hand/Reserved/Available
  nem o status do Pedido. Salvar a separação de novo preserva a
  conferência (o lote não mudou; quantidade é outro conceito).
- **Confirmação bloqueada:** linha loteada com quantidade > 0 e sem
  `verifiedAt` faz o CONFIRM falhar com "Existem lotes ainda não
  conferidos nesta expedição." Validado no backend; a UI só antecipa. A
  elegibilidade do lote continua sendo revalidada no CONFIRM mesmo com a
  conferência feita.
- **Lote errado nunca é aceito em silêncio** nem substituído: a mensagem
  mostra lote esperado × lote informado, e trocar exige a realocação
  explícita da reserva já existente.
- **Quantidade continua separada do QR:** o QR diz *qual lote*, a
  ShipmentLine diz *quanto*. 400 unidades de um lote = 1 conferência.
- **UX de Pedido com vários produtos:** o DTO passou a expor `products`
  (um grupo por linha do Pedido, inclusive as ainda sem reserva) com
  Pedido/Já expedido/Falta/Reservado/Expedindo agora/Lotes conferidos e um
  status visual `PENDING/READY/PARTIAL/VERIFIED` — tudo derivado, nada
  persistido — mais `verification` (produtos, lotes necessários, lotes
  conferidos). Contagem de produtos/lotes é segura; unidades incompatíveis
  nunca são somadas.
- Testes: `shipment-verification.test.ts` (identidade, QR puro e payload,
  lote de outro produto, lote de componente, linha de outra Expedição,
  bloqueado/aguardando/vencido, bloqueio e liberação do CONFIRM, dois
  lotes do mesmo produto, conferência preservada no save, Pedido com três
  produtos → `PARTIALLY_SHIPPED`, mesmo lote em dois Pedidos com a
  matemática final 800/600/200). As suítes existentes passaram a conferir
  antes de confirmar.

---

# Delivery 21 — Dashboard operacional (Bloco E, capacidade 30)

Cockpit, não BI. `GET /dashboard?from=&to=` é um **read model único** —
uma chamada em vez de dezenas — e **nunca é fonte de verdade**: nenhuma
tabela agregada, nenhum campo persistido, nenhum cache/Redis. Tudo é
derivado ao vivo dos documentos e dos serviços centrais já existentes
(`inventory-ledger.ts`, `allocation.service.ts`, `costs.service.ts`).

**Separação inegociável entre estado atual e período.** "Operação atual"
(Comercial/Produção/Compras/Estoque-Qualidade) ignora completamente o
filtro; só as métricas históricas respondem a ele. Coberto por teste: uma
OP antiga `IN_PRODUCTION` continua contando no estado mesmo quando a
janela consultada não a inclui, e o bloco de estado sai idêntico em duas
janelas radicalmente diferentes.

**Cada métrica do período usa a data operacional do próprio documento** —
Pedidos por `createdAt`, Recebimentos por `Receipt.receivedAt` (nunca
movimentos `RECEIPT_IN`: um recebimento com cinco linhas é UM
recebimento), OPs por `completedAt`, Expedições por `confirmedAt`,
Faturamentos por `issuedAt`. Nunca `updatedAt`. Todas as métricas são
**contagem de documentos/eventos** — nada soma quantidades de UOMs
diferentes.

**Valor faturado só existe quando TODOS os faturamentos emitidos do
período têm preço completo.** Caso contrário o card mostra "Valores
incompletos" com o denominador (`billingsWithCompletePricing` de
`billingsIssued`) e `billedAmount` fica `null`. Teste obrigatório: FAT-A
completo de R$ 100 + FAT-B incompleto nunca exibe R$ 100 como total.

**"Precisa de atenção" é a seção mais importante** e vem antes dos
números. Dez tipos derivados (lote vencido/bloqueado/aguardando
Qualidade/próximo do vencimento, OP com falta de material, OC atrasada,
Pedido aguardando produção/expedição, Expedição aguardando faturamento,
OP concluída com custo incompleto), severidade `CRITICAL/WARNING/INFO`
**derivada por mapa fixo, nunca persistida** — não existe tabela
`Attention` nem engine configurável. Ordem: severidade → data → código
(determinística). Limite de 20 com o total ao lado; cada linha navega
para o documento. Lote só vira atenção com saldo > 0 — lote zerado não é
problema operacional. `LOT_EXPIRED` usa a data efetiva de validade, não
o status persistido (nenhum job marca `EXPIRED`).

Outras decisões registradas:
- "Itens em compra" conta **itens distintos** com quantidade aberta —
  1000 kg + 2500 un jamais viram 3500.
- OC atrasada = `ORDERED`/`PARTIALLY_RECEIVED` + previsão vencida + saldo
  ainda aberto.
- "OPs com falta de material" restringe-se a `DRAFT`/`PLANNED`: uma
  `RELEASED` já tem reserva própria e contá-la geraria falta falsa.
- "OPs concluídas com custo incompleto" (`PARTIAL`/`NO_COST`) é indicador
  de qualidade do dado — mostra a contagem, nunca dinheiro.
- Um único gráfico (atividade de estoque por dia, contagem de eventos),
  em SVG próprio; nenhuma biblioteca de BI entrou no projeto.
- Últimos 15 movimentos com quantidade + unidade por linha (seguro) e
  origem resolvida pelos vínculos 1:1 que já existem.
- N+1 evitado: disponibilidade resolvida de uma vez para todos os itens
  candidatos a falta; varredura de custo das OPs concluídas limitada a
  200 linhas.
- O frontend envia sempre `from`/`to` explícitos (Hoje/7/30/
  Personalizado, padrão Hoje), para "hoje" ser o dia do operador e não o
  fuso do servidor.
- `vitest.config.ts` passou a limitar `maxWorkers: 3`: com 26 arquivos de
  teste cada um subindo app + pool do Prisma, o Postgres local esgotava
  os connection slots e testes corretos falhavam por infraestrutura.

---

# Correção de consistência Bloco C — tela Produção → Produto Acabado

`Produção → Produto Acabado` deixou de ser placeholder. A capacidade já
existia inteira no back (ProductionOutput, `Lot.origin = PRODUCTION`,
`FINISHED_GOOD_PRODUCTION`, Inventory Ledger, Qualidade, Rastreabilidade,
Fundação de Custos) — faltava só a visão. Nada de domínio novo foi criado.

- `GET /finished-goods` (`modules/finished-goods/`) é **read model puro**:
  uma linha por `Lot` com `origin = PRODUCTION`. Lote de recebimento nunca
  aparece.
- **Não existe segundo estoque nem entidade nova.** Produzido = soma dos
  `ProductionOutput` do lote (histórico do que saiu da OP); On Hand /
  Reserved / Available vêm do `inventory-ledger.ts`. Quantidade produzida
  nunca é usada como saldo.
- Qualidade é o status efetivo do lote (mesma regra de sempre, vencimento
  calculado, não persistido). As ações de Qualidade continuam na tela do
  Lote — não foram duplicadas aqui.
- Custo vem de `getProductionOrderMaterialCost` e é resolvido **uma vez por
  OP distinta**, nunca por linha (evita N+1 quando uma OP gera vários
  lotes). `REAL`/`ESTIMATED` mostram valor + origem; `PARTIAL`/`NO_COST`
  mostram "Parcial"/"Sem custo" e **nenhum número** — custo incompleto
  jamais é exibido como custo fechado.
- A tela é **somente leitura**: não há `+ Novo Produto Acabado`. Produto
  acabado nasce exclusivamente de OP → apontamento. Ações: `Abrir lote`,
  `Abrir OP`. Cada quantidade carrega a própria unidade; nada é somado
  entre unidades diferentes.
- Estado vazio: "Nenhum produto acabado produzido ainda."
- Testes (`finished-goods.test.ts`): só lotes PRODUCTION; produzido do
  ProductionOutput divergindo de On Hand; Reserved/Available do ledger;
  qualidade `AWAITING_RELEASE` com Available 0 e liberação abrindo
  Available; custo `REAL` com valor e `NO_COST` com `materialUnitCost`
  nulo; filtros de status e busca por lote Veridi.

---

# Durable UI decisions
- Veridi green visual identity, v2 token set (`--v-green-*`/`--v-lime`/
  `--ok`/`--warn`/`--err`, `--font-ui`/`--font-code`, no CDN fonts).
- Old permanent Explorer/Workspace/Properties shell is not used.
- Default shell = top topbar + left sidebar (collapsible) + main workspace.
- Simple CRUD (list + create/edit) uses `FullWorkspaceModal` — covers only
  the workspace, topbar/sidebar stay visible.
- A transactional document (PO, future OP) uses its own page inside the
  workspace instead — not a modal.
- `ConfirmDialog` for destructive/cautionary confirms (tone "danger") and
  for positive commit confirms (tone "accent"); never `window.confirm`.
- No permanent global toolbar.
- No permanent bottom status bar.
- Desktop is dense/data-oriented.
- Receiving/picking are mobile/tablet scan-first.
- On mobile widths (≤640px) the sidebar becomes an off-canvas overlay
  (hidden by default, opened via the existing hamburger button) instead of
  squeezing the workspace — same z-index/backdrop idiom as `modal-overlay`.
- A dedicated print route (e.g. lot label) renders outside `AppShell` —
  no topbar/sidebar, own small print stylesheet.
- No UI framework.

---

# Open non-blocking product decisions
- exact automatic finished-product lot-number algorithm;
- exact expiry-warning threshold;
- detailed permissions;
- exact Quality responsibility/release rules;
- loss/yield reason codes;
- final label dimensions/printer;
- whether every item class requires expiry;
- file-storage provider for production.

---

# Delivery 36 — Recursos industriais (Bloco G, capacidade 44)

## Recurso ≠ uso do recurso
`IndustrialResource` (`REC-000001`) é o cadastro econômico — mão de obra,
equipamento ou energia — com unidade de consumo derivada do tipo (hora para
LABOR/EQUIPMENT, kWh para ENERGY) e `powerKw` só em equipamento. O quanto um
produto consome é `IndustrialCostResourceUsage`, ligado à CostVersion, uma
linha por recurso (sem roteiro nesta fase) e sempre com quantidade > 0.

Recurso `LABOR` é categoria econômica, nunca pessoa: `User` continua sendo
quem executou/auditou, e os dois nunca se ligam sozinhos.

## Tarifa histórica e imutável
`IndustrialResourceRate` nunca é editada: reajuste é registro novo. Não
existe `currentRate` gravado — a vigente é derivada de `effectiveAt`/
`validUntil` numa data de referência, e tarifa legada sem vigência é
referência, jamais vigente. `HOUR`/`KWH` ficam num enum próprio, fora do
registro de UOM de itens (senão daria para cadastrar matéria-prima em kWh —
desvio consciente do §16/§18 do handoff, relatado).

## Energia sem dupla contagem
`energyCalculationMode` na versão: `NONE` (não estruturada, nunca zero),
`DIRECT` (consumo lançado como recurso de energia) ou `FROM_EQUIPMENT`
(Σ horas × kW). Os dois últimos são mutuamente exclusivos e o backend recusa
a troca de modo enquanto houver energia direta lançada. Um único equipamento
sem potência deixa a energia derivada EM ABERTO — somar só os conhecidos
apresentaria um número menor como se fosse o consumo real.

## Congelamento na ativação
Ativar grava por uso: nome, tipo, id/valor/moeda/unidade/vigência da tarifa e
potência. Reajustar a hora depois muda a "referência atual" exibida no
rascunho, nunca o snapshot da versão ativa. Tarifa desconhecida congela
`null`, e ativar incompleta exige confirmação explícita. Recurso inativo
bloqueia ativação nova; versão já ativa continua íntegra e não ganha
pendência por inativação posterior. Nova versão copia os usos, nunca as
tarifas.

## Telas
Gestão → Recursos Industriais (lista com filtros + CSV, detalhe com
histórico de tarifas e "Registrar tarifa"); seção RECURSOS INDUSTRIAIS e
seção ENERGIA na página de custos, com preview do kWh derivado; a impressão
da EC ganhou a seção de recursos — rascunho mostra referência atual, ativa
mostra o snapshot.

## Corpus
O CMV legado NÃO detalha recurso: as 9 planilhas com custo histórico trazem
mão de obra, equipamento e energia diluídos no custo unitário. Isso virou
`UNRESOLVED_RESOURCE_COST` (9), e a classificação por texto só emite
`LABOR/EQUIPMENT/ENERGY_RESOURCE_CANDIDATE` e
`EQUIPMENT_COST_MAY_INCLUDE_ENERGY`. Nenhum recurso é criado a partir de
texto e nada é persistido. Golden da formulação intacto: 26/26/0.

## Efeito colateral desta capacidade
Estrutura com energia ainda não configurada passou a ser "com pendências"
(`ENERGY_NOT_CONFIGURED`) e ativar assim exige confirmação — consequência
direta de "NONE nunca significa energia zero". Os testes da 43 foram
ajustados a essa regra.

- Testes: 542 API + 25 web + 14 scripts. Playwright: `handoff/screens/44-*`.

---

# Next recommended implementation

Blocos A-C completos (exceto Usuários), **Bloco D completo (22-28)**,
**Fundação de Custos (29)** e **Dashboard operacional (30)** concluídos,
mais o fechamento operacional QR de Produto Acabado + conferência de lote
na Expedição, os **Relatórios R-01…R-17 (31)** e as **Exportações CSV +
Impressão/PDF (32)** — Bloco E encerrado.
Bloco F CONCLUÍDO (33-42); Bloco G em andamento (43-44 concluídas).
Próximo passo do roadmap oficial: **capacidade 45 — custo industrial
consolidado**, que multiplica os usos de recurso pelas tarifas congeladas e
soma as premissas manuais. A base de
desenvolvimento é reconstruível a partir do corpus real da Veridi
(`pnpm veridi:data:seed --reset`, dados em `.local-data/`, nunca
versionados); o importador definitivo continua sendo a **capacidade 41** —
o que existe hoje é ferramenta de dados de desenvolvimento. Depois seguem
45-47 (Bloco G). **Ao terminar o Bloco G, parar**: o
Bloco H (regulatório/rotulagem) é gate e depende de nova validação do
Product Owner. Demo Readiness, responsivo/mobile e hardening geral seguem
não iniciados, por decisão explícita.
Reutilizar quando começar: `FullWorkspaceModal`
+ `components.css` para cadastros simples; padrão de página própria (ver
Ordem de Compra/Recebimento/editor de Formulação/OP/Pedido) para novos
documentos transacionais; `apps/api/src/lib/inventory-ledger.ts`
(`getReservedByItems/Lots` já somam MaterialReservation +
CustomerOrderReservation líquida de expedição, `getAvailableByItems`,
`getOnOrderByItems`) para qualquer cálculo futuro de saldo;
`Billing`/`BillingLine` ISSUED são a base direta dos relatórios de
faturamento (R-15 por `issuedAt`, R-17 Pedido × Entregue × Faturado), e
`GET /billings/awaiting` já é o read model de R-16 — nenhuma tabela
agregada precisa ser criada; `hasCompletePricing` é a chave para separar
"quantidade faturada" (sempre confiável) de "valor faturado" nos KPIs;
`apps/api/src/lib/cost-reference.ts` + `modules/costs/costs.service.ts`
são a fonte única de custo (item/formulação/OP) — qualquer KPI de custo
deve consumi-los e propagar a qualidade `REAL/ESTIMATED/PARTIAL/NO_COST`
em vez de exibir um número sem contexto;
`traceability.service.ts` já resolve
genealogia real, reutilizável para qualquer tela futura de
rastreabilidade por Pedido/Expedição; a rota de impressão da etiqueta de
lote (fora do `AppShell`, CSS de impressão próprio) é o padrão a
reaproveitar no Bloco E para impressão/PDF, e a página da Expedição já
foi estruturada como bloco read-only pensando nisso.

Não criar as tabelas futuras antes do próximo slice ser confirmado.

---

# State maintenance
Keep this file concise.
Rewrite/condense after meaningful changes.
Do not turn it into a chronological log.
