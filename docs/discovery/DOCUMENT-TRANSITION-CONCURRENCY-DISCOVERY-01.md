# DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01 — transições de documento sob concorrência

## 1. Status

`DECIDIDO` — os quatro riscos P0 foram entregues em 2026-09-19 por DOCUMENT-TRANSITION-CONCURRENCY-01 **Fatia 1**
(seção 16), na `main` e fora de PROD. Os P1 continuam abertos para as fatias seguintes (seções 12 e 15).

Discovery READ ONLY de 2026-09-19 sobre `main` `f7ebb771`, entregue só no chat (o handoff da rodada proibia docs) e
persistido aqui na implementação. O texto do chat não ficou em transcrição recuperável: este documento parte do resumo
registrado na sessão do discovery e foi **reconferido linha a linha no código de `f7ebb771`**; os quatro P0 foram
reproduzidos por teste antes da correção (seção 5, "Reprodução"). As linhas citadas são as de `f7ebb771`.

## 2. Objetivo

Descobrir onde duas operações simultâneas sobre o mesmo documento (Expedição, OP, OC, Pedido, Faturamento, Lote) podem
deixar o **status documental divergente da realidade física** — documento cancelado com saída de estoque, consumo ou
recebimento; movimento de estoque apagado de um documento confirmado; reserva presa a documento que já não a usa.

## 3. PO baseline

- Transições com efeito físico são transacionais e revalidam o estado dentro da transação (CLAUDE.md, "Important
  multi-record operations must be transactional"; ledger imutável, correção por estorno).
- Decisão vigente de MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01: **FKs mantidas, segurança na aplicação** — trava,
  releitura e recontagem, sem trocar ação referencial do banco.
- Precedentes de reparo no repositório: Inventário (`travarSessao` + `exigirStatus` + `traduzirConflito`), Recebimento,
  `updateProductionOrder`, Picking e o estorno de Consumo Interno (P2034/P2028 → 409).

## 4. Estado atual

Prisma 6.19 sem nível de isolamento configurado = READ COMMITTED. As transições "de ida" travam a raiz com
`SELECT … FOR UPDATE` e releem o estado sob a trava: confirmar Expedição, receber OC, liberar, consumir e pesar OP, emitir
Faturamento, aplicar Plano e reservar. Os **cancelamentos** de Expedição, OC, Pedido, OP e Faturamento — e as **edições**
de Expedição (PATCH da separação e conferência de lote), OC, Pedido e Faturamento — liam sem trava e gravavam
`update({ where: { id } })`.

Em READ COMMITTED esse UPDATE não falha: ele **espera** a trava da transição concorrente e, depois do commit dela, grava
por cima — o status que a transição acabou de escrever é sobrescrito, e o efeito físico dela fica.

## 5. Evidências

Travas de ida (em `f7ebb771`):

- Expedição: `confirmShipment` trava `shipments` (`shipments.service.ts:763`), depois `customer_orders` (l.771), `items`
  (l.796) e `lots` (l.799); grava um `SHIPMENT_OUT` por linha (l.925-937) e o status CONFIRMED (l.940-948).
- OP: consumo e pesagem travam `production_orders` (`picking.service.ts:42-55`; `recipe.service.ts:243-250`); o primeiro
  consumo grava EM PRODUÇÃO (`picking.service.ts:491-495`). Liberar trava a OP (`production-orders.service.ts:1345`).
- OC: o recebimento trava `purchase_orders` e relê o status (`receiving.service.ts:232-238`).

Leituras sem trava (em `f7ebb771`):

- `cancelShipment` (`shipments.service.ts:993`), `updateShipment` (l.529; `deleteMany` das linhas em l.592) e
  `verifyShipmentLine` (l.679; grava a linha em l.740).
- `cancelProductionOrder` (`production-orders.service.ts:1579`; libera a reserva em l.1597 antes do UPDATE da OP).
- `cancelPurchaseOrder` (`purchase-orders.service.ts:495`).
- FK `inventory_movements.shipmentLineId` com `ON DELETE CASCADE` (`schema.prisma:3367-3368`): apagar a linha da
  Expedição apaga o `SHIPMENT_OUT` dela. A tela da Expedição chama o PATCH antes de conferir e antes de confirmar.
- `app.ts` não mapeia P2034/P2028: fora de Inventário e Consumo Interno, conflito de concorrência virava 500.

**Reprodução (DOCUMENT-TRANSITION-CONCURRENCY-01, antes da correção).** Cada teste segura, numa transação do próprio
teste, uma trava que a primeira operação toma depois da raiz e prova por `pg_blocking_pids` quem parou em quem:

| Risco | Resultado no código de `f7ebb771` |
|---|---|
| R-S1 | Expedição **CANCELLED com 1 SHIPMENT_OUT** — confirmação 200, cancelamento 200 |
| R-S2 (edição lê antes, apaga depois) | Expedição CONFIRMED com **0 SHIPMENT_OUT** — o CASCADE apagou a saída; o saldo físico voltou |
| R-S2 (confirmação primeiro) | deadlock entre a edição e a confirmação; a vítima respondia 500 |
| R-S2 (conferência) | conferência 200 regravando `verifiedAt` durante a confirmação |
| R-O1 (consumo e pesagem) | OP **CANCELLED com consumo real** e reserva liberada |
| R-P1 | OC **CANCELLED com Receipt e RECEIPT_IN** |

## 6. Findings

- **F1.** Toda transição "de volta" (cancelar) e toda edição de documento com efeito físico decidia sobre um retrato
  lido antes de qualquer trava.
- **F2.** A espera acontecia só no UPDATE final — tarde demais: a decisão já tinha sido tomada sobre o estado antigo.
- **F3.** Na Expedição, o PATCH reescreve as linhas (DELETE + INSERT). Depois de CONFIRMED, esse DELETE leva o
  `SHIPMENT_OUT` pelo CASCADE — é o pior caso: a saída física some do ledger sem estorno.
- **F4.** Nenhum teste existente corria cancelar ou editar contra a transição concorrente; os testes de concorrência do
  repositório cobriam só ida × ida (duas confirmações, dois recebimentos).
- **F5.** O cancelamento da OP libera a reserva antes do UPDATE da OP — com a corrida, a reserva ficava RELEASED numa OP
  que consumiu.

## 7. Gaps

- Cancelar e editar sem trava da raiz (Expedição, OC, Pedido, OP, Faturamento; edição de Lote).
- Conflito de concorrência (deadlock, trava além do prazo da transação) sem tradução para 409 fora de Inventário e CI.

## 8. Riscos

| ID | Prioridade | Corrida | Efeito |
|---|---|---|---|
| R-S1 | P0 | Expedição confirmar × cancelar | CANCELLED com `SHIPMENT_OUT` |
| R-S2 | P0 | Expedição PATCH ou conferência × confirmar | CASCADE apaga o `SHIPMENT_OUT` já gravado; conferência regravada em Expedição confirmada |
| R-O1 | P0 | OP consumo ou pesagem × cancelar | CANCELLED com consumo real, reserva liberada |
| R-P1 | P0 | OC receber × cancelar | CANCELLED com Receipt e `RECEIPT_IN` |
| — | P1 | OP liberar × cancelar | reserva ACTIVE presa a OP cancelada (o Reservado não olha o status do pai; sem caminho na UI) |
| — | P1 | Pedido aplicar plano ou reservar × cancelar | reserva ACTIVE presa a Pedido cancelado |
| — | P1 | Faturamento emitir × cancelar; editar × emitir | status do Faturamento divergente do documento emitido |
| — | P1 | OC e Pedido confirmar × cancelar | o cancelado "ressuscita" como confirmado |
| — | P1 | Lote liberar × bloquear | o bloqueio se perde |

## 9. Alternativas consideradas

- **Trava da raiz + releitura na transação (escolhida).** É o padrão que o repositório já usa nas transições de ida.
- Isolamento SERIALIZABLE ou REPEATABLE READ: troca a espera por erro de serialização e exige retry — rejeitado; a espera
  com releitura dá a resposta de regra de negócio certa ("já confirmada") sem retry.
- Trocar o `ON DELETE CASCADE` do movimento por `RESTRICT`: rejeitado nesta fase (decisão vigente "FKs mantidas,
  segurança na aplicação"; mudaria o schema e a migração da base).

## 10. Recomendação

Toda transição e toda edição que dependem do status do documento: dentro da transação, **travar a raiz, reler, validar
sobre o estado travado, fazer os efeitos derivados, gravar o status, commit**. Conflito de concorrência nos fluxos
tocados vira 409 `concurrent_write`, sem retry automático. Ordem de reparo: Expedição → OP → OC → Pedido → Faturamento →
Lote.

## 11. Decisões PO

Handoff DOCUMENT-TRANSITION-CONCURRENCY-01 (2026-09-19): Fatia 1 só com os quatro P0; sem migration; sem mudar FK nem
CASCADE; sem retry automático; P2034/P2028 ou conflito equivalente → 409; testes determinísticos, sem sleep como prova.

## 12. Pendências PO

Os P1 da seção 8 — uma fatia por vez, na ordem da recomendação. Encerrar OP sem produção e encerrar saldo de OC são de
outra capability (exceções), não desta.

## 13. Escopo recomendado

Fatia 1: R-S1, R-S2, R-O1 e R-P1, com tradução do conflito nos fluxos tocados.

## 14. Fora do escopo

Pedido, Faturamento, Lote, confirmar × cancelar de OC, edição de OC, permissões e autoria do cancelamento, "Encerrar OP
sem produção", "Encerrar saldo restante".

## 15. Próxima capability

DOCUMENT-TRANSITION-CONCURRENCY-01 Fatia 2 (P1): Pedido (plano/reserva × cancelar, confirmar × cancelar), Faturamento
(emitir × cancelar, editar × emitir), OC confirmar × cancelar e Lote liberar × bloquear.

## 16. Implementação

**Fatia 1 — IMPLEMENTADA em 2026-09-19** (DOCUMENT-TRANSITION-CONCURRENCY-01, sem migration, fora de PROD):

- Expedição: `travarExpedicao` (trava `shipments` e relê) em `cancelShipment`, `updateShipment` e
  `verifyShipmentLine` — a mesma trava que `confirmShipment` já tomava. O DELETE das linhas só roda com o rascunho
  travado; CASCADE e FK intocados.
- OP: `cancelProductionOrder` trava `production_orders`, relê e decide; a liberação da reserva de uma OP LIBERADA
  continua na mesma transação, depois da trava.
- OC: `cancelPurchaseOrder` trava `purchase_orders`, relê e decide.
- Conflito: `lib/conflito-de-concorrencia.ts` reconhece P2034, P2028 e o deadlock que o Prisma 6.19 entrega sem código
  (`PrismaClientUnknownRequestError` com `40P01`); Expedição, cancelamento de OP e cancelamento de OC respondem 409
  `concurrent_write`, nada gravado.
- Testes: `shipments-concorrencia.test.ts`, `cancelar-op-concorrencia.test.ts`, `cancelar-oc-concorrencia.test.ts` (as
  corridas da seção 5 e a ordem inversa, cancelamento primeiro) e `conflito-de-concorrencia.test.ts`; suporte em
  `test-support/corrida-sob-trava.ts`.
- Efeito colateral sem código a mais: com o cancelamento da OP travado, OP liberar × cancelar (P1) passa a serializar e
  libera a reserva criada pela liberação. Não há teste dedicado; o item fica aberto até a Fatia 2 prová-lo.

## 17. Histórico de decisões

- 2026-09-19 — discovery entregue no chat (READ ONLY, `f7ebb771`).
- 2026-09-19 — PO abre a Fatia 1 só com os P0, sem migration; documento persistido na implementação.
