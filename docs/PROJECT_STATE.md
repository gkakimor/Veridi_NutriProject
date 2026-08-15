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

18 dos 21 módulos do MVP ainda não foram implementados (Bloco A: falta
Usuários e Produtos).

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
                 Cadastros > Itens / Fornecedores / Clientes
apps/api        Fastify + TS strict, Prisma; /health, /items, /units,
                 /suppliers, /customers
packages/shared contratos compartilhados (Health, Item, UnitOfMeasure,
                 Supplier, Customer, CNPJ, UFs brasileiras)
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

- Nenhuma pendência nova. Segue a mesma pendência de `window.confirm` já
  registrada no Delivery 02.

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

---

# Durable UI decisions
- Veridi green visual identity.
- Existing token/design-system philosophy stays.
- Old permanent Explorer/Workspace/Properties shell is not used.
- Default shell = top masthead + left sidebar + main workspace.
- Contextual right drawer only when useful.
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

Restam do Bloco A: **Usuários, Clientes, Fornecedores, Produtos** — a
definir por próximo handoff de Product Ownership. Reutilizar o padrão
estabelecido pelo Cadastro de Itens (tabela + drawer + `components.css`).

Não criar as tabelas futuras antes do próximo slice ser confirmado.

---

# State maintenance
Keep this file concise.
Rewrite/condense after meaningful changes.
Do not turn it into a chronological log.
