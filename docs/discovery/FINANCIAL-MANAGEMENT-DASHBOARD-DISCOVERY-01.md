# FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 — Painel Gerencial

Rodada conjunta com DISCOVERY-FOUNDATION-01, que criou esta pasta e o
[índice](README.md).

## 1. Status

**`EM_ANALISE`** — 2026-09-15.

Cinco decisões de PO continuam abertas (seção 11): duas sobre dinheiro, uma
sobre permissão. E há um defeito HIGH no valor faturado que o produto já mostra
(G1, seção 7), que precisa ser corrigido antes de qualquer tela gerencial.
`READY_TO_IMPLEMENT: NO` (seção 16).

- **Base auditada:** `main` = `origin/main` = `9b011aa`. PROD em
  `release/prod` = `2400def`.
- **Método:** leitura de código, schema e documentos. Sem banco, sem API em
  execução, sem teste, sem build.
- **Revisor aplicado:** `/erp-functional-reviewer`. Cada regra leva um rótulo:
  **EXISTE HOJE** (vista no código ou em documento, com fonte), **PROPOSTO**
  (recomendação deste discovery), **FUTURO** (roadmap ou domínio novo).
- **Dado real:** PROD recebeu a carga inicial de cadastros em 2026-09-14.
  Pedidos, expedições, faturamentos, OCs, recebimentos e OPs estão vazios
  (`PROJECT_STATE.md`, "DEV" e "Produção"). Todo indicador desta tela nasce em
  estado vazio.

## 2. Objetivo

Responder duas perguntas e desenhar a resposta como tela:

1. Quais informações monetárias e gerenciais o Veridi mostra **hoje com
   confiança**?
2. Quais **parecem** financeiras, mas seriam enganosas com o domínio atual?

Restrições do handoff: não redesenhar o Painel Operacional, não construir BI
genérico, não inventar domínio e não chamar a evolução de MVP.

## 3. PO baseline

**Pedido explícito deste handoff (2026-09-15):**

- avaliar uma segunda visão, gerencial, ao lado do Painel Operacional;
- poucos indicadores, acionáveis e explicáveis; todo indicador leva ao documento
  que o compõe, quando possível;
- soma parcial nunca parece total;
- três horizontes: realizado, posição atual e compromissos já registrados — sem
  previsão estatística;
- valor de OC não é pagamento; faturamento não é receita recebida nem entrada de
  caixa;
- kg, un e L nunca somados entre si;
- data civil da operação; "Acumulado no ano", nunca "YTD";
- não criar endpoint, DTO, componente, gráfico, migration ou schema nesta rodada.

**Decisões anteriores que valem aqui (EXISTE HOJE):**

| Decisão | Fonte |
|---|---|
| Faturamento é comercial, nunca fiscal: sem NF-e, imposto, contas a receber ou pagamento | `PRODUCT_RULES.md` "Invoicing (implemented, Delivery 19)" |
| Contas a pagar, contas a receber e fluxo de caixa ficam fora, e nunca são inferidos de custo ou de preço de OC | `ROADMAP_POST_MVP.md` "Fiscal / financeiro" |
| Painel é cockpit, não BI; não construir dashboard antes de o dado ser confiável | `ROADMAP_POST_MVP.md` "Relatórios analíticos"; `PRODUCT_RULES.md` §30 |
| Agregado monetário só existe com todos os documentos completos; soma parcial nunca é total | `PRODUCT_RULES.md` §30, "Durable rules (Dashboard)" |
| Um número mostrado em dois lugares tem uma implementação só | `PRODUCT_RULES.md` §31, "Durable rules (Reports)" |
| O total de documento comercial é a soma das linhas já arredondadas | `PRODUCT_RULES.md` §55 e §61 |
| O desconto é do cabeçalho; o faturamento emitido congela bruto, desconto, ajuste e total | `PRODUCT_RULES.md` §34; BILL-DISCOUNT-01b |
| Custo, margem, markup e comissão só para COMMERCIAL e ADMIN, em qualquer formato | `PRODUCT_RULES.md` §5.10; `PRICING_PROVENANCE_ROLES` |
| "Lucro" e "margem líquida" nunca aparecem: contribuição não é lucro | `PRODUCT_RULES.md` §5.9 |
| Perfil tributário é classificação informada, sem efeito em runtime; o ERP não vira motor fiscal | `PRODUCT_RULES.md` §83; BACKLOG PRICING-TEMPLATE-FLEX-01 |
| Nenhum módulo é ocultado (decisão da Veridi, 2026-09-10) | `PROJECT_STATE.md` "Próxima prioridade" |
| COST-VAR-02 (comparação de CMV e proteção de margem) bloqueado nas 7 decisões do PO | [`COST-VAR-01`](../archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) §25 |

## 4. Estado atual

### 4.1 Painel Operacional (EXISTE HOJE)

`GET /dashboard?from=&to=` recebe dias `YYYY-MM-DD`, abre cada dia no fuso de
São Paulo, lê tudo numa transação `RepeatableRead` e usa um `now` por
requisição. Tela `DashboardPage.tsx`, rota `/`, item "Painel" no topo da
navegação, **sem gate de perfil**.

| Bloco | Conteúdo | Responde ao período? |
|---|---|---|
| Ações rápidas | links filtrados por perfil | não |
| Precisa de atenção | 10 tipos derivados, agrupados | não |
| No período | Pedidos criados (`createdAt`), Recebimentos (`receivedAt`), OPs concluídas (`completedAt`), Expedições (`confirmedAt`), Faturamentos emitidos (`issuedAt`) e **Valor faturado** | sim |
| Operação atual | Comercial, Produção, Compras, Estoque & Qualidade — só contagens | não |
| Movimentações | contagem de eventos por tipo, gráfico SVG por dia comercial, últimos 15 movimentos | sim |

O único valor monetário do Painel é "Valor faturado". Presets: Hoje, 7 dias,
30 dias, Personalizado.

### 4.2 Onde o produto já mostra dinheiro (EXISTE HOJE)

| Superfície | Valor mostrado | Gate de perfil |
|---|---|---|
| Faturamento — lista, documento, PDF | `totalAmount` do documento: bruto − desconto apropriado + ajuste de fechamento, congelado na emissão | nenhum |
| Pedido — origem comercial e resumo dos faturamentos | `agreedSubtotalAmount`, `agreedTotalAmount`, preço acordado por linha, `totalAmount` de cada faturamento | nenhum |
| Visão do Cliente — Pedido, Faturamento, Projeto | os mesmos DTOs acima | nenhum |
| Orçamentos — lista geral e versão | `total` com desconto; plano de pagamento | proveniência econômica filtrada por perfil |
| Ordem de Compra | total derivado por §61 | nenhum |
| R-08 Ordens de Compra | "Valor previsto" por OC, só completa | nenhum |
| R-09 Recebimentos | preço da OC e custo efetivo, por linha | nenhum |
| R-14 Pedido → Operação | valor de cada faturamento | nenhum |
| R-15 Faturamento por período | valor por documento e total do filtro | nenhum |
| R-18 Custo industrial por produto | último cálculo salvo por produto | nenhum |
| R-19 e R-20 | preço, custo, margem, markup | COMMERCIAL, ADMIN |
| CMV do produto | custo simulado; precificação só para COMMERCIAL e ADMIN | parcial |

### 4.3 O que não existe no domínio (EXISTE HOJE como ausência)

- **Contas a receber:** não existe recebimento de cliente, baixa, título nem
  vencimento real. `CustomerOrder.agreedPaymentSchedule` é o plano como foi
  apresentado, com parcelas em `dueInDays` relativos — o schema diz "Isto nao e
  financeiro nem contas a receber".
- **Contas a pagar:** não existe pagamento a fornecedor. §31 separa preço da OC,
  custo efetivo de aquisição e valor pago, e o terceiro é camada futura.
- **Caixa, banco e conciliação:** não existem.
- **Nota fiscal e imposto:** não existem. Faturamento não é documento fiscal.
- **Custo das vendas por faturamento:** não existe. Pedido e Faturamento não
  carregam custo (§34, "Confidentiality"); o custo de produto acabado mora na OP.
- **Correção de faturamento emitido:** não existe devolução nem nota de crédito.
  Faturamento emitido é imutável e não cancela (`cancelBilling` só aceita
  rascunho); Expedição confirmada também não cancela.

## 5. Evidências

**Código — faturamento e valor faturado**

- `apps/api/src/modules/dashboard/dashboard.service.ts:41-86` — `buildPeriod`:
  soma `quantity × unitPrice` de todas as linhas, sem arredondar a linha e sem
  desconto; `toFixed(2)` só no fim.
- `apps/api/src/modules/dashboard/dashboard.routes.ts:19-33` — rota sem gate.
- `apps/api/src/modules/reports/billing-reports.service.ts:63-121` — R-15: total
  do filtro por `unitPrice × Σ quantity`; valor de cada linha é a soma bruta.
  O CSV do R-15 usa o mesmo serviço (`exports/report-exports.ts:428`).
- `apps/api/src/modules/reports/commercial-reports.service.ts:409-426` — R-14:
  valor de cada faturamento pela soma bruta.
- `apps/api/src/modules/billings/billings.service.ts:280-351` (`toBillingDTO`),
  `:739-794` (emissão congela a apropriação), `:801-827` (cancelamento só de
  rascunho).
- `packages/shared/src/billings.ts:218-243` (`calcularTotaisFaturamento`, §55) e
  `:344` em diante (`calcularApropriacaoComercialDoFaturamento`).
- `apps/api/src/modules/customer-orders/customer-orders.service.ts:253-283` — o
  resumo do Pedido usa o `totalAmount` congelado e explica por quê;
  `:297-321` (`deriveOrderBillingStatus`); `:953-967` (Pedido com expedição
  confirmada não cancela).
- `apps/web/src/pages/customer-consultation/SummaryTab.tsx:11-19` — comentário
  diz que o total do Faturamento "não é persistido"; desatualizado desde
  BILL-DISCOUNT-01b.
- `apps/api/src/modules/dashboard/dashboard.test.ts:386-490` — valor faturado
  testado só sem desconto (100 × R$ 3,00).

**Código — pedido, compras, custo e permissão**

- `apps/api/src/modules/projects/quote-to-order.service.ts:200-227` — único
  lugar que grava `agreedUnitPrice`, `agreedSubtotalAmount` e
  `agreedTotalAmount`: Pedido digitado direto nasce sem preço.
- `apps/api/src/modules/purchase-orders/purchase-orders.service.ts:474-482` —
  OC só cancela em rascunho ou confirmada; não existe encerramento de saldo.
- `apps/api/src/modules/reports/purchasing-reports.service.ts:26-102` (R-08 com
  `calcularTotaisOrdemCompra`) e `:110-188` (R-09).
- `apps/api/src/modules/industrial-cost-calculation/production-cost.service.ts:52-61`
  — custo da OP: materiais realizados + custo padrão aplicado, nunca "real".
- `apps/api/src/modules/reports/reports.routes.ts:147-183` e
  `packages/shared/src/pricing.ts:42` — R-19 e R-20 restritos a
  `PRICING_PROVENANCE_ROLES` (COMMERCIAL, ADMIN).
- `apps/api/src/lib/current-user.ts:92-97` — `requireRole`: "sem matriz de
  permissão por botão nesta fase".

**Código — navegação, período e drill-down**

- `apps/web/src/app/navigation.ts:46` (Painel) e `:365-381` (Gestão: Relatórios;
  Precificação com `roles`).
- `apps/web/src/lib/list-period.ts:24-38` — as listas já têm "Mês atual";
  `packages/shared/src/business-timezone.ts:289` (`primeiroDiaDoMesComercial`).
  Não há ajudante de mês anterior nem de ano.
- `apps/web/src/pages/billings/BillingsPage.tsx:55-57, 134-142` — Faturamento
  filtra pela URL: `status`, `customerId`, `period`, `dateFrom`, `dateTo`.
- `apps/web/src/pages/customer-orders/CustomerOrdersPage.tsx:75, 98-100` — "Em
  aberto" inclui rascunho; sem período e sem estado de faturamento.
- `apps/web/src/pages/purchase-orders/PurchaseOrdersPage.tsx:67, 86-94` — "Em
  aberto" inclui rascunho.
- `apps/web/src/pages/shipments/ShipmentsPage.tsx:73-82` — só status; sem filtro
  "a faturar".
- `apps/web/src/pages/reports/` — nenhuma tela de relatório lê filtro da URL.
- `apps/web/src/pages/customer-consultation/routes.tsx:33-52` — Visão do
  Cliente com abas de pedidos, produtos e faturamentos.

**Schema (`apps/api/prisma/schema.prisma`)**

`UserRole` 106-113 · `BillingStatus` 350-354 · `QuoteVersion` 797-890 ·
`QuoteLine` 898-999 · `ProductionOrderCostSnapshot` 1346-1375 ·
`PricingVersion`/`PricingTier` 1407-1569 · `SupplierItemOffer` 1771-1812 ·
`ItemCostReference` 2116-2143 · `CustomerTaxProfile`/`Customer` 2257-2337 ·
`PurchaseOrder`/`PurchaseOrderLine` 2625-2714 · `Receipt`/`ReceiptLine`
2723-2824 · `CustomerOrder` 3399-3498 · `CustomerOrderDelivery` 3513-3565 ·
`CustomerOrderLine` 3597-3657 · `Shipment`/`ShipmentLine` 3740-3861 ·
`Billing`/`BillingLine` 3871-4029.

**Documentos**

`PRODUCT_RULES.md` §5.8, §5.9, §5.10, §5.12, "Invoicing", §30, §31 ("Material
cost foundation"), §34, §55, §61, §75, §83, §84 · `ROADMAP_POST_MVP.md`
"Relatórios analíticos" e "Fiscal / financeiro" · `PROJECT_STATE.md`
BILL-DISCOUNT-01b e DASHBOARD-* · COST-VAR-01 §25.

## 6. Findings

### 6.1 O que cada valor monetário significa

Existir um campo em reais não quer dizer que ele seja caixa ou contabilidade.
Classificação de cada fonte (EXISTE HOJE):

| Valor | Campo | Categoria | Data que o situa | Pode faltar? |
|---|---|---|---|---|
| Preço e total da proposta | `QuoteLine.unitPrice`; total por `calcularTotaisOrcamento`, com desconto | PROPOSTO | `quoteDate`, `sentAt` | sim — linha sem preço deixa o total nulo |
| Proposta aceita | a mesma versão com status `ACCEPTED` | CONTRATADO | `acceptedAt` | sim |
| Condição de pagamento | `QuoteVersion.paymentMethod`, parcelas, juros; `CustomerOrder.agreedPaymentSchedule` | CONTRATADO (condição) — não é título a receber | parcelas em `dueInDays` relativos | sim |
| Custo, margem e comissão congelados no envio | `QuoteLine.industrialCostPerUnitSnapshot`, `contributionMarginSnapshot`, `markupSnapshot`, `commissionPercentSnapshot` | CUSTO PROSPECTIVO / ESTIMADO | `sentAt` | sim — linha manual e legado |
| Acordo do Pedido | `CustomerOrder.agreedSubtotalAmount`, `agreedTotalAmount`; `CustomerOrderLine.agreedUnitPrice` | PEDIDO | criação a partir da proposta; compromisso em `confirmedAt` | sim — **Pedido digitado direto nunca tem** |
| Expedido | `ShipmentLine.quantity` — sem valor próprio | EXPEDIDO (quantidade) | `confirmedAt` | valor só derivado do preço acordado |
| Preço acordado copiado no faturamento | `BillingLine.agreedUnitPrice` | CONTRATADO | criação do rascunho | sim |
| Preço faturado | `BillingLine.unitPrice` (override com motivo) | FATURADO | emissão | sim — emissão não exige preço |
| Documento de faturamento | `Billing.grossAmount`, `discountAmount`, `commercialAdjustmentAmount`, `totalAmount` | FATURADO | `issuedAt` | sim — preço incompleto; legado sem apropriação |
| Preço da OC e total do documento | `PurchaseOrderLine.unitPrice`; total por `calcularTotaisOrdemCompra` (§61) | ESTIMADO (previsto/negociado) — nunca pago | `orderDate` (data civil) | sim |
| Custo efetivo de aquisição | `ReceiptLine.actualUnitCost` | CUSTO REALIZADO (aquisição) | `receivedAt` | sim — nulo é desconhecido, zero é zero |
| Oferta de fornecedor | `SupplierItemOffer.unitPrice` | CUSTO DE REFERÊNCIA | `effectiveAt`–`validUntil` | só vale com vigência e em BRL |
| Referência manual de custo | `ItemCostReference.unitCost` | CUSTO DE REFERÊNCIA (estimativa) | `effectiveFrom` | sim |
| Média 30 d, 90 d, último real | derivadas dos recebimentos com custo | CUSTO DE REFERÊNCIA | data de referência do cálculo | sim |
| Cálculo de custo salvo | `IndustrialCostCalculation` (CALC) | CUSTO PROSPECTIVO (congelado) | `costReferenceDate` | total nulo quando parcial |
| Faixa de precificação ativa | `PricingTier.*Snapshot` (custo, preço técnico, contribuição, margem, markup, comissão, imposto estimado %) | CUSTO PROSPECTIVO + PROPOSTO (preço técnico) | `activatedAt` | sim |
| CMV do produto | simulação por quantidade, sem persistência (§5.12) | CUSTO PROSPECTIVO (simulado) | data de referência explícita | "CMV indisponível" quando parcial |
| Custo da OP concluída | `ProductionOrderCostSnapshot` | CUSTO REALIZADO **híbrido**: materiais realizados + padrão aplicado | `completedAt` | total nulo quando parcial |
| Valor pago a fornecedor | — | **PAGO: não existe** | — | — |
| Valor recebido de cliente | — | **RECEBIDO: não existe** | — | — |

### 6.2 Faturamento

**Regras (EXISTE HOJE).** Só `ISSUED` fatura; rascunho nunca conta; cancelamento
só de rascunho; emitido é imutável. A quantidade é a da Expedição confirmada,
um faturamento ativo por Expedição, sem faturamento parcial dentro da Expedição
e sem consolidar Expedições. Um Pedido fatura em partes por ter várias
Expedições. O preço nasce igual ao acordado; override exige COMMERCIAL ou ADMIN
e motivo. O desconto do Pedido é apropriado no cabeçalho, de forma cumulativa, e
o documento que completa as quantidades absorve o saldo e o ajuste de
arredondamento: com o Pedido inteiro faturado, `Σ Billing.totalAmount` fecha
exatamente em `agreedTotalAmount`.

**F1 — HIGH — "Valor faturado" tem quatro contas.**

| Superfície | Conta |
|---|---|
| Documento, lista de Faturamento, resumo do Pedido, Visão do Cliente | `totalAmount` congelado: bruto por linha arredondada − desconto + ajuste |
| Painel — "Valor faturado" | `Σ quantidade × preço` de todas as linhas, sem arredondar a linha, sem desconto |
| R-15 — valor por documento, total do filtro, CSV e PDF | a mesma soma bruta, agregada por preço |
| R-14 — valor de cada faturamento | a mesma soma bruta, por documento |

Dois efeitos, os dois com dinheiro:

- **Desconto.** Pedido de subtotal R$ 1.000,00 com 10% de desconto, faturado
  num documento: o documento vale R$ 900,00; Painel, R-15 e R-14 dizem
  R$ 1.000,00.
- **Arredondamento (§55).** Duas linhas de `1 × 0,1250`: o documento soma
  `0,13 + 0,13` = R$ 0,26; o Painel e o R-15 dizem R$ 0,25.

Viola §31 (uma implementação por número) e §55. O teste do Painel só cobre
documento sem desconto e sem casas além de duas
(`dashboard.test.ts:386-490`). O resumo do Pedido já tinha corrigido a mesma
divergência para si (`customer-orders.service.ts:274-280`); as outras três
superfícies não. Registrado como **BILLED-VALUE-CANONICAL-01** na seção A do
`BACKLOG.md`.

**Definições propostas (PROPOSTO), usadas no resto deste documento:**

| Nome na tela | Definição | Data |
|---|---|---|
| **Faturado** | Faturamentos `ISSUED` do período: soma de `Billing.totalAmount`. Documento emitido sem `totalAmount` (legado anterior a BILL-DISCOUNT-01b) vale `Σ round(quantidade × preço, 2)` das linhas. O total só existe quando todos os documentos do recorte têm preço completo | `issuedAt`, no dia comercial |
| **A faturar** | Expedições `CONFIRMED` sem faturamento `ISSUED` — as que têm rascunho entram. Mesma regra do contador do Painel e do R-16. Valor: `Σ round(quantidade × agreedUnitPrice, 2)` das linhas, pelo preço acordado e **antes do desconto do Pedido** | posição atual |
| **A expedir** | Linhas de Pedidos `CONFIRMED`, `IN_FULFILLMENT` e `PARTIALLY_SHIPPED`: `max(pedido − expedido confirmado, 0)` × preço acordado, arredondado por linha, antes do desconto | posição atual |

"Expedido e não faturado" é o mesmo conjunto que "A faturar"; a tela usa um nome
só. "Pedido ainda não expedido" é "A expedir".

**Não há dupla contagem em quantidade.** Por linha do Pedido, faturado ≤
expedido ≤ pedido: o faturamento copia as linhas de uma Expedição, e a Expedição
recusa quantidade acima do saldo (`ExceedsReservedRemainingError`,
`ExceedsOutstandingError`). Então pedido = faturado + a faturar + a expedir. **Em
valor a identidade não fecha** — "Faturado" já carrega desconto e override, os
outros dois estão no preço acordado — e por isso a tela nunca soma os três num
"total do Pedido".

### 6.3 Carteira de pedidos

| KPI | Fórmula | Data | Status incluídos | Excluídos | Confiança |
|---|---|---|---|---|---|
| Pedidos confirmados (quantidade) | contagem com `confirmedAt` no período | `confirmedAt` | `CONFIRMED`, `IN_FULFILLMENT`, `PARTIALLY_SHIPPED`, `SHIPPED` | `DRAFT`; `CANCELLED` no momento da leitura | CONFIÁVEL |
| Pedidos confirmados (R$) | `Σ agreedTotalAmount` dos mesmos | `confirmedAt` | idem | idem | PARCIAL — Pedido direto não tem valor |
| A expedir (R$) | seção 6.2 | agora | `CONFIRMED`, `IN_FULFILLMENT`, `PARTIALLY_SHIPPED` | `DRAFT`, `SHIPPED`, `CANCELLED` | PARCIAL — idem |
| A faturar (R$) | seção 6.2 | agora | Expedição `CONFIRMED` sem `ISSUED` | — | PARCIAL — idem |
| Carteira em aberto | A expedir + A faturar, mostrados lado a lado, sem terceiro número | agora | idem | idem | PARCIAL |
| Valor já expedido no período | `Σ` expedido × preço acordado | `confirmedAt` | Expedição `CONFIRMED` | — | PARCIAL — e redundante com Faturado + A faturar: **não recomendado** |
| Ticket médio / valor médio por pedido | `Σ agreedTotalAmount ÷ N` | `confirmedAt` | — | — | **NÃO RECOMENDADO**: poucos pedidos grandes, e o Pedido direto sai do numerador sem sair do denominador |
| Pedidos por cliente | contagem por `customerId` | `confirmedAt` | como acima | como acima | CONFIÁVEL |

- Pedido com expedição confirmada não cancela (`customer-orders.service.ts:963`):
  o que foi expedido ou faturado nunca pertence a Pedido cancelado.
- Um Pedido `CONFIRMED` cancelado depois sai de "Pedidos confirmados" também no
  período passado. É a leitura recomendada — confirmado que não virou compromisso
  não é carteira —, dita no texto de ajuda.
- Pedido legado sem `confirmedAt` (§86 admite registro sem data) fica fora dos
  indicadores por período e dentro das posições atuais, que são por status.

### 6.4 Compras

| KPI | Fórmula | Data | Confiança |
|---|---|---|---|
| Compras contratadas (R$) | total §61 das OCs `ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`; `DRAFT` e `CANCELLED` fora | `orderDate` (data civil, a mesma do R-08) | PARCIAL — preço da OC é opcional |
| A receber de fornecedores (R$ previsto) | linhas de OCs `ORDERED`/`PARTIALLY_RECEIVED`: saldo aberto × preço da OC, arredondado por linha | agora | PARCIAL — preço opcional e saldo que não encerra (G5) |
| Recebido a custo efetivo (R$) | `Σ receivedQuantity × actualUnitCost` de recebimentos de OC | `receivedAt` | PARCIAL — custo opcional; sem regra de arredondamento de documento (G6) |
| Compras contratadas por fornecedor | o primeiro KPI agrupado por `supplierId` | `orderDate` | PARCIAL |
| Valor pago | — | — | **NÃO SUPORTADO** |

**O Veridi NÃO tem Contas a Pagar nem caixa realizado.** Valor de OC é previsto
e negociado; custo efetivo é quanto o material custou; nenhum dos dois diz
quando nem quanto dinheiro saiu (§31). A palavra "gasto" também fica fora: soa
como pago. Recebimento de material do cliente não tem OC nem custo Veridi (§40)
e não entra em Compras.

### 6.5 Receita e recebimento financeiro

**Não existe recebimento de cliente.** Faturado não é recebido. O plano de
pagamento congelado no Pedido tem parcelas em `dueInDays`, sem data-base ligada
ao faturamento e sem baixa: não é previsão de recebimento.

Palavras proibidas na tela gerencial: "Receita", "Receita recebida", "Entrada de
caixa" e "Recebimentos" — esta última colide com o Recebimento de material de
Compras, e cada leitor a entenderia de um jeito. O nome é **"Faturado"**.

### 6.6 Margem

| Margem | Fonte | Momento | Limitações | Mostrar? |
|---|---|---|---|---|
| Estimada (da precificação) | `PricingTier.contributionMarginSnapshot` | ativação da faixa | é de uma quantidade, não de uma venda; qualidade do custo varia | já está no R-19, restrito; **fora do painel** |
| Contratada (no envio da proposta) | `QuoteLine.contributionMarginSnapshot`, `industrialCostPerUnitSnapshot`, `commissionPercentSnapshot` | `sentAt` | não chega ao Pedido nem ao Faturamento; ignora o desconto global; linha manual carrega a margem da faixa (R20-MANUAL-REFERENCE-MARGIN-01); congela o custo do cálculo, não o custo p/ preço (R20-SENT-PRICING-BASIS-SNAPSHOT-01) | **evolução**, restrita a `PRICING_PROVENANCE_ROLES`, depois de COST-VAR-02 |
| Realizada | exigiria valor faturado por linha (o desconto é do cabeçalho, sem rateio), custo do lote faturado (lote → OP → custo híbrido), comissão e imposto por venda (não modelados) | — | lote de abertura não tem OP nem custo | **NÃO SUPORTADO** — domínio novo (custo das vendas) |

"Margem bruta", "margem líquida" e "lucro" continuam proibidos (§5.9).

### 6.7 CMV

O que o produto chama de CMV **hoje** é o custo industrial de um produto para
uma quantidade, a partir do cálculo salvo vigente numa data (§5.12): custo
**prospectivo e simulado, por produto**. Existem ainda três versões congeladas —
o CALC, a faixa ativa (`costPerUnitSnapshot`) e a linha enviada
(`industrialCostPerUnitSnapshot`) —, um custo **realizado híbrido por OP**
(`ProductionOrderCostSnapshot`) e **nenhum custo por faturamento**.

Em contabilidade, CMV é o custo das mercadorias **vendidas no período**. Posto ao
lado de "Faturado", o leitor subtrai um do outro e lê margem.

**Nomenclatura proposta:** "Custo industrial de referência" para o CMV simulado
e o CALC; "Custo industrial da OP (materiais realizados + custo padrão)" para o
snapshot da OP; "CMV do período" e "Custo das vendas" reservados ao domínio
futuro. A tela gerencial não usa a sigla CMV.

### 6.8 Impostos

- `Customer.taxProfile` é classificação sem efeito em runtime (§83).
- O imposto estimado do Modelo de Precificação entra no divisor do preço técnico
  da faixa e congela em `PricingTier.estimatedTaxPercentSnapshot` (§84). A linha
  do Orçamento não o congela, e ele não chega ao Pedido nem ao Faturamento.
- Faturamento não é nota fiscal e não tem imposto.

Consequência: "Faturado" é o valor comercial cobrado, com o imposto embutido no
preço quando o Modelo o considerou. **Faturamento líquido de impostos e carga
tributária estimada: NÃO SUPORTADO.** A palavra "bruto" já quer dizer "antes do
desconto" no Faturamento (`grossAmount`); a tela gerencial não usa "bruto" nem
"líquido" com sentido de imposto.

### 6.9 Realizado, posição atual e próximos compromissos

**Realizado** — responde ao período escolhido.

| Indicador | Fonte | Confiança |
|---|---|---|
| Faturado | `Billing` `ISSUED` por `issuedAt` | CONFIÁVEL depois de BILLED-VALUE-CANONICAL-01; PARCIAL enquanto houver documento sem preço |
| Faturamentos emitidos | contagem | CONFIÁVEL |
| Pedidos confirmados | `confirmedAt` | CONFIÁVEL em quantidade; PARCIAL em R$ |
| Compras contratadas | OC por `orderDate` | PARCIAL |
| Clientes com faturamento | clientes distintos com faturamento emitido | CONFIÁVEL |
| Produção concluída | OPs por `completedAt` | CONFIÁVEL — já está no Painel Operacional; não repetir |
| Custo realizado | `ProductionOrderCostSnapshot` | fora — custo híbrido por OP não é o custo do que foi vendido no período |

**Posição atual** — não responde ao período.

| Indicador | Confiança |
|---|---|
| A expedir (R$ acordado) | PARCIAL |
| A faturar (R$ acordado; contagem de Expedições) | contagem CONFIÁVEL; R$ PARCIAL |
| A receber de fornecedores (R$ previsto) | PARCIAL |
| Produção em andamento | contagem — já no Painel Operacional |

**Próximos compromissos** — só o que está registrado; nenhuma previsão
estatística. Janela proposta: hoje e os 29 dias civis seguintes, fixa, sem
responder ao período.

| Compromisso | Fonte | Confiança |
|---|---|---|
| Entregas programadas | `CustomerOrderDelivery` ativa com saldo e `scheduledDate` na janela; quantidade por produto e unidade; valor = saldo × preço acordado | contagem CONFIÁVEL; R$ PARCIAL |
| Entregas atrasadas | dia prometido já passou e há saldo (§75) | CONFIÁVEL |
| Pedidos sem cronograma com data pedida | `requestedDeliveryDate` na janela | PARCIAL — data do cabeçalho, sem saldo por data |
| Compras esperadas | OCs abertas com `expectedDeliveryDate` na janela; valor previsto | PARCIAL |
| OPs programadas | `ProductionOrderSchedule` na janela | contagem — pertence ao Planejamento; fora desta tela |

### 6.10 KPIs candidatos

| KPI | Veredito | Por quê |
|---|---|---|
| Faturamento emitido ("Faturado") | **CONFIÁVEL HOJE** em contagem; em R$, **PARCIAL** até BILLED-VALUE-CANONICAL-01 | com desconto, o número atual não é o dos documentos (F1) |
| Expedido a faturar ("A faturar") | **CONFIÁVEL HOJE** em contagem; **PARCIAL** em R$ | Pedido direto não tem preço acordado |
| Carteira confirmada ("A expedir" + "A faturar") | **PARCIAL** | idem |
| Compras contratadas | **PARCIAL** | preço da OC é opcional |
| Compras recebidas | **PARCIAL** | custo efetivo é opcional; falta regra de total do recebimento (G6) |
| Margem estimada | **NÃO SUPORTADO** no painel | seção 6.6 |
| Ticket médio | **NÃO SUPORTADO** | seção 6.3 |
| Pedidos confirmados | **CONFIÁVEL HOJE** em contagem; **PARCIAL** em R$ | Pedido direto |
| Clientes com faturamento | **CONFIÁVEL HOJE** | contagem de clientes distintos |
| Valor médio por pedido | **NÃO SUPORTADO** | é o ticket médio com outro nome |

### 6.11 Tendência

Comparar só períodos equivalentes, calculados no servidor:

| Período escolhido | Comparado com |
|---|---|
| Mês atual (dia 1 até hoje) | o mês anterior do dia 1 até o mesmo dia — ou até o último dia dele, se for mais curto |
| Mês anterior (fechado) | o mês antes dele, fechado |
| Acumulado no ano | 1º de janeiro até o mesmo dia do ano anterior (29/02 compara com 28/02) |
| Personalizado | o intervalo de mesmo número de dias imediatamente antes |

- Variação só aparece com **os dois períodos completos** e o anterior maior que
  zero.
- Anterior igual a zero: "Sem base de comparação" — nunca "+∞%" nem "+100%".
- Qualquer um dos dois incompleto: sem variação, com "Valores incompletos".
- Os dois valores absolutos aparecem; o percentual é secundário, com uma casa.
- Janela curta (Hoje, 7 dias) não compara: em venda B2B de lotes, a variação
  diária é ruído.

### 6.12 Gráficos

| # | Gráfico | Pergunta | Eixo e unidade | Fonte | Drill-down | Risco de leitura | Veredito |
|---|---|---|---|---|---|---|---|
| A | Faturado ao longo do tempo | O faturamento está subindo ou caindo? | x: mês (Acumulado no ano; Personalizado acima de 62 dias), semana ou dia; y: R$ | Faturado por `issuedAt` no dia comercial | barra → Faturamento filtrado pelo intervalo da barra | intervalo com documento sem preço desenhado menor do que é → marcar "Incompleto", sem altura | **MANTER** (versão 1) |
| B | Pedidos confirmados × faturamento | — | — | — | — | populações e datas diferentes (confirma em setembro, fatura em novembro) e Pedido direto sem valor desenham "confirmado menor que faturado" falso | **DESCARTAR** |
| C | Composição da carteira | Quanto está preso antes da expedição e quanto espera faturamento? | uma barra horizontal: A expedir · A faturar; R$ acordado | seção 6.2 | segmento → lista correspondente (G4) | incompleto → mostrar contagens no lugar da barra | **MANTER** (versão 1) |
| D | Top clientes | Quem concentra o faturamento? | 10 barras horizontais; R$ | Faturado por cliente | cliente → Visão do Cliente, aba Faturamentos | ver seção 6.13 | **MANTER**, como tabela ranqueada (versão 1) |
| E | Top produtos | Quais produtos concentram o faturamento? | 10 barras horizontais; R$ | linhas faturadas por produto | produto → Visão do Cliente › Produto | valor por produto é de linha, antes do desconto do cabeçalho: a soma do ranking não bate com "Faturado" — dizer isso e nunca somar | **MANTER**, como tabela com a nota (versão 1) |
| F | Compras por período e fornecedor | Com quem a Veridi mais compromete compra? | barras; R$ previsto | total §61 | fornecedor → Ordens de Compra do fornecedor | preço de OC opcional; lido como gasto | **EVOLUÇÃO**, com rótulo "contratado" e depois de G5 |
| G | Margem por período ou produto | — | — | — | — | margem não suportada (6.6) | **DESCARTAR** |

O gráfico de Movimentações continua no Painel Operacional. Nenhum gráfico
decorativo entra.

### 6.13 Top clientes

**Padrão proposto: ranking por Faturado no período.** Não por pedido confirmado
(Pedido direto sem valor distorce), nem por carteira (é posição, não resultado).
Uma métrica por ranking, nunca misturada.

- Cliente é o `customerId` do Pedido do faturamento; o nome vem do snapshot do
  documento. Cliente com vários projetos é uma linha só.
- Desempate por valor e depois por código do cliente.
- Cliente com documento sem preço no período não entra no ranking por valor; a
  tabela diz quantos e quais ficaram fora (decisão D2).
- Top 10; "Demais clientes" só aparece com todos os documentos completos.

### 6.14 Top produtos

**Padrão proposto: ranking pelo valor das linhas faturadas** —
`round(quantidade × preço, 2)` por `BillingLine.productId` —, antes do desconto
do cabeçalho, dito na tela.

- Quantidade aparece só na linha do próprio produto, com a unidade dele
  (`BillingLine.unitCode`). **Nunca total de quantidade entre produtos**: kg, un
  e L não se somam.
- Ranking por quantidade: não — unidades diferentes.
- Ranking por número de pedidos: não recomendado — pedido grande e pequeno pesam
  igual.
- Produto pertence a um cliente (`Product.customerId` obrigatório), então o
  drill-down vai para a Visão do Cliente.

### 6.15 Drill-down

Princípio já em vigor (§5.11): link que carrega contexto filtra de verdade. Link
para filtro que o destino ignora não entra na versão 1.

| Indicador | Destino | Suportado hoje? | O que falta |
|---|---|---|---|
| Faturado no período | `/comercial/faturamento?status=ISSUED&period=custom&dateFrom=…&dateTo=…` | **SIM** — a lista lê status, período e datas da URL | — |
| Faturado de um cliente | a mesma lista com `customerId`; ou Visão do Cliente › Faturamentos | **SIM** (a aba da Visão do Cliente não tem período) | — |
| Documentos sem preço | lista de Faturamento | **NÃO** | filtro "sem preço completo" |
| A faturar | R-16 | **PARCIAL** | relatório não lê filtro da URL; lista de Expedições não filtra "a faturar" |
| A expedir | `/comercial/pedidos?status=…` | **PARCIAL** | "Em aberto" inclui rascunho e a URL aceita um grupo; falta o grupo "Carteira" (`CONFIRMED`, `IN_FULFILLMENT`, `PARTIALLY_SHIPPED`) |
| Pedidos confirmados no período | — | **NÃO** | lista de Pedidos sem período por `confirmedAt`; R-12 filtra por `orderDate` e não lê a URL |
| Compras contratadas | `/compras/ordens?status=…&period=custom&dateFrom=…&dateTo=…` | **PARCIAL** | "Em aberto" inclui rascunho; falta o grupo "Confirmadas" (`ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`) |
| Cliente do ranking | `/consultas/clientes/:customerId/faturamentos` | **SIM** | — |
| Produto do ranking | `/consultas/clientes/:customerId/produtos/:productId` | **SIM** | — |
| Entrega programada | `/comercial/pedidos/:id` | **SIM** — as entregas são vistas dentro do Pedido | — |

### 6.16 Período

**Recomendação:** Mês atual (padrão), Mês anterior, Acumulado no ano e
Personalizado.

- Gestão pergunta por mês e por ano. Hoje e 7 dias são perguntas operacionais e
  já moram no Painel Operacional. Últimos 30 dias atravessa a virada do mês e
  perde para os dois presets de mês.
- "Mês atual" já existe nas listas (`resolveListPeriod`, com
  `primeiroDiaDoMesComercial`). "Mês anterior" e "Acumulado no ano" pedem dois
  ajudantes pequenos no shared, com a mesma conta de dia civil — nenhuma regra
  nova.
- Tudo no dia comercial de São Paulo (§72, §81): `issuedAt`, `confirmedAt` e
  `receivedAt` são instantes abertos por `limitesDoDiaComercial`; `orderDate` da
  OC e `scheduledDate` são datas civis comparadas como dia.
- Período invertido é recusa, com a regra e a frase do Painel.

### 6.17 Acumulado no ano

**Faz sentido:** é a pergunta clássica de gestão e a base da comparação anual.

- Intervalo: de 1º de janeiro do ano civil de hoje, em São Paulo, até hoje,
  inclusive.
- Entram: Faturado (faturamento `ISSUED` por `issuedAt`), Pedidos confirmados
  (`confirmedAt`) e Compras contratadas (`orderDate`).
- Posição atual e próximos compromissos não mudam com o preset.
- Comparação: o mesmo intervalo do ano anterior.
- Ano é o **ano civil**; o ERP não tem exercício fiscal, e a tela não sugere que
  tenha.
- Rótulo: "Acumulado no ano". Nunca "YTD".

### 6.18 UX e navegação

| Opção | Leitura |
|---|---|
| A — Painel vira grupo: Operacional, Gerencial | muda o item de topo e o endereço `/` que todo perfil usa; favoritos e preferências gravados como `dashboard` teriam de migrar |
| B — abas Operacional \| Gerencial dentro do Painel | a tela inicial de todos ganha a pergunta "qual aba?"; a aba restrita some para parte dos perfis; os períodos dos dois (Hoje/7/30 contra mês/ano) convivem na mesma página e se confundem — justamente a confusão que a ajuda do Painel já tenta desfazer |
| C — tela própria em **Gestão** | "Painel Gerencial" ao lado de Relatórios e Precificação, com `roles` que espelham o gate da API, no padrão de `navigation.ts` |

**Recomendação: C.** O Painel Operacional fica intacto; Gestão já é o lugar e já
tem o mecanismo de perfil; os relatórios do drill-down moram no mesmo grupo. Um
atalho "Visão gerencial" no Painel Operacional, só para quem tem perfil, é
evolução.

### 6.19 Nome

Sem contas a pagar, contas a receber, caixa e conciliação, "Painel Financeiro"
promete o que não existe: o primeiro usuário procura "a receber" e não acha.
"Financeiro & Gestão" herda o problema. "Visão Gerencial" se confunde com "Visão
do Cliente", que é consulta de um cliente só.

**Recomendação: "Painel Gerencial"**, com o subtítulo "Faturamento, carteira e
compras — valores comerciais, não financeiros." Rota sugerida:
`/gestao/painel-gerencial`.

### 6.20 Perfis e permissões

**Hoje (EXISTE HOJE):** `GET /dashboard`, `/billings`, `/customer-orders`,
`/purchase-orders`, R-08, R-09, R-14 e R-15 não têm gate de perfil — PRODUCTION,
QUALITY e VIEWER leem valor faturado, preço acordado e preço de OC. Só a
proveniência econômica (custo, margem, markup, comissão) é restrita a COMMERCIAL
e ADMIN. `requireRole` é gate por rota; um perfil por usuário.

**Matriz proposta (PROPOSTO — decisão D4):**

| Bloco | ADMIN | COMMERCIAL | PURCHASING | PRODUCTION | QUALITY | VIEWER |
|---|---|---|---|---|---|---|
| Página na versão 1 (Faturado, A faturar, A expedir, rankings, entregas, Compras contratadas) | sim | sim | não | não | não | não |
| Bloco de Compras para PURCHASING | — | — | evolução | não | não | não |
| Margem contratada (evolução) | sim | sim | não | não | não | não |

- Uma constante de perfis, no mesmo padrão de `PRICING_PROVENANCE_ROLES`, usada
  pela API, pelo item de menu e pelo catálogo.
- **O gate da tela não protege o dado.** Os mesmos valores continuam legíveis nas
  telas operacionais e nos relatórios abertos. Restringir valor de venda nessas
  telas é outra decisão, e esbarra em "nenhum módulo é ocultado".
- Permissão específica ("ver valores gerenciais") só faz sentido quando existir
  matriz de permissão; hoje `UserRole` é um enum por usuário.

### 6.21 Dados incompletos

A regra já existe (§30): agregado só com todos os documentos completos. Proposta
de tela para todo o Painel Gerencial:

| Situação | Card | Nota |
|---|---|---|
| Sem documento | "—" | "Sem faturamentos no período." — não é incompleto |
| Todos completos | "R$ 120.450,00" | "32 documentos, todos com preço." |
| Algum sem preço | **"Valores incompletos"**, sem número grande | "30 de 32 documentos com preço." + link para os documentos (depende de G4) |
| Pedido direto na carteira | **"Valores incompletos"** | "4 pedidos sem preço acordado (digitados direto)." |

- Gráfico: intervalo incompleto marcado "Incompleto", sem altura de valor.
- Tendência: sem variação quando qualquer período está incompleto.
- Ranking: cada linha é o valor completo de um cliente ou produto; os que têm
  documento sem preço ficam fora **e são nomeados** na tabela (decisão D2).
- Subtotal conhecido nunca aparece em card (decisão D2).

### 6.22 Performance e arquitetura

**Hoje (EXISTE HOJE):** `GET /dashboard` roda numa transação `RepeatableRead`,
numa conexão — o `Promise.all` vira fila —, com 30 s de limite. `buildPeriod`
carrega em memória todos os faturamentos do período com as linhas: com
"Acumulado no ano", isso cresce o ano inteiro. O R-15 já agrega no banco.

Índices: `billings.issuedAt` tem; `customer_orders.confirmedAt`,
`purchase_orders.orderDate`, `shipments.confirmedAt` e `receipts.receivedAt` não.
O volume da Veridi é pequeno (76 clientes, 173 produtos, nenhum documento
transacional em PROD): índice novo não é pré-requisito, mas a versão 1 mede com
massa de um ano antes de publicar.

**Recomendação (PROPOSTO): endpoint e read model próprios.**
`GET /management-dashboard?from=&to=`, num módulo próprio, sem crescer o
`GET /dashboard`.

- Mesma transação `RepeatableRead` e mesmo `now` único
  (DASHBOARD-SNAPSHOT-CONSISTENCY-01, DASHBOARD-CONSISTENT-NOW-01).
- Agregação no banco: soma de `totalAmount` e contagem de completos por
  `aggregate`/`groupBy`; ranking por cliente com `groupBy` e junção pequena em
  memória, ou SQL explícito revisado.
- Período anterior como segunda janela, na mesma transação.
- Valor do documento pela função canônica de BILLED-VALUE-CANONICAL-01 — nunca
  uma quinta conta.
- Sem tabela agregada, sem cache, sem job (§30).
- Gráfico em SVG próprio, como o de Movimentações; sem biblioteca de gráfico.

## 7. Gaps

### 7.1 Gap matrix

| # | Indicador | Fonte atual | Confiável? | Gap | Severidade | Ação |
|---|---|---|---|---|---|---|
| G1 | Faturado (R$) | Painel, R-15 e R-14 somam bruto; documentos usam `totalAmount` | **NÃO**, com desconto ou preço de 4 casas | quatro contas para o mesmo número (F1) | HIGH | BILLED-VALUE-CANONICAL-01, antes do Painel Gerencial |
| G2 | A expedir, A faturar, Pedidos confirmados (R$) | preço acordado do Pedido | PARCIAL | Pedido digitado direto não tem preço; o valor só nasce no faturamento, digitado à mão | HIGH | mostrar incompleto (D2, D5); preço em Pedido direto é decisão à parte |
| G3 | Todos os valores | endpoints operacionais sem gate | PARCIAL (acesso) | gate da tela gerencial não protege o dado | MEDIUM | D4; restringir valor nas telas operacionais é decisão separada |
| G4 | Drill-down | listas e relatórios | PARCIAL | relatórios não leem a URL; Pedidos e OCs sem grupos "Carteira" e "Confirmadas"; Expedições sem "a faturar"; Faturamento sem "sem preço completo"; Pedidos sem período por `confirmedAt` | MEDIUM | filtros de URL na versão 1 — só os que os links usam |
| G5 | A receber de fornecedores | OC `PARTIALLY_RECEIVED` | PARCIAL | OC parcialmente recebida não cancela nem encerra saldo: o que o fornecedor não vai entregar fica "a receber" para sempre | MEDIUM | R$ a receber fora da versão 1; encerramento de saldo de OC é decisão do PO (sem ID ainda) |
| G6 | Recebido a custo efetivo | `ReceiptLine.actualUnitCost` | PARCIAL | não há regra de total do recebimento; §55 e §61 não o cobrem | MEDIUM | regra de arredondamento por linha antes de somar — evolução |
| G7 | Margem contratada | snapshots de `QuoteLine` | PARCIAL | não chega ao Pedido nem ao Faturamento; ignora o desconto; linha manual carrega a margem da faixa; COST-VAR-02 bloqueado | HIGH (bloqueia margem) | fora da versão 1; depois das 7 decisões de COST-VAR-01 |
| G8 | Margem realizada, CMV do período | — | NÃO SUPORTADO | não existe custo das vendas por faturamento; desconto não é rateado; comissão e imposto por venda não são modelados | domínio novo | FUTURO |
| G9 | Pago, recebido, caixa, contas a pagar e a receber | — | NÃO SUPORTADO | domínio financeiro inexistente | domínio novo | FUTURO |
| G10 | Faturamento líquido de impostos, carga tributária | — | NÃO SUPORTADO | sem NF-e e sem imposto por venda | domínio novo | FUTURO |
| G11 | Faturado de período passado | `Billing` `ISSUED` imutável | CONFIÁVEL, com limite | faturamento emitido errado não se corrige nem se cancela e fica no indicador | MEDIUM | FUTURO (correção, nota de crédito); a ajuda diz isso |
| G12 | Mês anterior, Acumulado no ano | `business-timezone.ts` | PARCIAL | só existe `primeiroDiaDoMesComercial` | LOW | dois ajudantes no shared, na versão 1 |
| G13 | Pedidos criados (Painel Operacional) | `createdAt` | CONFIÁVEL para operação | conta rascunho e cancelado; não serve de KPI comercial | LOW | nada no Operacional; o Gerencial usa `confirmedAt` |
| G14 | Documento legado | `Billing.totalAmount` nulo; Pedido sem `confirmedAt` | PARCIAL | fallback precisa ser explícito | LOW | regras das seções 6.2 e 6.3; PROD não tem legado transacional |
| G15 | Faturado de um ano | `buildPeriod` carrega em memória | PARCIAL (performance) | todo faturamento do ano com linhas a cada requisição | MEDIUM | agregação no banco, no endpoint novo (6.22) |

### 7.2 Onde o gap já tem nome

- Margem e CMV: COST-VAR-02, bloqueado nas decisões de
  [COST-VAR-01](../archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md).
- Margem da linha enviada: R20-MANUAL-REFERENCE-MARGIN-01 e
  R20-SENT-PRICING-BASIS-SNAPSHOT-01 (`BACKLOG.md`).
- Tributos, frete e landed cost: brainstorm na seção F do `BACKLOG.md`.
- Contas a pagar e a receber: `ROADMAP_POST_MVP.md`, "Fiscal / financeiro".
- Novo nesta rodada: **BILLED-VALUE-CANONICAL-01** (G1), na seção A do
  `BACKLOG.md`. G4, G6, G12 e G15 são escopo das capabilities da seção 13; G5 fica
  como pendência de PO, sem ID.

## 8. Riscos

| Risco | Severidade |
|---|---|
| Número gerencial diferente do documento (G1): o primeiro gestor que conferir um faturamento com desconto perde a confiança na tela inteira | HIGH |
| Carteira parcial lida como total onde a Veridi usa Pedido digitado direto (G2) | HIGH |
| "Financeiro" no nome cria expectativa de contas a receber, contas a pagar e caixa | MEDIUM |
| "Faturado" lido como dinheiro recebido | MEDIUM |
| CMV ou margem lidos como números contábeis | MEDIUM |
| Gate de perfil passa sensação de sigilo que não existe (G3) | MEDIUM |
| `GET /dashboard` virando monólito se o gerencial crescer dentro dele | MEDIUM |
| Painel virando BI: cada corte novo pedido (vendedor, região, canal) sem domínio que o sustente | MEDIUM |
| Tela nasce vazia em PROD; avaliar só com massa de homologação | LOW |
| Faturamento emitido errado permanece no indicador (G11) | MEDIUM |

## 9. Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Crescer o `GET /dashboard` com os blocos monetários | monólito; período e perfis diferentes; o Painel Operacional fica mais lento para todos |
| "Painel Financeiro" usando o plano de pagamento como contas a receber | o plano é condição acordada, com `dueInDays` relativos e sem baixa: seria recebível inventado |
| Valor de OC como "pago" ou "gasto" | §31 proíbe |
| Mostrar subtotal conhecido quando incompleto, em destaque | parece total (§30); fica como alternativa da D2, só em texto secundário |
| Margem pela faixa ativa de hoje aplicada ao faturado | reescreve a negociação com o custo de hoje (§34) e atropela COST-VAR-02 |
| Ratear o desconto por linha para o ranking de produto | cria preço líquido que ninguém acordou (§34) |
| "A faturar" depois do desconto, proporcional | a apropriação real depende de qual documento fecha o Pedido; o número divergiria do faturamento emitido (alternativa da D5) |
| Ranking de produto por quantidade | soma kg, un e L |
| Tabela agregada ou cache mensal | §30 proíbe; o volume não pede |
| Biblioteca de BI ou de gráficos | proibida pela baseline de UI; SVG próprio já resolve o gráfico atual |
| Abas no Painel (B) ou Painel como grupo (A) | seção 6.18 |

## 10. Recomendação

### 10.1 Resposta às duas perguntas

**Com confiança hoje:** faturamento emitido — em contagem já, em reais depois de
BILLED-VALUE-CANONICAL-01 —, posição comercial em número de documentos
(pedidos, expedições a faturar) e compromissos registrados (entregas
programadas, entregas atrasadas, compras esperadas).

**Parcial, e precisa dizer quando está incompleto:** carteira, a faturar e
pedidos confirmados em reais (Pedido digitado direto não tem preço), compras
contratadas (preço de OC é opcional) e recebido a custo efetivo.

**Parece financeiro e seria enganoso:** "receita" ou "recebido" a partir do
faturado; "a receber" a partir do plano de pagamento; "pago" ou "gasto" a partir
da OC; margem, lucro ou CMV do período a partir de custo prospectivo ou de custo
híbrido da OP; faturamento líquido ou carga tributária a partir do imposto
estimado da precificação; ticket médio com Pedido direto sem valor. Nada disso
entra.

O Painel Gerencial não é BI: cerca de seis indicadores, sem widget configurável,
sem corte livre por dimensão, sem exportação na versão 1.

### 10.2 Wireframe textual — versão 1

Valores ilustrativos.

```
PAINEL GERENCIAL                                        Gestão › Painel Gerencial
Faturamento, carteira e compras — valores comerciais, não financeiros.  [Como funciona]

Período: (Mês atual) (Mês anterior) (Acumulado no ano) (Personalizado [de] [até])
         Comparado com: 01/08/2026 a 15/08/2026

RESULTADO DO PERÍODO
┌───────────────────────┬───────────────────────┬───────────────────────┬──────────────────────┐
│ Faturado              │ Pedidos confirmados   │ Compras contratadas   │ Clientes faturados   │
│ R$ 120.450,00         │ 14 pedidos            │ Valores incompletos   │ 9                    │
│ 32 documentos, todos  │ R$ 98.300,00          │ 11 de 13 OCs com      │                      │
│ com preço             │ 14 de 14 com preço    │ preço                 │                      │
│ Anterior R$ 111.300,00│ acordado              │                       │                      │
│ +8,2%                 │                       │                       │                      │
│ Ver faturamentos      │ Ver pedidos           │ Ver ordens de compra  │ Ver ranking          │
└───────────────────────┴───────────────────────┴───────────────────────┴──────────────────────┘

POSIÇÃO ATUAL — não depende do período
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Carteira — preço acordado, antes do desconto do pedido                                     │
│ A expedir  R$ 210.000,00 · 6 pedidos        A faturar  R$ 18.600,00 · 3 expedições         │
│ [██████████████████████████████████████████████████████████████████░░░░░░]                 │
│ Ver pedidos da carteira                     Ver expedições a faturar                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘

TENDÊNCIA — Faturado por mês
  jan ▇▇▇▇  fev ▇▇▇  mar ▇▇▇▇▇ … ago ▇▇▇▇▇▇  set [Incompleto]
  Cada barra abre os faturamentos do mês.

CLIENTES — Faturado no período            PRODUTOS — valor das linhas, antes do desconto
 1. CLI-000012 Cliente A    R$ 40.100,00    1. PA-000031 Produto X   R$ 22.000,00 · 5.000 un
 2. CLI-000007 Cliente B    R$ 25.300,00    2. PA-000018 Produto Y   R$ 19.500,00 · 300 kg
 …                                          …
 Fora do ranking: CLI-000044, com           Quantidade só por produto, na unidade dele.
 documento sem preço.

PRÓXIMOS COMPROMISSOS — hoje e os 29 dias seguintes
 Entregas programadas: 7 · R$ 64.000,00 acordado · 2 atrasadas      Ver pedidos
 Compras esperadas: 4 OCs · R$ 12.800,00 previsto                    Ver ordens de compra

Esta tela não mostra contas a receber, contas a pagar, caixa, impostos, margem nem CMV.
```

### 10.3 Faseamento do produto final

**Versão 1 do Painel Gerencial** — depois de BILLED-VALUE-CANONICAL-01 e das
decisões D1–D5:

- tela própria em Gestão, gate ADMIN e COMMERCIAL, endpoint e read model
  próprios;
- período: Mês atual, Mês anterior, Acumulado no ano, Personalizado, com
  comparação equivalente;
- resultado: Faturado, Pedidos confirmados, Compras contratadas, Clientes
  faturados;
- posição: Carteira (A expedir e A faturar), com a barra de composição;
- tendência: Faturado por intervalo;
- rankings: 10 clientes por Faturado e 10 produtos por valor das linhas;
- próximos compromissos: entregas programadas e atrasadas, compras esperadas;
- "Valores incompletos" em todos os blocos;
- drill-down só para destino que filtra de verdade, com os filtros de URL que
  faltam (G4) entrando junto;
- "Como funciona" dizendo o que a tela não é.

**Evolução posterior** — sem domínio novo:

- A receber de fornecedores em R$ (depois de G5);
- Recebido a custo efetivo (depois de G6);
- Compras por fornecedor (gráfico F);
- Propostas enviadas em aberto — `QuoteVersion` `SENT` não vencida, pelo
  `total` —, rotuladas como proposto;
- margem de contribuição contratada, restrita, depois das decisões de COST-VAR-01;
- bloco de Compras para PURCHASING;
- atalho no Painel Operacional para quem tem perfil;
- PDF do painel.

**Dependente de novo domínio:**

- contas a receber: títulos, vencimento real, baixa, inadimplência;
- contas a pagar: títulos de fornecedor e pagamento;
- caixa, fluxo de caixa e conciliação bancária;
- nota fiscal e imposto por venda: faturamento líquido, carga tributária;
- custo das vendas por faturamento: CMV do período, margem realizada;
- correção de faturamento emitido: devolução, nota de crédito;
- preço acordado em Pedido digitado direto, se a carteira em R$ tiver de ser
  completa sem proposta.

### 10.4 Cenários adversariais

Contra o desenho recomendado da versão 1.

| # | Cenário | Resolve? | Severidade | Observação |
|---|---|---|---|---|
| 1 | Nenhum faturamento | YES | LOW | "—" e "Sem faturamentos no período"; é o estado atual de PROD |
| 2 | Faturamento sem preço completo | YES | MEDIUM | total nulo com "N de M"; o link para os sem preço depende de G4 |
| 3 | Faturamento parcial do pedido | YES | — | cada documento vale o total congelado; A faturar e A expedir saem das linhas |
| 4 | Duas expedições do mesmo pedido | YES | — | um faturamento por expedição; faturado ≤ expedido ≤ pedido em cada linha |
| 5 | Pedido cancelado | PARTIAL | LOW | pedido com expedição não cancela; pedido confirmado e cancelado depois sai de "Pedidos confirmados" também no período passado — leitura escolhida, dita na ajuda |
| 6 | Faturamento emitido depois do período do pedido | YES | — | cada indicador usa a própria data; o gráfico que cruzaria as duas (B) foi descartado |
| 7 | Cliente com vários projetos | YES | — | ranking pelo cliente do Pedido |
| 8 | Produto em várias UOMs | YES | — | ranking em R$; quantidade só por produto e na unidade dele |
| 9 | Compra sem preço | PARTIAL | MEDIUM | "Valores incompletos" em Compras contratadas; preço de OC é opcional por regra |
| 10 | OC parcialmente recebida | PARTIAL | MEDIUM | saldo não encerra (G5); R$ a receber fica fora da versão 1 |
| 11 | Custo prospectivo sem custo realizado | YES | — | a versão 1 não mostra custo nem margem |
| 12 | Período anterior igual a zero | YES | — | "Sem base de comparação", nunca percentual infinito |
| 13 | Documento legado | PARTIAL | LOW | faturamento sem `totalAmount` pela soma das linhas arredondadas; Pedido sem `confirmedAt` fora dos indicadores por período |
| 14 | Desconto | NO hoje; YES com BILLED-VALUE-CANONICAL-01 | HIGH | F1 |
| 15 | Material do cliente | YES | — | fora de Compras e do custo; o faturamento do produto não muda |
| 16 | Imposto ausente | YES | — | nenhum indicador de imposto; a ajuda diz que não é documento fiscal |
| 17 | Cliente sem atividade | YES | — | não entra no ranking; nenhuma linha zerada |
| 18 | Pedido futuro | YES | — | entrega futura aparece em Próximos compromissos; nada no realizado |
| 19 | Faturamento emitido no último minuto do dia em São Paulo | YES | — | `limitesDoDiaComercial` fecha o dia em 23:59:59.999, regra já testada no Painel |
| 20 | Período de um ano | PARTIAL | MEDIUM | exige agregação no banco no endpoint novo (G15) |

## 11. Decisões PO

### D1 — Qual é o valor de "Faturado"

- **Recomendação:** o valor do documento emitido — `Billing.totalAmount`,
  depois do desconto apropriado e do ajuste de fechamento; legado sem ele, pela
  soma das linhas arredondadas. Aplicado também ao Painel Operacional, ao R-15 e
  ao R-14 por BILLED-VALUE-CANONICAL-01, antes do Painel Gerencial.
- **Alternativa:** manter a soma das linhas em todas as superfícies,
  arredondando por linha (§55), e renomear para "Faturado antes do desconto".
- **Impacto:** com desconto, Painel e R-15 passam a mostrar o valor menor, o do
  documento. Nada gravado muda. Na alternativa, o número segue diferente do
  documento que o cliente recebeu.

### D2 — Como a tela trata valores incompletos

- **Recomendação:** card sem número ("Valores incompletos"), "N de M com
  preço" e link para os documentos sem preço; ranking só com linhas completas,
  nomeando quem ficou fora; nenhum subtotal conhecido em card; tendência sem
  variação.
- **Alternativa:** "Subtotal conhecido R$ X (N de M documentos)" em texto
  secundário do card.
- **Impacto:** a recomendação deixa o card sem valor enquanto faltar preço, e
  empurra a Veridi a completar o dado; a alternativa dá um número útil que pode
  ser lido como total.

### D3 — Nome e lugar

- **Recomendação:** "Painel Gerencial", tela própria em Gestão
  (`/gestao/painel-gerencial`); Painel Operacional intacto.
- **Alternativa:** abas Operacional | Gerencial dentro do Painel.
- **Impacto:** a recomendação não mexe na tela inicial de ninguém e usa o gate
  de menu que já existe; a alternativa põe dois recortes de período na mesma
  página.

### D4 — Quem vê

- **Recomendação:** ADMIN e COMMERCIAL na versão 1, numa constante de perfis
  usada pela API, pelo menu e pelo catálogo.
- **Alternativa:** incluir PURCHASING, ou abrir a todos os perfis, como o
  Painel Operacional.
- **Impacto:** o gate é da tela; os mesmos valores continuam legíveis nas telas
  operacionais. Fechar valor de venda nelas é decisão separada.

### D5 — Valor de "A expedir" e "A faturar"

- **Recomendação:** preço acordado do Pedido × quantidade, arredondado por
  linha, **antes do desconto do Pedido**, dito no card; incompleto quando algum
  Pedido não tem preço acordado.
- **Alternativa:** estimar o valor depois do desconto, proporcional ao
  percentual do Pedido.
- **Impacto:** a recomendação é exata sobre o que está gravado; a alternativa
  diverge do faturamento que for emitido, porque a apropriação real depende de
  qual documento fecha o Pedido.

## 12. Pendências PO

- D1 a D5.
- Encerramento de saldo de OC parcialmente recebida (G5): sem ID; o PO decide se
  vira discovery próprio.
- Preço acordado em Pedido digitado direto (G2): só se a carteira em R$ tiver de
  ser completa sem proposta.
- Posição de BILLED-VALUE-CANONICAL-01 na fila viva.

## 13. Escopo recomendado

Duas capabilities, nesta ordem:

1. **BILLED-VALUE-CANONICAL-01** — função única do valor do faturamento emitido;
   Painel, R-15 (tela, CSV e PDF) e R-14 passam a usá-la; testes com desconto,
   ajuste de fechamento, preço de quatro casas e legado; comentário de
   `SummaryTab.tsx` corrigido. Sem migration.
2. **MANAGEMENT-DASHBOARD-V1-01** — a versão 1 da seção 10.3.

## 14. Fora do escopo

- Redesenho do Painel Operacional.
- Contas a pagar, contas a receber, caixa, conciliação, NF-e e impostos.
- Margem, CMV do período e custo das vendas.
- Previsão estatística, metas e orçamento anual.
- BI configurável: widgets, cortes livres, filtros por dimensão arbitrária.
- Tabela agregada, cache e job.
- Acabamento mobile e tablet (fase atual é desktop).

## 15. Próxima capability

**BILLED-VALUE-CANONICAL-01**, depois da decisão D1. Em seguida,
**MANAGEMENT-DASHBOARD-V1-01**, depois de D2 a D5.

## 16. Implementação

**NÃO IMPLEMENTADO.**

`READY_TO_IMPLEMENT: NO` — há gap HIGH (G1) com decisão pendente (D1) e
decisões abertas sobre dinheiro (D2, D5) e permissão (D4), que o
`/erp-functional-reviewer` exige resolvidas antes de implementar.
BILLED-VALUE-CANONICAL-01 fica pronto para implementar assim que D1 for
respondida.

## 17. Histórico de decisões

| Data | Registro | Motivo |
|---|---|---|
| 2026-09-15 | Discovery aberto em `EM_ANALISE`, com recomendações e cinco decisões de PO pendentes | rodada inicial |
| 2026-09-15 | **Addendum.** D1 decidida pelo PO: "Faturado" é `Billing.totalAmount` (a recomendação da seção 11). BILLED-VALUE-CANONICAL-01 implementada no mesmo dia: Painel, R-14 e R-15 (tela, CSV e PDF) leem `billings/billed-value.ts`; emitido legado sem total congelado vale a soma das linhas arredondadas; sem preço completo não há valor nem total. O resto do documento fica como foi escrito, e o discovery segue `EM_ANALISE` com D2–D5 abertas | handoff BILLED-VALUE-CANONICAL-01 |
