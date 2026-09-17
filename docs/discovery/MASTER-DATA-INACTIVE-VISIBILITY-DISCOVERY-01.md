# MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01 — cadastro inativo: visível × selecionável

## 1. Status

`EM_ANALISE` — **D1–D3 decididas pelo PO e implementadas** na Fatia 1 (INVENTORY-INACTIVE-ITEM-VISIBILITY-01,
2026-09-17, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §107); **D6–D7 decididas e implementadas** na Fatia 2
(PRODUCT-INACTIVE-COMMERCIAL-GATE-01, 2026-09-17, §108); **D4 e D8 decididas e implementadas** na Fatia 3
(SUPPLIER-ITEM-INACTIVE-GATE-01, 2026-09-17, §112). **D5 e D9 têm recomendação e esperam o handoff** de cada fatia.

Discovery READ ONLY de 2026-09-17 sobre `a6fcbdd` (deltas `a2bce62` e `0fc49e4` conferidos), entregue só no chat e
persistido na implementação da Fatia 1, a partir do resumo da sessão. As linhas de código citadas são as da época; a
fatia que tratar cada achado reconfere na `main` antes de agir.

## 2. Objetivo

Mapear onde Item, Fornecedor e Produto inativos **somem** do que ainda existe (estoque, histórico) e onde **vazam** para
operação nova — e propor uma regra por lugar.

Princípio proposto: **inativo não entra em escolha nova, mas não some do que já existe.**

## 3. PO baseline

- §95 (Cliente): operação comercial nova recusada para Bloqueado e Inativo, histórico à vista — o molde.
- §100: quem inativa e reativa Item, Fornecedor e Produto.
- [INVENTORY-PHYSICAL-COUNT-DISCOVERY-01](INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md): item inativo **com saldo** é contável;
  sem saldo fica fora do escopo.
- ASSISTED-ENTITY-SELECTOR-FOUNDATION-01 (`a2bce62`): a consulta de Item recusa inativo em escolha nova ("Item inativo não
  entra em escolha nova."); ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 promete linha inativa desabilitada nos demais seletores.

## 4. Estado atual (no discovery)

`active` e o índice já existem em Item, Fornecedor, Produto e Item × Fornecedor. Não há regra única: cada tela e cada rota
decidiu por conta própria, e as decisões divergem entre API e Web.

## 5. Evidências

- `apps/api/src/modules/inventory/inventory.service.ts:224` — `where = { active: true }` fixo em `listInventory`, desde o
  commit que criou o módulo (`2c86dea`, 2026-08-15), sem regra, sem teste, DTO sem flag, query sem parâmetro. O CSV
  (`list-exports.ts`) lê o mesmo serviço. R-01 mostra o mesmo saldo.
- `apps/web/src/pages/inventory/StockCountPage.tsx` — Contagem rápida buscava `active: true`; a API
  (`createQuickStockCount`) não olha `active`. A prévia do Inventário (`stock-count.service.ts`, `avaliarEscopo`) já
  aplica "inativo só com saldo".
- `POST /inventory-adjustments` (`createInventoryAdjustment`) aceitava entrada manual de item inativo.

## 6. Findings

**Estoque e físico**
- F1 — item inativo com saldo, reserva ou compra aberta sumia da visão de Estoque e do CSV.
- F2 — Contagem rápida: a Web escondia o inativo que a API aceita contar (Web errada frente ao Inventário).

**Produto inativo no Comercial**
- F3 — a API aceita vincular a Projeto, linha/versão/duplicar/enviar/aceitar Orçamento, aprovar Projeto (promove
  `APPROVED`) e gerar Pedido rascunho; recusam só Pedido (linha/confirmar), plano, OP criar/planejar e ativar Formulação.
  OP liberar não relê Produto/PA.

**Item × Fornecedor**
- F4 — criar recusa `inactive_reference` (sem teste); reativar relação, homologar, preferencial e oferta aceitam item ou
  fornecedor inativo (API e Web; `podeSerPreferencial` ignora `supplierActive`; DTO sem `itemActive`); inativar
  fornecedor não limpa o preferencial (o custo já ignora).
- F5 — receber OC já confirmada de fornecedor/item inativo é permitido, e o diálogo de inativar promete o contrário.
- F6 — OC marca "inativo" por AUSÊNCIA na página (falso positivo).

**Produção e outros**
- F7 — OP planejar ignora componente inativo.
- F8 — consumo de Amostra: a Web filtra, a API aceita.
- F9 — R-18 abre só com ativos.

## 7. Gaps

Nenhuma regra escrita para "inativo" fora do Cliente (§95); nenhum teste protegia F1; a situação não viajava no DTO do
Estoque, e a tela não tinha como marcar.

## 8. Riscos

Material físico invisível (F1) é inventário que ninguém conta nem vende; vazamento comercial (F3) é venda de produto
descontinuado; relação homologada de fornecedor inativo (F4) volta ao custo e à compra.

## 9. Alternativas consideradas

- Estoque: esconder todo inativo (estado de antes) × mostrar todo inativo × mostrar só com posição. A terceira mantém o
  físico à vista sem encher a visão de cadastro morto.
- Contagem rápida: filtrar a busca por elegibilidade (segunda consulta por busca) × buscar tudo e deixar a prévia
  decidir. A segunda é o que o Inventário já faz.

## 10. Recomendação

Uma regra por lugar (D1–D9), em quatro fatias e uma opcional, sem migration.

## 11. Decisões PO

| # | Decisão | Situação |
|---|---|---|
| D1 | Estoque, inativo COM posição (saldo, reservado ou em compra > 0): aparece por padrão, marcado "Item inativo" | **Decidida** (handoff da Fatia 1) |
| D2 | Estoque, inativo SEM posição: fora por padrão; filtro "Incluir inativos sem saldo"; CSV igual à tela | **Decidida** (handoff da Fatia 1) |
| D3 | Físico: Contagem rápida sim; saída e perda sim; entrada manual (`ADJUSTMENT_IN`) não — sobra entra pela contagem | **Decidida** (handoff da Fatia 1) |
| D4 | Receber OC já confirmada com item/fornecedor inativo: sim, com marca; corrigir o texto do "Inativar" | **Decidida** (handoff da Fatia 3) |
| D5 | OP nova com componente inativo: recusar no planejar nomeando o item; OP planejada/liberada segue | Recomendada |
| D6 | Produto inativo não inicia compromisso novo: recusar vincular, linha nova, enviar, aceitar, aprovar, gerar Pedido e criar Amostra; rascunho abre com aviso; versão nova e duplicar copiam a linha e não enviam nem aceitam até regularizar; OP planejada não libera; nada é cancelado; custos, preço, CMV e roteiro sem bloqueio | **Decidida** (handoff da Fatia 2) |
| D7 | Produto × PA sem cascata (perfis diferentes no §100); PA existente e inativo com recusa própria, nunca "sem produto acabado"; cadastro do Produto avisa o PA inativo | **Decidida** (handoff da Fatia 2) |
| D8 | Relação com item/fornecedor inativo: recusar reativar, homologar, preferencial e oferta; inativar fornecedor limpa o preferencial dele | **Decidida** (handoff da Fatia 3) |
| D9 | R-18 abre em "Todos", com a situação | Recomendada |

## 12. Pendências PO

D5 e D9, uma fatia por vez.

## 13. Escopo recomendado

| Fatia | Capability | Decisões |
|---|---|---|
| 1 | INVENTORY-INACTIVE-ITEM-VISIBILITY-01 | D1–D3 |
| 2 | PRODUCT-INACTIVE-COMMERCIAL-GATE-01 | D6–D7 |
| 3 | SUPPLIER-ITEM-INACTIVE-GATE-01 | D4, D8 |
| 4 | PRODUCTION-INACTIVE-COMPONENT-GATE-01 | D5 |
| opcional | INACTIVE-MARKERS-REPORTS-01 | D9 |

## 14. Fora do escopo

Histórico de Inativar/Reativar (MASTER-DATA-STATUS-HISTORY-01); travas estruturais (MASTER-DATA-STRUCTURAL-LOCKS-01);
cancelar documento aberto por causa de inativação.

## 15. Próxima capability

A próxima fatia que o PO emitir: 4 (PRODUCTION-INACTIVE-COMPONENT-GATE-01, D5) ou a opcional
(INACTIVE-MARKERS-REPORTS-01, D9). Nenhuma depende da outra.

## 16. Implementação

**Fatia 1 — IMPLEMENTADA em 2026-09-17** (INVENTORY-INACTIVE-ITEM-VISIBILITY-01, na `main` e fora de PROD, sem migration,
§107):

- `GET /inventory` e `/inventory/export.csv` sem `active: true` fixo: inativo com posição aparece; sem posição, só com
  `includeInactiveWithoutPosition=true`; `onlyWithStock` inalterado; CSV com a coluna "Item ativo";
- `InventoryItemSummaryDTO.itemActive` (o detalhe herda); lista e detalhe marcam "Item inativo"; lotes, reservas e
  movimentos seguem à vista;
- `POST /inventory-adjustments` recusa `ADJUSTMENT_IN` de inativo (400 `inactive_item`); saída e perda seguem; o ajuste
  da Web não oferece entrada para inativo;
- Contagem rápida busca ativos e inativos, marca o inativo, e a prévia decide a posição (inativo sem saldo: "nenhuma
  posição para contar"); os seletores do Inventário marcam o inativo.

**Fatia 2 — IMPLEMENTADA em 2026-09-17** (PRODUCT-INACTIVE-COMMERCIAL-GATE-01, na `main` e fora de PROD, sem migration, §108).
F3 reconferido na `main` (`9a739e27`) antes de agir — confirmado inteiro; além dele, a geração do Pedido não olhava o PA e a
Amostra nova aceitava produto inativo (porta trazida pelo handoff):

- `lib/product-active-gate.ts`: 400 `inactive_product` em vincular ao Projeto, linha nova, envio e aceite de Orçamento,
  aprovação do Projeto (transação desfeita), geração e confirmação de Pedido e Amostra nova; a liberação da OP planejada
  relê Produto e o PA congelado; criar, trocar e planejar a OP intocados;
- PA existente e inativo: 400 `inactive_finished_item` na linha e na confirmação do Pedido, na geração pelo orçamento e na
  liberação da OP — `missing_finished_item` fica para o produto sem PA; sem cascata Produto × PA;
- situação atual nos DTOs (`QuoteLineDTO.productActive`, `CustomerOrderLineDTO` e `ProductionOrderDTO` com
  `productActive`/`finishedItemActive`, `ProductFinishedItemSummary.active`); Web sem o inativo em escolha nova (vincular,
  linha nova, amostra), marcas no registro salvo, aviso do passo recusado e aviso de PA inativo no cadastro do Produto.

**Fatia 3 — IMPLEMENTADA em 2026-09-17** (SUPPLIER-ITEM-INACTIVE-GATE-01, na `main` e fora de PROD, sem migration, §112).
F4 e F5 reconferidos na `main` (`ad341350`) antes de agir — confirmados; F6 entrou junto, porque a marca falsa da OC e a marca
verdadeira do recebimento são a mesma informação:

- `exigirPartesAtivas` em `supplier-items.service.ts`: 400 `inactive_reference` em criar, reativar a relação, homologar,
  preferencial e oferta, com a frase nomeando a parte e o ato (`InactiveSupplierItemPartyError` passou a receber o ato);
  bloquear, voltar para pendente, inativar a relação, remover o preferencial e editar dados comerciais seguem, e a recusa
  vem ANTES da elegibilidade do preferencial;
- `deactivateSupplier` limpa `preferred` das relações do fornecedor na mesma transação da inativação, sem tocar em relação,
  oferta nem histórico; reativar não devolve a escolha; inativar Item não mexe em preferencial;
- receber OC confirmada segue liberado (D4), com `PurchaseOrderDTO.supplierActive` e `PurchaseOrderLineDTO.itemActive` lidos
  agora — o que também corrige F6: a OC marcava "inativo" pela ausência do cadastro na primeira página do catálogo;
- `SupplierItemDTO.itemActive` (o `supplierActive` já existia); detalhe com marcas, aviso do que volta com a reativação e
  só os botões que a API recusaria desabilitados; grade e seção do Item marcam a relação e não oferecem o preferencial;
  recebimento mostra as duas marcas sem barrar; o diálogo de inativar o Fornecedor deixou de prometer que o recebimento para.

Fatia 4 e a opcional: NÃO IMPLEMENTADO.

## 17. Histórico de decisões

- 2026-09-17 — discovery entregue no chat (READY NO); D1–D3 decididas pelo PO no handoff da Fatia 1 e implementadas no
  mesmo dia; documento persistido nessa implementação.
- 2026-09-17 — D6–D7 decididas pelo PO no handoff da Fatia 2 (PRODUCT-INACTIVE-COMMERCIAL-GATE-01) e implementadas no mesmo
  dia; o handoff acrescentou a Amostra nova às portas da D6 e a revalidação de Produto e PA na liberação da OP.
- 2026-09-17 — D4 e D8 decididas pelo PO no handoff da Fatia 3 (SUPPLIER-ITEM-INACTIVE-GATE-01) e implementadas no mesmo dia;
  o handoff confirmou que inativação posterior não bloqueia recebimento já comprometido, e a fatia trouxe junto a marca
  verdadeira da OC (F6).
