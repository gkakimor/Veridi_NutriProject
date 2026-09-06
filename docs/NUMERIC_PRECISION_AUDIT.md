# Auditoria de precisão numérica — PREC-01

**Status:** auditoria **aprovada pelo PO e publicada em 2026-09-05**, sem
migration e sem mudança de regra. As decisões tomadas sobre ela viraram regra
durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57, §58 e §59, e trabalho
nomeado na seção E de [`BACKLOG.md`](BACKLOG.md). Este documento continua sendo
a **evidência**: o inventário, as medições e o porquê de cada decisão.
**Implementação:** a **Fundação A** (#20 + PREC-MIG-A) foi entregue em
2026-09-05 — 43 colunas em `DECIMAL(24,12)` e o motor decimal em 40 dígitos. As
demais capabilities seguem pendentes; o inventário abaixo marca o que já mudou.
**Branch:** `audit/global-numeric-precision`, a partir de `main @ 4b9df47`.
**Escopo:** todo o domínio numérico mensurável — estoque, itens, lotes, compras,
recebimentos, fornecedores, formulações, templates, ordens de produção, pesagem,
movimentações, projetos, orçamentos, pedidos, expedições, faturamento, custos
industriais, CMV, precificação, recursos, energia, mão de obra, percentuais,
pureza, overage, fatores e conversões de unidade.
**Fora do escopo:** IDs, códigos, contadores, números de versão e posições.

---

## 1. Resumo executivo

A arquitetura numérica da Veridi está **melhor do que a hipótese de trabalho
supunha**, e o risco real está concentrado em um lugar só, que não é o que se
esperava.

O que a auditoria provou:

- **Nenhum `Float`/`double precision` no banco.** 106 colunas `numeric`, todas
  com precision e scale explícitos, e o banco local bate coluna a coluna com o
  `schema.prisma` — **zero divergência de precisão** (164/164). O drift do
  BACKLOG #14 não toca tipo numérico.
- **Nenhuma grandeza atravessa a API como número JSON.** Todo Decimal sai como
  `string` e volta como `string`. Não existe um único campo de quantidade,
  custo, preço, percentual ou fator tipado como `number` nos DTOs de
  `@veridi/shared`.
- **Abrir um campo, não editar e salvar preserva o valor integralmente.**
  `formatDecimalInput` troca o separador e nada mais — não arredonda, não
  completa casas. Dez casos determinísticos, incluindo `4.053187640000` e
  `123.456789012345`: **IDENTICAL em todos**.
- **Os motores de cálculo são Decimal puro do início ao fim.** Formulação, custo,
  média ponderada, CMV e precificação nunca reconsomem um valor arredondado para
  apresentação. O arredondamento é sempre a última operação, na saída.

O risco real, provado com dado de produção:

- **`Decimal(18,6)` não é suficiente para quantidade física derivada.** O
  componente `MP-000147` declara `0,000048 kg` sobre base de 1000. Ao produzir
  de 1 a 10 unidades a necessidade física é `4,8e-8` a `4,8e-7 kg` e o
  `requiredQuantity` **persiste como `0,000000`** — a Ordem de Produção afirma
  que não precisa do material. A 100 unidades o valor grava `0,000005` contra
  `0,0000048` reais, erro de +4,2%. Com scale 12 todos são exatos.
- **`decimal.js` roda em 20 dígitos significativos** (default, nunca
  reconfigurado). É um teto de JavaScript **independente da coluna**: um
  `DECIMAL(30,12)` cheio tem 30 dígitos significativos e seria truncado pela
  aritmética antes de chegar ao banco.

**Conclusão de arquitetura:** o problema da Veridi não é precisão de exibição
confundida com armazenamento — essa separação já existe e funciona. É **scale de
armazenamento insuficiente para grandeza física derivada em micrograma**, mais
seis pontos de serialização inconsistentes.

---

## 2. Política — aprovada

Quatro regras, derivadas do que a auditoria encontrou e **aprovadas pelo PO em
2026-09-05**. P1 a P4 estão consolidadas em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57 e §58; aqui fica o raciocínio.

**P1 — A coluna é a precisão. Não existe casa escondida além do scale.**
Hoje o sistema não tem "precisão oculta" para preservar: `Decimal(18,6)` guarda
exatamente seis casas, e o que passa disso já foi descartado no `INSERT`. Toda
discussão de "não destruir casas ocultas" só passa a ter objeto **depois** de a
migration ampliar o scale — e é por isso que o invariante de §57 precisa estar
escrito antes, não depois.

**P2 — Serialização espelha o scale da coluna, sempre.**
`toFixed(N)` no DTO com `N < scale` é perda silenciosa. Seis ocorrências
divergem hoje (§5). A regra: um campo persistido sai da API com exatamente o
número de casas que a coluna guarda. Valor derivado não persistido sai com o
scale da sua categoria.

**P3 — Arredondamento comercial é regra de domínio e vive no cálculo, não no
formatter.** Já é assim: `calcularTotaisOrcamento`, `calcularTotaisFaturamento`
e `calcularTotaisOrdemCompra` produzem strings de 2 casas porque o documento tem
2 casas ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §55), não porque a tela mostra 2.
Preferência de exibição nunca alcança esses valores.

**P4 — Aritmética de grandeza acontece em Decimal, dos dois lados.**
A web já respeita isso nos motores compartilhados. As três exceções que fazem
conta em `Number` e produzem valor enviado ou impresso estão em §5.

---

## 3. Inventário por categoria

**164 campos numéricos auditados** — os de domínio, declarados no
`schema.prisma`: **106 Decimal** e **58 Int**. O banco tem 165 colunas numéricas;
a excedente é `_prisma_migrations.applied_steps_count`, bookkeeping do próprio
Prisma, fora do domínio. Zero Float. Zero Decimal sem precision/scale explícita.

| Scale | Campos | Categorias predominantes |
|---|---|---|
| `Decimal(18,6)` | 46 | QUANTITY, TECHNICAL_VALUE, UOM_CONVERSION |
| `Decimal(14,4)` | 27 | UNIT_COST, UNIT_PRICE, RATE, custos compostos |
| `Decimal(7,4)` | 13 | PERCENTAGE |
| `Decimal(14,6)` | 7 | UNIT_PRICE técnico (precificação) |
| `Decimal(6,3)` | 7 | PERCENTAGE (pureza/overage) |
| `Decimal(12,4)` | 4 | RATIO_FACTOR (markup), PHYSICAL_MEASUREMENT (kW) |
| `Decimal(14,2)` | 2 | COMMERCIAL_DOCUMENT_TOTAL |

Os 59 Int são contadores, números de versão, posições, `sortOrder`, prazos em
dias/meses e contagens de embalagem (`dosesPerPackage`, `capsulesPerDose`,
`unitsPerShippingBox`, `installmentCount`). Todos são COUNT legítimo: nenhum
representa grandeza mensurável fracionária. **Nenhuma recomendação de mudança.**

### 3.1 Tabela de inventário — campos com decisão

A coluna **Atual** descreve o estado da auditoria (2026-09-05, antes da
implementação). As 43 linhas marcadas **Sim — A** já estão em `DECIMAL(24,12)`
desde a Fundação A; a tabela é mantida como registro do que foi medido, não como
retrato do schema. O estado corrente do schema é conferido por
`scripts/numeric-precision-matrix.test.ts`. Três colunas `18,6` ficaram
deliberadamente fora — os dois campos `legacy*` de `FormulationComponent` e
`QuoteLine.industrialCostPerUnitSnapshot`, que viaja com os demais snapshots de
precificação no PREC-MIG-B.

| Model.Field | Categoria | Atual | Uso | Risco | Recomendação | Migration? |
|---|---|---|---|---|---|---|
| ProductionOrderRequirement.requiredQuantity | QUANTITY | 18,6 | necessidade física persistida, em unidade de estoque | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| ProductionOrderRequirement.theoreticalQuantity | QUANTITY | 18,6 | teórico congelado da OP | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| MaterialReservationLine.quantity | QUANTITY | 18,6 | reserva derivada da necessidade | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| ProductionConsumption.quantity | QUANTITY | 18,6 | consumo real, baixa de estoque | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| InventoryMovement.quantity | QUANTITY | 18,6 | razão de estoque | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| RecipeWeighing.plannedQuantitySnapshot | QUANTITY | 18,6 | peso planejado da parte | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| RecipeWeighing.actualQuantity | QUANTITY | 18,6 | peso realmente pesado | POTENTIAL_RISK | 24,12 | Sim — A |
| SampleConsumption.quantity | QUANTITY | 18,6 | consumo de amostra — lote pequeno por definição | **INSUFFICIENT_SCALE** | 24,12 | **Sim — A** |
| FormulationComponent.quantity | QUANTITY | 18,6 | declarada na unidade do componente (mg) | OK | 24,12 | Sim — A |
| FormulationTemplateComponent.quantity | QUANTITY | 18,6 | idem, template | OK | 24,12 | Sim — A |
| Lot.initialReceivedQuantity | QUANTITY | 18,6 | quantidade de lote recebida | OK | 24,12 | Sim — A |
| ReceiptLine.receivedQuantity | QUANTITY | 18,6 | recebimento físico | OK | 24,12 | Sim — A |
| ProductionOutput.quantity | QUANTITY | 18,6 | produção declarada | OK | 24,12 | Sim — A |
| ShipmentLine.quantity | QUANTITY | 18,6 | expedição | OK | 24,12 | Sim — A |
| BillingLine.quantity | QUANTITY | 18,6 | faturamento | OK | 24,12 | Sim — A |
| PurchaseOrderLine.orderedQuantity | QUANTITY | 18,6 | compra | OK | 24,12 | Sim — A |
| CustomerOrderLine.orderedQuantity | QUANTITY | 18,6 | pedido acordado | OK | 24,12 | Sim — A |
| CustomerOrderReservationLine.quantity | QUANTITY | 18,6 | reserva de PA | OK | 24,12 | Sim — A |
| ProductionOrder.plannedQuantity | QUANTITY | 18,6 | quantidade planejada | OK | 24,12 | Sim — A |
| FormulationVersion.basisQuantity | QUANTITY | 18,6 | base da versão (divisor) | POTENTIAL_RISK | 24,12 | Sim — A |
| ProjectSample.outputQuantity | QUANTITY | 18,6 | piloto — lote pequeno | POTENTIAL_RISK | 24,12 | Sim — A |
| **UnitOfMeasure.toBaseFactor** | UOM_CONVERSION | 18,6 | fator de conversão, multiplica e divide toda quantidade | decidido pelo PO | **24,12** | **Sim — A (ENTREGUE)** |
| Item.defaultPurityPercent | PERCENTAGE | 6,3 | pureza padrão | POTENTIAL_RISK | 9,6 | Sim — B |
| FormulationComponent.purityPercentApplied | PERCENTAGE | 6,3 | pureza aplicada (divisor) | POTENTIAL_RISK | 9,6 | Sim — B |
| FormulationComponent.overagePercent | PERCENTAGE | 6,3 | overage aplicado | POTENTIAL_RISK | 9,6 | Sim — B |
| ProductionOrderRequirement.purityPercentApplied | PERCENTAGE | 6,3 | congelado na OP | POTENTIAL_RISK | 9,6 | Sim — B |
| ProductionOrderRequirement.overagePercent | PERCENTAGE | 6,3 | congelado na OP | POTENTIAL_RISK | 9,6 | Sim — B |
| FormulationTemplateComponent.purityPercentApplied | PERCENTAGE | 6,3 | template | POTENTIAL_RISK | 9,6 | Sim — B |
| FormulationTemplateComponent.overagePercent | PERCENTAGE | 6,3 | template | POTENTIAL_RISK | 9,6 | Sim — B |
| ItemCostReference.unitCost | UNIT_COST | 14,4 | referência manual de custo | POTENTIAL_RISK | 20,8 | **Sim — B (ENTREGUE)** |
| ReceiptLine.actualUnitCost | UNIT_COST | 14,4 | custo efetivo de aquisição — origem de toda média | decidido pelo PO | 20,8 | **Sim — B (ENTREGUE)** |
| SupplierItemOffer.unitPrice | UNIT_COST | 14,4 | oferta de fornecedor, lida como custo pelo seletor | POTENTIAL_RISK | 20,8 | **Sim — B (ENTREGUE)** |
| PurchaseOrderLine.unitPrice | UNIT_PRICE | 14,4 | preço da OC | NEEDS_DOMAIN_DECISION | 20,8 | Não — categoria UNIT_PRICE, fora do PREC-MIG-B |
| **QuoteLine.unitPrice** | UNIT_PRICE | 14,4 | preço da linha do orçamento | **NEEDS_DOMAIN_DECISION** | 20,6 ou manter | **Decisão do PO** |
| CustomerOrderLine.agreedUnitPrice | UNIT_PRICE | 14,4 | preço acordado — contratual | DOCUMENTAL, ver §6 | manter 14,4 | Não |
| BillingLine.agreedUnitPrice / unitPrice | UNIT_PRICE | 14,4 | preço faturado — emitido | DOCUMENTAL, ver §6 | manter 14,4 | Não |
| PricingTier.manualUnitPrice | UNIT_PRICE | 14,6 | preço manual da faixa | OK | 20,8 | Sim — B |
| PricingTier.selectedPriceSnapshot | UNIT_PRICE | 14,6 | preço congelado na ativação | OK | 20,8 | Sim — B |
| PricingTier.suggestedPriceSnapshot | UNIT_PRICE | 14,6 | preço sugerido | OK | 20,8 | Sim — B |
| IndustrialCostCalculation.costPerUnit | TECHNICAL_VALUE | 18,6 | custo industrial unitário | OK | 24,12 | Sim — A |
| IndustrialCostCalculation.costPer1000 | TECHNICAL_VALUE | 14,4 | custo por mil | POTENTIAL_RISK | 20,8 | Sim — B |
| IndustrialCostCalculation.knownSubtotal / totalIndustrialCost / directIndustrialCost / overheadCost | TECHNICAL_VALUE | 14,4 | composição do custo | POTENTIAL_RISK | 20,8 | Sim — B |
| ProductionOrderCostSnapshot.costPerProducedUnit | TECHNICAL_VALUE | 18,6 | CMV por unidade produzida | OK | 24,12 | Sim — A |
| ProductionOrderCostSnapshot.* (4 campos) | TECHNICAL_VALUE | 14,4 | composição do CMV | POTENTIAL_RISK | 20,8 | Sim — B |
| PricingTier.* Snapshot totais (6 campos) | TECHNICAL_VALUE | 14,4 | snapshots de precificação | POTENTIAL_RISK | 20,8 | Sim — B |
| PricingTier.costPerUnitSnapshot | TECHNICAL_VALUE | 18,6 | custo unitário congelado | OK | 24,12 | Sim — A |
| PricingTier.contributionPerUnitSnapshot / commissionPerUnitSnapshot | TECHNICAL_VALUE | 14,6 | contribuição e comissão por unidade | OK | 20,8 | Sim — B |
| QuoteLine.*Snapshot (7 campos) | TECHNICAL_VALUE | 18,6 / 14,6 / 7,4 / 12,4 | proveniência da precificação | OK | acompanha categoria | Sim — B |
| IndustrialResourceRate.rateValue | RATE | 14,4 | tarifa de recurso | POTENTIAL_RISK | 20,8 | Sim — B |
| IndustrialCostLine.rateValue / IndustrialCostTemplateAdditionalCost.rateValue | RATE | 14,4 | tarifa de custo adicional | POTENTIAL_RISK | 20,8 | Sim — B |
| IndustrialResource.powerKw / IndustrialCostResourceUsage.powerKwSnapshot | PHYSICAL_MEASUREMENT | 12,4 | potência para energia | OK | manter 12,4 | Não |
| IndustrialCostResourceUsage.usageQuantity / IndustrialCostVersion.referenceOutputQuantity / IndustrialCostTemplate* | QUANTITY | 18,6 | horas, quantidade de referência | OK | 24,12 | Sim — A |
| QuoteVersion.discountPercent / downPaymentPercent / monthlyInterestPercent | PERCENTAGE | 7,4 | condições comerciais | OK | manter 7,4 | Não |
| PricingTier.commissionPercent / targetContributionMarginPercent / *Snapshot | PERCENTAGE | 7,4 | margem e comissão | OK | manter 7,4 | Não |
| CustomerOrder.agreedDiscountPercent | PERCENTAGE | 7,4 | desconto acordado | OK | manter 7,4 | Não |
| PricingPolicyTemplateTier.* | PERCENTAGE / QUANTITY | 7,4 / 18,6 | template de política | OK | acompanha categoria | Sim — A/B |
| QuoteLine.markupSnapshot / PricingTier.markupSnapshot | RATIO_FACTOR | 12,4 | markup | OK | manter 12,4 | Não |
| Project.doseAmount / minimumBatchQuantity, Product.doseAmount / minimumBatchQuantity | QUANTITY | 18,6 | cadastro de dose e lote mínimo | OK | 24,12 | Sim — A |
| SupplierItemOffer.minimumOrderQuantity | QUANTITY | 18,6 | lote mínimo do fornecedor | OK | 24,12 | Sim — A |
| QuoteLine.quotedQuantity / pricingTierQuantitySnapshot, PricingTier.quantity, CustomerOrderLine.agreedPricingTierQuantity | QUANTITY | 18,6 | quantidade comercial (faixa) | OK | 24,12 | Sim — A |
| FormulationComponent.legacyTotalQuantity / legacyBatchUnits | QUANTITY | 18,6 | dado importado do legado | NOT_APPLICABLE | não alterar | Não |
| **CustomerOrder.agreedSubtotalAmount** | COMMERCIAL_DOCUMENT_TOTAL | 14,2 | subtotal congelado do Pedido | **DOCUMENTAL_2DP_CORRECT** | manter 14,2 | **Não** |
| **CustomerOrder.agreedTotalAmount** | COMMERCIAL_DOCUMENT_TOTAL | 14,2 | total congelado do Pedido | **DOCUMENTAL_2DP_CORRECT** | manter 14,2 | **Não** |

---

## 4. Riscos críticos

### R1 — Quantidade física derivada zera em `Decimal(18,6)` — CRÍTICO

Provado com o corpus real. Componente `MP-000147`, `FIXED_BASIS`,
`0,000048 kg` sobre base 1000, item estocado em kg:

| Produzir | Físico calculado | Gravado (18,6) | Gravado (24,12) |
|---|---|---|---|
| 1 | `4,8e-8` | **`0,000000`** | `0,000000048000` |
| 5 | `2,4e-7` | **`0,000000`** | `0,000000240000` |
| 10 | `4,8e-7` | **`0,000000`** | `0,000000480000` |
| 11 | `5,28e-7` | `0,000001` (+89%) | `0,000000528000` |
| 100 | `4,8e-6` | `0,000005` (+4,2%) | `0,000004800000` |
| 1000 | `4,8e-5` | `0,000048` exato | exato |

Zero em `requiredQuantity` significa, no domínio, "não precisa deste material" —
a resposta plausível e errada que o próprio motor de Formulação foi escrito para
evitar (`formulation-quantity.ts`, comentário de `fatorDaBase`). O scale a
reintroduz depois do motor, na gravação.

**Alcance real medido:** 1991 componentes de formulação; **142 abaixo de 0,001**
na unidade de estoque; **1 já zera** hoje. Unidades reais do produto: `g` (base),
`kg`, `mg`, `un`, `L`, `mL`. Não existe `µg` cadastrado — micrograma entra como
fração de `mg`, e é aí que o piso aparece.

**Onde dói:** amostra, piloto e lote pequeno — exatamente `ProjectSample`,
`SampleConsumption` e OPs de baixa tiragem.

### R2 — `decimal.js` limita a 20 dígitos significativos — RESOLVIDO na Fundação A

**A auditoria contou um construtor; existem dois.** A implementação de #20
descobriu que o Prisma empacota a própria cópia do `decimal.js`:
`Prisma.Decimal !== Decimal`, configuração independente, e é `Prisma.Decimal`
que roda quase todo o cálculo de domínio da API. Um `Decimal.set()` apenas em
`@veridi/shared` — que era o que este relatório sugeria — teria deixado a API
inteira em 20 dígitos, e nenhum teste do pacote compartilhado perceberia. A
configuração canônica alcança os dois, e `apps/api/src/lib/decimal.test.ts`
prova ambos por comportamento.

O diagnóstico abaixo continua correto e é o motivo da decisão:

`Decimal.precision = 20`, `rounding = 4` (ROUND_HALF_UP), nunca reconfigurado em
nenhum ponto do repositório. Consequência medida:

```
new Decimal("123456789012.123456789012").times(1)  ->  123456789012.12345679
```

O valor tem 24 dígitos significativos; a aritmética devolve 20. **Um
`DECIMAL(30,12)` seria truncado pelo JavaScript antes de chegar ao banco** — a
coluna guardaria um número que o motor nunca é capaz de produzir. Qualquer
ampliação de scale exige, no mesmo passo, `Decimal.set({ precision: N })` em
`@veridi/shared` e em `apps/api`, com N coberto por teste.

### R3 — Fator de conversão de unidade em `Decimal(18,6)` — RESOLVIDO na Fundação A

`UnitOfMeasure.toBaseFactor` multiplica e divide **toda** conversão de
quantidade do sistema. Hoje os fatores são `1`, `1000` e `0.001`: exatos. Um
fator não decimal — libra→kg é `0.45359237`, oito casas — truncaria para
`0.453592` e contaminaria toda quantidade convertida. Não é defeito atual; é
fragilidade estrutural que a primeira unidade imperial ou volumétrica ativa.

### R4 — Custo efetivo de aquisição em `Decimal(14,4)` — RESOLVIDO na Fundação B

`ReceiptLine.actualUnitCost` é a **única origem** de custo real do sistema: a
média ponderada 30d/90d, o último custo real e o custo do lote consumido saem
todos dele. Quatro casas em R$ para insumo comprado por quilo é razoável; para
insumo comprado por grama ou miligrama, quatro casas em unidade pequena é
grosseiro. Precisa de decisão de domínio, não de widening automático.

### R5 — Seis pontos de serialização com `toFixed(N)` menor que o scale — MÉDIO

Ver §5. Nenhum destrói dado gravado; todos entregam à tela menos precisão do que
o banco tem, e um deles grava.

---

## 5. Pontos de perda

### 5.1 Serialização API — `toFixed(N)` abaixo do scale da coluna

**Nenhuma das seis linhas abaixo foi corrigida na Fundação A**, e isso é
deliberado: todas serializam coluna do PREC-MIG-B ou preço contratual, que o PO
decidiu não ampliar. PREC-SER-01 segue integralmente aberto.

A Fundação A ajustou **outros cinco** pontos — os que serializavam coluna que
passou a `DECIMAL(24,12)` e continuariam cortando em seis casas o que o banco
guarda em doze: `costPerUnit` do cálculo industrial
(`calculation.service.ts`, `snapshot.service.ts`), `costPerProducedUnit`
(`production-cost.service.ts`) e `costPerUnitSnapshot` da faixa
(`quote-pricing.service.ts`, `cost-reports.service.ts`). Todos passam por
`apps/api/src/lib/decimal-serialization.ts`, que tem uma função por escala em
uso — a escala pertence à categoria do campo, não a quem chama.

| Arquivo:linha | Campo | Scale | `toFixed` | Classificação |
|---|---|---|---|---|
| `pricing/pricing.service.ts:517` | `PricingTier.selectedPriceSnapshot` | 6 | 4 | DISPLAY_ONLY — DTO de comparação |
| `pricing/pricing.service.ts:519` | `PricingTier.manualUnitPrice` | 6 | 4 | DISPLAY_ONLY — DTO de comparação |
| `product-cmv/product-cmv.service.ts:45` | `selectedPriceSnapshot` / `manualUnitPrice` | 6 | 4 | DISPLAY_ONLY |
| `industrial-cost-calculation/snapshot.service.ts:137` | `totalIndustrialCost` | 4 | 2 | DISPLAY_ONLY |
| `industrial-cost-calculation/snapshot.service.ts:138` | `knownSubtotal` | 4 | 2 | DISPLAY_ONLY |
| `industrial-cost-calculation/snapshot.service.ts:140` | `costPer1000` | 4 | 2 | DISPLAY_ONLY |
| **`projects/quote-pricing.service.ts:288`** | `selectedPriceSnapshot` → `QuoteLine.unitPrice` | 6 → **coluna 4** | 4 | **PREMATURE_ROUNDING — grava** |

A última grava: aplicar uma faixa de precificação a uma linha de orçamento
converte um preço de 6 casas em 4. O `.toFixed(4)` é defensivo — a coluna só
comporta 4 —, então a perda é da coluna, não do código. A proveniência
sobrevive em `QuoteLine.pricingSelectedUnitPriceSnapshot` (14,6), o que torna a
perda **reversível por leitura** e reduz a urgência.

**Inconsistência adicional:** a mesma média ponderada de custo sai com 4 casas em
`costs/costs.service.ts` (`formatUnitCost`) e com 6 em
`items/item-cost-references.service.ts:162`. Medido: `11.658585` contra
`11.6586` para o mesmo valor. Duas telas exibem números diferentes do mesmo dado.

### 5.2 Aritmética em `Number` que produz valor enviado ou impresso

| Local | O que faz | Classificação |
|---|---|---|
| `customer-orders/CustomerOrderPage.tsx:201` `complementoDaLinha` | `Math.max(Number(pedido) − Number(valor), 0).toString()` vira o conteúdo do campo *Produzir*, que é enviado | **FLOAT_RISK** |
| `inventory/StockCountPage.tsx:145` | diferença de contagem em float — só exibida e usada como booleano; o valor enviado é a string digitada | DISPLAY_ONLY |
| `print/documents.tsx:353` | `(Number(requiredQuantity) / numberOfParts).toFixed(6)` no documento impresso da OP | **PREMATURE_ROUNDING** |

`complementoDaLinha`, medido:

```
pedido=1000.1  reserva=0.3   -> campo "999.8000000000001"      -> banco 999.800000
pedido=2.3     reserva=2.2   -> campo "0.09999999999999964"    -> banco 0.100000
```

O banco corrige por arredondamento na escala 6, mas o operador **vê o ruído no
campo** e ele viaja no payload. O limite exato: o ULP do double supera `1e-6` a
partir de `1e10`, e a partir daí a sexta casa é destruída de fato —
`10000000000.000002 − 0.000001` devolve `10000000000`. Abaixo de ≈9×10⁹ a
escala 6 é exatamente representável em double.

`print/documents.tsx:353` diverge do domínio: a API divide as partes com
`splitDecimal` (`ROUND_DOWN` na escala 6, resto absorvido pela última parte, soma
exata). O documento impresso mostra `total/partes` em float como `X × N`, que não
fecha com o total quando a divisão não é exata — num documento de execução GMP.

### 5.3 O que **não** perde precisão

Verificado e negativo:

- `parseFloat`, `parseInt`, `Math.trunc`: **zero ocorrências** em todo o
  repositório.
- `.toNumber()`: uma ocorrência, em `PricingTier.batchCountSnapshot`, coluna
  `Int`. Correto.
- `Math.round` / `Math.floor` / `Math.ceil`: 35 ocorrências, **nenhuma sobre
  grandeza** — paginação (29), rótulo de tamanho de arquivo (3) e contagem de
  dias (3). O arredondamento de caixas de embarque usa `Prisma.Decimal.ceil()`,
  não `Math.ceil`.
- Dos 128 `Number(` da web: 59 são comparação/guarda, 10 alimentam o `CalcHint`
  (conferência com tolerância, nunca autoridade), 4 são `esperado=` do mesmo
  `CalcHint`, 10 são índice/`Int`, 5 são soma exibida, 3 são a aritmética da
  tabela acima. Os demais são condições de badge.
- `packages/shared`: 5 `Number(` — dois em validação de CNPJ, um em DDD de
  telefone, dois em comentário. **Nenhum sobre grandeza.**
- Migrations: 115 declarações de decimal, **zero `ALTER COLUMN`** sobre tipo
  numérico. Nenhuma coluna nasceu sem precisão explícita; nenhum widening ou
  narrowing histórico.

---

## 6. Valores documentais

Apenas **duas colunas** do sistema congelam moeda: `CustomerOrder.
agreedSubtotalAmount` e `CustomerOrder.agreedTotalAmount`, ambas `Decimal(14,2)`.

`PurchaseOrder`, `Receipt`, `Billing` e `QuoteVersion` **não persistem nenhum
total monetário** — todos são derivados na leitura pela função canônica do
documento. Isso é uma força: não existe total histórico congelado para
reconciliar, e ampliar scale de operando não recalcula documento nenhum.

As duas colunas de `CustomerOrder` são **DOCUMENTAL_2DP_CORRECT**: são o valor
acordado que o cliente confere, e `PRODUCT_RULES.md` §55 já fixa que o subtotal é
`Σ round(quantidade × preço, 2)`. **Não ampliar.** Elas ficam fora de qualquer
preferência de exibição (§10.4).

`CustomerOrderLine.agreedUnitPrice` e os dois preços de `BillingLine` também são
contratuais/emitidos. Ampliar o scale deles é possível sem tocar histórico, mas é
decisão comercial, não técnica: um preço acordado de 4 casas é o que está no
documento assinado.

---

## 7. Formatação e UI

### 7.1 Formatters existentes

| Função | Arquivo | min | max | Arredonda | Locale | Opera sobre |
|---|---|---|---|---|---|---|
| `formatBRL` | `lib/currency.ts` | 2 | 2 (padrão BRL) | `toLocaleString` | pt-BR | `string` → `Number` |
| `formatUnitPriceBRL` | `lib/currency.ts` | 2 | **4** | `toLocaleString` | pt-BR | `string` → `Number` |
| `formatQuantity` | `lib/quantity.ts` | 0 | **6** | `toLocaleString`, sem agrupamento | pt-BR | `string` → `Number` |
| `formatQuantityWithUnit` | `lib/quantity.ts` | — | — | delega | — | delega |
| `formatPercent` | `lib/percent.ts` | 0 | **2** | `toLocaleString` | pt-BR | `string` → `Number` |
| `formatDecimalInput` | `lib/decimal-input.ts` | — | — | **nenhum** | — | `string` → `string` |
| (local) `CostBreakdown.tsx:35` | componente | 2 | 2 ou 6 conforme o valor sumir | `toLocaleString` | pt-BR | `string` → `Number` |

Fallback uniforme: `null`/`NaN` → `"—"`. `formatQuantity` devolve `"≈ 0"` para
valor não-zero abaixo de `1e-6`, de propósito.

### 7.2 Precisão visual hardcoded

Sete ocorrências de `minimumFractionDigits`/`maximumFractionDigits`/`toFixed` na
web, **todas nos formatters acima ou em rótulo de tamanho de arquivo**, mais a
única de `print/documents.tsx:353` já classificada. Fora dos formatters existe
**um** `toLocaleString` numérico em todo o `apps/web` (`CostBreakdown.tsx:35`);
todos os outros 30 são data. A formatação está centralizada — a preferência de
exibição tem um alvo pequeno e bem definido.

### 7.3 O que a formatação atual impede no futuro

Todos os formatters convertem `string` → `Number` antes de formatar. Medido:

```
"123456789012.123456"  -> Number -> 123456789012.12346  -> "123456789012,12346"
"999999999999.999999999999" -> Number -> 1000000000000
```

Enquanto o teto for `Decimal(18,6)` isso é inofensivo. **Com scale 12 os
formatters passam a mentir**: acima de ~15 dígitos significativos o double já
perdeu o valor antes de o `Intl` formatar. Ampliar scale obriga a reescrever os
formatters sobre `Decimal`, e esse trabalho pertence à mesma capability da
migration, não a uma rodada posterior.

---

## 8. Round-trip

Valores determinísticos, medidos contra o PostgreSQL local por
`SELECT CAST(… AS numeric(p,s))` — leitura pura, sem escrita em tabela.

**Banco — o que a coluna realmente guarda:**

| Valor | (18,6) | (14,4) | (14,6) | (14,2) | (30,12) |
|---|---|---|---|---|---|
| `0.1` | `0.100000` | `0.1000` | `0.100000` | `0.10` | `0.100000000000` |
| `0.1234` | `0.123400` | `0.1234` | `0.123400` | `0.12` | exato |
| `0.123456` | exato | `0.1235` | exato | `0.12` | exato |
| `0.12345678` | `0.123457` | `0.1235` | `0.123457` | `0.12` | exato |
| `0.123456789012` | `0.123457` | `0.1235` | `0.123457` | `0.12` | **exato** |
| `4.053187640000` | `4.053188` | `4.0532` | `4.053188` | `4.05` | **exato** |
| `123.456789012345` | `123.456789` | `123.4568` | `123.456789` | `123.46` | `123.456789012345` |
| `0.000123456789` | `0.000123` | `0.0001` | `0.000123` | `0.00` | **exato** |
| `0.0000001` | **`0.000000`** | `0.0000` | **`0.000000`** | `0.00` | `0.000000100000` |
| `999999999999.999999999999` | *overflow* | *overflow* | *overflow* | *overflow* | exato |

Arredondamento do PostgreSQL: HALF_UP, consistente com `Decimal.rounding = 4`.

**Web — abrir, não editar, salvar:** `formatDecimalInput` → `parseDecimalInput`,
os dez casos acima: **IDENTICAL em 10/10**, incluindo `4.053187640000`,
`0.123456789012` e `999999999999.999999999999`. O campo de edição **não** destrói
casas. A resposta ao §18 do handoff é **SIM, preserva** — e o motivo é que hoje
não há casa oculta a preservar: a coluna já é o teto.

**Média ponderada** (§25) — quantidades e custos fracionários de 6 casas:

```
Σ(qtd × custo) = 164.51701607376   Σ qtd = 14.111233
média cheia    = 11.65858547398090585    (Decimal, sem arredondamento intermediário)
DTO de custos.service.ts             -> 11.6586
DTO de item-cost-references.service  -> 11.658585
```

A conta preserva precisão total até a apresentação. A divergência é a
serialização inconsistente de §5.1, não a matemática.

---

## 9. Tipos PostgreSQL — a evidência por trás da matriz

**Aprovada pelo PO em 2026-09-05**; a matriz canônica vive em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58. A tabela abaixo é o raciocínio que a
sustenta — o range e a granularidade que cada categoria precisa, e por quê.

`DECIMAL(30,12)` foi **recusado como baseline**, por dois motivos medidos:
`decimal.js` só produz 20 dígitos significativos (R2), e 18 dígitos inteiros são
ordens de grandeza acima de qualquer necessidade da Veridi. O aprovado é
**`DECIMAL(24,12)`** para grandeza técnica — 12 inteiros + 12 decimais, 24
dígitos significativos —, ainda acima do teto atual do `decimal.js`, o que torna
a elevação para 40 dígitos (§59) parte obrigatória da mesma migration.

| Categoria | Tipo aprovado | Máximo inteiro | Menor fração | Justificativa |
|---|---|---|---|---|
| QUANTITY | `DECIMAL(24,12)` | 999.999.999.999 | `1e-12` | R1: `4,8e-8 kg` precisa de 8 casas só para existir; 12 dá margem para mg→kg com overage e pureza encadeados |
| UNIT_COST | `DECIMAL(20,8)` | 999.999.999.999 | `1e-8` | custo por grama de insumo caro; 8 casas cobrem R$/mg |
| UNIT_PRICE (técnico) | `DECIMAL(20,8)` | 999.999.999.999 | `1e-8` | preço unitário de precificação, hoje 14,6 |
| UNIT_PRICE (contratual) | **manter `DECIMAL(14,4)`** | 9.999.999.999 | `1e-4` | valor acordado no documento; ver §6 |
| PERCENTAGE (comercial) | **manter `DECIMAL(7,4)`** | 999 | `1e-4` | desconto, margem, comissão: 4 casas decidem |
| PERCENTAGE (pureza/overage) | `DECIMAL(9,6)` | 999 | `1e-6` | laudo de ensaio dá 99,9995%; hoje 6,3 arredonda para 100,000 |
| RATIO_FACTOR (markup) | **manter `DECIMAL(12,4)`** | 99.999.999 | `1e-4` | indicador de leitura |
| UOM_CONVERSION | `DECIMAL(24,12)` | 999.999.999.999 | `1e-12` | R3: fator multiplica tudo; libra→kg tem 8 casas |
| TECHNICAL_RESULT | `DECIMAL(24,12)` | 999.999.999.999 | `1e-12` | CMV/unidade, custo/unidade, contribuição/unidade |
| RATE | `DECIMAL(20,8)` | 999.999.999.999 | `1e-8` | tarifa de recurso, energia, mão de obra |
| COMMERCIAL_TOTAL | **manter `DECIMAL(14,2)`** | 999.999.999.999 | `0,01` | valor documental congelado; §6 |
| PHYSICAL_MEASUREMENT (kW) | **manter `DECIMAL(12,4)`** | 99.999.999 | `1e-4` | potência de equipamento |
| COUNT | **manter `Int`** | — | — | contagem inteira por definição |

**Maior range necessário:** 12 dígitos inteiros. Justificativa: a maior grandeza
plausível é quantidade em `mg` de um lote industrial — 10 toneladas = `1e10 mg`,
onze dígitos. Doze dá uma ordem de folga sem entrar na faixa em que o double da
UI já falha.

**Menor granularidade necessária:** `1e-12`. Justificativa: `0,045 mg` em item
estocado em `kg` é `4,5e-8`; com pureza e overage encadeados e base fracionária o
resultado desce mais duas a três ordens. Oito casas seriam o mínimo; doze é a
margem que evita uma segunda migration.

---

## 10. Plano de migration — aprovado, nenhuma gerada

Os grupos abaixo viraram os itens **PREC-MIG-A a E** na seção E de
[`BACKLOG.md`](BACKLOG.md): A ≙ Grupo A, e o Grupo B foi separado por categoria
em B (custo), C (pureza/overage) e D (resultado técnico), com E para o que ainda
exige decisão individual. **Nenhuma migration foi gerada** nesta rodada nem na
aprovação.

### Grupo A — widening seguro de grandeza física e técnica
`Decimal(18,6)` → `Decimal(24,12)`. **~40 colunas.** Sem decisão de domínio: o
valor gravado continua o mesmo, apenas passa a caber mais. Inclui os seis campos
de R1.

### Grupo B — precisa decisão de domínio antes
`Decimal(14,4)` → `Decimal(20,8)` para custo, tarifa e preço técnico (**~25
colunas**); `Decimal(6,3)` → `Decimal(9,6)` para pureza e overage (**7
colunas**); `Decimal(14,6)` → `Decimal(20,8)` para preço de precificação (**7
colunas**). Perguntas em §12.

`UnitOfMeasure.toBaseFactor` **saiu deste grupo**: o PO o colocou no PREC-MIG-A
e ele foi entregue lá. Quantidade com doze casas não adianta se a conversão
perder precisão antes dela.

### Grupo C — manter 2 casas
`CustomerOrder.agreedSubtotalAmount`, `CustomerOrder.agreedTotalAmount`.

### Grupo D — não alterar
Os 58 `Int`; `IndustrialResource.powerKw` e `powerKwSnapshot`; markup;
percentuais comerciais `(7,4)`; os dois campos `legacy*` de
`FormulationComponent`; e, salvo decisão comercial, os preços contratuais
`(14,4)` de `CustomerOrderLine` e `BillingLine`.

### Reversibilidade e backfill

Ampliar scale em PostgreSQL (`ALTER COLUMN … TYPE numeric(p,s)` com `s` maior)
**preserva o valor existente** e o reescreve com zeros à direita: `0.123457`
vira `0.123457000000`. Não trunca, não recalcula e não altera nada congelado.
**Backfill: NÃO.** Um valor já gravado com perda permanece como está — §28 do
handoff, e não há como reconstruir a casa que nunca foi persistida.

A operação **não** é reversível na direção contrária sem perda: reduzir scale
truncaria. Por isso a decisão de scale precisa nascer certa, e por isso 12 e não 8.

### Sequência aprovada

1. **#20 + PREC-MIG-A** — **ENTREGUE em 2026-09-05.** Precisão canônica em 40
   dígitos (§59) nos dois construtores, e widening de 43 colunas —
   39 QUANTITY, 1 FACTOR (`toBaseFactor`) e 3 TECHNICAL_RESULT que já estavam em
   `18,6` — para `DECIMAL(24,12)`. Os três resultados técnicos saem do residual
   do PREC-MIG-D, que fica só com os de `14,4` e `14,6`. Migration
   `20260925093001_numeric_precision_quantities_24_12`, sem backfill: 371
   valores existentes conferidos antes e depois, zero divergência matemática.
2. **PREC-MIG-B** — **ENTREGUE em 2026-09-05.** As três colunas UNIT_COST em
   `DECIMAL(20,8)`: `ReceiptLine.actualUnitCost`, `ItemCostReference.unitCost` e
   `SupplierItemOffer.unitPrice`. Migration
   `20260925093002_numeric_precision_unit_cost_20_8`, sem backfill.
   `PurchaseOrderLine.unitPrice` ficou fora: a linha do inventário diz "Sim — B",
   mas a **categoria** é UNIT_PRICE, e o PREC-MIG-B do PO é UNIT_COST.
3. **PREC-MIG-C e D** — pureza e overage em `DECIMAL(9,6)`, demais resultados
   técnicos.
4. **PREC-SER-01, PREC-SER-02 e PREC-FMT-01** — não são migration de schema, mas
   precisam entrar depois do widening para que a serialização já espelhe o scale
   novo. `PREC-FMT-01` é pré-requisito de qualquer preset acima de seis casas.
5. **PREC-MIG-E** — o que exigir decisão individual, caso a caso.

**Ordem obrigatória:** `Decimal.precision` **antes ou junto** do widening. Ampliar
a coluna sem ampliar o motor cria coluna que o sistema não consegue preencher.

---

## 11. Preferências de exibição — desenho aprovado, nada implementado

Aprovado como roadmap pelo PO em 2026-09-05, **depois da fundação**, e nomeado
em PREC-UI-01 a 08 na seção E de [`BACKLOG.md`](BACKLOG.md). Os invariantes que
a implementação não pode violar são regra durável em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57.

### 11.1 Arquitetura

Preferência **só de apresentação**, em duas camadas:

1. **Perfil do usuário** — persistido, um registro por usuário.
   `User.displayPrecisionPreset` + overrides por categoria.
2. **Override de sessão** — em memória do cliente, não persistido, descartado ao
   sair. Vence o perfil enquanto existir.

Nenhuma das duas chega ao servidor num payload de escrita. A API continua
respondendo o scale da coluna; a escolha acontece depois, no formatter.

**Viável?** Perfil por usuário: **SIM** — existe `User`, e a formatação está
centralizada em cinco funções. Override de sessão: **SIM** — é estado de
contexto React sobre as mesmas funções.

**Pré-requisito técnico:** os formatters precisam operar sobre `Decimal`, não
sobre `Number` (§7.3). Sem isso, um preset "máxima precisão" mostraria lixo de
double.

### 11.2 Categorias configuráveis independentes

Sete, espelhando as categorias do inventário: **Quantidade**, **Custo unitário**,
**Preço unitário**, **Percentual**, **Pureza/overage**, **Fator/conversão**,
**CMV/resultado técnico**. Um número global único é recusado: quantidade em kg e
margem em % não têm a mesma leitura útil.

### 11.3 Presets

Os números abaixo saem da auditoria — mínimo = o que a leitura exige, máximo = o
que a coluna guardará após a migration.

| Categoria | Compacta | Padrão | Técnica | Máxima |
|---|---|---|---|---|
| Quantidade | 2 | 6 (hoje) | 8 | scale da coluna |
| Custo unitário | 2 | 4 (hoje) | 6 | scale da coluna |
| Preço unitário | 2 | 2–4 (hoje) | 6 | scale da coluna |
| Percentual | 0 | 2 (hoje) | 4 | scale da coluna |
| Pureza/overage | 1 | 2 | 4 | scale da coluna |
| Fator/conversão | 2 | 4 | 8 | scale da coluna |
| CMV/resultado técnico | 2 | 4 (hoje) | 8 | scale da coluna |

"Padrão" reproduz o comportamento atual — a preferência não muda nada para quem
não escolher. "Personalizada" libera as sete categorias.

### 11.4 O que a preferência NÃO alcança

- **Totais documentais congelados.** `R$ 172,84` continua `R$ 172,84` em modo
  técnico. As duas colunas de §6 e todo total produzido por
  `calcularTotaisOrcamento` / `calcularTotaisFaturamento` /
  `calcularTotaisOrdemCompra` são imunes. **SIM, excluídos.**
- **Documentos impressos.** Papel é registro; formato de papel é regra, não
  preferência.
- **Qualquer valor persistido.** A preferência vive depois da API.

### 11.5 Campo em foco

Padrão recomendado, para implementação futura:

- **leitura** — valor formatado conforme a preferência ativa;
- **foco/edição** — valor completo do servidor, sem máscara
  (`formatDecimalInput`, que já não arredonda);
- **blur** — volta à máscara;
- **salvar sem alterar** — envia o texto original, byte a byte.

Os três primeiros já são o comportamento atual. O quarto está provado em §8.
A implementação futura precisa **preservar** isso, não construir.

---

## 12. Decisões do PO e o que ainda falta

A auditoria abriu sete perguntas. **O PO respondeu seis em 2026-09-05**, na
aprovação de PREC-01. As decisões duráveis estão em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57, §58 e §59; o que segue é o
fechamento de cada pergunta desta auditoria.

| Pergunta | Decisão do PO |
|---|---|
| Scale de quantidade — 12 casas confirma? | **Sim.** QUANTITY em `DECIMAL(24,12)`, §58 |
| `ReceiptLine.actualUnitCost` — 4 ou 8 casas? | **8.** `DECIMAL(20,8)`, por ser fonte de custo real que alimenta aquisição, média ponderada, estoque e CMV — PREC-MIG-B |
| `QuoteLine.unitPrice` — ampliar ou manter? | **Manter.** É preço do documento comercial; snapshot histórico não sofre widening por decisão técnica, §58 |
| Preço contratual (`CustomerOrderLine`, `BillingLine`) — ampliar? | **Não.** Mesma regra: o valor do documento assinado é o valor do documento |
| Pureza e overage — 3 ou 6 casas? | **6.** `DECIMAL(9,6)`, para que `99,9995%` não vire `100,000` — PREC-MIG-C |
| `toBaseFactor` — ampliar agora? | **Agora.** FACTOR/conversão em `DECIMAL(24,12)`, dentro de PREC-MIG-A |
| `print/documents.tsx:353` deve usar `splitDecimal`? | **Sim.** Vira PREC-FMT/#21, independente de migration |

E decidiu também o que a auditoria não tinha perguntado: `decimal.js` sobe para
**40 dígitos significativos**, numa configuração canônica só (§59), e
`DECIMAL(30,12)` fica recusado como baseline.

**O que continua aberto — PREC-MIG-E.** Os campos que a matriz de §58 não
resolve sozinha e que exigem decisão individual, caso a caso, no momento em que
a fundação já estiver no lugar:

- `IndustrialResource.powerKw` e `powerKwSnapshot` — `Decimal(12,4)` hoje;
  ampliar só se a medição de energia passar a exigir;
- `PricingTier.*Snapshot` de totais em `Decimal(14,4)` — são snapshot de
  precificação, e a fronteira entre resultado técnico e valor congelado precisa
  ser dita campo a campo;
- `FormulationComponent.legacyTotalQuantity` e `legacyBatchUnits` — dado
  importado do legado, `NOT_APPLICABLE` enquanto ninguém calcular sobre eles;
- percentuais comerciais em `Decimal(7,4)` — mantidos, mas revisitar se margem
  ou comissão passarem a ser negociadas com mais casas.

Nenhum deles bloqueia PREC-MIG-A.

---

## 13. Plano de testes obrigatório da capability de implementação

Nenhum widening entra sem estes testes. A auditoria mediu o comportamento atual;
os testes abaixo travam o comportamento novo e provam que o antigo não volta.

**Precisão do motor** — antes de qualquer coluna. Provar que
`new Decimal("123456789012.123456789012").times(1)` devolve o valor íntegro, e
que a configuração é **uma só**: um teste que falhe se `Decimal.set()` aparecer
fora do ponto canônico.

**Round-trip do banco.** Para cada categoria da matriz de §58, gravar e ler o
valor de referência da sua granularidade e comparar exatamente: 2, 4, 6, 8 e 12
casas, mais `0,000000048` e `0,000123456789`. Esperado: IDENTICAL.

**Round-trip da API.** O DTO devolve o scale da coluna, nem mais nem menos. Um
teste por serializador corrigido em PREC-SER-01, incluindo o caso que hoje
diverge — a mesma média ponderada servida por dois endpoints tem que sair igual.

**Round-trip da UI.** Abrir, não editar, salvar: o valor gravado é byte a byte o
anterior. Vale para os fluxos de Formulação, Precificação, OC, Recebimento,
Faturamento e Contagem de Estoque — um por família de tela, não um só.

**Casa oculta.** Com preferência de exibição reduzida, o campo em edição revela
a precisão íntegra e o submit preserva o que não estava visível. Enquanto
PREC-UI não existir, o teste roda contra `formatDecimalInput`.

**Microdosagem — o caso que originou #19.** `MP-000147` a `0,000048 kg` sobre
base 1000, produzindo 1, 5, 10, 11, 100 e 1000 unidades: nenhum `requiredQuantity`
grava zero, e o valor bate com o do motor sem arredondamento. Este teste é a
prova de que #19 fechou.

**UOM.** Conversão `mg → kg` e `mL → L` em cadeia com pureza e overage, com o
resultado conferido contra a aritmética exata. Um caso com fator não decimal
(oito casas) para provar que `toBaseFactor` ampliado não trunca.

**Custo.** Média ponderada 30d/90d com quantidades fracionárias e custos de 6 a
12 casas; último custo real; custo do lote consumido; referência manual; oferta
de fornecedor. Comparar contra o valor exato, não contra o valor arredondado.

**Formulação.** `PHYSICAL_DIRECT` e `THEORETICAL_WITH_ADJUSTMENTS`, com
`FIXED_BASIS`, `PER_DOSE` e `PER_FINISHED_UNIT`, pureza e overage encadeados:
nenhum arredondamento antes do resultado final.

**CMV e precificação.** Custo industrial, custo por unidade, custo por mil,
contribuição e preço sugerido: a cadeia interna permanece em `Decimal` e só a
saída arredonda.

**Compras e recebimento.** Preço unitário preservado; recebimento parcial
independente do total; nenhum total documental persistido.

**Documentos históricos — o teste que protege o que não pode mudar.** Um
Orçamento, um Pedido e um Faturamento gravados **antes** da migration mantêm
exatamente o valor congelado depois dela. Widening não é backfill: se este teste
mudar de valor, a migration está errada.

**Gate de regressão de escala.** Um teste que leia o `schema.prisma` e recuse
coluna numérica nova fora da matriz de §58 — o mesmo espírito de
`scripts/migration-order.test.ts`, para que a decisão não se perca na próxima
capability que criar uma tabela.

## Reprodutibilidade

Os números deste documento vieram de quatro scripts temporários, **removidos após
a auditoria** e reproduzíveis a partir daqui:

1. **Precisão real do banco** — `information_schema.columns` filtrado por
   `numeric|integer|bigint|smallint` em `table_schema='public'` e
   `table_type='BASE TABLE'`, comparado com os pares `tabela|coluna|tipo|p,s`
   extraídos do `schema.prisma` (respeitando `@map`/`@@map`). Resultado: 164
   pares idênticos, 1 coluna só no banco (`_prisma_migrations`).
2. **Round-trip do PostgreSQL** — `SELECT CAST($1::text AS numeric(p,s))::text`
   para os dez valores de §8 contra os sete tipos em uso mais `(30,12)`. Leitura
   pura: nenhuma tabela escrita.
3. **Motor de Formulação** — `calcularQuantidadeDoComponente` de
   `packages/shared/dist`, aplicado ao componente real `MP-000147` do banco
   local, para as sete quantidades produzidas de R1.
4. **Camada web** — `formatDecimalInput`/`parseDecimalInput`/`formatQuantity`/
   `complementoDaLinha` reproduzidos byte a byte a partir do código de
   `apps/web/src/lib` e de `CustomerOrderPage.tsx`.

Todos usam `scripts/local-db-guard.mjs` (`exigirBancoLocal`) e recusam qualquer
destino que não seja localhost. **Produção nunca foi consultada.**
