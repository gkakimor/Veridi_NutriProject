# CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01 — quem cria e edita o cadastro do Cliente

## 1. Status

`IMPLEMENTADO` — decisão do PO (opção A) entregue por CUSTOMER-EDIT-PERMISSIONS-01 em 2026-09-16.

Discovery somente leitura feito em 2026-09-16 sobre `main` `2114227`, entregue só no chat: o handoff dele proibia
documento e commit. Este arquivo é o registro durável, escrito junto da implementação e revalidado sobre `800ec99`
(nada do que o discovery leu tinha mudado entre os dois).

## 2. Objetivo

Responder quem pode CRIAR e EDITAR o cadastro do Cliente, e o que isso muda na API, nas telas e nos fluxos que
oferecem cadastrar Cliente no contexto — sem confundir com a SITUAÇÃO cadastral (§95), que já tinha dono.

## 3. PO baseline

- CUSTOMER-EDIT-PERMISSIONS-01 registrado no BACKLOG em 2026-09-16 (HOMOLOGATION-RELEASE-RAILWAY-01) como "aguardando
  definição do PO".
- CUSTOMER-STATUS-HARDENING-01 (2026-09-16) já restringia as quatro ações de situação a ADMIN e COMMERCIAL
  (`CUSTOMER_STATUS_CHANGE_ROLES`), com 403 antes do corpo e da existência.

## 4. Estado atual (antes da implementação)

- `POST /customers` e `PATCH /customers/:id` só exigiam sessão (`requireCurrentUser`): os seis perfis — VIEWER
  inclusive — criavam e editavam o cadastro inteiro, CNPJ, razão social, perfil tributário e `businessLotSuffix`
  incluídos.
- A tela oferecia "+ Novo cliente" e "Editar" a todo perfil: na lista de Clientes, na página
  `/cadastros/clientes/novo` e no cadastro contextual do Pedido, do recebimento de material do cliente, do Projeto e do
  Produto (página e modal).
- O PATCH já ignorava `code`, `externalCode`, `active`, `blocked`, `status` e autoria.
- Histórico do cadastro: só `createdBy*`, `updatedBy*` e `updatedAt`. Não existe trilha de antes/depois dos campos.
- `User.role` nasce VIEWER.

## 5. Evidências

- Rotas: `apps/api/src/modules/customers/customers.routes.ts` (POST e PATCH com `requireCurrentUser`).
- Service: `apps/api/src/modules/customers/customers.service.ts` (`updateCustomer` confere a existência antes de gravar).
- Sonda em runtime (2026-09-16, banco `veridi_dev_test`, config de Vitest temporária fora do repositório): os seis
  perfis receberam 201 no POST e 200 no PATCH com CNPJ, razão social, perfil tributário e `businessLotSuffix`.
- Contrato: `packages/shared/src/customers.ts` — `UpdateCustomerInput` sem `zipCode`, `street`, `number`,
  `complement` e `district`, que a tela sempre enviou e a API sempre aceitou (`customers.schemas.ts`).
- Comentário: `apps/web/src/pages/customers/customer-form.tsx` dizia que o servidor recusa nome duplicado. Não recusa:
  a única unicidade do cadastro é o CNPJ, quando informado.
- Superfícies de "+ Novo cliente": `CustomersPage.tsx`, `CustomerCreatePage.tsx`, `CustomerOrderPage.tsx`,
  `ReceiveCustomerMaterialPage.tsx`, `ProjectFormModal.tsx`, `product-form.tsx` (hospedado por `ProductCreatePage.tsx`
  e `ProductFormModal.tsx`).

## 6. Findings

- **F1 (P1):** qualquer sessão cria e edita Cliente, inclusive VIEWER — provado em runtime.
- **F2:** a tela oferece criação e edição a quem, depois da decisão, receberia 403.
- **F3:** `UpdateCustomerInput` não declara o endereço estruturado que trafega de fato.
- **F4:** comentário incorreto sobre nome duplicado em `customer-form.tsx`.
- **F5:** não há histórico de antes/depois das mudanças estruturais (CNPJ, razão social, perfil tributário).
- **F6:** Pedido, Expedição, Recebimento e Faturamento também só exigem sessão — já registrado no discovery da
  Produção; fora desta pergunta.

## 7. Gaps

- Gate de perfil em POST e PATCH, na ordem do CUSTOMER-STATUS-HARDENING-01 (perfil antes do corpo e da existência).
- Modo consulta na tela para quem não edita, sem quebrar o `EntityLink` de Cliente das outras telas.
- Criação contextual condicionada ao perfil, sem bloquear a escolha de Cliente existente.

## 8. Riscos

- Esconder só o botão deixaria a API aberta — a autoridade tem de ser a rota.
- 404 antes do 403 permitiria inferir a existência do registro.
- Tirar "+ Novo cliente" sem dizer a quem pedir cria beco sem saída em Pedido, Recebimento, Projeto e Produto.
- Unificar a lista do cadastro com a da situação impediria as duas de divergirem no futuro.

## 9. Alternativas consideradas

- **A** — ADMIN e COMMERCIAL criam e editam tudo; os demais consultam. Recomendada.
- **B** — identificação fiscal (razão social, CNPJ, perfil tributário, sufixo de lote) só ADMIN depois de criada; o
  resto ADMIN e COMMERCIAL.
- **C** — só VIEWER perde a escrita.

Nenhuma exige migration; uma trilha de antes/depois exigiria.

## 10. Recomendação

Opção A, com a lista própria `CUSTOMER_EDIT_ROLES`, separada de `CUSTOMER_STATUS_CHANGE_ROLES`.

## 11. Decisões PO

- **D1 — decidida em 2026-09-16:** opção A. ADMIN e COMMERCIAL criam e editam; PRODUCTION, QUALITY, PURCHASING e
  VIEWER consultam. Gate para o cadastro inteiro, sem permissão campo a campo.
- **D2 — decidida:** `businessLotSuffix` fica sob o mesmo gate e continua sem campo na tela.
- **D3 — decidida:** sem histórico de antes/depois nesta capability; registrado CUSTOMER-MASTER-DATA-AUDIT-01 (P2,
  futuro).
- **D4 — decidida:** consulta automática de CNPJ fica registrada como CUSTOMER-CNPJ-AUTOFILL-01 (P1), provedor Serpro —
  Consulta CNPJ Básica, e NÃO INICIA SEM APROVAÇÃO EXPLÍCITA DA VERIDI.
  **Atualização de 2026-09-17:** aprovada pela Veridi e entregue como CUSTOMER-CNPJ-LOOKUP-01 — assistência ao
  preenchimento (nunca atualização automática), com **OpenCNPJ** como primeiro provedor e **Serpro como provedor
  futuro**. Regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §111.

## 12. Pendências PO

Nenhuma para esta capability. CUSTOMER-CNPJ-AUTOFILL-01 aguardava a Veridi e foi reconciliado em 2026-09-17 por
CUSTOMER-CNPJ-LOOKUP-01 (§111); segue sem decisão apenas ligar o SERPRO.

## 13. Escopo recomendado

Gate em POST e PATCH; constante compartilhada; modo consulta no mesmo modal; "+ Novo cliente" condicionado ao perfil em
todas as superfícies, com a ajuda "Solicite ao Comercial ou Administrador o cadastro do cliente." no beco sem saída;
correção do contrato compartilhado e do comentário.

## 14. Fora do escopo

Histórico de antes/depois; permissão por campo; consulta de CNPJ; permissões de Pedido, Expedição, Recebimento e
Faturamento; dados existentes (nada alterado).

## 15. Próxima capability

CUSTOMER-EDIT-PERMISSIONS-01 (entregue). Depois, sem posição: CUSTOMER-MASTER-DATA-AUDIT-01. A consulta de CNPJ saiu
desta fila em 2026-09-17, entregue como CUSTOMER-CNPJ-LOOKUP-01 (§111).

## 16. Implementação

**IMPLEMENTADO** em 2026-09-16 por CUSTOMER-EDIT-PERMISSIONS-01 (merge na `main`, fora de PROD). Regra em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §98; estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md); proteção em
[`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md). Sem migration.

## 17. Histórico de decisões

- 2026-09-16 — discovery entregue no chat (sem documento, por restrição do handoff); opções A/B/C.
- 2026-09-16 — PO decide a opção A (D1–D4); implementação e este registro na mesma rodada.
