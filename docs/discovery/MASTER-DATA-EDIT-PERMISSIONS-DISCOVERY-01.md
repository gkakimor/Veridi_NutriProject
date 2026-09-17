# MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01 — quem cria, edita e muda a situação de Item, Fornecedor e Produto

## 1. Status

`IMPLEMENTADO` — decisões do PO entregues por MASTER-DATA-EDIT-PERMISSIONS-01 em 2026-09-16.

Discovery somente leitura feito em 2026-09-16 sobre `main` `fc5041b`, entregue só no chat. Este arquivo é o registro
durável, escrito junto da implementação e revalidado no código sobre `4178c2f` (nada do que o discovery leu tinha
mudado entre as duas bases). O texto do chat não foi recuperado inteiro: as evidências abaixo foram conferidas de novo no
código, e as decisões são as do handoff de implementação.

## 2. Objetivo

Responder quem pode CRIAR, EDITAR, INATIVAR e REATIVAR o cadastro de Item, Fornecedor e Produto; o que dentro de cada
cadastro tem dono mais estreito; e o que isso muda na API, nas telas e nos fluxos que oferecem cadastrar no contexto —
sem confundir a permissão do cadastro com a das seções que já têm regra própria (referência de custo, homologação,
roteiro, documentos).

## 3. PO baseline

- CUSTOMER-EDIT-PERMISSIONS-01 (§98) fixou o padrão para o Cliente: lista própria por ato, 403 antes do corpo e da
  existência, consulta no mesmo modal, "Solicite a … o cadastro" no seletor.
- MASTER-DATA-LIFECYCLE-DISCOVERY-01 (só no chat) deixou a decisão D4 — quem inativa e reativa — para esta pergunta.
- `POST /items/:id/cost-references` já era de COMMERCIAL e ADMIN; a homologação da relação Item × Fornecedor já era da
  Qualidade; o roteiro padrão do Produto já era de ADMIN e PRODUCTION; o anexo de documento do Produto já era de
  COMMERCIAL, QUALITY e ADMIN.

## 4. Estado atual (antes da implementação)

- `POST`/`PATCH`/`activate`/`deactivate` de Item, Fornecedor e Produto só exigiam sessão: VIEWER criava, editava,
  inativava e reativava os três cadastros.
- `items.routes.ts`, `suppliers.routes.ts` e `products.routes.ts` não mapeavam `ForbiddenError`, e a aplicação não tem
  tratador de erro global: um `requireRole` cru nessas rotas respondia 500.
- A tela do Item manda os quatro controles de rastreabilidade em todo salvamento (`item-form.tsx`): um gate pela
  presença da chave recusaria qualquer edição.
- `POST /items` gravava `initialCostReference` para qualquer sessão — porta lateral à regra de quem define custo.
- `POST /products` direto nasce `APPROVED` e estava aberto a qualquer sessão.
- `POST /products` com `finishedProductItemId` ignorava `finishedRequiresCoa` em silêncio.
- Inativar o inativo e reativar o ativo respondiam 200, sem 409.
- As telas ofereciam "+ Novo", "Editar" e "Inativar/Reativar" a todo perfil; "Nova relação" (Item × Fornecedor) aparecia
  para quem a API recusaria; anexar e arquivar documento do Produto apareciam para todos.

## 5. Evidências

- Rotas: `apps/api/src/modules/items/items.routes.ts`, `suppliers/suppliers.routes.ts`, `products/products.routes.ts`
  (antes: `requireCurrentUser` ou nada); `items/item-cost-references.routes.ts` (COMMERCIAL e ADMIN em literal);
  `supplier-items/supplier-items.routes.ts` (PURCHASING e ADMIN em literal); `attachments/attachments.routes.ts`
  (listas por contexto em literal).
- Serviços: `items.service.ts` (`createItem` com `initialCostReference`; `updateItem` sem ator), `products.service.ts`
  (`createProduct` e `createFinishedItemForProduct`), `finished-item-for-product.ts` (PA com os três controles ligados e
  laudo opcional).
- Defaults: `ITEM_TYPE_DEFAULTS` em `packages/shared/src/items.ts` tinha três controles; `requiresCoa: false` estava
  repetido no serviço e na tela.
- Web: `pages/items/ItemsPage.tsx`, `item-form.tsx`, `ItemCreatePage.tsx`, `pages/suppliers/*`, `pages/products/*`,
  `pages/purchase-orders/PurchaseOrderPage.tsx`, `pages/supplier-items/SupplierItemsPage.tsx` e
  `SupplierItemFormModal.tsx`, `pages/formulations/FormulationVersionPage.tsx`,
  `pages/formulation-templates/FormulationTemplateDetailPage.tsx`, `pages/customer-orders/CustomerOrderPage.tsx`.
- Fixtures que dependiam do acesso aberto: `production-orders/gmp-execution.test.ts` (PRODUCTION criava Produto) e
  `quality/quality-documents.test.ts` (PURCHASING criava item com CoA exigido).

## 6. Findings

- **F1 (P1):** qualquer sessão cria, edita, inativa e reativa Item, Fornecedor e Produto.
- **F2:** `requireRole` cru nessas rotas vira 500 (`ForbiddenError` não mapeado).
- **F3:** gate de controle pela presença da chave quebraria o salvamento do Item.
- **F4 (P1):** `POST /items` com `initialCostReference` define custo sem ser do custeio.
- **F5 (P1):** `POST /products` direto cria produto aprovado para qualquer sessão.
- **F6:** `finishedRequiresCoa` ignorado quando o PA já existe — nem endurece, nem avisa.
- **F7:** transição de situação repetida devolve 200 em vez de recusa.
- **F8:** telas oferecem ações que terminam em 403 ("+ Novo", "Editar", "Inativar/Reativar", "Nova relação", anexar e
  arquivar documento do Produto).
- **F9 (fora do escopo):** `PATCH /products/:id` religa ou desliga o PA sem trava, e `operationallyUsed` ignora
  formulação, Modelo, PA e relação Item × Fornecedor → MASTER-DATA-STRUCTURAL-LOCKS-01.
- **F10 (fora do escopo, P1):** `PUT /receipt-lines/:id/acquisition-cost` só exige sessão → ACQUISITION-COST-PERMISSION-01.
- **F11 (fora do escopo):** Inativar/Reativar sem motivo e sem histórico nos três cadastros → MASTER-DATA-STATUS-HISTORY-01.
- **F12 (conhecido, fora do escopo):** `POST /supplier-items` aceita `qualificationStatus: APPROVED` de Compras — decisão
  D3 do ITEM-SUPPLIER-UX-DISCOVERY-01, não tocada aqui.

## 7. Gaps

- Gate de perfil por ato nas três rotas, antes do corpo e da existência, sem 500.
- Autoridade por campo dentro do Item (controles, marca de consumo, custo inicial), julgada contra o gravado.
- Recusa explícita do custo inicial e do laudo de PA existente.
- 409 de transição de situação.
- Modo consulta nas três telas, criação contextual condicionada ao perfil, e as subações próprias preservadas.

## 8. Riscos

- Esconder só o botão deixaria a API aberta — a autoridade tem de ser a rota.
- 404 antes do 403 revelaria a existência do registro.
- Gate por presença da chave travaria a edição do Item para Compras e Produção.
- Checar o controle e regravá-lo abre corrida: a Qualidade liga o laudo e a tela velha de Compras desliga.
- Tirar "+ Novo" sem dizer a quem pedir cria beco sem saída na OC, na Formulação e no Pedido.
- Confundir o cadastro com a seção tiraria do Comercial a referência de custo e da Produção o roteiro.

## 9. Alternativas consideradas

- **Item A** — só ADMIN e QUALITY editam tudo. **Item B** — ADMIN, PURCHASING, QUALITY e PRODUCTION criam e editam;
  controles só QUALITY e ADMIN; custo só COMMERCIAL e ADMIN (recomendada). **Item C** — só VIEWER perde a escrita.
- **Fornecedor A** — PURCHASING e ADMIN (recomendada). **Fornecedor B** — também QUALITY.
- **Produto A** — COMMERCIAL e ADMIN, com roteiro, documentos e custos nas rotas próprias (recomendada). **Produto B** —
  também PRODUCTION.

Nenhuma exige migration; motivo e histórico da situação exigiriam.

## 10. Recomendação

Item B, Fornecedor A, Produto A, com listas próprias por ato em `@veridi/shared`, `exigirPerfil` compartilhado, gate de
campo pela mudança de valor e consulta no mesmo modal.

## 11. Decisões PO

- **DE1 — Item, criar e editar:** ADMIN, PURCHASING, QUALITY e PRODUCTION. COMMERCIAL e VIEWER consultam.
- **DE2 — Item, controles:** `controlsLot`, `controlsExpiry`, `requiresQualityRelease`, `requiresCoa` só QUALITY e ADMIN;
  criação por PURCHASING ou PRODUCTION no padrão canônico do tipo; na edição, comparar gravado × novo.
- **DE3 — Item, campos técnicos:** identidade, classificação e códigos com a lista de DE1; `consumedInProduction`
  continua autoridade operacional de Produção e Administrador. **Leitura aplicada:** lista própria
  (`ITEM_PRODUCTION_CONSUMPTION_ROLES`), com o mesmo critério de mudança dos controles.
- **DE4 — Item, custo:** referência de custo, inclusive a inicial, de COMMERCIAL e ADMIN; o pedido de outro perfil é
  recusado, não ignorado.
- **DE5 — Item, situação:** inativar PURCHASING, QUALITY e ADMIN; reativar QUALITY e ADMIN; 409 para transição inválida;
  motivo e histórico para MASTER-DATA-STATUS-HISTORY-01.
- **DE6 — Fornecedor:** criar, editar, inativar e reativar PURCHASING e ADMIN; QUALITY não edita; homologação continua na
  relação Item × Fornecedor.
- **DE7 — Produto:** criar, editar, inativar e reativar COMMERCIAL e ADMIN, inclusive a criação direta aprovada;
  Formulação e Roteiro com a Produção; documentos e controles do PA com a Qualidade, pelas rotas próprias.
- **DE8 — Exige CoA do PA:** COMMERCIAL e ADMIN podem marcar na criação do Produto; depois, o controle é do Item e da
  Qualidade — o caminho do Produto não pode desligar controle existente.
- **DE9 — Criação contextual:** OC oferece "+ Novo item" (ADMIN, PURCHASING, QUALITY, PRODUCTION) e "+ Novo fornecedor"
  (ADMIN, PURCHASING); "Nova relação" com PURCHASING e ADMIN; Formulação oferece "+ Novo item" com a lista do Item;
  Pedido oferece "+ Novo produto" com COMMERCIAL e ADMIN; sem permissão, a ajuda "Solicite a … o cadastro" e a escolha
  do existente livre.
- **DE10 — Modo consulta:** quem não edita abre os três cadastros em leitura, preservando subações próprias.
- **DE11 — Travas estruturais:** não ampliar agora; registrar MASTER-DATA-STRUCTURAL-LOCKS-01.
- **DE12 — Custo de aquisição:** registrar ACQUISITION-COST-PERMISSION-01 (P1), sem corrigir nesta capability.

## 12. Pendências PO

Nenhuma para esta capability. Registrados para decisão futura: MASTER-DATA-STRUCTURAL-LOCKS-01,
MASTER-DATA-STATUS-HISTORY-01 e ACQUISITION-COST-PERMISSION-01.

## 13. Escopo recomendado

Gates nas rotas de Item, Fornecedor e Produto; autoridade por campo no Item; 409 de situação; listas compartilhadas;
consulta nas três telas; criação contextual e "Nova relação" por perfil; anexar e arquivar documento do Produto pela lista
da API; fixtures ajustadas; matrizes de teste por perfil na API e na Web.

## 14. Fora do escopo

Motivo e histórico de situação (migration); travas estruturais novas; gate do custo de aquisição; permissões de
Formulação, OP, Pedido, Recebimento e Expedição; a regra D3 da relação homologada por Compras; anexar e arquivar em Lote,
Recebimento, Projeto e Amostra (as telas ainda oferecem a todos — achado registrado no BACKLOG); dados existentes.

## 15. Próxima capability

MASTER-DATA-EDIT-PERMISSIONS-01 (entregue). Depois, sem posição: ACQUISITION-COST-PERMISSION-01 (P1; entregue em
2026-09-16 — Compras e Administrador, no PUT e no recebimento, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §105),
MASTER-DATA-STRUCTURAL-LOCKS-01 e MASTER-DATA-STATUS-HISTORY-01.

## 16. Implementação

**IMPLEMENTADO** em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (merge na `main`, fora de PROD). Regra em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §100; estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md); proteção em
[`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Sem migration.

## 17. Histórico de decisões

- 2026-09-16 — discovery entregue no chat sobre `fc5041b` (sem documento); recomendações Item B, Fornecedor A, Produto A.
- 2026-09-16 — PO fecha DE1–DE12; implementação e este registro na mesma rodada. `consumedInProduction` com lista própria
  (Produção e Administrador), leitura do handoff declarada em DE3.
