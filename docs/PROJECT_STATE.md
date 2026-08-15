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

Decisão durável: baseline visual v2 (tokens `--v-green-*`/`--v-lime`/
`--ok`/`--warn`/`--err`, `--font-ui`/`--font-code` sem CDN) é o padrão
oficial de identidade. Para telas CRUD simples (list + create/edit) o
padrão é `FullWorkspaceModal` — aplicado em Itens, Fornecedores, Clientes,
Produtos. Para **documentos transacionais** o padrão é **página própria
dentro do workspace** (não modal) — aplicado em Ordem de Compra e agora
Recebimento; será reutilizado em Ordem de Produção. Ver `docs/UI_BRAND.md`.

14 dos 21 módulos do MVP ainda não foram implementados (Bloco A: falta só
Usuários; Bloco B: falta Estoque/Movimentações/FEFO — OC, Recebimento e
Lotes já implementados).

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
apps/web        React + Vite + TS strict, shell operacional Veridi,
                 Cadastros > Itens/Fornecedores/Clientes/Produtos,
                 Compras > Ordens de Compra/Recebimentos,
                 Estoque > Lotes
apps/api        Fastify + TS strict, Prisma; /health, /items, /units,
                 /suppliers, /customers, /products, /purchase-orders,
                 /receipts, /lots
packages/shared contratos compartilhados (Health, Item, UnitOfMeasure,
                 Supplier, Customer, Product, PurchaseOrder, Receipt, Lot,
                 CNPJ, UFs)
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
13. Formulations
14. Versioning
15. OP
16. Requirement Calculation
17. Reservation
18. QR Picking
19. Actual Consumption
20. Partial Production / Completion
21. Finished Product

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

# Next recommended implementation

Resta do Bloco A: **Usuários**. Bloco B segue com **Estoque/On Hand +
Inventory Movements** (ledger a partir dos `Receipt`s/`Lot`s já modelados —
`Lot.initialReceivedQuantity` explicitamente não é saldo) e depois
FEFO/QR/Etiqueta — a definir por próximo handoff de Product Ownership.
Reutilizar: `FullWorkspaceModal` + `components.css` para cadastros
simples; padrão de página própria (ver Ordem de Compra/Recebimento) para
novos documentos transacionais (ex.: Ordem de Produção).

Não criar as tabelas futuras antes do próximo slice ser confirmado.

---

# State maintenance
Keep this file concise.
Rewrite/condense after meaningful changes.
Do not turn it into a chronological log.
