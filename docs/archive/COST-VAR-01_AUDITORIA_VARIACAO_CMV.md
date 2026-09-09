# COST-VAR-01 — Auditoria: variação de CMV e proteção de margem

**Rodada de auditoria. Nada de runtime foi alterado. Nenhuma migration criada.
Documento de decisão para o Product Owner — STOP GATE.**

- Base: `main` == `origin/main`, HEAD `592c126`, 60 migrations.
- Data da auditoria: 2026-09-09.
- Método: leitura de código e de `docs/PRODUCT_RULES.md`; execução somente
  leitura dos motores canônicos do projeto contra DEV; inventário somente
  leitura de PROD via `railway run -s Postgres`.

---

## 1. A dor, traduzida para o domínio real

O negócio pediu quatro respostas. Elas se traduzem assim:

| Pergunta do usuário | Termo real do projeto |
|---|---|
| "qual era o custo das matérias-primas naquele momento" | `IndustrialCostCalculation` (CALC) — base econômica congelada; e o snapshot da linha do orçamento |
| "quanto meu CMV mudou" | diferença entre `PricingTier.costPerUnitSnapshot` / `QuoteLine.industrialCostPerUnitSnapshot` e `costForOutputQuantity` com a data de hoje |
| "quanto minha margem mudou" | `contributionMarginPercent` — **margem de contribuição**, nunca lucro |
| "quanto eu teria que subir o preço" | `P = C / (1 − m − c)` de `@veridi/shared/pricing-math.ts` |

A palavra **lucro** não pode ser usada. O sistema calcula margem de
contribuição (preço − comissão − custo industrial) e markup. Impostos,
despesas financeiras, frete comercial e despesas administrativas não estão
modelados.

---

## 2. O motor canônico de CMV

Não existe entidade `Cmv`, tabela de CMV nem segundo motor. A cadeia é:

```
selectItemCostSource            (lib/cost-source-selection.ts)   fonte do custo unitário do material
  └─ getItemCostReference       (lib/cost-reference.ts)          passos 1–3 (compra real)
computeFormulationRequirements  (production-orders/requirement-calc.ts) quantidade física
costForOutputQuantity           (pricing/pricing-cost.ts)        custo industrial de UMA quantidade
  ├─ consumido por PricingTier  (pricing.service.ts)
  ├─ consumido por getProductCmv(product-cmv.service.ts)
  └─ consumido por rebase-preview (pricing.service.ts)
computePrice                    (@veridi/shared/pricing-math.ts) preço, contribuição, markup
```

`product-cmv.service.ts` **orquestra, não calcula** — escolhe documentos
(formulação ativa, estrutura ativa, CALC vigente) e agrupa o resultado.

Endpoints de leitura relevantes:

| Endpoint | O que responde |
|---|---|
| `GET /products/:id/cmv?quantity=&referenceDate=` | CMV congelado **e** simulação com os dados de hoje, com composição linha a linha nos dois |
| `GET /formulation-versions/:id/cost-estimate` | estimativa de material da formulação numa data |
| `GET /items/:id/cost-reference` | fonte que a seleção automática usaria numa data |
| `GET /industrial-costs/:id/calculate` | prévia do cálculo industrial (não persiste) |
| `GET /pricing-versions/:id/rebase-preview` | custo por faixa **na base atual × na base nova**, com o preço ao lado |

---

## 3. Hierarquia real das fontes de custo (§53)

`COST_SOURCE_PRIORITY` em `lib/cost-source-selection.ts`:

| # | Fonte (símbolo real) | Prospectiva/real | Data de referência | Alimenta CMV | Auditável historicamente |
|---|---|---|---|---|---|
| 1 | `WEIGHTED_AVG_30D` — média ponderada de `ReceiptLine.actualUnitCost` nos 30 dias até `referenceDate` | real | sim (`fimDoDia`) | sim | sim (ReceiptLine imutável) |
| 2 | `WEIGHTED_AVG_90D` | real | sim | sim | sim |
| 3 | `LAST_REAL` — última `ReceiptLine` com custo, sem limite de idade | real | sim | sim | sim |
| 4 | `SUPPLIER_OFFER_PREFERRED` / `SUPPLIER_OFFER_SINGLE_APPROVED` — `SupplierItemOffer` | prospectiva | sim (`effectiveAt`/`validUntil`) | sim | sim (oferta imutável) |
| 4b | `AMBIGUOUS_SUPPLIER_REFERENCE` — ofertas existem, falta escolher | — | sim | **não** (custo fica desconhecido) | — |
| 5 | `MANUAL_REFERENCE` — `ItemCostReference` | prospectiva | sim (`effectiveFrom`) | sim | sim (nova linha por vigência) |
| 6 | `NO_COST` | — | — | não | — |
| — | `EXCLUDED_CUSTOMER_SUPPLIED` | fora do custo Veridi | — | não | — |
| — | `REAL` — custo do lote efetivamente consumido | realizado | `consumedAt` | só custo realizado de OP | sim |

A prioridade é **entre categorias**: ambiguidade dentro de "oferta válida"
não pula para a referência manual.

`REAL` nunca sai da seleção prospectiva; ele existe só em
`getConsumedLotCostReference`, para custo de OP.

**Preço de OC (`PurchaseOrderLine.unitPrice`) nunca vira custo**, em nenhum
degrau. Também não existe conceito de "valor efetivamente pago" — é camada
financeira futura, explicitamente fora de escopo (§31 e ROADMAP).

---

## 4. Item × Fornecedor entra no CMV? **SIM na regra, NÃO nos dados**

**Na regra:** sim, degrau 4. Condições cumulativas em `resolveSupplierOfferCost`:

- `SupplierItem.active = true` e `qualificationStatus = APPROVED`;
- `Supplier.active = true`;
- `currencyCode = "BRL"` (sem câmbio nesta fase);
- `effectiveAt != null` **e** `effectiveAt <= referenceDate`;
- `validUntil == null` **ou** `validUntil >= referenceDate`;
- `priceUomCode` convertível para a unidade de estoque do item.

Desempate: uma oferta válida → usa; várias com exatamente um `preferred` →
usa o preferencial; várias sem preferencial (ou mais de um) →
`AMBIGUOUS_SUPPLIER_REFERENCE`, custo **desconhecido**.

**Nos dados (medido em DEV e em PROD, 2026-09-09):**

```
offersTotal            602      (DEV e PROD idênticos)
offersSemVigencia      602      effectiveAt = NULL
offersValidasHoje        0
offersPorSource        LEGACY_IMPORT:602
offersPorMoeda         BRL:602
SupplierItems APPROVED+ativos com oferta   370
  ...com ao menos uma oferta com effectiveAt  0
itens com >1 fornecedor homologado ofertando 90
  ...destes, sem nenhum preferencial          90
SupplierItems com preferred = true            0
```

Consequência provada por execução do seletor canônico:

```
ITEM MP-000002 (Cloridrato de tiamina)
  5 ofertas homologadas: 248 / 280 / 320 / 349 / 349 BRL/kg  — todas eff=NULL
  referência manual: 334,50/kg
  SELEÇÃO EM 2026-09-09: MANUAL_REFERENCE = 334,50
```

**Hoje, nenhuma oferta de fornecedor alimenta CMV em lugar nenhum do
sistema.** É comportamento correto e documentado (§5.3: preço legado sem data
de cotação é observação histórica, nunca preço vigente), mas significa que o
degrau 4 está inteiramente inerte.

**Risco de ativação:** se alguém passar a informar `effectiveAt` nessas
ofertas sem antes definir o fornecedor preferencial, os 90 itens
multi-fornecedor caem em `AMBIGUOUS_SUPPLIER_REFERENCE` — custo desconhecido,
CMV `PARTIAL`, preço por margem indisponível. Hoje esses mesmos itens têm
custo (referência manual). Ativar vigência **piora** o CMV se o preferencial
não vier junto.

---

## 5. Imutabilidade da oferta e reconstrução histórica

`SupplierItemOffer` é imutável por regra (§5.3) e o schema não tem
`updatedAt`: mudou preço, MOQ, moeda ou vigência, nasce oferta nova. Isso
**basta** para reconstruir "qual oferta estava válida na data X" — a consulta
por `effectiveAt <= X AND (validUntil IS NULL OR validUntil >= X)` é
determinística e é exatamente a que o seletor usa.

Nada garante no banco que duas ofertas do mesmo `SupplierItem` não tenham
vigências sobrepostas. O seletor resolve pegando a de `effectiveAt` mais
recente (`orderBy: [{effectiveAt:"desc"},{createdAt:"desc"}]`), o que é
estável mas não é uma trava.

---

## 6. Moeda e MOQ

**Moeda:** `SupplierItemOffer.currencyCode` é gravado e **nunca convertido**.
O filtro do seletor é `currencyCode: "BRL"` literal — oferta em USD/EUR
simplesmente não é candidata e não vira custo BRL por nenhum caminho.
`ItemCostReference.currencyCode` tem default `"BRL"` e **não é filtrado** pelo
seletor: uma referência manual gravada em outra moeda entraria como se fosse
BRL. Hoje as 293 referências existentes são BRL, então não há erro em campo —
mas é uma porta aberta.

**MOQ:** `minimumOrderQuantity` + `minimumOrderUomCode` na oferta. **Não
participa da escolha da oferta nem do custo unitário.** Ele age só na
Sugestão de Compra, como recomendação (`max(falta, MOQ)`), nunca como bloqueio
(§5.3). Preço unitário e viabilidade de MOQ são coisas separadas, e continuam
separadas.

---

## 7. Recebimento — o que entra no custo

Três conceitos que o projeto nunca mistura (§31):

1. **preço de OC** — `PurchaseOrderLine.unitPrice`, previsto/negociado;
2. **custo efetivo de aquisição** — `ReceiptLine.actualUnitCost`, informado
   por gente, `PUT /receipt-lines/:id/acquisition-cost`;
3. **valor efetivamente pago** — **não existe** como conceito no modelo. É
   camada financeira futura e nunca é inferido do custo nem da OC.

O custeio nunca reabre o recebimento físico: `setAcquisitionCost` jamais toca
quantidade, item, lote ou fornecedor, e jamais cria `InventoryMovement`.
`null` é desconhecido, `0` é zero informado, negativo é recusado. Recebimento
`CUSTOMER_SUPPLIED` recusa custo de aquisição por regra de domínio.

A média das janelas 30d/90d é **ponderada por quantidade recebida**, e só
consome linhas com `actualUnitCost` realmente informado.

---

## 8. `referenceDate` — provado, com um furo

A auditoria executou os motores canônicos contra DEV, somente leitura:

```
ITEM MP-000005 (Cianocobalamina) ref=27000/kg desde 2026-09-07
  em 2025-01-01: NO_COST null
  em 2026-09-09: MANUAL_REFERENCE 27000

COMPRA MP-ECO-…-HPTL2 recebida 2026-09-09, custo 10
  em 2026-08-01 (antes):  NO_COST null
  em 2026-09-09 (no dia): WEIGHTED_AVG_30D 10  "Média ponderada de 1 recebimento(s) nos últimos 30 dias."
  em 2027-06-01 (+9m):    LAST_REAL 10         "Último custo real conhecido (REC-045246, 09/09/2026)."

FORM PROD-101635 V1 @2026-09-09: quality=ESTIMATED total=1,00
FORM PROD-101635 V1 @2025-01-01: quality=NO_COST  semCusto=[MP-ECO-…]

CMV PROD-101635 @2026-09-09: base=CALC-026351 total=1001,0000 perUnit=1,0010 COMPLETE_REAL_REFERENCE
                             live  total=1001,0000 perUnit=1,0010 COMPLETE_REAL_REFERENCE
CMV PROD-101635 @2026-08-01: base=—  "Não há cálculo de custo salvo até esta data de referência."
                             live  quality=PARTIAL (material sem custo naquele dia)
```

**Sim: o mesmo produto calculado em duas datas devolve dois resultados
historicamente coerentes**, e a escolha do CALC respeita
`costReferenceDate <= fimDoDia(referenceDate)`.

**Furo encontrado (baixo impacto, mas real):** a comparação de vigência da
oferta usa `params.referenceDate` cru, enquanto compra real e referência
manual usam `fimDoDia(referenceDate)`
(`cost-source-selection.ts`, `resolveSupplierOfferCost`). Uma oferta que passa
a valer no próprio dia da consulta (`effectiveAt` gravado às 00:00 UTC do dia
D) entra — porque `00:00 <= 00:00` —, mas uma gravada com hora não-zero no
dia D não entraria. Como `referenceDate` chega da rota sempre como
`T00:00:00.000Z`, a assimetria é latente, não ativa. Vale alinhar quando a
capability for implementada.

**Lacuna de prova:** não existe teste cobrindo "oferta A vigente até 30/09,
oferta B a partir de 01/10 → CMV em 01/10 antecipa o aumento". Em
`cost-source-selection.test.ts` toda oferta é criada com
`effectiveAt = ontem` e `validUntil = null`; nenhum caso varia
`referenceDate` contra vigência de oferta. O código suporta (a query filtra
pelos dois lados); a capacidade **não está protegida por teste** e nenhum dado
real a exercita.

**Preço futuro (§28):** pela mesma query, `referenceDate` futura já seleciona
a oferta que valerá naquele dia. Portanto, com vigências informadas, o CMV
futuro antecipa o aumento sem código novo. Sem vigências (situação atual),
não antecipa nada.

**Oferta expirada (§27):** se a única oferta expirou, ela sai do conjunto de
candidatos e o motor **cai para o degrau 5** (referência manual) e, na
ausência dela, para `NO_COST`. Não usa a oferta anterior, não usa último real
(esse já foi tentado antes, nos degraus 1–3) e nunca usa zero.

---

## 9. Custo desconhecido e material do cliente

**Fail-closed, confirmado.** `costForOutputQuantity` só produz `total` quando
`complete === true`. Faltando material, recurso ou premissa, `total = null`,
`quality = PARTIAL` (ou `NO_COST`) e o que existe é servido como
`knownSubtotal`, rotulado como subtotal. A tela mostra **"CMV indisponível"**
mais o subtotal conhecido. `R$ 0,00` nunca substitui desconhecido.

Linha percentual sobre custo direto só é aplicada quando o direto está
completo — aplicar sobre subtotal parcial produziria overhead menor que o
real.

**Material do cliente:** `FormulationComponent.supplyResponsibility = CUSTOMER`
mantém a quantidade física, não entra no custo, **não degrada a qualidade**
(o motor conta só componentes Veridi) e gera aviso
`CUSTOMER_SUPPLIED_MATERIAL`. Do lado realizado, `Lot.ownerType = CUSTOMER`
tem o mesmo tratamento. Uma referência manual no item não muda isso.
No CMV aparece no grupo próprio `CUSTOMER_SUPPLIED`.

---

## 10. Qualidade da fonte (§31 do handoff)

`ItemCostReference` **não tem** coluna `confidence`, `source` nem `method`.
Tem `unitCost`, `currencyCode`, `uomCode`, `effectiveFrom`, `note`, autoria.

A confiança existe, mas como **texto dentro de `note`**: o carregador
`scripts/veridi-market-reference/load.ts` grava
`"… · HIGH_CONFIDENCE · fonte: … · registrado em …"`, com três tiers
(`COMPRA_REAL`, `OFERTA_FORNECEDOR`, `PESQUISA_MERCADO`). Ou seja: a
informação está no banco, mas em prosa — não é filtrável, agregável nem
tipada.

O que a UI **já** consegue distinguir sem coluna nova é a **fonte
selecionada** (`IndustrialMaterialCostSource`), que é enum e viaja no
breakdown de cada componente. Uma UI de comparação pode hoje mostrar
"custo real de compra / oferta válida / referência manual / desconhecido"
por componente. O que ela **não** consegue é dizer "estimativa de baixa
confiança" sem parsear string.

---

## 11. O que cada documento congela

| Documento | Total | Componentes | Fonte do custo | Data de referência | Quantidade/base | Custo industrial |
|---|---|---|---|---|---|---|
| `IndustrialCostCalculation` (CALC) | `totalIndustrialCost`, `directIndustrialCost`, `overheadCost`, `knownSubtotal`, `costPerUnit`, `costPer1000` | **sim** — `result` (JSON) com materiais/recursos/premissas | **sim**, `costSource` por material dentro de `result` | `costReferenceDate` | `referenceOutputQuantity` + `referenceOutputUomCode` | é ele |
| `PricingVersion` | — | — | `costQualitySnapshot` | `costReferenceDateSnapshot` | — | aponta o CALC (`industrialCostCalculationId`) |
| `PricingTier` (na ativação) | `costTotalSnapshot`, `costPer1000Snapshot`, `knownSubtotalSnapshot` | **não** | `costQualitySnapshot` | herda da versão | `quantity` + `uomCode`, `batchCountSnapshot` | `costPerUnitSnapshot` (24,12) |
| `QuoteLine` (no envio) | — | **não** | `costQualitySnapshot`, `pricingWarningsSnapshot` | `costReferenceDateSnapshot` | `quotedQuantity` + `uomCode`, `pricingTierQuantitySnapshot` | `industrialCostPerUnitSnapshot` (24,12), `costCalculationCodeSnapshot`, `costStructureLabelSnapshot`, `formulationVersionNumberSnapshot` |
| `CustomerOrderLine` | — | **não** | **não** | **não** | `orderedQuantity` | **não** |
| `ProductionOrderCostSnapshot` | `totalIndustrialCost`, `knownSubtotal`, `actualMaterialCostKnown`, `standardAppliedCostKnown` | **sim** — `breakdown` (JSON) | dentro do breakdown | `completedAt` | `producedQuantity` | `costPerProducedUnit` |

Além do custo, a `QuoteLine` congela a economia inteira:
`commissionPercentSnapshot`, `contributionPerUnitSnapshot`,
`contributionMarginSnapshot`, `markupSnapshot`,
`pricingSelectedUnitPriceSnapshot`.

**O Pedido é deliberadamente pobre em custo.** `CustomerOrderLine` guarda
`agreedUnitPrice`, `agreedPriceSource` e a identidade da faixa
(`agreedPricingCode`, `agreedPricingVersionNumber`, `agreedPricingTierQuantity`,
`agreedPricingTierUom`) — "custo, margem, markup e comissão continuam sendo
informação interna do orçamento e não atravessam para o Pedido". O caminho
até o custo existe via `sourceQuoteLineId → QuoteLine`, que é único e
`SetNull` em delete.

---

## 12. Orçamento: o que já congela e o que a validade faz

`sendQuoteVersion` (§17 do handoff):

- exige `validUntil` — rascunho pode não ter, documento enviado não;
- exige linhas com quantidade, unidade e preço;
- congela cliente/projeto (código, nome, CNPJ, endereço completo);
- chama `buildLineSnapshots`, que congela **linha a linha** a cadeia
  PREC → CALC → estrutura → formulação, mais custo, comissão, contribuição,
  margem, markup e avisos;
- custo incompleto (`PARTIAL`/`NO_COST`) só passa com
  `confirmIncompleteCost` — e essa exigência vale **só** para linha que
  precificou pela faixa.

**Preço herdado, custo de hoje (§74):** linha cujo preço não veio de faixa
(acordo mantido, reajustado ou manual) também congela economia — a referência
é a faixa da precificação ATIVA com a mesma quantidade física. Se não houver
faixa equivalente, a linha vai só com o snapshot do produto e **fica sem base
econômica**. Isso é deliberado, e é a principal razão pela qual, hoje, muitas
linhas não têm CMV congelado.

**Validade (§71):**

- obrigatória no envio, opcional no rascunho;
- é **data civil** (`validUntil`), não número de dias — não existe campo
  "3 dias" ou "5 dias"; quem escolhe a data é quem monta a proposta;
- "vencida" é estado **derivado** a cada leitura (`expired` no DTO), comparando
  dias em `America/Sao_Paulo`; não existe status `EXPIRED` e nada varre o banco;
- aceite de proposta vencida é **recusado** (`QuoteExpiredError`, erro de
  domínio em português);
- aceita **não vence retroativamente**: `createOrderFromAcceptedQuote` não
  consulta `validUntil`. O Pedido pode ser materializado semanas depois com o
  preço intacto;
- recompra = **QuoteVersion nova no mesmo projeto** (§69); não abre projeto,
  não existe pedido recorrente.

Os "3 ou 5 dias" do negócio hoje só existem como escolha manual de data. Não
há default, nem por cliente, nem por tipo de cliente.

---

## 13. Preço, margem e preço sugerido

Conta canônica, pura, em `packages/shared/src/pricing-math.ts`
(`computePrice`), usada pela API e pela prévia da tela — motor único:

```
P = C / (1 − m − c)                       preço sugerido por margem alvo
comissão/un      = P × c
contribuição/un  = P − (P × c) − C
margem contrib.% = contribuição/un ÷ P × 100
markup %         = (P ÷ C − 1) × 100
```

`C` = custo industrial por unidade da faixa. `m` = margem alvo. `c` = comissão
sobre o preço **bruto**. Regras duras já implementadas:

- custo incompleto **não** vira preço pela margem (`TARGET_PRICE_UNAVAILABLE`);
- `m + c >= 100%` → `TARGET_PRICE_IMPOSSIBLE`, sem preço;
- contribuição negativa é informação legítima, nunca zerada
  (`NEGATIVE_CONTRIBUTION`);
- markup indefinido para custo zero (`MARKUP_UNDEFINED`).

**Pergunta §18 — se o CMV sobe de 10 para 11 mantendo margem e comissão, o
sistema calcula o novo preço sugerido?**
**SIM, a conta existe e é pura.** `computePrice({priceMode:"TARGET_MARGIN",
costPerUnit:"11", targetMarginPercent, commissionPercent})` devolve
`suggestedUnitPrice` sem tocar em banco. O que **não** existe é um chamador
que faça isso com o custo de hoje contra um preço já acordado — hoje
`computePrice` só é invocado ao montar/ativar faixa e na prévia de faixa.

**Pergunta §19 — com preço congelado do orçamento + CMV atual, dá para derivar
a margem atual?**
**SIM, e todos os operandos existem.**

```
P  = QuoteLine.unitPrice            (ou CustomerOrderLine.agreedUnitPrice)
c  = QuoteLine.commissionPercentSnapshot
C₀ = QuoteLine.industrialCostPerUnitSnapshot          (custo da proposta)
C₁ = getProductCmv(...).live.costPerUnit              (custo de hoje)

margem da proposta = (P − P·c − C₀) ÷ P × 100     ← já congelada em contributionMarginSnapshot
margem com custo de hoje = (P − P·c − C₁) ÷ P × 100
ΔCMV absoluto = C₁ − C₀        ΔCMV % = (C₁ − C₀) ÷ C₀ × 100
preço para preservar a condição = C₁ ÷ (1 − m₀ ÷ 100 − c)   com m₀ = contributionMarginSnapshot
```

**Nada disso é calculado hoje.** A lacuna é de composição, não de motor.

---

## 14. Explicação da variação por componente (§26)

**Já é possível, e a informação já trafega.** `GET /products/:id/cmv` devolve
`simulation.components[]` (base congelada) **e** `live.components[]` (dados de
hoje), cada componente com `itemId`, `code`, `requiredQuantity`, `unitCost`,
`totalCost`, `costSource`, `group`. Diferenciar as duas listas por `itemId`
produz exatamente "Cafeína +R$ 0,31 · Pote +R$ 0,08 · Rótulo +R$ 0,04".

O `CALC` guarda o mesmo detalhamento em `result` (JSON), então a base
congelada é reconstruível mesmo sem recalcular.

Duas ressalvas:

1. o **diff não é computado** em lugar nenhum — nem API, nem tela;
2. as duas listas podem ter componentes diferentes quando a formulação mudou
   entre a base e hoje. O CMV já detecta isso (`basisFormulationVersionNumber`
   ≠ `formulationVersionNumber` → `formulacaoDefasada`), mas um diff ingênuo
   apresentaria "componente novo" como variação de preço. Precisa separar
   *mudou o preço* de *mudou a receita*.

O que **falta** para explicar a variação a partir de um **orçamento**: a
`QuoteLine` congela só `industrialCostPerUnitSnapshot` (um número), não a
composição. Para abrir a variação por componente de um orçamento é preciso
navegar `costCalculationCodeSnapshot → IndustrialCostCalculation.result`, que
existe e é imutável. **É suficiente**, e não exige tabela nova.

---

## 15. Comparação fundamental — desenho conceitual

Com a fórmula real do projeto:

```
SNAPSHOT DA PROPOSTA (ORC-000123 · linha PROD-000045)
  quantidade          1.000 un
  CMV/un   C₀         R$ 10,0000    QuoteLine.industrialCostPerUnitSnapshot
  preço/un P          R$ 16,0000    QuoteLine.unitPrice
  comissão c          5,00 %        QuoteLine.commissionPercentSnapshot
  contribuição/un     R$  5,2000    QuoteLine.contributionPerUnitSnapshot
  margem contrib.     32,50 %       QuoteLine.contributionMarginSnapshot
  base do custo       CALC-000987 @ 2026-09-01

ESTIMATIVA DE HOJE (2026-09-09)
  CMV/un   C₁         R$ 11,4000    getProductCmv(...).live.costPerUnit
  preço/un P          R$ 16,0000    inalterado — documento histórico não se reescreve
  contribuição/un     R$  3,8000    P − P·c − C₁
  margem contrib.     23,75 %

VARIAÇÃO
  ΔCMV                +R$ 1,4000    +14,00 %
  Δmargem             −8,75 p.p.
  por componente      Cafeína +0,31 · Pote +0,08 · Rótulo +0,04 · … (diff dos breakdowns)

PREÇO PARA PRESERVAR A CONDIÇÃO
  P' = C₁ ÷ (1 − 0,3250 − 0,0500) = 11,40 ÷ 0,6250 = R$ 18,2400
  recomendação — nunca substitui o preço do orçamento nem o do Pedido
```

Toda a aritmética acima usa funções que já existem. Nenhuma fórmula nova.

---

## 16. Dados reais medidos (somente leitura, 2026-09-09)

| Métrica | DEV | PROD |
|---|---|---|
| Products | 300 | 215 |
| Items | 4.081 | 796 |
| Materiais (MP + embalagem) | 922 | 581 |
| SupplierItems | 639 | 639 |
| SupplierItems APPROVED + ativos | 449 | 449 |
| SupplierItemOffers | 602 | 602 |
| ...válidas hoje | **0** | **0** |
| ...sem vigência (`effectiveAt = NULL`) | 602 | 602 |
| ...expiradas / futuras | 0 / 0 | 0 / 0 |
| ...com MOQ informado | 537 | 537 |
| `SupplierItem.preferred = true` | **0** | **0** |
| ItemCostReferences | 293 | 293 |
| ...itens com >1 vigência | **0** | **0** |
| Receipts / ReceiptLines | 85 / 87 | **0 / 0** |
| ReceiptLines com `actualUnitCost` | 76 | **0** |
| Itens com custo real de compra | 57 | **0** |
| PurchaseOrders | 89 | **0** |
| **Materiais sem nenhuma fonte de custo** | **572 de 922 (62 %)** | **288 de 581 (50 %)** |
| Materiais com oferta válida | 0 | 0 |
| Materiais só com referência manual | 293 | 293 |
| IndustrialCostVersions / ativas | 68 / 68 | 2 / **0** |
| IndustrialCostCalculations | 87 (76 completos, 11 parciais) | **0** |
| PricingVersions / ativas | 81 / 62 | **0 / 0** |
| PricingTiers com `costPerUnitSnapshot` | 76 de 81 | 0 |
| Quotes | 50 (29 ACCEPTED, 6 SENT, 9 ARCHIVED, 6 DRAFT) | 9 (todas ARCHIVED) |
| Quotes com `validUntil` | 39 | 0 |
| QuoteLines | 40 (todas `priceSource = MANUAL`) | **0** |
| **QuoteLines com CMV congelado** | **0** | **0** |
| QuoteLines com `pricingTierId` | 0 | 0 |
| QuoteLines por `priceOrigin` | MANUAL 14 · INHERITED 5 · ADJUSTED 2 · null 19 | — |
| CustomerOrders / linhas | 38 / 42 (29 com origem em orçamento) | 0 / 0 |
| ProductionOrderCostSnapshots | 2 | 0 |
| Lotes `ownerType = CUSTOMER` | 0 | 0 |

**Leituras obrigatórias destes números:**

1. **PROD não tem nenhuma compra recebida.** Os degraus 1–3 da hierarquia
   estão vazios. Toda a capacidade de custo em produção repousa sobre 293
   `ItemCostReference` — degrau 5, a fonte de menor prioridade e a única
   classificada como estimativa.
2. **PROD não tem nenhum CALC nem nenhuma precificação.** Não há base
   congelada de custo em produção. Qualquer comparação "custo do orçamento ×
   custo de hoje" em PROD não tem o primeiro termo.
3. **Nenhuma QuoteLine, em DEV ou PROD, tem CMV congelado.** As colunas
   existem desde a migration e `buildLineSnapshots` as preenche; o que falta é
   linha originada de faixa (`priceSource = PRICING_TIER`) ou linha com faixa
   ativa equivalente. 100 % das linhas de DEV são `MANUAL` sem faixa
   correspondente.
4. **Metade das matérias-primas não tem custo nenhum.** 288 em PROD, 572 em
   DEV. Qualquer CMV que as toque sai `PARTIAL`.
5. As 293 referências manuais têm todas a **mesma vigência**, `2026-09-07`.
   Não existe histórico de vigência a reconstruir — o histórico começa agora.

---

## 17. Cenários reais (§35) — o que a massa permitiu e o que não permitiu

**A. boa cobertura de preços.** Não existe em PROD (0 CALC). Em DEV só
existem produtos gerados por suíte automatizada (`Projeto Economia …`,
`Projeto Cadeia …`), com um único componente. Usado como cenário A:
`PROD-101635`, CMV 1.000 un = R$ 1.001,00, `COMPLETE_REAL_REFERENCE`,
composição `MP-ECO-…: R$ 1.000,00` + `ENERGY: R$ 1,00`.

**B. parte das matérias-primas sem custo.** Existe e é abundante: 11 CALC
`PARTIAL` em DEV (ex.: `CALC-023592` / `PROD-089668`, subtotal conhecido
R$ 1,00, total `null`). A faixa correspondente `PREC-018510` tem
`costPerUnitSnapshot = null`, `contributionMarginSnapshot = null` e
`selectedPriceSnapshot = 12,50` — preço manual sobre custo desconhecido, com
margem indisponível. É exatamente o comportamento fail-closed esperado.

**C. oferta de fornecedor com mudança de vigência.** **Não existe.** Nenhuma
das 602 ofertas tem `effectiveAt`, em nenhum dos dois ambientes. Cenário
impossível de montar sem fabricar dado — e fabricar preço está fora do escopo
desta rodada.

**Cenário temporal (§36).** Feito com massa existente, sem escrita, e
reportado na seção 8. O eixo que variou foi a data, não o dado: o mesmo item
responde `NO_COST` → `WEIGHTED_AVG_30D` → `LAST_REAL` conforme a
`referenceDate` anda; o mesmo produto responde CMV completo em 09/09 e
"sem cálculo salvo até esta data" em 01/08. A variação **de preço de
material** entre duas datas não pôde ser demonstrada com dado real porque
todos os 87 recebimentos de DEV têm a mesma data (2026-09-09) e PROD não tem
nenhum.

---

## 18. Infraestrutura de alertas — o que já existe

Existe, e não é preciso inventar nada:

- `dashboard/attention.service.ts` → `buildAttentionList`, com
  `AttentionItemDTO` (`type`, `severity`, `description`, `code`,
  `relevantDate`, `targetKind`, `targetId`) e `AttentionGroupDTO` para
  agrupar. Severidades `CRITICAL` / `WARNING` / `INFO`;
- **nada é persistido**: a atenção é derivada do read model a cada leitura.
  Não há tabela de alerta nem severidade gravada;
- hoje cobre lote vencido/a vencer, CoA pendente, OP com falta, OP com custo
  incompleto, pedido aguardando produção/expedição, entrega prevista;
- do lado do custo já existe `IndustrialCostWarningDTO` com códigos
  (`MATERIAL_COST_UNKNOWN`, `RESOURCE_RATE_UNKNOWN`, `ENERGY_UNKNOWN`,
  `NEGATIVE_CONTRIBUTION`, `TARGET_PRICE_UNAVAILABLE`, …) e `target`
  (`RECEIPT` / `PURCHASE` / `RESOURCE` / `ENERGY` / `STALE_BASIS`) — o read
  model do CMV já descobre **o que a pessoa precisa fazer** para cada custo
  faltante.

Um aviso de variação de CMV cabe nessa infraestrutura sem schema novo.

---

## 19. Recompra (§24) — onde a dor encosta

`quote-price-origin.service.ts` já implementa §74: ao montar orçamento novo
num projeto aprovado, cada linha escolhe entre manter a condição aceita,
reajustar por percentual, usar a precificação atual ou preço manual. A
condição anterior é uma `QuoteLine` de proposta ACEITA do mesmo projeto e
produto, escolhida deterministicamente por `acceptedAt`.

Só um caso vem pré-selecionado: condição vigente **e** mesma quantidade
física. Manter condição vencida ou de outra quantidade exige confirmação e
motivo gravado.

**O que já está lá:** último preço vendido (`inheritedFromQuoteLine.unitPrice`)
e último CMV daquele acordo (`inheritedFromQuoteLine.industrialCostPerUnitSnapshot`,
quando existe).
**O que falta:** o CMV de hoje ao lado, e a variação. É o encontro mais
direto entre a dor relatada e o que já está construído — a tela de formação
de preço da recompra é onde a pessoa está decidindo exatamente isso.

---

## 20. Histórico de CMV: recalcular × persistir

**A — recalcular por `referenceDate`.**
Já funciona e está provado (seção 8). Determinístico **enquanto** os dados de
origem não mudarem. Não é: informar hoje o custo de um recebimento de agosto
altera a resposta de "quanto custava em agosto". Isso é deliberado e
documentado (§31: "informar um custo depois melhora automaticamente a
qualidade dos custos de produção passados"). Ou seja, recálculo histórico é
**reprodutível**, não **imutável**.

**B — persistir snapshot.**
Já existe, em três níveis: `IndustrialCostCalculation` (com composição
completa em `result`), `PricingTier` (na ativação) e `QuoteLine` (no envio).
Esses são imutáveis por regra e **é o que responde "qual era o CMV daquele
orçamento"** sem depender de informação viva.

**Resposta à pergunta §13/§25:** o que é **auditável** é B. O que é
**reprodutível** é A. A comparação que o negócio pediu precisa dos dois: o
snapshot como termo fixo, o recálculo como termo móvel. **Nenhuma tabela nova
é necessária** — o único dado que hoje não existe é a *comparação em si*, e
comparação é resultado, não documento.

---

## 21. Tributos e custos adicionais — onde poderiam entrar (só mapeamento)

Nada é decidido aqui. Os pontos de extensão possíveis, em ordem de
proximidade ao custo:

| Ponto | O que caberia | Efeito no CMV | Observação |
|---|---|---|---|
| `SupplierItemOffer` | frete/tributo **cotado** pelo fornecedor | prospectivo (degrau 4) | oferta é imutável — mudou o encargo, nasce oferta nova |
| `PurchaseOrderLine` | encargos **negociados** na compra | **nenhum** hoje | preço de OC nunca vira custo, por regra dura |
| `ReceiptLine.actualUnitCost` | **já é o ponto oficial** | real (degraus 1–3) | o schema foi nomeado "custo efetivo de **aquisição**" exatamente para comportar mercadoria + frete + despesas atribuíveis (§31, ROADMAP "landed cost") |
| `ReceiptLine` com colunas novas | frete/tributo/outros **separados** do preço da mercadoria | real, com rastreabilidade da composição | exige migration; ganho é poder mostrar "de que é feito" o custo |
| Documento fiscal | tributo não recuperável apurado | real | não existe módulo fiscal; ROADMAP trata como integração futura |
| `ItemCostReference` | estimativa **já com encargos** | prospectivo (degrau 5) | mistura mercadoria e encargo num número só |
| `IndustrialCostLine` (premissa manual) | encargo modelado como linha da estrutura | industrial, não de aquisição | já existe e já funciona; muda a natureza do número |

**O caminho de menor ruptura é `ReceiptLine`** — o schema foi desenhado para
isso e o nome do campo é a evidência. A decisão de **se** o encargo é uma
coluna nova ou uma soma dentro de `actualUnitCost` é do PO, e não é desta
rodada.

---

## 22. Recomendação durável — não duplicar o CMV

Qualquer capability de variação de CMV **reusa** `costForOutputQuantity` e
`computePrice`. Não pode nascer "CMV do dashboard", "CMV do orçamento" e
"CMV da comparação" como três fórmulas. Precedente já respeitado por três
consumidores diferentes (faixa de precificação, tela de CMV, prévia de
rebase), e por `getFormulationCostEstimate`, que foi corrigido justamente
para parar de ter hierarquia própria.

A comparação é uma **subtração entre duas invocações do mesmo motor**, nunca
um cálculo paralelo.

---

## 23. Gaps encontrados

| # | Gap | Gravidade |
|---|---|---|
| G1 | Nenhuma `QuoteLine` (DEV ou PROD) tem CMV congelado — 100 % das linhas são `MANUAL` sem faixa ativa equivalente | **alta** — o primeiro termo da comparação não existe na prática |
| G2 | PROD não tem nenhum `IndustrialCostCalculation` nem `PricingVersion` | **alta** — não há base congelada em produção |
| G3 | PROD não tem nenhuma compra recebida; todo custo vem de referência manual (degrau 5) | **alta** — o CMV de produção é integralmente estimativa |
| G4 | 602 ofertas sem `effectiveAt` → degrau 4 inerte; e 90 itens multi-fornecedor sem preferencial ficariam `AMBIGUOUS` se a vigência fosse informada | **alta** (risco de regressão ao ativar) |
| G5 | 288 materiais em PROD (50 %) e 572 em DEV (62 %) sem nenhuma fonte de custo | **alta** |
| G6 | `CustomerOrderLine` não carrega custo nem margem; só chega via `sourceQuoteLineId` | média (é decisão de arquitetura, mas limita comparação no Pedido) |
| G7 | `ItemCostReference` não tem `confidence`/`source`/`method` tipados — só prosa em `note` | média |
| G8 | `ItemCostReference.currencyCode` não é filtrado pelo seletor: referência em moeda estrangeira entraria como BRL | média (latente) |
| G9 | Vigência de oferta compara com `referenceDate` cru enquanto compra e referência manual usam `fimDoDia` | baixa (latente) |
| G10 | Nenhum teste cobre "oferta substituída em data X" (vigência × `referenceDate`) | média (capacidade não protegida) |
| G11 | Nenhum lugar computa o diff de composição entre base congelada e hoje | é a capability pedida |
| G12 | Diff de componentes não separa "mudou preço" de "mudou receita" quando a formulação avançou | média (armadilha de implementação) |
| G13 | Validade do orçamento é data livre; não existe default nem prazo por perfil de cliente | baixa (é o que o negócio citou como "3 ou 5 dias") |

---

## 24. Riscos

1. **Falsa precisão.** Comparar um CMV `COMPLETE_REAL_REFERENCE` com um
   `PARTIAL` produz uma "variação" que é ausência de dado, não movimento de
   preço. A comparação precisa recusar-se a existir quando qualquer um dos
   dois lados é incompleto — o mesmo fail-closed do total.
2. **Comparar receitas diferentes.** Se a formulação avançou entre a base e
   hoje, a variação mistura mudança de custo com mudança de produto.
3. **Ativar vigência de oferta sem preferencial** rebaixa 90 itens de "com
   custo" para "custo desconhecido".
4. **Reescrever documento histórico.** Qualquer implementação que grave o
   custo novo na `QuoteLine` ou no `CustomerOrderLine` quebra §74/§70 e a
   regra COM-03.
5. **Linguagem.** Chamar contribuição negativa de "prejuízo" afirma algo que
   o sistema não sabe: não conhece impostos, despesas administrativas nem
   frete comercial.
6. **Custo de recálculo.** `costForOutputQuantity` faz `findMany` de UOM,
   requisitos de formulação e — no caminho `live` — uma seleção de fonte por
   componente. Comparar 300 produtos ao abrir uma tela é caro.

---

## 25. As 7 decisões para o Product Owner

### P1 — Qual snapshot é "o CMV do orçamento"

| | Opção | Impacto schema | Impacto UX | Risco |
|---|---|---|---|---|
| A | `QuoteLine.industrialCostPerUnitSnapshot` (**recomendada**) | nenhum | é o número que o documento enviado carrega | é `null` em 100 % das linhas atuais (G1) |
| B | `PricingTier.costPerUnitSnapshot` da faixa citada | nenhum | some quando a linha não veio de faixa | não representa o que foi enviado |
| C | `IndustrialCostCalculation` apontado por `costCalculationCodeSnapshot` | nenhum | dá a composição completa, não só o total | precisa recalcular para a quantidade da linha |

**Recomendação: A como total, C como composição.** A `QuoteLine` responde
"quanto"; o CALC responde "de quê". Nenhum dos dois exige migration.
Pré-requisito: fechar G1 — sem faixa ativa equivalente, o snapshot não nasce.

### P2 — Quando comparar com o CMV atual

| | Opção | Impacto | Risco |
|---|---|---|---|
| A | sob demanda, botão "Atualizar estimativa" (**recomendada**) | nenhum no schema; um endpoint de leitura | usuário pode não clicar |
| B | ao abrir a tela do orçamento | nenhum no schema | custo por abertura; tela lenta em proposta multi-produto |
| C | job noturno + persistência da comparação | tabela nova | duplica o CMV como dado; contraria §22 |

**Recomendação: A**, com a data de cálculo visível. Simular é leitura (§5.12);
manter assim preserva a regra e o custo.

### P3 — Onde mostrar

| | Opção | Papel |
|---|---|---|
| A | só na Precificação | ajusta a faixa, mas não conversa com o acordo do cliente |
| B | só no Orçamento | é onde o preço vira compromisso |
| C | **em ambos, com papéis diferentes** (**recomendada**) | Precificação: "a faixa envelheceu, refaça a base" (o `rebase-preview` já faz metade). Orçamento/recompra: "esta condição, hoje, vale isto" |
| D | relatório dedicado | bom para varredura, ruim para decidir na hora |

**Recomendação: C, começando pela recompra** (seção 19), que é onde a dor foi
relatada; depois o painel D como visão de carteira.

### P4 — Como calcular o preço sugerido

| | Opção | Fórmula |
|---|---|---|
| A | **preservar a margem de contribuição da proposta** (**recomendada**) | `P' = C₁ ÷ (1 − m₀ ÷ 100 − c)` com `m₀ = contributionMarginSnapshot` |
| B | preservar a contribuição em reais por unidade | `P' = (C₁ + contribuição₀) ÷ (1 − c)` |
| C | preservar o markup | `P' = C₁ × (1 + markup₀ ÷ 100)` |

**Recomendação: A** — é a inversa exata do motor que formou o preço original
(`computePrice`), então não introduz uma segunda definição de "condição
original". Oferecer B como número secundário é barato e às vezes é o que o
comercial quer.

Em qualquer opção: **preço sugerido é recomendação.** Nunca substitui
automaticamente o preço do orçamento nem do Pedido.

### P5 — Quando alertar

| | Opção | Impacto |
|---|---|---|
| A | só comparação manual | nenhum; não avisa ninguém |
| B | **badge quando a variação passa de X %** (**recomendada**) | reusa `IndustrialCostWarningDTO`; X é parâmetro de produto, não de código |
| C | alerta ao tentar reutilizar condição vencida/antiga | encaixa em §74, que já exige confirmação e motivo |
| D | painel de produtos com margem deteriorada | reusa `AttentionGroupDTO`; precisa de recálculo em lote (risco 6) |

**Recomendação: B + C.** B informa; C intercepta no momento em que a decisão
comercial acontece. D depois, quando houver massa em PROD.

Linguagem: mostrar o número. Margem negativa pode ter alerta objetivo. Nunca
a palavra "prejuízo".

### P6 — Guardar histórico de comparações

| | Opção | Impacto schema |
|---|---|---|
| A | **não guardar** (**recomendada**) | nenhum |
| B | guardar por orçamento | tabela nova |
| C | guardar por produto/dia | tabela nova + job |

**Recomendação: A.** Os dois termos já são recuperáveis (snapshot imutável +
recálculo determinístico por `referenceDate`). Persistir a subtração cria um
terceiro documento que pode divergir dos seus operandos — exatamente o que
§22 proíbe. Se depois for preciso "quando isso passou de 10 %", aí sim vira
decisão de dado, com evidência de uso.

### P7 — Onde entram custos adicionais e tributos

| | Opção | Impacto |
|---|---|---|
| A | **`ReceiptLine`, dentro de `actualUnitCost`** (**recomendada como direção**) | nenhum no schema; ganho imediato, perda de visibilidade da composição |
| B | `ReceiptLine` com colunas separadas (mercadoria, frete, tributo não recuperável, outras) | migration; mostra de que é feito o custo; mantém o degrau real |
| C | `SupplierItemOffer` | encargo prospectivo; útil para simular antes de comprar |
| D | documento fiscal | módulo que não existe |

**Recomendação: fixar a direção A/B agora e a forma depois.** O ponto
oficial é o recebimento — o campo já se chama "custo efetivo de aquisição"
por causa disso. Decidir entre A e B é uma rodada própria, e não deve
atravessar COST-VAR-01.

---

## 26. Recomendação geral

A capacidade pedida é **composição, não construção**. O motor de custo, o
motor de preço, o congelamento por documento, a data de referência, a
composição por componente e a infraestrutura de aviso já existem e já são
únicos. Falta subtrair.

Mas a capability **não deve começar pela comparação**. Os três primeiros gaps
tornam a comparação vazia em produção: sem compra recebida, sem CALC e sem
faixa, o orçamento não tem CMV congelado para comparar. A ordem que faz
sentido é:

1. informar vigência nas ofertas **junto com** o fornecedor preferencial
   (G4), ou decidir conscientemente deixar o degrau 4 inerte;
2. fazer nascer CALC e precificação em PROD (G2), o que faz `QuoteLine`
   passar a congelar CMV (G1);
3. então implementar a comparação, que a essa altura terá os dois termos.

Implementar a comparação antes disso entrega uma tela que responde "—".

---

## 27. Fora de escopo desta rodada, por decisão

- Nenhum arquivo de runtime alterado. Nenhuma migration.
- Nenhuma regra tributária decidida (brainstorm fiscal é separado).
- Nenhum dado fabricado em DEV ou PROD; PROD acessado somente para leitura.
- `docs/PRODUCT_RULES.md` **não** foi alterado: não há decisão tomada para
  registrar.
