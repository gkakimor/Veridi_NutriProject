# OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01 — passagem de bastão no Painel: a próxima ação de quem recebe

## 1. Status

`DECIDIDO` — o PO respondeu P2–P6 em 2026-09-19 (seção 11); P1 (preferir o lote da própria OP) ficou pendente e
opcional, como FINISHED-GOODS-OWN-LOT-PREFERENCE-01. `READY_TO_IMPLEMENT = YES`, **sem migration**. Achado F-1 é
defeito, não decisão, e vem antes das atenções. Nada implementado (seção 16).

Discovery READ ONLY de 2026-09-19 sobre `main` `f7ebb771`, entregue só no chat (o handoff proibia docs). Persistido no
mesmo dia por PRODUCT-BACKLOG-CONSOLIDATION-01. **O relatório completo não está acessível**: a sessão do discovery não
existe mais e o texto não ficou em arquivo. Este documento parte da nota registrada no fim da sessão (resumo) e não foi
reconferido no código; as linhas marcadas com "~" são aproximadas, como na nota. Faltam, e não foram reconstruídos: o
inventário completo das atenções atuais do Painel, o texto de cada atenção proposta, os cenários adversariais e o plano
de testes. A implementação refaz essa leitura na `main` atual.

## 2. Objetivo

Encontrar onde o trabalho "muda de mão" — uma etapa termina e outra pessoa precisa agir — e o Painel não avisa quem
recebe; propor as atenções que fecham esses buracos, sem o Painel executar nada.

## 3. PO baseline

- Top 8 da revisão funcional (VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, 2026-09-19, só no chat): "chegou o que
  você esperava" — PA pronto → reserva dirigida; lote liberado → OP pronta — e "Painel com atrasos".
- O Painel orienta; o módulo operacional executa (reafirmado pelo PO na decisão, seção 11).

## 4. Estado atual (em `f7ebb771`, pela nota)

- **Buraco central:** entre concluir a OP e reservar o PA, o Pedido some do Painel. `ORDER_AWAITING_PRODUCTION` sai na
  conclusão da OP; `ORDER_AWAITING_SHIPMENT` só nasce com reserva. A ajuda do Pedido manda "volte e use Reservar
  disponível".
- Atraso de entrega (`situacaoDaEntrega`) só aparece no Painel Gerencial.
- `PRAZO_DO_CLIENTE` compara um instante com o marcador do dia; o quadro nem recebe a promessa; o prazo do Pedido trava
  depois do Plano, e a promessa passa a ser a entrega programada.
- O FEFO da reserva de PA ignora o dono do lote (qual OP o produziu).
- Expedição → Faturamento já é resolvido pelas atenções existentes.

## 5. Evidências

- `produzidoEmEspera` em `customer-orders.service.ts` (~489), repetido em `fulfillment-plan.service.ts` (~544).
- `ShipmentLine.customerOrderReservationLineId` é obrigatório; `Lot.productionOrderId` liga o lote de PA à OP.
- Atenções citadas: `ORDER_AWAITING_PRODUCTION`, `ORDER_AWAITING_SHIPMENT`, `LOT_AWAITING_QUALITY`,
  `PRAZO_DO_CLIENTE`.

## 6. Findings

**F-1 — defeito: "falta produzir" em dobro no Plano misto.** `produzidoEmEspera = produzido − expedido − reservado
restante` desconta do produzido também o que veio do ESTOQUE. Plano padrão misto (reserva 60 + OP 40): a OP aponta 40 →
`pendingProductionQuantity` = 40, a tela oferece "Gerar OP para saldo restante" e a rota aceita → produção em dobro, até
alguém reservar os 40. Os testes só cobrem reserva 0/produção 100 ou OP cancelada.

Os demais achados são os buracos da seção 4.

## 7. Gaps

- Nenhuma atenção entre "OP concluída" e "PA reservado" (o Pedido some do Painel).
- Nenhuma atenção de OP pronta para liberar, de Pedido confirmado sem Plano, de saldo sem produção nem de entrega
  atrasada no Painel operacional.

## 8. Riscos

- F-1 gera produção em dobro com a tela e a rota de acordo — o dano é físico (MP consumida, PA sem pedido).
- A atenção "saldo sem produção" (A4) calculada sobre a conta atual herdaria o F-1: por isso F-1 vem antes.

## 9. Alternativas consideradas

A nota não registrou as alternativas descartadas.

## 10. Recomendação

**Correção do F-1:** atribuir a produção por lote (`Lot.productionOrderId` das OPs da linha; a Expedição sempre aponta
a linha de reserva) e uma função única para o DTO do Pedido e para a OP do saldo.

**Top 8 de atenções proposto:**

- **A1 — PA pronto para reservar:** min(falta reservar, produzido em espera corrigido, disponível).
- **A2 — OP pronta para liberar:** predicado puro extraído da liberação.
- **A3 — Pedido sem Plano** (CONFIRMED).
- **A4 — saldo sem produção** (depende do F-1).
- **A5 — entrega atrasada** (`situacaoDaEntrega`, hoje só no Painel Gerencial).
- **A6 — OP termina depois da promessa.**
- Enriquecer `LOT_AWAITING_QUALITY` ("cobre falta da OP", "PA do PED").
- Enriquecer `ORDER_AWAITING_PRODUCTION` / OP com falta.

**Fatias:** F0 (F-1) → F1 Pedido → F2 OP → F3 atrasos; F4 opcional, preferir o lote da OP.

## 11. Decisões PO

Respondidas em 2026-09-19 (handoff PRODUCT-BACKLOG-CONSOLIDATION-01), com as palavras do PO:

- **P2 — A2 sempre × só numa janela:** OP pronta para liberar aparece **sempre, como INFO**, ordenada pela
  programação.
- **P3 — comparação de prazo (mesmo dia = risco?):** usar **DIA CIVIL**, não instante arbitrário.
- **P4 — prazo do Pedido como entrega implícita:** Pedido sem entrega ativa usa `requestedDeliveryDate` como promessa
  implícita.
- **P5 — Painel por área:** pode agrupar por área operacional, **sem esconder informação por perfil** nesta fase.
- **P6 — suprimir o redundante:** quando existir "PA pronto para reservar" ou "saldo sem produção", suprimir o
  "aguardando produção" redundante.
- **Princípios:** o Painel orienta e o módulo operacional executa. Nunca reservar, liberar OP, gerar OP, faturar ou
  reprogramar automaticamente.

## 12. Pendências PO

- **P1 — preferir o lote produzido para a própria linha do Pedido** (FINISHED-GOODS-OWN-LOT-PREFERENCE-01): altera a
  política de alocação (hoje FEFO sem olhar o dono do lote). **Pendente e opcional; não decidido.**

## 13. Escopo recomendado

| Fatia | Capability | Conteúdo (pelo assunto de cada fatia) |
|---|---|---|
| F0 | PENDING-PRODUCTION-LOT-ATTRIBUTION-01 | F-1: produção atribuída por lote, função única para DTO e OP do saldo; reproduzir com teste vermelho antes |
| F1 | DASHBOARD-ORDER-NEXT-ACTION-01 | Pedido: A1, A3, A4 (depois de F0) e a supressão de P6 |
| F2 | DASHBOARD-OP-READY-TO-RELEASE-01 | OP: A2, sempre INFO, pela programação |
| F3 | DASHBOARD-DELIVERY-DELAYS-01 | Atrasos: A5 e A6, por dia civil, com `requestedDeliveryDate` como promessa implícita |
| F4 | FINISHED-GOODS-OWN-LOT-PREFERENCE-01 | Opcional, pendente de P1 |

Os dois enriquecimentos (`LOT_AWAITING_QUALITY` e `ORDER_AWAITING_PRODUCTION`) se distribuem no handoff.

## 14. Fora do escopo

- Qualquer ação automática a partir do Painel (seção 11).
- Esconder atenção por perfil nesta fase.
- Atrasos de proposta e de recebimento sem custo, que a revisão funcional também citava no "Painel com atrasos": não
  estão no desenho deste discovery.

## 15. Próxima capability

PENDING-PRODUCTION-LOT-ATTRIBUTION-01 (P0/P1 na fila viva de [`BACKLOG.md`](../BACKLOG.md)); as atenções F1–F3 vêm
depois, como P1/P2. Vizinho na mesma conta: L4 de [CLOSE-WITH-REASON-DISCOVERY-01](CLOSE-WITH-REASON-DISCOVERY-01.md)
("produzido em espera" conta PA de lote bloqueado ou perdido). Concorrência reservar × cancelar Pedido é P1 de
[DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01](DOCUMENT-TRANSITION-CONCURRENCY-DISCOVERY-01.md).

## 16. Implementação

**NÃO IMPLEMENTADO.**

## 17. Histórico de decisões

- 2026-09-19 — discovery entregue no chat (READ ONLY, `f7ebb771`), `READY = YES`, sem migration; decisões P1–P6
  abertas.
- 2026-09-19 — PO decide P2–P6 e os princípios; P1 fica pendente e opcional. Persistido da nota da sessão por
  PRODUCT-BACKLOG-CONSOLIDATION-01.
