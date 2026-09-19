# AUTHORIZATION-AUTHORSHIP-DISCOVERY-01 — quem pode escrever e quem fica registrado como autor

## 1. Status

`DECIDIDO` — dez decisões do PO em 2026-09-19 (seção 11). Implementação em duas capabilities, conceitos separados que
podem ir na mesma rodada se for simples e seguro: **AUTHZ-VIEWER-READONLY-01** (P0, perfis) e
**AUTHORSHIP-SESSION-ACTOR-01** (P1, autoria). Nada implementado (seção 16).

**O relatório deste discovery não está acessível.** Não há arquivo, nota de memória nem transcrição recuperável; o ID e
as decisões chegaram no handoff do PO de 2026-09-19 (PRODUCT-BACKLOG-CONSOLIDATION-01), que o persistiu. Este documento
registra só:

- as decisões do PO, com as palavras dele (seção 11);
- o que já estava provado em documentos e relatórios anteriores (seções 4 e 5), cada fato com a origem e a base.

**Não foram reconstruídos**, e a implementação precisa refazer na `main` atual antes de codificar: a base (SHA) do
discovery, o inventário de rotas e de autores com arquivo e linha, a matriz por rota, as perguntas como foram feitas,
as recomendações e o veredito `READY_TO_IMPLEMENT`.

## 2. Objetivo

Fechar a escrita de quem só consulta (VIEWER), dizer quais perfis escrevem em cada ato já decidido, e fazer a autoria
nova vir do usuário real da sessão — não de "Ambiente local".

## 3. PO baseline

Decisões de perfil já em vigor antes deste discovery:

- Cliente: ADMIN e COMMERCIAL criam e editam (§98, `CUSTOMER_EDIT_ROLES`).
- Item, Fornecedor e Produto: listas por ato no shared (§100); `exigirPerfil` + `responderSemPermissao` em
  `apps/api/src/lib/current-user.ts`, 403 antes do corpo e da existência.
- Custo efetivo de aquisição: PURCHASING e ADMIN, com `costUpdatedBy` do usuário da sessão (§105).
- Porta direta da OP (criar, editar, aplicar roteiro, planejar, liberar, cancelar): PRODUCTION e ADMIN
  (PRODUCTION-ROUTE-ASSIGNMENT-01).
- Estorno do consumo interno: ADMIN e QUALITY (§126). Exclusão física de cadastro mestre: só ADMIN (§125). Nunca zero
  ADMIN ativo (§120).

## 4. Estado atual — o que os documentos já provavam

- **Execução da OP aberta a qualquer sessão** — 10 mutações só com `requireCurrentUser` (picking, consumo, pesagem,
  parte, apontamento, variância, conclusão): VIEWER baixa estoque, cria lote de PA e conclui OP (I1 de
  [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md), base `9c60845`;
  reafirmado em `f7ebb771` por [CLOSE-WITH-REASON-DISCOVERY-01](CLOSE-WITH-REASON-DISCOVERY-01.md), seção 4).
- **Cancelar OP grava "Ambiente local"** em `cancelledBy` e `reservation.releasedBy`, embora a rota exija
  ADMIN/PRODUCTION (I3, mesmo discovery).
- **Plano de Atendimento, OP do saldo, reservar e realocar PA abertos a qualquer sessão**; reservar e realocar gravam
  "Ambiente local" (I4, mesmo discovery; CLOSE-WITH-REASON-DISCOVERY-01, seção 4, em `f7ebb771`).
- **Formulação sem gate de perfil** e criar, ativar e inativar versão com `SYSTEM_ACTOR`; o mesmo `SYSTEM_ACTOR` ao
  confirmar e cancelar Pedido e na OC (I11, mesmo discovery).
- **Rotas de OC sem gate de perfil** (`purchase-orders.routes.ts:97-151`), confirmar e cancelar OC com "Ambiente local";
  **rotas de Pedido sem gate** (CLOSE-WITH-REASON-DISCOVERY-01, seção 4, em `f7ebb771`).
- Revisão funcional (VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, `ef7ca1c9`, só no chat, pela nota da sessão):
  "Ambiente local" em Pedido, OC e Formulação; rotas de Formulação, Pedido, OC, Expedição e Recebimento sem gate de
  perfil — VIEWER confirma OC.

## 5. Evidências

As da seção 4, nas bases citadas. Armadilhas de implementação já documentadas em
[PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md):

- **I5** — rotas que validam o corpo antes do perfil devolvem 400 a quem devia receber 403.
- **I6** — `picking.routes.ts`, `production.routes.ts` e `recipe.routes.ts` não mapeiam `ForbiddenError`: um
  `requireRole` novo sem esse tratamento responde **500**.
- **I7** — services de execução aceitam `actor?` e caem em `SYSTEM_ACTOR` se ele faltar.
- Testes de autoria com `not.toBeNull()` passam com "Ambiente local": o teste precisa comparar o nome exato.

## 6. Findings

Os da seção 4. O relatório do discovery pode ter tido outros; não ficaram registrados.

## 7. Gaps

- Não há lista única de "quem escreve" para Pedido, entregas, OC, rascunho de OC pelo Pedido, Plano, OP do saldo,
  reserva de PA, preço de faturamento, Formulação, Recebimento, Expedição e execução da OP.
- Não há regra de que VIEWER nunca escreve.
- A autoria de vários atos não vem da sessão.

## 8. Riscos

- Endurecer perfil quebra quem usa hoje uma conta de outro perfil para operar (P6 de
  PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01): conferir os papéis dos usuários reais de PROD antes de publicar.
- 500 no lugar de 403 nas rotas de execução (I6).
- Autor "Ambiente local" gravado em silêncio por chamador sem ator (I7).

## 9. Alternativas consideradas

Não registradas (seção 1).

## 10. Recomendação

As decisões da seção 11, aplicadas em duas capabilities:

- **AUTHZ-VIEWER-READONLY-01** — decisões 1 a 7 e 10: nenhuma mutação aceita VIEWER; as listas decididas por ato, com
  ADMIN explícito; onde a Veridi ainda não definiu o perfil final, o provisório "todos menos VIEWER".
- **AUTHORSHIP-SESSION-ACTOR-01** — decisões 8 e 9: autoria nova com o usuário real da sessão e ator obrigatório no
  service dos módulos tocados.

## 11. Decisões PO

Decididas em 2026-09-19 (handoff PRODUCT-BACKLOG-CONSOLIDATION-01), com as palavras do PO:

1. VIEWER é somente leitura operacional.
2. ADMIN aparece explicitamente em todas as listas.
3. Pedido + entregas: ADMIN + COMMERCIAL.
4. OC: ADMIN + PURCHASING.
5. Rascunho de OC pelo Pedido: ADMIN + PURCHASING + COMMERCIAL.
6. Plano de Atendimento, OP do saldo, reservar e realocar PA: ADMIN + COMMERCIAL.
7. Preço de faturamento: ADMIN + COMMERCIAL.
8. Autoria histórica nova usa o usuário real da sessão. Sem backfill dos registros antigos "Ambiente local".
9. Nos módulos tocados, ator obrigatório no service.
10. Onde a Veridi ainda não definiu o perfil final: usar provisoriamente TODOS MENOS VIEWER. Depois estreitar.

Áreas sem perfil final registradas nesta consolidação — "políticas definitivas" que dependem da Veridi: Formulação,
Recebimento, chão de fábrica (execução da OP), Expedição e Faturamento (fora o preço, decisão 7). Decisão explícita
mais estreita vale sobre o provisório da decisão 10: encerrar OP sem produção fica em ADMIN + PRODUCTION provisório (P5
de [CLOSE-WITH-REASON-DISCOVERY-01](CLOSE-WITH-REASON-DISCOVERY-01.md)).

**Efeito sobre [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md):** P3
(OP do Pedido e reserva de PA) respondida pela decisão 6; P4 (cancelamentos antigos com "Ambiente local") respondida
pela decisão 8 — ficam como estão; P8 (Formulação sem gate e com `SYSTEM_ACTOR`) absorvida pelas duas capabilities; o
VIEWER de I1 e a autoria de I3 e I7 saem para AUTHZ-VIEWER-READONLY-01 e AUTHORSHIP-SESSION-ACTOR-01. Seguem abertas lá:
P1 e P6 (perfil final de quem executa a OP, com a Veridi), P2 (variância), P5 (botões de estoque que já dão 403) e P7
(autoria em texto × `userId`). Até o perfil final, a execução da OP e a variância caem no provisório da decisão 10.

## 12. Pendências PO

- Perfil final das áreas listadas na seção 11 (Veridi) — até lá, o provisório.
- P1, P2, P5, P6 e P7 de PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.

## 13. Escopo recomendado

- **AUTHZ-VIEWER-READONLY-01 (P0):** gate de perfil antes do corpo em toda mutação das áreas da seção 7, com as listas
  do shared (ADMIN explícito) e a tela escondendo a ação de quem não pode; `ForbiddenError` mapeado para 403 onde faltar
  (I6).
- **AUTHORSHIP-SESSION-ACTOR-01 (P1):** ator da sessão nos atos que gravam "Ambiente local", ator obrigatório no
  service dos módulos tocados, testes comparando o nome exato; sem backfill.

## 14. Fora do escopo

- Backfill de autoria antiga (decisão 8).
- Perfil definitivo das áreas que dependem da Veridi (decisão 10).
- Esconder leitura ou menu por perfil.

## 15. Próxima capability

AUTHZ-VIEWER-READONLY-01, primeira da fila viva de [`BACKLOG.md`](../BACKLOG.md); AUTHORSHIP-SESSION-ACTOR-01 logo
depois, ou na mesma rodada.

## 16. Implementação

**NÃO IMPLEMENTADO.**

## 17. Histórico de decisões

- 2026-09-19 — PO decide 1–10 e abre AUTHZ-VIEWER-READONLY-01 (P0) e AUTHORSHIP-SESSION-ACTOR-01 (P1). Documento criado
  por PRODUCT-BACKLOG-CONSOLIDATION-01 só com as decisões e os fatos já documentados; o relatório do discovery não
  estava acessível.
