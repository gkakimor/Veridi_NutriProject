# ITEM-SUPPLIER-UX-DISCOVERY-01 — Item × Fornecedor administrável onde a pessoa já está

## 1. Status

`EM_ANALISE` — a D3, que bloqueava a Fatia 1, foi decidida pelo PO e implementada em
ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 (2026-09-16, na `main`, fora de PROD). As Fatias 1 e 2 e a tela geral
seguem como recomendação, a confirmar no handoff de ITEM-SUPPLIER-UX-01.

**Origem deste arquivo.** O discovery foi feito em 2026-09-16, READ ONLY, sobre `origin/main` `670ffa2`, e entregue
só no chat: o handoff proibia escrever no repositório. Este documento foi persistido depois, na rodada que fechou a
D3, a partir do resumo registrado daquela sessão e das evidências reconferidas no código em `df45133`. Os números de
dados são os do levantamento de 2026-09-16 (`veridi_dev` com a carga de PROD), não reconsultados. A numeração "D3"
indica que o relatório original trazia outras decisões; o texto delas não foi preservado e não é reconstruído aqui —
se ainda valerem, voltam ao PO no handoff da Fatia 1.

## 2. Objetivo

Tornar a relação Item × Fornecedor administrável onde a pessoa já trabalha — no cadastro do Item e no do Fornecedor —
sem domínio novo, e dizer o que impede começar.

## 3. PO baseline

- §5.3 (capability 40): homologar e bloquear são decisões da Qualidade; Compras registra a relação, o código, os
  preços e o preferencial; qualquer dos lados devolve para pendente, com histórico imutável.
- §100 (MASTER-DATA-EDIT-PERMISSIONS-01, DE6): criar e alterar a relação, marcar preferencial e registrar oferta são de
  Compras e Administrador (`SUPPLIER_ITEM_EDIT_ROLES`); a homologação segue na relação, com regra própria.
- D3 decidida em 2026-09-16 (seção 11), regra durável no §101.

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

- A relação não é administrável a partir do Item nem do Fornecedor: a seção é só leitura.
- ~~A criação permitia a Compras decidir a homologação~~ — fechado pela D3.

## 8. Riscos

- Levar o formulário para dentro do Item multiplicaria a porta da D3 — por isso ela bloqueava a Fatia 1. Fechada, a
  reutilização herda a regra.
- Tornar o preferencial fácil de marcar sem mostrar a ambiguidade (F3) esconderia por que o custo não aparece.
- As duas E2E acima dependem da "Nova relação" na tela geral: mexer nela pede mexer nelas.

## 9. Alternativas consideradas

- **Tela geral de Item × Fornecedor:** manter como está (opção 1, recomendada) e reavaliar depois das Fatias 1 e 2.
  As outras opções do relatório original não foram preservadas.
- **D3:** (a) Compras cria só `PENDING` e a Qualidade decide pela rota própria — decidida; (b) manter a criação com
  situação livre para Compras — descartada, é a segunda porta da decisão.

## 10. Recomendação

- **Fatia 1 — ITEM-SUPPLIER-UX-01:** seção Fornecedores do modal do Item administrável, reutilizando
  `SupplierItemFormModal` e `SupplierItemDetailModal`.
- **Fatia 2:** o mesmo em Fornecedor › Itens.
- **Tela geral:** fica como está (opção 1).

## 11. Decisões PO

### D3 — Compras cria a relação já homologada? — DECIDIDA em 2026-09-16

**Decisão (handoff ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01):** não. Compras cria a relação, cadastra os dados
comerciais e a primeira oferta, e administra o preferencial quando a relação for elegível; a relação que Compras cria
nasce `PENDING`, e pedir `APPROVED` ou `BLOCKED` é recusado. Homologar e bloquear continuam decisões de Qualidade e
Administrador, nas rotas de homologação. Voltar para pendente preserva os papéis do domínio (Compras, Qualidade e
Administrador), e o histórico de homologação não muda. O Administrador, autoridade de exceção, mantém a criação com
situação explícita — o contrato que já existia —, sem ampliar permissões. Preferencial continua exigindo relação ativa
e homologada, e a oferta segue participando do custo pelas regras existentes.

**Impacto:** sem migration; recusa 403 com o motivo, antes de qualquer leitura e sem gravar nada; na tela, Compras vê
"Situação inicial: Pendente" com a explicação, e o Administrador mantém o seletor. Regra no §101.

## 12. Pendências PO

- Confirmar, no handoff de ITEM-SUPPLIER-UX-01, o escopo das Fatias 1 e 2 e a opção 1 para a tela geral — e reapresentar
  as decisões do relatório original que não constam aqui, se ainda valerem. Nenhuma bloqueia começar a Fatia 1.

## 13. Escopo recomendado

Fatia 1: no modal do Item em edição, a seção Fornecedores passa a oferecer "Nova relação" e o detalhe da relação a
quem os perfis permitem, com as mesmas regras e as mesmas listas da tela geral. Fatia 2: o mesmo no Fornecedor.

## 14. Fora do escopo

Lead time de fornecedor; vigência para as ofertas legadas; escolha automática de preferencial (nunca "o mais
barato", §5.3); vigências sobrepostas (SUPPLIER-OFFER-OVERLAP-01); mudanças na tela geral.

## 15. Próxima capability

ITEM-SUPPLIER-UX-01 (Fatia 1), quando o PO emitir o handoff.

## 16. Implementação

- **D3:** ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01, entregue em 2026-09-16, na `main` e fora de PROD (regra no §101,
  estado no [`PROJECT_STATE.md`](../PROJECT_STATE.md)).
- **Fatias 1 e 2:** NÃO IMPLEMENTADO.

## 17. Histórico de decisões

- **2026-09-16** — discovery entregue no chat, READ ONLY, base `670ffa2`; D3 aberta, bloqueando a Fatia 1.
- **2026-09-16** — D3 decidida pelo PO. Antes: a criação aceitava a situação informada por quem criava, inclusive
  Compras. Agora: Compras cria `PENDING`; homologar e bloquear, também na criação, são de Qualidade e Administrador.
  Motivo: a mesma decisão tinha duas portas com autoridades diferentes. Implementada em
  ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01, que também persistiu este documento.
