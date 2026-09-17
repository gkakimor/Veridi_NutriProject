# ITEM-SUPPLIER-UX-DISCOVERY-01 — Item × Fornecedor administrável onde a pessoa já está

## 1. Status

`IMPLEMENTADO` — a Fatia 1 (D1) foi entregue em ITEM-SUPPLIER-UX-01, e a D3 antes dela, em
ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 (2026-09-16, as duas na `main` e fora de PROD). A D2 mantém a tela geral; a
D4 leva a visão Fornecedor → Itens para capability separada (SUPPLIER-ITEMS-UX-01, futura); a D5 deixa lead time de
fornecedor fora do escopo.

**Origem deste arquivo.** O discovery foi feito em 2026-09-16, READ ONLY, sobre `origin/main` `670ffa2`, e entregue
só no chat: o handoff proibia escrever no repositório. Este documento foi persistido depois, na rodada que fechou a
D3, a partir do resumo registrado daquela sessão e das evidências reconferidas no código em `df45133`. Os números de
dados são os do levantamento de 2026-09-16 (`veridi_dev` com a carga de PROD), não reconsultados. A numeração "D3"
indica que o relatório original trazia outras decisões; o texto delas não foi preservado e não é reconstruído aqui —
se ainda valerem, voltam ao PO no handoff da Fatia 1. **Voltaram:** o handoff de ITEM-SUPPLIER-UX-01 (2026-09-16)
trouxe D1, D2, D4 e D5, registradas na seção 11 com o texto do PO e a numeração dele.

## 2. Objetivo

Tornar a relação Item × Fornecedor administrável onde a pessoa já trabalha — no cadastro do Item e no do Fornecedor —
sem domínio novo, e dizer o que impede começar.

## 3. PO baseline

- §5.3 (capability 40): homologar e bloquear são decisões da Qualidade; Compras registra a relação, o código, os
  preços e o preferencial; qualquer dos lados devolve para pendente, com histórico imutável.
- §100 (MASTER-DATA-EDIT-PERMISSIONS-01, DE6): criar e alterar a relação, marcar preferencial e registrar oferta são de
  Compras e Administrador (`SUPPLIER_ITEM_EDIT_ROLES`); a homologação segue na relação, com regra própria.
- D3 decidida em 2026-09-16 (seção 11), regra durável no §101.
- D1, D2, D4 e D5 decididas em 2026-09-16 no handoff de ITEM-SUPPLIER-UX-01 (seção 11); a D1 tem regra durável no §102.

## 4. Estado atual

- **Domínio completo para a UX.** `SupplierItem` N:N, único por (fornecedor, item); preferencial único por item (índice
  parcial) e só em relação ativa e homologada (CHECK); ofertas imutáveis com preço, MOQ, vigência e origem (`MANUAL`,
  `LEGACY_IMPORT`); homologação com histórico append-only de quem decidiu e quando. Matéria-prima e embalagem usam a
  mesma relação; produto acabado é recusado.
- **Sem lead time de fornecedor.** O único prazo do sistema é `QuoteVersion.leadTimeDays`, do orçamento comercial.
- **Telas.** Compras › Item × Fornecedor (`SupplierItemsPage`) cria pela "Nova relação" (`SupplierItemFormModal`) e
  administra no detalhe (`SupplierItemDetailModal`: dados comerciais, homologação, preferencial e ofertas). Nos modais
  do Item e do Fornecedor, `SupplierItemsSection` só lista — cadastrar, homologar e registrar preço acontecem na tela
  geral.
- **Dado real** (2026-09-16): 721 relações, 0 preferenciais, 773 ofertas `LEGACY_IMPORT` sem vigência, 101 itens com
  duas ou mais relações homologadas ativas.
- **Desde ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01:** a relação criada por Compras nasce `PENDING`; homologar e
  bloquear, inclusive na criação, são de Qualidade e Administrador (§101).
- **Desde ITEM-SUPPLIER-UX-01:** a seção Fornecedores do modal do Item administra a relação
  (`FornecedoresDoItemSection`): adicionar fornecedor com o Item fixo, definir o preferencial na linha com confirmação
  e abrir o detalhe por cima do Item (§102). O cadastro do Fornecedor segue só listando (`SupplierItemsSection`).
- **Desde SUPPLIER-QUALITY-REJECTION-REASON-01:** bloquear a relação exige motivo, gravado na observação do evento de
  homologação (§104); o diálogo mora no detalhe compartilhado, então vale na tela geral e no cadastro do Item.
- **Dado real reconferido em 2026-09-16** (`veridi_dev`, só leitura): 721 relações — 603 de matéria-prima, 118 de
  embalagem, nenhuma de produto acabado —, 512 homologadas e 209 pendentes, nenhuma inativa, nenhuma com fornecedor
  inativo, nenhum preferencial; 346 itens com relação, no máximo 9 por item. `ItemType` só tem matéria-prima, embalagem
  e produto acabado (não existe "uso e consumo").

## 5. Evidências

- Modelo: `apps/api/prisma/schema.prisma` (`SupplierItem`, `SupplierItemOffer`, `SupplierItemQualificationHistory`);
  `apps/api/prisma/migrations/20260908090000_supplier_items/migration.sql` (`supplier_items_preferred_per_item_key`,
  `supplier_items_preferred_requires_approved_check`).
- API: `apps/api/src/modules/supplier-items/supplier-items.routes.ts` (gates por ato),
  `supplier-items.service.ts` (`createSupplierItem`, `changeQualification`, `setPreferred`, `createOffer`),
  `supplier-items.schemas.ts` (`createSupplierItemSchema` com `qualificationStatus`, `preferred` e `initialOffer`).
- Listas: `packages/shared/src/supplier-items.ts` (`SUPPLIER_ITEM_EDIT_ROLES`; desde a D3,
  `SUPPLIER_ITEM_QUALIFICATION_ROLES`).
- Tela: `apps/web/src/pages/supplier-items/` (`SupplierItemsPage`, `SupplierItemFormModal`, `SupplierItemDetailModal`),
  `apps/web/src/components/SupplierItemsSection.tsx` (usada em `pages/items/ItemFormModal.tsx` e
  `pages/suppliers/SupplierFormModal.tsx`).
- E2E que passam pela "Nova relação" e escolhem "Homologado", com o ADMIN que o runner cria:
  `scripts/e2e/oferta-de-fornecedor-vira-custo.mjs` e `scripts/e2e/private-label-golden-path.mjs`.
- Desde ITEM-SUPPLIER-UX-01: `apps/web/src/pages/supplier-items/FornecedoresDoItem.tsx` (seção do Item),
  `preferencial.tsx` (elegibilidade e confirmação), `SupplierItemFormModal` com `itemFixo`, `SupplierItemDetailModal`
  com `preferencialDoItem`; teste `fornecedores-do-item.test.tsx`.

## 6. Findings

- **F1 — sem migration.** Tudo o que a administração no Item e no Fornecedor precisa já existe no domínio e na API.
- **F2 — D3: duas portas para a mesma decisão.** `POST /supplier-items` aceitava `qualificationStatus` `APPROVED` ou
  `BLOCKED` de Compras, enquanto `POST /supplier-items/:id/qualification` recusava o mesmo ato com 403. O formulário
  oferecia o seletor a quem abrisse "Nova relação", e os testes do cadastro completo rodavam como ADMIN — nada acusava.
  Registrado também como F12 em [MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01](MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md).
- **F3 — ambiguidade latente.** Com 101 itens de dois ou mais homologados e nenhum preferencial, cada oferta válida
  registrada num deles leva o custo a "ambíguo" até alguém escolher o preferencial (§76).
- **F4 — legado sem vigência.** As 773 ofertas importadas são observação histórica e não entram no custo.

## 7. Gaps

- ~~A relação não é administrável a partir do Item~~ — fechado pela D1 (ITEM-SUPPLIER-UX-01). A partir do
  Fornecedor continua só leitura (D4).
- ~~A criação permitia a Compras decidir a homologação~~ — fechado pela D3.

## 8. Riscos

- Levar o formulário para dentro do Item multiplicaria a porta da D3 — por isso ela bloqueava a Fatia 1. Fechada, a
  reutilização herda a regra.
- Tornar o preferencial fácil de marcar sem mostrar a ambiguidade (F3) esconderia por que o custo não aparece.
- As duas E2E acima dependem da "Nova relação" na tela geral: mexer nela pede mexer nelas.

## 9. Alternativas consideradas

- **Tela geral de Item × Fornecedor:** manter como está (opção 1, recomendada) e reavaliar depois das Fatias 1 e 2.
  As outras opções do relatório original não foram preservadas. Decidida pela D2: permanece.
- **D3:** (a) Compras cria só `PENDING` e a Qualidade decide pela rota própria — decidida; (b) manter a criação com
  situação livre para Compras — descartada, é a segunda porta da decisão.

## 10. Recomendação

- **Fatia 1 — ITEM-SUPPLIER-UX-01:** seção Fornecedores do modal do Item administrável, reutilizando
  `SupplierItemFormModal` e `SupplierItemDetailModal`. Entregue (D1).
- **Fatia 2:** o mesmo em Fornecedor › Itens. Capability separada (D4).
- **Tela geral:** fica como está (opção 1). Mantida (D2).

## 11. Decisões PO

### D1 — A seção Fornecedores do Item passa a ser administrável? — DECIDIDA e IMPLEMENTADA em 2026-09-16

**Decisão (handoff ITEM-SUPPLIER-UX-01):** sim. A seção Fornecedores do cadastro e da consulta do Item mostra as
relações reais do item e administra a relação Item × Fornecedor ali mesmo: Compras e Administrador criam a relação com o
Item fixo, editam os dados comerciais, administram ofertas e definem o preferencial respeitando a elegibilidade (relação
ativa e homologada); a Qualidade consulta e homologa, bloqueia ou devolve para pendente pelas ações que já existem;
Produção, Comercial e Consulta consultam. Nenhuma permissão ampliada para facilitar a tela; a relação continua N:N por
`SupplierItem`, sem fornecedor direto no Item nem na embalagem.

**Impacto:** sem migration e sem API nova. Detalhe da relação aberto por cima do Item, sem navegar; duplicidade leva à
relação existente; trocar o preferencial pede confirmação curta e usa a troca atômica da API. Regra no §102.

### D2 — A tela global Item × Fornecedor permanece? — MANTIDA em 2026-09-16

**Decisão (handoff ITEM-SUPPLIER-UX-01):** sim. Compras › Item × Fornecedor continua útil como consulta, fila de Compras
e fila de Qualidade — não é substituída, removida nem redirecionada para o Item. A seção do Item é a visão contextual; a
tela geral, a transversal.

**Impacto:** a tela geral não mudou; as E2E que passam pela "Nova relação" seguem valendo.

**Decisão (handoff ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01):** não. Compras cria a relação, cadastra os dados
comerciais e a primeira oferta, e administra o preferencial quando a relação for elegível; a relação que Compras cria
nasce `PENDING`, e pedir `APPROVED` ou `BLOCKED` é recusado. Homologar e bloquear continuam decisões de Qualidade e
Administrador, nas rotas de homologação. Voltar para pendente preserva os papéis do domínio (Compras, Qualidade e
Administrador), e o histórico de homologação não muda. O Administrador, autoridade de exceção, mantém a criação com
situação explícita — o contrato que já existia —, sem ampliar permissões. Preferencial continua exigindo relação ativa
e homologada, e a oferta segue participando do custo pelas regras existentes.

**Impacto:** sem migration; recusa 403 com o motivo, antes de qualquer leitura e sem gravar nada; na tela, Compras vê
"Situação inicial: Pendente" com a explicação, e o Administrador mantém o seletor. Regra no §101. Implementada
anteriormente, em ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01; ITEM-SUPPLIER-UX-01 a herda no cadastro do Item.

### D4 — Fornecedor → Itens entra agora? — FUTURA

**Decisão (handoff ITEM-SUPPLIER-UX-01):** não. A visão inversa — Fornecedor → Itens fornecidos, administrável no
cadastro do Fornecedor — fica para capability separada, SUPPLIER-ITEMS-UX-01, e não é implementada agora.

**Impacto:** a seção Itens fornecidos do Fornecedor segue só leitura, com o caminho para a tela geral.

### D5 — Lead time do fornecedor entra agora? — FORA DO ESCOPO

**Decisão (handoff ITEM-SUPPLIER-UX-01):** não. Nenhum campo nem schema de prazo de entrega do fornecedor nesta rodada.

**Impacto:** o único prazo do sistema continua sendo `QuoteVersion.leadTimeDays`, do orçamento comercial.

## 12. Pendências PO

- Nenhuma para a Fatia 1.
- Para decidir com SUPPLIER-ITEMS-UX-01: levar à tela geral a confirmação da troca de preferencial que o cadastro do Item
  já pede. Na tela geral, "Marcar como preferencial" continua trocando direto, como antes (D2; a E2E
  `oferta-de-fornecedor-vira-custo` passa por ele).

## 13. Escopo recomendado

Fatia 1: no modal do Item em edição, a seção Fornecedores passa a oferecer "Nova relação" e o detalhe da relação a
quem os perfis permitem, com as mesmas regras e as mesmas listas da tela geral — entregue como "Adicionar fornecedor"
(D1). Fatia 2: o mesmo no Fornecedor (D4, futura).

## 14. Fora do escopo

Lead time de fornecedor (D5); Fornecedor → Itens administrável (D4); vigência para as ofertas legadas; escolha automática
de preferencial (nunca "o mais barato", §5.3); vigências sobrepostas (SUPPLIER-OFFER-OVERLAP-01); comparador de ofertas
ou motor de custo novo; mudanças na tela geral (D2).

## 15. Próxima capability

SUPPLIER-ITEMS-UX-01 (Fatia 2, D4), quando o PO emitir o handoff.

## 16. Implementação

- **D3:** ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01, entregue em 2026-09-16, na `main` e fora de PROD (regra no §101,
  estado no [`PROJECT_STATE.md`](../PROJECT_STATE.md)).
- **D1 — Fatia 1:** ITEM-SUPPLIER-UX-01, entregue em 2026-09-16, na `main` e fora de PROD (regra no §102, estado no
  [`PROJECT_STATE.md`](../PROJECT_STATE.md)). Sem migration e sem API nova.
- **D2:** tela geral sem mudança.
- **D4 — Fatia 2:** NÃO IMPLEMENTADO (SUPPLIER-ITEMS-UX-01).
- **D5:** fora do escopo, nada a implementar.
- **Motivo do bloqueio** (decisão do PO posterior a D1–D5): SUPPLIER-QUALITY-REJECTION-REASON-01, entregue em
  2026-09-16, na `main` e fora de PROD (regra no §104). Sem migration. Muda o detalhe também na tela geral; a D2 segue
  valendo para o resto dela.

## 17. Histórico de decisões

- **2026-09-16** — discovery entregue no chat, READ ONLY, base `670ffa2`; D3 aberta, bloqueando a Fatia 1.
- **2026-09-16** — D3 decidida pelo PO. Antes: a criação aceitava a situação informada por quem criava, inclusive
  Compras. Agora: Compras cria `PENDING`; homologar e bloquear, também na criação, são de Qualidade e Administrador.
  Motivo: a mesma decisão tinha duas portas com autoridades diferentes. Implementada em
  ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01, que também persistiu este documento.
- **2026-09-16** — D1, D2, D4 e D5 decididas pelo PO no handoff de ITEM-SUPPLIER-UX-01, que reapresentou as decisões cujo
  texto não tinha sido preservado. D1: antes, a seção Fornecedores do Item só listava; agora administra a relação. D2: a
  tela geral permanece. D4: Fornecedor → Itens vai para capability separada. D5: lead time fora do escopo. D1
  implementada em ITEM-SUPPLIER-UX-01; o discovery passa a `IMPLEMENTADO`.
- **2026-09-16** — motivo do bloqueio decidido pelo PO no handoff de SUPPLIER-QUALITY-REJECTION-REASON-01. Antes: a
  observação da decisão era opcional em qualquer situação, e um bloqueio podia ficar sem porquê. Agora: bloquear exige
  motivo em texto livre (sem lista fechada), na observação do evento; homologar e voltar para pendente seguem
  opcionais; bloqueio antigo sem motivo continua válido, sem backfill. Motivo: a decisão negativa da Qualidade precisa
  ser explicável depois. A regra vale no detalhe compartilhado, então chega à tela geral e ao cadastro do Item.
  Implementada na mesma rodada (§104).
