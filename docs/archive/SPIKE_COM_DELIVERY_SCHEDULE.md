# Spike — quantidade contratada e entregas programadas (COM-04, 2026-09-09)

Investigação de domínio que precede o COM-04. Fica aqui o que foi ENCONTRADO no
código e as OPÇÕES levadas ao PO. Nenhuma regra durável nasce deste documento:
ela vai para [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) quando o PO decidir.

Base: `main == origin/main == 3424c9c`. Zero runtime, zero schema, zero migration.

O cenário: cliente fecha **3.000 un**, recebe **1.000 em outubro, 1.000 em
novembro, 1.000 em dezembro**. Um Orçamento, um Pedido, um preço — três
atendimentos físicos. Não é pedido recorrente: não há scheduler, assinatura nem
geração automática.

## O que o modelo atual JÁ faz

| Capacidade | Onde | Estado |
|---|---|---|
| N Expedições CONFIRMED por Pedido | `shipments_one_draft_per_customer_order` (índice parcial, só DRAFT é exclusiva) | funciona |
| Expedição parcial com saldo | `getShippedByOrderLines` + `outstandingQuantity` | funciona |
| Status derivado do físico | `shipments.service.ts` — `SHIPPED` vs `PARTIALLY_SHIPPED`, sem botão manual | funciona |
| Reserva incremental | `reserveAvailable` (Reserva complementar), teto = saldo a expedir | funciona |
| N Ordens de Produção por linha | `createRemainderOrder`, quantidade livre até o pendente | funciona |
| Billing por Expedição | `billings_one_active_per_shipment` — N Billings por Pedido | funciona |
| Preço do Billing = acordo | `createBilling` lê `CustomerOrderLine.agreedUnitPrice`, nunca a PREC vigente | funciona |
| Quantidade do Billing = expedido | cópia fiel da `ShipmentLine`, nunca recalculada do Pedido | funciona |
| Posição por linha | `orderedQuantity`, `shippedQuantity`, `outstandingQuantity`, `billedQuantity`, `unbilledShippedQuantity`, `pendingProductionQuantity` | funciona |

**O ciclo `3 × 1.000` já roda hoje, na unha.** Confirma 3.000, aplica o Plano,
edita a separação para 1.000, confirma, fatura; reserva complementar quando a
produção sai; repete. O que NÃO existe é dizer, antes de expedir, que as três
entregas são 15/10, 15/11 e 15/12.

## O que NÃO existe

- **Nenhum conceito de cronograma de entrega.** Varredura no schema: só
  `CustomerOrder.requestedDeliveryDate` (uma data, no cabeçalho),
  `PurchaseOrder.expectedDeliveryDate` (compra, outro contexto) e
  `QuoteVersion.leadTimeDays` (texto de proposta, não copiado para o Pedido).
- **Endereço de entrega por remessa.** `Shipment` não tem destino. O Pedido
  congela UM endereço do Cliente no CONFIRM. Uma ordem com entregas em endereços
  diferentes não é representável.
- **Desconto global no faturamento.** Ver abaixo.

## Os três achados que exigem decisão

### 1. O desconto global nunca chega ao Faturamento

`CustomerOrder.agreedDiscountPercent` / `agreedTotalAmount` são gravados pelo
`quote-to-order.service.ts` e lidos **só para exibição** em
`commercialOriginOf`. `billings.service.ts` não os menciona;
`calcularTotaisFaturamento` é `Σ(quantidade × preço unitário)`, sem desconto.

Pedido de 3.000 × R$ 10 com 10% de desconto: acordado R$ 27.000, faturado
R$ 30.000. **O buraco existe hoje com UMA expedição total** — não nasce do
COM-04. O parcelamento apenas o torna visível três vezes.

Classificação pedida no handoff: **D — falta regra.** Não existe política, o
Billing não ignora "por decisão", e ninguém recalcula. Simplesmente não foi
modelado.

### 2. O Plano de Atendimento exige cobrir o Pedido inteiro, de uma vez

`applyFulfillmentPlan` valida `reserveQuantity + produceQuantity ==
orderLine.orderedQuantity` (`IncompletePlanCoverageError`) e só roda com o
Pedido `CONFIRMED` — depois vira `IN_FULFILLMENT` e não reaplica.

Para 3.000 com primeira entrega de 1.000, o Plano planeja 3.000: reserva o
disponível e abre OP para o déficit. Isso **não é economicamente errado** e a
independência da Produção está preservada (`createRemainderOrder` divide OPs à
vontade). Mas reserva estoque de dezembro em setembro, tirando-o de outros
Pedidos por três meses.

### 3. Expedição DRAFT é separação, não agenda

DRAFT é a Folha de Separação FO-05: exige `customerOrderReservationLineId` NOT
NULL (lote já alocado), tem conferência física por lote (`verifiedAt`) e o
índice parcial permite **uma só por Pedido**. Três DRAFTs futuras são
impossíveis estruturalmente e erradas semanticamente.

## Opções de modelagem

### A — cronograma em JSON na `CustomerOrderLine`

`deliverySchedule Json?`. Uma coluna, migration mínima.

Precedente contra: o único JSON do domínio comercial é
`agreedPaymentSchedule` — um RESULTADO congelado, nunca consultado nem editado.
Um cronograma é o oposto: vivo, editável, consultado por data, alvo de FK vinda
da `ShipmentLine`. JSON não indexa, não referencia e não agrupa dois produtos na
mesma entrega.

### B — entidade própria: `CustomerOrderDelivery` + `CustomerOrderDeliveryLine`

Cabeçalho por entrega prevista (sequência, data, observação, cancelamento) e uma
linha por `CustomerOrderLine`. Opcional no mesmo passo:
`ShipmentLine.customerOrderDeliveryLineId String?` — previsto × realizado.

Resolve entrega multi-produto (15/10: A 1.000 + B 500), duas Expedições
atendendo uma parcela (N linhas apontando a mesma entrega prevista) e atraso
derivado. Custa 2 tabelas + 1 coluna nullable.

### C — `Shipment` DRAFT como programação

Descartada pelo achado 3.

### D — linhas planas em `CustomerOrderLine`, sem cabeçalho

Tabela única `(customerOrderLineId, sequence, scheduledDate, quantity)`. Mais
simples que B, mas a entrega de 15/10 com dois produtos vira duas linhas soltas
que a tela precisa agrupar por data — e datas que divergem por engano deixam de
ser a mesma entrega sem ninguém perceber.

## Recomendação técnica (não é decisão de PO)

**B**, com status inteiramente derivado (`quantity` vs soma das `ShipmentLine`
confirmadas ligadas), único campo persistido de estado sendo
`cancelledAt/By/Reason`. Sem máquina de estados, no padrão de
`deriveOrderBillingStatus`.

Invariantes propostas: `Σ programado ≤ orderedQuantity` sempre; "planejamento
completo" é derivado da igualdade, nunca uma flag. O cronograma **nunca** toca
`agreedUnitPrice` nem alimenta `resolveTierInput` — a faixa continua vindo da
quantidade total da linha.

Edição do cronograma precisa de serviço próprio: `updateCustomerOrder` tranca
tudo a partir de `IN_FULFILLMENT`, e é exatamente aí que o cronograma vive.
